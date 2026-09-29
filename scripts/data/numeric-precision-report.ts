#!/usr/bin/env tsx
/**
 * Founder ruling 2026-09-29 #10 (DEFECT-0052): READ-ONLY report of what a
 * numeric(14,2) migration would do to each bare `numeric` column.
 *
 * For every column declared `numeric` with no precision, it reports the row
 * count, the largest scale present, the largest magnitude, how many values
 * have more than 2 decimals (these would be ROUNDED) and how many are at or
 * above 1e12 (these would be REJECTED by numeric(14,2)). The per-table
 * migration is approved from this output. It never writes: the whole run is
 * one READ ONLY transaction.
 *
 *   DATABASE_URL=... npx tsx scripts/data/numeric-precision-report.ts [--out=dir]
 */
import { connect, exportRows, isMain, parseFlags, type Queryable } from "./_client";

export interface ColumnReport {
  table: string;
  column: string;
  rows: number;
  maxScale: number | null;
  maxAbs: string | null;
  wouldRound: number;
  wouldReject: number;
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function numericPrecisionReport(client: Queryable): Promise<ColumnReport[]> {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const { rows: cols } = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'numeric' AND numeric_precision IS NULL
        ORDER BY table_name, column_name`,
    );
    const out: ColumnReport[] = [];
    for (const c of cols) {
      const col = quoteIdent(c.column_name);
      const { rows } = await client.query<{
        n: string; max_scale: number | null; max_abs: string | null; round_n: string; reject_n: string;
      }>(
        `SELECT count(*) AS n, max(scale(${col})) AS max_scale, max(abs(${col}))::text AS max_abs,
                count(*) FILTER (WHERE scale(${col}) > 2) AS round_n,
                count(*) FILTER (WHERE abs(${col}) >= 1e12) AS reject_n
           FROM ${quoteIdent(c.table_name)}`,
      );
      const r = rows[0];
      out.push({
        table: c.table_name,
        column: c.column_name,
        rows: Number(r?.n ?? 0),
        maxScale: r?.max_scale ?? null,
        maxAbs: r?.max_abs ?? null,
        wouldRound: Number(r?.round_n ?? 0),
        wouldReject: Number(r?.reject_n ?? 0),
      });
    }
    return out.sort((a, b) => b.wouldReject - a.wouldReject || b.wouldRound - a.wouldRound);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  const report = await numericPrecisionReport(client);
  await end();
  const risky = report.filter((r) => r.wouldRound || r.wouldReject);
  console.log(`${report.length} bare numeric columns; ${risky.length} would change under numeric(14,2):`);
  for (const r of risky) console.log(`  ${r.table}.${r.column}: round ${r.wouldRound}, reject ${r.wouldReject}, max scale ${r.maxScale}, max |v| ${r.maxAbs}`);
  console.log(`full report: ${exportRows(flags.outDir, "numeric-precision-report", report)}`);
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
