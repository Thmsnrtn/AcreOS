/**
 * ParcelFactsPanel — owned-parcel facts with their source, date and
 * confidence, plus the data-truth warnings. Behind the Map door, inside the
 * selected-property panel.
 *
 * Renders ONLY what /api/land-data/parcel-lookup returns, which is already
 * the accuracy-gated projection: a fact whose labelled sample has not passed
 * arrives in `withheldFacts` with its reason and is shown as withheld.
 */

import { useQuery } from "@tanstack/react-query";
import { DdReportPurchase } from "./DdReportPurchase";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { PARCEL_FACT_LABELS, type ParcelFactKey } from "@shared/landData/parcelFacts";
import type { ParcelTruth } from "@shared/landData/parcelTruths";

interface ShownFact {
  key: ParcelFactKey;
  status: "computed" | "unavailable";
  value: any;
  confidence: "high" | "medium" | "low" | null;
  method: string;
  reason?: string;
  sources: Array<{ name: string; url: string; retrievedOn: string }>;
  accuracy?: { check: string; sampleSize: number; agreed: number; verifiedOn: string | null };
}

interface LookupResponse {
  found: boolean;
  county?: { status: string; refusalReason: string | null; parcelsStored: number } | null;
  parcel?: {
    parcelKey: string;
    facts: ShownFact[];
    withheldFacts: Array<{ key: ParcelFactKey; label: string; reason: string }>;
    truths: ParcelTruth[];
  };
}

function formatValue(f: ShownFact): string {
  const v = f.value;
  switch (f.key) {
    case "road_frontage_m": return `${Math.round(v)} m (${Math.round(v * 3.28084)} ft)`;
    case "legal_access_indication":
      return v === "public_road_contact" ? "A public road touches the parcel" : v === "non_access_road_contact_only" ? "Only a private drive, trail or limited-access road touches it" : "No road touches the mapped parcel";
    case "buildable_acres": return `${v.acres} of ${v.breakdown.parcelAcres} ac (steep ${v.breakdown.steepAcres}, wetland ${v.breakdown.wetlandAcres}, flood ${v.breakdown.floodAcres})`;
    case "public_land_adjacent": return v.adjacent ? `Yes — ${v.units.map((u: any) => u.name).join(", ")}` : "No";
    case "distance_to_town_km": return `${v.km} km to ${v.town}`;
    case "distance_to_transmission_km": return `${v.km} km`;
    case "out_of_state_owner": return v.outOfState ? `Yes (mailing state ${v.mailingState})` : "No";
  }
}

const TRUTH_ICON = { info: Info, caution: AlertTriangle, warning: ShieldAlert } as const;

export function ParcelFactsPanel({ state, county, apn }: { state: string; county: string; apn: string }) {
  const q = useQuery<LookupResponse>({
    queryKey: ["/api/land-data/parcel-lookup", state, county, apn],
    queryFn: async () => {
      const params = new URLSearchParams({ state, county, apn });
      const res = await fetch(`/api/land-data/parcel-lookup?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    enabled: Boolean(state && county && apn),
  });

  if (!state || !county || !apn) return null;
  if (q.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (q.isError) return <QueryErrorState error={q.error} onRetry={() => q.refetch()} compact />;
  const data = q.data!;
  if (!data.found || !data.parcel) {
    const c = data.county;
    return (
      <p className="text-xs text-muted-foreground" data-testid="parcel-facts-not-loaded">
        {c?.status === "refused"
          ? c.refusalReason
          : c && c.status !== "not_requested"
            ? `This county is being loaded (${c.parcelsStored} parcels so far).`
            : "AcreOS has not loaded this county's free parcel data yet."}
      </p>
    );
  }
  const p = data.parcel;
  return (
    <section className="space-y-3" aria-label="Land facts" data-testid="parcel-facts-panel">
      <ul className="space-y-2">
        {p.facts.map((f) => (
          <li key={f.key} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{PARCEL_FACT_LABELS[f.key]}</span>
              {f.status === "computed" && f.sources[0] && (
                // The shared provenance chip. A "high" rubric fact reads from an
                // authoritative layer finer than the fact's tolerance; medium and
                // low are derived estimates (shared/landData/parcelFacts.ts).
                <DataProvenanceChip
                  source={f.sources.map((s) => s.name).join(" + ")}
                  sourceAsOf={f.sources[0].retrievedOn}
                  classification={f.confidence === "high" ? "authoritative" : "estimate"}
                />
              )}
            </div>
            <p>{f.status === "computed" ? formatValue(f) : f.reason}</p>
            <p className="text-muted-foreground">
              {f.sources.map((s) => `${s.name}, retrieved ${s.retrievedOn}`).join(" · ")}
            </p>
            {f.accuracy && f.accuracy.sampleSize > 0 && (
              <p className="text-muted-foreground" title={f.accuracy.check}>
                Checked against the source on {f.accuracy.agreed} of {f.accuracy.sampleSize} sampled parcels.
              </p>
            )}
          </li>
        ))}
        {p.withheldFacts.map((w) => (
          <li key={w.key} className="text-xs text-muted-foreground">
            <span className="font-medium">{w.label}:</span> {w.reason}
          </li>
        ))}
      </ul>
      <ul className="space-y-1.5" aria-label="What this data cannot tell you">
        {p.truths.map((t) => {
          const Icon = TRUTH_ICON[t.severity];
          return (
            <li key={t.key} className="flex gap-2 text-xs">
              <Icon className={t.severity === "warning" ? "h-3.5 w-3.5 shrink-0 text-destructive" : "h-3.5 w-3.5 shrink-0 text-muted-foreground"} aria-hidden="true" />
              <span>
                {t.message}
                {t.link && (
                  <>
                    {" "}
                    <a className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2" href={t.link.url} target="_blank" rel="noreferrer">
                      {t.link.label}
                    </a>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <DdReportPurchase parcelKey={p.parcelKey} />
    </section>
  );
}
