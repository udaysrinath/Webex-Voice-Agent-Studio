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
