/**
 * sanctionsListSync — LIVE OFAC list ingestion for the advisory name-matcher.
 *
 * ⚠️  ADVISORY DATA — NOT A LEGAL DETERMINATION ⚠️
 * ────────────────────────────────────────────────
 * This job fetches the PUBLIC U.S. Treasury OFAC data files, parses them, and
 * UPSERTs the cleartext entries into `sanctions_list_entries`. That table is
 * the live cached copy that backs the fuzzy advisory matcher in
 * `ofacScreening.ts`. A match against this data is ADVISORY — a founder-visible
 * flag for MANUAL review, never an automatic block and never a legal
 * determination.
 *
 * Data source — Treasury published data files
 * ───────────────────────────────────────────
 * We fetch the official Treasury OFAC download files (the same ones the
 * existing hash-gate uses), under https://www.treasury.gov/ofac/downloads/ :
 *
 *   - SDN list (primary):           https://www.treasury.gov/ofac/downloads/sdn.csv
 *   - Consolidated list (primary):  https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv
 *
 * Both share the SAME positional CSV layout (the "primary name" file):
 *   [0] ent_num   — Treasury's stable unique id (our `ofac_uid`)
 *   [1] SDN_Name  — primary display name
 *   [2] SDN_Type  — "individual" | "" (entity) | "vessel" | "aircraft"
 *   [3] Program   — program code(s), pipe/semicolon-delimited
 *   [4] Title
 *   [5] Call_Sign
 *   [6] Vess_type
 *   [7] Tonnage
 *   [8] GRT
 *   [9] Vess_flag
 *   [10] Vess_owner
 *   [11] Remarks  — free text; we also mine a published-date out of it
 *
 * We pick the CSV form because it is the most parseable without an XML
 * dependency and is stable across both lists. Aliases (alt.csv) and addresses
 * (add.csv) share the same `ent_num` join key; when those companion files are
 * reachable we fold them in, but the primary file alone is sufficient and the
 * job degrades gracefully if a companion file is missing.
 *
 * URLs are overridable via env (OFAC_SDN_URL, OFAC_CONSOLIDATED_URL, and the
 * *_ALT_URL / *_ADD_URL companions) so tests never hit the network and ops can
 * repoint at a mirror.
 *
 * Resilience contract
 * ───────────────────
 * On ANY fetch/parse failure for a list we LOG (structured `logger`) and
 * SKIP that list — we NEVER wipe the existing cached rows. A partial outage
 * (e.g. Consolidated reachable, SDN down) refreshes what it can and leaves the
 * rest intact. Good data is never replaced by an empty result.
 *
 * The actual UPSERT is keyed on the (source_list, ofac_uid) unique index, so
 * re-running is idempotent and rows that drop off the list age out via
 * `fetched_at` (we mark the run's published date; a future purge can prune
 * rows not seen in N days — left as a follow-up, not destructive here).
 */

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { sanctionsListEntries, type InsertSanctionsListEntry } from "@shared/schema";
import { logger } from "../../utils/logger";
import { normalizeName } from "./ofacScreening";

export type SourceList = "SDN" | "CONSOLIDATED";
export type EntityType = "individual" | "entity" | "vessel" | "aircraft";

const SDN_URL = process.env.OFAC_SDN_URL || "https://www.treasury.gov/ofac/downloads/sdn.csv";
const SDN_ALT_URL = process.env.OFAC_SDN_ALT_URL || "https://www.treasury.gov/ofac/downloads/alt.csv";
const SDN_ADD_URL = process.env.OFAC_SDN_ADD_URL || "https://www.treasury.gov/ofac/downloads/add.csv";

const CONSOLIDATED_URL =
  process.env.OFAC_CONSOLIDATED_URL ||
  "https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv";
const CONSOLIDATED_ALT_URL =
  process.env.OFAC_CONSOLIDATED_ALT_URL ||
  "https://www.treasury.gov/ofac/downloads/consolidated/cons_alt.csv";
const CONSOLIDATED_ADD_URL =
  process.env.OFAC_CONSOLIDATED_ADD_URL ||
  "https://www.treasury.gov/ofac/downloads/consolidated/cons_add.csv";

