import { useRef, useEffect, useState } from "react";
import mapboxgl from "mapbox-gl";
import { MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

if (MAPBOX_TOKEN) {
  mapboxgl.accessToken = MAPBOX_TOKEN;
}

interface PropertyBoundary {
  id: number;
  apn: string;
  name?: string;
  boundary: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  centroid: {
    lat: number;
    lng: number;
  };
  status?: string;
}

interface PropertyMapProps {
  properties: PropertyBoundary[];
  selectedPropertyId?: number;
  onPropertySelect?: (propertyId: number) => void;
  height?: string;
  showLabels?: boolean;
  interactive?: boolean;
  initialViewState?: {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch?: number;
  };
}

const STATUS_COLORS: Record<string, string> = {
  prospect: "#fbbf24",
  due_diligence: "#f97316",
  offer_sent: "#8b5cf6",
  under_contract: "#3b82f6",
  owned: "#22c55e",
  listed: "#06b6d4",
  sold: "#6b7280",
  available: "#22c55e",
  default: "#22c55e",
};

export function PropertyMap({
  properties,
  height = "400px",
  showLabels = true,
  interactive = true,
  initialViewState,
}: PropertyMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN || properties.length === 0) return;

    const viewState = initialViewState || (() => {
      if (properties.length === 0) {
        return { longitude: -98.5795, latitude: 39.8283, zoom: 4, pitch: 0 };
      }
      const avgLng = properties.reduce((sum, p) => sum + p.centroid.lng, 0) / properties.length;
      const avgLat = properties.reduce((sum, p) => sum + p.centroid.lat, 0) / properties.length;
      return {
        longitude: avgLng,
        latitude: avgLat,
        zoom: properties.length === 1 ? 16 : 10,
        pitch: 45,
      };
    })();

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [viewState.longitude, viewState.latitude],
      zoom: viewState.zoom,
      pitch: viewState.pitch || 0,
      interactive,
    });

    map.current.on("load", () => {
      if (!map.current) return;
      setMapLoaded(true);

      const geojsonData: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: properties
          .filter(p => p.boundary)
          .map(p => ({
            type: "Feature",
            properties: {
              id: p.id,
              apn: p.apn,
              name: p.name,
              color: STATUS_COLORS[p.status || "default"] || STATUS_COLORS.default,
            },
            geometry: p.boundary as GeoJSON.Geometry,
          })),
      };

      map.current.addSource("properties", {
        type: "geojson",
        data: geojsonData,
      });

      map.current.addLayer({
        id: "property-fill",
        type: "fill",
        source: "properties",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.35,
        },
      });

      map.current.addLayer({
        id: "property-outline",
        type: "line",
        source: "properties",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-opacity": 0.9,
        },
      });

      if (showLabels) {
        const labelPoints: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: properties
            .filter(p => p.centroid)
            .map(p => ({
              type: "Feature",
              properties: { id: p.id, apn: p.apn },
              geometry: {
                type: "Point",
                coordinates: [p.centroid.lng, p.centroid.lat],
              },
            })),
        };

        map.current.addSource("labels", {
          type: "geojson",
          data: labelPoints,
        });

        map.current.addLayer({
          id: "property-labels",
          type: "symbol",
          source: "labels",
          layout: {
            "text-field": ["get", "apn"],
            "text-size": 12,
            "text-anchor": "center",
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#000000",
            "text-halo-width": 1.5,
          },
        });
      }

      if (interactive) {
        map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
      }
    });

    return () => {
      map.current?.remove();
    };
  }, [properties, initialViewState, showLabels, interactive]);

  if (!MAPBOX_TOKEN) {
    return (
      <Card className="flex items-center justify-center" style={{ height }}>
        <CardContent className="text-center text-muted-foreground p-6">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Map not available</p>
          <p className="text-sm mt-1">Please configure VITE_MAPBOX_ACCESS_TOKEN</p>
        </CardContent>
      </Card>
    );
  }

  if (properties.length === 0) {
    return (
      <Card className="flex items-center justify-center" style={{ height }}>
        <CardContent className="text-center text-muted-foreground p-6">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No properties with map data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div 
      ref={mapContainer} 
      className="rounded-md overflow-hidden" 
      style={{ height, width: "100%" }} 
      data-testid="property-map"
    />
  );
}

interface SinglePropertyMapProps {
  boundary?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null;
  centroid?: {
    lat: number;
    lng: number;
  } | null;
  apn?: string;
  height?: string;
}

export function SinglePropertyMap({ boundary, centroid, apn, height = "300px" }: SinglePropertyMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN || !boundary || !centroid) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [centroid.lng, centroid.lat],
      zoom: 17,
      pitch: 60,
      interactive: false,
    });

    map.current.on("load", () => {
      if (!map.current) return;

      const geojsonData: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { apn, color: "#22c55e" },
          geometry: boundary as GeoJSON.Geometry,
        }],
      };

      map.current.addSource("property", {
        type: "geojson",
        data: geojsonData,
      });

      map.current.addLayer({
        id: "property-fill",
        type: "fill",
        source: "property",
        paint: {
          "fill-color": "#22c55e",
          "fill-opacity": 0.35,
        },
      });

      map.current.addLayer({
        id: "property-outline",
        type: "line",
        source: "property",
        paint: {
          "line-color": "#22c55e",
          "line-width": 3,
          "line-opacity": 0.9,
        },
      });
    });

    return () => {
      map.current?.remove();
    };
  }, [boundary, centroid, apn]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center bg-muted/30 rounded-md" style={{ height }}>
        <div className="text-center text-muted-foreground p-4">
          <MapPin className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-xs">Configure Mapbox token</p>
        </div>
      </div>
    );
  }

  if (!boundary || !centroid) {
    return (
      <div className="flex items-center justify-center bg-muted/30 rounded-md" style={{ height }}>
        <div className="text-center text-muted-foreground p-4">
          <MapPin className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No map data</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={mapContainer} 
      className="w-full h-full" 
      style={{ height }}
      data-testid="single-property-map"
    />
  );
}

export default PropertyMap;
