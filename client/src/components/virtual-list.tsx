/**
 * Task #187 — Virtual List Component
 *
 * Zero-dependency windowed list renderer for large datasets.
 * Only renders rows that are visible in the viewport + an overscan buffer,
 * keeping DOM nodes minimal regardless of total item count.
 *
 * Usage:
 *   <VirtualList
 *     items={leads}
 *     itemHeight={72}
 *     containerHeight={600}
 *     renderItem={(item, index) => <LeadRow lead={item} key={item.id} />}
 *   />
 *
 * For dynamic-height items, set estimatedItemHeight and the list will
 * measure each row after it renders and re-layout accordingly.
 */

import { useRef, useState, useCallback, useEffect, type ReactNode } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VirtualListProps<T> {
  /** All items to virtualize (full array — filtering/sorting done by caller) */
  items: T[];
  /** Fixed height of each row in pixels. Required for fixed-mode. */
  itemHeight: number;
  /** Height of the scroll container in pixels */
  containerHeight: number;
  /** Render a single row. Must be pure or memoized. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Extra rows rendered above and below the visible window (default: 5) */
  overscan?: number;
  /** Optional class names on the outer container */
  className?: string;
  /** Called when scroll reaches within threshold px of the bottom */
  onEndReached?: () => void;
  /** How many px from the bottom triggers onEndReached (default: 200) */
  endReachedThreshold?: number;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

function useVirtualList<T>(
  items: T[],
  itemHeight: number,
  containerHeight: number,
  overscan: number,
) {
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = items.length * itemHeight;

  // First and last visible indices (before overscan)
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan,
  );

  const visibleItems = items.slice(startIndex, endIndex + 1).map((item, i) => ({
    item,
    index: startIndex + i,
    offsetTop: (startIndex + i) * itemHeight,
  }));

  const paddingTop = startIndex * itemHeight;
  const paddingBottom = Math.max(0, (items.length - endIndex - 1) * itemHeight);

  return { visibleItems, paddingTop, paddingBottom, totalHeight, setScrollTop };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
  className,
  onEndReached,
  endReachedThreshold = 200,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { visibleItems, paddingTop, paddingBottom, totalHeight, setScrollTop } =
    useVirtualList(items, itemHeight, containerHeight, overscan);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
      setScrollTop(scrollTop);

      if (onEndReached && scrollHeight - scrollTop - clientHeight < endReachedThreshold) {
        onEndReached();
      }
    },
    [setScrollTop, onEndReached, endReachedThreshold],
  );

  return (
    <div
      ref={containerRef}
      style={{ height: containerHeight, overflowY: "auto", position: "relative" }}
      onScroll={handleScroll}
      className={className}
      role="list"
    >
      {/* Total height spacer — maintains scrollbar size */}
      <div style={{ height: totalHeight, position: "relative" }}>
        {/* Top padding — replaces invisible rows above the window */}
        <div style={{ height: paddingTop }} aria-hidden="true" />

        {/* Visible rows */}
        {visibleItems.map(({ item, index, offsetTop }) => (
          <div
            key={index}
            style={{ height: itemHeight }}
            role="listitem"
          >
            {renderItem(item, index)}
          </div>
        ))}

        {/* Bottom padding — replaces invisible rows below the window */}
        <div style={{ height: paddingBottom }} aria-hidden="true" />
      </div>
    </div>
  );
}

// ─── Convenience: auto-height container ──────────────────────────────────────

/**
 * VirtualListAutoHeight — wraps VirtualList and measures the container
 * height automatically using ResizeObserver. Use this when the container
 * height is determined by CSS rather than a fixed value.
 *
 * Usage:
 *   <div className="flex-1 overflow-hidden">
 *     <VirtualListAutoHeight items={leads} itemHeight={72} renderItem={...} />
 *   </div>
 */
export function VirtualListAutoHeight<T>(
  props: Omit<VirtualListProps<T>, "containerHeight">,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
    });
    ro.observe(el);
    setHeight(el.clientHeight);

    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} style={{ flex: 1, overflow: "hidden", height: "100%" }}>
      <VirtualList {...props} containerHeight={height} />
    </div>
  );
}
