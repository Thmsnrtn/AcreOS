/**
 * EntityTable — the shared table kit (handoff P1 §2.2, Wave 1.4).
 *
 * One assembled composition over the shadcn table primitives: typed column
 * defs, sortable headers (aria-sort announced), optional sticky header,
 * row click-through, shape-matched skeleton rows, an EmptyState-with-CTA
 * empty slot, and j/k + Enter keyboard row navigation. The five heavy lists
 * (leads, properties, rent-roll, the Finance notes book, auction-worksheet)
 * render through this instead of hand-rolled `<table>` scaffolding.
 *
 * COMPOSITION WITH ERROR HONESTY (slice 6 / §2.3): QueryErrorState, the
 * stale-while-error chip, and ContentReveal live OUTSIDE this component.
 * EntityTable renders the data it is given — it never fetches, never guesses
 * at error states, and renders `empty` only when the caller says the list is
 * genuinely empty (a hard-failed query must never reach it as `items: []`).
 *
 * VIRTUALIZATION — deliberately absent. The legacy VirtualTable.tsx
 * (superseded by this kit; zero call sites at HEAD) positions rows as
 * absolute divs, which destroys table semantics. All five target lists bound
 * their row counts (server pagination / drawer-bounded books), so honest
 * table semantics win over speculative virtualization. If a future list
 * genuinely needs windowing, add it here behind the same column-def API
 * rather than resurrecting the div-based renderer.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, type EmptyStateProps } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { EntityColumn, EntityTableSort } from "./types";

/**
 * Density presets, matched to the paddings the five lists already use:
 * - default: shadcn (h-12/px-4 heads, p-4 cells) — leads, finance notes
 * - compact: px-3 py-2, text-xs heads — rent-roll's registers
 * - dense:   px-2 py-1, text-xs — CSV import previews
 */
type EntityTableDensity = "default" | "compact" | "dense";

const DENSITY_HEAD: Record<EntityTableDensity, string> = {
  default: "",
  compact: "h-auto px-3 py-2 text-xs",
  dense: "h-auto px-2 py-1 text-xs",
};

const DENSITY_CELL: Record<EntityTableDensity, string> = {
  default: "",
  compact: "px-3 py-2",
  dense: "px-2 py-1",
};

const DENSITY_TABLE: Record<EntityTableDensity, string> = {
  default: "",
  compact: "text-sm",
  dense: "text-xs",
};

interface EntityTableProps<T> {
  items: T[];
  columns: Array<EntityColumn<T>>;
  /** Stable row key. Falls back to the row index when omitted. */
  getRowId?: (item: T, index: number) => string | number;
  /** Loading → shape-matched skeleton rows (never a spinner). */
  loading?: boolean;
  /** How many skeleton rows to draw while loading. */
  skeletonRows?: number;
  /**
   * Empty slot, rendered as a full-width row under the header when
   * `items` is empty and not loading. Pass a node (FirstHelloEmpty /
   * EmptyFilter / custom) — or use `emptyState` for the plain
   * EmptyState-with-CTA config form. `empty` wins when both are set.
   * When neither is provided an empty list renders an empty body —
   * callers that branch to their own empty surface outside the table
   * (Finance door pattern) keep doing exactly that.
   */
  empty?: ReactNode;
  /** Config form of the empty slot: canonical EmptyState with its CTA. */
  emptyState?: EmptyStateProps;
  /** Controlled sort state (pair with onSortChange). */
  sort?: EntityTableSort | null;
  /**
   * Controlled-sort callback: receives the NEXT state for the clicked
   * column under the none → desc → asc → none cycle. When omitted, columns
   * with `sortAccessor` sort uncontrolled inside the kit.
   */
  onSortChange?: (sort: EntityTableSort | null) => void;
  /** Row click-through. Also enables Enter activation via keyboard nav. */
  onRowClick?: (item: T, index: number) => void;
  rowClassName?: string | ((item: T) => string);
  rowTestId?: (item: T) => string;
  /** Classes on the header `<tr>` (e.g. "bg-muted/50"). */
  headerRowClassName?: string;
  density?: EntityTableDensity;
  /**
   * Sticky header cells. Only effective inside a vertically scrolling
   * container — pass `maxHeight` to let the kit own that container.
   */
  stickyHeader?: boolean;
  /** e.g. "24rem" — wraps the table in its own overflow-y scroll region. */
  maxHeight?: string;
  /** Screen-reader table caption (rendered sr-only). */
  caption?: string;
  /**
   * j/k + Enter row navigation. Defaults to on when `onRowClick` exists.
   * Keys are only handled when the row itself has focus, so controls
   * inside cells keep their own keyboard behavior.
   */
  keyboardNav?: boolean;
  testId?: string;
  className?: string;
}

function nextSortFor(
  current: EntityTableSort | null | undefined,
  columnId: string,
): EntityTableSort | null {
  if (!current || current.columnId !== columnId) return { columnId, direction: "desc" };
  if (current.direction === "desc") return { columnId, direction: "asc" };
  return null;
}

