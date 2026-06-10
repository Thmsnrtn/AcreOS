import { useEffect, useState } from "react";
import { Sidebar, useSidebarCollapsed } from "@/components/layout-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { ErrorBoundary } from "@/components/error-boundary";
import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { usePaxRail } from "@/contexts/pax-rail-context";
import { UsageLimitBanner } from "@/components/usage-limit-banner";
import { NotificationStack } from "@/components/notification-stack";
import { LegalHoldBanner } from "@/components/legal-hold-banner";

/**
 * Read document.title and strip the " · AcreOS" suffix that useDocumentTitle
 * appends. Falls back to "Main content" when nothing useful is set yet.
 * Re-runs on each render — the consumer's useDocumentTitle effect runs in the
 * same commit, so the value is current by the second render in practice.
 */
function useDocumentTitleFallback(explicit: string | undefined): string {
  const [value, setValue] = useState<string>(() => deriveTitle(explicit));
  useEffect(() => {
    setValue(deriveTitle(explicit));
  }, [explicit]);
  return value;
}

function deriveTitle(explicit: string | undefined): string {
  if (explicit) return explicit;
  if (typeof document === "undefined") return "Main content";
  const t = document.title || "";
  const stripped = t.replace(/\s·\sAcreOS$/, "").trim();
  return stripped || "Main content";
}

interface PageShellProps {
  children: React.ReactNode;
  /** Show full-page loading skeleton instead of children */
  isLoading?: boolean;
  /** Custom loading fallback (overrides default skeleton) */
  loadingFallback?: React.ReactNode;
  /** Max width of the content area. Defaults to "7xl". */
  maxWidth?: "4xl" | "5xl" | "6xl" | "7xl";
  /** Accessible label for the main content region */
  label?: string;
  /**
   * T0-9 — render content-only (no sidebar / topbar / `<main id="main-content">`).
   *
   * Set this when the page is mounted INSIDE another page that already
   * renders a PageShell (e.g. finance.tsx + portfolio.tsx inside the
   * /money tabs, deals/leads/properties inside /pipeline). Without it the
   * embedded page nested a second full app shell: duplicate sidebar +
   * topbar, a second `id="main-content"` (invalid HTML — breaks the skip
   * link), two H1s, and doubled left margin. Same class of bug that
   * command-center.tsx (~:1909) was de-shelled for.
   */
  embedded?: boolean;
}

/**
 * Standard page layout wrapper.
 *
 * Provides:
 * - Sidebar
 * - Responsive main content area with consistent padding/margins
 * - Per-page error boundary so a crash in one page doesn't nuke the app
 * - Optional loading state
 *
 * Usage:
 * ```tsx
 * export default function MyPage() {
 *   const { data, isLoading } = useQuery(...);
 *   return (
 *     <PageShell isLoading={isLoading}>
 *       {/* page content *\/}
 *     </PageShell>
 *   );
 * }
 * ```
 */
const MAX_WIDTH_CLASSES = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
} as const;

export function PageShell({ children, isLoading, loadingFallback, maxWidth = "7xl", label, embedded }: PageShellProps) {
  const { isCollapsed } = useSidebarCollapsed();
  const { isOpen: railOpen } = usePaxRail();
  const resolvedLabel = useDocumentTitleFallback(label);
  // Embedded mode: the parent PageShell already provides sidebar, topbar,
  // skip link, main landmark, banners, and outer padding — render only the
  // page content (still inside its own ErrorBoundary so a crash in an
  // embedded tab doesn't take down the host page).
  if (embedded) {
    return (
      <div className="space-y-6 md:space-y-8">
        <ErrorBoundary>
          {isLoading ? (loadingFallback ?? <PageShellSkeleton />) : children}
        </ErrorBoundary>
      </div>
    );
  }
  // min-h-[100dvh] (not min-h-screen / 100vh) so iOS Safari's dynamic
  // address bar doesn't cause content to overflow the visible viewport.
  return (
    <div
      className="flex min-h-[100dvh] desert-gradient isolate"
      // env(safe-area-inset-top) keeps the top bar clear of the iOS dynamic
      // island / notch in standalone PWA mode. Desktop reads it as 0.
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      {/* The global skip link lives in App.tsx (`.skip-to-content`, 44px
          target). A second one here double-announces "skip" to screen
          readers and trips the touch-target contract (1×1 sr-only rect),
          so PageShell only provides the #main-content landmark. */}
      <Sidebar />
      <div
        className={`flex-1 flex flex-col min-w-0 content-spring will-change-[margin-left] transition-[margin-right] duration-200 ${
          isCollapsed ? "md:ml-[76px]" : "md:ml-[17rem]"
        } ${railOpen ? "md:mr-[360px]" : "md:mr-12"}`}
      >
        <PageTopbar title={resolvedLabel === "Main content" ? undefined : resolvedLabel} />
        <main
          id="main-content"
          aria-label={resolvedLabel}
          className="flex-1 p-4 md:p-8 pb-8 mobile-safe-content overflow-x-hidden"
        >
        <NotificationStack>
          {/* legal hold outranks a usage warning */}
          <LegalHoldBanner />
          <UsageLimitBanner />
        </NotificationStack>
        <div className={`${MAX_WIDTH_CLASSES[maxWidth]} mx-auto space-y-6 md:space-y-8 page-enter`}>
          <ErrorBoundary>
            {isLoading
              ? (loadingFallback ?? <PageShellSkeleton />)
              : children}
          </ErrorBoundary>
        </div>
        </main>
      </div>
    </div>
  );
}

/** Default full-page loading skeleton */
function PageShellSkeleton() {
  return (
    <div className="space-y-6" data-testid="skeleton-page-shell" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading page…</span>
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-xl skeleton-shimmer" aria-hidden="true" />
        ))}
      </div>
      <div className="h-64 rounded-xl skeleton-shimmer" aria-hidden="true" />
    </div>
  );
}
