/**
 * LandSnapshot — the bundled, decision-grade "Land Snapshot" for a parcel.
 *
 * Investors want ONE answer to "should I look harder at this parcel?", not nine
 * scattered cards. This is the top section of the parcel-detail overview: the
 * six decision fields (flood / soil / wetlands / acreage / buildable / access)
 * plus supporting context, each with a provenance chip (source · as-of ·
 * confidence), and an honest "what we don't know yet" list of the fields we
 * couldn't populate.
 *
 * Assembled entirely server-side from FREE open data we already query — the
 * premium feeling Regrid sells, at $0. Honesty contract: a real "Unknown"
 * outperforms a fake number; gaps are shown, never filled with defaults.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { SPRINGS, useReducedMotionPreference, respectReducedMotion } from "@/lib/motion-tokens";
import { lightImpact } from "@/lib/haptics";
import { usd } from "@/lib/format";
import { Layers, HelpCircle, CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import {
  type LandProfile,
  type LandField,
  type LandProfileGap,
  type LandProfileFields,
  LAND_PROFILE_FIELD_ORDER,
  LAND_PROFILE_FIELD_LABELS,
} from "@shared/landProfile";

interface LandSnapshotProps {
  propertyId: number;
}

/**
 * Per-tile reveal interval (ms) for the staged "snapshot assembling" feel — the
 * same source-by-source choreography the public /tools/parcel-check streams,
 * applied here once the assembled profile lands. Tight enough to feel alive,
 * slow enough that each tile registers as its own arrival.
 */
const REVEAL_STEP_MS = 110;

/**
 * useStaggeredReveal — advance a "revealed up to" index one tile per tick,
 * firing a lightImpact() as each tile lands so the customer FEELS the snapshot
 * assemble. Under reduced motion it reveals everything instantly with no haptic.
 * The reveal restarts whenever `resetKey` changes (a new parcel) or `count`
 * grows.
 */
function useStaggeredReveal(count: number, reduced: boolean, resetKey: unknown): number {
  const [revealed, setRevealed] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (reduced || count <= 0) {
      setRevealed(count);
      return;
    }
    // Reveal the first tile immediately, then march the rest in.
    setRevealed(count > 0 ? 1 : 0);
    let i = 1;
    const tick = () => {
      i += 1;
      setRevealed(Math.min(i, count));
      lightImpact();
      if (i < count) timer.current = setTimeout(tick, REVEAL_STEP_MS);
    };
    if (count > 1) timer.current = setTimeout(tick, REVEAL_STEP_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [count, reduced, resetKey]);

  return revealed;
}

/** Format a single field's value for display, by field key. */
function formatValue(key: keyof LandProfileFields, value: unknown): string {
  if (value === null || value === undefined) return "—";
  switch (key) {
    case "acreage":
      return `${Number(value).toLocaleString()} ac`;
    case "wetlandsPercentage":
    case "buildablePercentage":
      return `${Math.round(Number(value))}%`;
    case "agValuePerAcre":
      return `${usd(Number(value), { noCents: true })}/ac`;
    case "roadAccess":
    case "waterAccess":
    case "powerAccess":
      return value === true ? "Yes" : "No";
    case "soilCapabilityClass":
      return `Class ${String(value)}`;
    default:
      return String(value);
  }
}

const GAP_REASON_LABEL: Record<LandProfileGap["reason"], string> = {
  not_looked_up: "Not yet pulled",
  no_data: "No data at this location",
  lookup_failed: "Source unavailable",
};

const GAP_REASON_ICON: Record<LandProfileGap["reason"], typeof MinusCircle> = {
  not_looked_up: HelpCircle,
  no_data: MinusCircle,
  lookup_failed: XCircle,
};

/**
 * One field tile: label, value, and provenance chip. Springs in when its turn
 * in the staged reveal arrives (SPRINGS.smooth); collapses to instant under
 * reduced motion. Same choreography language as the public streaming widget.
 */
