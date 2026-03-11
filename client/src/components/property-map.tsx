import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import { MapPin, Maximize2, Minimize2, Mountain, Satellite, Map as MapIcon, Play, Pause, Layers, ChevronDown, ChevronUp, Loader2, Ruler, Square, Camera, Download, X, Clipboard, MapPinned, BarChart3, CircleDot, Database, Box, TreePine, Tractor, Sun, Clock, Wind, Compass, TrendingUp, TrendingDown, Minus as MinusIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDynamicMapLayers, buildArcGISRasterTileUrl, isArcGISMapServerUrl, type MapLayer } from "@/hooks/use-dynamic-map-layers";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

if (MAPBOX_TOKEN) {
  mapboxgl.accessToken = MAPBOX_TOKEN;
}

type MapStyle = "satellite" | "terrain" | "streets";

const MAP_STYLES: Record<MapStyle, string> = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain: "mapbox://styles/mapbox/outdoors-v12",
  streets: "mapbox://styles/mapbox/streets-v12",
};

const FEMA_NFHL_URL = "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer";
const USGS_LAND_USE_URL = "https://www.sciencebase.gov/arcgis/rest/services/Catalog/5f9637fad34eb2e5df3d40a2/MapServer";
const USDA_CDL_URL = "https://nassgeodata.gmu.edu/arcgis/rest/services/CropScapeService/WMS_CroplandRaster/MapServer";
const USDA_CLU_URL = "https://gis.sc.egov.usda.gov/appgeodb/rest/services/common_land_unit/MapServer";
const USGS_HILLSHADE_URL = "https://carto.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer";
const USGS_TOPO_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer";

const LAYER_STORAGE_KEY = "property-map-layers";
const MEASUREMENT_UNITS_KEY = "property-map-measurement-units";

type MeasurementMode = "none" | "distance" | "area";
type MeasurementUnits = "imperial" | "metric";

interface MeasurementPoint {
  lng: number;
  lat: number;
  marker?: mapboxgl.Marker;
}

function loadMeasurementUnits(): MeasurementUnits {
  try {
    const stored = localStorage.getItem(MEASUREMENT_UNITS_KEY);
    if (stored === "metric" || stored === "imperial") {
      return stored;
    }
  } catch {
    console.log("Could not load measurement units from localStorage");
  }
  return "imperial";
}

function saveMeasurementUnits(units: MeasurementUnits): void {
  try {
    localStorage.setItem(MEASUREMENT_UNITS_KEY, units);
  } catch {
    console.log("Could not save measurement units to localStorage");
  }
}

function calculateDistance(points: MeasurementPoint[]): number {
  if (points.length < 2) return 0;
  let totalDistance = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const R = 6371000;
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    const deltaLat = (to.lat - from.lat) * Math.PI / 180;
    const deltaLng = (to.lng - from.lng) * Math.PI / 180;
    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalDistance += R * c;
  }
  return totalDistance;
}

function calculatePolygonArea(points: MeasurementPoint[]): number {
  if (points.length < 3) return 0;
  const R = 6371000;
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lat1 = points[i].lat * Math.PI / 180;
    const lat2 = points[j].lat * Math.PI / 180;
    const lng1 = points[i].lng * Math.PI / 180;
    const lng2 = points[j].lng * Math.PI / 180;
    area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  area = Math.abs(area * R * R / 2);
  return area;
}

function formatDistance(meters: number, units: MeasurementUnits): string {
  if (units === "metric") {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(0)} m`;
  }
  const feet = meters * 3.28084;
  if (feet >= 5280) {
    return `${(feet / 5280).toFixed(2)} mi`;
  }
  return `${feet.toFixed(0)} ft`;
}

function formatArea(sqMeters: number, units: MeasurementUnits): string {
  if (units === "metric") {
    if (sqMeters >= 10000) {
      return `${(sqMeters / 10000).toFixed(2)} ha`;
    }
    return `${sqMeters.toFixed(0)} m²`;
  }
  const acres = sqMeters / 4046.86;
  if (acres >= 1) {
    return `${acres.toFixed(2)} acres`;
  }
  const sqFeet = sqMeters * 10.7639;
  return `${sqFeet.toFixed(0)} sq ft`;
}

// ── Solar Geometry Engine ─────────────────────────────────────────────────────
// Implements the Spencer (1971) solar position algorithm with equation-of-time
// correction for accurate sun azimuth/altitude at any lat/lng/time.

interface SolarPosition {
  azimuth: number;   // 0–360° compass bearing (0=N, 90=E, 180=S, 270=W)
  altitude: number;  // –90 to 90° (0=horizon, 90=zenith, negative=below horizon)
  sunrise: number;   // fractional hours in approximate local solar time
  sunset: number;
  isDaytime: boolean;
  phase: "night" | "astronomical" | "nautical" | "civil" | "golden" | "day";
}

function calculateSolarPosition(lat: number, lng: number, hourOfDay: number): SolarPosition {
  const d2r = Math.PI / 180;
  const r2d = 180 / Math.PI;

  const now = new Date();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Solar declination via Spencer (1971)
  const B = (2 * Math.PI * (dayOfYear - 1)) / 365;
  const declinationRad =
    (0.006918 - 0.399912 * Math.cos(B) + 0.070257 * Math.sin(B) -
      0.006758 * Math.cos(2 * B) + 0.000907 * Math.sin(2 * B) -
      0.002697 * Math.cos(3 * B) + 0.00148 * Math.sin(3 * B));

  // Equation of time (minutes)
  const eot =
    229.18 * (0.000075 + 0.001868 * Math.cos(B) - 0.032077 * Math.sin(B) -
      0.014615 * Math.cos(2 * B) - 0.04089 * Math.sin(2 * B));

  // Timezone offset from longitude (approximate)
  const tzOffset = Math.round(lng / 15);
  const solarNoon = 12 - (lng - tzOffset * 15) / 15 - eot / 60;

  const hourAngleRad = (hourOfDay - solarNoon) * 15 * d2r;
  const latRad = lat * d2r;

  // Solar altitude (elevation)
  const sinAlt =
    Math.sin(latRad) * Math.sin(declinationRad) +
    Math.cos(latRad) * Math.cos(declinationRad) * Math.cos(hourAngleRad);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * r2d;

  // Solar azimuth (compass bearing, 0=N, clockwise)
  const cosAz =
    (Math.sin(declinationRad) - Math.sin(latRad) * sinAlt) /
    (Math.cos(latRad) * Math.cos(Math.asin(sinAlt) || 0.0001));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * r2d;
  if (hourAngleRad > 0) azimuth = 360 - azimuth;
  azimuth = (azimuth + 360) % 360;

  // Sunrise / sunset
  const cosHasr = -Math.tan(latRad) * Math.tan(declinationRad);
  let sunrise = 6, sunset = 18;
  if (Math.abs(cosHasr) <= 1) {
    const hasr = (Math.acos(cosHasr) * r2d) / 15;
    sunrise = solarNoon - hasr;
    sunset = solarNoon + hasr;
  }

  // Sun phase
  let phase: SolarPosition["phase"] = "night";
  if (altitude > 0) phase = altitude < 6 ? "civil" : altitude < 12 ? "golden" : "day";
  else if (altitude > -6) phase = "civil";
  else if (altitude > -12) phase = "nautical";
  else if (altitude > -18) phase = "astronomical";

  return { azimuth, altitude, sunrise, sunset, isDaytime: altitude > 0, phase };
}

function formatSolarTime(hours: number): string {
  const totalMins = Math.max(0, hours) * 60;
  const h = Math.floor(totalMins / 60) % 24;
  const m = Math.round(totalMins % 60);
  const period = h < 12 ? "AM" : "PM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${m.toString().padStart(2, "0")} ${period}`;
}

function getSkyGradientClass(phase: SolarPosition["phase"]): string {
  switch (phase) {
    case "night": return "from-slate-950 via-indigo-950 to-slate-900";
    case "astronomical": return "from-slate-900 via-indigo-900 to-slate-800";
    case "nautical": return "from-indigo-900 via-blue-900 to-indigo-800";
    case "civil": return "from-orange-900 via-rose-800 to-amber-700";
    case "golden": return "from-amber-600 via-orange-500 to-yellow-400";
    case "day": return "from-sky-400 via-blue-400 to-sky-300";
  }
}

// ── Elevation Profile ─────────────────────────────────────────────────────────

interface ElevationPoint {
  distance: number; // metres from start
  elevation: number; // metres above sea level (from Mapbox terrain)
}

function sampleElevationAlongLine(
  mapRef: mapboxgl.Map,
  points: MeasurementPoint[],
  samples = 60
): ElevationPoint[] {
  if (points.length < 2) return [];
  const totalDist = calculateDistance(points);
  const result: ElevationPoint[] = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const targetDist = t * totalDist;
    let cumDist = 0;
    let segStart = points[0];
    let segEnd = points[points.length - 1];
    let segT = t;

    if (points.length > 2) {
      for (let j = 0; j < points.length - 1; j++) {
        const segDist = calculateDistance([points[j], points[j + 1]]);
        if (cumDist + segDist >= targetDist) {
          segStart = points[j];
          segEnd = points[j + 1];
          segT = segDist > 0 ? (targetDist - cumDist) / segDist : 0;
          break;
        }
        cumDist += segDist;
      }
    }

    const lng = segStart.lng + (segEnd.lng - segStart.lng) * segT;
    const lat = segStart.lat + (segEnd.lat - segStart.lat) * segT;
    const elevation = mapRef.queryTerrainElevation([lng, lat]) ?? 0;
    result.push({ distance: t * totalDist, elevation });
  }
  return result;
}

function ElevationProfileOverlay({
  points,
  totalDistance,
  units,
  onClose,
}: {
  points: ElevationPoint[];
  totalDistance: number;
  units: MeasurementUnits;
  onClose: () => void;
}) {
  if (points.length < 2) return null;
  const elevations = points.map((p) => p.elevation);
  const minElev = Math.min(...elevations);
  const maxElev = Math.max(...elevations);
  const elevRange = maxElev - minElev;

  // Calculate cumulative gain/loss
  let gainM = 0, lossM = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0) gainM += diff;
    else lossM += Math.abs(diff);
  }

  const toDisplay = (m: number) =>
    units === "metric" ? `${m.toFixed(0)}m` : `${(m * 3.28084).toFixed(0)}ft`;

  const W = 260, H = 56;
  const pathData = points
    .map((p, i) => {
      const x = (p.distance / (totalDistance || 1)) * W;
      const y =
        H - ((p.elevation - minElev) / (elevRange || 1)) * (H - 8) - 4;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `${pathData} L ${W} ${H} L 0 ${H} Z`;

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 bg-background/97 backdrop-blur-md rounded-xl shadow-2xl border border-border/60 p-3 w-80">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Mountain className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-xs font-semibold">Elevation Profile</span>
          <span className="text-[10px] text-muted-foreground">
            ({formatDistance(totalDistance, units)})
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <svg width={W} height={H} className="w-full overflow-visible mb-2">
        <defs>
          <linearGradient id="elev-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {/* Zero line */}
        {minElev <= 0 && (
          <line
            x1="0"
            y1={H - ((0 - minElev) / (elevRange || 1)) * (H - 8) - 4}
            x2={W}
            y2={H - ((0 - minElev) / (elevRange || 1)) * (H - 8) - 4}
            stroke="rgba(59,130,246,0.4)"
            strokeDasharray="3,2"
            strokeWidth="1"
          />
        )}
        <path d={areaPath} fill="url(#elev-grad)" />
        <path
          d={pathData}
          fill="none"
          stroke="#22c55e"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>

      <div className="grid grid-cols-4 gap-1 text-[10px]">
        <div className="text-center">
          <div className="text-muted-foreground">Min</div>
          <div className="font-semibold">{toDisplay(minElev)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Max</div>
          <div className="font-semibold">{toDisplay(maxElev)}</div>
        </div>
        <div className="text-center">
          <div className="text-emerald-600">↑ Gain</div>
          <div className="font-semibold text-emerald-600">{toDisplay(gainM)}</div>
        </div>
        <div className="text-center">
          <div className="text-red-500">↓ Loss</div>
          <div className="font-semibold text-red-500">{toDisplay(lossM)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Compass Rose ──────────────────────────────────────────────────────────────

function CompassRose({ bearing }: { bearing: number }) {
  return (
    <div
      className="absolute bottom-12 right-3 z-10 pointer-events-none select-none"
      data-testid="compass-rose"
      title={`Bearing: ${Math.round(bearing)}°`}
    >
      <div
        className="w-11 h-11 relative"
        style={{ transform: `rotate(${-bearing}deg)` }}
      >
        <svg viewBox="0 0 44 44" className="w-full h-full drop-shadow-lg">
          <circle
            cx="22"
            cy="22"
            r="20"
            fill="rgba(0,0,0,0.55)"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="1"
          />
          {/* Tick marks */}
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i * 45 * Math.PI) / 180;
            const inner = i % 2 === 0 ? 15 : 17;
            const outer = 20;
            return (
              <line
                key={i}
                x1={22 + inner * Math.sin(angle)}
                y1={22 - inner * Math.cos(angle)}
                x2={22 + outer * Math.sin(angle)}
                y2={22 - outer * Math.cos(angle)}
                stroke="rgba(255,255,255,0.4)"
                strokeWidth={i % 2 === 0 ? 1.5 : 0.8}
              />
            );
          })}
          {/* North arrow (red) */}
          <polygon points="22,3 19,20 25,20" fill="#ef4444" opacity="0.95" />
          {/* South arrow (white) */}
          <polygon points="22,41 19,24 25,24" fill="rgba(255,255,255,0.75)" />
          {/* Center hub */}
          <circle cx="22" cy="22" r="2.5" fill="white" />
          {/* N label */}
          <text
            x="22"
            y="2"
            textAnchor="middle"
            fontSize="5.5"
            fill="white"
            fontWeight="bold"
            dominantBaseline="hanging"
          >
            N
          </text>
        </svg>
      </div>
    </div>
  );
}

