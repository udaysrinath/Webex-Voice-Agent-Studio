import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clipboard,
  Loader2,
  Mic,
  PhoneCall,
  Radio,
  Settings,
} from "lucide-react";
import { agentsApi, twilioApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  RetailProgressTimeline,
  createRetailAssistState,
  updateRetailAssistState,
} from "@/components/retail-agent-assist";

type MonitorState = "connecting" | "waiting" | "in-call" | "ended" | "error";

interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  text: string;
  correctedText?: string;
  timestamp: number;
}

interface TwilioMonitorMessage {
  type:
    | "connected"
    | "callStarted"
    | "callStateChanged"
    | "callEnded"
    | "smsSent"
    | "userTranscript"
    | "assistantTranscript"
    | "toolCallStarted"
    | "toolCallCompleted"
    | "identityVerificationSent"
    | "identityVerified"
    | "customerContextLoaded"
    | "inventoryUpdated"
    | "recommendationCreated"
    | "reservationCreated"
    | "associateHandoffCreated";
  text?: string;
  rawText?: string;
  correctedText?: string;
  corrected?: boolean;
  to?: string;
  callerPhone?: string;
  state?: "starting" | "active" | "waiting_for_tool" | "wrap_up" | "post_call" | "ended";
  previousState?: "starting" | "active" | "waiting_for_tool" | "wrap_up" | "post_call" | "ended";
  reason?: string;
  toolName?: string;
  data?: unknown;
  success?: boolean;
  result?: string;
  error?: string;
  durationMs?: number;
  timestamp?: number;
}

