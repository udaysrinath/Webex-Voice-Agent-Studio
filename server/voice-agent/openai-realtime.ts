import WebSocket from "ws";
import { EventEmitter } from "events";

export interface RealtimeSessionConfig {
  model?: string;
  voice?: string;
  instructions: string;
  inputAudioFormat: "g711_ulaw" | "pcm16";
  outputAudioFormat: "g711_ulaw" | "pcm16";
  turnDetection?: {
    type: "server_vad";
    threshold?: number;
    silence_duration_ms?: number;
    interrupt_response?: boolean;
  };
  inputAudioTranscriptionLanguage?: string;
  inputAudioTranscriptionPrompt?: string;
  tools?: Array<{
    type: "function";
    name: string;
    description: string;
    parameters: object;
  }>;
  temperature?: number;
}

export class OpenAIRealtimeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private config: RealtimeSessionConfig;

  constructor(apiKey: string, config: RealtimeSessionConfig) {
    super();
    this.apiKey = apiKey;
    this.config = config;
  }

  connect(): void {
    const model = this.config.model || "gpt-4o-realtime-preview";
    this.ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${model}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
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
    this.send({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice: this.config.voice || "alloy",
        input_audio_format: this.config.inputAudioFormat,
        output_audio_format: this.config.outputAudioFormat,
        instructions: this.config.instructions,
        turn_detection: this.config.turnDetection || {
          type: "server_vad",
          threshold: 0.5,
          silence_duration_ms: 500,
          interrupt_response: true,
        },
        tools: this.config.tools || [],
        tool_choice: "auto",
        temperature: this.config.temperature ?? 0.8,
        input_audio_transcription: {
          model: "whisper-1",
          language: this.config.inputAudioTranscriptionLanguage,
          prompt: this.config.inputAudioTranscriptionPrompt,
        },
      },
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
      case "input_audio_buffer.speech_started":
        this.emit("userSpeechStarted");
        break;
      case "input_audio_buffer.speech_stopped":
        this.emit("userSpeechStopped");
        break;
      case "response.audio.delta":
        if (event.delta) {
          this.emit("audio", event.delta, event.item_id);
        }
        break;
      case "response.audio.done":
        this.emit("audioDone", event.item_id);
        break;
      case "response.audio_transcript.delta":
        this.emit("assistantTranscriptDelta", event.delta);
        break;
      case "response.audio_transcript.done":
        this.emit("assistantTranscriptDone", event.transcript);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.emit("userTranscript", event.transcript);
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
        this.emit("responseDone", event.response);
        break;
      case "response.cancelled":
        this.emit("responseCancelled");
        break;
      case "error":
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

  triggerResponse(): void {
    this.send({ type: "response.create" });
  }

  sendFunctionOutput(callId: string, output: string): void {
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output },
    });
    this.send({ type: "response.create" });
  }

  private send(event: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  close(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }
}
