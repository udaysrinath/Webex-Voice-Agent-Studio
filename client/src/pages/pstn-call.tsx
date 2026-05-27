import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  PhoneCall,
} from "lucide-react";
import { agentsApi, twilioApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createRetailAssistState,
  updateRetailAssistState,
} from "@/components/retail-agent-assist";
import { VoiceMonitorPage } from "@/components/voice-monitor-page";
import { MonitorBadge, VoiceMonitorWorkspace } from "@/components/voice-monitor-workspace";

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
        appendTranscript("system", "Voice call connected.");
        return;
      }

      if (msg.type === "callEnded") {
        setMonitorState("ended");
        appendTranscript("system", "Voice call ended.");
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
    <VoiceMonitorPage
      title={agent?.name || "Store Assistant"}
      subtitle={getAgentMonitorSubtitle(agent)}
      onBack={() => setLocation("/")}
      actions={
        <>
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
        </>
      }
    >
          <VoiceMonitorWorkspace
            transcriptRef={transcriptRef}
            transcript={transcript}
            agentName={agent?.name || "Agent"}
            transcriptSubtitle={statusLabel}
            emptyText="Waiting for call activity. The live transcript will appear here."
            assistState={assistState}
            callerLabel={formatCallerPhone(callerPhone)}
            loading={isLoading}
            headerBadge={<MonitorBadge>Voice monitor</MonitorBadge>}
          />
    </VoiceMonitorPage>
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
      return "Ready for voice monitor";
    case "in-call":
      return "Voice call live";
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

function getAgentMonitorSubtitle(agent?: {
  llmModel?: string | null;
  voiceModel?: string | null;
  language?: string | null;
}): string {
  return [
    agent?.llmModel || "gpt-4o",
    agent?.voiceModel || "voice",
    agent?.language || "en-US",
  ].join(" • ");
}
