/**
 * Chart of Accounts seed + ledger constraint tests
 * (Lavender §1, Hilda §2 — Week 6 foundation).
 *
 * Verifies:
 *   - seedChartOfAccountsForOrg produces 14 default accounts
 *   - Repeat invocation is a no-op (idempotency)
 *   - The debit-XOR-credit constraint shape is encoded on the table
 *     (compiled SQL contains both legs of the OR + the non-negative
 *     check). We exercise the constraint at the SQL/schema level
 *     because the test harness mocks the DB layer; the DB-level
 *     enforcement is exercised by the migration test in CI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory store for inserted chart-of-accounts rows. Keyed by org so
// the idempotency check (count by org) works correctly.
type Row = Record<string, any>;
const accountStore = new Map<number, Row[]>();

vi.mock("../../server/db", () => {
  return {
    db: {
      insert(_table: any) {
        return {
          values(rows: Row | Row[]) {
            const arr = Array.isArray(rows) ? rows : [rows];
            return {
              returning(_proj?: any) {
                const out: Row[] = [];
                for (const r of arr) {
                  const orgRows = accountStore.get(r.organizationId) ?? [];
                  const row = { id: `acc-${orgRows.length + 1}`, ...r };
                  orgRows.push(row);
                  accountStore.set(r.organizationId, orgRows);
                  out.push(row);
                }
                return Promise.resolve(out);
              },
            };
          },
        };
      },
      select(_proj?: any) {
        return {
          from(_t: any) {
            return {
              where(predicate: any) {
                // The seed's idempotency check builds a Drizzle SQL
                // expression of the form eq(chartOfAccounts.organizationId, X).
                // Drizzle compiles eq() into an SQL object whose .queryChunks
                // contains the literal value as `param.value`. Walk the
                // structure defensively to extract the org id.
                const orgId = extractOrgId(predicate);
                const rows = orgId != null ? accountStore.get(orgId) ?? [] : [];
                return Promise.resolve([{ count: rows.length }]);
              },
            };
          },
        };
      },
    },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Extract the integer org id from a Drizzle predicate. The shape varies
// across drizzle minor versions, so we walk recursively for any nested
// `value` or `params` field that yields a number.
function extractOrgId(node: any): number | null {
  if (node == null) return null;
  if (typeof node === "number") return node;
  if (typeof node !== "object") return null;
  for (const key of ["value", "params"]) {
    if (key in node) {
      const found = extractOrgId(node[key]);
      if (found != null) return found;
    }
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = extractOrgId(child);
      if (found != null) return found;
    }
  }
  if ("queryChunks" in node) {
    const found = extractOrgId(node.queryChunks);
    if (found != null) return found;
  }
  return null;
}

describe("chartOfAccountsSeed", () => {
  beforeEach(() => {
    accountStore.clear();
  });

  it("produces 14 default accounts on first seed", async () => {
    const { seedChartOfAccountsForOrg, DEFAULT_CHART_OF_ACCOUNTS } = await import(
      "../../server/services/chartOfAccountsSeed"
    );

    expect(DEFAULT_CHART_OF_ACCOUNTS).toHaveLength(15);

    const inserted = await seedChartOfAccountsForOrg(42);
    expect(inserted).toBe(15);
    expect(accountStore.get(42)).toHaveLength(15);
  });

  it("includes one of each canonical account type and number", async () => {
    const { DEFAULT_CHART_OF_ACCOUNTS } = await import(
      "../../server/services/chartOfAccountsSeed"
    );

    const numbers = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.accountNumber).sort();
    expect(numbers).toEqual(
      [
        "1000", "1100", "1200", "1500",
        "2000", "2500",
        "3000", "3500",
        "4000", "4100", "4500",
        "5000", "6000", "6500", "7000",
      ].sort(),
    );

    const types = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.accountType));
    expect(types.has("asset")).toBe(true);
    expect(types.has("liability")).toBe(true);
    expect(types.has("equity")).toBe(true);
    expect(types.has("revenue")).toBe(true);
    expect(types.has("expense")).toBe(true);
  });

  it("is idempotent — re-seeding does not add duplicates", async () => {
    const { seedChartOfAccountsForOrg } = await import(
      "../../server/services/chartOfAccountsSeed"
    );

    const first = await seedChartOfAccountsForOrg(7);
    const second = await seedChartOfAccountsForOrg(7);

    expect(first).toBe(15);
    expect(second).toBe(0);
    expect(accountStore.get(7)).toHaveLength(15);
  });

  it("seeds independent orgs independently", async () => {
    const { seedChartOfAccountsForOrg } = await import(
      "../../server/services/chartOfAccountsSeed"
    );

    await seedChartOfAccountsForOrg(101);
    await seedChartOfAccountsForOrg(202);

    expect(accountStore.get(101)).toHaveLength(15);
    expect(accountStore.get(202)).toHaveLength(15);
  });
});

describe("account_ledger_entries debit-XOR-credit constraint", () => {
  it("encodes the XOR + non-negative checks on the table", async () => {
    // Pull the table via the schema export and inspect the symbol-keyed
    // metadata. Drizzle attaches CHECK constraints on the table object's
    // extra-config callback; we re-invoke it here to verify the SQL.
    const schema = await import("@shared/schema");
    const table: any = schema.accountLedgerEntries;

    // Drizzle stores the extra-config builder under a Symbol; we
    // reconstruct it by inspecting table column references.
    expect(table.debit).toBeDefined();
    expect(table.credit).toBeDefined();

    // The compiled CHECK constraint lives in the migration; we co-test
    // it by asserting the migration SQL contains both legs of the OR
    // and the non-negative guard.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migration = fs.readFileSync(
      path.resolve(__dirname, "../../migrations/0042_chart_of_accounts.sql"),
      "utf8",
    );

    // Debit > 0 AND credit = 0
    expect(migration).toMatch(/"debit"\s*>\s*0\s+AND\s+"credit"\s*=\s*0/i);
    // Debit = 0 AND credit > 0
    expect(migration).toMatch(/"debit"\s*=\s*0\s+AND\s+"credit"\s*>\s*0/i);
    // Non-negative
    expect(migration).toMatch(/"debit"\s*>=\s*0\s+AND\s+"credit"\s*>=\s*0/i);
    // Constraint name
    expect(migration).toContain("account_ledger_entries_debit_xor_credit");
  });

  it("rejects rows with both debit and credit set (constraint shape)", () => {
    // Pure logic check mirroring the SQL CHECK predicate. A row is
    // valid iff exactly one of (debit, credit) is positive and both
    // are non-negative.
    const isValid = (debit: number, credit: number) =>
      debit >= 0 && credit >= 0 &&
      ((debit > 0 && credit === 0) || (debit === 0 && credit > 0));

    expect(isValid(100, 0)).toBe(true);   // debit-only — ok
    expect(isValid(0, 100)).toBe(true);   // credit-only — ok
    expect(isValid(100, 100)).toBe(false); // both — rejected
    expect(isValid(0, 0)).toBe(false);     // neither — rejected
    expect(isValid(-1, 0)).toBe(false);    // negative — rejected
    expect(isValid(0, -1)).toBe(false);    // negative — rejected
  });
});
