import { useQuery } from "@tanstack/react-query";
import { useState, useCallback, useEffect } from "react";

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

function loadDynamicLayerState(): DynamicLayerState {
  try {
    const stored = localStorage.getItem(DYNAMIC_LAYERS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    console.log("Could not load dynamic layer state from localStorage");
  }
  return {};
}

function saveDynamicLayerState(state: DynamicLayerState): void {
  try {
    localStorage.setItem(DYNAMIC_LAYERS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.log("Could not save dynamic layer state to localStorage");
  }
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
  const [layerState, setLayerState] = useState<DynamicLayerState>(loadDynamicLayerState);

  const { data: layers = [], isLoading, error } = useQuery<MapLayer[]>({
    queryKey: ["/api/map-layers"],
    staleTime: 1000 * 60 * 5,
  });

  const toggleLayer = useCallback((layerId: number) => {
    setLayerState((prev) => {
      const current = prev[layerId] || { enabled: false, opacity: 0.7 };
      const newState = {
        ...prev,
        [layerId]: {
          ...current,
          enabled: !current.enabled,
        },
      };
      saveDynamicLayerState(newState);
      return newState;
    });
  }, []);

  const setLayerOpacity = useCallback((layerId: number, opacity: number) => {
    setLayerState((prev) => {
      const current = prev[layerId] || { enabled: false, opacity: 0.7 };
      const newState = {
        ...prev,
        [layerId]: {
          ...current,
          opacity,
        },
      };
      saveDynamicLayerState(newState);
      return newState;
    });
  }, []);

  const isLayerEnabled = useCallback(
    (layerId: number): boolean => {
      return layerState[layerId]?.enabled || false;
    },
    [layerState]
  );

  const getLayerOpacity = useCallback(
    (layerId: number): number => {
      return layerState[layerId]?.opacity ?? 0.7;
    },
    [layerState]
  );

  const enabledLayers = layers.filter((layer) => isLayerEnabled(layer.id));

  const layersByCategory = layers.reduce<Record<string, MapLayer[]>>((acc, layer) => {
    const category = layer.category || "Other";
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(layer);
    return acc;
  }, {});

  return {
    layers,
    layersByCategory,
    enabledLayers,
    isLoading,
    error,
    layerState,
    toggleLayer,
    setLayerOpacity,
    isLayerEnabled,
    getLayerOpacity,
  };
}
