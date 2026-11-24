/**
 * Pax-facing read of the ACQUIRED note book (HYB-DEF-5).
 *
 * Until this module, nothing under server/ai read the acquired book:
 * `get_notes` and the system-context aggregator read the serviced
 * (`notes`) table only and presented it as the whole notes book, so a
 * hybrid operator's acquired notes were silently absent from Pax's
 * answers — with no coverage statement saying the slice was partial
 * (the RW-D coverage rule: an answer assembled from a partial slice
 * says which slice). This module is the acquired half of Pax's
 * cross-book read: org-scoped, capped like every other org-wide list
 * read, shaped in dollars for the model, and paired with an explicit
 * coverage statement the tool results carry verbatim.
 *
 * Borrower contact (HYB-DEF-6, second half): a note's borrower contact
 * lives on the LINKED LEAD (`acquiredNotes.borrowerId` /
 * `notes.borrowerId` → leads). The shaping helpers here resolve that
 * link so Pax reads the lead's email/phone before ever saying a
 * borrower's contact "isn't stored".
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { acquiredNotes } from "@shared/schema";
import { capListRead, LIST_READ_CAP } from "../../storage/listCap";

/** Acquired-note lifecycle (shared/schema/notes-vertical.ts). */
const ACQUIRED_NOTE_TERMINAL_STATUSES = ["paid_off", "sold"] as const;

