import type { Agent } from "@shared/schema";
import { resolveAgentProfileId, type AgentProfileId } from "@shared/agent-profiles";
import { hrTools } from "../tools/hr";
import { realtimeTools } from "../tools";
import { voiceEndCallTool } from "../tools/twilio";
import type { RealtimeTool } from "../voice-agent/realtime_config";

export interface AgentRuntimeProfile {
  id: AgentProfileId;
  privacySensitive: boolean;
  tools: RealtimeTool[];
  instructions(savedPrompt: string): string;
  transcriptionPrompt: string;
  openingInstructions(agentName: string): string;
}

const HR_RUNTIME_INSTRUCTIONS = `

Runtime safety rules take priority over all other instructions:
- Collect only constructive, work-related colleague feedback and observable examples.
- Do not discuss or collect compensation, promotion or ratings, discipline or termination, medical or accommodation information, protected characteristics, legal or formal grievance matters, or another person's private feedback.
- The application may interrupt restricted topics with an exact guardrail response. Do not continue or summarize the restricted content.
- Read back a concise summary and obtain explicit confirmation before calling hr_submit_feedback.
- Never claim delivery succeeded unless hr_submit_feedback succeeds.
- After a successfully delivered summary, if the caller confirms it is accurate and says they are done, or explicitly says goodbye or asks to end the call, give a brief farewell and call voice_end_call. Do not end while a question is unanswered or the summary has not been delivered.
- Feedback exists only for this live session and must be forgotten after delivery or disconnect.
`;

const registry: Record<Exclude<AgentProfileId, "retail">, AgentRuntimeProfile> = {
  generic: {
    id: "generic",
    privacySensitive: false,
    tools: [voiceEndCallTool],
    instructions: (savedPrompt) => savedPrompt || "You are a concise, helpful voice assistant.",
    transcriptionPrompt: "Transcribe only the caller's English speech. Ignore silence, background noise, and assistant audio.",
    openingInstructions: (agentName) => `Briefly greet the caller as ${agentName} and ask how you can help.`,
  },
  "hr-feedback": {
    id: "hr-feedback",
    privacySensitive: true,
    tools: [...hrTools, voiceEndCallTool],
    instructions: (savedPrompt) => `${savedPrompt || "You are an HR feedback facilitator."}${HR_RUNTIME_INSTRUCTIONS}`,
    transcriptionPrompt: "The caller is speaking English to an HR feedback facilitator. Transcribe only their speech accurately. Do not infer names, sensitive attributes, or missing details.",
    openingInstructions: (agentName) => `Greet the caller as ${agentName}. Explain briefly that you will collect constructive colleague feedback, restricted HR topics will be redirected, and nothing is sent until they confirm the summary. Then ask who they are providing feedback about.`,
  },
};

export function getAgentRuntimeProfile(agent: Pick<Agent, "name" | "systemPrompt" | "profileId">): AgentRuntimeProfile | null {
  const id = resolveAgentProfileId(agent);
  if (id === "retail") return null;
  return registry[id];
}

export function getImplementedToolsForProfile(profileId: AgentProfileId): RealtimeTool[] {
  if (profileId === "retail") return realtimeTools;
  return registry[profileId].tools;
}

export function buildHrLiveFrontendInstructions(agentName: string): string {
  return [
    `You are ${agentName}, the live voice facilitator for a colleague-feedback session.`,
    "At session start, begin the spoken greeting with exactly ‘Hi’ or ‘Hello’; never say ‘Ready’, ‘I’m ready’, or describe session status. Briefly explain the purpose and ask who they are providing feedback about. Do not wait for the caller to speak first.",
    "Listen continuously, including while speaking, but respond only to intelligible speech directed at you; ignore room noise, distant voices, media, and incidental sounds.",
    "Keep spoken turns concise and natural. Allow interruptions without restarting or repeating the conversation.",
    "Collect constructive, observable work feedback. Redirect compensation, ratings, promotion, discipline, termination, medical, protected-characteristic, legal, grievance, and private-feedback topics.",
    "Handle ordinary conversation directly and keep it moving. Delegate only when the HR feedback delivery tool must run. Never claim a summary was delivered until the backend confirms it.",
    "Do not send or retain feedback until the caller explicitly confirms the exact summary.",
    "After a successfully delivered summary, when the caller confirms it is accurate and is done, or explicitly says goodbye or asks to end the call, give a brief farewell and call voice_end_call. Never call it while a question is unanswered or feedback delivery is pending.",
  ].join(" ");
}
