/**
 * The parcel facts a land investor prices and mails on — ACREAGE, VALUE and
 * TAX-DELINQUENT status — read from an imported lead list.
 *
 * ONE module, used by every lead import path (the population is pinned by
 * tests/unit/leadImportKeepsParcelFacts.test.ts):
 *   - POST /api/leads/csv-import              (server/routes-leads.ts)
 *   - POST /api/leads/import/tax-delinquent   (server/routes-leads.ts)
 *   - importLeads()                           (server/services/importExport.ts —
 *     POST /api/leads/import, POST /api/import/leads and its background job)
 *   - processTaxDelinquentImport()            (server/services/taxDelinquentPipeline.ts)
 * and by the client column mappers (shared/leads/csvImportMapping.ts for the
 * Smart CSV sheet, client/src/components/tax-delinquent-importer.tsx).
 *
 * REFUSE, NEVER FABRICATE. A cell that does not plainly hold the fact is null —
 * never 0. "N/A", "", "unknown", "5,000 sq ft" in an acres column, "$-" are all
 * null. A zero acreage or a zero value is null too: a county roll writes 0 for
 * "not assessed" / "not measured", and a stored 0 would read as a worthless or
 * dimensionless parcel to every downstream price and equity calculation.
 *
 * TWO VALUES, NOT ONE. A county ASSESSED value is the assessor's figure for
 * taxation; `estimatedValue` is a market ESTIMATE (the schema: "a derived
 * ESTIMATE, never a quoted comp"). They are different facts and are kept in
 * different columns — an "Assessed Value" column never fills estimatedValue.
 */

export type ParcelFactField =
  | "acreage"
  | "assessedValue"
  | "estimatedValue"
  | "taxDelinquent"
  | "taxDelinquentAmount"
  | "taxDelinquentYears";

/** Raw cells for the parcel facts, as an import row carries them. */
export interface RawParcelFacts {
  acreage?: unknown;
  assessedValue?: unknown;
  estimatedValue?: unknown;
  taxDelinquent?: unknown;
  taxDelinquentAmount?: unknown;
  taxDelinquentYears?: unknown;
}

/** Insert-ready lead columns (numeric columns are strings for Drizzle). */
export interface LeadParcelFactColumns {
  acreage: string | null;
  assessedValue: string | null;
  estimatedValue: string | null;
  taxDelinquent: boolean | null;
  taxDelinquentAmount: string | null;
  taxDelinquentYears: number | null;
}

function cellText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : "";
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw).trim();
}

/** "1,234.5" → 1234.5; anything that is not a plain decimal → null. */
function plainNumber(s: string): number | null {
  // Thousands separators only between digit groups ("1,234.5", not "1,2").
  if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^-?\.\d+$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Acres. "12.5", "12.5 ac", "12.5 acres", "1,234.5", "12.5AC" → the number.
 * Blank, "N/A", garbage, another unit ("5000 sq ft", "2 ha"), zero or a
 * negative → null.
 */
function parseAcreage(raw: unknown): number | null {
  const s = cellText(raw).toLowerCase();
  if (!s) return null;
  const m = s.match(/^(.*?)\s*(acres?|acs?|ac\.)?$/);
  const num = m ? plainNumber(m[1].trim()) : null;
  if (num === null || num <= 0) return null;
  return num;
}

/**
 * Money. "$12,345", "12345.67", "$ 1,200.00", "USD 900" → the number.
 * Blank, "N/A", "$-", garbage, negative or "(1,200)" → null. `allowZero` is
 * for an amount owed, where $0 is a real statement ("nothing owed"); for a
 * VALUE a zero means "not assessed" and is null.
 */
function parseMoney(raw: unknown, opts: { allowZero?: boolean } = {}): number | null {
  const s = cellText(raw).replace(/^usd\s*/i, "").replace(/^\$\s*/, "").replace(/\s*usd$/i, "").trim();
  if (!s) return null;
  const n = plainNumber(s);
  if (n === null || n < 0) return null;
  if (n === 0 && !opts.allowZero) return null;
  return n;
}

/** Whole years delinquent. "3", "3 yrs", "3 years" → 3; blank, garbage, negative, > 100 → null. */
function parseYearsDelinquent(raw: unknown): number | null {
  const s = cellText(raw).toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,3})\s*(y|yr|yrs|year|years)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= 100 ? n : null;
}

