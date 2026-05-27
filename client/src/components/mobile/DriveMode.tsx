/**
 * DriveMode — mobile driving-for-dollars curb capture.
 *
 * Lens 2 + 6 + 15 driver: DealMachine's killer mobile feature is the
 * one-tap "save the address I'm parked in front of" GPS capture. This
 * component is the customer-facing surface for that flow.
 *
 * Layout (top → bottom, full-screen):
 *   1. Map view (lazy MapLibre) centered on the current GPS fix.
 *   2. Big "Save current location as lead" CTA (≥88pt touch target,
 *      haptic via navigator.vibrate(20) on tap).
 *   3. Camera capture button — opens the native phone camera via
 *      input[capture=environment] (iOS Safari + Android Chrome both
 *      respect it).
 *   4. Bottom: rolling list of the last 5 saves this session, so the
 *      investor sees their progress without leaving the screen.
 *
 * Route optimization, auto skip-trace, batch capture, etc. all live
 * later — this is the minimum that proves the loop on the phone.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Camera, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { SinglePropertyMap } from "@/components/property-map-lazy";

interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: number;
}

interface SavedLead {
  id: number;
  lat: number;
  lng: number;
  savedAt: number;
  geocoded: boolean;
}

/**
 * Tiny wrapper around navigator.geolocation.watchPosition. Returns the
 * latest fix + accuracy, with a sentinel for "permission denied" so the
 * UI can show a clear error state. We use watchPosition (not getCurrent)
 * so the map keeps recentering as the investor drives.
 */
function useGpsWatch() {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser doesn't support GPS.");
      setPending(false);
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        });
        setPending(false);
        setError(null);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enable it in your phone's settings to use Drive Mode."
            : "Couldn't get a GPS fix — try moving to a clearer view of the sky.",
        );
        setPending(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return { fix, error, pending };
}

/**
 * Try to vibrate the device for haptic feedback. Silent no-op on
 * unsupported browsers (desktop, iOS Safari without user gesture, etc.).
 */
function haptic(ms = 20) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch {
    // ignore — vibration is best-effort
  }
}

