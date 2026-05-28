import { useState, useRef, useCallback, useEffect } from "react";

export type VoiceAgentState = "idle" | "connecting" | "listening" | "speaking";
export type VoiceActivity = "idle" | "connecting" | "ready" | "user_speaking" | "agent_speaking" | "barge_in";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  correctedText?: string;
  timestamp: number;
}

interface UseVoiceAgentOptions {
  agentId?: number;
  systemPrompt?: string;
  voice?: string;
  gender?: string;
  onEvent?: (event: any) => void;
}

const ASSISTANT_PLAYBACK_MIC_COOLDOWN_MS = 120;
const TRANSIENT_ACTIVITY_MS = 900;
const MIC_RMS_THRESHOLD = 0.008;
const MIC_SPEECH_HANGOVER_MS = 900;

export function useVoiceAgent(options: UseVoiceAgentOptions = {}) {
  const [state, setState] = useState<VoiceAgentState>("idle");
  const [activity, setActivity] = useState<VoiceActivity>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [userPartial, setUserPartial] = useState("");
  const [assistantPartial, setAssistantPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const processorSinkRef = useRef<GainNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainNodeRef = useRef<GainNode | null>(null);
  const assistantPlaybackActiveRef = useRef(false);
  const assistantPlaybackStartedAtRef = useRef(0);
  const assistantPlaybackBlockedUntilRef = useRef(0);
  const micSpeechActiveUntilRef = useRef(0);
  const transientActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(options.onEvent);

  useEffect(() => {
    onEventRef.current = options.onEvent;
  }, [options.onEvent]);

  function clearPlayback(): void {
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch {}
    });
    activeSourcesRef.current = [];
    if (audioContextRef.current) {
      nextPlayTimeRef.current = audioContextRef.current.currentTime;
    }
    markAssistantPlaybackEnded(false);
  }

  const start = useCallback(async () => {
    try {
      setError(null);
      setState("connecting");
      setActivity("connecting");
      setTranscript([]);
      setUserPartial("");
      setAssistantPartial("");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 24000,
          sampleSize: 16,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ latencyHint: "interactive", sampleRate: 24000 });
      audioContextRef.current = audioContext;
      nextPlayTimeRef.current = audioContext.currentTime;

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 1.0;
      gainNode.connect(audioContext.destination);
      gainNodeRef.current = gainNode;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      const processorSink = audioContext.createGain();
      processorSink.gain.value = 0;
      workletNodeRef.current = processor;
      processorSinkRef.current = processorSink;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/voice-agent`);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "start",
          agentId: options.agentId,
          config: { systemPrompt: options.systemPrompt, voice: options.voice, gender: options.gender },
        }));
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playAudioChunk(event.data);
        } else {
          handleEvent(JSON.parse(event.data));
        }
      };

      ws.onclose = () => {
        setUserPartial("");
        setState("idle");
        setActivity("idle");
        cleanup();
      };

      ws.onerror = () => {
        setError("Connection failed. Check that OPENAI_API_KEY is configured.");
        setUserPartial("");
        setState("idle");
        setActivity("idle");
        cleanup();
      };

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const input = e.inputBuffer.getChannelData(0);
        if (!shouldSendMicFrame(input)) return;

        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        ws.send(pcm16.buffer);
      };

      source.connect(processor);
      processor.connect(processorSink);
      processorSink.connect(audioContext.destination);
    } catch (err: any) {
      setError(err.message || "Failed to start voice agent");
      setUserPartial("");
      setState("idle");
      setActivity("idle");
    }
  }, [options.agentId, options.systemPrompt, options.voice]);

  const stop = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
      wsRef.current.close();
    }
    cleanup();
    setUserPartial("");
    setState("idle");
    setActivity("idle");
  }, []);

  function handleEvent(msg: any): void {
    onEventRef.current?.(msg);

    switch (msg.type) {
      case "connected":
        setState("listening");
        setActivity("ready");
        break;
      case "interruptClear":
        clearPlayback();
        setUserPartial("");
        setAssistantPartial("");
        setState("listening");
        clearTransientActivityTimer();
        setActivity((current) => (current === "barge_in" ? "user_speaking" : current));
        break;
      case "bargeInDetected":
        clearPlayback();
        setUserPartial("");
        setAssistantPartial("");
        setState("listening");
        showTransientActivity("barge_in");
        break;
      case "userSpeechStarted":
        setUserPartial("");
        setState("listening");
        clearTransientActivityTimer();
        setActivity("user_speaking");
        break;
      case "userSpeechStopped":
        setUserPartial("");
        setState("listening");
        setActivity((current) => (current === "user_speaking" ? "ready" : current));
        break;
      case "userTranscriptSuppressed":
        setUserPartial("");
        setState("listening");
        setActivity((current) => (current === "user_speaking" || current === "barge_in" ? "ready" : current));
        break;
      case "userTranscript":
        setUserPartial("");
        appendTranscript("user", msg.text, msg.corrected ? msg.rawText : undefined);
        setState("listening");
        setActivity("ready");
        break;
      case "userTranscriptDelta":
        setUserPartial((prev) => `${prev}${msg.delta || ""}`);
        setState("listening");
        setActivity("user_speaking");
        break;
      case "assistantTranscriptDelta":
        setAssistantPartial((prev) => prev + msg.delta);
        setState("speaking");
        clearTransientActivityTimer();
        setActivity("agent_speaking");
        break;
      case "assistantTranscriptDone":
        appendTranscript("assistant", msg.text);
        setAssistantPartial("");
        setActivity((current) => (current === "barge_in" ? "ready" : current));
        break;
      case "responseDone":
        if (!isAssistantPlaybackLive()) {
          setState("listening");
          setActivity((current) => (current === "agent_speaking" || current === "barge_in" ? "ready" : current));
        }
        break;
      case "callEnded":
        wsRef.current?.close();
        cleanup();
        setUserPartial("");
        setState("idle");
        setActivity("idle");
        break;
      case "error":
        if (isBenignVoiceError(msg.message)) return;
        setError(msg.message);
        break;
    }
  }

  function appendTranscript(role: TranscriptEntry["role"], text: string, correctedText?: string): void {
    const cleaned = (text || "").trim();
    if (!cleaned) return;
    const cleanedCorrection = (correctedText || "").trim();
    const correction = cleanedCorrection && normalizeTranscriptForDedupe(cleanedCorrection) !== normalizeTranscriptForDedupe(cleaned)
      ? cleanedCorrection
      : undefined;

    const normalized = normalizeTranscriptForDedupe(cleaned);
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      const lastNormalized = last ? normalizeTranscriptForDedupe(last.text) : "";
      if (
        last?.role === role &&
        lastNormalized === normalized &&
        normalizeTranscriptForDedupe(last.correctedText || "") === normalizeTranscriptForDedupe(correction || "")
      ) return prev;
      return [...prev, { role, text: cleaned, correctedText: correction, timestamp: Date.now() }];
    });
  }

  function playAudioChunk(arrayBuffer: ArrayBuffer): void {
    if (!audioContextRef.current || !gainNodeRef.current) return;
    const ctx = audioContextRef.current;
    const pcm16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
    }
    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gainNodeRef.current);
    const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    src.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;
    activeSourcesRef.current.push(src);
    markAssistantPlaybackStarted();
    setState("speaking");
    setActivity("agent_speaking");
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
      scheduleAssistantPlaybackEndCheck();
    };
    scheduleAssistantPlaybackEndCheck();
  }

  function cleanup(): void {
    clearPlayback();
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    processorSinkRef.current?.disconnect();
    processorSinkRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    gainNodeRef.current?.disconnect();
    gainNodeRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    nextPlayTimeRef.current = 0;
    assistantPlaybackActiveRef.current = false;
    assistantPlaybackStartedAtRef.current = 0;
    assistantPlaybackBlockedUntilRef.current = 0;
    micSpeechActiveUntilRef.current = 0;
    clearTransientActivityTimer();
    if (playbackEndTimerRef.current) {
      clearTimeout(playbackEndTimerRef.current);
      playbackEndTimerRef.current = null;
    }
    wsRef.current = null;
  }

  function markAssistantPlaybackStarted(): void {
    assistantPlaybackBlockedUntilRef.current = 0;
    if (playbackEndTimerRef.current) {
      clearTimeout(playbackEndTimerRef.current);
      playbackEndTimerRef.current = null;
    }
    if (assistantPlaybackActiveRef.current) return;

    assistantPlaybackActiveRef.current = true;
    assistantPlaybackStartedAtRef.current = Date.now();
    sendControlEvent({ type: "assistantPlaybackStarted" });
  }

  function markAssistantPlaybackEnded(withCooldown: boolean): void {
    if (playbackEndTimerRef.current) {
      clearTimeout(playbackEndTimerRef.current);
      playbackEndTimerRef.current = null;
    }

    if (withCooldown) {
      assistantPlaybackBlockedUntilRef.current = Date.now() + ASSISTANT_PLAYBACK_MIC_COOLDOWN_MS;
    } else {
      assistantPlaybackBlockedUntilRef.current = 0;
    }

    const cooldownMs = withCooldown ? ASSISTANT_PLAYBACK_MIC_COOLDOWN_MS : 0;
    playbackEndTimerRef.current = setTimeout(() => {
      assistantPlaybackActiveRef.current = false;
      assistantPlaybackStartedAtRef.current = 0;
      assistantPlaybackBlockedUntilRef.current = 0;
      playbackEndTimerRef.current = null;
      sendControlEvent({ type: "assistantPlaybackEnded" });
      setState((current) => (current === "speaking" ? "listening" : current));
      setActivity((current) => (current === "agent_speaking" ? "ready" : current));
    }, cooldownMs);
  }

  function scheduleAssistantPlaybackEndCheck(): void {
    if (playbackEndTimerRef.current) {
      clearTimeout(playbackEndTimerRef.current);
      playbackEndTimerRef.current = null;
    }

    playbackEndTimerRef.current = setTimeout(() => {
      const ctx = audioContextRef.current;
      const playbackRemainingMs = ctx
        ? Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000)
        : 0;

      if (activeSourcesRef.current.length > 0 || playbackRemainingMs > 50) {
        scheduleAssistantPlaybackEndCheck();
        return;
      }

      markAssistantPlaybackEnded(true);
    }, 80);
  }

  function sendControlEvent(event: object): void {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }

  function isAssistantPlaybackLive(): boolean {
    const ctx = audioContextRef.current;
    return Boolean(
      activeSourcesRef.current.length > 0 ||
      (ctx && nextPlayTimeRef.current > ctx.currentTime + 0.05)
    );
  }

  function shouldSendMicFrame(input: Float32Array): boolean {
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < input.length; i++) {
      const sample = input[i];
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
    const now = Date.now();
    const hasSpeechEnergy = rms >= MIC_RMS_THRESHOLD || peak >= MIC_RMS_THRESHOLD * 4;
    if (hasSpeechEnergy) {
      micSpeechActiveUntilRef.current = now + MIC_SPEECH_HANGOVER_MS;
      return true;
    }

    return now < micSpeechActiveUntilRef.current;
  }

  function showTransientActivity(nextActivity: VoiceActivity): void {
    clearTransientActivityTimer();
    setActivity(nextActivity);
    transientActivityTimerRef.current = setTimeout(() => {
      setActivity((current) => (current === nextActivity ? "ready" : current));
      transientActivityTimerRef.current = null;
    }, TRANSIENT_ACTIVITY_MS);
  }

  function clearTransientActivityTimer(): void {
    if (transientActivityTimerRef.current) {
      clearTimeout(transientActivityTimerRef.current);
      transientActivityTimerRef.current = null;
    }
  }

  useEffect(() => () => cleanup(), []);

  return { state, activity, transcript, userPartial, assistantPartial, error, start, stop };
}

function isBenignVoiceError(message: unknown): boolean {
  const text = String(message || "");
  return /Tool call ID 'call_[^']+' not found in conversation/.test(text);
}

function normalizeTranscriptForDedupe(text: string): string {
  return text.toLowerCase().replace(/[.!?,\s]+$/g, "");
}
