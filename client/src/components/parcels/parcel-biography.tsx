/**
 * ParcelBiography — the "Biography" strip on the parcel-detail overview
 * (Iyari #1: "PropStream shows you today; AcreOS shows you the story").
 *
 * Renders the longitudinal story the parcel-biography engine mines from the
 * append-only parcel_observations log:
 *   - a sparkline of assessed value over time (rendered ONLY for a real ≥2-point
 *     series — never a fabricated line),
 *   - owner-change markers + the current-owner tenure clock,
 *   - a tax-status band with recurrence signal,
 * each with a DataProvenanceChip (source · as-of · confidence) and an honest
 * "first seen / last confirmed" from observed_at.
 *
 * Honesty contract (mirrors the Wave-1 land-snapshot patterns): when a field has
 * <2 real points we show a first-seen note, not an invented trend; when the whole
 * log is empty we show an honest empty state. We never draw a line through a
 * single dot.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { usd, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { History, TrendingUp, TrendingDown, Minus, Users, Receipt } from "lucide-react";

// ----------------------------------------------------------------------------
// Response shapes (mirror server/services/parcel-biography.ts — client cannot
// import server modules, so the contract is restated here).
// ----------------------------------------------------------------------------

interface SeriesPoint {
  value: unknown;
  numeric: number | null;
  source: string;
  confidence: number | null;
  observedAt: string; // ISO (serialized Date)
}

interface NumericTrend {
  firstValue: number;
  lastValue: number;
  firstAt: string;
  lastAt: string;
  delta: number;
  pctChange: number | null;
  velocityPerYear: number | null;
  accelerationPerYear2: number | null;
  direction: "rising" | "falling" | "flat" | "mixed";
}

interface FieldBiography {
  field: string;
  series: SeriesPoint[];
  firstSeen: string | null;
  lastConfirmed: string | null;
  sources: string[];
  hasTrend: boolean;
  trend?: NumericTrend;
}

interface OwnerTenure {
  changeCount: number;
  currentOwnerSince: string | null;
  currentTenureYears: number | null;
  medianYearsBetweenChanges: number | null;
}

interface TaxRecurrence {
  delinquentCount: number;
  isRecurring: boolean;
  episodes: number;
  medianYearsBetweenEpisodes: number | null;
  currentlyDelinquent: boolean;
}

interface ParcelBiographyData {
  apn: string;
  state: string;
  county: string;
  fields: Record<string, FieldBiography>;
  assessedValue: FieldBiography | null;
  taxStatus: FieldBiography | null;
  owner: FieldBiography | null;
  ownerTenure: OwnerTenure | null;
  taxRecurrence: TaxRecurrence | null;
  observationCount: number;
  hasAnySeries: boolean;
}

interface ParcelBiographyProps {
  propertyId: number;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function formatPct(pct: number | null): string | null {
  if (pct == null) return null;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${(pct * 100).toFixed(pct >= 0.1 || pct <= -0.1 ? 0 : 1)}%`;
}

/** A small inline SVG sparkline. Renders nothing for <2 numeric points. */
function Sparkline({ points }: { points: SeriesPoint[] }) {
  const numeric = points.filter((p) => p.numeric !== null) as Array<
    SeriesPoint & { numeric: number }
  >;
  if (numeric.length < 2) return null;

  const W = 240;
  const H = 56;
  const PAD = 4;
  const xs = numeric.map((p) => new Date(p.observedAt).getTime());
  const ys = numeric.map((p) => p.numeric);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const coords = numeric.map((p, i) => {
    const x = PAD + ((xs[i] - minX) / spanX) * (W - 2 * PAD);
    // SVG y grows downward; invert so higher value = higher on screen.
    const y = PAD + (1 - (ys[i] - minY) / spanY) * (H - 2 * PAD);
    return { x, y };
  });

  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-14"
      role="img"
      aria-label={`Assessed value trend across ${numeric.length} observations`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--acr-accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={1.6} fill="var(--acr-accent)" vectorEffect="non-scaling-stroke" />
      ))}
      <circle cx={last.x} cy={last.y} r={2.6} fill="var(--acr-pos)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Honest "first seen / last confirmed" footer for any field. */
