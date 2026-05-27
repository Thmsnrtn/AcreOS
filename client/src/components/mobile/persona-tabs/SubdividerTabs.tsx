/**
 * Subdivider persona — Today + Portfolio mobile tabs.
 *
 * Brigid §4 / Lens 19 #1: subdividers run their week from the parking lot
 * outside Williamson Planning. The Universal tabs are useless to them —
 * they need permit-gate health, perc-test queue, lots-in-market, and
 * lots-sold-this-month above the fold.
 *
 * Today:
 *   - Stalled permit gates (expected_return_at past + still in_review/submitted)
 *   - Perc tests due soon (TDEC bottleneck)
 *   - Lots currently in market (status=listed/under_contract across all parents)
 *   - Lots sold this month (count + proceeds)
 *
 * Portfolio:
 *   - Active subdivisions (parent parcels with at least one child lot)
 *   - Total carrying-cost burn (parent-basis + plan-stage cost projections)
 *   - Lots sold YTD
 *   - Blended lot price (avg sold price across YTD sold lots)
 *
 * Data sources:
 *   GET /api/subdivider/dashboard          — org-wide rollup
 *   GET /api/permits/stalled               — stalled gate list (with labels)
 *   GET /api/properties?status=listed,under_contract — in-market children
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  Layers,
  Clock,
  ArrowRight,
  TrendingUp,
  CheckCircle2,
  Hammer,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SubdividerDashboard {
  hasData: boolean;
  parentCount?: number;
  totalChildLots?: number;
  soldChildLots?: number;
  totalParentBasisCents?: number;
  totalSoldProceedsCents?: number;
  recoveredPct?: number;
  stalledGates?: number;
}

interface StalledGate {
  id: string;
  gateKey: string;
  label: string;
  status: string;
  submittedAt: string | null;
  expectedReturnAt: string | null;
  contactName: string | null;
}

interface StalledGatesResponse {
  count: number;
  stalled: StalledGate[];
  asOf: string;
}

interface PropertyRow {
  id: number;
  apn?: string | null;
  childLotNumber?: string | null;
  status?: string;
  parentParcelId?: number | null;
  listPrice?: string | number | null;
  soldPrice?: string | number | null;
  soldDate?: string | null;
}

function activateOnKey(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

function fmtUsdCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function daysOverdue(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function startOfYearIso(): string {
  return new Date(new Date().getFullYear(), 0, 1).toISOString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed (${res.status})`);
  return res.json();
}

export function SubdividerToday() {
  const [, setLocation] = useLocation();

  const dashboard = useQuery<SubdividerDashboard>({
    queryKey: ["/api/subdivider/dashboard"],
    queryFn: () => fetchJson<SubdividerDashboard>("/api/subdivider/dashboard"),
    staleTime: 60_000,
  });

  const stalled = useQuery<StalledGatesResponse>({
    queryKey: ["/api/permits/stalled"],
    queryFn: () => fetchJson<StalledGatesResponse>("/api/permits/stalled"),
    staleTime: 60_000,
  });

  // All child lots (parent_parcel_id IS NOT NULL) — use a generous pageSize.
  const childLots = useQuery<{ properties?: PropertyRow[] } | PropertyRow[]>({
    queryKey: ["/api/properties", "child-lots", "today"],
    queryFn: () => fetchJson<any>("/api/properties?pageSize=500"),
    staleTime: 60_000,
  });

  const children: PropertyRow[] = useMemo(() => {
    const raw = childLots.data;
    const rows: PropertyRow[] = Array.isArray(raw)
      ? raw
      : (raw?.properties ?? []);
    return rows.filter((r) => r.parentParcelId != null);
  }, [childLots.data]);

  const inMarket = useMemo(
    () => children.filter((c) => c.status === "listed" || c.status === "under_contract"),
    [children],
  );

  const monthStart = startOfMonthIso();
  const soldThisMonth = useMemo(() => {
    return children.filter(
      (c) => c.status === "sold" && c.soldDate && c.soldDate >= monthStart,
    );
  }, [children, monthStart]);

  const soldThisMonthProceeds = useMemo(() => {
    return soldThisMonth.reduce((sum, c) => {
      const n = typeof c.soldPrice === "string"
        ? parseFloat(c.soldPrice)
        : (c.soldPrice ?? 0);
      return sum + (Number.isFinite(n) ? Number(n) : 0);
    }, 0);
  }, [soldThisMonth]);

  if (dashboard.isLoading || stalled.isLoading || childLots.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  const stalledList = (stalled.data?.stalled ?? []).slice(0, 5);
  const percStalled = stalledList.filter((g) => g.gateKey === "soil_percolation_tests");

  return (
    <div className="space-y-5">
      {/* Stalled permit gates — Brigid's #1 daily pain */}
      <section>
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-500" aria-hidden />
          Stalled permit gates
        </h2>
        {stalledList.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6 px-4 text-center">
              No permit gates past their expected return date.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {stalledList.map((g) => {
              const d = daysOverdue(g.expectedReturnAt);
              const tone = d >= 14 ? "rose" : d >= 7 ? "amber" : "neutral";
              return (
                <Card
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation("/permits")}
                  onKeyDown={activateOnKey(() => setLocation("/permits"))}
                  aria-label={`Open stalled permit gate ${g.label}, ${d} days overdue`}
                  className={cn(
                    "p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tone === "rose" && "border-rose-400/60",
                    tone === "amber" && "border-amber-400/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate text-sm">{g.label}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {g.status.replace(/_/g, " ")}
                        {g.contactName ? ` · ${g.contactName}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={cn(
                          "text-base font-semibold tabular-nums",
                          tone === "rose" && "text-rose-600 dark:text-rose-400",
                          tone === "amber" && "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        +{d}d
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        overdue
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Perc-tests (TDEC bottleneck) — pulled out separately since it's
          the gate that most often eats months */}
      {percStalled.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            Perc tests waiting on TDEC
          </h2>
          <Card className="p-4 border-amber-400/60">
            <div className="text-sm">
              {percStalled.length} parcel{percStalled.length === 1 ? "" : "s"} stuck in the
              TDEC perc-test queue. Average wait at last check: {Math.max(...percStalled.map((g) => daysOverdue(g.expectedReturnAt)))}d past expected.
            </div>
          </Card>
        </section>
      )}

      {/* This-month sales */}
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Lots in market"
          value={String(inMarket.length)}
          sub="listed + under contract"
          onClick={() => setLocation("/parcels")}
        />
        <StatTile
          label="Sold this month"
          value={String(soldThisMonth.length)}
          sub={fmtUsd(soldThisMonthProceeds) + " proceeds"}
          tone={soldThisMonth.length > 0 ? "pos" : "neutral"}
          onClick={() => setLocation("/parcels")}
        />
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/permits")}
        >
          <span className="flex items-center gap-2">
            <Hammer className="h-4 w-4" /> Permits
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/county-timelines")}
        >
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Timelines
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </section>
    </div>
  );
}

export function SubdividerPortfolio() {
  const [, setLocation] = useLocation();

  const dashboard = useQuery<SubdividerDashboard>({
    queryKey: ["/api/subdivider/dashboard"],
    queryFn: () => fetchJson<SubdividerDashboard>("/api/subdivider/dashboard"),
    staleTime: 60_000,
  });

  const childLots = useQuery<{ properties?: PropertyRow[] } | PropertyRow[]>({
    queryKey: ["/api/properties", "child-lots", "portfolio"],
    queryFn: () => fetchJson<any>("/api/properties?pageSize=500"),
    staleTime: 60_000,
  });

  const children: PropertyRow[] = useMemo(() => {
    const raw = childLots.data;
    const rows: PropertyRow[] = Array.isArray(raw)
      ? raw
      : (raw?.properties ?? []);
    return rows.filter((r) => r.parentParcelId != null);
  }, [childLots.data]);

  const yearStart = startOfYearIso();
  const soldYtd = useMemo(() => {
    return children.filter(
      (c) => c.status === "sold" && c.soldDate && c.soldDate >= yearStart,
    );
  }, [children, yearStart]);

  const soldYtdProceedsCents = useMemo(() => {
    return soldYtd.reduce((sum, c) => {
      const n = typeof c.soldPrice === "string"
        ? parseFloat(c.soldPrice)
        : (c.soldPrice ?? 0);
      return sum + (Number.isFinite(n) ? Math.round(Number(n) * 100) : 0);
    }, 0);
  }, [soldYtd]);

  const blendedLotPriceCents = soldYtd.length > 0
    ? Math.round(soldYtdProceedsCents / soldYtd.length)
    : null;

  if (dashboard.isLoading || childLots.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  const d = dashboard.data;
  const noData = !d?.hasData;

  return (
    <div className="space-y-3">
      {noData ? (
        <Card>
          <CardContent className="py-8 px-4 text-sm text-muted-foreground text-center space-y-2">
            <Layers className="h-6 w-6 mx-auto text-muted-foreground/60" aria-hidden />
            <div>No active subdivisions yet.</div>
            <div className="text-xs">
              Add a parent parcel, then create child lots from the Subdivision tab.
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3">
            <StatTile
              label="Active subdivisions"
              value={String(d!.parentCount ?? 0)}
              sub={`${d!.totalChildLots ?? 0} child lots`}
              onClick={() => setLocation("/parcels")}
            />
            <StatTile
              label="Carrying-cost burn"
              value={fmtUsdCents(d!.totalParentBasisCents ?? null)}
              sub="parent basis + plan costs"
              tone={
                d!.stalledGates && d!.stalledGates > 0 ? "warn" : "neutral"
              }
              onClick={() => setLocation("/parcels")}
            />
            <StatTile
              label="Sold YTD"
              value={String(soldYtd.length)}
              sub={fmtUsdCents(soldYtdProceedsCents)}
              tone={soldYtd.length > 0 ? "pos" : "neutral"}
            />
            <StatTile
              label="Blended lot price"
              value={fmtUsdCents(blendedLotPriceCents)}
              sub="YTD avg sold"
            />
          </section>

          {d!.stalledGates && d!.stalledGates > 0 ? (
            <Card className="p-4 border-amber-400/60">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                <div className="font-medium text-sm">
                  {d!.stalledGates} permit gate{d!.stalledGates === 1 ? "" : "s"} stalled — investigation needed
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-4 border-emerald-400/40">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <div className="text-sm">All permit gates on track</div>
              </div>
            </Card>
          )}

          {d!.totalParentBasisCents != null && d!.totalParentBasisCents > 0 && (
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Basis recovery</div>
              <div className="text-2xl font-semibold tabular-nums mt-1 flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-emerald-500" aria-hidden />
                {d!.recoveredPct ?? 0}%
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {fmtUsdCents(d!.totalSoldProceedsCents ?? 0)} of {fmtUsdCents(d!.totalParentBasisCents)} recovered
              </div>
            </Card>
          )}
        </>
      )}

      <Button
        variant="outline"
        className="w-full h-12 justify-between"
        onClick={() => setLocation("/parcels")}
      >
        <span>Open subdivisions</span>
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
  tone?: "neutral" | "pos" | "warn";
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
        tone === "pos" && "border-emerald-400/40",
        tone === "warn" && "border-amber-400/40",
        interactive && "cursor-pointer active:bg-muted/50",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums mt-1",
          tone === "pos" && "text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
