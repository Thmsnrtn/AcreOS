import { useEffect, useState } from "react";
import { Sidebar, useSidebarCollapsed } from "@/components/layout-sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { usePaxRail } from "@/contexts/pax-rail-context";
import { UsageLimitBanner } from "@/components/usage-limit-banner";

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

export function PageShell({ children, isLoading, loadingFallback, maxWidth = "7xl", label }: PageShellProps) {
  const { isCollapsed } = useSidebarCollapsed();
  const { isOpen: railOpen } = usePaxRail();
  const resolvedLabel = useDocumentTitleFallback(label);
  return (
    <div className="flex min-h-screen desert-gradient isolate">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-background focus:text-foreground focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main
        id="main-content"
        aria-label={resolvedLabel}
        className={`flex-1 p-4 pt-16 md:pt-8 md:p-8 pb-8 overflow-x-hidden content-spring will-change-[margin-left] transition-[margin-right] duration-200 ${
          isCollapsed ? "md:ml-[76px]" : "md:ml-[17rem]"
        } ${railOpen ? "md:mr-[360px]" : "md:mr-12"}`}
      >
        <UsageLimitBanner />
        <div className={`${MAX_WIDTH_CLASSES[maxWidth]} mx-auto space-y-6 md:space-y-8 page-enter`}>
          <ErrorBoundary>
            {isLoading
              ? (loadingFallback ?? <PageShellSkeleton />)
              : children}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

/** Default full-page loading skeleton */
function PageShellSkeleton() {
  return (
    <div className="space-y-6" data-testid="skeleton-page-shell">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-xl skeleton-shimmer" />
        ))}
      </div>
      <div className="h-64 rounded-xl skeleton-shimmer" />
    </div>
  );
}
