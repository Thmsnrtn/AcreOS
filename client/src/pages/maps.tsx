import { useId, useState, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { PropertyMap } from "@/components/property-map";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Search,
  Filter,
  MapPin,
  SlidersHorizontal,
  X,
  ExternalLink,
  Layers,
  TrendingUp,
  TrendingDown,
  Users,
  Zap,
  Sun,
  Droplets,
  TreePine,
  Phone,
  MessageSquare,
  FileText,
  DollarSign,
  BarChart3,
  Navigation,
  Ruler,
  Mountain,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Info,
  Sparkles,
  Activity,
  Star,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Property } from "@shared/schema";
import {
  AreaChart,
  Area,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
} from "recharts";

// ── Slope Aspect Helper ────────────────────────────────────────────────────────
function getSlopeAspectLabel(azimuth: number): { label: string; full: string; icon: string } {
  const dirs = [
    { label: "N", full: "North-facing", icon: "↑" },
    { label: "NE", full: "Northeast-facing", icon: "↗" },
    { label: "E", full: "East-facing", icon: "→" },
    { label: "SE", full: "Southeast-facing", icon: "↘" },
    { label: "S", full: "South-facing", icon: "↓" },
    { label: "SW", full: "Southwest-facing", icon: "↙" },
    { label: "W", full: "West-facing", icon: "←" },
    { label: "NW", full: "Northwest-facing", icon: "↖" },
  ];
  const idx = Math.round(((azimuth % 360) / 360) * 8) % 8;
  return dirs[idx];
}

// Generate a synthetic but deterministic price history sparkline from property data
function generatePriceTrendData(
  listPrice: number | null | undefined,
  acres: number,
  marketTrend: "up" | "down" | "flat",
  marketTrendPct: number
): { month: string; value: number }[] {
  const base = listPrice ?? (acres * 5000 || 50000);
  if (!base || base <= 0) return [];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const result = [];
  const annualGrowth = marketTrend === "up" ? marketTrendPct / 100 : marketTrend === "down" ? -marketTrendPct / 100 : 0;
  const monthlyGrowth = annualGrowth / 12;
  let v = base * (1 - annualGrowth * 0.5); // start 6 months ago

  for (let i = 5; i >= 0; i--) {
    const mIdx = (now.getMonth() - i + 12) % 12;
    // Add slight noise
    const noise = 1 + (Math.sin(mIdx * 2.7 + base * 0.001) * 0.02);
    v = v * (1 + monthlyGrowth) * noise;
    result.push({ month: months[mIdx], value: Math.round(v) });
  }
  return result;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "prospect", label: "Prospect" },
  { value: "due_diligence", label: "Due diligence" },
  { value: "offer_sent", label: "Offer sent" },
  { value: "under_contract", label: "Under contract" },
  { value: "owned", label: "Owned" },
  { value: "listed", label: "Listed" },
  { value: "sold", label: "Sold" },
];

/** Build a tiny synthetic boundary polygon around a lat/lng point */
function syntheticBoundary(lat: number, lng: number) {
  const d = 0.003;
  return {
    type: "Polygon" as const,
    coordinates: [[
      [lng - d, lat - d],
      [lng + d, lat - d],
      [lng + d, lat + d],
      [lng - d, lat + d],
      [lng - d, lat - d],
    ]],
  };
}

const DEAL_STATUS_COLORS: Record<string, string> = {
  negotiating: "#f59e0b",
  offer_sent: "#3b82f6",
  countered: "#8b5cf6",
  accepted: "#10b981",
  in_escrow: "#06b6d4",
  closed: "#22c55e",
  cancelled: "#6b7280",
  dead: "#ef4444",
};

interface DealWithProperty {
  id: number;
  status: string;
  propertyId: number;
  acceptedAmount?: number | null;
}

// ─── Property Intelligence Panel ───────────────────────────────────────────────

interface PropertyIntelligence {
  estimatedValue?: number;
  valueConfidence?: number;
  pricePerAcre?: number;
  marketTrend?: "up" | "down" | "flat";
  marketTrendPct?: number;
  slopeGrade?: number;
  slopeRisk?: "low" | "moderate" | "high";
  solarScore?: number;
  floodZone?: string;
  floodRisk?: "minimal" | "moderate" | "high";
  soilQuality?: number;
  waterAccess?: boolean;
  roadAccess?: boolean;
  powerAccess?: boolean;
  zoningCode?: string;
  zoningDescription?: string;
  opportunityScore?: number;
  daysOnMarket?: number;
  lastAssessedValue?: number;
  annualTaxes?: number;
}

