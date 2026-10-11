/**
 * AreaDataPanel — small public datasets about the area around a property,
 * behind the Map door (the selected-property panel). The consumer of
 * /api/land-data/national/:category.
 *
 * Loaded only when the person asks (six outside sources per property is not
 * free for them to answer). Every value is what the source returned for this
 * point; a source that needs a key, or has nothing here, says so in words.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { DataProvenanceChip } from "@/components/data-provenance-chip";

type AnyData = Record<string, any>;

interface Dataset {
  category: string;
  label: string;
  format: (d: AnyData) => string;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-US") : null);

/** One row per dataset the route serves (pinned by tests/unit/areaDataPanel.test.tsx). */
export const AREA_DATASETS: readonly Dataset[] = [
  {
    category: "jobs_lehd",
    label: "Jobs in the county",
    format: (d) => `${n(d.totalJobsAtWorkplaces) ?? "?"} jobs located in ${d.county ?? "the"} County (${d.year})`,
  },
  {
    category: "traffic_counts",
    label: "Nearest traffic count",
    format: (d) => `${n(d.aadt) ?? "?"} vehicles a day on ${d.road} (${d.year}), ${n(d.distanceM) ?? "?"} m away`,
  },
  {
    category: "protected_lands_padus",
    label: "Public land within 1 km",
    format: (d) => (Array.isArray(d.units) && d.units.length ? d.units.map((u: AnyData) => u.name).join(", ") : "None within 1 km"),
  },
  {
    category: "manufactured_home_parks",
    label: "Manufactured-home parks",
    format: (d) => `${n(d.count) ?? "?"} within ${d.radiusMiles} miles`,
  },
  {
    category: "fair_market_rent",
    label: "Fair market rent",
    format: (d) => {
      const two = d.basicdata && !Array.isArray(d.basicdata) ? d.basicdata["Two-Bedroom"] : null;
      return two ? `$${n(two)} for a two-bedroom (${d.areaName ?? "this county"}, ${d.year})` : `Published for ${d.areaName ?? "this county"} (${d.year})`;
    },
  },
  {
    category: "acs_county_profile",
    label: "County profile",
    format: (d) =>
      `${n(d.population) ?? "?"} people · median household income $${n(d.medianHouseholdIncome) ?? "?"} · median rent $${n(d.medianGrossRent) ?? "?"} (${d.acsYear})`,
  },
];

interface NationalResponse {
  available: boolean;
  reason?: string;
  source?: string;
  fetchedAt?: string;
  data?: AnyData;
}

export function AreaDataPanel({ lat, lng, state }: { lat: number; lng: number; state?: string | null }) {
  const [asked, setAsked] = useState(false);
  const q = useQuery<Array<{ ds: Dataset; res: NationalResponse }>>({
    queryKey: ["/api/land-data/national", lat, lng, state ?? ""],
    enabled: asked && Number.isFinite(lat) && Number.isFinite(lng),
    queryFn: async () =>
      Promise.all(
        AREA_DATASETS.map(async (ds) => {
          const params = new URLSearchParams({ lat: String(lat), lng: String(lng), ...(state ? { state } : {}) });
          const res = await fetch(`/api/land-data/national/${ds.category}?${params}`, { credentials: "include" });
          if (!res.ok) return { ds, res: { available: false, reason: "This source could not be reached just now. Try again in a minute." } };
          return { ds, res: (await res.json()) as NationalResponse };
        }),
      ),
  });

  if (!asked) {
    return (
      <Button variant="outline" size="sm" className="text-xs" onClick={() => setAsked(true)}>
        Load area data (jobs, traffic, public land, rents)
      </Button>
    );
  }
  if (q.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {AREA_DATASETS.map((d) => (
          <Skeleton key={d.category} className="h-4 w-full" />
        ))}
      </div>
    );
  }
  if (q.isError) return <QueryErrorState error={q.error} onRetry={() => q.refetch()} compact />;
  return (
    <ul className="space-y-2" aria-label="Area data" data-testid="area-data-panel">
      {(q.data ?? []).map(({ ds, res }) => (
        <li key={ds.category} className="text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{ds.label}</span>
            {res.available && res.source && (
              <DataProvenanceChip source={res.source} sourceAsOf={res.fetchedAt?.slice(0, 10) ?? null} classification="authoritative" />
            )}
          </div>
          <p className="text-muted-foreground">{res.available && res.data ? ds.format(res.data) : res.reason ?? "No answer for this location."}</p>
        </li>
      ))}
    </ul>
  );
}
