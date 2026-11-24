import type React from "react";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import { PageLoader } from "@/components/page-loader";
import { Redirect } from "@/components/cross-build-redirect";

/**
 * Client-side convenience gate for founder surfaces: renders NotFound unless
 * `useAuth().isFounder`. It is UX gating only — the boundary is server-side
 * (`requireFounder` on every /api/founder route). Used by the founder route
 * tree (client/src/founder-routes.tsx) and, for the shared /commissions page,
 * by the customer App.tsx.
 *
 * `/auth` belongs to the customer build, so from the founder build this
 * Redirect becomes a full page load (components/cross-build-redirect.tsx).
 */
export function FounderProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, isFounder } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  if (!isFounder) {
    return <NotFound />;
  }

  return <Component />;
}
