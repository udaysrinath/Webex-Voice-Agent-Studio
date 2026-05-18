import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
} from "lucide-react";
import { webexDemoApi, type WebexDemoSessionResult } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function DemoSetup() {
  const [webexEmail, setWebexEmail] = useState("");

  const setupMutation = useMutation({
    mutationFn: webexDemoApi.setupSession,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setupMutation.mutate({
      webexEmail,
    });
  }

  const result = setupMutation.data;
  const isDisabled = setupMutation.isPending || !webexEmail.trim();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-white/10 bg-background/95">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" aria-label="Back">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Webex Demo Setup</h1>
              <p className="text-sm text-muted-foreground">Cisco Live voice agent session target</p>
            </div>
          </div>
          <Badge variant="outline">Webex email</Badge>
        </div>
      </div>

      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
        <Card className="border-white/10 bg-card/50 p-6">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <h2 className="text-lg font-semibold">Connect Webex Recipient</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The server-owned Webex token creates the room from this email and posts confirmations there.
              </p>
            </div>

            <div className="max-w-xl">
              <div className="space-y-2">
                <Label htmlFor="webex-email">Webex email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="webex-email"
                    type="email"
                    value={webexEmail}
                    onChange={(event) => setWebexEmail(event.target.value)}
                    className="pl-9"
                    placeholder="person@example.com"
                    autoComplete="email"
                    data-testid="input-webex-email"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                No tester access token is needed.
              </p>
              <Button type="submit" disabled={isDisabled} data-testid="button-create-webex-session">
                {setupMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                Connect Webex Room
              </Button>
            </div>
          </form>
        </Card>

        {setupMutation.isError && (
          <Alert variant="destructive" data-testid="alert-webex-session-error">
            <AlertTitle>Webex setup failed</AlertTitle>
            <AlertDescription>{setupMutation.error.message}</AlertDescription>
          </Alert>
        )}

        {result && <SetupResult result={result} />}
      </main>
    </div>
  );
}

function SetupResult({ result }: { result: WebexDemoSessionResult }) {
  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5 p-6" data-testid="card-webex-session-result">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Demo room connected</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.createdRoom ? "Created" : "Reused"} room and{" "}
              {result.membershipStatus === "added" ? "added" : "confirmed"} {result.webexEmail}.
            </p>
          </div>
        </div>
        <Badge className="w-fit bg-emerald-500/20 text-emerald-100" variant="outline">
          Active target
        </Badge>
      </div>

      <dl className="mt-5 grid gap-4 text-sm md:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Room title</dt>
          <dd className="mt-1 break-words font-medium">{result.roomTitle}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Room ID</dt>
          <dd className="mt-1 break-all font-mono text-xs">{result.roomId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Webex recipient</dt>
          <dd className="mt-1 font-medium">{result.webexEmail}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Smoke message</dt>
          <dd className="mt-1 font-medium">{result.messageSent ? "Sent" : "Not sent"}</dd>
        </div>
      </dl>
    </Card>
  );
}
