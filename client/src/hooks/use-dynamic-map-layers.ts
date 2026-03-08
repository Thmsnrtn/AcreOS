import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface MapLayer {
  id: number;
  title: string;
  category: string | null;
  subcategory: string | null;
  apiUrl: string | null;
  portalUrl: string | null;
  accessLevel: string | null;
  description: string | null;
  coverage: string | null;
  geometryType: string;
}

export interface DynamicLayerState {
  [layerId: number]: {
    enabled: boolean;
    opacity: number;
  };
}

const DYNAMIC_LAYERS_STORAGE_KEY = "dynamic-map-layers";

function loadLocalLayerState(): DynamicLayerState {
  try {
    const stored = localStorage.getItem(DYNAMIC_LAYERS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function saveLocalLayerState(state: DynamicLayerState): void {
  try {
    localStorage.setItem(DYNAMIC_LAYERS_STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function buildArcGISRasterTileUrl(baseUrl: string): string {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  return `${cleanUrl}/export?bbox={bbox-epsg-3857}&bboxSR=3857&size=256,256&f=image`;
}

export function isArcGISMapServerUrl(url: string | null): boolean {
  if (!url) return false;
  return url.includes("/MapServer") || url.includes("/rest/services");
}

export function useDynamicMapLayers() {
  const queryClient = useQueryClient();

  // Server-persisted preferences (authoritative source)
  const { data: serverPrefs, isLoading: prefsLoading } = useQuery<DynamicLayerState>({
    queryKey: ["/api/user/map-layer-preferences"],
    staleTime: 1000 * 60 * 5,
  });

  // Local state initialised from localStorage, then overwritten by server prefs once loaded
  const [layerState, setLayerState] = useState<DynamicLayerState>(loadLocalLayerState);

  // Sync server preferences into local state once loaded
  useEffect(() => {
    if (serverPrefs && !prefsLoading) {
      setLayerState((local) => {
        // Merge: server wins for any key it knows about
        const merged = { ...local, ...serverPrefs };
        saveLocalLayerState(merged);
        return merged;
      });
    }
  }, [serverPrefs, prefsLoading]);

  const { data: layers = [], isLoading: layersLoading, error } = useQuery<MapLayer[]>({
    queryKey: ["/api/map-layers"],
    staleTime: 1000 * 60 * 5,
  });

  // Mutation to persist a single layer preference to the server
  const { mutate: persistPref } = useMutation({
    mutationFn: ({ layerId, enabled, opacity }: { layerId: number; enabled?: boolean; opacity?: number }) =>
      apiRequest("PUT", `/api/user/map-layer-preferences/${layerId}`, { enabled, opacity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/map-layer-preferences"] });
    },
  });

  const toggleLayer = useCallback((layerId: number) => {
    setLayerState((prev) => {
      const current = prev[layerId] || { enabled: false, opacity: 0.7 };
      const newEnabled = !current.enabled;
      const newState = { ...prev, [layerId]: { ...current, enabled: newEnabled } };
      saveLocalLayerState(newState);
      persistPref({ layerId, enabled: newEnabled });
      return newState;
    });
  }, [persistPref]);

  const setLayerOpacity = useCallback((layerId: number, opacity: number) => {
    setLayerState((prev) => {
      const current = prev[layerId] || { enabled: false, opacity: 0.7 };
      const newState = { ...prev, [layerId]: { ...current, opacity } };
      saveLocalLayerState(newState);
      persistPref({ layerId, opacity });
      return newState;
    });
  }, [persistPref]);

  const isLayerEnabled = useCallback(
    (layerId: number): boolean => layerState[layerId]?.enabled || false,
    [layerState]
  );

  const getLayerOpacity = useCallback(
    (layerId: number): number => layerState[layerId]?.opacity ?? 0.7,
    [layerState]
  );

  const enabledLayers = layers.filter((layer) => isLayerEnabled(layer.id));

  const layersByCategory = layers.reduce<Record<string, MapLayer[]>>((acc, layer) => {
    const category = layer.category || "Other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(layer);
    return acc;
  }, {});

  return {
    layers,
    layersByCategory,
    enabledLayers,
    isLoading: layersLoading || prefsLoading,
    error,
    layerState,
    toggleLayer,
    setLayerOpacity,
    isLayerEnabled,
    getLayerOpacity,
  };
}
