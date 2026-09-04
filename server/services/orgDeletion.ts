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
 * Deliberate retentions (documented lawful basis, GDPR Art. 17(3)):
 *   - audit_events: append-only trigger (migration 0049), 7-year
 *     compliance floor — retained under Art. 17(3)(b) (legal obligation).
 *   - financial_ledger: organizationId is SET NULL on org delete — the
 *     money spine stays intact for accounting/tax retention, detached
 *     from the tenant.
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
]);

export interface OrgDeletionResult {
  orgId: number;
  deletedRowsByTable: Record<string, number>;
  /** Tables that still hold rows for the org after all passes — surfaced, not hidden. */
  residualTables: string[];
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
}

async function tenantScopedTables(): Promise<TenantScopedTable[]> {
  const res = await db.execute<{ table_name: string; column_name: string }>(sql`
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name IN (${sql.raw(TENANT_KEY_COLUMNS.map((c) => `'${c}'`).join(", "))})
      AND t.table_type = 'BASE TABLE'
      AND c.table_name != 'organizations'
    ORDER BY c.table_name, c.column_name
  `);
  const rows = (res as { rows?: Array<{ table_name: string; column_name: string }> }).rows ?? [];
  const byTable = new Map<string, string[]>();
  for (const r of rows) {
    if (RETAINED_TABLES.has(r.table_name)) continue;
    const cols = byTable.get(r.table_name);
    if (cols) cols.push(r.column_name);
    else byTable.set(r.table_name, [r.column_name]);
  }
  return [...byTable].map(([table, columns]) => ({ table, columns }));
}

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

  const tables = await tenantScopedTables();
  const columnsByTable = new Map(tables.map((t) => [t.table, t.columns]));
  const deletedRowsByTable: Record<string, number> = {};
  const remaining = new Set(tables.map((t) => t.table));
  let passes = 0;

  // Multi-pass: each pass attempts every remaining table; FK-blocked deletes
  // stay for the next pass. Converges because every successful delete only
  // ever unblocks parents. Bail when a pass makes zero progress.
  while (remaining.size > 0 && passes < 12) {
    passes++;
    let progressed = false;
    for (const table of [...remaining]) {
      try {
        // Whichever spelling(s) this table carries. `OR` rather than one
        // fixed column: a table with both must be cleared on both, and a
        // table with only `org_id` was previously not visited at all.
        const predicate = (columnsByTable.get(table) ?? ["organization_id"])
          .map((c) => `"${c}" = ${orgId}`)
          .join(" OR ");
        const res = await db.execute(sql.raw(
          `DELETE FROM "${table}" WHERE ${predicate}`,
        ));
        const count = (res as { rowCount?: number }).rowCount ?? 0;
        deletedRowsByTable[table] = (deletedRowsByTable[table] ?? 0) + count;
        remaining.delete(table);
        progressed = true;
      } catch {
        // FK-blocked (a child table still holds rows) — retry next pass.
      }
    }
    if (!progressed) break;
  }

  // Detach the retained financial spine (declared SET NULL, but assert it —
  // an FK left RESTRICT would otherwise block the org-row delete).
  try {
    await db.execute(sql`UPDATE financial_ledger SET organization_id = NULL WHERE organization_id = ${orgId}`);
  } catch { /* column/table may not exist on minimal installs */ }

  let orgRowDeleted = false;
  try {
    const res = await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
    orgRowDeleted = ((res as { rowCount?: number }).rowCount ?? 0) > 0;
  } catch (err) {
    logger.error(`[org-deletion] org row delete blocked for org ${orgId}`, err instanceof Error ? err : undefined);
  }

  const residualTables = [...remaining];
  const result: OrgDeletionResult = {
    orgId,
    deletedRowsByTable,
    residualTables,
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
      { metadata: { residualTables, orgRowDeleted } },
    );
  }

  return result;
}
