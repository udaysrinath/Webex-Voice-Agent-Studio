import {
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Activity,
  Clock3,
  ClipboardCheck,
  Gift,
  History,
  IdCard,
  MapPin,
  PackageCheck,
  Phone,
  Radio,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  RETAIL_STORE_ASSISTANT_USE_CASE,
  getRetailInventoryStatusLabel,
  type RetailActionPlan,
  type RetailCustomerProfile,
  type RetailInventoryItem,
} from "@shared/use-cases";

export interface RetailReservation {
  reservationId: string;
  customerName: string;
  item: RetailInventoryItem;
  store: string;
  pickupTime: string;
  status: string;
}

export interface RetailToolEvent {
  id: string;
  toolName: string;
  status: "ready" | "running" | "done" | "error";
  result?: string;
  args?: Record<string, unknown>;
  data?: unknown;
  durationMs?: number;
  timestamp: number;
}

export interface RetailAssistState {
  verification?: {
    phone: string;
    method: "sms" | "lookup";
    status: "sent" | "verified";
    smsSent?: boolean;
    sentAt?: number;
    verifiedAt?: number;
  };
  customer: RetailCustomerProfile;
  inventory: RetailInventoryItem[];
  recommendation?: RetailInventoryItem;
  recommendationRationale?: string;
  reservation?: RetailReservation;
  handoff?: RetailActionPlan;
  toolEvents: RetailToolEvent[];
  completedStages: {
    identityVerificationSent: boolean;
    identityVerified: boolean;
    customerLoaded: boolean;
    historyFetched: boolean;
    inventoryChecked: boolean;
    recommendationCreated: boolean;
    reservationCreated: boolean;
    handoffCreated: boolean;
  };
}

export function createRetailAssistState(): RetailAssistState {
  return {
    customer: RETAIL_STORE_ASSISTANT_USE_CASE.customer,
    inventory: RETAIL_STORE_ASSISTANT_USE_CASE.inventory,
    recommendation: undefined,
    recommendationRationale: "",
    handoff: RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook,
    toolEvents: [],
    completedStages: {
      identityVerificationSent: false,
      identityVerified: false,
      customerLoaded: false,
      historyFetched: false,
      inventoryChecked: false,
      recommendationCreated: false,
      reservationCreated: false,
      handoffCreated: false,
    },
  };
}

export function updateRetailAssistState(current: RetailAssistState, event: any): RetailAssistState {
  const timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();

  switch (event.type) {
    case "identityVerificationSent": {
      const data = event.data || {};
      return {
        ...current,
        verification: {
          phone: data.phone || current.verification?.phone || "",
          method: "sms",
          status: "sent",
          smsSent: data.smsSent ?? true,
          sentAt: timestamp,
        },
        completedStages: { ...current.completedStages, identityVerificationSent: true },
      };
    }
    case "identityVerified": {
      const data = event.data || {};
      const verifiedCustomerName = typeof data.customerName === "string" && data.customerName.trim()
        ? data.customerName.trim()
        : "";
      return {
        ...current,
        verification: {
          phone: data.phone || current.verification?.phone || "",
          method: "sms",
          status: "verified",
          smsSent: current.verification?.smsSent ?? true,
          sentAt: current.verification?.sentAt,
          verifiedAt: data.verifiedAt || timestamp,
        },
        customer: verifiedCustomerName
          ? { ...current.customer, name: verifiedCustomerName }
          : current.customer,
        completedStages: {
          ...current.completedStages,
          identityVerificationSent: true,
          identityVerified: true,
        },
      };
    }
    case "customerContextLoaded": {
      const data = event.data || {};
      return {
        ...current,
        verification: data.verification
          ? {
              phone: data.verification.phone || current.verification?.phone || "",
              method: data.verification.method === "lookup" ? "lookup" : "sms",
              status: "verified",
              smsSent: current.verification?.smsSent ?? true,
              sentAt: current.verification?.sentAt,
              verifiedAt: data.verification.verifiedAt || current.verification?.verifiedAt || timestamp,
            }
          : current.verification,
        customer: data.customer || current.customer,
        completedStages: {
          ...current.completedStages,
          identityVerificationSent: true,
          identityVerified: true,
          customerLoaded: true,
          historyFetched: true,
        },
      };
    }
    case "inventoryUpdated": {
      const data = event.data || {};
      return {
        ...current,
        inventory: Array.isArray(data.items) && data.items.length > 0 ? data.items : current.inventory,
        completedStages: { ...current.completedStages, inventoryChecked: true },
      };
    }
    case "recommendationCreated": {
      const data = event.data || {};
      return {
        ...current,
        recommendation: data.recommendation || current.recommendation,
        recommendationRationale: data.rationale || current.recommendationRationale,
        completedStages: { ...current.completedStages, recommendationCreated: true },
      };
    }
    case "reservationCreated": {
      return {
        ...current,
        reservation: event.data || current.reservation,
        completedStages: { ...current.completedStages, reservationCreated: true },
      };
    }
    case "associateHandoffCreated": {
      return {
        ...current,
        handoff: event.data || current.handoff,
        completedStages: { ...current.completedStages, handoffCreated: true },
      };
    }
    case "toolCallStarted": {
      const toolName = String(event.toolName || "tool");
      if (toolName === "twilio_sms" || toolName === "twilio_sms_caller_summary") return current;
      const toolEvent: RetailToolEvent = {
        id: `${toolName}-${timestamp}`,
        toolName,
        status: "running",
        args: event.args,
        timestamp,
      };
      return {
        ...current,
        toolEvents: [toolEvent, ...current.toolEvents].slice(0, 12),
      };
    }
    case "toolCallCompleted": {
      const toolName = String(event.toolName || "tool");
      if (toolName === "twilio_sms" || toolName === "twilio_sms_caller_summary") return current;
      let updatedMostRecentRunning = false;
      const updated = current.toolEvents.map((item) => {
        if (!updatedMostRecentRunning && item.toolName === toolName && item.status === "running") {
          updatedMostRecentRunning = true;
          return {
            ...item,
            status: event.success ? "done" as const : "error" as const,
            result: getTimelineEventDetail({
              ...item,
              status: event.success ? "done" as const : "error" as const,
              result: event.result || event.error,
              data: event.data,
              durationMs: event.durationMs,
              timestamp,
            }),
            data: event.data,
            durationMs: event.durationMs,
            timestamp,
          };
        }
        return item;
      });
      return {
        ...current,
        toolEvents: updatedMostRecentRunning
          ? updated
          : [
              {
                id: `${toolName}-${timestamp}`,
                toolName,
                status: event.success ? "done" as const : "error" as const,
                result: getTimelineEventDetail({
                  id: `${toolName}-${timestamp}`,
                  toolName,
                  status: event.success ? "done" as const : "error" as const,
                  result: event.result || event.error,
                  data: event.data,
                  durationMs: event.durationMs,
                  timestamp,
                }),
                data: event.data,
                durationMs: event.durationMs,
                timestamp,
              },
              ...current.toolEvents,
            ].slice(0, 12),
      };
    }
    default:
      return current;
  }
}

