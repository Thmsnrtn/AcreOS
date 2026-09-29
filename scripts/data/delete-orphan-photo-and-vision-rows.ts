#!/usr/bin/env tsx
/**
 * Founder ruling 2026-09-29 #9d: delete the photo and vision rows that point at
 * nothing (DEFECT-0164, DEFECT-0165).
 *
 * Before the S3 store (ruling #1) existed, two upload routes recorded rows for
 * images whose bytes were dropped, and a daily job wrote invented vision
 * "detections" for customer properties:
 *  - `rehab_photos` whose `s3_key` is not an `s3://` reference — before/after,
 *    lender-draw and tax-basis "evidence" with no image behind it;
 *  - `field_scout_photos` whose `url` is an `/uploads/…` path nothing serves —
 *    and whose image hash made the same photo un-uploadable once storage
 *    existed, through the dedup index;
 *  - every `property_vision_snapshots` row captured before the refusal shipped:
 *    no vision model has ever been configured (`visionAnalyzerConfigured()` is
 *    false), so every such row is the seeded pseudo-random output DEFECT-0165
 *    removed — and the `system_alerts` "significant change" rows those
 *    snapshots raised.
 *
 * Rows that hold a real `s3://` reference are never touched. Everything
 * deleted is exported to JSON first, in one transaction per table.
 *
 *   DATABASE_URL=... npx tsx scripts/data/delete-orphan-photo-and-vision-rows.ts          # dry run
 *   DATABASE_URL=... npx tsx scripts/data/delete-orphan-photo-and-vision-rows.ts --apply  # export + delete
 */
import { connect, exportRows, isMain, parseFlags, type Queryable } from "./_client";

/** Each target: the table and the predicate that marks a row as pointing at nothing. */
export const ORPHAN_TARGETS = [
  { table: "rehab_photos", where: `s3_key NOT LIKE 's3://%'` },
  { table: "field_scout_photos", where: `url NOT LIKE 's3://%'` },
  // Bounded to the era before the refusal shipped (DEFECT-0165, 2026-09-28):
  // every row from then is fabricated, and a real model configured later must
  // never have its snapshots swept up by a re-run of this script.
  { table: "property_vision_snapshots", where: `captured_at < '2026-09-29'` },
  // The "significant change" alerts those fabricated snapshots raised, in the
  // same era (audit of this script, 2026-09-29).
  { table: "system_alerts", where: `type = 'vision_change_detected' AND created_at < '2026-09-29'` },
] as const;

export async function deleteOrphanPhotoAndVisionRows(
  client: Queryable,
  opts: { apply: boolean; outDir: string },
): Promise<{ counts: Record<string, number>; exports: string[]; applied: boolean }> {
  const counts: Record<string, number> = {};
  const exports: string[] = [];
  const found: Array<{ table: string; where: string; rows: Array<Record<string, unknown>> }> = [];
  for (const t of ORPHAN_TARGETS) {
    const { rows } = await client.query<Record<string, unknown>>(`SELECT * FROM ${t.table} WHERE ${t.where} ORDER BY id`);
    counts[t.table] = rows.length;
    found.push({ ...t, rows });
  }
  if (!opts.apply) return { counts, exports, applied: false };
  for (const f of found) {
    if (f.rows.length === 0) continue;
    exports.push(exportRows(opts.outDir, `${f.table}-orphans`, f.rows));
    await client.query("BEGIN");
    try {
      // Delete exactly the exported ids, and only while they still match.
      await client.query(`DELETE FROM ${f.table} WHERE id = ANY($1) AND (${f.where})`, [f.rows.map((r) => r.id)]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
  return { counts, exports, applied: true };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  const r = await deleteOrphanPhotoAndVisionRows(client, flags);
  await end();
  for (const [t, n] of Object.entries(r.counts)) console.log(`  ${t}: ${n} row(s) point at nothing`);
  console.log(r.applied ? `Exported to ${r.exports.join(", ") || "(nothing)"}, then deleted.` : "Dry run: nothing changed. Re-run with --apply to export and delete.");
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
