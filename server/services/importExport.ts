import { neutraliseCsvFormula } from "@shared/csv/formulaSafe";
import { parseDncFlag } from "@shared/leads/csvImportMapping";
import { leadParcelFactsFromRow, parcelFactCellsFromRecord } from "@shared/leads/parcelFacts";
import { z } from "zod";
// Exports read the WHOLE book, never the 5000-row capped list (DEFECT-0170).
import {
  readAllDeals,
  readAllLeads,
  readAllNotes,
  readAllProperties,
} from "../storage/wholeBookReads";
import { insertLeadSchema, insertPropertySchema, insertDealSchema, leads, activityLog } from "@shared/schema";
import { calculateMonthlyPayment } from "../storage/noteRepo";
import { leadHasOptedOut } from "./leadContactability";
import { and, eq, inArray, sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { apnMatchForm, createParcelDedupeIndex } from "./leads/parcelDedupe";
// Wave B "Wire the engine" — CSV/bulk imports are a lead-creation path, so
// they must fire lead.created just like the single-create route does.
import { emitLeadCreated, emitLeadCreatedDurably } from "./leadEvents";
// 2026-07-29 Wave B completeness audit: the lead importer fired
// `lead.created`, but the property and deal importers in this same file
// created rows silently — so a workflow on `property.created` / `deal.created`
// ran for a single-record create and not for a CSV import of a thousand.
// Same rule, same file, same event contract.
import { emitPropertyCreated, emitPropertyCreatedDurably } from "./propertyEvents";
import { emitDealCreated, emitDealCreatedDurably } from "./dealEvents";
import { clock } from "../utils/clock";
import { stripConsentForImport } from "./consentStamp";

/**
 * A persistence failure on an import path, as a field-level message. A raw
 * driver error carries the whole statement — "Failed query: insert into
 * "properties" (…) values (default, $1, …)" — which is the table's column list
 * and its parameter placeholders handed to the API caller (G11 run, §P6). The
 * row, the field and the fix are what the customer needs; the SQL is not.
 * Errors this module throws itself ("sizeAcres: Size is required") are already
 * field-level and pass through unchanged.
 */
const SQL_IN_MESSAGE = /Failed query:|\binsert\s+into\b|\bupdate\s+"|\bselect\s+.+\s+from\b|\bdelete\s+from\b|\$\d+\b|params:/i;

function fieldFromColumn(column: unknown): string | null {
  if (typeof column !== "string" || !/^[a-z_][a-z0-9_]*$/.test(column)) return null;
  return column.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export function importRowError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown } | null)?.cause ?? err;
  const pg = (cause ?? {}) as { code?: unknown; column?: unknown; constraint?: unknown };
  const leaksSql = SQL_IN_MESSAGE.test(message) || typeof pg.code === "string";
  if (!leaksSql) return message;
  const field = fieldFromColumn(pg.column);
  switch (pg.code) {
    case "23502":
      return `${field ?? "a required field"}: is required. Fix: fill this column in for the row.`;
    case "22P02":
    case "22003":
      return `${field ?? "a numeric or date field"}: the value is not in the expected format. Fix: use a plain number (12.5) or an ISO date (2026-10-30) with no units or symbols.`;
    case "22001":
      return `${field ?? "a text field"}: the value is too long. Fix: shorten it.`;
    case "23505":
      return "this row duplicates a record that already exists. Fix: remove the duplicate row or change its identifying fields.";
    case "23503":
      return `${field ?? "a reference"}: points at a record that does not exist in this organization. Fix: correct the id or import the referenced record first.`;
    case "23514":
      return `${field ?? "a field"}: the value is not allowed. Fix: use one of the values the app offers for this field.`;
    default:
      return "this row could not be saved. Fix: check the row's values against the column guide and re-import it.";
  }
}

/** A numeric cell: blank is "not stated"; anything else must be a plain number, or the row names the field. */
function numericCell(field: string, raw: string | null | undefined): string | null {
  const t = (raw ?? "").toString().trim();
  if (t === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) {
    throw new Error(`${field}: "${t}" is not a plain number. Fix: use digits only, such as 12.5 (no commas, units or $).`);
  }
  return t;
}

/** A date cell: blank is "not stated"; anything else must parse, or the row names the field. */
function dateCell(field: string, raw: string | null | undefined): Date | null {
  const t = (raw ?? "").toString().trim();
  if (t === "") return null;
  const iso = parseDate(t);
  if (!iso) throw new Error(`${field}: "${t}" is not a date. Fix: use a date such as 2026-10-30 or 10/30/2026.`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  duplicatesSkipped: number;
  /** Rows skipped because the owner asked not to be contacted (suppression hook). */
  suppressedSkipped?: number;
  errors: Array<{
    row: number;
    data: Record<string, string>;
    error: string;
  }>;
}

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: Array<{
    rowNumber: number;
    data: Record<string, string>;
    valid: boolean;
    errors: string[];
  }>;
  columns: string[];
}

export interface ExportFilters {
  status?: string;
  startDate?: string;
  endDate?: string;
  type?: string;
}

/**
 * CSV → rows keyed by header.
 *
 * Exports from Excel and Google Sheets routinely start with a UTF-8 byte-order
 * mark and end lines with CRLF. Both are handled explicitly here rather than
 * by accident: the BOM is removed before the header is read (so the first
 * column is `firstName`, not `\uFEFFfirstName`, and still maps), and the record
 * splitter understands CRLF, LF and lone CR.
 *
 * Records are split by a single character scan that knows about quotes, so a
 * quoted value containing a line break — an address or a note — stays ONE
 * value. The previous version split the text on newlines before looking at
 * quotes, which cut such a row in two and shifted every later column.
 */
/** Header names that would address Object.prototype rather than a column. */
const RESERVED_HEADER_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/** The uploaded text is not a CSV at all — the caller's fault, a 400, never a 500. */
export class CsvInputError extends Error {}

export function parseCSV(csvString: string): Array<Record<string, string>> {
  if (typeof csvString !== "string") {
    throw new CsvInputError("CSV input must be text");
  }
  const records = splitCsvRecords(csvString.replace(/^\uFEFF/, ""))
    .filter((cells) => cells.some((c) => c.trim().length > 0));
  if (records.length === 0) {
    throw new CsvInputError("CSV is empty: it needs a header row");
  }
  // A header and no rows is a valid file with nothing in it — exactly what an
  // export of an empty book is. It reports 0 rows; it is not an error (G11
  // Defect 1: re-importing the headers-only notes export returned a 500).
  if (records.length === 1) return [];

  const headers = records[0].map((h) => h.trim());
  const data: Array<Record<string, string>> = [];
  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    const entries: Array<[string, string]> = [];
    headers.forEach((header, idx) => {
      if (RESERVED_HEADER_NAMES.has(header)) return;
      entries.push([header, values[idx]?.trim() || ""]);
    });
    data.push(Object.fromEntries(entries));
  }
  return data;
}

/** RFC 4180-style record split: quoted fields may hold commas, quotes ("") and line breaks. */
function splitCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell.trim() === "") {
      // A quote opens a quoted field only at the START of a field. Mid-field
      // (`5" pipe`) it is a literal — otherwise one stray inch mark would run
      // the quoted state across every following line.
      inQuotes = true;
      cell = "";
    } else if (c === ",") {
      record.push(cell);
      cell = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell.length > 0 || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  return records;
}

