/**
 * Legal-run Leg 6.2 — population guard for the hold-aware retention job.
 *
 * The real-database test (retentionRespectsLegalHolds.realdb.test.ts) proves
 * the DELETE keeps a held org's rows for the tables it seeds. This one proves
 * the property covers EVERY rule: each rule over a table that carries a
 * tenant key (per the Drizzle declarations, not per the job's own list) must
 * name that key as its orgColumn, and every rule without one must carry a
 * written hold disposition. A new org-scoped rule added without an orgColumn
 * — the shape that made the job hold-blind — fails here.
 */
import { describe, expect, it, vi } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { PgTable as PgTableClass } from "drizzle-orm/pg-core";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import * as schema from "@shared/schema";
import { NON_ORG_SCOPED_RULE_DISPOSITIONS, retentionRuleInventory } from "../../server/jobs/dataRetention";

const TENANT_KEYS = ["organization_id", "org_id"];

const declared = new Map<string, string[]>();
for (const v of Object.values(schema)) {
  if (is(v, PgTableClass)) {
    const cfg = getTableConfig(v as PgTable);
    declared.set(cfg.name, cfg.columns.map((c) => c.name));
  }
}

describe("every nightly retention rule is hold-aware or has a written disposition", () => {
  const rules = retentionRuleInventory();

  it("reads a non-trivial population (vacuity floor)", () => {
    expect(rules.length).toBeGreaterThanOrEqual(9);
    expect(declared.size).toBeGreaterThan(300);
  });

  for (const r of retentionRuleInventory()) {
    it(`${r.table}`, () => {
      const cols = declared.get(r.table);
      const key = cols?.find((c) => TENANT_KEYS.includes(c)) ?? null;
      if (key) {
        expect(r.orgColumn, `${r.table} carries ${key} but its retention rule has no orgColumn — a hold cannot stop it`).toBe(key);
      } else if (r.orgColumn) {
        expect(cols ?? [], `${r.table}.${r.orgColumn} is not a declared column`).toContain(r.orgColumn);
      } else {
        expect(
          NON_ORG_SCOPED_RULE_DISPOSITIONS[r.table],
          `${r.table} has no tenant key and no hold disposition in NON_ORG_SCOPED_RULE_DISPOSITIONS`,
        ).toBeTruthy();
      }
    });
  }

  it("no stale dispositions for tables that are no longer rules", () => {
    const tables = new Set(rules.map((r) => r.table));
    for (const t of Object.keys(NON_ORG_SCOPED_RULE_DISPOSITIONS)) expect(tables.has(t), t).toBe(true);
  });
});

describe("api_telemetry_samples has ONE retention owner (Leg 6.3)", () => {
  it("the nightly retention job does not purge it — the rollup does", () => {
    expect(retentionRuleInventory().map((r) => r.table)).not.toContain("api_telemetry_samples");
  });

  it("the rollup job's tick is no longer than its 5-minute daily window, so it runs every day", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/jobs/apiTelemetryRollupJob.ts"), "utf8"));
    const start = src.indexOf("function startApiTelemetryRollupJob");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start);
    // and it is still started by the scheduler
    const sched = stripComments(readFileSync(resolve(__dirname, "../../server/jobs/runScheduledJobs.ts"), "utf8"));
    expect(sched).toMatch(/\n\s*startApiTelemetryRollupJob\(\);/);
    expect(body).toMatch(/getUTCHours\(\) === 1 && now\.getUTCMinutes\(\) < 5/);
    const m = /const TICK_MS = (\d+) \* 60 \* 1000;/.exec(body);
    expect(m, "rollup tick constant not found").not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(5);
    expect(body).toMatch(/\}, TICK_MS\);/);
  });
});
