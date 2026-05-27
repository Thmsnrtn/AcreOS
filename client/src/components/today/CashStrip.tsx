import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, Banknote, ArrowRight } from "lucide-react";
import { usd, dollarsCompact } from "@/lib/format";

interface CashStripProps {
  isLoading: boolean;
  cashOnHand: number; // dollars; aggregate 30/60/90 projection floor
  openDealsValue: number; // dollars (pipeline value)
  openDealsCount: number;
  pendingPayments30: number; // dollars projected next 30d
  lateCount: number;
}

// One-row financial summary. Replaces Business pulse + Cash position
// sections. Sparkline endpoint wired in 716f3ee9 remains available for
// future enrichment — current strip surfaces three numbers + late count.
export function CashStrip({
  isLoading,
  cashOnHand,
  openDealsValue,
  openDealsCount,
  pendingPayments30,
  lateCount,
}: CashStripProps) {
  if (isLoading) {
    return (
      <div data-testid="section-cash-strip">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div data-testid="section-cash-strip">
      <div className="flex items-center justify-between mb-3">
        <h2 className="acr-eyebrow" style={{ color: "var(--acr-ink-3)" }}>
          Cash strip
        </h2>
        <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
          <Link href="/finance">
            View finance <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <Card>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-card bg-acr-pos-soft shrink-0">
              <Banknote className="w-4 h-4 text-acr-pos" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground uppercase tracking-wide">Cash position</p>
              <p className="text-lg font-semibold tabular-nums">
                {cashOnHand > 0 ? usd(cashOnHand, { noCents: true }) : "—"}
              </p>
              <p className="text-caption text-muted-foreground">90d projected receipts</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-card bg-primary/10 shrink-0">
              <DollarSign className="w-4 h-4 text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground uppercase tracking-wide">Open deals</p>
              <p className="text-lg font-semibold tabular-nums">
                {openDealsValue > 0 ? dollarsCompact(openDealsValue * 100) : "—"}
              </p>
              <p className="text-caption text-muted-foreground tabular-nums">
                {openDealsCount} active
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-card bg-acr-warn-soft shrink-0">
              <TrendingUp className="w-4 h-4 text-acr-warn" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground uppercase tracking-wide">Pending payments</p>
              <p className="text-lg font-semibold tabular-nums">
                {pendingPayments30 > 0 ? usd(pendingPayments30, { noCents: true }) : "—"}
              </p>
              <p className="text-caption text-muted-foreground tabular-nums inline-flex items-center gap-1">
                next 30 days
                {lateCount > 0 && (
                  <Badge variant="secondary" className="bg-acr-neg-soft text-acr-neg text-micro py-0 px-1.5 tabular-nums">
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
