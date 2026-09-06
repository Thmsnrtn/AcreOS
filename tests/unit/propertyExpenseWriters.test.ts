/**
 * PROPERTY EXPENSES — the operating-cost axis, and the honesty guards on it.
 *
 * WHAT WAS BROKEN
 * ───────────────
 * NOI needs two axes: income (rent, which the ledger held) and operating
 * EXPENSE, which had no store at all. So NOI was never computed — it was
 * ASSUMED, via a flat ~40%-of-rent expense guess baked into every projection.
 * Under that guess a building with a new roof and one with a failing roof
 * produce the SAME NOI, and a cap rate or DSCR built on a guessed expense ratio
 * is a fabricated number in a plausible costume. `property_expenses` replaces
 * the guess with what the operator actually spent.
 *
 * WHAT THIS FILE PINS (all PURE — no DATABASE_URL, no live queries)
 * ────────────────────────────────────────────────────────────────
 *   1. isOperatingCategory is TOTAL over PROPERTY_EXPENSE_CATEGORIES and marks
 *      exactly mortgage_interest + depreciation as NON-operating — the two
 *      Schedule-E lines that are stored for completeness but must never reach
 *      NOI. If a new category is added with no operating answer, this fails.
 *   2. The maintenance roll-in dedup SHAPE: created and existed are disjoint and
 *      exhaustive, and a RE-RUN reports 0 created (everything moves to existed),
 *      which is what the partial UNIQUE (org, source, source_ref) guarantees at
 *      the DB and what buildBulkCreateReport must report so a re-run never reads
 *      as a fresh import that double-counts a repair.
 *   3. Manual-entry validation via the REAL exported zod schema
 *      (expenseCreateSchema) — a bad category and a negative amount are rejected,
 *      isOperating is not an accepted input, and a good row parses.
 *   4. WIRING, asserted against route source AS CODE (comments stripped first):
 *      isOperating is derived server-side from isOperatingCategory and never read
 *      off the request body; the roll-in uses onConflictDoNothing on the guard.
 *
 * Source assertions strip comments first — this repo has been bitten by a regex
 * that matched the comment documenting a line rather than the line, and there is
 * a test for the stripper below.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import {
  PROPERTY_EXPENSE_CATEGORIES,
  PROPERTY_EXPENSE_SOURCES,
  isOperatingCategory,
  type PropertyExpenseCategory,
} from "../../shared/rental/propertyExpense";
import { buildBulkCreateReport } from "../../shared/rental/unitInventory";
import { expenseCreateSchema } from "../../server/routes-property-expenses";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");

/**
 * Source with every comment removed. Block comments first, then trailing and
 * whole-line `//`. `(^|\s)` before the slashes keeps `https://…` intact.
 */
function code(src: string): string {
  return stripComments(src);
}

const ROUTES_SRC = read("server/routes-property-expenses.ts");
const ROUTES_CODE = code(ROUTES_SRC);

// ---------------------------------------------------------------------------
// The comment-stripper itself. If it stops stripping, every source assertion
// below silently weakens into "the file mentions this somewhere".
// ---------------------------------------------------------------------------

describe("assertions run against code, not prose", () => {
  it("strips line, trailing and block comments", () => {
    const src = [
      "// isOperating: req.body.isOperating,",
      "const kept = 1; // isOperating: req.body.isOperating,",
      "/* isOperating: req.body.isOperating, */",
      "/**",
      " * isOperating: req.body.isOperating,",
      " */",
      "const alsoKept = 2;",
    ].join("\n");
    const out = code(src);
    expect(out).not.toContain("isOperating: req.body.isOperating,");
    expect(out).toContain("const kept = 1;");
    expect(out).toContain("const alsoKept = 2;");
  });

  it("leaves URLs alone", () => {
    expect(code('const u = "https://example.test/x";')).toContain("https://example.test/x");
  });
});

// ---------------------------------------------------------------------------
// 1. The operating classifier is total, and correct on the two exceptions.
// ---------------------------------------------------------------------------

describe("isOperatingCategory is total and marks the two non-operating lines", () => {
  it("returns a boolean for EVERY category — no category is left undecided", () => {
    for (const category of PROPERTY_EXPENSE_CATEGORIES) {
      expect(typeof isOperatingCategory(category)).toBe("boolean");
    }
  });

  it("mortgage_interest and depreciation are the ONLY non-operating categories", () => {
    const nonOperating = PROPERTY_EXPENSE_CATEGORIES.filter((c) => !isOperatingCategory(c));
    expect(new Set(nonOperating)).toEqual(new Set(["mortgage_interest", "depreciation"]));
  });

  it("every other category is operating", () => {
    for (const category of PROPERTY_EXPENSE_CATEGORIES) {
      const expectedOperating = category !== "mortgage_interest" && category !== "depreciation";
      expect(isOperatingCategory(category)).toBe(expectedOperating);
    }
  });

  it("repairs — the maintenance roll-in category — is operating (it reaches NOI)", () => {
    expect(isOperatingCategory("repairs")).toBe(true);
  });

  it("the source vocabulary is exactly manual + maintenance_invoice", () => {
    expect(new Set(PROPERTY_EXPENSE_SOURCES)).toEqual(new Set(["manual", "maintenance_invoice"]));
  });
});

