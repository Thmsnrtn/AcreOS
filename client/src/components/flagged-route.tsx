/**
 * FlaggedRoute — a customer route behind a server-driven feature flag.
 *
 * When the flag is off, the route is a feature that exists but is not
 * switched on for this account. It used to render the generic 404 page,
 * which tells the customer the address is wrong or the page was deleted —
 * neither true, and the 404 offers no reason and no way back into the work.
 * It now renders a neutral "not available" EmptyState inside the normal app
 * shell, so the five doors stay one click away.
 *
 * No nav entry is added: the route keeps living wherever it already lived.
 * A server-emitted link must still not target a flagged route
 * (serverEmittedLinksResolve.test.ts) — "not available" is honest, but it
 * is still not the thing the link promised.
 */

import React, { Suspense, lazy } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { RouteFallback } from "@/components/route-fallback";

// The not-available view loads on demand: FlaggedRoute is in the entry
// bundle, and the view is only needed when a flag is off.
const FeatureNotAvailable = lazy(() => import("./flagged-route-unavailable"));

export function FlaggedRoute({ route, component: Component }: { route: string; component: React.ComponentType }) {
  const { user, isLoading: authLoading } = useAuth();
  const { isRouteEnabled, isLoading: flagsLoading } = useFeatureFlags();

  if (authLoading || flagsLoading) {
    return <RouteFallback />;
  }

  if (!user) return <Redirect to="/auth" />;
  if (!isRouteEnabled(route)) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <FeatureNotAvailable />
      </Suspense>
    );
  }
  return <Component />;
}