function ObservedFootnote({ field }: { field: FieldBiography }) {
  return (
    <p className="text-micro text-muted-foreground leading-none mt-1">
      First seen {formatDate(field.firstSeen)} · Last confirmed {formatDate(field.lastConfirmed)}
    </p>
  );
}

// ----------------------------------------------------------------------------
// Sub-sections
// ----------------------------------------------------------------------------

function AssessedValueStrip({ field }: { field: FieldBiography }) {
  const trend = field.hasTrend ? field.trend : undefined;
  const lastPoint = field.series[field.series.length - 1];
  const lastSource = lastPoint?.source ?? field.sources[0];
  const lastConfidence = lastPoint?.confidence != null ? Math.round(lastPoint.confidence * 100) : null;

  const DirIcon =
    trend?.direction === "rising"
      ? TrendingUp
      : trend?.direction === "falling"
        ? TrendingDown
        : Minus;
  const dirToneClass =
    trend?.direction === "rising"
      ? "text-acr-pos"
      : trend?.direction === "falling"
        ? "text-acr-heat-hot"
        : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid="biography-assessed-value">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Assessed value
        </span>
        <DataProvenanceChip
          source={lastSource}
          sourceAsOf={field.lastConfirmed}
          confidence={lastConfidence}
          classification="authoritative"
        />
      </div>

      {field.hasTrend && trend ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-semibold leading-tight">
              {usd(trend.lastValue, { noCents: true })}
            </span>
            <span className={cn("inline-flex items-center gap-1 text-sm font-medium", dirToneClass)}>
              <DirIcon className="w-3.5 h-3.5" aria-hidden="true" />
              {formatPct(trend.pctChange) ?? "—"}
            </span>
          </div>
          <Sparkline points={field.series} />
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-micro text-muted-foreground mt-1">
            <span>
              From {usd(trend.firstValue, { noCents: true })} ({field.series.length} points)
            </span>
            {trend.velocityPerYear != null ? (
              <span>
                ~{usd(Math.round(trend.velocityPerYear), { noCents: true })}/yr
              </span>
            ) : null}
            {trend.accelerationPerYear2 != null ? (
              <span>{trend.accelerationPerYear2 > 0 ? "accelerating" : "slowing"}</span>
            ) : null}
          </div>
        </>
      ) : (
        // Honest single-point / empty state — never draw a line through one dot.
        <div>
          <span className="text-lg font-semibold leading-tight">
            {lastPoint?.numeric != null ? usd(lastPoint.numeric, { noCents: true }) : "—"}
          </span>
          <p className="text-micro text-muted-foreground mt-0.5">
            Only one observation so far — a trend appears once we record a second.
          </p>
        </div>
      )}
      <ObservedFootnote field={field} />
    </div>
  );
}

function OwnerStrip({
  field,
  tenure,
}: {
  field: FieldBiography;
  tenure: OwnerTenure | null;
}) {
  const lastPoint = field.series[field.series.length - 1];
  const currentOwner = lastPoint?.value != null ? String(lastPoint.value) : "—";

  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid="biography-owner">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium inline-flex items-center gap-1">
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          Ownership
        </span>
        <DataProvenanceChip
          source={lastPoint?.source ?? field.sources[0]}
          sourceAsOf={field.lastConfirmed}
          classification="authoritative"
        />
      </div>
      <span className="text-base font-semibold leading-tight block truncate" title={currentOwner}>
        {currentOwner}
      </span>
      {tenure ? (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-micro text-muted-foreground mt-1">
          {tenure.currentTenureYears != null ? (
            <span>
              Held {tenure.currentTenureYears} yr{tenure.currentTenureYears === 1 ? "" : "s"}
            </span>
          ) : null}
          {tenure.changeCount > 0 ? (
            <span>
              {tenure.changeCount} owner change{tenure.changeCount === 1 ? "" : "s"} on record
            </span>
          ) : (
            <span>No owner change observed yet</span>
          )}
          {tenure.medianYearsBetweenChanges != null ? (
            <span>~{tenure.medianYearsBetweenChanges} yr deed cadence</span>
          ) : null}
        </div>
      ) : null}
      <ObservedFootnote field={field} />
    </div>
  );
}