const FETCH_TIMEOUT_MS = 30_000;

// ─── CSV parsing (RFC-4180-ish, quoted-field aware) ──────────────────────────

/** Parse a single CSV line, honoring quoted fields containing commas. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
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
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  // Treasury uses "-0-" to mean "n/a"; collapse it to empty.
  return fields.map((f) => {
    const t = f.trim();
    return t === "-0-" ? "" : t;
  });
}

/** Split a CSV body into logical rows, tolerating quoted fields with newlines. */
function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Track quote state across the whole body so an embedded \n inside a
      // quoted Remarks field doesn't split the record.
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (cur.length > 0) rows.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) rows.push(cur);
  return rows;
}

// ─── Field mapping ───────────────────────────────────────────────────────────

/** Map Treasury's SDN_Type to our entity_type enum. Blank ⇒ "entity". */
export function mapEntityType(sdnType: string): EntityType {
  const t = (sdnType || "").trim().toLowerCase();
  if (t === "individual") return "individual";
  if (t === "vessel") return "vessel";
  if (t === "aircraft") return "aircraft";
  return "entity";
}

/** Split a Program field into discrete codes (Treasury uses "] [" / ";" / "|"). */
export function parsePrograms(program: string): string[] {
  if (!program) return [];
  return program
    .split(/\]\s*\[|[;|]/)
    .map((p) => p.replace(/[[\]]/g, "").trim())
    .filter((p) => p.length > 0);
}

/**
 * Mine a published date out of a Remarks field. Treasury embeds dates in a few
 * forms; we accept "DD Mon YYYY" / "Mon DD, YYYY" / ISO. Returns null if none.
 * This is a best-effort provenance signal — the run records `fetchedAt`
 * regardless; this only sharpens the "list current as of" surface.
 */
export function extractPublishedDate(remarks: string): Date | null {
  if (!remarks) return null;
  const tryParse = (s: string | undefined): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  // PREFER a date that follows "Listed " — Treasury uses that for the listing
  // date, which is the provenance we want (not a DOB that also matches the
  // generic date shapes below).
  const listedIso = remarks.match(/Listed\s+(\d{4}-\d{2}-\d{2})/i);
  const listedDmy = remarks.match(/Listed\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i);
  const listed = tryParse(listedIso?.[1]) ?? tryParse(listedDmy?.[1]);
  if (listed) return listed;

  // Fall back to the first date of either form anywhere in the remarks.
  const iso = remarks.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const isoDate = tryParse(iso?.[1]);
  if (isoDate) return isoDate;
  const dmy = remarks.match(/\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/);
  return tryParse(dmy?.[1]);
}

export interface ParsedEntry {
  sourceList: SourceList;
  entityType: EntityType;
  primaryName: string;
  normalizedName: string;
  aliases: string[];
  programs: string[];
  addresses: Array<Record<string, string>>;
  remarks: string | null;
  ofacUid: string;
  listPublishedAt: Date | null;
}

/**
 * Parse a Treasury primary-name CSV body into ParsedEntry rows.
 *
 * `altByUid` / `addrByUid` are optional companion maps (alt.csv / add.csv,
 * keyed by ent_num) that fold aliases + addresses in when available.
 */
export function parsePrimaryCsv(
  text: string,
  sourceList: SourceList,
  opts: {
    altByUid?: Map<string, string[]>;
    addrByUid?: Map<string, Array<Record<string, string>>>;
  } = {},
): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  const rows = splitCsvRows(text);
  const seen = new Set<string>();
  for (const line of rows) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    if (f.length < 4) continue;
    const ofacUid = f[0];
    const primaryName = f[1];
    if (!ofacUid || !primaryName) continue;
    // The primary file is one row per uid; guard against dupes anyway.
    if (seen.has(ofacUid)) continue;
    seen.add(ofacUid);

    const remarks = f[11] || "";
    out.push({
      sourceList,
      entityType: mapEntityType(f[2]),
      primaryName,
      normalizedName: normalizeName(primaryName),
      aliases: opts.altByUid?.get(ofacUid) ?? [],
      programs: parsePrograms(f[3]),
      addresses: opts.addrByUid?.get(ofacUid) ?? [],
      remarks: remarks || null,
      ofacUid,
      listPublishedAt: extractPublishedDate(remarks),
    });
  }
  return out;
}

