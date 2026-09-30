#!/usr/bin/env tsx
/**
 * Audit of 9ed61f4: give legacy bulk-deleted leads the soft delete every list
 * read understands.
 *
 * `bulkDeleteLeads` used to set `status = 'deleted'` WITHOUT `deleted_at`.
 * Every lead list filters on `deleted_at`, so those leads stayed listed, and
 * the Undo (which matches `deleted_at IS NOT NULL`) restored nothing. The
 * repository now stamps `deleted_at` and keeps the real status; this script
 * brings the rows written before that fix in line: `deleted_at` is set to the
 * row's own `updated_at` (the moment of the bulk delete) and nothing else is
 * changed. A restore (which now resets a legacy `deleted` status to `new`)
 * brings any of them back.
 *
 * Only rows with `status = 'deleted' AND deleted_at IS NULL` are touched.
 * Everything touched is exported to JSON first, in one transaction.
 *
 *   DATABASE_URL=... npx tsx scripts/data/stamp-status-deleted-leads.ts          # dry run
 *   DATABASE_URL=... npx tsx scripts/data/stamp-status-deleted-leads.ts --apply  # export + stamp
 */
import { connect, exportRows, isMain, parseFlags, type Queryable } from "./_client";

export interface StatusDeletedLeadRow {
  id: number;
  organization_id: number;
  status: string;
  updated_at: string | Date | null;
}

export async function stampStatusDeletedLeads(
  client: Queryable,
  opts: { apply: boolean; outDir: string },
): Promise<{ rows: StatusDeletedLeadRow[]; exportPath: string | null; applied: boolean }> {
  const { rows } = await client.query<StatusDeletedLeadRow>(
    `SELECT id, organization_id, status, updated_at FROM leads
      WHERE status = 'deleted' AND deleted_at IS NULL
      ORDER BY id`,
  );
  if (!opts.apply || rows.length === 0) return { rows, exportPath: null, applied: false };
  const exportPath = exportRows(opts.outDir, "leads-status-deleted-without-deleted-at", rows);
  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE leads SET deleted_at = coalesce(updated_at, now())
        WHERE id = ANY($1::int[]) AND status = 'deleted' AND deleted_at IS NULL`,
      [rows.map((r) => r.id)],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return { rows, exportPath, applied: true };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  const r = await stampStatusDeletedLeads(client, flags);
  await end();
  console.log(`${r.rows.length} lead(s) deleted by status without deleted_at.`);
  console.log(r.applied ? `Exported to ${r.exportPath}, then stamped.` : "Dry run: nothing changed. Re-run with --apply to export and stamp.");
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
