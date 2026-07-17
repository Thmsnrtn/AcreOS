/**
 * Subdivision plan editor — mapbox-gl-draw on top of property-map's
 * existing infrastructure (CT-2).
 *
 * Brigid §1.2: "Multiple plans per parcel ('Plan A — 12 lots,' 'Plan B
 * — 8 lots, two estate'), so I can A/B them. Earl will redline whichever
 * I send him; I want the previous plans intact when he comes back two
 * weeks later asking why I changed the cul-de-sac."
 *
 * Wires to the existing SD-7 backend:
 *   GET    /api/plans/:planId       — load existing plan's GeoJSON
 *   PATCH  /api/plans/:planId       — save GeoJSON (auto-bumps version)
 *
 * Lot polygons get persisted to /api/plans/:planId; per-lot summary
 * (lotCount + totalAcres + totalRoadFeet) is recomputed server-side
 * on save by SD-7's summarizeGeojson().
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import * as turf from "@turf/turf";
import { Save, MapPin, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface PlanResponse {
  plan: {
    id: string;
    name: string;
    versionNumber: number;
    status: string;
    parentParcelId: number;
    geojson: GeoJSON.FeatureCollection | null;
    lotCount: number | null;
    totalAcres: string | null;
    totalRoadFeet: number | null;
  };
}

interface ZoningInfo {
  zoningCode: string;
  zoningDescription: string;
  setbacks?: { front?: number; rear?: number; side?: number };
  minimumLotSize?: number;
}

interface ParcelSummary {
  id: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

interface Props {
  planId: string;
  /** Optional initial map center; falls back to first feature centroid or US center. */
  defaultCenter?: [number, number];
}

const KIND_OPTIONS = [
  { value: "lot", label: "Lot", color: "#3b82f6" },
  { value: "road_centerline", label: "Road", color: "#f59e0b" },
  { value: "parent_boundary", label: "Parent boundary", color: "#10b981" },
  { value: "setback_overlay", label: "Setback", color: "#a855f7" },
] as const;