function isLiveAcquiredNote(status: string): boolean {
  return !(ACQUIRED_NOTE_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface AcquiredNotePaxRow {
  id: string;
  noteNumber: string;
  borrowerId: number | null;
  payerName: string;
  payerPhone: string | null;
  status: string;
  delinquencyStatus: string;
  daysDelinquent: number;
  originalPrincipalCents: number;
  currentBalanceCents: number;
  paymentAmountCents: number;
  interestRateBps: number;
  nextPaymentDate: string | null;
  acquisitionDate: string;
}

export interface BorrowerContact {
  leadId: number | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Where the contact came from — Pax must never present a fallback as the lead record. */
  source: "linked_lead" | "note_record" | "none";
}

interface LeadContactShape {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * The borrower's contact AS RECORDED ON THE LINKED LEAD. Null fields
 * mean the lead itself carries no value — the honest statement is
 * "no email on the borrower's lead record", never "isn't stored"
 * without having looked.
 */
export function borrowerContactFromLead(
  lead: LeadContactShape | null | undefined,
): BorrowerContact {
  if (!lead) return { leadId: null, name: null, email: null, phone: null, source: "none" };
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return {
    leadId: lead.id,
    name: name || null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    source: "linked_lead",
  };
}

/**
 * Acquired notes also carry a payer snapshot (name + address phone)
 * written at import. The linked lead wins when it exists; the snapshot
 * is the fallback and is LABELLED `note_record` so Pax cites it as the
 * note's own record, not as the borrower's lead record.
 */
export function borrowerContactForAcquiredNote(
  row: Pick<AcquiredNotePaxRow, "borrowerId" | "payerName" | "payerPhone">,
  lead: LeadContactShape | null | undefined,
): BorrowerContact {
  if (lead) return borrowerContactFromLead(lead);
  if (row.payerName || row.payerPhone) {
    return {
      leadId: row.borrowerId ?? null,
      name: row.payerName || null,
      email: null,
      phone: row.payerPhone ?? null,
      source: "note_record",
    };
  }
  return { leadId: row.borrowerId ?? null, name: null, email: null, phone: null, source: "none" };
}

function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function shapeAcquiredNoteForPax(row: AcquiredNotePaxRow, contact: BorrowerContact) {
  return {
    id: row.id,
    book: "acquired" as const,
    noteNumber: row.noteNumber,
    borrowerId: row.borrowerId,
    borrowerName: row.payerName,
    borrowerContact: contact,
    originalPrincipal: centsToDollars(row.originalPrincipalCents),
    currentBalance: centsToDollars(row.currentBalanceCents),
    interestRate: row.interestRateBps / 100,
    monthlyPayment: centsToDollars(row.paymentAmountCents),
    status: row.status,
    delinquencyStatus: row.delinquencyStatus,
    daysDelinquent: row.daysDelinquent,
    nextPaymentDate: row.nextPaymentDate,
    acquisitionDate: row.acquisitionDate,
  };
}

export interface AcquiredBookSummary {
  count: number;
  liveCount: number;
  totalBalance: number;
  monthlyPayments: number;
  delinquentCount: number;
}

export function summarizeAcquiredBook(rows: AcquiredNotePaxRow[]): AcquiredBookSummary {
  const live = rows.filter((r) => isLiveAcquiredNote(r.status));
  return {
    count: rows.length,
    liveCount: live.length,
    totalBalance: centsToDollars(live.reduce((s, r) => s + r.currentBalanceCents, 0)),
    monthlyPayments: centsToDollars(live.reduce((s, r) => s + r.paymentAmountCents, 0)),
    delinquentCount: live.filter((r) => r.delinquencyStatus !== "current").length,
  };
}

/**
 * The RW-D coverage statement for a notes answer. It names BOTH books
 * and their counts — including when a book is empty — so a partial
 * slice can never again be presented as the whole book.
 */
export function buildNotesCoverageStatement(servicedCount: number, acquiredCount: number): string {
  return (
    `Coverage: this answer reads BOTH note books — the serviced book ` +
    `(notes this account originated and services: ${servicedCount}) and the acquired book ` +
    `(notes this account bought: ${acquiredCount}). Figures are labelled by book; ` +
    `the two books are never merged into one unlabelled total.` +
    (acquiredCount === 0 ? " The acquired book is empty in this account." : "") +
    (servicedCount === 0 ? " The serviced book is empty in this account." : "")
  );
}

/** Org-scoped, capped read of the acquired book for Pax surfaces. */
export async function listAcquiredNotesForPax(orgId: number): Promise<AcquiredNotePaxRow[]> {
  const rows = await db
    .select({
      id: acquiredNotes.id,
      noteNumber: acquiredNotes.noteNumber,
      borrowerId: acquiredNotes.borrowerId,
      payerName: acquiredNotes.payerName,
      payerAddress: acquiredNotes.payerAddress,
      status: acquiredNotes.status,
      delinquencyStatus: acquiredNotes.delinquencyStatus,
      daysDelinquent: acquiredNotes.daysDelinquent,
      originalPrincipalCents: acquiredNotes.originalPrincipalCents,
      currentBalanceCents: acquiredNotes.currentBalanceCents,
      paymentAmountCents: acquiredNotes.paymentAmountCents,
      interestRateBps: acquiredNotes.interestRateBps,
      nextPaymentDate: acquiredNotes.nextPaymentDate,
      acquisitionDate: acquiredNotes.acquisitionDate,
    })
    .from(acquiredNotes)
    .where(eq(acquiredNotes.organizationId, orgId))
    .orderBy(desc(acquiredNotes.acquisitionDate))
    .limit(LIST_READ_CAP + 1);
  const capped = capListRead(rows, LIST_READ_CAP, "listAcquiredNotesForPax", orgId);
  return capped.map((r) => ({
    id: r.id,
    noteNumber: r.noteNumber,
    borrowerId: r.borrowerId,
    payerName: r.payerName,
    payerPhone: r.payerAddress?.phone ?? null,
    status: r.status,
    delinquencyStatus: r.delinquencyStatus,
    daysDelinquent: r.daysDelinquent,
    originalPrincipalCents: r.originalPrincipalCents,
    currentBalanceCents: r.currentBalanceCents,
    paymentAmountCents: r.paymentAmountCents,
    interestRateBps: r.interestRateBps,
    nextPaymentDate: r.nextPaymentDate as unknown as string | null,
    acquisitionDate: r.acquisitionDate as unknown as string,
  }));
}

/** Live acquired-book totals for the cash-flow tool — labelled, never merged into the serviced figures. */
export async function activeAcquiredNoteTotals(orgId: number): Promise<{
  liveAcquiredNotesCount: number;
  totalOutstandingBalance: number;
  monthlyCashflow: number;
}> {
  const rows = await listAcquiredNotesForPax(orgId);
  const s = summarizeAcquiredBook(rows);
  return {
    liveAcquiredNotesCount: s.liveCount,
    totalOutstandingBalance: s.totalBalance,
    monthlyCashflow: s.monthlyPayments,
  };
}
