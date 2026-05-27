/**
 * /outreach/mail · EDDM map tab (Pillar 3 Tab 4).
 *
 * Full-screen interactive Mapbox surface for painting USPS carrier-route
 * selections, with optional parcel overlay. Selection drives a live cost
 * summary ($0.31/household per Pillar 3 cost weights) and a Queue button
 * that calls /api/outreach/mail/eddm/queue and switches to the In-Flight
 * tab.
 *
 * Carrier-route geometry today is a synthetic 5×4 grid stub — the demo
 * badge surfaces that fact, and the production wire-up lands when USPS BCG
 * permitting trips at $1k MRR. See routes-eddm.ts for the server side.
 *
 * Engine choice: Mapbox stays here (per Pillar 8.3) — EDDM benefits from
 * Mapbox's data pipeline. Other surfaces are migrating to MapLibre.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { motion } from "framer-motion";
import {
  Loader2,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Sparkles,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  useEddmParcels,
  useEddmQueue,
  useEddmRoutes,
  type EddmRouteFeature,
} from "@/hooks/use-outreach-mail";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN =
  (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined) ||
  ((typeof window !== "undefined" ? (window as any).__ENV__ : undefined)
    ?.VITE_MAPBOX_ACCESS_TOKEN as string | undefined);

// Per Pillar 3 cost weights — 31¢/piece for EDDM postcards.
const EDDM_PER_PIECE_CENTS = 31;

// Households-to-color ramp anchors. Matches the legend in the side panel.
const HOUSEHOLD_RAMP: { stop: number; color: string }[] = [
  { stop: 100, color: "#dbeafe" },
  { stop: 250, color: "#60a5fa" },
  { stop: 400, color: "#1d4ed8" },
  { stop: 500, color: "#1e3a8a" },
];

interface OrgWithSettings {
  id: number;
  settings?: { primaryCounty?: string; primaryState?: string } | null;
}

export default function EddmTab() {
  const { toast } = useToast();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Pull the org's primary county from settings — defaults TX/Hidalgo, the
  // common case for the dev seed. The user can override above the map.
  const orgQuery = useQuery<OrgWithSettings>({
    queryKey: ["/api/organizations/current"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/organizations/current");
        return res.json();
      } catch {
        return { id: 0 } as OrgWithSettings;
      }
    },
    retry: false,
  });

  const defaultState = orgQuery.data?.settings?.primaryState ?? "TX";
  const defaultCounty = orgQuery.data?.settings?.primaryCounty ?? "Hidalgo";

  const [stateInput, setStateInput] = useState(defaultState);
  const [countyInput, setCountyInput] = useState(defaultCounty);
  useEffect(() => {
    setStateInput(defaultState);
    setCountyInput(defaultCounty);
  }, [defaultState, defaultCounty]);

  const [activeState, setActiveState] = useState(defaultState);
  const [activeCounty, setActiveCounty] = useState(defaultCounty);

  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(new Set());
  const [showParcels, setShowParcels] = useState(false);
  const [acreageRange, setAcreageRange] = useState<[number, number]>([0, 200]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const routesQuery = useEddmRoutes(activeCounty, activeState);
  const parcelsQuery = useEddmParcels(
    showParcels ? bbox : null,
    {
      acreageMin: acreageRange[0] > 0 ? acreageRange[0] : undefined,
      acreageMax: acreageRange[1] < 200 ? acreageRange[1] : undefined,
    },
  );
  const queueMutation = useEddmQueue();

  // ── Initialize Mapbox once ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    if (!MAPBOX_TOKEN) {
      setTokenError(
        "VITE_MAPBOX_ACCESS_TOKEN is not configured. The EDDM map requires Mapbox.",
      );
      return;
    }
    mapboxgl.accessToken = MAPBOX_TOKEN;

    try {
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [-98.0, 30.5],
        zoom: 6,
      });
      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), "top-right");
      map.on("moveend", () => {
        const b = map.getBounds();
        if (b) {
          setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        }
      });
      mapRef.current = map;
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Sync carrier-route layer when data changes ──────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routesQuery.data) return;
    const apply = () => {
      const features = routesQuery.data!.features;
      const fc = { type: "FeatureCollection" as const, features };

      // Annotate selection state directly on the feature properties so the
      // style expression can branch on it without a paint-property-per-route.
      const annotated = {
        ...fc,
        features: features.map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            selected: selectedRouteIds.has(f.properties.routeId),
          },
        })),
      };

      const existing = map.getSource("eddm-routes") as mapboxgl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(annotated as GeoJSON.FeatureCollection);
        return;
      }

      map.addSource("eddm-routes", { type: "geojson", data: annotated as GeoJSON.FeatureCollection });
      map.addLayer({
        id: "eddm-routes-fill",
        type: "fill",
        source: "eddm-routes",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#16a34a",
            [
              "interpolate",
              ["linear"],
              ["get", "householdCount"],
              ...HOUSEHOLD_RAMP.flatMap((s) => [s.stop, s.color]),
            ],
          ],
          "fill-opacity": ["case", ["==", ["get", "selected"], true], 0.65, 0.45],
        },
      });
      map.addLayer({
        id: "eddm-routes-outline",
        type: "line",
        source: "eddm-routes",
        paint: {
          "line-color": ["case", ["==", ["get", "selected"], true], "#15803d", "#1e3a8a"],
          "line-width": ["case", ["==", ["get", "selected"], true], 2.5, 1],
        },
      });

      // Fit bounds the first time we get data so the county fills the view.
      if (features.length > 0) {
        const allCoords = features.flatMap((f) => f.geometry.coordinates[0]);
        const lons = allCoords.map((c) => c[0]);
        const lats = allCoords.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 60, duration: 600 },
        );
      }

      map.on("click", "eddm-routes-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = (f.properties as { routeId?: string } | null)?.routeId;
        if (!id) return;
        setSelectedRouteIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      });
      map.on("mouseenter", "eddm-routes-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "eddm-routes-fill", () => {
        map.getCanvas().style.cursor = "";
      });
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [routesQuery.data, selectedRouteIds]);

  // ── Sync parcels overlay ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const fc = parcelsQuery.data ?? { type: "FeatureCollection" as const, features: [] };

      const existing = map.getSource("eddm-parcels") as mapboxgl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(fc as GeoJSON.FeatureCollection);
      } else {
        map.addSource("eddm-parcels", {
          type: "geojson",
          data: fc as GeoJSON.FeatureCollection,
        });
        map.addLayer({
          id: "eddm-parcels-circle",
          type: "circle",
          source: "eddm-parcels",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 3,
            "circle-color": "#f97316",
            "circle-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "eddm-parcels-fill",
          type: "fill",
          source: "eddm-parcels",
          filter: ["!=", ["geometry-type"], "Point"],
          paint: {
            "fill-color": "#f97316",
            "fill-opacity": 0.35,
            "fill-outline-color": "#c2410c",
          },
        });
      }

      const visibility = showParcels ? "visible" : "none";
      ["eddm-parcels-circle", "eddm-parcels-fill"].forEach((id) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
      });
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [parcelsQuery.data, showParcels]);

  // ── Selection summary ───────────────────────────────────────────────────
  const featuresById = useMemo(() => {
    const m = new Map<string, EddmRouteFeature>();
    routesQuery.data?.features.forEach((f) => m.set(f.properties.routeId, f));
    return m;
  }, [routesQuery.data]);

  const selectedHouseholds = useMemo(() => {
    let total = 0;
    selectedRouteIds.forEach((id) => {
      total += featuresById.get(id)?.properties.householdCount ?? 0;
    });
    return total;
  }, [selectedRouteIds, featuresById]);

  const totalCents = selectedHouseholds * EDDM_PER_PIECE_CENTS;

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSearch = () => {
    const stateUp = stateInput.trim().toUpperCase();
    const county = countyInput.trim();
    if (stateUp.length !== 2 || county.length === 0) {
      toast({
        title: "Need state + county",
        description: "Use a 2-letter state code and a county name.",
        variant: "destructive",
      });
      return;
    }
    setActiveState(stateUp);
    setActiveCounty(county);
    setSelectedRouteIds(new Set());
  };

  const handleSelectAllVisible = () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    if (!b) return;
    const visible = (routesQuery.data?.features ?? []).filter((f) => {
      const coords = f.geometry.coordinates[0];
      const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      return cx >= b.getWest() && cx <= b.getEast() && cy >= b.getSouth() && cy <= b.getNorth();
    });
    setSelectedRouteIds(new Set(visible.map((f) => f.properties.routeId)));
  };

  const handleClear = () => setSelectedRouteIds(new Set());

  const handleQueue = async () => {
    if (selectedRouteIds.size === 0 || selectedHouseholds === 0) return;
    try {
      const result = await queueMutation.mutateAsync({
        routeIds: Array.from(selectedRouteIds),
        pieceType: "postcard_4x6",
        householdCount: selectedHouseholds,
      });
      toast({
        title: "EDDM queued",
        description: `${result.quote.pieceCount.toLocaleString()} households · ${formatUsd(
          result.quote.totalCents,
        )} · leaves in ${result.holdWindowMinutes}m`,
      });
      // Switch to in-flight tab so Tom can cancel within the hold window.
      window.location.hash = "in-flight";
    } catch (err) {
      toast({
        title: "Couldn't queue EDDM",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="relative -mx-4 md:-mx-6 -mb-6"
      data-testid="eddm-tab"
    >
      {/* ── Top bar: county search ──────────────────────────────────────── */}
      <motion.div variants={staggerItem} className="px-4 md:px-6 pb-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[12rem]">
            <Label htmlFor="eddm-county" className="text-xs">
              County
            </Label>
            <Input
              id="eddm-county"
              value={countyInput}
              onChange={(e) => setCountyInput(e.target.value)}
              placeholder="Hidalgo"
              data-testid="input-eddm-county"
            />
          </div>
          <div className="w-24">
            <Label htmlFor="eddm-state" className="text-xs">
              State
            </Label>
            <Input
              id="eddm-state"
              maxLength={2}
              value={stateInput}
              onChange={(e) => setStateInput(e.target.value.toUpperCase())}
              placeholder="TX"
              data-testid="input-eddm-state"
            />
          </div>
          <Button onClick={handleSearch} data-testid="button-eddm-search">
            <MapIcon className="w-4 h-4 mr-2" aria-hidden="true" />
            Load
          </Button>
          {routesQuery.data?.synthetic && (
            <Badge variant="secondary" className="ml-auto" data-testid="badge-demo-routes">
              <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" />
              {routesQuery.data.notice}
            </Badge>
          )}
        </div>
      </motion.div>

      {/* ── Map container ────────────────────────────────────────────────── */}
      <div className="relative w-full h-[calc(100vh-18rem)] min-h-[24rem] bg-muted">
        {tokenError ? (
          <div
            className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground"
            data-testid="map-token-error"
            role="alert"
          >
            {tokenError}
          </div>
        ) : (
          <div
            ref={mapContainerRef}
            className="absolute inset-0"
            data-testid="eddm-map"
            aria-label="EDDM carrier-route map"
          />
        )}

        {/* Routes loading spinner */}
        {routesQuery.isLoading && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-background/95 rounded-full px-3 py-1 text-xs flex items-center gap-2 shadow">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            Loading carrier routes…
          </div>
        )}

        {/* Side panel — layer toggles + filters */}
        {panelOpen && (
          <aside
            className="absolute top-3 left-3 w-72 max-w-[calc(100%-1.5rem)] bg-background/95 rounded-card shadow-lg border p-3 space-y-3"
            data-testid="eddm-side-panel"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Layers</h3>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setPanelOpen(false)}
                aria-label="Collapse panel"
                data-testid="button-panel-close"
              >
                <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="toggle-parcels" className="text-sm">
                Show parcels
              </Label>
              <Switch
                id="toggle-parcels"
                checked={showParcels}
                onCheckedChange={setShowParcels}
                data-testid="toggle-parcels"
              />
            </div>

            {showParcels && (
              <div className="space-y-2">
                <Label className="text-xs">
                  Acreage: {acreageRange[0]} – {acreageRange[1] >= 200 ? "200+" : acreageRange[1]}
                </Label>
                <Slider
                  min={0}
                  max={200}
                  step={5}
                  value={acreageRange}
                  onValueChange={(v) => setAcreageRange([v[0] ?? 0, v[1] ?? 200])}
                  data-testid="slider-acreage"
                />
                <p className="text-xs text-muted-foreground" data-testid="parcels-count">
                  {parcelsQuery.isLoading
                    ? "Counting parcels…"
                    : `${parcelsQuery.data?.total ?? 0} parcels match`}
                </p>
              </div>
            )}

            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-muted-foreground">Household density</p>
              <div className="flex gap-1 items-center">
                {HOUSEHOLD_RAMP.map((s) => (
                  <div
                    key={s.stop}
                    className="flex-1 h-2 rounded"
                    style={{ background: s.color }}
                    aria-hidden="true"
                  />
                ))}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{HOUSEHOLD_RAMP[0].stop}</span>
                <span>{HOUSEHOLD_RAMP[HOUSEHOLD_RAMP.length - 1].stop}+</span>
              </div>
            </div>

            <div className="border-t pt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSelectAllVisible}
                data-testid="button-select-visible"
              >
                Select visible
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleClear}
                disabled={selectedRouteIds.size === 0}
                data-testid="button-clear-selection"
              >
                Clear
              </Button>
            </div>
          </aside>
        )}

        {!panelOpen && (
          <Button
            size="icon"
            variant="default"
            className="absolute top-3 left-3"
            onClick={() => setPanelOpen(true)}
            aria-label="Open layers panel"
            data-testid="button-panel-open"
          >
            <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* ── Bottom toolbar: selection summary + queue ──────────────────── */}
      <Card
        className="mx-4 md:mx-6 mt-3 mb-4 sticky bottom-3 z-10 shadow-lg"
        data-testid="eddm-summary-bar"
      >
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[14rem]">
            <p className="text-sm font-medium" data-testid="text-eddm-summary">
              {selectedRouteIds.size === 0
                ? "Click routes to start selecting"
                : `${selectedRouteIds.size} route${
                    selectedRouteIds.size === 1 ? "" : "s"
                  } selected — ${selectedHouseholds.toLocaleString()} households (~${formatUsd(
                    totalCents,
                  )} to mail all)`}
            </p>
            <p className="text-xs text-muted-foreground">
              $0.31/household · EDDM postcard 4×6
            </p>
          </div>
          <Button
            disabled={selectedRouteIds.size === 0 || queueMutation.isPending}
            onClick={handleQueue}
            data-testid="button-eddm-queue"
          >
            <Send className="w-4 h-4 mr-2" aria-hidden="true" />
            {queueMutation.isPending ? "Queueing…" : "Queue EDDM blast"}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
