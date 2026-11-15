/**
 * Settlement & Documents Rail (P1-3) — SERVICE-level proof.
 *
 * `settlementRail.test.ts` pins the rail's pure functions (renderers,
 * transition table, pricing, variance, merge, id shape). This file pins the
 * four SERVICE behaviours that sit on top of them, by driving the REAL
 * service functions against an in-memory db whose chains dispatch on the
 * table handed to `.from()` / `.insert()` / `.update()`. Only the db edge and
 * the named collaborators (the two payoff engines, the org time-zone read,
 * the mail delivery lane) are faked.
 *
 *   1. generateLienRelease refuses unless the note is `paid_off`, in either
 *      book, and the guard fires before any recording-status read or write;
 *   2. advanceRecordingStatus enforces the instrument number in the service
 *      before a recording may read "recorded" (no update on refusal);
 *   3. generatePayoffLetter renders the letter from the RECORDED
 *      `note_payoff_quotes` row — never the acquired book's in-memory quote;
 *   4. the offer-mail transport returns a letter to draft, with the failure
 *      reason, when the mail send fails (and marks it sent on success).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── The in-memory db ────────────────────────────────────────────────────────

type Op = "select" | "insert" | "update";
interface DbCall {
  op: Op;
  table: unknown;
  values?: unknown;
  set?: Record<string, unknown>;
}

const fake = vi.hoisted(() => {
  const state = {
    calls: [] as DbCall[],
    /** Rows a read of `table` returns. */
    selectRows: new Map<unknown, unknown[]>(),
    /** Rows `.returning()` yields for an insert into `table` (default: the inserted values + id). */
    insertReturning: new Map<unknown, unknown[]>(),
    /** Rows `.returning()` yields for an update of `table` (default: the patch). */
    updateReturning: new Map<unknown, (patch: Record<string, unknown>) => unknown[]>(),
  };
  return state;
});

vi.mock("../../server/db", () => {
  // One chainable, thenable builder per query: every chain method returns the
  // builder, and awaiting it (with or without .returning()) resolves the rows
  // for the table the query named.
  function builder(resolve: () => unknown[]) {
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ["where", "orderBy", "limit", "returning", "innerJoin", "leftJoin"]) b[m] = self;
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve().then(resolve).then(ok, bad);
    return b;
  }
  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => {
        const call: DbCall = { op: "select", table };
        fake.calls.push(call);
        return builder(() => (fake.selectRows.get(table) ?? []).map((r) => ({ ...(r as object) })));
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        const call: DbCall = { op: "insert", table, values };
        fake.calls.push(call);
        return builder(() => fake.insertReturning.get(table) ?? [{ id: 9001, ...(values as object) }]);
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (patch: Record<string, unknown>) => {
        const call: DbCall = { op: "update", table, set: patch };
        fake.calls.push(call);
        return builder(() => fake.updateReturning.get(table)?.(patch) ?? [{ ...patch }]);
      },
    })),
  };
  return { db };
});

// ── The named collaborators ─────────────────────────────────────────────────

vi.mock("../../server/services/notes/servicedNotePayoff", () => ({
  quoteServicedNotePayoff: vi.fn(),
}));
vi.mock("../../server/services/form1098Batch", () => ({
  resolveOrgTimeZone: vi.fn(async () => "America/Chicago"),
}));
vi.mock("../../server/routes-notes", () => ({
  computeAcquiredNotePayoff: vi.fn(),
}));
vi.mock("../../server/services/settlementRail/delivery", () => ({
  deliverRailLetterByMail: vi.fn(),
}));
// Pass-through spies on the REAL recording-status functions, so the lien
// release's ordering (guard before lookup) is observable at the call edge.
vi.mock("../../server/services/settlementRail/recordingStatus", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/services/settlementRail/recordingStatus")>();
  return {
    ...real,
    listRecordingStatusesForSubject: vi.fn(real.listRecordingStatusesForSubject),
    createRecordingStatus: vi.fn(real.createRecordingStatus),
  };
});

// ── Imports under test (after mocks) ────────────────────────────────────────

