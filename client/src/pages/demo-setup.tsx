import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
} from "lucide-react";
import { demoCustomerApi, type DemoCustomerSessionResult } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function DemoSetup() {
  const [customerEmail, setCustomerEmail] = useState("");

  const setupMutation = useMutation({
    mutationFn: demoCustomerApi.setupSession,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setupMutation.mutate({
      customerEmail,
    });
  }

  const result = setupMutation.data;
  const isDisabled = setupMutation.isPending || !customerEmail.trim();

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
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Customer Demo Setup</h1>
              <p className="text-sm text-muted-foreground">Cisco Live customer contact target</p>
            </div>
          </div>
          <Badge variant="outline">Customer email</Badge>
        </div>
      </div>

      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
        <Card className="border-white/10 bg-card/50 p-6">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <h2 className="text-lg font-semibold">Set Customer Email</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This configures the customer email used when email delivery is selected. Spoken confirmation wording defaults to SMS.
              </p>
            </div>

            <div className="max-w-xl">
              <div className="space-y-2">
                <Label htmlFor="customer-email">Customer email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="customer-email"
                    type="email"
                    value={customerEmail}
                    onChange={(event) => setCustomerEmail(event.target.value)}
                    className="pl-9"
                    placeholder="customer@example.com"
                    autoComplete="email"
                    data-testid="input-customer-email"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                The manager Webex room is fixed by server configuration.
              </p>
              <Button type="submit" disabled={isDisabled} data-testid="button-create-customer-session">
                {setupMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Save Customer Email
              </Button>
            </div>
          </form>
        </Card>

        {setupMutation.isError && (
          <Alert variant="destructive" data-testid="alert-customer-session-error">
            <AlertTitle>Customer setup failed</AlertTitle>
            <AlertDescription>{setupMutation.error.message}</AlertDescription>
          </Alert>
        )}

        {result && <SetupResult result={result} />}
      </main>
    </div>
  );
}

function SetupResult({ result }: { result: DemoCustomerSessionResult }) {
  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5 p-6" data-testid="card-customer-session-result">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Customer email saved</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.customerEmail} is saved for the customer confirmation flow.
            </p>
          </div>
        </div>
        <Badge className="w-fit bg-emerald-500/20 text-emerald-100" variant="outline">
          Customer target
        </Badge>
      </div>

      <dl className="mt-5 grid gap-4 text-sm md:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Customer email</dt>
          <dd className="mt-1 break-words font-medium">{result.customerEmail}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Email webhook</dt>
          <dd className="mt-1 font-medium">{result.emailConfigured ? "Configured" : "Not configured"}</dd>
        </div>
      </dl>
    </Card>
  );
}