/**
 * A tax-delinquent flag cell. Y / Yes / True / T / 1 / "Delinquent" → true;
 * N / No / False / F / 0 / "Current" / "Not delinquent" → false; blank or
 * anything else → null (unknown is not "no").
 */
function parseDelinquentFlag(raw: unknown): boolean | null {
  const s = cellText(raw).toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (!s) return null;
  if (/^(n|no|false|f|0|current|paid|not delinquent|non delinquent|nondelinquent)$/.test(s)) return false;
  if (/^(y|yes|true|t|1|x|delinquent|tax delinquent|delq|delinq)$/.test(s)) return true;
  return null;
}

/**
 * The row's tax-delinquent status, from every column that speaks to it. A
 * positive amount owed or a positive years-delinquent count IS delinquency, so
 * either implies true; otherwise the flag column decides; no evidence → null.
 */
function resolveTaxDelinquent(input: {
  flag: boolean | null;
  amount: number | null;
  years: number | null;
}): boolean | null {
  if (input.flag === true) return true;
  if ((input.amount ?? 0) > 0 || (input.years ?? 0) > 0) return true;
  return input.flag;
}

const asColumn = (n: number | null): string | null => (n === null ? null : String(n));

/** The insert-ready parcel-fact columns for one import row. */
export function leadParcelFactsFromRow(row: RawParcelFacts): LeadParcelFactColumns {
  const acreage = parseAcreage(row.acreage);
  const assessedValue = parseMoney(row.assessedValue);
  const estimatedValue = parseMoney(row.estimatedValue);
  const amount = parseMoney(row.taxDelinquentAmount, { allowZero: true });
  const years = parseYearsDelinquent(row.taxDelinquentYears);
  const flag = parseDelinquentFlag(row.taxDelinquent);
  return {
    acreage: asColumn(acreage),
    assessedValue: asColumn(assessedValue),
    estimatedValue: asColumn(estimatedValue),
    taxDelinquent: resolveTaxDelinquent({ flag, amount, years }),
    taxDelinquentAmount: asColumn(amount),
    taxDelinquentYears: years,
  };
}

/**
 * Header → parcel fact, for the column mappers. The header is normalized to
 * lower-case words first ("Lot Size (Acres)" → "lot size acres", "CalcAcres"
 * → "calc acres", "TAX_DELINQUENT" → "tax delinquent"). Returns null for a header that is not a parcel fact. "Land Value" is
 * returned as `landValue` so a mapper can use it as the assessed value only
 * when the file has no explicit assessed column (a county roll's land
 * component is an assessor's figure, never a market estimate).
 */
export function classifyParcelFactHeader(header: string): ParcelFactField | "landValue" | null {
  const h = normalizeFactHeader(header);
  const has = (re: RegExp) => re.test(h);
  // Acreage first: "Assessed Acres" / "Parcel Acres" are areas, not values or APNs.
  if (has(/\b(acres?|acreage|acs)\b/) || h === "ac" || has(/\bcalc ac\b/)) return "acreage";
  // A square-foot or hectare lot size matches nothing here: never read as acres.
  const delinq = has(/\b(delinquent|delinquency|delq|delinq)\b/);
  if (delinq && has(/\b(years?|yrs?)\b/)) return "taxDelinquentYears";
  if (has(/\byears? behind\b/)) return "taxDelinquentYears";
  if (
    (delinq && has(/\b(amount|amt|balance|due|owed|total|taxes)\b/)) ||
    has(/\btax(es)? (owed|due)\b/) ||
    has(/\b(amount|balance|total) (due|owed)\b/) ||
    has(/\bback taxes\b/)
  ) {
    return "taxDelinquentAmount";
  }
  if (delinq && has(/\bsince\b/)) return null; // a year, not a flag
  if (delinq) return "taxDelinquent";
  if (has(/\b(assessed|assessment|assessor)\b/) && !has(/\b(date|year|yr)\b/)) return "assessedValue";
  if (has(/\b(market|estimated|est|estimate)\b/) && has(/\b(value|val|price)\b/)) return "estimatedValue";
  if (has(/\bland (value|val)\b/)) return "landValue";
  return null;
}

