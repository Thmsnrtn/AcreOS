#!/usr/bin/env node
/**
 * backfill-observations.mjs — Iyari (Chief of Future), elevation idea #3.
 *
 * THE NOW-OR-NEVER WINDOW. The parcel_observations log (migration 0121) is the
 * one asset we cannot buy retroactively: longitudinal parcel facts captured at
 * the marginal cost of one async insert. Organically the log grows one point per
 * lookup, so a real trend takes YEARS to accumulate — which starves the Biography
 * engine (server/services/parcel-biography.ts) and the delta detector until a
 * parcel has >2 points.
 *
 * BUT for the counties we already crawl, many ArcGIS assessor layers expose
 * HISTORICAL fields right now: an assessment YEAR, PRIOR-year assessed values,
 * a LAST-SALE / DEED date. Every day we don't capture those into the log with
 * their REAL observed_at, we lose the cheapest depth our time series will ever
 * have. This script reaches back through that window before it closes.
 *
 * WHAT IT DOES (built-to-learn — ugly is fine, honesty is not):
 *   1. AUDIT (default): for each active county_gis_endpoint, queries a bounded
 *      sample of APNs we already own (from `properties`) and reports which
 *      historical fields the endpoint actually returns. Writes NOTHING. This is
 *      the "which seeded counties expose history" survey the memo asks for.
 *   2. BACKFILL (`--write`): for every historical field found, writes a
 *      parcel_observations row with a BACKDATED observed_at derived from the
 *      field's own year/date — so a parcel can show a multi-point trend on day
 *      one instead of a single dot.
 *
 * SAFETY / DISCIPLINE:
 *   - IDEMPOTENT: before inserting, checks for an existing row with the same
 *     (apn, field, source, observed_at). Re-running only fills genuine gaps.
 *   - APPEND-ONLY: only INSERTs. Never UPDATE/DELETE. Does NOT touch the
 *     observation-log writer, snapshots, or LandProfile.
 *   - BOUNDED: --limit caps APNs per county; --counties filters; polite delay
 *     between external calls; per-call timeout. Default audit hits at most a few
 *     parcels per county.
 *   - source = "backfill_county_gis" so backfilled rows are always
 *     distinguishable from live-captured observations in provenance.
 *
 * USAGE:
 *   DATABASE_URL=... node scripts/backfill-observations.mjs            # audit
 *   DATABASE_URL=... node scripts/backfill-observations.mjs --write    # backfill
 *   ... --counties="Cochise,Yavapai" --limit=25 --delay=400
 */

import pg from "pg";

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`${k}=`));
  return hit ? hit.slice(k.length + 1) : d;
};

if (has("--help") || has("-h")) {
  console.log(`backfill-observations.mjs — backdated parcel-observation backfill (Iyari #3)

  --write              actually INSERT observations (default: audit only)
  --counties=A,B       only these county names (case-insensitive)
  --limit=N            max APNs sampled per county (default 25)
  --delay=MS           ms between external ArcGIS calls (default 350)
  --timeout=MS         per-call timeout (default 8000)
  --help               this text`);
  process.exit(0);
}