// ── Sun Control Panel ─────────────────────────────────────────────────────────

function SunControlPanel({
  lat,
  lng,
  sunHour,
  onSunHourChange,
  isAnimating,
  onToggleAnimation,
  onClose,
}: {
  lat: number;
  lng: number;
  sunHour: number;
  onSunHourChange: (h: number) => void;
  isAnimating: boolean;
  onToggleAnimation: () => void;
  onClose: () => void;
}) {
  const solar = calculateSolarPosition(lat, lng, sunHour);
  const gradient = getSkyGradientClass(solar.phase);

  const phaseLabel: Record<SolarPosition["phase"], string> = {
    night: "Night",
    astronomical: "Astro. Twilight",
    nautical: "Nautical Twilight",
    civil: "Civil Twilight",
    golden: "Golden Hour",
    day: "Daylight",
  };

  return (
    <div
      className="absolute bottom-28 right-3 z-20 bg-background/97 backdrop-blur-md rounded-xl shadow-2xl border border-border/60 p-3 w-60"
      data-testid="sun-control-panel"
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Sun className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs font-semibold">Solar Simulation</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Sky gradient preview strip */}
      <div
        className={`h-12 rounded-lg mb-2.5 bg-gradient-to-b ${gradient} flex items-center justify-center relative overflow-hidden`}
      >
        {solar.isDaytime && (
          <div
            className="absolute w-5 h-5 rounded-full bg-yellow-200 shadow-[0_0_12px_4px_rgba(253,224,71,0.8)] pointer-events-none"
            style={{
              left: `${(solar.azimuth / 360) * 100}%`,
              top: `${Math.max(8, 80 - solar.altitude)}%`,
              transform: "translate(-50%, -50%)",
            }}
          />
        )}
        <span className="text-white text-xs font-bold drop-shadow-md z-10">
          {formatSolarTime(sunHour)}
        </span>
      </div>

      <Slider
        value={[sunHour]}
        onValueChange={([v]) => onSunHourChange(v)}
        min={0}
        max={23.75}
        step={0.25}
        className="mb-3"
        data-testid="sun-hour-slider"
      />

      <div className="grid grid-cols-3 gap-1 text-center mb-2.5">
        <div className="bg-muted/50 rounded p-1.5">
          <div className="text-[9px] text-muted-foreground">Azimuth</div>
          <div className="text-xs font-bold">{solar.azimuth.toFixed(0)}°</div>
        </div>
        <div className="bg-muted/50 rounded p-1.5">
          <div className="text-[9px] text-muted-foreground">Elevation</div>
          <div
            className={`text-xs font-bold ${solar.altitude > 0 ? "text-amber-500" : "text-slate-400"}`}
          >
            {solar.altitude.toFixed(1)}°
          </div>
        </div>
        <div className="bg-muted/50 rounded p-1.5">
          <div className="text-[9px] text-muted-foreground">Phase</div>
          <div className="text-[9px] font-bold leading-tight">
            {phaseLabel[solar.phase]}
          </div>
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground mb-2.5">
        <span>
          ☀ Rise: <strong>{formatSolarTime(solar.sunrise)}</strong>
        </span>
        <span>
          ☽ Set: <strong>{formatSolarTime(solar.sunset)}</strong>
        </span>
      </div>

      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant={isAnimating ? "default" : "outline"}
          className="flex-1 h-7 text-xs gap-1"
          onClick={onToggleAnimation}
        >
          {isAnimating ? (
            <>
              <Pause className="h-3 w-3" /> Pause
            </>
          ) : (
            <>
              <Play className="h-3 w-3" /> Animate
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs px-2"
          onClick={() => onSunHourChange(new Date().getHours() + new Date().getMinutes() / 60)}
          title="Reset to current time"
        >
          <Clock className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

interface LayerState {
  femaFloodZone: boolean;
  propertyHeatmap: boolean;
  zoningDistricts: boolean;
  heatmapOpacity: number;
  osmBuildings: boolean;
  terrainContours: boolean;
  usdaCropland: boolean;
  usdaClu: boolean;
  usgsHillshade: boolean;
  hypsometricHillshade: boolean;
  slopeGradient: boolean;
}

const DEFAULT_LAYER_STATE: LayerState = {
  femaFloodZone: false,
  propertyHeatmap: true,
  zoningDistricts: false,
  heatmapOpacity: 0.35,
  osmBuildings: false,
  terrainContours: false,
  usdaCropland: false,
  usdaClu: false,
  usgsHillshade: false,
  hypsometricHillshade: false,
  slopeGradient: false,
};

function loadLayerState(): LayerState {
  try {
    const stored = localStorage.getItem(LAYER_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_LAYER_STATE, ...JSON.parse(stored) };
    }
  } catch {
    console.log("Could not load layer state from localStorage");
  }
  return DEFAULT_LAYER_STATE;
}

function saveLayerState(state: LayerState): void {
  try {
    localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.log("Could not save layer state to localStorage");
  }
}

interface PropertyBoundary {
  id: number;
  apn: string;
  name?: string;
  boundary: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  centroid: {
    lat: number;
    lng: number;
  };
  status?: string;
}

interface PropertyMapProps {
  properties: PropertyBoundary[];
  selectedPropertyId?: number;
  onPropertySelect?: (propertyId: number) => void;
  height?: string;
  showLabels?: boolean;
  interactive?: boolean;
  enable3DTerrain?: boolean;
  showControls?: boolean;
  initialViewState?: {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch?: number;
  };
}

const STATUS_COLORS: Record<string, string> = {
  prospect: "#fbbf24",
  due_diligence: "#f97316",
  offer_sent: "#8b5cf6",
  under_contract: "#3b82f6",
  owned: "#22c55e",
  listed: "#06b6d4",
  sold: "#6b7280",
  available: "#22c55e",
  default: "#22c55e",
};

interface NearbyParcelData {
  apn: string;
  boundary: GeoJSON.Geometry;
  centroid: { lat: number; lng: number };
  distance: number;
  acres?: number;
  owner?: string;
}

interface CompProperty {
  id: string;
  apn?: string;
  address?: string;
  salePrice?: number;
  saleDate?: string;
  acres?: number;
  pricePerAcre?: number;
  lat: number;
  lng: number;
  distance?: number;
  adjustedValue?: number;
  desirabilityScore?: number;
}

type NearbyRadius = "0.5" | "1" | "2" | "5";

const COMP_RECENCY_COLORS = {
  recent: "#22c55e",
  moderate: "#84cc16",
  older: "#eab308",
  old: "#f97316",
};

function getCompRecencyColor(saleDate?: string): string {
  if (!saleDate) return COMP_RECENCY_COLORS.old;
  const monthsAgo = (Date.now() - new Date(saleDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo <= 6) return COMP_RECENCY_COLORS.recent;
  if (monthsAgo <= 12) return COMP_RECENCY_COLORS.moderate;
  if (monthsAgo <= 24) return COMP_RECENCY_COLORS.older;
  return COMP_RECENCY_COLORS.old;
}

function getCompRecencyOpacity(saleDate?: string): number {
  if (!saleDate) return 0.5;
  const monthsAgo = (Date.now() - new Date(saleDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo <= 6) return 1;
  if (monthsAgo <= 12) return 0.85;
  if (monthsAgo <= 24) return 0.7;
  return 0.5;
}

export function PropertyMap({
  properties,
  selectedPropertyId,
  onPropertySelect,
  height = "400px",
  showLabels = true,
  interactive = true,
  enable3DTerrain = true,
  showControls = true,
  initialViewState,
}: PropertyMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentStyle, setCurrentStyle] = useState<MapStyle>("satellite");
  const [isFlyoverActive, setIsFlyoverActive] = useState(false);
  const flyoverAnimationRef = useRef<number | null>(null);
  
  const [layerState, setLayerState] = useState<LayerState>(loadLayerState);
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
  const [femaLoading, setFemaLoading] = useState(false);
  
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>("none");
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [measurementUnits, setMeasurementUnits] = useState<MeasurementUnits>(loadMeasurementUnits);
  const [isExporting, setIsExporting] = useState(false);
  const measurementClickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  
  const [nearbyParcels, setNearbyParcels] = useState<NearbyParcelData[]>([]);
  const [nearbyRadius, setNearbyRadius] = useState<NearbyRadius>("1");
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [showNearbyParcels, setShowNearbyParcels] = useState(false);
  const [nearbyPanelOpen, setNearbyPanelOpen] = useState(false);
  
  const [comps, setComps] = useState<CompProperty[]>([]);
  const [compsLoading, setCompsLoading] = useState(false);
  const [showComps, setShowComps] = useState(false);
  const [compsPanelOpen, setCompsPanelOpen] = useState(false);
  
  const compMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const dynamicLayerIdsRef = useRef<Set<string>>(new Set());
  
  const { toast } = useToast();
  
  const {
    layersByCategory: dynamicLayersByCategory,
    enabledLayers: dynamicEnabledLayers,
    isLoading: dynamicLayersLoading,
    toggleLayer: toggleDynamicLayer,
    setLayerOpacity: setDynamicLayerOpacity,
    isLayerEnabled: isDynamicLayerEnabled,
    getLayerOpacity: getDynamicLayerOpacity,
  } = useDynamicMapLayers();
  
  const [dynamicLayersSectionOpen, setDynamicLayersSectionOpen] = useState(false);
  const [is3DExtrudeMode, setIs3DExtrudeMode] = useState(false);

  // Solar simulation
  const initHour = new Date().getHours() + new Date().getMinutes() / 60;
  const [sunHour, setSunHour] = useState<number>(initHour);
  const [showSunPanel, setShowSunPanel] = useState(false);
  const [isSunAnimating, setIsSunAnimating] = useState(false);
  const sunAnimRef = useRef<number | null>(null);

  // Compass bearing (updated from map events)
  const [mapBearing, setMapBearing] = useState(0);

  // Elevation profile (distance measurement mode)
  const [elevationPoints, setElevationPoints] = useState<ElevationPoint[]>([]);
  const [showElevationProfile, setShowElevationProfile] = useState(false);

  const updateLayerState = useCallback((updates: Partial<LayerState>) => {
    setLayerState(prev => {
      const newState = { ...prev, ...updates };
      saveLayerState(newState);
      return newState;
    });
  }, []);

  // ── Sky / Solar update ──────────────────────────────────────────────────────
  const updateSkyForTime = useCallback((hour: number) => {
    if (!map.current || !mapLoaded) return;
    const center = map.current.getCenter();
    const solar = calculateSolarPosition(center.lat, center.lng, hour);

    // Update sky atmosphere sun position
    if (map.current.getLayer("sky")) {
      // Mapbox sky-atmosphere-sun: [azimuth°, altitude°]
      // azimuth: 0=N, 90=E; altitude: 0=horizon, 90=zenith
      const clampedAlt = Math.max(-10, solar.altitude);
      map.current.setPaintProperty("sky", "sky-atmosphere-sun", [
        solar.azimuth,
        clampedAlt,
      ]);
      // Dim sky at night, brighten during day
      const sunIntensity = solar.isDaytime
        ? Math.min(20, 5 + solar.altitude * 0.3)
        : 0.5;
      map.current.setPaintProperty("sky", "sky-atmosphere-sun-intensity", sunIntensity);

      // Atmospheric haze based on sun angle
      const haze = solar.phase === "night" ? 0.1 :
        solar.phase === "golden" ? 0.6 : 0.35;
      map.current.setPaintProperty("sky", "sky-atmosphere-halo-color", `rgba(255,220,120,${haze})`);
    }
  }, [mapLoaded]);

  // ── Hypsometric hillshade layer ─────────────────────────────────────────────
  const addHypsometricLayer = useCallback(() => {
    if (!map.current) return;
    if (!map.current.getSource("mapbox-dem")) {
      map.current.addSource("mapbox-dem-hyp", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
    }
    const demSource = map.current.getSource("mapbox-dem") ? "mapbox-dem" : "mapbox-dem-hyp";
    if (!map.current.getLayer("hypsometric-hillshade")) {
      map.current.addLayer(
        {
          id: "hypsometric-hillshade",
          type: "hillshade",
          source: demSource,
          paint: {
            "hillshade-exaggeration": 0.75,
            "hillshade-shadow-color": "#2d3a2e",
            "hillshade-highlight-color": "#f7f3e9",
            "hillshade-accent-color": "#8aad8a",
            "hillshade-illumination-direction": 315,
            "hillshade-illumination-anchor": "map",
          },
        },
        "waterway-label"
      );
    }
  }, []);

  const removeHypsometricLayer = useCallback(() => {
    if (!map.current) return;
    if (map.current.getLayer("hypsometric-hillshade"))
      map.current.removeLayer("hypsometric-hillshade");
  }, []);

  // ── Slope gradient layer ────────────────────────────────────────────────────
  const addSlopeGradientLayer = useCallback(() => {
    if (!map.current) return;
    // Use a steep-slope-accentuated hillshade as a slope proxy
    const demSource = map.current.getSource("mapbox-dem") ? "mapbox-dem" : "mapbox-dem-hyp";
    if (!map.current.getLayer("slope-gradient")) {
      map.current.addLayer(
        {
          id: "slope-gradient",
          type: "hillshade",
          source: demSource,
          paint: {
            "hillshade-exaggeration": 1.2,
            "hillshade-shadow-color": "#7f1d1d",  // steep = dark red
            "hillshade-highlight-color": "#f0fdf4", // flat = white-green
            "hillshade-accent-color": "#d97706",    // mid-slope = amber
            "hillshade-illumination-direction": 270, // east-west gradient
            "hillshade-illumination-anchor": "viewport",
          },
        },
        "waterway-label"
      );
    }
  }, []);

  const removeSlopeGradientLayer = useCallback(() => {
    if (!map.current) return;
    if (map.current.getLayer("slope-gradient"))
      map.current.removeLayer("slope-gradient");
  }, []);

  const addFemaFloodLayer = useCallback(() => {
    if (!map.current) return;
    
    setFemaLoading(true);
    
    if (!map.current.getSource("fema-flood")) {
      map.current.addSource("fema-flood", {
        type: "raster",
        tiles: [
          `${FEMA_NFHL_URL}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`
        ],
        tileSize: 256,
        attribution: "FEMA NFHL"
      });
    }
    
    if (!map.current.getLayer("fema-flood-layer")) {
      const firstSymbolId = map.current.getStyle()?.layers?.find(l => l.type === "symbol")?.id;
      
      map.current.addLayer({
        id: "fema-flood-layer",
        type: "raster",
        source: "fema-flood",
        paint: {
          "raster-opacity": 0.7,
          "raster-fade-duration": 0
        }
      }, firstSymbolId);
    }
    
    map.current.setLayoutProperty("fema-flood-layer", "visibility", "visible");
    
    setTimeout(() => setFemaLoading(false), 1000);
  }, []);

  const removeFemaFloodLayer = useCallback(() => {
    if (!map.current) return;
    
    if (map.current.getLayer("fema-flood-layer")) {
      map.current.setLayoutProperty("fema-flood-layer", "visibility", "none");
    }
  }, []);

  const updateHeatmapOpacity = useCallback((opacity: number) => {
    if (!map.current) return;
    
    if (map.current.getLayer("property-fill")) {
      map.current.setPaintProperty("property-fill", "fill-opacity", opacity);
    }
  }, []);

  const togglePropertyHeatmap = useCallback((visible: boolean) => {
    if (!map.current) return;
    
    if (map.current.getLayer("property-fill")) {
      map.current.setLayoutProperty("property-fill", "visibility", visible ? "visible" : "none");
    }
    if (map.current.getLayer("property-outline")) {
      map.current.setLayoutProperty("property-outline", "visibility", visible ? "visible" : "none");
    }
  }, []);

  const addZoningLayer = useCallback(() => {
    if (!map.current) return;

    if (!map.current.getSource("zoning-land-use")) {
      map.current.addSource("zoning-land-use", {
        type: "raster",
        tiles: [
          `${USGS_LAND_USE_URL}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`
        ],
        tileSize: 256,
        attribution: "USGS NLCD",
      });
    }

    if (!map.current.getLayer("zoning-land-use-layer")) {
      const firstSymbolId = map.current.getStyle()?.layers?.find(l => l.type === "symbol")?.id;
      map.current.addLayer({
        id: "zoning-land-use-layer",
        type: "raster",
        source: "zoning-land-use",
        paint: { "raster-opacity": 0.6, "raster-fade-duration": 0 },
      }, firstSymbolId);
    }

    map.current.setLayoutProperty("zoning-land-use-layer", "visibility", "visible");
  }, []);

  const removeZoningLayer = useCallback(() => {
    if (!map.current) return;
    if (map.current.getLayer("zoning-land-use-layer")) {
      map.current.setLayoutProperty("zoning-land-use-layer", "visibility", "none");
    }
  }, []);

  const handleZoningToggle = useCallback((checked: boolean) => {
    updateLayerState({ zoningDistricts: checked });
    if (checked) {
      addZoningLayer();
    } else {
      removeZoningLayer();
    }
  }, [updateLayerState, addZoningLayer, removeZoningLayer]);

  const addOsmBuildingsLayer = useCallback(() => {
    if (!map.current) return;
    if (map.current.getLayer("osm-3d-buildings")) return;
    const firstSymbolId = map.current.getStyle()?.layers?.find(l => l.type === "symbol")?.id;
    map.current.addLayer({
      id: "osm-3d-buildings",
      source: "composite",
      "source-layer": "building",
      filter: ["==", "extrude", "true"],
      type: "fill-extrusion",
      minzoom: 14,
      paint: {
        "fill-extrusion-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ddd", "#aaa"],
        "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.05, ["get", "height"]],
        "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.05, ["get", "min_height"]],
        "fill-extrusion-opacity": 0.65,
      },
    }, firstSymbolId);
  }, []);

  const removeOsmBuildingsLayer = useCallback(() => {
    if (!map.current) return;
    if (map.current.getLayer("osm-3d-buildings")) map.current.removeLayer("osm-3d-buildings");
  }, []);

  const addTerrainContoursLayer = useCallback(() => {
    if (!map.current) return;
    if (map.current.getSource("mapbox-terrain-contours")) return;
    map.current.addSource("mapbox-terrain-contours", {
      type: "vector",
      url: "mapbox://mapbox.mapbox-terrain-v2",
    });
    map.current.addLayer({
      id: "terrain-contour-lines",
      type: "line",
      source: "mapbox-terrain-contours",
      "source-layer": "contour",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#c6a35e",
        "line-width": ["match", ["get", "index"], [1, 2], 0.6, 1.0],
        "line-opacity": 0.7,
      },
    });
    map.current.addLayer({
      id: "terrain-contour-labels",
      type: "symbol",
      source: "mapbox-terrain-contours",
      "source-layer": "contour",
      filter: [">", ["get", "index"], 0],
      layout: {
        "symbol-placement": "line",
        "text-field": ["concat", ["get", "ele"], "m"],
        "text-font": ["DIN Offc Pro Italic", "Arial Unicode MS Regular"],
        "text-size": 10,
      },
      paint: {
        "text-color": "#c6a35e",
        "text-halo-color": "rgba(0,0,0,0.6)",
        "text-halo-width": 1,
      },
    });
  }, []);

  const removeTerrainContoursLayer = useCallback(() => {
    if (!map.current) return;
    if (map.current.getLayer("terrain-contour-labels")) map.current.removeLayer("terrain-contour-labels");
    if (map.current.getLayer("terrain-contour-lines")) map.current.removeLayer("terrain-contour-lines");
    if (map.current.getSource("mapbox-terrain-contours")) map.current.removeSource("mapbox-terrain-contours");
  }, []);

  const addArcGISOverlayLayer = useCallback((id: string, url: string) => {
    if (!map.current) return;
    if (map.current.getLayer(`${id}-layer`)) return;
    if (!map.current.getSource(id)) {
      map.current.addSource(id, {
        type: "raster",
        tiles: [`${url}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`],
        tileSize: 256,
      });
    }
    const firstSymbolId = map.current.getStyle()?.layers?.find(l => l.type === "symbol")?.id;
    map.current.addLayer({
      id: `${id}-layer`,
      type: "raster",
      source: id,
      paint: { "raster-opacity": 0.7, "raster-fade-duration": 0 },
    }, firstSymbolId);
  }, []);

  const removeArcGISOverlayLayer = useCallback((id: string) => {
    if (!map.current) return;
    if (map.current.getLayer(`${id}-layer`)) map.current.setLayoutProperty(`${id}-layer`, "visibility", "none");
  }, []);

  const toggle3DExtrude = useCallback(() => {
    if (!map.current || !mapLoaded) return;
    const entering = !is3DExtrudeMode;
    setIs3DExtrudeMode(entering);

    if (entering) {
      // Extrude parcels as 3D fill-extrusion columns
      if (map.current.getLayer("property-fill")) map.current.setLayoutProperty("property-fill", "visibility", "none");
      if (map.current.getLayer("property-outline")) {
        map.current.setPaintProperty("property-outline", "line-width", 2);
      }
      if (!map.current.getLayer("property-extrusion")) {
        map.current.addLayer({
          id: "property-extrusion",
          type: "fill-extrusion",
          source: "properties",
          paint: {
            "fill-extrusion-color": ["get", "color"],
            "fill-extrusion-height": 120,
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.75,
          },
        });
      } else {
        map.current.setLayoutProperty("property-extrusion", "visibility", "visible");
      }
      map.current.easeTo({ pitch: 55, bearing: -20, duration: 800 });
      // Boost terrain exaggeration
      map.current.setTerrain({ source: "mapbox-dem", exaggeration: 2.5 });
    } else {
      if (map.current.getLayer("property-extrusion")) {
        map.current.setLayoutProperty("property-extrusion", "visibility", "none");
      }
      if (map.current.getLayer("property-fill")) map.current.setLayoutProperty("property-fill", "visibility", "visible");
      map.current.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      map.current.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
    }
  }, [is3DExtrudeMode, mapLoaded]);

  const fetchNearbyParcels = useCallback(async () => {
    if (!selectedPropertyId) {
      toast({
        title: "No Property Selected",
        description: "Please select a property to find nearby parcels.",
        variant: "destructive",
      });
      return;
    }
    
    setNearbyLoading(true);
    try {
      const response = await fetch(`/api/properties/${selectedPropertyId}/nearby?radius=${nearbyRadius}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to fetch nearby parcels");
      }
      const data = await response.json();
      setNearbyParcels(data.parcels || []);
      setShowNearbyParcels(true);
      setNearbyPanelOpen(true);
      toast({
        title: "Nearby Parcels Found",
        description: `Found ${data.parcels?.length || 0} parcels within ${nearbyRadius} mile${nearbyRadius !== "1" ? "s" : ""}.`,
      });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to fetch nearby parcels",
        variant: "destructive",
      });
    } finally {
      setNearbyLoading(false);
    }
  }, [selectedPropertyId, nearbyRadius, toast]);

  const fetchComps = useCallback(async () => {
    if (!selectedPropertyId) {
      toast({
        title: "No Property Selected",
        description: "Please select a property to view comparables.",
        variant: "destructive",
      });
      return;
    }
    
    setCompsLoading(true);
    try {
      const response = await fetch(`/api/properties/${selectedPropertyId}/comps`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to fetch comparable properties");
      }
      const data = await response.json();
      const compsList = (data.comps || []).map((c: any, idx: number) => ({
        id: c.id || `comp-${idx}`,
        apn: c.apn,
        address: c.address || c.siteAddress,
        salePrice: c.salePrice || c.lastSalePrice,
        saleDate: c.saleDate || c.lastSaleDate,
        acres: c.acres || c.lotSizeAcres,
        pricePerAcre: c.pricePerAcre,
        lat: c.centroid?.lat || c.lat,
        lng: c.centroid?.lng || c.lng,
        distance: c.distanceMiles,
        adjustedValue: c.adjustedValue,
        desirabilityScore: c.desirabilityScore,
      }));
      setComps(compsList);
      setShowComps(true);
      setCompsPanelOpen(true);
      toast({
        title: "Comparables Found",
        description: `Found ${compsList.length} comparable properties.`,
      });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to fetch comparables",
        variant: "destructive",
      });
    } finally {
      setCompsLoading(false);
    }
  }, [selectedPropertyId, toast]);

  const addNearbyParcelsLayer = useCallback(() => {
    if (!map.current || nearbyParcels.length === 0) return;
    
    if (map.current.getLayer("nearby-parcels-fill")) {
      map.current.removeLayer("nearby-parcels-fill");
    }
    if (map.current.getLayer("nearby-parcels-outline")) {
      map.current.removeLayer("nearby-parcels-outline");
    }
    if (map.current.getSource("nearby-parcels")) {
      map.current.removeSource("nearby-parcels");
    }
    
    const geojsonData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: nearbyParcels.map(p => ({
        type: "Feature" as const,
        properties: { apn: p.apn, distance: p.distance, acres: p.acres },
        geometry: p.boundary,
      })),
    };
    
    map.current.addSource("nearby-parcels", {
      type: "geojson",
      data: geojsonData,
    });
    
    map.current.addLayer({
      id: "nearby-parcels-fill",
      type: "fill",
      source: "nearby-parcels",
      paint: {
        "fill-color": "#64748b",
        "fill-opacity": 0.25,
      },
    });
    
    map.current.addLayer({
      id: "nearby-parcels-outline",
      type: "line",
      source: "nearby-parcels",
      paint: {
        "line-color": "#3b82f6",
        "line-width": 2,
        "line-opacity": 0.8,
      },
    });
  }, [nearbyParcels]);

  const removeNearbyParcelsLayer = useCallback(() => {
    if (!map.current) return;
    if (map.current.getLayer("nearby-parcels-fill")) {
      map.current.removeLayer("nearby-parcels-fill");
    }
    if (map.current.getLayer("nearby-parcels-outline")) {
      map.current.removeLayer("nearby-parcels-outline");
    }
    if (map.current.getSource("nearby-parcels")) {
      map.current.removeSource("nearby-parcels");
    }
  }, []);

  const addCompMarkers = useCallback(() => {
    if (!map.current) return;
    
    compMarkersRef.current.forEach(m => m.remove());
    compMarkersRef.current = [];
    
    comps.forEach(comp => {
      if (!comp.lat || !comp.lng) return;
      
      const color = getCompRecencyColor(comp.saleDate);
      const opacity = getCompRecencyOpacity(comp.saleDate);
      
      const el = document.createElement("div");
      el.className = "comp-marker";
      el.style.cssText = `
        width: 24px;
        height: 24px;
        background-color: ${color};
        border: 2px solid white;
        border-radius: 50%;
        cursor: pointer;
        opacity: ${opacity};
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`;
      
      const pricePerAcre = comp.pricePerAcre 
        ? `$${comp.pricePerAcre.toLocaleString()}/ac`
        : comp.salePrice && comp.acres 
          ? `$${Math.round(comp.salePrice / comp.acres).toLocaleString()}/ac`
          : "N/A";
      
      const popup = new mapboxgl.Popup({ offset: 25, closeButton: true })
        .setHTML(`
          <div style="min-width: 180px; font-family: system-ui;">
            <div style="font-weight: 600; margin-bottom: 4px;">${comp.address || comp.apn || "Comp Property"}</div>
            ${comp.salePrice ? `<div style="color: #22c55e; font-weight: 500;">$${comp.salePrice.toLocaleString()}</div>` : ""}
            ${comp.saleDate ? `<div style="font-size: 12px; color: #6b7280;">Sold: ${new Date(comp.saleDate).toLocaleDateString()}</div>` : ""}
            ${comp.acres ? `<div style="font-size: 12px; color: #6b7280;">Size: ${comp.acres.toFixed(2)} acres</div>` : ""}
            <div style="font-size: 12px; color: #6b7280;">$/Acre: ${pricePerAcre}</div>
            ${comp.distance ? `<div style="font-size: 12px; color: #6b7280;">Distance: ${comp.distance.toFixed(2)} mi</div>` : ""}
          </div>
        `);
      
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([comp.lng, comp.lat])
        .setPopup(popup)
        .addTo(map.current!);
      
      compMarkersRef.current.push(marker);
    });
  }, [comps]);

  const removeCompMarkers = useCallback(() => {
    compMarkersRef.current.forEach(m => m.remove());
    compMarkersRef.current = [];
  }, []);

  const addDynamicLayer = useCallback((layer: MapLayer, opacity: number) => {
    if (!map.current || !layer.apiUrl) return;
    
    const sourceId = `dynamic-layer-${layer.id}`;
    const layerId = `dynamic-layer-${layer.id}-raster`;
    
    if (map.current.getLayer(layerId)) {
      map.current.setPaintProperty(layerId, "raster-opacity", opacity);
      return;
    }
    
    if (map.current.getSource(sourceId)) {
      map.current.removeSource(sourceId);
    }
    
    if (isArcGISMapServerUrl(layer.apiUrl)) {
      const tileUrl = buildArcGISRasterTileUrl(layer.apiUrl);
      
      map.current.addSource(sourceId, {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        attribution: layer.title,
      });
      
      const firstSymbolId = map.current.getStyle()?.layers?.find(l => l.type === "symbol")?.id;
      
      map.current.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": opacity,
          "raster-fade-duration": 0,
        },
      }, firstSymbolId);
      
      dynamicLayerIdsRef.current.add(layerId);
    }
  }, []);

  const removeDynamicLayer = useCallback((layerId: number) => {
    if (!map.current) return;
    
    const sourceId = `dynamic-layer-${layerId}`;
    const rasterLayerId = `dynamic-layer-${layerId}-raster`;
    
    if (map.current.getLayer(rasterLayerId)) {
      map.current.removeLayer(rasterLayerId);
      dynamicLayerIdsRef.current.delete(rasterLayerId);
    }
    
    if (map.current.getSource(sourceId)) {
      map.current.removeSource(sourceId);
    }
  }, []);

  const updateDynamicLayerOpacity = useCallback((layerId: number, opacity: number) => {
    if (!map.current) return;
    
    const rasterLayerId = `dynamic-layer-${layerId}-raster`;
    
    if (map.current.getLayer(rasterLayerId)) {
      map.current.setPaintProperty(rasterLayerId, "raster-opacity", opacity);
    }
  }, []);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    
    dynamicEnabledLayers.forEach(layer => {
      const opacity = getDynamicLayerOpacity(layer.id);
      addDynamicLayer(layer, opacity);
    });
    
    dynamicLayerIdsRef.current.forEach(layerId => {
      const match = layerId.match(/^dynamic-layer-(\d+)-raster$/);
      if (match) {
        const id = parseInt(match[1], 10);
        if (!dynamicEnabledLayers.some(l => l.id === id)) {
          removeDynamicLayer(id);
        }
      }
    });
  }, [mapLoaded, dynamicEnabledLayers, addDynamicLayer, removeDynamicLayer, getDynamicLayerOpacity]);

  useEffect(() => {
    if (showNearbyParcels && nearbyParcels.length > 0 && mapLoaded) {
      addNearbyParcelsLayer();
    } else {
      removeNearbyParcelsLayer();
    }
  }, [showNearbyParcels, nearbyParcels, mapLoaded, addNearbyParcelsLayer, removeNearbyParcelsLayer]);

  useEffect(() => {
    if (showComps && comps.length > 0 && mapLoaded) {
      addCompMarkers();
    } else {
      removeCompMarkers();
    }
  }, [showComps, comps, mapLoaded, addCompMarkers, removeCompMarkers]);

  const addPropertyLayers = useCallback(() => {
    if (!map.current) return;

    if (map.current.getSource("properties")) {
      if (map.current.getLayer("property-labels")) map.current.removeLayer("property-labels");
      if (map.current.getLayer("property-outline")) map.current.removeLayer("property-outline");
      if (map.current.getLayer("property-fill")) map.current.removeLayer("property-fill");
      if (map.current.getSource("labels")) map.current.removeSource("labels");
      map.current.removeSource("properties");
    }

    const geojsonData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: properties
        .filter(p => p.boundary)
        .map(p => ({
          type: "Feature",
          properties: {
            id: p.id,
            apn: p.apn,
            name: p.name,
            status: p.status || "default",
            color: STATUS_COLORS[p.status || "default"] || STATUS_COLORS.default,
          },
          geometry: p.boundary as GeoJSON.Geometry,
        })),
    };

    map.current.addSource("properties", {
      type: "geojson",
      data: geojsonData,
    });

    map.current.addLayer({
      id: "property-fill",
      type: "fill",
      source: "properties",
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": layerState.heatmapOpacity,
      },
      layout: {
        visibility: layerState.propertyHeatmap ? "visible" : "none"
      }
    });

    map.current.addLayer({
      id: "property-outline",
      type: "line",
      source: "properties",
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3,
        "line-opacity": 0.9,
      },
      layout: {
        visibility: layerState.propertyHeatmap ? "visible" : "none"
      }
    });

    if (showLabels) {
      const labelPoints: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: properties
          .filter(p => p.centroid)
          .map(p => ({
            type: "Feature",
            properties: { id: p.id, apn: p.apn },
            geometry: {
              type: "Point",
              coordinates: [p.centroid.lng, p.centroid.lat],
            },
          })),
      };

      map.current.addSource("labels", {
        type: "geojson",
        data: labelPoints,
      });

      map.current.addLayer({
        id: "property-labels",
        type: "symbol",
        source: "labels",
        layout: {
          "text-field": ["get", "apn"],
          "text-size": 12,
          "text-anchor": "center",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#000000",
          "text-halo-width": 1.5,
        },
      });
    }

    if (layerState.femaFloodZone) {
      addFemaFloodLayer();
    }
  }, [properties, showLabels, layerState.heatmapOpacity, layerState.propertyHeatmap, layerState.femaFloodZone, addFemaFloodLayer]);

  const setup3DTerrain = useCallback(() => {
    if (!map.current || !enable3DTerrain) return;

    if (!map.current.getSource("mapbox-dem")) {
      map.current.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
    }

    map.current.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

    // Initialize sky with real-time solar position
    if (!map.current.getLayer("sky")) {
      const center = map.current.getCenter();
      const currentHour = new Date().getHours() + new Date().getMinutes() / 60;
      const solar = calculateSolarPosition(center.lat, center.lng, currentHour);
      const sunIntensity = solar.isDaytime
        ? Math.min(20, 5 + solar.altitude * 0.3)
        : 0.5;
      map.current.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [solar.azimuth, Math.max(-10, solar.altitude)],
          "sky-atmosphere-sun-intensity": sunIntensity,
        },
      });
    }
  }, [enable3DTerrain]);

  const changeMapStyle = useCallback((style: MapStyle) => {
    if (!map.current) return;
    setCurrentStyle(style);
    map.current.setStyle(MAP_STYLES[style]);

    map.current.once("style.load", () => {
      setup3DTerrain();
      addPropertyLayers();
    });
  }, [setup3DTerrain, addPropertyLayers]);

  const startFlyover = useCallback(() => {
    if (!map.current || properties.length === 0) return;

    setIsFlyoverActive(true);

    // Build cinematic waypoints: visit each property in sequence
    const waypoints = properties.slice(0, 8); // cap at 8 properties per tour
    let wpIndex = 0;
    let orbitBearing = 0;
    let orbitFrames = 0;
    const ORBIT_FRAMES_PER_PROPERTY = 240; // ~8 seconds at 30fps

    const visitNext = () => {
      if (!map.current || !flyoverAnimationRef.current && wpIndex > 0) return;
      const wp = waypoints[wpIndex % waypoints.length];

      // Fly to this property with cinematic pitch + varying bearing
      const approachBearing = (wpIndex * 137.5) % 360; // golden angle rotation
      map.current.flyTo({
        center: [wp.centroid.lng, wp.centroid.lat],
        zoom: 15.5 + Math.random() * 0.8,
        pitch: 55 + Math.random() * 15,
        bearing: approachBearing,
        duration: 3500,
        curve: 1.4,
        essential: true,
      });

      orbitBearing = approachBearing;
      orbitFrames = 0;
    };

    visitNext();

    const animate = () => {
      if (!map.current) return;
      orbitFrames++;

      // Slow orbit around current property
      orbitBearing = (orbitBearing + 0.18) % 360;
      map.current.setBearing(orbitBearing);

      // Subtle pitch oscillation for cinematic effect
      const pitchWave = 60 + Math.sin((orbitFrames / ORBIT_FRAMES_PER_PROPERTY) * Math.PI * 2) * 8;
      map.current.setPitch(pitchWave);

      // Move to next property after orbit completes
      if (orbitFrames >= ORBIT_FRAMES_PER_PROPERTY) {
        wpIndex = (wpIndex + 1) % waypoints.length;
        visitNext();
      }

      flyoverAnimationRef.current = requestAnimationFrame(animate);
    };

    // Start orbit after fly-in completes
    const startOrbit = () => {
      flyoverAnimationRef.current = requestAnimationFrame(animate);
    };
    setTimeout(startOrbit, 3600);
  }, [properties]);

  const stopFlyover = useCallback(() => {
    if (flyoverAnimationRef.current) {
      cancelAnimationFrame(flyoverAnimationRef.current);
      flyoverAnimationRef.current = null;
    }
    setIsFlyoverActive(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
    setTimeout(() => {
      map.current?.resize();
    }, 100);
  }, []);

  const clearMeasurement = useCallback(() => {
    measurementPoints.forEach(p => p.marker?.remove());
    setMeasurementPoints([]);
    
    if (map.current) {
      if (map.current.getLayer("measurement-line")) {
        map.current.removeLayer("measurement-line");
      }
      if (map.current.getLayer("measurement-fill")) {
        map.current.removeLayer("measurement-fill");
      }
      if (map.current.getSource("measurement")) {
        map.current.removeSource("measurement");
      }
    }
  }, [measurementPoints]);

  const exitMeasurementMode = useCallback(() => {
    if (measurementClickHandlerRef.current && map.current) {
      map.current.off("click", measurementClickHandlerRef.current);
      measurementClickHandlerRef.current = null;
    }
    clearMeasurement();
    setMeasurementMode("none");
    if (map.current) {
      map.current.getCanvas().style.cursor = "";
    }
  }, [clearMeasurement]);

  const updateMeasurementLayer = useCallback((points: MeasurementPoint[], mode: MeasurementMode) => {
    if (!map.current || points.length < 2) return;
    
    const coordinates = points.map(p => [p.lng, p.lat]);
    
    if (map.current.getSource("measurement")) {
      const source = map.current.getSource("measurement") as mapboxgl.GeoJSONSource;
      if (mode === "area" && points.length >= 3) {
        source.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [[...coordinates, coordinates[0]]]
          }
        });
      } else {
        source.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates
          }
        });
      }
    } else {
      const geojsonData: GeoJSON.Feature = mode === "area" && points.length >= 3
        ? {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[...coordinates, coordinates[0]]]
            }
          }
        : {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates
            }
          };
      
      map.current.addSource("measurement", {
        type: "geojson",
        data: geojsonData
      });
      
      if (mode === "area") {
        map.current.addLayer({
          id: "measurement-fill",
          type: "fill",
          source: "measurement",
          paint: {
            "fill-color": "#3b82f6",
            "fill-opacity": 0.3
          }
        });
      }
      
      map.current.addLayer({
        id: "measurement-line",
        type: "line",
        source: "measurement",
        paint: {
          "line-color": "#3b82f6",
          "line-width": 3,
          "line-dasharray": [2, 1]
        }
      });
    }
  }, []);

  const startMeasurement = useCallback((mode: MeasurementMode) => {
    if (!map.current) return;
    
    if (measurementClickHandlerRef.current) {
      map.current.off("click", measurementClickHandlerRef.current);
    }
    clearMeasurement();
    setMeasurementMode(mode);
    map.current.getCanvas().style.cursor = "crosshair";
    
    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      
      const marker = new mapboxgl.Marker({
        color: "#3b82f6",
        scale: 0.7
      })
        .setLngLat([lng, lat])
        .addTo(map.current!);
      
      setMeasurementPoints(prev => {
        const newPoints = [...prev, { lng, lat, marker }];
        updateMeasurementLayer(newPoints, mode);
        return newPoints;
      });
    };
    
    measurementClickHandlerRef.current = handleClick;
    map.current.on("click", handleClick);
  }, [clearMeasurement, updateMeasurementLayer]);

  const toggleMeasurementUnits = useCallback(() => {
    setMeasurementUnits(prev => {
      const newUnits = prev === "imperial" ? "metric" : "imperial";
      saveMeasurementUnits(newUnits);
      return newUnits;
    });
  }, []);

  const exportMapAsPng = useCallback(async () => {
    if (!map.current) return;
    
    setIsExporting(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const canvas = map.current.getCanvas();
      const dataUrl = canvas.toDataURL("image/png");
      
      const link = document.createElement("a");
      link.download = `map-export-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
      
      toast({
        title: "Map Exported",
        description: "Image downloaded successfully.",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Could not export map image.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }, [toast]);

  const copyMapToClipboard = useCallback(async () => {
    if (!map.current) return;
    
    setIsExporting(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const canvas = map.current.getCanvas();
      
      canvas.toBlob(async (blob) => {
        if (!blob) {
          throw new Error("Failed to create blob");
        }
        
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
          ]);
          
          toast({
            title: "Copied to Clipboard",
            description: "Map image copied successfully.",
          });
        } catch (err) {
          toast({
            title: "Copy Failed",
            description: "Could not copy to clipboard. Try downloading instead.",
            variant: "destructive",
          });
        } finally {
          setIsExporting(false);
        }
      }, "image/png");
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Could not export map image.",
        variant: "destructive",
      });
      setIsExporting(false);
    }
  }, [toast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && measurementMode !== "none") {
        exitMeasurementMode();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [measurementMode, exitMeasurementMode]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    if (layerState.femaFloodZone) addFemaFloodLayer(); else removeFemaFloodLayer();
  }, [layerState.femaFloodZone, mapLoaded, addFemaFloodLayer, removeFemaFloodLayer]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    if (layerState.osmBuildings) addOsmBuildingsLayer(); else removeOsmBuildingsLayer();
  }, [layerState.osmBuildings, mapLoaded, addOsmBuildingsLayer, removeOsmBuildingsLayer]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    if (layerState.terrainContours) addTerrainContoursLayer(); else removeTerrainContoursLayer();
  }, [layerState.terrainContours, mapLoaded, addTerrainContoursLayer, removeTerrainContoursLayer]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    if (layerState.usdaCropland) addArcGISOverlayLayer("usda-cdl", USDA_CDL_URL);
    else removeArcGISOverlayLayer("usda-cdl");
  }, [layerState.usdaCropland, mapLoaded, addArcGISOverlayLayer, removeArcGISOverlayLayer]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    if (layerState.usdaClu) addArcGISOverlayLayer("usda-clu", USDA_CLU_URL);
    else removeArcGISOverlayLayer("usda-clu");
  }, [layerState.usdaClu, mapLoaded, addArcGISOverlayLayer, removeArcGISOverlayLayer]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    if (layerState.usgsHillshade) addArcGISOverlayLayer("usgs-hillshade", USGS_HILLSHADE_URL);
    else removeArcGISOverlayLayer("usgs-hillshade");
  }, [layerState.usgsHillshade, mapLoaded, addArcGISOverlayLayer, removeArcGISOverlayLayer]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    togglePropertyHeatmap(layerState.propertyHeatmap);
  }, [layerState.propertyHeatmap, mapLoaded, togglePropertyHeatmap]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    updateHeatmapOpacity(layerState.heatmapOpacity);
  }, [layerState.heatmapOpacity, mapLoaded, updateHeatmapOpacity]);

  // Hypsometric hillshade layer toggle
  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    if (layerState.hypsometricHillshade) addHypsometricLayer();
    else removeHypsometricLayer();
  }, [layerState.hypsometricHillshade, mapLoaded, addHypsometricLayer, removeHypsometricLayer]);

  // Slope gradient layer toggle
  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    if (layerState.slopeGradient) addSlopeGradientLayer();
    else removeSlopeGradientLayer();
  }, [layerState.slopeGradient, mapLoaded, addSlopeGradientLayer, removeSlopeGradientLayer]);

  // Solar time → sky update
  useEffect(() => {
    updateSkyForTime(sunHour);
  }, [sunHour, mapLoaded, updateSkyForTime]);

  // Sun animation loop
  useEffect(() => {
    if (!isSunAnimating) {
      if (sunAnimRef.current) {
        cancelAnimationFrame(sunAnimRef.current);
        sunAnimRef.current = null;
      }
      return;
    }
    const step = () => {
      setSunHour((prev) => {
        const next = (prev + 0.05) % 24; // ~24 seconds per simulated day
        return next;
      });
      sunAnimRef.current = requestAnimationFrame(step);
    };
    sunAnimRef.current = requestAnimationFrame(step);
    return () => {
      if (sunAnimRef.current) cancelAnimationFrame(sunAnimRef.current);
    };
  }, [isSunAnimating]);

  // Track map bearing for compass rose
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const onRotate = () => {
      if (map.current) setMapBearing(map.current.getBearing());
    };
    map.current.on("rotate", onRotate);
    return () => {
      map.current?.off("rotate", onRotate);
    };
  }, [mapLoaded]);

  // Elevation profile: sample terrain when measurement points change
  useEffect(() => {
    if (
      measurementMode === "distance" &&
      measurementPoints.length >= 2 &&
      map.current &&
      mapLoaded
    ) {
      const pts = sampleElevationAlongLine(map.current, measurementPoints, 60);
      if (pts.some((p) => p.elevation !== 0)) {
        setElevationPoints(pts);
        setShowElevationProfile(true);
      }
    } else {
      setElevationPoints([]);
      setShowElevationProfile(false);
    }
  }, [measurementPoints, measurementMode, mapLoaded]);

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN || properties.length === 0) return;

    const viewState = initialViewState || (() => {
      if (properties.length === 0) {
        return { longitude: -98.5795, latitude: 39.8283, zoom: 4, pitch: 0 };
      }
      const avgLng = properties.reduce((sum, p) => sum + p.centroid.lng, 0) / properties.length;
      const avgLat = properties.reduce((sum, p) => sum + p.centroid.lat, 0) / properties.length;
      return {
        longitude: avgLng,
        latitude: avgLat,
        zoom: properties.length === 1 ? 16 : 10,
        pitch: 60,
      };
    })();

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[currentStyle],
      center: [viewState.longitude, viewState.latitude],
      zoom: viewState.zoom,
      pitch: viewState.pitch || 60,
      bearing: 0,
      interactive,
    });

    map.current.on("load", () => {
      if (!map.current) return;
      setMapLoaded(true);

      setup3DTerrain();
      addPropertyLayers();

      if (interactive) {
        map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
      }
    });

    return () => {
      stopFlyover();
      map.current?.remove();
    };
  }, [properties, initialViewState, interactive, currentStyle, setup3DTerrain, addPropertyLayers, stopFlyover]);

  if (!MAPBOX_TOKEN) {
    return (
      <Card className="flex items-center justify-center" style={{ height }}>
        <CardContent className="text-center text-muted-foreground p-6">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Map not available</p>
          <p className="text-sm mt-1">Please configure VITE_MAPBOX_ACCESS_TOKEN</p>
        </CardContent>
      </Card>
    );
  }

  if (properties.length === 0) {
    return (
      <Card className="flex items-center justify-center" style={{ height }}>
        <CardContent className="text-center text-muted-foreground p-6">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No properties with map data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div 
      className={cn(
        "relative rounded-md overflow-hidden",
        isFullscreen && "fixed inset-0 z-50 rounded-none"
      )}
      style={isFullscreen ? undefined : { height, width: "100%" }}
      data-testid="property-map-container"
    >
      <div 
        ref={mapContainer} 
        className="w-full h-full"
        style={isFullscreen ? { height: "100vh" } : { height }}
        data-testid="property-map"
      />

      {showControls && (
        <>
          <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
            <div className="flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1 shadow-lg">
              <Button
                size="icon"
                variant={currentStyle === "satellite" ? "default" : "ghost"}
                onClick={() => changeMapStyle("satellite")}
                title="Satellite View"
                data-testid="button-map-satellite"
              >
                <Satellite className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant={currentStyle === "terrain" ? "default" : "ghost"}
                onClick={() => changeMapStyle("terrain")}
                title="Terrain View"
                data-testid="button-map-terrain"
              >
                <Mountain className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant={currentStyle === "streets" ? "default" : "ghost"}
                onClick={() => changeMapStyle("streets")}
                title="Street View"
                data-testid="button-map-streets"
              >
                <MapIcon className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1 shadow-lg">
              <Button
                size="icon"
                variant={is3DExtrudeMode ? "default" : "ghost"}
                onClick={toggle3DExtrude}
                title={is3DExtrudeMode ? "Exit 3D View" : "3D Parcel View"}
                data-testid="button-3d-extrude"
              >
                <Box className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant={isFlyoverActive ? "default" : "ghost"}
                onClick={isFlyoverActive ? stopFlyover : startFlyover}
                title={isFlyoverActive ? "Stop Cinematic Flyover" : "Cinematic Property Tour"}
                data-testid="button-map-flyover"
              >
                {isFlyoverActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant={showSunPanel ? "default" : "ghost"}
                onClick={() => setShowSunPanel((v) => !v)}
                title="Solar Simulation"
                data-testid="button-sun-panel"
              >
                <Sun className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                data-testid="button-map-fullscreen"
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            </div>

            <div className="flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1 shadow-lg">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant={measurementMode !== "none" ? "default" : "ghost"}
                    title="Measure"
                    data-testid="button-measure"
                  >
                    <Ruler className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => startMeasurement("distance")}
                    data-testid="menu-item-measure-distance"
                  >
                    <Ruler className="h-4 w-4 mr-2" />
                    Measure Distance
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => startMeasurement("area")}
                    data-testid="menu-item-measure-area"
                  >
                    <Square className="h-4 w-4 mr-2" />
                    Measure Area
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Export Map"
                    disabled={isExporting}
                    data-testid="button-export"
                  >
                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={exportMapAsPng}
                    disabled={isExporting}
                    data-testid="menu-item-download-png"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download as PNG
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={copyMapToClipboard}
                    disabled={isExporting}
                    data-testid="menu-item-copy-clipboard"
                  >
                    <Clipboard className="h-4 w-4 mr-2" />
                    Copy to Clipboard
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {selectedPropertyId && (
              <div className="flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1 shadow-lg">
                <Button
                  size="icon"
                  variant={showNearbyParcels ? "default" : "ghost"}
                  onClick={fetchNearbyParcels}
                  disabled={nearbyLoading}
                  title="Find Nearby Parcels"
                  data-testid="button-find-nearby"
                >
                  {nearbyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPinned className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon"
                  variant={showComps ? "default" : "ghost"}
                  onClick={fetchComps}
                  disabled={compsLoading}
                  title="Show Comparables"
                  data-testid="button-show-comps"
                >
                  {compsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>

          {showNearbyParcels && nearbyParcels.length > 0 && (
            <div className="absolute top-3 right-14 z-10 w-64">
              <Collapsible open={nearbyPanelOpen} onOpenChange={setNearbyPanelOpen}>
                <div className="bg-background/90 backdrop-blur-sm rounded-md shadow-lg">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-between gap-2 rounded-b-none"
                      data-testid="button-toggle-nearby-panel"
                    >
                      <div className="flex items-center gap-2">
                        <MapPinned className="h-4 w-4 text-blue-500" />
                        <span className="text-sm font-medium">Nearby Parcels ({nearbyParcels.length})</span>
                      </div>
                      {nearbyPanelOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="p-3 space-y-3 border-t">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground">Radius:</Label>
                        <Select value={nearbyRadius} onValueChange={(v) => setNearbyRadius(v as NearbyRadius)}>
                          <SelectTrigger className="h-7 text-xs" data-testid="select-nearby-radius">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0.5">0.5 mi</SelectItem>
                            <SelectItem value="1">1 mi</SelectItem>
                            <SelectItem value="2">2 mi</SelectItem>
                            <SelectItem value="5">5 mi</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={fetchNearbyParcels}
                          disabled={nearbyLoading}
                          className="h-7 text-xs"
                          data-testid="button-refresh-nearby"
                        >
                          {nearbyLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
                        </Button>
                      </div>
                      <ScrollArea className="h-[150px]">
                        <div className="space-y-2">
                          {nearbyParcels.slice(0, 10).map((parcel, idx) => (
                            <div 
                              key={parcel.apn || idx} 
                              className="p-2 rounded-md bg-muted/50 text-xs"
                              data-testid={`nearby-parcel-${idx}`}
                            >
                              <div className="font-medium">{parcel.apn}</div>
                              <div className="text-muted-foreground">
                                {parcel.distance?.toFixed(2)} mi away
                                {parcel.acres ? ` | ${parcel.acres.toFixed(2)} ac` : ""}
                              </div>
                            </div>
                          ))}
                          {nearbyParcels.length > 10 && (
                            <div className="text-xs text-muted-foreground text-center">
                              +{nearbyParcels.length - 10} more parcels
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                      <div className="flex items-center gap-2 pt-2 border-t">
                        <Checkbox
                          id="show-nearby"
                          checked={showNearbyParcels}
                          onCheckedChange={(c) => setShowNearbyParcels(!!c)}
                          data-testid="checkbox-show-nearby"
                        />
                        <Label htmlFor="show-nearby" className="text-xs cursor-pointer">Show on map</Label>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-6 text-xs"
                          onClick={() => { setNearbyParcels([]); setShowNearbyParcels(false); }}
                          data-testid="button-clear-nearby"
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </div>
          )}

          {showComps && comps.length > 0 && (
            <div className="absolute bottom-3 right-3 z-10 w-72">
              <Collapsible open={compsPanelOpen} onOpenChange={setCompsPanelOpen}>
                <div className="bg-background/90 backdrop-blur-sm rounded-md shadow-lg">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-between gap-2 rounded-b-none"
                      data-testid="button-toggle-comps-panel"
                    >
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-medium">Comparables ({comps.length})</span>
                      </div>
                      {compsPanelOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="p-3 space-y-3 border-t">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">Recency:</span>
                        <div className="flex items-center gap-1">
                          <CircleDot className="h-3 w-3" style={{ color: COMP_RECENCY_COLORS.recent }} />
                          <span className="text-[10px]">0-6mo</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CircleDot className="h-3 w-3" style={{ color: COMP_RECENCY_COLORS.moderate }} />
                          <span className="text-[10px]">6-12mo</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CircleDot className="h-3 w-3" style={{ color: COMP_RECENCY_COLORS.older }} />
                          <span className="text-[10px]">12-24mo</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CircleDot className="h-3 w-3" style={{ color: COMP_RECENCY_COLORS.old }} />
                          <span className="text-[10px]">24mo+</span>
                        </div>
                      </div>
                      <ScrollArea className="h-[180px]">
                        <div className="space-y-2">
                          {comps.map((comp, idx) => (
                            <div 
                              key={comp.id || idx} 
                              className="p-2 rounded-md bg-muted/50 text-xs"
                              data-testid={`comp-item-${idx}`}
                            >
                              <div className="font-medium truncate">{comp.address || comp.apn || "Comp Property"}</div>
                              {comp.salePrice && (
                                <div className="text-green-600 font-semibold">${comp.salePrice.toLocaleString()}</div>
                              )}
                              <div className="text-muted-foreground flex flex-wrap gap-2">
                                {comp.saleDate && <span>{new Date(comp.saleDate).toLocaleDateString()}</span>}
                                {comp.acres && <span>{comp.acres.toFixed(2)} ac</span>}
                                {comp.pricePerAcre && <span>${comp.pricePerAcre.toLocaleString()}/ac</span>}
                              </div>
                              {comp.distance && (
                                <div className="text-muted-foreground">{comp.distance.toFixed(2)} mi away</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                      <div className="flex items-center gap-2 pt-2 border-t">
                        <Checkbox
                          id="show-comps"
                          checked={showComps}
                          onCheckedChange={(c) => setShowComps(!!c)}
                          data-testid="checkbox-show-comps"
                        />
                        <Label htmlFor="show-comps" className="text-xs cursor-pointer">Show on map</Label>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-6 text-xs"
                          onClick={() => { setComps([]); setShowComps(false); }}
                          data-testid="button-clear-comps"
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </div>
          )}

          <div className="absolute bottom-3 left-3 z-10">
            <Collapsible open={isLayerPanelOpen} onOpenChange={setIsLayerPanelOpen}>
              <div className="bg-background/90 backdrop-blur-sm rounded-md shadow-lg overflow-visible">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between gap-2 px-3"
                    data-testid="button-layer-panel-toggle"
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4" />
                      <span className="text-sm font-medium">Data Layers</span>
                    </div>
                    {isLayerPanelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-3 pt-0 space-y-4 min-w-[220px]">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="fema-flood"
                          checked={layerState.femaFloodZone}
                          onCheckedChange={(checked) => updateLayerState({ femaFloodZone: !!checked })}
                          data-testid="checkbox-fema-flood"
                        />
                        <Label htmlFor="fema-flood" className="text-sm flex items-center gap-2 cursor-pointer">
                          FEMA Flood Zones
                          {femaLoading && <Loader2 className="h-3 w-3 animate-spin" data-testid="loader-fema" />}
                        </Label>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="property-heatmap"
                            checked={layerState.propertyHeatmap}
                            onCheckedChange={(checked) => updateLayerState({ propertyHeatmap: !!checked })}
                            data-testid="checkbox-property-heatmap"
                          />
                          <Label htmlFor="property-heatmap" className="text-sm cursor-pointer">
                            Property Status
                          </Label>
                        </div>
                        {layerState.propertyHeatmap && (
                          <div className="pl-6 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Opacity</span>
                              <span className="text-xs text-muted-foreground" data-testid="text-opacity-value">{Math.round(layerState.heatmapOpacity * 100)}%</span>
                            </div>
                            <Slider
                              value={[layerState.heatmapOpacity]}
                              onValueChange={([value]) => updateLayerState({ heatmapOpacity: value })}
                              min={0.1}
                              max={1}
                              step={0.05}
                              className="w-full"
                              data-testid="slider-heatmap-opacity"
                            />
                            <div className="flex flex-wrap gap-1 mt-2">
                              {Object.entries(STATUS_COLORS).filter(([key]) => key !== "default").map(([status, color]) => (
                                <div key={status} className="flex items-center gap-1" data-testid={`legend-status-${status}`}>
                                  <div 
                                    className="w-2 h-2 rounded-full" 
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="text-[10px] text-muted-foreground capitalize">{status.replace("_", " ")}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="zoning-districts"
                          checked={layerState.zoningDistricts}
                          onCheckedChange={(checked) => handleZoningToggle(!!checked)}
                          data-testid="checkbox-zoning-districts"
                        />
                        <Label htmlFor="zoning-districts" className="text-sm cursor-pointer text-muted-foreground">
                          Zoning Districts
                        </Label>
                      </div>

                      <Separator />
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">3D &amp; Terrain</div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="osm-buildings"
                          checked={layerState.osmBuildings}
                          onCheckedChange={(checked) => updateLayerState({ osmBuildings: !!checked })}
                          data-testid="checkbox-osm-buildings"
                        />
                        <Label htmlFor="osm-buildings" className="text-sm cursor-pointer flex items-center gap-1">
                          <Box className="h-3 w-3 text-muted-foreground" />
                          OSM 3D Buildings
                        </Label>
                      </div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="terrain-contours"
                          checked={layerState.terrainContours}
                          onCheckedChange={(checked) => updateLayerState({ terrainContours: !!checked })}
                          data-testid="checkbox-terrain-contours"
                        />
                        <Label htmlFor="terrain-contours" className="text-sm cursor-pointer flex items-center gap-1">
                          <Mountain className="h-3 w-3 text-muted-foreground" />
                          Terrain Contours
                        </Label>
                      </div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="usgs-hillshade"
                          checked={layerState.usgsHillshade}
                          onCheckedChange={(checked) => updateLayerState({ usgsHillshade: !!checked })}
                          data-testid="checkbox-usgs-hillshade"
                        />
                        <Label htmlFor="usgs-hillshade" className="text-sm cursor-pointer flex items-center gap-1">
                          <Sun className="h-3 w-3 text-muted-foreground" />
                          USGS Hillshade
                        </Label>
                      </div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="hypsometric-hillshade"
                          checked={layerState.hypsometricHillshade}
                          onCheckedChange={(checked) => updateLayerState({ hypsometricHillshade: !!checked })}
                          data-testid="checkbox-hypsometric-hillshade"
                        />
                        <Label htmlFor="hypsometric-hillshade" className="text-sm cursor-pointer flex items-center gap-1">
                          <Mountain className="h-3 w-3 text-emerald-600" />
                          Hypsometric Relief
                        </Label>
                      </div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="slope-gradient"
                          checked={layerState.slopeGradient}
                          onCheckedChange={(checked) => updateLayerState({ slopeGradient: !!checked })}
                          data-testid="checkbox-slope-gradient"
                        />
                        <Label htmlFor="slope-gradient" className="text-sm cursor-pointer flex items-center gap-1">
                          <TrendingUp className="h-3 w-3 text-amber-600" />
                          Slope Gradient
                        </Label>
                      </div>

                      <Separator />
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Agriculture (USDA Free)</div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="usda-cropland"
                          checked={layerState.usdaCropland}
                          onCheckedChange={(checked) => updateLayerState({ usdaCropland: !!checked })}
                          data-testid="checkbox-usda-cropland"
                        />
                        <Label htmlFor="usda-cropland" className="text-sm cursor-pointer flex items-center gap-1">
                          <Tractor className="h-3 w-3 text-muted-foreground" />
                          Cropland Data Layer
                        </Label>
                      </div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="usda-clu"
                          checked={layerState.usdaClu}
                          onCheckedChange={(checked) => updateLayerState({ usdaClu: !!checked })}
                          data-testid="checkbox-usda-clu"
                        />
                        <Label htmlFor="usda-clu" className="text-sm cursor-pointer flex items-center gap-1">
                          <TreePine className="h-3 w-3 text-muted-foreground" />
                          Common Land Units
                        </Label>
                      </div>

                      <Separator className="my-3" />

                      <Collapsible open={dynamicLayersSectionOpen} onOpenChange={setDynamicLayersSectionOpen}>
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-between gap-2 px-0 h-8"
                            data-testid="button-toggle-dynamic-layers"
                          >
                            <div className="flex items-center gap-2">
                              <Database className="h-4 w-4" />
                              <span className="text-sm font-medium">GIS Data Layers</span>
                              {dynamicLayersLoading && <Loader2 className="h-3 w-3 animate-spin" data-testid="loader-dynamic-layers" />}
                              {dynamicEnabledLayers.length > 0 && (
                                <Badge variant="secondary" className="h-5 px-1.5 text-xs" data-testid="badge-enabled-layers-count">
                                  {dynamicEnabledLayers.length}
                                </Badge>
                              )}
                            </div>
                            {dynamicLayersSectionOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ScrollArea className="h-[200px] mt-2" data-testid="dynamic-layers-scroll-area">
                            <div className="space-y-3 pr-3">
                              {Object.keys(dynamicLayersByCategory).length === 0 && !dynamicLayersLoading && (
                                <div className="text-xs text-muted-foreground text-center py-2" data-testid="text-no-dynamic-layers">
                                  No GIS layers available
                                </div>
                              )}
                              {Object.entries(dynamicLayersByCategory).map(([category, layers]) => (
                                <div key={category} className="space-y-2" data-testid={`dynamic-layer-category-${category.toLowerCase().replace(/\s+/g, "-")}`}>
                                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                    {category}
                                  </div>
                                  {layers.slice(0, 10).map((layer) => (
                                    <div key={layer.id} className="space-y-1" data-testid={`dynamic-layer-item-${layer.id}`}>
                                      <div className="flex items-center gap-2">
                                        <Checkbox
                                          id={`dynamic-layer-${layer.id}`}
                                          checked={isDynamicLayerEnabled(layer.id)}
                                          onCheckedChange={() => toggleDynamicLayer(layer.id)}
                                          disabled={!isArcGISMapServerUrl(layer.apiUrl)}
                                          data-testid={`checkbox-dynamic-layer-${layer.id}`}
                                        />
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Label
                                              htmlFor={`dynamic-layer-${layer.id}`}
                                              className={cn(
                                                "text-xs cursor-pointer truncate max-w-[150px]",
                                                !isArcGISMapServerUrl(layer.apiUrl) && "text-muted-foreground"
                                              )}
                                              data-testid={`label-dynamic-layer-${layer.id}`}
                                            >
                                              {layer.title}
                                            </Label>
                                          </TooltipTrigger>
                                          <TooltipContent side="right" className="max-w-[250px]">
                                            <div className="space-y-1">
                                              <p className="font-medium">{layer.title}</p>
                                              {layer.description && <p className="text-xs text-muted-foreground">{layer.description}</p>}
                                              {layer.coverage && <p className="text-xs text-muted-foreground">Coverage: {layer.coverage}</p>}
                                              {!isArcGISMapServerUrl(layer.apiUrl) && (
                                                <p className="text-xs text-yellow-500">Not a compatible MapServer layer</p>
                                              )}
                                            </div>
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>
                                      {isDynamicLayerEnabled(layer.id) && (
                                        <div className="pl-6 space-y-1">
                                          <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-muted-foreground">Opacity</span>
                                            <span className="text-[10px] text-muted-foreground" data-testid={`text-dynamic-layer-opacity-${layer.id}`}>
                                              {Math.round(getDynamicLayerOpacity(layer.id) * 100)}%
                                            </span>
                                          </div>
                                          <Slider
                                            value={[getDynamicLayerOpacity(layer.id)]}
                                            onValueChange={([value]) => {
                                              setDynamicLayerOpacity(layer.id, value);
                                              updateDynamicLayerOpacity(layer.id, value);
                                            }}
                                            min={0.1}
                                            max={1}
                                            step={0.05}
                                            className="w-full"
                                            data-testid={`slider-dynamic-layer-opacity-${layer.id}`}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {layers.length > 10 && (
                                    <div className="text-[10px] text-muted-foreground pl-6">
                                      +{layers.length - 10} more layers
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>
        </>
      )}

      {isFullscreen && (
        <Button
          size="icon"
          variant="outline"
          onClick={toggleFullscreen}
          className="absolute top-3 right-3 z-10 bg-background/80 backdrop-blur-sm"
          data-testid="button-exit-fullscreen"
        >
          <Minimize2 className="h-4 w-4" />
        </Button>
      )}

      {measurementMode !== "none" && (
        <div 
          className="absolute top-3 left-1/2 transform -translate-x-1/2 z-10 bg-background/90 backdrop-blur-sm rounded-md shadow-lg p-3 min-w-[200px]"
          data-testid="measurement-overlay"
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              {measurementMode === "distance" ? (
                <Ruler className="h-4 w-4 text-blue-500" />
              ) : (
                <Square className="h-4 w-4 text-blue-500" />
              )}
              <span className="text-sm font-medium">
                {measurementMode === "distance" ? "Distance" : "Area"}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={exitMeasurementMode}
              className="h-6 w-6"
              title="Close (Esc)"
              data-testid="button-close-measurement"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          
          <div className="text-center py-2" data-testid="measurement-result">
            {measurementMode === "distance" ? (
              <span className="text-lg font-semibold">
                {measurementPoints.length >= 2 
                  ? formatDistance(calculateDistance(measurementPoints), measurementUnits)
                  : "Click to add points"}
              </span>
            ) : (
              <span className="text-lg font-semibold">
                {measurementPoints.length >= 3 
                  ? formatArea(calculatePolygonArea(measurementPoints), measurementUnits)
                  : measurementPoints.length < 3 
                    ? `Click to add ${3 - measurementPoints.length} more point${3 - measurementPoints.length > 1 ? "s" : ""}`
                    : "Click to add points"}
              </span>
            )}
          </div>
          
          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t">
            <Button
              size="sm"
              variant="ghost"
              onClick={toggleMeasurementUnits}
              className="text-xs"
              data-testid="button-toggle-units"
            >
              {measurementUnits === "imperial" ? "Switch to Metric" : "Switch to Imperial"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearMeasurement}
              disabled={measurementPoints.length === 0}
              data-testid="button-clear-measurement"
            >
              Clear
            </Button>
          </div>
          
          <div className="text-xs text-muted-foreground text-center mt-2">
            Press Esc to exit
          </div>
        </div>
      )}

      {/* Compass Rose */}
      {showControls && <CompassRose bearing={mapBearing} />}

      {/* Solar Simulation Panel */}
      {showControls && showSunPanel && properties.length > 0 && (
        <SunControlPanel
          lat={properties[0].centroid.lat}
          lng={properties[0].centroid.lng}
          sunHour={sunHour}
          onSunHourChange={(h) => {
            setSunHour(h);
            updateSkyForTime(h);
          }}
          isAnimating={isSunAnimating}
          onToggleAnimation={() => setIsSunAnimating((v) => !v)}
          onClose={() => {
            setShowSunPanel(false);
            setIsSunAnimating(false);
          }}
        />
      )}

      {/* Elevation Profile Overlay (distance measurement mode) */}
      {showControls && showElevationProfile && elevationPoints.length >= 2 && (
        <ElevationProfileOverlay
          points={elevationPoints}
          totalDistance={calculateDistance(measurementPoints)}
          units={measurementUnits}
          onClose={() => setShowElevationProfile(false)}
        />
      )}
    </div>
  );
}

interface SinglePropertyMapProps {
  boundary?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null;
  centroid?: {
    lat: number;
    lng: number;
  } | null;
  apn?: string;
  height?: string;
  enable3DTerrain?: boolean;
  state?: string;
  county?: string;
  showNearbyParcels?: boolean;
}

interface NearbyParcel {
  apn: string;
  boundary: GeoJSON.Geometry;
  centroid: { lat: number; lng: number };
}

export function SinglePropertyMap({ 
  boundary, 
  centroid, 
  apn, 
  height = "300px", 
  enable3DTerrain = true,
  state,
  county,
  showNearbyParcels = true
}: SinglePropertyMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN || !boundary || !centroid) return;

    // Helper to compute bounds from polygon coordinates
    const computeBounds = (coords: number[][][]): [[number, number], [number, number]] => {
      let minLng = Infinity, maxLng = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;
      for (const ring of coords) {
        for (const [lng, lat] of ring) {
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
      }
      return [[minLng, minLat], [maxLng, maxLat]];
    };

    // Compute bounds from boundary coordinates
    const coords = boundary.coordinates as number[][][];
    const bounds = computeBounds(coords);
    
    // Build satellite 3D map with terrain
    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [centroid.lng, centroid.lat],
      zoom: 15.5,
      pitch: enable3DTerrain ? 50 : 0,
      bearing: -15,
      interactive: true,
    });
    map.current = mapInstance;

    mapInstance.on("error", () => { /* suppress to avoid console spam */ });

    let layersAdded = false;

    const addLayers = () => {
      if (layersAdded || mapInstance.getSource("property")) {
        layersAdded = true;
        return;
      }
      layersAdded = true;

      // 3D Terrain + Sky
      if (enable3DTerrain) {
        if (!mapInstance.getSource("mapbox-dem")) {
          mapInstance.addSource("mapbox-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
        }
        mapInstance.setTerrain({ source: "mapbox-dem", exaggeration: 1.4 });

        if (!mapInstance.getLayer("sky")) {
          const currentHour = new Date().getHours() + new Date().getMinutes() / 60;
          const solar = calculateSolarPosition(centroid.lat, centroid.lng, currentHour);
          mapInstance.addLayer({
            id: "sky",
            type: "sky",
            paint: {
              "sky-type": "atmosphere",
              "sky-atmosphere-sun": [solar.azimuth, Math.max(-10, solar.altitude)],
              "sky-atmosphere-sun-intensity": solar.isDaytime
                ? Math.min(18, 4 + solar.altitude * 0.25) : 0.5,
            },
          });
        }
      }

      const geojsonData: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { apn },
          geometry: boundary as GeoJSON.Geometry,
        }],
      };

      mapInstance.addSource("property", {
        type: "geojson",
        data: geojsonData,
      });

      // Elegant parcel fill — semi-transparent primary color
      mapInstance.addLayer({
        id: "property-fill",
        type: "fill",
        source: "property",
        paint: {
          "fill-color": "#22c55e",
          "fill-opacity": 0.18,
        },
      });

      // Sharp animated outline
      mapInstance.addLayer({
        id: "property-outline",
        type: "line",
        source: "property",
        paint: {
          "line-color": "#22c55e",
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            10, 1.5,
            16, 3,
            20, 5,
          ],
          "line-opacity": 0.9,
        },
      });

      // Inner glow for depth
      mapInstance.addLayer({
        id: "property-fill-glow",
        type: "line",
        source: "property",
        paint: {
          "line-color": "#4ade80",
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            10, 3,
            16, 8,
          ],
          "line-opacity": 0.15,
          "line-blur": 4,
        },
      });

      // Smooth fly-in to fit parcel
      try {
        mapInstance.fitBounds(bounds as mapboxgl.LngLatBoundsLike, {
          padding: { top: 60, bottom: 60, left: 60, right: 60 },
          pitch: enable3DTerrain ? 50 : 0,
          bearing: -15,
          duration: 1200,
          maxZoom: 18,
        });
      } catch { /* bounds may be degenerate */ }

      mapInstance.addControl(new mapboxgl.NavigationControl(), "top-right");

      // Fetch and display nearby parcels
      if (showNearbyParcels && state && county) {
        fetch(`/api/parcels/nearby?lat=${centroid.lat}&lng=${centroid.lng}&state=${state}&county=${encodeURIComponent(county)}&radius=0.25`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (!data?.parcels || !mapInstance) return;
            const filtered = data.parcels.filter((p: NearbyParcel) => p.apn !== apn);
            if (filtered.length === 0) return;

            const nearbyGeojson: GeoJSON.FeatureCollection = {
              type: "FeatureCollection",
              features: filtered.map((p: NearbyParcel) => ({
                type: "Feature" as const,
                properties: { apn: p.apn },
                geometry: p.boundary,
              })),
            };

            if (!mapInstance.getSource("nearby-parcels")) {
              mapInstance.addSource("nearby-parcels", {
                type: "geojson",
                data: nearbyGeojson,
              });

              mapInstance.addLayer({
                id: "nearby-parcels-outline",
                type: "line",
                source: "nearby-parcels",
                paint: {
                  "line-color": "#fbbf24",
                  "line-width": 2,
                  "line-opacity": 0.8,
                },
              }, "property-fill");
            }
          })
          .catch(() => {});
      }
    };

    mapInstance.once("load", () => { addLayers(); });
    mapInstance.once("idle", () => { if (!layersAdded) addLayers(); });

    const timeoutId = setTimeout(() => {
      if (!layersAdded && mapInstance) addLayers();
    }, 2000);

    return () => {
      clearTimeout(timeoutId);
      map.current?.remove();
    };
  }, [boundary, centroid, apn, enable3DTerrain, state, county, showNearbyParcels]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center bg-muted/30 rounded-md" style={{ height }}>
        <div className="text-center text-muted-foreground p-4">
          <MapPin className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-xs">Configure Mapbox token</p>
        </div>
      </div>
    );
  }

  if (!boundary || !centroid) {
    return (
      <div className="flex items-center justify-center bg-muted/30 rounded-md" style={{ height }}>
        <div className="text-center text-muted-foreground p-4">
          <MapPin className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No map data</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={mapContainer} 
      className="w-full h-full rounded-md overflow-hidden" 
      style={{ height }}
      data-testid="single-property-map"
    />
  );
}

interface StaticPropertyMapProps {
  boundary: {
    type: string;
    coordinates: number[][][];
  };
  centroid: { lat: number; lng: number };
  height?: string;
  width?: number;
  className?: string;
  onClick?: () => void;
}

export function StaticPropertyMap({ 
  boundary, 
  centroid, 
  height = "200px",
  width = 400,
  className = "",
  onClick
}: StaticPropertyMapProps) {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  if (!MAPBOX_TOKEN) {
    return (
      <div className={cn("flex items-center justify-center bg-muted/30 rounded-md", className)} style={{ height }}>
        <div className="text-center text-muted-foreground p-4">
          <MapPin className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-xs">Configure Mapbox token</p>
        </div>
      </div>
    );
  }

  if (!boundary || !centroid) {
    return (
      <div className={cn("flex items-center justify-center bg-muted/30 rounded-md", className)} style={{ height }}>
        <div className="text-center text-muted-foreground p-4">
          <MapPin className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No map data</p>
        </div>
      </div>
    );
  }

  // Simplify coordinates for URL (take every Nth point to reduce URL length)
  const simplifyCoordinates = (coords: number[][], maxPoints: number = 50): number[][] => {
    if (coords.length <= maxPoints) return coords;
    const step = Math.ceil(coords.length / maxPoints);
    const simplified = coords.filter((_, i) => i % step === 0);
    // Ensure the polygon is closed
    if (simplified.length > 0 && 
        (simplified[0][0] !== simplified[simplified.length - 1][0] || 
         simplified[0][1] !== simplified[simplified.length - 1][1])) {
      simplified.push(simplified[0]);
    }
    return simplified;
  };

  // Build path overlay for the boundary (using Mapbox path syntax)
  // Format: path-{strokeWidth}+{strokeColor}-{fillOpacity}+{fillColor}({coordinates})
  const coords = boundary.coordinates[0] || [];
  const simplifiedCoords = simplifyCoordinates(coords);
  
  // Create a path string: lng,lat,lng,lat,...
  const pathCoords = simplifiedCoords.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(',');
  
  // Use GeoJSON overlay for more accurate rendering
  const geojsonOverlay = {
    type: "Feature",
    properties: {
      "stroke": "#ef4444",
      "stroke-width": 3,
      "stroke-opacity": 1,
      "fill": "#22c55e",
      "fill-opacity": 0.4
    },
    geometry: {
      type: "Polygon",
      coordinates: [simplifiedCoords]
    }
  };

  // URL-encode the GeoJSON
  const encodedGeojson = encodeURIComponent(JSON.stringify(geojsonOverlay));

  // Calculate dimensions (Mapbox Static API has limits)
  const pixelHeight = parseInt(height) || 200;
  const pixelWidth = Math.min(width, 1280); // Max 1280px
  const safeHeight = Math.min(pixelHeight, 1280);

  // Build the static map URL with auto-fitting and more padding for zoomed-out view
  const staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/geojson(${encodedGeojson})/auto/${pixelWidth}x${safeHeight}@2x?access_token=${MAPBOX_TOKEN}&padding=60`;

  // Fallback URL without GeoJSON overlay (just satellite view centered on property)
  const fallbackUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${centroid.lng},${centroid.lat},16/${pixelWidth}x${safeHeight}@2x?access_token=${MAPBOX_TOKEN}`;

  if (imageError) {
    return (
      <div 
        className={cn("relative overflow-hidden rounded-md cursor-pointer", className)} 
        style={{ height }}
        onClick={onClick}
        data-testid="static-property-map-fallback"
      >
        <img 
          src={fallbackUrl}
          alt="Property satellite view"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <Badge variant="secondary" className="text-xs">
            <MapPin className="h-3 w-3 mr-1" />
            View Details
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={cn("relative overflow-hidden rounded-md", onClick ? "cursor-pointer hover:opacity-95 transition-opacity" : "", className)} 
      style={{ height }}
      onClick={onClick}
      data-testid="static-property-map"
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <img 
        src={staticMapUrl}
        alt="Property boundary map"
        className="w-full h-full object-cover"
        loading="lazy"
        onLoad={() => setIsLoading(false)}
        onError={() => {
          console.warn("[StaticPropertyMap] Failed to load static map with overlay, using fallback");
          setImageError(true);
          setIsLoading(false);
        }}
      />
    </div>
  );
}

export default PropertyMap;
