/**
 * DEFECT-0048 — tables extracted from the schema monolith still load, and
 * their foreign keys still resolve, through the `@shared/schema` barrel.
 *
 * The barrel re-exports each module with `export *`, which is HOISTED: a
 * module under shared/schema/ evaluates before the monolith's own body. A
 * module that read a monolith table eagerly (anything outside a
 * `references(() => …)` callback) would hit the temporal dead zone at load.
 * This loads the real barrel, checks every table exported by every module is
 * a live Drizzle table reachable from the barrel, and forces every foreign-key
 * reference callback to run.
 */
import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { PgTable as PgTableClass } from "drizzle-orm/pg-core";
import * as barrel from "../../shared/schema";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const MODULE_DIR = resolve(__dirname, "../../shared/schema");
/** Modules deliberately imported by direct path, not through the barrel. */
const DIRECT_IMPORT_MODULES = new Set(["ach-autopay.ts", "solene-constitutional-violations.ts"]);

const modules = readdirSync(MODULE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("DEFECT-0048 — schema modules load through the barrel", () => {
  it("finds the modules (vacuity floor)", () => {
    expect(modules.length).toBeGreaterThanOrEqual(90);
  });

  it("every module table is a live table exported by the barrel, with resolvable foreign keys", async () => {
    let tables = 0;
    const problems: string[] = [];
    for (const file of modules) {
      const mod = (await import(resolve(MODULE_DIR, file))) as Record<string, unknown>;
      for (const [name, value] of Object.entries(mod)) {
        if (!is(value, PgTableClass)) continue;
        tables++;
        if (!DIRECT_IMPORT_MODULES.has(file) && (barrel as Record<string, unknown>)[name] !== value) problems.push(`${file}: ${name} not re-exported by the barrel`);
        try {
          for (const fk of getTableConfig(value as PgTable).foreignKeys) {
            const ref = fk.reference();
            if (!ref.foreignTable) problems.push(`${file}: ${name} has an unresolved foreign key`);
          }
        } catch (err) {
          problems.push(`${file}: ${name} threw resolving a foreign key: ${(err as Error).message}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(tables).toBeGreaterThanOrEqual(350);
  });
});
