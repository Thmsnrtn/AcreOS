/**
 * Note-tape commit — V-Notes-1 N1. Writes a validated tape: one acquired_notes
 * row per NEW loan number, and one note_field_observations row per stated
 * field (with its provenance) — in ONE transaction.
 *
 *   - Refuses unless every row is valid or EXPLICITLY excluded: no partial
 *     import the operator did not choose, and every excluded row is reported.
 *   - A loan number the org already holds is NEVER updated. Its stated values
 *     are appended as new observations beside the earlier ones, and the fields
 *     whose value differs are reported — N4 surfaces the disagreement; nothing
 *     here resolves, averages or overwrites it.
 *   - Collateral is resolved to an AcreOS-held public-record parcel (and an
 *     APID where the county has a FIPS reference and an applied release).
 *     A searched-but-unmatched reference is recorded as a verified absence
 *     (kind 'searched_none'), never linked; a note with no usable reference
 *     records nothing (never searched = unknown). properties is never touched.
 *   - Org-private: every read and write carries the organization id.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { acquiredNotes, noteFieldObservations, type InsertNoteFieldObservation } from "@shared/schema";
import { NOTE_TAPE_FIELD, TAPE_CONFIDENCE, TAPE_CONFIDENCE_BASIS, type NoteTapeFieldKey } from "@shared/notes/noteTapeFields";
import type { NoteTapeValidation, PreparedNote } from "./noteTapeImport";

export interface CollateralResolution {
  searchedFor: { state: string; county: string; apn: string };
  parcelKey: string | null;
  apid: string | null;
  /** Why there is no parcel or no APID, in plain words. */
  reason: string | null;
}

/** null = not searchable (the tape gave no APN + state + county): unknown, never "not found". */
async function resolveCollateral(c: PreparedNote["collateral"]): Promise<CollateralResolution | null> {
  if (!c.apn || !c.state || !c.county) return null;
  const searchedFor = { state: c.state, county: c.county, apn: c.apn };
  const { findOwnedParcelRow } = await import("../landData/ownedParcelView");
  const row = await findOwnedParcelRow(c.state, c.county, c.apn);
  if (!row) return { searchedFor, parcelKey: null, apid: null, reason: "no AcreOS-held public-record parcel has this county parcel id" };
  const { countyFipsFor } = await import("../landData/releases/releaseLineage");
  const fips = countyFipsFor(c.state, c.county);
  if (!fips) return { searchedFor, parcelKey: row.parcelKey ?? null, apid: null, reason: `no county FIPS reference for ${c.state}, so no APID can be resolved` };
  const { db } = await import("../../db");
  const { loadCountyLedger } = await import("../landData/apidStore");
  const { apidForApnAt } = await import("@shared/landData/apid");
  const ledger = await loadCountyLedger(db, c.state, fips);
  if (!ledger.lastRelease) return { searchedFor, parcelKey: row.parcelKey ?? null, apid: null, reason: "no parcel release has been applied for this county yet" };
  const apid = apidForApnAt(ledger, c.apn, ledger.lastRelease.ordinal);
  return { searchedFor, parcelKey: row.parcelKey ?? null, apid, reason: apid ? null : "the parcel id has no APID in the county's current release" };
}

export interface CommitNoteTapeArgs {
  organizationId: number;
  actorUserId: string;
  fileName: string;
  fileSha256: string;
  /** The tape's own "as of" date, when the operator states it. */
  asOf: string | null;
  validation: NoteTapeValidation;
  /** Rows the operator chose to leave out. Every rejected row must be fixed or listed here. */
  excludeRows: number[];
}

export type CommitNoteTapeResult =
  | { status: "refused"; reason: string; unmappedRequired?: NoteTapeValidation["unmappedRequired"]; unresolvedRows?: number[] }
  | {
      status: "committed";
      importId: string;
      created: number;
      appendedToExisting: number;
      excludedRows: number[];
      notes: Array<{ fileRow: number; noteId: string; noteNumber: string; created: boolean; collateral: "matched" | "unmatched" | "not_searched"; documentsIncomplete: boolean; differingFields: string[] }>;
    };

