import { CheckCircle2, MessageSquareText, Send, ShieldAlert } from "lucide-react";
import type { TranscriptEntry } from "@/hooks/use-voice-agent";

export interface HrTimelineEvent {
  id: string;
  kind: "session" | "guardrail" | "delivery" | "tool";
  title: string;
  detail: string;
  timestamp: number;
  success?: boolean;
}

export interface HrAssistState {
  events: HrTimelineEvent[];
}

export function createHrAssistState(): HrAssistState {
  return { events: [] };
}

export function updateHrAssistState(state: HrAssistState, event: any): HrAssistState {
  const timestamp = Number(event?.timestamp) || Date.now();
  let next: HrTimelineEvent | null = null;
  if (event?.type === "hrSessionStarted") {
    next = { id: `session-${timestamp}`, kind: "session", title: "Feedback session started", detail: "Feedback stays in this live session until a confirmed summary is delivered.", timestamp };
  } else if (event?.type === "liveSessionReady") {
    next = { id: `live-${timestamp}`, kind: "session", title: "Voice session ready", detail: "The agent is ready and will greet you shortly.", timestamp };
  } else if (event?.type === "guardrailTriggered") {
    next = { id: `guardrail-${timestamp}`, kind: "guardrail", title: `Guardrail: ${event.title || "Restricted HR topic"}`, detail: event.detail || "Restricted content was excluded and the conversation was redirected.", timestamp };
  } else if (event?.type === "feedbackDelivered") {
    next = { id: `delivery-${timestamp}`, kind: "delivery", title: "Confirmed summary delivered", detail: "The summary was sent to Webex and discarded from the voice session.", timestamp, success: true };
  } else if (event?.type === "toolCallCompleted" && event?.toolName === "hr_submit_feedback" && !event?.success) {
    next = { id: `tool-${timestamp}`, kind: "tool", title: "Summary delivery blocked", detail: event.error || "The confirmed summary could not be delivered.", timestamp, success: false };
  }
  return next ? { events: [...state.events, next] } : state;
}

function getInterviewCards(transcript: TranscriptEntry[]): HrTimelineEvent[] {
  const cards: HrTimelineEvent[] = [];
  const seen = new Set<string>();
  let awaiting: "example" | "development" | null = null;
  const addCard = (id: string, title: string, detail: string, timestamp: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    cards.push({ id, kind: "session", title, detail, timestamp });
  };
  for (const entry of transcript) {
    if (entry.role === "assistant") {
      if (/high.pressure situation/i.test(entry.text)) {
        awaiting = "example";
      } else if (/do differently|start doing more/i.test(entry.text)) {
        awaiting = "development";
      }
    } else if (entry.role === "user") {
      const answer = entry.text.trim();
      if (awaiting === "example" && answer) {
        addCard("high-pressure-response", "High-pressure response received", "The caller responded to the high-pressure question.", entry.timestamp);
      } else if (awaiting === "development" && answer) {
        addCard("development-response", "Development response received", "The caller responded to the leadership-development question.", entry.timestamp);
      }
      awaiting = null;
    }
  }
  return cards;
}

export function HrProgressTimeline({ state, transcript }: { state: HrAssistState; transcript: TranscriptEntry[] }) {
  const events = [...state.events, ...getInterviewCards(transcript)].sort((a, b) => a.timestamp - b.timestamp);
  if (events.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="hr-assist-timeline">
      {events.map((event) => {
        const Icon = event.kind === "guardrail" ? ShieldAlert : event.kind === "delivery" ? Send : event.kind === "session" ? MessageSquareText : CheckCircle2;
        const tone = event.kind === "guardrail"
          ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
          : event.success === false
            ? "border-red-500/35 bg-red-500/10 text-red-200"
            : event.kind === "delivery"
              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
              : "border-white/10 bg-white/5 text-foreground";
        return (
          <div key={event.id} className={`rounded-lg border p-4 ${tone}`}>
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-semibold">{event.title}</p>
                <p className="mt-1 text-xs leading-relaxed opacity-80">{event.detail}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
