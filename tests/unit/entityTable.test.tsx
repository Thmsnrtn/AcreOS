// @vitest-environment jsdom
/**
 * Wave 1.4 — the EntityTable kit (handoff P1 §2.2: one table/list kit).
 *
 * Two halves:
 *
 *  1. UNIT — the kit itself (client/src/components/entity-table/):
 *     rows/columns render from typed column defs; empty renders the
 *     canonical EmptyState with the CONFIGURED CTA (or a custom node);
 *     loading renders shape-matched skeleton rows and never a spinner;
 *     a sortable header cycles none → desc → asc → none, re-orders the
 *     rows (uncontrolled) and announces via aria-sort; j/k + Enter
 *     keyboard row navigation works and never hijacks inner controls.
 *     EntityList (the card/stack half) honors the same state contract.
 *
 *  2. MIGRATION PIN — derived from the five REAL page files this wave
 *     migrated. Each must import the kit and must no longer carry its
 *     prior local table/list scaffolding (raw `<table` markup, the
 *     ui/table import where it is fully retired, or the hand-rolled
 *     main-list markers where a page keeps ui/table for an unrelated
 *     non-target surface — finance.tsx's NoteDetailDrawer tables).
 *
 * Falsifiability: before this wave client/src/components/entity-table/
 * did not exist and every one of the five pages hand-rolled its own
 * table/list scaffolding, so both halves fail at the pre-wave HEAD.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import fs from "node:fs";
import path from "node:path";

import { EntityTable } from "../../client/src/components/entity-table/EntityTable";
import { EntityList } from "../../client/src/components/entity-table/EntityList";
import type { EntityColumn } from "../../client/src/components/entity-table/types";

// ─── jsdom shims (repo pattern — see doorErrorStates.test.tsx) ───────────

beforeEach(() => {
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// ─── Mount helper (react-dom/client, no @testing-library) ────────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(ui: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
  return container;
}

function rerender(ui: ReactElement) {
  act(() => {
    root!.render(ui);
  });
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function byTestId(id: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? null;
}

function keydown(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────

interface Row {
  id: number;
  name: string;
  score: number;
}

const ROWS: Row[] = [
  { id: 1, name: "Alpha", score: 10 },
  { id: 2, name: "Bravo", score: 30 },
  { id: 3, name: "Charlie", score: 20 },
];

const COLUMNS: Array<EntityColumn<Row>> = [
  { id: "name", header: "Name", cell: (r) => r.name },
  {
    id: "score",
    header: "Score",
    align: "right",
    sortable: true,
    sortAccessor: (r) => r.score,
    cell: (r) => r.score,
  },
];

const NullIcon: React.ComponentType<{ className?: string }> = () => null;

function renderedNames(): string[] {
  return Array.from(
    container!.querySelectorAll<HTMLElement>("tbody tr td:first-child"),
  ).map((td) => td.textContent ?? "");
}

// ─── 1a. Rows and columns from defs ──────────────────────────────────────

describe("EntityTable — renders rows and columns from typed defs", () => {
  it("draws one <th> per column and one <td> per column per row, with table semantics", () => {
    mount(
      <EntityTable<Row> items={ROWS} getRowId={(r) => r.id} columns={COLUMNS} testId="t" />,
    );
    const table = container!.querySelector("table");
    expect(table).not.toBeNull();
    const headers = Array.from(table!.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers[0]).toBe("Name");
    expect(headers[1]).toContain("Score");
    const rows = table!.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelectorAll("td")).toHaveLength(2);
    expect(rows[0].textContent).toContain("Alpha");
    expect(rows[1].textContent).toContain("30");
  });

  it("applies rowTestId per row and right-alignment per column def", () => {
    mount(
      <EntityTable<Row>
        items={ROWS}
        getRowId={(r) => r.id}
        columns={COLUMNS}
        rowTestId={(r) => `row-fixture-${r.id}`}
      />,
    );
    expect(byTestId("row-fixture-2")).not.toBeNull();
    const scoreCell = byTestId("row-fixture-1")!.querySelectorAll("td")[1];
    expect(scoreCell.className).toContain("text-right");
  });
});

// ─── 1b. Empty → EmptyState with the configured CTA ──────────────────────

describe("EntityTable — empty state", () => {
  it("renders the canonical EmptyState with the configured CTA (config form)", () => {
    const onCta = vi.fn();
    mount(
      <EntityTable<Row>
        items={[]}
        columns={COLUMNS}
        emptyState={{
          icon: NullIcon,
          headline: "Nothing here yet",
          cta: { label: "Add the first one", onClick: onCta, "data-testid": "kit-empty-cta" },
        }}
      />,
    );
    expect(byTestId("empty-state")).not.toBeNull();
    expect(container!.textContent).toContain("Nothing here yet");
    const cta = byTestId("kit-empty-cta")!;
    expect(cta.textContent).toContain("Add the first one");
    act(() => cta.click());
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it("renders a custom empty node (FirstHelloEmpty / EmptyFilter slot) instead when given", () => {
    mount(
      <EntityTable<Row>
        items={[]}
        columns={COLUMNS}
        empty={<div data-testid="custom-empty">filters returned nothing</div>}
      />,
    );
    expect(byTestId("custom-empty")).not.toBeNull();
    // Header row survives above the empty slot, as the leads table did.
    expect(container!.querySelectorAll("thead th")).toHaveLength(2);
  });
});

// ─── 1c. Loading → skeleton rows, never a spinner ────────────────────────

describe("EntityTable — loading state", () => {
  it("renders shape-matched skeleton rows (one cell per column), no spinner", () => {
    mount(
      <EntityTable<Row>
        items={[]}
        columns={COLUMNS}
        loading
        skeletonRows={3}
        testId="t"
      />,
    );
    const skeletonRows = container!.querySelectorAll('[data-testid^="t-skeleton-row-"]');
    expect(skeletonRows).toHaveLength(3);
    expect(skeletonRows[0].querySelectorAll("td")).toHaveLength(2);
    expect(container!.querySelector(".animate-pulse")).not.toBeNull();
    expect(container!.querySelector(".animate-spin")).toBeNull();
    // Loading never shows the empty slot.
    expect(byTestId("t-empty-row")).toBeNull();
  });
});

// ─── 1c'. Sticky header (kit-owned scroll region) ────────────────────────

describe("EntityTable — sticky header", () => {
  it("marks header cells sticky (semantic z token) inside the kit's own maxHeight scroll region", () => {
    mount(
      <EntityTable<Row>
        items={ROWS}
        getRowId={(r) => r.id}
        columns={COLUMNS}
        stickyHeader
        maxHeight="20rem"
      />,
    );
    const th = container!.querySelector("thead th")!;
    expect(th.className).toContain("sticky");
    expect(th.className).toContain("z-docked");
    const scrollRegion = container!.querySelector<HTMLElement>("div.overflow-auto")!;
    expect(scrollRegion.style.maxHeight).toBe("20rem");
  });
});

// ─── 1d. Sort toggles order and announces ────────────────────────────────

describe("EntityTable — uncontrolled sort (sortAccessor)", () => {
  it("cycles none → desc → asc → none, re-orders rows, and sets aria-sort", () => {
    mount(<EntityTable<Row> items={ROWS} getRowId={(r) => r.id} columns={COLUMNS} />);
    const sortButton = byTestId("entity-sort-score")!;
    const scoreTh = () => container!.querySelectorAll("thead th")[1];

    expect(renderedNames()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(scoreTh().getAttribute("aria-sort")).toBe("none");

    act(() => sortButton.click()); // → desc
    expect(renderedNames()).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(scoreTh().getAttribute("aria-sort")).toBe("descending");

    act(() => sortButton.click()); // → asc
    expect(renderedNames()).toEqual(["Alpha", "Charlie", "Bravo"]);
    expect(scoreTh().getAttribute("aria-sort")).toBe("ascending");

    act(() => sortButton.click()); // → none (original order)
    expect(renderedNames()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(scoreTh().getAttribute("aria-sort")).toBe("none");
  });

  it("nullish values sort LAST in both directions (fleet-7 verifier catch)", () => {
    // The direction multiplier used to flip "null last" into "null first"
    // on descending sorts; the nullish branch is now hoisted out of it.
    const rowsWithNull: Row[] = [
      { id: "a", name: "Alpha", score: 10 },
      { id: "n", name: "Nullish", score: null as unknown as number },
      { id: "b", name: "Bravo", score: 30 },
    ];
    mount(<EntityTable<Row> items={rowsWithNull} getRowId={(r) => r.id} columns={COLUMNS} />);
    const sortButton = byTestId("entity-sort-score")!;

    act(() => sortButton.click()); // → desc
    expect(renderedNames()).toEqual(["Bravo", "Alpha", "Nullish"]);

    act(() => sortButton.click()); // → asc
    expect(renderedNames()).toEqual(["Alpha", "Bravo", "Nullish"]);
  });

  it("controlled mode reports the next cycle state and renders the given order untouched", () => {
    const onSortChange = vi.fn();
    mount(
      <EntityTable<Row>
        items={ROWS}
        getRowId={(r) => r.id}
        columns={COLUMNS}
        sort={null}
        onSortChange={onSortChange}
      />,
    );
    act(() => byTestId("entity-sort-score")!.click());
    expect(onSortChange).toHaveBeenCalledWith({ columnId: "score", direction: "desc" });
    // Controlled: the kit does NOT reorder on its own — the caller owns it.
    expect(renderedNames()).toEqual(["Alpha", "Bravo", "Charlie"]);

    rerender(
      <EntityTable<Row>
        items={ROWS}
        getRowId={(r) => r.id}
        columns={COLUMNS}
        sort={{ columnId: "score", direction: "desc" }}
        onSortChange={onSortChange}
      />,
    );
    act(() => byTestId("entity-sort-score")!.click());
    expect(onSortChange).toHaveBeenLastCalledWith({ columnId: "score", direction: "asc" });

    rerender(
      <EntityTable<Row>
        items={ROWS}
        getRowId={(r) => r.id}
        columns={COLUMNS}
        sort={{ columnId: "score", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    act(() => byTestId("entity-sort-score")!.click());
    expect(onSortChange).toHaveBeenLastCalledWith(null);
  });
});

// ─── 1e. Keyboard row navigation ─────────────────────────────────────────

describe("EntityTable — j/k + Enter keyboard navigation", () => {
  it("j/k move focus between rows; Enter activates the row click-through", () => {
    const onRowClick = vi.fn();
    mount(
      <EntityTable<Row>
        items={ROWS}
        getRowId={(r) => r.id}
        columns={COLUMNS}
        onRowClick={onRowClick}
        rowTestId={(r) => `row-nav-${r.id}`}
      />,
    );
    const row1 = byTestId("row-nav-1")!;
    const row2 = byTestId("row-nav-2")!;

    act(() => row1.focus());
    expect(document.activeElement).toBe(row1);

    keydown(row1, "j");
    expect(document.activeElement).toBe(row2);

    keydown(row2, "k");
    expect(document.activeElement).toBe(row1);

    keydown(row1, "Enter");
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toEqual(ROWS[0]);
  });

  it("does not hijack keys typed into controls inside a cell", () => {
    const onRowClick = vi.fn();
    mount(
      <EntityTable<Row>
        items={ROWS}
        getRowId={(r) => r.id}
        columns={[
          ...COLUMNS,
          {
            id: "action",
            header: "Action",
            cell: (r) => <button type="button" data-testid={`inner-${r.id}`}>act</button>,
          },
        ]}
        onRowClick={onRowClick}
      />,
    );
    const inner = byTestId("inner-1")!;
    keydown(inner, "Enter"); // bubbles to the row, but target !== row
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

// ─── 1f. EntityList — same contract for card/stack lists ─────────────────

describe("EntityList — the card/stack half of the kit", () => {
  it("renders items through renderItem", () => {
    mount(
      <EntityList<Row>
        items={ROWS}
        getItemId={(r) => r.id}
        className="space-y-3"
        renderItem={(r) => <article data-testid={`card-${r.id}`}>{r.name}</article>}
      />,
    );
    expect(byTestId("card-2")!.textContent).toBe("Bravo");
    expect(container!.querySelectorAll("article")).toHaveLength(3);
  });

  it("loading renders the shape-matched skeleton, not a spinner", () => {
    mount(
      <EntityList<Row>
        items={[]}
        loading
        renderSkeleton={() => <div data-testid="shaped-skeleton" className="animate-pulse" />}
        renderItem={() => null}
      />,
    );
    expect(byTestId("shaped-skeleton")).not.toBeNull();
    expect(container!.querySelector(".animate-spin")).toBeNull();
  });

  it("loading without renderSkeleton falls back to skeletonCount skeleton rows", () => {
    mount(<EntityList<Row> items={[]} loading skeletonCount={2} renderItem={() => null} />);
    expect(container!.querySelectorAll(".animate-pulse")).toHaveLength(2);
    expect(container!.querySelector(".animate-spin")).toBeNull();
  });

  it("empty renders the canonical EmptyState with the configured CTA", () => {
    mount(
      <EntityList<Row>
        items={[]}
        renderItem={() => null}
        emptyState={{
          icon: NullIcon,
          headline: "No listings on the worksheet",
          cta: { label: "Open your counties", href: "/counties", "data-testid": "list-empty-cta" },
        }}
      />,
    );
    expect(byTestId("empty-state")).not.toBeNull();
    const cta = byTestId("list-empty-cta")!;
    expect(cta.textContent).toContain("Open your counties");
    expect(cta.closest("a")?.getAttribute("href") ?? cta.getAttribute("href")).toBe("/counties");
  });
});

// ─── 2. MIGRATION PIN — derived from the five real page files ────────────
//
// Each entry names the page, the kit import(s) it must carry, and the
// prior local-scaffolding markers that must be GONE. `forbidden` is
// per-file because finance.tsx legitimately keeps ui/table for the
// NoteDetailDrawer's payment-history/amortization tables (a note DETAIL
// surface, not the migrated notes LIST) — its pin is the hand-rolled
// notes-table markers instead.

const PAGES_DIR = path.resolve(__dirname, "../../client/src/pages");

interface MigratedPage {
  file: string;
  /** At least one of the kit's entry points must be imported. */
  mustImport: string[];
  /** Substrings that must be present (the kit call sites). */
  mustContain: string[];
  /** Prior local-scaffolding markers that must be gone. */
  forbidden: Array<{ marker: string | RegExp; reason: string }>;
}