import {
  acquiredNotes,
  leads,
  notePayoffQuotes,
  notes,
  offerLetters,
  organizations,
  recordingStatuses,
  type NotePayoffQuote,
} from "@shared/schema";
import { db } from "../../server/db";
import { generateLienRelease, LienReleaseRefusedError } from "../../server/services/settlementRail/lienRelease";
import {
  advanceRecordingStatus,
  createRecordingStatus,
  listRecordingStatusesForSubject,
  RecordingTransitionError,
} from "../../server/services/settlementRail/recordingStatus";
import { generatePayoffLetter } from "../../server/services/settlementRail/payoffLetter";
import { drainQueuedOfferLetters } from "../../server/services/settlementRail/offerMailTransport";
import { quoteServicedNotePayoff } from "../../server/services/notes/servicedNotePayoff";
import { resolveOrgTimeZone } from "../../server/services/form1098Batch";
import { computeAcquiredNotePayoff } from "../../server/routes-notes";
import { deliverRailLetterByMail } from "../../server/services/settlementRail/delivery";

const ORG = 7;
const ACQUIRED_ID = "11111111-2222-3333-4444-555555555555";

const callsOn = (op: Op, table: unknown) => fake.calls.filter((c) => c.op === op && c.table === table);

beforeEach(() => {
  fake.calls.length = 0;
  fake.selectRows.clear();
  fake.insertReturning.clear();
  fake.updateReturning.clear();
  vi.clearAllMocks();
  fake.selectRows.set(organizations, [{ name: "Acme Note Fund LLC" }]);
});

// ── 1. Lien release: the paid_off guard ─────────────────────────────────────