const LEAD_COLUMN_MAP: Record<string, string> = {
  type: "type",
  firstName: "firstName",
  first_name: "firstName",
  "first name": "firstName",
  lastName: "lastName",
  last_name: "lastName",
  "last name": "lastName",
  email: "email",
  phone: "phone",
  address: "address",
  city: "city",
  state: "state",
  zip: "zip",
  county: "county",
  apn: "apn",
  APN: "apn",
  "parcel number": "apn",
  parcel_number: "apn",
  parcelNumber: "apn",
  status: "status",
  source: "source",
  notes: "notes",
  // A list's DNC flag may set do-not-contact. There is deliberately NO consent
  // column here: an import never grants TCPA consent.
  doNotContact: "doNotContact",
  do_not_contact: "doNotContact",
  "do not contact": "doNotContact",
  dnc: "doNotContact",
  DNC: "doNotContact",
  // Phase 4 Week 15-16 (Magdalena §1) — history-preserving migration columns.
  tags: "tags",
  tag: "tags",
  labels: "tags",
  assignedTo: "assignedTo",
  assigned_to: "assignedTo",
  "assigned to": "assignedTo",
  owner: "assignedTo",
  ownerEmail: "assignedTo",
  createdAt: "createdAt",
  created_at: "createdAt",
  "created at": "createdAt",
  createdOn: "createdAt",
};

const PROPERTY_COLUMN_MAP: Record<string, string> = {
  apn: "apn",
  APN: "apn",
  "parcel number": "apn",
  parcelNumber: "apn",
  legalDescription: "legalDescription",
  legal_description: "legalDescription",
  "legal description": "legalDescription",
  county: "county",
  state: "state",
  address: "address",
  city: "city",
  zip: "zip",
  subdivision: "subdivision",
  lotNumber: "lotNumber",
  lot_number: "lotNumber",
  "lot number": "lotNumber",
  sizeAcres: "sizeAcres",
  size_acres: "sizeAcres",
  "size acres": "sizeAcres",
  // The header exportPropertiesToCSV writes — the user-facing name. G11 Defect 2:
  // the export said "Size (Acres)", the map did not know it, and the app's own
  // export re-imported 0/3.
  "size (acres)": "sizeAcres",
  size: "sizeAcres",
  acres: "sizeAcres",
  zoning: "zoning",
  terrain: "terrain",
  roadAccess: "roadAccess",
  road_access: "roadAccess",
  "road access": "roadAccess",
  status: "status",
  assessedValue: "assessedValue",
  assessed_value: "assessedValue",
  "assessed value": "assessedValue",
  marketValue: "marketValue",
  market_value: "marketValue",
  "market value": "marketValue",
  purchasePrice: "purchasePrice",
  purchase_price: "purchasePrice",
  "purchase price": "purchasePrice",
  purchaseDate: "purchaseDate",
  purchase_date: "purchaseDate",
  "purchase date": "purchaseDate",
  soldPrice: "soldPrice",
  sold_price: "soldPrice",
  "sold price": "soldPrice",
  soldDate: "soldDate",
  sold_date: "soldDate",
  "sold date": "soldDate",
  listPrice: "listPrice",
  list_price: "listPrice",
  "list price": "listPrice",
  description: "description",
  latitude: "latitude",
  lat: "latitude",
  longitude: "longitude",
  lng: "longitude",
  lon: "longitude",
};

const DEAL_COLUMN_MAP: Record<string, string> = {
  propertyId: "propertyId",
  property_id: "propertyId",
  "property id": "propertyId",
  type: "type",
  status: "status",
  offerAmount: "offerAmount",
  offer_amount: "offerAmount",
  "offer amount": "offerAmount",
  counterAmount: "counterAmount",
  counter_amount: "counterAmount",
  "counter amount": "counterAmount",
  acceptedAmount: "acceptedAmount",
  accepted_amount: "acceptedAmount",
  "accepted amount": "acceptedAmount",
  closingCosts: "closingCosts",
  closing_costs: "closingCosts",
  "closing costs": "closingCosts",
  offerDate: "offerDate",
  offer_date: "offerDate",
  "offer date": "offerDate",
  closingDate: "closingDate",
  closing_date: "closingDate",
  "closing date": "closingDate",
  titleCompany: "titleCompany",
  title_company: "titleCompany",
  "title company": "titleCompany",
  escrowNumber: "escrowNumber",
  escrow_number: "escrowNumber",
  "escrow number": "escrowNumber",
  notes: "notes",
};

/**
 * The ONE header → field resolver. normalizeRow reads cells through it, and the
 * export/import header-drift tests resolve every exported header through it, so
 * "an exported header is importable" is decided by the code that imports.
 */
function resolveImportHeader(columnMap: Record<string, string>, header: string): string | undefined {
  return columnMap[header.toLowerCase()] || columnMap[header] || undefined;
}

function normalizeRow<T extends Record<string, string>>(
  row: Record<string, string>,
  columnMap: Record<string, string>
): T {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = resolveImportHeader(columnMap, key) || key;
    normalized[normalizedKey] = value;
  }

  return normalized as T;
}

const leadImportSchema = insertLeadSchema.extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

const propertyImportSchema = insertPropertySchema.extend({
  apn: z.string().min(1, "APN is required"),
  county: z.string().min(1, "County is required"),
  state: z.string().min(1, "State is required"),
  sizeAcres: z.string().min(1, "Size is required").or(z.number()),
});

const dealImportSchema = insertDealSchema.extend({
  propertyId: z.number().or(z.string().transform((v) => parseInt(v, 10))),
  type: z.string().min(1, "Type is required"),
});

export function previewImport(
  csvData: Array<Record<string, string>>,
  entityType: "leads" | "properties" | "deals"
): ImportPreview {
  const columnMap =
    entityType === "leads"
      ? LEAD_COLUMN_MAP
      : entityType === "properties"
      ? PROPERTY_COLUMN_MAP
      : DEAL_COLUMN_MAP;

  const schema =
    entityType === "leads"
      ? leadImportSchema
      : entityType === "properties"
      ? propertyImportSchema
      : dealImportSchema;

  const columns = csvData.length > 0 ? Object.keys(csvData[0]) : [];
  let validRows = 0;
  let invalidRows = 0;

  const rows = csvData.slice(0, 100).map((rawRow, i) => {
    const row = normalizeRow<Record<string, string>>(rawRow, columnMap);
    const parseResult = validateRow(row, entityType);

    if (parseResult.valid) {
      validRows++;
    } else {
      invalidRows++;
    }

    return {
      rowNumber: i + 2,
      data: rawRow,
      valid: parseResult.valid,
      errors: parseResult.errors,
    };
  });

  return {
    totalRows: csvData.length,
    validRows,
    invalidRows,
    rows,
    columns,
  };
}

function validateRow(
  row: Record<string, string>,
  entityType: "leads" | "properties" | "deals"
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (entityType === "leads") {
    if (!row.firstName) errors.push("First name is required");
    if (!row.lastName) errors.push("Last name is required");
  } else if (entityType === "properties") {
    if (!row.apn) errors.push("APN is required");
    if (!row.county) errors.push("County is required");
    if (!row.state) errors.push("State is required");
    if (!row.sizeAcres) errors.push("Size (acres) is required");
  } else if (entityType === "deals") {
    if (!row.propertyId) errors.push("Property ID is required");
    if (!row.type) errors.push("Type is required");
  }

  return { valid: errors.length === 0, errors };
}