function FieldTile({
  fieldKey,
  field,
  reduced,
}: {
  fieldKey: keyof LandProfileFields;
  field: LandField<unknown>;
  reduced: boolean;
}) {
  return (
    <motion.div
      layout
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={respectReducedMotion(SPRINGS.smooth, reduced)}
      className="rounded-lg border border-border bg-card p-3 flex flex-col gap-1"
      data-testid={`land-snapshot-field-${fieldKey}`}
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
        {LAND_PROFILE_FIELD_LABELS[fieldKey]}
      </span>
      <span className="text-lg font-semibold leading-tight">
        {formatValue(fieldKey, field.value)}
      </span>
      <DataProvenanceChip
        source={field.source}
        sourceAsOf={field.asOf}
        confidence={field.confidence}
        classification={field.classification}
      />
    </motion.div>
  );
}

export function LandSnapshot({ propertyId }: LandSnapshotProps) {
  const reduced = useReducedMotionPreference();
  const {
    data: profile,
    isLoading,
    error,
    refetch,
  } = useQuery<LandProfile>({
    queryKey: [`/api/properties/${propertyId}/land-profile`],
    enabled: Number.isFinite(propertyId) && propertyId > 0,
    // The snapshot is assembled from cached enrichment; keep it fresh-ish but
    // don't refetch aggressively (it can trigger a live fetch on a cold parcel).
    staleTime: 5 * 60 * 1000,
  });

  const populatedFields = profile
    ? LAND_PROFILE_FIELD_ORDER.filter(
        (key) => (profile as LandProfileFields)[key] !== undefined,
      )
    : [];

  // Staged reveal — tiles spring in one-by-one with a haptic per arrival, the
  // same "watch the snapshot assemble" choreography the public widget streams.
  // Keyed on propertyId so navigating to a new parcel replays the reveal.
  const revealed = useStaggeredReveal(populatedFields.length, reduced, propertyId);

  if (isLoading) {
    return (
      <Card data-testid="land-snapshot-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="w-4 h-4" aria-hidden="true" />
            Land Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[5.5rem] w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !profile) {
    return (
      <QueryErrorState
        error={error}
        onRetry={() => refetch()}
        title="Couldn't load the Land Snapshot"
        description="The free open-data sources may be temporarily unavailable. Try again."
      />
    );
  }

  return (
    <Card data-testid="land-snapshot">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="w-4 h-4" aria-hidden="true" />
            Land Snapshot
          </CardTitle>
          <span className="text-xs text-muted-foreground" data-testid="land-snapshot-completeness">
            {profile.fieldsPopulated} of {profile.fieldsTotal} fields ·{" "}
            {profile.fromCache ? "cached" : "freshly pulled"} · free open data
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {populatedFields.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {populatedFields.slice(0, revealed).map((key) => (
              <FieldTile
                key={key}
                fieldKey={key}
                field={(profile as LandProfileFields)[key] as LandField<unknown>}
                reduced={reduced}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="land-snapshot-empty">
            We haven't pulled any free open-data fields for this parcel yet. Add
            coordinates to populate the snapshot.
          </p>
        )}

        {/* Honest "what we don't know yet" — never fake a value. */}
        {profile.gaps.length > 0 && (
          <div
            className="rounded-lg border border-dashed border-border bg-muted/30 p-3"
            data-testid="land-snapshot-gaps"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                What we don't know yet
              </span>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {profile.gaps.map((gap) => {
                const Icon = GAP_REASON_ICON[gap.reason];
                return (
                  <li
                    key={gap.field}
                    className="flex items-center justify-between gap-2 text-sm"
                    data-testid={`land-snapshot-gap-${gap.field}`}
                  >
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      {gap.label}
                    </span>
                    <span className="text-micro text-muted-foreground/80 shrink-0">
                      {GAP_REASON_LABEL[gap.reason]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Hold the celebration until the staged reveal finishes so it lands as
            the payoff of watching every tile arrive, not a premature flash. */}
        {profile.gaps.length === 0 &&
          populatedFields.length > 0 &&
          revealed >= populatedFields.length && (
            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={respectReducedMotion(SPRINGS.smooth, reduced)}
              className="flex items-center gap-1.5 text-sm text-acr-pos"
              data-testid="land-snapshot-complete"
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              Every tracked land field is populated from free open data.
            </motion.p>
          )}
      </CardContent>
    </Card>
  );
}
