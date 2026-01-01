import { useState, useCallback, useMemo } from "react";
import Map, { Source, Layer, Marker, NavigationControl, FullscreenControl, ScaleControl } from "react-map-gl";
import type { MapRef, ViewStateChangeEvent, LayerProps } from "react-map-gl";
import { MapPin, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import "mapbox-gl/dist/mapbox-gl.css";

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

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

// Colors for different property statuses
const STATUS_COLORS: Record<string, string> = {
  prospect: "#fbbf24", // yellow
  due_diligence: "#f97316", // orange
  offer_sent: "#8b5cf6", // purple
  under_contract: "#3b82f6", // blue
  owned: "#22c55e", // green
  listed: "#06b6d4", // cyan
  sold: "#6b7280", // gray
  default: "#22c55e", // green
};

// Polygon fill layer style
const polygonFillLayer: LayerProps = {
  id: "property-fill",
  type: "fill",
  paint: {
    "fill-color": ["get", "color"],
    "fill-opacity": 0.35,
  },
};

// Polygon outline layer style
const polygonOutlineLayer: LayerProps = {
  id: "property-outline",
  type: "line",
  paint: {
    "line-color": ["get", "color"],
    "line-width": 3,
    "line-opacity": 0.9,
  },
};

// Selected polygon highlight
const selectedOutlineLayer: LayerProps = {
  id: "selected-outline",
  type: "line",
  paint: {
    "line-color": "#facc15",
    "line-width": 5,
    "line-opacity": 1,
  },
  filter: ["==", ["get", "id"], 0],
};

// Label layer for APNs
const labelLayer: LayerProps = {
  id: "property-labels",
  type: "symbol",
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
};

export function PropertyMap({
  properties,
  selectedPropertyId,
  onPropertySelect,
  height = "400px",
  showLabels = true,
  interactive = true,
  initialViewState,
}: PropertyMapProps) {
  const [viewState, setViewState] = useState(() => {
    // Calculate initial view from properties if not provided
    if (initialViewState) return initialViewState;
    
    if (properties.length === 0) {
      return {
        longitude: -98.5795,
        latitude: 39.8283,
        zoom: 4,
        pitch: 0,
      };
    }
    
    // Calculate center from all properties
    const avgLng = properties.reduce((sum, p) => sum + p.centroid.lng, 0) / properties.length;
    const avgLat = properties.reduce((sum, p) => sum + p.centroid.lat, 0) / properties.length;
    
    return {
      longitude: avgLng,
      latitude: avgLat,
      zoom: properties.length === 1 ? 16 : 10,
      pitch: 45,
    };
  });

  // Convert properties to GeoJSON for the map
  const geojsonData = useMemo(() => {
    const features = properties
      .filter(p => p.boundary)
      .map(p => ({
        type: "Feature" as const,
        properties: {
          id: p.id,
          apn: p.apn,
          name: p.name,
          color: STATUS_COLORS[p.status || "default"] || STATUS_COLORS.default,
        },
        geometry: p.boundary,
      }));

    return {
      type: "FeatureCollection" as const,
      features,
    };
  }, [properties]);

  // Center points for labels
  const labelPoints = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: properties
      .filter(p => p.centroid)
      .map(p => ({
        type: "Feature" as const,
        properties: {
          id: p.id,
          apn: p.apn,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [p.centroid.lng, p.centroid.lat],
        },
      })),
  }), [properties]);

  // Selected property filter
  const selectedFilter = useMemo(
    () => ["==", ["get", "id"], selectedPropertyId || 0] as any,
    [selectedPropertyId]
  );

  const handleMove = useCallback((evt: ViewStateChangeEvent) => {
    setViewState(evt.viewState);
  }, []);

  const handleClick = useCallback((evt: any) => {
    if (!interactive || !onPropertySelect) return;
    
    const features = evt.features;
    if (features && features.length > 0) {
      const feature = features[0];
      if (feature.properties?.id) {
        onPropertySelect(feature.properties.id);
      }
    }
  }, [interactive, onPropertySelect]);

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
          <p className="text-sm mt-1">Add parcel boundaries to see properties on the map</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-md overflow-hidden border" style={{ height }} data-testid="property-map">
      <Map
        {...viewState}
        onMove={handleMove}
        onClick={handleClick}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        style={{ width: "100%", height: "100%" }}
        terrain={{ source: "mapbox-dem", exaggeration: 1.2 }}
        interactiveLayerIds={interactive ? ["property-fill"] : []}
        cursor={interactive ? "pointer" : "default"}
      >
        {/* Terrain source for 3D */}
        <Source
          id="mapbox-dem"
          type="raster-dem"
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
          tileSize={512}
          maxzoom={14}
        />

        {/* Property boundaries */}
        <Source id="properties" type="geojson" data={geojsonData}>
          <Layer {...polygonFillLayer} />
          <Layer {...polygonOutlineLayer} />
          <Layer {...selectedOutlineLayer} filter={selectedFilter} />
        </Source>

        {/* Property labels */}
        {showLabels && (
          <Source id="labels" type="geojson" data={labelPoints}>
            <Layer {...labelLayer} />
          </Source>
        )}

        {/* Map controls */}
        <NavigationControl position="top-right" />
        <FullscreenControl position="top-right" />
        <ScaleControl position="bottom-left" />
      </Map>
    </div>
  );
}

// Single property map view
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
  if (!boundary || !centroid) {
    return (
      <Card className="flex items-center justify-center bg-muted/30" style={{ height }}>
        <CardContent className="text-center text-muted-foreground p-6">
          <MapPin className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No map data available</p>
          <p className="text-xs mt-1">Fetch parcel boundary to view on map</p>
        </CardContent>
      </Card>
    );
  }

  const property: PropertyBoundary = {
    id: 1,
    apn: apn || "",
    boundary,
    centroid,
    status: "owned",
  };

  return (
    <PropertyMap
      properties={[property]}
      height={height}
      showLabels={true}
      interactive={false}
      initialViewState={{
        longitude: centroid.lng,
        latitude: centroid.lat,
        zoom: 17,
        pitch: 60,
      }}
    />
  );
}

export default PropertyMap;