const MIGRATED_PAGES: MigratedPage[] = [
  {
    file: "leads.tsx",
    mustImport: ["@/components/entity-table/EntityTable"],
    mustContain: ['testId="table-leads"', 'sortTestId: "button-sort-score"'],
    forbidden: [
      { marker: 'from "@/components/ui/table"', reason: "ui/table import fully retired" },
      { marker: /<table\b/i, reason: "no raw or shadcn table scaffolding" },
    ],
  },
  {
    file: "properties.tsx",
    mustImport: [
      "@/components/entity-table/EntityList",
      "@/components/entity-table/EntityTable",
    ],
    mustContain: ['testId="list-properties"'],
    forbidden: [
      { marker: 'from "@/components/ui/table"', reason: "ui/table import fully retired" },
      { marker: /<table\b/i, reason: "no raw or shadcn table scaffolding" },
      {
        marker: /paginatedProperties\.map\(\(property\) => \(\s*<div key=/,
        reason: "the hand-rolled inventory grid map is gone (kit renders it)",
      },
    ],
  },
  {
    file: "finance.tsx",
    mustImport: ["@/components/entity-table/EntityTable"],
    mustContain: ['testId="table-finance-notes"'],
    forbidden: [
      {
        marker: '<TableHead className="min-w-[140px]">Borrower</TableHead>',
        reason: "the hand-rolled notes-list table header is gone",
      },
      {
        marker: /<TableRow[^>]*data-testid=\{`row-note-/,
        reason: "the hand-rolled notes-list rows are gone (kit renders them)",
      },
    ],
  },
  {
    file: "rent-roll.tsx",
    mustImport: ["@/components/entity-table/EntityTable"],
    mustContain: [
      'testId="table-rent-aging"',
      'testId="table-late-fee-rules"',
      'testId="table-lease-ledger"',
      'testId="table-allocation-preview"',
    ],
    forbidden: [{ marker: /<table\b/i, reason: "no raw table scaffolding" }],
  },
  {
    file: "auction-worksheet.tsx",
    mustImport: [
      "@/components/entity-table/EntityList",
      "@/components/entity-table/EntityTable",
    ],
    mustContain: ['testId="list-auction-worksheet"', 'testId="table-lot-import-sample"'],
    forbidden: [{ marker: /<table\b/i, reason: "no raw table scaffolding" }],
  },
];

describe("migration pin — the five heavy lists render through the kit", () => {
  for (const page of MIGRATED_PAGES) {
    describe(page.file, () => {
      const filePath = path.join(PAGES_DIR, page.file);

      it("exists on disk", () => {
        expect(fs.existsSync(filePath)).toBe(true);
      });

      const src = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";

      for (const imp of page.mustImport) {
        it(`imports the kit: ${imp}`, () => {
          expect(src).toContain(`"${imp}"`);
        });
      }

      for (const marker of page.mustContain) {
        it(`carries the kit call site marker: ${marker}`, () => {
          expect(src).toContain(marker);
        });
      }

      for (const { marker, reason } of page.forbidden) {
        it(`prior scaffolding gone: ${reason}`, () => {
          if (typeof marker === "string") {
            expect(src).not.toContain(marker);
          } else {
            expect(src).not.toMatch(marker);
          }
        });
      }
    });
  }

  it("the kit files themselves exist (falsifiable against pre-wave HEAD)", () => {
    const kitDir = path.resolve(__dirname, "../../client/src/components/entity-table");
    for (const f of ["EntityTable.tsx", "EntityList.tsx", "types.ts"]) {
      expect(fs.existsSync(path.join(kitDir, f)), `${f} must exist`).toBe(true);
    }
  });
});
