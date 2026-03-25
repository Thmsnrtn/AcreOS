import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin } from "lucide-react";

interface CompProperty {
  id?: number;
  latitude?: number | null;
  longitude?: number | null;
  coordinates?: { lat: number; lng: number } | null;
  salePrice?: number | null;
  pricePerAcre?: number | null;
  address?: string;
  acreage?: number | null;
  distance?: number | null;
}

interface CompMapOverlayProps {
  subjectLat: number;
  subjectLng: number;
  comps: CompProperty[];
}

function formatPrice(val: number | null | undefined): string {
  if (val == null || !isFinite(val)) return "—";
  return `$${Math.round(val).toLocaleString()}`;
}

export function CompMapOverlay({ subjectLat, subjectLng, comps }: CompMapOverlayProps) {
  const validComps = useMemo(
    () =>
      comps.filter((c) => {
        const lat = c.latitude ?? c.coordinates?.lat;
        const lng = c.longitude ?? c.coordinates?.lng;
        return lat != null && lng != null;
      }),
    [comps]
  );

  if (validComps.length === 0) return null;

  // Calculate bounds for centering
  const allLats = [subjectLat, ...validComps.map((c) => (c.latitude ?? c.coordinates?.lat)!)];
  const allLngs = [subjectLng, ...validComps.map((c) => (c.longitude ?? c.coordinates?.lng)!)];
  const centerLat = allLats.reduce((a, b) => a + b, 0) / allLats.length;
  const centerLng = allLngs.reduce((a, b) => a + b, 0) / allLngs.length;

  // Compute zoom from bounds spread
  const latSpread = Math.max(...allLats) - Math.min(...allLats);
  const lngSpread = Math.max(...allLngs) - Math.min(...allLngs);
  const maxSpread = Math.max(latSpread, lngSpread, 0.01);
  const zoom = Math.min(14, Math.max(8, Math.round(14 - Math.log2(maxSpread * 100))));

  // Use OpenStreetMap static tile as backdrop with marker overlay
  const tileUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${Math.min(...allLngs) - 0.01},${Math.min(...allLats) - 0.01},${Math.max(...allLngs) + 0.01},${Math.max(...allLats) + 0.01}&layer=mapnik&marker=${subjectLat},${subjectLng}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          Comp Map
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative w-full" style={{ height: 300 }}>
          <iframe
            title="Comparable properties map"
            src={tileUrl}
            className="w-full h-full border-0 rounded-b-lg"
            style={{ pointerEvents: "auto" }}
          />
          {/* Overlay legend */}
          <div className="absolute bottom-2 left-2 bg-background/90 backdrop-blur-sm rounded-md p-2 text-xs space-y-1 border">
            <div className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary" />
              Subject property
            </div>
            <div className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-secondary" />
              {validComps.length} comparable{validComps.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
        {/* Comp price list below map */}
        <div className="px-3 py-2 space-y-1 border-t">
          {validComps.slice(0, 6).map((c, i) => (
            <div key={c.id ?? i} className="flex justify-between text-xs text-muted-foreground">
              <span className="truncate max-w-[60%]">
                {c.address || `Comp ${i + 1}`}
                {c.distance != null ? ` (${c.distance.toFixed(1)} mi)` : ""}
              </span>
              <span className="font-medium text-foreground">
                {formatPrice(c.salePrice)}
                {c.pricePerAcre ? ` · ${formatPrice(c.pricePerAcre)}/ac` : ""}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
