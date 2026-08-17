/**
 * T27 — Tax Delinquent List Importer Pipeline
 *
 * Handles the full pipeline for processing county tax delinquent lists:
 *   1. Parse uploaded CSV/TSV file (or structured JSON from scraper)
 *   2. Normalize column names from common county formats
 *   3. Deduplicate against existing leads (by APN and owner name)
 *   4. Score each new lead using the lead scoring service
 *   5. Bulk import into leads table
 *   6. Return import summary with stats
 *
 * Exposed via: POST /api/import/tax-delinquent
 *
 * Supports county CSV exports with varying column names:
 *   - APN: "APN", "Parcel Number", "Parcel ID", "Tax ID"
 *   - Owner: "Owner Name", "Owner", "Taxpayer", "Property Owner"
 *   - Amount: "Delinquent Amount", "Amount Due", "Taxes Owed"
 *   - Address: "Situs Address", "Property Address", "Site Address"
 */

import { db } from "../db";
import { leads } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { normalizeParcelRef, parcelKey } from "@shared/parcel/parcelRef";

// ─── Tax-delinquent payload convention ──────────────────────────────────────
// The leads table has no apn/county/taxDelinquent/delinquentAmount/metadata/
// propertyAddress columns. Tax-delinquent imports flag the lead with the
// TAX_DELINQUENT_TAG in `tags` and stash the extra structured fields as JSON in
// the `notes` column.
//
// KNOWN DEBT (groundwork, no schema change this wave): JSON-in-notes makes
// these fields unqueryable — dedup, state/county filtering, and equity math
// all require decoding every row in application code, and `notes` can no
// longer hold free-form user notes for these leads. Intended fix: promote
// apn / county / delinquentAmountCents / delinquentYears / daysUntilTaxSale /
// propertyValueCents (+ provenance) / acres to real columns — either on
// `leads` or a dedicated `tax_delinquent_leads` child table keyed by lead id —
// with a backfill that decodes existing payloads and then frees `notes`.
// TODO(tsc): column promotion tracked for the schema wave.
const TAX_DELINQUENT_TAG = "tax_delinquent";

interface TaxDelinquentPayload {
  apn?: string;
  county?: string;
  propertyAddress?: string;
  delinquentAmount?: string;
  delinquentYears?: number;
  daysUntilTaxSale?: number;
  propertyValueCents?: number;
  acres?: number;
  importedAt?: string;
}

function encodePayload(p: TaxDelinquentPayload): string {
  return JSON.stringify(p);
}

function decodePayload(notes: string | null | undefined): TaxDelinquentPayload {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? (parsed as TaxDelinquentPayload) : {};
  } catch {
    return {};
  }
}

export interface RawDelinquentRecord {
  [key: string]: string;
}

export interface NormalizedDelinquentRecord {
  apn: string;
  ownerName: string;
  propertyAddress?: string;
  city?: string;
  state?: string;
  county?: string;
  zipCode?: string;
  delinquentAmount?: number;
  delinquentYears?: number;
  acres?: number;
  rawRow: RawDelinquentRecord;
}

export interface ImportResult {
  totalRows: number;
  normalized: number;
  duplicates: number;
  imported: number;
  skipped: number;
  errors: number;
  importedLeadIds: number[];
  errorDetails: { row: number; reason: string }[];
}

// ─── Column name normalization ────────────────────────────────────────────────

const APN_ALIASES = ["apn", "parcel number", "parcel id", "parcel_id", "tax id", "tax_id", "account number", "folio"];
const OWNER_ALIASES = ["owner name", "owner", "taxpayer", "property owner", "owner_name", "taxpayer name"];
const ADDRESS_ALIASES = ["situs address", "property address", "site address", "address", "location", "parcel address"];
const CITY_ALIASES = ["city", "situs city", "property city"];
const STATE_ALIASES = ["state", "st", "situs state"];
const ZIP_ALIASES = ["zip", "zip code", "zipcode", "postal code"];
const AMOUNT_ALIASES = ["delinquent amount", "amount due", "taxes owed", "tax amount", "amount", "balance due"];
const ACRES_ALIASES = ["acres", "acreage", "lot size acres", "land area", "total acres"];
const YEAR_ALIASES = ["delinquent years", "years delinquent", "years", "delinquent since"];

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = normalizedHeaders.findIndex(h => h === alias || h.includes(alias));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

