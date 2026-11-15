/**
 * Legal-run Leg 6.2 — the nightly purge FAILS CLOSED when it cannot read the
 * legal holds. If the hold lookup throws, no org-scoped rule may DELETE
 * anything (it would otherwise run with an empty hold clause and purge held
 * orgs' rows); the non-org rules still run; and every skipped rule is reported
 * as a failure so the job supervisor sees the run as failed.
 *
 * Drives the real runDataRetention() and renders every statement it issues
 * through Drizzle's own Postgres dialect, so the assertion reads the SQL that
 * would reach the database.
 */
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ holdLookupFails: true, heldIds: [] as number[], statements: [] as string[] }));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const dialect = new PgDialect();
  return {
    db: {
      execute: async (q: any) => {
        const text = dialect.sqlToQuery(q).sql;
        h.statements.push(text);
        if (/FROM legal_holds/.test(text)) {
          if (h.holdLookupFails) throw Object.assign(new Error("connection reset"), { code: "08006" });
          return { rows: h.heldIds.map((organization_id) => ({ organization_id })) };
        }
        if (/^DELETE/.test(text)) return { rowCount: 0, rows: [] };
        return { rows: [{ n: 0 }] };
      },
    },
  };
});

import { retentionRuleInventory, runDataRetention } from "../../server/jobs/dataRetention";

const deletesOn = (table: string) => h.statements.filter((s) => new RegExp(`^DELETE FROM ${table}\\b`).test(s));

describe("hold lookup failure", () => {
  it("no org-scoped table is purged, non-org tables still are, and each skip is a reported failure", async () => {
    h.holdLookupFails = true;
    h.statements = [];
    const result = await runDataRetention();
    const rules = retentionRuleInventory();
    const orgScoped = rules.filter((r) => r.orgColumn);
    const nonOrg = rules.filter((r) => !r.orgColumn);
    expect(orgScoped.length).toBeGreaterThanOrEqual(6);
    expect(nonOrg.length).toBeGreaterThanOrEqual(1);
    for (const r of orgScoped) expect(deletesOn(r.table), `${r.table} purged with holds unknown`).toEqual([]);
    for (const r of nonOrg) expect(deletesOn(r.table).length, `${r.table} not purged`).toBe(1);
    expect(result.failures.length).toBe(orgScoped.length);
    for (const f of result.failures) expect(f.error).toMatch(/fail closed/);
  });

  it("control: when the lookup works and an org is held, every org-scoped DELETE excludes it", async () => {
    h.holdLookupFails = false;
    h.heldIds = [77];
    h.statements = [];
    const result = await runDataRetention();
    expect(result.failures).toEqual([]);
    for (const r of retentionRuleInventory().filter((x) => x.orgColumn)) {
      const [del] = deletesOn(r.table);
      expect(del, `${r.table} not purged`).toBeTruthy();
      expect(del).toMatch(new RegExp(`"${r.orgColumn}" IS NULL OR "${r.orgColumn}" NOT IN \\(\\$\\d+\\)`));
    }
  });
});
