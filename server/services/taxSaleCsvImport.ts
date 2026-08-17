/**
 * Tax-sale lot-list import — column mapping + per-row validation.
 *
 * ── Why ────────────────────────────────────────────────────────────────
 * `tax_sale_auctions` and `tax_sale_listings` had ZERO insert paths. The
 * auction worksheet, the courthouse-mode bid screen and the county
 * upcoming-auction counts all queried tables nothing on earth could fill:
 * `importFromCounty` and `countyAssessorIngest.fetchTaxDelinquentList` are
 * stubs that return empty arrays. A strong workflow layer over an empty
 * data layer.
 *
 * This module is the honest feedstock: the operator's own county lot list,
 * as a CSV. No scraping, no data plane (that is a separate founder-gated
 * bet) — the county publishes a PDF/XLS, the operator saves it as CSV, and
 * AcreOS maps it.
 *
 * ── Design rules ───────────────────────────────────────────────────────
 * 1. NO SILENT DROPS. Every input row lands in exactly one of `valid` or
 *    `rejected`, and `assertNoRowLost()` proves it. The most common way an
 *    import lies is to report "412 imported" from a 500-row file.
 * 2. Mapping is EXPLICIT. We suggest a mapping from the header row, but the
 *    operator confirms it. A guess presented as a fact is the same defect
 *    as a fabricated number.
 * 3. Money is integer cents internally. (`tax_sale_listings` money columns
 *    are legacy `numeric`, so `centsToNumeric()` serializes at the DB
 *    boundary — the cents value is canonical, the string is a cast.)
 * 4. Validation refuses rather than coerces: an unparseable dollar amount
 *    is an error with the offending text quoted back, never a 0.
 *
 * Pure module — no DB, no Express. Unit-testable without DATABASE_URL.
 */

import { referenceCoveredStates } from "./taxRuleCoverage";
import { normalizeParcelRef, parcelKey } from "@shared/parcel/parcelRef";

/** Guardrails mirroring server/services/import.ts. */
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 20_000;

export const TAX_SALE_LOT_SALE_TYPES = ["lien", "deed", "redeemable_deed"] as const;
export type TaxSaleLotSaleType = (typeof TAX_SALE_LOT_SALE_TYPES)[number];

export const TAX_SALE_LOT_ACQUISITION_SOURCES = [
  "auction",
  "otc",
  "pre_sale_list",
  "private",
] as const;
export type TaxSaleLotAcquisitionSource = (typeof TAX_SALE_LOT_ACQUISITION_SOURCES)[number];

// ============================================================================
// Delimited parsing
// ============================================================================

export interface ParsedSheet {
  headers: string[];
  /** Data rows only. Ragged rows are preserved as-is; validation reports them. */
  rows: string[][];
}

