/**
 * PrefetchLink — wouter Link that warms the destination route's data
 * cache on hover/focus, so navigation feels instant.
 *
 * Apple-grade SaaS apps (Linear, Stripe) prefetch the next route the
 * moment your cursor crosses the link. Result: by the time the click
 * fires, the page's primary query is already cached and the new view
 * paints in <50ms instead of waiting on a round-trip.
 *
 * Usage:
 *   <PrefetchLink href="/leads">Leads</PrefetchLink>
 *   <PrefetchLink href="/properties" prefetchKeys={["/api/properties", "/api/properties/stats"]}>
 *     Properties
 *   </PrefetchLink>
 *
 * By default we infer the primary query key from the href:
 *   /leads        → /api/leads
 *   /properties   → /api/properties
 *   /deals        → /api/deals
 *   /today        → /api/dashboard/stats + /api/me/today
 *   /money, /notes → /api/notes
 *   /campaigns, /outreach → /api/campaigns
 * Override via `prefetchKeys` for routes whose canonical query isn't
 * obvious from the URL.
 */
import { type AnchorHTMLAttributes, type ReactNode, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

interface PrefetchLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: ReactNode;
  /**
   * Explicit query keys to prefetch. When omitted, sensible defaults
   * are inferred from the href via inferKeys().
   */
  prefetchKeys?: string[];
  /**
   * Disable prefetching for this link (e.g. external links or routes
   * with no canonical query).
   */
  noPrefetch?: boolean;
  /**
   * How long the prefetched data is considered fresh. Defaults to 30s
   * — long enough to bridge a hover→click, short enough to not poison
   * cache with stale data.
   */
  staleTime?: number;
}

/**
 * Map a route path to its canonical primary query key(s). Conservative
 * by default — keys that already match the page's useQuery call mean
 * the prefetch hits the same cache entry the page reads from.
 */
function inferKeys(href: string): string[] {
  const path = href.split("?")[0].replace(/\/$/, "");
  switch (path) {
    case "/today":
      return ["/api/dashboard/stats", "/api/me/today"];
    case "/leads":
      return ["/api/leads"];
    case "/properties":
      return ["/api/properties"];
    case "/deals":
      return ["/api/deals"];
    case "/campaigns":
    case "/outreach":
      return ["/api/campaigns"];
    case "/money":
    case "/notes":
      return ["/api/notes"];
    case "/portfolio":
      return ["/api/portfolio"];
    case "/cash-flow":
      return ["/api/cash-flow"];
    case "/inbox":
      return ["/api/inbox"];
    case "/analytics":
      return ["/api/analytics"];
    case "/activity":
      return ["/api/activity"];
    case "/tasks":
      return ["/api/tasks"];
    case "/settings":
      return ["/api/me/preferences"];
    default:
      return [];
  }
}

export function PrefetchLink({
  href,
  children,
  prefetchKeys,
  noPrefetch = false,
  staleTime = 30_000,
  onMouseEnter,
  onFocus,
  ...rest
}: PrefetchLinkProps) {
  const queryClient = useQueryClient();
  // Once-per-mount guard so the same link doesn't prefetch repeatedly
  // when the user hovers/leaves/hovers again. The cache entry persists
  // for staleTime so the second hover is a no-op anyway, but this
  // avoids the extra react-query call.
  const prefetched = useRef<Set<string>>(new Set());

  const doPrefetch = useCallback(() => {
    if (noPrefetch) return;
    const keys = prefetchKeys ?? inferKeys(href);
    for (const key of keys) {
      if (prefetched.current.has(key)) continue;
      prefetched.current.add(key);
      // Fire-and-forget — react-query handles its own errors + caching.
      void queryClient.prefetchQuery({ queryKey: [key], staleTime });
    }
  }, [queryClient, href, prefetchKeys, noPrefetch, staleTime]);

  return (
    <Link
      href={href}
      onMouseEnter={(e) => {
        doPrefetch();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        doPrefetch();
        onFocus?.(e);
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
