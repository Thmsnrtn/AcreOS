/**
 * LandCoveragePanel — the honest free-parcel coverage map, behind the Map door.
 *
 * Shows, per Tennessee county, what the free county source census verified:
 * a source whose terms allow AcreOS to keep a copy, a source usable for live
 * lookups only, unverified candidates, or nothing found. The colors come from
 * the census rows; nothing is inferred. A customer can ask AcreOS to load a
 * county: the server either queues it or says exactly why it cannot (no free
 * source, terms forbid storing, review pending) and records the demand.
 *
 * Opened from the Map page header (a sheet, not a new nav entry).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPinned, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest } from "@/lib/queryClient";
import { STYLE_URLS } from "@/lib/map-engine";
import {
  COVERAGE_LABELS,
  type CountyCoverage,
  type StateCensus,
} from "@shared/landData/countySourceCensus";
import tnBoundaries from "@shared/landData/tnCountyBoundaries.json";

interface CoverageResponse {
  counties: StateCensus[];
  statewidePrograms: Array<{ state: string; attribution: string; sourceUrl: string; termsUrl: string | null; note: string }>;
}

interface ProcessOutcome {
  status: string;
  refusalReason: string | null;
  demandCount: number;
}

/** Map fill per coverage class — read from the theme so it follows dark mode. */
function coverageColor(c: CountyCoverage): string {
  const css = getComputedStyle(document.documentElement);
  const token = {
    storable_with_manual_download: "--acr-pos",
    lookup_only: "--acr-warn",
    unverified_candidates: "--muted-foreground",
    no_source_found: "--destructive",
  }[c];
  const v = css.getPropertyValue(token).trim();
  return v ? (v.startsWith("#") || v.startsWith("rgb") || v.startsWith("hsl") ? v : `hsl(${v})`) : "gray";
}

const BADGE_VARIANT: Record<CountyCoverage, "default" | "secondary" | "outline" | "destructive"> = {
  storable_with_manual_download: "default",
  lookup_only: "secondary",
  unverified_candidates: "outline",
  no_source_found: "destructive",
};

export function LandCoveragePanel() {
  const coverage = useQuery<CoverageResponse>({
    queryKey: ["/api/land-data/coverage"],
    queryFn: async () => {
      const res = await fetch("/api/land-data/coverage", { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
  });
  const [state, setState] = useState("TN");
  const [county, setCounty] = useState("");
  const [outcome, setOutcome] = useState<ProcessOutcome | null>(null);

  // allow-no-invalidation: records demand / queues a county — the answer is shown inline
  const process = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/land-data/counties/process", { state: state.trim(), county: county.trim() });
      return (await res.json()) as ProcessOutcome;
    },
    onSuccess: (o) => setOutcome(o),
  });

  const tn = coverage.data?.counties.find((c) => c.state === "TN");
  const byFips = useMemo(() => new Map((tn?.rows ?? []).map((r) => [r.countyFips, r])), [tn]);
  const tally = useMemo(() => {
    const t: Partial<Record<CountyCoverage, number>> = {};
    for (const r of tn?.rows ?? []) t[r.coverage] = (t[r.coverage] ?? 0) + 1;
    return t;
  }, [tn]);

  const mapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!mapRef.current || !tn) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: STYLE_URLS.streets,
      bounds: [[-90.4, 34.9], [-81.6, 36.7]],
      fitBoundsOptions: { padding: 8 },
      interactive: true,
    });
    map.on("load", () => {
      const features = (tnBoundaries as any).features.map((f: any) => {
        const row = byFips.get(f.properties.fips);
        return { ...f, properties: { ...f.properties, color: row ? coverageColor(row.coverage) : "gray" } };
      });
      map.addSource("tn-coverage", { type: "geojson", data: { type: "FeatureCollection", features } });
      map.addLayer({ id: "tn-coverage-fill", type: "fill", source: "tn-coverage", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.45 } });
      map.addLayer({ id: "tn-coverage-line", type: "line", source: "tn-coverage", paint: { "line-color": ["get", "color"], "line-width": 0.6 } });
    });
    return () => map.remove();
  }, [tn, byFips]);

  if (coverage.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    );
  }
  if (coverage.isError) {
    return <QueryErrorState error={coverage.error} onRetry={() => coverage.refetch()} compact />;
  }
  if (!tn) {
    return (
      <EmptyState
        icon={MapPinned}
        headline="No county census loaded yet"
        subtitle="The free-source census has not been built for any state."
        cta={{ label: "Back to the map", href: "/maps" }}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="land-coverage-panel">
      <div>
        <h3 className="text-sm font-medium">Free parcel sources — Tennessee</h3>
        <p className="text-xs text-muted-foreground">
          Census built {tn.builtOn} from live checks. A county shows only what its sources prove.
        </p>
      </div>
      <div ref={mapRef} className="h-56 w-full rounded-md border" role="img" aria-label="Map of Tennessee counties colored by free parcel source coverage" />
      <ul className="space-y-1 text-xs" aria-label="Coverage legend">
        {(Object.keys(COVERAGE_LABELS) as CountyCoverage[]).map((c) => (
          <li key={c} className="flex items-center justify-between gap-2" data-testid={`coverage-legend-${c}`}>
            {/* The label wraps and the count never does: on a phone-width sheet
                a one-line badge pushed "86 counties" past the edge. */}
            <Badge variant={BADGE_VARIANT[c]} className="min-w-0 whitespace-normal text-left">{COVERAGE_LABELS[c]}</Badge>
            <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground" data-testid={`coverage-count-${c}`}>
              {tally[c] ?? 0} {(tally[c] ?? 0) === 1 ? "county" : "counties"}
            </span>
          </li>
        ))}
      </ul>

      <form
        className="space-y-2 rounded-md border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (state.trim().length === 2 && county.trim()) process.mutate();
        }}
      >
        <p className="text-xs font-medium">Load a county's free parcels</p>
        <div className="grid grid-cols-[4rem_1fr] gap-2">
          <div>
            <Label htmlFor="cov-state" className="text-xs">State</Label>
            <Input id="cov-state" value={state} maxLength={2} onChange={(e) => setState(e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label htmlFor="cov-county" className="text-xs">County</Label>
            <Input id="cov-county" value={county} onChange={(e) => setCounty(e.target.value)} placeholder="DeKalb" />
          </div>
        </div>
        <Button type="submit" size="sm" disabled={process.isPending || !county.trim()}>
          {process.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Request this county
        </Button>
        {process.isError && <p className="text-xs text-destructive">The request did not go through. Try again.</p>}
        {outcome && (
          <p className="text-xs" role="status">
            {outcome.status === "refused"
              ? outcome.refusalReason
              : outcome.status === "complete"
                ? "This county is loaded."
                : `Queued. ${outcome.demandCount} request${outcome.demandCount === 1 ? "" : "s"} so far — counties load in order of demand.`}
          </p>
        )}
      </form>

      {coverage.data!.statewidePrograms.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Statewide programs (live lookups)</p>
          <ul className="text-xs text-muted-foreground">
            {coverage.data!.statewidePrograms.map((p) => (
              <li key={p.state}>
                <a className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2" href={p.sourceUrl} target="_blank" rel="noreferrer">
                  {p.state} — {p.attribution}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
