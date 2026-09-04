/**
 * The right-to-erasure sweep must be able to SEE every table it is supposed
 * to clear — and the proof of that may not come from the sweep's own query.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `orgDeletion.ts` is a good design: dynamic information_schema enumeration,
 * multi-pass so FK-blocked children drain first, honest residual reporting.
 * Its whole population was defined by one literal — `WHERE c.column_name =
 * 'organization_id'`.
 *
 * 42 tables in this schema name the tenant key `org_id` instead:
 * `integration_credentials` (the encrypted credential store),
 * `borrower_messages`, `user_sessions` / `user_activation_events` /
 * `user_feedback`, the whole agent-memory set (agent_episodic_memory,
 * agent_semantic_memory, agent_working_memory_v13), `founder_interactions`,
 * the scp_* memory tables. None is in RETAINED_TABLES, so none was a
 * deliberate retention under Art. 17(3) — they were invisible.
 *
 * And they did not fail loudly. Only 9 of the 42 carry a foreign key to
 * `organizations`; the other 33 could not block the final org-row delete, so a
 * run returned `residualTables: []` and `orgRowDeleted: true` with the rows
 * still in place (2026-09-04 review, CONFIRMED).
 *
 * ── WHY THE POPULATION IS DERIVED FROM THE SCHEMA ───────────────────────────
 * The obvious test — call the deleter's enumerator and check it found
 * everything — agrees with the deleter by construction: both would ask the
 * same question and get the same answer. So the expected set is derived
 * INDEPENDENTLY, from the Drizzle definitions in shared/schema*.ts, and the
 * deleter is checked against that. It is the same relationship the schema
 * mirror has with migrate.mjs.
 *
 * idempotent: true — Drizzle metadata plus a source read, no DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";

const ROOT = path.resolve(__dirname, "../..");
const DELETER = "server/services/orgDeletion.ts";
const source = fs.readFileSync(path.join(ROOT, DELETER), "utf8");

/** Tenant-scoped tables, grouped by which spelling of the key they carry. */
function tenantTables(): { organizationId: string[]; orgId: string[]; both: string[] } {
  const organizationId: string[] = [];
  const orgId: string[] = [];
  const both: string[] = [];
  for (const value of Object.values(schema)) {
    let cfg: ReturnType<typeof getTableConfig>;
    try {
      cfg = getTableConfig(value as never);
    } catch {
      continue; // not a pgTable
    }
    if (cfg.name === "organizations") continue;
    const names = new Set(cfg.columns.map((c) => c.name));
    const a = names.has("organization_id");
    const b = names.has("org_id");
    if (a && b) both.push(cfg.name);
    else if (b) orgId.push(cfg.name);
    else if (a) organizationId.push(cfg.name);
  }
  return { organizationId, orgId, both };
}

const TABLES = tenantTables();

/**
 * ORG_ID RATCHET. `organization_id` is the convention; these 42 predate it.
 * Down-only: a NEW table using `org_id` fails here, and renaming one of these
 * lowers the number in the same commit. Measured 2026-09-04.
 */
const ORG_ID_TABLE_BASELINE = 42;

describe("the sweep can see both spellings of the tenant key", () => {
  it("reads a real population (vacuity guard)", () => {
    // getTableConfig throws for every non-table export and is caught, so a
    // drizzle change that made it throw for tables too would leave this test
    // asserting nothing about nothing.
    expect(TABLES.organizationId.length).toBeGreaterThan(300);
    expect(TABLES.orgId.length).toBeGreaterThan(0);
    expect(source.length).toBeGreaterThan(2000);
  });

  it("enumerates org_id as well as organization_id", () => {
    expect(
      source,
      "the enumeration is the sweep's whole population — a tenant key it does " +
        "not name is a table it never visits, and 33 of those tables have no " +
        "foreign key to block the org-row delete, so the run reports success",
    ).toContain('const TENANT_KEY_COLUMNS = ["organization_id", "org_id"] as const;');
    // And the constant is what the SQL is built from, not a decoration
    // alongside a hardcoded IN list.
    // Parameterized, not interpolated: `sql.join` binds each spelling as a
    // placeholder. The first version used `sql.raw`, which the sql-raw ratchet
    // counts — and rightly, since a raw string is how an interpolation becomes
    // an injection the day the list stops being a compile-time constant.
    expect(source).toMatch(/IN \(\$\{sql\.join\(TENANT_KEY_COLUMNS\./);
  });

  it("deletes on the column each table actually carries", () => {
    // A fixed `WHERE organization_id = …` against an org_id table errors, and
    // the catch in the pass loop is silent — it would have looked like an
    // FK-blocked retry and then like a residual.
    expect(source).toMatch(/columnsByTable\.get\(table\)/);
    expect(source).toMatch(/DELETE FROM "\$\{table\}" WHERE \$\{predicate\}/);
    expect(source, "a table with both spellings must be cleared on both").toContain('.join(" OR ")');
  });

  it("every tenant-key spelling in the schema is one the sweep names", () => {
    // The completeness claim, derived from shared/schema*.ts rather than from
    // the deleter. A third spelling appearing in the schema fails here.
    const named = ["organization_id", "org_id"];
    const spellings = new Set<string>();
    for (const value of Object.values(schema)) {
      let cfg: ReturnType<typeof getTableConfig>;
      try {
        cfg = getTableConfig(value as never);
      } catch {
        continue;
      }
      for (const c of cfg.columns) {
        if (/^(organization|org)_id$/.test(c.name)) spellings.add(c.name);
      }
    }
    expect([...spellings].sort()).toEqual(named.slice().sort());
  });
});

describe("org_id is legacy and the count only shrinks", () => {
  it("no table carries both spellings", () => {
    // If one ever does, the OR predicate above is what keeps it correct — but
    // it is worth knowing, because two tenant keys on one row can disagree.
    expect(TABLES.both).toEqual([]);
  });

  it(`at most ${ORG_ID_TABLE_BASELINE} tables use org_id`, () => {
    expect(
      TABLES.orgId.length,
      `a NEW table named its tenant key org_id. The convention is ` +
        `organization_id: every tenancy lint, index check and erasure sweep in ` +
        `this repo was written against it, and each one has to be widened by ` +
        `hand for the other spelling. Rename the column.`,
    ).toBeLessThanOrEqual(ORG_ID_TABLE_BASELINE);
  });

  it("the ratchet is not stale-high", () => {
    expect(
      TABLES.orgId.length,
      `${TABLES.orgId.length} tables now use org_id, below the baseline of ` +
        `${ORG_ID_TABLE_BASELINE}. Lower ORG_ID_TABLE_BASELINE in the commit ` +
        `that earned it — a stale-high baseline is free headroom.`,
    ).toBe(ORG_ID_TABLE_BASELINE);
  });

  it("the tables that motivated this are among them", () => {
    // Named so that a future rename shows up here as a deliberate change
    // rather than a silent one, and so the reader can see what was invisible.
    for (const table of [
      "integration_credentials",
      "borrower_messages",
      "agent_episodic_memory",
      "agent_semantic_memory",
      "agent_working_memory_v13",
      "user_sessions",
      "user_feedback",
      "founder_interactions",
    ]) {
      expect(TABLES.orgId, `${table} is no longer an org_id table`).toContain(table);
    }
  });
});