function parseAmount(val: string): number | undefined {
  if (!val) return undefined;
  const cleaned = val.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? undefined : n;
}

function parseAcres(val: string): number | undefined {
  if (!val) return undefined;
  const n = parseFloat(val.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? undefined : n;
}

// ─── CSV Parser (no external dep) ────────────────────────────────────────────

function parseCsv(content: string): RawDelinquentRecord[] {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let inQuotes = false;
    let current = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const records: RawDelinquentRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    if (values.length < 2) continue;
    const record: RawDelinquentRecord = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] ?? "";
    });
    records.push(record);
  }

  return records;
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function normalizeRecords(raw: RawDelinquentRecord[]): NormalizedDelinquentRecord[] {
  if (raw.length === 0) return [];

  const headers = Object.keys(raw[0]);
  const apnCol = findColumn(headers, APN_ALIASES);
  const ownerCol = findColumn(headers, OWNER_ALIASES);
  const addrCol = findColumn(headers, ADDRESS_ALIASES);
  const cityCol = findColumn(headers, CITY_ALIASES);
  const stateCol = findColumn(headers, STATE_ALIASES);
  const zipCol = findColumn(headers, ZIP_ALIASES);
  const amountCol = findColumn(headers, AMOUNT_ALIASES);
  const acresCol = findColumn(headers, ACRES_ALIASES);
  const yearsCol = findColumn(headers, YEAR_ALIASES);

  return raw
    .map((row): NormalizedDelinquentRecord | null => {
      const apn = apnCol ? row[apnCol]?.trim() : "";
      const ownerName = ownerCol ? row[ownerCol]?.trim() : "";
      if (!apn || !ownerName) return null;

      return {
        apn,
        ownerName,
        propertyAddress: addrCol ? row[addrCol]?.trim() : undefined,
        city: cityCol ? row[cityCol]?.trim() : undefined,
        state: stateCol ? row[stateCol]?.trim() : undefined,
        zipCode: zipCol ? row[zipCol]?.trim() : undefined,
        delinquentAmount: amountCol ? parseAmount(row[amountCol]) : undefined,
        delinquentYears: yearsCol ? parseInt(row[yearsCol]) || undefined : undefined,
        acres: acresCol ? parseAcres(row[acresCol]) : undefined,
        rawRow: row,
      };
    })
    .filter((r): r is NormalizedDelinquentRecord => r !== null);
}

// ─── Parcel identity ─────────────────────────────────────────────────────────

/**
 * Dedup key for "have we already imported this parcel?".
 *
 * That is an IDENTITY question, so this uses `parcelKey` — the strict rule from
 * shared/parcel/parcelRef.ts, the one owner of "the same parcel" — and NOT
 * `parcelMatchKey`. Treating a row as a duplicate DROPS it: the loose key
 * collapses "12-345-678" into "12345678", and in a county where the separator
 * is significant that silently discards a different parcel's lead, with nothing
 * downstream able to notice. A candidate key must never decide an identity.
 *
 * This replaces an inline rule (state lower · county lower · apn lower, joined
 * by "|") — one of four competing parcel normalisations that were live in this
 * repo, none of which agreed with the others.
 *
 * WHAT THE SWITCH CHANGES. The key is never persisted; it is rebuilt here for
 * BOTH sides of every comparison — the existing rows are re-keyed from the DB
 * in the same pass that keys the incoming CSV rows. So a normalisation change
 * cannot MISS a stored key the way a persisted key would; it can only
 * re-partition rows that are all being re-keyed together, and that
 * re-partition is one-directional:
 *   - MERGE, never split. The old rule and parcelRef are both case-insensitive
 *     on all three parts, so case moves nothing. parcelRef additionally
 *     collapses internal whitespace runs, so "12  345" and "12 345" become ONE
 *     parcel where they used to be two. That direction removes duplicate
 *     imports; it cannot create them.
 *   - Refusals keep yesterday's rule verbatim (see below), so nothing that
 *     deduped before stops deduping now.
 * Both sides being normalised here is also why the comparison stays correct
 * without knowing what case the tuple happens to be stored in — we compare
 * case-insensitively rather than assuming a stored case.
 */
