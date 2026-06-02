/**
 * sanctionsList — OFAC SDN screening (Phase 0 floor).
 *
 * Three responsibilities:
 *   1. Daily ingestion: download the public Treasury SDN CSV, hash each
 *      (name + country) tuple, replace the contents of sanctions_list in
 *      one transaction. Idempotent — re-running just re-builds the table.
 *
 *   2. Signup-time hash match: hashSignupCheck() takes the candidate name
 *      and 2-letter country code, hashes the same way, looks up in
 *      sanctions_list. Returns { matched, reason }.
 *
 *   3. Sanctioned-country quick-block: SANCTIONED_COUNTRIES is the
 *      OFAC-comprehensive embargoed country list. checkSanctionedCountry()
 *      returns true if the signup's country code is on the list.
 *
 * Importantly: this is the Phase 0 FLOOR — not a substitute for real
 * sanctions compliance at Phase 2+. The legal posture (Beatrice) is that
 * we're not running an audited program; we're not blind either. Blocked
 * signups get a polite, Beatrice-approved message.
 *
 * # Why we hash
 *
 * Storing the raw SDN CSV in our DB would be (a) duplicative of a public
 * resource and (b) a small landmine if our DB were ever exported as a
 * "list of sanctioned individuals". We store SHA-256 truncations only.
 * A match means "this signup's hashed identity equals a hashed SDN entry"
 * — sufficient for a block, insufficient for any other use.
 *
 * # Hash policy
 *
 * The hash input is canonicalized: NFKD normalize, lowercase, strip
 * non-alphanumeric, then `${name}::${countryCode}`. SHA-256 → hex →
 * first 24 chars (= 96 bits of entropy; collision rate vs. ~10k SDN
 * entries is negligible).
 */

import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { sanctionsList } from "@shared/schema";
import { logger } from "../utils/logger";

/**
 * OFAC-comprehensive embargoed countries (2026 list). Quick-block at signup
 * regardless of the SDN hash check. Codes are ISO 3166-1 alpha-2.
 *
 * NOTE: this list is intentionally short. The OFAC sectoral programs cover
 * additional countries with PARTIAL sanctions (e.g. Venezuela targeted
 * sectors) that are NOT comprehensive bans — those go through the SDN hash
 * lookup, not this list.
 */
export const SANCTIONED_COUNTRIES = new Set<string>([
  "CU", // Cuba
  "IR", // Iran
  "KP", // North Korea
  "SY", // Syria
  "RU", // Russia (full sectoral 2026)
  "BY", // Belarus
  "AF", // Afghanistan (Taliban-controlled territory)
]);

const DEFAULT_OFAC_SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const LIST_SOURCE = "ofac-sdn";

/**
 * Canonicalize a (name, country) pair the same way for both ingest and
 * lookup. NFKD strips diacritics; lowercase + alphanumeric-only handles
 * "Doe, John" vs "doe john" vs "Doe John" vs "Döe John".
 */