/**
 * Parse an alt.csv body → Map<ent_num, alias[]>.
 * Layout: [0] ent_num, [1] alt_num, [2] alt_type, [3] alt_name, [4] remarks.
 */
export function parseAltCsv(text: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const line of splitCsvRows(text)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    if (f.length < 4) continue;
    const uid = f[0];
    const alias = f[3];
    if (!uid || !alias) continue;
    const arr = m.get(uid) ?? [];
    if (!arr.includes(alias)) arr.push(alias);
    m.set(uid, arr);
  }
  return m;
}

/**
 * Parse an add.csv body → Map<ent_num, address[]>.
 * Layout: [0] ent_num, [1] add_num, [2] address, [3] city/state/province,
 *         [4] country, [5] remarks.
 */
export function parseAddCsv(text: string): Map<string, Array<Record<string, string>>> {
  const m = new Map<string, Array<Record<string, string>>>();
  for (const line of splitCsvRows(text)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    if (f.length < 3) continue;
    const uid = f[0];
    if (!uid) continue;
    const addr: Record<string, string> = {};
    if (f[2]) addr.address = f[2];
    if (f[3]) addr.cityStateProvince = f[3];
    if (f[4]) addr.country = f[4];
    if (Object.keys(addr).length === 0) continue;
    const arr = m.get(uid) ?? [];
    arr.push(addr);
    m.set(uid, arr);
  }
  return m;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { method: "GET", signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`fetch ${url} returned HTTP ${resp.status}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort companion fetch — returns empty data (not an error) on failure. */
async function fetchAltMap(url: string): Promise<Map<string, string[]>> {
  try {
    return parseAltCsv(await fetchText(url));
  } catch (err) {
    logger.warn("[sanctionsListSync] alt companion fetch skipped", {
      metadata: { url, error: err instanceof Error ? err.message : String(err) },
    });
    return new Map();
  }
}

async function fetchAddrMap(url: string): Promise<Map<string, Array<Record<string, string>>>> {
  try {
    return parseAddCsv(await fetchText(url));
  } catch (err) {
    logger.warn("[sanctionsListSync] add companion fetch skipped", {
      metadata: { url, error: err instanceof Error ? err.message : String(err) },
    });
    return new Map();
  }
}

// ─── Upsert ──────────────────────────────────────────────────────────────────

/**
 * UPSERT parsed entries into sanctions_list_entries on the
 * (source_list, ofac_uid) unique index. Chunked. Pure DB I/O — exported so the
 * sync orchestrator and tests can drive it directly.
 */
export async function upsertEntries(entries: ParsedEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const now = new Date();
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK).map<InsertSanctionsListEntry>((e) => ({
      sourceList: e.sourceList,
      entityType: e.entityType,
      primaryName: e.primaryName,
      normalizedName: e.normalizedName,
      aliases: e.aliases,
      programs: e.programs,
      addresses: e.addresses,
      remarks: e.remarks,
      ofacUid: e.ofacUid,
      listPublishedAt: e.listPublishedAt,
    }));
    await db
      .insert(sanctionsListEntries)
      .values(slice)
      .onConflictDoUpdate({
        target: [sanctionsListEntries.sourceList, sanctionsListEntries.ofacUid],
        set: {
          entityType: sql`excluded.entity_type`,
          primaryName: sql`excluded.primary_name`,
          normalizedName: sql`excluded.normalized_name`,
          aliases: sql`excluded.aliases`,
          programs: sql`excluded.programs`,
          addresses: sql`excluded.addresses`,
          remarks: sql`excluded.remarks`,
          listPublishedAt: sql`excluded.list_published_at`,
          fetchedAt: now,
        },
      });
    written += slice.length;
  }
  return written;
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export interface SyncListResult {
  sourceList: SourceList;
  fetched: number;
  upserted: number;
  /** Set when the list was SKIPPED (fetch/parse failure) — cache left intact. */
  error?: string;
}

export interface SanctionsSyncSummary {
  results: SyncListResult[];
  totalUpserted: number;
  durationMs: number;
}

/** Refresh a single list. On failure, logs + returns an error result (cache intact). */
async function refreshOneList(
  sourceList: SourceList,
  primaryUrl: string,
  altUrl: string,
  addUrl: string,
): Promise<SyncListResult> {
  try {
    // Companions are best-effort and non-fatal; primary is required.
    const [primaryText, altByUid, addrByUid] = await Promise.all([
      fetchText(primaryUrl),
      fetchAltMap(altUrl),
      fetchAddrMap(addUrl),
    ]);
    const entries = parsePrimaryCsv(primaryText, sourceList, { altByUid, addrByUid });
    if (entries.length === 0) {
      // An empty parse from a non-empty body is suspicious — DO NOT treat it as
      // a successful refresh that could (via a future purge) wipe good rows.
      const error = "parsed 0 entries from a reachable list — leaving cache intact";
      logger.warn("[sanctionsListSync] refresh skipped — empty parse", {
        metadata: { sourceList, primaryUrl },
      });
      return { sourceList, fetched: 0, upserted: 0, error };
    }
    const upserted = await upsertEntries(entries);
    logger.info("[sanctionsListSync] list refreshed", {
      metadata: { sourceList, fetched: entries.length, upserted },
    });
    return { sourceList, fetched: entries.length, upserted };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Resilience contract: never wipe good data on a failed refresh.
    logger.error(
      "[sanctionsListSync] list refresh failed — existing cache left intact",
      err instanceof Error ? err : undefined,
      { metadata: { sourceList, primaryUrl } },
    );
    return { sourceList, fetched: 0, upserted: 0, error };
  }
}

/**
 * Refresh BOTH the SDN and Consolidated lists into sanctions_list_entries.
 *
 * Each list is independent: a failure in one logs + skips that list and leaves
 * its cached rows intact while the other still refreshes. Never throws.
 */
export async function syncSanctionsLists(): Promise<SanctionsSyncSummary> {
  const start = Date.now();
  const results = await Promise.all([
    refreshOneList("SDN", SDN_URL, SDN_ALT_URL, SDN_ADD_URL),
    refreshOneList("CONSOLIDATED", CONSOLIDATED_URL, CONSOLIDATED_ALT_URL, CONSOLIDATED_ADD_URL),
  ]);
  const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
  const durationMs = Date.now() - start;
  logger.info("[sanctionsListSync] sync complete", {
    metadata: {
      totalUpserted,
      durationMs,
      perList: results.map((r) => ({ list: r.sourceList, upserted: r.upserted, error: r.error ?? null })),
    },
  });
  return { results, totalUpserted, durationMs };
}

// ─── One-shot CLI entry ──────────────────────────────────────────────────────
// Run manually:  tsx server/services/compliance/sanctionsListSync.ts
// (or: npx tsx server/services/compliance/sanctionsListSync.ts)
// Hits the LIVE Treasury endpoints and UPSERTs into sanctions_list_entries.
const isMainModule = (() => {
  try {
    // import.meta.url is the file URL; process.argv[1] is the invoked script.
    return Boolean(
      typeof process !== "undefined" &&
        process.argv[1] &&
        import.meta.url === new URL(`file://${process.argv[1]}`).href,
    );
  } catch {
    return false;
  }
})();

if (isMainModule) {
  syncSanctionsLists()
    .then((summary) => {
      logger.info("[sanctionsListSync] CLI run finished", {
        metadata: { totalUpserted: summary.totalUpserted, durationMs: summary.durationMs },
      });
      process.exit(summary.results.every((r) => !r.error) ? 0 : 1);
    })
    .catch((err) => {
      logger.error(
        "[sanctionsListSync] CLI run failed",
        err instanceof Error ? err : undefined,
      );
      process.exit(1);
    });
}
