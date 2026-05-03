import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Filter, X } from "lucide-react";

/**
 * EmptyFilter
 * --------------------------------------------------------------------------
 * Archetype #3 — filtered list returned zero items, but data *does* exist
 * in the system overall. The fix is "clear filters", not "create new data."
 */

interface EmptyFilterProps {
  /** Number of active filters. Used for copy ("2 filters"). */
  filterCount: number;
  /** Reset all active filters. */
  onClearFilters: () => void;
  /** Optional override for headline copy. */
  headline?: string;
  /** Optional override for subtitle copy. */
  subtitle?: string;
  /** Optional override for the CTA label. Defaults to "Clear filters". */
  clearLabel?: string;
  className?: string;
}

export function EmptyFilter({
  filterCount,
  onClearFilters,
  headline,
  subtitle,
  clearLabel = "Clear filters",
  className = "",
}: EmptyFilterProps) {
  const filterWord =
    filterCount === 1 ? "filter" : "filters";
  const defaultHeadline =
    filterCount > 0
      ? `No matches for these ${filterWord}`
      : "No matches";
  const defaultSubtitle =
    filterCount > 0
      ? `${filterCount} active ${filterWord} narrowed the results to nothing. Clear them to see everything again.`
      : "Try adjusting your search terms or filters.";

  return (
    <Card
      className={`border-dashed bg-muted/20 ${className}`}
      data-testid="empty-filter"
    >
      <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div
          className="mb-4 p-3 rounded-full bg-muted/60"
          aria-hidden="true"
        >
          <Filter className="w-7 h-7 text-muted-foreground" />
        </div>

        <h3
          className="text-base font-semibold mb-1.5 text-foreground"
          data-testid="empty-filter-title"
        >
          {headline ?? defaultHeadline}
        </h3>
        <p
          className="text-sm text-muted-foreground max-w-sm mb-5"
          data-testid="empty-filter-subtitle"
        >
          {subtitle ?? defaultSubtitle}
        </p>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClearFilters}
          aria-label={clearLabel}
          data-testid="empty-filter-clear"
          className="gap-1.5"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          {clearLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
