export const AGENT_PROFILE_IDS = ["generic", "retail", "hr-feedback"] as const;

export type AgentProfileId = (typeof AGENT_PROFILE_IDS)[number];

export interface AgentProfileLike {
  profileId?: string | null;
  name?: string | null;
  systemPrompt?: string | null;
}

export function isAgentProfileId(value: unknown): value is AgentProfileId {
  return typeof value === "string" && AGENT_PROFILE_IDS.includes(value as AgentProfileId);
}

export function resolveAgentProfileId(agent: AgentProfileLike): AgentProfileId {
  if (agent.profileId && agent.profileId !== "generic" && isAgentProfileId(agent.profileId)) {
    return agent.profileId;
  }

  const text = `${agent.name || ""}\n${agent.systemPrompt || ""}`.toLowerCase();
  if (text.includes("hr feedback") || text.includes("colleague feedback")) return "hr-feedback";
  if (
    text.includes("store assistant") ||
    text.includes("retail store assistant") ||
    text.includes("cross-store intelligence") ||
    text.includes("mayada abdelrahman")
  ) {
    return "retail";
  }
  return "generic";
}
