/**
 * Unique-constraint NAME drift between shared/schema.ts and a database built
 * from this repo's migrations — the comparison, kept pure so a canary can feed
 * it fixtures (tests/unit/constraintNameDrift.test.ts) and the gate
 * (scripts/check-constraint-names.ts) can feed it a real database.
 *
 * WHY NAMES. A migration that writes `col TEXT NOT NULL UNIQUE` gets
 * Postgres's name, `<table>_<col>_key`. The schema's bare `.unique()` declares
 * Drizzle's, `<table>_<col>_unique`. Uniqueness holds either way, so nothing
 * fails at runtime — but the database does not match the schema that describes
 * it, `drizzle-kit push`/`generate` reads the difference as a constraint to
 * drop and re-add, and any code or migration that names the constraint (ON
 * CONFLICT ON CONSTRAINT, ALTER … DROP CONSTRAINT) names one that does not
 * exist. Found on event_mesh_events (2026-10-07).
 *
 * Each declared unique is classified against the database:
 *   ok       — a unique constraint or unique index with the declared name
 *   renamed  — uniqueness on exactly those columns exists, under another name
 *   missing  — no uniqueness on those columns at all (the worse finding: the
 *              schema promises a guarantee the database does not enforce)
 */
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

export interface UniqueSpec {
  table: string;
  name: string;
  columns: string[];
}

export interface ConstraintNameDiff {
  ok: UniqueSpec[];
  renamed: Array<UniqueSpec & { actual: string }>;
  missing: UniqueSpec[];
}

const key = (cols: string[]) => [...cols].sort().join(",");

/** Every unique a Drizzle schema module declares: column `.unique()` and table `unique()`. */
export function declaredUniques(schema: Record<string, unknown>): UniqueSpec[] {
  const out: UniqueSpec[] = [];
  for (const value of Object.values(schema)) {
    let cfg: ReturnType<typeof getTableConfig>;
    try {
      cfg = getTableConfig(value as PgTable);
    } catch {
      continue; // not a table
    }
    if (!cfg?.name || !Array.isArray(cfg.columns)) continue;
    for (const c of cfg.columns) {
      const col = c as unknown as { isUnique?: boolean; uniqueName?: string; name: string };
      if (col.isUnique) out.push({ table: cfg.name, name: col.uniqueName ?? `${cfg.name}_${col.name}_unique`, columns: [col.name] });
    }
    for (const u of cfg.uniqueConstraints) {
      const columns = u.columns.map((c) => c.name);
      // An unnamed table-level unique() gets Drizzle's default name.
      out.push({ table: cfg.name, name: u.getName() ?? `${cfg.name}_${columns.join("_")}_unique`, columns });
    }
  }
  return out;
}

/** Compare declared uniques with the uniques (constraints + unique indexes) a database has. */
export function diffUniqueNames(declared: UniqueSpec[], actual: UniqueSpec[]): ConstraintNameDiff {
  const byTable = new Map<string, UniqueSpec[]>();
  for (const a of actual) {
    const list = byTable.get(a.table) ?? [];
    list.push(a);
    byTable.set(a.table, list);
  }
  const diff: ConstraintNameDiff = { ok: [], renamed: [], missing: [] };
  for (const d of declared) {
    const there = byTable.get(d.table) ?? [];
    if (there.some((a) => a.name === d.name)) {
      diff.ok.push(d);
      continue;
    }
    const sameCols = there.find((a) => key(a.columns) === key(d.columns));
    if (sameCols) diff.renamed.push({ ...d, actual: sameCols.name });
    else diff.missing.push(d);
  }
  return diff;
}

/** The register key for one finding. */
export const findingKey = (f: UniqueSpec) => `${f.table}:${f.name}`;
