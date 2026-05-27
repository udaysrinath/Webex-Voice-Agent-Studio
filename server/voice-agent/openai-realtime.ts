import WebSocket from "ws";
import { EventEmitter } from "events";

export interface RealtimeSessionConfig {
  model?: string;
  voice?: string;
  instructions: string;
  inputAudioFormat: "g711_ulaw" | "pcm16";
  outputAudioFormat: "g711_ulaw" | "pcm16";
  turnDetection?: {
    type: "server_vad" | "semantic_vad";
    create_response?: boolean;
    eagerness?: "low" | "medium" | "high" | "auto";
    idle_timeout_ms?: number;
    prefix_padding_ms?: number;
    threshold?: number;
    silence_duration_ms?: number;
    interrupt_response?: boolean;
  };
  inputAudioTranscriptionLanguage?: string;
  inputAudioTranscriptionModel?: string;
  inputAudioTranscriptionPrompt?: string;
  inputAudioNoiseReduction?: {
    type: "near_field" | "far_field";
  } | null;
  tools?: Array<{
    type: "function";
    name: string;
    description: string;
    parameters: object;
  }>;
}

export interface RealtimeSpeechEvent {
  item_id?: string;
  audio_start_ms?: number;
  audio_end_ms?: number;
}

export class OpenAIRealtimeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private config: RealtimeSessionConfig;
  private emittedAssistantTranscriptInResponse = false;
  private responseActive = false;
  private responseCreateInFlight = false;
  private pendingResponseCreates: Array<Record<string, unknown> | undefined> = [];

  constructor(apiKey: string, config: RealtimeSessionConfig) {
    super();
    this.apiKey = apiKey;
    this.config = config;
  }

  connect(): void {
    const model = this.config.model || process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2";
    this.ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${model}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    this.ws.on("open", () => {
      this.sendSessionUpdate();
      this.emit("open");
    });

    this.ws.on("message", (data: Buffer | string) => {
      try {
        const event = JSON.parse(data.toString());
        this.handleEvent(event);
      } catch {}
    });

    this.ws.on("close", () => this.emit("close"));
    this.ws.on("error", (err) => this.emit("error", err));
  }

  private sendSessionUpdate(): void {
    const session: Record<string, any> = {
      type: "realtime",
      output_modalities: ["audio"],
      audio: {
        input: {
          format: getRealtimeAudioFormat(this.config.inputAudioFormat),
          noise_reduction: this.config.inputAudioNoiseReduction ?? null,
          turn_detection: this.config.turnDetection || {
            type: "server_vad",
            create_response: true,
            threshold: 0.5,
            silence_duration_ms: 500,
            interrupt_response: true,
          },
          transcription: {
            model: this.config.inputAudioTranscriptionModel || "gpt-4o-mini-transcribe",
            language: this.config.inputAudioTranscriptionLanguage,
            prompt: this.config.inputAudioTranscriptionPrompt,
          },
        },
        output: {
          format: getRealtimeAudioFormat(this.config.outputAudioFormat),
          voice: this.config.voice || "marin",
        },
      },
      instructions: this.config.instructions,
      tools: this.config.tools || [],
      tool_choice: "auto",
    };

    this.send({
      type: "session.update",
      session,
    });
  }

  private handleEvent(event: any): void {
    switch (event.type) {
      case "session.created":
        this.emit("sessionCreated", event);
        break;
      case "session.updated":
        this.emit("sessionReady", event);
        break;
      case "response.created":
        this.responseActive = true;
        this.responseCreateInFlight = false;
        this.emittedAssistantTranscriptInResponse = false;
        this.emit("responseStarted", event.response);
        break;
      case "input_audio_buffer.speech_started":
        this.emit("userSpeechStarted", event as RealtimeSpeechEvent);
        break;
      case "input_audio_buffer.speech_stopped":
        this.emit("userSpeechStopped", event as RealtimeSpeechEvent);
        break;
      case "response.audio.delta":
      case "response.output_audio.delta":
        if (event.delta) {
          this.emit("audio", event.delta, event.item_id);
        }
        break;
      case "response.audio.done":
      case "response.output_audio.done":
        this.emit("audioDone", event.item_id);
        break;
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
        this.emit("assistantTranscriptDelta", event.delta);
        break;
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":
        this.emitAssistantTranscriptDone(event.transcript);
        break;
      case "response.output_text.delta":
        this.emit("assistantTranscriptDelta", event.delta);
        break;
      case "response.output_text.done":
        this.emitAssistantTranscriptDone(event.text);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.emit("userTranscript", event.transcript);
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (event.delta) {
          this.emit("userTranscriptDelta", event.delta, event.item_id);
        }
        break;
      case "conversation.item.input_audio_transcription.segment":
        if (event.text) {
          this.emit("userTranscriptSegment", event.text, event.item_id);
        }
        break;
      case "conversation.item.input_audio_transcription.failed":
        this.emit("userTranscriptFailed", event.error);
        break;
      case "conversation.item.done":
        break;
      case "response.function_call_arguments.done":
        this.emit("functionCall", {
          callId: event.call_id,
          name: event.name,
          arguments: event.arguments,
          itemId: event.item_id,
        });
        break;
      case "response.done":
        this.responseActive = false;
        this.responseCreateInFlight = false;
        if (isCancelledRealtimeResponse(event.response)) {
          this.emit("responseCancelled", event.response);
        } else {
          this.emit("responseDone", event.response);
        }
        this.flushPendingResponseCreate();
        break;
      case "response.cancelled":
      case "response.canceled":
        this.responseActive = false;
        this.responseCreateInFlight = false;
        this.emit("responseCancelled");
        this.flushPendingResponseCreate();
        break;
      case "error":
        if (isBenignRealtimeError(event.error)) return;
        this.emit("error", new Error(event.error?.message || "OpenAI Realtime error"));
        break;
    }
  }

  appendAudio(base64Audio: string): void {
    this.send({ type: "input_audio_buffer.append", audio: base64Audio });
  }

  truncateResponse(itemId: string, audioEndMs: number): void {
    this.send({
      type: "conversation.item.truncate",
      item_id: itemId,
      content_index: 0,
      audio_end_ms: audioEndMs,
    });
  }

  cancelResponse(): void {
    this.send({ type: "response.cancel" });
  }

  triggerResponse(response?: Record<string, unknown>): void {
    this.enqueueResponseCreate(response);
  }

  sendFunctionOutput(callId: string, output: string, createResponse = true): void {
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output },
    });
    if (createResponse) {
      this.enqueueResponseCreate();
    }
  }

  private enqueueResponseCreate(response?: Record<string, unknown>): void {
    if (this.responseActive || this.responseCreateInFlight) {
      this.pendingResponseCreates.push(response);
      return;
    }
    this.sendResponseCreate(response);
  }

  private flushPendingResponseCreate(): void {
    if (this.responseActive || this.responseCreateInFlight) return;
    if (this.pendingResponseCreates.length === 0) return;
    const response = this.pendingResponseCreates.shift();
    this.sendResponseCreate(response);
  }

  private sendResponseCreate(response?: Record<string, unknown>): void {
    this.responseCreateInFlight = true;
    this.send(response ? { type: "response.create", response } : { type: "response.create" });
  }

  private send(event: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  private emitAssistantTranscriptDone(text: string): void {
    if (!text?.trim()) return;
    this.emittedAssistantTranscriptInResponse = true;
    this.emit("assistantTranscriptDone", text);
  }

  close(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }
}

