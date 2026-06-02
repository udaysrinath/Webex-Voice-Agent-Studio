import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  Loader2,
  MessageSquare,
  Mic,
  PhoneCall,
  Radio,
} from "lucide-react";
import { agentsApi, twilioApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

  const normalizedPhoneNumber = getDialablePhoneNumber(twilioStatus?.phoneNumber);
  const phoneHref = normalizedPhoneNumber ? `tel:${normalizedPhoneNumber}` : undefined;

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
          msg.text,
          msg.timestamp,
          msg.type === "userTranscript" && msg.corrected ? msg.rawText : undefined
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

  if (!hasAgentId) {
    return (
      <div className="pstn-page p-6">
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
  const displayPhoneNumber = twilioLoading
    ? "Loading phone number..."
    : formatHeaderPhoneNumber(twilioStatus?.phoneNumber);

  return (
    <div className="pstn-page">
      <div className="pstn-header">
        <div className="pstn-header-inner mx-auto flex max-w-[1520px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")} aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="app-icon-tile flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
              <PhoneCall className="w-5 h-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold leading-8 tracking-normal">Acme electronics Agent</h1>
              <p className="truncate text-[13px] leading-5 text-muted-foreground">
                {agent?.name || "Loading agent..."}
              </p>
            </div>
          </div>
          <div className="pstn-header-actions flex shrink-0 items-center gap-3">
            <div className="pstn-webex-stack flex min-w-0 flex-col items-end gap-1">
              <Button variant="outline" size="sm" onClick={() => setLocation("/demo-setup")}>
                <MessageSquare className="h-4 w-4" />
                Webex setup
              </Button>
              {phoneHref ? (
                <a className="pstn-header-phone" href={phoneHref} aria-label={`Call ${displayPhoneNumber}`}>
                  <PhoneCall className="h-3 w-3" />
                  <span>{displayPhoneNumber}</span>
                </a>
              ) : (
                <span className="pstn-header-phone pstn-header-phone-muted">
                  <PhoneCall className="h-3 w-3" />
                  <span>{displayPhoneNumber}</span>
                </span>
              )}
            </div>
            <Badge className={getMonitorBadgeClass(monitorState)}>{statusLabel}</Badge>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1520px] px-6 pb-6">
        <div className="pstn-primary flex flex-col">
          <section className="pstn-workspace grid flex-1 lg:grid-cols-[minmax(0,1fr)_520px] xl:grid-cols-[minmax(0,1fr)_560px]">
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="pstn-section-header flex shrink-0 items-center justify-between gap-4 px-5">
                <div className="flex items-center gap-3">
                  <div className="app-icon-tile relative flex h-10 w-10 items-center justify-center rounded-full">
                    {monitorState === "connecting" ? (
                      <Loader2 className="relative z-10 w-4 h-4 text-foreground" />
                    ) : (
                      <Radio className="relative z-10 w-4 h-4 text-foreground" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold leading-5 tracking-normal">Live customer and agent conversation</h2>
                    <p className="text-xs text-muted-foreground">{statusLabel}</p>
                  </div>
                </div>
              </div>

              <div ref={transcriptRef} className="pstn-transcript-pane min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
                {isLoading && (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4" />
                    Loading PSTN monitor...
                  </div>
                )}

                {!isLoading && transcript.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                    <div className="app-icon-tile flex h-16 w-16 items-center justify-center rounded-full">
                      <Mic className="h-8 w-8 text-foreground" />
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
            <aside className="pstn-side-pane flex min-h-0 flex-col border-t lg:border-l lg:border-t-0 lg:overflow-hidden">
              <div className="pstn-rail-header flex shrink-0 items-center gap-3 px-5">
                <div className="app-icon-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold leading-5 tracking-normal">Acme electronics Agent Timeline</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Live tool progress and handoff context</p>
                </div>
              </div>
              <div className="pstn-timeline-shell min-h-0 flex-1 overflow-y-auto p-4">
                <div className="pstn-timeline-content">
                  <RetailProgressTimeline className="pstn-progress-timeline" state={assistState} />
                </div>
                <div className="pstn-rail-empty flex h-full min-h-[320px] flex-col items-center justify-center rounded-lg p-6 text-center">
                  <Radio className="mb-3 h-5 w-5 text-foreground" />
                  <p className="text-sm font-medium text-foreground">Waiting for call activity</p>
                  <p className="mt-1 max-w-[240px] text-xs leading-relaxed">
                    Verification, inventory lookup, reservation, and handoff events will appear here.
                  </p>
                </div>
              </div>
            </aside>
          </section>
        </div>
      </main>
    </div>
  );
}

function TranscriptBubble({ entry, agentName, callerPhone }: { entry: TranscriptEntry; agentName: string; callerPhone?: string | null }) {
  if (entry.role === "system") {
    return (
      <div className="flex justify-center">
        <div className="pstn-message-system rounded-full px-3 py-1 text-xs text-muted-foreground">
          {entry.text}
        </div>
      </div>
    );
  }

  const isUser = entry.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`pstn-message-avatar flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        isUser ? "pstn-message-avatar-user" : "pstn-message-avatar-assistant"
      }`}>
        {isUser ? "U" : <Bot className="h-4 w-4" />}
      </div>
      <div className={`min-w-0 flex-1 ${isUser ? "text-right" : ""}`}>
        <div className="mb-1 text-xs text-muted-foreground">
          {isUser ? formatCallerPhone(callerPhone) : agentName}
        </div>
        <div className={`inline-block max-w-[85%] rounded-xl border p-3 text-left text-sm ${
          isUser
            ? "pstn-message-user rounded-tr-none"
            : "pstn-message-assistant rounded-tl-none"
        }`}>
          {entry.text}
        </div>
      </div>
    </div>
  );
}

function normalizeTranscriptForDedupe(text: string): string {
  return text.toLowerCase().replace(/[.!?,\s]+$/g, "");
}

function getDialablePhoneNumber(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const dialable = raw.replace(/[^\d+]/g, "");
  return dialable || null;
}

function formatHeaderPhoneNumber(value?: string | null): string {
  const raw = value?.trim();
  if (!raw) return "Set TWILIO_PHONE_NUMBER";
  return formatCallerPhone(raw);
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
      return "status-warning";
    case "waiting":
      return "status-info";
    case "in-call":
      return "status-success";
    case "ended":
      return "status-muted";
    case "error":
      return "status-danger";
  }
}
