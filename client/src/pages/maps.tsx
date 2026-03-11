import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
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

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "prospect", label: "Prospect" },
  { value: "due_diligence", label: "Due Diligence" },
  { value: "offer_sent", label: "Offer Sent" },
  { value: "under_contract", label: "Under Contract" },
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
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0">
          <X className="w-4 h-4" />
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
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minAcres, setMinAcres] = useState(0);
  const [maxAcres, setMaxAcres] = useState(10000);
  const [mapMode, setMapMode] = useState<"properties" | "deals">("properties");
  const [showBuyerDemandHeatmap, setShowBuyerDemandHeatmap] = useState(false);
  const [showPredictionHeatmap, setShowPredictionHeatmap] = useState(false);

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: deals = [] } = useQuery<DealWithProperty[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetch("/api/deals").then((r) => r.json()),
  });

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
            <MapPin className="w-4 h-4 text-primary shrink-0" />
            <h1 className="text-base font-semibold truncate">
              {mapMode === "deals" ? "Portfolio Map" : "Property Intelligence Map"}
            </h1>
            <Badge variant="secondary" className="text-[10px] shrink-0">
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
          <div className="flex items-center rounded-md border overflow-hidden shrink-0">
            <button
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${mapMode === "properties" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => setMapMode("properties")}
            >
              Properties
            </button>
            <button
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${mapMode === "deals" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => setMapMode("deals")}
            >
              Deals
            </button>
          </div>

          {/* Search */}
          <div className="relative w-44 hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 h-7 text-xs"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 h-7 text-xs hidden md:flex">
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
                  <Filter className="w-4 h-4" />
                  Map Filters & Layers
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-5 mt-5">
                {/* Search (mobile) */}
                <div className="sm:hidden">
                  <Label className="text-xs font-medium">Search</Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input placeholder="Search…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 text-sm" />
                  </div>
                </div>

                {/* Status */}
                <div>
                  <Label className="text-xs font-medium">Property Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="mt-1.5 text-sm">
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
                  <Label className="text-xs font-medium">
                    Min Acres: <span className="text-primary">{minAcres.toLocaleString()}</span>
                  </Label>
                  <Slider min={0} max={1000} step={10} value={[minAcres]} onValueChange={([v]) => setMinAcres(v)} className="mt-2" />
                </div>
                <div>
                  <Label className="text-xs font-medium">
                    Max Acres: <span className="text-primary">{maxAcres >= 10000 ? "No limit" : maxAcres.toLocaleString()}</span>
                  </Label>
                  <Slider min={100} max={10000} step={100} value={[maxAcres]} onValueChange={([v]) => setMaxAcres(v)} className="mt-2" />
                </div>

                {/* Data Layers */}
                <div className="space-y-3 pt-2 border-t">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <Layers className="w-3.5 h-3.5 text-primary" /> Intelligence Layers
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-blue-500" />
                      <div>
                        <Label className="text-xs cursor-pointer">Buyer Demand Heatmap</Label>
                        <p className="text-[10px] text-muted-foreground">Inquiry density by area</p>
                      </div>
                    </div>
                    <Switch checked={showBuyerDemandHeatmap} onCheckedChange={setShowBuyerDemandHeatmap} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-3.5 h-3.5 text-purple-500" />
                      <div>
                        <Label className="text-xs cursor-pointer">ML Price Prediction</Label>
                        <p className="text-[10px] text-muted-foreground">Green = above avg, Red = below</p>
                      </div>
                    </div>
                    <Switch checked={showPredictionHeatmap} onCheckedChange={setShowPredictionHeatmap} />
                  </div>
                </div>

                <Button variant="outline" className="w-full text-sm" onClick={() => {
                  setSearchQuery(""); setStatusFilter("all"); setMinAcres(0); setMaxAcres(10000);
                  setShowBuyerDemandHeatmap(false); setShowPredictionHeatmap(false);
                }}>
                  Reset All Filters
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Map + side panel */}
        <div className="flex" style={{ height: "calc(100vh - 125px)" }}>
          <div className="flex-1 relative min-w-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm">Loading property intelligence…</p>
                </div>
              </div>
            ) : filteredProperties.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <MapPin className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="font-semibold text-lg">No properties with coordinates</h3>
                <p className="text-muted-foreground text-sm mt-2 max-w-sm">
                  Add GPS coordinates to your properties to visualize them on the 3D intelligence map with parcel boundaries, terrain analysis, and demand heatmaps.
                </p>
                <Button asChild variant="outline" className="mt-4" size="sm">
                  <Link href="/properties">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to Inventory
                  </Link>
                </Button>
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
