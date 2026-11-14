/**
 * Settlement & Documents Rail — Notes transplant, item N-2: the lien release.
 *
 * When a note pays off, its status flips to `paid_off` — and until now the
 * paper that frees the title did not exist: no satisfaction/release was
 * generated anywhere in the product, so the borrower's title stayed clouded
 * by a lien whose debt no longer existed until someone drafted the release
 * outside AcreOS. This service closes the payoff arc in-product:
 *
 *   1. refuse unless the note (either book) is actually `paid_off`;
 *   2. generate the release from the note + collateral record;
 *   3. open its recording-status row on the rail (prepared), which the
 *      operator advances to `recorded` with the instrument number when the
 *      county records it — the payoff arc's terminal state.
 *
 * The original mortgage's recording facts (instrument number, recording
 * date) are operator-supplied when the note record does not carry them:
 * they are facts of the county record, and the rail never invents them.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { acquiredNotes, leads, notes, organizations, properties, type RecordingStatusRow } from "@shared/schema";
import { buildLienRelease, type RailDocumentArtifact } from "./documents";
import { createRecordingStatus, listRecordingStatusesForSubject } from "./recordingStatus";
import { noteBookForId } from "./payoffLetter";
import { clock } from "../../utils/clock";

export class LienReleaseRefusedError extends Error {
  constructor(
    readonly reason: "not_paid_off" | "note_not_found",
    message: string,
  ) {
    super(message);
    this.name = "LienReleaseRefusedError";
  }
}

export interface LienReleaseResult {
  artifact: RailDocumentArtifact;
  recording: RecordingStatusRow;
  /** True when the recording row already existed (the document was re-rendered, not re-filed). */
  recordingReused: boolean;
}

export async function generateLienRelease(args: {
  organizationId: number;
  noteId: string;
  createdByUserId: string | null;
  /** The original instrument's recording facts, when the operator knows them. */
  originalInstrumentNumber?: string | null;
  originalRecordingDate?: string | null;
  /** The date the note was satisfied (ISO date). Defaults to today. */
  payoffDate?: string | null;
}): Promise<LienReleaseResult> {
  const book = noteBookForId(args.noteId);
  if (!book) {
    throw new LienReleaseRefusedError("note_not_found", "Note not found");
  }
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, args.organizationId))
    .limit(1);
  const lenderName = org?.name ?? "Your lender";
  const payoffDate = args.payoffDate ?? clock.now().toISOString().slice(0, 10);

  let borrowerName: string | null = null;
  let propertyId: number | null = null;
  let noteDate: string | null = null;
  let status: string;

  if (book === "serviced_note") {
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, Number(args.noteId)), eq(notes.organizationId, args.organizationId)))
      .limit(1);
    if (!note) throw new LienReleaseRefusedError("note_not_found", "Note not found");
    status = note.status;
    propertyId = note.propertyId;
    noteDate = note.startDate ? new Date(note.startDate).toISOString().slice(0, 10) : null;
    if (note.borrowerId) {
      const [borrower] = await db
        .select({ firstName: leads.firstName, lastName: leads.lastName })
        .from(leads)
        .where(and(eq(leads.id, note.borrowerId), eq(leads.organizationId, args.organizationId)))
        .limit(1);
      if (borrower) borrowerName = `${borrower.firstName} ${borrower.lastName}`.trim();
    }
  } else {
    const [note] = await db
      .select()
      .from(acquiredNotes)
      .where(and(eq(acquiredNotes.id, args.noteId), eq(acquiredNotes.organizationId, args.organizationId)))
      .limit(1);
    if (!note) throw new LienReleaseRefusedError("note_not_found", "Note not found");
    status = note.status;
    propertyId = note.propertyId;
    noteDate = note.originationDate as unknown as string;
    borrowerName = note.payerName;
  }

  if (status !== "paid_off") {
    throw new LienReleaseRefusedError(
      "not_paid_off",
      `A lien release can only be generated for a note that has paid off — this note's status is "${status}".`,
    );
  }

  const [property] = propertyId
    ? await db
        .select({
          address: properties.address,
          city: properties.city,
          state: properties.state,
          zip: properties.zip,
          county: properties.county,
          legalDescription: properties.legalDescription,
        })
        .from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, args.organizationId)))
        .limit(1)
    : [];
  const propertyAddress = property
    ? [property.address, property.city, property.state, property.zip].filter((x) => x && String(x).trim()).join(", ") || null
    : null;

  const artifact = buildLienRelease({
    lenderName,
    borrowerName: borrowerName ?? "Borrower",
    propertyAddress,
    legalDescription: property?.legalDescription ?? null,
    county: property?.county ?? null,
    state: property?.state ?? null,
    originalInstrumentNumber: args.originalInstrumentNumber ?? null,
    originalRecordingDate: args.originalRecordingDate ?? null,
    noteDate,
    payoffDate,
  });
  artifact.filename = `lien-release-${args.noteId}-${payoffDate}.pdf`;

  const subjectType = book === "serviced_note" ? "note" : "acquired_note";
  const existing = await listRecordingStatusesForSubject(args.organizationId, subjectType, args.noteId);
  const open = existing.find((r) => r.status !== "rejected");
  if (open) return { artifact, recording: open, recordingReused: true };
  const recording = await createRecordingStatus({
    organizationId: args.organizationId,
    subjectKind: "lien_release",
    subjectType,
    subjectId: args.noteId,
    county: property?.county ?? null,
    state: property?.state ?? null,
    createdByUserId: args.createdByUserId,
  });
  return { artifact, recording, recordingReused: false };
}
