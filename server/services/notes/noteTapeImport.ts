/**
 * Note-tape import — mapping + per-row validation (V-Notes-1 N1).
 *
 * The rules (shared with the tax-sale lot importer this copies, taxSaleCsvImport.ts):
 *   1. REFUSAL BEFORE BUILD. A required field left unmapped refuses the whole
 *      file with a field-level report; nothing is validated, nothing written.
 *   2. NO SILENT DROPS. Every data row lands in exactly one of `valid` or
 *      `rejected` (assertNoRowLost proves it).
 *   3. REFUSE, NEVER COERCE. A blank or unparseable required cell is a row
 *      error naming the field, the cell and the fix — never a 0, a 360 or a
 *      derived date. An optional field the tape does not state is null.
 *   4. TARGETED FIXES. `overrides` replaces single cells of single rows, so an
 *      investor fixes row 14's rate without re-running the file; a corrected
 *      cell is marked as the operator's, not the tape's, for provenance.
 *
 * Pure module — no DB, no Express.
 */

import { createHash } from "node:crypto";
import { parseDelimited, parseMoneyToCents, type ParsedSheet } from "../taxSaleCsvImport";
import {
  CRITICAL_DOCUMENTS,
  NOTE_STATUSES,
  NOTE_TAPE_FIELD,
  NOTE_TAPE_FIELDS,
  REQUIRED_NOTE_TAPE_FIELDS,
  type DocumentState,
  type NoteStatus,
  type NoteTapeFieldKey,
} from "@shared/notes/noteTapeFields";

export type NoteTapeMapping = Partial<Record<NoteTapeFieldKey, number | null>>;
/** fileRow → field → replacement raw text (the operator's correction). */
export type NoteTapeOverrides = Record<number, Partial<Record<NoteTapeFieldKey, string>>>;

export interface NoteFieldError {
  field: NoteTapeFieldKey | "row";
  column: string | null;
  value: string;
  message: string;
  /** What to put in the cell instead. */
  fix: string;
}

export interface NoteRowRejection {
  /** 1-based row in the FILE (header is row 1). */
  fileRow: number;
  raw: string[];
  errors: NoteFieldError[];
}

/** Where one prepared value came from: the tape's cell, or the operator's correction of it. */
export interface CellSource {
  column: string | null;
  raw: string;
  origin: "tape" | "operator_correction";
}

export type TypedValue = string | number | null;

export interface PreparedNote {
  fileRow: number;
  noteNumber: string;
  payerName: string;
  originalPrincipalCents: number;
  currentBalanceCents: number;
  interestRateBps: number;
  termMonths: number;
  paymentAmountCents: number;
  paymentDueDay: number;
  originationDate: string;
  maturityDate: string;
  acquisitionDate: string;
  acquisitionPriceCents: number;
  status: NoteStatus;
  remainingTermMonths: number | null;
  balloonAmountCents: number | null;
  balloonDate: string | null;
  paidThroughDate: string | null;
  nextPaymentDate: string | null;
  collateral: { apn: string | null; state: string | null; county: string | null; address: string | null };
  /** Only the documents the tape records; an unmapped optional document is absent (unknown), never "missing". */
  documents: Partial<Record<NoteTapeFieldKey, DocumentState>>;
  documentExceptionNote: string | null;
  /** True when a critical document is missing or carries an exception. */
  documentsIncomplete: boolean;
  /** Every field this row stated, its typed value and where it came from. */
  stated: Partial<Record<NoteTapeFieldKey, { value: TypedValue; source: CellSource }>>;
}

export interface NoteTapeValidation {
  /** Non-empty → the file was refused before any row was looked at. */
  unmappedRequired: Array<{ field: NoteTapeFieldKey; label: string; fix: string }>;
  valid: PreparedNote[];
  rejected: NoteRowRejection[];
  summary: { totalRows: number; validCount: number; rejectedCount: number; documentsIncomplete: number };
}

// ── Mapping ──────────────────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

/** Suggest a mapping from the header row. A suggestion, confirmed by the operator — never applied as fact. */
export function suggestNoteTapeMapping(headers: readonly string[]): { mapping: NoteTapeMapping; unmatchedHeaders: string[] } {
  const mapping: NoteTapeMapping = {};
  const used = new Set<number>();
  for (const f of NOTE_TAPE_FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && (norm(h) === norm(f.label) || f.aliases.includes(norm(h))));
    if (idx >= 0) {
      mapping[f.key] = idx;
      used.add(idx);
    }
  }
  return { mapping, unmatchedHeaders: headers.filter((_, i) => !used.has(i)) };
}

// ── Cell parsers (strict) ────────────────────────────────────────────────

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function parseRate(raw: string): Parsed<number> {
  const t = raw.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, message: `"${raw}" is not a percentage` };
  const pct = Number(t);
  if (!(pct > 0 && pct <= 36)) return { ok: false, message: `${pct}% is outside 0–36% — check whether the tape states the rate as a fraction` };
  return { ok: true, value: Math.round(pct * 100) };
}

