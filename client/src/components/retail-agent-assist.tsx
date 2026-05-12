import {
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  History,
  MapPin,
  PackageCheck,
  Phone,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  timestamp: number;
}

export interface RetailAssistState {
  verification?: {
    phone: string;
    method: "sms";
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
    recommendation: RETAIL_STORE_ASSISTANT_USE_CASE.inventory.find((item) => item.sku === "CASE-PURPLE-11"),
    recommendationRationale: "Persistent memory: birthday gift for daughter plus purple accessory preference.",
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
              method: "sms",
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
      return {
        ...current,
        toolEvents: [
          { id: `${toolName}-${timestamp}`, toolName, status: "running", timestamp },
          ...current.toolEvents.filter((item) => item.toolName !== toolName).slice(0, 5),
        ],
      };
    }
    case "toolCallCompleted": {
      const toolName = String(event.toolName || "tool");
      const updated = current.toolEvents.map((item) =>
        item.toolName === toolName
          ? {
              ...item,
              status: event.success ? "done" as const : "error" as const,
              result: event.result || event.error,
              timestamp,
            }
          : item
      );
      const hasExisting = updated.some((item) => item.toolName === toolName);
      return {
        ...current,
        toolEvents: hasExisting
          ? updated
          : [
              {
                id: `${toolName}-${timestamp}`,
                toolName,
                status: event.success ? "done" as const : "error" as const,
                result: event.result || event.error,
                timestamp,
              },
              ...current.toolEvents,
            ].slice(0, 6),
      };
    }
    default:
      return current;
  }
}

export function getRetailAssistEventTypeForTool(toolName: string): string | null {
  switch (toolName) {
    case "retail_send_identity_verification":
      return "identityVerificationSent";
    case "retail_verify_identity_code":
      return "identityVerified";
    case "retail_get_customer_context":
      return "customerContextLoaded";
    case "retail_lookup_inventory":
      return "inventoryUpdated";
    case "retail_recommend_accessory":
      return "recommendationCreated";
    case "retail_reserve_item":
      return "reservationCreated";
    case "retail_create_associate_handoff":
      return "associateHandoffCreated";
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
                  ? `${state.customer.name} verified and context loaded`
                  : customerConfirmed
                    ? `Identity verified with ${state.verification?.phone || "phone on file"}`
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
                Identity is verified. Previous call history will appear after the customer context tool completes.
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
                    <p key={`${chat.date}-${chat.channel}`} className="text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground/80">{chat.channel}</span> · {chat.summary}
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
              {verified ? "Customer verified" : "SMS verification sent"}
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
              ? `Verified with phone number ${verification.phone}. Customer memory can now be used.`
              : `Code sent to ${verification.phone}. Waiting for the customer to read back the SMS code.`}
          </p>
        </div>
      </div>
    </div>
  );
}

export function RetailProgressTimeline({ state }: { state: RetailAssistState }) {
  const steps = [
    {
      label: "SMS verification sent",
      detail: state.verification?.phone
        ? `Code sent to ${state.verification.phone}`
        : "Send code to phone on file",
      done: state.completedStages.identityVerificationSent,
      active: Boolean(state.toolEvents.find((event) => event.toolName === "retail_send_identity_verification" && event.status === "running")),
    },
    {
      label: "User verified",
      detail: state.verification?.phone
        ? `Phone ${state.verification.phone} verified by SMS`
        : "Confirm SMS code",
      done: state.completedStages.identityVerified,
      active: state.completedStages.identityVerificationSent && !state.completedStages.identityVerified,
    },
    {
      label: "Previous call history fetched",
      detail: state.completedStages.historyFetched
        ? `${state.customer.pastChats.length} prior interactions loaded`
        : "Load customer memory after verification",
      done: state.completedStages.historyFetched,
      active: state.completedStages.identityVerified && !state.completedStages.historyFetched,
    },
    {
      label: "Inventory lookup complete",
      detail: state.completedStages.inventoryChecked
        ? `${state.inventory.length} inventory result${state.inventory.length === 1 ? "" : "s"} checked`
        : "Check local and nearby stock",
      done: state.completedStages.inventoryChecked,
      active: Boolean(state.toolEvents.find((event) => event.toolName === "retail_lookup_inventory" && event.status === "running")),
    },
    {
      label: "Recommendation ready",
      detail: state.completedStages.recommendationCreated
        ? state.recommendation?.name || "Personalized add-on selected"
        : "Use verified memory for next best action",
      done: state.completedStages.recommendationCreated,
      active: Boolean(state.toolEvents.find((event) => event.toolName === "retail_recommend_accessory" && event.status === "running")),
    },
    {
      label: "Reservation created",
      detail: state.completedStages.reservationCreated
        ? `${state.reservation?.store || "Store"} pickup ${state.reservation?.pickupTime || ""}`.trim()
        : "Reserve selected item",
      done: state.completedStages.reservationCreated,
      active: Boolean(state.toolEvents.find((event) => event.toolName === "retail_reserve_item" && event.status === "running")),
    },
    {
      label: "Associate handoff created",
      detail: state.completedStages.handoffCreated
        ? "Store team playbook prepared"
        : "Prepare associate context",
      done: state.completedStages.handoffCreated,
      active: Boolean(state.toolEvents.find((event) => event.toolName === "retail_create_associate_handoff" && event.status === "running")),
    },
  ];

  return (
    <Card className="border-white/10 bg-card/50 p-4">
      <PanelHeader
        icon={<CheckCircle2 className="h-4 w-4" />}
        title="Progress Timeline"
        subtitle="Customer verification and agent-assist milestones"
      />
      <div className="mt-4 space-y-0">
        {steps.map((step, index) => (
          <div key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
            {index < steps.length - 1 && (
              <span className="absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px bg-white/10" />
            )}
            <span
              className={cn(
                "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                step.done && "border-green-400/30 bg-green-400/10 text-green-200",
                !step.done && step.active && "border-primary/30 bg-primary/10 text-primary",
                !step.done && !step.active && "border-white/10 bg-white/[0.03] text-muted-foreground"
              )}
            >
              {step.done ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <span className={cn("h-2 w-2 rounded-full", step.active ? "animate-pulse bg-primary" : "bg-muted-foreground/50")} />
              )}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-sm font-medium", step.done && "text-green-100")}>{step.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
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
              <div key={`${chat.date}-${chat.channel}`} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">{chat.channel}</span>
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
            John gets remembered context, cross-store inventory, reservation help, summary SMS consent, and an associate-ready playbook.
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
