/**
 * /money/cross-vertical — multi-vertical consolidated P&L + W-2 exit
 * calculator. Customer-facing surface for operators running 2+ verticals.
 *
 * Magnus / Imani personas (panel-300 customers-verticals 209/210). Without
 * this view, multi-vertical operators churn to Excel.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrendingUp, Calculator, Calendar } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { SupportFeedbackButton } from "@/components/support-feedback-button";

interface VerticalRow {
  vertical: string;
  revenueCents: number;
  costsCents: number;
  netCents: number;
  trailing30Days: { revenueCents: number; costsCents: number };
}
interface PnL {
  organizationId: number;
  organizationName: string;
  asOf: string;
  verticals: VerticalRow[];
  consolidated: { revenueCents: number; costsCents: number; netCents: number };
  monthlyNetRunRateCents: number;
}
interface Projection {
  achievableMonth: number | null;
  monthsModeled: number;
  finalRunRateCents: number;
  growthRatePct: number;
}

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}
function fmtUsdCents(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}
function verticalLabel(key: string): string {
  return ({ land: "Land", note_investor: "Notes", buy_and_hold: "Property mgmt", fix_and_flipper: "Fix & flip", subdivision: "Subdivision", wholesale: "Wholesale" } as any)[key] ?? key;
}

export default function MultiVerticalPnLPage() {
  useDocumentTitle("Cross-vertical P&L — AcreOS");
  const { toast } = useToast();
  const [w2Income, setW2Income] = useState("8000");
  const [growthRate, setGrowthRate] = useState("5");
  const [projection, setProjection] = useState<Projection | null>(null);

  const pnl = useQuery<PnL>({
    queryKey: ["/api/account/multi-vertical-pnl"],
    queryFn: async () => {
      const r = await fetch("/api/account/multi-vertical-pnl", { credentials: "include" });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
  });

  const projectExit = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/account/multi-vertical-pnl/w2-exit", {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify({
          monthlyW2IncomeCents: Math.round(Number(w2Income) * 100),
          monthlyGrowthRatePct: Number(growthRate),
        }),
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
    onSuccess: (data: any) => setProjection(data.projection),
    onError: (err: any) => toast({ title: "Projection failed", description: err.message, variant: "destructive" }),
  });

  return (
    <PageShell label="Cross-vertical P&L">
      <div className="mb-6 flex items-start gap-3">
        <TrendingUp className="w-7 h-7 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cross-vertical P&L</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Aggregated revenue + costs across every vertical you run. Switch to the W-2-exit projection
            below to model when your AcreOS run-rate covers your day-job income.
          </p>
        </div>
      </div>

      {/* P&L summary */}
      {pnl.isLoading ? (
        <Skeleton className="h-32 mb-6" />
      ) : pnl.data ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Revenue</div>
              <div className="text-lg font-semibold mt-1">{fmtUsdCents(pnl.data.consolidated.revenueCents)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Costs</div>
              <div className="text-lg font-semibold mt-1 text-acr-neg">{fmtUsdCents(pnl.data.consolidated.costsCents)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Net</div>
              <div className={`text-lg font-semibold mt-1 ${pnl.data.consolidated.netCents >= 0 ? "text-acr-pos" : "text-acr-neg"}`}>
                {fmtUsdCents(pnl.data.consolidated.netCents)}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Monthly run-rate
              </div>
              <div className="text-lg font-semibold mt-1">{fmtUsdCents(pnl.data.monthlyNetRunRateCents)}</div>
              <div className="text-micro text-muted-foreground mt-0.5">last 30 days</div>
            </Card>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">By vertical</CardTitle>
              <CardDescription>Breakdown across the verticals you operate. Trailing 30-day numbers feed the run-rate above.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {pnl.data.verticals.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">No vertical activity recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium">Vertical</th>
                      <th className="px-3 py-2 text-right font-medium">Revenue</th>
                      <th className="px-3 py-2 text-right font-medium">Costs</th>
                      <th className="px-3 py-2 text-right font-medium">Net</th>
                      <th className="px-3 py-2 text-right font-medium">Last 30d net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnl.data.verticals.map((v) => (
                      <tr key={v.vertical} className="border-b border-border/40">
                        <td className="px-3 py-2 text-xs font-medium">{verticalLabel(v.vertical)}</td>
                        <td className="px-3 py-2 text-xs text-right font-mono">{fmtUsdCents(v.revenueCents)}</td>
                        <td className="px-3 py-2 text-xs text-right font-mono text-muted-foreground">{fmtUsdCents(v.costsCents)}</td>
                        <td className={`px-3 py-2 text-xs text-right font-mono ${v.netCents >= 0 ? "text-acr-pos" : "text-acr-neg"}`}>
                          {fmtUsdCents(v.netCents)}
                        </td>
                        <td className="px-3 py-2 text-xs text-right font-mono">
                          {fmtUsdCents(v.trailing30Days.revenueCents - v.trailing30Days.costsCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* W-2 exit calculator */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="w-4 h-4" /> W-2 exit calculator
              </CardTitle>
              <CardDescription>
                When does your AcreOS net run-rate cover your day-job income? Adjust your W-2 monthly net + assumed
                monthly growth rate; we project 24 months forward.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="w2">Monthly W-2 net (USD)</Label>
                  <Input id="w2" type="number" inputMode="numeric" value={w2Income} onChange={(e) => setW2Income(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="growth">Assumed monthly growth %</Label>
                  <Input id="growth" type="number" inputMode="numeric" value={growthRate} onChange={(e) => setGrowthRate(e.target.value)} />
                </div>
              </div>
              <Button onClick={() => projectExit.mutate()} disabled={projectExit.isPending}>
                {projectExit.isPending ? "Projecting…" : "Project my W-2 exit"}
              </Button>
              {projection && (
                <div className="mt-2 p-4 rounded-card bg-muted/40">
                  {projection.achievableMonth ? (
                    <p className="text-base font-semibold">
                      Month {projection.achievableMonth} → AcreOS run-rate covers W-2 income.
                    </p>
                  ) : (
                    <p className="text-base font-semibold">
                      Not reachable within {projection.monthsModeled} months at {projection.growthRatePct}% MoM growth.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Final run-rate at month {projection.monthsModeled}: {fmtUsdCents(projection.finalRunRateCents)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="mt-6 text-xs text-muted-foreground">
            P&L numbers reflect your operations across Land deals, Note Investor portfolio, and BH rent payments
            stored in AcreOS. As you add other verticals (FF, W, SD), they'll appear automatically. For a deeper
            historical view, check `/founder/financials` (founder access only) or{" "}
            <SupportFeedbackButton
              variant="link"
              defaultCategory="support"
              source="multi_vertical_pnl"
              ariaLabel="Open a support request about multi-vertical P&L"
              testId="mv-pnl-support"
            >
              open a support request
            </SupportFeedbackButton>
            .
          </p>
        </>
      ) : null}
    </PageShell>
  );
}
