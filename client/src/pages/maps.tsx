import { useState, useMemo } from "react";
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
import {
  Search,
  Filter,
  MapPin,
  SlidersHorizontal,
  X,
  ExternalLink,
} from "lucide-react";
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
  const d = 0.003; // ~0.3km radius
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

// Deal status → color mapping for portfolio view
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

export default function MapsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minAcres, setMinAcres] = useState(0);
  const [mapMode, setMapMode] = useState<"properties" | "deals">("properties");

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: deals = [] } = useQuery<DealWithProperty[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetch("/api/deals").then((r) => r.json()),
  });

  // Build a map of propertyId → deal for deal-mode coloring
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
      const matchAcres = acres >= minAcres;

      // In deal mode, only show properties that have deals
      if (mapMode === "deals") {
        return matchSearch && matchStatus && matchAcres && !!dealByPropertyId[p.id];
      }

      return matchSearch && matchStatus && matchAcres;
    });
  }, [properties, searchQuery, statusFilter, minAcres, mapMode, dealByPropertyId]);

  // Convert to PropertyBoundary format expected by PropertyMap
  const mapProperties = filteredProperties.map((p) => {
    const lat = parseFloat(String(p.latitude));
    const lng = parseFloat(String(p.longitude));

    // In deal mode, color by deal status
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

  // Portfolio stats for deals mode
  const dealStats = useMemo(() => {
    const active = deals.filter((d) => !["closed", "dead", "cancelled"].includes(d.status));
    const closed = deals.filter((d) => d.status === "closed");
    const totalVolume = closed.reduce((s, d) => s + Number(d.acceptedAmount || 0), 0);
    return { active: active.length, closed: closed.length, totalVolume };
  }, [deals]);

  return (
    <PageShell>
      <div className="-mx-4 -my-8 md:-mx-8 md:-my-8">
        {/* Header bar */}
        <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <MapPin className="w-5 h-5 text-primary shrink-0" />
            <h1 className="text-lg font-semibold truncate">
              {mapMode === "deals" ? "Portfolio Map" : "Property Map"}
            </h1>
            <Badge variant="secondary" className="text-xs shrink-0">
              {filteredProperties.length} / {propertiesWithCoords} mapped
            </Badge>
            {mapMode === "deals" && (
              <Badge variant="outline" className="text-xs shrink-0 hidden md:flex">
                {dealStats.active} active · {dealStats.closed} closed · $
                {(dealStats.totalVolume / 1000).toFixed(0)}k volume
              </Badge>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex items-center rounded-md border overflow-hidden shrink-0">
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${mapMode === "properties" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => setMapMode("properties")}
            >
              Properties
            </button>
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${mapMode === "deals" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => setMapMode("deals")}
            >
              Deals
            </button>
          </div>

          {/* Search */}
          <div className="relative w-48 md:w-64 hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-sm hidden md:flex">
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

          {/* Filters drawer */}
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 shrink-0">
                <SlidersHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">Filters</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Map Filters
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-6 mt-6">
                <div className="sm:hidden">
                  <Label className="text-sm font-medium">Search</Label>
                  <div className="relative mt-1.5">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="mt-1.5">
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
                <div>
                  <Label className="text-sm font-medium">Min Acres: {minAcres}</Label>
                  <Slider
                    min={0}
                    max={1000}
                    step={10}
                    value={[minAcres]}
                    onValueChange={([v]) => setMinAcres(v)}
                    className="mt-2"
                  />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setMinAcres(0);
                  }}
                >
                  Reset Filters
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Map + side panel */}
        <div className="flex" style={{ height: "calc(100vh - 130px)" }}>
          <div className="flex-1 relative min-w-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="animate-pulse">Loading map…</div>
              </div>
            ) : filteredProperties.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <MapPin className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="font-semibold text-lg">No properties with coordinates</h3>
                <p className="text-muted-foreground text-sm mt-2">
                  Add latitude/longitude to your properties to see them on the map.
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
                showControls
              />
            )}
          </div>

          {/* Selected property panel */}
          {selectedProperty && (
            <div className="w-64 border-l bg-card overflow-y-auto flex-shrink-0">
              <div className="p-4 border-b flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">
                    {selectedProperty.county}, {selectedProperty.state}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {selectedProperty.address || selectedProperty.apn}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedPropertyId(undefined)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge variant="outline" className="text-xs mt-0.5 capitalize">
                      {selectedProperty.status?.replace(/_/g, " ") || "—"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Acreage</p>
                    <p className="font-medium text-xs">
                      {selectedProperty.sizeAcres
                        ? `${parseFloat(String(selectedProperty.sizeAcres)).toLocaleString()} ac`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">APN</p>
                    <p className="font-medium text-xs truncate">{selectedProperty.apn || "—"}</p>
                  </div>
                  {selectedProperty.listPrice && (
                    <div>
                      <p className="text-xs text-muted-foreground">List Price</p>
                      <p className="font-medium text-xs text-primary">
                        ${parseInt(String(selectedProperty.listPrice)).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
                <Button asChild className="w-full" size="sm">
                  <Link href={`/properties?id=${selectedProperty.id}`}>
                    <ExternalLink className="w-3.5 h-3.5 mr-2" />
                    View Property
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
