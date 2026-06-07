/**
 * SampleParcelPreview — RAFE (Tahoe Wave-2)
 * =========================================
 *
 * "See a sample" affordance. A first customer whose own parcels aren't on the
 * map yet (or who lands on a thin county) can tap this to see the parcel-data
 * aha on a curated, data-rich parcel — soils, flood, wetlands, elevation
 * lighting up from FREE federal/state open data. Nothing here is mocked: it
 * runs a real /api/enrichment/coordinates lookup against the same providers a
 * customer's own parcels use, on coordinates chosen because their county's
 * SSURGO + FEMA NFHL + USGS layers resolve cleanly.
 *
 * Renders inside a bottom Sheet on mobile and a right Sheet on desktop so the
 * map door's "see a sample" works on a 390px phone and a 27-inch monitor alike.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import {
  PropertyEnrichmentWidget,
  type EnrichmentData,
} from "@/components/property-enrichment-widget";
import {
  CURATED_SAMPLE_PARCELS,
  DEFAULT_SAMPLE_PARCEL,
  type CuratedSampleParcel,
} from "@shared/curated-sample-parcels";
import { useIsMobile } from "@/hooks/use-mobile";
import { MapPin, Sparkles } from "lucide-react";

interface SampleParcelPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optionally start on a specific curated parcel; defaults to the first. */
  initialParcelId?: string;
}

export function SampleParcelPreview({
  open,
  onOpenChange,
  initialParcelId,
}: SampleParcelPreviewProps) {
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<CuratedSampleParcel>(
    () =>
      CURATED_SAMPLE_PARCELS.find((p) => p.id === initialParcelId) ??
      DEFAULT_SAMPLE_PARCEL,
  );

  const {
    data: enrichment,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<EnrichmentData>({
    queryKey: ["/api/enrichment/coordinates", "sample", selected.id],
    enabled: open,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch("/api/enrichment/coordinates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: selected.latitude,
          longitude: selected.longitude,
          state: selected.state,
          county: selected.county,
        }),
      });
      if (!res.ok) throw new Error(`Sample lookup failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "h-[85dvh] overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]"
            : "w-full sm:max-w-md overflow-y-auto"
        }
        data-testid="sheet-sample-parcel"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
            See a sample parcel
          </SheetTitle>
          <SheetDescription>
            A real lookup on a data-rich parcel — the same free public-records data
            (FEMA NFHL · USDA SSURGO · USFWS NWI · USGS 3DEP) AcreOS pulls for your
            own properties. This is exactly what you'll see once your parcels are on
            the map.
          </SheetDescription>
        </SheetHeader>

        {/* Curated-parcel picker */}
        <div
          className="flex flex-wrap gap-1.5 mt-4"
          role="group"
          aria-label="Choose a sample parcel"
        >
          {CURATED_SAMPLE_PARCELS.map((p) => {
            const active = p.id === selected.id;
            return (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                className="text-xs h-8"
                aria-pressed={active}
                onClick={() => setSelected(p)}
                data-testid={`button-sample-${p.id}`}
              >
                <MapPin className="w-3 h-3 mr-1" aria-hidden="true" />
                {p.label}
              </Button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="font-normal">
            {selected.county} County, {selected.state}
          </Badge>
          <span className="truncate">{selected.blurb}</span>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton
                className="h-20 w-full rounded-card"
                announceText="Pulling public records for the sample parcel"
              />
              <Skeleton className="h-32 w-full rounded-card" />
              <Skeleton className="h-32 w-full rounded-card" />
            </div>
          ) : isError ? (
            <QueryErrorState
              error={error as Error | null}
              title="Couldn't reach the data sources right now"
              description="Free public GIS servers occasionally hiccup. Try again or pick another sample parcel."
              onRetry={() => refetch()}
            />
          ) : enrichment ? (
            <PropertyEnrichmentWidget enrichmentData={enrichment} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
