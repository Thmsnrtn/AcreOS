import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

interface VirtualTableProps<T> {
  items: T[];
  estimateSize?: number;
  renderRow: (item: T, index: number) => React.ReactNode;
  renderHeader?: () => React.ReactNode;
  className?: string;
  emptyState?: React.ReactNode;
}

export function VirtualTable<T>({
  items,
  estimateSize = 56,
  renderRow,
  renderHeader,
  className = "",
  emptyState,
}: VirtualTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 10,
  });

  if (items.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={`relative overflow-auto ${className}`} ref={parentRef} style={{ height: "600px" }}>
      {renderHeader && (
        <div className="sticky top-0 z-docked bg-background border-b">
          {renderHeader()}
        </div>
      )}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderRow(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
