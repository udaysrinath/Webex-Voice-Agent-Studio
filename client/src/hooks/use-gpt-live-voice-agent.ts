import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptEntry, VoiceActivity, VoiceAgentState } from "@/hooks/use-voice-agent";
import { hasHrClosingFinished } from "@/lib/hr-call-completion";
import { hasHrDeliveryClosing, shouldNudgeHrClosing } from "@/lib/hr-closing-nudge";
import { HrLiveToolCoordinator, type HrLiveToolCall } from "@/lib/hr-live-tools";
import { HR_FEEDBACK_CLOSING } from "@shared/use-cases";

interface UseGptLiveVoiceAgentOptions {
  agentId: number;
  onEvent?: (event: any) => void;
}

interface LiveSessionResponse {
  session: { id: string };
  transport: { type: "webrtc"; sdp: string };
}

export function useGptLiveVoiceAgent(options: UseGptLiveVoiceAgentOptions) {
  const [state, setState] = useState<VoiceAgentState>("idle");
  const [activity, setActivity] = useState<VoiceActivity>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [userPartial, setUserPartial] = useState("");
  const [assistantPartial, setAssistantPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const userTranscriptRef = useRef("");
  const userTranscriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantTranscriptRef = useRef("");
  const userTurnIdRef = useRef(0);
  const reportedGuardrailsRef = useRef(new Set<string>());
  const onEventRef = useRef(options.onEvent);
  const closedRef = useRef(true);
  const feedbackDeliveredRef = useRef(false);
  const latestUserTextRef = useRef("");
  const automaticCloseRef = useRef(false);
  const closeRequestedAtRef = useRef(0);
  const closeWatchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closeResponseSeenRef = useRef(false);
  const closeQuietSinceRef = useRef(0);
  const closeLastTranscriptAtRef = useRef(0);
  const closeSpeechHeardRef = useRef(false);
  const closeTextRef = useRef("");
  const closeEnergyRef = useRef<{ energy: number; duration: number } | null>(null);
  const toolsRef = useRef<HrLiveToolCoordinator | null>(null);
  const closingStartedRef = useRef(false);
  const closingNudgeCountRef = useRef(0);
  const closingNudgeAtRef = useRef(0);
  const closingNudgeEventRef = useRef("");
  const closingFailureReportedRef = useRef(false);
  const deliveredResultRef = useRef<any>(null);

  useEffect(() => {
    onEventRef.current = options.onEvent;
  }, [options.onEvent]);

  const appendTranscript = useCallback((role: TranscriptEntry["role"], text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    setTranscript((current) => {
      const previous = current[current.length - 1];
      if (previous?.role === role) {
        if (normalizeTranscript(previous.text) === normalizeTranscript(cleaned)) return current;
        const merged = joinTranscriptText(previous.text, cleaned);
        return [
          ...current.slice(0, -1),
          { ...previous, text: merged, timestamp: Date.now() },
        ];
      }
      return [...current, { role, text: cleaned, timestamp: Date.now() }];
    });
  }, []);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    if (channelRef.current?.readyState === "open") {
      channelRef.current.send(JSON.stringify(event));
      return true;
    }
    return false;
  }, []);

  const commitAssistantTranscript = useCallback(() => {
    const text = assistantTranscriptRef.current;
    assistantTranscriptRef.current = "";
    setAssistantPartial("");
    appendTranscript("assistant", text);
  }, [appendTranscript]);

  const runGuardrail = useCallback(async (text: string, turnId: number) => {
    try {
      const response = await fetch("/api/live/hr/guardrail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok || closedRef.current) return;
      const { match } = await response.json();
      if (!match) return;
      const guardrailKey = `${turnId}:${match.category}`;
      if (reportedGuardrailsRef.current.has(guardrailKey)) return;
      reportedGuardrailsRef.current.add(guardrailKey);
      onEventRef.current?.({
        type: "guardrailTriggered",
        category: match.category,
        title: match.label,
        detail: "Restricted content was excluded from the feedback summary.",
        timestamp: Date.now(),
      });
    } catch {
      // The Live prompt still applies if the local deterministic guardrail check is unavailable.
    }
  }, []);

  const commitUserTranscript = useCallback(() => {
    if (userTranscriptTimerRef.current) {
      clearTimeout(userTranscriptTimerRef.current);
      userTranscriptTimerRef.current = null;
    }
    const text = userTranscriptRef.current.trim();
    const turnId = userTurnIdRef.current;
    userTranscriptRef.current = "";
    userTurnIdRef.current += 1;
    setUserPartial("");
    if (!text) return;
    appendTranscript("user", text);
    latestUserTextRef.current = text;
    const explicitHangup = /\b(goodbye|bye|hang up|end (?:the )?call|get off (?:the )?call|disconnect|we can (?:get off|end) (?:the )?call)\b/i.test(text);
    const politeCompletion = /\b(thanks?|thank you|that's all|that is all|i'm done|i am done|no,? that'?s all|nothing else)\b/i.test(text);
    if (!closingStartedRef.current && !automaticCloseRef.current && (explicitHangup || (feedbackDeliveredRef.current && politeCompletion))) {
      automaticCloseRef.current = true;
      closeRequestedAtRef.current = Date.now();
      closeResponseSeenRef.current = false;
      closeQuietSinceRef.current = 0;
    }
    onEventRef.current?.({ type: "userTranscript", text });
    onEventRef.current?.({ type: "userSpeechStopped", timestamp: Date.now() });
    setState((current) => current === "speaking" ? current : "listening");
    setActivity((current) => current === "agent_speaking" ? current : "ready");
    void runGuardrail(text, turnId);
  }, [appendTranscript, runGuardrail]);

  const scheduleUserGuardrailCheck = useCallback(() => {
    if (userTranscriptTimerRef.current) clearTimeout(userTranscriptTimerRef.current);
    userTranscriptTimerRef.current = setTimeout(() => {
      userTranscriptTimerRef.current = null;
      const text = userTranscriptRef.current.trim();
      if (text) void runGuardrail(text, userTurnIdRef.current);
    }, USER_TRANSCRIPT_TURN_GAP_MS);
  }, [runGuardrail]);

  const executeToolCall = useCallback(async (item: HrLiveToolCall): Promise<any> => {
    const name = String(item.name || "");
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(item.arguments || "{}"); } catch {}
    onEventRef.current?.({ type: "toolCallStarted", toolName: name, args: {}, timestamp: Date.now() });
    let result: any;
    if (name === "voice_end_call") {
      const explicitHangup = /\b(goodbye|bye|hang up|end (?:the )?call|get off (?:the )?call|disconnect)\b/i.test(latestUserTextRef.current);
      const allowed = explicitHangup || feedbackDeliveredRef.current;
      result = allowed
        ? { success: true, result: "The application will close after the full closing message finishes. Do not ask for another goodbye." }
        : { success: false, error: "Deliver the confirmed summary first, or wait for an explicit caller hang-up request." };
      if (allowed && !automaticCloseRef.current) {
        automaticCloseRef.current = true;
        closeRequestedAtRef.current = Date.now();
        closeResponseSeenRef.current = false;
        closeQuietSinceRef.current = 0;
      }
    } else if (name === "hr_submit_feedback") {
      // A backend retry must not deliver the same interview a second time.
      if (feedbackDeliveredRef.current) result = deliveredResultRef.current;
      else {
        try {
          const response = await fetch("/api/live/hr/tool", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, arguments: args }), signal: AbortSignal.timeout(20000),
          });
          result = await response.json();
          if (!response.ok) result = { success: false, error: result.error || "Feedback delivery failed." };
          if (closedRef.current) return result;
          if (result.success === true) {
            deliveredResultRef.current = result;
            feedbackDeliveredRef.current = true;
            automaticCloseRef.current = true;
            closeRequestedAtRef.current = Date.now();
            closeResponseSeenRef.current = false;
            closeQuietSinceRef.current = 0;
            closeLastTranscriptAtRef.current = 0;
            closeSpeechHeardRef.current = false;
            closeTextRef.current = "";
            closeEnergyRef.current = null;
            onEventRef.current?.({ type: "feedbackDelivered", timestamp: Date.now() });
          }
        } catch {
          result = { success: false, error: "Delivery could not be confirmed. Do not claim success or automatically retry the submission." };
        }
      }
    } else {
      result = { success: false, error: "Unsupported HR tool." };
    }
    if (!closedRef.current) onEventRef.current?.({
      type: "toolCallCompleted", toolName: name, success: result.success === true,
      result: result.result, error: result.error, data: result.data,
      durationMs: result.durationMs, timestamp: Date.now(),
    });
    return result;
  }, []);

  const handleLiveEvent = useCallback((event: any) => {
    switch (event?.type) {
      case "session.started":
        setState("listening");
        setActivity("ready");
        onEventRef.current?.({ type: "liveSessionReady", timestamp: Date.now() });
        sendEvent({ type: "response.create", event_id: `greeting_response_${Date.now()}` });
        break;
      case "session.output_transcript.delta":
        commitUserTranscript();
        assistantTranscriptRef.current += String(event.delta || "");
        setAssistantPartial(assistantTranscriptRef.current);
        if (automaticCloseRef.current) {
          closeResponseSeenRef.current = true;
          closeLastTranscriptAtRef.current = Date.now();
          closeTextRef.current += String(event.delta || "");
        }
        setState("speaking");
        setActivity("agent_speaking");
        break;
      case "session.output_transcript.done":
      case "session.output_audio_transcript.done":
      case "response.done":
        commitAssistantTranscript();
        setState("listening");
        setActivity((current) => current === "agent_speaking" ? "ready" : current);
        break;
      case "session.input_transcript.delta":
        if (!userTranscriptRef.current) {
          commitAssistantTranscript();
          onEventRef.current?.({ type: "userSpeechStarted", timestamp: Date.now() });
        }
        userTranscriptRef.current += String(event.delta || "");
        setUserPartial(userTranscriptRef.current);
        scheduleUserGuardrailCheck();
        setState("listening");
        setActivity("user_speaking");
        break;
      case "response.event":
        void toolsRef.current?.handle(event);
        break;
      case "session.commentary.appended":
      case "session.instructions.appended":
        if (event.client_event_id === closingNudgeEventRef.current) {
          onEventRef.current?.({ type: "hrClosingAccepted", timestamp: Date.now() });
          console.info("[HR closing] Live update accepted", closingNudgeCountRef.current);
        }
        break;
      case "session.closed":
        commitUserTranscript();
        commitAssistantTranscript();
        setState("idle");
        setActivity("idle");
        break;
      case "error":
        setError(event.error?.message || "The voice session encountered an error.");
        console.error("[HR Live]", event.error?.message || "Voice session error", event.client_event_id);
        onEventRef.current?.({ type: "hrLiveError", clientEventId: event.client_event_id, timestamp: Date.now() });
        break;
    }
  }, [commitAssistantTranscript, commitUserTranscript, executeToolCall, scheduleUserGuardrailCheck, sendEvent]);

  const cleanup = useCallback(() => {
    closedRef.current = true;
    toolsRef.current?.dispose();
    toolsRef.current = null;
    closingNudgeCountRef.current = 0;
    closingNudgeAtRef.current = 0;
    closingNudgeEventRef.current = "";
    closingFailureReportedRef.current = false;
    closingStartedRef.current = false;
    deliveredResultRef.current = null;
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    audioRef.current = null;
    if (userTranscriptTimerRef.current) {
      clearTimeout(userTranscriptTimerRef.current);
      userTranscriptTimerRef.current = null;
    }
    userTurnIdRef.current = 0;
    reportedGuardrailsRef.current.clear();
    userTranscriptRef.current = "";
    assistantTranscriptRef.current = "";
    setAssistantPartial("");
    feedbackDeliveredRef.current = false;
    latestUserTextRef.current = "";
    automaticCloseRef.current = false;
    closeRequestedAtRef.current = 0;
    closeResponseSeenRef.current = false;
    closeQuietSinceRef.current = 0;
    closeLastTranscriptAtRef.current = 0;
    closeSpeechHeardRef.current = false;
    closeTextRef.current = "";
    closeEnergyRef.current = null;
    if (closeWatchTimerRef.current) {
      clearInterval(closeWatchTimerRef.current);
      closeWatchTimerRef.current = null;
    }
  }, []);

  const requestDeliveryClosing = useCallback(() => {
    if (closedRef.current || !feedbackDeliveredRef.current) return;
    if (!closingStartedRef.current) {
      closingStartedRef.current = true;
      closeRequestedAtRef.current = Date.now();
      closeTextRef.current = "";
      closeResponseSeenRef.current = false;
      closeSpeechHeardRef.current = false;
      closeQuietSinceRef.current = 0;
      closeEnergyRef.current = null;
    }
    closingNudgeAtRef.current = Date.now();
    automaticCloseRef.current = true;
    closingNudgeCountRef.current++;
    const eventId = "hr_closing_" + Date.now() + "_" + closingNudgeCountRef.current;
    closingNudgeEventRef.current = eventId;
    const retry = closingNudgeCountRef.current > 1;
    const sent = sendEvent({
      type: retry ? "session.instructions.append" : "session.commentary.append",
      event_id: eventId, delegation_id: null,
      content: retry
        ? "The summary was successfully delivered to Webex. Finish the interview now in your normal voice: confirm the summary was sent to the Webex space for Alex Morgan's development review, thank the caller, and end with Have a nice day. Do not narrate these instructions, ask another question, or send feedback again."
        : HR_FEEDBACK_CLOSING,
    });
    onEventRef.current?.({ type: "hrClosingRequested", attempt: closingNudgeCountRef.current, sent, timestamp: Date.now() });
    if (!sent) setError("Your summary was sent, but the closing update could not reach the voice connection.");
  }, [sendEvent]);

  const start = useCallback(async () => {
    cleanup();
    closedRef.current = false;
    toolsRef.current = new HrLiveToolCoordinator({
      execute: executeToolCall,
      result: (call, result) => {
        if (!sendEvent({ type: "response.item.create", event_id: `hr_result_${call.call_id}_${Date.now()}`,
          item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) } })) {
          throw new Error("The HR tool result could not reach the voice connection.");
        }
      },
      continue: () => {
        if (!sendEvent({ type: "response.create", event_id: `hr_continue_${Date.now()}` })) {
          setError("The HR backend could not be resumed.");
        }
        if (feedbackDeliveredRef.current && !closingStartedRef.current) requestDeliveryClosing();
      },
      error: (message) => {
        setError(message);
        onEventRef.current?.({ type: "hrBackendError", message, timestamp: Date.now() });
        if (feedbackDeliveredRef.current && !closingStartedRef.current) requestDeliveryClosing();
      },
    });
    setError(null);
    setTranscript([]);
    setUserPartial("");
    setAssistantPartial("");
    setState("connecting");
    setActivity("connecting");
    onEventRef.current?.({ type: "hrSessionStarted", profileId: "hr-feedback", timestamp: Date.now() });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      audioRef.current = audio;
      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void audio.play().catch(() => setError("Browser audio playback was blocked. Select Start again."));
      };
      closeWatchTimerRef.current = setInterval(async () => {
        if (!automaticCloseRef.current || closedRef.current) return;
        const activePeer = peerRef.current;
        const receiver = activePeer?.getReceivers().find((entry) => entry.track.kind === "audio");
        let audioLevel: number | null = null;
        try {
          const stats = await receiver?.getStats();
          stats?.forEach((report) => {
            if (report.type === "inbound-rtp" && report.kind === "audio" && typeof report.audioLevel === "number") {
              audioLevel = report.audioLevel;
            } else if (report.type === "inbound-rtp" && report.kind === "audio"
              && typeof report.totalAudioEnergy === "number" && typeof report.totalSamplesDuration === "number") {
              const previous = closeEnergyRef.current;
              if (previous && report.totalSamplesDuration > previous.duration) {
                audioLevel = Math.sqrt(Math.max(0, report.totalAudioEnergy - previous.energy)
                  / (report.totalSamplesDuration - previous.duration));
              }
              closeEnergyRef.current = { energy: report.totalAudioEnergy, duration: report.totalSamplesDuration };
            }
          });
        } catch {}
        if (closedRef.current || activePeer !== peerRef.current) return;
        const audioElement = audioRef.current;
        if (audioLevel !== null && audioLevel >= 0.015) closeSpeechHeardRef.current = true;
        const playbackQuiet = audioLevel !== null
          ? audioLevel < 0.015
          : Boolean(audioElement && audioElement.ended);
        if (!playbackQuiet) closeQuietSinceRef.current = 0;
        else if (!closeQuietSinceRef.current) closeQuietSinceRef.current = Date.now();
        const elapsed = Date.now() - closeRequestedAtRef.current;
        const quietFor = closeQuietSinceRef.current ? Date.now() - closeQuietSinceRef.current : 0;
        const transcriptQuietFor = Date.now() - closeLastTranscriptAtRef.current;
        // Never use a seven-second deadline measured from tool delivery: this
        // closing line itself can take longer than that to speak.
        const fullClosing = !feedbackDeliveredRef.current || hasHrDeliveryClosing(closeTextRef.current);
        const playbackFinished = fullClosing && hasHrClosingFinished({
          responseSeen: closeResponseSeenRef.current, speechHeard: closeSpeechHeardRef.current,
          audioLevel, quietForMs: quietFor, transcriptQuietForMs: transcriptQuietFor,
          closingText: closeTextRef.current,
        });
        if (feedbackDeliveredRef.current && shouldNudgeHrClosing({
          attempts: closingNudgeCountRef.current,
          sinceNudgeMs: Date.now() - closingNudgeAtRef.current,
          transcriptQuietMs: closeLastTranscriptAtRef.current ? transcriptQuietFor : elapsed,
          audioLevel, text: closeTextRef.current,
        })) requestDeliveryClosing();
        if (feedbackDeliveredRef.current && elapsed > 60000 && !fullClosing && !closingFailureReportedRef.current) {
          closingFailureReportedRef.current = true;
          setError("Your summary was sent to Webex, but the voice confirmation has not completed. You can end the call manually.");
          onEventRef.current?.({ type: "hrClosingFailed", timestamp: Date.now() });
        }
        if (elapsed > 900 && playbackFinished) {
          if (closeWatchTimerRef.current) clearInterval(closeWatchTimerRef.current);
          closeWatchTimerRef.current = null;
          automaticCloseRef.current = false;
          commitAssistantTranscript();
          onEventRef.current?.({ type: "callEndedAutomatically", timestamp: Date.now() });
          sendEvent({ type: "session.close", event_id: `auto_close_${Date.now()}` });
          appendTranscript("system", "Voice call ended.");
          cleanup();
          setUserPartial("");
          setState("idle");
          setActivity("idle");
        }
      }, 200);
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed") {
          setError("The voice connection failed.");
          setState("idle");
          setActivity("idle");
          cleanup();
        }
      };
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.addEventListener("message", (message) => {
        try {
          handleLiveEvent(JSON.parse(message.data));
        } catch {}
      });
      channel.addEventListener("close", () => {
        if (closedRef.current) return;
        setState("idle");
        setActivity("idle");
        cleanup();
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      const response = await fetch("/api/live/hr/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: options.agentId, sdp: peer.localDescription?.sdp }),
      });
      const result = await response.json() as LiveSessionResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to start the voice session.");
      await peer.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
    } catch (startError: any) {
      setError(startError?.message || "Unable to start the voice session.");
      setState("idle");
      setActivity("idle");
      cleanup();
    }
  }, [appendTranscript, cleanup, commitAssistantTranscript, executeToolCall, handleLiveEvent, options.agentId, requestDeliveryClosing, sendEvent]);

  const stop = useCallback(() => {
    commitUserTranscript();
    commitAssistantTranscript();
    sendEvent({ type: "session.close", event_id: `close_${Date.now()}` });
    appendTranscript("system", "Voice call ended.");
    cleanup();
    setUserPartial("");
    setState("idle");
    setActivity("idle");
  }, [appendTranscript, cleanup, commitAssistantTranscript, commitUserTranscript, sendEvent]);

  useEffect(() => cleanup, [cleanup]);

  return {
    state,
    activity,
    transcript,
    userPartial,
    assistantPartial,
    error,
    start,
    stop,
  };
}

const USER_TRANSCRIPT_TURN_GAP_MS = 550;

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, 5000);
    function finish() {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", handleStateChange);
      resolve();
    }
    const handleStateChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      finish();
    };
    peer.addEventListener("icegatheringstatechange", handleStateChange);
  });
}

function normalizeTranscript(text: string): string {
  return text.toLowerCase().replace(/[.!?,\s]+$/g, "");
}

function joinTranscriptText(current: string, next: string): string {
  return /^[,.;:!?')\]}]/.test(next)
    ? `${current}${next}`
    : `${current} ${next}`;
}
