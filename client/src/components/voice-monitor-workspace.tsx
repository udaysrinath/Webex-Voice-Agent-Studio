import type { ReactNode, RefObject } from "react";
import { Bot, Loader2, Mic, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RetailProgressTimeline, type RetailAssistState } from "@/components/retail-agent-assist";

export interface VoiceMonitorTranscriptEntry {
  role: "user" | "assistant" | "system";
  text: string;
  correctedText?: string;
  timestamp: number;
}

interface VoiceMonitorWorkspaceProps {
  transcriptRef: RefObject<HTMLDivElement | null>;
  transcript: VoiceMonitorTranscriptEntry[];
  agentName: string;
  transcriptTitle?: string;
  transcriptSubtitle?: string;
  emptyText?: string;
  assistState: RetailAssistState;
  timelineTitle?: string;
  timelineSubtitle?: string;
  timelineEmptyTitle?: string;
  timelineEmptyText?: string;
  callerLabel?: string | null;
  loading?: boolean;
  headerBadge?: ReactNode;
  headerAction?: ReactNode;
}

export function VoiceMonitorWorkspace({
  transcriptRef,
  transcript,
  agentName,
  transcriptTitle = "Live Transcript",
  transcriptSubtitle = "Ready for voice monitor",
  emptyText = "Waiting for call activity. The live transcript will appear here.",
  assistState,
  timelineTitle = "Agent assist timeline",
  timelineSubtitle = "Live tool progress and handoff context",
  timelineEmptyTitle = "Waiting for call activity",
  timelineEmptyText = "Verification, inventory lookup, reservation, and handoff events will appear here.",
  callerLabel,
  loading = false,
  headerBadge,
  headerAction,
}: VoiceMonitorWorkspaceProps) {
  return (
    <section className="pstn-workspace grid flex-1 lg:grid-cols-[minmax(0,1fr)_520px] xl:grid-cols-[minmax(0,1fr)_560px]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="pstn-section-header flex shrink-0 items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <div className="app-icon-tile relative flex h-10 w-10 items-center justify-center rounded-full">
              {loading ? (
                <Loader2 className="relative z-10 h-4 w-4 text-foreground" />
              ) : (
                <Radio className="relative z-10 h-4 w-4 text-foreground" />
              )}
            </div>
            <div>
              <h2 className="text-[15px] font-bold leading-5 tracking-normal">{transcriptTitle}</h2>
              <p className="text-xs text-muted-foreground">{transcriptSubtitle}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerBadge}
            {headerAction}
          </div>
        </div>

        <div ref={transcriptRef} className="pstn-transcript-pane min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4" />
              Loading monitor...
            </div>
          )}

          {!loading && transcript.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <div className="app-icon-tile flex h-16 w-16 items-center justify-center rounded-full">
                <Mic className="h-8 w-8 text-foreground" />
              </div>
              <p className="max-w-sm text-sm">{emptyText}</p>
            </div>
          )}

          {transcript.map((entry, index) => (
            <VoiceMonitorTranscriptBubble
              key={`${entry.timestamp}-${index}`}
              entry={entry}
              agentName={agentName}
              callerLabel={callerLabel}
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
            <h2 className="text-[15px] font-bold leading-5 tracking-normal">{timelineTitle}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{timelineSubtitle}</p>
          </div>
        </div>
        <div className="pstn-timeline-shell min-h-0 flex-1 overflow-y-auto p-4">
          <div className="pstn-timeline-content">
            <RetailProgressTimeline className="pstn-progress-timeline" state={assistState} />
          </div>
          <div className="pstn-rail-empty flex h-full min-h-[320px] flex-col items-center justify-center rounded-lg p-6 text-center">
            <Radio className="mb-3 h-5 w-5 text-foreground" />
            <p className="text-sm font-medium text-foreground">{timelineEmptyTitle}</p>
            <p className="mt-1 max-w-[240px] text-xs leading-relaxed">{timelineEmptyText}</p>
          </div>
        </div>
      </aside>
    </section>
  );
}

function VoiceMonitorTranscriptBubble({
  entry,
  agentName,
  callerLabel,
}: {
  entry: VoiceMonitorTranscriptEntry;
  agentName: string;
  callerLabel?: string | null;
}) {
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
          {isUser ? callerLabel || "Caller" : agentName}
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

export function MonitorBadge({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="pstn-chip">
      {children}
    </Badge>
  );
}