export interface ImportLeadsOptions {
  /** Optional user-supplied header → field map (overrides default LEAD_COLUMN_MAP). */
  fieldMap?: Record<string, string> | null;
  /**
   * Stage `lead.created` in the outbox instead of the in-memory queue. The
   * scheduled import worker sets this: it has no request to fail, so an
   * in-memory event lost on a restart would vanish silently (DEFECT-0130).
   */
  durableEvents?: boolean;
}

export async function importLeads(
  csvData: Array<Record<string, string>>,
  organizationId: number,
  options: ImportLeadsOptions = {}
): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: csvData.length,
    successCount: 0,
    errorCount: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  // Phase 4 Week 15-16: resolve assignedTo emails → team_member.id, once per
  // distinct email so a 50K-row import doesn't fan out to 50K queries.
  const assignedEmailLookup = new Map<string, number | null>();

  // Phase 1: Validate all rows and collect parsed data
  const validatedRows: {
    index: number;
    data: any;
    dupCriteria: any;
    extras: { tags?: string[]; assignedTo?: number; createdAt?: Date };
  }[] = [];

  // Combined column map: defaults + user-supplied overrides.
  const effectiveMap = options.fieldMap
    ? { ...LEAD_COLUMN_MAP, ...options.fieldMap }
    : LEAD_COLUMN_MAP;

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];
    const row = normalizeRow<Record<string, string>>(rawRow, effectiveMap);

    try {
      const parseResult = leadImportSchema.safeParse({
        type: row.type || "seller",
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email || null,
        phone: row.phone || null,
        address: row.address || null,
        city: row.city || null,
        state: row.state || null,
        zip: row.zip || null,
        county: row.county || null,
        apn: row.apn || null,
        status: row.status || "new",
        source: row.source || "import",
        notes: row.notes || null,
        // Acreage, assessed vs estimated value and tax-delinquent status, from
        // the columns a county list uses ("Acres", "Total Assessed",
        // "Delinquent Amount", ...) or the caller's field map.
        ...leadParcelFactsFromRow(
          parcelFactCellsFromRecord(rawRow, (h) => effectiveMap[h.toLowerCase()] ?? effectiveMap[h]),
        ),
        ...(parseDncFlag(row.doNotContact) ? { doNotContact: true, optOutDate: clock.now(), optOutReason: "import_dnc_flag" } : {}),
      });

      if (!parseResult.success) {
        const errorMessages = parseResult.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        throw new Error(errorMessages);
      }

      // Build duplicate criteria for later checking
      const dupCriteria: Parameters<typeof storage.findDuplicateLeads>[1] = {};
      if (parseResult.data.email) dupCriteria.email = parseResult.data.email;
      if (parseResult.data.phone) dupCriteria.phone = parseResult.data.phone;
      if (parseResult.data.firstName && parseResult.data.lastName) {
        dupCriteria.firstName = parseResult.data.firstName;
        dupCriteria.lastName = parseResult.data.lastName;
      }

      // ─── History-preserving extras (Magdalena §1) ──────────────────────────
      const extras: { tags?: string[]; assignedTo?: number; createdAt?: Date } = {};
      if (row.tags) {
        // The exporter joins tags with "; " — split on both, or a round trip
        // turns two tags into one tag named "a; b".
        extras.tags = row.tags
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
      }
      if (row.assignedTo) {
        const email = row.assignedTo.trim().toLowerCase();
        if (!assignedEmailLookup.has(email)) {
          const member = await storage.getTeamMemberByEmail?.(organizationId, email);
          assignedEmailLookup.set(email, member?.id ?? null);
        }
        const memberId = assignedEmailLookup.get(email);
        if (memberId) extras.assignedTo = memberId;
      }
      if (row.createdAt) {
        const d = new Date(row.createdAt);
        if (!isNaN(d.getTime())) extras.createdAt = d;
      }

      validatedRows.push({ index: i, data: parseResult.data, dupCriteria, extras });
    } catch (error) {
      result.errorCount++;
      result.errors.push({
        row: i + 2,
        data: rawRow,
        error: importRowError(error),
      });
    }
  }

  // Phase 2: Duplicate detection. A row WITH an APN is a parcel, and its
  // identity is the parcel (APN + state + county — services/leads/
  // parcelDedupe.ts). It is not deduped on the owner's name, email or phone:
  // one owner holding three parcels on a county list is three leads, and the
  // contact match skipped two of them (DEFECT-0140). A row with no APN is a
  // contact, and keeps the contact match.
  const incomingApns = Array.from(
    new Set(validatedRows.map((r) => String(r.data.apn ?? "").trim()).filter((a) => a.length > 0)),
  );
  const existingParcels = createParcelDedupeIndex();
  for (let i = 0; i < incomingApns.length; i += 1000) {
    const existing = await db
      .select({ apn: leads.apn, state: leads.state, county: leads.county })
      .from(leads)
      // Deleted leads COUNT here, deliberately: a STOP writes doNotContact
      // onto the row even after it is deleted, and re-importing the list must
      // not mint a fresh, contactable row for someone who revoked consent
      // (audit of the fourth follow-up — DEFECT-0273's one exception).
      .where(and(eq(leads.organizationId, organizationId), inArray(sql`upper(regexp_replace(trim(${leads.apn}), '\\s+', ' ', 'g'))`, incomingApns.slice(i, i + 1000).map(apnMatchForm))));
    for (const r of existing) {
      if ((r.apn ?? "").trim()) existingParcels.add(r.state, r.county, r.apn ?? "");
    }
  }
  const seenParcels = createParcelDedupeIndex();

  // W5a suppression hook (server/services/leads/importSuppressionHook.ts):
  // an owner who asked not to be contacted is not re-created by an import.
  const { loadOutreachSuppression } = await import("./leads/importSuppressionHook");
  const isSuppressed = await loadOutreachSuppression(organizationId);

  const nonDuplicateRows: typeof validatedRows = [];
  for (const row of validatedRows) {
    if (isSuppressed({ phone: row.data.phone, email: row.data.email, address: row.data.address, zip: row.data.zip }).suppressed) {
      result.suppressedSkipped = (result.suppressedSkipped ?? 0) + 1;
      continue;
    }
    const apn = String(row.data.apn ?? "").trim();
    if (apn) {
      if (existingParcels.has(row.data.state, row.data.county, apn) || seenParcels.has(row.data.state, row.data.county, apn)) {
        result.duplicatesSkipped++;
        continue;
      }
      seenParcels.add(row.data.state, row.data.county, apn);
    } else if (Object.keys(row.dupCriteria).length > 0) {
      const duplicates = await storage.findDuplicateLeads(organizationId, row.dupCriteria);
      if (duplicates.length > 0) {
        result.duplicatesSkipped++;
        continue;
      }
    }
    nonDuplicateRows.push(row);
  }

  // Phase 3: Batch insert non-duplicate leads in chunks of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < nonDuplicateRows.length; i += BATCH_SIZE) {
    const chunk = nonDuplicateRows.slice(i, i + BATCH_SIZE);
    try {
      const created = await storage.createLeadsBatch(
        chunk.map((c) => ({ ...c.data, ...c.extras, organizationId }))
      );
      result.successCount += created.length;
      // VOLUME NOTE (Wave B): the workflow engine's event contract is
      // per-entity — `emitLeadEvent` takes a single leadId and there is no
      // batch/aggregate lead event, and no pre-existing batching convention
      // for workflow events anywhere in the engine. So a 50K-row import
      // enqueues 50K events. That is bounded and safe by construction:
      // `workflowEngine.emit()` pushes onto an in-process queue drained
      // SERIALLY by a single `processQueue` loop, off the request path, and
      // `getActiveWorkflowsByTrigger` returns [] for orgs with no
      // lead.created workflow — so the cost for the common case is one
      // indexed query per row, and the import response is never blocked.
      // If import-scale fan-out ever becomes a problem, the fix belongs in
      // the engine (a batch event or per-org coalescing), not here — do NOT
      // silently drop per-lead events, that would make the trigger lie again.
      for (const lead of created) {
        if (options.durableEvents) await emitLeadCreatedDurably(organizationId, lead);
        else emitLeadCreated(organizationId, lead);
      }
    } catch {
      // If batch fails, fall back to individual inserts for this chunk
      for (const item of chunk) {
        try {
          // The same no-consent row the batch insert writes (consentStamp.ts):
          // an import never grants consent, on either path.
          const single = await storage.createLead({ ...(stripConsentForImport({ ...item.data, ...item.extras }) as typeof item.data), organizationId });
          result.successCount++;
          if (options.durableEvents) await emitLeadCreatedDurably(organizationId, single);
          else emitLeadCreated(organizationId, single);
        } catch (error) {
          result.errorCount++;
          result.errors.push({
            row: item.index + 2,
            data: csvData[item.index],
            error: importRowError(error),
          });
        }
      }
    }
  }

  return result;
}

