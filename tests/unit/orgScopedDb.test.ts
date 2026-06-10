/**
 * Tier 1F (elevation blueprint 2026-06-10) — tenancy by construction.
 *
 * Covers the org-scoped repository layer (server/utils/orgScopedDb.ts):
 *
 *   1. `forOrg(orgId).findById(table, id)` provably injects the
 *      `organization_id = $org` predicate into the emitted WHERE clause
 *      (rendered through PgDialect, same technique as tcpaOrgScope.test.ts).
 *   2. `forOrg()` rejects garbage org ids loudly (undefined/NaN/0/floats)
 *      instead of silently widening to every tenant.
 *   3. The mechanical registry covers every org-scoped table in
 *      shared/schema.ts — orders of magnitude beyond the legacy 8 aliases.
 *   4. The `unscopedForPlatformOps(reason)` escape hatch logs its reason and
 *      refuses calls without a meaningful one.
 *   5. A converted storage method (`storage.getSupportCase(orgId, id)`) is
 *      org-pinned end to end: cross-org ids resolve to undefined, and the
 *      generated SQL carries the org predicate.
 *
 * idempotent: true — db fully mocked; no network, no Postgres.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// In-memory state the mocked db chain reads/writes.
const state = vi.hoisted(() => ({
  rows: [] as any[],
  lastWhere: undefined as unknown,
}));

const loggerInfo = vi.hoisted(() => vi.fn());

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        // orgScopedDb.findById chains .where(...).limit(1); the converted
        // storage methods all route through it.
        where: (expr: unknown) => {
          state.lastWhere = expr;
          const result = Promise.resolve(state.rows) as Promise<any[]> & { limit: () => Promise<any[]> };
          result.limit = async () => state.rows;
          return result;
        },
      }),
    }),
  },
  withTransaction: async (fn: any) => fn({}),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: loggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Keep the storage module graph light — these pull crypto/config at import.
vi.mock("../../server/services/skipTraceEncryption", () => ({
  encryptSkipTracePayload: vi.fn((x: unknown) => x),
  decryptSkipTraceRow: vi.fn((x: unknown) => x),
}));
vi.mock("../../server/services/legalHold", () => ({
  assertNotUnderLegalHold: vi.fn(async () => undefined),
  filterOutHeldIds: vi.fn(async (_org: unknown, ids: unknown) => ids),
  orgHasActiveHold: vi.fn(async () => false),
}));

import {
  forOrg,
  unscopedForPlatformOps,
  listOrgScopedTableNames,
} from "../../server/utils/orgScopedDb";
import { supportCases, sessions } from "@shared/schema";
import { storage } from "../../server/storage";

const dialect = new PgDialect();

const ORG_A = 7;
const ORG_B = 999;

beforeEach(() => {
  state.rows = [];
  state.lastWhere = undefined;
  loggerInfo.mockClear();
});

describe("OrgScopedDb.findById — org predicate by construction", () => {
  it("emits a WHERE clause pinning BOTH organization_id and the row id", async () => {
    state.rows = [{ id: 42, organizationId: ORG_A }];

    const row = await forOrg(ORG_A).findById(supportCases, 42);
    expect(row).toEqual({ id: 42, organizationId: ORG_A });

    const rendered = dialect.sqlToQuery(state.lastWhere as SQL);
    expect(rendered.sql).toContain("organization_id");
    expect(rendered.sql).toContain("id");
    expect(rendered.params).toContain(ORG_A);
    expect(rendered.params).toContain(42);
  });

  it("returns undefined when the row is outside the caller's org (no row in scope)", async () => {
    // The org-pinned query simply finds nothing for another tenant's id.
    state.rows = [];
    const row = await forOrg(ORG_A).findById(supportCases, 31337);
    expect(row).toBeUndefined();
  });

  it("refuses tables without an organizationId column (runtime backstop for `as any`)", () => {
    expect(() => forOrg(ORG_A).scope(sessions as any)).toThrow(/no organizationId column/);
  });
});

describe("forOrg — org id validation", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["NaN", NaN],
    ["zero", 0],
    ["negative", -3],
    ["float", 1.5],
    ["string", "7"],
  ])("throws on %s instead of silently widening the tenancy", (_label, bad) => {
    expect(() => forOrg(bad as any)).toThrow(/positive integer organizationId/);
  });
});

describe("mechanical org-scoped table registry", () => {
  it("covers the customer crown jewels and far exceeds the legacy 8-table hand-list", () => {
    const names = listOrgScopedTableNames();
    for (const jewel of [
      "deals",
      "leads",
      "properties",
      "support_cases",
      "inbox_messages",
      "mailing_orders",
      "document_versions",
      "ai_conversations",
    ]) {
      expect(names).toContain(jewel);
    }
    // 2026-06-10 baseline: 319 tables discovered mechanically. Allow slack
    // for schema evolution but fail hard if discovery ever regresses toward
    // the old hand-curated coverage.
    expect(names.length).toBeGreaterThan(250);
  });
});

describe("unscopedForPlatformOps — the explicit escape hatch", () => {
  it("logs the reason on every cross-org access", () => {
    const reason = "test: founder billing reconciliation across tenants";
    unscopedForPlatformOps(reason);
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("UNSCOPED"),
      expect.objectContaining({ reason }),
    );
  });

  it("refuses empty or token reasons", () => {
    expect(() => unscopedForPlatformOps("")).toThrow(/meaningful reason/);
    expect(() => unscopedForPlatformOps("because")).toThrow(/meaningful reason/);
    expect(() => unscopedForPlatformOps(undefined as any)).toThrow(/meaningful reason/);
  });
});

describe("converted storage method — getSupportCase(orgId, id)", () => {
  it("pins the lookup to the caller's org in the generated SQL", async () => {
    state.rows = [{ id: 5, organizationId: ORG_A, subject: "billing question" }];

    const found = await storage.getSupportCase(ORG_A, 5);
    expect(found?.subject).toBe("billing question");

    const rendered = dialect.sqlToQuery(state.lastWhere as SQL);
    expect(rendered.sql).toContain("organization_id");
    expect(rendered.params).toContain(ORG_A);
    expect(rendered.params).toContain(5);
  });

  it("resolves a cross-org caseId to undefined — indistinguishable from missing", async () => {
    // Org B's case 88 doesn't exist inside org A's scope; the pinned query
    // returns no rows, exactly like a nonexistent id.
    state.rows = [];
    const fromOtherOrg = await storage.getSupportCase(ORG_A, 88);
    expect(fromOtherOrg).toBeUndefined();

    const rendered = dialect.sqlToQuery(state.lastWhere as SQL);
    expect(rendered.params).toContain(ORG_A);
    expect(rendered.params).not.toContain(ORG_B);
  });
});
