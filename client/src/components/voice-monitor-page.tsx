import type { ReactNode } from "react";
import { ArrowLeft, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VoiceMonitorPageProps {
  title: string;
  subtitle: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function VoiceMonitorPage({
  title,
  subtitle,
  onBack,
  actions,
  children,
}: VoiceMonitorPageProps) {
  return (
    <div className="pstn-page">
      <div className="pstn-header">
        <div className="pstn-header-inner mx-auto flex max-w-[1520px] items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="app-icon-tile flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
              <Mic className="h-5 w-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold leading-8 tracking-normal">{title}</h1>
              <p className="truncate text-[13px] leading-5 text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          {actions && (
            <div className="pstn-header-actions flex shrink-0 items-center gap-3">
              {actions}
            </div>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-[1520px] px-6 pb-6">
        <div className="pstn-primary flex flex-col">
          {children}
        </div>
      </main>
    </div>
  );
}