function TaxStatusStrip({
  field,
  recurrence,
}: {
  field: FieldBiography;
  recurrence: TaxRecurrence | null;
}) {
  const lastPoint = field.series[field.series.length - 1];
  const current = lastPoint?.value != null ? String(lastPoint.value) : "—";
  const delinquent = recurrence?.currentlyDelinquent ?? false;

  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid="biography-tax-status">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium inline-flex items-center gap-1">
          <Receipt className="w-3.5 h-3.5" aria-hidden="true" />
          Tax status
        </span>
        <DataProvenanceChip
          source={lastPoint?.source ?? field.sources[0]}
          sourceAsOf={field.lastConfirmed}
          classification="authoritative"
        />
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-block w-2 h-2 rounded-full shrink-0",
          )}
          style={{ backgroundColor: delinquent ? "var(--acr-heat-hot)" : "var(--acr-pos)" }}
          aria-hidden="true"
        />
        <span className="text-base font-semibold leading-tight capitalize">{current}</span>
      </div>
      {recurrence && recurrence.episodes > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-micro text-muted-foreground mt-1">
          {recurrence.isRecurring ? (
            <span className="text-acr-heat-hot font-medium">
              Recurring — {recurrence.episodes} delinquency episodes
              {recurrence.medianYearsBetweenEpisodes != null
                ? ` (~every ${recurrence.medianYearsBetweenEpisodes} yr)`
                : ""}
            </span>
          ) : (
            <span>1 delinquency episode on record</span>
          )}
        </div>
      ) : null}
      <ObservedFootnote field={field} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

export function ParcelBiography({ propertyId }: ParcelBiographyProps) {
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<ParcelBiographyData>({
    queryKey: [`/api/parcel-biography/${propertyId}`],
    enabled: Number.isFinite(propertyId) && propertyId > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card data-testid="parcel-biography-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="w-4 h-4" aria-hidden="true" />
            Biography
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="parcel-biography-error">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="w-4 h-4" aria-hidden="true" />
            Biography
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QueryErrorState error={error} onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const assessed = data.assessedValue;
  const owner = data.owner;
  const taxStatus = data.taxStatus;
  const hasAnyField = Boolean(assessed || owner || taxStatus);

  return (
    <Card data-testid="parcel-biography">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="w-4 h-4" aria-hidden="true" />
          Biography
          <span className="text-micro font-normal text-muted-foreground">
            the parcel&rsquo;s story, from the observation log
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasAnyField ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {assessed ? <AssessedValueStrip field={assessed} /> : null}
            {owner ? <OwnerStrip field={owner} tenure={data.ownerTenure} /> : null}
            {taxStatus ? <TaxStatusStrip field={taxStatus} recurrence={data.taxRecurrence} /> : null}
          </div>
        ) : (
          // Honest empty state — we have not recorded any history for this parcel
          // yet. We never fabricate a trend to fill the space.
          <div
            className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground"
            data-testid="parcel-biography-empty"
          >
            <p className="font-medium text-foreground">No history recorded yet</p>
            <p className="mt-0.5">
              AcreOS captures a parcel&rsquo;s assessed value, owner, and tax status every time we
              look it up. As soon as we observe this parcel more than once, its trajectory appears
              here — the story a snapshot can&rsquo;t show.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ParcelBiography;
