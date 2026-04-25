import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FiltersChip({ onClick, count = 0, className, testId }: { onClick: () => void; count?: number; className?: string; testId?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-label={count > 0 ? `Filters, ${count} active` : "Filters"}
      className={cn("md:hidden rounded-full px-3 h-8", className)}
      data-testid={testId || "button-filters-chip"}
    >
      <Filter className="w-4 h-4 mr-1" aria-hidden="true" />
      Filters{count > 0 ? <> (<span className="tabular-nums">{count}</span>)</> : ""}
    </Button>
  );
}
