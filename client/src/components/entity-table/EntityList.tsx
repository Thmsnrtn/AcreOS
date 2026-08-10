/**
 * EntityList — the card/stack half of the shared table/list kit
 * (handoff P1 §2.2, Wave 1.4).
 *
 * Two of the five heavy lists are not tables at HEAD: Properties renders a
 * responsive card GRID and the auction worksheet renders a STACK of
 * expandable listing cards. Converting either into `<table>` markup would
 * be a redesign; the kit instead offers the same state contract
 * (items → renderItem, loading → shape-matched skeleton, empty →
 * EmptyState-with-CTA slot) over a stack or grid container, so those pages
 * shed their local list scaffolding without changing a pixel.
 *
 * Same composition rule as EntityTable: QueryErrorState / stale chips /
 * ContentReveal live OUTSIDE. This renders the data it is given.
 */
import { Fragment, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, type EmptyStateProps } from "@/components/empty-state";
import { cn } from "@/lib/utils";

interface EntityListProps<T> {
  items: T[];
  /** Renders one list entry — the page keeps full ownership of the card. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Stable item key. Falls back to the index when omitted. */
  getItemId?: (item: T, index: number) => string | number;
  /** Loading → skeleton (never a spinner). */
  loading?: boolean;
  /** Shape-matched skeleton for the whole loading state. */
  renderSkeleton?: () => ReactNode;
  /** Rows for the fallback skeleton when renderSkeleton is not given. */
  skeletonCount?: number;
  /**
   * Empty slot when `items` is empty and not loading. Node form wins over
   * `emptyState`; pass `null` to render just the (empty) container.
   */
  empty?: ReactNode;
  /** Config form: the canonical EmptyState with its purposeful CTA. */
  emptyState?: EmptyStateProps;
  /** "stack" (vertical list) or "grid" (the container classes set columns). */
  layout?: "stack" | "grid";
  /** Container classes, e.g. "space-y-3" or "grid grid-cols-1 … gap-6". */
  className?: string;
  testId?: string;
}

export function EntityList<T>({
  items,
  renderItem,
  getItemId,
  loading = false,
  renderSkeleton,
  skeletonCount = 4,
  empty,
  emptyState,
  layout = "stack",
  className,
  testId = "entity-list",
}: EntityListProps<T>) {
  if (loading) {
    return (
      <div data-testid={`${testId}-loading`}>
        {renderSkeleton ? (
          renderSkeleton()
        ) : (
          <div className="space-y-3">
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <Skeleton key={i} className="h-16" announce={i === 0} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    const emptyNode =
      empty !== undefined ? empty : emptyState !== undefined ? <EmptyState {...emptyState} /> : null;
    if (emptyNode === null) {
      return <div className={className} data-testid={testId} />;
    }
    return (
      <div className={className} data-testid={testId}>
        {/* In a grid the empty surface spans every column, as the pages did. */}
        {layout === "grid" ? <div className="col-span-full">{emptyNode}</div> : emptyNode}
      </div>
    );
  }

  return (
    <div className={cn(className)} data-testid={testId}>
      {items.map((item, index) => {
        const key = getItemId ? getItemId(item, index) : index;
        // Fragment keying — no wrapper box, so grid columns and space-y-*
        // spacing land on the page's own item markup exactly as before.
        return <Fragment key={key}>{renderItem(item, index)}</Fragment>;
      })}
    </div>
  );
}
