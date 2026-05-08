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
import { Save, MapPin, Loader2 } from "lucide-react";

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
    geojson: GeoJSON.FeatureCollection | null;
    lotCount: number | null;
    totalAcres: string | null;
    totalRoadFeet: number | null;
  };
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

    // Mapbox token comes from env (already wired in property-map.tsx).
    const token = (window as any).MAPBOX_TOKEN ?? import.meta.env.VITE_MAPBOX_TOKEN;
    if (token) (mapboxgl.accessToken as any) = token;

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
        <div ref={containerRef} className="h-96 w-full rounded-md border" />
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