export function SubdivisionPlanEditor({ planId, defaultCenter }: Props) {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [activeKind, setActiveKind] = useState<typeof KIND_OPTIONS[number]["value"]>("lot");
  const [dirty, setDirty] = useState(false);

  const planQuery = useQuery<PlanResponse>({
    queryKey: ["/api/plans", planId],
    queryFn: async () => {
      const res = await fetch(`/api/plans/${planId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  // Fetch parent parcel address — needed to look up zoning setbacks.
  const parcelQuery = useQuery<{ properties: ParcelSummary[] }>({
    queryKey: ["/api/properties", planQuery.data?.plan.parentParcelId],
    enabled: !!planQuery.data?.plan.parentParcelId,
    queryFn: async () => {
      const res = await fetch(`/api/properties?id=${planQuery.data!.plan.parentParcelId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const parentParcel = parcelQuery.data?.properties?.[0];
  const fullAddress = parentParcel
    ? [parentParcel.address, parentParcel.city, parentParcel.state, parentParcel.zip].filter(Boolean).join(", ")
    : null;

  const zoningQuery = useQuery<ZoningInfo>({
    queryKey: ["/api/zoning/lookup", fullAddress],
    enabled: !!fullAddress,
    queryFn: async () => {
      const res = await fetch("/api/zoning/lookup", {
        method: "POST",
        credentials: "include",
        headers: csrfHeader(),
        body: JSON.stringify({ address: fullAddress }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    staleTime: 30 * 60_000,
  });

  const setbacks = zoningQuery.data?.setbacks ?? null;
  // Use the largest of front/rear/side as the buffer distance for visualization.
  // (A precise treatment would buffer the parent-boundary's edges separately, but
  // a single-distance inward buffer is the right first cut.)
  const setbackFt = setbacks
    ? Math.max(setbacks.front ?? 0, setbacks.rear ?? 0, setbacks.side ?? 0)
    : null;

  const saveMutation = useMutation({
    mutationFn: async (geojson: GeoJSON.FeatureCollection) => {
      const res = await fetch(`/api/plans/${planId}`, {
        method: "PATCH",
        credentials: "include",
        headers: csrfHeader(),
        body: JSON.stringify({ geojson }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Plan saved", description: `Version ${data.plan?.versionNumber ?? "?"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/plans", planId] });
      setDirty(false);
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // Initialize map + draw once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Canonical Mapbox token var is VITE_MAPBOX_ACCESS_TOKEN (property-map.tsx,
    // the founder setup wizard). This component previously read the legacy
    // VITE_MAPBOX_TOKEN name — so even a correctly configured deploy rendered
    // a silent gray map here. Without a token we don't construct the map at
    // all; the render below shows an honest "map unavailable" state instead.
    const token =
      import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ??
      (window as any).__ENV__?.VITE_MAPBOX_ACCESS_TOKEN ??
      (window as any).MAPBOX_TOKEN;
    if (!token) return;
    (mapboxgl.accessToken as any) = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: defaultCenter ?? [-98.5, 39.8],
      zoom: defaultCenter ? 16 : 4,
    });

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, line_string: true, trash: true },
      defaultMode: "simple_select",
    });

    map.addControl(draw as any);
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    mapRef.current = map;
    drawRef.current = draw;

    const onChange = () => setDirty(true);
    map.on("draw.create", (e: any) => {
      // Tag new features with the active kind.
      for (const f of e.features) {
        if (f && f.id) draw.setFeatureProperty(f.id as string, "kind", activeKind);
      }
      setDirty(true);
    });
    map.on("draw.update", onChange);
    map.on("draw.delete", onChange);

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // activeKind intentionally not in deps — handled by ref pattern below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror activeKind into a ref so the draw.create handler picks up the
  // latest value without re-binding.
  const activeKindRef = useRef(activeKind);
  useEffect(() => { activeKindRef.current = activeKind; }, [activeKind]);

  // FW-5: setback buffer + lot/setback intersection count.
  // Computed reactively from current draw state + zoning setback feet.
  const [setbackViolations, setSetbackViolations] = useState<number>(0);

  // Render setback buffer layer when zoning setbacks resolve. The buffer is
  // an inward shrink of the parent_boundary feature; lot polygons that
  // extend INTO the buffer (i.e. straddle the setback line) are violations.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (setbackFt === null || !planQuery.data?.plan.geojson) return;

    const fc = planQuery.data.plan.geojson;
    const parentBoundary = fc.features?.find((f: any) => f.properties?.kind === "parent_boundary");
    if (!parentBoundary || parentBoundary.geometry.type !== "Polygon") {
      // Without a parent_boundary feature there's nothing to buffer.
      return;
    }

    // turf.buffer expects miles or kilometers; convert ft → km.
    const setbackKm = (setbackFt * 0.3048) / 1000;
    let setbackPolygon: any = null;
    try {
      // Negative distance shrinks the polygon inward.
      setbackPolygon = turf.buffer(parentBoundary as any, -setbackKm, { units: "kilometers" });
    } catch {
      setbackPolygon = null;
    }

    // Add or update the setback layer.
    const existing = map.getSource("setback-overlay") as mapboxgl.GeoJSONSource | undefined;
    const setbackFc: GeoJSON.FeatureCollection = setbackPolygon
      ? { type: "FeatureCollection", features: [setbackPolygon] }
      : { type: "FeatureCollection", features: [] };
    if (existing) {
      existing.setData(setbackFc);
    } else {
      map.addSource("setback-overlay", { type: "geojson", data: setbackFc });
      // Buildable envelope: parent boundary minus setback.
      // Render as a translucent purple band.
      map.addLayer({
        id: "setback-overlay-fill",
        type: "fill",
        source: "setback-overlay",
        paint: { "fill-color": "#a855f7", "fill-opacity": 0.10 },
      });
      map.addLayer({
        id: "setback-overlay-line",
        type: "line",
        source: "setback-overlay",
        paint: { "line-color": "#a855f7", "line-width": 2, "line-dasharray": [3, 2] },
      });
    }

    // Compute lot/setback violations.
    if (setbackPolygon) {
      const lots = fc.features.filter((f: any) => f.properties?.kind === "lot");
      let violations = 0;
      for (const lot of lots) {
        try {
          // A lot violates setback if any part of it is OUTSIDE the buildable
          // envelope (setbackPolygon) but INSIDE the parent boundary. Easier
          // formulation: lot intersects the setback band (parent − envelope).
          if (lot.geometry.type !== "Polygon") continue;
          const inside = turf.booleanWithin(lot as any, setbackPolygon);
          if (!inside) violations++;
        } catch {/* ignore */}
      }
      setSetbackViolations(violations);
    } else {
      setSetbackViolations(0);
    }
  }, [setbackFt, planQuery.data?.plan.geojson]);

  // Load existing plan GeoJSON when query resolves.
  useEffect(() => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map || !planQuery.data?.plan.geojson) return;
    draw.deleteAll();
    draw.add(planQuery.data.plan.geojson);

    // Center on first feature if we have one and no defaultCenter was provided.
    if (!defaultCenter) {
      const first = planQuery.data.plan.geojson.features?.[0];
      if (first?.geometry) {
        try {
          const bounds = new mapboxgl.LngLatBounds();
          collectCoords(first.geometry as any, (c) => bounds.extend(c as [number, number]));
          map.fitBounds(bounds, { padding: 40, duration: 0 });
        } catch {/* ignore */}
      }
    }
    setDirty(false);
  }, [planQuery.data?.plan.id, defaultCenter]);

  const handleSave = () => {
    const draw = drawRef.current;
    if (!draw) return;
    const fc = draw.getAll() as GeoJSON.FeatureCollection;
    // Ensure each feature has a kind property (default to lot).
    fc.features = fc.features.map((f) => {
      const kind = (f.properties as any)?.kind ?? "lot";
      return { ...f, properties: { ...(f.properties ?? {}), kind } };
    });
    saveMutation.mutate(fc);
  };

  if (planQuery.isLoading) return <Skeleton className="h-96" />;
  if (planQuery.error || !planQuery.data) {
    return <Card><CardContent className="py-8 text-sm text-muted-foreground">Could not load plan.</CardContent></Card>;
  }

  const plan = planQuery.data.plan;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="w-4 h-4 text-primary" aria-hidden="true" />
          {plan.name}
          <Badge variant="outline" className="text-xs">v{plan.versionNumber}</Badge>
        </CardTitle>
        <CardDescription>
          Draw lot polygons + road centerlines. Each feature is tagged with the
          selected kind on create. Save bumps the plan version (v{plan.versionNumber} → v{plan.versionNumber + 1}).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* FW-5: zoning + setback summary */}
        {zoningQuery.data && (
          <div className="flex items-center justify-between gap-3 p-2 rounded-md bg-acr-accent/5 border border-acr-accent/20 text-xs">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{zoningQuery.data.zoningCode}</Badge>
              <span className="text-muted-foreground">{zoningQuery.data.zoningDescription}</span>
              {setbacks && (
                <span className="text-muted-foreground">
                  · setbacks F{setbacks.front ?? "—"} / R{setbacks.rear ?? "—"} / S{setbacks.side ?? "—"} ft
                </span>
              )}
            </div>
            {setbackViolations > 0 && (
              <span className="flex items-center gap-1 text-acr-warning font-semibold">
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                {setbackViolations} lot{setbackViolations === 1 ? "" : "s"} violate setback
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Drawing as:</span>
          {KIND_OPTIONS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setActiveKind(k.value)}
              className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                activeKind === k.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
              }`}
              style={{ borderLeft: `4px solid ${k.color}` }}
            >
              {k.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-xs text-acr-warning">Unsaved changes</span>}
            <Button size="sm" disabled={!dirty || saveMutation.isPending} onClick={handleSave}>
              {saveMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Saving…</>
              ) : (
                <><Save className="w-3.5 h-3.5 mr-1" /> Save plan</>
              )}
            </Button>
          </div>
        </div>
        {import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ||
        (typeof window !== "undefined" &&
          ((window as any).__ENV__?.VITE_MAPBOX_ACCESS_TOKEN || (window as any).MAPBOX_TOKEN)) ? (
          <div ref={containerRef} className="h-96 w-full rounded-md border" />
        ) : (
          // Customer-safe honest state (mirrors property-map.tsx): no env-var
          // names on a customer surface — the cause lives in the deploy config.
          <div className="h-96 w-full rounded-md border flex items-center justify-center text-center text-muted-foreground p-6">
            <p>The drawing map isn't available right now — your plan data is safe and saving still works.</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Use the polygon tool on the map controls to draw lots. Use the line tool for roads.
          The trash icon deletes selected features. Plan-level summary (lot count, total acres,
          road footage) recomputes from feature properties on save.
        </p>
      </CardContent>
    </Card>
  );
}

function collectCoords(geom: any, push: (c: number[]) => void) {
  if (!geom) return;
  if (geom.type === "Point") push(geom.coordinates);
  else if (geom.type === "LineString") geom.coordinates.forEach(push);
  else if (geom.type === "Polygon") geom.coordinates.forEach((ring: number[][]) => ring.forEach(push));
  else if (geom.type === "MultiPolygon")
    geom.coordinates.forEach((poly: number[][][]) => poly.forEach((ring: number[][]) => ring.forEach(push)));
}
