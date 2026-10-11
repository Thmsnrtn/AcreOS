/**
 * Guided A2P 10DLC registration (W5b, Settings → Integrations).
 *
 * The org registers ITS OWN brand and campaign with ITS OWN SMS provider —
 * AcreOS never registers on its account for a customer. This guide shows what
 * is connected, the exact fields the provider asks for (shared/sms/
 * a2p10dlc.ts), and the registration status: read from the provider where
 * AcreOS reads it (Twilio), otherwise as the customer reports it, labelled
 * "self-reported". Until the registration is confirmed, texts to owners are
 * refused at send (server/services/smsService.ts sendOrgSMS).
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { A2P_10DLC_STEPS, A2P_SOURCE_LABELS, A2P_STATUSES, type A2pStatus, type A2pStatusSource } from "@shared/sms/a2p10dlc";

interface A2pResponse {
  connected: null | { provider: string; phoneNumber: string; numberKind: string | null; readableByAcreOS: boolean };
  registration: null | {
    provider: string;
    numberKind: string;
    phoneNumber: string | null;
    brandStatus: A2pStatus;
    campaignStatus: A2pStatus;
    statusSource: A2pStatusSource;
    checkedAt: string;
    providerDetail: { note?: string | null; errors?: unknown[] } | null;
  };
  sendVerdict: { allowed: boolean; reason?: string };
}

const STATUS_LABEL: Record<A2pStatus, string> = {
  not_started: "Not started",
  pending: "In review",
  approved: "Approved",
  failed: "Rejected",
};

const KEY = ["/api/sms/a2p-registration"];

export function A2pRegistrationGuide() {
  const { toast } = useToast();
  const q = useQuery<A2pResponse>({ queryKey: KEY });
  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/sms/a2p-registration/refresh", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      toast({ title: "Registration checked with your provider" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't check the registration", description: err.message }),
  });
  const [form, setForm] = useState({ provider: "", phoneNumber: "", brandStatus: "pending" as A2pStatus, campaignStatus: "pending" as A2pStatus });
  const report = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/sms/a2p-registration/self-report", form)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      toast({ title: "Saved — labelled as self-reported" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't save", description: err.message }),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2" data-testid="a2p-guide-loading">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.error) return <QueryErrorState error={q.error as Error} onRetry={() => q.refetch()} compact />;
  const data = q.data!;
  const reg = data.registration;
  const canRead = Boolean(data.connected?.readableByAcreOS);

  return (
    <Card className="rounded-card" data-testid="a2p-guide">
      <CardHeader>
        <CardTitle className="text-section-h2">Text-message registration (A2P 10DLC)</CardTitle>
        <CardDescription>
          US carriers block business texts from a number whose brand and campaign aren&apos;t registered. You register
          your own business with your own SMS provider; AcreOS never registers on its account for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 1. What is connected */}
        <section aria-labelledby="a2p-connected" className="space-y-1">
          <h3 id="a2p-connected" className="text-sm font-semibold">1. Your SMS provider</h3>
          {data.connected ? (
            <p className="text-sm" data-testid="a2p-connected">
              {data.connected.provider === "twilio" ? "Twilio" : data.connected.provider}, sending from {data.connected.phoneNumber}
              {data.connected.numberKind === "toll_free" ? " (a toll-free number: it needs toll-free verification instead of 10DLC)" : ""}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="a2p-not-connected">
              No SMS provider of your own is connected.{" "}
              <Link href="/settings/byok" className="underline">Connect your Twilio account</Link>, or record a registration you
              made with another provider below.
            </p>
          )}
        </section>

        {/* 2. Status */}
        <section aria-labelledby="a2p-status" className="space-y-2">
          <h3 id="a2p-status" className="text-sm font-semibold">2. Registration status</h3>
          {reg ? (
            <div className="text-sm space-y-1" data-testid="a2p-status">
              <div className="flex flex-wrap gap-2 items-center">
                {reg.numberKind !== "toll_free" && <Badge variant="outline">Brand: {STATUS_LABEL[reg.brandStatus]}</Badge>}
                <Badge variant="outline">
                  {reg.numberKind === "toll_free" ? "Toll-free verification" : "Campaign"}: {STATUS_LABEL[reg.campaignStatus]}
                </Badge>
                <Badge variant={reg.statusSource === "self_reported" ? "secondary" : "outline"} data-testid="a2p-status-source">
                  {A2P_SOURCE_LABELS[reg.statusSource]}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {reg.statusSource === "provider_api" ? "Checked" : "Reported"} {formatDateTime(reg.checkedAt)}
                {reg.phoneNumber ? ` · ${reg.phoneNumber}` : ""}
                {reg.providerDetail?.note ? ` · ${reg.providerDetail.note}` : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="a2p-status-none">Nothing on file yet.</p>
          )}
          <p className={`text-sm ${data.sendVerdict.allowed ? "text-acr-pos" : "text-acr-warn"}`} role="status" data-testid="a2p-send-verdict">
            {data.sendVerdict.allowed ? "Texts to owners can go out." : `Texts to owners are held: ${data.sendVerdict.reason}.`}
          </p>
          {canRead && (
            <Button className="min-h-11 pointer-fine:sm:min-h-9" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-a2p-refresh">
              Check with my provider
            </Button>
          )}
        </section>

        {/* 3. Exact fields */}
        <section aria-labelledby="a2p-fields" className="space-y-3">
          <h3 id="a2p-fields" className="text-sm font-semibold">3. What your provider will ask for</h3>
          {A2P_10DLC_STEPS.map((step) => (
            <details key={step.id} className="rounded-md border p-3" data-testid={`a2p-step-${step.id}`}>
              <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                {step.title}
              </summary>
              <p className="text-xs text-muted-foreground mt-2">{step.why}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {step.fields.map((f) => (
                  <li key={f.attribute}>
                    {f.label}
                    <span className="text-xs text-muted-foreground">
                      {" "}· <code>{f.attribute}</code>
                      {f.required === "yes" ? " · required" : f.required === "if_applicable" ? " · if it applies" : " · optional"}
                      {f.note ? ` · ${f.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <p className="text-xs text-muted-foreground">
            Field names are Twilio&apos;s; other providers register with The Campaign Registry and ask for the same facts.
          </p>
        </section>

        {/* 4. Self-report (only where AcreOS can't read the provider) */}
        {!canRead && (
          <section aria-labelledby="a2p-report" className="space-y-3" data-testid="a2p-self-report">
            <h3 id="a2p-report" className="text-sm font-semibold">4. Record your registration</h3>
            <p className="text-xs text-muted-foreground">
              AcreOS can&apos;t read this provider&apos;s registration, so it takes your word for it and labels it
              &ldquo;self-reported&rdquo; everywhere it is shown.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="a2p-provider">Provider</Label>
                <Input id="a2p-provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="e.g. Telnyx" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="a2p-number">Number you text from</Label>
                <Input id="a2p-number" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+1 512 555 0100" inputMode="tel" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="a2p-brand">Brand status</Label>
                <Select value={form.brandStatus} onValueChange={(v) => setForm({ ...form, brandStatus: v as A2pStatus })}>
                  <SelectTrigger id="a2p-brand"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {A2P_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="a2p-campaign">Campaign (or toll-free verification) status</Label>
                <Select value={form.campaignStatus} onValueChange={(v) => setForm({ ...form, campaignStatus: v as A2pStatus })}>
                  <SelectTrigger id="a2p-campaign"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {A2P_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="min-h-11 pointer-fine:sm:min-h-9" onClick={() => report.mutate()} disabled={report.isPending || !form.provider || !form.phoneNumber} data-testid="button-a2p-self-report">
              Save as self-reported
            </Button>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
