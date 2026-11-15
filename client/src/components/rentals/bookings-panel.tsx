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
 * W2-STR (2026-11-06) wired the three routes that had no screen: recording a
 * stay (POST /api/properties/:id/reservations — until then the list could only
 * ever be empty), a stay's status (PATCH /api/reservations/:id/status, whose
 * move to checked_out fires reservation.checkout) and the per-stay P&L
 * (GET /api/reservations/:id/pnl).
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
 * rentable units on record. A blank amount on the form is sent as unrecorded
 * (null), never $0, and the P&L net is "—" until every line is known. There is
 * NO market/suggested nightly rate anywhere.
 */

import { PropertyCombobox } from "@/components/property-combobox";
import { Fragment, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CalendarCheck, Plus } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Verbs } from "@/lib/labels";
import { RESERVATION_CHANNELS, RESERVATION_STATUSES } from "@shared/constants/rental";

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

const statusLabel = (s: string) => s.replace("_", " ");

/** The money a stay records, in the order a channel payout lists it. */
const MONEY_FIELDS = [
  ["grossBookingCents", "Gross booking ($)"],
  ["channelFeeCents", "Channel fee ($)"],
  ["cleaningFeeCents", "Cleaning fee ($)"],
  ["taxesCents", "Taxes ($)"],
  ["payoutCents", "Payout ($)"],
] as const;

/** Typed dollars → integer cents. Blank → null (unrecorded, never $0); unreadable → NaN, which blocks the submit. */
function dollarsToCents(v: string | undefined): number | null {
  if (!v || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : Number.NaN;
}

// ---------------------------------------------------------------------------
// Record a stay — POST /api/properties/:id/reservations (the vertical's writer)
// ---------------------------------------------------------------------------

function RecordStayForm({ propertyId, onDone }: { propertyId: number; onDone: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState<Record<string, string>>({ status: "booked" });
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const money = Object.fromEntries(MONEY_FIELDS.map(([k]) => [k, dollarsToCents(f[k])]));
  const ready = !!f.checkIn && !!f.checkOut && f.checkOut > f.checkIn
    && !Object.values(money).some((c) => Number.isNaN(c));

  const record = useMutation({
    mutationFn: () => apiRequest("POST", `/api/properties/${propertyId}/reservations`, {
      checkIn: f.checkIn,
      checkOut: f.checkOut,
      guestName: f.guestName?.trim() || null,
      channel: f.channel || null,
      status: f.status,
      ...money,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId] });
      toast({ title: "Stay recorded" });
      onDone();
    },
  });

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="record-stay-form">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="stay-check-in" className="text-xs">Check-in *</Label>
          <Input id="stay-check-in" type="date" value={f.checkIn ?? ""} onChange={(e) => set("checkIn")(e.target.value)} className="h-9 mt-1" />
        </div>
        <div>
          <Label htmlFor="stay-check-out" className="text-xs">Check-out *</Label>
          <Input id="stay-check-out" type="date" value={f.checkOut ?? ""} onChange={(e) => set("checkOut")(e.target.value)} className="h-9 mt-1" />
        </div>
        <div>
          <Label htmlFor="stay-guest" className="text-xs">Guest</Label>
          <Input id="stay-guest" value={f.guestName ?? ""} onChange={(e) => set("guestName")(e.target.value)} className="h-9 mt-1" />
        </div>
        <div>
          <Label htmlFor="stay-channel" className="text-xs">Channel</Label>
          <Select value={f.channel ?? ""} onValueChange={set("channel")}>
            <SelectTrigger id="stay-channel" className="h-9 mt-1"><SelectValue placeholder="Not recorded" /></SelectTrigger>
            <SelectContent>
              {RESERVATION_CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="stay-status" className="text-xs">Status</Label>
          <Select value={f.status} onValueChange={set("status")}>
            <SelectTrigger id="stay-status" className="h-9 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESERVATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {MONEY_FIELDS.map(([k, label]) => (
          <div key={k}>
            <Label htmlFor={`stay-${k}`} className="text-xs">{label}</Label>
            <Input id={`stay-${k}`} type="number" min="0" step="0.01" value={f[k] ?? ""} onChange={(e) => set(k)(e.target.value)} className="h-9 mt-1" />
          </div>
        ))}
      </div>
      <p className="text-micro text-muted-foreground">
        Leave an amount blank if you don't have it — it stays unrecorded, never $0. To correct a stay later,
        mark it cancelled and record it again.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={!ready || record.isPending} onClick={() => record.mutate()} data-testid="button-record-stay-submit">
          Record stay
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{Verbs.CANCEL}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A stay's status — PATCH /api/reservations/:id/status
// ---------------------------------------------------------------------------

