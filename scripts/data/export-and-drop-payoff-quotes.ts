#!/usr/bin/env tsx
/**
 * Founder ruling 2026-09-29 #9a: export, then drop, the legacy
 * `payoff_quotes` table.
 *
 * It has had no writer since DEFECT-0100 and — as of this commit — no reader:
 * the three legacy GET routes and their storage methods are removed and the
 * schema no longer declares it. Every payoff quote lives in
 * `note_payoff_quotes`. Run this AFTER that code is deployed.
 *
 * Every row is exported to JSON first; the drop runs only with --apply, and
 * only if the export wrote the same number of rows the table holds.
 *
 *   DATABASE_URL=... npx tsx scripts/data/export-and-drop-payoff-quotes.ts          # dry run (counts)
 *   DATABASE_URL=... npx tsx scripts/data/export-and-drop-payoff-quotes.ts --apply  # export + drop
 */
import { readFileSync } from "node:fs";
import { connect, exportRows, isMain, parseFlags, type Queryable } from "./_client";

export async function exportAndDropPayoffQuotes(
  client: Queryable,
  opts: { apply: boolean; outDir: string },
): Promise<{ exists: boolean; rows: number; exportPath: string | null; dropped: boolean }> {
  const { rows: t } = await client.query<{ reg: string | null }>(`SELECT to_regclass('public.payoff_quotes')::text AS reg`);
  if (!t[0]?.reg) return { exists: false, rows: 0, exportPath: null, dropped: false };
  const { rows } = await client.query(`SELECT * FROM payoff_quotes ORDER BY id`);
  if (!opts.apply) return { exists: true, rows: rows.length, exportPath: null, dropped: false };
  const exportPath = exportRows(opts.outDir, "payoff_quotes", rows);
  const written = JSON.parse(readFileSync(exportPath, "utf8")) as unknown[];
  if (written.length !== rows.length) {
    throw new Error(`export wrote ${written.length} of ${rows.length} rows — refusing to drop`);
  }
  await client.query("BEGIN");
  try {
    // Re-count inside the transaction: a row that appeared since the export
    // (there is no writer, but never assume) aborts the drop.
    const { rows: c } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM payoff_quotes`);
    if (Number(c[0]?.n) !== rows.length) throw new Error("payoff_quotes changed since the export — refusing to drop");
    await client.query(`DROP TABLE payoff_quotes`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return { exists: true, rows: rows.length, exportPath, dropped: true };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  const r = await exportAndDropPayoffQuotes(client, flags);
  await end();
  if (!r.exists) console.log("payoff_quotes does not exist — nothing to do.");
  else if (!r.dropped) console.log(`payoff_quotes holds ${r.rows} row(s). Dry run: nothing changed. Re-run with --apply to export and drop.`);
  else console.log(`Exported ${r.rows} row(s) to ${r.exportPath}, then dropped payoff_quotes.`);
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
