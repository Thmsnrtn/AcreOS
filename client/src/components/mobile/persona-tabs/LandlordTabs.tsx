/**
 * Landlord persona — Today + Portfolio mobile tabs.
 *
 * Imelda Lens 21 (Mobile Landlord): the "answer-the-phone-from-the-
 * truck" surface that Buildium owns on mobile and AcreOS has been
 * losing on desktop-only. These tabs cover the operator side; the
 * tenant portal + ACH leg is deferred (money-transmitter work) and
 * tenant screening is deferred (SmartMove).
 *
 *   Today:
 *     - Overnight rent received (today's rent_payments aggregate,
 *       tenant vs HAP split)
 *     - Tickets aging > SLA (emergency >4h / urgent >24h /
 *       standard >5d / cosmetic >14d), sorted hottest-first
 *     - Leases expiring < 60d, with the state-rule notice window
 *       (when "send N-day notice NOW" is required, the card flips
 *       to rose)
 *     - HAP recerts coming up in the next 60d (annual recert
 *       anchored on lease start_date)
 *
 *   Portfolio:
 *     - Occupancy % (active units / total units on record)
 *     - MTD rent collected
 *     - YTD expenses (maintenance invoices only — full P&L lives at
 *       /portfolio-pnl)
 *     - Depreciation accrued (links to /depreciation-calculator,
 *       the authoritative source)
 *     - Active maintenance tickets count
 *     - Section 8 share
 *
 * Data sources:
 *   /api/rent-ledger/summary?since=...        — overnight receipts
 *   /api/maintenance-tickets?status=open      — open tickets
 *   /api/rentals/leases/expiring?within=60    — expiring + notice gate
 *   /api/rentals/section-8/recerts-due?within=60 — HAP recerts
 *   /api/rent-roll/occupancy                  — occupancy %
 *   /api/portfolio/landlord-stats             — Portfolio aggregates
 *
 * All list endpoints degrade gracefully via fetchJsonArray so a flaky
 * connection still renders the shell (count = 0, EmptyState card).
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
  Phone,
  MessageSquare,
  Inbox,
  Calculator,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { fetchJsonArray } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";

// ----- Types -----
interface Ticket {
  id: string;
  propertyId: number;
  title: string;
  severity: "emergency" | "urgent" | "standard" | "cosmetic" | string;
  status: string;
  submittedAt: string;
}

interface ExpiringLease {
  id: string;
  propertyId: number;
  unitLabel: string | null;
  endDate: string | null;
  daysToExpiry: number;
  state: string | null;
  noticeDays: number | null;
  noticeWindowOpensAt: string | null;
  noticeWindowOpen: boolean;
  monthlyRentCents: number;
  // Lightly enriched on the server when a primary tenant is on the
  // lease — when not present, the call/text chips collapse. Avoids an
  // extra round-trip for the typical truck-side path.
  primaryTenant?: { id: string; name: string; phone: string | null } | null;
}

interface HapRecertLease {
  id: string;
  propertyId: number;
  unitLabel: string | null;
  nextRecertDate: string | null;
  daysUntilRecert: number;
  hapPortionCents: number;
}

interface RentSummary {
  since: string;
  paymentsCount: number;
  totalCents: number;
  hapCents: number;
  tenantCents: number;
}

interface OccupancyResponse {
  activeUnits: number;
  totalUnits: number;
  propertyCount: number;
  occupancyPct: number | null;
}

interface LandlordStatsResponse {
  mtdRentCollectedCents: number;
  ytdExpensesCents: number;
  ytdDepreciationCents: number | null;
  activeMaintenanceCount: number;
  section8: {
    activeLeases: number;
    totalActiveLeases: number;
    sharePct: number;
  };
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

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  return `$${Math.round(dollars).toLocaleString()}`;
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

// Tap-friendly call / SMS chips for tenant cards. Both use platform
// handlers (tel: / sms:) so iOS routes through the dialer/Messages and
// Android does the same. stopPropagation keeps the chip from also
// activating the surrounding card.
function ContactChip({
  kind,
  phone,
  label,
}: {
  kind: "call" | "text";
  phone: string;
  label: string;
}) {
  const Icon = kind === "call" ? Phone : MessageSquare;
  const href = kind === "call" ? `tel:${phone}` : `sms:${phone}`;
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted active:bg-muted/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-3 w-3" aria-hidden />
      {kind === "call" ? "Call" : "Text"}
    </a>
  );
}

// ============================================================================
// Today tab
// ============================================================================

export function LandlordToday() {
  const [, setLocation] = useLocation();
  // iOS safe-area pad on mobile; desktop preview skips it so the
  // section doesn't leave a strip at the bottom of a wide layout.
  const isMobile = useIsMobile();

  const ticketsQ = useQuery<Ticket[]>({
    queryKey: ["/api/maintenance-tickets", "open-for-today"],
    queryFn: async () => {
      // Server returns `{ tickets: [...] }`; fetchJsonArray flattens
      // common envelopes but not custom keys, so we accept both.
      const res = await fetch("/api/maintenance-tickets?status=open", { credentials: "include" });
      if (!res.ok) return [];
      const j = await res.json().catch(() => ({}));
      if (Array.isArray(j)) return j;
      if (Array.isArray(j?.tickets)) return j.tickets;
      return [];
    },
    staleTime: 60_000,
  });

  const summaryQ = useQuery<RentSummary>({
    queryKey: ["/api/rent-ledger/summary", "overnight"],
    queryFn: async () => {
      const res = await fetch(
        `/api/rent-ledger/summary?since=${encodeURIComponent(startOfTodayIso())}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        return { since: "", paymentsCount: 0, totalCents: 0, hapCents: 0, tenantCents: 0 };
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  const expiringQ = useQuery<{ leases: ExpiringLease[] }>({
    queryKey: ["/api/rentals/leases/expiring", 60],
    queryFn: async () => {
      const res = await fetch("/api/rentals/leases/expiring?within=60", { credentials: "include" });
      if (!res.ok) return { leases: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

  const hapQ = useQuery<{ leases: HapRecertLease[] }>({
    queryKey: ["/api/rentals/section-8/recerts-due", 60],
    queryFn: async () => {
      const res = await fetch("/api/rentals/section-8/recerts-due?within=60", { credentials: "include" });
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

  const tickets = ticketsQ.data ?? [];
  const openTickets = tickets.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const ticketsWithSla = openTickets
    .map((t) => ({ ...t, _sla: ticketSlaState(t) }))
    .sort((a, b) => {
      if (a._sla.pastSla !== b._sla.pastSla) return a._sla.pastSla ? -1 : 1;
      const aOver = a._sla.agedHours - a._sla.slaHours;
      const bOver = b._sla.agedHours - b._sla.slaHours;
      return bOver - aOver;
    })
    .slice(0, 5);

  const summary = summaryQ.data;
  const overnightCount = summary?.paymentsCount ?? 0;
  const overnightTotalCents = summary?.totalCents ?? 0;
  const hapOvernight = summary?.hapCents ?? 0;

  const expiring = expiringQ.data?.leases ?? [];
  const expiringSoon = expiring.slice(0, 4);

  const hapRecerts = hapQ.data?.leases ?? [];
  const hapTop = hapRecerts.slice(0, 3);

  return (
    <div className={cn("space-y-5", isMobile && "pb-[env(safe-area-inset-bottom)]")}>
      {/* Overnight rent */}
      <section>
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
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
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {overnightCount} payment{overnightCount === 1 ? "" : "s"} since midnight
                {hapOvernight > 0 ? ` · ${fmtMoney(hapOvernight)} HAP` : ""}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
          </div>
        </Card>
      </section>

      {/* Tickets past SLA */}
      <section>
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          Tickets aging
        </h2>
        {ticketsWithSla.length === 0 ? (
          <Card>
            <CardContent className="px-2 py-2">
              <EmptyState
                icon={Inbox}
                title="No open tickets"
                description="New tickets show up here once a tenant or vendor opens one."
                actionLabel="Open maintenance"
                actionIcon={null}
                onAction={() => setLocation("/maintenance")}
                className="py-6"
              />
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
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
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
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          Leases expiring &lt; 60d
        </h2>
        {expiringSoon.length === 0 ? (
          <Card>
            <CardContent className="px-2 py-2">
              <EmptyState
                icon={CalendarClock}
                title="No leases ending in 60 days"
                description="Leases ending in the next 60 days show here with the state renewal notice window."
                actionLabel="Open leases"
                actionIcon={null}
                onAction={() => setLocation("/leases")}
                className="py-6"
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {expiringSoon.map((l) => {
              const tone = l.noticeWindowOpen ? "rose" : l.daysToExpiry <= 30 ? "amber" : "neutral";
              const noticeLabel = l.noticeDays != null
                ? l.noticeWindowOpen
                  ? `Send ${l.noticeDays}-day notice NOW`
                  : `${l.noticeDays}-day notice (${l.state ?? "—"})`
                : `Notice rule for ${l.state ?? "—"} not in registry`;
              const phone = l.primaryTenant?.phone ?? null;
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
                      <div className="font-medium truncate">
                        Property #{l.propertyId}
                        {l.unitLabel ? <span className="text-muted-foreground"> · {l.unitLabel}</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">{noticeLabel}</div>
                      {phone && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <ContactChip
                            kind="call"
                            phone={phone}
                            label={`Call ${l.primaryTenant?.name ?? "tenant"}`}
                          />
                          <ContactChip
                            kind="text"
                            phone={phone}
                            label={`Text ${l.primaryTenant?.name ?? "tenant"}`}
                          />
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn(
                        "text-base font-semibold tabular-nums",
                        tone === "rose" && "text-rose-600 dark:text-rose-400",
                        tone === "amber" && "text-amber-600 dark:text-amber-400",
                      )}>
                        {l.daysToExpiry}d
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
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
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-sky-500" aria-hidden />
          HAP recerts &lt; 60d
        </h2>
        {hapTop.length === 0 ? (
          <Card>
            <CardContent className="px-2 py-2">
              <EmptyState
                icon={ShieldCheck}
                title="No HAP recerts in 60 days"
                description="Section 8 annual recerts inside 60 days show up here so you can pull the inspection paperwork early."
                actionLabel="Open leases"
                actionIcon={null}
                onAction={() => setLocation("/leases?filter=section_8")}
                className="py-6"
              />
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
                      <div className="font-medium truncate">
                        Property #{l.propertyId}
                        {l.unitLabel ? <span className="text-muted-foreground"> · {l.unitLabel}</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        HAP {fmtMoney(l.hapPortionCents)}/mo
                        {l.nextRecertDate ? ` · recert ${l.nextRecertDate}` : ""}
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
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
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
            <Wrench className="h-4 w-4" aria-hidden /> Tickets
          </span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/rent-roll")}
        >
          <span className="flex items-center gap-2">
            <Banknote className="h-4 w-4" aria-hidden /> Rent roll
          </span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </section>
    </div>
  );
}

// ============================================================================
// Portfolio tab
// ============================================================================

export function LandlordPortfolio() {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();

  const occQ = useQuery<OccupancyResponse>({
    queryKey: ["/api/rent-roll/occupancy"],
    queryFn: async () => {
      const res = await fetch("/api/rent-roll/occupancy", { credentials: "include" });
      if (!res.ok) return { activeUnits: 0, totalUnits: 0, propertyCount: 0, occupancyPct: null };
      return res.json();
    },
    staleTime: 60_000,
  });

  const statsQ = useQuery<LandlordStatsResponse>({
    queryKey: ["/api/portfolio/landlord-stats"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/landlord-stats", { credentials: "include" });
      if (!res.ok) {
        return {
          mtdRentCollectedCents: 0,
          ytdExpensesCents: 0,
          ytdDepreciationCents: null,
          activeMaintenanceCount: 0,
          section8: { activeLeases: 0, totalActiveLeases: 0, sharePct: 0 },
        };
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  // Aging strip pulls the existing /api/rent/aging endpoint. We use
  // fetchJsonArray with pageSize=100 to obey the list-cap pattern;
  // the server tolerates the unknown query param.
  const agingQ = useQuery<Array<{ days_overdue: number; balance_cents: number }>>({
    queryKey: ["/api/rent/aging", "portfolio"],
    queryFn: () => fetchJsonArray<any>("/api/rent/aging?pageSize=100"),
    staleTime: 60_000,
  });

  if (occQ.isLoading || statsQ.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  const occupancyPct = occQ.data?.occupancyPct ?? null;
  const activeUnits = occQ.data?.activeUnits ?? 0;
  const totalUnits = occQ.data?.totalUnits ?? 0;

  const mtdRent = statsQ.data?.mtdRentCollectedCents ?? 0;
  const ytdExpenses = statsQ.data?.ytdExpensesCents ?? 0;
  const ytdDepreciation = statsQ.data?.ytdDepreciationCents ?? null;
  const activeTickets = statsQ.data?.activeMaintenanceCount ?? 0;
  const section8Share = statsQ.data?.section8?.sharePct ?? 0;
  const section8Count = statsQ.data?.section8?.activeLeases ?? 0;

  // `/api/rent/aging` returns an envelope `{ charges, totalsByBucket }`
  // — fetchJsonArray flattens common envelopes and lands as [] when
  // the response is the object form, so we defensively read both.
  const agingRows = Array.isArray(agingQ.data) ? agingQ.data : [];
  const overdueRows = agingRows.filter((c: any) => Number(c?.days_overdue) > 0);
  const overdueCount = overdueRows.length;
  const overdueTotal = overdueRows.reduce(
    (s: number, c: any) => s + Number(c?.balance_cents ?? 0),
    0,
  );

  return (
    <div className={cn("space-y-3", isMobile && "pb-[env(safe-area-inset-bottom)]")}>
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Occupancy"
          value={occupancyPct != null ? `${occupancyPct}%` : "—"}
          sub={`${activeUnits} of ${totalUnits} units`}
          onClick={() => setLocation("/rent-roll")}
        />
        <StatTile
          label="MTD rent collected"
          value={fmtMoney(mtdRent)}
          sub="this month"
          onClick={() => setLocation("/rent-roll")}
        />
        <StatTile
          label="YTD expenses"
          value={fmtMoney(ytdExpenses)}
          sub="maintenance invoices"
          onClick={() => setLocation("/portfolio-pnl")}
        />
        <StatTile
          label="YTD depreciation"
          value={ytdDepreciation != null ? fmtMoney(ytdDepreciation) : "—"}
          sub={ytdDepreciation != null ? "accrued" : "see calculator"}
          icon={Calculator}
          onClick={() => setLocation("/depreciation-calculator")}
        />
        <StatTile
          label="Active tickets"
          value={String(activeTickets)}
          sub={activeTickets > 0 ? "open or in progress" : "none open"}
          tone={activeTickets > 5 ? "amber" : "neutral"}
          onClick={() => setLocation("/maintenance")}
        />
        <StatTile
          label="Section 8 share"
          value={`${section8Share}%`}
          sub={`${section8Count} HAP lease${section8Count === 1 ? "" : "s"}`}
          onClick={() => setLocation("/leases?filter=section_8")}
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
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
              <div>
                <div className="font-medium text-sm">
                  {overdueCount} overdue charge{overdueCount === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {fmtMoney(overdueTotal)} outstanding
                </div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
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
              <Home className="h-4 w-4 text-muted-foreground" aria-hidden />
              Tenants &amp; leases
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {activeUnits} active unit{activeUnits === 1 ? "" : "s"} across the portfolio
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
      </Card>

      <Button
        variant="outline"
        className="w-full h-12 justify-between"
        onClick={() => setLocation("/portfolio-pnl")}
      >
        <span>Open portfolio P&amp;L</span>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "amber";
  icon?: typeof Banknote;
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
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" aria-hidden />}
        {label}
      </div>
      <div className={cn(
        "text-2xl font-semibold tabular-nums mt-1",
        tone === "amber" && "text-amber-600 dark:text-amber-400",
      )}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