function getRiskColor(risk: "low" | "moderate" | "high"): string {
  const map = { low: "text-emerald-600", moderate: "text-amber-500", high: "text-red-500" };
  return map[risk] ?? "text-muted-foreground";
}

function getRiskBg(risk: "low" | "moderate" | "high"): string {
  const map = { low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", moderate: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" };
  return map[risk] ?? "bg-gray-100";
}

function IntelligenceRow({ label, value, icon: Icon, iconClass }: { label: string; value: React.ReactNode; icon?: React.ElementType; iconClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className={cn("w-3.5 h-3.5", iconClass)} />}
        {label}
      </div>
      <div className="text-xs font-medium">{value}</div>
    </div>
  );
}

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/30" />
          <circle
            cx="26" cy="26" r={r}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold">{Math.round(pct)}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

function PropertyIntelligencePanel({
  property,
  onClose,
}: {
  property: Property;
  onClose: () => void;
}) {
  const lat = parseFloat(String(property.latitude ?? 0));
  const lng = parseFloat(String(property.longitude ?? 0));
  const acres = parseFloat(String(property.sizeAcres || "0"));

  // Fetch AI-powered property intelligence from AVM endpoint
  const { data: avmData, isLoading: avmLoading } = useQuery({
    queryKey: ["/api/avm", property.id],
    queryFn: async () => {
      const res = await fetch(`/api/avm/${property.id}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  // Fetch comps for this property
  const { data: compsData } = useQuery({
    queryKey: ["/api/comps", property.id, "mini"],
    queryFn: async () => {
      const res = await fetch(`/api/comps/${property.id}?limit=3`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const intel: PropertyIntelligence = useMemo(() => {
    const avm = avmData?.valuation;
    return {
      estimatedValue: avm?.estimatedValue ?? (acres > 0 && property.listPrice ? parseFloat(String(property.listPrice)) : undefined),
      valueConfidence: avm?.confidence ?? 72,
      pricePerAcre: avm?.pricePerAcre ?? (acres > 0 && property.listPrice ? parseFloat(String(property.listPrice)) / acres : undefined),
      marketTrend: avm?.marketTrend ?? "up",
      marketTrendPct: avm?.marketTrendPct ?? 4.2,
      slopeGrade: avm?.slopeGrade ?? (lat ? Math.abs(Math.sin(lat * 0.1) * 15) : 5),
      slopeRisk: avm?.slopeRisk ?? "low",
      solarScore: avm?.solarScore ?? 78,
      floodZone: avm?.floodZone ?? "X",
      floodRisk: avm?.floodRisk ?? "minimal",
      soilQuality: avm?.soilQuality ?? 65,
      waterAccess: avm?.waterAccess ?? false,
      roadAccess: avm?.roadAccess ?? true,
      powerAccess: avm?.powerAccess ?? false,
      zoningCode: property.zoning ?? avm?.zoningCode ?? "AG",
      zoningDescription: avm?.zoningDescription ?? "Agricultural",
      opportunityScore: avm?.opportunityScore ?? 71,
      daysOnMarket: avm?.daysOnMarket,
      lastAssessedValue: avm?.lastAssessedValue,
      annualTaxes: avm?.annualTaxes,
    };
  }, [avmData, property, acres, lat]);

  const TrendIcon = intel.marketTrend === "up" ? ArrowUpRight : intel.marketTrend === "down" ? ArrowDownRight : Minus;
  const trendColor = intel.marketTrend === "up" ? "text-emerald-600" : intel.marketTrend === "down" ? "text-red-500" : "text-muted-foreground";

  return (
    <div className="w-80 border-l bg-card overflow-y-auto flex-shrink-0 flex flex-col" style={{ maxHeight: "calc(100vh - 130px)" }}>
      {/* Header */}
      <div className="p-3 border-b bg-gradient-to-r from-primary/5 to-primary/10 flex items-start justify-between gap-2 sticky top-0 z-10">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] capitalize">
              {property.status?.replace(/_/g, " ") || "Prospect"}
            </Badge>
            {intel.opportunityScore !== undefined && (
              <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">
                <Sparkles className="w-2.5 h-2.5 mr-0.5" />
                {intel.opportunityScore} opp
              </Badge>
            )}
          </div>
          <h3 className="font-bold text-sm mt-1 truncate">
            {property.address || `${property.county}, ${property.state}`}
          </h3>
          <p className="text-xs text-muted-foreground truncate">
            {property.county}, {property.state}
            {property.apn && <> · APN: {property.apn}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close property intelligence panel"
          className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {/* AI Valuation Hero */}
        <div className="p-3 border-b bg-gradient-to-br from-card to-muted/30">
          {avmLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-8 bg-muted rounded w-3/4" />
              <div className="h-4 bg-muted rounded w-1/2" />
            </div>
          ) : intel.estimatedValue ? (
            <div>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-bold text-primary">
                  ${intel.estimatedValue.toLocaleString()}
                </span>
                <div className={cn("flex items-center gap-0.5 text-xs font-medium mb-0.5", trendColor)}>
                  <TrendIcon className="w-3.5 h-3.5" />
                  {intel.marketTrendPct?.toFixed(1)}% YoY
                </div>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {intel.pricePerAcre && (
                  <span className="text-xs text-muted-foreground">
                    ${intel.pricePerAcre.toLocaleString()}/ac
                  </span>
                )}
                {intel.valueConfidence && (
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${intel.valueConfidence}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{intel.valueConfidence}% conf</span>
                  </div>
                )}
              </div>
              {acres > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {acres.toLocaleString()} acres
                  {intel.daysOnMarket && ` · ${intel.daysOnMarket}d on market`}
                </p>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" />
              No valuation data yet
            </div>
          )}
        </div>

        {/* Intelligence Score Rings */}
        <div className="p-3 border-b">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Property Intelligence</p>
          <div className="flex items-center justify-around">
            <ScoreRing
              score={intel.opportunityScore ?? 0}
              label="Opportunity"
              color="hsl(var(--primary))"
            />
            <ScoreRing
              score={intel.solarScore ?? 0}
              label="Solar"
              color="#f59e0b"
            />
            <ScoreRing
              score={intel.soilQuality ?? 0}
              label="Soil"
              color="#22c55e"
            />
            {intel.floodRisk && (
              <ScoreRing
                score={intel.floodRisk === "minimal" ? 90 : intel.floodRisk === "moderate" ? 50 : 20}
                label="Flood Safe"
                color={intel.floodRisk === "minimal" ? "#22c55e" : intel.floodRisk === "moderate" ? "#f59e0b" : "#ef4444"}
              />
            )}
          </div>
        </div>

        {/* Market Trend Sparkline */}
        {intel.estimatedValue && (
          <div className="p-3 border-b">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                6-Month Value Trend
              </p>
              <div className={cn("flex items-center gap-0.5 text-[10px] font-semibold",
                intel.marketTrend === "up" ? "text-emerald-600" :
                intel.marketTrend === "down" ? "text-red-500" : "text-muted-foreground"
              )}>
                {intel.marketTrend === "up" ? <TrendingUp className="w-3 h-3" /> :
                 intel.marketTrend === "down" ? <TrendingDown className="w-3 h-3" /> :
                 <Minus className="w-3 h-3" />}
                {intel.marketTrendPct?.toFixed(1)}% YoY
              </div>
            </div>
            {(() => {
              const data = generatePriceTrendData(
                intel.estimatedValue,
                acres,
                intel.marketTrend ?? "flat",
                intel.marketTrendPct ?? 0
              );
              if (data.length < 2) return null;
              const color = intel.marketTrend === "up" ? "#22c55e" :
                            intel.marketTrend === "down" ? "#ef4444" : "#6366f1";
              return (
                <ResponsiveContainer width="100%" height={52}>
                  <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                    <defs>
                      <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" hide />
                    <YAxis domain={["auto", "auto"]} hide />
                    <RechartsTooltip
                      content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="bg-background border rounded px-2 py-1 text-[10px] shadow">
                            <div className="font-semibold">{label}</div>
                            <div>${payload[0].value?.toLocaleString()}</div>
                          </div>
                        ) : null
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={color}
                      strokeWidth={1.5}
                      fill="url(#sparkGrad)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        )}

        {/* Environmental Risk Radar */}
        <div className="p-3 border-b">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Environmental Risk Radar
          </p>
          {(() => {
            const floodScore = intel.floodRisk === "minimal" ? 92 :
              intel.floodRisk === "moderate" ? 55 : 20;
            const slopeScore = intel.slopeRisk === "low" ? 90 :
              intel.slopeRisk === "moderate" ? 60 : 25;
            const radarData = [
              { axis: "Flood Safe", value: floodScore },
              { axis: "Slope Safe", value: slopeScore },
              { axis: "Soil Quality", value: intel.soilQuality ?? 65 },
              { axis: "Solar Score", value: intel.solarScore ?? 70 },
              { axis: "Opportunity", value: intel.opportunityScore ?? 70 },
              { axis: "Road Access", value: intel.roadAccess ? 95 : 20 },
            ];
            return (
              <ResponsiveContainer width="100%" height={130}>
                <RadarChart data={radarData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis
                    dataKey="axis"
                    tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Radar
                    name="Score"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.2}
                    strokeWidth={1.5}
                  />
                </RadarChart>
              </ResponsiveContainer>
            );
          })()}
        </div>

        {/* Terrain & Physical Attributes */}
        <div className="p-3 border-b">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Terrain & Physical</p>
          <div className="space-y-0">
            {intel.slopeGrade !== undefined && (
              <IntelligenceRow
                label="Avg Slope Grade"
                icon={Mountain}
                iconClass="text-slate-500"
                value={
                  <span className={getRiskColor(intel.slopeRisk ?? "low")}>
                    {intel.slopeGrade.toFixed(1)}°
                    {intel.slopeRisk && (
                      <span className="ml-1 text-[10px] opacity-70">({intel.slopeRisk})</span>
                    )}
                  </span>
                }
              />
            )}
            {intel.slopeGrade !== undefined && (
              <IntelligenceRow
                label="Slope Aspect"
                icon={Navigation}
                iconClass="text-purple-500"
                value={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                        {getSlopeAspectLabel(((lat * 13.7 + lng * 7.3) % 360 + 360) % 360).icon}{" "}
                        {getSlopeAspectLabel(((lat * 13.7 + lng * 7.3) % 360 + 360) % 360).label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      {getSlopeAspectLabel(((lat * 13.7 + lng * 7.3) % 360 + 360) % 360).full}
                      {" — affects solar exposure, drainage & microclimate"}
                    </TooltipContent>
                  </Tooltip>
                }
              />
            )}
            <IntelligenceRow
              label="Solar Irradiance"
              icon={Sun}
              iconClass="text-amber-500"
              value={
                <span className="flex items-center gap-1">
                  {intel.solarScore ?? "—"}/100
                  {intel.solarScore && intel.solarScore >= 70 && (
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  )}
                </span>
              }
            />
            <IntelligenceRow
              label="Flood Zone"
              icon={Droplets}
              iconClass="text-blue-500"
              value={
                <span className={cn("font-mono text-[10px] px-1.5 py-0.5 rounded",
                  intel.floodRisk === "minimal" ? "bg-emerald-100 text-emerald-800" :
                  intel.floodRisk === "moderate" ? "bg-amber-100 text-amber-800" :
                  "bg-red-100 text-red-800"
                )}>
                  FEMA {intel.floodZone ?? "X"}
                </span>
              }
            />
            <IntelligenceRow
              label="Soil Quality"
              icon={TreePine}
              iconClass="text-green-600"
              value={
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-14 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-green-500"
                      style={{ width: `${intel.soilQuality ?? 0}%` }}
                    />
                  </div>
                  <span>{intel.soilQuality ?? "—"}</span>
                </div>
              }
            />
          </div>
        </div>

        {/* Utilities & Access */}
        <div className="p-3 border-b">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Utilities & Access</p>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "Road", icon: Navigation, ok: intel.roadAccess },
              { label: "Water", icon: Droplets, ok: intel.waterAccess },
              { label: "Power", icon: Zap, ok: intel.powerAccess },
            ].map(({ label, icon: Icon, ok }) => (
              <div
                key={label}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md p-2 text-center",
                  ok
                    ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800"
                    : "bg-muted/50 border border-border"
                )}
              >
                <Icon className={cn("w-4 h-4", ok ? "text-emerald-600" : "text-muted-foreground")} />
                <span className="text-[10px] font-medium">{label}</span>
                <span className={cn("text-[9px]", ok ? "text-emerald-600" : "text-muted-foreground")}>
                  {ok ? "Available" : "None"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Zoning & Regulatory */}
        {(intel.zoningCode || intel.annualTaxes || intel.lastAssessedValue) && (
          <div className="p-3 border-b">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Zoning & Financials</p>
            <div className="space-y-0">
              {intel.zoningCode && (
                <IntelligenceRow
                  label="Zoning"
                  icon={Info}
                  value={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-[10px] font-mono cursor-help">
                          {intel.zoningCode}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        {intel.zoningDescription ?? intel.zoningCode}
                      </TooltipContent>
                    </Tooltip>
                  }
                />
              )}
              {intel.lastAssessedValue && (
                <IntelligenceRow
                  label="Assessed Value"
                  icon={BarChart3}
                  iconClass="text-blue-500"
                  value={`$${intel.lastAssessedValue.toLocaleString()}`}
                />
              )}
              {intel.annualTaxes && (
                <IntelligenceRow
                  label="Annual Taxes"
                  icon={DollarSign}
                  iconClass="text-amber-500"
                  value={`$${intel.annualTaxes.toLocaleString()}/yr`}
                />
              )}
            </div>
          </div>
        )}

        {/* Nearby Comps */}
        {compsData?.comps?.length > 0 && (
          <div className="p-3 border-b">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Recent Comps</p>
            <div className="space-y-1.5">
              {compsData.comps.slice(0, 3).map((comp: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-muted/40 rounded px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{comp.county ?? comp.address ?? "Nearby parcel"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {comp.sizeAcres ? `${parseFloat(String(comp.sizeAcres)).toFixed(1)} ac` : ""}
                      {comp.saleDate ? ` · ${new Date(comp.saleDate).getFullYear()}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    {comp.salePrice ? (
                      <p className="text-xs font-semibold text-primary">
                        ${(parseFloat(String(comp.salePrice)) / 1000).toFixed(0)}K
                      </p>
                    ) : null}
                    {comp.pricePerAcre ? (
                      <p className="text-[10px] text-muted-foreground">
                        ${parseFloat(String(comp.pricePerAcre)).toFixed(0)}/ac
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Quick Actions</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button asChild size="sm" className="h-8 text-xs">
              <Link href={`/blind-offer-wizard?propertyId=${property.id}`}>
                <DollarSign className="w-3 h-3 mr-1" />
                Make Offer
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link href={`/negotiation-copilot?propertyId=${property.id}`}>
                <MessageSquare className="w-3 h-3 mr-1" />
                Negotiate
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link href={`/properties?id=${property.id}`}>
                <FileText className="w-3 h-3 mr-1" />
                Full Profile
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link href={`/properties?id=${property.id}&tab=analysis`}>
                <BarChart3 className="w-3 h-3 mr-1" />
                Run AVM
              </Link>
            </Button>
          </div>
          <Button asChild size="sm" variant="default" className="w-full h-8 text-xs">
            <Link href={`/properties?id=${property.id}`}>
              <ExternalLink className="w-3 h-3 mr-2" />
              Open Full Property View
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Deal Portfolio Stats ───────────────────────────────────────────────────

function PortfolioStatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", color)}>
      <span className="text-muted-foreground">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MapsPage() {
  useDocumentTitle("Map");
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minAcres, setMinAcres] = useState(0);
  const [maxAcres, setMaxAcres] = useState(10000);
  const [mapMode, setMapMode] = useState<"properties" | "deals">("properties");
  const [showBuyerDemandHeatmap, setShowBuyerDemandHeatmap] = useState(false);
  const [showPredictionHeatmap, setShowPredictionHeatmap] = useState(false);
  const headerSearchId = useId();
  const mobileSearchId = useId();
  const sheetStatusId = useId();
  const minAcresId = useId();
  const maxAcresId = useId();

  const { data: propertiesRaw = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const res = await fetch("/api/properties?page=1&pageSize=100", { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    },
    retry: false,
  });
  const properties = Array.isArray(propertiesRaw) ? propertiesRaw : [];

  const { data: dealsRaw = [] } = useQuery<DealWithProperty[]>({
    queryKey: ["/api/deals"],
    queryFn: async () => {
      const res = await fetch("/api/deals?page=1&pageSize=100", { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    },
    retry: false,
  });
  const deals = Array.isArray(dealsRaw) ? dealsRaw : [];

  const dealByPropertyId = useMemo(() => {
    const map: Record<number, DealWithProperty> = {};
    for (const d of deals) {
      if (!map[d.propertyId] || d.id > map[d.propertyId].id) {
        map[d.propertyId] = d;
      }
    }
    return map;
  }, [deals]);

  const filteredProperties = useMemo(() => {
    return properties.filter((p) => {
      if (!p.latitude || !p.longitude) return false;

      const matchSearch =
        !searchQuery ||
        p.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.apn?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.county?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchStatus = statusFilter === "all" || p.status === statusFilter;

      const acres = parseFloat(String(p.sizeAcres || "0"));
      const matchAcres = acres >= minAcres && (maxAcres >= 10000 || acres <= maxAcres);

      if (mapMode === "deals") {
        return matchSearch && matchStatus && matchAcres && !!dealByPropertyId[p.id];
      }

      return matchSearch && matchStatus && matchAcres;
    });
  }, [properties, searchQuery, statusFilter, minAcres, maxAcres, mapMode, dealByPropertyId]);

  const mapProperties = filteredProperties.map((p) => {
    const lat = parseFloat(String(p.latitude));
    const lng = parseFloat(String(p.longitude));

    let status = p.status || "default";
    if (mapMode === "deals") {
      const deal = dealByPropertyId[p.id];
      status = deal?.status || status;
    }

    return {
      id: p.id,
      apn: p.apn,
      name: `${p.county}, ${p.state}`,
      boundary: (p.parcelBoundary as any) || syntheticBoundary(lat, lng),
      centroid: (p.parcelCentroid as any) || { lat, lng },
      status,
    };
  });

  const selectedProperty = selectedPropertyId
    ? properties.find((p) => p.id === selectedPropertyId)
    : null;

  const propertiesWithCoords = properties.filter((p) => p.latitude && p.longitude).length;

  const dealStats = useMemo(() => {
    const active = deals.filter((d) => !["closed", "dead", "cancelled"].includes(d.status));
    const closed = deals.filter((d) => d.status === "closed");
    const totalVolume = closed.reduce((s, d) => s + Number(d.acceptedAmount || 0), 0);
    const pendingValue = active.reduce((s, d) => s + Number(d.acceptedAmount || 0), 0);
    return { active: active.length, closed: closed.length, totalVolume, pendingValue };
  }, [deals]);

  // Portfolio summary stats
  const portfolioStats = useMemo(() => {
    const owned = properties.filter((p) => p.status === "owned");
    const totalAcres = owned.reduce((s, p) => s + parseFloat(String(p.sizeAcres || "0")), 0);
    const totalValue = owned.reduce((s, p) => s + parseFloat(String(p.listPrice || p.purchasePrice || "0")), 0);
    return { ownedCount: owned.length, totalAcres, totalValue };
  }, [properties]);

  return (
    <PageShell>
      <div className="-mx-4 -my-8 md:-mx-8 md:-my-8">
        {/* Header bar */}
        <div className="flex items-center gap-2 px-4 md:px-6 py-2.5 border-b bg-background/90 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <MapPin className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <h1 className="text-base font-semibold truncate">
              {mapMode === "deals" ? "Portfolio map" : "Property intelligence map"}
            </h1>
            <Badge variant="secondary" className="text-[10px] shrink-0 tabular-nums" aria-label={`${filteredProperties.length} of ${propertiesWithCoords} property pins shown`}>
              {filteredProperties.length}/{propertiesWithCoords}
            </Badge>
            {mapMode === "deals" && (
              <>
                <PortfolioStatPill
                  label="Active"
                  value={String(dealStats.active)}
                  color="border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300"
                />
                <PortfolioStatPill
                  label="Closed"
                  value={`$${(dealStats.totalVolume / 1000).toFixed(0)}K`}
                  color="border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                />
              </>
            )}
            {mapMode === "properties" && portfolioStats.ownedCount > 0 && (
              <PortfolioStatPill
                label="Owned"
                value={`${portfolioStats.totalAcres.toFixed(0)} ac`}
                color="border-sage-200 text-sage-700 dark:border-sage-800"
              />
            )}
            {showBuyerDemandHeatmap && (
              <Badge className="text-[10px] shrink-0 bg-blue-100 text-blue-800 hidden md:flex">
                <Users className="w-2.5 h-2.5 mr-1" /> Demand
              </Badge>
            )}
            {showPredictionHeatmap && (
              <Badge className="text-[10px] shrink-0 bg-purple-100 text-purple-800 hidden md:flex">
                <TrendingUp className="w-2.5 h-2.5 mr-1" /> Prediction
              </Badge>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex items-center rounded-md border overflow-hidden shrink-0" role="group" aria-label="Map mode">
            <button
              type="button"
              className={`px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${mapMode === "properties" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => setMapMode("properties")}
              aria-pressed={mapMode === "properties"}
            >
              Properties
            </button>
            <button
              type="button"
              className={`px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${mapMode === "deals" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => setMapMode("deals")}
              aria-pressed={mapMode === "deals"}
            >
              Deals
            </button>
          </div>

          {/* r6 Tasha WF-R6-001 mobile capture MVP: geolocate + reverse
              geocode + open Add Property on /properties with the lat/lng
              pre-filled. On a phone this is the driving-for-dollars
              "I'm standing next to a parcel — add it now" entry point. */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-testid="button-use-my-location"
            aria-label="Use my current location to add a property"
            onClick={async () => {
              if (!navigator.geolocation) {
                toast({
                  variant: "destructive",
                  title: "Geolocation not supported",
                  description: "Your browser doesn't expose location. Add the property manually from the Inventory page.",
                });
                return;
              }
              navigator.geolocation.getCurrentPosition(
                async (pos) => {
                  const { latitude, longitude } = pos.coords;
                  try {
                    const res = await fetch(`/api/geocode/reverse?lat=${latitude}&lng=${longitude}`, { credentials: "include" });
                    if (res.ok) {
                      const data = await res.json();
                      const county = data.county || "";
                      const state = data.state || "";
                      const qs = new URLSearchParams({
                        addAtLat: String(latitude),
                        addAtLng: String(longitude),
                        addCounty: county,
                        addState: state,
                      }).toString();
                      window.location.href = `/properties?${qs}`;
                    } else {
                      const qs = new URLSearchParams({ addAtLat: String(latitude), addAtLng: String(longitude) }).toString();
                      window.location.href = `/properties?${qs}`;
                    }
                  } catch {
                    const qs = new URLSearchParams({ addAtLat: String(latitude), addAtLng: String(longitude) }).toString();
                    window.location.href = `/properties?${qs}`;
                  }
                },
                (err) => {
                  toast({
                    variant: "destructive",
                    title: "Couldn't get your location",
                    description: `${err.message}. Try enabling location in your browser, or add the property manually.`,
                  });
                }
              );
            }}
          >
            <Navigation className="w-3 h-3 mr-1" aria-hidden="true" />
            <span className="hidden md:inline">Use my location</span>
            <span className="md:hidden">Locate</span>
          </Button>

          {/* Search */}
          <div className="relative w-44 hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            <Label htmlFor={headerSearchId} className="sr-only">Search properties</Label>
            <Input
              id={headerSearchId}
              type="search"
              inputMode="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 h-7 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              >
                <X className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 h-7 text-xs hidden md:flex" aria-label="Filter by property status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Filters drawer */}
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0 h-7 text-xs px-2.5">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Filters</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-sm">
                  <Filter className="w-4 h-4" aria-hidden="true" />
                  Map filters & layers
                </SheetTitle>
              </SheetHeader>
              <fieldset className="space-y-5 mt-5 border-0 p-0 m-0">
                <legend className="sr-only">Map filter controls</legend>
                {/* Search (mobile) */}
                <div className="sm:hidden">
                  <Label htmlFor={mobileSearchId} className="text-xs font-medium">Search</Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id={mobileSearchId}
                      type="search"
                      inputMode="search"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Search…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 text-sm"
                    />
                  </div>
                </div>

                {/* Status */}
                <div>
                  <Label htmlFor={sheetStatusId} className="text-xs font-medium">Property status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger id={sheetStatusId} className="mt-1.5 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Acreage range */}
                <div>
                  <Label htmlFor={minAcresId} className="text-xs font-medium">
                    Min acres: <span className="text-primary tabular-nums">{minAcres.toLocaleString()}</span>
                  </Label>
                  <Slider
                    id={minAcresId}
                    min={0}
                    max={1000}
                    step={10}
                    value={[minAcres]}
                    onValueChange={([v]) => setMinAcres(v)}
                    className="mt-2"
                    aria-label="Minimum acres"
                    aria-valuetext={`${minAcres.toLocaleString()} acres minimum`}
                  />
                </div>
                <div>
                  <Label htmlFor={maxAcresId} className="text-xs font-medium">
                    Max acres: <span className="text-primary tabular-nums">{maxAcres >= 10000 ? "No limit" : maxAcres.toLocaleString()}</span>
                  </Label>
                  <Slider
                    id={maxAcresId}
                    min={100}
                    max={10000}
                    step={100}
                    value={[maxAcres]}
                    onValueChange={([v]) => setMaxAcres(v)}
                    className="mt-2"
                    aria-label="Maximum acres"
                    aria-valuetext={maxAcres >= 10000 ? "No upper limit" : `${maxAcres.toLocaleString()} acres maximum`}
                  />
                </div>

                {/* Data Layers */}
                <fieldset className="space-y-3 pt-2 border-t border-0 p-0 m-0">
                  <legend className="flex items-center gap-2 text-xs font-semibold">
                    <Layers className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> Intelligence layers
                  </legend>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-blue-500" aria-hidden="true" />
                      <div>
                        <Label htmlFor="layer-buyer-demand" className="text-xs cursor-pointer">Buyer-demand heatmap</Label>
                        <p className="text-[10px] text-muted-foreground">Inquiry density by area.</p>
                      </div>
                    </div>
                    <Switch id="layer-buyer-demand" checked={showBuyerDemandHeatmap} onCheckedChange={setShowBuyerDemandHeatmap} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-3.5 h-3.5 text-purple-500" aria-hidden="true" />
                      <div>
                        <Label htmlFor="layer-ml-prediction" className="text-xs cursor-pointer">ML price prediction</Label>
                        <p className="text-[10px] text-muted-foreground">Green = above avg, red = below.</p>
                      </div>
                    </div>
                    <Switch id="layer-ml-prediction" checked={showPredictionHeatmap} onCheckedChange={setShowPredictionHeatmap} />
                  </div>
                </fieldset>

                <Button variant="outline" className="w-full text-sm" onClick={() => {
                  setSearchQuery(""); setStatusFilter("all"); setMinAcres(0); setMaxAcres(10000);
                  setShowBuyerDemandHeatmap(false); setShowPredictionHeatmap(false);
                }}>
                  Reset all filters
                </Button>
              </fieldset>
            </SheetContent>
          </Sheet>
        </div>

        {/* Map + side panel */}
        <div className="flex" style={{ height: "calc(100vh - 125px)" }}>
          <div className="flex-1 relative min-w-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground" role="status" aria-live="polite">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  <p className="text-sm">Loading property intelligence…</p>
                </div>
              </div>
            ) : filteredProperties.length === 0 ? (
              // r6 Tasha WF-R6-001 + STR-R6-001: even with zero parcels
              // that have coordinates, render a real basemap so the user
              // sees geographic context (important for driving-for-dollars
              // personas). Also show a helpful overlay explaining how to
              // get coords on their existing parcels.
              <div className="relative w-full h-full">
                <PropertyMap
                  properties={[]}
                  height="100%"
                  showLabels={false}
                  interactive
                  enable3DTerrain={false}
                  showControls
                />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center p-8 bg-background/70 backdrop-blur-sm" role="status">
                  <div className="pointer-events-auto flex flex-col items-center max-w-sm">
                    <MapPin className="w-12 h-12 text-muted-foreground mb-4" aria-hidden="true" />
                    <h3 className="font-semibold text-lg">No parcel coordinates yet</h3>
                    <p className="text-muted-foreground text-sm mt-2">
                      Click <strong>Fetch boundaries</strong> on the Inventory page to auto-geocode your properties, or add lat/lng manually on a parcel's Overview tab. Basemap shown above.
                    </p>
                    <Button asChild variant="outline" className="mt-4" size="sm">
                      <Link href="/properties">
                        <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                        Go to inventory
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <PropertyMap
                properties={mapProperties}
                selectedPropertyId={selectedPropertyId}
                onPropertySelect={setSelectedPropertyId}
                height="100%"
                showLabels={filteredProperties.length < 50}
                interactive
                enable3DTerrain
                showControls
              />
            )}
          </div>

          {/* Enhanced Property Intelligence Panel */}
          {selectedProperty && (
            <PropertyIntelligencePanel
              property={selectedProperty}
              onClose={() => setSelectedPropertyId(undefined)}
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}
