/**
 * Organization deletion — the right-to-erasure path (2026-07 DB audit).
 *
 * The audit found gdprService referencing `deleteOrganization(orgId)` that
 * NEVER EXISTED, ~190 org-scoped foreign keys with no cascade, and no way
 * to actually satisfy an account-deletion request end-to-end. This module
 * is that missing function.
 *
 * Approach — dynamic, multi-pass sweep instead of a hand-ordered list:
 *   1. Enumerate every table carrying a tenant key — `organization_id` OR
 *      `org_id`, the two spellings this schema uses — from information_schema
 *      (the FK graph is 300+ tables and still growing; a hand-maintained order
 *      would rot immediately).
 *   2. DELETE FROM each WHERE its tenant key = $orgId. Some deletes fail
 *      on the first pass because a NO ACTION child still holds rows —
 *      passes repeat until a full pass makes no progress (children drain
 *      first, parents succeed on a later pass).
 *   3. Delete the organizations row itself.
 *   4. Report residuals HONESTLY: anything still holding rows (append-only
 *      audit tables, exotic FK shapes) is returned to the caller and
 *      logged — never silently skipped.
 *
 * The tenant key is compared in ITS OWN TYPE (2026-10-26). Some tables key
 * the org as text (onboarding_funnel_metrics.org_id,
 * pax_user_context.organization_id); `text = integer` is a Postgres error,
 * which the FK-retry catch used to swallow, so those rows were never erased
 * for any org. Now: an integer-family key is compared to the number, a
 * text-family key to its decimal string, and a key of any other type is
 * REFUSED before anything is deleted. Only a foreign-key violation (23503)
 * is retried on the next pass; any other DELETE error stops the erasure
 * loudly (OrgErasureError) BEFORE the organizations row is deleted, so the
 * org stays visible and the erasure can be re-run once fixed.
 *
 * Deliberate retentions (documented lawful basis, GDPR Art. 17(3)):
 *   - audit_events: append-only trigger (migration 0049), 7-year
 *     compliance floor — retained under Art. 17(3)(b) (legal obligation).
 *   - financial_ledger: organizationId is SET NULL on org delete — the
 *     money spine stays intact for accounting/tax retention, detached
 *     from the tenant.
 *   - purpose_ledger: append-only (UPDATE/DELETE/TRUNCATE triggers, 0289)
 *     record of why each person-adjacent lookup was made — the evidence of
 *     a permissible purpose (FCRA/GLBA/DPPA), retained under Art. 17(3)(b).
 *     Its organization_id carries no FK, so the org row deletes cleanly;
 *     the sweep never tries the DELETE the trigger would refuse.
 *
 * SAFETY: founder-gated at the route; requires the exact org name typed
 * back as confirmation; refuses founder-flagged orgs outright.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";

/** Tables the sweep must NOT touch, with the reason on the same line. */
const RETAINED_TABLES = new Set<string>([
  "audit_events", // append-only trigger; 7-year floor; Art. 17(3)(b)
  "financial_ledger", // FK is SET NULL — accounting spine detaches, not deleted
  "mrr_snapshots", // platform-level aggregate, not tenant data
  "purpose_ledger", // append-only permissible-purpose record (D2e); no FK to organizations; Art. 17(3)(b)
]);

export interface OrgDeletionResult {
  orgId: number;
  deletedRowsByTable: Record<string, number>;
  /** Tables that still hold rows for the org after all passes — surfaced, not hidden. */
  residualTables: string[];
  /** For each residual table, the foreign-key error that kept it blocked. */
  residualReasons: Record<string, string>;
  orgRowDeleted: boolean;
  passes: number;
}

/**
 * The two spellings of the tenant key in this schema.
 *
 * `organization_id` is the convention; 42 tables use `org_id` instead, and
 * this sweep enumerated ONLY the first — so it was blind to
 * `integration_credentials` (the encrypted credential store),
 * `borrower_messages`, `user_sessions` / `user_activation_events` /
 * `user_feedback` (per-user history), the whole agent-memory set
 * (agent_episodic_memory, agent_semantic_memory, agent_working_memory_v13),
 * `founder_interactions` and the scp_* memory tables.
 *
 * None of them is in RETAINED_TABLES, so they were not deliberate retentions
 * under Art. 17(3) — they were invisible. And because 33 of the 42 carry no
 * foreign key to `organizations`, they did not even block the final org-row
 * delete: a run returned `residualTables: []` and `orgRowDeleted: true` with
 * the rows still there (2026-09-04 review, CONFIRMED).
 *
 * A population defined by one literal is the third law's shape. The literal is
 * now a list, and the completeness of that list is asserted against
 * shared/schema*.ts — not against this query — in
 * tests/unit/orgDeletionCoversEveryTenantTable.test.ts, because a test that
 * derives the population from the deleter agrees with the deleter by
 * construction.
 */
