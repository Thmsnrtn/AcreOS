import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, Banknote, ArrowRight } from "lucide-react";
import { usd, dollarsCompact } from "@/lib/format";
import { KpiSparkline } from "./KpiSparkline";

interface CashStripProps {
  isLoading: boolean;
  cashOnHand: number; // dollars; aggregate 30/60/90 projection floor
  openDealsValue: number; // dollars (pipeline value)
  openDealsCount: number;
  pendingPayments30: number; // dollars projected next 30d
  lateCount: number;
}

// 90-day per-KPI history arrives on /api/today.cash.*History. CashStrip pulls
// from the cached payload directly so today.tsx (untouched) doesn't need to
// thread new props. Empty arrays mean "we have no honest history to plot" —
// the sparkline component returns null in that case rather than faking data.
interface CashHistoryPayload {
  cash?: {
    cashHistory?: number[];
    openDealsValueHistory?: number[];
    pendingPayments30History?: number[];
    lateCountHistory?: number[];
  };
}

// One-row financial summary. Tile leaves use a discreet 12px leading icon
// (no saturated rounded background) plus a sparkline against the typical
// range. The "endpoint sparkline" comment historically here referred to a
// /api/dashboard/sparkline route that pre-dated /api/today consolidation;
// we now read history straight off the consolidated payload.
export function CashStrip({
  isLoading,
  cashOnHand,
  openDealsValue,
  openDealsCount,
  pendingPayments30,
  lateCount,
}: CashStripProps) {
  // Shares cache with today.tsx — no extra request.
  const { data: today } = useQuery<CashHistoryPayload>({
    queryKey: ["/api/today"],
    enabled: !isLoading,
  });
  const cashHistory = today?.cash?.cashHistory ?? [];
  const openDealsHistory = today?.cash?.openDealsValueHistory ?? [];
  const pendingHistory = today?.cash?.pendingPayments30History ?? [];

  if (isLoading) {
    return (
      <div data-testid="section-cash-strip">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div data-testid="section-cash-strip">
      <div className="flex items-center justify-between mb-4">
        <h2 className="acr-section-h2 text-section-h2">
          Cash
        </h2>
        <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
          <Link href="/finance">
            View finance <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <Card className="rounded-card shadow-acr-2">
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-6">
          <div className="flex items-start gap-2">
            <Banknote
              className="w-3 h-3 mt-1 shrink-0"
              style={{ color: "var(--acr-ink-3)" }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-caption text-muted-foreground uppercase tracking-wide">
                Cash position
              </p>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-lg font-semibold tabular-nums">
                  {cashOnHand > 0 ? usd(cashOnHand, { noCents: true }) : "—"}
                </p>
                <KpiSparkline
                  data={cashHistory}
                  label="Cash position (90d completed payments per week)"
                />
              </div>
              <p className="text-caption text-muted-foreground">90d projected receipts</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <DollarSign
              className="w-3 h-3 mt-1 shrink-0"
              style={{ color: "var(--acr-ink-3)" }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-caption text-muted-foreground uppercase tracking-wide">
                Open deals
              </p>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-lg font-semibold tabular-nums">
                  {openDealsValue > 0 ? dollarsCompact(openDealsValue * 100) : "—"}
                </p>
                <KpiSparkline
                  data={openDealsHistory}
                  label="Open deals value (90d weekly)"
                />
              </div>
              <p className="text-caption text-muted-foreground tabular-nums">
                {openDealsCount} active
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <TrendingUp
              className="w-3 h-3 mt-1 shrink-0"
              style={{ color: "var(--acr-ink-3)" }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-caption text-muted-foreground uppercase tracking-wide">
                Pending payments
              </p>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-lg font-semibold tabular-nums">
                  {pendingPayments30 > 0 ? usd(pendingPayments30, { noCents: true }) : "—"}
                </p>
                <KpiSparkline
                  data={pendingHistory}
                  label="Pending payments next 30d (90d weekly)"
                />
              </div>
              <p className="text-caption text-muted-foreground tabular-nums inline-flex items-center gap-1">
                next 30 days
                {lateCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-acr-neg-soft text-acr-neg text-micro py-0 px-1.5 tabular-nums"
                  >
                    {lateCount} late
                  </Badge>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
