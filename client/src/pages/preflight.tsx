import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  PlayCircle,
  RefreshCcw,
  Save,
  Settings,
  XCircle,
} from "lucide-react";
import { demoApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Preflight() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [webexSpaceId, setWebexSpaceId] = useState("");

  const preflightQuery = useQuery({
    queryKey: ["demo-preflight"],
    queryFn: demoApi.getPreflight,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (preflightQuery.data?.config.webexSpaceId !== undefined) {
      setWebexSpaceId(preflightQuery.data.config.webexSpaceId);
    }
  }, [preflightQuery.data?.config.webexSpaceId]);

  const saveConfig = useMutation({
    mutationFn: () => demoApi.updateConfig({ webexSpaceId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["demo-preflight"] });
      toast({ title: "Demo config saved" });
    },
    onError: (error: Error) => {
      toast({
        title: "Demo config save failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const runScenarios = useMutation({
    mutationFn: demoApi.runScenarios,
    onError: (error: Error) => {
      toast({
        title: "Scenario run failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const preflight = preflightQuery.data;
  const scenarioRun = runScenarios.data;
  const isBusy = preflightQuery.isFetching || saveConfig.isPending || runScenarios.isPending;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-white/10 bg-background/95">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")} aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
              <Settings className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold leading-tight">Demo Preflight</h1>
              <p className="text-sm text-muted-foreground">Runtime setup for the Cisco Live voice agent demo</p>
            </div>
          </div>
          <Badge variant={preflight?.ready ? "default" : "outline"}>
            {preflight?.ready ? "Ready" : "Needs attention"}
          </Badge>
        </div>
      </div>

      <main className="mx-auto grid max-w-5xl gap-5 px-6 py-6">
        <Card className="rounded-lg border-white/10 bg-card/60 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Runtime Webex Room</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="webex-space-id">
                Room ID
              </label>
              <Input
                id="webex-space-id"
                value={webexSpaceId}
                onChange={(event) => setWebexSpaceId(event.target.value)}
                placeholder="Paste the demo Webex room ID"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Saved runtime values override the profile room for new calls. Active calls keep the room they started with.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => saveConfig.mutate()} disabled={isBusy}>
                <Save className="w-4 h-4" />
                Save
              </Button>
              <Button variant="outline" onClick={() => preflightQuery.refetch()} disabled={isBusy}>
                <RefreshCcw className="w-4 h-4" />
                Rerun
              </Button>
              {preflight?.config.source && (
                <span className="text-sm text-muted-foreground">
                  Source: {preflight.config.source}
                  {preflight.config.updatedAt ? `, updated ${new Date(preflight.config.updatedAt).toLocaleTimeString()}` : ""}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg border-white/10 bg-card/60 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Checks</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {preflightQuery.isLoading && (
              <div className="flex items-center gap-3 rounded-lg border border-white/10 p-4 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                Running preflight checks...
              </div>
            )}
            {preflightQuery.error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {(preflightQuery.error as Error).message}
              </div>
            )}
            {preflight?.checks.map((check) => (
              <div
                key={check.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-white/10 bg-background/50 p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {check.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive" />
                    )}
                    {check.label}
                  </div>
                  <div className="mt-1 break-words text-sm text-muted-foreground">{check.detail}</div>
                </div>
                <Badge variant={check.ok ? "default" : "outline"}>{check.ok ? "OK" : "Fix"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-lg border-white/10 bg-card/60 shadow-none">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">Scenario Runner</CardTitle>
              <Button onClick={() => runScenarios.mutate()} disabled={isBusy}>
                <PlayCircle className="w-4 h-4" />
                Run
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {runScenarios.isPending && (
              <div className="flex items-center gap-3 rounded-lg border border-white/10 p-4 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                Running backend scenarios...
              </div>
            )}
            {scenarioRun && (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <Badge variant={scenarioRun.passed ? "default" : "outline"}>
                  {scenarioRun.summary.passed}/{scenarioRun.summary.total} passed
                </Badge>
                <span>Last run {new Date(scenarioRun.ranAt).toLocaleTimeString()}</span>
              </div>
            )}
            {scenarioRun?.results.map((result) => (
              <div
                key={result.id}
                className="grid gap-2 rounded-lg border border-white/10 bg-background/50 p-4 md:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {result.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive" />
                    )}
                    {result.label}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{result.expected}</div>
                  <div className="mt-2 break-words text-sm text-muted-foreground">{result.actual}</div>
                </div>
                <div className="flex items-start justify-between gap-3 md:justify-end">
                  <Badge variant={result.passed ? "default" : "outline"}>{result.passed ? "OK" : "Fail"}</Badge>
                  <span className="text-xs text-muted-foreground">{result.durationMs}ms</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
