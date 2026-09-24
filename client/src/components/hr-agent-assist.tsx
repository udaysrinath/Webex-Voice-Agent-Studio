import { CheckCircle2, MessageSquareText, Send, ShieldAlert } from "lucide-react";

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
  } else if (event?.type === "guardrailTriggered") {
    next = { id: `guardrail-${timestamp}`, kind: "guardrail", title: `Guardrail: ${event.title || "Restricted HR topic"}`, detail: event.detail || "Restricted content was excluded and the conversation was redirected.", timestamp };
  } else if (event?.type === "feedbackDelivered") {
    next = { id: `delivery-${timestamp}`, kind: "delivery", title: "Confirmed summary delivered", detail: "The summary was sent to Webex and discarded from the voice session.", timestamp, success: true };
  } else if (event?.type === "toolCallCompleted" && event?.toolName === "hr_submit_feedback" && !event?.success) {
    next = { id: `tool-${timestamp}`, kind: "tool", title: "Summary delivery blocked", detail: event.error || "The confirmed summary could not be delivered.", timestamp, success: false };
  }
  return next ? { events: [...state.events, next] } : state;
}

export function HrProgressTimeline({ state }: { state: HrAssistState }) {
  if (state.events.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="hr-assist-timeline">
      {state.events.map((event) => {
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
