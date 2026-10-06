import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, Banknote, ArrowRight } from "lucide-react";
import { usd, dollarsCompact } from "@/lib/format";
import { KpiSparkline } from "./KpiSparkline";

// Each figure is `null` when the server could not compute it — today, when
// the sample-parcel read fails and the real book cannot be split from the
// onboarding sample (server/routes-today.ts `cash.unavailableReason`). A null
// figure is UNKNOWN, not zero: it renders as an explicit unavailable state,
// never "0 active" or "$0". A non-null 0 is a real zero and renders as one.
interface CashStripProps {
  isLoading: boolean;
  cashOnHand: number | null; // dollars; aggregate 30/60/90 projection floor
  openDealsValue: number | null; // dollars (pipeline value)
  openDealsCount: number | null;
  pendingPayments30: number | null; // dollars projected next 30d
  lateCount: number | null;
  /** Why the figures above are null, when they are (machine code from the server). */
  unavailableReason?: string | null;
}

/**
 * Plain-language copy for `cash.unavailableReason`. The server sends a code;
 * the customer reads a sentence. Unknown codes (and a null reason over null
 * figures) get the generic sentence — the raw code is never shown.
 */
export function cashUnavailableCopy(reason: string | null | undefined): string {
  if (reason === "sample_parcels_unreadable") {
    return "Your book couldn't be read just now: sample parcels couldn't be told apart from your own, so these figures are withheld rather than guessed.";
  }
  return "These figures couldn't be read just now, so they're withheld rather than guessed.";
}

/**
 * The visible "—" for a figure that could not be read, with an accessible
 * name that says so. `data-cash-figure-state` lets a test (or a reviewer)
 * tell an unread figure from a real zero, which also renders "—" for the
 * money tiles.
 */
function UnavailableFigure({ figure, label, reason }: { figure: string; label: string; reason: string }) {
  return (
    <span data-cash-figure={figure} data-cash-figure-state="unavailable" title={reason}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label} unavailable</span>
    </span>
  );
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
  unavailableReason = null,
}: CashStripProps) {
  // Shares cache with today.tsx — no extra request.
  const { data: today } = useQuery<CashHistoryPayload>({
    queryKey: ["/api/today"],
    enabled: !isLoading,
  });
  const cashHistory = today?.cash?.cashHistory ?? [];
  const openDealsHistory = today?.cash?.openDealsValueHistory ?? [];
  const pendingHistory = today?.cash?.pendingPayments30History ?? [];
  const anyUnavailable =
    cashOnHand === null ||
    openDealsValue === null ||
    openDealsCount === null ||
    pendingPayments30 === null ||
    lateCount === null;
  const reasonCopy = cashUnavailableCopy(unavailableReason);

  if (isLoading) {
    // Shaped, not a block. This stood in for a three-column KPI card — icon,
    // label, value, sparkline and caption per column — with a single
    // `h-24 w-full`, so the strip grew on every Today load and pushed the
    // queue below it down. The header is real text and renders immediately
    // rather than being skeletoned at all; only the card's contents are
    // unknown. Geometry comes from the same Card / CardContent / grid the
    // loaded state uses, so it cannot drift.
    return (
      <div data-testid="section-cash-strip">
        <CashStripHeader />
        <Card className="rounded-card shadow-acr-2" aria-hidden="true">
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-2">
                <Skeleton className="w-3 h-3 mt-1 shrink-0 rounded-sm" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3 w-24" />
                  <div className="flex items-baseline justify-between gap-2 mt-1">
                    <Skeleton className="h-[22px] w-20" />
                    <Skeleton className="h-6 w-16 rounded-sm" />
                  </div>
                  <Skeleton className="h-3 w-28 mt-1" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="section-cash-strip">
      <CashStripHeader />
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
                  {cashOnHand === null ? (
                    <UnavailableFigure figure="cashOnHand" label="Cash position" reason={reasonCopy} />
                  ) : cashOnHand > 0 ? (
                    usd(cashOnHand, { noCents: true })
                  ) : (
                    "—"
                  )}
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
                  {openDealsValue === null ? (
                    <UnavailableFigure figure="openDealsValue" label="Open deals value" reason={reasonCopy} />
                  ) : openDealsValue > 0 ? (
                    dollarsCompact(openDealsValue * 100)
                  ) : (
                    "—"
                  )}
                </p>
                <KpiSparkline
                  data={openDealsHistory}
                  label="Open deals value (90d weekly)"
                />
              </div>
              <p className="text-caption text-muted-foreground tabular-nums">
                {openDealsCount === null ? (
                  <span data-cash-figure="openDealsCount" data-cash-figure-state="unavailable" title={reasonCopy}>
                    count unavailable
                  </span>
                ) : (
                  <>{openDealsCount} active</>
                )}
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
                  {pendingPayments30 === null ? (
                    <UnavailableFigure figure="pendingPayments30" label="Pending payments" reason={reasonCopy} />
                  ) : pendingPayments30 > 0 ? (
                    usd(pendingPayments30, { noCents: true })
                  ) : (
                    "—"
                  )}
                </p>
                <KpiSparkline
                  data={pendingHistory}
                  label="Pending payments next 30d (90d weekly)"
                />
              </div>
              <p className="text-caption text-muted-foreground tabular-nums inline-flex items-center gap-1">
                next 30 days
                {lateCount !== null && lateCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-acr-neg-soft text-acr-neg-soft-ink text-micro py-0 px-1.5 tabular-nums"
                  >
                    {lateCount} late
                  </Badge>
                )}
              </p>
            </div>
          </div>
          {anyUnavailable && (
            <p
              role="status"
              data-testid="cash-strip-unavailable"
              className="sm:col-span-3 text-caption text-muted-foreground"
            >
              {reasonCopy}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