export async function commitNoteTape(a: CommitNoteTapeArgs): Promise<CommitNoteTapeResult> {
  const v = a.validation;
  if (v.unmappedRequired.length > 0) return { status: "refused", reason: "Map every required column before importing.", unmappedRequired: v.unmappedRequired };
  const excluded = new Set(a.excludeRows);
  const unresolved = v.rejected.map((r) => r.fileRow).filter((r) => !excluded.has(r));
  if (unresolved.length > 0) return { status: "refused", reason: "Fix or exclude every row with an error before importing — nothing is imported partially.", unresolvedRows: unresolved };
  const notes = v.valid.filter((n) => !excluded.has(n.fileRow));
  if (notes.length === 0) return { status: "refused", reason: "No row is left to import." };

  // Reads first (no tenant data): collateral resolution against public-record parcels.
  const collateral = new Map<number, CollateralResolution | null>();
  for (const n of notes) collateral.set(n.fileRow, await resolveCollateral(n.collateral));

  const importId = randomUUID();
  const { withTransaction } = await import("../../db");
  return withTransaction(async (tx) => {
    const out: Extract<CommitNoteTapeResult, { status: "committed" }>["notes"] = [];
    for (const n of notes) {
      const [existing] = await tx
        .select({ id: acquiredNotes.id })
        .from(acquiredNotes)
        .where(and(eq(acquiredNotes.organizationId, a.organizationId), eq(acquiredNotes.noteNumber, n.noteNumber)))
        .limit(1);
      let noteId: string;
      if (existing) noteId = existing.id;
      else {
        const [row] = await tx
          .insert(acquiredNotes)
          .values({
            organizationId: a.organizationId,
            noteNumber: n.noteNumber,
            payerName: n.payerName,
            originalPrincipalCents: n.originalPrincipalCents,
            currentBalanceCents: n.currentBalanceCents,
            interestRateBps: n.interestRateBps,
            termMonths: n.termMonths,
            paymentAmountCents: n.paymentAmountCents,
            paymentDueDay: n.paymentDueDay,
            originationDate: n.originationDate,
            maturityDate: n.maturityDate,
            acquisitionDate: n.acquisitionDate,
            acquisitionPriceCents: n.acquisitionPriceCents,
            status: n.status,
            remainingTermMonths: n.remainingTermMonths,
            balloonAmountCents: n.balloonAmountCents,
            balloonDate: n.balloonDate,
            paidThroughDate: n.paidThroughDate,
            nextPaymentDate: n.nextPaymentDate,
          })
          .returning({ id: acquiredNotes.id });
        noteId = row.id;
      }

      // Disagreement report for an existing note: the latest recorded value per field vs this tape's.
      const differing: string[] = [];
      if (existing) {
        const prior = await tx
          .select({ field: noteFieldObservations.field, value: noteFieldObservations.value })
          .from(noteFieldObservations)
          .where(and(eq(noteFieldObservations.organizationId, a.organizationId), eq(noteFieldObservations.noteId, noteId), eq(noteFieldObservations.kind, "value")))
          .orderBy(desc(noteFieldObservations.observedAt));
        const latest = new Map<string, unknown>();
        for (const p of prior) if (!latest.has(p.field)) latest.set(p.field, p.value);
        for (const [k, s] of Object.entries(n.stated)) {
          if (latest.has(k) && JSON.stringify(latest.get(k)) !== JSON.stringify(s!.value)) differing.push(k);
        }
      }

      const rows: InsertNoteFieldObservation[] = [];
      for (const [k, s] of Object.entries(n.stated) as Array<[NoteTapeFieldKey, NonNullable<PreparedNote["stated"][NoteTapeFieldKey]>]>) {
        const corrected = s.source.origin === "operator_correction";
        rows.push({
          organizationId: a.organizationId,
          noteId,
          field: k,
          kind: "value",
          value: s.value,
          source: corrected ? "operator_correction" : "note_tape",
          sourceRef: { fileName: a.fileName, fileSha256: a.fileSha256, fileRow: n.fileRow, column: s.source.column, raw: s.source.raw },
          asOf: a.asOf,
          confidence: TAPE_CONFIDENCE,
          confidenceBasis: corrected ? "corrected by the operator during import; the tape's own cell was not used" : TAPE_CONFIDENCE_BASIS,
          decayClass: NOTE_TAPE_FIELD[k].decay,
          importId,
          recordedBy: a.actorUserId,
        });
      }
      const res = collateral.get(n.fileRow) ?? null;
      if (res) {
        const base = { organizationId: a.organizationId, noteId, field: "collateral.parcel", source: "warehouse" as const, asOf: null, decayClass: "years", importId, recordedBy: a.actorUserId };
        if (res.parcelKey) {
          rows.push({ ...base, kind: "value", value: { parcelKey: res.parcelKey, apid: res.apid, ...res.searchedFor, apidReason: res.reason }, sourceRef: { searchedFor: res.searchedFor }, confidence: "high", confidenceBasis: "the tape's county parcel id matched an AcreOS-held public-record parcel exactly" });
        } else {
          rows.push({ ...base, kind: "searched_none", value: null, sourceRef: { searchedFor: res.searchedFor, reason: res.reason }, confidence: "high", confidenceBasis: "searched AcreOS-held public-record parcels for this county parcel id; none found" });
        }
      }
      if (rows.length > 0) await tx.insert(noteFieldObservations).values(rows);
      out.push({ fileRow: n.fileRow, noteId, noteNumber: n.noteNumber, created: !existing, collateral: res === null ? "not_searched" : res.parcelKey ? "matched" : "unmatched", documentsIncomplete: n.documentsIncomplete, differingFields: differing });
    }
    return {
      status: "committed" as const,
      importId,
      created: out.filter((x) => x.created).length,
      appendedToExisting: out.filter((x) => !x.created).length,
      excludedRows: [...excluded].sort((x, y) => x - y),
      notes: out,
    };
  });
}
