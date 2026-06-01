import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  Loader2,
  Mic,
  Phone,
  PhoneOff,
  Radio,
} from "lucide-react";
import { agentsApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RetailProgressTimeline,
  createRetailAssistState,
  updateRetailAssistState,
} from "@/components/retail-agent-assist";
import { useVoiceAgent, type TranscriptEntry, type VoiceActivity, type VoiceAgentState } from "@/hooks/use-voice-agent";

export default function BrowserCall() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const agentId = Number(new URLSearchParams(search).get("agentId"));
  const hasAgentId = Number.isFinite(agentId) && agentId > 0;

  const [assistState, setAssistState] = useState(createRetailAssistState);

  const handleRealtimeEvent = useCallback((event: any) => {
    setAssistState((current) => updateRetailAssistState(current, event));
  }, []);

  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => agentsApi.getById(agentId),
    enabled: hasAgentId,
  });

  const { state, activity, transcript, userPartial, assistantPartial, error, start, stop } = useVoiceAgent({
    agentId: hasAgentId ? agentId : undefined,
    systemPrompt: agent?.systemPrompt || undefined,
    voice: agent?.voiceModel,
    gender: agent?.gender,
    onEvent: handleRealtimeEvent,
  });

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript, userPartial, assistantPartial]);

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

  const isActive = state !== "idle";
  const hasTranscript = transcript.length > 0 || Boolean(userPartial) || Boolean(assistantPartial);
  const statusLabel = getStatusLabel(state, activity);
  const badgeClass = getStatusBadgeClass(state, activity);

  return (
    <div className="pstn-page">
      <div className="pstn-header">
        <div className="pstn-header-inner mx-auto flex max-w-[1520px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")} aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="app-icon-tile flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
              <Mic className="w-5 h-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold leading-8 tracking-normal">Browser Voice Call</h1>
              <p className="truncate text-[13px] leading-5 text-muted-foreground">
                {agentLoading ? "Loading agent..." : agent?.name || "Agent"}
              </p>
            </div>
          </div>
          <div className="pstn-header-actions flex shrink-0 items-center gap-3">
            {!isActive ? (
              <Button
                size="sm"
                className="shrink-0 gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={start}
                disabled={agentLoading || !agent}
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
            <Badge className={badgeClass}>{statusLabel}</Badge>
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
                    {state === "connecting" ? (
                      <Loader2 className="relative z-10 w-4 h-4 text-foreground animate-spin" />
                    ) : (
                      <Radio className="relative z-10 w-4 h-4 text-foreground" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold leading-5 tracking-normal">Live Browser Transcript</h2>
                    <p className="text-xs text-muted-foreground">{statusLabel}</p>
                  </div>
                </div>
                <Badge variant="outline" className="pstn-chip">
                  Browser call
                </Badge>
              </div>

              <div ref={transcriptRef} className="pstn-transcript-pane min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
                {agentLoading && (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading agent...
                  </div>
                )}

                {!agentLoading && !hasTranscript && !isActive && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                    <div className="app-icon-tile flex h-16 w-16 items-center justify-center rounded-full">
                      <Mic className="h-8 w-8 text-foreground" />
                    </div>
                    <p className="max-w-sm text-sm">
                      Press <strong>Start Call</strong> to begin a live browser voice call with {agent?.name || "the agent"}.
                    </p>
                  </div>
                )}

                {!agentLoading && !hasTranscript && isActive && state === "connecting" && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                    <Loader2 className="h-10 w-10 animate-spin" />
                    <p className="text-sm">Connecting to agent...</p>
                  </div>
                )}

                {error && (
                  <div className="flex justify-center">
                    <div className="pstn-message-system rounded-full px-3 py-1 text-xs text-red-400">
                      Error: {error}
                    </div>
                  </div>
                )}

                {transcript.map((entry, index) => (
                  <TranscriptBubble
                    key={`${entry.timestamp}-${index}`}
                    entry={entry}
                    agentName={agent?.name || "Agent"}
                  />
                ))}

                {userPartial && (
                  <div className="flex gap-3 flex-row-reverse">
                    <div className="pstn-message-avatar flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold pstn-message-avatar-user">
                      U
                    </div>
                    <div className="min-w-0 flex-1 text-right">
                      <div className="mb-1 text-xs text-muted-foreground">You</div>
                      <div className="inline-block max-w-[85%] rounded-xl border p-3 text-left text-sm pstn-message-user rounded-tr-none opacity-70">
                        {userPartial}
                        <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5 align-middle opacity-60" />
                      </div>
                    </div>
                  </div>
                )}

                {assistantPartial && (
                  <div className="flex gap-3">
                    <div className="pstn-message-avatar flex h-8 w-8 shrink-0 items-center justify-center rounded-full pstn-message-avatar-assistant">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 text-xs text-muted-foreground">{agent?.name || "Agent"}</div>
                      <div className="inline-block max-w-[85%] rounded-xl border p-3 text-left text-sm pstn-message-assistant rounded-tl-none opacity-70">
                        {assistantPartial}
                        <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5 align-middle opacity-60" />
                      </div>
                    </div>
                  </div>
                )}
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

function TranscriptBubble({ entry, agentName }: { entry: TranscriptEntry; agentName: string }) {
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
          {isUser ? "You" : agentName}
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

function getStatusLabel(state: VoiceAgentState, activity: VoiceActivity): string {
  if (state === "idle") return "Ready";
  if (state === "connecting") return "Connecting";
  if (activity === "user_speaking") return "You're speaking";
  if (activity === "agent_speaking" || state === "speaking") return "Agent talking";
  if (activity === "barge_in") return "Barge-in";
  return "Listening";
}

function getStatusBadgeClass(state: VoiceAgentState, activity: VoiceActivity): string {
  if (state === "idle") return "status-muted";
  if (state === "connecting") return "status-warning";
  if (activity === "barge_in") return "status-warning";
  if (activity === "agent_speaking" || state === "speaking") return "status-info";
  if (activity === "user_speaking") return "status-success";
  return "status-success";
}
