/**
 * Right-to-erasure — deleteOrganization (2026-07 GDPR gap closure).
 *
 * Locks the safety + convergence semantics:
 *   1. founder orgs are REFUSED outright
 *   2. unknown orgs throw (no silent no-op "success")
 *   3. multi-pass FK convergence: a parent table that fails while its
 *      child holds rows succeeds on a later pass
 *   4. retained tables (audit_events, financial_ledger) are never swept;
 *      the ledger is detached (org id nulled), not deleted
 *   5. residual tables are reported honestly, never dropped from the result
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  isFounder: false,
  orgExists: true,
  /** table → rows remaining for the org */
  rows: {} as Record<string, number>,
  /** parent → child: parent DELETE throws while child still has rows */
  fkBlocks: {} as Record<string, string>,
  ledgerDetached: false,
  orgRowDeleted: false,
  deleteAttempts: [] as string[],
};

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", () => ({
  db: {
    execute: async (query: any) => {
      const text: string = (query?.queryChunks ? JSON.stringify(query.queryChunks) : String(query?.sql ?? query)) + "";
      const raw = typeof query === "object" && "sql" in (query ?? {}) ? String((query as any).sql) : text;
      // JSON-stringified chunks escape quotes (\") — normalize so the
      // DELETE-table regex below matches the real SQL text.
      const q = (raw.length > 5 ? raw : text).replace(/\\"/g, '"');

      if (q.includes("information_schema")) {
        return { rows: Object.keys(state.rows).map((t) => ({ table_name: t })) };
      }
      if (q.includes("SELECT is_founder")) {
        return state.orgExists
          ? { rows: [{ is_founder: state.isFounder, name: "Acme Land Co" }] }
          : { rows: [] };
      }
      if (q.includes("UPDATE financial_ledger")) {
        state.ledgerDetached = true;
        return { rowCount: 1 };
      }
      if (q.includes("DELETE FROM organizations")) {
        state.orgRowDeleted = true;
        return { rowCount: 1 };
      }
      const m = q.match(/DELETE FROM "([a-z0-9_]+)"/);
      if (m) {
        const table = m[1];
        state.deleteAttempts.push(table);
        const blockingChild = state.fkBlocks[table];
        if (blockingChild && (state.rows[blockingChild] ?? 0) > 0) {
          throw new Error(`FK violation: ${blockingChild} still references ${table}`);
        }
        const n = state.rows[table] ?? 0;
        state.rows[table] = 0;
        return { rowCount: n };
      }
      return { rows: [], rowCount: 0 };
    },
  },
}));

import { deleteOrganization } from "../../server/services/orgDeletion";

beforeEach(() => {
  state.isFounder = false;
  state.orgExists = true;
  state.rows = {};
  state.fkBlocks = {};
  state.ledgerDetached = false;
  state.orgRowDeleted = false;
  state.deleteAttempts = [];
});

describe("deleteOrganization", () => {
  it("refuses founder orgs outright", async () => {
    state.isFounder = true;
    await expect(deleteOrganization(42)).rejects.toThrow(/founder/);
  });

  it("throws on unknown orgs — no silent success", async () => {
    state.orgExists = false;
    await expect(deleteOrganization(999)).rejects.toThrow(/not found/);
  });

  it("converges across FK-ordered passes (child drains, parent succeeds later)", async () => {
    state.rows = { leads: 10, lead_activities: 25 };
    // leads can't delete while lead_activities still holds rows.
    state.fkBlocks = { leads: "lead_activities" };

    const result = await deleteOrganization(42);

    expect(result.deletedRowsByTable.lead_activities).toBe(25);
    expect(result.deletedRowsByTable.leads).toBe(10);
    expect(result.residualTables).toEqual([]);
    expect(result.orgRowDeleted).toBe(true);
    expect(result.passes).toBeGreaterThanOrEqual(2); // needed a retry pass
  });

  it("detaches the financial ledger instead of deleting it", async () => {
    state.rows = { leads: 1 };
    await deleteOrganization(42);
    expect(state.ledgerDetached).toBe(true);
    expect(state.deleteAttempts).not.toContain("financial_ledger");
    expect(state.deleteAttempts).not.toContain("audit_events");
  });

  it("reports permanently blocked tables as residuals, honestly", async () => {
    state.rows = { stuck_table: 5, blocker_child: 3 };
    // stuck_table blocked by blocker_child, and blocker_child ALSO blocked
    // by stuck_table (a cycle the sweep cannot break).
    state.fkBlocks = { stuck_table: "blocker_child", blocker_child: "stuck_table" };

    const result = await deleteOrganization(42);

    expect(result.residualTables.sort()).toEqual(["blocker_child", "stuck_table"]);
  });
});
