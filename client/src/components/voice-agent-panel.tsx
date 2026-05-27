import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Activity, Bot, MessageSquare, Phone, PhoneOff, Loader2, Mic, UserRound, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useVoiceAgent, type VoiceActivity, type VoiceAgentState, type TranscriptEntry } from "@/hooks/use-voice-agent";
import { RetailProgressTimeline, createRetailAssistState, type RetailAssistState } from "@/components/retail-agent-assist";
import { MonitorBadge, VoiceMonitorWorkspace } from "@/components/voice-monitor-workspace";

interface VoiceAgentPanelProps {
  agentId: number;
  agentName: string;
  systemPrompt?: string;
  voice?: string;
  gender?: string;
  onStateChange?: (state: VoiceAgentState) => void;
  onRealtimeEvent?: (event: any) => void;
  assistState?: RetailAssistState;
  layout?: "compact" | "split";
}

export function VoiceAgentPanel({
  agentId,
  agentName,
  systemPrompt,
  voice,
  gender,
  onStateChange,
  onRealtimeEvent,
  assistState,
  layout = "compact",
}: VoiceAgentPanelProps) {
  const { state, activity, transcript, userPartial, assistantPartial, error, start, stop } = useVoiceAgent({
    agentId,
    systemPrompt,
    voice,
    gender,
    onEvent: onRealtimeEvent,
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, userPartial, assistantPartial]);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  const isActive = state !== "idle";
  const hasTranscript = transcript.length > 0 || Boolean(userPartial) || Boolean(assistantPartial);
  const monitorTranscript = useMemo(() => {
    const entries = [...transcript];
    if (userPartial.trim()) {
      entries.push({ role: "user", text: userPartial, timestamp: Date.now() });
    }
    if (assistantPartial.trim()) {
      entries.push({ role: "assistant", text: assistantPartial, timestamp: Date.now() });
    }
    return entries;
  }, [assistantPartial, transcript, userPartial]);

  if (layout === "split") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <VoiceMonitorWorkspace
          transcriptRef={scrollRef}
          transcript={monitorTranscript}
          agentName={agentName}
          transcriptSubtitle={state === "idle" ? "Ready for voice monitor" : getStateLabel(state, activity)}
          emptyText="Waiting for call activity. The live transcript will appear here."
          assistState={assistState || createRetailAssistState()}
          callerLabel="Caller"
          loading={state === "connecting"}
          headerBadge={<MonitorBadge>{state === "idle" ? "Voice monitor" : getStateLabel(state, activity)}</MonitorBadge>}
          headerAction={
            !isActive ? (
              <Button
                size="sm"
                className="shrink-0 gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={start}
                data-testid="button-start-call"
              >
                <Phone className="w-4 h-4" />
                Start
              </Button>
            ) : (
              <Button
                size="sm"
                className="shrink-0 gap-2 bg-red-600 hover:bg-red-700 text-white"
                onClick={stop}
                data-testid="button-end-call"
              >
                <PhoneOff className="w-4 h-4" />
                End
              </Button>
            )
          }
        />
        {error && <ErrorBanner message={error} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <CallPulse state={state} activity={activity} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Voice Call</span>
              <StatusBadge state={state} activity={activity} />
            </div>
            <p className="text-xs text-muted-foreground truncate">{agentName}</p>
          </div>
        </div>

        {!isActive ? (
          <Button
            size="sm"
            className="shrink-0 gap-2 bg-green-600 hover:bg-green-700 text-white"
            onClick={start}
            data-testid="button-start-call"
          >
            <Phone className="w-4 h-4" />
            Start Call
          </Button>
        ) : (
          <Button
            size="sm"
            className="shrink-0 gap-2 bg-red-600 hover:bg-red-700 text-white"
            onClick={stop}
            data-testid="button-end-call"
          >
            <PhoneOff className="w-4 h-4" />
            End Call
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {!hasTranscript && !isActive && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Mic className="w-8 h-8 text-primary/60" />
            </div>
            <p className="text-sm text-muted-foreground max-w-[200px]">
              Start a real-time voice call with {agentName}
            </p>
          </div>
        )}

        {!hasTranscript && isActive && state === "connecting" && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Connecting...</p>
          </div>
        )}

        {!hasTranscript && isActive && state === "listening" && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
            <div className="relative w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-green-400/20 animate-ping" />
              <Mic className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-sm text-muted-foreground">Listening... speak now</p>
          </div>
        )}

        {transcript.map((entry, i) => (
          <TranscriptBubble key={i} entry={entry} agentName={agentName} />
        ))}

        {userPartial && <UserPartialBubble text={userPartial} />}

        {assistantPartial && (
          <div className="flex gap-3">
            <Avatar className="h-8 w-8 border border-primary/50 shrink-0 ring-2 ring-primary/30 animate-pulse">
              <AvatarFallback className="bg-primary text-black text-xs font-bold">
                {agentName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-1">{agentName}</div>
              <div className="p-3 rounded-xl rounded-tl-none bg-white/5 border border-white/10 text-sm">
                {assistantPartial}
                <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}
    </div>
  );
}

function TranscriptPane({
  agentName,
  transcript,
  userPartial,
  assistantPartial,
  scrollRef,
  hasTranscript,
}: {
  agentName: string;
  transcript: TranscriptEntry[];
  userPartial: string;
  assistantPartial: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  hasTranscript: boolean;
}) {
  return (
    <div className="min-h-0 flex flex-col bg-card/20">
      <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-white/10">
        <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold leading-tight">Live Transcript</h2>
          <p className="text-xs text-muted-foreground">{agentName}</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
        {!hasTranscript && (
          <div className="flex h-full min-h-[320px] items-center justify-center text-center">
            <div className="max-w-sm space-y-2">
              <div className="mx-auto h-12 w-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center">
                <Activity className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Waiting for conversation</p>
              <p className="text-sm text-muted-foreground">
                Customer messages and agent responses will appear here as the call unfolds.
              </p>
            </div>
          </div>
        )}

        {transcript.map((entry, i) => (
          <TranscriptBubble key={i} entry={entry} agentName={agentName} />
        ))}

        {userPartial && <UserPartialBubble text={userPartial} />}

        {assistantPartial && (
          <div className="flex gap-3">
            <Avatar className="h-8 w-8 border border-primary/50 shrink-0 ring-2 ring-primary/30 animate-pulse">
              <AvatarFallback className="bg-primary text-black text-xs font-bold">
                {agentName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-1">{agentName}</div>
              <div className="p-3 rounded-xl rounded-tl-none bg-white/5 border border-white/10 text-sm">
                {assistantPartial}
                <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CallControlPane({
  agentName,
  state,
  activity,
  isActive,
  start,
  stop,
  assistState,
}: {
  agentName: string;
  state: VoiceAgentState;
  activity: VoiceActivity;
  isActive: boolean;
  start: () => void;
  stop: () => void;
  assistState?: RetailAssistState;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <CallPulse state={state} activity={activity} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Voice Call</span>
              <StatusBadge state={state} activity={activity} />
            </div>
            <p className="text-xs text-muted-foreground truncate">{agentName}</p>
          </div>
        </div>

        {!isActive ? (
          <Button
            size="sm"
            className="shrink-0 gap-2 bg-green-600 hover:bg-green-700 text-white"
            onClick={start}
            data-testid="button-start-call"
          >
            <Phone className="w-4 h-4" />
            Start
          </Button>
        ) : (
          <Button
            size="sm"
            className="shrink-0 gap-2 bg-red-600 hover:bg-red-700 text-white"
            onClick={stop}
            data-testid="button-end-call"
          >
            <PhoneOff className="w-4 h-4" />
            End
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        <div className="flex min-h-full flex-col justify-center gap-5">
          <div className="text-center">
            <CallStage agentName={agentName} state={state} activity={activity} isActive={isActive} />
            {isActive && <CallActivityStack activity={activity} />}
          </div>
          {assistState && <RetailProgressTimeline state={assistState} />}
        </div>
      </div>
    </div>
  );
}

function CallStage({
  agentName,
  state,
  activity,
  isActive,
}: {
  agentName: string;
  state: VoiceAgentState;
  activity: VoiceActivity;
  isActive: boolean;
}) {
  if (!isActive) {
    return (
      <div className="mx-auto flex w-full max-w-[280px] flex-col items-center gap-5">
        <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Mic className="w-9 h-9 text-primary/60" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold leading-tight">Ready for browser call</p>
          <p className="mx-auto max-w-[220px] text-sm leading-relaxed text-muted-foreground">
            Start a live voice call with {agentName}.
          </p>
        </div>
      </div>
    );
  }

  if (state === "connecting") {
    return (
      <div className="space-y-4">
        <Loader2 className="mx-auto w-9 h-9 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Connecting...</p>
      </div>
    );
  }

  const isAgentSpeaking = activity === "agent_speaking" || state === "speaking";
  const isUserSpeaking = activity === "user_speaking";
  const isBargeIn = activity === "barge_in";
  const color = isBargeIn
    ? "bg-amber-500/10 border-amber-500/40"
    : isAgentSpeaking
      ? "bg-blue-500/10 border-blue-500/30"
      : isUserSpeaking
        ? "bg-purple-500/10 border-purple-500/30"
        : "bg-green-500/10 border-green-500/30";
  const pingColor = isBargeIn
    ? "bg-amber-400/20"
    : isAgentSpeaking
      ? "bg-blue-400/20"
      : isUserSpeaking
        ? "bg-purple-400/20"
        : "bg-green-400/20";
  const iconColor = isBargeIn
    ? "text-amber-300"
    : isAgentSpeaking
      ? "text-blue-300"
      : isUserSpeaking
        ? "text-purple-300"
        : "text-green-400";
  const label = isBargeIn
    ? "Barge-in detected"
    : isAgentSpeaking
      ? "Agent is talking"
      : isUserSpeaking
        ? "User is talking"
        : "Listening";
  const description = isBargeIn
    ? "Assistant audio was interrupted so the user can take the floor."
    : isAgentSpeaking
      ? "Audio response is playing."
      : isUserSpeaking
        ? "Capturing the user's turn."
        : "Speak naturally. Transcript updates on the left.";

  return (
    <div className="space-y-5">
      <div className={`relative mx-auto w-24 h-24 rounded-full border flex items-center justify-center ${color}`}>
        <span className={`absolute inset-0 rounded-full animate-ping ${pingColor}`} />
        {isBargeIn ? (
          <Zap className={`relative z-10 w-11 h-11 ${iconColor}`} />
        ) : isAgentSpeaking ? (
          <Bot className={`relative z-10 w-11 h-11 ${iconColor}`} />
        ) : isUserSpeaking ? (
          <UserRound className={`relative z-10 w-11 h-11 ${iconColor}`} />
        ) : (
          <Mic className={`relative z-10 w-11 h-11 ${iconColor}`} />
        )}
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function CallActivityStack({ activity }: { activity: VoiceActivity }) {
  const rows = [
    {
      key: "user_speaking" as const,
      label: "User talking",
      helper: "Inbound speech detected",
      icon: UserRound,
      activeClass: "border-purple-400/40 bg-purple-500/10 text-purple-200",
    },
    {
      key: "agent_speaking" as const,
      label: "Agent talking",
      helper: "Assistant audio playing",
      icon: Bot,
      activeClass: "border-blue-400/40 bg-blue-500/10 text-blue-200",
    },
    {
      key: "barge_in" as const,
      label: "Barge-in",
      helper: "User interrupted agent audio",
      icon: Zap,
      activeClass: "border-amber-400/50 bg-amber-500/10 text-amber-200",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-xs space-y-2 text-left">
      {rows.map((row) => {
        const Icon = row.icon;
        const active = activity === row.key;
        return (
          <div
            key={row.key}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
              active
                ? row.activeClass
                : "border-white/10 bg-white/[0.03] text-muted-foreground"
            }`}
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              active ? "bg-white/10" : "bg-white/5"
            }`}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">{row.label}</span>
              <span className="block text-xs opacity-70">{row.helper}</span>
            </span>
            <span className={`h-2 w-2 rounded-full ${active ? "bg-current animate-pulse" : "bg-white/15"}`} />
          </div>
        );
      })}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20">
      <p className="text-xs text-red-400">{message}</p>
    </div>
  );
}

function getStateLabel(state: VoiceAgentState, activity?: VoiceActivity): string {
  if (activity === "barge_in") return "Barge-in";
  if (activity === "user_speaking") return "User talking";
  if (activity === "agent_speaking" || state === "speaking") return "Agent talking";
  if (state === "connecting") return "Connecting";
  if (state === "listening") return "Voice call live";
  return "Ready for voice monitor";
}

function CallPulse({ state, activity }: { state: VoiceAgentState; activity?: VoiceActivity }) {
  const isActive = state !== "idle";
  const isTalking = state === "speaking" || activity === "agent_speaking";
  const isUser = activity === "user_speaking";
  const isBargeIn = activity === "barge_in";
  const color = isBargeIn
    ? "bg-amber-400/25"
    : isTalking
      ? "bg-blue-400/25"
      : isUser
        ? "bg-purple-400/25"
        : "bg-green-400/25";
  const iconColor = isBargeIn
    ? "text-amber-300"
    : isTalking
      ? "text-blue-300"
      : isUser
        ? "text-purple-300"
        : isActive
          ? "text-green-300"
          : "text-primary";

  return (
    <div className="relative h-10 w-10 shrink-0 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
      {isActive && (
        <>
          <span className={`absolute inset-0 rounded-full ${color} animate-ping`} />
          <span className={`absolute inset-1 rounded-full ${color} animate-pulse`} />
        </>
      )}
      <Mic className={`relative z-10 w-4 h-4 ${iconColor}`} />
    </div>
  );
}

function StatusBadge({ state, activity }: { state: VoiceAgentState; activity?: VoiceActivity }) {
  if (activity === "barge_in") {
    return (
      <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/25 text-xs gap-1">
        <Zap className="w-3 h-3" /> Barge-in
      </Badge>
    );
  }

  if (activity === "user_speaking") {
    return (
      <Badge className="bg-purple-500/10 text-purple-300 border-purple-500/25 text-xs gap-1">
        <span className="w-1.5 h-1.5 bg-purple-300 rounded-full animate-pulse" /> User talking
      </Badge>
    );
  }

  switch (state) {
    case "idle":
      return null;
    case "connecting":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 text-xs gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Connecting
        </Badge>
      );
    case "listening":
      return (
        <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-xs gap-1">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> Listening
        </Badge>
      );
    case "speaking":
      return (
        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-xs gap-1">
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" /> Agent talking
        </Badge>
      );
  }
}

function TranscriptBubble({ entry, agentName }: { entry: TranscriptEntry; agentName: string }) {
  const isUser = entry.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar className={`h-8 w-8 border shrink-0 ${isUser ? "border-purple-500/50" : "border-primary/50"}`}>
        <AvatarFallback className={`text-xs font-bold ${isUser ? "bg-purple-500 text-white" : "bg-primary text-black"}`}>
          {isUser ? "U" : agentName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className={`flex-1 ${isUser ? "text-right" : ""}`}>
        <div className="text-xs text-muted-foreground mb-1">
          {isUser ? "You" : agentName}
        </div>
        <div className={`inline-block p-3 rounded-xl text-sm max-w-[85%] ${
          isUser
            ? "rounded-tr-none bg-purple-500/10 border border-purple-500/20 text-left"
            : "rounded-tl-none bg-white/5 border border-white/10"
        }`}>
          {entry.text}
        </div>
      </div>
    </div>
  );
}

function UserPartialBubble({ text }: { text: string }) {
  const cleaned = text.trim();
  if (!cleaned) return null;

  return (
    <div className="flex flex-row-reverse gap-3">
      <Avatar className="h-8 w-8 border border-purple-500/50 shrink-0 ring-2 ring-purple-400/20 animate-pulse">
        <AvatarFallback className="bg-purple-500 text-white text-xs font-bold">U</AvatarFallback>
      </Avatar>
      <div className="flex-1 text-right">
        <div className="text-xs text-muted-foreground mb-1">You</div>
        <div className="inline-block p-3 rounded-xl rounded-tr-none bg-purple-500/10 border border-purple-500/20 text-left text-sm max-w-[85%]">
          {cleaned}
          <span className="inline-block w-1.5 h-4 bg-purple-300/70 animate-pulse ml-0.5 align-middle" />
        </div>
      </div>
    </div>
  );
}
