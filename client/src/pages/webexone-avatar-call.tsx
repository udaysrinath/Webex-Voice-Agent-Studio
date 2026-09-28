import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, anamApi, chatApi, type AnamVoiceMode, type ChatMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { resolveAgentProfileId } from "@shared/agent-profiles";

type VoiceMode = AnamVoiceMode;

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
  const anamClientRef = useRef<any>(null);
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
      const answer = await chatApi.send({ message, history, systemPrompt: agent.systemPrompt, agentId: agent.id });
      if (stoppingRef.current) return;
      conversationRef.current = [...conversationRef.current, { role: "assistant", content: answer.response }];
      await anamClientRef.current?.talk(answer.response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not get an answer from the assistant.");
    }
  }, [agent]);

  const searchWebexOneReference = useCallback(async (query: string): Promise<string> => {
    if (!agent) throw new Error("WebexOne agent is unavailable.");
    const response = await fetch("/api/webexone/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent.id, query: query.slice(0, 500) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "WebexOne reference search failed.");
    return body.excerpts || "No relevant WebexOne reference excerpts were found. Do not guess; tell the attendee this detail is not in the available reference.";
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
      model: "nova-2",
      language: "en",
      smart_format: "true",
      interim_results: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
      vad_events: "true",
      encoding: "linear16",
      // Browsers may not honor the requested AudioContext rate. Tell Deepgram
      // the actual PCM rate so speech speed/pitch is never misinterpreted.
      sample_rate: String(context.sampleRate),
    });
    // Keep Deepgram credentials and token-based auth on the server. This
    // same-origin socket also avoids browser-specific third-party WS failures.
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/deepgram?${params}`);
    deepgramSocketRef.current = socket;
    let deepgramReady = false;
    processor.onaudioprocess = (event) => {
      if (deepgramReady && socket.readyState === WebSocket.OPEN) socket.send(floatToPcm16(event.inputBuffer.getChannelData(0)));
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
        const transcript = data.channel?.alternatives?.[0]?.transcript || "";
        if (transcript && data.is_final) finalTranscriptRef.current = `${finalTranscriptRef.current} ${transcript}`.trim();
        if (data.speech_final || data.type === "UtteranceEnd") {
          const turn = finalTranscriptRef.current;
          finalTranscriptRef.current = "";
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
      const context = new AudioContext({ sampleRate: 48000 });
      passthroughContextRef.current = context;
      const workletSource = `class AnamPcm16k extends AudioWorkletProcessor {
        constructor() { super(); this.leftover = new Float32Array(0); }
        process(inputs, outputs) {
          const input = inputs[0] && inputs[0][0];
          const output = outputs[0] && outputs[0][0];
          if (output) output.fill(0);
          if (!input) return true;
          const samples = new Float32Array(this.leftover.length + input.length);
          samples.set(this.leftover); samples.set(input, this.leftover.length);
          const count = Math.floor(samples.length / 3);
          const pcm = new ArrayBuffer(count * 2); const view = new DataView(pcm);
          for (let i = 0; i < count; i++) {
            const value = Math.max(-1, Math.min(1, (samples[i * 3] + samples[i * 3 + 1] + samples[i * 3 + 2]) / 3));
            view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
          }
          this.leftover = samples.slice(count * 3);
          if (count) this.port.postMessage(pcm, [pcm]);
          return true;
        }
      }
      registerProcessor("anam-pcm16k", AnamPcm16k);`;
      const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
      try {
        await context.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      const source = context.createMediaStreamSource(event.streams[0]);
      const processor = new AudioWorkletNode(context, "anam-pcm16k", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const silent = context.createGain();
      silent.gain.value = 0;
      passthroughProcessorRef.current = processor;
      passthroughGainRef.current = silent;
      processor.port.onmessage = (message: MessageEvent<ArrayBuffer>) => {
        if (!stoppingRef.current && message.data.byteLength) audioInputRef.current?.sendAudioChunk(message.data);
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);
    };

    const events = peer.createDataChannel("oai-events");
    let responseAudioEnded = false;
    const pendingTools = new Map<string, { completed: boolean; calls: Map<string, Promise<void>> }>();
    const continueDelegation = (delegationId: string) => {
      const pending = pendingTools.get(delegationId);
      if (!pending?.completed || !pending.calls.size) return;
      pendingTools.delete(delegationId);
      void Promise.all(pending.calls.values()).then(() => {
        if (!stoppingRef.current && events.readyState === "open") {
          events.send(JSON.stringify({ type: "response.create", event_id: `webexone_continue_${Date.now()}` }));
        }
      });
    };
    events.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "session.started") {
          events.send(JSON.stringify({ type: "response.create", event_id: `webexone_greeting_${Date.now()}` }));
        }
        if (message.type === "response.event" && message.delegation_id) {
          const nested = message.event;
          const delegationId = String(message.delegation_id);
          if (nested?.type === "response.output_item.done" && nested.item?.type === "function_call" && nested.item.call_id) {
            const pending = pendingTools.get(delegationId) || { completed: false, calls: new Map<string, Promise<void>>() };
            pendingTools.set(delegationId, pending);
            const callId = String(nested.item.call_id);
            if (!pending.calls.has(callId)) {
              const task = (async () => {
                let output: string;
                try {
                  if (nested.item.name !== "search_webexone_reference") throw new Error("Unknown WebexOne tool.");
                  const args = JSON.parse(nested.item.arguments || "{}");
                  if (typeof args.query !== "string") throw new Error("A search query is required.");
                  output = await searchWebexOneReference(args.query);
                } catch (cause) {
                  output = `Reference lookup failed: ${cause instanceof Error ? cause.message : "Unknown error"}. Do not invent an answer.`;
                }
                if (!stoppingRef.current && events.readyState === "open") {
                  events.send(JSON.stringify({ type: "response.item.create", event_id: `webexone_result_${callId}`, item: { type: "function_call_output", call_id: callId, output } }));
                }
              })();
              pending.calls.set(callId, task);
            }
          }
          if (nested?.type === "response.completed") {
            const pending = pendingTools.get(delegationId);
            if (pending) {
              pending.completed = true;
              continueDelegation(delegationId);
            }
          }
        }
        if (message.type === "response.created") responseAudioEnded = false;
        if ((message.type === "session.output_audio.done" || message.type === "response.done") && !responseAudioEnded) {
          responseAudioEnded = true;
          audioInputRef.current?.endSequence();
        }
        if (message.type === "session.input_transcript.delta") responseAudioEnded = false;
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
  }, [agent, searchWebexOneReference]);

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
    conversationRef.current = [];
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

      if (mode === "anam-native") {
        await client.talk(`Hi, I'm ${agent.name}. What would you like to know about WebexOne 2026?`);
      } else if (mode === "deepgram-anam") {
        await startDeepgram();
        await client.talk(`Hi, I'm ${agent.name}. What would you like to know about WebexOne 2026?`);
      } else if (mode === "gpt-live-anam") {
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
      {isLive && error && <p role="alert" className="fixed left-1/2 top-4 z-[101] -translate-x-1/2 rounded-lg bg-red-950/90 px-4 py-2 text-sm text-red-100">{error}</p>}
    </main>
  );
}