export default function PstnCall() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const requestedAgentId = Number(new URLSearchParams(search).get("agentId"));
  const hasAgentId = Number.isFinite(requestedAgentId) && requestedAgentId > 0;
  const agentId = hasAgentId ? 1 : requestedAgentId;
  const [monitorState, setMonitorState] = useState<MonitorState>("connecting");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [callerPhone, setCallerPhone] = useState<string | null>(null);
  const [assistState, setAssistState] = useState(createRetailAssistState);

  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => agentsApi.getById(agentId),
    enabled: hasAgentId,
  });

  const { data: twilioStatus, isLoading: twilioLoading } = useQuery({
    queryKey: ["twilio-status"],
    queryFn: twilioApi.getStatus,
  });

  const agentWebhookUrl = useMemo(() => {
    if (!twilioStatus?.webhooks?.voice || !hasAgentId) return null;
    const url = new URL(twilioStatus.webhooks.voice);
    url.searchParams.set("agentId", String(agentId));
    return url.toString();
  }, [agentId, hasAgentId, twilioStatus?.webhooks?.voice]);

  const phoneHref = twilioStatus?.phoneNumber
    ? `tel:${twilioStatus.phoneNumber.replace(/[^\d+]/g, "")}`
    : undefined;

  useEffect(() => {
    if (hasAgentId && requestedAgentId !== 1) {
      setLocation("/pstn-call?agentId=1", { replace: true });
    }
  }, [hasAgentId, requestedAgentId, setLocation]);

  useEffect(() => {
    if (!hasAgentId) {
      setMonitorState("error");
      return;
    }

    setMonitorState("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/twilio-monitor?agentId=${agentId}`);

    ws.onopen = () => setMonitorState("waiting");
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as TwilioMonitorMessage;
      setAssistState((current) => updateRetailAssistState(current, msg));
      if (msg.type === "connected") {
        setMonitorState("waiting");
        return;
      }

      if (msg.type === "callStarted") {
        setMonitorState("in-call");
        setCallerPhone(msg.callerPhone || null);
        setAssistState((current) => ({
          ...createRetailAssistState(),
          toolEvents: current.toolEvents,
        }));
        appendTranscript("system", "PSTN call connected.");
        return;
      }

      if (msg.type === "callEnded") {
        setMonitorState("ended");
        appendTranscript("system", "PSTN call ended.");
        return;
      }

      if (msg.type === "smsSent") {
        appendTranscript("system", `Summary SMS sent to ${msg.to || "the caller"}.`);
        return;
      }

      if ((msg.type === "userTranscript" || msg.type === "assistantTranscript") && msg.text) {
        appendTranscript(
          msg.type === "userTranscript" ? "user" : "assistant",
          msg.type === "userTranscript" ? msg.rawText || msg.text : msg.text,
          msg.timestamp,
          msg.type === "userTranscript" && msg.corrected ? msg.correctedText || msg.text : undefined
        );
      }
    };
    ws.onerror = () => setMonitorState("error");
    ws.onclose = () => setMonitorState((current) => (current === "in-call" ? "ended" : current));

    return () => ws.close();
  }, [agentId, hasAgentId]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  function appendTranscript(
    role: TranscriptEntry["role"],
    text: string,
    timestamp = Date.now(),
    correctedText?: string
  ): void {
    const cleaned = text.trim();
    if (!cleaned) return;
    const cleanedCorrection = (correctedText || "").trim();
    const correction = cleanedCorrection && normalizeTranscriptForDedupe(cleanedCorrection) !== normalizeTranscriptForDedupe(cleaned)
      ? cleanedCorrection
      : undefined;

    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (
        last?.role === role &&
        last.text === cleaned &&
        (last.correctedText || "") === (correction || "")
      ) return prev;
      return [...prev, { role, text: cleaned, correctedText: correction, timestamp }];
    });
  }

  async function copyValue(label: string, value: string | null | undefined): Promise<void> {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({
        title: "Copy failed",
        description: value,
        variant: "destructive",
      });
    }
  }

  if (!hasAgentId) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <Button variant="ghost" className="gap-2" onClick={() => setLocation("/")}>
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="mt-16 text-center">
          <h1 className="text-2xl font-semibold">No agent selected</h1>
        </div>
      </div>
    );
  }

  const isLoading = agentLoading || twilioLoading;
  const statusLabel = getMonitorStatusLabel(monitorState);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-white/10 bg-background/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")} aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <PhoneCall className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">PSTN Agent Assist</h1>
              <p className="truncate text-sm text-muted-foreground">
                {agent?.name || "Loading agent..."}
              </p>
            </div>
          </div>
          <Badge className={getMonitorBadgeClass(monitorState)}>{statusLabel}</Badge>
        </div>
      </div>

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
        <Card className="p-4 bg-card/50 border-white/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10 border border-green-500/20">
                <PhoneCall className="w-5 h-5 text-green-300" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">Call From A Phone</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Dial the Twilio number. Transcript appears on the left and progress appears on the right.
                </p>
              </div>
            </div>

            <div className="grid gap-3 lg:min-w-[860px] lg:grid-cols-[minmax(270px,0.9fr)_minmax(0,1.5fr)_minmax(220px,0.8fr)]">
              <InfoRow
                className="min-w-[270px]"
                icon={<PhoneCall className="w-4 h-4" />}
                label="Twilio number"
                value={twilioStatus?.phoneNumber || "Set TWILIO_PHONE_NUMBER"}
                valueDisplay="nowrap"
                action={
                  twilioStatus?.phoneNumber ? (
                    <Button asChild size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                      <a href={phoneHref}>Call</a>
                    </Button>
                  ) : null
                }
              />

              <InfoRow
                icon={<Settings className="w-4 h-4" />}
                label="Voice webhook"
                value={agentWebhookUrl || "Set APP_BASE_URL"}
                valueDisplay="wrap"
                action={
                  agentWebhookUrl ? (
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Copy webhook URL"
                      onClick={() => copyValue("Webhook URL", agentWebhookUrl)}
                    >
                      <Clipboard className="w-4 h-4" />
                    </Button>
                  ) : null
                }
              />

              <InfoRow
                icon={<CheckCircle2 className="w-4 h-4" />}
                label="Summary SMS"
                value={twilioStatus?.smsConfigured ? "Available with consent" : "Not configured"}
              />
            </div>
          </div>
        </Card>

        <section className="grid min-h-[720px] overflow-hidden rounded-lg border border-white/10 bg-card/40 lg:h-[calc(100vh-280px)] lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
                  {(monitorState === "waiting" || monitorState === "in-call") && (
                    <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  )}
                  {monitorState === "connecting" ? (
                    <Loader2 className="relative z-10 w-4 h-4 animate-spin text-primary" />
                  ) : (
                    <Radio className="relative z-10 w-4 h-4 text-primary" />
                  )}
                </div>
                <div>
                  <h2 className="text-base font-semibold">Live PSTN Transcript</h2>
                  <p className="text-xs text-muted-foreground">{statusLabel}</p>
                </div>
              </div>
              <Badge variant="outline" className="border-white/10 text-muted-foreground">
                Browser monitor
              </Badge>
            </div>

            <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
              {isLoading && (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading PSTN monitor...
                </div>
              )}

              {!isLoading && transcript.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
                    <Mic className="h-8 w-8 text-primary/70" />
                  </div>
                  <p className="max-w-sm text-sm">
                    Waiting for a PSTN call on {agent?.name || "this agent"}. The live transcript will appear here.
                  </p>
                </div>
              )}

              {transcript.map((entry, index) => (
                <TranscriptBubble
                  key={`${entry.timestamp}-${index}`}
                  entry={entry}
                  agentName={agent?.name || "Agent"}
                  callerPhone={callerPhone}
                />
              ))}
            </div>
          </div>
          <aside className="min-h-0 border-t border-white/10 p-4 lg:border-l lg:border-t-0 lg:overflow-hidden">
            <RetailProgressTimeline state={assistState} className="h-full overflow-y-auto" />
          </aside>
        </section>
      </main>
    </div>
  );
}

