/**
 * T0-5 (elevation blueprint 2026-06-10): checkTcpaBeforeSend must be
 * org-scoped.
 *
 * It used to look the lead up by bare id across ALL orgs — a latent
 * cross-tenant read on the send path. The signature now REQUIRES orgId
 * (compiler finds every caller) and the where clause pins
 * leads.organizationId. These tests assert:
 *
 *   1. The emitted WHERE clause actually constrains organization_id with the
 *      caller's org (not just the lead id).
 *   2. A lead id that doesn't resolve inside the caller's org (i.e. another
 *      org's lead) comes back BLOCKED, fail-safe.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// In-memory state the mocked db chain reads/writes.
const state = vi.hoisted(() => ({
  rows: [] as any[],
  lastWhere: undefined as unknown,
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (expr: unknown) => {
          state.lastWhere = expr;
          return { limit: async () => state.rows };
        },
      }),
    }),
  },
}));

// Keep the module graph light — autonomyGuardrails pulls in storage + logger.
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkTcpaBeforeSend } from "../../server/services/autonomyGuardrails";

const dialect = new PgDialect();

beforeEach(() => {
  state.rows = [];
  state.lastWhere = undefined;
});

describe("checkTcpaBeforeSend — org scoping (T0-5)", () => {
  it("constrains the lookup by organization_id AND lead id", async () => {
    state.rows = [
      { tcpaConsent: true, doNotContact: false, optOutDate: null, status: "new" },
    ];

    const result = await checkTcpaBeforeSend(7, 42);
    expect(result.allowed).toBe(true);

    // Render the captured WHERE expression and prove the org pin is in it.
    const rendered = dialect.sqlToQuery(state.lastWhere as SQL);
    expect(rendered.sql).toContain("organization_id");
    expect(rendered.params).toContain(7);
    expect(rendered.params).toContain(42);
  });

  it("returns BLOCKED when the lead id belongs to a different org (no row in scope)", async () => {
    // The org-scoped query returns no row for another tenant's lead — exactly
    // what an attacker-influenced lead_id from org B looks like to org A.
    state.rows = [];

    const result = await checkTcpaBeforeSend(7, 999);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not found");
  });

  it("still blocks DNC leads inside the caller's own org", async () => {
    state.rows = [
      { tcpaConsent: true, doNotContact: true, optOutDate: null, status: "new" },
    ];

    const result = await checkTcpaBeforeSend(7, 42);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("do-not-contact");
  });
});
