import WebSocket from "ws";
import { EventEmitter } from "events";
import type { RealtimeSessionConfig } from "./openai-realtime";

const TRANSCRIPT_IDLE_MS = 250;

export interface LiveSessionOptions {
  frontendInstructions: string;
  backendInstructions: string;
  backendModel?: string;
}

export function buildLiveSessionStart(
  config: RealtimeSessionConfig,
  options: LiveSessionOptions
): Record<string, any> {
  const tools = (config.tools || []).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  return {
    type: "session.start",
    event_id: "voice_agent_session_start",
    session: {
      model: "gpt-live-1",
      instructions: options.frontendInstructions,
      audio: {
        format: { type: "audio/pcm", rate: 24000 },
        output: { voice: config.voice || "marin" },
      },
      delegation: {
        type: "responses",
        responses: {
          model: options.backendModel || process.env.OPENAI_LIVE_BACKEND_MODEL || "gpt-5.6-luna",
          instructions: options.backendInstructions,
          tools,
          tool_choice: "auto",
          parallel_tool_calls: false,
        },
      },
    },
  };
}

export class OpenAILiveClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private started = false;
  private closing = false;
  private inputTranscript = "";
  private outputTranscript = "";
  private inputTimer: ReturnType<typeof setTimeout> | null = null;
  private outputActive = false;

  constructor(
    private readonly apiKey: string,
    private readonly config: RealtimeSessionConfig,
    private readonly options: LiveSessionOptions
  ) {
    super();
  }

  connect(): void {
    this.ws = new WebSocket("wss://api.openai.com/v1/live/sessions", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    this.ws.on("open", () => this.startSession());
    this.ws.on("message", (data) => {
      try {
        this.handleEvent(JSON.parse(data.toString()));
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error("Invalid GPT-Live event"));
      }
    });
    this.ws.on("close", () => this.emit("close"));
    this.ws.on("error", (error) => this.emit("error", error));
  }

  private startSession(): void {
    this.send(buildLiveSessionStart(this.config, this.options));
  }

  private handleEvent(event: any): void {
    switch (event.type) {
      case "session.started":
        this.started = true;
        this.emit("open");
        this.emit("sessionReady", event);
        return;
      case "session.input_transcript.delta":
        this.handleInputTranscriptDelta(String(event.delta || ""));
        return;
      case "session.output_transcript.delta":
        this.handleOutputTranscriptDelta(String(event.delta || ""));
        return;
      case "session.output_audio.delta":
        if (event.delta) this.handleOutputAudioDelta(event.delta);
        return;
      case "response.event":
        this.handleDelegatedResponseEvent(event);
        return;
      case "session.closed":
        this.ws?.close();
        return;
      case "error":
        this.emit("error", new Error(event.error?.message || "OpenAI GPT-Live error"));
        return;
    }
  }

  private handleInputTranscriptDelta(delta: string): void {
    if (!delta) return;
    if (!this.inputTranscript) this.emit("userSpeechStarted", {});
    this.inputTranscript += delta;
    this.emit("userTranscriptDelta", delta);
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = setTimeout(() => {
      const transcript = this.inputTranscript.trim();
      this.inputTranscript = "";
      this.inputTimer = null;
      this.emit("userSpeechStopped", {});
      if (transcript) this.emit("userTranscript", transcript);
    }, TRANSCRIPT_IDLE_MS);
  }

  private handleOutputTranscriptDelta(delta: string): void {
    if (!delta) return;
    this.outputTranscript += delta;
    this.emit("assistantTranscriptDelta", delta);
  }

  private handleOutputAudioDelta(delta: string): void {
    if (!this.outputActive) {
      this.outputActive = true;
      this.emit("responseStarted");
    }
    this.emit("audio", delta, "gpt-live-output");
  }

  flushOutputTranscript(): void {
    const transcript = this.outputTranscript.trim();
    this.outputTranscript = "";
    if (transcript) this.emit("assistantTranscriptDone", transcript);
    this.outputActive = false;
    this.emit("audioDone", "gpt-live-output");
    this.emit("responseDone");
  }

  private handleDelegatedResponseEvent(envelope: any): void {
    const event = envelope.event;
    if (event?.type === "response.output_item.done" && event.item?.type === "function_call") {
      this.emit("functionCall", {
        callId: event.item.call_id,
        name: event.item.name,
        arguments: event.item.arguments,
        itemId: event.item.id,
        delegationId: envelope.delegation_id,
      });
    } else if (event?.type === "error") {
      this.emit("error", new Error(event.error?.message || "GPT-Live delegated response error"));
    }
  }

  appendAudio(base64Audio: string): void {
    if (!this.started || this.closing) return;
    this.send({ type: "session.input_audio.append", audio: base64Audio });
  }

  startWithGreeting(): void {
    this.appendInstruction(
      "Greet the caller now in English with one short sentence. Introduce yourself as the HR Agent, explain that you will help collect constructive colleague feedback, and ask who they are sharing feedback about. Begin immediately, then pause and listen."
    );
  }

  appendInstruction(content: string): void {
    if (!this.started || !content.trim()) return;
    this.send({
      type: "session.instructions.append",
      event_id: `instruction_${Date.now()}`,
      delegation_id: null,
      content: content.slice(0, 2000),
    });
  }

  triggerResponse(response?: Record<string, any>): void {
    const inputText = response?.input
      ?.flatMap((item: any) => item?.content || [])
      .map((content: any) => content?.text || "")
      .filter(Boolean)
      .join(" ");
    const content = [response?.instructions, inputText].filter(Boolean).join("\n\n");
    this.appendInstruction(content);
  }

  sendFunctionOutput(callId: string, output: string, createResponse = true): void {
    this.send({
      type: "response.item.create",
      event_id: `tool_result_${Date.now()}`,
      item: { type: "function_call_output", call_id: callId, output },
    });
    if (createResponse) {
      this.send({ type: "response.create", event_id: `continue_${Date.now()}` });
    }
  }

  cancelResponse(): void {
    this.appendInstruction("Stop speaking immediately and listen to the caller.");
  }

  truncateResponse(_itemId?: string, _audioEndMs?: number): void {
    // GPT-Live has no Realtime conversation.item.truncate equivalent.
  }

  close(): void {
    this.clearTimers();
    if (this.ws?.readyState === WebSocket.OPEN && this.started && !this.closing) {
      this.closing = true;
      this.send({ type: "session.close", event_id: `close_${Date.now()}` });
      setTimeout(() => this.ws?.close(), 1000);
    } else {
      this.ws?.close();
    }
  }

  private clearTimers(): void {
    if (this.inputTimer) clearTimeout(this.inputTimer);
  }

  private send(event: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }
}
