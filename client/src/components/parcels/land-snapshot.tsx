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

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
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

/** One field tile: label, value, and provenance chip. */
function FieldTile({
  fieldKey,
  field,
}: {
  fieldKey: keyof LandProfileFields;
  field: LandField<unknown>;
}) {
  return (
    <div
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
    </div>
  );
}

export function LandSnapshot({ propertyId }: LandSnapshotProps) {
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

  const populatedFields = LAND_PROFILE_FIELD_ORDER.filter(
    (key) => (profile as LandProfileFields)[key] !== undefined,
  );

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
            {populatedFields.map((key) => (
              <FieldTile
                key={key}
                fieldKey={key}
                field={(profile as LandProfileFields)[key] as LandField<unknown>}
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

        {profile.gaps.length === 0 && populatedFields.length > 0 && (
          <p
            className="flex items-center gap-1.5 text-sm text-acr-pos"
            data-testid="land-snapshot-complete"
          >
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            Every tracked land field is populated from free open data.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