export async function importProperties(
  csvData: Array<Record<string, string>>,
  organizationId: number,
  options: { durableEvents?: boolean } = {},
): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: csvData.length,
    successCount: 0,
    errorCount: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];
    const row = normalizeRow<Record<string, string>>(rawRow, PROPERTY_COLUMN_MAP);

    try {
      const parseResult = propertyImportSchema.safeParse({
        apn: row.apn,
        legalDescription: row.legalDescription || null,
        county: row.county,
        state: row.state,
        address: row.address || null,
        city: row.city || null,
        zip: row.zip || null,
        subdivision: row.subdivision || null,
        lotNumber: row.lotNumber || null,
        sizeAcres: row.sizeAcres,
        zoning: row.zoning || null,
        terrain: row.terrain || null,
        roadAccess: row.roadAccess || null,
        status: row.status || "prospect",
        assessedValue: numericCell("assessedValue", row.assessedValue),
        marketValue: numericCell("marketValue", row.marketValue),
        purchasePrice: numericCell("purchasePrice", row.purchasePrice),
        purchaseDate: dateCell("purchaseDate", row.purchaseDate),
        listPrice: numericCell("listPrice", row.listPrice),
        soldPrice: numericCell("soldPrice", row.soldPrice),
        soldDate: dateCell("soldDate", row.soldDate),
        description: row.description || null,
        latitude: numericCell("latitude", row.latitude),
        longitude: numericCell("longitude", row.longitude),
      });

      if (!parseResult.success) {
        const errorMessages = parseResult.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        throw new Error(errorMessages);
      }

      numericCell("sizeAcres", String(parseResult.data.sizeAcres));
      const createdProperty = await storage.createProperty({
        ...parseResult.data,
        sizeAcres: String(parseResult.data.sizeAcres),
        organizationId,
      });

      result.successCount++;
      // Same per-entity contract (and the same volume note) as the lead
      // importer above.
      if (options.durableEvents) await emitPropertyCreatedDurably(organizationId, createdProperty);
      else emitPropertyCreated(organizationId, createdProperty);
    } catch (error) {
      result.errorCount++;
      result.errors.push({
        row: i + 2,
        data: rawRow,
        error: importRowError(error),
      });
    }
  }

  return result;
}

export async function importDeals(
  csvData: Array<Record<string, string>>,
  organizationId: number,
  options: { durableEvents?: boolean } = {},
): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: csvData.length,
    successCount: 0,
    errorCount: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];
    const row = normalizeRow<Record<string, string>>(rawRow, DEAL_COLUMN_MAP);

    try {
      const propertyId = parseInt(row.propertyId, 10);
      if (isNaN(propertyId)) {
        throw new Error("Invalid property ID");
      }

      const property = await storage.getProperty(organizationId, propertyId);
      if (!property) {
        throw new Error("Property not found or doesn't belong to this organization");
      }

      const createdDeal = await storage.createDeal({
        organizationId,
        propertyId,
        type: row.type || "acquisition",
        status: row.status || "negotiating",
        offerAmount: row.offerAmount || null,
        counterAmount: row.counterAmount || null,
        acceptedAmount: row.acceptedAmount || null,
        closingCosts: row.closingCosts || null,
        titleCompany: row.titleCompany || null,
        escrowNumber: row.escrowNumber || null,
        notes: row.notes || null,
        offerDate: dateCell("offerDate", row.offerDate),
        closingDate: dateCell("closingDate", row.closingDate),
      }, undefined, { source: "historical_import" });

      result.successCount++;
      if (options.durableEvents) await emitDealCreatedDurably(organizationId, createdDeal);
      else emitDealCreated(organizationId, createdDeal);
    } catch (error) {
      result.errorCount++;
      result.errors.push({
        row: i + 2,
        data: rawRow,
        error: importRowError(error),
      });
    }
  }

  return result;
}

export function escapeCSV(value: any): string {
  if (value === null || value === undefined) return "";
  const str = neutraliseCsvFormula(String(value));
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const num = Number(value);
  if (isNaN(num)) return "";
  return num.toFixed(2);
}

/**
 * Export columns that carry the system's own bookkeeping, not data a user
 * supplies — the importer deliberately does not read them. Anything else an
 * exporter emits must resolve through the import map
 * (tests/unit/exportHeadersAreImportable.test.ts), so the next header rename or
 * omission fails in CI instead of in production (G11 Defects 2 and 3).
 */
const EXPORT_ONLY_HEADERS: Record<"leads" | "properties" | "deals" | "notes", readonly string[]> = {
  leads: ["ID", "Score", "Last Contacted At", "Updated At"],
  properties: ["ID", "Created At", "Updated At"],
  deals: ["ID", "Created At", "Updated At"],
  // Notes: Property ID / Borrower ID are keys in the source organization, and the
  // export deliberately carries no borrower name or contact (that is lead data,
  // exported with the leads), so a re-import refuses each row naming the borrower;
  // Maturity Date and Next Payment Date are DERIVED by createNote from the start
  // date, the term and the first payment date; payment method and auto-pay are
  // not carried because automation needs the destination's own connected
  // account ("be the rail").
  notes: [
    "ID", "Property ID", "Borrower ID", "Maturity Date", "Next Payment Date", "Down Payment",
    "Down Payment Received", "Payment Method", "Auto Pay Enabled", "Created At", "Updated At",
  ],
};

const LEAD_EXPORT_HEADERS = [
  "ID",
  "Type",
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Address",
  "City",
  "State",
  "Zip",
  "County",
  "APN",
  "Acreage",
  "Assessed Value",
  "Estimated Value",
  "Tax Delinquent",
  "Tax Delinquent Amount",
  "Tax Delinquent Years",
  "Do Not Contact",
  "Status",
  "Source",
  "Notes",
  "Tags",
  "Score",
  "Last Contacted At",
  "Created At",
  "Updated At",
] as const;