function extractAssistantTranscriptFromResponse(response: any): string {
  if (!response?.output || !Array.isArray(response.output)) return "";
  const parts = response.output
    .filter((item: any) => item?.role === "assistant" || item?.type === "message")
    .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
    .map((content: any) => content?.transcript || content?.text || "")
    .filter(Boolean);
  return parts.join(" ").trim();
}

function extractAssistantTranscriptFromItem(item: any): string {
  if (item?.role !== "assistant" || !Array.isArray(item.content)) return "";
  return item.content
    .map((content: any) => content?.transcript || content?.text || "")
    .filter(Boolean)
    .join(" ")
    .trim();
}

function isBenignRealtimeError(error: any): boolean {
  const message = String(error?.message || "");
  return (
    message.includes("Cancellation failed: no active response found") ||
    /Audio content of \d+ms is already shorter than \d+ms/.test(message) ||
    /Tool call ID 'call_[^']+' not found in conversation/.test(message)
  );
}

function isCancelledRealtimeResponse(response: any): boolean {
  const status = String(response?.status || "").toLowerCase();
  return status === "cancelled" || status === "canceled";
}

function getRealtimeAudioFormat(format: RealtimeSessionConfig["inputAudioFormat"]): { type: string; rate?: 24000 } {
  if (format === "g711_ulaw") {
    return { type: "audio/pcmu" };
  }

  return { type: "audio/pcm", rate: 24000 };
}