const WRITE = has("--write");
const COUNTY_FILTER = (val("--counties", "") || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const PER_COUNTY_LIMIT = Math.max(1, Number(val("--limit", "25")) || 25);
const DELAY_MS = Math.max(0, Number(val("--delay", "350")) || 350);
const TIMEOUT_MS = Math.max(1000, Number(val("--timeout", "8000")) || 8000);
const SOURCE = "backfill_county_gis";

if (!process.env.DATABASE_URL) {
  console.error("[backfill] DATABASE_URL not set — aborting");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── historical-field detectors ───────────────────────────────────────────────
// Each detector inspects a raw ArcGIS attribute bag and, if it recognizes a
// historical fact, returns { field, value, observedAt } where observedAt is the
// BACKDATED date implied by the data itself (an assessment year, a sale date).
// Conservative on purpose: a field we can't confidently date is SKIPPED, never
// stamped with today's date (that would pollute the log with fake history).

/** Find the first attribute whose KEY matches any regex, return [key, value]. */
function pick(attrs, patterns) {
  for (const key of Object.keys(attrs)) {
    const lower = key.toLowerCase();
    if (patterns.some((p) => p.test(lower))) {
      const v = attrs[key];
      if (v !== null && v !== undefined && v !== "") return [key, v];
    }
  }
  return null;
}

/** Coerce a 4-digit year out of a value; null if implausible. */
function toYear(v) {
  const n = Number(String(v).replace(/[^0-9]/g, "").slice(0, 4));
  if (!Number.isFinite(n) || n < 1900 || n > 2100) return null;
  return n;
}

/** Parse an epoch-ms / ISO / yyyymmdd-ish date; null if not datelike. */
function toDate(v) {
  if (v == null) return null;
  // ArcGIS commonly returns dates as epoch milliseconds.
  if (typeof v === "number" && v > 1_000_000_000_000) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && /\d{4}/.test(s)) return d;
  return null;
}

/** Mid-year date for a bare assessment year (honest granularity: the year). */
function yearToObservedAt(year) {
  return new Date(Date.UTC(year, 6, 1)); // Jul 1 of that year
}

const DETECTORS = [
  // Prior/historical assessed values keyed by a year-bearing field name.
  (attrs) => {
    const out = [];
    for (const key of Object.keys(attrs)) {
      const lower = key.toLowerCase();
      // e.g. ASSESSED_2021, ASSDVAL2020, ASMT_VAL_2019, TOTALVAL_2022
      const m = lower.match(/(assd|assess|asmt|aval|totalval|landval|val)[^0-9]*((19|20)\d{2})/);
      if (!m) continue;
      const year = toYear(m[2]);
      const num = Number(String(attrs[key]).replace(/[$,\s]/g, ""));
      if (year && Number.isFinite(num) && num > 0) {
        out.push({ field: "assessed_value", value: num, observedAt: yearToObservedAt(year) });
      }
    }
    return out;
  },

  // A single assessment-year + current assessed value pair → one backdated point.
  (attrs) => {
    const yearHit = pick(attrs, [/^(tax|assess|asmt)?_?year$/, /assessmentyear/, /taxyr/, /assyear/]);
    const valHit = pick(attrs, [/^assessed?val/, /^totalval/, /^total_assess/, /^assd_?total/]);
    if (!yearHit || !valHit) return [];
    const year = toYear(yearHit[1]);
    const num = Number(String(valHit[1]).replace(/[$,\s]/g, ""));
    if (year && Number.isFinite(num) && num > 0) {
      return [{ field: "assessed_value", value: num, observedAt: yearToObservedAt(year) }];
    }
    return [];
  },

  // Last sale / deed date → owner-change cadence anchor. We record the sale
  // PRICE (if present) and the deed event date as observed history.
  (attrs) => {
    const dateHit = pick(attrs, [/sale.?date/, /deed.?date/, /lastsale/, /saledt/, /transferdate/, /recorddate/]);
    if (!dateHit) return [];
    const when = toDate(dateHit[1]);
    if (!when) return [];
    const out = [{ field: "deed_date", value: when.toISOString().slice(0, 10), observedAt: when }];
    const priceHit = pick(attrs, [/sale.?price/, /saleamt/, /saleprice/, /lastsaleprice/]);
    if (priceHit) {
      const num = Number(String(priceHit[1]).replace(/[$,\s]/g, ""));
      if (Number.isFinite(num) && num > 0) {
        out.push({ field: "sale_price", value: num, observedAt: when });
      }
    }
    return out;
  },
];

/** Run every detector over an attribute bag; flatten the historical facts. */
function extractHistoricalFacts(attrs) {
  const facts = [];
  for (const detector of DETECTORS) {
    try {
      for (const f of detector(attrs) || []) facts.push(f);
    } catch {
      /* a malformed county bag must never crash the run */
    }
  }
  // De-dupe identical (field, observedAt-day, value) within one parcel.
  const seen = new Set();
  return facts.filter((f) => {
    const k = `${f.field}|${f.observedAt.toISOString().slice(0, 10)}|${JSON.stringify(f.value)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── ArcGIS query (mirrors server/services/parcel.ts queryArcGISEndpoint) ──────
async function queryEndpoint(endpoint, apn) {
  const apnField = endpoint.apn_field || "APN";
  const cleanApn = String(apn).replace(/[-\s]/g, "");
  const variants = [...new Set([cleanApn, String(apn).trim(), cleanApn.replace(/^0+/, "")])];
  const baseUrl = String(endpoint.base_url || "").replace(/\/$/, "");
  const layerId = endpoint.layer_id || "0";
  const extra = endpoint.additional_params || {};

  for (const variant of variants) {
    const params = new URLSearchParams({
      where: `${apnField} = '${variant}'`,
      outFields: "*",
      returnGeometry: "false",
      f: "json",
      ...extra,
    });
    const url = `${baseUrl}/${layerId}/query?${params.toString()}`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "AcreOS-backfill (+https://acreos.io)" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.error) continue;
      const feat = data?.features?.[0];
      if (feat?.attributes) return feat.attributes;
    } catch {
      /* timeout / network — try next variant, then give up on this APN */
    }
  }
  return null;
}

// ── main ──────────────────────────────────────────────────────────────────────
const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  console.log(`[backfill] mode=${WRITE ? "WRITE" : "AUDIT"} limit/county=${PER_COUNTY_LIMIT} delay=${DELAY_MS}ms`);

  // Active, verified endpoints we already crawl.
  const endpoints = (
    await client.query(`
      SELECT id, state, county, apn_field, base_url, layer_id, additional_params, is_active, is_verified
      FROM county_gis_endpoints
      WHERE is_active = true
      ORDER BY state, county
    `)
  ).rows.filter((e) => COUNTY_FILTER.length === 0 || COUNTY_FILTER.includes(String(e.county).toLowerCase()));

  if (endpoints.length === 0) {
    console.log("[backfill] no matching active county_gis_endpoints — nothing to do");
    await client.end();
    return;
  }

  const totals = {
    countiesScanned: 0,
    countiesWithHistory: 0,
    apnsSampled: 0,
    apnsHit: 0,
    factsFound: 0,
    inserted: 0,
    skippedExisting: 0,
    skippedNoApns: 0,
  };

  for (const ep of endpoints) {
    // APNs we already own in this county (the safe, bounded sample set).
    const apns = (
      await client.query(
        `SELECT DISTINCT apn FROM properties
         WHERE apn IS NOT NULL AND apn <> ''
           AND lower(county) = lower($1) AND upper(state) = upper($2)
         LIMIT $3`,
        [ep.county, ep.state, PER_COUNTY_LIMIT],
      )
    ).rows.map((r) => r.apn);

    totals.countiesScanned++;

    if (apns.length === 0) {
      totals.skippedNoApns++;
      console.log(`[backfill] ${ep.county}, ${ep.state}: no owned APNs to sample — skipped`);
      continue;
    }

    let countyFacts = 0;
    const fieldHistogram = {};

    for (const apn of apns) {
      totals.apnsSampled++;
      const attrs = await queryEndpoint(ep, apn);
      await sleep(DELAY_MS);
      if (!attrs) continue;
      totals.apnsHit++;

      const facts = extractHistoricalFacts(attrs);
      if (facts.length === 0) continue;
      countyFacts += facts.length;
      totals.factsFound += facts.length;

      for (const f of facts) {
        fieldHistogram[f.field] = (fieldHistogram[f.field] || 0) + 1;
        if (!WRITE) continue;

        // Idempotency: skip if an identical backfilled row already exists.
        const exists = await client.query(
          `SELECT 1 FROM parcel_observations
           WHERE apn = $1 AND field = $2 AND source = $3 AND observed_at = $4
           LIMIT 1`,
          [apn, f.field, SOURCE, f.observedAt.toISOString()],
        );
        if (exists.rowCount > 0) {
          totals.skippedExisting++;
          continue;
        }

        await client.query(
          `INSERT INTO parcel_observations
             (organization_id, apn, state, county, field, value, source, confidence, observed_at)
           VALUES (NULL, $1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
          [
            apn,
            String(ep.state).toUpperCase(),
            ep.county,
            f.field,
            JSON.stringify(f.value),
            SOURCE,
            null,
            f.observedAt.toISOString(),
          ],
        );
        totals.inserted++;
      }
    }

    if (countyFacts > 0) {
      totals.countiesWithHistory++;
      const hist = Object.entries(fieldHistogram)
        .map(([k, n]) => `${k}×${n}`)
        .join(", ");
      console.log(
        `[backfill] ${ep.county}, ${ep.state}: ${countyFacts} historical facts across ${apns.length} APNs — ${hist}`,
      );
    } else {
      console.log(
        `[backfill] ${ep.county}, ${ep.state}: no historical fields exposed (${apns.length} APNs sampled)`,
      );
    }
  }

  await client.end();

  console.log("\n[backfill] ── summary ──────────────────────────────");
  console.log(`  counties scanned ......... ${totals.countiesScanned}`);
  console.log(`  counties with history .... ${totals.countiesWithHistory}`);
  console.log(`  counties w/o owned APNs .. ${totals.skippedNoApns}`);
  console.log(`  APNs sampled / hit ....... ${totals.apnsSampled} / ${totals.apnsHit}`);
  console.log(`  historical facts found ... ${totals.factsFound}`);
  if (WRITE) {
    console.log(`  observations inserted .... ${totals.inserted}`);
    console.log(`  skipped (already present)  ${totals.skippedExisting}`);
  } else {
    console.log(`  (audit only — re-run with --write to backfill these as backdated observations)`);
  }
  console.log("[backfill] done.");
}

main().catch((err) => {
  console.error("[backfill] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
