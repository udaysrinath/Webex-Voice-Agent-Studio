import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptEntry, VoiceActivity, VoiceAgentState } from "@/hooks/use-voice-agent";

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
    }
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
    if (explicitHangup || (feedbackDeliveredRef.current && politeCompletion)) {
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

  const executeToolCall = useCallback(async (envelope: any) => {
    const item = envelope?.event?.item;
    if (envelope?.event?.type !== "response.output_item.done" || item?.type !== "function_call") return;
    const name = String(item.name || "");
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(item.arguments || "{}");
    } catch {}

    if (name === "voice_end_call") {
      const explicitHangup = /\b(goodbye|bye|hang up|end (?:the )?call|get off (?:the )?call|disconnect|we can (?:get off|end) (?:the )?call)\b/i.test(latestUserTextRef.current);
      const politeCompletion = /\b(thanks?|thank you|that's all|that is all|i'm done|i am done|no,? that'?s all|nothing else)\b/i.test(latestUserTextRef.current);
      const allowed = explicitHangup || (feedbackDeliveredRef.current && politeCompletion);
      const result = allowed
        ? { success: true, result: "The caller confirmed they are done. Close the call after the farewell finishes." }
        : { success: false, error: "Do not end yet: confirm the feedback summary was delivered and the caller clearly indicated they are done, or wait for an explicit goodbye or hang-up request." };
      onEventRef.current?.({
        type: "toolCallStarted",
        toolName: name,
        args: {},
        timestamp: Date.now(),
      });
      sendEvent({
        type: "response.item.create",
        event_id: `tool_result_${Date.now()}`,
        item: { type: "function_call_output", call_id: item.call_id, output: JSON.stringify(result) },
      });
      if (allowed) {
        onEventRef.current?.({ type: "toolCallCompleted", toolName: name, success: true, result: result.result, timestamp: Date.now() });
        automaticCloseRef.current = true;
        closeRequestedAtRef.current = Date.now();
        closeQuietSinceRef.current = 0;
      } else {
        onEventRef.current?.({ type: "toolCallCompleted", toolName: name, success: false, error: result.error, timestamp: Date.now() });
        sendEvent({ type: "response.create", event_id: `continue_${Date.now()}` });
      }
      return;
    }

    if (name !== "hr_submit_feedback") return;

    onEventRef.current?.({ type: "toolCallStarted", toolName: name, args: {}, timestamp: Date.now() });
    try {
      const response = await fetch("/api/live/hr/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, arguments: args }),
      });
      const result = await response.json();
      onEventRef.current?.({
        type: "toolCallCompleted",
        toolName: name,
        success: result.success === true,
        result: result.result,
        error: result.error,
        data: result.data,
        durationMs: result.durationMs,
        timestamp: Date.now(),
      });
      if (result.success) {
        feedbackDeliveredRef.current = true;
        onEventRef.current?.({ type: "feedbackDelivered", timestamp: Date.now() });
      }
      sendEvent({
        type: "response.item.create",
        event_id: `tool_result_${Date.now()}`,
        item: {
          type: "function_call_output",
          call_id: item.call_id,
          output: JSON.stringify(result),
        },
      });
      sendEvent({ type: "response.create", event_id: `continue_${Date.now()}` });
    } catch {
      onEventRef.current?.({
        type: "toolCallCompleted",
        toolName: name,
        success: false,
        error: "The feedback delivery service was unavailable.",
        timestamp: Date.now(),
      });
    }
  }, [sendEvent]);

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
        if (automaticCloseRef.current) closeResponseSeenRef.current = true;
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
        void executeToolCall(event);
        break;
      case "session.closed":
        commitUserTranscript();
        commitAssistantTranscript();
        setState("idle");
        setActivity("idle");
        break;
      case "error":
        setError(event.error?.message || "The voice session encountered an error.");
        break;
    }
  }, [commitAssistantTranscript, commitUserTranscript, executeToolCall, scheduleUserGuardrailCheck, sendEvent]);

  const cleanup = useCallback(() => {
    closedRef.current = true;
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
    if (closeWatchTimerRef.current) {
      clearInterval(closeWatchTimerRef.current);
      closeWatchTimerRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    cleanup();
    closedRef.current = false;
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
            }
          });
        } catch {}
        const audioElement = audioRef.current;
        if (!closeResponseSeenRef.current) return;
        const playbackQuiet = audioLevel !== null
          ? audioLevel < 0.015
          : Boolean(audioElement && audioElement.ended);
        if (!playbackQuiet) closeQuietSinceRef.current = 0;
        else if (!closeQuietSinceRef.current) closeQuietSinceRef.current = Date.now();
        const elapsed = Date.now() - closeRequestedAtRef.current;
        const quietFor = closeQuietSinceRef.current ? Date.now() - closeQuietSinceRef.current : 0;
        if (elapsed > 900 && (quietFor > 700 || elapsed > 7000)) {
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
  }, [appendTranscript, cleanup, commitAssistantTranscript, handleLiveEvent, options.agentId, sendEvent]);

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