export function getRetailAssistEventTypeForTool(toolName: string): string | null {
  switch (toolName) {
    case "retail_confirm_profile":
      return "identityVerified";
    case "retail_get_customer_context":
      return "customerContextLoaded";
    case "retail_lookup_inventory":
      return "inventoryUpdated";
    case "retail_recommend_gift_accessory":
      return "recommendationCreated";
    case "retail_reserve_item":
      return "reservationCreated";
    default:
      return null;
  }
}

export function isRetailCustomerConfirmed(state: RetailAssistState): boolean {
  return state.completedStages.identityVerified || state.completedStages.customerLoaded;
}

export function RetailInlineAssist({ state }: { state: RetailAssistState }) {
  const customerConfirmed = isRetailCustomerConfirmed(state);
  const customerLoaded = state.completedStages.customerLoaded;
  const latestTool = state.toolEvents.find((event) => event.status === "running") || state.toolEvents[0];

  if (!customerConfirmed && !latestTool && !state.verification) return null;

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-3xl rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4 text-left shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Agent Assist</p>
              <p className="text-xs text-muted-foreground">
                {customerLoaded
                  ? `${state.customer.name} context loaded`
                  : customerConfirmed
                    ? `Customer context loaded for ${state.verification?.phone || "phone on file"}`
                    : state.verification?.status === "sent"
                      ? `SMS verification sent to ${state.verification.phone}`
                      : "Waiting for customer identity"}
              </p>
            </div>
          </div>
          {latestTool && (
            <Badge variant="outline" className="border-white/10 bg-white/[0.04] text-muted-foreground">
              {formatToolName(latestTool.toolName)}
            </Badge>
          )}
        </div>

        {!customerLoaded ? (
          <div className="mt-3 space-y-3">
            {state.verification ? (
              <VerificationAssistCard state={state} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Customer history and inventory will appear here after the agent confirms who is calling.
              </p>
            )}
            {customerConfirmed && (
              <p className="text-xs text-muted-foreground">
                Customer context is loaded. Previous call history will appear after the customer context tool completes.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <VerificationAssistCard state={state} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-background/35 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" />
                  Customer
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{state.customer.name}</span>
                  <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-200">{state.customer.loyaltyTier}</Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{state.customer.intent}</p>
              </div>

              <div className="rounded-lg border border-white/10 bg-background/35 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  Chat history
                </div>
                <div className="space-y-2">
                  {state.customer.pastChats.slice(0, 2).map((chat) => (
                    <p key={`${chat.date}-${chat.date}`} className="text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground/80">{chat.date}</span> · {chat.summary}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            {state.completedStages.inventoryChecked && (
              <div className="rounded-lg border border-white/10 bg-background/35 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Boxes className="h-3.5 w-3.5" />
                  Inventory
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {state.inventory.slice(0, 4).map((item) => (
                    <div key={`${item.sku}-${item.store}`} className="rounded-md border border-white/10 bg-white/[0.03] p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{item.name}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {item.store} · {item.quantity} units · {item.price}
                          </p>
                        </div>
                        <StatusBadge status={item.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(state.completedStages.recommendationCreated || state.completedStages.reservationCreated || state.completedStages.handoffCreated) && (
              <div className="grid gap-3 md:grid-cols-2">
                {state.completedStages.reservationCreated && state.reservation && (
                  <div className="rounded-lg border border-green-400/20 bg-green-400/10 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-green-200">
                      <PackageCheck className="h-3.5 w-3.5" />
                      Reservation
                    </div>
                    <p className="mt-2 text-sm font-medium">{state.reservation.item.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {state.reservation.store} · {state.reservation.pickupTime}
                    </p>
                  </div>
                )}

                {state.completedStages.recommendationCreated && state.recommendation && (
                  <div className="rounded-lg border border-purple-400/20 bg-purple-400/10 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-purple-200">
                      <Sparkles className="h-3.5 w-3.5" />
                      Personalized add-on
                    </div>
                    <p className="mt-2 text-sm font-medium">{state.recommendation.name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{state.recommendationRationale}</p>
                  </div>
                )}
              </div>
            )}

            {state.completedStages.handoffCreated && state.handoff && (
              <div className="rounded-lg border border-white/10 bg-background/35 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Send className="h-3.5 w-3.5" />
                  Associate handoff
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{state.handoff.associateMessage}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VerificationAssistCard({ state }: { state: RetailAssistState }) {
  const verification = state.verification;
  if (!verification) return null;

  const verified = verification.status === "verified" || state.completedStages.identityVerified;
  const lookupLoaded = verification.method === "lookup";
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        verified
          ? "border-green-400/20 bg-green-400/10"
          : "border-cyan-400/20 bg-cyan-400/10"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
            verified
              ? "border-green-400/30 bg-green-400/10 text-green-200"
              : "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
          )}
        >
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">
              {lookupLoaded ? "Customer context loaded" : verified ? "Customer verified" : "SMS verification sent"}
            </p>
            <Badge
              className={cn(
                verified
                  ? "border-green-400/20 bg-green-400/10 text-green-200"
                  : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"
              )}
            >
              {verification.method.toUpperCase()}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {verified
              ? lookupLoaded
                ? `Loaded customer profile and history for ${verification.phone}.`
                : `Verified with phone number ${verification.phone}. Customer memory can now be used.`
              : `Code sent to ${verification.phone}. Waiting for the customer to read back the SMS code.`}
          </p>
        </div>
      </div>
    </div>
  );
}

interface ThinkingAccordionState {
  header: string;
  summary: string;
  lines: ThinkingLine[];
}

interface ThinkingAccordionSection extends ThinkingAccordionState {
  id: string;
  status: ThinkingLine["status"];
  active: boolean;
  icon: ReactNode;
  tone: "cyan" | "blue" | "green" | "purple" | "amber" | "red" | "slate";
}

interface ThinkingLine {
  id: string;
  text: string;
  detail?: string;
  status: "active" | "complete" | "waiting" | "error";
}

const THINKING_STATUS_LABELS = [
  "Thinking...",
  "Looking up context...",
  "Searching availability...",
  "Checking options...",
  "Reasoning through next steps...",
  "Preparing response...",
];

export function RetailProgressTimeline({ className, state }: { className?: string; state: RetailAssistState }) {
  const events = [...state.toolEvents].reverse();
  const [openSectionId, setOpenSectionId] = useState<string>("");
  const [statusIndex, setStatusIndex] = useState(0);
  const runningCount = events.filter((e) => e.status === "running").length;
  const isThinking = runningCount > 0;
  const sections = getThinkingAccordionSections(state, events, isThinking, statusIndex);
  const latestSection = sections[sections.length - 1];

  useEffect(() => {
    if (latestSection) setOpenSectionId(latestSection.id);
  }, [latestSection?.id]);

  useEffect(() => {
    if (!isThinking) {
      setStatusIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setStatusIndex((current) => (current + 1) % THINKING_STATUS_LABELS.length);
    }, 1400);
    return () => window.clearInterval(interval);
  }, [isThinking]);

  if (!hasThinkingActivity(state)) return null;

  return (
    <div className={cn("retail-progress-timeline space-y-3", className)}>
      {sections.map((section) => (
        <ThinkingAccordionBox
          key={section.id}
          section={section}
          isOpen={openSectionId === section.id}
          onOpenChange={(open) => setOpenSectionId(open ? section.id : "")}
        />
      ))}
    </div>
  );
}

function ThinkingAccordionBox({
  section,
  isOpen,
  onOpenChange,
}: {
  section: ThinkingAccordionSection;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Collapsible
      open={isOpen}
      onOpenChange={onOpenChange}
      className={cn(
        "retail-thinking-box overflow-hidden rounded-xl border bg-card/50",
        isOpen ? "border-white/15" : "border-white/10"
      )}
    >
      <CollapsibleTrigger className="retail-thinking-trigger flex w-full items-center justify-between gap-3 p-3 text-sm transition-colors hover:bg-white/[0.02]">
        <div className="flex min-w-0 items-center gap-3 text-left">
          <span
            className={cn(
              "retail-thinking-icon relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
              getThinkingIconToneClassName(section.tone, section.active)
            )}
          >
            {section.active && <span className={cn("absolute inset-0 rounded-full animate-ping", getThinkingPingClassName(section.tone))} />}
            <span className="relative">{section.icon}</span>
          </span>
          <span className={cn("retail-thinking-title min-w-0 truncate font-medium", section.active ? "text-primary" : "text-foreground")}>
            {section.header}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
          <span className="hidden text-xs sm:inline">{isOpen ? "Hide" : "Show"}</span>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="retail-thinking-content border-t border-white/10 bg-black/20 p-4">
          <div className="retail-thinking-summary rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-sm leading-relaxed text-foreground/90">{section.summary}</p>
            <div className="mt-3 space-y-2">
              {section.lines.map((line) => (
                <ThinkingLineItem key={line.id} line={line} />
              ))}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ThinkingLineItem({ line }: { line: ThinkingLine }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md px-1 py-1">
      <span
        className={cn(
          "retail-thinking-dot mt-1.5 h-2 w-2 shrink-0 rounded-full",
          line.status === "active" && "animate-pulse bg-primary",
          line.status === "complete" && "bg-cyan-300/75",
          line.status === "error" && "bg-red-400",
          line.status === "waiting" && "bg-muted-foreground/45"
        )}
      />
      <div className="min-w-0">
        <p className="text-sm leading-snug text-foreground/90">{line.text}</p>
        {line.detail && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{line.detail}</p>}
      </div>
    </div>
  );
}

function getThinkingAccordionSections(
  state: RetailAssistState,
  events: RetailToolEvent[],
  isThinking: boolean,
  statusIndex: number
): ThinkingAccordionSection[] {
  if (events.length === 0) {
    return [toThinkingSection("fallback", getFallbackWorkState(state), false, "active")];
  }

  return events.map((event, index) => {
    const isLatest = index === events.length - 1;
    const section = getCurrentWorkState(state, event);
    const active = event.status === "running";
    return {
      ...section,
      id: event.id,
      header: active && isLatest ? getActiveThinkingHeader(section.header, statusIndex) : section.header,
      status: getThinkingStatus(event.status),
      active,
      icon: getThinkingSectionIcon(section.header, getThinkingStatus(event.status), active),
      tone: getThinkingSectionTone(section.header, getThinkingStatus(event.status)),
    };
  });
}

function toThinkingSection(
  id: string,
  state: ThinkingAccordionState,
  active: boolean,
  status: ThinkingLine["status"]
): ThinkingAccordionSection {
  return {
    ...state,
    id,
    active,
    status,
    icon: getThinkingSectionIcon(state.header, status, active),
    tone: getThinkingSectionTone(state.header, status),
  };
}

function getThinkingSectionIcon(header: string, status: ThinkingLine["status"], active: boolean): ReactNode {
  const normalized = header.toLowerCase();
  const className = cn("h-4 w-4", active && "animate-pulse");

  if (status === "error") return <ShieldCheck className={className} />;
  if (normalized.includes("confirm")) return <IdCard className={className} />;
  if (normalized.includes("history")) return <History className={className} />;
  if (normalized.includes("context") || normalized.includes("profile") || normalized.includes("user")) return <UserRound className={className} />;
  if (normalized.includes("product") || normalized.includes("catalog") || normalized.includes("inventory") || normalized.includes("search")) return <Search className={className} />;
  if (normalized.includes("reservation") || normalized.includes("reserving")) return <PackageCheck className={className} />;
  if (normalized.includes("add-on") || normalized.includes("addon")) return <Gift className={className} />;
  if (normalized.includes("confirmation")) return <ClipboardCheck className={className} />;
  if (normalized.includes("handoff") || normalized.includes("store")) return <Store className={className} />;
  if (normalized.includes("wrap")) return <Send className={className} />;
  return active ? <Activity className={className} /> : <BrainCircuit className={className} />;
}

function getThinkingSectionTone(header: string, status: ThinkingLine["status"]): ThinkingAccordionSection["tone"] {
  const normalized = header.toLowerCase();
  if (status === "error") return "red";
  if (normalized.includes("confirm")) return "amber";
  if (normalized.includes("history") || normalized.includes("context") || normalized.includes("profile") || normalized.includes("user")) return "cyan";
  if (normalized.includes("product") || normalized.includes("catalog") || normalized.includes("inventory") || normalized.includes("search")) return "blue";
  if (normalized.includes("reservation") || normalized.includes("reserving") || normalized.includes("confirmation")) return "green";
  if (normalized.includes("add-on") || normalized.includes("addon")) return "purple";
  if (normalized.includes("handoff") || normalized.includes("store") || normalized.includes("wrap")) return "slate";
  return "cyan";
}

function getThinkingIconToneClassName(tone: ThinkingAccordionSection["tone"], active: boolean): string {
  if (tone === "cyan") return active ? "border-cyan-300/35 bg-cyan-400/10 text-cyan-200" : "border-cyan-300/20 bg-cyan-400/[0.06] text-cyan-200/80";
  if (tone === "blue") return active ? "border-blue-300/35 bg-blue-400/10 text-blue-200" : "border-blue-300/20 bg-blue-400/[0.06] text-blue-200/80";
  if (tone === "green") return active ? "border-green-300/35 bg-green-400/10 text-green-200" : "border-green-300/20 bg-green-400/[0.06] text-green-200/80";
  if (tone === "purple") return active ? "border-purple-300/35 bg-purple-400/10 text-purple-200" : "border-purple-300/20 bg-purple-400/[0.06] text-purple-200/80";
  if (tone === "amber") return active ? "border-amber-300/35 bg-amber-400/10 text-amber-200" : "border-amber-300/20 bg-amber-400/[0.06] text-amber-200/80";
  if (tone === "red") return active ? "border-red-300/35 bg-red-400/10 text-red-200" : "border-red-300/20 bg-red-400/[0.06] text-red-200/80";
  return active ? "border-white/20 bg-white/[0.06] text-foreground" : "border-white/10 bg-white/[0.03] text-muted-foreground";
}

function getThinkingPingClassName(tone: ThinkingAccordionSection["tone"]): string {
  if (tone === "cyan") return "bg-cyan-300/15";
  if (tone === "blue") return "bg-blue-300/15";
  if (tone === "green") return "bg-green-300/15";
  if (tone === "purple") return "bg-purple-300/15";
  if (tone === "amber") return "bg-amber-300/15";
  if (tone === "red") return "bg-red-300/15";
  return "bg-white/10";
}

function hasThinkingActivity(state: RetailAssistState): boolean {
  return (
    state.toolEvents.length > 0 ||
    Boolean(state.verification) ||
    Object.values(state.completedStages).some(Boolean)
  );
}

function getUnderstoodSignals(state: RetailAssistState): string[] {
  const signals: string[] = [];

  if (state.completedStages.identityVerified || state.completedStages.customerLoaded) {
    signals.push(`${state.customer.name} is the verified customer.`);
  } else if (state.verification?.status === "sent") {
    signals.push(`SMS verification is pending for ${state.verification.phone}.`);
  } else {
    signals.push("Customer identity still needs to be confirmed.");
  }

  if (state.completedStages.customerLoaded) {
    signals.push(state.customer.intent);
  } else {
    signals.push("Profile and history will load after verification.");
  }

  if (state.completedStages.historyFetched && state.customer.pastChats[0]) {
    signals.push(`Recent history: ${state.customer.pastChats[0].summary}`);
  }

  return signals.slice(0, 3);
}

function getReadySignals(state: RetailAssistState): string[] {
  const ready: string[] = [];

  if (state.completedStages.customerLoaded) {
    ready.push("Customer profile and conversation memory can guide the response.");
  }

  if (state.completedStages.inventoryChecked) {
    const bestItem = state.inventory.find((item) => item.status === "in_stock") || state.inventory[0];
    if (bestItem) ready.push(`${bestItem.store} has ${bestItem.quantity} matching unit${bestItem.quantity === 1 ? "" : "s"}.`);
  }

  if (state.completedStages.reservationCreated && state.reservation) {
    ready.push(`${state.reservation.item.name} is reserved for ${state.reservation.pickupTime}.`);
  }

  if (state.completedStages.recommendationCreated && state.recommendation) {
    ready.push(`${state.recommendation.name} is the recommended add-on.`);
  }

  if (state.completedStages.handoffCreated && state.handoff) {
    ready.push("Associate handoff is ready for the store team.");
  }

  return ready.length > 0 ? ready.slice(-3) : ["No customer-facing action is ready yet."];
}

function getCurrentWorkState(state: RetailAssistState, event?: RetailToolEvent): ThinkingAccordionState {
  if (!event) {
    return getFallbackWorkState(state);
  }

  const data = (event.data || {}) as any;
  const args = (event.args || {}) as any;
  const running = event.status === "running";
  const status = getThinkingStatus(event.status);
  const candidateName = data.customer?.name || data.customerName || data.preferredName || data.maskedFullName || "";
  const customerFirstName = getFirstName(candidateName);
  const verifiedCustomerName = data.customer?.name || data.customerName || "";
  const phone = args.phone || data.phone || state.verification?.phone || state.customer.phone;

  if (event.toolName === "retail_profile_lookup") {
    const possibleMatchText = customerFirstName === "the customer"
      ? "a returning customer"
      : customerFirstName;
    return {
      header: running ? "Looking up user" : "Confirming user",
      summary: `Looking up phone number ${phone}. I see the caller could be ${possibleMatchText}, so I need a quick confirmation before using customer details.`,
      lines: [
        { id: "lookup-phone", text: `Checking customer records for ${phone}.`, status },
        { id: "lookup-match", text: `Possible match found: ${possibleMatchText}.`, status },
        { id: "lookup-confirm", text: "Preparing to ask for last-name confirmation.", status: running ? "waiting" : "active" },
      ],
    };
  }

  if (event.toolName === "retail_confirm_profile") {
    const verified = data.verified === true;
    return {
      header: running ? "Confirming profile" : verified ? "Profile confirmed" : "Confirmation needed",
      summary: verified
        ? `The last name matches ${verifiedCustomerName || "the profile candidate"}. The assistant can now load history and continue naturally.`
        : "The last name did not match, so the assistant should not use customer-specific details yet.",
      lines: [
        { id: "confirm-last-name", text: "Checking the provided last name against the profile candidate.", status },
        {
          id: "confirm-result",
          text: verified ? "Identity confirmed; customer history can be loaded next." : "Identity is still unconfirmed.",
          status: verified ? "complete" : "error",
        },
      ],
    };
  }

  if (event.toolName === "retail_user_lookup") {
    return {
      header: running ? "Looking up user" : "User lookup ready",
      summary: `Looking up phone number ${phone} and preparing to confirm identity before using customer details.`,
      lines: [
        { id: "lookup-phone", text: `Checking customer records for ${phone}.`, status },
        { id: "lookup-confirm", text: "Preparing to confirm the caller before using profile details.", status },
      ],
    };
  }

  if (event.toolName === "retail_user_history_lookup") {
    return {
      header: "Looking up history",
      summary: `Searching ${customerFirstName}'s previous interactions so the assistant can use relevant context naturally and avoid making the caller repeat details.`,
      lines: [
        { id: "history-calls", text: "Searching previous call history.", status },
        { id: "history-orders", text: "Looking at previous order history.", status },
        { id: "history-profile", text: "Reviewing saved profile preferences.", status },
      ],
    };
  }

  if (event.toolName === "retail_get_customer_context") {
    return {
      header: running ? "Loading customer context" : "Customer context ready",
      summary: `Combining ${customerFirstName}'s profile, prior conversations, and shopping preferences before the assistant uses customer context.`,
      lines: [
        { id: "context-profile", text: "Reading customer profile.", status },
        { id: "context-preferences", text: "Checking saved preferences and relationship context.", status },
        { id: "context-greeting", text: `Preparing a simple welcome for ${customerFirstName}.`, status: running ? "waiting" : "complete" },
      ],
    };
  }

  if (event.toolName === "retail_search_products") {
    const query = args.query || args.product || data.query || "the requested product";
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const topMatch = data.topMatch || matches[0];
    return {
      header: running ? "Searching products" : matches.length > 0 ? "Product matches found" : "Product search complete",
      summary: `Searching the catalog for ${query} before checking availability or suggesting alternatives.`,
      lines: [
        { id: "product-query", text: `Searching product catalog for "${query}".`, status },
        {
          id: "product-match",
          text: topMatch?.name
            ? `Best match: ${topMatch.name}.`
            : "No exact product match found yet.",
          status,
        },
        { id: "product-next", text: "Next step is checking inventory and proposing the pickup store.", status: running ? "waiting" : "complete" },
      ],
    };
  }

  if (event.toolName === "retail_lookup_inventory") {
    const available = Array.isArray(data.available) ? data.available[0] : undefined;
    const product = args.product || data.product || available?.name || "the requested product";
    const store = args.preferredStore || available?.store || "the requested store";
    return {
      header: running ? "Searching inventory" : "Inventory found",
      summary: `Searching catalog for ${product}, narrowing to the right model, and checking pickup availability at ${store}.`,
      lines: [
        { id: "inventory-catalog", text: `Searching catalog for "${product}".`, status },
        { id: "inventory-narrow", text: "Narrowing results to the requested model and configuration.", status },
        {
          id: "inventory-store",
          text: available?.store
            ? `${available.name || product} is available at ${available.store}.`
            : `Checking stock at ${store}.`,
          status,
        },
      ],
    };
  }

  if (event.toolName === "retail_reserve_item") {
    const product = data.item?.name || args.product || data.product || state.reservation?.item.name || "the selected item";
    const store = data.store || args.store || state.reservation?.store || "the selected store";
    const pickup = data.pickupTime || args.pickupTime || state.reservation?.pickupTime || "the requested pickup time";
    return {
      header: running ? "Reserving item" : "Reservation ready",
      summary: `Holding ${product} at ${store} for ${pickup}, then preparing the confirmation the assistant should say back to the customer.`,
      lines: [
        { id: "reserve-item", text: `Reserving ${product}.`, status },
        { id: "reserve-store", text: `Using ${store} as the pickup location.`, status },
        { id: "reserve-time", text: `Confirming pickup for ${pickup}.`, status },
      ],
    };
  }

  if (event.toolName === "retail_recommend_gift_accessory") {
    const recommendation = data.recommendation?.name || "A compatible add-on";
    const product = args.product || data.product || state.reservation?.item.name || "the reserved item";
    return {
      header: running ? "Checking add-ons" : "Add-on suggestion ready",
      summary: `Checking whether there is a relevant accessory for ${product} without turning the call into a broad upsell.`,
      lines: [
        { id: "addon-product", text: `Matching accessories to ${product}.`, status },
        { id: "addon-history", text: "Using prior conversation context only if it is relevant.", status },
        { id: "addon-result", text: `${recommendation} is the suggested add-on.`, status },
      ],
    };
  }

  if (event.toolName === "retail_order_confirmation") {
    return {
      header: running ? "Preparing confirmation" : "Confirmation ready",
      summary: "Preparing the customer-facing reservation summary.",
      lines: [
        { id: "confirm-item", text: "Checking the item, pickup store, and pickup time.", status },
        { id: "confirm-wording", text: "Keeping the confirmation concise.", status },
      ],
    };
  }

  if (event.toolName === "retail_store_manager_summary") {
    return {
      header: running ? "Preparing handoff" : "Store handoff ready",
      summary: "Packaging the reservation and customer context for the store team.",
      lines: [
        { id: "handoff-customer", text: "Including the customer and reservation details.", status },
        { id: "handoff-associate", text: "Adding the short associate note.", status },
      ],
    };
  }

  if (event.toolName === "voice_end_call") {
    return {
      header: running ? "Closing call" : "Closing complete",
      summary: running
        ? "The assistant is sending the final closing before hangup."
        : "The assistant has completed the closing step.",
      lines: [{ id: "wrap-call", text: "Brief closing and hangup are queued.", status }],
    };
  }

  if (event.status === "error") {
    return {
      header: "Needs attention",
      summary: event.result || "The assistant could not complete one background step.",
      lines: [{ id: "error-step", text: "A background step failed.", status: "error" }],
    };
  }

  return getFallbackWorkState(state);
}

function getFallbackWorkState(state: RetailAssistState): ThinkingAccordionState {
  if (state.completedStages.handoffCreated) {
    return {
      header: "Store handoff ready",
      summary: "The assistant has packaged the reservation and recommendation for the store team.",
      lines: [
        { id: "fallback-handoff", text: state.handoff?.associateMessage || "Associate handoff is ready.", status: "complete" },
      ],
    };
  }
  if (state.completedStages.reservationCreated && state.reservation) {
    return {
      header: "Reservation ready",
      summary: `The assistant is ready to confirm ${state.reservation.item.name} at ${state.reservation.store}.`,
      lines: getReadySignals(state).map((signal, index) => ({ id: `ready-${index}`, text: signal, status: "complete" })),
    };
  }
  if (state.completedStages.inventoryChecked) {
    return {
      header: "Inventory found",
      summary: "The assistant has checked the requested product and pickup options.",
      lines: [
        { id: "fallback-inventory", text: "Nearby availability is ready to use in the response.", status: "complete" },
      ],
    };
  }
  if (state.completedStages.customerLoaded) {
    return {
      header: "Customer context ready",
      summary: "The assistant has enough profile and history context to greet the customer.",
      lines: getUnderstoodSignals(state).map((signal, index) => ({ id: `understood-${index}`, text: signal, status: "complete" })),
    };
  }
  return {
    header: "Looking up user",
    summary: "Looking up the caller before using customer-specific context.",
    lines: [
      { id: "fallback-lookup", text: `Checking customer records for ${state.customer.phone}.`, status: "active" },
    ],
  };
}

function getActiveThinkingHeader(baseHeader: string, statusIndex: number): string {
  if (statusIndex === 0) return baseHeader;
  return THINKING_STATUS_LABELS[statusIndex];
}

function getThinkingStatus(status: RetailToolEvent["status"]): ThinkingLine["status"] {
  if (status === "running") return "active";
  if (status === "error") return "error";
  if (status === "done") return "complete";
  return "waiting";
}

function getFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "the customer";
}

export function RetailCustomerMemory({ state, compact = false }: { state: RetailAssistState; compact?: boolean }) {
  const { customer } = state;

  return (
    <Card className="border-white/10 bg-card/50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
          <UserRound className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{customer.name}</h2>
            <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-200">{customer.loyaltyTier}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{customer.intent}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm">
        <AssistFact icon={<Phone className="h-4 w-4" />} label="Caller" value={customer.phone} />
        <AssistFact icon={<Clock3 className="h-4 w-4" />} label="Pickup" value={customer.preferredPickupTime} />
      </div>

      {!compact && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" />
            Past chats
          </div>
          <div className="space-y-2">
            {customer.pastChats.map((chat) => (
              <div key={`${chat.date}-${chat.date}`} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">{chat.date}</span>
                  <span className="text-muted-foreground">{chat.date}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{chat.summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function RetailInventoryPanel({ state, compact = false }: { state: RetailAssistState; compact?: boolean }) {
  const visibleInventory = compact ? state.inventory.slice(0, 3) : state.inventory;

  return (
    <Card className="border-white/10 bg-card/50 p-4">
      <PanelHeader
        icon={<Boxes className="h-4 w-4" />}
        title="Inventory Intelligence"
        subtitle="Local stock, nearby fulfillment, and personalized add-ons"
      />
      <div className="mt-4 space-y-2">
        {visibleInventory.map((item) => (
          <div key={`${item.sku}-${item.store}`} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {item.store}
                  </span>
                  <span>{item.price}</span>
                  <span>{item.quantity} units</span>
                </div>
              </div>
              <StatusBadge status={item.status} />
            </div>
            {!compact && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.note}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function RetailDecisionTrace({ state, mode = "full" }: { state: RetailAssistState; mode?: "full" | "compact" }) {
  const steps = RETAIL_STORE_ASSISTANT_USE_CASE.decisionTrace;
  const completedSteps = [
    state.completedStages.customerLoaded,
    state.completedStages.inventoryChecked,
    state.completedStages.inventoryChecked,
    state.completedStages.recommendationCreated,
    state.completedStages.handoffCreated,
  ];

  return (
    <Card className="border-white/10 bg-card/50 p-4">
      <PanelHeader
        icon={<BrainCircuit className="h-4 w-4" />}
        title="Decision Trace"
        subtitle="Observable business reasoning, not hidden chain-of-thought"
      />
      <div className="mt-4 space-y-3">
        {steps.map((step, index) => {
          const done = completedSteps[index];
          const active = !done && completedSteps.slice(0, index).every(Boolean);
          return (
            <div key={step.title} className="flex gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  done && "border-green-400/30 bg-green-400/10 text-green-300",
                  active && "border-primary/30 bg-primary/10 text-primary",
                  !done && !active && "border-white/10 bg-white/[0.03] text-muted-foreground"
                )}
              >
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                {mode === "full" && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function RetailActionPanel({ state }: { state: RetailAssistState }) {
  const reservation = state.reservation;
  const handoff = state.handoff || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook;

  return (
    <Card className="border-white/10 bg-card/50 p-4">
      <PanelHeader
        icon={<PackageCheck className="h-4 w-4" />}
        title="Next Best Action"
        subtitle="Reserve, personalize, and prep the associate"
      />

      <div className="mt-4 space-y-3">
        <div className="rounded-md border border-green-400/20 bg-green-400/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-green-200">
              {reservation ? "Reservation confirmed" : "Reservation target"}
            </p>
            <Badge className="border-green-400/20 bg-green-400/10 text-green-200">
              {reservation?.status || "Ready"}
            </Badge>
          </div>
          <p className="mt-2 text-sm">
            {reservation?.item?.name || handoff.reservedItem}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {reservation?.store || handoff.reservedStore} at {reservation?.pickupTime || handoff.pickupTime}
          </p>
        </div>

        <div className="rounded-md border border-purple-400/20 bg-purple-400/10 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-purple-200">
            <Sparkles className="h-4 w-4" />
            Personalized add-on
          </div>
          <p className="mt-2 text-sm">{state.recommendation?.name || handoff.recommendedUpsell}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{state.recommendationRationale}</p>
        </div>
      </div>
    </Card>
  );
}

export function RetailAssociatePlaybook({ state }: { state: RetailAssistState }) {
  const playbook = state.handoff || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook;

  return (
    <Card className="border-white/10 bg-card/50 p-4">
      <PanelHeader
        icon={<Send className="h-4 w-4" />}
        title="Associate Playbook"
        subtitle="What the store team receives after the call"
      />
      <div className="mt-4 space-y-2 text-sm">
        <AssistFact icon={<UserRound className="h-4 w-4" />} label="Customer" value={playbook.customerName} />
        <AssistFact icon={<PackageCheck className="h-4 w-4" />} label="Reserved item" value={playbook.reservedItem} />
        <AssistFact icon={<Clock3 className="h-4 w-4" />} label="Pickup" value={playbook.pickupTime} />
        <AssistFact icon={<Sparkles className="h-4 w-4" />} label="Upsell" value={playbook.recommendedUpsell} />
      </div>
      <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-muted-foreground">
        {playbook.associateMessage}
      </div>
    </Card>
  );
}

export function RetailToolTimeline({ state }: { state: RetailAssistState }) {
  const events = state.toolEvents.length > 0
    ? state.toolEvents
    : RETAIL_STORE_ASSISTANT_USE_CASE.recommendedTools.slice(0, 4).map((tool, index) => ({
        id: tool.name,
        toolName: tool.name,
        status: "ready" as const,
        result: tool.description,
        timestamp: Date.now() - index * 1000,
      }));

  return (
    <Card className="border-white/10 bg-card/50 p-4">
      <PanelHeader
        icon={<Radio className="h-4 w-4" />}
        title="Live Actions"
        subtitle="Tool activity visible to the demo operator"
      />
      <div className="mt-4 space-y-2">
        {events.map((event) => (
          <div key={event.id} className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <span
              className={cn(
                "mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full",
                event.status === "running" && "bg-primary animate-pulse",
                event.status === "done" && "bg-green-400",
                event.status === "error" && "bg-red-400",
                event.status === "ready" && "bg-muted-foreground/40"
              )}
            />
            <div className="min-w-0">
              <p className="text-xs font-medium">{formatToolName(event.toolName)}</p>
              {event.result && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{event.result}</p>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function RetailAssistHero({ state, liveLabel }: { state: RetailAssistState; liveLabel: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-gradient-to-r from-cyan-500/10 via-blue-500/5 to-purple-500/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <p className="text-xs font-medium uppercase tracking-wide text-primary">{liveLabel}</p>
          </div>
          <h2 className="mt-2 text-lg font-semibold">Continuity-driven retail agent assist</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            The caller gets remembered context, cross-store inventory, reservation help, summary SMS consent, and an associate-ready playbook.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {RETAIL_STORE_ASSISTANT_USE_CASE.capabilityChips.slice(0, 4).map((chip) => (
            <Badge key={chip} variant="outline" className="border-white/10 bg-white/[0.04] text-muted-foreground">
              {chip}
            </Badge>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Metric label="Customer" value={state.customer.name} />
        <Metric label="Availability" value="Palo Alto: 3 units" />
        <Metric label="Pickup target" value={state.reservation?.pickupTime || state.customer.preferredPickupTime} />
      </div>
    </div>
  );
}

function PanelHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function AssistFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] p-2.5">
      <div className="text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-background/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: RetailInventoryItem["status"] }) {
  const className =
    status === "in_stock"
      ? "border-green-400/20 bg-green-400/10 text-green-200"
      : status === "low_stock"
        ? "border-yellow-400/20 bg-yellow-400/10 text-yellow-200"
        : "border-red-400/20 bg-red-400/10 text-red-200";

  return <Badge className={className}>{getRetailInventoryStatusLabel(status)}</Badge>;
}

function formatToolName(name: string): string {
  return name
    .replace(/^retail_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getTimelineEventDetail(event: RetailToolEvent): string {
  const data = (event.data || {}) as any;
  const detailSuffix = formatDurationSuffix(event.durationMs);
  if (event.toolName === "retail_user_lookup") {
    if (event.status === "running") return "Looking up the returning customer profile.";
    if (event.status === "done") return `Customer profile loaded.${detailSuffix}`;
  }
  if (event.toolName === "retail_user_history_lookup") {
    if (event.status === "running") return "Checking previous conversations and order history.";
    if (event.status === "done") return `Previous conversations and order history loaded.${detailSuffix}`;
  }
  if (event.toolName === "retail_get_customer_context") {
    if (event.status === "running") return "Preparing customer context for the assistant.";
    if (event.status === "done") return `Customer context is ready.${detailSuffix}`;
  }
  if (event.toolName === "retail_lookup_inventory") {
    if (event.status === "running") return "Checking availability across stores.";
    if (event.status === "done") {
      const available = Array.isArray(data.available) ? data.available[0] : undefined;
      return available?.store
        ? `Inventory checked. ${available.name || "The item"} is available at ${available.store}.${detailSuffix}`
        : `Inventory checked across stores.${detailSuffix}`;
    }
  }
  if (event.toolName === "retail_reserve_item") {
    if (event.status === "running") return "Creating the pickup reservation.";
    if (event.status === "done") {
      const itemName = data.item?.name || data.product || "The item";
      const store = data.store ? ` at ${data.store}` : "";
      const pickup = data.pickupTime ? ` for ${data.pickupTime}` : "";
      const reference = data.reservationId ? ` Reference ${data.reservationId}.` : "";
      return `${itemName} reserved${store}${pickup}.${reference}${detailSuffix}`;
    }
  }
  if (event.toolName === "retail_recommend_gift_accessory") {
    if (event.status === "running") return "Finding a relevant add-on for the reserved item.";
    if (event.status === "done") {
      const recommendation = data.recommendation?.name || "A matching add-on";
      return `${recommendation} selected as a relevant add-on.${detailSuffix}`;
    }
  }
  if (event.toolName === "retail_order_confirmation") {
    if (event.status === "running") return "Preparing the customer confirmation.";
    if (event.status === "done") return `Customer confirmation handled.${detailSuffix}`;
  }
  if (event.toolName === "retail_store_manager_summary") {
    if (event.status === "running") return "Preparing the store manager handoff.";
    if (event.status === "done") return `Store manager handoff sent.${detailSuffix}`;
  }
  if (event.toolName === "voice_end_call") {
    if (event.status === "done") return `Call ended after the customer was finished.${detailSuffix}`;
  }
  if (event.status === "error" && event.result) return event.result;
  if (event.result) return event.result;
  if (event.status === "running") return "Step in progress.";
  if (event.status === "error") return "This step needs attention.";
  if (event.status === "done") return "Step completed.";
  return "Waiting.";
}

function formatDurationSuffix(durationMs: number | undefined): string {
  if (!Number.isFinite(durationMs)) return "";
  if ((durationMs as number) < 1000) return ` (${Math.max(0, Math.round(durationMs as number))}ms)`;
  return ` (${((durationMs as number) / 1000).toFixed(1)}s)`;
}
