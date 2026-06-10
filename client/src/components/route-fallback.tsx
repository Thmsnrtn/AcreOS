/**
 * RouteFallback — door-shaped Suspense fallback for lazy route chunks
 * (Tier 3C perceived-speed doctrine, elevation blueprint).
 *
 * Replaces the centered spinner that previously played while a route chunk
 * downloaded. Every door page renders PageShell (sidebar rail + topbar +
 * content column), so the fallback paints THAT silhouette with Skeletons —
 * the page appears to assemble in place instead of flashing
 * spinner → blank → content. Mirrors PageShell's geometry (17rem rail on
 * md+, p-4/md:p-8 content, max-w-7xl) so there is no layout shift when the
 * real chunk mounts.
 */
import { Skeleton } from "@/components/ui/skeleton";

export function RouteFallback() {
  return (
    <div
      className="flex min-h-[100dvh] bg-background"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="route-fallback"
    >
      <span className="sr-only">Loading page…</span>
      {/* Sidebar rail silhouette — desktop only, like the real Sidebar. */}
      <div
        className="hidden md:flex w-[17rem] shrink-0 flex-col gap-3 border-r border-border p-4"
        aria-hidden="true"
      >
        <Skeleton className="h-9 w-32" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>
      </div>
      {/* Topbar + content column silhouette. */}
      <div className="flex-1 flex flex-col min-w-0" aria-hidden="true">
        <div className="h-14 border-b border-border flex items-center px-4 md:px-8">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex-1 p-4 md:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            <Skeleton className="h-8 w-56" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
