/**
 * Settlement & Documents Rail — Notes transplant, item N-1: the payoff LETTER.
 *
 * A borrower (or their escrow/title company) does not pay off a screen. The
 * canonical payoff quote existed for both books — serviced via
 * `quoteServicedNotePayoff`, acquired via `computeAcquiredNotePayoff`, both
 * recorded in `note_payoff_quotes` — and the borrower portal could render
 * that quote row as a plain PDF, but no formal letter artifact existed:
 * nothing the operator could generate from the note record, address to the
 * borrower or escrow, and DELIVER (download / mail / certified mail) as the
 * money moment's paper. This is that letter, on the rail:
 *
 *   1. quote through the book's ONE canonical engine and record the row;
 *   2. render the letter from THAT row (figures ≡ quote by construction);
 *   3. hand the artifact to the rail's delivery lanes.
 *
 * The two books share the `/api/notes/:id` path family and are told apart
 * by id shape — serviced notes are integer ids, acquired notes are uuids —
 * the same disambiguation `note_payoff_quotes.noteSystem` records.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  acquiredNotes,
  leads,
  notes,
  notePayoffQuotes,
  organizations,
  properties,
  type NotePayoffQuote,
  type PayoffQuoteChannel,
} from "@shared/schema";
import { quoteServicedNotePayoff } from "../notes/servicedNotePayoff";
import { resolveOrgTimeZone } from "../form1098Batch";
import { isoDateUtc, PAYOFF_DAY_COUNT_CONVENTION, PAYOFF_ENGINE_VERSION } from "../notePaymentMath";
import { computeAcquiredNotePayoff } from "../../routes-notes";
import { buildPayoffLetter, type RailDocumentArtifact } from "./documents";
import type { RailMailRecipient } from "./delivery";

export type NoteBook = "serviced_note" | "acquired_note";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which book a `/api/notes/:id` id belongs to, by the id's own shape. Null when it is neither. */
export function noteBookForId(noteId: string): NoteBook | null {
  if (UUID_SHAPE.test(noteId)) return "acquired_note";
  if (/^\d+$/.test(noteId)) return "serviced_note";
  return null;
}

export interface PayoffLetterResult {
  book: NoteBook;
  quoteRow: NotePayoffQuote;
  artifact: RailDocumentArtifact;
  /** The borrower as a mail recipient, when the record carries a usable address. */
  recipient: RailMailRecipient | null;
  borrowerName: string | null;
}

