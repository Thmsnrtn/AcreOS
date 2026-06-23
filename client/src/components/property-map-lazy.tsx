/**
 * property-map-lazy — lazy-loaded re-export of property-map components.
 *
 * The underlying `property-map.tsx` imports MapLibre (~2.4 MB vendor chunk).
 * Pages that don't always render a map (e.g. /properties, /maps) should
 * import from THIS file instead of `property-map.tsx` directly, so the
 * map vendor bundle only resolves when the component actually mounts.
 *
 * Created during W5-3 bundle-perf work. Callers see the same API as before
 * — just wrapped in React.lazy under the hood by importing the underlying
 * components via dynamic import + Suspense at the call site.
 *
 * For now this is a thin re-export to keep the build green; the next
 * iteration converts each consumer to `<Suspense fallback={...}>` + a
 * lazy-imported `<PropertyMapLazyMount>` that only resolves the underlying
 * module on first render.
 */
import React, { Suspense } from "react";
import { useLocation } from "wouter";
import { MapPinOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/error-boundary";

// React.lazy can't return named exports directly — wrap each export in its
// own lazy boundary so the underlying module only loads on first mount.
const PropertyMapLazy = React.lazy(() =>
  import("./property-map").then((m) => ({ default: m.PropertyMap })),
);
const SinglePropertyMapLazy = React.lazy(() =>
  import("./property-map").then((m) => ({ default: m.SinglePropertyMap })),
);
const StaticPropertyMapLazy = React.lazy(() =>
  import("./property-map").then((m) => ({ default: m.StaticPropertyMap })),
);

function MapFallback({ className }: { className?: string }) {
  return (
    <div className={className} aria-busy="true">
      <Skeleton className="h-full w-full rounded-card" announceText="Loading map" />
    </div>
  );
}

// Graceful degradation when the map ENGINE itself throws (MapLibre init failure,
// WebGL unavailable, vendor chunk error) — without this a map crash white-screens
// the entire page via the app-level boundary. The surrounding page stays usable;
// navigating away and back clears it (resetKey = location).
function MapErrorFallback() {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-card border border-border bg-muted/30 p-6 text-center"
      role="status"
    >
      <MapPinOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">The map couldn't load</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Everything else on this page still works. Reload, or check that your browser allows hardware
        graphics (WebGL).
      </p>
    </div>
  );
}

/** Lazy + Suspense + an engine-crash boundary, shared by all map exports. */
function MapBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return (
    <ErrorBoundary fallback={<MapErrorFallback />} resetKey={location}>
      <Suspense fallback={<MapFallback className="h-full w-full" />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function PropertyMap(props: React.ComponentProps<typeof PropertyMapLazy>) {
  return (
    <MapBoundary>
      <PropertyMapLazy {...props} />
    </MapBoundary>
  );
}

export function SinglePropertyMap(props: React.ComponentProps<typeof SinglePropertyMapLazy>) {
  return (
    <MapBoundary>
      <SinglePropertyMapLazy {...props} />
    </MapBoundary>
  );
}

export function StaticPropertyMap(props: React.ComponentProps<typeof StaticPropertyMapLazy>) {
  return (
    <MapBoundary>
      <StaticPropertyMapLazy {...props} />
    </MapBoundary>
  );
}

export default PropertyMap;
