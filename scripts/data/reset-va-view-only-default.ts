#!/usr/bin/env tsx
/**
 * Migration 0269 follow-up: VA team members still carrying the OLD column
 * default go back to the role default (assigned leads only).
 *
 * `team_members.view_only_assigned_leads` was `NOT NULL DEFAULT false`, so a VA
 * whose row was written without the field (every invite accept) holds an
 * explicit `false`, which out-ranks the `va` role default. 0269 made the column
 * nullable — NULL now means "use the role's default" — but deliberately did
 * not rewrite rows: a stored `false` can also be an owner's deliberate choice
 * ("this VA may see the whole pool"), made through
 * PATCH /api/team/:id/view-only-assigned-leads.
 *
 * So the reset touches only rows where `false` cannot have been chosen:
 *   - role = 'va', view_only_assigned_leads = false, AND
 *   - no audit_log entry records that member's flag being SET by the toggle
 *     (entity_type 'team_member', changes.fields containing
 *     'viewOnlyAssignedLeads'). Those rows are counted and left alone.
 *
 * Effect of --apply: the selected rows get view_only_assigned_leads = NULL, so
 * those VAs read only the leads assigned to them. Output is counts only; the
 * export holds ids, org ids and the old value — no names or emails.
 *
 *   DATABASE_URL=... npx tsx scripts/data/reset-va-view-only-default.ts          # dry run (counts)
 *   DATABASE_URL=... npx tsx scripts/data/reset-va-view-only-default.ts --apply  # export, then reset
 */
import { connect, exportRows, isMain, parseFlags, type Queryable } from "./_client";

export interface VaDefaultRow {
  id: number;
  organization_id: number;
  view_only_assigned_leads: boolean;
}

/** A recorded toggle of this member's flag: the owner chose the value. */
const EXPLICIT_CHOICE = `EXISTS (
  SELECT 1 FROM audit_log a
   WHERE a.entity_type = 'team_member'
     AND a.entity_id = tm.id
     AND a.organization_id = tm.organization_id
     AND a.changes -> 'fields' ? 'viewOnlyAssignedLeads'
)`;

export const SELECT_CANDIDATES = `SELECT tm.id, tm.organization_id, tm.view_only_assigned_leads
  FROM team_members tm
 WHERE tm.role = 'va' AND tm.view_only_assigned_leads = false AND NOT ${EXPLICIT_CHOICE}
 ORDER BY tm.id`;

export const COUNT_EXPLICIT = `SELECT count(*)::int AS n
  FROM team_members tm
 WHERE tm.role = 'va' AND tm.view_only_assigned_leads = false AND ${EXPLICIT_CHOICE}`;

export async function resetVaViewOnlyDefault(
  client: Queryable,
  opts: { apply: boolean; outDir: string },
): Promise<{ candidates: number; keptExplicit: number; exportPath: string | null; applied: boolean }> {
  const { rows } = await client.query<VaDefaultRow>(SELECT_CANDIDATES);
  const explicit = await client.query<{ n: number | string }>(COUNT_EXPLICIT);
  const keptExplicit = Number(explicit.rows[0]?.n ?? 0);
  if (!opts.apply || rows.length === 0) {
    return { candidates: rows.length, keptExplicit, exportPath: null, applied: false };
  }
  const exportPath = exportRows(opts.outDir, "team-members-va-view-only-default-reset", rows);
  await client.query("BEGIN");
  try {
    // Re-asserts the selection predicate: a row toggled after the read keeps
    // the owner's new choice.
    await client.query(
      `UPDATE team_members tm SET view_only_assigned_leads = NULL
        WHERE tm.id = ANY($1::int[]) AND tm.role = 'va' AND tm.view_only_assigned_leads = false
          AND NOT ${EXPLICIT_CHOICE}`,
      [rows.map((r) => r.id)],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return { candidates: rows.length, keptExplicit, exportPath, applied: true };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  const r = await resetVaViewOnlyDefault(client, flags);
  await end();
  console.log(`${r.candidates} VA member(s) still at the old default (false, never toggled).`);
  console.log(`${r.keptExplicit} VA member(s) at false by a recorded owner/admin choice — left as they are.`);
  console.log(
    r.applied
      ? `Exported to ${r.exportPath}, then reset to the role default.`
      : "Dry run: nothing changed. Re-run with --apply to export and reset.",
  );
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
