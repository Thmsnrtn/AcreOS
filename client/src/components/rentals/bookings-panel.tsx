/**
 * BOOKINGS — the short-term-rental (STR) nightly-stay surface (STR Wave A).
 * Rendered as the "Bookings" tab of `/leases` (see client/src/pages/leases.tsx).
 *
 * WHERE THIS LIVES, AND WHY THERE
 * ───────────────────────────────
 * A TAB on `/leases`, behind the Rentals module. It adds no route and no nav
 * entry — the customer nav is exactly five doors and "no new top-level nav
 * entries EVER" is a standing founder hard-stop, so a new surface hangs off an
 * existing page. `/leases` is the rentals surface an operator is already on when
 * they think about a building's tenancies; a nightly stay is one more.
 *
 * WHAT IT IS FOR
 * ──────────────
 * STR shipped riding the monthly-lease stack, so a nightly stay had nowhere to
 * live and no metric to manage to. This panel reads the reservations a property
 * holds and the honest occupancy / ADR / RevPAR the pure engine computes over a
 * window (shared/rental/strMetrics.ts, via GET /api/properties/:id/str-metrics).
 *
 * MONEY POSTURE (founder ruling "be the rail, not the provider")
 * ──────────────────────────────────────────────────────────────
 * RECORD-ONLY. Every amount shown is a figure the operator recorded off their
 * own channel payout. Nothing here moves, holds or collects a cent.
 *
 * REFUSE, DON'T FABRICATE
 * ───────────────────────
 * A metric with no honest denominator renders as "—", never a guess: ADR is "—"
 * when nothing was booked; occupancy and RevPAR are "—" when the property has no
 * rentable units on record. There is NO market/suggested nightly rate anywhere.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarCheck } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { fetchJsonArray } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

interface ReservationRow {
  id: string;
  propertyId: number;
  unitId: string | null;
  guestName: string | null;
  channel: string | null;
  checkIn: string;
  checkOut: string;
  nights: number | null;
  grossBookingCents: number | null;
  cleaningFeeCents: number | null;
  taxesCents: number | null;
  payoutCents: number | null;
  status: string;
}

interface StrMetrics {
  bookedNights: number;
  availableNights: number | null;
  occupancyBps: number | null;
  roomRevenueCents: number;
  adrCents: number | null;
  revparCents: number | null;
}

interface MetricsResponse {
  metrics: StrMetrics;
  window: { start: string; end: string; nights: number | null };
  activeUnitCount: number;
  availableUnitNights: number | null;
  reservationCount: number;
}

interface PropertySummary {
  id: number;
  address: string | null;
  city: string | null;
  state: string | null;
  apn: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Integer cents → "$1,234.56", or "—" for a genuinely-absent value (never a 0 guess). */