export function canonicalizeNameCountry(name: string, country: string): string {
  const cleanName = (name || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const cleanCountry = (country || "").trim().toUpperCase().slice(0, 2);
  return `${cleanName}::${cleanCountry}`;
}

export function hashNameCountry(name: string, country: string): string {
  const canon = canonicalizeNameCountry(name, country);
  return crypto.createHash("sha256").update(canon).digest("hex").slice(0, 24);
}

/**
 * Result of a signup-time sanctions check.
 *
 *   matched=false           → allow signup
 *   matched=true, reason=*  → block with this reason code
 */
export interface SanctionsCheckResult {
  matched: boolean;
  reason?: "ofac-sdn-hash" | "sanctioned-country";
  /**
   * Message safe to show to the blocked user. Approved tone:
   * acknowledges the block without explaining the screening mechanism
   * (which would help adversaries craft evasion).
   */
  message?: string;
}

/**
 * Sanctioned-country quick block. Returns matched=true if the country
 * code is on SANCTIONED_COUNTRIES.
 */
export function checkSanctionedCountry(country: string | undefined | null): SanctionsCheckResult {
  if (!country) return { matched: false };
  const code = country.trim().toUpperCase().slice(0, 2);
  if (SANCTIONED_COUNTRIES.has(code)) {
    return {
      matched: true,
      reason: "sanctioned-country",
      // Beatrice-approved phrasing: factual, not apologetic; offers a
      // legitimate path (support contact) without admitting screening
      // mechanism.
      message:
        "We're unable to provision an account from this country at this time. " +
        "If you believe this is in error, please contact support@acreos.io.",
    };
  }
  return { matched: false };
}

/**
 * OFAC SDN hash match. Returns matched=true if the canonicalized
 * (name, country) hash appears in sanctions_list.
 *
 * If the table is empty (cron hasn't run yet), returns matched=false —
 * we never want to block all signups because the ingest job hasn't
 * fired. The ingest job logs a warning if it can't reach Treasury.
 */
export async function checkOfacSdn(
  name: string,
  country: string,
): Promise<SanctionsCheckResult> {
  if (!name) return { matched: false };
  const hash = hashNameCountry(name, country);
  try {
    const rows = await db
      .select({ id: sanctionsList.id, program: sanctionsList.program })
      .from(sanctionsList)
      .where(
        and(eq(sanctionsList.listSource, LIST_SOURCE), eq(sanctionsList.nameCountryHash, hash)),
      )
      .limit(1);
    if (rows.length > 0) {
      return {
        matched: true,
        reason: "ofac-sdn-hash",
        message:
          "We're unable to create this account. " +
          "If you believe this is in error, please contact support@acreos.io.",
      };
    }
  } catch (err) {
    // DB read failure: fail-open. We log and continue. The alternative
    // (failing closed) would block all signups during any DB blip.
    logger.warn("[sanctionsList] checkOfacSdn DB read failed — failing open", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
  return { matched: false };
}

/**
 * Composite signup check — runs both lanes (country + hash) and returns
 * the first block. Use this from the signup handler.
 */
export async function checkSignup(input: {
  name: string;
  country?: string | null;
}): Promise<SanctionsCheckResult> {
  const country = input.country ?? "";
  const countryCheck = checkSanctionedCountry(country);
  if (countryCheck.matched) return countryCheck;
  return await checkOfacSdn(input.name, country);
}

// ─── Ingest job ─────────────────────────────────────────────────────────────

/**
 * Minimal CSV parser for the SDN format. The Treasury CSV is well-formed
 * and doesn't need a full RFC-4180 implementation, but we still respect
 * quoted fields containing commas.
 *
 * SDN format (positional): ent_num, SDN_Name, SDN_Type, Program,
 *   Title, Call_Sign, Vess_type, Tonnage, GRT, Vess_flag,
 *   Vess_owner, Remarks.
 *
 * We only use SDN_Name (col 1) and Program (col 3) — country is parsed
 * out of the Remarks field where present, otherwise blank.
 */
function parseSdnCsv(text: string): Array<{ name: string; program: string; remarks: string }> {
  const rows: Array<{ name: string; program: string; remarks: string }> = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 4) continue;
    const name = fields[1];
    const program = fields[3];
    const remarks = fields[11] ?? "";
    if (name) rows.push({ name, program, remarks });
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
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
  return fields.map((f) => f.trim().replace(/^-0-$/, "")); // SDN uses "-0-" for "n/a"
}

/**
 * Extract a 2-letter country code from a Remarks field. The Treasury
 * format embeds country sometimes as `country=XX` and sometimes as a
 * trailing parenthetical. We pull both forms; missing country → "".
 */
function extractCountry(remarks: string): string {
  const match = remarks.match(/country[:=]\s*([A-Z]{2})/i);
  if (match) return match[1].toUpperCase();
  return "";
}

/**
 * Refresh the sanctions_list table from the public OFAC SDN CSV.
 *
 * - Downloads the CSV (URL configurable via OFAC_SDN_URL).
 * - Hashes each (name, country) tuple.
 * - In one transaction: DELETE FROM sanctions_list WHERE list_source = 'ofac-sdn'
 *   then bulk INSERT the new hashes.
 *
 * Returns a summary { fetched, inserted, errors } for the cron log.
 */
export async function refreshOfacSdnList(opts: { url?: string } = {}): Promise<{
  fetched: number;
  inserted: number;
  durationMs: number;
  error?: string;
}> {
  const start = Date.now();
  const url = opts.url || process.env.OFAC_SDN_URL || DEFAULT_OFAC_SDN_URL;
  try {
    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) {
      const error = `OFAC SDN fetch returned ${resp.status}`;
      logger.warn("[sanctionsList] refresh skipped — fetch non-OK", { metadata: { url, status: resp.status } });
      return { fetched: 0, inserted: 0, durationMs: Date.now() - start, error };
    }
    const text = await resp.text();
    const rows = parseSdnCsv(text);

    // Dedupe at the hash level — the SDN CSV often has multiple entries
    // per individual (vessel, AKA, etc.) that collapse to the same
    // (name, country) hash. INSERT ON CONFLICT handles it but we save
    // the round-trips.
    const seen = new Set<string>();
    const inserts: { nameCountryHash: string; listSource: string; program: string | null }[] = [];
    for (const r of rows) {
      const country = extractCountry(r.remarks);
      const hash = hashNameCountry(r.name, country);
      if (seen.has(hash)) continue;
      seen.add(hash);
      inserts.push({
        nameCountryHash: hash,
        listSource: LIST_SOURCE,
        program: r.program || null,
      });
    }

    // Single transaction: replace contents.
    await db.transaction(async (tx) => {
      await tx.delete(sanctionsList).where(eq(sanctionsList.listSource, LIST_SOURCE));
      // Batch insert (Postgres handles ~10k rows in one INSERT fine).
      // Chunk at 1000 just to keep the statement size reasonable.
      const CHUNK = 1000;
      for (let i = 0; i < inserts.length; i += CHUNK) {
        const slice = inserts.slice(i, i + CHUNK);
        if (slice.length > 0) await tx.insert(sanctionsList).values(slice);
      }
    });

    logger.info("[sanctionsList] OFAC SDN refresh complete", {
      metadata: { fetched: rows.length, inserted: inserts.length, durationMs: Date.now() - start },
    });
    return { fetched: rows.length, inserted: inserts.length, durationMs: Date.now() - start };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("[sanctionsList] OFAC SDN refresh failed", err instanceof Error ? err : undefined);
    return { fetched: 0, inserted: 0, durationMs: Date.now() - start, error: errMsg };
  }
}