function propertyLine(p: { address: string | null; city: string | null; state: string; zip: string | null } | undefined): string | null {
  if (!p) return null;
  const parts = [p.address, p.city, p.state, p.zip].filter((x) => x && String(x).trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

async function orgName(organizationId: number): Promise<string> {
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return org?.name ?? "Your lender";
}

/**
 * Quote + render a payoff letter for one note in either book. Returns null
 * when the note does not exist in this org (callers turn that into a 404).
 */
export async function generatePayoffLetter(args: {
  organizationId: number;
  noteId: string;
  payoffDate: Date;
  channel: PayoffQuoteChannel;
  quotedByUserId: string | null;
  payoffFeeCents?: number;
  paymentInstructions?: string | null;
}): Promise<PayoffLetterResult | null> {
  const book = noteBookForId(args.noteId);
  if (!book) return null;
  const lenderName = await orgName(args.organizationId);

  if (book === "serviced_note") {
    const noteDbId = Number(args.noteId);
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteDbId), eq(notes.organizationId, args.organizationId)))
      .limit(1);
    if (!note) return null;

    const [borrower] = note.borrowerId
      ? await db.select().from(leads).where(and(eq(leads.id, note.borrowerId), eq(leads.organizationId, args.organizationId))).limit(1)
      : [];
    const [property] = note.propertyId
      ? await db
          .select({ address: properties.address, city: properties.city, state: properties.state, zip: properties.zip })
          .from(properties)
          .where(and(eq(properties.id, note.propertyId), eq(properties.organizationId, args.organizationId)))
          .limit(1)
      : [];
    const borrowerName = borrower ? `${borrower.firstName} ${borrower.lastName}`.trim() : null;
    const { row } = await quoteServicedNotePayoff({
      note,
      payoffDate: args.payoffDate,
      lenderTimeZone: await resolveOrgTimeZone(args.organizationId),
      channel: args.channel,
      payerName: borrowerName,
      quotedByUserId: args.quotedByUserId,
      provenance: "settlement_rail:payoff_letter",
    });
    const recipient: RailMailRecipient | null =
      borrower && borrower.address && borrower.city && borrower.state && borrower.zip
        ? {
            name: borrowerName ?? "Borrower",
            address: { line1: borrower.address, city: borrower.city, state: borrower.state, zip: borrower.zip },
          }
        : null;
    return {
      book,
      quoteRow: row,
      artifact: buildPayoffLetter({
        quote: row,
        lenderName,
        borrowerName,
        propertyAddress: propertyLine(property),
        paymentInstructions: args.paymentInstructions ?? null,
      }),
      recipient,
      borrowerName,
    };
  }

  // Acquired book: the same recorded-quote discipline as
  // POST /api/notes/:id/payoff/quotes — compute through the canonical
  // engine, record the row, render from the row.
  const result = await computeAcquiredNotePayoff(db, args.organizationId, args.noteId, args.payoffDate, {
    payoffFeeCents: args.payoffFeeCents ?? 0,
  });
  if (!result) return null;
  const q = result.quote;
  const [row] = await db
    .insert(notePayoffQuotes)
    .values({
      organizationId: args.organizationId,
      noteSystem: "acquired_note",
      noteRef: result.note.id,
      noteNumber: result.note.noteNumber,
      payerName: result.note.payerName,
      quotedByUserId: args.quotedByUserId,
      channel: args.channel,
      payoffDate: q.payoffDate,
      goodThroughDate: q.payoffDate,
      principalBalanceCents: q.principalBalanceCents,
      annualRateBpsHundredths: Math.round(q.annualRateBps * 100),
      accrualStartDate: q.accrualStartDate,
      daysAccrued: q.daysAccrued,
      dayCountConvention: q.dayCountConvention,
      perDiemInterestCents: q.perDiemInterestCents,
      accruedInterestCents: q.accruedInterestCents,
      unappliedCreditCents: q.unappliedCreditCents,
      lateFeesOutstandingCents: q.lateFeesOutstandingCents,
      payoffFeeCents: q.payoffFeeCents,
      totalPayoffCents: q.totalPayoffCents,
      engineVersion: q.engineVersion,
      engineInputJson: {
        principalBalanceCents: result.input.principalBalanceCents,
        annualRateBps: result.input.annualRateBps,
        accrualStartDate: isoDateUtc(result.input.accrualStartDate),
        payoffDate: isoDateUtc(result.input.payoffDate),
        unappliedCreditCents: result.input.unappliedCreditCents ?? 0,
        lateFeesOutstandingCents: result.input.lateFeesOutstandingCents ?? 0,
        payoffFeeCents: result.input.payoffFeeCents ?? 0,
        dayCountConvention: PAYOFF_DAY_COUNT_CONVENTION,
        engineVersion: PAYOFF_ENGINE_VERSION,
      },
      notes: "settlement_rail:payoff_letter",
    })
    .returning();

  const [note] = await db
    .select({ propertyId: acquiredNotes.propertyId, payerAddress: acquiredNotes.payerAddress })
    .from(acquiredNotes)
    .where(and(eq(acquiredNotes.id, args.noteId), eq(acquiredNotes.organizationId, args.organizationId)))
    .limit(1);
  const [property] = note?.propertyId
    ? await db
        .select({ address: properties.address, city: properties.city, state: properties.state, zip: properties.zip })
        .from(properties)
        .where(and(eq(properties.id, note.propertyId), eq(properties.organizationId, args.organizationId)))
        .limit(1)
    : [];
  const pa = note?.payerAddress;
  const recipient: RailMailRecipient | null =
    pa && pa.line1 && pa.city && pa.state && pa.zip
      ? { name: result.note.payerName, address: { line1: pa.line1, line2: pa.line2, city: pa.city, state: pa.state, zip: pa.zip } }
      : null;
  // The recorded row is the render source (never the in-memory quote), so
  // the letter and the ledger can be compared field-for-field.
  return {
    book,
    quoteRow: row,
    artifact: buildPayoffLetter({
      quote: row,
      lenderName,
      borrowerName: result.note.payerName,
      propertyAddress: propertyLine(property),
      paymentInstructions: args.paymentInstructions ?? null,
    }),
    recipient,
    borrowerName: result.note.payerName,
  };
}