function parsePositiveInt(raw: string, min: number, max: number): Parsed<number> {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return { ok: false, message: `"${raw}" is not a whole number` };
  const n = Number(t);
  if (n < min || n > max) return { ok: false, message: `${n} is outside ${min}–${max}` };
  return { ok: true, value: n };
}

export function parseTapeDate(raw: string): Parsed<string> {
  const t = raw.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) [m, d, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return { ok: false, message: `"${raw}" is not a date` };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { ok: false, message: `"${raw}" is not a real calendar date` };
  return { ok: true, value: dt.toISOString().slice(0, 10) };
}

const STATUS_SPELLINGS: Record<string, NoteStatus> = {
  performing: "performing",
  current: "performing",
  late: "late",
  delinquent: "late",
  default: "default",
  defaulted: "default",
  "non performing": "default",
  npl: "default",
  "paid off": "paid_off",
  paidoff: "paid_off",
  "paid_off": "paid_off",
  sold: "sold",
};
function parseStatus(raw: string): Parsed<NoteStatus> {
  const s = STATUS_SPELLINGS[norm(raw)] ?? STATUS_SPELLINGS[raw.trim().toLowerCase()];
  return s ? { ok: true, value: s } : { ok: false, message: `"${raw}" is not a status this importer recognises (${NOTE_STATUSES.join(", ")})` };
}

const DOC_SPELLINGS: Record<string, DocumentState> = {
  present: "present", yes: "present", y: "present", "in file": "present", received: "present", ok: "present",
  missing: "missing", no: "missing", n: "missing", none: "missing", "not in file": "missing",
  exception: "exception", exc: "exception", defect: "exception", defective: "exception",
};
function parseDocument(raw: string): Parsed<DocumentState> {
  const s = DOC_SPELLINGS[norm(raw)];
  return s ? { ok: true, value: s } : { ok: false, message: `"${raw}" is not present, missing or exception` };
}

function parseState(raw: string): Parsed<string> {
  const t = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? { ok: true, value: t } : { ok: false, message: `"${raw}" is not a two-letter state code` };
}

function parseMoney(raw: string): Parsed<number> {
  const r = parseMoneyToCents(raw);
  if ("error" in r) return { ok: false, message: r.error };
  if (Number.isNaN(r.cents)) return { ok: false, message: "blank" };
  if (r.cents < 0) return { ok: false, message: `a negative amount (${raw}) is not a balance or price` };
  return { ok: true, value: r.cents };
}

function parseCell(key: NoteTapeFieldKey, raw: string): Parsed<TypedValue> {
  const def = NOTE_TAPE_FIELD[key];
  switch (def.kind) {
    case "money": return parseMoney(raw);
    case "rate": return parseRate(raw);
    case "int": return parsePositiveInt(raw, 1, 600);
    case "day": return parsePositiveInt(raw, 1, 31);
    case "date": return parseTapeDate(raw);
    case "status": return parseStatus(raw);
    case "state": return parseState(raw);
    case "document": return parseDocument(raw);
    case "text": return raw.trim() ? { ok: true, value: raw.trim() } : { ok: false, message: "blank" };
  }
}

// ── Validation ───────────────────────────────────────────────────────────