function StayStatusSelect({ r }: { r: ReservationRow }) {
  const update = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/reservations/${r.id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/properties", r.propertyId] }),
  });
  return (
    <Select value={r.status} onValueChange={(s) => update.mutate(s)} disabled={update.isPending}>
      <SelectTrigger className="h-8 w-32" aria-label={`Status of the stay from ${r.checkIn}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        {RESERVATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Per-stay P&L — GET /api/reservations/:id/pnl (shared/rental/stayPnl.ts)
// ---------------------------------------------------------------------------

interface StayPnlResponse {
  stayNights: number | null;
  pnl: {
    netCents: number | null;
    lines: Array<{ key: string; label: string; kind: "income" | "deduction"; amountCents: number | null; available: boolean }>;
  };
  allocation: { operatingSumCents: number; windowNights: number | null } | null;
}

function StayPnl({ id }: { id: string }) {
  const q = useQuery<StayPnlResponse>({ queryKey: [`/api/reservations/${id}/pnl`] });
  if (q.isLoading) return <Skeleton className="h-28 max-w-md" data-testid={`stay-pnl-loading-${id}`} />;
  if (q.isError || !q.data) {
    return (
      <QueryErrorState
        error={q.error instanceof Error ? q.error : null}
        onRetry={() => q.refetch()}
        isRetrying={q.isRefetching}
        compact
        title="Couldn't load this stay's P&L"
        description="We hit a snag reading this stay. Your data is safe — try again."
        testId={`stay-pnl-error-${id}`}
      />
    );
  }
  const { pnl, allocation: a } = q.data;
  return (
    <div className="space-y-2" data-testid={`stay-pnl-${id}`}>
      <dl className="grid max-w-md gap-1">
        {pnl.lines.map((l) => (
          <div key={l.key} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{l.label}</dt>
            <dd className="tabular-nums">
              {!l.available
                ? l.key === "allocated_operating_expense" ? "no expenses recorded" : "not recorded"
                : `${l.kind === "deduction" && l.amountCents ? "−" : ""}${centsExact(l.amountCents)}`}
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-border pt-1 font-semibold">
          <dt>Net</dt>
          <dd className="tabular-nums" data-testid={`stay-pnl-net-${id}`}>{centsExact(pnl.netCents)}</dd>
        </div>
      </dl>
      <p className="text-micro text-muted-foreground">
        {pnl.netCents === null && "Net shows once every line above is recorded. "}
        {a?.windowNights
          ? `The operating-expense share spreads the ${centsExact(a.operatingSumCents)} of operating expenses recorded on this property over their ${a.windowNights} nights. `
          : "Operating expenses are recorded on the Expenses tab. "}
        The cleaning fee and taxes count as pass-throughs, so a cleaner's invoice also logged as an expense counts cleaning twice.
      </p>
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
  const [recording, setRecording] = useState(false);
  const [openPnl, setOpenPnl] = useState<string | null>(null);

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
            records a stay off your own channel payout, and the channel is a label you set, not a live sync.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <div>
              <Label htmlFor="bookings-property" className="text-xs">Property</Label>
              {/* Server-searched (DEFECT-0168): this asked for pageSize=200, which
                  the list route rejects (max 100), so the picker was always empty. */}
              <PropertyCombobox
                id="bookings-property"
                className="h-9 mt-1"
                value={propertyId ? Number(propertyId) : null}
                onChange={(id) => setPropertyId(String(id))}
                placeholder="Choose a property…"
                aria-label="Choose a property"
              />
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

              {recording ? (
                <RecordStayForm propertyId={propertyIdNum} onDone={() => setRecording(false)} />
              ) : reservations.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setRecording(true)} data-testid="button-record-stay">
                  <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                  Record a stay
                </Button>
              )}

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
                  subtitle="Occupancy and ADR have nothing to measure until reservations are on file for this property."
                  framed
                  cta={recording ? { label: "", _noOp: true } : { label: "Record a stay", onClick: () => setRecording(true) }}
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
                        <th scope="col" className="px-3 py-2 text-right font-medium">P&amp;L</th>
                      </tr>
                    </thead>
                    <motion.tbody variants={staggerContainer} initial="hidden" animate="visible">
                      {reservations.map((r) => (
                        <Fragment key={r.id}>
                          <motion.tr variants={staggerItem} className="border-b border-border/40" data-testid={`row-reservation-${r.id}`}>
                            <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.checkIn}</td>
                            <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.checkOut}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.nights ?? "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.guestName ?? "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.channel ?? "—"}</td>
                            <td className="px-3 py-2"><StayStatusSelect r={r} /></td>
                            <td className="px-3 py-2 text-right tabular-nums">{centsExact(r.grossBookingCents)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{centsExact(r.payoutCents)}</td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm" variant="ghost" aria-expanded={openPnl === r.id}
                                aria-label={`P&L for the stay from ${r.checkIn}`}
                                onClick={() => setOpenPnl(openPnl === r.id ? null : r.id)}
                                data-testid={`button-stay-pnl-${r.id}`}
                              >
                                P&amp;L
                              </Button>
                            </td>
                          </motion.tr>
                          {openPnl === r.id && (
                            <tr className="border-b border-border/40 bg-muted/20">
                              <td colSpan={9} className="px-3 py-3"><StayPnl id={r.id} /></td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </motion.tbody>
                  </table>
                </div>
              )}

              <p className="text-micro text-muted-foreground">
                A cancelled stay is kept in the list but excluded from every metric. Room revenue is
                gross booking less the pass-through cleaning fee and taxes — the operator's own recorded
                amounts, never a market or suggested rate. Changing a stay to checked out runs any
                checkout workflow you have switched on in Workflows; recording a stay does not.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