export function parcelDedupKey(
  state: string | null | undefined,
  county: string | null | undefined,
  apn: string | null | undefined,
): string {
  const ref = normalizeParcelRef({ state, county, apn });
  if (ref.ok) return parcelKey(ref.ref);

  // parcelRef REFUSES a half-formed natural key (absent or non-two-letter
  // state, absent county, digitless APN) rather than guessing — and imported
  // county lists genuinely arrive without a county or a state. A refusal must
  // not silently mean "not a duplicate": that would re-import the same rows on
  // every retry. So refused rows fall back to the pre-parcelRef rule, byte for
  // byte, under a prefix that can never collide with a parcelKey (a parcelKey
  // always begins with a two-letter upper-case state code and a space).
  // This fallback is explicitly NOT a parcel identity — it only has to be
  // exactly as good as the key it replaces.
  return `unnormalized|${(state ?? "").toLowerCase().trim()}|${(county ?? "").toLowerCase().trim()}|${(apn ?? "").toLowerCase().trim()}`;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function processTaxDelinquentImport(
  orgId: number,
  userId: number,
  csvContent: string,
  options: {
    state?: string;
    county?: string;
    defaultSource?: string;
    campaignId?: number;
  } = {}
): Promise<ImportResult> {
  const raw = parseCsv(csvContent);
  const normalized = normalizeRecords(raw);

  const result: ImportResult = {
    totalRows: raw.length,
    normalized: normalized.length,
    duplicates: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    importedLeadIds: [],
    errorDetails: [],
  };

  if (normalized.length === 0) return result;

  // Fetch existing (state, county, apn) tuples for this org to detect
  // duplicates. Marcus: "APNs are *not* unique across counties. Two
  // different counties in different states can both have an APN like
  // 001-0001-001. The dedup check uses existingApnSet keyed by APN
  // alone — that'll silently merge or skip leads from different
  // counties." Fix: composite key.
  // leads has no apn/county columns; apn/county live in the notes JSON payload
  // on tax-delinquent leads. Pull existing flagged leads and decode the tuple.
  const existingTuples = await db
    .select({ state: leads.state, notes: leads.notes })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, orgId),
        sql`${leads.tags} @> ${JSON.stringify([TAX_DELINQUENT_TAG])}::jsonb`,
      )
    );

  const existingTupleSet = new Set(
    existingTuples
      .map((r) => ({ state: r.state, payload: decodePayload(r.notes) }))
      .filter((r) => Boolean(r.payload.apn))
      .map((r) => parcelDedupKey(r.state, r.payload.county, r.payload.apn!))
  );

  const toInsert: typeof leads.$inferInsert[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const rec = normalized[i];

    // Dedup check on the composite (state, county, apn) tuple — IDENTITY, so
    // parcelDedupKey (strict `parcelKey`), never the loose match key.
    const recState = rec.state || options.state;
    const recCounty = rec.county || options.county;
    const recKey = parcelDedupKey(recState, recCounty, rec.apn);
    if (existingTupleSet.has(recKey)) {
      result.duplicates++;
      continue;
    }

    // Mark as imported to avoid double-importing on retry
    existingTupleSet.add(recKey);

    // Parse owner name into first/last
    const nameParts = rec.ownerName.split(/\s+/);
    const lastName = nameParts[nameParts.length - 1] || rec.ownerName;
    const firstName = nameParts.slice(0, -1).join(" ") || "";

    // leads has no createdBy/apn/propertyAddress/county/zipCode/taxDelinquent/
    // delinquentAmount/metadata columns. Map to the real columns (address, zip)
    // and stash the rest in the notes JSON payload, flagged via tags.
    toInsert.push({
      organizationId: orgId,
      firstName,
      lastName,
      address: rec.propertyAddress,
      city: rec.city,
      state: rec.state || options.state,
      zip: rec.zipCode,
      source: options.defaultSource || "tax_delinquent",
      status: "new",
      // Multi-factor import-time score. Marcus: "Real scoring needs
      // years delinquent, equity %, tax-to-value ratio, owner age,
      // absentee status, prior cure history, parcel size and zoning."
      // We don't have all those at import; this captures what we do have
      // (years + acres + completeness). The full scorer picks up later.
      score: scoreImportRecord(rec),
      tags: [TAX_DELINQUENT_TAG],
      campaignId: options.campaignId,
      notes: encodePayload({
        apn: rec.apn,
        county: rec.county || options.county,
        propertyAddress: rec.propertyAddress,
        delinquentAmount: rec.delinquentAmount?.toString(),
        delinquentYears: rec.delinquentYears,
        acres: rec.acres,
        importedAt: new Date().toISOString(),
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Batch insert in chunks of 100
  const CHUNK_SIZE = 100;
  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    try {
      const inserted = await db.insert(leads).values(chunk).returning({ id: leads.id });
      result.importedLeadIds.push(...inserted.map(r => r.id));
      result.imported += inserted.length;
    } catch (err: any) {
      result.errors += chunk.length;
      result.errorDetails.push({ row: i, reason: err.message });
    }
  }

  return result;
}

// ─── Real implementations replacing the foundation-PR stubs ─────────────────
//
// Marcus's persona walkthrough: "the service is a stub. taxDelinquentPipeline.
// getLeads literally returns []. So the empty state is what I see no matter
// what I do, until I import a CSV." Below are the wired-in implementations
// that read from the leads table where tax-delinquent leads actually live
// (created by processTaxDelinquentImport above with taxDelinquent=true).

interface GetLeadsOpts {
  organizationId: number;
  stateCode?: string;
  risk?: string;
  limit?: number;
  page?: number;
}

/**
 * Provenance of `propertyValueCents` / `equityPercent`:
 *   - "assessed": a real assessed value arrived with the county data.
 *   - "none":     no value on file. We REFUSE to invent one (the old code
 *                 fabricated taxOwed × 8 and presented it as real — a direct
 *                 fabrication-doctrine violation). Value and equity are null
 *                 and the UI renders an explicit "no assessed value on file"
 *                 state instead of a number.
 */
export type ValueProvenance = "assessed" | "none";

export interface DelinquentLeadRow {
  id: number;
  ownerName: string;
  propertyAddress: string;
  county: string;
  stateCode: string;
  /** null when the county list didn't include years delinquent — never defaulted to 0. */
  yearsDelinquent: number | null;
  /** null when no delinquent amount is on file — never defaulted to $0. */
  taxOwedCents: number | null;
  /** Real assessed value only; null when valueProvenance === "none". */
  propertyValueCents: number | null;
  /** Derived from real values only; null when value or tax owed is unknown. */
  equityPercent: number | null;
  valueProvenance: ValueProvenance;
  daysUntilTaxSale?: number;
  risk: "critical" | "high" | "medium" | "low";
  score: number;
}

/**
 * Multi-factor import-time scoring. Caps at 90; live scoring nudges
 * higher when behavioral signals (mailers responded, calls answered)
 * accrue.
 */
function scoreImportRecord(rec: NormalizedDelinquentRecord): number {
  let s = 30; // base
  if (rec.delinquentYears != null) {
    if (rec.delinquentYears >= 3) s += 40;
    else if (rec.delinquentYears === 2) s += 30;
    else if (rec.delinquentYears === 1) s += 20;
    else s += 10;
  }
  // Larger parcels skew motivated (more carrying cost for chronic delinquents).
  if (rec.acres != null && rec.acres > 1) s += 10;
  if (rec.acres != null && rec.acres > 5) s += 5;
  // Address completeness signals data quality (likelier deliverable mail).
  if (rec.propertyAddress) s += 5;
  if (rec.zipCode) s += 5;
  return Math.min(90, s);
}

/**
 * Derive risk bucket from years delinquent + equity. Marcus: "the 11-day-out
 * owner is twenty times more motivated than the 180-day-out owner" — so when
 * we know daysUntilTaxSale, that dominates.
 *
 * Unknown inputs (null) never escalate risk: a lead with no equity data does
 * not get the equity-based "high" bump, and a lead with no years-delinquent
 * data doesn't get the years-based tiers. Escalation only from real signals.
 */
export function deriveRisk(input: {
  yearsDelinquent: number | null;
  daysUntilTaxSale?: number;
  equityPercent: number | null;
}): "critical" | "high" | "medium" | "low" {
  const { yearsDelinquent, daysUntilTaxSale, equityPercent } = input;
  if (daysUntilTaxSale !== undefined && daysUntilTaxSale <= 30) return "critical";
  if (yearsDelinquent !== null && yearsDelinquent >= 3) return "critical";
  if (daysUntilTaxSale !== undefined && daysUntilTaxSale <= 90) return "high";
  if (yearsDelinquent === 2 && equityPercent !== null && equityPercent >= 40) return "high";
  if (yearsDelinquent !== null && yearsDelinquent >= 1) return "medium";
  return "low";
}

/** The lead-table fields the row mapper reads. Kept narrow so the mapper is a pure, unit-testable function. */
export interface LeadRowInput {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  score: number | null;
  notes: string | null;
}

/**
 * Pure mapper: lead row + notes payload → API row.
 *
 * Refuse-not-fabricate: every field either comes from real imported data or
 * is null. The pre-fix version invented propertyValueCents = taxOwed × 8 when
 * no value was on file and served the derived equity% as if real; that
 * fabrication is removed. If a labeled heuristic is ever reintroduced it must
 * carry its own ValueProvenance tag and must never feed sorting/filtering/risk
 * as if it were an assessed value.
 */
export function mapLeadToDelinquentRow(l: LeadRowInput): DelinquentLeadRow {
  const meta = decodePayload(l.notes);
  const ownerName =
    [l.firstName, l.lastName].filter(Boolean).join(" ").trim() || (l.email ?? "Unknown owner");

  // Tax owed: null when no delinquent amount is on file (never a fake $0).
  const taxOwedDollars =
    meta.delinquentAmount != null ? parseFloat(meta.delinquentAmount) : NaN;
  const taxOwedCents = Number.isFinite(taxOwedDollars)
    ? Math.round(taxOwedDollars * 100)
    : null;

  // Property value: assessed-only. No value on file → null + provenance "none".
  const assessedValueCents =
    typeof meta.propertyValueCents === "number" &&
    Number.isFinite(meta.propertyValueCents) &&
    meta.propertyValueCents > 0
      ? Math.round(meta.propertyValueCents)
      : null;
  const valueProvenance: ValueProvenance = assessedValueCents !== null ? "assessed" : "none";

  // Equity: derivable only when both real inputs exist.
  const equityPercent =
    assessedValueCents !== null && taxOwedCents !== null
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(((assessedValueCents - taxOwedCents) / assessedValueCents) * 100),
          ),
        )
      : null;

  const yearsDelinquent = meta.delinquentYears ?? null;
  const daysUntilTaxSale = meta.daysUntilTaxSale;
  const riskBucket = deriveRisk({ yearsDelinquent, daysUntilTaxSale, equityPercent });

  return {
    id: l.id,
    ownerName,
    propertyAddress: [meta.propertyAddress ?? l.address, l.city, l.state]
      .filter(Boolean)
      .join(", "),
    county: meta.county ?? "",
    stateCode: l.state ?? "",
    yearsDelinquent,
    taxOwedCents,
    propertyValueCents: assessedValueCents,
    equityPercent,
    valueProvenance,
    daysUntilTaxSale,
    risk: riskBucket,
    score: l.score ?? 0,
  };
}

async function getLeads(opts: GetLeadsOpts): Promise<{ leads: DelinquentLeadRow[]; total: number }> {
  const { organizationId, stateCode, risk, limit = 50, page = 1 } = opts;
  const offset = Math.max(0, (page - 1) * limit);

  // Pull the candidate set: tax-delinquent flagged, optionally filtered by
  // state. Risk is a derived-server-side bucket so we filter post-derive.
  const conditions = [
    eq(leads.organizationId, organizationId),
    sql`${leads.tags} @> ${JSON.stringify([TAX_DELINQUENT_TAG])}::jsonb`,
  ];
  if (stateCode) {
    conditions.push(eq(leads.state, stateCode.toUpperCase()));
  }

  const rows = await db
    .select()
    .from(leads)
    .where(and(...conditions))
    .orderBy(sql`${leads.score} DESC NULLS LAST`)
    .limit(limit * 4) // pull extra so post-derive risk filter still has volume
    .offset(offset);

  const mapped: DelinquentLeadRow[] = rows.map((l) => mapLeadToDelinquentRow(l));

  const filtered = risk && risk !== "all"
    ? mapped.filter((m) => m.risk === risk)
    : mapped;
  const trimmed = filtered.slice(0, limit);
  return { leads: trimmed, total: filtered.length };
}

async function getLead(id: number, orgId: number): Promise<DelinquentLeadRow | null> {
  const [row] = await db
    .select()
    .from(leads)
    .where(and(
      eq(leads.id, id),
      eq(leads.organizationId, orgId),
      sql`${leads.tags} @> ${JSON.stringify([TAX_DELINQUENT_TAG])}::jsonb`,
    ))
    .limit(1);
  if (!row) return null;
  const result = await getLeads({ organizationId: orgId, limit: 200 });
  return result.leads.find((l) => l.id === id) ?? null;
}

interface AddToOutreachResult {
  success: boolean;
  leadId: number;
  status: string;
  consentState: "mail_only" | "inbound_engaged" | "express_consent";
}

async function addToOutreach(id: number, orgId: number): Promise<AddToOutreachResult> {
  const [row] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.organizationId, orgId), sql`${leads.tags} @> ${JSON.stringify([TAX_DELINQUENT_TAG])}::jsonb`))
    .limit(1);
  if (!row) throw new Error("Lead not found");

  // Marcus: "Add a consent-state column on /tax-delinquent: Mail-only /
  // Inbound-engaged / Express-consent." Derive from existing tcpaConsent
  // and lead activity. Without explicit consent the legal-safe default is
  // mail-only (no TCPA risk; FDCPA mini-Miranda still applies on letter
  // copy but that's a template concern).
  const consentState: AddToOutreachResult["consentState"] =
    (row as any).tcpaConsent ? "express_consent" : "mail_only";

  // Move the lead into 'contacted' status. The actual mailer / SMS / call
  // queueing is a separate service that runs from the lead's status; we
  // don't bypass TCPA here. Marcus's compliance-test concern: the mail-
  // first cadence is the TCPA-safe default.
  await db
    .update(leads)
    .set({ status: "contacted", updatedAt: new Date() })
    .where(eq(leads.id, id));

  return { success: true, leadId: id, status: "contacted", consentState };
}

// Namespace export for route consumption
export const taxDelinquentPipeline = {
  processTaxDelinquentImport,
  getLeads,
  getLead,
  addToOutreach,
  // importFromCounty: scraper-driven pipeline. Wired in TD-6 (PDF OCR
  // + per-county scraper roster). For now, leave as a no-op rather than
  // pretending we have the data — same honesty as the rest of TD-1.
  async importFromCounty(_opts: { organizationId: number; stateCode?: string; county?: string; limit?: number }) {
    return {
      imported: 0,
      errors: 0,
      message: "Per-county scraper not yet implemented. Use the CSV importer at /api/import/tax-delinquent for now.",
    };
  },
};