export function validateNoteTape(opts: { sheet: ParsedSheet; mapping: NoteTapeMapping; overrides?: NoteTapeOverrides }): NoteTapeValidation {
  const { sheet, mapping } = opts;
  const overrides = opts.overrides ?? {};
  const isMapped = (k: NoteTapeFieldKey) => typeof mapping[k] === "number" && (mapping[k] as number) >= 0 && (mapping[k] as number) < sheet.headers.length;
  const unmappedRequired = REQUIRED_NOTE_TAPE_FIELDS.filter((k) => !isMapped(k)).map((k) => ({ field: k, label: NOTE_TAPE_FIELD[k].label, fix: `map a column to "${NOTE_TAPE_FIELD[k].label}"` }));
  const summary = { totalRows: sheet.rows.length, validCount: 0, rejectedCount: 0, documentsIncomplete: 0 };
  if (unmappedRequired.length > 0) return { unmappedRequired, valid: [], rejected: [], summary };

  const valid: PreparedNote[] = [];
  const rejected: NoteRowRejection[] = [];
  const firstRowForNumber = new Map<string, number>();

  sheet.rows.forEach((cells, i) => {
    const fileRow = i + 2;
    const errors: NoteFieldError[] = [];
    const stated: PreparedNote["stated"] = {};
    const rowOverrides = overrides[fileRow] ?? {};
    for (const def of NOTE_TAPE_FIELDS) {
      const corrected = rowOverrides[def.key];
      if (!isMapped(def.key) && corrected === undefined) continue;
      const column = isMapped(def.key) ? sheet.headers[mapping[def.key] as number] : null;
      const raw = corrected ?? cells[mapping[def.key] as number] ?? "";
      const source: CellSource = { column, raw, origin: corrected !== undefined ? "operator_correction" : "tape" };
      if (raw.trim() === "") {
        if (def.required) errors.push({ field: def.key, column, value: raw, message: `${def.label} is blank — it is required and is never filled in for you`, fix: def.fix });
        continue;
      }
      const p = parseCell(def.key, raw);
      if (!p.ok) errors.push({ field: def.key, column, value: raw, message: `${def.label}: ${p.message}`, fix: def.fix });
      else stated[def.key] = { value: p.value, source };
    }
    const v = <T extends TypedValue>(k: NoteTapeFieldKey) => (stated[k]?.value ?? null) as T | null;

    // Cross-field checks — each names both fields.
    const orig = v<string>("originationDate");
    const mat = v<string>("maturityDate");
    if (orig && mat && mat <= orig) errors.push({ field: "maturityDate", column: null, value: mat, message: `Maturity ${mat} is not after origination ${orig}`, fix: "check the maturity and origination dates against the note" });
    const docs: PreparedNote["documents"] = {};
    for (const k of ["docNote", "docSecurityInstrument", "docAssignmentChain", "docAllonges", "docPaymentHistory"] as const) {
      const s = v<DocumentState>(k);
      if (s) docs[k] = s;
    }
    const exceptionNote = v<string>("docExceptionNote");
    const exceptions = Object.entries(docs).filter(([, s]) => s === "exception").map(([k]) => k as NoteTapeFieldKey);
    if (exceptions.length > 0 && !exceptionNote) {
      for (const k of exceptions) errors.push({ field: k, column: null, value: "exception", message: `${NOTE_TAPE_FIELD[k].label} is marked exception, but the exception is not recorded`, fix: `map "${NOTE_TAPE_FIELD.docExceptionNote.label}" and say what the exception is — an exception is recorded, never assumed` });
    }
    const num = v<string>("noteNumber");
    if (num) {
      const first = firstRowForNumber.get(num);
      if (first !== undefined) errors.push({ field: "noteNumber", column: null, value: num, message: `Loan number ${num} is also on row ${first}`, fix: "each note appears once per tape; remove or renumber the duplicate" });
      else firstRowForNumber.set(num, fileRow);
    }

    if (errors.length > 0) {
      rejected.push({ fileRow, raw: cells, errors });
      return;
    }
    const documentsIncomplete = CRITICAL_DOCUMENTS.some((k) => docs[k] !== "present");
    if (documentsIncomplete) summary.documentsIncomplete += 1;
    valid.push({
      fileRow,
      noteNumber: num as string,
      payerName: v<string>("payerName") as string,
      originalPrincipalCents: v<number>("originalPrincipal") as number,
      currentBalanceCents: v<number>("currentBalance") as number,
      interestRateBps: v<number>("interestRate") as number,
      termMonths: v<number>("termMonths") as number,
      paymentAmountCents: v<number>("paymentAmount") as number,
      paymentDueDay: v<number>("paymentDueDay") as number,
      originationDate: orig as string,
      maturityDate: mat as string,
      acquisitionDate: v<string>("acquisitionDate") as string,
      acquisitionPriceCents: v<number>("acquisitionPrice") as number,
      status: v<NoteStatus>("status") as NoteStatus,
      remainingTermMonths: v<number>("remainingTermMonths"),
      balloonAmountCents: v<number>("balloonAmount"),
      balloonDate: v<string>("balloonDate"),
      paidThroughDate: v<string>("paidThroughDate"),
      nextPaymentDate: v<string>("nextPaymentDate"),
      collateral: { apn: v<string>("collateralApn"), state: v<string>("collateralState"), county: v<string>("collateralCounty"), address: v<string>("collateralAddress") },
      documents: docs,
      documentExceptionNote: exceptionNote,
      documentsIncomplete,
      stated,
    });
  });
  summary.validCount = valid.length;
  summary.rejectedCount = rejected.length;
  return { unmappedRequired, valid, rejected, summary };
}

/** Every data row is accounted for exactly once — the import cannot report fewer rows than it read. */
export function assertNoRowLost(v: NoteTapeValidation): void {
  if (v.unmappedRequired.length > 0) return;
  const seen = new Set([...v.valid.map((x) => x.fileRow), ...v.rejected.map((x) => x.fileRow)]);
  if (seen.size !== v.summary.totalRows || v.valid.length + v.rejected.length !== v.summary.totalRows) {
    throw new Error(`note tape: ${v.summary.totalRows} rows read but ${v.valid.length} valid + ${v.rejected.length} rejected`);
  }
}

/** Parse the uploaded text into a sheet, with the tape's own sha256 for provenance. */
export function readNoteTape(text: string): { sheet: ParsedSheet; sha256: string } {
  return { sheet: parseDelimited(text), sha256: createHash("sha256").update(text).digest("hex") };
}