function InfoRow({
  action,
  className,
  icon,
  label,
  value,
  valueDisplay = "truncate",
}: {
  action?: ReactNode;
  className?: string;
  icon: ReactNode;
  label: string;
  value: string;
  valueDisplay?: "truncate" | "wrap" | "nowrap";
}) {
  const valueClassName = {
    truncate: "truncate text-sm font-medium",
    wrap: "mt-1 whitespace-normal break-all font-mono text-[12px] leading-relaxed text-foreground",
    nowrap: "whitespace-nowrap text-sm font-medium tabular-nums",
  }[valueDisplay];

  return (
    <div className={`flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3 ${className || ""}`}>
      <div className="mt-1 text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={valueClassName}>
          {value}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {number}
      </span>
      <p>{text}</p>
    </div>
  );
}

function TranscriptBubble({ entry, agentName, callerPhone }: { entry: TranscriptEntry; agentName: string; callerPhone?: string | null }) {
  if (entry.role === "system") {
    return (
      <div className="flex justify-center">
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted-foreground">
          {entry.text}
        </div>
      </div>
    );
  }

  const isUser = entry.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        isUser ? "bg-purple-500 text-white" : "bg-primary text-black"
      }`}>
        {isUser ? "U" : <Bot className="h-4 w-4" />}
      </div>
      <div className={`min-w-0 flex-1 ${isUser ? "text-right" : ""}`}>
        <div className="mb-1 text-xs text-muted-foreground">
          {isUser ? formatCallerPhone(callerPhone) : agentName}
        </div>
        <div className={`inline-block max-w-[85%] rounded-xl border p-3 text-left text-sm ${
          isUser
            ? "rounded-tr-none border-purple-500/20 bg-purple-500/10"
            : "rounded-tl-none border-white/10 bg-white/[0.05]"
        }`}>
          {entry.text}
          {isUser && entry.correctedText && (
            <span className="text-muted-foreground"> [corrected: {entry.correctedText}]</span>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizeTranscriptForDedupe(text: string): string {
  return text.toLowerCase().replace(/[.!?,\s]+$/g, "");
}

function formatCallerPhone(value?: string | null): string {
  const raw = value?.trim();
  if (!raw) return "Caller";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return raw;
}

function getMonitorStatusLabel(state: MonitorState): string {
  switch (state) {
    case "connecting":
      return "Connecting monitor";
    case "waiting":
      return "Waiting for PSTN call";
    case "in-call":
      return "PSTN call live";
    case "ended":
      return "Call ended";
    case "error":
      return "Monitor unavailable";
  }
}

function getMonitorBadgeClass(state: MonitorState): string {
  switch (state) {
    case "connecting":
      return "bg-yellow-500/10 text-yellow-300 border-yellow-500/20";
    case "waiting":
      return "bg-blue-500/10 text-blue-300 border-blue-500/20";
    case "in-call":
      return "bg-green-500/10 text-green-300 border-green-500/20";
    case "ended":
      return "bg-white/5 text-muted-foreground border-white/10";
    case "error":
      return "bg-red-500/10 text-red-300 border-red-500/20";
  }
}
