/**
 * FounderApp — the root of the FOUNDER build (dist/founder, entry
 * client/src/founder-main.tsx). P1-9 / X-2: the founder's pages ship in their
 * own Vite output so none of their code is in the customer bundle.
 *
 * It holds the same provider stack as the customer App (theme, query client,
 * sidebar, tenant theme, feature flags, …) so shared shell components such as
 * PageShell and the sidebar behave identically, but only the founder route
 * tree (./founder-routes) and the founder-only chrome: the founder mobile nav
 * and the Atlas Dock. Customer-only chrome (trial banner, NPS, Pax copilot
 * rail, team chat, quick-add, deal modals, cookie banner) is not mounted.
 *
 * Authorization is unchanged — this is a build-time split. Founder access is
 * enforced server-side (requireFounder on /api/founder); FounderProtectedRoute
 * is UX gating only. Paths owned by the customer build (/today, /auth, org
 * switch, …) leave this app with a full page load (components/cross-build-
 * redirect.tsx), because wouter cannot navigate between bundles.
 */
import React, { Suspense } from "react";
import { useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { telemetry } from "@/lib/telemetry";
import { setSentryUser } from "@/lib/sentry";
import { identifyUser } from "@/lib/analytics";
import { ThemeProvider } from "@/contexts/theme-context";
import { TenantThemeProvider } from "@/contexts/tenant-theme-context";
import { FeatureFlagsProvider } from "@/contexts/feature-flags-context";
import { AccessibilityProvider } from "@/contexts/accessibility-context";
import { PaxRailProvider } from "@/contexts/pax-rail-context";
import { DynamicIslandProvider } from "@/contexts/dynamic-island-context";
import { SidebarProvider } from "@/components/layout-sidebar";
import { HintsProvider } from "@/components/feature-hints";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import { ErrorBoundary } from "@/components/error-boundary";
import { OfflineIndicator } from "@/components/offline-indicator";
import { RouteFallback } from "@/components/route-fallback";
import { PageWrapper } from "@/components/page-wrapper";
import { FounderMobileBottomNav } from "@/components/mobile/FounderMobileBottomNav";
import { usePageContext } from "@/hooks/use-page-context";
import { useRouteHeadingFocus } from "@/hooks/use-route-heading-focus";
import { useCursorGlass } from "@/hooks/use-cursor-glass";
import { useRenderSentinel } from "@/hooks/use-render-sentinel";
import { installViewTransitions } from "@/lib/view-transitions";
import { FounderRoutes } from "./founder-routes";

const KeyboardShortcutsModal = React.lazy(() => import("@/components/keyboard-shortcuts").then(m => ({ default: m.KeyboardShortcutsModal })));
const CommandPalette = React.lazy(() => import("@/components/command-palette").then(m => ({ default: m.CommandPalette })));
// Phase D — Atlas Dock follows Tom across every founder surface.
const AtlasDock = React.lazy(() => import("@/components/founder-chat/Dock").then(m => ({ default: m.Dock })));

/**
 * AtlasDockHost — thin wrapper that resolves the current page context
 * (route + URL params) and hands it to the lazy Dock.
 */
function AtlasDockHost() {
  const pageContext = usePageContext();
  // Subscribe to the global "atlas:discuss" event so any artifact card
  // can request the dock open with a prefilled question. See
  // client/src/lib/atlas-discuss.ts for the publisher helper.
  const [prefill, setPrefill] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      setPrefill(detail?.message ?? undefined);
    };
    window.addEventListener("atlas:discuss", handler);
    return () => window.removeEventListener("atlas:discuss", handler);
  }, []);
  return <AtlasDock pageContext={pageContext} prefillMessage={prefill} />;
}

function FounderRouter() {
  const [pathname] = useLocation();
  // After a client-side navigation move focus to the new page's H1 so the
  // destination is announced (same Tier 3C keyboard layer as the customer app).
  useRouteHeadingFocus(pathname);
  return (
    <React.Suspense fallback={<RouteFallback />}>
      <FounderRoutes />
    </React.Suspense>
  );
}

function FounderContent() {
  const { user } = useAuth();
  const [location] = useLocation();
  useCursorGlass();
  // Blank-render sentinel: detects a mounted-but-unpainted page (stalled
  // animation engine on iOS Safari), self-heals, and reports the trip.
  useRenderSentinel();

  React.useEffect(() => {
    if (user) {
      telemetry.sessionStart();
      // Tag Sentry events with the authenticated user (cleared on logout).
      setSentryUser({ id: user.id, email: user.email ?? undefined });
      identifyUser(String(user.id), {
        persona: user.persona ?? "land_investor",
        email: user.email ?? undefined,
      });
    } else {
      setSentryUser(null);
    }
  }, [user]);

  return (
    <>
      <a href="#main-content" className="skip-to-content" aria-label="Skip to main content">
        Skip to content
      </a>
      <PageWrapper>
        <FounderRouter />
      </PageWrapper>
      {user && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
      {/* The founder's own mobile nav (F-D22: mobile founders were stranded
          with no nav). Shown on every founder-build page, including the
          founder-gated pages at non-/founder URLs, which no longer have the
          customer bottom nav to fall back on. */}
      {user && <FounderMobileBottomNav />}
      {/* Atlas Dock — appears on every /founder/* page EXCEPT /founder itself
          (which IS the chat shell — dual surfaces would duplicate the UI).
          Page-context is auto-resolved from the current location so Atlas can
          answer "what am I looking at?". */}
      {user && location.startsWith("/founder") && location !== "/founder" && (
        <Suspense fallback={null}>
          <AtlasDockHost />
        </Suspense>
      )}
    </>
  );
}

// F-D12: pass wouter's location to the ErrorBoundary so a per-route crash
// doesn't trap the user — boundary clears its error state on next nav.
function LocationAwareErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

export default function FounderApp() {
  React.useEffect(() => {
    installViewTransitions();
  }, []);

  return (
    <LocationAwareErrorBoundary>
      <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <AccessibilityProvider>
        <SidebarProvider>
          <PaxRailProvider>
          <DynamicIslandProvider>
          <QueryClientProvider client={queryClient}>
            <TenantThemeProvider>
            <FeatureFlagsProvider>
            <TooltipProvider>
              <HintsProvider>
                <KeyboardShortcutsProvider>
                  <OfflineIndicator />
                  <Toaster />
                  <FounderContent />
                  <Suspense fallback={null}>
                    <KeyboardShortcutsModal />
                  </Suspense>
                </KeyboardShortcutsProvider>
              </HintsProvider>
            </TooltipProvider>
            </FeatureFlagsProvider>
            </TenantThemeProvider>
          </QueryClientProvider>
          </DynamicIslandProvider>
          </PaxRailProvider>
        </SidebarProvider>
        </AccessibilityProvider>
      </ThemeProvider>
      </MotionConfig>
    </LocationAwareErrorBoundary>
  );
}
