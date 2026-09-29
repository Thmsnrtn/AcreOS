#!/usr/bin/env tsx
/**
 * Founder ruling 2026-09-29 #9c (DEFECT-0155 residue): delete the
 * `market_metrics` "monthly" rows that re-published a single operator's
 * closed deal as a county's price per acre.
 *
 * How the pollution happened: each closed deal was written as a raw
 * contribution row (org NULL, period `transaction`). `analyzeMarket` then
 * copied the county's LATEST row — often that single deal — into a new
 * org-NULL "monthly" row with no data sources, and every later analysis
 * copied the latest row again. Readers now exclude raw contributions, but a
 * polluted monthly row is itself "published", so the single deal kept
 * propagating forward. The raw contribution rows are the network's legitimate
 * k-anonymous inputs and are KEPT.
 *
 * Rule (a fixed point, per county): a monthly, org-NULL, no-data-source row is
 * polluted when its median $/acre equals the median of the latest earlier
 * org-NULL row in the same county AND that earlier row is a raw contribution
 * or is itself polluted. Everything polluted is exported to JSON before the
 * delete, in one transaction.
 *
 *   DATABASE_URL=... npx tsx scripts/data/delete-polluted-market-rows.ts          # dry run
 *   DATABASE_URL=... npx tsx scripts/data/delete-polluted-market-rows.ts --apply  # export + delete
 */
import { connect, exportRows, isMain, parseFlags, type Queryable } from "./_client";

export interface MarketRow {
  id: number;
  county: string;
  state: string;
  metric_date: string | Date;
  period_type: string;
  organization_id: number | null;
  median_price_per_acre: string | null;
  data_sources: unknown;
}

export function findPollutedMonthlyRows(rows: MarketRow[]): MarketRow[] {
  const byCounty = new Map<string, MarketRow[]>();
  for (const r of rows) {
    if (r.organization_id !== null) continue;
    const k = `${r.state}::${r.county}`.toLowerCase();
    (byCounty.get(k) ?? byCounty.set(k, []).get(k)!).push(r);
  }
  const polluted: MarketRow[] = [];
  for (const list of byCounty.values()) {
    list.sort((a, b) => new Date(a.metric_date).getTime() - new Date(b.metric_date).getTime() || a.id - b.id);
    const tainted = new Set<number>();
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.period_type === "transaction") {
        tainted.add(r.id);
        continue;
      }
      const republication = r.period_type === "monthly" && (r.data_sources === null || r.data_sources === undefined);
      if (!republication || i === 0) continue;
      const prev = list[i - 1];
      const same =
        r.median_price_per_acre !== null &&
        prev.median_price_per_acre !== null &&
        Number(r.median_price_per_acre) === Number(prev.median_price_per_acre);
      if (same && tainted.has(prev.id)) {
        tainted.add(r.id);
        polluted.push(r);
      }
    }
  }
  return polluted;
}

export async function deletePollutedMarketRows(
  client: Queryable,
  opts: { apply: boolean; outDir: string },
): Promise<{ polluted: MarketRow[]; exportPath: string | null; applied: boolean }> {
  const { rows } = await client.query<MarketRow>(
    `SELECT * FROM market_metrics WHERE organization_id IS NULL
       AND (state, county) IN (SELECT DISTINCT state, county FROM market_metrics WHERE period_type = 'transaction')
     ORDER BY state, county, metric_date, id`,
  );
  const polluted = findPollutedMonthlyRows(rows);
  if (!opts.apply || polluted.length === 0) return { polluted, exportPath: null, applied: false };
  const exportPath = exportRows(opts.outDir, "market-metrics-polluted-rows", polluted);
  await client.query("BEGIN");
  try {
    await client.query(`DELETE FROM market_metrics WHERE id = ANY($1::int[]) AND organization_id IS NULL AND period_type = 'monthly'`, [
      polluted.map((p) => p.id),
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return { polluted, exportPath, applied: true };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  const r = await deletePollutedMarketRows(client, flags);
  await end();
  console.log(`${r.polluted.length} polluted monthly row(s) across ${new Set(r.polluted.map((p) => `${p.state}/${p.county}`)).size} counties.`);
  console.log(r.applied ? `Exported to ${r.exportPath}, then deleted.` : "Dry run: nothing changed. Re-run with --apply to export and delete.");
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
