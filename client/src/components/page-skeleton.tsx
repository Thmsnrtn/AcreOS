/**
 * PageSkeleton — W2-5 primitive for the spinner-only long-tail pages.
 *
 * The ~50 C-grade pages share three content layouts; each variant mirrors
 * its layout class's real shape (per CLAUDE.md: skeletons match content
 * shape, never spinners):
 *
 *   - "table" — stat-card row + table header + data rows
 *   - "list"  — rows of avatar + two-line text + trailing action
 *   - "form"  — stacked label/input field pairs + submit row
 *
 * Usage: replace the page-level `Loader2` loading return:
 *
 *   if (isLoading) return <PageSkeleton variant="table" />;
 *
 * The skeleton covers the CONTENT region only — pages keep rendering their
 * own static headers/toolbars above it. Announces loading exactly once at
 * the root (`role="status"`); inner Skeletons are decorative
 * (`announce={false}`) to avoid duplicate screen-reader announcements.
 * `animate-pulse` is collapsed globally under prefers-reduced-motion via
 * index.css.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type PageSkeletonVariant = "table" | "list" | "form";

export interface PageSkeletonProps {
  variant: PageSkeletonVariant;
  /** "table" only: stat cards above the table. Default 4; pass 0 to hide. */
  statCards?: number;
  /** Row count. Default: 8 (table), 6 (list). Ignored by "form". */
  rows?: number;
  /** "form" only: label+input pairs. Default 6. */
  fields?: number;
  /** Screen-reader announcement. Default "Loading page". */
  announceText?: string;
  className?: string;
}

// Column width rhythm for table cells — varied widths read as real data,
// uniform bars read as stripes.
const TABLE_CELL_WIDTHS = ["w-32", "w-24", "w-20", "w-16"] as const;

function TableVariant({ statCards, rows }: { statCards: number; rows: number }) {
  return (
    <>
      {statCards > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: statCards }).map((_, i) => (
            <Card key={i} data-testid={`page-skeleton-stat-${i}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <Skeleton announce={false} className="h-4 w-24" />
                <Skeleton announce={false} className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton announce={false} className="h-8 w-20 mb-1" />
                <Skeleton announce={false} className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 pb-3 border-b" data-testid="page-skeleton-table-header">
            {TABLE_CELL_WIDTHS.map((w, i) => (
              <Skeleton
                announce={false}
                key={i}
                className={cn("h-4", w, i === TABLE_CELL_WIDTHS.length - 1 && "ml-auto")}
              />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3" data-testid={`page-skeleton-row-${i}`}>
              {TABLE_CELL_WIDTHS.map((w, j) => (
                <Skeleton
                  announce={false}
                  key={j}
                  className={cn("h-4", w, j === TABLE_CELL_WIDTHS.length - 1 && "ml-auto")}
                />
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function ListVariant({ rows }: { rows: number }) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3" data-testid={`page-skeleton-row-${i}`}>
          <Skeleton announce={false} className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton announce={false} className="h-4 w-1/3 max-w-48" />
            <Skeleton announce={false} className="h-3 w-1/2 max-w-64" />
          </div>
          <Skeleton announce={false} className="h-6 w-16 shrink-0" />
        </div>
      ))}
      </CardContent>
    </Card>
  );
}

function FormVariant({ fields }: { fields: number }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <Skeleton announce={false} className="h-5 w-40" />
        <Skeleton announce={false} className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-6">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2" data-testid={`page-skeleton-field-${i}`}>
            <Skeleton announce={false} className="h-4 w-28" />
            <Skeleton announce={false} className="h-10 w-full" />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Skeleton announce={false} className="h-10 w-24" />
          <Skeleton announce={false} className="h-10 w-32" />
        </div>
      </CardContent>
    </Card>
  );
}

export function PageSkeleton({
  variant,
  statCards = 4,
  rows,
  fields = 6,
  announceText = "Loading page",
  className,
}: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("space-y-6", className)}
      data-testid={`page-skeleton-${variant}`}
    >
      <span className="sr-only">{announceText}</span>
      {variant === "table" && <TableVariant statCards={statCards} rows={rows ?? 8} />}
      {variant === "list" && <ListVariant rows={rows ?? 6} />}
      {variant === "form" && <FormVariant fields={fields} />}
    </div>
  );
}
