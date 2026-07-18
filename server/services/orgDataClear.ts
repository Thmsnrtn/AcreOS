/**
 * Org-scoped record clearing — the engine behind POST /api/clear-demo-data.
 *
 * The old implementation deleted six tables and threw a foreign-key
 * violation (→ 500) the moment any lead/deal/property had dependent rows
 * (offers, conversations, campaign responses…). ~90 tables reference the
 * root tables with NO ACTION/RESTRICT rules, and the set grows with the
 * schema — so instead of a hand-maintained list, this walks the live FK
 * graph from information_schema at call time:
 *
 *   1. Compute the closure of tables that transitively BLOCK deletion of
 *      the roots (NO ACTION / RESTRICT foreign keys only — SET NULL and
 *      CASCADE edges never block and are left to Postgres).
 *   2. Delete org rows from every closure table, children before parents,
 *      via bounded multi-pass: a table that still has dependent rows
 *      simply fails that pass and succeeds on a later one. Pass count is
 *      bounded by FK-graph depth, capped at MAX_PASSES.
 *   3. Tables without an organization_id column are scoped through their
 *      parents: delete rows whose FK column points at a victim row
 *      (recursively org-scoped, depth-capped).
 *
 * Deliberately NOT one big transaction: the operation is idempotent and
 * retry-safe, and per-statement failures are expected control flow in the
 * multi-pass walk (a poisoned transaction would abort the whole run).
 */
import { sql } from "drizzle-orm";
import { db } from "../storage";
import { logger } from "../utils/logger";

/** Tables the Settings "Clear data" action promises to empty for the org. */
export const CLEAR_ROOT_TABLES = [
  "payments",
  "notes",
  "deals",
  "properties",
  "leads",
  "activity_log",
] as const;

const MAX_PASSES = 10;
const SCOPE_DEPTH = 4;

export interface FkEdge {
  child: string;
  childCol: string;
  parent: string;
  parentCol: string;
}

export interface ClearOutcome {
  cleared: Record<string, number>;
  passes: number;
  /** Tables that could not be emptied (should be [] on success). */
  blocked: string[];
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Closure of tables whose rows can block deletion of `roots`:
 * roots plus every table with a blocking FK path INTO the closure.
 * Exported for unit tests.
 */
export function computeBlockingClosure(
  edges: FkEdge[],
  roots: readonly string[],
): Set<string> {
  const closure = new Set<string>(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) {
      if (closure.has(e.parent) && !closure.has(e.child)) {
        closure.add(e.child);
        grew = true;
      }
    }
  }
  return closure;
}

/**
 * SQL subquery selecting `table`.`col` values belonging to `orgId`.
 * Org-scoped tables resolve directly; orgless tables resolve through
 * their blocking FK parents, depth-capped. Returns null when the table
 * can't be org-scoped within the depth budget. Exported for unit tests.
 */
export function buildVictimSubquery(
  table: string,
  col: string,
  orgId: number,
  edges: FkEdge[],
  orgTables: Set<string>,
  closure: Set<string>,
  depth: number = SCOPE_DEPTH,
  seen: Set<string> = new Set(),
): string | null {
  if (orgTables.has(table)) {
    return `SELECT ${ident(col)} FROM ${ident(table)} WHERE organization_id = ${Math.trunc(orgId)}`;
  }
  if (depth <= 0 || seen.has(table)) return null;
  const nextSeen = new Set(seen).add(table);
  const parts: string[] = [];
  for (const e of edges) {
    if (e.child !== table || !closure.has(e.parent)) continue;
    const parentSub = buildVictimSubquery(
      e.parent, e.parentCol, orgId, edges, orgTables, closure, depth - 1, nextSeen,
    );
    if (parentSub) {
      parts.push(
        `SELECT ${ident(col)} FROM ${ident(table)} WHERE ${ident(e.childCol)} IN (${parentSub})`,
      );
    }
  }
  return parts.length > 0 ? parts.join(" UNION ") : null;
}

async function loadBlockingEdges(): Promise<FkEdge[]> {
  const result = await db.execute(sql`
    SELECT tc.table_name  AS child,
           kcu.column_name AS child_col,
           ccu.table_name  AS parent,
           ccu.column_name AS parent_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND rc.delete_rule IN ('NO ACTION', 'RESTRICT')
  `);
  return (result.rows as Array<Record<string, unknown>>).map((r) => ({
    child: String(r.child),
    childCol: String(r.child_col),
    parent: String(r.parent),
    parentCol: String(r.parent_col),
  }));
}

async function loadOrgScopedTables(tables: Set<string>): Promise<Set<string>> {
  const result = await db.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
  `);
  const all = new Set(
    (result.rows as Array<Record<string, unknown>>).map((r) => String(r.table_name)),
  );
  return new Set([...tables].filter((t) => all.has(t)));
}

export async function clearOrganizationRecords(orgId: number): Promise<ClearOutcome> {
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error(`clearOrganizationRecords: invalid orgId ${orgId}`);
  }
  const edges = await loadBlockingEdges();
  const closure = computeBlockingClosure(edges, CLEAR_ROOT_TABLES);
  const orgTables = await loadOrgScopedTables(closure);

  const cleared: Record<string, number> = {};
  const pending = new Set(closure);
  let passes = 0;

  while (pending.size > 0 && passes < MAX_PASSES) {
    passes++;
    let settledThisPass = 0;
    for (const table of [...pending]) {
      try {
        let deleted = 0;
        if (orgTables.has(table)) {
          const r = await db.execute(
            sql.raw(`DELETE FROM ${ident(table)} WHERE organization_id = ${Math.trunc(orgId)}`),
          );
          deleted = r.rowCount ?? 0;
        } else {
          // Orgless table: remove only the rows pointing at this org's
          // victim rows — enough to unblock the parents, nothing more.
          for (const e of edges) {
            if (e.child !== table || !closure.has(e.parent)) continue;
            const sub = buildVictimSubquery(
              e.parent, e.parentCol, orgId, edges, orgTables, closure,
            );
            if (!sub) continue;
            const r = await db.execute(
              sql.raw(`DELETE FROM ${ident(table)} WHERE ${ident(e.childCol)} IN (${sub})`),
            );
            deleted += r.rowCount ?? 0;
          }
        }
        if (deleted > 0) cleared[table] = (cleared[table] ?? 0) + deleted;
        pending.delete(table);
        settledThisPass++;
      } catch {
        // Expected mid-walk: dependent rows remain — retry next pass.
      }
    }
    if (settledThisPass === 0) break; // no table can make progress — bail
  }

  const blocked = [...pending].sort();
  if (blocked.length > 0) {
    logger.error("clearOrganizationRecords left tables blocked", { orgId, blocked, passes });
  } else {
    logger.info("clearOrganizationRecords completed", {
      orgId,
      passes,
      tables: Object.keys(cleared).length,
      rows: Object.values(cleared).reduce((a, b) => a + b, 0),
    });
  }
  return { cleared, passes, blocked };
}
