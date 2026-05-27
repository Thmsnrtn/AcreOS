/**
 * Landlord persona — Today + Portfolio mobile tabs.
 *
 * Lens 21 named the Imelda surface "overnight rent + 48-hour tickets" — the
 * answer-the-phone-from-the-truck check that Buildium owns on mobile and
 * AcreOS has been losing on desktop-only. These tabs cover the operator
 * side; the tenant portal + ACH leg is deferred (money-transmitter work).
 *
 *   Today:
 *     - Overnight rent received (last 24h, by payor type)
 *     - Tickets aging past their SLA (emergency >4h / urgent >24h /
 *       standard >5d / cosmetic >14d) sorted hottest-first
 *     - Leases expiring < 60d (with the state-rule non-renewal notice window)
 *     - HAP recerts coming up in the next 60d (Section 8 portion > 0)
 *
 *   Portfolio:
 *     - Occupancy %
 *     - MTD rent collected
 *     - YTD expenses
 *     - Depreciation accrued YTD
 *
 * Data sources:
 *   /api/leases                     — lease list (status, end dates, HAP)
 *   /api/maintenance-tickets        — open tickets
 *   /api/rent/aging                 — overdue charge balances
 *   /api/leases/expiring            — leases within N days of expiry (this PR)
 *   /api/leases/hap-recerts         — HAP recert due (this PR)
 *   /api/rent-roll/summary          — occupancy + MTD rent (best-effort)
 *
 * The tabs degrade gracefully when an endpoint is unavailable so the
 * mobile screen still renders something useful (count = 0, empty card).
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Banknote,
  Wrench,
  CalendarClock,
  ShieldCheck,
  ArrowRight,
  AlertTriangle,
  Home,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchJsonArray } from "@/lib/queryClient";

// ----- Types -----
interface Ticket {
  id: string;
  propertyId: number;
  title: string;
  severity: "emergency" | "urgent" | "standard" | "cosmetic" | string;
  status: string;
  submittedAt: string;
}

interface Lease {
  id: string;
  propertyId: number;
  unitLabel?: string | null;
  status: string;
  endDate?: string | null;
  monthlyRentCents: number;
  isSection8?: boolean;
  hapPortionCents?: number | null;
  state: string;
}

interface Payment {
  id: string;
  leaseId: string;
  amountCents: number;
  receivedAt: string;
  payorType: "tenant" | "hap" | string;
}

interface AgingResponse {
  asOf: string;
  totalsByBucket: Record<string, { count: number; totalCents: number }>;
  charges: Array<{ balance_cents: number; days_overdue: number }>;
}

interface ExpiringResponse {
  leases: Array<{
    id: string;
    propertyId: number;
    endDate: string | null;
    daysToExpiry: number;
    state: string;
    noticeDays: number | null;
    noticeWindowOpensAt: string | null;
    noticeWindowOpen: boolean;
  }>;
}

interface HapRecertResponse {
  leases: Array<{
    id: string;
    propertyId: number;
    nextRecertDate: string;
    daysUntilRecert: number;
    hapPortionCents: number;
  }>;
}

// ----- Helpers -----
function activateOnKey(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

function fmtMoney(cents: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  const sign = opts.sign && dollars > 0 ? "+" : "";
  return `${sign}$${Math.round(dollars).toLocaleString()}`;
}

function hoursSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return (Date.now() - t) / 3_600_000;
}

// SLA windows by severity. Past these, the ticket is "aging."
const SLA_HOURS: Record<string, number> = {
  emergency: 4,
  urgent: 24,
  standard: 24 * 5,
  cosmetic: 24 * 14,
};

function ticketSlaState(t: Ticket): {
  agedHours: number;
  slaHours: number;
  pastSla: boolean;
  tone: "rose" | "amber" | "neutral";
} {
  const agedHours = hoursSince(t.submittedAt);
  const slaHours = SLA_HOURS[t.severity] ?? SLA_HOURS.standard;
  const pastSla = agedHours > slaHours;
  const tone = pastSla
    ? t.severity === "emergency" || t.severity === "urgent"
      ? "rose"
      : "amber"
    : "neutral";
  return { agedHours, slaHours, pastSla, tone };
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ============================================================================
// Today tab
// ============================================================================

export function LandlordToday() {
  const [, setLocation] = useLocation();

  const ticketsQ = useQuery<{ tickets: Ticket[] }>({
    queryKey: ["/api/maintenance-tickets", "open-for-today"],
    queryFn: async () => {
      const res = await fetch("/api/maintenance-tickets", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });

  // Best-effort overnight payments — uses /api/rent-payments if exposed;
  // otherwise the section degrades to a count of 0 with no row list.
  const paymentsQ = useQuery<{ payments: Payment[] }>({
    queryKey: ["/api/rent-payments", "overnight"],
    queryFn: async () => {
      const res = await fetch(`/api/rent-payments?since=${encodeURIComponent(startOfTodayIso())}`, { credentials: "include" });
      if (!res.ok) return { payments: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

  const expiringQ = useQuery<ExpiringResponse>({
    queryKey: ["/api/leases/expiring", 60],
    queryFn: async () => {
      const res = await fetch("/api/leases/expiring?withinDays=60", { credentials: "include" });
      if (!res.ok) return { leases: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

  const hapQ = useQuery<HapRecertResponse>({
    queryKey: ["/api/leases/hap-recerts", 60],
    queryFn: async () => {
      const res = await fetch("/api/leases/hap-recerts?withinDays=60", { credentials: "include" });
      if (!res.ok) return { leases: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

  if (ticketsQ.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  const tickets = ticketsQ.data?.tickets ?? [];
  const openTickets = tickets.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const ticketsWithSla = openTickets
    .map((t) => ({ ...t, _sla: ticketSlaState(t) }))
    .sort((a, b) => {
      // past-SLA first, then by how far over SLA they are
      if (a._sla.pastSla !== b._sla.pastSla) return a._sla.pastSla ? -1 : 1;
      const aOver = a._sla.agedHours - a._sla.slaHours;
      const bOver = b._sla.agedHours - b._sla.slaHours;
      return bOver - aOver;
    })
    .slice(0, 5);

  const payments = paymentsQ.data?.payments ?? [];
  const overnightCount = payments.length;
  const overnightTotalCents = payments.reduce((s, p) => s + (p.amountCents || 0), 0);
  const hapOvernight = payments.filter((p) => p.payorType === "hap").reduce((s, p) => s + (p.amountCents || 0), 0);

  const expiring = expiringQ.data?.leases ?? [];
  const expiringSoon = expiring.slice(0, 4);

  const hapRecerts = hapQ.data?.leases ?? [];
  const hapTop = hapRecerts.slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Overnight rent */}
      <section>
        <h2 className="text-caption uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <Banknote className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
          Overnight rent
        </h2>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setLocation("/rent-roll")}
          onKeyDown={activateOnKey(() => setLocation("/rent-roll"))}
          aria-label={`Overnight rent ${fmtMoney(overnightTotalCents)} across ${overnightCount} payments`}
          className="p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-3xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {fmtMoney(overnightTotalCents)}
              </div>
              <div className="text-caption text-muted-foreground mt-0.5">
                {overnightCount} payment{overnightCount === 1 ? "" : "s"} since midnight
                {hapOvernight > 0 ? ` · ${fmtMoney(hapOvernight)} HAP` : ""}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </Card>
      </section>

      {/* Tickets past SLA */}
      <section>
        <h2 className="text-caption uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          Tickets aging
        </h2>
        {ticketsWithSla.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6 px-4 text-center">
              No open tickets. Slow day or a quiet portfolio.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {ticketsWithSla.map((t) => {
              const tone = t._sla.tone;
              const overBy = Math.max(0, t._sla.agedHours - t._sla.slaHours);
              const overLabel = overBy >= 24 ? `${Math.floor(overBy / 24)}d over` : `${Math.round(overBy)}h over`;
              return (
                <Card
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/maintenance?ticket=${t.id}`)}
                  onKeyDown={activateOnKey(() => setLocation(`/maintenance?ticket=${t.id}`))}
                  aria-label={`Open ticket ${t.title}`}
                  className={cn(
                    "p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tone === "rose" && "border-rose-400/60",
                    tone === "amber" && "border-amber-400/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        #{t.propertyId} · {t.severity} · {t.status.replace(/_/g, " ")}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn(
                        "text-sm font-semibold tabular-nums",
                        tone === "rose" && "text-rose-600 dark:text-rose-400",
                        tone === "amber" && "text-amber-600 dark:text-amber-400",
                      )}>
                        {t._sla.pastSla ? overLabel : `${Math.round(t._sla.agedHours)}h`}
                      </div>
                      <div className="text-micro uppercase tracking-wide text-muted-foreground">
                        SLA {t._sla.slaHours}h
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Leases expiring */}
      <section>
        <h2 className="text-caption uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          Leases expiring &lt; 60d
        </h2>
        {expiringSoon.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6 px-4 text-center">
              No leases ending in the next 60 days.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {expiringSoon.map((l) => {
              const tone = l.noticeWindowOpen ? "rose" : l.daysToExpiry <= 30 ? "amber" : "neutral";
              const noticeLabel = l.noticeDays != null
                ? l.noticeWindowOpen
                  ? `Send ${l.noticeDays}-day notice NOW`
                  : `${l.noticeDays}-day notice (${l.state})`
                : `Notice rule for ${l.state} not in registry`;
              return (
                <Card
                  key={l.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/leases?id=${l.id}`)}
                  onKeyDown={activateOnKey(() => setLocation(`/leases?id=${l.id}`))}
                  aria-label={`Open lease ${l.id} expiring in ${l.daysToExpiry} days`}
                  className={cn(
                    "p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tone === "rose" && "border-rose-400/60",
                    tone === "amber" && "border-amber-400/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">Property #{l.propertyId}</div>
                      <div className="text-xs text-muted-foreground">{noticeLabel}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn(
                        "text-base font-semibold tabular-nums",
                        tone === "rose" && "text-rose-600 dark:text-rose-400",
                        tone === "amber" && "text-amber-600 dark:text-amber-400",
                      )}>
                        {l.daysToExpiry}d
                      </div>
                      <div className="text-micro uppercase tracking-wide text-muted-foreground">
                        to expiry
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* HAP recerts */}
      <section>
        <h2 className="text-caption uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-sky-500" aria-hidden />
          HAP recerts &lt; 60d
        </h2>
        {hapTop.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6 px-4 text-center">
              No HAP recerts coming up in the next 60 days.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {hapTop.map((l) => {
              const tone = l.daysUntilRecert <= 14 ? "rose" : l.daysUntilRecert <= 30 ? "amber" : "neutral";
              return (
                <Card
                  key={l.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/leases?id=${l.id}`)}
                  onKeyDown={activateOnKey(() => setLocation(`/leases?id=${l.id}`))}
                  aria-label={`HAP recert for lease ${l.id} in ${l.daysUntilRecert} days`}
                  className={cn(
                    "p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tone === "rose" && "border-rose-400/60",
                    tone === "amber" && "border-amber-400/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">Property #{l.propertyId}</div>
                      <div className="text-xs text-muted-foreground">
                        HAP {fmtMoney(l.hapPortionCents)}/mo · recert {l.nextRecertDate}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn(
                        "text-base font-semibold tabular-nums",
                        tone === "rose" && "text-rose-600 dark:text-rose-400",
                        tone === "amber" && "text-amber-600 dark:text-amber-400",
                      )}>
                        {l.daysUntilRecert}d
                      </div>
                      <div className="text-micro uppercase tracking-wide text-muted-foreground">
                        to recert
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/maintenance")}
        >
          <span className="flex items-center gap-2">
            <Wrench className="h-4 w-4" /> Tickets
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/rent-roll")}
        >
          <span className="flex items-center gap-2">
            <Banknote className="h-4 w-4" /> Rent roll
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </section>
    </div>
  );
}

// ============================================================================
// Portfolio tab
// ============================================================================

interface RentRollSummary {
  occupancyPct?: number;
  mtdRentCollectedCents?: number;
  ytdExpensesCents?: number;
  ytdDepreciationCents?: number;
}

export function LandlordPortfolio() {
  const [, setLocation] = useLocation();

  const leasesQ = useQuery<{ leases: Lease[] }>({
    queryKey: ["/api/leases", "all"],
    queryFn: async () => {
      const res = await fetch("/api/leases", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const summaryQ = useQuery<RentRollSummary>({
    queryKey: ["/api/rent-roll/summary"],
    queryFn: async () => {
      const res = await fetch("/api/rent-roll/summary", { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 60_000,
  });

  const agingQ = useQuery<AgingResponse>({
    queryKey: ["/api/rent/aging"],
    queryFn: async () => {
      const res = await fetch("/api/rent/aging", { credentials: "include" });
      if (!res.ok) return { asOf: "", totalsByBucket: {}, charges: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

  if (leasesQ.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  const leases = leasesQ.data?.leases ?? [];
  const activeLeases = leases.filter((l) => l.status === "active");
  const doorCount = leases.length;
  const activeCount = activeLeases.length;
  // If the server didn't compute occupancy, infer it as activeLeases / total
  // leases on record — coarse, but better than blank on a phone screen.
  const occupancyPct =
    summaryQ.data?.occupancyPct ??
    (doorCount > 0 ? Math.round((activeCount / doorCount) * 100) : null);

  const mtdRent = summaryQ.data?.mtdRentCollectedCents ?? null;
  const ytdExpenses = summaryQ.data?.ytdExpensesCents ?? null;
  const ytdDepreciation = summaryQ.data?.ytdDepreciationCents ?? null;

  const aging = agingQ.data?.totalsByBucket ?? {};
  const overdueTotal =
    (aging.d1_30?.totalCents ?? 0) +
    (aging.d31_60?.totalCents ?? 0) +
    (aging.d61_90?.totalCents ?? 0) +
    (aging.d90_plus?.totalCents ?? 0);
  const overdueCount =
    (aging.d1_30?.count ?? 0) +
    (aging.d31_60?.count ?? 0) +
    (aging.d61_90?.count ?? 0) +
    (aging.d90_plus?.count ?? 0);

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Occupancy"
          value={occupancyPct != null ? `${occupancyPct}%` : "—"}
          sub={`${activeCount} of ${doorCount} on record`}
          onClick={() => setLocation("/rent-roll")}
        />
        <StatTile
          label="MTD rent collected"
          value={fmtMoney(mtdRent)}
          sub={mtdRent != null ? "this month" : "wire /api/rent-roll/summary"}
          onClick={() => setLocation("/rent-roll")}
        />
        <StatTile
          label="YTD expenses"
          value={fmtMoney(ytdExpenses)}
          sub="from P&L"
          onClick={() => setLocation("/portfolio-pnl")}
        />
        <StatTile
          label="YTD depreciation"
          value={fmtMoney(ytdDepreciation)}
          sub="accrued"
          onClick={() => setLocation("/depreciation-calculator")}
        />
      </section>

      {overdueCount > 0 && (
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setLocation("/rent-roll?filter=overdue")}
          onKeyDown={activateOnKey(() => setLocation("/rent-roll?filter=overdue"))}
          aria-label={`Open ${overdueCount} overdue charges totaling ${fmtMoney(overdueTotal)}`}
          className="p-4 border-amber-400/60 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <div>
                <div className="font-medium text-sm">
                  {overdueCount} overdue charge{overdueCount === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {fmtMoney(overdueTotal)} outstanding
                </div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </Card>
      )}

      <Card
        role="button"
        tabIndex={0}
        onClick={() => setLocation("/tenants")}
        onKeyDown={activateOnKey(() => setLocation("/tenants"))}
        aria-label="Open tenants"
        className="p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium flex items-center gap-2">
              <Home className="h-4 w-4 text-muted-foreground" />
              Tenants &amp; leases
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {activeCount} active lease{activeCount === 1 ? "" : "s"} across the portfolio
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>

      <Button
        variant="outline"
        className="w-full h-12 justify-between"
        onClick={() => setLocation("/portfolio-pnl")}
      >
        <span>Open portfolio P&amp;L</span>
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
      <div className={cn(
        "text-2xl font-semibold tabular-nums mt-1",
        tone === "amber" && "text-amber-600 dark:text-amber-400",
      )}>
        {value}
      </div>
      {sub && <div className="text-caption text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
