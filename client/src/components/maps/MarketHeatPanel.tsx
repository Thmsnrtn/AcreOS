/**
 * MarketHeatPanel — Map-door county market-heat layer (Tier 3F data co-op).
 *
 * Lives INSIDE the Map door (five fixed doors — never a new nav entry):
 * toggled from the "Intelligence layers" section of the Map filters sheet.
 * Shows privacy-preserving county aggregates from the cross-org network:
 * asked/accepted price per acre (median + quartiles), days to seller
 * response, observation density, and Land Credit Score grade mix.
 *
 * Honesty contract: a county is shown with numbers ONLY when the network's
 * k>=5 contributing-parcel floor was cleared (sub-k rollups are never even
 * materialized server-side). Below the floor we show exactly how many more
 * contributing parcels the county needs — never fake heat.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, MapPinned, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Distribution {
  median: number;
  p25: number;
  p75: number;
  n: number;
}

interface CountyHeat {
  state: string;
  county: string;
  hasData: boolean;
  period?: string;
  cohortSize?: number;
  metrics?: {
    askedPricePerAcre: Distribution | null;
    acceptedPricePerAcre: Distribution | null;
    daysToResponse: Distribution | null;
    parcelObservationDensity: {
      parcelsObserved: number;
      observationsInPeriod: number;
    };
    lcsGradeDistribution: { total: number; shares: Record<string, number> } | null;
  };
  parcelsObserved?: number;
  parcelsNeeded?: number;
  privacyFloor?: number;
}

interface MyCountiesResponse {
  counties: CountyHeat[];
  privacyFloor: number;
}

interface BrowseResponse {
  state: string;
  counties: Array<{
    state: string;
    county: string;
    period: string;
    cohortSize: number;
    metrics: CountyHeat["metrics"];
  }>;
  privacyFloor: number;
}

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY",
];

function usdPerAcre(v: number): string {
  return `$${Math.round(v).toLocaleString()}/ac`;
}

function DistRow({ label, dist, money }: { label: string; dist: Distribution | null; money?: boolean }) {
  if (!dist) {
    return (
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-micro text-muted-foreground">{label}</span>
        <span className="text-micro text-muted-foreground">Not enough network data</span>
      </div>
    );
  }
  const fmt = (v: number) => (money ? usdPerAcre(v) : `${Math.round(v * 10) / 10}d`);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-micro text-muted-foreground">{label}</span>
      <span className="text-xs tabular-nums">
        <span className="font-medium">{fmt(dist.median)}</span>
        <span className="text-muted-foreground"> · p25 {fmt(dist.p25)} · p75 {fmt(dist.p75)} · n={dist.n}</span>
      </span>
    </div>
  );
}

function CountyHeatCard({ c }: { c: CountyHeat }) {
  if (!c.hasData) {
    const needed = c.parcelsNeeded ?? 0;
    return (
      <div className="rounded-card border border-border/50 p-3 space-y-1" data-testid={`heat-county-${c.county}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">{c.county}, {c.state}</span>
          <Badge variant="outline" className="text-micro shrink-0">Building coverage</Badge>
        </div>
        <p className="text-micro text-muted-foreground">
          Not enough network data in this county yet — {needed} more contributing
          parcel{needed === 1 ? "" : "s"} needed before aggregates unlock
          ({c.parcelsObserved ?? 0} of {c.privacyFloor ?? 5} so far).
        </p>
      </div>
    );
  }
  const m = c.metrics;
  return (
    <div className="rounded-card border border-border/50 p-3 space-y-1.5" data-testid={`heat-county-${c.county}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{c.county}, {c.state}</span>
        <Badge variant="secondary" className="text-micro shrink-0 tabular-nums">
          {c.cohortSize} parcels · {c.period}
        </Badge>
      </div>
      {m && (
        <div className="space-y-1">
          <DistRow label="Asked $/acre" dist={m.askedPricePerAcre} money />
          <DistRow label="Accepted $/acre" dist={m.acceptedPricePerAcre} money />
          <DistRow label="Days to response" dist={m.daysToResponse} />
          {m.lcsGradeDistribution ? (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-micro text-muted-foreground">LCS grades</span>
              <span className="text-micro tabular-nums truncate">
                {Object.entries(m.lcsGradeDistribution.shares)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([g, pct]) => `${g} ${pct}%`)
                  .join(" · ")}
              </span>
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-micro text-muted-foreground">LCS grades</span>
              <span className="text-micro text-muted-foreground">Not enough scored parcels</span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-micro text-muted-foreground">Observation density</span>
            <span className="text-micro tabular-nums">
              {m.parcelObservationDensity.parcelsObserved} parcels · {m.parcelObservationDensity.observationsInPeriod} this period
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function MarketHeatPanel({
  onClose,
  className,
}: {
  onClose: () => void;
  className?: string;
}) {
  const [browseState, setBrowseState] = useState<string>("");

  const myCounties = useQuery<MyCountiesResponse>({
    queryKey: ["/api/market-heat/my-counties"],
    queryFn: async () => {
      const res = await fetch("/api/market-heat/my-counties", { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
  });

  const browse = useQuery<BrowseResponse>({
    queryKey: ["/api/market-heat/browse", browseState],
    queryFn: async () => {
      const res = await fetch(`/api/market-heat/browse?state=${browseState}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    enabled: /^[A-Z]{2}$/.test(browseState),
  });

  return (
    <Card
      className={cn(
        // Bold Tahoe re-skin (Wave R, §1.4 canvas-overlay chrome): this panel
        // floats OVER the map canvas (positioned absolute by the parent), so it
        // takes the canvas-overlay glass role — `bg-surface-haze` (.90), the
        // bold `backdrop-blur-lg` depth read, a softened `border-border/50`
        // edge-of-light hairline, `shadow-level-2` (Track-1, theme-neutral —
        // floats over content on all sides) and `rounded-card`. Visual-only.
        // See docs/design/reskin-treatment.md.
        "flex flex-col max-h-full overflow-hidden bg-surface-haze backdrop-blur-lg border border-border/50 shadow-level-2 rounded-card",
        className,
      )}
      data-testid="market-heat-panel"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 py-3 px-4 border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Flame className="w-4 h-4 text-acr-heat-warm" aria-hidden="true" />
          County market heat
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          aria-label="Close county market heat panel"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <p className="text-micro text-muted-foreground">
          Aggregated from real activity across the AcreOS network. A county
          appears only after 5+ distinct parcels contribute — below that floor
          the network shows progress, never estimates.
        </p>

        <section aria-label="Market heat for your counties" className="space-y-2">
          <h3 className="text-xs font-semibold">Your counties</h3>
          {myCounties.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-20 w-full rounded-card" />
              <Skeleton className="h-20 w-full rounded-card" />
            </div>
          ) : myCounties.isError ? (
            <QueryErrorState
              error={myCounties.error as Error}
              onRetry={() => myCounties.refetch()}
              isRetrying={myCounties.isRefetching}
              compact
            />
          ) : (myCounties.data?.counties.length ?? 0) === 0 ? (
            <EmptyState
              icon={MapPinned}
              headline="No counties in your inventory yet"
              subtitle="Add a property and its county shows up here with network market data as coverage builds."
              cta={{ label: "Go to inventory", href: "/properties" }}
            />
          ) : (
            <div className="space-y-2">
              {myCounties.data!.counties.map((c) => (
                <CountyHeatCard key={`${c.state}-${c.county}`} c={c} />
              ))}
            </div>
          )}
        </section>

        <section aria-label="Browse market heat by state" className="space-y-2">
          <h3 className="text-xs font-semibold">Browse by state</h3>
          <div>
            <Label htmlFor="market-heat-state" className="sr-only">State</Label>
            <Select value={browseState} onValueChange={setBrowseState}>
              <SelectTrigger id="market-heat-state" className="h-8 text-xs" aria-label="Choose a state to browse county market data">
                <SelectValue placeholder="Choose a state" />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {browseState && browse.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-20 w-full rounded-card" />
            </div>
          ) : browseState && browse.isError ? (
            <QueryErrorState
              error={browse.error as Error}
              onRetry={() => browse.refetch()}
              isRetrying={browse.isRefetching}
              compact
            />
          ) : browseState && browse.data ? (
            browse.data.counties.length === 0 ? (
              <p className="text-micro text-muted-foreground" role="status">
                No county in {browseState} has cleared the 5-parcel network
                floor yet. Working a county adds to its coverage.
              </p>
            ) : (
              <div className="space-y-2">
                {browse.data.counties.map((c) => (
                  <CountyHeatCard
                    key={`${c.state}-${c.county}`}
                    c={{ ...c, hasData: true }}
                  />
                ))}
              </div>
            )
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}
