#!/usr/bin/env tsx
/**
 * Remove due-diligence checklist rows whose organization is not the
 * organization that holds their property.
 *
 * A checklist belongs to the property holder's organization, and the read
 * now says so (storage.getDueDiligenceChecklist takes the organization). Rows
 * recorded under any other organization are never served again; this removes
 * them. It prints COUNTS only — no row contents. With --apply it first exports
 * the rows it found to JSON, then deletes, in one transaction, only those ids
 * that still sit outside their property's organization, and reports how many
 * the DELETE actually removed.
 *
 * Founder-run only (a production deletion):
 *   DATABASE_URL=... npx tsx scripts/data/delete-checklists-outside-property-org.ts          # dry run
 *   DATABASE_URL=... npx tsx scripts/data/delete-checklists-outside-property-org.ts --apply  # export + delete
 */
import { connect, exportRows, isMain, parseFlags, type Queryable } from "./_client";

/** A checklist whose organization differs from its property's organization. */
export const OUTSIDE_PROPERTY_ORG = `
  FROM due_diligence_checklists c
  JOIN properties p ON p.id = c.property_id
  WHERE c.organization_id <> p.organization_id`;

export async function deleteChecklistsOutsidePropertyOrg(
  client: Queryable,
  opts: { apply: boolean; outDir: string },
): Promise<{ count: number; deleted: number; exported: string | null; applied: boolean }> {
  const { rows } = await client.query<Record<string, unknown>>(`SELECT c.* ${OUTSIDE_PROPERTY_ORG} ORDER BY c.id`);
  if (!opts.apply || rows.length === 0) return { count: rows.length, deleted: 0, exported: null, applied: false };
  const exported = exportRows(opts.outDir, "due-diligence-checklists-outside-property-org", rows);
  let deleted = 0;
  await client.query("BEGIN");
  try {
    // Exactly the exported ids, and only while they still sit outside the
    // property's organization.
    const removed = await client.query(
      `DELETE FROM due_diligence_checklists c USING properties p
        WHERE c.id = ANY($1) AND p.id = c.property_id AND c.organization_id <> p.organization_id
        RETURNING c.id`,
      [rows.map((r) => r.id)],
    );
    deleted = removed.rows.length;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return { count: rows.length, deleted, exported, applied: true };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  const r = await deleteChecklistsOutsidePropertyOrg(client, flags);
  await end();
  console.log(`  ${r.count} checklist row(s) recorded outside their property's organization`);
  console.log(
    r.applied
      ? `Exported to ${r.exported}, then deleted ${r.deleted} row(s).`
      : "Dry run: nothing changed. Re-run with --apply to export and delete.",
  );
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
