import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { OpenAIRealtimeClient, RealtimeSessionConfig } from "./openai-realtime";
import { storage } from "../storage";
import { realtimeTools, executeTool } from "../tools";

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
const BROWSER_AUDIO_ECHO_GUARD_MS = 1200;
const BROWSER_TRANSCRIPT_ECHO_GUARD_MS = 1200;
const BROWSER_ASSISTANT_ECHO_MATCH_MS = 5000;

interface BrowserTranscriptGuardContext {
  acceptedUserTranscriptCount: number;
  browserPlaybackActive: boolean;
  language: string;
  lastAssistantAudioAt: number;
  lastAssistantDoneAt: number;
  lastAssistantTranscript: string;
  lastBrowserPlaybackEndedAt: number;
  responseActive: boolean;
}

function normalizeTranscript(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?,\s]+$/g, "");
}

function getPrimaryLanguageCode(language: string | undefined): string {
  return (language || "en").split(/[-_]/)[0]?.toLowerCase() || "en";
}

function isEnglishLanguage(language: string): boolean {
  return getPrimaryLanguageCode(language) === "en";
}

function hasMostlyNonLatinLetters(text: string): boolean {
  const latinLetters = text.match(/[A-Za-z]/g)?.length || 0;
  const nonAsciiChars = text.match(/[\u0080-\uFFFF]/g)?.length || 0;
  const signalChars = latinLetters + nonAsciiChars;
  if (signalChars < 3) return false;

  return latinLetters / signalChars < 0.6;
}

