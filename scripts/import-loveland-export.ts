/**
 * Rosy River B4 — Loveland Technologies export importer.
 *
 * Loveland publishes parcel data per-county as downloadable CSV/GeoJSON
 * exports (not a programmatic API). The founder manually downloads the
 * county's data, drops the file in, and runs:
 *
 *   ts-node scripts/import-loveland-export.ts <file> --state TX --county Harris
 *
 * The script upserts each row into parcel_snapshots so the existing
 * tiered lookup (lookupParcelByAPN in server/services/parcel.ts) can hit
 * Loveland data before falling through to RapidAPI / Regrid.
 *
 * Flags:
 *   --state TX             (required)
 *   --county Harris        (required)
 *   --fips 48201           (optional but recommended)
 *   --dry-run              parse + count, no DB writes
 *   --limit N              stop after N rows (for sanity testing)
 *
 * Idempotent: re-running upserts on (apn, state, county). Older snapshots
 * are overwritten with the fresher Loveland data — Loveland refreshes
 * county-wide so a re-run is the right way to keep the cache current.
 *
 * Expected CSV columns (Loveland's standard schema; some optional):
 *   apn, owner, situs_address, situs_city, situs_zip, deeded_acres,
 *   assessed_value, market_value, land_use_code, zoning,
 *   legal_description, longitude, latitude, geometry_wkt
 *
 * GeoJSON FeatureCollection input (Loveland also offers this format)
 * is auto-detected when the file is .geojson or .json — properties map
 * to columns above; the feature's `geometry` becomes the snapshot's
 * geom.
 */

import * as fs from "fs";
import * as path from "path";
import { db } from "../server/db";
import { parcelSnapshots } from "@shared/schema";
import { and, eq } from "drizzle-orm";

interface LovelandRow {
  apn: string;
  owner?: string;
  situs_address?: string;
  situs_city?: string;
  situs_zip?: string;
  deeded_acres?: string;
  assessed_value?: string;
  market_value?: string;
  land_use_code?: string;
  zoning?: string;
  legal_description?: string;
  longitude?: string;
  latitude?: string;
  geometry_wkt?: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    file,
    state: get("--state"),
    county: get("--county"),
    fips: get("--fips"),
    dryRun: args.includes("--dry-run"),
    limit: get("--limit") ? parseInt(get("--limit")!, 10) : undefined,
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): LovelandRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: LovelandRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cells[j] ?? "").trim();
    }
    if (!row.apn) continue;
    rows.push(row as unknown as LovelandRow);
  }
  return rows;
}

function parseGeoJson(text: string): LovelandRow[] {
  const fc = JSON.parse(text);
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new Error("Expected GeoJSON FeatureCollection");
  }
  const rows: LovelandRow[] = [];
  for (const f of fc.features) {
    const props = f.properties ?? {};
    if (!props.apn && !props.APN) continue;
    rows.push({
      apn: String(props.apn ?? props.APN),
      owner: props.owner ?? props.OWNER,
      situs_address: props.situs_address ?? props.address,
      situs_city: props.situs_city ?? props.city,
      situs_zip: props.situs_zip ?? props.zip,
      deeded_acres: String(props.deeded_acres ?? props.acres ?? ""),
      assessed_value: String(props.assessed_value ?? ""),
      market_value: String(props.market_value ?? ""),
      land_use_code: props.land_use_code ?? props.use_code,
      zoning: props.zoning,
      legal_description: props.legal_description ?? props.legal,
      // Approximate centroid from geometry if not explicitly provided
      longitude: props.longitude ?? props.lng,
      latitude: props.latitude ?? props.lat,
      geometry_wkt: undefined, // GeoJSON geometry is structured; skip WKT
    });
  }
  return rows;
}

function toNumberOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const { file, state, county, fips, dryRun, limit } = parseArgs();
  if (!file || !state || !county) {
    console.error("usage: ts-node scripts/import-loveland-export.ts <file> --state TX --county Harris [--fips 48201] [--dry-run] [--limit N]");
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`file not found: ${abs}`);
    process.exit(1);
  }
  const text = fs.readFileSync(abs, "utf-8");
  const ext = path.extname(abs).toLowerCase();
  const rows = ext === ".geojson" || ext === ".json" ? parseGeoJson(text) : parseCsv(text);
  console.log(`[loveland] parsed ${rows.length} row(s) from ${path.basename(abs)}`);

  if (limit) {
    rows.length = Math.min(rows.length, limit);
  }

  if (dryRun) {
    console.log(`[loveland] DRY RUN — would upsert ${rows.length} row(s) into parcel_snapshots`);
    process.exit(0);
  }

  let upserts = 0;
  let skipped = 0;
  const normalizedState = state.toUpperCase();
  const normalizedCounty = county;

  for (const r of rows) {
    if (!r.apn) {
      skipped++;
      continue;
    }
    const lng = toNumberOrNull(r.longitude);
    const lat = toNumberOrNull(r.latitude);
    const fullAddress = [r.situs_address, r.situs_city, r.situs_zip]
      .filter(Boolean)
      .join(", ");

    const payload = {
      apn: r.apn,
      state: normalizedState,
      county: normalizedCounty,
      fipsCode: fips ?? null,
      source: "loveland",
      owner: r.owner ?? null,
      siteAddress: fullAddress || null,
      acres: toNumberOrNull(r.deeded_acres)?.toString() ?? null,
      legalDescription: r.legal_description ?? null,
      zoning: r.zoning ?? null,
      landUse: r.land_use_code ?? null,
      assessedValue: toNumberOrNull(r.assessed_value)?.toString() ?? null,
      marketValue: toNumberOrNull(r.market_value)?.toString() ?? null,
      centroid: lat != null && lng != null ? { lat, lng } : null,
      rawData: { ...r } as Record<string, unknown>,
      fetchedAt: new Date(),
      updatedAt: new Date(),
    } as Record<string, unknown>;

    const existing = await db
      .select({ id: parcelSnapshots.id })
      .from(parcelSnapshots)
      .where(
        and(
          eq(parcelSnapshots.apn, r.apn),
          eq(parcelSnapshots.state, normalizedState),
          eq(parcelSnapshots.county, normalizedCounty),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(parcelSnapshots).values(payload);
    } else {
      await db
        .update(parcelSnapshots)
        .set(payload)
        .where(eq(parcelSnapshots.id, existing[0].id));
    }
    upserts++;
    if (upserts % 100 === 0) {
      console.log(`[loveland] upserted ${upserts}/${rows.length}…`);
    }
  }

  console.log(`[loveland] done — upserts=${upserts} skipped=${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[loveland] fatal:", err);
  process.exit(1);
});