function splitLine(line: string, delimiter: string): string[] {
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
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** Sniff comma vs tab vs semicolon from the header line. */
function detectDelimiter(headerLine: string): string {
  const counts: Array<[string, number]> = [
    [",", (headerLine.match(/,/g) ?? []).length],
    ["\t", (headerLine.match(/\t/g) ?? []).length],
    [";", (headerLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseDelimited(text: string): ParsedSheet {
  if (text.length > MAX_CSV_BYTES) {
    throw new Error(
      `File too large (${(text.length / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_CSV_BYTES / 1024 / 1024} MB.`,
    );
  }
  // Strip a UTF-8 BOM — county exports from Excel routinely carry one, and it
  // silently corrupts the first header name.
  const cleaned = text.replace(/^﻿/, "");
  const lines = cleaned.split(/\r?\n/).filter((l, idx) => idx === 0 || l.trim() !== "");
  if (lines.length === 0 || lines[0].trim() === "") {
    throw new Error("File is empty — expected a header row and at least one lot row.");
  }
  if (lines.length < 2) {
    throw new Error("File has a header row but no lot rows.");
  }
  if (lines.length - 1 > MAX_CSV_ROWS) {
    throw new Error(
      `File has too many rows (${lines.length - 1}). Maximum is ${MAX_CSV_ROWS.toLocaleString()}.`,
    );
  }
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter);
  const rows = lines.slice(1).map((l) => splitLine(l, delimiter));
  return { headers, rows };
}

// ============================================================================
// Field catalogue
// ============================================================================

export type LotFieldKind = "text" | "state" | "money" | "int" | "sale_type" | "source";

export interface LotFieldDef {
  key: LotFieldKey;
  label: string;
  required: boolean;
  kind: LotFieldKind;
  /** Lowercased header spellings seen in real county exports. */
  aliases: string[];
  help?: string;
}

export type LotFieldKey =
  | "apn"
  | "county"
  | "state"
  | "saleType"
  | "totalTaxOwed"
  | "minimumBid"
  | "openingBid"
  | "assessedValue"
  | "marketValue"
  | "address"
  | "city"
  | "zip"
  | "legalDescription"
  | "acreage"
  | "propertyType"
  | "ownerName"
  | "acquisitionSource"
  | "notes";

export const LOT_FIELDS: readonly LotFieldDef[] = [
  {
    key: "apn",
    label: "Parcel number (APN)",
    required: true,
    kind: "text",
    aliases: ["apn", "parcel", "parcel #", "parcel no", "parcel number", "parcel id", "pin", "tax id", "account", "account number", "property id"],
  },
  {
    key: "county",
    label: "County",
    required: true,
    kind: "text",
    aliases: ["county", "county name", "parish"],
  },
  {
    key: "state",
    label: "State",
    required: true,
    kind: "state",
    aliases: ["state", "st", "state code"],
    help: "Two-letter code. Rows with a state AcreOS has no rules for are rejected, not defaulted.",
  },
  {
    key: "saleType",
    label: "Sale type",
    required: true,
    kind: "sale_type",
    aliases: ["sale type", "saletype", "type", "sale", "lien or deed"],
    help: "lien · deed · redeemable_deed",
  },
  {
    key: "totalTaxOwed",
    label: "Total tax owed",
    required: true,
    kind: "money",
    aliases: ["total tax owed", "tax owed", "taxes owed", "total due", "amount due", "total amount due", "delinquent tax", "total taxes"],
  },
  {
    key: "minimumBid",
    label: "Minimum bid",
    required: false,
    kind: "money",
    aliases: ["minimum bid", "min bid", "minimum", "upset bid", "opening", "starting bid"],
  },
  {
    key: "openingBid",
    label: "Opening bid",
    required: false,
    kind: "money",
    aliases: ["opening bid", "open bid"],
  },
  {
    key: "assessedValue",
    label: "Assessed value",
    required: false,
    kind: "money",
    aliases: ["assessed value", "assessed", "assessment", "av", "total assessed"],
  },
  {
    key: "marketValue",
    label: "Market value",
    required: false,
    kind: "money",
    aliases: ["market value", "fmv", "appraised value", "appraisal"],
  },
  {
    key: "address",
    label: "Situs address",
    required: false,
    kind: "text",
    aliases: ["address", "situs", "situs address", "property address", "street", "location"],
  },
  { key: "city", label: "City", required: false, kind: "text", aliases: ["city", "town", "municipality"] },
  { key: "zip", label: "ZIP", required: false, kind: "text", aliases: ["zip", "zipcode", "zip code", "postal", "postal code"] },
  {
    key: "legalDescription",
    label: "Legal description",
    required: false,
    kind: "text",
    aliases: ["legal description", "legal", "description", "brief legal"],
  },
  { key: "acreage", label: "Acreage", required: false, kind: "text", aliases: ["acreage", "acres", "acre", "lot size"] },
  {
    key: "propertyType",
    label: "Property type",
    required: false,
    kind: "text",
    aliases: ["property type", "class", "property class", "use code", "land use"],
  },
  {
    key: "ownerName",
    label: "Owner of record",
    required: false,
    kind: "text",
    aliases: ["owner", "owner name", "owner of record", "taxpayer", "taxpayer name", "assessee"],
  },
  {
    key: "acquisitionSource",
    label: "Acquisition source",
    required: false,
    kind: "source",
    aliases: ["acquisition source", "source", "inventory type"],
    help: "auction · otc · pre_sale_list · private. Defaults to the auction's own source when blank.",
  },
  { key: "notes", label: "Notes", required: false, kind: "text", aliases: ["notes", "comment", "comments", "remarks"] },
];

export const REQUIRED_LOT_FIELDS: readonly LotFieldKey[] = LOT_FIELDS.filter((f) => f.required).map(
  (f) => f.key,
);

/** fieldKey → column index in the sheet, or null for "not mapped". */
export type ColumnMapping = Partial<Record<LotFieldKey, number | null>>;

export interface MappingSuggestion {
  mapping: ColumnMapping;
  /** Required fields we could not find a column for — the operator must map these. */
  unmappedRequired: LotFieldKey[];
  /** Sheet columns we did not claim, so the UI can show what is being ignored. */
  ignoredColumns: Array<{ index: number; header: string }>;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Suggest a mapping. Exact alias match first across ALL fields, then a
 * contains-match pass, so a sheet with both "minimum bid" and "bid" does not
 * hand "bid" to minimumBid before "minimum bid" gets its shot.
 */
export function suggestColumnMapping(headers: string[]): MappingSuggestion {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  const claimed = new Set<number>();

  for (const field of LOT_FIELDS) {
    const idx = normalized.findIndex((h, i) => !claimed.has(i) && field.aliases.includes(h));
    if (idx >= 0) {
      mapping[field.key] = idx;
      claimed.add(idx);
    }
  }
  for (const field of LOT_FIELDS) {
    if (mapping[field.key] != null) continue;
    const idx = normalized.findIndex(
      (h, i) => !claimed.has(i) && h.length > 2 && field.aliases.some((a) => a.length > 2 && h.includes(a)),
    );
    if (idx >= 0) {
      mapping[field.key] = idx;
      claimed.add(idx);
    }
  }

  return {
    mapping,
    unmappedRequired: REQUIRED_LOT_FIELDS.filter((k) => mapping[k] == null),
    ignoredColumns: headers
      .map((header, index) => ({ index, header }))
      .filter(({ index }) => !claimed.has(index)),
  };
}

// ============================================================================
// Validation
// ============================================================================

export interface FieldError {
  field: LotFieldKey | "row";
  column: string | null;
  value: string;
  message: string;
}

export interface RowRejection {
  /** 1-based row number in the FILE (header is row 1, so first data row is 2). */
  fileRow: number;
  raw: string[];
  errors: FieldError[];
}

/**
 * A validated lot, in canonical form. Money is integer cents; the DB
 * boundary casts to the legacy `numeric` columns via `centsToNumeric`.
 */
export interface PreparedLot {
  fileRow: number;
  apn: string;
  county: string;
  state: string;
  saleType: TaxSaleLotSaleType;
  totalTaxOwedCents: number;
  minimumBidCents: number | null;
  openingBidCents: number | null;
  assessedValueCents: number | null;
  marketValueCents: number | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  legalDescription: string | null;
  acreage: string | null;
  propertyType: string | null;
  ownerName: string | null;
  acquisitionSource: TaxSaleLotAcquisitionSource | null;
  notes: string | null;
}

export interface ValidationOutcome {
  valid: PreparedLot[];
  rejected: RowRejection[];
  summary: {
    totalRows: number;
    validCount: number;
    rejectedCount: number;
    /** Distinct (state, county) pairs seen among valid rows. */
    jurisdictions: Array<{ state: string; county: string; count: number }>;
    totalTaxOwedCents: number;
    minimumBidTotalCents: number;
  };
}

const VALID_STATES = new Set(referenceCoveredStates());

/**
 * Parse a money string to integer cents. Returns null for blank, and an
 * Error-carrying result for anything unparseable. Deliberately strict:
 * "$1,234.56", "1234.56" and "(1,234.56)" are accepted; "call clerk",
 * "N/A" and "1.2.3" are rejected rather than silently zeroed.
 */
export function parseMoneyToCents(raw: string): { cents: number } | { error: string } {
  const t = raw.trim();
  if (t === "" || t === "-") return { cents: NaN };
  let s = t.replace(/[$\s,]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,6})?$/.test(s)) {
    return { error: `"${raw}" is not a dollar amount AcreOS can read.` };
  }
  const cents = Math.round(Number(s) * 100);
  if (!Number.isSafeInteger(cents)) {
    return { error: `"${raw}" is out of range.` };
  }
  if (negative) return { error: `"${raw}" is negative; a tax-sale amount cannot be.` };
  return { cents };
}

function normalizeSaleType(raw: string): TaxSaleLotSaleType | null {
  const t = raw.toLowerCase().replace(/[\s-]+/g, "_").trim();
  if (t === "lien" || t === "tax_lien" || t === "tax_lien_certificate" || t === "certificate" || t === "cert") {
    return "lien";
  }
  if (t === "deed" || t === "tax_deed") return "deed";
  if (t === "redeemable_deed" || t === "redeemable" || t === "hybrid") return "redeemable_deed";
  return null;
}

function normalizeSource(raw: string): TaxSaleLotAcquisitionSource | null {
  const t = raw.toLowerCase().replace(/[\s-]+/g, "_").trim();
  if ((TAX_SALE_LOT_ACQUISITION_SOURCES as readonly string[]).includes(t)) {
    return t as TaxSaleLotAcquisitionSource;
  }
  if (t === "over_the_counter" || t === "struck_off" || t === "county_held") return "otc";
  if (t === "presale" || t === "pre_sale" || t === "published_list") return "pre_sale_list";
  if (t === "off_market" || t === "direct") return "private";
  return null;
}

export interface ValidateOptions {
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
  /**
   * Parcels already on the worksheet for this auction. Matching rows are
   * rejected as duplicates rather than double-inserted — and rather than
   * silently skipped, which is how "412 of 500" happens.
   *
   * THE FULL NATURAL KEY, not the APN alone. An APN is unique WITHIN A COUNTY
   * and nowhere else; parcel 123-45-678 exists in Travis County and in Harris
   * County and they are different pieces of land. Keyed on the APN alone, a
   * state-level tax-sale list — which is the ordinary shape of one — rejected
   * the second county's parcel as "already on this worksheet", and the user was
   * told a real parcel was a duplicate. `county` and `state` are REQUIRED
   * import fields, so the whole key was on the row the entire time.
   */
  existingParcels?: readonly { apn: string; county: string; state: string }[];
  /** Fallback when the sheet has no acquisition-source column. */
  defaultAcquisitionSource?: TaxSaleLotAcquisitionSource;
}

/**
 * The dedup identity for one lot: state + county + APN, through the repo's one
 * definition of "the same parcel" (shared/parcel/parcelRef.ts).
 *
 * `parcelKey`, not `parcelMatchKey` — deciding two rows are duplicates DROPS
 * one of them, and the loose key merges "12-345-678" with "12345678". In a
 * county where the separator is significant that discards a genuinely different
 * parcel from a tax sale, which is the expensive direction to be wrong in.
 *
 * A key parcelRef refuses (missing county, digitless APN) falls back to a
 * prefixed raw form so such rows still dedupe against EACH OTHER — a refusal
 * must not silently mean "not a duplicate" and let the same row import twice.
 * The prefix cannot collide with a parcelKey, which always begins with a
 * two-letter upper-case state code and a space.
 */
function lotDedupKey(p: { apn: string; county: string; state: string }): string {
  const ref = normalizeParcelRef({ state: p.state, county: p.county, apn: p.apn });
  if (ref.ok) return parcelKey(ref.ref);
  return `unnormalized|${p.state.trim().toLowerCase()}|${p.county.trim().toLowerCase()}|${p.apn.trim().toLowerCase()}`;
}

export function validateLotRows(opts: ValidateOptions): ValidationOutcome {
  const { headers, rows, mapping } = opts;
  const valid: PreparedLot[] = [];
  const rejected: RowRejection[] = [];
  const seenApns = new Set((opts.existingParcels ?? []).map(lotDedupKey));
  const seenInFile = new Map<string, number>();

  const colName = (key: LotFieldKey): string | null => {
    const idx = mapping[key];
    return idx == null ? null : (headers[idx] ?? `column ${idx + 1}`);
  };
  const cell = (row: string[], key: LotFieldKey): string => {
    const idx = mapping[key];
    if (idx == null) return "";
    return (row[idx] ?? "").trim();
  };

  rows.forEach((row, i) => {
    const fileRow = i + 2; // header is file row 1
    const errors: FieldError[] = [];

    // A wholly blank line inside the file is a rejection with an explanation,
    // not an invisible skip.
    if (row.every((c) => c.trim() === "")) {
      rejected.push({
        fileRow,
        raw: row,
        errors: [{ field: "row", column: null, value: "", message: "Row is empty." }],
      });
      return;
    }
    if (row.length !== headers.length) {
      errors.push({
        field: "row",
        column: null,
        value: row.join(" | "),
        message: `Row has ${row.length} column${row.length === 1 ? "" : "s"} but the header has ${headers.length}. Check for an unquoted comma.`,
      });
    }

    const apn = cell(row, "apn");
    const county = cell(row, "county");
    const stateRaw = cell(row, "state");
    const saleTypeRaw = cell(row, "saleType");

    if (!apn) {
      errors.push({ field: "apn", column: colName("apn"), value: apn, message: "Parcel number is required." });
    }
    if (!county) {
      errors.push({ field: "county", column: colName("county"), value: county, message: "County is required." });
    }

    const state = stateRaw.toUpperCase();
    if (!state) {
      errors.push({ field: "state", column: colName("state"), value: stateRaw, message: "State is required." });
    } else if (!/^[A-Z]{2}$/.test(state)) {
      errors.push({
        field: "state",
        column: colName("state"),
        value: stateRaw,
        message: `"${stateRaw}" is not a two-letter state code.`,
      });
    } else if (!VALID_STATES.has(state)) {
      errors.push({
        field: "state",
        column: colName("state"),
        value: stateRaw,
        message: `AcreOS has no tax-sale rules encoded for '${state}'. The row is not imported — nothing is assumed on your behalf.`,
      });
    }

    const saleType = normalizeSaleType(saleTypeRaw);
    if (!saleTypeRaw) {
      errors.push({
        field: "saleType",
        column: colName("saleType"),
        value: saleTypeRaw,
        message: "Sale type is required (lien, deed, or redeemable_deed).",
      });
    } else if (!saleType) {
      errors.push({
        field: "saleType",
        column: colName("saleType"),
        value: saleTypeRaw,
        message: `"${saleTypeRaw}" is not a sale type AcreOS recognises (lien, deed, redeemable_deed).`,
      });
    }

    const money: Partial<Record<LotFieldKey, number | null>> = {};
    for (const key of ["totalTaxOwed", "minimumBid", "openingBid", "assessedValue", "marketValue"] as const) {
      const raw = cell(row, key);
      const field = LOT_FIELDS.find((f) => f.key === key)!;
      if (raw === "") {
        if (field.required) {
          errors.push({ field: key, column: colName(key), value: raw, message: `${field.label} is required.` });
        }
        money[key] = null;
        continue;
      }
      const parsed = parseMoneyToCents(raw);
      if ("error" in parsed) {
        errors.push({ field: key, column: colName(key), value: raw, message: parsed.error });
        money[key] = null;
      } else if (Number.isNaN(parsed.cents)) {
        money[key] = null;
      } else {
        money[key] = parsed.cents;
      }
    }

    const sourceRaw = cell(row, "acquisitionSource");
    let acquisitionSource: TaxSaleLotAcquisitionSource | null = opts.defaultAcquisitionSource ?? null;
    if (sourceRaw) {
      const s = normalizeSource(sourceRaw);
      if (!s) {
        errors.push({
          field: "acquisitionSource",
          column: colName("acquisitionSource"),
          value: sourceRaw,
          message: `"${sourceRaw}" is not an acquisition source AcreOS recognises (auction, otc, pre_sale_list, private).`,
        });
      } else {
        acquisitionSource = s;
      }
    }

    // Duplicate detection — against the worksheet AND within the file.
    // Keyed on the whole parcel, not the APN: see `existingParcels`.
    if (apn) {
      const dupKey = lotDedupKey({ apn, county, state });
      if (seenApns.has(dupKey)) {
        errors.push({
          field: "apn",
          column: colName("apn"),
          value: apn,
          message: `Parcel ${apn} is already on this worksheet. Not imported twice.`,
        });
      } else if (seenInFile.has(dupKey)) {
        errors.push({
          field: "apn",
          column: colName("apn"),
          value: apn,
          message: `Parcel ${apn} also appears on row ${seenInFile.get(dupKey)} of this file.`,
        });
      }
    }

    if (errors.length > 0) {
      rejected.push({ fileRow, raw: row, errors });
      return;
    }

    if (apn) seenInFile.set(lotDedupKey({ apn, county, state }), fileRow);

    const orNull = (v: string): string | null => (v === "" ? null : v);
    valid.push({
      fileRow,
      apn,
      county,
      state,
      saleType: saleType!,
      totalTaxOwedCents: money.totalTaxOwed!,
      minimumBidCents: money.minimumBid ?? null,
      openingBidCents: money.openingBid ?? null,
      assessedValueCents: money.assessedValue ?? null,
      marketValueCents: money.marketValue ?? null,
      address: orNull(cell(row, "address")),
      city: orNull(cell(row, "city")),
      zip: orNull(cell(row, "zip")),
      legalDescription: orNull(cell(row, "legalDescription")),
      acreage: orNull(cell(row, "acreage")),
      propertyType: orNull(cell(row, "propertyType")),
      ownerName: orNull(cell(row, "ownerName")),
      acquisitionSource,
      notes: orNull(cell(row, "notes")),
    });
  });

  const jurisdictionMap = new Map<string, { state: string; county: string; count: number }>();
  for (const lot of valid) {
    const k = `${lot.state}|${lot.county}`;
    const cur = jurisdictionMap.get(k);
    if (cur) cur.count += 1;
    else jurisdictionMap.set(k, { state: lot.state, county: lot.county, count: 1 });
  }

  return {
    valid,
    rejected,
    summary: {
      totalRows: rows.length,
      validCount: valid.length,
      rejectedCount: rejected.length,
      jurisdictions: Array.from(jurisdictionMap.values()).sort((a, b) => b.count - a.count),
      totalTaxOwedCents: valid.reduce((s, l) => s + l.totalTaxOwedCents, 0),
      minimumBidTotalCents: valid.reduce((s, l) => s + (l.minimumBidCents ?? 0), 0),
    },
  };
}

/**
 * The no-silent-drop invariant, as an assertion rather than a comment.
 * Called by the import route before it commits anything.
 */
export function assertNoRowLost(outcome: ValidationOutcome): void {
  const accounted = outcome.valid.length + outcome.rejected.length;
  if (accounted !== outcome.summary.totalRows) {
    throw new Error(
      `Import accounting error: ${outcome.summary.totalRows} rows in, ${accounted} accounted for. Refusing to import a file we cannot fully explain.`,
    );
  }
}

/** Integer cents → the string form the legacy `numeric` columns take. */
export function centsToNumeric(cents: number | null): string | null {
  if (cents === null) return null;
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** The legacy `numeric` string form → integer cents. Null-safe. */
export function numericToCents(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseMoneyToCents(String(value));
  if ("error" in parsed || Number.isNaN(parsed.cents)) return null;
  return parsed.cents;
}
