/**
 * /founder/admin/costs — the unified Costs & economics instrument.
 *
 * Founder-nav consolidation (Phase 2): seven separate cost/economics routes
 * (/founder/cost, /ai-costs, /cost-optimizer, /unit-economics,
 * /observability-cost, /providers, /paid-data-eval) collapsed into one tabbed
 * hub under the /founder/admin/* deliberate-instrument namespace. Each tab
 * renders the original page's shell-less *Content component verbatim — zero
 * behavior change, one PageShell, one nav entry instead of seven.
 *
 * Deep-link a tab with ?tab=<value> (e.g. ?tab=ai-spend) so the command palette
 * and bookmarks can land directly on a sub-view.
 */
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";

import { CostContent } from "@/pages/founder/cost";
import { AiCostsContent } from "@/pages/founder/ai-costs";
import { CostOptimizerContent } from "@/pages/founder/cost-optimizer";
import { UnitEconomicsContent } from "@/pages/founder/unit-economics";
import { ObservabilityCostContent } from "@/pages/founder/observability-cost";
import { ProvidersContent } from "@/pages/founder-providers";
import { PaidDataEvalContent } from "@/pages/founder/paid-data-eval";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "ai-spend", label: "AI spend" },
  { value: "optimizer", label: "Optimizer" },
  { value: "unit-economics", label: "Unit economics" },
  { value: "sentry", label: "Observability" },
  { value: "providers", label: "Providers" },
  { value: "paid-data", label: "Paid-data trial" },
] as const;

// ─── Outreach stop-loss (founder rulings #4/#5, 2026-07-28) ──────────────────
// The monthly mail+data spend line that pauses outreach until the founder
// looks. Status from GET /api/founder/autopilot/stop-loss; the resume button
// is the founder's "I've looked — resume this month" tap. Honest states
// throughout: an unreadable ledger says so (and blocks resume) — never a
// fabricated zero.

interface StopLossStatus {
  lineCents: number;
  mtdSpendCents: number | null;
  mailCents: number | null;
  dataCents: number | null;
  paused: boolean;
  reason: string;
  monthKey: string;
  acknowledgedAtCents: number | null;
  effectiveThresholdCents: number | null;
}

const STOP_LOSS_KEY = ["/api/founder/autopilot/stop-loss"];

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function OutreachStopLossCard() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const query = useQuery<StopLossStatus>({
    queryKey: STOP_LOSS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/stop-loss", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load stop-loss status (${res.status})`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const resume = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/autopilot/stop-loss/resume", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.message ?? `Couldn't resume (${res.status})`);
      }
      return body as { ok: boolean; message: string };
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: STOP_LOSS_KEY });
      toast({ title: "Outreach resumed", description: data.message });
    },
    onError: (err) =>
      toast({
        title: "Couldn't resume",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  if (query.isLoading) {
    return (
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="flex items-center gap-6">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (query.error) {
    return (
      <QueryErrorState
        error={query.error instanceof Error ? query.error : new Error(String(query.error))}
        onRetry={() => query.refetch()}
        title="Could not load the outreach stop-loss status"
        compact
        className="mb-4"
      />
    );
  }

  const s = query.data;
  if (!s) return null;

  const ledgerUnreadable = s.mtdSpendCents == null;

  return (
    <Card className="mb-4" data-testid="outreach-stop-loss-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Outreach stop-loss</CardTitle>
          <Badge variant={s.paused ? "destructive" : "secondary"}>
            {s.paused ? "Paused" : "Running"}
          </Badge>
        </div>
        <CardDescription>
          Monthly mail + data spend line ({s.monthKey}) — crossing it pauses outreach until you look.
          The line is yours to raise from Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <div className="text-xs text-muted-foreground">Your line</div>
            <div className="text-lg font-semibold tabular-nums">{usd(s.lineCents)}/mo</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Spent this month (mail + data)</div>
            <div className="text-lg font-semibold tabular-nums">
              {ledgerUnreadable ? "Unreadable" : usd(s.mtdSpendCents!)}
            </div>
            {!ledgerUnreadable && s.mailCents != null && s.dataCents != null && (
              <div className="text-xs text-muted-foreground tabular-nums">
                mail {usd(s.mailCents)} · data {usd(s.dataCents)}
              </div>
            )}
          </div>
          {s.effectiveThresholdCents != null && (
            <div>
              <div className="text-xs text-muted-foreground">Pauses at</div>
              <div className="text-lg font-semibold tabular-nums">{usd(s.effectiveThresholdCents)}</div>
            </div>
          )}
        </div>

        <p className="text-sm text-muted-foreground">{s.reason}</p>

        {s.paused && !ledgerUnreadable && (
          <Button
            size="sm"
            onClick={() => resume.mutate()}
            disabled={resume.isPending}
          >
            {resume.isPending ? "Resuming…" : "I've looked — resume this month"}
          </Button>
        )}
        {s.paused && ledgerUnreadable && (
          <p className="text-sm text-muted-foreground">
            Resume is unavailable while the spend ledger is unreadable — resuming would mean spending
            blind. Outreach stays paused until the ledger read recovers.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function FounderAdminCostsPage() {
  useDocumentTitle("Costs & economics — AcreOS");
  const search = useSearch();
  const requested = new URLSearchParams(search).get("tab");
  const initial = TABS.some((t) => t.value === requested) ? requested! : "overview";

  return (
    <PageShell label="Costs & economics">
      <OutreachStopLossCard />
      <Tabs defaultValue={initial} className="w-full">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview"><CostContent /></TabsContent>
        <TabsContent value="ai-spend"><AiCostsContent /></TabsContent>
        <TabsContent value="optimizer"><CostOptimizerContent /></TabsContent>
        <TabsContent value="unit-economics"><UnitEconomicsContent /></TabsContent>
        <TabsContent value="sentry"><ObservabilityCostContent /></TabsContent>
        <TabsContent value="providers"><ProvidersContent /></TabsContent>
        <TabsContent value="paid-data"><PaidDataEvalContent /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