function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number {
  // Nullish sorts last in both directions' base ordering.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function EntityTable<T>({
  items,
  columns,
  getRowId,
  loading = false,
  skeletonRows = 5,
  empty,
  emptyState,
  sort,
  onSortChange,
  onRowClick,
  rowClassName,
  rowTestId,
  headerRowClassName,
  density = "default",
  stickyHeader = false,
  maxHeight,
  caption,
  keyboardNav,
  testId = "entity-table",
  className,
}: EntityTableProps<T>) {
  const [internalSort, setInternalSort] = useState<EntityTableSort | null>(null);
  const controlled = onSortChange !== undefined;
  const activeSort = controlled ? (sort ?? null) : internalSort;

  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const navEnabled = keyboardNav ?? onRowClick !== undefined;

  const sortedItems = (() => {
    if (controlled || !activeSort) return items;
    const column = columns.find((c) => c.id === activeSort.columnId);
    if (!column?.sortAccessor) return items;
    const accessor = column.sortAccessor;
    const dir = activeSort.direction === "desc" ? -1 : 1;
    // Nullish stays LAST in both directions: hoisted OUT of the direction
    // multiplier, which would otherwise flip "null last" into "null first"
    // on descending sorts (fleet-7 verifier catch).
    return [...items].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null || bv == null) return compareValues(av, bv);
      return dir * compareValues(av, bv);
    });
  })();

  const handleSortClick = (column: EntityColumn<T>) => {
    const next = nextSortFor(activeSort, column.id);
    if (controlled) {
      onSortChange?.(next);
    } else {
      setInternalSort(next);
    }
  };

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(sortedItems.length - 1, index));
    rowRefs.current[clamped]?.focus();
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    item: T,
    index: number,
  ) => {
    // Only when the row itself is focused — never hijack inner controls.
    if (event.target !== event.currentTarget) return;
    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(index + 1);
    } else if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(index - 1);
    } else if ((event.key === "Enter" || event.key === " ") && onRowClick) {
      event.preventDefault();
      onRowClick(item, index);
    }
  };

  const colSpan = columns.length;
  const isEmpty = !loading && sortedItems.length === 0;
  const emptyNode =
    empty !== undefined ? empty : emptyState !== undefined ? <EmptyState {...emptyState} /> : null;

  const headLabel = (column: EntityColumn<T>): string =>
    column.headerLabel ?? (typeof column.header === "string" ? column.header : column.id);

  const sortIconFor = (column: EntityColumn<T>) => {
    if (activeSort?.columnId === column.id) {
      return activeSort.direction === "desc" ? (
        <ArrowDown className="w-3 h-3 ml-1" aria-hidden="true" />
      ) : (
        <ArrowUp className="w-3 h-3 ml-1" aria-hidden="true" />
      );
    }
    return <ArrowUpDown className="w-3 h-3 ml-1" aria-hidden="true" />;
  };

  const table = (
    <Table className={cn(DENSITY_TABLE[density], className)} data-testid={testId}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <TableHeader>
        <TableRow className={headerRowClassName}>
          {columns.map((column) => {
            const sortable = Boolean(column.sortable);
            const active = sortable && activeSort?.columnId === column.id;
            return (
              <TableHead
                key={column.id}
                className={cn(
                  DENSITY_HEAD[density],
                  column.align === "right" && "text-right",
                  stickyHeader && "sticky top-0 z-docked bg-background",
                  column.headClassName,
                )}
                aria-sort={
                  sortable
                    ? active
                      ? activeSort!.direction === "desc"
                        ? "descending"
                        : "ascending"
                      : "none"
                    : undefined
                }
              >
                {sortable ? (
                  <button
                    type="button"
                    onClick={() => handleSortClick(column)}
                    className={cn(
                      "flex items-center hover-elevate rounded px-1 -ml-1",
                      column.align === "right" && "ml-auto -mr-1",
                    )}
                    aria-label={`Sort by ${headLabel(column)}`}
                    data-testid={column.sortTestId ?? `entity-sort-${column.id}`}
                  >
                    {column.header}
                    {sortIconFor(column)}
                  </button>
                ) : (
                  column.header
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading &&
          Array.from({ length: skeletonRows }).map((_, rowIndex) => (
            <TableRow key={`skeleton-${rowIndex}`} data-testid={`${testId}-skeleton-row-${rowIndex}`}>
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  className={cn(DENSITY_CELL[density], column.align === "right" && "text-right")}
                >
                  <Skeleton
                    className={cn(
                      "h-4 w-full max-w-[120px]",
                      column.align === "right" && "ml-auto",
                    )}
                    announce={rowIndex === 0 && column.id === columns[0]?.id}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        {isEmpty && emptyNode !== null && (
          <TableRow data-testid={`${testId}-empty-row`}>
            <TableCell colSpan={colSpan} className="p-0">
              {emptyNode}
            </TableCell>
          </TableRow>
        )}
        {!loading &&
          sortedItems.map((item, index) => (
            <TableRow
              key={getRowId ? getRowId(item, index) : index}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              // Roving tabindex: one tab stop for the whole body; j/k roam.
              tabIndex={navEnabled ? (index === 0 ? 0 : -1) : undefined}
              onClick={onRowClick ? () => onRowClick(item, index) : undefined}
              onKeyDown={navEnabled ? (e) => handleRowKeyDown(e, item, index) : undefined}
              className={cn(
                typeof rowClassName === "function" ? rowClassName(item) : rowClassName,
                navEnabled &&
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              )}
              data-testid={rowTestId?.(item)}
            >
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  className={cn(
                    DENSITY_CELL[density],
                    column.align === "right" && "text-right",
                    typeof column.cellClassName === "function"
                      ? column.cellClassName(item)
                      : column.cellClassName,
                  )}
                >
                  {column.cell(item, index)}
                </TableCell>
              ))}
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );

  if (maxHeight) {
    return (
      <div className="overflow-auto" style={{ maxHeight }}>
        {table}
      </div>
    );
  }
  return table;
}
