import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, Banknote, ArrowRight, type LucideIcon } from "lucide-react";
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

// One-row financial summary, drawn as a ledger band rather than a card
// (Fieldstone redesign): hairline rules above and below, three columns split
// by thin dividers, the figure in large tabular Inter so the numbers scan.
// The metrics and their labels are exactly what /api/today computes — "Cash
// position" is the 90-day projected-receipts floor, not a monthly cash flow,
// and nothing here is relabelled to look like a different calculation.
/**
 * The strip's title row. Shared by the loading and loaded states so the two
 * are byte-identical above the card — a header that only appears once the
 * data lands is itself a layout shift.
 */
function CashStripHeader() {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="acr-section-h2 text-section-h2">Cash</h2>
      <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
        <Link href="/finance">
          View finance <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

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
    // Shaped like the loaded band — label, figure, caption per column — from
    // the same grid, so the strip does not grow when the data lands.
    return (
      <div data-testid="section-cash-strip">
        <CashStripHeader />
        <div className={BAND} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cellClass(i)}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-28 mt-2" />
              <Skeleton className="h-3 w-20 mt-2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="section-cash-strip">
      <CashStripHeader />
      <dl className={BAND}>
        <Metric
          index={0}
          icon={Banknote}
          label="Cash position"
          value={cashOnHand > 0 ? usd(cashOnHand, { noCents: true }) : "—"}
          caption="90d projected receipts"
          spark={<KpiSparkline data={cashHistory} label="Cash position (90d completed payments per week)" />}
        />
        <Metric
          index={1}
          icon={DollarSign}
          label="Open deals"
          value={openDealsValue > 0 ? dollarsCompact(openDealsValue * 100) : "—"}
          caption={<span className="tabular-nums">{openDealsCount} active</span>}
          spark={<KpiSparkline data={openDealsHistory} label="Open deals value (90d weekly)" />}
        />
        <Metric
          index={2}
          icon={TrendingUp}
          label="Pending payments"
          value={pendingPayments30 > 0 ? usd(pendingPayments30, { noCents: true }) : "—"}
          caption={
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              next 30 days
              {lateCount > 0 && (
                <Badge
                  variant="secondary"
                  className="bg-acr-neg-soft text-acr-neg-soft-ink text-micro py-0 px-1.5 tabular-nums"
                >
                  {lateCount} late
                </Badge>
              )}
            </span>
          }
          spark={<KpiSparkline data={pendingHistory} label="Pending payments next 30d (90d weekly)" />}
        />
      </dl>
    </div>
  );
}

/** Hairline-ruled band; two columns on a phone (the third spans), three from sm. */
const BAND = "grid grid-cols-2 sm:grid-cols-3 border-y border-border";

function cellClass(index: number) {
  return [
    "min-w-0 py-4 sm:py-5",
    index === 0 ? "pr-4 sm:pr-6" : "",
    index === 1 ? "pl-4 sm:px-6 border-l border-border" : "",
    // Third metric: full width under the first two on a phone, its own
    // column from sm.
    index === 2 ? "col-span-2 sm:col-span-1 border-t sm:border-t-0 sm:border-l border-border sm:pl-6" : "",
  ].join(" ");
}

function Metric({
  index,
  icon: Icon,
  label,
  value,
  caption,
  spark,
}: {
  index: number;
  icon: LucideIcon;
  label: string;
  value: string;
  caption: React.ReactNode;
  spark: React.ReactNode;
}) {
  return (
    <div className={cellClass(index)}>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1.5 flex items-end justify-between gap-3">
        <span className="text-2xl md:text-[28px] leading-none font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </span>
        {spark}
      </dd>
      <dd className="mt-1.5 text-caption text-muted-foreground">{caption}</dd>
    </div>
  );
}
