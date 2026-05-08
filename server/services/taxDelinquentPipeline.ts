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
    .map(row => {
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
      } satisfies NormalizedDelinquentRecord;
    })
    .filter((r): r is NormalizedDelinquentRecord => r !== null);
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
  const existingTuples = await db
    .select({ state: leads.state, county: leads.county, apn: leads.apn })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, orgId),
        sql`${leads.apn} is not null`,
      )
    );

  const tupleKey = (state: string | null | undefined, county: string | null | undefined, apn: string) =>
    `${(state ?? "").toLowerCase().trim()}|${(county ?? "").toLowerCase().trim()}|${apn.toLowerCase().trim()}`;

  const existingTupleSet = new Set(
    existingTuples
      .filter((r): r is { state: string | null; county: string | null; apn: string } => Boolean(r.apn))
      .map((r) => tupleKey(r.state, r.county, r.apn!))
  );

  const toInsert: typeof leads.$inferInsert[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const rec = normalized[i];

    // Dedup check on the composite (state, county, apn) tuple.
    const recState = rec.state || options.state;
    const recCounty = rec.county || options.county;
    const recKey = tupleKey(recState, recCounty, rec.apn);
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

    toInsert.push({
      organizationId: orgId,
      createdBy: userId,
      firstName,
      lastName,
      apn: rec.apn,
      propertyAddress: rec.propertyAddress,
      city: rec.city,
      state: rec.state || options.state,
      county: rec.county || options.county,
      zipCode: rec.zipCode,
      source: options.defaultSource || "tax_delinquent",
      status: "new",
      // Multi-factor import-time score. Marcus: "Real scoring needs
      // years delinquent, equity %, tax-to-value ratio, owner age,
      // absentee status, prior cure history, parcel size and zoning."
      // We don't have all those at import; this captures what we do have
      // (years + acres + completeness). The full scorer picks up later.
      score: scoreImportRecord(rec),
      taxDelinquent: true,
      delinquentAmount: rec.delinquentAmount?.toString(),
      campaignId: options.campaignId,
      metadata: {
        delinquentYears: rec.delinquentYears,
        acres: rec.acres,
        importedAt: new Date().toISOString(),
      } as any,
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

interface DelinquentLeadRow {
  id: number;
  ownerName: string;
  propertyAddress: string;
  county: string;
  stateCode: string;
  yearsDelinquent: number;
  taxOwedCents: number;
  propertyValueCents: number;
  equityPercent: number;
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
 */
function deriveRisk(input: {
  yearsDelinquent: number;
  daysUntilTaxSale?: number;
  equityPercent: number;
}): "critical" | "high" | "medium" | "low" {
  const { yearsDelinquent, daysUntilTaxSale, equityPercent } = input;
  if (daysUntilTaxSale !== undefined && daysUntilTaxSale <= 30) return "critical";
  if (yearsDelinquent >= 3) return "critical";
  if (daysUntilTaxSale !== undefined && daysUntilTaxSale <= 90) return "high";
  if (yearsDelinquent === 2 && equityPercent >= 40) return "high";
  if (yearsDelinquent >= 1) return "medium";
  return "low";
}

async function getLeads(opts: GetLeadsOpts): Promise<{ leads: DelinquentLeadRow[]; total: number }> {
  const { organizationId, stateCode, risk, limit = 50, page = 1 } = opts;
  const offset = Math.max(0, (page - 1) * limit);

  // Pull the candidate set: tax-delinquent flagged, optionally filtered by
  // state. Risk is a derived-server-side bucket so we filter post-derive.
  const conditions = [
    eq(leads.organizationId, organizationId),
    eq(leads.taxDelinquent, true),
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

  const mapped: DelinquentLeadRow[] = rows.map((l) => {
    const meta = (l.metadata as { delinquentYears?: number; daysUntilTaxSale?: number; propertyValueCents?: number } | null) ?? {};
    const ownerName = [l.firstName, l.lastName].filter(Boolean).join(" ").trim() || (l.email ?? "Unknown owner");
    const taxOwedDollars = parseFloat(l.delinquentAmount ?? "0");
    const taxOwedCents = Math.round(taxOwedDollars * 100);
    // Property value is best-effort: prefer metadata.propertyValueCents,
    // then taxOwedCents × 8 as a placeholder (industry-typical
    // tax-to-value of ~12.5% for delinquent rural). We surface the
    // "estimated" caveat upstream — the real value lands when AVM /
    // assessed-value joins ship in TD-2.
    const propertyValueCents = meta.propertyValueCents ?? Math.round(taxOwedCents * 8);
    const equityPercent = propertyValueCents > 0
      ? Math.max(0, Math.min(100, Math.round(((propertyValueCents - taxOwedCents) / propertyValueCents) * 100)))
      : 0;
    const yearsDelinquent = meta.delinquentYears ?? 0;
    const daysUntilTaxSale = meta.daysUntilTaxSale;
    const riskBucket = deriveRisk({ yearsDelinquent, daysUntilTaxSale, equityPercent });
    return {
      id: l.id,
      ownerName,
      propertyAddress: [l.propertyAddress, l.city, l.state].filter(Boolean).join(", "),
      county: l.county ?? "",
      stateCode: l.state ?? "",
      yearsDelinquent,
      taxOwedCents,
      propertyValueCents,
      equityPercent,
      daysUntilTaxSale,
      risk: riskBucket,
      score: l.score ?? 0,
    };
  });

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
      eq(leads.taxDelinquent, true),
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
    .where(and(eq(leads.id, id), eq(leads.organizationId, orgId), eq(leads.taxDelinquent, true)))
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