function centsExact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "−" : ""}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** Basis points → "16.7%", or "—" when the metric refused (unknown denominator). */
function bpsPercent(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

function propertyName(p: PropertySummary): string {
  const line = [p.address, p.city, p.state].filter(Boolean).join(", ");
  return line !== "" ? `#${p.id} · ${line}` : `#${p.id} · APN ${p.apn ?? "—"}`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function MetricTile({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border border-border p-3" data-testid={testId}>
      <div className="text-micro text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function BookingsPanel() {
  const [propertyId, setPropertyId] = useState<string>("");
  const [windowStart, setWindowStart] = useState<string>(isoDaysAgo(30));
  const [windowEnd, setWindowEnd] = useState<string>(todayIso());

  const propsQuery = useQuery<PropertySummary[]>({
    queryKey: ["/api/properties", "bookings-panel"],
    queryFn: () => fetchJsonArray<PropertySummary>("/api/properties?pageSize=200"),
  });

  const propertyIdNum = Number.parseInt(propertyId, 10);
  const hasProperty = Number.isFinite(propertyIdNum) && propertyIdNum > 0;

  const reservationsQuery = useQuery<{ reservations: ReservationRow[]; count: number }>({
    queryKey: ["/api/properties", propertyIdNum, "reservations"],
    enabled: hasProperty,
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyIdNum}/reservations`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const validWindow = windowStart !== "" && windowEnd !== "" && windowEnd > windowStart;
  const metricsQuery = useQuery<MetricsResponse>({
    queryKey: ["/api/properties", propertyIdNum, "str-metrics", windowStart, windowEnd],
    enabled: hasProperty && validWindow,
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyIdNum}/str-metrics?windowStart=${windowStart}&windowEnd=${windowEnd}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const reservations = reservationsQuery.data?.reservations ?? [];
  const metrics = metricsQuery.data?.metrics;

  return (
    <div className="space-y-6" data-testid="bookings-panel">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-primary" aria-hidden="true" />
            Bookings
          </CardTitle>
          <CardDescription>
            The nightly stays recorded on this property, and the occupancy, ADR and RevPAR computed
            over a window from your own recorded amounts. Nothing here moves money — a reservation
            records a stay you already hosted, and the channel is a label you set, not a live sync.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <div>
              <Label htmlFor="bookings-property" className="text-xs">Property</Label>
              {propsQuery.isLoading ? (
                <Skeleton className="h-9 mt-1" />
              ) : (
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger id="bookings-property" className="h-9 mt-1" aria-label="Choose a property">
                    <SelectValue placeholder="Choose a property…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(propsQuery.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{propertyName(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label htmlFor="bookings-window-start" className="text-xs">Window start</Label>
              <Input
                id="bookings-window-start" type="date" value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)} className="h-9 mt-1"
              />
            </div>
            <div>
              <Label htmlFor="bookings-window-end" className="text-xs">Window end</Label>
              <Input
                id="bookings-window-end" type="date" value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)} className="h-9 mt-1"
              />
            </div>
          </div>

          {!hasProperty ? (
            <EmptyState
              icon={Building2}
              headline="Pick a property"
              subtitle="Reservations are recorded against a building. Choose one to see its stays and performance."
              framed
              cta={{ label: "", _noOp: true }}
              testId="bookings-no-property"
            />
          ) : (
            <>
              {/* Metrics tiles — refuse-not-fabricate: a metric with no honest denominator is "—". */}
              {metricsQuery.isLoading ? (
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
                </div>
              ) : metricsQuery.isError ? (
                <QueryErrorState
                  error={metricsQuery.error instanceof Error ? metricsQuery.error : null}
                  onRetry={() => metricsQuery.refetch()}
                  isRetrying={metricsQuery.isRefetching}
                  compact
                  title="Couldn't compute this property's metrics"
                  description="We hit a snag reading the reservations. Your data is safe — try again."
                  testId="bookings-metrics-error"
                />
              ) : metrics ? (
                <div className="space-y-2">
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <MetricTile label="Occupancy" value={bpsPercent(metrics.occupancyBps)} testId="metric-occupancy" />
                    <MetricTile label="ADR" value={centsExact(metrics.adrCents)} testId="metric-adr" />
                    <MetricTile label="RevPAR" value={centsExact(metrics.revparCents)} testId="metric-revpar" />
                    <MetricTile label="Booked nights" value={String(metrics.bookedNights)} testId="metric-booked-nights" />
                    <MetricTile label="Room revenue" value={centsExact(metrics.roomRevenueCents)} testId="metric-room-revenue" />
                  </div>
                  {metrics.occupancyBps === null && (
                    <p className="text-micro text-muted-foreground">
                      Occupancy and RevPAR read “—” because this property has no rentable units on record,
                      so there is no honest denominator. Add a unit on the Units tab to compute them —
                      AcreOS will not invent one.
                    </p>
                  )}
                </div>
              ) : null}

              {/* Reservations list. */}
              {reservationsQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
              ) : reservationsQuery.isError ? (
                <QueryErrorState
                  error={reservationsQuery.error instanceof Error ? reservationsQuery.error : null}
                  onRetry={() => reservationsQuery.refetch()}
                  isRetrying={reservationsQuery.isRefetching}
                  compact
                  title="Couldn't load this property's reservations"
                  description="We hit a snag reading the reservations. Your data is safe — try again."
                  testId="bookings-query-error"
                />
              ) : reservations.length === 0 ? (
                <EmptyState
                  icon={CalendarCheck}
                  headline="No reservations recorded on this property yet"
                  subtitle="Record a stay, or import your own Airbnb/VRBO CSV export. Until then, occupancy and ADR have nothing to measure."
                  framed
                  cta={{ label: "", _noOp: true }}
                  testId="bookings-empty"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Recorded reservations on this property</caption>
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                        <th scope="col" className="px-3 py-2 text-left font-medium">Check-in</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Check-out</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Nights</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Guest</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Channel</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Gross</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Payout</th>
                      </tr>
                    </thead>
                    <motion.tbody variants={staggerContainer} initial="hidden" animate="visible">
                      {reservations.map((r) => (
                        <motion.tr key={r.id} variants={staggerItem} className="border-b border-border/40" data-testid={`row-reservation-${r.id}`}>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.checkIn}</td>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.checkOut}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.nights ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.guestName ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.channel ?? "—"}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-micro">{r.status}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{centsExact(r.grossBookingCents)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{centsExact(r.payoutCents)}</td>
                        </motion.tr>
                      ))}
                    </motion.tbody>
                  </table>
                </div>
              )}

              <p className="text-micro text-muted-foreground">
                A cancelled stay is kept in the list but excluded from every metric. Room revenue is
                gross booking less the pass-through cleaning fee and taxes — the operator's own recorded
                amounts, never a market or suggested rate.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
