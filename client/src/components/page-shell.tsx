import { Sidebar, useSidebarCollapsed } from "@/components/layout-sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { PageHeaderSkeleton } from "@/components/list-skeleton";

interface PageShellProps {
  children: React.ReactNode;
  /** Show full-page loading skeleton instead of children */
  isLoading?: boolean;
  /** Custom loading fallback (overrides default skeleton) */
  loadingFallback?: React.ReactNode;
  /** Max width of the content area. Defaults to "7xl". */
  maxWidth?: "4xl" | "5xl" | "6xl" | "7xl";
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

export function PageShell({ children, isLoading, loadingFallback, maxWidth = "7xl" }: PageShellProps) {
  const { isCollapsed } = useSidebarCollapsed();
  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main
        className={`flex-1 p-4 pt-16 md:pt-8 md:p-8 pb-8 overflow-x-hidden content-spring ${
          isCollapsed ? "md:ml-[76px]" : "md:ml-[17rem]"
        }`}
      >
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