describe("generateLienRelease — refuses unless the note is paid_off, before any recording read or write", () => {
  const servicedNote = (status: string) => ({
    id: 42,
    organizationId: ORG,
    status,
    propertyId: null,
    borrowerId: null,
    startDate: new Date("2021-03-01T00:00:00Z"),
  });
  const acquiredNote = (status: string) => ({
    id: ACQUIRED_ID,
    organizationId: ORG,
    status,
    propertyId: null,
    originationDate: "2021-03-01",
    payerName: "Pat Borrower",
  });

  it("serviced book: an active note is refused with not_paid_off, and nothing was read from or written to the recording rail", async () => {
    fake.selectRows.set(notes, [servicedNote("active")]);
    const err = await generateLienRelease({ organizationId: ORG, noteId: "42", createdByUserId: "u1" }).catch((e) => e);
    expect(err).toBeInstanceOf(LienReleaseRefusedError);
    expect((err as LienReleaseRefusedError).reason).toBe("not_paid_off");
    // The guard actually read the serviced note (vacuity check)…
    expect(callsOn("select", notes)).toHaveLength(1);
    // …and fired before the existing-recording lookup and before any write.
    expect(listRecordingStatusesForSubject).not.toHaveBeenCalled();
    expect(callsOn("select", recordingStatuses)).toHaveLength(0);
    expect(createRecordingStatus).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("acquired book: a performing note is refused from the acquired book's own row, with no recording read or write", async () => {
    fake.selectRows.set(acquiredNotes, [acquiredNote("performing")]);
    // A paid_off row in the OTHER book must not satisfy the guard.
    fake.selectRows.set(notes, [servicedNote("paid_off")]);
    const err = await generateLienRelease({ organizationId: ORG, noteId: ACQUIRED_ID, createdByUserId: "u1" }).catch((e) => e);
    expect(err).toBeInstanceOf(LienReleaseRefusedError);
    expect((err as LienReleaseRefusedError).reason).toBe("not_paid_off");
    expect(callsOn("select", acquiredNotes)).toHaveLength(1);
    expect(callsOn("select", notes)).toHaveLength(0);
    expect(listRecordingStatusesForSubject).not.toHaveBeenCalled();
    expect(callsOn("select", recordingStatuses)).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("positive control: a paid_off note resolves and opens a fresh recording row (the guard is the only blocker)", async () => {
    fake.selectRows.set(notes, [servicedNote("paid_off")]);
    fake.selectRows.set(recordingStatuses, []);
    const result = await generateLienRelease({
      organizationId: ORG,
      noteId: "42",
      createdByUserId: "u1",
      payoffDate: "2026-11-20",
    });
    expect(result.recordingReused).toBe(false);
    expect(listRecordingStatusesForSubject).toHaveBeenCalledWith(ORG, "note", "42");
    const inserts = callsOn("insert", recordingStatuses);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      organizationId: ORG,
      subjectKind: "lien_release",
      subjectType: "note",
      subjectId: "42",
      status: "prepared",
    });
    expect(result.recording).toMatchObject({ status: "prepared", subjectId: "42" });
    expect(result.artifact.kind).toBe("lien_release");
    expect(result.artifact.html).toContain("SATISFIED IN FULL");
    expect(result.artifact.html).toContain("Acme Note Fund LLC");
  });

  it("positive control (acquired book): a paid_off acquired note resolves under subjectType acquired_note", async () => {
    fake.selectRows.set(acquiredNotes, [acquiredNote("paid_off")]);
    const result = await generateLienRelease({ organizationId: ORG, noteId: ACQUIRED_ID, createdByUserId: null });
    expect(result.recordingReused).toBe(false);
    expect(callsOn("insert", recordingStatuses)[0].values).toMatchObject({ subjectType: "acquired_note", subjectId: ACQUIRED_ID });
    expect(result.artifact.html).toContain("Pat Borrower");
  });
});

// ── 2. Recording status: instrument number enforced in the service ──────────

describe("advanceRecordingStatus — an instrument number is required before a recording reads \"recorded\"", () => {
  const storedRow = (overrides: Record<string, unknown> = {}) => ({
    id: 5,
    organizationId: ORG,
    subjectKind: "lien_release",
    subjectType: "note",
    subjectId: "42",
    status: "prepared",
    instrumentNumber: null,
    documentRef: null,
    rejectionReason: null,
    sentAt: null,
    recordedAt: null,
    preparedAt: new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  });

  it("prepared → recorded with no number passed and none stored is refused, and no update is issued", async () => {
    fake.selectRows.set(recordingStatuses, [storedRow()]);
    const err = await advanceRecordingStatus({ organizationId: ORG, id: 5, to: "recorded" }).catch((e) => e);
    expect(err).toBeInstanceOf(RecordingTransitionError);
    expect((err as Error).message).toMatch(/instrument number is required/);
    // The transition itself is allowed by the table — only the number refuses it.
    expect(callsOn("select", recordingStatuses)).toHaveLength(1);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("a whitespace-only number is no number", async () => {
    fake.selectRows.set(recordingStatuses, [storedRow()]);
    await expect(
      advanceRecordingStatus({ organizationId: ORG, id: 5, to: "recorded", instrumentNumber: "   " }),
    ).rejects.toBeInstanceOf(RecordingTransitionError);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("prepared → recorded WITH a number passed succeeds; the update carries the number and the row reads recorded", async () => {
    fake.selectRows.set(recordingStatuses, [storedRow()]);
    fake.updateReturning.set(recordingStatuses, (patch) => [{ ...storedRow(), ...patch }]);
    const updated = await advanceRecordingStatus({ organizationId: ORG, id: 5, to: "recorded", instrumentNumber: "2026-0099123" });
    const updates = callsOn("update", recordingStatuses);
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ status: "recorded", instrumentNumber: "2026-0099123" });
    expect(updates[0].set?.recordedAt).toBeInstanceOf(Date);
    expect(updated.status).toBe("recorded");
    expect(updated.instrumentNumber).toBe("2026-0099123");
  });

  it("sent_for_recording → recorded with the number already on the stored row (none passed) succeeds", async () => {
    fake.selectRows.set(recordingStatuses, [storedRow({ status: "sent_for_recording", instrumentNumber: "2026-0077001" })]);
    fake.updateReturning.set(recordingStatuses, (patch) => [{ ...storedRow(), ...patch }]);
    const updated = await advanceRecordingStatus({ organizationId: ORG, id: 5, to: "recorded" });
    const updates = callsOn("update", recordingStatuses);
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ status: "recorded", instrumentNumber: "2026-0077001" });
    expect(updated.status).toBe("recorded");
  });
});

// ── 3. Payoff letter: rendered from the RECORDED quote row ──────────────────

function recordedQuote(overrides: Partial<NotePayoffQuote> = {}): NotePayoffQuote {
  return {
    id: "99999999-8888-7777-6666-555555555555",
    organizationId: ORG,
    noteSystem: "serviced_note",
    noteRef: "42",
    noteNumber: "N-RECORDED",
    payerName: "Pat Borrower",
    quotedByUserId: null,
    channel: "operator_api",
    payoffDate: "2026-12-01",
    goodThroughDate: "2026-12-01",
    principalBalanceCents: 4_321_000,
    annualRateBpsHundredths: 90000,
    accrualStartDate: "2026-11-01",
    daysAccrued: 30,
    dayCountConvention: "actual/365",
    perDiemInterestCents: 1_066,
    accruedInterestCents: 31_980,
    unappliedCreditCents: 0,
    lateFeesOutstandingCents: 1_234,
    payoffFeeCents: 0,
    totalPayoffCents: 4_354_214,
    engineVersion: "test",
    engineInputJson: {},
    notes: null,
    quotedAt: new Date("2026-11-12T00:00:00Z"),
    createdAt: new Date("2026-11-12T00:00:00Z"),
    ...overrides,
  } as NotePayoffQuote;
}

describe("generatePayoffLetter — the letter is the RECORDED quote row, verbatim", () => {
  it("serviced book: the result's quoteRow is the engine's recorded row and the letter renders its figures", async () => {
    const note = { id: 42, organizationId: ORG, status: "active", borrowerId: null, propertyId: null };
    fake.selectRows.set(notes, [note]);
    const row = recordedQuote();
    vi.mocked(quoteServicedNotePayoff).mockResolvedValue({ row } as never);
    const payoffDate = new Date("2026-12-01T00:00:00Z");

    const result = await generatePayoffLetter({
      organizationId: ORG,
      noteId: "42",
      payoffDate,
      channel: "operator_api",
      quotedByUserId: "u1",
    });

    expect(result).not.toBeNull();
    expect(result!.book).toBe("serviced_note");
    expect(result!.quoteRow).toBe(row);
    expect(resolveOrgTimeZone).toHaveBeenCalledWith(ORG);
    expect(quoteServicedNotePayoff).toHaveBeenCalledWith(
      expect.objectContaining({ payoffDate, lenderTimeZone: "America/Chicago", provenance: "settlement_rail:payoff_letter" }),
    );
    const html = result!.artifact.html;
    expect(html).toContain("$43,542.14"); // total
    expect(html).toContain("$43,210.00"); // principal
    expect(html).toContain("$319.80"); // accrued interest
    expect(html).toContain("$12.34"); // late fees
    expect(html).toContain("$10.66"); // per diem
    expect(html).toContain("N-RECORDED");
    expect(html).toContain(row.id);
    expect(result!.artifact.filename).toBe(`payoff-letter-42-${row.id}.pdf`);
  });

  it("acquired book: renders the row the insert RETURNED, never the engine's in-memory quote", async () => {
    // The in-memory quote: deliberately different figures everywhere.
    vi.mocked(computeAcquiredNotePayoff).mockResolvedValue({
      note: { id: ACQUIRED_ID, noteNumber: "AQ-IN-MEMORY", payerName: "Sam Payer" },
      quote: {
        payoffDate: "2026-12-01",
        principalBalanceCents: 7_777_700,
        annualRateBps: 1000,
        accrualStartDate: "2026-11-01",
        daysAccrued: 30,
        dayCountConvention: "actual/365",
        perDiemInterestCents: 2_131,
        accruedInterestCents: 63_930,
        unappliedCreditCents: 0,
        lateFeesOutstandingCents: 0,
        payoffFeeCents: 0,
        totalPayoffCents: 7_841_630,
        engineVersion: "test",
      },
      input: {
        principalBalanceCents: 7_777_700,
        annualRateBps: 1000,
        accrualStartDate: new Date("2026-11-01T00:00:00Z"),
        payoffDate: new Date("2026-12-01T00:00:00Z"),
      },
    } as never);
    const recorded = recordedQuote({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      noteSystem: "acquired_note",
      noteRef: ACQUIRED_ID,
      noteNumber: "AQ-RECORDED",
      payerName: "Sam Payer",
    });
    fake.insertReturning.set(notePayoffQuotes, [recorded]);
    fake.selectRows.set(acquiredNotes, [{ propertyId: null, payerAddress: null }]);

    const result = await generatePayoffLetter({
      organizationId: ORG,
      noteId: ACQUIRED_ID,
      payoffDate: new Date("2026-12-01T00:00:00Z"),
      channel: "operator_api",
      quotedByUserId: "u1",
    });

    expect(result).not.toBeNull();
    expect(result!.book).toBe("acquired_note");
    // The quote WAS recorded, from the engine's figures…
    const inserts = callsOn("insert", notePayoffQuotes);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({ noteSystem: "acquired_note", noteRef: ACQUIRED_ID, totalPayoffCents: 7_841_630 });
    // …and the letter is the RETURNED row, not the in-memory quote.
    expect(result!.quoteRow).toBe(recorded);
    const html = result!.artifact.html;
    expect(html).toContain("$43,542.14");
    expect(html).toContain("AQ-RECORDED");
    expect(html).toContain(recorded.id);
    expect(html).not.toContain("$78,416.30"); // the in-memory total
    expect(html).not.toContain("$77,777.00"); // the in-memory principal
    expect(html).not.toContain("AQ-IN-MEMORY");
  });
});

// ── 4. Offer-mail transport: a failed send returns the letter to draft ──────

describe("drainQueuedOfferLetters — a failed mail send goes back to draft with the reason", () => {
  const queuedLetter = {
    id: 314,
    organizationId: ORG,
    leadId: 55,
    status: "queued",
    deliveryMethod: "direct_mail",
    letterContent: "Dear {firstName}, we will pay {offerPrice} for your land in {city}, {state}.",
    offerAmount: "12500",
    createdAt: new Date("2026-11-10T00:00:00Z"),
  };
  const lead = { id: 55, firstName: "Pat", lastName: "Owner", address: "12 Oak St", city: "Austin", state: "TX", zip: "78701" };

  beforeEach(() => {
    fake.selectRows.set(offerLetters, [queuedLetter]);
    fake.selectRows.set(leads, [lead]);
  });

  it("the send throws → status draft, responseNotes 'Mail send failed (…' with the reason; summary 1/0/1/0", async () => {
    vi.mocked(deliverRailLetterByMail).mockRejectedValue(new Error("house mail refused: insufficient purchased credits"));
    const summary = await drainQueuedOfferLetters();
    expect(summary).toEqual({ claimed: 1, sent: 0, failed: 1, skipped: 0 });
    // The send was really attempted, for this letter, with its own price merged.
    expect(deliverRailLetterByMail).toHaveBeenCalledTimes(1);
    const sendArgs = vi.mocked(deliverRailLetterByMail).mock.calls[0][0];
    expect(sendArgs).toMatchObject({ organizationId: ORG, lane: "mail", idempotencyKey: "offer-letter:314" });
    expect(sendArgs.html).toContain("$12,500");
    const updates = callsOn("update", offerLetters);
    expect(updates).toHaveLength(1);
    expect(updates[0].set?.status).toBe("draft");
    const notesText = String(updates[0].set?.responseNotes);
    expect(notesText.startsWith("Mail send failed (")).toBe(true);
    expect(notesText).toContain("house mail refused: insufficient purchased credits");
    expect(updates[0].set).not.toHaveProperty("lobMailingId");
  });

  it("success control: the send resolves a provider id → status sent with lobMailingId; summary sent 1", async () => {
    vi.mocked(deliverRailLetterByMail).mockResolvedValue({ providerId: "ltr_abc123" } as never);
    const summary = await drainQueuedOfferLetters();
    expect(summary).toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0 });
    const updates = callsOn("update", offerLetters);
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ status: "sent", lobMailingId: "ltr_abc123" });
    expect(updates[0].set?.sentAt).toBeInstanceOf(Date);
  });
});
