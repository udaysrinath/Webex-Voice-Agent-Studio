import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { calculateAdaptiveMicThreshold, MIC_NOISE_WINDOW_SIZE } from "@/lib/microphone-noise-gate";
import { agentsApi, anamApi, chatApi, type AnamVoiceMode, type ChatMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { resolveAgentProfileId } from "@shared/agent-profiles";
import { AVATAR_PCM_WORKLET_SOURCE } from "@/lib/avatar-pcm-worklet";
import { lastUtterance, type TranscriptFragment } from "@shared/live-transcript";
import { AudioLab, configFromParams, configToParams, pcmToWav, toDb } from "@/lib/avatar-audio-lab";

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
  const labRef = useRef<AudioLab | null>(null);
  const avatarMeterRef = useRef({ rmsDb: -Infinity, peakDb: -Infinity, clipped: 0, ring: [] as Float32Array[], samples: 0, rate: 48000 });
  const [, setLabTick] = useState(0);
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
    const labConfig = configFromParams(params);
    const audioInput = client.createAgentAudioInputStream({ encoding: "pcm_s16le", sampleRate: labConfig.rate, channels: 1 });
    audioInputRef.current = audioInput;
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    realtimeMicRef.current = mic;
    const peer = new RTCPeerConnection();
    realtimePeerRef.current = peer;
    mic.getAudioTracks().forEach((track) => peer.addTrack(track, mic));

    const liveLog = (kind: string, detail: Record<string, unknown> = {}) => { void fetch("/api/webexone/live-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, detail }), keepalive: true }).catch(() => {}); };
    peer.ontrack = async (event) => {
      // Browser resampling replaces the old three-sample averaging filter.
      const context = new AudioContext({ sampleRate: labConfig.rate });
      passthroughContextRef.current = context;
      // A page that starts without a click can leave the audio context suspended, which silences everything sent to the avatar.
      void fetch("/api/webexone/live-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "audio-context", detail: { state: context.state, sampleRate: context.sampleRate } }), keepalive: true }).catch(() => {});
      if (context.state === "suspended") {
        void context.resume().catch(() => {});
        const resume = () => { void context.resume().catch(() => {}); };
        window.addEventListener("pointerdown", resume, { once: true });
        window.addEventListener("keydown", resume, { once: true });
      }
      const moduleUrl = URL.createObjectURL(new Blob([AVATAR_PCM_WORKLET_SOURCE], { type: "text/javascript" }));
      try {
        await context.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      // The worklet packs 20 ms of whatever rate the context really runs at, and the browser may not honour 16 kHz
      // (some device browsers do not). Tell ANAM the true rate, or the avatar's audio would play at the wrong speed.
      if (context.sampleRate !== labConfig.rate) {
        liveLog("sample-rate-mismatch", { requested: labConfig.rate, actual: context.sampleRate });
        audioInputRef.current = client.createAgentAudioInputStream({ encoding: "pcm_s16le", sampleRate: context.sampleRate, channels: 1 });
      }
      labRef.current = new AudioLab(
        labConfig,
        context.sampleRate,
        (chunk) => { if (!stoppingRef.current) audioInputRef.current?.sendAudioChunk(chunk); },
        () => audioInputRef.current?.endSequence(),
      );
      const source = context.createMediaStreamSource(event.streams[0]);
      const processor = new AudioWorkletNode(context, "avatar-pcm", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const silent = context.createGain();
      silent.gain.value = 0;
      passthroughProcessorRef.current = processor;
      passthroughGainRef.current = silent;
      processor.port.onmessage = (message: MessageEvent<ArrayBuffer>) => { if (!stoppingRef.current) labRef.current?.push(message.data); };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);
    };

    const events = peer.createDataChannel("oai-events");
    let responseAudioEnded = false;
    // Client delegation: GPT-Live asks us for help (session.delegation.created) and we answer from the knowledge base.
    // Its transcript deltas are the only record of what the caller said, so keep them per turn.
    const fragments: TranscriptFragment[] = [];
    let assistantTranscript = "";
    let latestDelegation = "";
    let lastAnswer: { delegationId: string; fallback: string; retried: boolean } | undefined;
    const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
    let delegatedSinceSpeech = false;
    let unansweredTimer: number | undefined;
    let spokenBuffer = "";
    let spokenTimer: number | undefined;
    let sawSessionStarted = false;
    let greeted = false;
    let greetingAcknowledged = false;
    let channelOpenedAt = performance.now();
    // GPT-Live opens the conversation when told to (Responses-only commands such as response.create are not available).
    const greet = (reason: string) => {
      if (greeted || skipGreetingRef.current) return;
      greeted = true;
      liveLog("greeting-sent", { reason, tMs: Math.round(performance.now() - channelOpenedAt) });
      sendEvent({ type: "session.instructions.append", event_id: `webexone_greeting_${Date.now()}`, delegation_id: null, content: `Greet the caller now, in English. Say: “Hi, I'm ${agent?.name || "your WebexOne guide"}. I can answer questions about WebexOne 2026. What would you like to know?” Then wait.` });
      // if it was never acknowledged, say it once more
      window.setTimeout(() => {
        if (!greetingAcknowledged && !stoppingRef.current) {
          liveLog("greeting-resent", { reason: "no acknowledgement after 4 s" });
          sendEvent({ type: "session.instructions.append", event_id: `webexone_greeting_retry_${Date.now()}`, delegation_id: null, content: `Greet the caller now, in English. Say: “Hi, I'm ${agent?.name || "your WebexOne guide"}. I can answer questions about WebexOne 2026. What would you like to know?” Then wait.` });
        }
      }, 4000);
    };
    events.onopen = () => {
      channelOpenedAt = performance.now();
      liveLog("datachannel-open");
      // normally session.started arrives first; if it does not, do not wait for the caller to speak
      window.setTimeout(() => { if (!sawSessionStarted) greet("data channel open, no session.started after 1.5 s"); }, 1500);
    };
    const sendEvent = (event: Record<string, unknown>) => { if (events.readyState === "open" && !stoppingRef.current) events.send(JSON.stringify(event)); };
    const flushAssistant = () => { if (assistantTranscript.trim()) turns.push({ role: "assistant", content: assistantTranscript.trim() }); assistantTranscript = ""; };
    const answerDelegation = async (delegationId: string, offsetMs?: number) => {
      latestDelegation = delegationId;
      // the last transcript fragment can land just after the delegation event
      for (let waited = 0; !fragments.length && waited < 400; waited += 50) await new Promise((resolve) => window.setTimeout(resolve, 50));
      const question = lastUtterance(fragments, offsetMs);
      liveLog("delegation", { question, fragments: fragments.length, offsetMs });
      fragments.length = 0;
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
        for (const pack of (body.facts as string[] | undefined) || []) {
          sendEvent({ type: "session.thinking.append", event_id: `webexone_facts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, delegation_id: delegationId, content: pack });
        }
        content = body.content;
        lastAnswer = { delegationId, fallback: String(body.fallback || ""), retried: false };
      } catch (cause) {
        console.warn("WebexOne lookup failed", cause);
        content = "The lookup is unavailable right now. Tell the caller you could not check that and suggest the WebexOne app or the Registration & Information Desk.";
      }
      // a newer question arrived while this one was being looked up: its answer is stale
      if (stoppingRef.current || latestDelegation !== delegationId) { liveLog("answer-dropped", { question, reason: stoppingRef.current ? "call ended" : "a newer delegation arrived" }); return; }
      liveLog("answer-sent", { question });
      turns.push({ role: "user", content: question });
      sendEvent({ type: "session.commentary.append", event_id: `webexone_answer_${Date.now()}`, delegation_id: delegationId, content });
    };
    events.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "session.started") {
          sawSessionStarted = true;
          liveLog("session-started", { tMs: Math.round(performance.now() - channelOpenedAt) });
          greet("session.started");
        }
        if (message.type === "session.instructions.appended") {
          greetingAcknowledged = true;
          liveLog("greeting-acknowledged", { tMs: Math.round(performance.now() - channelOpenedAt) });
        }
        if (message.type === "session.input_transcript.delta") {
          delegatedSinceSpeech = false;
          window.clearTimeout(unansweredTimer);
          unansweredTimer = window.setTimeout(() => {
            if (!delegatedSinceSpeech && fragments.length) liveLog("no-delegation", { heard: lastUtterance(fragments), spokeMeanwhile: spokenBuffer.slice(0, 200) });
          }, 3000);
          fragments.push({ text: String(message.delta || ""), startMs: Number(message.start_ms) || 0, endMs: Number(message.end_ms) || 0 });
          if (fragments.length > 200) fragments.splice(0, fragments.length - 200);
          responseAudioEnded = false;
        }
        if (message.type === "session.output_transcript.delta") {
          assistantTranscript += message.delta || "";
          spokenBuffer += message.delta || "";
          window.clearTimeout(spokenTimer);
          spokenTimer = window.setTimeout(() => { liveLog("avatar-said", { text: spokenBuffer.trim().slice(0, 400) }); spokenBuffer = ""; }, 2000);
        }
        if (message.type === "session.delegation.created" && message.delegation?.target === "client" && message.delegation?.id) delegatedSinceSpeech = true;
        if (message.type === "session.delegation.created" && message.delegation?.target === "client" && message.delegation?.id) void answerDelegation(String(message.delegation.id), typeof message.offset_ms === "number" ? message.offset_ms : undefined);
        if (message.type === "response.created") responseAudioEnded = false;
        if ((message.type === "session.output_audio.done" || message.type === "response.done") && !responseAudioEnded) {
          responseAudioEnded = true;
          labRef.current?.endSequence();
        }
        if (message.type === "session.input_audio.speech_started" || message.type === "input_audio_buffer.speech_started") {
          const wasSpeaking = labRef.current?.speechStarted() ?? false;
          if (spokenBuffer || wasSpeaking) liveLog("barge-in", { whileSaying: spokenBuffer.slice(-120), localInterrupt: labRef.current?.config.localInterrupt ?? true });
          // With local interruption off, GPT-Live stops its own audio and the sequence simply runs dry.
          if (labRef.current?.config.localInterrupt ?? true) {
            anamClientRef.current?.interruptPersona();
            labRef.current?.interrupted();
            labRef.current?.endSequence();
          }
        }
        if (message.type === "error") {
          const detail = String(message.error?.message || "");
          liveLog("openai-error", { detail: detail.slice(0, 300) });
          // GPT-Live caps one append at ~500 tokens; if it rejected the answer as too long, resend the shorter version once
          if (/must not exceed 500 tokens/i.test(detail) && lastAnswer && !lastAnswer.retried && lastAnswer.fallback && latestDelegation === lastAnswer.delegationId) {
            lastAnswer.retried = true;
            sendEvent({ type: "session.commentary.append", event_id: `webexone_answer_retry_${Date.now()}`, delegation_id: lastAnswer.delegationId, content: lastAnswer.fallback });
          } else setError(detail || "The realtime voice session returned an error.");
        }
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
    labRef.current?.reset();
    labRef.current = null;
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

  // Debug only: meter and record what the avatar actually plays (ANAM's output), to compare with what we sent it.
  useEffect(() => {
    if (!debugEnabled || !isLive) return;
    let context: AudioContext | undefined;
    let processor: ScriptProcessorNode | undefined;
    let retry: number | undefined;
    const attach = () => {
      const stream = videoRef.current?.srcObject as MediaStream | null;
      if (!stream || !stream.getAudioTracks().length) { retry = window.setTimeout(attach, 1000); return; }
      context = new AudioContext();
      const meter = avatarMeterRef.current;
      meter.rate = context.sampleRate;
      const source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        let squares = 0, peak = 0;
        for (let i = 0; i < input.length; i++) { const v = Math.abs(input[i]); squares += v * v; if (v > peak) peak = v; if (v >= 0.9989) meter.clipped += 1; }
        meter.rmsDb = toDb(Math.sqrt(squares / input.length));
        meter.peakDb = toDb(peak);
        meter.ring.push(Float32Array.from(input));
        meter.samples += input.length;
        while (meter.samples > meter.rate * 10 && meter.ring.length > 1) meter.samples -= meter.ring.shift()!.length;
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
    };
    attach();
    return () => { window.clearTimeout(retry); processor?.disconnect(); void context?.close().catch(() => {}); };
  }, [debugEnabled, isLive]);

  useEffect(() => {
    if (!debugEnabled || !isLive) return;
    const fmt = (db: number) => (Number.isFinite(db) ? `${db.toFixed(1)}` : "-inf");
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      const quality = video?.getVideoPlaybackQuality?.();
      const lab = labRef.current;
      const context = passthroughContextRef.current;
      const avatar = avatarMeterRef.current;
      let openai = "n/a";
      try {
        const reports = await realtimePeerRef.current?.getStats();
        reports?.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "audio") openai = `jitter ${(report.jitter * 1000).toFixed(0)}ms lost ${report.packetsLost} concealed ${report.concealedSamples}/${report.totalSamplesReceived}`;
        });
      } catch {}
      const stats = lab?.stats;
      setDebugText([
        `mode ${mode}  video ${video?.videoWidth}x${video?.videoHeight} dropped ${quality?.droppedVideoFrames}/${quality?.totalVideoFrames} muted ${video?.muted}`,
        `ctx ${context?.state} ${context?.sampleRate} Hz  openai ${openai}`,
        stats
          ? `SENT to avatar: rms ${fmt(stats.rmsDb)} peak ${fmt(stats.peakDb)} dBFS  clipped ${stats.clipped}\n  pkts ${stats.packets} sends ${stats.sentChunks} (${stats.sentMs.toFixed(0)} ms)  maxGap ${stats.maxGapMs.toFixed(0)} ms  gaps>60ms ${stats.gapsOver60}`
          : "SENT to avatar: (no audio yet)",
        `AVATAR plays:  rms ${fmt(avatar.rmsDb)} peak ${fmt(avatar.peakDb)} dBFS  clipped ${avatar.clipped}`,
        stats ? `speech-while-avatar-speaking ${stats.speechWhileSpeaking}  interrupts ${stats.interrupts}  sequence ends ${stats.endSequences}` : "",
        lab ? `config: gain ${lab.config.gainDb} dB | chunk ${lab.config.chunkMs} ms | prebuffer ${lab.config.prebufferMs} ms | idle end ${lab.config.idleEndMs || "off"} | local interrupt ${lab.config.localInterrupt ? "on" : "off"}` : "",
      ].filter(Boolean).join("\n"));
    }, 500);
    return () => window.clearInterval(timer);
  }, [debugEnabled, isLive, mode]);

  const cycle = <T,>(values: T[], current: T): T => values[(values.indexOf(current) + 1) % values.length];
  const download = (blob: Blob | undefined, name: string) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  };
  const avatarWav = () => {
    const meter = avatarMeterRef.current;
    if (!meter.samples) return undefined;
    const merged = new Int16Array(meter.samples);
    let offset = 0;
    for (const block of meter.ring) { for (let i = 0; i < block.length; i++) merged[offset + i] = Math.max(-32768, Math.min(32767, Math.round(block[i] * 32767))); offset += block.length; }
    return pcmToWav(merged, meter.rate);
  };

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
        <div className="fixed left-2 top-2 z-[102] max-w-[95vw] space-y-2 rounded bg-black/85 p-2 font-mono text-xs text-green-300">
          <pre className="whitespace-pre-wrap">{debugText}</pre>
          <div className="flex flex-wrap gap-1">
            {labRef.current && (() => {
              const lab = labRef.current!;
              const set = (patch: Partial<typeof lab.config>) => { Object.assign(lab.config, patch); setLabTick((n) => n + 1); };
              return (
                <>
                  <Button size="sm" variant="outline" onClick={() => set({ gainDb: cycle([0, 6, 9], lab.config.gainDb) })}>Gain {lab.config.gainDb} dB</Button>
                  <Button size="sm" variant="outline" onClick={() => set({ chunkMs: cycle([20, 100, 200, 400], lab.config.chunkMs) })}>Chunk {lab.config.chunkMs} ms</Button>
                  <Button size="sm" variant="outline" onClick={() => set({ prebufferMs: cycle([0, 150, 300], lab.config.prebufferMs) })}>Prebuffer {lab.config.prebufferMs} ms</Button>
                  <Button size="sm" variant="outline" onClick={() => set({ idleEndMs: cycle([0, 600], lab.config.idleEndMs) })}>Idle end {lab.config.idleEndMs ? `${lab.config.idleEndMs} ms` : "off"}</Button>
                  <Button size="sm" variant="outline" onClick={() => set({ localInterrupt: !lab.config.localInterrupt })}>Local interrupt {lab.config.localInterrupt ? "on" : "off"}</Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    // the sample rate is fixed when the audio context is created, so changing it reloads the page with these settings
                    const next = configToParams({ ...lab.config, rate: lab.config.rate === 16000 ? 24000 : 16000 });
                    next.set("agentId", String(agentId));
                    next.set("debug", "1");
                    window.location.search = next.toString();
                  }}>Send rate {lab.config.rate} (tap to switch + reload)</Button>
                </>
              );
            })()}
            <Button size="sm" variant="outline" onClick={() => { const next = !animMuted; if (videoRef.current) videoRef.current.muted = next; setAnimMuted(next); }}>{animMuted ? "Unmute avatar video" : "Mute avatar video"}</Button>
            <Button size="sm" variant="outline" onClick={() => download(labRef.current?.recentWav(), "sent-to-avatar.wav")}>Save SENT audio</Button>
            <Button size="sm" variant="outline" onClick={() => download(avatarWav(), "avatar-output.wav")}>Save AVATAR audio</Button>
          </div>
        </div>
      )}
      {isLive && error && <p role="alert" className="fixed left-1/2 top-4 z-[101] -translate-x-1/2 rounded-lg bg-red-950/90 px-4 py-2 text-sm text-red-100">{error}</p>}
    </main>
  );
}
