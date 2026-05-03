import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MapPin,
  Clock,
  Camera,
  ClipboardCheck,
  FileText,
  Link2,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { relative } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldScoutVisit {
  id: string;
  propertyAddress: string;
  latitude?: number;
  longitude?: number;
  startedAt: string;
  endedAt?: string;
  durationMinutes?: number;
  photoCount: number;
  checklistScore?: number;
  notesPreview?: string;
  dealId?: string;
  synced: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMapboxStaticUrl(lat: number, lng: number): string {
  // Uses a placeholder-style URL; swap in a real Mapbox token for production
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-s+22c55e(${lng},${lat})/${lng},${lat},15,0/300x150@2x?access_token=pk.placeholder`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ScoutReportCardProps {
  visit: FieldScoutVisit;
  onGenerateReport?: (visitId: string) => void;
  onSyncToDeal?: (visitId: string) => void;
}

export function ScoutReportCard({
  visit,
  onGenerateReport,
  onSyncToDeal,
}: ScoutReportCardProps) {
  const hasCoords = visit.latitude !== undefined && visit.longitude !== undefined;

  return (
    <Card className="bg-acr-bg-sunken border-border overflow-hidden">
      {/* Mini map thumbnail */}
      {hasCoords && (
        <div className="relative h-28 bg-acr-bg-sunken overflow-hidden">
          <img
            src={getMapboxStaticUrl(visit.latitude!, visit.longitude!)}
            alt="Visit location"
            className="w-full h-full object-cover opacity-80"
            onError={(e) => {
              // Hide image on load error (no Mapbox token)
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-muted to-transparent" />
          <div className="absolute bottom-2 left-3 text-[10px] text-muted-foreground font-mono flex items-center gap-1">
            <MapPin className="w-3 h-3 text-acr-pos" />
            {visit.latitude!.toFixed(5)}, {visit.longitude!.toFixed(5)}
          </div>
        </div>
      )}

      <CardContent className={cn("p-3 space-y-3", !hasCoords && "pt-3")}>
        {/* Header */}
        <div>
          <div className="font-medium text-sm">{visit.propertyAddress || "Unknown Address"}</div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {format(new Date(visit.startedAt), "MMM d, yyyy")}
            </span>
            {visit.durationMinutes !== undefined && (
              <span className="text-[10px] text-muted-foreground">
                {formatDuration(visit.durationMinutes)}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {relative(visit.startedAt)}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="secondary"
            className="text-[10px] bg-acr-bg-sunken text-muted-foreground flex items-center gap-1"
          >
            <Camera className="w-3 h-3" />
            {visit.photoCount} photo{visit.photoCount !== 1 ? "s" : ""}
          </Badge>

          {visit.checklistScore !== undefined && (
            <Badge
              className={cn(
                "text-[10px] flex items-center gap-1",
                visit.checklistScore >= 80
                  ? "bg-acr-pos-soft/50 text-acr-pos"
                  : visit.checklistScore >= 50
                  ? "bg-acr-warn-soft/50 text-acr-warn"
                  : "bg-acr-neg-soft/50 text-acr-neg"
              )}
            >
              <ClipboardCheck className="w-3 h-3" />
              {visit.checklistScore}% pass
            </Badge>
          )}

          {visit.dealId && (
            <Badge
              variant="outline"
              className="text-[10px] border-acr-accent text-acr-accent flex items-center gap-1"
            >
              <Link2 className="w-3 h-3" />
              Linked
            </Badge>
          )}

          {!visit.synced && (
            <Badge
              variant="outline"
              className="text-[10px] border-acr-warn-soft text-acr-warn"
            >
              Pending sync
            </Badge>
          )}
        </div>

        {/* Notes preview */}
        {visit.notesPreview && (
          <p className="text-xs text-muted-foreground line-clamp-2">{visit.notesPreview}</p>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onGenerateReport?.(visit.id)}
            className="flex-1 border-border text-muted-foreground text-xs"
          >
            <FileText className="w-3 h-3 mr-1" />
            Generate Report
          </Button>
          {!visit.dealId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSyncToDeal?.(visit.id)}
              className="flex-1 border-border text-acr-accent text-xs"
            >
              <Link2 className="w-3 h-3 mr-1" />
              Sync to Deal
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