// ---------------------------------------------------------------------------
// 2. The maintenance roll-in dedup shape — a re-run adds nothing.
// ---------------------------------------------------------------------------
//
// The route inserts one property_expenses row per completed, invoiced ticket
// with source='maintenance_invoice' and sourceRef=ticket.id, onConflictDoNothing
// against the partial UNIQUE (org, source, source_ref). The report is built from
// the ticket ids ATTEMPTED and the sourceRefs the INSERT actually returned —
// exactly the buildBulkCreateReport contract, so the report shape can be pinned
// without a database.

describe("maintenance roll-in reports created vs existed by ticket id", () => {
  it("first run: every ticket is created, nothing pre-existed", () => {
    const attempted = ["tk_1", "tk_2", "tk_3"];
    // The DB returned every sourceRef (nothing conflicted).
    const report = buildBulkCreateReport(attempted, attempted);
    expect(report.createdCount).toBe(3);
    expect(report.existedCount).toBe(0);
    expect(report.created).toEqual(["tk_1", "tk_2", "tk_3"]);
    expect(report.existed).toEqual([]);
  });

  it("re-run of the same window: 0 created, all existed (the guard absorbed them)", () => {
    const attempted = ["tk_1", "tk_2", "tk_3"];
    // Second run: the partial UNIQUE caught every row, so onConflictDoNothing
    // returned NOTHING. This is the double-charge guard doing its job.
    const report = buildBulkCreateReport(attempted, []);
    expect(report.createdCount).toBe(0);
    expect(report.existedCount).toBe(3);
    expect(report.existed).toEqual(["tk_1", "tk_2", "tk_3"]);
  });

  it("incremental run: only the new ticket is created, the rest existed", () => {
    const attempted = ["tk_1", "tk_2", "tk_3", "tk_4"];
    // tk_4 is the only one that wasn't already rolled in.
    const report = buildBulkCreateReport(attempted, ["tk_4"]);
    expect(report.createdCount).toBe(1);
    expect(report.existedCount).toBe(3);
    expect(report.created).toEqual(["tk_4"]);
  });

  it("created and existed are disjoint and exhaustive over attempted", () => {
    const attempted = ["tk_1", "tk_2", "tk_3", "tk_4", "tk_5"];
    const created = ["tk_2", "tk_4"];
    const report = buildBulkCreateReport(attempted, created);
    // disjoint
    expect(report.created.filter((x) => report.existed.includes(x))).toEqual([]);
    // exhaustive
    expect([...report.created, ...report.existed].sort()).toEqual([...attempted].sort());
    expect(report.createdCount + report.existedCount).toBe(attempted.length);
  });

  it("empty window: an all-zero report, not an error", () => {
    const report = buildBulkCreateReport([], []);
    expect(report.attemptedCount).toBe(0);
    expect(report.createdCount).toBe(0);
    expect(report.existedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Manual-entry validation via the REAL exported schema.
// ---------------------------------------------------------------------------

describe("expenseCreateSchema (the real route validator)", () => {
  const good = {
    category: "repairs" as PropertyExpenseCategory,
    amountCents: 12500,
    incurredOn: "2026-08-01",
  };

  it("accepts a well-formed manual expense", () => {
    const parsed = expenseCreateSchema.safeParse(good);
    expect(parsed.success).toBe(true);
  });

  it("rejects a category not in the Schedule-E set", () => {
    const parsed = expenseCreateSchema.safeParse({ ...good, category: "bribes" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const parsed = expenseCreateSchema.safeParse({ ...good, amountCents: -1 });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-integer amount (cents are whole)", () => {
    const parsed = expenseCreateSchema.safeParse({ ...good, amountCents: 12.5 });
    expect(parsed.success).toBe(false);
  });

  it("rejects a malformed date", () => {
    const parsed = expenseCreateSchema.safeParse({ ...good, incurredOn: "08/01/2026" });
    expect(parsed.success).toBe(false);
  });

  it("does NOT surface isOperating as an accepted field — it is server-derived", () => {
    const parsed = expenseCreateSchema.safeParse({ ...good, isOperating: false });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Even when a client sends it, it never survives parsing into the write.
      expect("isOperating" in parsed.data).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Wiring — the honesty guards, asserted against route source AS CODE.
// ---------------------------------------------------------------------------

describe("the route derives isOperating server-side and dedups the roll-in", () => {
  it("computes isOperating from isOperatingCategory(...), not the request body", () => {
    expect(ROUTES_CODE).toContain("isOperatingCategory(parsed.data.category)");
    // The operating flag is never read off the client payload.
    expect(ROUTES_CODE).not.toContain("req.body.isOperating");
    expect(ROUTES_CODE).not.toContain("parsed.data.isOperating");
  });

  it("stamps source='maintenance_invoice' and sourceRef=ticket id on rolled rows", () => {
    expect(ROUTES_CODE).toContain('"maintenance_invoice"');
    expect(ROUTES_CODE).toContain("sourceRef: t.id");
  });

  it("dedups the roll-in with onConflictDoNothing (the partial-unique guard)", () => {
    expect(ROUTES_CODE).toContain("onConflictDoNothing()");
  });

  it("only rolls in completed, actually-invoiced tickets", () => {
    expect(ROUTES_CODE).toContain('eq(maintenanceTickets.status, "completed")');
    expect(ROUTES_CODE).toContain("isNotNull(maintenanceTickets.invoiceCents)");
    expect(ROUTES_CODE).toContain("gt(maintenanceTickets.invoiceCents, 0)");
  });

  it("scopes every read/write by organization (org isolation)", () => {
    expect(ROUTES_CODE).toContain("eq(propertyExpenses.organizationId, orgId)");
  });
});
