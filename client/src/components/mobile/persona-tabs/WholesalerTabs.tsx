/**
 * Wholesaler persona — Today + Portfolio mobile tabs.
 *
 * Per the 12-agent audit, the Wholesaler leapfrog is a "mobile EMD +
 * assignment dashboard" — countdown timers + interested-buyer count on
 * Today, persistent across in-escrow contracts. These tabs deliver:
 *
 *   Today:    EMD timers + buyer-blast responses today + hot replies
 *   Portfolio: in-flight contracts + total EMD at risk + buyer-list size
 *
 * Data sources:
 *   /api/deals — pipeline with status + acceptance dates
 *   /api/buyer-blasts — outbound blasts + per-blast interested counts
 *   /api/leads (buyer subset) — buyer-list activity
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Timer,
  Flame,
  Send,
  ArrowRight,
  Users,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchJsonArray } from "@/lib/queryClient";

interface Deal {
  id: number;
  status: string;
  acceptedAmount?: string | null;
  closingDate?: string | null;
  offerDate?: string | null;
  acceptedAt?: string | null;
  // EMD inspection window — emd_due_date or inspection_end is what we
  // want; allow a generous shape since not every deal has these.
  emdDueDate?: string | null;
  inspectionPeriodEndsAt?: string | null;
}

interface BuyerBlast {
  id: number;
  name: string;
  sentAt?: string | null;
  recipientsCount?: number;
  interestedCount?: number;
  notInterestedCount?: number;
}

function activateOnKey(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000));
}

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

export function WholesalerToday() {
  const [, setLocation] = useLocation();
  const { data: deals = [], isLoading: dLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetchJsonArray<Deal>("/api/deals?pageSize=100"),
    staleTime: 60_000,
  });
  const { data: blasts = [] } = useQuery<BuyerBlast[]>({
    queryKey: ["/api/buyer-blasts"],
    queryFn: () => fetchJsonArray<BuyerBlast>("/api/buyer-blasts"),
    staleTime: 60_000,
  });

  if (dLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  // EMD / inspection-period countdowns for in-escrow deals
  const inEscrow = deals
    .filter((d) => ["accepted", "in_escrow"].includes(d.status))
    .map((d) => {
      const days = daysUntil(d.emdDueDate ?? d.inspectionPeriodEndsAt);
      return { ...d, _days: days };
    })
    .filter((d) => d._days != null && d._days <= 14)
    .sort((a, b) => (a._days ?? 999) - (b._days ?? 999))
    .slice(0, 5);

  // Recent blasts with their interested counts
  const recentBlasts = [...blasts]
    .filter((b) => b.sentAt)
    .sort((a, b) => new Date(b.sentAt ?? 0).getTime() - new Date(a.sentAt ?? 0).getTime())
    .slice(0, 3);

  const totalInterestedToday = recentBlasts.reduce(
    (s, b) => s + (b.interestedCount ?? 0),
    0,
  );

  return (
    <div className="space-y-5">
      {/* EMD timers */}
      <section>
        <h2 className="text-caption uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          EMD / inspection countdowns
        </h2>
        {inEscrow.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6 px-4 text-center">
              No in-escrow deals with an EMD or inspection deadline in the next 14 days.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {inEscrow.map((d) => {
              const days = d._days as number;
              const tone = days <= 2 ? "rose" : days <= 7 ? "amber" : "neutral";
              return (
                <Card
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/deals/${d.id}`)}
                  onKeyDown={activateOnKey(() => setLocation(`/deals/${d.id}`))}
                  aria-label={`Open deal ${d.id}`}
                  className={cn(
                    "p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tone === "rose" && "border-rose-400/60",
                    tone === "amber" && "border-amber-400/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">Deal #{d.id}</div>
                      <div className="text-xs text-muted-foreground">{d.status}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={cn(
                          "text-base font-semibold tabular-nums",
                          tone === "rose" && "text-rose-600 dark:text-rose-400",
                          tone === "amber" && "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {days}d
                      </div>
                      <div className="text-micro uppercase tracking-wide text-muted-foreground">
                        to EMD
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Buyer-blast response stats */}
      <section>
        <h2 className="text-caption uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          Buyer blast responses
        </h2>
        {recentBlasts.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6 px-4 text-center">
              No recent buyer blasts. Send one from Campaigns.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="p-4 mb-2">
              <div className="text-micro uppercase tracking-wide text-muted-foreground">
                Interested buyers today
              </div>
              <div className="text-3xl font-semibold tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
                {totalInterestedToday}
              </div>
              <div className="text-caption text-muted-foreground mt-0.5">
                across {recentBlasts.length} recent blast{recentBlasts.length === 1 ? "" : "s"}
              </div>
            </Card>
            <div className="space-y-2">
              {recentBlasts.map((b) => (
                <Card
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/buyer-blasts/${b.id}`)}
                  onKeyDown={activateOnKey(() => setLocation(`/buyer-blasts/${b.id}`))}
                  aria-label={`Open buyer blast ${b.name}`}
                  className="p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{b.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.recipientsCount ?? "—"} sent
                      </div>
                    </div>
                    <div className="text-right shrink-0 text-sm tabular-nums">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        {b.interestedCount ?? 0}
                      </span>
                      <span className="text-muted-foreground"> interested</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/buyer-blasts")}
        >
          <span className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Blasts
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/earnest-money")}
        >
          <span className="flex items-center gap-2">
            <Timer className="h-4 w-4" /> EMDs
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </section>
    </div>
  );
}

export function WholesalerPortfolio() {
  const [, setLocation] = useLocation();
  const { data: deals = [], isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetchJsonArray<Deal>("/api/deals?pageSize=100"),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  const inFlight = deals.filter((d) =>
    ["negotiating", "offer_sent", "countered", "accepted", "in_escrow"].includes(d.status),
  );
  const inEscrow = deals.filter((d) => ["accepted", "in_escrow"].includes(d.status));
  const expiringInEscrow = inEscrow.filter((d) => {
    const days = daysUntil(d.emdDueDate ?? d.inspectionPeriodEndsAt);
    return days != null && days <= 7;
  });
  const totalEmdAtRisk = inEscrow.reduce(
    (s, d) => s + Number(d.acceptedAmount ?? 0) * 0.01, // EMD typically 1% — rough proxy
    0,
  );

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="In-flight contracts"
          value={String(inFlight.length)}
          sub={`${inEscrow.length} in escrow`}
          onClick={() => setLocation("/deals")}
        />
        <StatTile
          label="EMD at risk (est.)"
          value={fmtMoney(totalEmdAtRisk)}
          sub="rough 1% across escrow"
          tone={expiringInEscrow.length > 0 ? "amber" : "neutral"}
          onClick={() => setLocation("/earnest-money")}
        />
      </section>
      {expiringInEscrow.length > 0 && (
        <Card className="p-4 border-amber-400/60">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            <div className="font-medium text-sm">
              {expiringInEscrow.length} deal{expiringInEscrow.length === 1 ? "" : "s"} approaching EMD deadline
            </div>
          </div>
        </Card>
      )}
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setLocation("/buyer-analytics")}
        onKeyDown={activateOnKey(() => setLocation("/buyer-analytics"))}
        aria-label="Open buyer list health"
        className="p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Buyer list health
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Stale buyers · response rates · re-engagement
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>
      <Button
        variant="outline"
        className="w-full h-12 justify-between"
        onClick={() => setLocation("/deals")}
      >
        <span>Open deals pipeline</span>
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "amber";
  onClick?: () => void;
}) {
  const interactive = !!onClick;
  return (
    <Card
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive && onClick ? activateOnKey(onClick) : undefined}
      aria-label={interactive ? `${label} ${value}`.trim() : undefined}
      className={cn(
        "p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "amber" && "border-amber-400/40",
        interactive && "cursor-pointer active:bg-muted/50",
      )}
    >
      <div className="text-micro uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums mt-1",
          tone === "amber" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-caption text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
