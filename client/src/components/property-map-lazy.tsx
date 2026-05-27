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
import { Skeleton } from "@/components/ui/skeleton";

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

export function PropertyMap(props: React.ComponentProps<typeof PropertyMapLazy>) {
  return (
    <Suspense fallback={<MapFallback className="h-full w-full" />}>
      <PropertyMapLazy {...props} />
    </Suspense>
  );
}

export function SinglePropertyMap(props: React.ComponentProps<typeof SinglePropertyMapLazy>) {
  return (
    <Suspense fallback={<MapFallback className="h-full w-full" />}>
      <SinglePropertyMapLazy {...props} />
    </Suspense>
  );
}

export function StaticPropertyMap(props: React.ComponentProps<typeof StaticPropertyMapLazy>) {
  return (
    <Suspense fallback={<MapFallback className="h-full w-full" />}>
      <StaticPropertyMapLazy {...props} />
    </Suspense>
  );
}

export default PropertyMap;
