import React from "react";
import { cn } from "@/lib/utils";

interface MobileCardListProps<T> {
  items: T[];
  renderCard: (item: T, index: number) => React.ReactNode;
  className?: string;
  emptyState?: React.ReactNode;
}

export function MobileCardList<T>({
  items,
  renderCard,
  className,
  emptyState,
}: MobileCardListProps<T>) {
  if (items.length === 0 && emptyState) return <>{emptyState}</>;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {items.map((item, index) => (
        <div key={index}>{renderCard(item, index)}</div>
      ))}
    </div>
  );
}

// Hook to detect mobile viewport
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );

  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return isMobile;
}