function tokenizeTranscript(text: string): string[] {
  return normalizeTranscript(text)
    .split(/[^a-z0-9']+/i)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length > 2);
}

function hasHighAssistantEchoOverlap(userText: string, assistantText: string): boolean {
  const userTokens = new Set(tokenizeTranscript(userText));
  const assistantTokens = new Set(tokenizeTranscript(assistantText));
  if (userTokens.size < 3 || assistantTokens.size < 3) return false;

  let shared = 0;
  for (const token of Array.from(userTokens)) {
    if (assistantTokens.has(token)) shared++;
  }

  return shared / userTokens.size >= 0.75;
}

function shouldSuppressBrowserAudioInput(
  responseActive: boolean,
  browserPlaybackActive: boolean,
  lastAssistantAudioAt: number,
  lastBrowserPlaybackEndedAt: number
): boolean {
  const now = Date.now();
  return (
    responseActive ||
    browserPlaybackActive ||
    now - lastAssistantAudioAt < BROWSER_AUDIO_ECHO_GUARD_MS ||
    now - lastBrowserPlaybackEndedAt < BROWSER_AUDIO_ECHO_GUARD_MS
  );
}

function shouldSuppressBrowserUserTranscript(
  text: string,
  context: BrowserTranscriptGuardContext
): boolean {
  const normalized = normalizeTranscript(text);
  if (!normalized) return true;

  const now = Date.now();
  const justAfterAssistant =
    now - context.lastAssistantDoneAt < BROWSER_TRANSCRIPT_ECHO_GUARD_MS ||
    now - context.lastAssistantAudioAt < BROWSER_TRANSCRIPT_ECHO_GUARD_MS ||
    now - context.lastBrowserPlaybackEndedAt < BROWSER_TRANSCRIPT_ECHO_GUARD_MS;

  if (context.responseActive || context.browserPlaybackActive || justAfterAssistant) {
    return true;
  }

  if (isEnglishLanguage(context.language) && hasMostlyNonLatinLetters(normalized)) {
    return true;
  }

  const recentAssistant = now - context.lastAssistantDoneAt < BROWSER_ASSISTANT_ECHO_MATCH_MS;
  if (
    recentAssistant &&
    context.lastAssistantTranscript &&
    hasHighAssistantEchoOverlap(normalized, context.lastAssistantTranscript)
  ) {
    return true;
  }

  const isShortFarewell = SPURIOUS_SHORT_TRANSCRIPTS.has(normalized);
  if (!isShortFarewell) return false;

  return context.acceptedUserTranscriptCount === 0;
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
        
        if (params.callerPhone) {
          instructions += `\n\nCRITICAL INFO: The user is calling from the phone number ${params.callerPhone}. You can use this phone number if you need to send them an SMS.`;
        }

        if (agentId && agentId !== "default") {
          const agent = await storage.getAgent(parseInt(agentId));
          if (agent) {
            instructions = agent.systemPrompt || instructions;
            voice = mapVoice(agent.voiceModel);
          }
        }

        const tools = realtimeTools;

        openai = new OpenAIRealtimeClient(process.env.OPENAI_API_KEY || "", {
          instructions,
          voice,
          inputAudioFormat: "g711_ulaw",
          outputAudioFormat: "g711_ulaw",
          tools,
        });

        openai.on("audio", (base64: string, itemId: string) => {
          lastItemId = itemId;
          if (responseStartTs === null) responseStartTs = latestTs;
          ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: base64 } }));
          const markName = `m-${Date.now()}`;
          ws.send(JSON.stringify({ event: "mark", streamSid, mark: { name: markName } }));
          markQueue.push(markName);
        });

        openai.on("userSpeechStarted", () => {
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

        openai.on("functionCall", async ({ callId, name, arguments: argsString }) => {
          console.log(`[VoiceAgent/Twilio] Function call: ${name}`);
          try {
            const args = JSON.parse(argsString);
            const result = await executeTool(name, args);
            console.log(`[VoiceAgent/Twilio] Function result:`, result);
            openai?.sendFunctionOutput(callId, JSON.stringify(result));
          } catch (e: any) {
            console.error(`[VoiceAgent/Twilio] Function execution failed:`, e);
            openai?.sendFunctionOutput(callId, JSON.stringify({ success: false, error: e.message }));
          }
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
  let responseActive = false;
  let browserPlaybackActive = false;
  let lastAssistantAudioAt = 0;
  let lastAssistantDoneAt = 0;
  let lastAssistantTranscript = "";
  let lastBrowserPlaybackEndedAt = 0;
  let acceptedUserTranscriptCount = 0;
  let language = "en-US";

  ws.on("message", async (raw) => {
    if (Buffer.isBuffer(raw) && openai) {
      if (
        shouldSuppressBrowserAudioInput(
          responseActive,
          browserPlaybackActive,
          lastAssistantAudioAt,
          lastBrowserPlaybackEndedAt
        )
      ) {
        return;
      }

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
        language = config?.language || language;

        if (agentId) {
          const agent = await storage.getAgent(parseInt(agentId));
          if (agent) {
            instructions = agent.systemPrompt || instructions;
            voice = mapVoice(agent.voiceModel);
            language = agent.language || language;
          }
        }

        const tools = realtimeTools;

        instructions = "Always respond in English unless the user explicitly asks for another language.\n\n" + instructions;

        openai = new OpenAIRealtimeClient(process.env.OPENAI_API_KEY || "", {
          instructions,
          voice,
          inputAudioFormat: "pcm16",
          outputAudioFormat: "pcm16",
          inputAudioTranscriptionLanguage: getPrimaryLanguageCode(language),
          turnDetection: {
            type: "server_vad",
            threshold: 0.65,
            silence_duration_ms: 700,
            interrupt_response: false,
          },
          tools,
        });

        openai.on("audio", (base64: string, _itemId: string) => {
          responseActive = true;
          lastAssistantAudioAt = Date.now();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(Buffer.from(base64, "base64"));
          }
        });

        openai.on("audioDone", () => {
          lastAssistantAudioAt = Date.now();
        });

        openai.on("userSpeechStarted", () => {
          if (
            shouldSuppressBrowserAudioInput(
              responseActive,
              browserPlaybackActive,
              lastAssistantAudioAt,
              lastBrowserPlaybackEndedAt
            )
          ) {
            return;
          }

          sendEvent({ type: "userSpeechStarted" });
        });

        openai.on("userSpeechStopped", () => {
          sendEvent({ type: "userSpeechStopped" });
        });

        openai.on("userTranscript", (text: string) => {
          const trimmed = text.trim();
          if (
            shouldSuppressBrowserUserTranscript(trimmed, {
              acceptedUserTranscriptCount,
              browserPlaybackActive,
              language,
              lastAssistantAudioAt,
              lastAssistantDoneAt,
              lastAssistantTranscript,
              lastBrowserPlaybackEndedAt,
              responseActive,
            })
          ) {
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
          lastAssistantTranscript = trimmed;
          sendEvent({ type: "assistantTranscriptDone", text: trimmed });
        });

        openai.on("responseDone", () => {
          responseActive = false;
          sendEvent({ type: "responseDone" });
        });

        openai.once("sessionReady", () => {
          openai!.triggerResponse();
        });

        openai.on("error", (err: Error) => {
          sendEvent({ type: "error", message: err.message });
        });

        openai.on("functionCall", async ({ callId, name, arguments: argsString }) => {
          console.log(`[VoiceAgent/Browser] Function call: ${name}`);
          try {
            const args = JSON.parse(argsString);
            const result = await executeTool(name, args);
            console.log(`[VoiceAgent/Browser] Function result:`, result);
            openai?.sendFunctionOutput(callId, JSON.stringify(result));
          } catch (e: any) {
            console.error(`[VoiceAgent/Browser] Function execution failed:`, e);
            openai?.sendFunctionOutput(callId, JSON.stringify({ success: false, error: e.message }));
          }
        });

        openai.connect();
        sendEvent({ type: "connected" });
      } else if (msg.type === "stop") {
        openai?.close();
        openai = null;
      } else if (msg.type === "assistantPlaybackStarted") {
        browserPlaybackActive = true;
      } else if (msg.type === "assistantPlaybackEnded") {
        browserPlaybackActive = false;
        lastBrowserPlaybackEndedAt = Date.now();
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