export async function exportLeadsToCSV(
  organizationId: number,
  filters?: ExportFilters
): Promise<string> {
  let leads = await readAllLeads(organizationId);

  if (filters) {
    if (filters.status) {
      leads = leads.filter((l) => l.status === filters.status);
    }
    if (filters.type) {
      leads = leads.filter((l) => l.type === filters.type);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      leads = leads.filter((l) => l.createdAt && new Date(l.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      leads = leads.filter((l) => l.createdAt && new Date(l.createdAt) <= end);
    }
  }

  const headers = LEAD_EXPORT_HEADERS;

  const rows = leads.map((lead) =>
    [
      escapeCSV(lead.id),
      escapeCSV(lead.type),
      escapeCSV(lead.firstName),
      escapeCSV(lead.lastName),
      escapeCSV(lead.email),
      escapeCSV(lead.phone),
      escapeCSV(lead.address),
      escapeCSV(lead.city),
      escapeCSV(lead.state),
      escapeCSV(lead.zip),
      escapeCSV(lead.county),
      escapeCSV(lead.apn),
      escapeCSV(lead.acreage),
      escapeCSV(lead.assessedValue),
      escapeCSV(lead.estimatedValue),
      // Unknown stays blank: a blank cell re-imports as "unknown", never as "No".
      escapeCSV(lead.taxDelinquent === true ? "Yes" : lead.taxDelinquent === false ? "No" : ""),
      escapeCSV(lead.taxDelinquentAmount),
      escapeCSV(lead.taxDelinquentYears),
      // Only a set flag is written; blank re-imports as "not flagged".
      escapeCSV(leadHasOptedOut(lead) ? "Yes" : ""),
      escapeCSV(lead.status),
      escapeCSV(lead.source),
      escapeCSV(lead.notes),
      escapeCSV(lead.tags ? lead.tags.join("; ") : ""),
      escapeCSV(lead.score),
      escapeCSV(formatDate(lead.lastContactedAt)),
      escapeCSV(formatDate(lead.createdAt)),
      escapeCSV(formatDate(lead.updatedAt)),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

const PROPERTY_EXPORT_HEADERS = [
  "ID",
  "APN",
  "Legal Description",
  "County",
  "State",
  "Address",
  "City",
  "Zip",
  "Subdivision",
  "Lot Number",
  "Size (Acres)",
  "Zoning",
  "Terrain",
  "Road Access",
  "Status",
  "Assessed Value",
  "Market Value",
  "Purchase Price",
  "Purchase Date",
  "List Price",
  "Sold Price",
  "Sold Date",
  "Latitude",
  "Longitude",
  "Description",
  "Created At",
  "Updated At",
] as const;

export async function exportPropertiesToCSV(
  organizationId: number,
  filters?: ExportFilters
): Promise<string> {
  let properties = await readAllProperties(organizationId);

  if (filters) {
    if (filters.status) {
      properties = properties.filter((p) => p.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      properties = properties.filter((p) => p.createdAt && new Date(p.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      properties = properties.filter((p) => p.createdAt && new Date(p.createdAt) <= end);
    }
  }

  const headers = PROPERTY_EXPORT_HEADERS;

  const rows = properties.map((property) =>
    [
      escapeCSV(property.id),
      escapeCSV(property.apn),
      escapeCSV(property.legalDescription),
      escapeCSV(property.county),
      escapeCSV(property.state),
      escapeCSV(property.address),
      escapeCSV(property.city),
      escapeCSV(property.zip),
      escapeCSV(property.subdivision),
      escapeCSV(property.lotNumber),
      escapeCSV(property.sizeAcres),
      escapeCSV(property.zoning),
      escapeCSV(property.terrain),
      escapeCSV(property.roadAccess),
      escapeCSV(property.status),
      escapeCSV(formatCurrency(property.assessedValue)),
      escapeCSV(formatCurrency(property.marketValue)),
      escapeCSV(formatCurrency(property.purchasePrice)),
      escapeCSV(formatDate(property.purchaseDate)),
      escapeCSV(formatCurrency(property.listPrice)),
      escapeCSV(formatCurrency(property.soldPrice)),
      escapeCSV(formatDate(property.soldDate)),
      escapeCSV(property.latitude),
      escapeCSV(property.longitude),
      escapeCSV(property.description),
      escapeCSV(formatDate(property.createdAt)),
      escapeCSV(formatDate(property.updatedAt)),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

const DEAL_EXPORT_HEADERS = [
  "ID",
  "Property ID",
  "Type",
  "Status",
  "Offer Amount",
  "Offer Date",
  "Counter Amount",
  "Accepted Amount",
  "Closing Date",
  "Closing Costs",
  "Title Company",
  "Escrow Number",
  "Notes",
  "Created At",
  "Updated At",
] as const;

export async function exportDealsToCSV(
  organizationId: number,
  filters?: ExportFilters
): Promise<string> {
  let deals = await readAllDeals(organizationId);

  if (filters) {
    if (filters.status) {
      deals = deals.filter((d) => d.status === filters.status);
    }
    if (filters.type) {
      deals = deals.filter((d) => d.type === filters.type);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      deals = deals.filter((d) => d.createdAt && new Date(d.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      deals = deals.filter((d) => d.createdAt && new Date(d.createdAt) <= end);
    }
  }

  const headers = DEAL_EXPORT_HEADERS;

  const rows = deals.map((deal) =>
    [
      escapeCSV(deal.id),
      escapeCSV(deal.propertyId),
      escapeCSV(deal.type),
      escapeCSV(deal.status),
      escapeCSV(formatCurrency(deal.offerAmount)),
      escapeCSV(formatDate(deal.offerDate)),
      escapeCSV(formatCurrency(deal.counterAmount)),
      escapeCSV(formatCurrency(deal.acceptedAmount)),
      escapeCSV(formatDate(deal.closingDate)),
      escapeCSV(formatCurrency(deal.closingCosts)),
      escapeCSV(deal.titleCompany),
      escapeCSV(deal.escrowNumber),
      escapeCSV(deal.notes),
      escapeCSV(formatDate(deal.createdAt)),
      escapeCSV(formatDate(deal.updatedAt)),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

const NOTE_EXPORT_HEADERS = [
  "ID",
  "Property ID",
  "Borrower ID",
  "Original Principal",
  "Current Balance",
  "Interest Rate",
  "Term (Months)",
  "Monthly Payment",
  "Service Fee",
  "Late Fee",
  "Grace Period (Days)",
  "Start Date",
  "First Payment Date",
  "Next Payment Date",
  "Maturity Date",
  "Status",
  "Down Payment",
  "Down Payment Received",
  "Payment Method",
  "Auto Pay Enabled",
  "Notes",
  "Created At",
  "Updated At",
] as const;

export async function exportNotesToCSV(
  organizationId: number,
  filters?: ExportFilters
): Promise<string> {
  let notes = await readAllNotes(organizationId);

  if (filters) {
    if (filters.status) {
      notes = notes.filter((n) => n.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      notes = notes.filter((n) => n.createdAt && new Date(n.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      notes = notes.filter((n) => n.createdAt && new Date(n.createdAt) <= end);
    }
  }

  const headers = NOTE_EXPORT_HEADERS;

  const rows = notes.map((note) =>
    [
      escapeCSV(note.id),
      escapeCSV(note.propertyId),
      escapeCSV(note.borrowerId),
      escapeCSV(formatCurrency(note.originalPrincipal)),
      escapeCSV(formatCurrency(note.currentBalance)),
      escapeCSV(formatCurrency(note.interestRate)),
      escapeCSV(note.termMonths),
      escapeCSV(formatCurrency(note.monthlyPayment)),
      escapeCSV(formatCurrency(note.serviceFee)),
      escapeCSV(formatCurrency(note.lateFee)),
      escapeCSV(note.gracePeriodDays),
      escapeCSV(formatDate(note.startDate)),
      escapeCSV(formatDate(note.firstPaymentDate)),
      escapeCSV(formatDate(note.nextPaymentDate)),
      escapeCSV(formatDate(note.maturityDate)),
      escapeCSV(note.status),
      escapeCSV(formatCurrency(note.downPayment)),
      escapeCSV(note.downPaymentReceived ? "Yes" : "No"),
      escapeCSV(note.paymentMethod),
      escapeCSV(note.autoPayEnabled ? "Yes" : "No"),
      escapeCSV(note.notes),
      escapeCSV(formatDate(note.createdAt)),
      escapeCSV(formatDate(note.updatedAt)),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export async function getLeadsData(
  organizationId: number,
  filters?: ExportFilters
): Promise<any[]> {
  let leads = await readAllLeads(organizationId);

  if (filters) {
    if (filters.status) {
      leads = leads.filter((l) => l.status === filters.status);
    }
    if (filters.type) {
      leads = leads.filter((l) => l.type === filters.type);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      leads = leads.filter((l) => l.createdAt && new Date(l.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      leads = leads.filter((l) => l.createdAt && new Date(l.createdAt) <= end);
    }
  }

  return leads;
}

export async function getPropertiesData(
  organizationId: number,
  filters?: ExportFilters
): Promise<any[]> {
  let properties = await readAllProperties(organizationId);

  if (filters) {
    if (filters.status) {
      properties = properties.filter((p) => p.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      properties = properties.filter((p) => p.createdAt && new Date(p.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      properties = properties.filter((p) => p.createdAt && new Date(p.createdAt) <= end);
    }
  }

  return properties;
}

export async function getDealsData(
  organizationId: number,
  filters?: ExportFilters
): Promise<any[]> {
  let deals = await readAllDeals(organizationId);

  if (filters) {
    if (filters.status) {
      deals = deals.filter((d) => d.status === filters.status);
    }
    if (filters.type) {
      deals = deals.filter((d) => d.type === filters.type);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      deals = deals.filter((d) => d.createdAt && new Date(d.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      deals = deals.filter((d) => d.createdAt && new Date(d.createdAt) <= end);
    }
  }

  return deals;
}

export async function getNotesData(
  organizationId: number,
  filters?: ExportFilters
): Promise<any[]> {
  let notes = await readAllNotes(organizationId);

  if (filters) {
    if (filters.status) {
      notes = notes.filter((n) => n.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      notes = notes.filter((n) => n.createdAt && new Date(n.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      notes = notes.filter((n) => n.createdAt && new Date(n.createdAt) <= end);
    }
  }

  return notes;
}

export async function createBackupZip(organizationId: number): Promise<{
  files: Array<{ name: string; content: string }>;
  organization: any;
}> {
  const org = await storage.getOrganization(organizationId);
  
  const [leadsCSV, propertiesCSV, dealsCSV, notesCSV] = await Promise.all([
    exportLeadsToCSV(organizationId),
    exportPropertiesToCSV(organizationId),
    exportDealsToCSV(organizationId),
    exportNotesToCSV(organizationId),
  ]);

  const metadata = {
    organizationId,
    organizationName: org?.name,
    exportedAt: clock.now().toISOString(),
    version: "1.0",
    counts: {
      leads: leadsCSV.split("\n").length - 1,
      properties: propertiesCSV.split("\n").length - 1,
      deals: dealsCSV.split("\n").length - 1,
      notes: notesCSV.split("\n").length - 1,
    },
  };

  return {
    files: [
      { name: "leads.csv", content: leadsCSV },
      { name: "properties.csv", content: propertiesCSV },
      { name: "deals.csv", content: dealsCSV },
      { name: "notes.csv", content: notesCSV },
      { name: "metadata.json", content: JSON.stringify(metadata, null, 2) },
    ],
    organization: org,
  };
}

// ============================================================
// NOTES (seller-financed) IMPORT — standard CSV compatible
// ============================================================

// Maps common note servicing column headers AND generic variants to AcreOS note fields.
// A user-provided fieldMap (from the UI's field-mapping step) takes precedence.
export const NOTE_COLUMN_MAP: Record<string, string> = {
  // Common headers
  "Borrower First Name": "borrowerFirstName",
  "borrower first name": "borrowerFirstName",
  borrowerFirstName: "borrowerFirstName",
  borrower_first_name: "borrowerFirstName",
  firstName: "borrowerFirstName",
  first_name: "borrowerFirstName",
  "first name": "borrowerFirstName",

  "Borrower Last Name": "borrowerLastName",
  "borrower last name": "borrowerLastName",
  borrowerLastName: "borrowerLastName",
  borrower_last_name: "borrowerLastName",
  lastName: "borrowerLastName",
  last_name: "borrowerLastName",
  "last name": "borrowerLastName",

  "Borrower Email": "borrowerEmail",
  "borrower email": "borrowerEmail",
  borrowerEmail: "borrowerEmail",
  borrower_email: "borrowerEmail",
  email: "borrowerEmail",

  "Borrower Phone": "borrowerPhone",
  "borrower phone": "borrowerPhone",
  borrowerPhone: "borrowerPhone",
  phone: "borrowerPhone",

  "Note Amount": "originalPrincipal",
  "note amount": "originalPrincipal",
  "Original Principal": "originalPrincipal",
  "original principal": "originalPrincipal",
  originalPrincipal: "originalPrincipal",
  original_principal: "originalPrincipal",
  principal: "originalPrincipal",
  amount: "originalPrincipal",

  "Current Balance": "currentBalance",
  "current balance": "currentBalance",
  currentBalance: "currentBalance",
  current_balance: "currentBalance",
  balance: "currentBalance",

  "Interest Rate": "interestRate",
  "interest rate": "interestRate",
  interestRate: "interestRate",
  interest_rate: "interestRate",
  rate: "interestRate",

  "Term (Months)": "termMonths",
  "term (months)": "termMonths",
  "Term Months": "termMonths",
  "term months": "termMonths",
  termMonths: "termMonths",
  term_months: "termMonths",
  term: "termMonths",

  "Monthly Payment": "monthlyPayment",
  "monthly payment": "monthlyPayment",
  monthlyPayment: "monthlyPayment",
  monthly_payment: "monthlyPayment",
  payment: "monthlyPayment",

  "Payment Day": "paymentDayOfMonth",
  "payment day": "paymentDayOfMonth",
  paymentDayOfMonth: "paymentDayOfMonth",
  payment_day_of_month: "paymentDayOfMonth",

  "Service Fee": "serviceFee",
  "service fee": "serviceFee",
  serviceFee: "serviceFee",
  service_fee: "serviceFee",

  "Late Fee": "lateFeeAmount",
  "late fee": "lateFeeAmount",
  lateFeeAmount: "lateFeeAmount",
  late_fee: "lateFeeAmount",

  "Grace Period": "gracePeriodDays",
  "grace period": "gracePeriodDays",
  "Grace Period (Days)": "gracePeriodDays",
  "grace period (days)": "gracePeriodDays",
  gracePeriodDays: "gracePeriodDays",
  grace_period_days: "gracePeriodDays",

  // Originated notes: the two dates createNote cannot do without (G11 Defect 1).
  // The importer reads them and refuses a row that lacks them — it never makes
  // one up.
  "Start Date": "startDate",
  "start date": "startDate",
  startDate: "startDate",
  start_date: "startDate",
  "First Payment Date": "firstPaymentDate",
  "first payment date": "firstPaymentDate",
  firstPaymentDate: "firstPaymentDate",
  first_payment_date: "firstPaymentDate",

  Status: "status",
  status: "status",

  "Property Address": "propertyAddress",
  "property address": "propertyAddress",
  propertyAddress: "propertyAddress",
  property_address: "propertyAddress",
  address: "propertyAddress",

  Notes: "internalNotes",
  notes: "internalNotes",
  comment: "internalNotes",
  comments: "internalNotes",

  // Acquisition fields — populated when importing into acquired_notes
  // (i.e. notes the user *bought* from a prior holder, not originated).
  // The originated importer ignores these silently.
  "Acquisition Price": "acquisitionPrice",
  "acquisition price": "acquisitionPrice",
  acquisitionPrice: "acquisitionPrice",
  acquisition_price: "acquisitionPrice",
  "Purchase Price": "acquisitionPrice",
  "purchase price": "acquisitionPrice",
  "Cost Basis": "acquisitionPrice",
  "cost basis": "acquisitionPrice",

  "Acquisition Date": "acquisitionDate",
  "acquisition date": "acquisitionDate",
  acquisitionDate: "acquisitionDate",
  acquisition_date: "acquisitionDate",
  "Purchase Date": "acquisitionDate",
  "purchase date": "acquisitionDate",
  "Date Acquired": "acquisitionDate",
  "date acquired": "acquisitionDate",

  "Origination Date": "originationDate",
  "origination date": "originationDate",
  originationDate: "originationDate",
  origination_date: "originationDate",
  "Note Date": "originationDate",
  "note date": "originationDate",
  "Original Note Date": "originationDate",
  "original note date": "originationDate",

  "Maturity Date": "maturityDate",
  "maturity date": "maturityDate",
  maturityDate: "maturityDate",
  maturity_date: "maturityDate",

  "Original Lender": "originalLender",
  "original lender": "originalLender",
  originalLender: "originalLender",
  original_lender: "originalLender",
  "Prior Holder": "originalLender",
  "prior holder": "originalLender",
  Seller: "originalLender",
  seller: "originalLender",

  "Note Number": "noteNumber",
  "note number": "noteNumber",
  noteNumber: "noteNumber",
  note_number: "noteNumber",
  "Loan Number": "noteNumber",
  "loan number": "noteNumber",
  loan_number: "noteNumber",
};

// Note status mapping: normalize external status strings to AcreOS enum values
function normalizeNoteStatus(raw: string): string {
  const lower = (raw || "").toLowerCase().trim();
  if (lower === "active" || lower === "current") return "active";
  if (lower === "paid off" || lower === "paid_off" || lower === "closed") return "paid_off";
  if (lower === "default" || lower === "defaulted") return "defaulted";
  if (lower === "late") return "late";
  if (lower === "suspended" || lower === "paused") return "suspended";
  return "active"; // default
}

export interface NoteImportFieldMap {
  [csvColumn: string]: string; // csvColumn -> acreos field name
}

export async function importNotesFromCSV(
  csvData: Array<Record<string, string>>,
  organizationId: number,
  userFieldMap?: NoteImportFieldMap
): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: csvData.length,
    successCount: 0,
    errorCount: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  // Apply user's custom field map first, then fall back to the built-in NOTE_COLUMN_MAP
  // A null-prototype map, and no reserved key: `fieldMap` arrives from the request
  // body, and a column named __proto__ / constructor must never address
  // Object.prototype (CodeQL: remote property injection). The caller's entries are
  // filtered first and merged in one step; no property is written by a
  // caller-supplied name.
  const callerEntries = userFieldMap
    ? Object.entries(userFieldMap).filter(
        ([csvCol, acreosField]) => !!acreosField && typeof acreosField === "string" && !RESERVED_HEADER_NAMES.has(csvCol),
      )
    : [];
  const effectiveMap: Record<string, string> = Object.assign(Object.create(null), NOTE_COLUMN_MAP, Object.fromEntries(callerEntries));

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];
    const row = normalizeRow<Record<string, string>>(rawRow, effectiveMap);

    try {
      // ── Validate the whole row BEFORE anything is written ────────────────
      // Every refusal below names the column and the fix; none supplies a
      // value the file did not state.
      const firstName = row.borrowerFirstName?.trim();
      const lastName = row.borrowerLastName?.trim();
      const principalRaw = row.originalPrincipal?.replace(/[$,\s]/g, "");

      if (!firstName && !lastName) {
        throw new Error("Borrower name is required (first name or last name)");
      }
      if (!principalRaw || isNaN(parseFloat(principalRaw))) {
        throw new Error("Original principal amount is required and must be a number");
      }

      // The two dates createNote builds the schedule and maturity from. A note
      // with no start date has no schedule, and a made-up one would put a made-up
      // maturity on a real loan.
      const dateProblems: string[] = [];
      const startIso = row.startDate?.trim() ? parseDate(row.startDate) : null;
      if (!row.startDate?.trim()) {
        dateProblems.push("Start Date is required; add a Start Date column (or map one with fieldMap) holding the date the note starts, such as 2026-01-01");
      } else if (!startIso) {
        dateProblems.push(`Start Date "${row.startDate.trim()}" is not a date; use a date such as 2026-01-01 or 1/1/2026`);
      }
      const firstPaymentIso = row.firstPaymentDate?.trim() ? parseDate(row.firstPaymentDate) : null;
      if (!row.firstPaymentDate?.trim()) {
        dateProblems.push("First Payment Date is required; add a First Payment Date column (or map one with fieldMap) holding the date the first payment is due");
      } else if (!firstPaymentIso) {
        dateProblems.push(`First Payment Date "${row.firstPaymentDate.trim()}" is not a date; use a date such as 2026-02-01 or 2/1/2026`);
      }
      if (dateProblems.length > 0) throw new Error(dateProblems.join("; "));

      const originalPrincipal = parseFloat(principalRaw);
      const currentBalance = row.currentBalance
        ? parseFloat(row.currentBalance.replace(/[$,\s]/g, ""))
        : originalPrincipal;
      const interestRateStated = !!row.interestRate?.trim();
      const interestRate = interestRateStated
        ? parseFloat(row.interestRate.replace(/[%\s]/g, ""))
        : 0;
      const termStated = !!row.termMonths?.trim();
      const termMonths = termStated ? parseInt(row.termMonths, 10) : 120;
      if (!Number.isFinite(currentBalance) || !Number.isFinite(interestRate) || !Number.isFinite(termMonths) || termMonths <= 0) {
        throw new Error("Current Balance, Interest Rate and Term (Months) must be plain numbers; fix the cell or clear it");
      }

      // monthly_payment is NOT NULL. A stated payment is used as stated; when
      // it is blank it is CALCULATED from the stated rate and term (the same
      // amortization the schedule uses) — and refused when it cannot be.
      let monthlyPayment: number;
      if (row.monthlyPayment?.trim()) {
        monthlyPayment = parseFloat(row.monthlyPayment.replace(/[$,\s]/g, ""));
        if (!Number.isFinite(monthlyPayment)) throw new Error(`Monthly Payment "${row.monthlyPayment.trim()}" is not a number; use a dollar amount such as 922.70`);
      } else if (interestRateStated && termStated) {
        monthlyPayment = Math.round(calculateMonthlyPayment(originalPrincipal, interestRate, termMonths) * 100) / 100;
      } else {
        throw new Error("Monthly Payment is required; add a Monthly Payment column, or state both Interest Rate and Term (Months) so it can be calculated");
      }

      const paymentDayOfMonth = row.paymentDayOfMonth
        ? parseInt(row.paymentDayOfMonth, 10)
        : 1;
      const serviceFee = row.serviceFee
        ? parseFloat(row.serviceFee.replace(/[$,\s]/g, ""))
        : "0";
      const lateFeeAmount = row.lateFeeAmount
        ? parseFloat(row.lateFeeAmount.replace(/[$,\s]/g, ""))
        : "0";
      const gracePeriodDays = row.gracePeriodDays
        ? parseInt(row.gracePeriodDays, 10)
        : 10;

      // Create a borrower lead if none exists with this email/name combo
      let borrowerId: number | null = null;
      const borrowerEmail = row.borrowerEmail?.trim() || null;

      if (borrowerEmail) {
        // One indexed lookup across the WHOLE book (DEFECT-0170). This loaded
        // the newest 5000 leads per row and matched in memory, so a borrower
        // whose lead was older became a DUPLICATE lead.
        const [match] = await db
          .select({ id: leads.id })
          .from(leads)
          .where(
            and(
              eq(leads.organizationId, organizationId),
              sql`${leads.deletedAt} IS NULL`,
              sql`lower(${leads.email}) = ${borrowerEmail.toLowerCase()}`,
            ),
          )
          .limit(1);
        if (match) {
          borrowerId = match.id;
        }
      }

      // ── Write: the borrower lead and the note stand or fall together ─────
      // storage.createLead / createNote take no transaction, so atomicity is
      // validate-first (above) plus rollback here: if the note cannot be
      // created, the lead THIS ROW made is removed with its activity entry, and
      // lead.created fires only after the note exists. A failed row leaves no
      // orphan borrower (G11 Defect 1).
      let createdLead: Awaited<ReturnType<typeof storage.createLead>> | null = null;
      if (!borrowerId) {
        createdLead = await storage.createLead({
          organizationId,
          type: "buyer",
          firstName: firstName || "",
          lastName: lastName || "",
          email: borrowerEmail,
          phone: row.borrowerPhone?.trim() || null,
          status: "active",
          source: "import",
        });
        borrowerId = createdLead.id;
      }

      try {
        await storage.createNote({
          organizationId,
          borrowerId,
          originalPrincipal: String(originalPrincipal),
          currentBalance: String(currentBalance),
          interestRate: String(interestRate),
          termMonths,
          monthlyPayment: String(monthlyPayment),
          paymentDayOfMonth,
          startDate: new Date(`${startIso}T00:00:00.000Z`),
          firstPaymentDate: new Date(`${firstPaymentIso}T00:00:00.000Z`),
          serviceFee: String(serviceFee),
          lateFeeAmount: String(lateFeeAmount),
          gracePeriodDays,
          status: normalizeNoteStatus(row.status || ""),
          paymentMethod: "manual",
          autoPayEnabled: false,
          internalNotes: row.internalNotes || null,
          // Reg-Z §1026.43 hard gate (Workstream A). Imported notes were
          // originated before they entered AcreOS — flagged 'legacy' so the
          // ATR origination gate accepts them. Servicing surfaces flag
          // 'legacy' rows for retroactive review.
          atrExemptionCode: "legacy",
        } as any);
      } catch (noteError) {
        if (createdLead) {
          await db.delete(activityLog).where(and(eq(activityLog.organizationId, organizationId), eq(activityLog.entityType, "lead"), eq(activityLog.entityId, createdLead.id)));
          await db.delete(leads).where(and(eq(leads.organizationId, organizationId), eq(leads.id, createdLead.id)));
        }
        throw noteError;
      }

      // Wave B — note import creates a real borrower lead; that is a lead
      // creation like any other and must fire the trigger.
      if (createdLead) emitLeadCreated(organizationId, createdLead);

      result.successCount++;
    } catch (error) {
      result.errorCount++;
      result.errors.push({
        row: i + 2,
        data: rawRow,
        error: importRowError(error),
      });
    }
  }

  return result;
}

// ============================================================
// ACQUIRED NOTES IMPORT — for notes the user *bought* from a prior holder
// (the dominant case for note investors per the persona walkthrough —
//  Linnea: "75% of my book, I did not originate. I bought paper.").
//
// Targets the acquired_notes table directly (not the originated `notes`
// table). Captures acquisition price + date separately from original
// face value — required for correct basis/yield/tax computation.
// Sub-$600-interest 1099-INT logic and OID/MD accretion ride follow-up
// PRs; this handles the data-model entry only.
// ============================================================

function parseMoneyToCents(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * A calendar date, strictly: ISO (2026-10-30) or US (10/30/2026) and a day that
 * exists. "2026-02-30" is refused, not rolled to March, and a bare number or a
 * sentence is not a date.
 */
function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const t = String(raw).trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) [m, d, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * The import maps and the export headers side by side, as ONE object: what the
 * columns endpoint tells the import UI ("these are the headers our own export
 * writes — they re-import"), and what tests/unit/exportHeadersAreImportable.test.ts
 * resolves through the importer's own `resolveHeader` to keep the two from
 * drifting (G11 Defects 2 and 3).
 */
export const IMPORT_EXPORT_CONTRACT = {
  importMaps: { leads: LEAD_COLUMN_MAP, properties: PROPERTY_COLUMN_MAP, deals: DEAL_COLUMN_MAP, notes: NOTE_COLUMN_MAP },
  exportHeaders: { leads: LEAD_EXPORT_HEADERS, properties: PROPERTY_EXPORT_HEADERS, deals: DEAL_EXPORT_HEADERS, notes: NOTE_EXPORT_HEADERS },
  exportOnlyHeaders: EXPORT_ONLY_HEADERS,
  resolveHeader: resolveImportHeader,
} as const;

export function getExpectedColumns(entityType: "leads" | "properties" | "deals"): string[] {
  if (entityType === "leads") {
    return [
      "firstName",
      "lastName",
      "email",
      "phone",
      "address",
      "city",
      "state",
      "county",
      "zip",
      // The parcel identity a lead import dedupes on (DEFECT-0140) — listed
      // so the import UI tells users these columns exist.
      "apn",
      // Parcel facts (shared/leads/parcelFacts.ts). "Acres", "Assessed Value",
      // "Market Value", "Delinquent Amount" etc. are recognised too.
      "acreage",
      "assessedValue",
      "estimatedValue",
      "taxDelinquent",
      "taxDelinquentAmount",
      "taxDelinquentYears",
      "type",
      "status",
      "source",
      "notes",
    ];
  } else if (entityType === "properties") {
    return [
      "apn",
      "county",
      "state",
      "sizeAcres",
      "address",
      "city",
      "zip",
      "subdivision",
      "lotNumber",
      "zoning",
      "terrain",
      "roadAccess",
      "status",
      "assessedValue",
      "marketValue",
      "description",
      "latitude",
      "longitude",
    ];
  } else {
    return [
      "propertyId",
      "type",
      "status",
      "offerAmount",
      "counterAmount",
      "acceptedAmount",
      "closingCosts",
      "titleCompany",
      "escrowNumber",
      "notes",
    ];
  }
}
