import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { OpenAIRealtimeClient, RealtimeSessionConfig } from "./openai-realtime";
import { storage } from "../storage";

const OPENAI_REALTIME_VOICE_MAP: Record<string, string> = {
  alloy: "alloy",
  echo: "echo",
  shimmer: "shimmer",
  "aura-asteria-en": "alloy",
  "aura-luna-en": "shimmer",
  "aura-stella-en": "shimmer",
  "aura-orion-en": "echo",
  "aura-arcas-en": "ash",
  "aura-perseus-en": "echo",
};

function mapVoice(voice: string): string {
  const valid = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
  if (valid.includes(voice)) return voice;
  return OPENAI_REALTIME_VOICE_MAP[voice] || "alloy";
}

const SPURIOUS_SHORT_TRANSCRIPTS = new Set(["bye", "goodbye"]);

function normalizeTranscript(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?,\s]+$/g, "");
}

function shouldSuppressBrowserUserTranscript(
  text: string,
  lastAssistantDoneAt: number,
  acceptedUserTranscriptCount: number,
  responseActive: boolean
): boolean {
  const normalized = normalizeTranscript(text);
  if (!normalized) return true;

  const isShortFarewell = SPURIOUS_SHORT_TRANSCRIPTS.has(normalized);
  if (!isShortFarewell) return false;

  const justAfterAssistant = Date.now() - lastAssistantDoneAt < 2500;
  return responseActive || justAfterAssistant || acceptedUserTranscriptCount === 0;
}

export function attachVoiceAgentWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    console.log(`[WebSocket] Upgrade request received for URL: ${request.url}`);
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/ws/twilio-stream" || url.pathname === "/ws/voice-agent") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log(`[WebSocket] Connection established for ${url.pathname}`);
        if (url.pathname === "/ws/twilio-stream") {
          handleTwilioSession(ws);
        } else {
          handleBrowserSession(ws);
        }
      });
    } else {
      // Let other handlers (like Vite HMR) process this
      return;
    }
  });
}

function handleTwilioSession(ws: WebSocket): void {
  console.log("[TwilioSession] New session started");
  let openai: OpenAIRealtimeClient | null = null;
  let streamSid: string | null = null;
  let lastItemId: string | null = null;
  let responseStartTs: number | null = null;
  let latestTs = 0;
  let markQueue: string[] = [];

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());

    switch (msg.event) {
      case "start": {
        streamSid = msg.start.streamSid;
        const params = msg.start.customParameters || {};
        const agentId = params.agentId;

        let instructions = "You are a helpful voice assistant. Keep responses concise and conversational.";
        let voice = "alloy";

        if (agentId && agentId !== "default") {
          const agent = await storage.getAgent(parseInt(agentId));
          if (agent) {
            instructions = agent.systemPrompt || instructions;
            voice = mapVoice(agent.voiceModel);
          }
        }

        openai = new OpenAIRealtimeClient(process.env.OPENAI_API_KEY || "", {
          instructions,
          voice,
          inputAudioFormat: "g711_ulaw",
          outputAudioFormat: "g711_ulaw",
        });

        openai.on("audio", (base64: string, itemId: string) => {
          lastItemId = itemId;
          if (responseStartTs === null) responseStartTs = latestTs;
          ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: base64 } }));
          const markName = `m-${Date.now()}`;
          ws.send(JSON.stringify({ event: "mark", streamSid, mark: { name: markName } }));
          markQueue.push(markName);
        });

        openai.on("speechStarted", () => {
          if (markQueue.length > 0 && responseStartTs !== null) {
            const elapsed = latestTs - responseStartTs;
            if (lastItemId) openai!.truncateResponse(lastItemId, elapsed);
            ws.send(JSON.stringify({ event: "clear", streamSid }));
            markQueue = [];
            lastItemId = null;
            responseStartTs = null;
          }
        });

        openai.on("userTranscript", (text: string) => {
          console.log(`[VoiceAgent/Twilio] User: ${text}`);
        });

        openai.on("assistantTranscriptDone", (text: string) => {
          console.log(`[VoiceAgent/Twilio] Agent: ${text}`);
        });

        openai.on("error", (err: Error) => {
          console.error("[VoiceAgent/Twilio] Error:", err.message);
        });

        openai.once("sessionReady", () => {
          openai!.triggerResponse();
        });

        openai.connect();
        break;
      }
      case "media":
        latestTs = parseInt(msg.media.timestamp);
        openai?.appendAudio(msg.media.payload);
        break;
      case "mark":
        markQueue.shift();
        break;
      case "stop":
        openai?.close();
        break;
    }
  });

  ws.on("close", () => openai?.close());
}

function handleBrowserSession(ws: WebSocket): void {
  let openai: OpenAIRealtimeClient | null = null;
  let lastItemId: string | null = null;
  let responseActive = false;
  let audioChunkCount = 0;
  let lastAssistantDoneAt = 0;
  let acceptedUserTranscriptCount = 0;

  ws.on("message", async (raw) => {
    if (Buffer.isBuffer(raw) && openai) {
      const base64 = raw.toString("base64");
      openai.appendAudio(base64);
      return;
    }

    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "start") {
        const { agentId, config } = msg;
        let instructions = config?.systemPrompt || "You are a helpful voice assistant. Keep responses concise and conversational.";
        let voice = "alloy";

        if (agentId) {
          const agent = await storage.getAgent(parseInt(agentId));
          if (agent) {
            instructions = agent.systemPrompt || instructions;
            voice = mapVoice(agent.voiceModel);
          }
        }

        instructions = "Always respond in English unless the user explicitly asks for another language.\n\n" + instructions;

        openai = new OpenAIRealtimeClient(process.env.OPENAI_API_KEY || "", {
          instructions,
          voice,
          inputAudioFormat: "pcm16",
          outputAudioFormat: "pcm16",
        });

        openai.on("audio", (base64: string, itemId: string) => {
          lastItemId = itemId;
          responseActive = true;
          audioChunkCount++;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(Buffer.from(base64, "base64"));
          }
        });

        openai.on("speechStarted", () => {
          responseActive = false;
          audioChunkCount = 0;
          lastItemId = null;
          sendEvent({ type: "interruptClear" });
          sendEvent({ type: "speechStarted" });
        });

        openai.on("userTranscript", (text: string) => {
          const trimmed = text.trim();
          if (shouldSuppressBrowserUserTranscript(trimmed, lastAssistantDoneAt, acceptedUserTranscriptCount, responseActive)) {
            return;
          }
          acceptedUserTranscriptCount++;
          sendEvent({ type: "userTranscript", text: trimmed });
        });

        openai.on("assistantTranscriptDelta", (delta: string) => {
          sendEvent({ type: "assistantTranscriptDelta", delta });
        });

        openai.on("assistantTranscriptDone", (text: string) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          lastAssistantDoneAt = Date.now();
          sendEvent({ type: "assistantTranscriptDone", text: trimmed });
        });

        openai.on("responseDone", () => {
          responseActive = false;
          audioChunkCount = 0;
          sendEvent({ type: "responseDone" });
        });

        openai.once("sessionReady", () => {
          openai!.triggerResponse();
        });

        openai.on("error", (err: Error) => {
          sendEvent({ type: "error", message: err.message });
        });

        openai.connect();
        sendEvent({ type: "connected" });
      } else if (msg.type === "stop") {
        openai?.close();
        openai = null;
      }
    } catch {}
  });

  ws.on("close", () => {
    openai?.close();
    openai = null;
  });

  function sendEvent(event: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }
}
