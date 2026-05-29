import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * NotificationStack — one ranked banner slot.
 *
 * Renders its banner children in PRIORITY ORDER (highest first) but shows only
 * ONE at a time: the highest-priority banner that actually has something to
 * say. Each banner already self-determines visibility by returning `null` when
 * it has nothing to show; `null` produces no DOM element, so the
 * `:first-child` rule below reveals the top-priority active banner and hides
 * any lower-priority ones that also rendered. No per-banner refactor needed.
 *
 * Why this exists: ~half a dozen independent banners (early-access, trial,
 * usage-limit, legal-hold, …) used to mount in parallel and stack on top of
 * each other, eating most of the viewport on mobile. This collapses each
 * cluster into a single, calm slot.
 *
 * Children MUST each render either `null` or a single in-flow root element
 * (all current banners do; dialogs/portals inside them don't count as in-flow
 * siblings). Order the children most-urgent first.
 */
export function NotificationStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("[&>*:not(:first-child)]:hidden", className)}
      data-testid="notification-stack"
    >
      {children}
    </div>
  );
}