/** Same word form as csvImportMapping's header normalizer; idempotent. */
function normalizeFactHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PARCEL_FACT_FIELDS: ReadonlySet<string> = new Set<ParcelFactField>([
  "acreage",
  "assessedValue",
  "estimatedValue",
  "taxDelinquent",
  "taxDelinquentAmount",
  "taxDelinquentYears",
]);

/**
 * The parcel-fact cells of one header-keyed record (a server-parsed CSV row).
 * A header the caller's own map sends to a fact field wins; a header the map
 * does not name is classified by its words. First non-empty cell per fact, in
 * column order. A "Land Value" column fills the assessed value only when no
 * assessed column is present in the record.
 */
export function parcelFactCellsFromRecord(
  record: Record<string, unknown>,
  mappedField: (header: string) => string | undefined = () => undefined,
): RawParcelFacts {
  const out: Record<string, unknown> = {};
  let landValue: unknown;
  let hasAssessedColumn = false;
  for (const [header, value] of Object.entries(record)) {
    const mapped = mappedField(header);
    const field = mapped !== undefined ? (PARCEL_FACT_FIELDS.has(mapped) ? mapped : null) : classifyParcelFactHeader(header);
    if (!field) continue;
    if (field === "assessedValue") hasAssessedColumn = true;
    if (cellText(value) === "") continue;
    if (field === "landValue") {
      if (landValue === undefined) landValue = value;
      continue;
    }
    if (out[field] === undefined) out[field] = value;
  }
  if (!hasAssessedColumn && landValue !== undefined) out.assessedValue = landValue;
  return out as RawParcelFacts;
}

/**
 * The parcel facts a lead detail shows, in the order an investor reads them.
 * Only facts that are on file appear — nothing is rendered as "0" or "$0" for
 * a fact the list did not state. The two values keep their own labels.
 */
export function parcelFactRows(lead: {
  acreage?: string | number | null;
  assessedValue?: string | number | null;
  estimatedValue?: string | number | null;
  taxDelinquent?: boolean | null;
  taxDelinquentAmount?: string | number | null;
  taxDelinquentYears?: number | null;
}): Array<{ key: ParcelFactField; label: string; value: string }> {
  const rows: Array<{ key: ParcelFactField; label: string; value: string }> = [];
  const num = (v: string | number | null | undefined): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const usd = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });
  const acres = num(lead.acreage);
  if (acres !== null) {
    rows.push({ key: "acreage", label: "Acreage", value: `${acres.toLocaleString("en-US", { maximumFractionDigits: 4 })} ac` });
  }
  const assessed = num(lead.assessedValue);
  if (assessed !== null) rows.push({ key: "assessedValue", label: "Assessed value (county)", value: usd(assessed) });
  const estimated = num(lead.estimatedValue);
  if (estimated !== null) rows.push({ key: "estimatedValue", label: "Estimated value", value: usd(estimated) });
  if (lead.taxDelinquent === true || lead.taxDelinquent === false) {
    rows.push({ key: "taxDelinquent", label: "Tax delinquent", value: lead.taxDelinquent ? "Yes" : "No" });
  }
  const owed = num(lead.taxDelinquentAmount);
  if (owed !== null) rows.push({ key: "taxDelinquentAmount", label: "Taxes owed", value: usd(owed) });
  if (typeof lead.taxDelinquentYears === "number") {
    rows.push({
      key: "taxDelinquentYears",
      label: "Years delinquent",
      value: `${lead.taxDelinquentYears} ${lead.taxDelinquentYears === 1 ? "year" : "years"}`,
    });
  }
  return rows;
}
