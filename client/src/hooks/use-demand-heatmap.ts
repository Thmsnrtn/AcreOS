/**
 * T44 — Demand Heatmap Layer Hook
 *
 * Fetches buyer demand signal data from the server and returns
 * GeoJSON-compatible feature collection for Mapbox GL heatmap layer rendering.
 *
 * Data sources:
 *   - buyerBehaviorEvents table: search clicks, saved searches, bid placements
 *   - demandHeatmaps table: pre-aggregated demand scores per county
 *
 * Usage in maps.tsx:
 *   const { heatmapData, isLoading } = useDemandHeatmap(bounds, { enabled: showDemand });
 *   map.addSource("demand", { type: "geojson", data: heatmapData });
 *   map.addLayer({ id: "demand-heat", type: "heatmap", source: "demand", ... });
 */

import { useQuery } from "@tanstack/react-query";

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface DemandPoint {
  lat: number;
  lng: number;
  weight: number; // 0–1 normalized demand intensity
  county?: string;
  state?: string;
  eventCount: number;
}

interface GeoJsonPoint {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { weight: number; county: string | undefined; eventCount: number };
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonPoint[];
}

export function useDemandHeatmap(
  bounds: MapBounds | null,
  options: { enabled?: boolean; resolution?: "county" | "state" } = {}
) {
  const { enabled = true, resolution = "county" } = options;

  const { data, isLoading, error } = useQuery<DemandPoint[]>({
    queryKey: ["/api/analytics/demand-heatmap", bounds, resolution],
    queryFn: async () => {
      if (!bounds) return [];
      const params = new URLSearchParams({
        north: bounds.north.toString(),
        south: bounds.south.toString(),
        east: bounds.east.toString(),
        west: bounds.west.toString(),
        resolution,
      });
      const res = await fetch(`/api/analytics/demand-heatmap?${params}`);
      if (!res.ok) throw new Error("Failed to load demand data");
      return res.json();
    },
    enabled: enabled && !!bounds,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  // Convert to GeoJSON for Mapbox
  const heatmapData: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: (data ?? []).map(p => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { weight: p.weight, county: p.county, eventCount: p.eventCount },
    })),
  };

  return { heatmapData, points: data ?? [], isLoading, error };
}
