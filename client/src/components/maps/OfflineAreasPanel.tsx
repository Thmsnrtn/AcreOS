/**
 * Offline field maps (W5b, Map door): save the area around a parcel for a
 * field visit with no signal. Imagery from sources whose terms allow offline
 * caching, plus the org's parcel facts; size-capped; every saved area says
 * "offline since <time>". Opens at /offline-map.html, which works in airplane
 * mode (client/public/offline-map.js).
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import {
  OfflineAreaRefusal,
  bboxAround,
  deleteOfflineArea,
  listOfflineAreas,
  planOfflineArea,
  saveOfflineArea,
  type OfflineArea,
} from "@/lib/offline-map-store";
import { OFFLINE_AREA_MAX_TILES } from "@shared/map/offlineSources";

interface ParcelLike {
  id: number;
  apn: string;
  county: string;
  state: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  parcelCentroid?: { lat: number; lng: number } | null;
}

const RADII = [0.5, 1, 2, 5] as const;
const MIN_ZOOM = 10;
const MAX_ZOOM = 16;

function centreOf(p: ParcelLike): { lat: number; lng: number } | null {
  const lat = Number(p.latitude ?? p.parcelCentroid?.lat);
  const lng = Number(p.longitude ?? p.parcelCentroid?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
}

export function OfflineAreasPanel({ properties }: { properties: ParcelLike[] }) {
  const { toast } = useToast();
  const located = useMemo(() => properties.filter((p) => centreOf(p)), [properties]);
  const [parcelId, setParcelId] = useState<string>(located[0] ? String(located[0].id) : "");
  const [radius, setRadius] = useState<string>("1");
  const [areas, setAreas] = useState<OfflineArea[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [supported] = useState(() => typeof window !== "undefined" && "caches" in window && "indexedDB" in window);

  const refresh = () => listOfflineAreas().then(setAreas).catch(() => setAreas([]));
  useEffect(() => {
    if (supported) void refresh();
  }, [supported]);
  useEffect(() => {
    if (!parcelId && located[0]) setParcelId(String(located[0].id));
  }, [located, parcelId]);

  const chosen = located.find((p) => String(p.id) === parcelId);
  const centre = chosen ? centreOf(chosen) : null;
  const plan = centre ? planOfflineArea(bboxAround(centre.lat, centre.lng, Number(radius)), MIN_ZOOM, MAX_ZOOM) : null;

  const save = async () => {
    if (!chosen || !centre) return;
    setProgress({ done: 0, total: plan?.tiles.length ?? 0 });
    try {
      await saveOfflineArea(
        {
          name: `${chosen.apn} · ${chosen.county}, ${chosen.state} · ${radius} mi`,
          bbox: bboxAround(centre.lat, centre.lng, Number(radius)),
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          now: new Date(),
        },
        (p) => setProgress({ done: p.done, total: p.total }),
      );
      toast({ title: "Saved for offline use", description: "Open the offline field map from here — it works with no signal." });
      await refresh();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Not saved",
        description: err instanceof OfflineAreaRefusal ? err.message : "The area couldn't be saved. Nothing was kept.",
      });
    } finally {
      setProgress(null);
    }
  };

  if (!supported) {
    return <p className="text-sm text-muted-foreground">This browser can&apos;t keep maps for offline use.</p>;
  }

  return (
    <div className="space-y-4" data-testid="offline-areas-panel">
      <p className="text-sm text-muted-foreground">
        Save the area around a parcel before a field visit. Satellite imagery and your parcel facts are kept on this
        device; street names aren&apos;t (that map&apos;s terms don&apos;t allow saving it).
      </p>
      {located.length === 0 ? (
        <p className="text-sm" data-testid="offline-no-located">None of your parcels has a map location yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="offline-parcel">Parcel</Label>
            <Select value={parcelId} onValueChange={setParcelId}>
              <SelectTrigger id="offline-parcel" data-testid="select-offline-parcel"><SelectValue /></SelectTrigger>
              <SelectContent>
                {located.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.apn} · {p.county}, {p.state}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="offline-radius">Area around it</Label>
            <Select value={radius} onValueChange={setRadius}>
              <SelectTrigger id="offline-radius" data-testid="select-offline-radius"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RADII.map((r) => <SelectItem key={r} value={String(r)}>{r} mile{r === 1 ? "" : "s"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {plan && (
            <p className={`text-xs ${plan.tiles.length > OFFLINE_AREA_MAX_TILES ? "text-acr-neg" : "text-muted-foreground"}`} data-testid="offline-plan">
              {plan.tiles.length.toLocaleString()} imagery tiles (limit {OFFLINE_AREA_MAX_TILES.toLocaleString()} per area).
            </p>
          )}
          {progress ? (
            <div className="space-y-1" role="status">
              <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} aria-label="Saving the area" />
              <p className="text-xs text-muted-foreground">{progress.done.toLocaleString()} of {progress.total.toLocaleString()} tiles</p>
            </div>
          ) : (
            <Button className="min-h-11 w-full" onClick={save} disabled={!plan || plan.tiles.length > OFFLINE_AREA_MAX_TILES} data-testid="button-save-offline-area">
              Save this area for offline
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2 border-t pt-3">
        <h3 className="text-sm font-semibold">On this device</h3>
        {areas === null ? null : areas.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="offline-areas-empty">No areas saved yet.</p>
        ) : (
          <ul className="space-y-2" data-testid="offline-areas-list">
            {areas.map((a) => (
              <li key={a.id} className="rounded-md border p-2 text-sm flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Offline since {formatDateTime(a.savedAt)} · {a.parcels.length} parcels · {(a.bytes / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 pointer-fine:sm:min-h-9"
                  onClick={() => deleteOfflineArea(a.id).then(refresh)}
                  aria-label={`Remove offline area ${a.name}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button asChild variant="outline" className="min-h-11 w-full">
          <a href="/offline-map.html" data-testid="link-open-offline-map">Open the offline field map</a>
        </Button>
      </div>
    </div>
  );
}