export function DriveMode() {
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { fix, error: gpsError, pending: gpsPending } = useGpsWatch();
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<SavedLead[]>([]);
  const [pendingPhotoLeadId, setPendingPhotoLeadId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The save button is the centerpiece — disabled until we have a fix or
  // while the request is in flight. Tapping fires haptic + POSTs the
  // current point, then prepends the result to the recent list.
  const saveCurrentLocation = async () => {
    if (!fix || saving) return;
    haptic(20);
    setSaving(true);
    try {
      const res = await apiRequest("POST", "/api/field-scout/quick-add", {
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
      });
      const body = await res.json();
      const saved: SavedLead = {
        id: body.leadId,
        lat: fix.lat,
        lng: fix.lng,
        savedAt: Date.now(),
        geocoded: !!body.geocoded,
      };
      setRecent((prev) => [saved, ...prev].slice(0, 5));
      setPendingPhotoLeadId(saved.id);
      toast({
        title: "Lead saved",
        description: saved.geocoded
          ? "Address resolved from parcel data."
          : "GPS only — enrich on desktop.",
      });
    } catch (err: any) {
      toast({
        title: "Couldn't save lead",
        description: err?.message ?? "Network issue — try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Camera capture goes to the most-recently saved lead. We don't auto-
  // open the camera on save because iOS Safari blocks file inputs without
  // a fresh user gesture — keep the camera button explicit.
  const openCamera = () => {
    if (!pendingPhotoLeadId) {
      toast({
        title: "Save a lead first",
        description: "Tap the big button to capture the GPS point, then attach a photo.",
        variant: "destructive",
      });
      return;
    }
    fileInputRef.current?.click();
  };

  const onPhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file again still fires
    if (!file || !pendingPhotoLeadId) return;

    const form = new FormData();
    form.append("photos", file);
    if (fix) {
      form.append("lat", String(fix.lat));
      form.append("lng", String(fix.lng));
    }
    try {
      const res = await fetch(`/api/leads/${pendingPhotoLeadId}/photos`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      toast({ title: "Photo attached", description: "Saved to the lead." });
    } catch (err: any) {
      toast({
        title: "Photo upload failed",
        description: err?.message ?? "Network issue — try again.",
        variant: "destructive",
      });
    }
  };

  // Single-centroid synth so the lazy SinglePropertyMap has something to
  // render. SinglePropertyMap requires a boundary; we hand it a tiny
  // bounding-box around the current point so the map renders the right
  // area at street level.
  const mapCentroid = fix ? { lat: fix.lat, lng: fix.lng } : null;
  const mapBoundary = fix
    ? {
        type: "Polygon" as const,
        coordinates: [[
          [fix.lng - 0.0005, fix.lat - 0.0005],
          [fix.lng + 0.0005, fix.lat - 0.0005],
          [fix.lng + 0.0005, fix.lat + 0.0005],
          [fix.lng - 0.0005, fix.lat + 0.0005],
          [fix.lng - 0.0005, fix.lat - 0.0005],
        ]],
      }
    : null;

  return (
    <div
      className="min-h-[100dvh] bg-background text-foreground flex flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      data-testid="drive-mode"
    >
      {/* Header — back button + title. Keep slim so the map dominates. */}
      <header className="flex items-center gap-2 px-4 h-12 border-b border-border bg-background/95 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setLocation("/")}
          aria-label="Exit Drive Mode"
          className="h-10 w-10 -ml-2 flex items-center justify-center rounded-full text-muted-foreground active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="drive-mode-back"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <h1 className="font-semibold tracking-tight">Drive Mode</h1>
        {fix ? (
          <span
            className="ml-auto text-caption text-muted-foreground"
            aria-live="polite"
            data-testid="drive-mode-accuracy"
          >
            ±{fix.accuracy.toFixed(0)}m
          </span>
        ) : null}
      </header>

      {/* Map — fills the upper third. Suspense fallback inside lazy map. */}
      <div
        className="relative w-full h-[40dvh] bg-muted"
        data-testid="drive-mode-map"
      >
        {mapBoundary && mapCentroid ? (
          <SinglePropertyMap
            boundary={mapBoundary}
            centroid={mapCentroid}
            height="100%"
            enable3DTerrain={false}
            showNearbyParcels={false}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {gpsPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Locking on GPS…
              </span>
            ) : (
              <span className="px-6 text-center">{gpsError ?? "No GPS fix yet."}</span>
            )}
          </div>
        )}
      </div>

      {/* Primary action stack. Save button is intentionally oversized
          (88pt+ on iOS at default rem) so a driver glancing at the
          screen can tap without looking. */}
      <div className="flex flex-col gap-3 px-4 pt-4 pb-2">
        <Button
          type="button"
          onClick={saveCurrentLocation}
          disabled={!fix || saving}
          aria-label="Save current location as lead"
          className="w-full h-24 text-lg font-semibold rounded-2xl shadow-md gap-3"
          data-testid="drive-mode-save"
        >
          {saving ? (
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          ) : (
            <MapPin className="h-6 w-6" aria-hidden />
          )}
          {saving ? "Saving…" : "Save current location as lead"}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={openCamera}
          aria-label="Capture photo of the property"
          className="w-full h-14 rounded-2xl gap-2"
          data-testid="drive-mode-camera"
        >
          <Camera className="h-5 w-5" aria-hidden />
          {pendingPhotoLeadId ? "Attach photo to last save" : "Save a lead, then add photo"}
        </Button>

        {/* Native camera launcher. capture="environment" tells iOS Safari +
            Android Chrome to open the rear camera directly instead of the
            photo library picker. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPhotoSelected}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          data-testid="drive-mode-camera-input"
        />
      </div>

      {/* Recent saves — last 5 in this session. Empty state explains the
          loop so the surface isn't blank on first land. */}
      <section
        className="flex-1 overflow-y-auto px-4 pt-2 pb-6"
        aria-label="Recent saves this session"
      >
        <h2 className="text-caption font-medium text-muted-foreground mb-2">
          Recent saves
        </h2>
        {recent.length === 0 ? (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              Saves from this session show up here. Tap the big button to
              capture the address you're parked in front of.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2" data-testid="drive-mode-recent-list">
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setLocation(`/leads/${r.id}`)}
                  className="w-full text-left rounded-xl border border-border bg-card px-4 py-3 active:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Open lead ${r.id}`}
                >
                  <div className="text-sm font-medium">
                    Lead #{r.id}
                  </div>
                  <div className="text-caption text-muted-foreground">
                    {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                    {r.geocoded ? " — address resolved" : " — GPS only"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!isMobile ? (
        <div className="px-4 py-2 text-caption text-muted-foreground border-t border-border">
          Drive Mode is optimized for phones. Open this page on your mobile
          browser for the full experience.
        </div>
      ) : null}
    </div>
  );
}

export default DriveMode;
