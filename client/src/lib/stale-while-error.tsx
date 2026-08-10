/**
 * Stale-while-error — the HOUSE PATTERN for door-page query failures
 * (master-handoff P1 §2.3, Wave 1.2).
 *
 * When a REFETCH fails but cached data exists, the surface keeps
 * rendering the cached data with a quiet warning chip — "Showing data
 * from {time} — Retry" — instead of swapping the whole door to an error
 * card. Only when there is NO cached data does the surface fall back to
 * a full `QueryErrorState`.
 *
 * Honesty boundary (refuse-not-fabricate): the chip always names the
 * data as stale — cached data is never silently presented as fresh, a
 * failed fetch is never dressed up as an empty state, and when the
 * cache's timestamp is unknown (react-query placeholderData reports
 * `dataUpdatedAt: 0`) the chip says "previously loaded" rather than
 * inventing a time.
 *
 * Three exports, smallest useful surface:
 *   - `getQueryDegradation(q)` — classify a query result: "ok" (no
 *     error), "stale" (error, but cached data to keep rendering), or
 *     "error" (error and nothing cached).
 *   - `StaleDataChip` — the quiet warning chip (role="status", real
 *     Retry button). Pages with bespoke layouts render it directly.
 *   - `StaleWhileError` — wrapper for self-contained sections: renders
 *     children (+ chip when stale) or QueryErrorState when nothing is
 *     cached.
 */

import type { ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryErrorState } from "@/components/query-error-state";

export type QueryDegradation = "ok" | "stale" | "error";

/**
 * The subset of a `UseQueryResult` the primitive needs. Structural, so
 * a react-query result object can be passed straight through.
 */
export interface StaleWhileErrorQuery<TData = unknown> {
  data: TData | undefined;
  isError: boolean;
  error: unknown;
  /** Epoch ms of the last successful fetch; 0 = unknown (placeholder). */
  dataUpdatedAt: number;
  refetch: () => unknown;
  isRefetching: boolean;
}

/** Classify how a query surface should degrade. */
export function getQueryDegradation(q: {
  isError: boolean;
  data: unknown;
}): QueryDegradation {
  if (!q.isError) return "ok";
  return q.data !== undefined ? "stale" : "error";
}

/**
 * Human phrasing for "how old is what you're looking at". Exported for
 * the unit test; `dataUpdatedAt <= 0` means react-query doesn't know
 * (placeholderData borrowed from another cache entry), so we refuse to
 * invent a timestamp.
 */
export function staleSinceText(dataUpdatedAt: number): string {
  if (dataUpdatedAt > 0) {
    return `Showing data from ${formatDistanceToNow(dataUpdatedAt, { addSuffix: true })}`;
  }
  return "Showing previously loaded data";
}

export interface StaleDataChipProps {
  /** The query's `dataUpdatedAt` (epoch ms). Pass 0 when unknown. */
  dataUpdatedAt: number;
  /** Triggers the query's refetch. A real button, keyboard-reachable. */
  onRetry: () => void;
  isRetrying?: boolean;
  className?: string;
  testId?: string;
}

/**
 * The quiet warning chip. `role="status"` so screen readers announce
 * the degradation without an interruptive alert — the data on screen is
 * still real, just stale.
 */
export function StaleDataChip({
  dataUpdatedAt,
  onRetry,
  isRetrying = false,
  className = "",
  testId = "stale-data-chip",
}: StaleDataChipProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={`flex items-center gap-2 rounded-md border border-acr-warn/40 bg-acr-warn-soft px-3 py-1.5 text-xs text-acr-warn ${className}`}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1" data-testid={`${testId}-text`}>
        {staleSinceText(dataUpdatedAt)} — couldn't refresh just now.
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={isRetrying}
        className="h-7 shrink-0 px-2 text-xs"
        data-testid={`${testId}-retry`}
      >
        <RefreshCw
          className={`mr-1 h-3 w-3 ${isRetrying ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        {isRetrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}

export interface StaleWhileErrorProps {
  query: StaleWhileErrorQuery;
  /** Content rendered from the (possibly cached) data. */
  children: ReactNode;
  /** Title for the no-cached-data QueryErrorState fallback. */
  errorTitle?: string;
  errorDescription?: string;
  /** Compact QueryErrorState (inline card instead of full-bleed). */
  compact?: boolean;
  testId?: string;
  chipClassName?: string;
}

/**
 * Wrapper form for self-contained sections: keeps rendering `children`
 * with a stale chip when a refetch fails over cached data; falls back
 * to `QueryErrorState` only when nothing is cached.
 */
export function StaleWhileError({
  query,
  children,
  errorTitle,
  errorDescription,
  compact = false,
  testId = "stale-while-error",
  chipClassName = "mb-4",
}: StaleWhileErrorProps) {
  const degradation = getQueryDegradation(query);

  if (degradation === "error") {
    return (
      <QueryErrorState
        error={query.error instanceof Error ? query.error : null}
        onRetry={() => query.refetch()}
        isRetrying={query.isRefetching}
        title={errorTitle}
        description={errorDescription}
        compact={compact}
        testId={`${testId}-error`}
      />
    );
  }

  return (
    <>
      {degradation === "stale" && (
        <StaleDataChip
          dataUpdatedAt={query.dataUpdatedAt}
          onRetry={() => query.refetch()}
          isRetrying={query.isRefetching}
          className={chipClassName}
          testId={`${testId}-chip`}
        />
      )}
      {children}
    </>
  );
}
