import { buildConfiguredWebexMessageArgs, message as sendWebexMessage } from "./webex";

export type HrRestrictedCategory =
  | "compensation"
  | "promotion_or_rating"
  | "discipline_or_termination"
  | "medical_or_accommodation"
  | "protected_characteristic"
  | "legal_or_grievance"
  | "private_feedback";

const RESTRICTED_PATTERNS: Array<{ category: HrRestrictedCategory; pattern: RegExp; label: string }> = [
  { category: "compensation", pattern: /\b(salary|salaries|pay|paid|compensation|bonus|benefits?|equity|stock options?|raise)\b/i, label: "Compensation and benefits" },
  { category: "promotion_or_rating", pattern: /\b(promot(?:e|ed|ing|ion)|performance rating|performance score|calibration|rank(?:ing)?|merit rating)\b/i, label: "Promotion and performance ratings" },
  { category: "discipline_or_termination", pattern: /\b(fir(?:e|ed|ing)|termination|terminate|layoff|disciplin(?:e|ary)|performance improvement plan|\bPIP\b)\b/i, label: "Discipline and employment decisions" },
  { category: "medical_or_accommodation", pattern: /\b(medical|diagnos(?:is|ed)|disability|accommodation|health condition|mental health|sick leave)\b/i, label: "Medical and accommodation information" },
  { category: "protected_characteristic", pattern: /\b(race|ethnicity|religion|gender|sexual orientation|pregnan(?:t|cy)|national origin|citizenship|age|marital status)\b/i, label: "Protected personal characteristics" },
  { category: "legal_or_grievance", pattern: /\b(lawsuit|legal action|lawyer|attorney|formal grievance|formal complaint|harassment complaint|discrimination complaint)\b/i, label: "Legal matters and formal grievances" },
  { category: "private_feedback", pattern: /\b(what did .{0,40} say about|tell me .{0,30} feedback|who said|anonymous feedback|confidential feedback|other people'?s feedback)\b/i, label: "Other people's private feedback" },
];

export interface HrGuardrailMatch {
  category: HrRestrictedCategory;
  label: string;
  response: string;
}

export function classifyHrRestrictedTopic(text: string): HrGuardrailMatch | null {
  const match = RESTRICTED_PATTERNS.find((item) => item.pattern.test(text));
  if (!match) return null;
  return {
    category: match.category,
    label: match.label,
    response: `I can't collect or discuss ${match.label.toLowerCase()} in this feedback session. Please focus on observable work behaviors, collaboration, outcomes, and constructive examples.`,
  };
}

export const hrTools = [
  {
    type: "function" as const,
    name: "hr_submit_feedback",
    description: "Send the caller-confirmed colleague feedback summary to the configured Webex space. Call only after explicit confirmation.",
    parameters: {
      type: "object",
      properties: {
        colleague: { type: "string", description: "Name of the colleague receiving feedback." },
        relationship: { type: "string", description: "How the caller works with the colleague." },
        strengths: { type: "array", items: { type: "string" }, description: "Constructive strengths supported by observable work behavior." },
        developmentAreas: { type: "array", items: { type: "string" }, description: "Constructive development areas supported by observable work behavior." },
        examples: { type: "array", items: { type: "string" }, description: "Optional observable examples." },
        consentConfirmed: { type: "boolean", description: "True only when the caller explicitly approved this exact summary." },
      },
      required: ["colleague", "relationship", "strengths", "developmentAreas", "consentConfirmed"],
    },
  },
];

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export async function submit_feedback(args: Record<string, unknown>): Promise<{ success: boolean; result?: string; error?: string; data?: unknown }> {
  if (args.consentConfirmed !== true) {
    return { success: false, error: "Explicit caller confirmation is required before feedback can be sent." };
  }

  const colleague = typeof args.colleague === "string" ? args.colleague.trim() : "";
  const relationship = typeof args.relationship === "string" ? args.relationship.trim() : "";
  const strengths = stringList(args.strengths);
  const developmentAreas = stringList(args.developmentAreas);
  const examples = stringList(args.examples);
  if (!colleague || !relationship || (strengths.length === 0 && developmentAreas.length === 0)) {
    return { success: false, error: "Colleague, relationship, and at least one feedback point are required." };
  }

  const restricted = classifyHrRestrictedTopic([colleague, relationship, ...strengths, ...developmentAreas, ...examples].join("\n"));
  if (restricted) {
    return { success: false, error: `Feedback contains a restricted topic: ${restricted.label}.` };
  }

  const bullets = (items: string[]) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- None provided";
  const summary = [
    "## Colleague feedback",
    `**Colleague:** ${colleague}`,
    `**Working relationship:** ${relationship}`,
    "### Strengths",
    bullets(strengths),
    "### Development areas",
    bullets(developmentAreas),
    ...(examples.length ? ["### Observable examples", bullets(examples)] : []),
    "_The caller explicitly confirmed this summary before delivery._",
  ].join("\n\n");

  const delivery = await sendWebexMessage(buildConfiguredWebexMessageArgs(summary));
  if (!delivery.success) return delivery;
  return {
    success: true,
    result: "Confirmed feedback summary sent to Webex and discarded from the voice session.",
    data: {
      delivered: true,
      strengthCount: strengths.length,
      developmentAreaCount: developmentAreas.length,
      exampleCount: examples.length,
    },
  };
}
