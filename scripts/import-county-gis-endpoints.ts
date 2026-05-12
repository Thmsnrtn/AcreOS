/**
 * Rosy River B3 — County GIS endpoint bulk importer.
 *
 * Reads a CSV file of county ArcGIS REST endpoints and upserts them into
 * county_gis_endpoints. Designed for piping in batches from public registries
 * (Open Address, state GIS portals, NACo county directories).
 *
 *   ts-node scripts/import-county-gis-endpoints.ts <file.csv>
 *   ts-node scripts/import-county-gis-endpoints.ts <file.csv> --verify
 *
 * The --verify flag issues a small GET against each endpoint's
 * MapServer?f=json metadata URL to confirm reachability before insertion.
 * Endpoints that fail verification are skipped and reported.
 *
 * CSV columns (header row required):
 *   state,county,fipsCode,baseUrl,layerId,apnField,ownerField,sourceUrl,notes
 *
 * Re-running is idempotent — existing (state, county) pairs are skipped
 * unless --update is passed (in which case the row is patched).
 */

import * as fs from "fs";
import * as path from "path";
import { db } from "../server/db";
import { countyGisEndpoints } from "@shared/schema";
import { and, eq } from "drizzle-orm";

interface CsvRow {
  state: string;
  county: string;
  fipsCode?: string;
  baseUrl: string;
  layerId?: string;
  apnField?: string;
  ownerField?: string;
  sourceUrl?: string;
  notes?: string;
}

function parseCsv(text: string): CsvRow[] {
  // Minimal CSV parser — handles quoted fields with embedded commas but not
  // newlines inside quotes (sufficient for the public registries we ingest).
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV needs at least header + 1 data row");
  }
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cells[j] ?? "").trim();
    }
    if (!row.state || !row.county || !row.baseUrl) continue;
    rows.push(row as unknown as CsvRow);
  }
  return rows;
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

async function verifyEndpoint(baseUrl: string): Promise<{ ok: boolean; reason?: string }> {
  // ArcGIS REST services respond to ?f=json on the MapServer root with a
  // service descriptor. Single GET with a short timeout is enough.
  try {
    const url = `${baseUrl.replace(/\/$/, "")}?f=json`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return { ok: false, reason: "non-JSON response" };
    }
    // ArcGIS error responses include { error: { code, message } } with 200 status
    if ((body as Record<string, unknown>).error) {
      return { ok: false, reason: `ArcGIS error: ${JSON.stringify((body as Record<string, unknown>).error)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith("--"));
  const verify = args.includes("--verify");
  const update = args.includes("--update");

  if (!filePath) {
    console.error("usage: ts-node scripts/import-county-gis-endpoints.ts <file.csv> [--verify] [--update]");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`file not found: ${absPath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(absPath, "utf-8");
  const rows = parseCsv(text);
  console.log(`[import] parsed ${rows.length} candidate endpoint(s) from ${path.basename(absPath)}`);

  let added = 0;
  let updated = 0;
  let skippedExisting = 0;
  let skippedInvalid = 0;
  const failures: Array<{ row: CsvRow; reason: string }> = [];

  for (const row of rows) {
    if (verify) {
      const v = await verifyEndpoint(row.baseUrl);
      if (!v.ok) {
        skippedInvalid++;
        failures.push({ row, reason: v.reason ?? "unknown" });
        console.warn(`[import] SKIP ${row.state}/${row.county} — ${v.reason}`);
        continue;
      }
    }

    const existing = await db
      .select({ id: countyGisEndpoints.id })
      .from(countyGisEndpoints)
      .where(
        and(
          eq(countyGisEndpoints.state, row.state.toUpperCase()),
          eq(countyGisEndpoints.county, row.county),
        ),
      )
      .limit(1);

    const payload = {
      state: row.state.toUpperCase(),
      county: row.county,
      fipsCode: row.fipsCode || null,
      endpointType: "arcgis_rest",
      baseUrl: row.baseUrl,
      layerId: row.layerId || "0",
      apnField: row.apnField || "APN",
      ownerField: row.ownerField || "OWNER",
      sourceUrl: row.sourceUrl || null,
      notes: row.notes || null,
      isActive: true,
      isVerified: verify, // marked verified only if we live-checked it
      lastVerified: verify ? new Date() : null,
      contributedBy: "bulk-import",
      updatedAt: new Date(),
    };

    if (existing.length === 0) {
      await db.insert(countyGisEndpoints).values(payload);
      added++;
      console.log(`[import] ADD  ${row.state}/${row.county}`);
    } else if (update) {
      await db.update(countyGisEndpoints).set(payload).where(eq(countyGisEndpoints.id, existing[0].id));
      updated++;
      console.log(`[import] UPDT ${row.state}/${row.county}`);
    } else {
      skippedExisting++;
    }
  }

  console.log(
    `\n[import] done — added=${added} updated=${updated} skipped_existing=${skippedExisting} skipped_invalid=${skippedInvalid}`,
  );

  if (failures.length > 0) {
    const failuresPath = absPath.replace(/\.csv$/i, ".failures.json");
    fs.writeFileSync(failuresPath, JSON.stringify(failures, null, 2));
    console.log(`[import] ${failures.length} failure(s) written to ${failuresPath}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[import] fatal:", err);
  process.exit(1);
});
