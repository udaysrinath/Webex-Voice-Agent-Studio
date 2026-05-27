import type { RealtimeSessionConfig } from "./openai-realtime";
import { realtimeTools } from "../tools";
import { twilioCallerSummaryTool, voiceEndCallTool } from "../tools/twilio";
import {
  buildBrowserTranscriptionPrompt,
  buildPhoneTranscriptionPrompt,
} from "./prompt";

export type RealtimeTool = NonNullable<RealtimeSessionConfig["tools"]>[number];

export const BROWSER_PCM16_SAMPLE_RATE = 24000;
export const TWILIO_G711_SAMPLE_RATE = 8000;

export function buildRealtimeVoiceTools(options: {
  smsEnabled: boolean;
  callerSummarySmsEnabled: boolean;
}): RealtimeTool[] {
  return [
    ...realtimeTools.filter((tool) => options.smsEnabled || tool.name !== "twilio_sms"),
    ...(options.callerSummarySmsEnabled ? [twilioCallerSummaryTool] : []),
    voiceEndCallTool,
  ];
}

export function buildRealtimeVoiceConfig(options: {
  instructions: string;
  voice: string;
  inputAudioFormat: RealtimeSessionConfig["inputAudioFormat"];
  outputAudioFormat?: RealtimeSessionConfig["outputAudioFormat"];
  transcriptionLanguage: string;
  transcriptionModel: string;
  transcriptionPrompt: string;
  inputAudioNoiseReduction: RealtimeSessionConfig["inputAudioNoiseReduction"];
  tools: RealtimeTool[];
}): RealtimeSessionConfig {
  return {
    instructions: options.instructions,
    voice: options.voice,
    inputAudioFormat: options.inputAudioFormat,
    outputAudioFormat: options.outputAudioFormat || options.inputAudioFormat,
    inputAudioTranscriptionLanguage: options.transcriptionLanguage,
    inputAudioTranscriptionModel: options.transcriptionModel,
    inputAudioTranscriptionPrompt: options.transcriptionPrompt,
    inputAudioNoiseReduction: options.inputAudioNoiseReduction,
    turnDetection: {
      type: "semantic_vad",
      eagerness: "high",
      create_response: false,
      interrupt_response: false,
    },
    tools: options.tools,
  };
}

export function buildBrowserRealtimeConfig(options: {
  instructions: string;
  voice: string;
  transcriptionLanguage: string;
  transcriptionModel: string;
  retailTranscriptionKeywords: string;
  tools: RealtimeTool[];
}): RealtimeSessionConfig {
  return buildRealtimeVoiceConfig({
    instructions: options.instructions,
    voice: options.voice,
    inputAudioFormat: "pcm16",
    transcriptionLanguage: options.transcriptionLanguage,
    transcriptionModel: options.transcriptionModel,
    transcriptionPrompt: buildBrowserTranscriptionPrompt(options.retailTranscriptionKeywords),
    inputAudioNoiseReduction: { type: "far_field" },
    tools: options.tools,
  });
}

export function buildPhoneRealtimeConfig(options: {
  instructions: string;
  voice: string;
  transcriptionLanguage: string;
  transcriptionModel: string;
  retailTranscriptionKeywords: string;
  tools: RealtimeTool[];
}): RealtimeSessionConfig {
  return buildRealtimeVoiceConfig({
    instructions: options.instructions,
    voice: options.voice,
    inputAudioFormat: "g711_ulaw",
    transcriptionLanguage: options.transcriptionLanguage,
    transcriptionModel: options.transcriptionModel,
    transcriptionPrompt: buildPhoneTranscriptionPrompt(options.retailTranscriptionKeywords),
    inputAudioNoiseReduction: { type: "near_field" },
    tools: options.tools,
  });
}
