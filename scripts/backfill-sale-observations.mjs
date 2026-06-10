#!/usr/bin/env node
/**
 * backfill-sale-observations.mjs — Tier 2A (elevation-blueprint-2026-06-10.md),
 * scope item 2: use the plumbed-but-unused observedAt.
 *
 * parcel_snapshots has been quietly accumulating lastSaleDate/lastSalePrice on
 * every lookup, but those facts never reached the parcel_observations log with
 * their REAL dates — so the tenure clock and deed-cadence engine in
 * parcel-biography.ts start from zero even where we already know a sale
 * happened in 2009. This one-shot script reaches back and writes DATED
 * observations (observed_at = the sale date itself) from every snapshot that
 * carries a sale date, giving the Biography engine decades of depth on day one.
 *
 * SAFETY / DISCIPLINE (mirrors scripts/backfill-observations.mjs):
 *   - AUDIT by default; only `--write` inserts. Audit prints what WOULD land.
 *   - IDEMPOTENT: skips rows where an identical (apn, field, source,
 *     observed_at) observation already exists. Re-running fills gaps only.
 *   - APPEND-ONLY: INSERT only — parcel_observations is trigger-enforced
 *     append-only anyway (migration 0148).
 *   - HONEST DATES: a snapshot with an implausible sale date (pre-1900 or
 *     future) is skipped, never stamped with today's date.
 *   - Preserves the snapshot's organization_id (NULL = shared/global cache).
 *   - source = "backfill_snapshot_sale" so provenance is always inspectable.
 *
 * USAGE:
 *   DATABASE_URL=... node scripts/backfill-sale-observations.mjs           # audit
 *   DATABASE_URL=... node scripts/backfill-sale-observations.mjs --write   # backfill
 *   ... --limit=5000   (cap snapshots processed; default unbounded)
 */

import pg from "pg";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`${k}=`));
  return hit ? hit.slice(k.length + 1) : d;
};

if (has("--help") || has("-h")) {
  console.log(`backfill-sale-observations.mjs — dated sale observations from parcel_snapshots (Tier 2A)

  --write       actually INSERT observations (default: audit only)
  --limit=N     max snapshots processed (default: all)
  --help        this text`);
  process.exit(0);
}

const WRITE = has("--write");
const LIMIT = Math.max(0, Number(val("--limit", "0")) || 0); // 0 = unbounded
const SOURCE = "backfill_snapshot_sale";

if (!process.env.DATABASE_URL) {
  console.error("[backfill-sale] DATABASE_URL not set — aborting");
  process.exit(1);
}

/** Plausibility gate — mirrors coerceSaleDate in observation-log.ts. */
function plausibleSaleDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  const maxYear = new Date().getUTCFullYear() + 1;
  return year >= 1900 && year <= maxYear;
}

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  console.log(`[backfill-sale] mode=${WRITE ? "WRITE" : "AUDIT"}${LIMIT ? ` limit=${LIMIT}` : ""}`);

  // Latest snapshot per (apn, state, county) that carries a sale date — a
  // re-fetched parcel must not produce duplicate sale observations.
  const rows = (
    await client.query(`
      SELECT DISTINCT ON (apn, upper(state), lower(county))
        apn, state, county, organization_id, last_sale_date, last_sale_price, source
      FROM parcel_snapshots
      WHERE last_sale_date IS NOT NULL
        AND apn IS NOT NULL AND apn <> ''
        AND state IS NOT NULL AND county IS NOT NULL
      ORDER BY apn, upper(state), lower(county), fetched_at DESC NULLS LAST
      ${LIMIT ? `LIMIT ${LIMIT}` : ""}
    `)
  ).rows;

  console.log(`[backfill-sale] ${rows.length} snapshots carry a sale date`);

  const totals = {
    snapshots: rows.length,
    implausibleDates: 0,
    factsEligible: 0,
    inserted: 0,
    skippedExisting: 0,
  };

  for (const snap of rows) {
    const saleDate = snap.last_sale_date instanceof Date ? snap.last_sale_date : new Date(snap.last_sale_date);
    if (!plausibleSaleDate(saleDate)) {
      totals.implausibleDates++;
      continue;
    }

    const facts = [{ field: "deed_date", value: saleDate.toISOString().slice(0, 10) }];
    const price = snap.last_sale_price != null ? Number(snap.last_sale_price) : NaN;
    if (Number.isFinite(price) && price > 0) {
      facts.push({ field: "sale_price", value: price });
    }

    for (const f of facts) {
      totals.factsEligible++;
      if (!WRITE) continue;

      // Idempotency: identical (apn, field, source, observed_at) → skip.
      const exists = await client.query(
        `SELECT 1 FROM parcel_observations
         WHERE apn = $1 AND field = $2 AND source = $3 AND observed_at = $4
         LIMIT 1`,
        [snap.apn, f.field, SOURCE, saleDate.toISOString()],
      );
      if (exists.rowCount > 0) {
        totals.skippedExisting++;
        continue;
      }

      await client.query(
        `INSERT INTO parcel_observations
           (organization_id, apn, state, county, field, value, source, confidence, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
        [
          snap.organization_id ?? null,
          snap.apn,
          String(snap.state).toUpperCase(),
          snap.county,
          f.field,
          JSON.stringify(f.value),
          SOURCE,
          null,
          saleDate.toISOString(),
        ],
      );
      totals.inserted++;
    }
  }

  await client.end();

  console.log("\n[backfill-sale] ── summary ─────────────────────────");
  console.log(`  snapshots with sale date . ${totals.snapshots}`);
  console.log(`  implausible dates skipped  ${totals.implausibleDates}`);
  console.log(`  eligible observations .... ${totals.factsEligible}`);
  if (WRITE) {
    console.log(`  inserted ................. ${totals.inserted}`);
    console.log(`  skipped (already present)  ${totals.skippedExisting}`);
  } else {
    console.log(`  (audit only — re-run with --write to insert these as dated observations)`);
  }
  console.log("[backfill-sale] done.");
}

main().catch((err) => {
  console.error("[backfill-sale] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
