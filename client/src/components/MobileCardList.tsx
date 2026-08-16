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
    <ul className={cn("flex flex-col gap-3 list-none p-0 m-0", className)}>
      {items.map((item, index) => (
        <li key={index} className="list-none">{renderCard(item, index)}</li>
      ))}
    </ul>
  );
}

// The mobile-viewport hook that used to live here is deleted (unit 121). It was
// a SECOND `useIsMobile` — zero importers, unused in this file, and returning a
// bare boolean where the canonical `@/hooks/use-mobile` returns
// `{ isMobile, isTablet, isKeyboardOpen, isDesktop }`. Both agree the breakpoint
// is 768; they disagree on the RETURN SHAPE, and the object is always truthy —
// so anyone who auto-imported the wrong one and wrote `if (useIsMobile())` got
// the mobile branch on a 1440px desktop. Same breakpoint, opposite answer.
