/**
 * entity-table/types — typed column defs for the shared table/list kit
 * (handoff P1 §2.2 "One table/list kit to rule them all", Wave 1.4).
 *
 * A column def is the unit of configuration: header, cell renderer, widths,
 * alignment, and (optionally) sortability. Pages declare an
 * `EntityColumn<T>[]` and hand it to `EntityTable`; the next list surface
 * costs a config object instead of hand-rolled `<table>` scaffolding.
 */
import type { ReactNode } from "react";

/** Active sort state: which column, which direction. */
export interface EntityTableSort {
  columnId: string;
  direction: "asc" | "desc";
}

export interface EntityColumn<T> {
  /** Stable identifier — referenced by sort state. */
  id: string;
  /** Header content. A string is used directly for aria labels. */
  header: ReactNode;
  /**
   * Plain-text column name for aria (sort-button label). Required in
   * practice when `header` is not a plain string and the column sorts.
   */
  headerLabel?: string;
  /** Cell renderer. The kit renders data it is given — no fetching here. */
  cell: (item: T, index: number) => ReactNode;
  /** Extra classes on the `<th>` (widths live here, e.g. "min-w-[120px]"). */
  headClassName?: string;
  /** Extra classes on the `<td>`, static or per-row. */
  cellClassName?: string | ((item: T) => string);
  /** "right" applies text-right to both header and cells. Default left. */
  align?: "left" | "right";
  /**
   * Sortable header. Cycle on click: none → desc → asc → none (numeric-first
   * convention — matches the Leads score sort this generalizes).
   * Controlled pages pass `sort`+`onSortChange` on the table; uncontrolled
   * pages provide `sortAccessor` and the kit sorts internally.
   */
  sortable?: boolean;
  /** Uncontrolled sorting: comparable value per row. */
  sortAccessor?: (item: T) => string | number | null | undefined;
  /** data-testid for the sort button (default `entity-sort-<id>`). */
  sortTestId?: string;
}
