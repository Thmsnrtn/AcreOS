import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import { MapPin, Maximize2, Minimize2, Mountain, Satellite, Map as MapIcon, Play, Pause } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

if (MAPBOX_TOKEN) {
  mapboxgl.accessToken = MAPBOX_TOKEN;
}

type MapStyle = "satellite" | "terrain" | "streets";

const MAP_STYLES: Record<MapStyle, string> = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain: "mapbox://styles/mapbox/outdoors-v12",
  streets: "mapbox://styles/mapbox/streets-v12",
};

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
  enable3DTerrain?: boolean;
  showControls?: boolean;
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
  enable3DTerrain = true,
  showControls = true,
  initialViewState,
}: PropertyMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentStyle, setCurrentStyle] = useState<MapStyle>("satellite");
  const [isFlyoverActive, setIsFlyoverActive] = useState(false);
  const flyoverAnimationRef = useRef<number | null>(null);

  const addPropertyLayers = useCallback(() => {
    if (!map.current) return;

    if (map.current.getSource("properties")) {
      if (map.current.getLayer("property-labels")) map.current.removeLayer("property-labels");
      if (map.current.getLayer("property-outline")) map.current.removeLayer("property-outline");
      if (map.current.getLayer("property-fill")) map.current.removeLayer("property-fill");
      if (map.current.getSource("labels")) map.current.removeSource("labels");
      map.current.removeSource("properties");
    }

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
  }, [properties, showLabels]);

  const setup3DTerrain = useCallback(() => {
    if (!map.current || !enable3DTerrain) return;

    if (!map.current.getSource("mapbox-dem")) {
      map.current.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
    }

    map.current.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

    if (!map.current.getLayer("sky")) {
      map.current.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [0.0, 90.0],
          "sky-atmosphere-sun-intensity": 15,
        },
      });
    }
  }, [enable3DTerrain]);

  const changeMapStyle = useCallback((style: MapStyle) => {
    if (!map.current) return;
    setCurrentStyle(style);
    map.current.setStyle(MAP_STYLES[style]);

    map.current.once("style.load", () => {
      setup3DTerrain();
      addPropertyLayers();
    });
  }, [setup3DTerrain, addPropertyLayers]);

  const startFlyover = useCallback(() => {
    if (!map.current || properties.length === 0) return;

    setIsFlyoverActive(true);
    const center = properties[0].centroid;
    let bearing = 0;

    const animate = () => {
      if (!map.current) return;
      bearing = (bearing + 0.3) % 360;
      map.current.easeTo({
        bearing,
        pitch: 60,
        duration: 50,
        easing: (t) => t,
      });
      flyoverAnimationRef.current = requestAnimationFrame(animate);
    };

    map.current.easeTo({
      center: [center.lng, center.lat],
      zoom: 16,
      pitch: 60,
      duration: 1000,
    });

    setTimeout(() => {
      flyoverAnimationRef.current = requestAnimationFrame(animate);
    }, 1000);
  }, [properties]);

  const stopFlyover = useCallback(() => {
    if (flyoverAnimationRef.current) {
      cancelAnimationFrame(flyoverAnimationRef.current);
      flyoverAnimationRef.current = null;
    }
    setIsFlyoverActive(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
    setTimeout(() => {
      map.current?.resize();
    }, 100);
  }, []);

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
        pitch: 60,
      };
    })();

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[currentStyle],
      center: [viewState.longitude, viewState.latitude],
      zoom: viewState.zoom,
      pitch: viewState.pitch || 60,
      bearing: 0,
      interactive,
    });

    map.current.on("load", () => {
      if (!map.current) return;
      setMapLoaded(true);

      setup3DTerrain();
      addPropertyLayers();

      if (interactive) {
        map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
      }
    });

    return () => {
      stopFlyover();
      map.current?.remove();
    };
  }, [properties, initialViewState, interactive, currentStyle, setup3DTerrain, addPropertyLayers, stopFlyover]);

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
      className={cn(
        "relative rounded-md overflow-hidden",
        isFullscreen && "fixed inset-0 z-50 rounded-none"
      )}
      style={isFullscreen ? undefined : { height, width: "100%" }}
      data-testid="property-map-container"
    >
      <div 
        ref={mapContainer} 
        className="w-full h-full"
        style={isFullscreen ? { height: "100vh" } : { height }}
        data-testid="property-map"
      />

      {showControls && (
        <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
          <div className="flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1 shadow-lg">
            <Button
              size="icon"
              variant={currentStyle === "satellite" ? "default" : "ghost"}
              onClick={() => changeMapStyle("satellite")}
              title="Satellite View"
              data-testid="button-map-satellite"
            >
              <Satellite className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant={currentStyle === "terrain" ? "default" : "ghost"}
              onClick={() => changeMapStyle("terrain")}
              title="Terrain View"
              data-testid="button-map-terrain"
            >
              <Mountain className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant={currentStyle === "streets" ? "default" : "ghost"}
              onClick={() => changeMapStyle("streets")}
              title="Street View"
              data-testid="button-map-streets"
            >
              <MapIcon className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1 shadow-lg">
            <Button
              size="icon"
              variant={isFlyoverActive ? "default" : "ghost"}
              onClick={isFlyoverActive ? stopFlyover : startFlyover}
              title={isFlyoverActive ? "Stop Flyover" : "Start Flyover"}
              data-testid="button-map-flyover"
            >
              {isFlyoverActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              data-testid="button-map-fullscreen"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {isFullscreen && (
        <Button
          size="icon"
          variant="outline"
          onClick={toggleFullscreen}
          className="absolute top-3 right-3 z-10 bg-background/80 backdrop-blur-sm"
          data-testid="button-exit-fullscreen"
        >
          <Minimize2 className="h-4 w-4" />
        </Button>
      )}
    </div>
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
  enable3DTerrain?: boolean;
}

export function SinglePropertyMap({ boundary, centroid, apn, height = "300px", enable3DTerrain = true }: SinglePropertyMapProps) {
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
      bearing: -17,
      interactive: true,
    });

    map.current.on("load", () => {
      if (!map.current) return;

      if (enable3DTerrain) {
        map.current.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });

        map.current.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

        map.current.addLayer({
          id: "sky",
          type: "sky",
          paint: {
            "sky-type": "atmosphere",
            "sky-atmosphere-sun": [0.0, 90.0],
            "sky-atmosphere-sun-intensity": 15,
          },
        });
      }

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

      map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    });

    return () => {
      map.current?.remove();
    };
  }, [boundary, centroid, apn, enable3DTerrain]);

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
      className="w-full h-full rounded-md overflow-hidden" 
      style={{ height }}
      data-testid="single-property-map"
    />
  );
}

export default PropertyMap;
