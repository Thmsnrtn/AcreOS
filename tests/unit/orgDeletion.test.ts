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
 *   6. each tenant key is compared in its own type (a text key gets a text
 *      literal); a type that cannot match is refused before any delete; a
 *      non-FK DELETE error stops the erasure loudly, org row kept
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
  /** table → tenant key data_type (default integer) */
  keyTypes: {} as Record<string, string>,
  /** table → a non-FK error its DELETE throws */
  brokenTables: {} as Record<string, string>,
  deleteSql: [] as string[],
  /** Leg 6.1: the org's active legal hold, if any. */
  hold: null as null | { id: string; caseRef: string; scope: string; placedAt: Date },
  /** Leg 6.4: document store configuration + byte deletion. */
  storeConfigured: false,
  storeFails: false,
  byteDeletes: [] as number[],
  /** Order of destructive steps, to prove bytes go before rows. */
  order: [] as string[],
};

vi.mock("../../server/services/legalHold", async () => {
  const actual = await vi.importActual<typeof import("../../server/services/legalHold")>("../../server/services/legalHold");
  return { ...actual, getActiveHoldSummary: async () => state.hold };
});
vi.mock("../../server/utils/auditLog", () => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("../../server/services/documentStore", () => ({
  documentStoreConfigured: () => state.storeConfigured,
  deleteAllOrgObjects: async (orgId: number) => {
    state.order.push("bytes");
    if (state.storeFails) throw new Error("AccessDenied");
    state.byteDeletes.push(orgId);
    return { objectsDeleted: 3 };
  },
}));

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
        return { rows: Object.keys(state.rows).map((t) => ({ table_name: t, column_name: "organization_id", data_type: state.keyTypes[t] ?? "integer" })) };
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
        state.order.push(`rows:${table}`);
        state.deleteSql.push(q);
        if (state.brokenTables[table]) throw Object.assign(new Error(state.brokenTables[table]), { code: "42883" });
        const blockingChild = state.fkBlocks[table];
        if (blockingChild && (state.rows[blockingChild] ?? 0) > 0) {
          throw Object.assign(new Error(`FK violation: ${blockingChild} still references ${table}`), { code: "23503" });
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
  state.keyTypes = {};
  state.brokenTables = {};
  state.deleteSql = [];
  state.hold = null;
  state.storeConfigured = false;
  state.storeFails = false;
  state.byteDeletes = [];
  state.order = [];
});

describe("deleteOrganization — legal hold (legal-run Leg 6.1)", () => {
  it("an org under an active legal hold is REFUSED with the hold error and nothing is deleted", async () => {
    state.rows = { leads: 4, legal_holds: 1 };
    state.storeConfigured = true;
    state.hold = { id: "h-1", caseRef: "CASE-9", scope: "org_wide", placedAt: new Date() };
    await expect(deleteOrganization(42)).rejects.toMatchObject({ name: "LegalHoldViolationError", code: "LEGAL_HOLD_ACTIVE" });
    expect(state.deleteAttempts).toEqual([]);
    expect(state.byteDeletes).toEqual([]);
    expect(state.orgRowDeleted).toBe(false);
    expect(state.ledgerDetached).toBe(false);
    expect(state.rows.legal_holds).toBe(1);
  });

  it("the refusal is recorded in audit_events", async () => {
    const { auditLog } = await import("../../server/utils/auditLog");
    state.hold = { id: "h-2", caseRef: "CASE-10", scope: "lead_specific", placedAt: new Date() };
    await expect(deleteOrganization(42)).rejects.toThrow(/CASE-10/);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "org_erasure.refused_legal_hold",
      target: { type: "organization", id: 42 },
    }));
  });

  it("no hold: erasure proceeds exactly as before", async () => {
    state.rows = { leads: 2 };
    const result = await deleteOrganization(42);
    expect(result.orgRowDeleted).toBe(true);
    expect(result.deletedRowsByTable.leads).toBe(2);
  });
});

