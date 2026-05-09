/**
 * /founder/financials — ASC 606 + NRR + concentration dashboard.
 *
 * Consumes the FW-MARISOL-2/3 endpoints:
 *   GET  /api/founder/financials/periods?from&to
 *   GET  /api/founder/financials/by-org?period=YYYY-MM
 *   GET  /api/founder/financials/nrr?period=YYYY-MM
 *   POST /api/founder/financials/run-recognition?period=YYYY-MM
 *   GET  /api/founder/financials/subscription-events
 *
 * The page Marisol/Ashok/Harlowe described in their memos: the founder
 * answers "what's our NRR? COGS-per-customer? recognized vs deferred?"
 * in one pane.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrendingUp, AlertTriangle, RefreshCw, DollarSign } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface PeriodTotals {
  periodKeyFrom: string;
  periodKeyTo: string;
  recognizedCents: number;
  deferredCents: number;
  distinctOrgCount: number;
  rowCount: number;
}

interface ByOrgRow {
  id: string;
  organizationId: number | null;
  orgName: string | null;
  tier: string | null;
  billingInterval: string | null;
  source: string;
  recognizedCents: number;
  deferredCents: number;
}

interface NrrResponse {
  periodFrom: string;
  periodTo: string;
  cohortSize: number;
  denominatorCents: number;
  numeratorCents: number;
  nrrPct: number | null;
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function currentPeriodKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function FounderFinancialsPage() {
  useDocumentTitle("Financials — AcreOS");
  const { toast } = useToast();
  const [period, setPeriod] = useState(currentPeriodKey());

  const totals = useQuery<PeriodTotals>({
    queryKey: ["/api/founder/financials/periods", period],
    queryFn: async () => {
      const r = await fetch(`/api/founder/financials/periods?from=${period}&to=${period}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
  });

  const byOrg = useQuery<{ period: string; rows: ByOrgRow[] }>({
    queryKey: ["/api/founder/financials/by-org", period],
    queryFn: async () => {
      const r = await fetch(`/api/founder/financials/by-org?period=${period}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
  });

  const nrr = useQuery<NrrResponse>({
    queryKey: ["/api/founder/financials/nrr", period],
    queryFn: async () => {
      const r = await fetch(`/api/founder/financials/nrr?period=${period}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
  });

  const runRecognition = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/founder/financials/run-recognition?period=${period}`, {
        method: "POST",
        headers: csrf(),
        credentials: "include",
        body: "{}",
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: `Recognition run: ${data.periodKey}`,
        description: `${data.rowsWritten} rows · ${fmtUsd(data.totalRecognizedCents)} recognized · ${fmtUsd(data.totalDeferredCents)} deferred`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/financials/periods", period] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/financials/by-org", period] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/financials/nrr", period] });
    },
    onError: (err: any) =>
      toast({ title: "Recognition failed", description: err.message, variant: "destructive" }),
  });

  // Customer-concentration computed client-side from by-org rows.
  const concentration = useMemo(() => {
    const rows = byOrg.data?.rows ?? [];
    const total = rows.reduce((s, r) => s + (r.recognizedCents ?? 0), 0);
    const top5 = rows.slice(0, 5).map((r) => ({
      ...r,
      sharePct: total > 0 ? Math.round(((r.recognizedCents ?? 0) / total) * 1000) / 10 : 0,
    }));
    return { total, top5, top1Pct: top5[0]?.sharePct ?? 0 };
  }, [byOrg.data]);

  const concentrationFlag = concentration.top1Pct > 20;

  return (
    <PageShell label="Financials">
      <div className="mb-6 flex items-start gap-3">
        <DollarSign className="w-6 h-6 text-primary mt-1" aria-hidden="true" />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Financials</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            ASC 606 recognized + deferred revenue, NRR over the trailing 12
            months, customer concentration. Recognition is idempotent —
            re-run for the period to refresh every row.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            className="border border-border rounded-md px-2 py-1 text-sm bg-background"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label="Period (YYYY-MM)"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => runRecognition.mutate()}
            disabled={runRecognition.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${runRecognition.isPending ? "animate-spin" : ""}`} />
            Run recognition
          </Button>
        </div>
      </div>

      {/* 4-tile summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Recognized {period}</div>
          <div className="text-lg font-semibold mt-1">
            {totals.isLoading ? <Skeleton className="h-5 w-20" /> : fmtUsd(totals.data?.recognizedCents ?? 0)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {totals.data?.distinctOrgCount ?? 0} orgs · {totals.data?.rowCount ?? 0} rows
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Deferred</div>
          <div className="text-lg font-semibold mt-1">
            {totals.isLoading ? <Skeleton className="h-5 w-20" /> : fmtUsd(totals.data?.deferredCents ?? 0)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Annual subs unrecognized</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> NRR (TTM)
          </div>
          <div className="text-lg font-semibold mt-1">
            {nrr.isLoading ? (
              <Skeleton className="h-5 w-16" />
            ) : nrr.data?.nrrPct == null ? (
              <Badge variant="outline" className="text-xs">N/A — cohort empty</Badge>
            ) : (
              `${nrr.data.nrrPct.toFixed(1)}%`
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            cohort {nrr.data?.cohortSize ?? 0} · {nrr.data?.periodFrom ?? "—"} → {nrr.data?.periodTo ?? "—"}
          </div>
        </Card>
        <Card className={`p-3 ${concentrationFlag ? "border-acr-warn/50 bg-acr-warn/5" : ""}`}>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            {concentrationFlag && <AlertTriangle className="w-3 h-3 text-acr-warn" />}
            Top-1 share
          </div>
          <div className={`text-lg font-semibold mt-1 ${concentrationFlag ? "text-acr-warn" : ""}`}>
            {byOrg.isLoading ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              `${concentration.top1Pct.toFixed(1)}%`
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Diligence flag at &gt;20%</div>
        </Card>
      </div>

      {/* Per-org table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">By organization</CardTitle>
            <CardDescription>Per-org recognition for {period}, sorted by recognized desc</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {byOrg.isLoading ? (
            <Skeleton className="h-32 m-4" />
          ) : (byOrg.data?.rows.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No recognition rows for {period} yet — click "Run recognition" to populate.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Organization</th>
                  <th className="px-3 py-2 text-left font-medium">Tier</th>
                  <th className="px-3 py-2 text-left font-medium">Interval</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Recognized</th>
                  <th className="px-3 py-2 text-right font-medium">Deferred</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {byOrg.data?.rows.map((r) => {
                  const share = concentration.total > 0
                    ? ((r.recognizedCents ?? 0) / concentration.total) * 100
                    : 0;
                  return (
                    <tr key={r.id} className="border-b border-border/40">
                      <td className="px-3 py-2 text-xs">{r.orgName ?? `Org #${r.organizationId}`}</td>
                      <td className="px-3 py-2 text-xs">{r.tier ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.billingInterval ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.source}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono">{fmtUsd(r.recognizedCents ?? 0)}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono text-muted-foreground">
                        {fmtUsd(r.deferredCents ?? 0)}
                      </td>
                      <td className={`px-3 py-2 text-xs text-right ${share > 20 ? "text-acr-warn font-semibold" : "text-muted-foreground"}`}>
                        {share.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-4">
        Recognition is idempotent — re-run for any period to overwrite rows
        with current pricing + interval. NRR is computed over the trailing
        12 months and returns N/A until cohort-2 data exists. Customer
        concentration above 20% top-1 share is the Series-A diligence
        trip-wire (Marisol/Ashok/Harlowe consensus).
      </p>
    </PageShell>
  );
}