const TENANT_KEY_COLUMNS = ["organization_id", "org_id"] as const;

interface TenantScopedTable {
  table: string;
  /** Which of TENANT_KEY_COLUMNS this table actually carries — one or both. */
  columns: string[];
  /** The WHERE clause matching the org, each key compared in its own type. */
  predicate: string;
}

/** A DELETE step that could not run for a reason other than an FK still holding rows. */
class OrgErasureError extends Error {
  constructor(
    message: string,
    readonly failures: Record<string, string>,
  ) {
    super(message);
    this.name = "OrgErasureError";
  }
}

const INTEGER_KEY_TYPES = new Set(["smallint", "integer", "bigint", "numeric"]);
const TEXT_KEY_TYPES = new Set(["text", "character varying", "character"]);

/** `"col" = <orgId>` in the column's own type; null when no literal of that type can match. */
function tenantKeyMatch(column: string, dataType: string, orgId: number): string | null {
  if (INTEGER_KEY_TYPES.has(dataType)) return `"${column}" = ${orgId}`;
  if (TEXT_KEY_TYPES.has(dataType)) return `"${column}" = '${orgId}'`;
  return null;
}

async function tenantScopedTables(orgId: number): Promise<TenantScopedTable[]> {
  const res = await db.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name IN (${sql.join(TENANT_KEY_COLUMNS.map((c) => sql`${c}`), sql`, `)})
      AND t.table_type = 'BASE TABLE'
      AND c.table_name != 'organizations'
    ORDER BY c.table_name, c.column_name
  `);
  const rows = (res as { rows?: Array<{ table_name: string; column_name: string; data_type: string }> }).rows ?? [];
  const byTable = new Map<string, { columns: string[]; matches: string[] }>();
  const unmatchable: Record<string, string> = {};
  for (const r of rows) {
    if (RETAINED_TABLES.has(r.table_name)) continue;
    const match = tenantKeyMatch(r.column_name, r.data_type, orgId);
    if (!match) {
      unmatchable[`${r.table_name}.${r.column_name}`] = `tenant key of type ${r.data_type} cannot be matched to an organization id`;
      continue;
    }
    const entry = byTable.get(r.table_name) ?? { columns: [], matches: [] };
    entry.columns.push(r.column_name);
    entry.matches.push(match);
    byTable.set(r.table_name, entry);
  }
  if (Object.keys(unmatchable).length > 0) {
    throw new OrgErasureError(
      `deleteOrganization: refusing to start — ${Object.keys(unmatchable).length} tenant key column(s) have a type the sweep cannot match: ${Object.keys(unmatchable).join(", ")}`,
      unmatchable,
    );
  }
  // `OR` rather than one fixed column: a table with both spellings must be
  // cleared on both, and a table with only `org_id` must be visited at all.
  return [...byTable].map(([table, e]) => ({ table, columns: e.columns, predicate: e.matches.join(" OR ") }));
}

const isForeignKeyViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return (e?.code ?? e?.cause?.code) === "23503";
};

/**
 * Hard-delete every org-scoped row and the org itself. Destructive and
 * irreversible — callers own the confirmation ceremony.
 */
export async function deleteOrganization(orgId: number): Promise<OrgDeletionResult> {
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error(`deleteOrganization: invalid orgId ${orgId}`);
  }

  // Refuse to delete a founder org — this is the one account whose loss is
  // unrecoverable operationally, and no erasure request can originate from it.
  const orgRes = await db.execute<{ is_founder: boolean; name: string }>(sql`
    SELECT is_founder, name FROM organizations WHERE id = ${orgId}
  `);
  const orgRow = ((orgRes as { rows?: Array<{ is_founder: boolean; name: string }> }).rows ?? [])[0];
  if (!orgRow) throw new Error(`deleteOrganization: org ${orgId} not found`);
  if (orgRow.is_founder) throw new Error(`deleteOrganization: refusing to delete a founder org`);

  const tables = await tenantScopedTables(orgId);
  const predicateByTable = new Map(tables.map((t) => [t.table, t.predicate]));
  const deletedRowsByTable: Record<string, number> = {};
  const remaining = new Set(tables.map((t) => t.table));
  /** Non-FK DELETE failures: never retried, never swallowed. */
  const failures: Record<string, string> = {};
  /** The last FK error per still-blocked table, so a residual carries its reason. */
  const blockedBy: Record<string, string> = {};
  let passes = 0;

  // Multi-pass: each pass attempts every remaining table; FK-blocked deletes
  // stay for the next pass. Converges because every successful delete only
  // ever unblocks parents. Bail when a pass makes zero progress.
  while (remaining.size > 0 && passes < 12) {
    passes++;
    let progressed = false;
    for (const table of [...remaining]) {
      if (failures[table]) continue;
      try {
        const predicate = predicateByTable.get(table);
        if (!predicate) throw new Error(`no tenant predicate for ${table}`);
        const res = await db.execute(sql.raw(
          `DELETE FROM "${table}" WHERE ${predicate}`,
        ));
        const count = (res as { rowCount?: number }).rowCount ?? 0;
        deletedRowsByTable[table] = (deletedRowsByTable[table] ?? 0) + count;
        remaining.delete(table);
        delete blockedBy[table];
        progressed = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // FK-blocked (a child table still holds rows) — retry next pass.
        // Anything else cannot succeed by retrying: record it, loudly.
        if (isForeignKeyViolation(err)) blockedBy[table] = message;
        else failures[table] = message;
      }
    }
    if (!progressed) break;
  }

  if (Object.keys(failures).length > 0) {
    logger.error(
      `[org-deletion] erasure for org ${orgId} STOPPED — ${Object.keys(failures).length} table(s) could not be deleted; the organizations row is kept so the erasure can be re-run`,
      undefined,
      { metadata: { failures, deletedRowsByTable } },
    );
    throw new OrgErasureError(
      `deleteOrganization: ${Object.keys(failures).length} table(s) failed with a non-FK error (${Object.keys(failures).join(", ")}); the organizations row was NOT deleted`,
      failures,
    );
  }

  // Detach the retained financial spine (declared SET NULL, but assert it —
  // an FK left RESTRICT would otherwise block the org-row delete).
  try {
    await db.execute(sql`UPDATE financial_ledger SET organization_id = NULL WHERE organization_id = ${orgId}`);
  } catch (err) {
    // Tolerated ONLY when the table or column does not exist (a minimal
    // install); any other failure leaves the ledger attached — stop loudly.
    const code = (err as { code?: string; cause?: { code?: string } } | null)?.code ?? (err as { cause?: { code?: string } } | null)?.cause?.code;
    if (code !== "42P01" && code !== "42703") {
      const message = err instanceof Error ? err.message : String(err);
      throw new OrgErasureError(`deleteOrganization: could not detach financial_ledger for org ${orgId}: ${message}`, { financial_ledger: message });
    }
  }

  let orgRowDeleted = false;
  try {
    const res = await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
    orgRowDeleted = ((res as { rowCount?: number }).rowCount ?? 0) > 0;
  } catch (err) {
    logger.error(`[org-deletion] org row delete blocked for org ${orgId}`, err instanceof Error ? err : undefined);
  }

  const residualTables = [...remaining];
  const residualReasons = Object.fromEntries(residualTables.map((t) => [t, blockedBy[t] ?? "unknown"]));
  const result: OrgDeletionResult = {
    orgId,
    deletedRowsByTable,
    residualTables,
    residualReasons,
    orgRowDeleted,
    passes,
  };

  logger.info(`[org-deletion] org ${orgId} deletion completed`, {
    metadata: {
      orgRowDeleted,
      passes,
      tablesCleared: Object.keys(deletedRowsByTable).length,
      rowsDeleted: Object.values(deletedRowsByTable).reduce((a, b) => a + b, 0),
      residualTables,
    },
  });
  if (residualTables.length > 0 || !orgRowDeleted) {
    logger.error(
      `[org-deletion] INCOMPLETE erasure for org ${orgId} — residuals must be resolved manually`,
      undefined,
      { metadata: { residualTables, residualReasons, orgRowDeleted } },
    );
  }

  return result;
}
