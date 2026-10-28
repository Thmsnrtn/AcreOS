/**
 * The note record — V-Notes-1 N2. One org-scoped read for /notes/:id: the
 * note's terms, yield fields and document set with the provenance of every
 * value, and the collateral's data picture from AcreOS's public-record parcel
 * warehouse.
 *
 *   - NO NUMBER WITHOUT PROVENANCE. Each term carries the observation it came
 *     from (source, file row and cell, as-of, confidence). A value with no
 *     recorded observation — a note entered before the note-tape import —
 *     says so ("no source recorded"); it is never dressed in a source.
 *   - ABSENCE IS STATED, NEVER BLANK. Collateral that was searched and not
 *     found, a note with no parcel id to search by, a lien search nobody ran
 *     and a hazard lookup nobody ran each come back as their own state with a
 *     reason — distinct from each other and from "found".
 *   - Every observation of a field is returned (oldest first), so N4 can show
 *     a disagreement with every value preserved.
 *   - Org-private: a note outside the caller's organization is `null` (the
 *     route answers 404), and every observation read filters on the org.
 */

import { and, asc, eq } from "drizzle-orm";
import { acquiredNotes, noteFieldObservations, type NoteFieldObservation } from "@shared/schema";
import { CRITICAL_DOCUMENTS, NOTE_TAPE_FIELD, type DocumentState, type NoteTapeFieldKey } from "@shared/notes/noteTapeFields";

export interface ObservationView {
  value: unknown;
  kind: "value" | "searched_none";
  source: string;
  sourceRef: Record<string, unknown>;
  asOf: string | null;
  confidence: string;
  /** Why this observation can be relied on, in words. */
  basis: string;
  decayClass: string;
  observedAt: string;
}

export interface RecordedValue {
  field: string;
  label: string;
  /** The value on the book row (what the rest of AcreOS computes from). */
  value: unknown;
  /** The observation that states this value, or null when no source was recorded. */
  provenance: ObservationView | null;
  /** Every observation of this field, oldest first. */
  observations: ObservationView[];
}

export type Absence = { status: "not_on_record" | "never_searched"; reason: string };

export interface CollateralPicture {
  status: "matched" | "unmatched" | "not_searched";
  /** What the tape gave to search by (null when it gave no APN + state + county). */
  searchedFor: { state: string; county: string; apn: string } | null;
  reason: string;
  parcel: null | {
    parcelKey: string;
    apid: string | null;
    apidReason: string | null;
    source: { name: string; retrievedAt: string | null };
    value: { marketValueCents: number | null; assessedValueCents: number | null } | Absence;
    tax: { taxAmountCents: number | null; taxYear: number | null; delinquency: Absence };
    seniorLiens: Absence;
    hazards: Absence;
  };
}

export interface NoteRecord {
  noteId: string;
  terms: RecordedValue[];
  yieldFields: RecordedValue[];
  /** Investment-to-value: purchase price ÷ collateral market value, only when both are known. */
  investmentToValue: { ratio: number; basis: string } | Absence;
  documents: {
    entries: Array<{ field: NoteTapeFieldKey; label: string; critical: boolean; state: DocumentState | "not_recorded"; provenance: ObservationView | null }>;
    exceptionNote: string | null;
    complete: boolean;
    /** Why it is not complete, in words. */
    gaps: string[];
  };
  collateral: CollateralPicture;
}

const TERM_FIELDS: Array<[NoteTapeFieldKey, keyof typeof acquiredNotes.$inferSelect]> = [
  ["noteNumber", "noteNumber"],
  ["payerName", "payerName"],
  ["status", "status"],
  ["currentBalance", "currentBalanceCents"],
  ["originalPrincipal", "originalPrincipalCents"],
  ["interestRate", "interestRateBps"],
  ["termMonths", "termMonths"],
  ["paymentAmount", "paymentAmountCents"],
  ["paymentDueDay", "paymentDueDay"],
  ["originationDate", "originationDate"],
  ["maturityDate", "maturityDate"],
  ["acquisitionDate", "acquisitionDate"],
  ["acquisitionPrice", "acquisitionPriceCents"],
];
const YIELD_FIELDS: Array<[NoteTapeFieldKey, keyof typeof acquiredNotes.$inferSelect]> = [
  ["remainingTermMonths", "remainingTermMonths"],
  ["balloonAmount", "balloonAmountCents"],
  ["balloonDate", "balloonDate"],
  ["paidThroughDate", "paidThroughDate"],
  ["nextPaymentDate", "nextPaymentDate"],
];
const DOC_FIELDS: NoteTapeFieldKey[] = ["docNote", "docSecurityInstrument", "docAssignmentChain", "docAllonges", "docPaymentHistory"];

const view = (o: NoteFieldObservation): ObservationView => ({
  value: o.value,
  kind: o.kind,
  source: o.source,
  sourceRef: o.sourceRef,
  asOf: o.asOf,
  confidence: o.confidence,
  basis: o.confidenceBasis,
  decayClass: o.decayClass,
  observedAt: o.observedAt.toISOString(),
});

const cents = (v: string | number | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Math.round(Number(v) * 100));

