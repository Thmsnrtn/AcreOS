/**
 * useNativeGeolocation — Capacitor Geolocation with web fallback
 *
 * Uses native high-accuracy GPS when running in Capacitor; falls back to the
 * browser Geolocation API on web. Supports continuous tracking mode.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { isNative } from "@/lib/platform";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GeoPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  timestamp: number;
}

export interface UseNativeGeolocationReturn {
  position: GeoPosition | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  isTracking: boolean;
  startTracking: () => Promise<void>;
  stopTracking: () => void;
  isNative: boolean;
  error: string | null;
  /** Request a single position fix */
  getCurrentPosition: () => Promise<GeoPosition | null>;
}

// ─── Permission helpers ──────────────────────────────────────────────────────

async function requestNativePermissions(): Promise<boolean> {
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const status = await Geolocation.checkPermissions();

    if (status.location === "granted" || status.coarseLocation === "granted") {
      return true;
    }

    if (status.location === "denied") {
      console.warn(
        "[Geolocation] Location permission was denied. Please enable it in Settings.",
      );
      return false;
    }

    const requested = await Geolocation.requestPermissions();
    return (
      requested.location === "granted" ||
      requested.coarseLocation === "granted"
    );
  } catch (err) {
    console.error("[Geolocation] Permission request failed:", err);
    return false;
  }
}

function friendlyError(err: GeolocationPositionError | any): string {
  if (err?.code === 1 || err?.message?.includes("denied")) {
    return "Location permission denied. Please enable location access in your device settings to use this feature.";
  }
  if (err?.code === 2) {
    return "Unable to determine your location. Please check that GPS is enabled.";
  }
  if (err?.code === 3 || err?.message?.includes("timeout")) {
    return "Location request timed out. Move to an area with better GPS signal and try again.";
  }
  return err?.message ?? "An unknown location error occurred.";
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useNativeGeolocation(): UseNativeGeolocationReturn {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<string | number | null>(null);
  const geoModuleRef = useRef<typeof import("@capacitor/geolocation") | null>(null);

  // Lazily load the Capacitor Geolocation module
  const getGeoModule = useCallback(async () => {
    if (geoModuleRef.current) return geoModuleRef.current;
    try {
      const mod = await import("@capacitor/geolocation");
      geoModuleRef.current = mod;
      return mod;
    } catch {
      return null;
    }
  }, []);

  const updateFromCoords = useCallback(
    (coords: GeolocationCoordinates, timestamp: number) => {
      setPosition({
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: coords.altitude,
        timestamp,
      });
      setAccuracy(coords.accuracy);
      setHeading(coords.heading);
      setSpeed(coords.speed);
      setError(null);
    },
    [],
  );

  // ── Single position fix ──────────────────────────────────────────────────

  const getCurrentPosition = useCallback(async (): Promise<GeoPosition | null> => {
    setError(null);

    if (isNative) {
      const mod = await getGeoModule();
      if (!mod) return null;

      const hasPermission = await requestNativePermissions();
      if (!hasPermission) {
        setError(
          "Location permission denied. Please enable location access in your device settings.",
        );
        return null;
      }

      try {
        const result = await mod.Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
        const pos: GeoPosition = {
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
          altitude: result.coords.altitude,
          timestamp: result.timestamp,
        };
        updateFromCoords(result.coords, result.timestamp);
        return pos;
      } catch (err: any) {
        const msg = friendlyError(err);
        setError(msg);
        console.error("[Geolocation] getCurrentPosition failed:", err);
        return null;
      }
    }

    // Web fallback
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not supported by this browser.");
      return null;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (result) => {
          const pos: GeoPosition = {
            latitude: result.coords.latitude,
            longitude: result.coords.longitude,
            altitude: result.coords.altitude,
            timestamp: result.timestamp,
          };
          updateFromCoords(result.coords, result.timestamp);
          resolve(pos);
        },
        (err) => {
          const msg = friendlyError(err);
          setError(msg);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
  }, [getGeoModule, updateFromCoords]);

  // ── Continuous tracking ──────────────────────────────────────────────────

  const startTracking = useCallback(async () => {
    if (isTracking) return;
    setError(null);

    if (isNative) {
      const mod = await getGeoModule();
      if (!mod) return;

      const hasPermission = await requestNativePermissions();
      if (!hasPermission) {
        setError(
          "Location permission denied. Please enable location access in your device settings.",
        );
        return;
      }

      try {
        const callbackId = await mod.Geolocation.watchPosition(
          { enableHighAccuracy: true },
          (pos: any, err: any) => {
            if (err) {
              setError(friendlyError(err));
              return;
            }
            if (pos) {
              updateFromCoords(pos.coords, pos.timestamp);
            }
          },
        );
        watchIdRef.current = callbackId;
        setIsTracking(true);
      } catch (err: any) {
        setError(friendlyError(err));
      }
      return;
    }

    // Web fallback
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not supported by this browser.");
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (result) => {
        updateFromCoords(result.coords, result.timestamp);
      },
      (err) => {
        setError(friendlyError(err));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
    watchIdRef.current = id;
    setIsTracking(true);
  }, [isTracking, getGeoModule, updateFromCoords]);

  const stopTracking = useCallback(async () => {
    if (!isTracking || watchIdRef.current === null) return;

    if (isNative) {
      try {
        const mod = await getGeoModule();
        if (mod) {
          await mod.Geolocation.clearWatch({
            id: watchIdRef.current as string,
          });
        }
      } catch (err) {
        console.warn("[Geolocation] clearWatch failed:", err);
      }
    } else {
      navigator.geolocation.clearWatch(watchIdRef.current as number);
    }

    watchIdRef.current = null;
    setIsTracking(false);
  }, [isTracking, getGeoModule]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        if (isNative) {
          import("@capacitor/geolocation")
            .then(({ Geolocation }) =>
              Geolocation.clearWatch({ id: watchIdRef.current as string }),
            )
            .catch(() => {});
        } else {
          navigator.geolocation.clearWatch(watchIdRef.current as number);
        }
      }
    };
  }, []);

  return {
    position,
    accuracy,
    heading,
    speed,
    isTracking,
    startTracking,
    stopTracking,
    isNative,
    error,
    getCurrentPosition,
  };
}
