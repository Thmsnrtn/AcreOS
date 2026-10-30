/**
 * Acquired-notes file export — G11 Defect 4.
 *
 * The legacy GET /api/export/notes reads the originated `notes` table only, so
 * the book a note investor imports through the note tape (acquired_notes) had
 * no file export at all. This is that export, built so the tape importer takes
 * it back: every header is the label of a note-tape field (the importer's own
 * `suggestNoteTapeMapping` matches on label), and every value is written in a
 * form the tape's strict cell parsers read — money as dollars, the rate as a
 * percentage, dates as ISO, statuses and document states as the tape words.
 *
 * RE-IMPORT PATH: POST /api/note-tape/preview with the exported file (the
 * mapping is suggested from the headers), then /api/note-tape/commit. A note
 * whose number already exists in the organization is appended to, not
 * duplicated.
 *
 * REFUSE, NEVER FABRICATE. The columns come from the acquired_notes row; the
 * document set and the collateral reference come from the latest value the
 * note's provenance ledger holds. A field no source ever stated is a blank
 * cell — never "missing", never 0 — so a note that did not arrive through the
 * tape (and so has no document observations) re-imports as a row the tape
 * importer refuses for its required document columns, with the field named.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { acquiredNotes, noteFieldObservations } from "@shared/schema";
import { NOTE_TAPE_FIELD, type NoteTapeFieldKey } from "@shared/notes/noteTapeFields";
import { escapeCSV } from "../importExport";

/** The tape fields the export writes, in the order the tape lists them. */
const ACQUIRED_NOTE_EXPORT_FIELDS: readonly NoteTapeFieldKey[] = [
  "noteNumber",
  "payerName",
  "originalPrincipal",
  "currentBalance",
  "interestRate",
  "termMonths",
  "paymentAmount",
  "paymentDueDay",
  "originationDate",
  "maturityDate",
  "acquisitionDate",
  "acquisitionPrice",
  "status",
  "remainingTermMonths",
  "balloonAmount",
  "balloonDate",
  "paidThroughDate",
  "nextPaymentDate",
  "rateAdjustmentDate",
  "collateralApn",
  "collateralState",
  "collateralCounty",
  "collateralAddress",
  "docNote",
  "docSecurityInstrument",
  "docAssignmentChain",
  "docAllonges",
  "docPaymentHistory",
  "docExceptionNote",
];

const ACQUIRED_NOTE_EXPORT_HEADERS: readonly string[] = ACQUIRED_NOTE_EXPORT_FIELDS.map((k) => NOTE_TAPE_FIELD[k].label);

/** Fields with no acquired_notes column: read from the latest provenance value. */
const OBSERVED_FIELDS: readonly NoteTapeFieldKey[] = [
  "rateAdjustmentDate",
  "collateralApn",
  "collateralState",
  "collateralCounty",
  "collateralAddress",
  "docNote",
  "docSecurityInstrument",
  "docAssignmentChain",
  "docAllonges",
  "docPaymentHistory",
  "docExceptionNote",
];

const dollars = (cents: number | null | undefined): string | null => {
  if (cents === null || cents === undefined) return null;
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};
const percent = (bps: number | null | undefined): string | null => (bps === null || bps === undefined ? null : (bps / 100).toFixed(2));

export type AcquiredNoteExportRow = Partial<Record<NoteTapeFieldKey, string | number | null>> & { id: string };

export async function readAcquiredNotesForExport(organizationId: number): Promise<AcquiredNoteExportRow[]> {
  const notes = await db
    .select()
    .from(acquiredNotes)
    .where(eq(acquiredNotes.organizationId, organizationId))
    .orderBy(asc(acquiredNotes.noteNumber), asc(acquiredNotes.createdAt));
  if (notes.length === 0) return [];

  const latest = new Map<string, unknown>();
  const observations = await db
    .select({ noteId: noteFieldObservations.noteId, field: noteFieldObservations.field, value: noteFieldObservations.value })
    .from(noteFieldObservations)
    .where(
      and(
        eq(noteFieldObservations.organizationId, organizationId),
        eq(noteFieldObservations.kind, "value"),
        inArray(noteFieldObservations.field, [...OBSERVED_FIELDS]),
      ),
    )
    .orderBy(desc(noteFieldObservations.observedAt));
  for (const o of observations) {
    const key = `${o.noteId}:${o.field}`;
    if (!latest.has(key)) latest.set(key, o.value);
  }
  const observed = (noteId: string, field: NoteTapeFieldKey): string | null => {
    const v = latest.get(`${noteId}:${field}`);
    return typeof v === "string" ? v : null;
  };

  return notes.map((n) => ({
    id: n.id,
    noteNumber: n.noteNumber,
    payerName: n.payerName ?? null,
    originalPrincipal: dollars(n.originalPrincipalCents),
    currentBalance: dollars(n.currentBalanceCents),
    interestRate: percent(n.interestRateBps),
    termMonths: n.termMonths,
    paymentAmount: dollars(n.paymentAmountCents),
    paymentDueDay: n.paymentDueDay,
    originationDate: n.originationDate,
    maturityDate: n.maturityDate,
    acquisitionDate: n.acquisitionDate,
    acquisitionPrice: dollars(n.acquisitionPriceCents),
    status: n.status,
    remainingTermMonths: n.remainingTermMonths ?? null,
    balloonAmount: dollars(n.balloonAmountCents),
    balloonDate: n.balloonDate ?? null,
    paidThroughDate: n.paidThroughDate ?? null,
    nextPaymentDate: n.nextPaymentDate ?? null,
    rateAdjustmentDate: observed(n.id, "rateAdjustmentDate"),
    collateralApn: observed(n.id, "collateralApn"),
    collateralState: observed(n.id, "collateralState"),
    collateralCounty: observed(n.id, "collateralCounty"),
    collateralAddress: observed(n.id, "collateralAddress"),
    docNote: observed(n.id, "docNote"),
    docSecurityInstrument: observed(n.id, "docSecurityInstrument"),
    docAssignmentChain: observed(n.id, "docAssignmentChain"),
    docAllonges: observed(n.id, "docAllonges"),
    docPaymentHistory: observed(n.id, "docPaymentHistory"),
    docExceptionNote: observed(n.id, "docExceptionNote"),
  }));
}

function acquiredNotesToCSV(rows: readonly AcquiredNoteExportRow[]): string {
  const lines = rows.map((r) => ACQUIRED_NOTE_EXPORT_FIELDS.map((k) => escapeCSV(r[k])).join(","));
  return [ACQUIRED_NOTE_EXPORT_HEADERS.map((h) => escapeCSV(h)).join(","), ...lines].join("\n");
}

export async function exportAcquiredNotesToCSV(organizationId: number): Promise<string> {
  return acquiredNotesToCSV(await readAcquiredNotesForExport(organizationId));
}

/** The acquired-notes file's column set — the note-tape field labels, in file order. */
export const ACQUIRED_NOTES_EXPORT = {
  fields: ACQUIRED_NOTE_EXPORT_FIELDS,
  headers: ACQUIRED_NOTE_EXPORT_HEADERS,
} as const;