/** The note's record for its own organization, or null (not found, or another org's). */
export async function buildNoteRecord(organizationId: number, noteId: string): Promise<NoteRecord | null> {
  const { db } = await import("../../db");
  const [note] = await db
    .select()
    .from(acquiredNotes)
    .where(and(eq(acquiredNotes.id, noteId), eq(acquiredNotes.organizationId, organizationId)))
    .limit(1);
  if (!note) return null;
  const obs = await db
    .select()
    .from(noteFieldObservations)
    .where(and(eq(noteFieldObservations.organizationId, organizationId), eq(noteFieldObservations.noteId, noteId)))
    .orderBy(asc(noteFieldObservations.observedAt));
  const byField = new Map<string, NoteFieldObservation[]>();
  for (const o of obs) byField.set(o.field, [...(byField.get(o.field) ?? []), o]);

  const recorded = ([field, col]: [NoteTapeFieldKey, keyof typeof note]): RecordedValue => {
    const all = byField.get(field) ?? [];
    const value = note[col] ?? null;
    // The observation that states the book value: the earliest one equal to it.
    // Money columns are bigint in number mode and dates are ISO strings on both
    // sides, so the comparison is direct.
    const match = all.find((o) => o.kind === "value" && JSON.stringify(o.value) === JSON.stringify(value));
    return { field, label: NOTE_TAPE_FIELD[field].label, value, provenance: match ? view(match) : null, observations: all.map(view) };
  };
  const terms = TERM_FIELDS.map(recorded);
  const yieldFields = YIELD_FIELDS.map(recorded);

  // Documents: the latest recorded state per document.
  const latest = (f: string) => (byField.get(f) ?? []).filter((o) => o.kind === "value").at(-1) ?? null;
  const entries = DOC_FIELDS.map((f) => {
    const o = latest(f);
    return { field: f, label: NOTE_TAPE_FIELD[f].label, critical: CRITICAL_DOCUMENTS.includes(f), state: (o?.value as DocumentState | undefined) ?? ("not_recorded" as const), provenance: o ? view(o) : null };
  });
  const exception = latest("docExceptionNote");
  const gaps = entries
    .filter((e) => e.critical && e.state !== "present")
    .map((e) => (e.state === "not_recorded" ? `${e.label}: no document record` : e.state === "missing" ? `${e.label}: missing` : `${e.label}: exception`));

  const collateral = await collateralPicture(byField.get("collateral.parcel") ?? []);
  const market = collateral.parcel && "marketValueCents" in collateral.parcel.value ? collateral.parcel.value.marketValueCents : null;
  const investmentToValue: NoteRecord["investmentToValue"] =
    market && market > 0
      ? { ratio: note.acquisitionPriceCents / market, basis: `purchase price ÷ the collateral's market value on record (${collateral.parcel!.source.name})` }
      : { status: "not_on_record", reason: collateral.status === "matched" ? "the matched parcel carries no market value" : "no collateral value is on record for this note" };

  return {
    noteId,
    terms,
    yieldFields,
    investmentToValue,
    documents: { entries, exceptionNote: (exception?.value as string | undefined) ?? null, complete: gaps.length === 0, gaps },
    collateral,
  };
}

async function collateralPicture(rows: NoteFieldObservation[]): Promise<CollateralPicture> {
  const last = rows.at(-1);
  if (!last) return { status: "not_searched", searchedFor: null, reason: "the tape gave no parcel id, state and county to search by", parcel: null };
  const searchedFor = ((last.sourceRef as { searchedFor?: CollateralPicture["searchedFor"] }).searchedFor ?? null) as CollateralPicture["searchedFor"];
  if (last.kind === "searched_none") {
    return { status: "unmatched", searchedFor, reason: String((last.sourceRef as { reason?: string }).reason ?? "no matching parcel"), parcel: null };
  }
  const v = last.value as { parcelKey: string; apid: string | null; apidReason: string | null };
  const { findOwnedParcelByKey } = await import("../landData/ownedParcelView");
  const row = await findOwnedParcelByKey(v.parcelKey);
  if (!row) return { status: "unmatched", searchedFor, reason: "the parcel matched at import is no longer held", parcel: null };
  const raw = (row.rawData ?? {}) as Record<string, unknown>;
  const market = cents(row.marketValue);
  const assessed = cents(row.assessedValue);
  return {
    status: "matched",
    searchedFor,
    reason: "matched an AcreOS-held public-record parcel by county parcel id",
    parcel: {
      parcelKey: v.parcelKey,
      apid: v.apid,
      apidReason: v.apidReason,
      source: { name: typeof raw.sourceName === "string" ? raw.sourceName : "public record", retrievedAt: row.fetchedAt ? row.fetchedAt.toISOString() : null },
      value: market === null && assessed === null ? { status: "not_on_record", reason: "the parcel record carries no market or assessed value" } : { marketValueCents: market, assessedValueCents: assessed },
      tax: {
        taxAmountCents: cents(row.taxAmount),
        taxYear: row.taxYear ?? null,
        delinquency: { status: "never_searched", reason: "AcreOS holds no tax-payment status for this parcel; delinquency has not been checked" },
      },
      seniorLiens: { status: "never_searched", reason: "no lien search has been performed; AcreOS holds no recorded-lien data for this parcel" },
      hazards: { status: "never_searched", reason: "no hazard lookup (flood, wildfire) has been run for this parcel" },
    },
  };
}
