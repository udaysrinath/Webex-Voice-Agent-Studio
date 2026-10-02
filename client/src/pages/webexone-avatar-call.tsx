import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { calculateAdaptiveMicThreshold, MIC_NOISE_WINDOW_SIZE } from "@/lib/microphone-noise-gate";
import { agentsApi, anamApi, chatApi, type AnamVoiceMode, type ChatMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { resolveAgentProfileId } from "@shared/agent-profiles";
import { AVATAR_PCM_WORKLET_SOURCE } from "@/lib/avatar-pcm-worklet";

type VoiceMode = AnamVoiceMode;

const MAX_AUTO_RECONNECTS = 3;
const DEEPGRAM_GATE_HANGOVER_MS = 600;
const MIN_TURN_CONFIDENCE = 0.5;
const MIN_SHORT_TURN_CONFIDENCE = 0.8;
const DEEPGRAM_KEYTERMS = ["WebexOne", "Webex", "Cisco", "Webex AI Agent", "Webex Contact Center", "Webex Calling"];

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, 5000);
    function finish() {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }
    function onStateChange() {
      if (peer.iceGatheringState === "complete") finish();
    }
    peer.addEventListener("icegatheringstatechange", onStateChange);
  });
}

export default function WebexOneAvatarCall() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const agentId = Number(params.get("agentId"));
  const requestedMode = params.get("mode");
  const mode: VoiceMode = requestedMode === "anam-native" || requestedMode === "deepgram-anam"
    ? requestedMode
    : "gpt-live-anam";
  const { data: agent, isLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => agentsApi.getById(agentId),
    enabled: Number.isInteger(agentId) && agentId > 0,
  });

  const [isStarting, setIsStarting] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inFullscreen, setInFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // ?debug=1 shows a device diagnostics panel (video size/drops, audio packet timing, OpenAI link stats).
  const debugEnabled = params.get("debug") === "1";
  const audioStatsRef = useRef({ packets: 0, lastAt: 0, maxGapMs: 0, gapsOver60: 0 });
  const [debugText, setDebugText] = useState("");
  const [animMuted, setAnimMuted] = useState(false);
  const anamClientRef = useRef<any>(null);
  const closeReasonRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  // True while silently re-establishing a session ANAM closed: keep history, skip the greeting.
  const resumingRef = useRef(false);
  const skipGreetingRef = useRef(false);
  const startCallRef = useRef<() => Promise<void>>(async () => {});
  const deepgramSocketRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeMicRef = useRef<MediaStream | null>(null);
  const passthroughContextRef = useRef<AudioContext | null>(null);
  const passthroughProcessorRef = useRef<AudioWorkletNode | null>(null);
  const passthroughGainRef = useRef<GainNode | null>(null);
  const audioInputRef = useRef<{ sendAudioChunk: (chunk: ArrayBuffer) => void; endSequence: () => void } | null>(null);
  const conversationRef = useRef<ChatMessage[]>([]);
  const lastAnamUserMessageIdRef = useRef<string | null>(null);
  const finalTranscriptRef = useRef("");
  const stoppingRef = useRef(false);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    const updateFullscreen = () => setInFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const floatToPcm16 = useCallback((input: Float32Array) => {
    const pcm = new ArrayBuffer(input.length * 2);
    const view = new DataView(pcm);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return pcm;
  }, []);

  const sendRecognizedTurn = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || !agent || stoppingRef.current) return;
    const history = conversationRef.current;
    conversationRef.current = [...history, { role: "user", content: message }];
    try {
      const answer = await chatApi.send({ message, history, systemPrompt: agent.systemPrompt, agentId: agent.id, ignoreOffTopic: true });
      if (stoppingRef.current) return;
      if (answer.ignored) {
        // Unrelated background talk: stay silent and keep it out of the conversation history.
        conversationRef.current = history;
        return;
      }
      conversationRef.current = [...conversationRef.current, { role: "assistant", content: answer.response }];
      const client = anamClientRef.current;
      if (!client) return;
      await client.talk(answer.response);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not get an answer from the assistant.";
      setError(/peer connection is null/i.test(message) && closeReasonRef.current ? closeReasonRef.current : message);
    }
  }, [agent]);

  const startDeepgram = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    micStreamRef.current = stream;
    const context = new AudioContext({ sampleRate: 16000 });
    micContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    micProcessorRef.current = processor;
    const silent = context.createGain();
    silent.gain.value = 0;
    const params = new URLSearchParams({
      model: "nova-3",
      language: "en",
      smart_format: "true",
      interim_results: "true",
      // Longer endpointing avoids cutting turns on short noise bursts and pauses.
      endpointing: "500",
      utterance_end_ms: "1200",
      vad_events: "true",
      encoding: "linear16",
      // Browsers may not honor the requested AudioContext rate. Tell Deepgram
      // the actual PCM rate so speech speed/pitch is never misinterpreted.
      sample_rate: String(context.sampleRate),
    });
    DEEPGRAM_KEYTERMS.forEach((term) => params.append("keyterm", term));
    // Keep Deepgram credentials and token-based auth on the server. This
    // same-origin socket also avoids browser-specific third-party WS failures.
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/deepgram?${params}`);
    deepgramSocketRef.current = socket;
    let deepgramReady = false;
    // Adaptive energy gate: while no speech-level energy is present, send silence instead of
    // background noise. Silence (not skipping) keeps stream timing intact for Deepgram endpointing.
    const recentRms: number[] = [];
    let speechActiveUntil = 0;
    let turnConfidenceSum = 0;
    let turnConfidenceCount = 0;
    processor.onaudioprocess = (event) => {
      if (!deepgramReady || socket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < input.length; i += 1) {
        sumSquares += input[i] * input[i];
        peak = Math.max(peak, Math.abs(input[i]));
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
      recentRms.push(rms);
      if (recentRms.length > MIC_NOISE_WINDOW_SIZE) recentRms.shift();
      const threshold = calculateAdaptiveMicThreshold(recentRms);
      const now = Date.now();
      if (rms >= threshold || peak >= threshold * 3) speechActiveUntil = now + DEEPGRAM_GATE_HANGOVER_MS;
      socket.send(now < speechActiveUntil ? floatToPcm16(input) : new ArrayBuffer(input.length * 2));
    };
    source.connect(processor);
    processor.connect(silent);
    silent.connect(context.destination);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "proxy_ready") {
          deepgramReady = true;
          return;
        }
        if (data.type === "proxy_error") {
          setError(data.error || "Could not connect to Deepgram streaming.");
          return;
        }
        const alternative = data.channel?.alternatives?.[0];
        const transcript = alternative?.transcript || "";
        if (transcript && data.is_final) {
          finalTranscriptRef.current = `${finalTranscriptRef.current} ${transcript}`.trim();
          if (typeof alternative?.confidence === "number") {
            turnConfidenceSum += alternative.confidence;
            turnConfidenceCount += 1;
          }
        }
        if (data.speech_final || data.type === "UtteranceEnd") {
          const turn = finalTranscriptRef.current;
          const confidence = turnConfidenceCount ? turnConfidenceSum / turnConfidenceCount : 1;
          finalTranscriptRef.current = "";
          turnConfidenceSum = 0;
          turnConfidenceCount = 0;
          // Background chatter tends to come back as short, low-confidence fragments.
          const words = turn.split(/\s+/).filter(Boolean).length;
          if (words < 2 && confidence < MIN_SHORT_TURN_CONFIDENCE) return;
          if (confidence < MIN_TURN_CONFIDENCE) return;
          void sendRecognizedTurn(turn);
        }
      } catch (cause) {
        console.warn("Unable to read Deepgram result", cause);
      }
    };
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Timed out connecting to Deepgram streaming.")), 15000);
      const onMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "proxy_ready") {
            window.clearTimeout(timeout);
            socket.removeEventListener("message", onMessage);
            resolve();
          } else if (data.type === "proxy_error") {
            window.clearTimeout(timeout);
            socket.removeEventListener("message", onMessage);
            reject(new Error(data.error || "Could not connect to Deepgram streaming."));
          }
        } catch {}
      };
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("Could not connect to the app's Deepgram audio proxy."));
      }, { once: true });
    });
    socket.onerror = () => setError("Deepgram audio connection was interrupted. End the call and try again.");
  }, [floatToPcm16, sendRecognizedTurn]);

  const startRealtimePassthrough = useCallback(async (client: any) => {
    const audioInput = client.createAgentAudioInputStream({ encoding: "pcm_s16le", sampleRate: 16000, channels: 1 });
    audioInputRef.current = audioInput;
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    realtimeMicRef.current = mic;
    const peer = new RTCPeerConnection();
    realtimePeerRef.current = peer;
    mic.getAudioTracks().forEach((track) => peer.addTrack(track, mic));

    peer.ontrack = async (event) => {
      // Browser resampling replaces the old three-sample averaging filter.
      const context = new AudioContext({ sampleRate: 16000 });
      passthroughContextRef.current = context;
      const moduleUrl = URL.createObjectURL(new Blob([AVATAR_PCM_WORKLET_SOURCE], { type: "text/javascript" }));
      try {
        await context.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      const source = context.createMediaStreamSource(event.streams[0]);
      const processor = new AudioWorkletNode(context, "avatar-pcm", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const silent = context.createGain();
      silent.gain.value = 0;
      passthroughProcessorRef.current = processor;
      passthroughGainRef.current = silent;
      processor.port.onmessage = (message: MessageEvent<ArrayBuffer>) => {
        const stats = audioStatsRef.current;
        const now = performance.now();
        if (stats.lastAt) {
          const gap = now - stats.lastAt;
          stats.maxGapMs = Math.max(stats.maxGapMs, gap);
          if (gap > 60) stats.gapsOver60 += 1;
        }
        stats.lastAt = now;
        stats.packets += 1;
        if (!stoppingRef.current && message.data.byteLength) audioInputRef.current?.sendAudioChunk(message.data);
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);
    };

    const events = peer.createDataChannel("oai-events");
    let responseAudioEnded = false;
    // Client delegation: GPT-Live asks us for help (session.delegation.created) and we answer from the knowledge base.
    // Its transcript deltas are the only record of what the caller said, so keep them per turn.
    let turnTranscript = "";
    let lastDeltaAt = 0;
    let assistantTranscript = "";
    let latestDelegation = "";
    const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
    const sendEvent = (event: Record<string, unknown>) => { if (events.readyState === "open" && !stoppingRef.current) events.send(JSON.stringify(event)); };
    const flushAssistant = () => { if (assistantTranscript.trim()) turns.push({ role: "assistant", content: assistantTranscript.trim() }); assistantTranscript = ""; };
    const answerDelegation = async (delegationId: string) => {
      latestDelegation = delegationId;
      // the last transcript fragment can land just after the delegation event
      for (let waited = 0; !turnTranscript.trim() && waited < 400; waited += 50) await new Promise((resolve) => window.setTimeout(resolve, 50));
      const question = turnTranscript.trim();
      turnTranscript = "";
      flushAssistant();
      let content: string;
      if (!question) {
        if (!stoppingRef.current && latestDelegation === delegationId) sendEvent({ type: "session.commentary.append", event_id: `webexone_repeat_${Date.now()}`, delegation_id: delegationId, content: "Say that you did not catch the question and ask the caller to repeat it." });
        return;
      }
      try {
        const response = await fetch("/api/webexone/live-answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: agent?.id, question, history: turns.slice(-6) }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "lookup failed");
        content = body.content;
      } catch (cause) {
        console.warn("WebexOne lookup failed", cause);
        content = "The lookup is unavailable right now. Tell the caller you could not check that and suggest the WebexOne app or the Registration & Information Desk.";
      }
      // a newer question arrived while this one was being looked up: its answer is stale
      if (stoppingRef.current || latestDelegation !== delegationId) return;
      turns.push({ role: "user", content: question });
      sendEvent({ type: "session.commentary.append", event_id: `webexone_answer_${Date.now()}`, delegation_id: delegationId, content });
    };
    events.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "session.started") {
          // greet through the live model; Responses-only commands such as response.create are not available here
          sendEvent({ type: "session.instructions.append", event_id: `webexone_greeting_${Date.now()}`, delegation_id: null, content: `Greet the caller now. Say: “Hi, I'm ${agent?.name || "your WebexOne guide"}. I can answer questions about WebexOne 2026. What would you like to know?” Then wait.` });
        }
        if (message.type === "session.input_transcript.delta") {
          // a long pause since the previous fragment means this is a new utterance, not the rest of the last one
          const now = performance.now();
          if (now - lastDeltaAt > 1800) turnTranscript = "";
          lastDeltaAt = now;
          turnTranscript += message.delta || "";
          responseAudioEnded = false;
        }
        if (message.type === "session.output_transcript.delta") assistantTranscript += message.delta || "";
        if (message.type === "session.delegation.created" && message.delegation?.target === "client" && message.delegation?.id) void answerDelegation(String(message.delegation.id));
        if (message.type === "response.created") responseAudioEnded = false;
        if ((message.type === "session.output_audio.done" || message.type === "response.done") && !responseAudioEnded) {
          responseAudioEnded = true;
          audioInputRef.current?.endSequence();
        }
        if (message.type === "session.input_audio.speech_started" || message.type === "input_audio_buffer.speech_started") {
          anamClientRef.current?.interruptPersona();
          audioInputRef.current?.endSequence();
        }
        if (message.type === "error") setError(message.error?.message || "The realtime voice session returned an error.");
      } catch (cause) {
        console.warn("Unable to read realtime event", cause);
      }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);
    const answerSdp = await anamApi.createGPTLiveSession(agent?.id || 0, peer.localDescription?.sdp || "");
    await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }, [agent]);

  const stopCall = useCallback(async () => {
    stoppingRef.current = true;
    try { deepgramSocketRef.current?.close(); } catch {}
    deepgramSocketRef.current = null;
    micProcessorRef.current?.disconnect();
    micProcessorRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    if (micContextRef.current && micContextRef.current.state !== "closed") await micContextRef.current.close().catch(() => {});
    micContextRef.current = null;
    realtimePeerRef.current?.close();
    realtimePeerRef.current = null;
    realtimeMicRef.current?.getTracks().forEach((track) => track.stop());
    realtimeMicRef.current = null;
    passthroughProcessorRef.current?.disconnect();
    passthroughProcessorRef.current?.port.close();
    passthroughProcessorRef.current = null;
    passthroughGainRef.current?.disconnect();
    passthroughGainRef.current = null;
    if (passthroughContextRef.current && passthroughContextRef.current.state !== "closed") await passthroughContextRef.current.close().catch(() => {});
    passthroughContextRef.current = null;
    audioInputRef.current = null;
    lastAnamUserMessageIdRef.current = null;
    if (anamClientRef.current) {
      await anamClientRef.current.stopStreaming().catch(() => {});
      anamClientRef.current = null;
    }
    setIsLive(false);
    setIsStarting(false);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  }, []);

  const startCall = useCallback(async () => {
    if (!agent || !containerRef.current || isStarting || isLive) return;
    setIsStarting(true);
    setError(null);
    stoppingRef.current = false;
    closeReasonRef.current = null;
    const resuming = resumingRef.current;
    resumingRef.current = false;
    if (!resuming) conversationRef.current = [];
    lastAnamUserMessageIdRef.current = null;
    try {
      // Request fullscreen synchronously in the click gesture, before network work.
      await containerRef.current.requestFullscreen().catch(() => {});
      const systemPrompt = agent.systemPrompt || `You are ${agent.name}, a concise and helpful WebexOne event Q&A assistant.`;
      const { sessionToken } = await anamApi.getSessionToken({ name: agent.name, systemPrompt }, agent.id, mode);
      const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
      const client = createClient(sessionToken, mode === "anam-native" ? undefined : { disableInputAudio: true });
      anamClientRef.current = client;
      if (mode === "anam-native") {
        client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages: Array<{ id: string; role: string; content: string }>) => {
          if (stoppingRef.current) return;
          const latestUserMessage = [...messages].reverse().find((message) => message.role === "user" && message.content.trim());
          if (!latestUserMessage || latestUserMessage.id === lastAnamUserMessageIdRef.current) return;
          lastAnamUserMessageIdRef.current = latestUserMessage.id;
          void sendRecognizedTurn(latestUserMessage.content);
        });
      }
      // streamToVideoElement starts WebRTC but resolves before the peer is connected.
      // Wait for the actual connection before sending the greeting or external audio.
      let resolveConnection!: () => void;
      let rejectConnection!: (error: Error) => void;
      const connected = new Promise<void>((resolve, reject) => {
        resolveConnection = resolve;
        rejectConnection = reject;
      });
      void connected.catch(() => {});
      const onConnected = () => resolveConnection();
      const onClosed = () => rejectConnection(new Error("ANAM closed the connection before the avatar was ready."));
      const connectionTimeout = window.setTimeout(() => rejectConnection(new Error("Timed out connecting to the ANAM avatar.")), 20000);
      client.addListener(AnamEvent.CONNECTION_ESTABLISHED, onConnected);
      client.addListener(AnamEvent.CONNECTION_CLOSED, onClosed);
      try {
        await client.streamToVideoElement("webexone-avatar-video");
        await connected;
      } finally {
        window.clearTimeout(connectionTimeout);
        client.removeListener(AnamEvent.CONNECTION_ESTABLISHED, onConnected);
        client.removeListener(AnamEvent.CONNECTION_CLOSED, onClosed);
      }
      setIsLive(true);
      // The server can close the session after it was established (plan session limit, idle timeout, etc.).
      // Record why, so a late talk() failure reports the real cause instead of "peer connection is null".
      client.addListener(AnamEvent.CONNECTION_CLOSED, (code: unknown, reason?: string) => {
        if (stoppingRef.current || anamClientRef.current !== client) return;
        console.error("ANAM connection closed", code, reason);
        closeReasonRef.current = `ANAM ended the avatar session${reason ? `: ${reason}` : ""}${code ? ` (${String(code)})` : ""}.`;
        void stopCall().then(() => {
          if (reconnectAttemptsRef.current >= MAX_AUTO_RECONNECTS) {
            setError(closeReasonRef.current);
            return;
          }
          reconnectAttemptsRef.current += 1;
          resumingRef.current = true;
          window.setTimeout(() => void startCallRef.current(), 500);
        });
      });

      const greeting = `Hi, I'm ${agent.name}. What would you like to know about WebexOne 2026?`;
      if (mode === "anam-native") {
        if (!resuming) await client.talk(greeting);
      } else if (mode === "deepgram-anam") {
        await startDeepgram();
        if (!resuming) await client.talk(greeting);
      } else if (mode === "gpt-live-anam") {
        skipGreetingRef.current = resuming;
        await startRealtimePassthrough(client);
      }
    } catch (cause) {
      const failure = cause as { message?: string; statusCode?: number; details?: { cause?: unknown } };
      const detail = typeof failure?.details?.cause === "string" ? failure.details.cause.trim() : "";
      const status = typeof failure?.statusCode === "number" ? ` (HTTP ${failure.statusCode})` : "";
      const message = detail
        ? `${failure.message || "Could not start the video avatar"}${status}: ${detail}`
        : `${failure?.message || "Could not start the video avatar."}${status}`;
      setError(message);
      await stopCall();
      setError(message);
    } finally {
      setIsStarting(false);
    }
  }, [agent, isLive, isStarting, mode, sendRecognizedTurn, startDeepgram, startRealtimePassthrough, stopCall]);

  startCallRef.current = startCall;

  useEffect(() => {
    if (!agent || resolveAgentProfileId(agent) !== "webexone-qa" || hasStartedRef.current) return;
    hasStartedRef.current = true;
    void startCall();
  }, [agent, startCall]);

  useEffect(() => () => {
    stoppingRef.current = true;
    deepgramSocketRef.current?.close();
    realtimePeerRef.current?.close();
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    realtimeMicRef.current?.getTracks().forEach((track) => track.stop());
    micContextRef.current?.close().catch(() => {});
    passthroughContextRef.current?.close().catch(() => {});
    anamClientRef.current?.stopStreaming().catch(() => {});
  }, []);

  useEffect(() => {
    if (!debugEnabled || !isLive) return;
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      const quality = video?.getVideoPlaybackQuality?.();
      const audio = audioStatsRef.current;
      const context = passthroughContextRef.current;
      let openai = "n/a";
      try {
        const reports = await realtimePeerRef.current?.getStats();
        reports?.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            openai = `jitter ${(report.jitter * 1000).toFixed(0)}ms lost ${report.packetsLost} concealed ${report.concealedSamples}/${report.totalSamplesReceived}`;
          }
        });
      } catch {}
      setDebugText([
        `mode ${mode}`,
        `video ${video?.videoWidth}x${video?.videoHeight} dropped ${quality?.droppedVideoFrames}/${quality?.totalVideoFrames} muted ${video?.muted}`,
        `ctx ${context?.state} rate ${context?.sampleRate} baseLat ${((context?.baseLatency || 0) * 1000).toFixed(0)}ms`,
        `pcm packets ${audio.packets} maxGap ${audio.maxGapMs.toFixed(0)}ms gaps>60ms ${audio.gapsOver60}`,
        `openai ${openai}`,
        `ua ${navigator.userAgent.slice(0, 90)}`,
      ].join("\n"));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [debugEnabled, isLive, mode]);

  if (!Number.isInteger(agentId) || agentId < 1) {
    return <div className="grid min-h-screen place-items-center bg-black p-6 text-white">Missing agent ID.</div>;
  }

  if (agent && resolveAgentProfileId(agent) !== "webexone-qa") {
    return <div className="grid min-h-screen place-items-center bg-black p-6 text-white">This video call is only available for the WebexOne Guide.</div>;
  }

  return (
    <main ref={containerRef} className="fixed inset-0 z-[100] flex min-h-screen flex-col bg-black text-white">
      <video
        id="webexone-avatar-video"
        ref={videoRef}
        autoPlay
        playsInline
        className={`min-h-0 flex-1 bg-black ${isLive ? "h-full w-full object-contain" : "hidden"}`}
      />

      {!isLive && (
        <div className="m-auto w-full max-w-2xl space-y-6 p-6 text-center">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">{agent?.name || (isLoading ? "Loading agent…" : "WebexOne Guide")}</h1>
            <p className="mt-2 text-sm text-white/60">{error ? "Could not connect the video avatar." : "Connecting video avatar…"}</p>
          </div>
          {error && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
              setLocation("/");
            }}>Back</Button>
            {error && <Button onClick={() => void startCall()} disabled={!agent || isStarting}>Retry</Button>}
          </div>
        </div>
      )}

      {isLive && (
        <Button variant="destructive" onClick={() => void stopCall()} className={`fixed bottom-6 left-1/2 z-[101] -translate-x-1/2 ${inFullscreen ? "" : ""}`}>
          End call
        </Button>
      )}
      {debugEnabled && isLive && (
        <div className="fixed left-2 top-2 z-[102] max-w-[90vw] space-y-2 rounded bg-black/80 p-2 font-mono text-xs text-green-300">
          <pre className="whitespace-pre-wrap">{debugText}</pre>
          <Button size="sm" variant="outline" onClick={() => {
            const next = !animMuted;
            if (videoRef.current) videoRef.current.muted = next;
            setAnimMuted(next);
          }}>{animMuted ? "Unmute avatar video" : "Mute avatar video (buzz test)"}</Button>
        </div>
      )}
      {isLive && error && <p role="alert" className="fixed left-1/2 top-4 z-[101] -translate-x-1/2 rounded-lg bg-red-950/90 px-4 py-2 text-sm text-red-100">{error}</p>}
    </main>
  );
}
