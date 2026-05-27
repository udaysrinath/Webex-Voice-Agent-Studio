import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import { getWebexProfile } from "../webex-profile";
import { STORE_MANAGER_SUMMARY_SYSTEM_PROMPT } from "../voice-agent/prompt";
import type { CallTranscriptEntry, StoreManagerCallSummary } from "../voice-agent/dto";

export const STORE_MANAGER_WEBEX_TEMPLATE = "store_manager_webex_message";

export const webexTools = [
  {
    type: "function" as const,
    name: "webex_message",
    description: "Send a message to the configured Webex space. Use this when the user asks you to send a message to Webex.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message content to send.",
        },
      },
      required: ["message"],
    },
  },
];

export function sanitizeText(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ');
}

export function getConfiguredWebexRoomId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const roomId = env.WEBEX_SPACE_ID;
  const trimmed = roomId?.trim();
  return trimmed || undefined;
}

export function buildConfiguredWebexMessageArgs(
  message: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const roomId = getConfiguredWebexRoomId(env);
  return roomId ? { message, roomId } : { message };
}

export function formatCallDuration(startedAt: number | null, endedAt: number): string {
  if (!startedAt) return "Unknown";
  const totalSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function formatTranscript(entries: CallTranscriptEntry[]): string {
  if (entries.length === 0) return "No transcript was captured.";
  return entries
    .map((entry) => `**${entry.role}:** ${entry.text}`)
    .join("\n\n");
}

export function formatJsonForInstructions(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function renderTemplate(templateName: string, values: Record<string, string>): string {
  const templatePath = path.resolve(process.cwd(), "server", "templates", `${templateName}.md`);
  const template = fs.readFileSync(templatePath, "utf8");
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? "");
}

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function fallbackStoreManagerSummary(transcriptText: string): StoreManagerCallSummary {
  return {
    customer_name: "Unknown",
    final_resolution: "Review needed",
    summary: transcriptText ? "A customer call was completed. Review the transcript for details." : "A customer call ended without a captured transcript.",
    customer_intent: "Review transcript",
    products_discussed: "Not specified",
    customer_preferences: "Not specified",
    store_actions: "Review needed",
    recommended_next_step: "Review the transcript and follow up with the customer if needed.",
    reserved_item: "Not specified",
    pickup_time: "Not specified",
    recommended_upsell: "Not specified",
  };
}

export async function summarizeCallForStoreManager(transcriptText: string): Promise<StoreManagerCallSummary> {
  const client = getOpenAIClient();
  if (!client || !transcriptText.trim()) {
    return fallbackStoreManagerSummary(transcriptText);
  }

  try {
    const response = await client.chat.completions.create({
      model: process.env.CHAT_MODEL?.trim() || "gpt-4o",
      messages: [
        {
          role: "system",
          content: STORE_MANAGER_SUMMARY_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Transcript:\n${transcriptText}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as Partial<StoreManagerCallSummary>;
    return {
      customer_name: parsed.customer_name || "Unknown",
      final_resolution: parsed.final_resolution || "Review needed",
      summary: parsed.summary || "Review the transcript for call details.",
      customer_intent: parsed.customer_intent || "Not specified",
      products_discussed: parsed.products_discussed || "Not specified",
      customer_preferences: parsed.customer_preferences || "Not specified",
      store_actions: parsed.store_actions || "Not specified",
      recommended_next_step: parsed.recommended_next_step || "Review the transcript and follow up if needed.",
      reserved_item: parsed.reserved_item || "Not specified",
      pickup_time: parsed.pickup_time || "Not specified",
      recommended_upsell: parsed.recommended_upsell || "Not specified",
    };
  } catch (error: any) {
    console.error("[VoiceAgent] Store manager summary failed:", error.message);
    return fallbackStoreManagerSummary(transcriptText);
  }
}

export async function message(args: Record<string, any>): Promise<{ success: boolean; result?: string; error?: string }> {
  const webexProfile = getWebexProfile();
  const token = webexProfile.bearerToken;
  if (!token) {
    return { success: false, error: "Webex is not configured" };
  }

  const { message: rawMessage } = args;
  const messageContent = sanitizeText(rawMessage);
  const requestedRoomId = typeof args.roomId === "string" ? args.roomId.trim() : "";
  const roomId = requestedRoomId || webexProfile.webexSpaceId;

  if (!roomId) {
    return { 
      success: false, 
      error: "No WebexSpaceId is configured. Please set a WebexSpaceId in your profile." 
    };
  }

  try {
    console.log("Sending Webex message to configured space:", roomId);
    
    const response = await fetch('https://webexapis.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId,
        markdown: messageContent,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = response.statusText;
      try {
        const errorData = JSON.parse(errorText);
        errorMsg = errorData.message || errorData.errors?.[0]?.description || response.statusText;
      } catch {}
      return { 
        success: false, 
        error: `Webex error (${response.status}): ${errorMsg}` 
      };
    }

    return { 
      success: true, 
      result: "Message successfully sent to the configured Webex space" 
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to send message" };
  }
}