describe("deleteOrganization — stored document bytes (legal-run Leg 6.4)", () => {
  it("store configured: every object under the org prefix is deleted BEFORE any row, and the count is reported", async () => {
    state.rows = { leads: 2, documents: 1 };
    state.storeConfigured = true;
    const result = await deleteOrganization(42);
    expect(state.byteDeletes).toEqual([42]);
    expect(state.order[0]).toBe("bytes");
    expect(result.documentBytes).toEqual({ status: "deleted", objectsDeleted: 3 });
  });

  it("byte deletion fails: the erasure STOPS loudly before any row is deleted and the org row is kept", async () => {
    state.rows = { leads: 2 };
    state.storeConfigured = true;
    state.storeFails = true;
    await expect(deleteOrganization(42)).rejects.toMatchObject({ name: "OrgErasureError" });
    expect(state.deleteAttempts).toEqual([]);
    expect(state.orgRowDeleted).toBe(false);
  });

  it("a tenant key the sweep cannot match refuses the erasure BEFORE any byte is deleted", async () => {
    state.rows = { leads: 1, weird: 1 };
    state.keyTypes = { weird: "uuid" };
    state.storeConfigured = true;
    await expect(deleteOrganization(42)).rejects.toThrow(/refusing to start/);
    expect(state.byteDeletes).toEqual([]);
    expect(state.deleteAttempts).toEqual([]);
  });

  it("store dormant: reported as store_not_configured, rows erased", async () => {
    state.rows = { leads: 1 };
    const result = await deleteOrganization(42);
    expect(result.documentBytes).toEqual({ status: "store_not_configured" });
    expect(state.byteDeletes).toEqual([]);
    expect(result.orgRowDeleted).toBe(true);
  });
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

  it("never sweeps the append-only purpose ledger — it is retained, and the org row still deletes", async () => {
    state.rows = { leads: 2, purpose_ledger: 4 };
    const result = await deleteOrganization(42);
    expect(state.deleteAttempts).not.toContain("purpose_ledger");
    expect(result.residualTables).toEqual([]);
    expect(result.orgRowDeleted).toBe(true);
  });

  it("reports permanently blocked tables as residuals, honestly", async () => {
    state.rows = { stuck_table: 5, blocker_child: 3 };
    // stuck_table blocked by blocker_child, and blocker_child ALSO blocked
    // by stuck_table (a cycle the sweep cannot break).
    state.fkBlocks = { stuck_table: "blocker_child", blocker_child: "stuck_table" };

    const result = await deleteOrganization(42);

    expect(result.residualTables.sort()).toEqual(["blocker_child", "stuck_table"]);
    expect(result.residualReasons.stuck_table).toMatch(/FK violation/);
  });

  it("compares a text tenant key to the org id as text, an integer key as a number", async () => {
    state.rows = { pax_user_context: 2, leads: 1 };
    state.keyTypes = { pax_user_context: "text" };
    const result = await deleteOrganization(42);
    expect(state.deleteSql.find((q) => q.includes('"pax_user_context"'))).toContain(`"organization_id" = '42'`);
    expect(state.deleteSql.find((q) => q.includes('"leads"'))).toContain(`"organization_id" = 42`);
    expect(result.deletedRowsByTable.pax_user_context).toBe(2);
    expect(result.residualTables).toEqual([]);
  });

  it("refuses to start when a tenant key has a type it cannot match — nothing is deleted", async () => {
    state.rows = { leads: 1, odd_table: 1 };
    state.keyTypes = { odd_table: "uuid" };
    await expect(deleteOrganization(42)).rejects.toThrow(/odd_table\.organization_id/);
    expect(state.deleteAttempts).toEqual([]);
    expect(state.orgRowDeleted).toBe(false);
  });

  it("a non-FK DELETE error is never swallowed: the erasure throws and the org row is kept", async () => {
    state.rows = { leads: 1, pax_user_context: 1 };
    state.brokenTables = { pax_user_context: "operator does not exist: text = integer" };
    await expect(deleteOrganization(42)).rejects.toThrow(/pax_user_context/);
    expect(state.orgRowDeleted).toBe(false);
    // Not retried as if it were FK-blocked.
    expect(state.deleteAttempts.filter((t) => t === "pax_user_context")).toHaveLength(1);
  });
});
