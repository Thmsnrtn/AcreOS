/**
 * achAutopayMoneyPath.test.ts — the invariants that keep borrower ACH autopay
 * from becoming either a lie or a double charge.
 *
 * Wave C ("Money moves", 2026-07-29). The borrower portal shipped an autopay
 * Switch that wrote one boolean and debited nothing, while telling the borrower
 * "Autopay is on — we'll collect this payment automatically". Making it real
 * means a debit path exists, so these tests pin the four properties that must
 * hold for a real debit path:
 *
 *   1. ONE debit per (note, period) — a double-click, a job re-run, a retry and
 *      a crash-and-retry all collapse before the processor is contacted.
 *   2. NO MANDATE ⇒ NO DEBIT. Refusal, never a debit "we'll paper over later".
 *   3. Autopay off ⇒ no debit, and an amount above the authorized ceiling ⇒ no
 *      debit (an over-authorization is the classic unauthorized-debit claim).
 *   4. `payment.received` is emitted AFTER the posting transaction commits and
 *      ONLY on the branch that actually created the ledger row.
 *
 * Everything is driven through the injected `AchAutopayStore` / `AchProcessor`
 * ports, so the suite needs no DATABASE_URL beyond the dummy in tests/setup.ts
 * and never reaches Stripe or any ACH rail.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  submitDebitForNote,
  submitDueDebits,
  applyProcessorState,
  applyReturn,
  evaluateDebitEligibility,
  planReturnDisposition,
  idempotencyKeyFor,
  periodKeyForDueDate,
  scheduledDebitAmountCents,
  buildAuthorizationText,
  MAX_ATTEMPTS_PER_PERIOD,
  type AchAutopayDeps,
  type AchAutopayStore,
  type AchProcessor,
  type AutopayNote,
  type ClaimAttemptInput,
  type PostSettlementInput,
  type PostSettlementResult,
  type PostReversalInput,
  type PostReversalResult,
  type ProcessorDebitState,
  type SubmitDebitInput,
} from "../../server/services/achAutopay";
import { classifyAchReturn } from "../../server/services/actumProcessing";
import type { AchDebitAttempt, AchMandate } from "../../shared/schema/ach-autopay";

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-01T12:00:00.000Z");
const DUE = new Date("2026-08-01T00:00:00.000Z");

function makeNote(overrides: Partial<AutopayNote> = {}): AutopayNote {
  return {
    id: 42,
    organizationId: 7,
    borrowerId: 99,
    status: "active",
    autoPayEnabled: true,
    monthlyPayment: "1000.00",
    serviceFee: "25.00",
    taxEscrowEnabled: false,
    monthlyTaxEscrow: "0",
    currentBalance: "100000.00",
    interestRate: "8.5",
    lateFee: "50.00",
    gracePeriodDays: 10,
    nextPaymentDate: DUE,
    ...overrides,
  };
}

function makeMandate(overrides: Partial<AchMandate> = {}): AchMandate {
  return {
    id: 5,
    organizationId: 7,
    noteId: 42,
    borrowerLeadId: 99,
    rail: "stripe_us_bank_account",
    processorAccountId: "acct_test",
    processorCustomerId: "cus_test",
    processorPaymentMethodId: "pm_test",
    processorMandateId: "mandate_test",
    processorSetupIntentId: "seti_test",
    setupReference: "cs_test",
    bankName: "Test Bank",
    accountLast4: "6789",
    accountType: "checking",
    authorizationText: "I authorize…",
    authorizationTextVersion: "2026-07-29.v1",
    authorizationMethod: "web",
    agreedAt: new Date("2026-07-20T00:00:00.000Z"),
    agreedIpAddress: "203.0.113.9",
    agreedUserAgent: "vitest",
    agreedByEmail: "borrower@example.com",
    debitType: "recurring",
    maxAmountCents: 200_000,
    frequency: "monthly",
    scheduleDescription: "monthly, on the 1st of each month",
    status: "active",
    confirmedAt: new Date("2026-07-20T00:05:00.000Z"),
    revokedAt: null,
    revokedReason: null,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-20T00:05:00.000Z"),
    ...overrides,
  };
}

function makeAttemptRow(input: ClaimAttemptInput, id: number): AchDebitAttempt {
  return {
    id,
    organizationId: input.organizationId,
    noteId: input.noteId,
    mandateId: input.mandateId,
    periodKey: input.periodKey,
    attemptNumber: input.attemptNumber,
    idempotencyKey: input.idempotencyKey,
    amountCents: input.amountCents,
    dueDate: input.dueDate,
    status: "created",
    processorPaymentIntentId: null,
    processorChargeId: null,
    returnCode: null,
    returnCategory: null,
    returnedAt: null,
    failureReason: null,
    nextRetryAt: null,
    retryOfAttemptId: input.retryOfAttemptId,
    paymentId: null,
    reversalPaymentId: null,
    submittedAt: null,
    settledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/**
 * An in-memory store that enforces the SAME uniqueness the DB does:
 * `claimAttempt` is INSERT … ON CONFLICT (note_id, period_key, attempt_number)
 * DO NOTHING, and `postSettlement` is idempotent on the PaymentIntent id (the
 * stand-in for the unique `payments.transaction_id`). If those two guarantees
 * hold, the whole engine is at-most-once.
 */
class FakeStore implements AchAutopayStore {
  attempts: AchDebitAttempt[] = [];
  notes: AutopayNote[] = [];
  mandates: AchMandate[] = [];
  /** Ordered log of side effects, so commit-then-emit ordering is provable. */
  events: string[] = [];
  postedTransactionIds = new Set<string>();
  autopayFlagWrites: Array<{ noteId: number; enabled: boolean }> = [];
  mandateStatusWrites: Array<{ mandateId: number; status: string }> = [];
  reversalsPosted = 0;
  private nextAttemptId = 1;
  private nextPaymentId = 500;

  async listAutopayDueNotes(through: Date): Promise<AutopayNote[]> {
    return this.notes.filter(
      (n) =>
        n.status === "active" &&
        n.autoPayEnabled === true &&
        n.nextPaymentDate != null &&
        n.nextPaymentDate.getTime() <= through.getTime(),
    );
  }

  async getNote(noteId: number): Promise<AutopayNote | null> {
    return this.notes.find((n) => n.id === noteId) ?? null;
  }

  async getActiveMandateForNote(noteId: number): Promise<AchMandate | null> {
    return this.mandates.find((m) => m.noteId === noteId && m.status === "active") ?? null;
  }

  async getMandateById(mandateId: number): Promise<AchMandate | null> {
    return this.mandates.find((m) => m.id === mandateId) ?? null;
  }

  async listAttemptsForPeriod(noteId: number, periodKey: string): Promise<AchDebitAttempt[]> {
    return this.attempts
      .filter((a) => a.noteId === noteId && a.periodKey === periodKey)
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
  }

  async claimAttempt(input: ClaimAttemptInput): Promise<AchDebitAttempt | null> {
    const clash = this.attempts.some(
      (a) =>
        a.noteId === input.noteId &&
        a.periodKey === input.periodKey &&
        a.attemptNumber === input.attemptNumber,
    );
    if (clash) {
      this.events.push("claimLost");
      return null;
    }
    const row = makeAttemptRow(input, this.nextAttemptId++);
    this.attempts.push(row);
    this.events.push("claimWon");
    return row;
  }

  async markAttemptSubmitted(attemptId: number, paymentIntentId: string, submittedAt: Date) {
    this.patch(attemptId, { status: "submitted", processorPaymentIntentId: paymentIntentId, submittedAt });
  }

  async markAttemptFailed(attemptId: number, failureReason: string) {
    this.patch(attemptId, { status: "failed", failureReason });
  }

  async markAttemptCanceled(attemptId: number, reason: string) {
    this.patch(attemptId, { status: "canceled", failureReason: reason });
  }

  async listInFlightAttempts(limit: number): Promise<AchDebitAttempt[]> {
    return this.attempts
      .filter((a) => ["created", "submitted", "processing"].includes(a.status))
      .slice(0, limit);
  }

  async recordReturn(input: {
    attemptId: number;
    returnCode: { code: string; category: string; description: string };
    returnedAt: Date;
    disposition: { nextRetryAt: Date | null };
    reversalPaymentId: number | null;
  }) {
    this.events.push("recordReturn");
    this.patch(input.attemptId, {
      status: "returned",
      returnCode: input.returnCode.code,
      returnCategory: input.returnCode.category,
      returnedAt: input.returnedAt,
      nextRetryAt: input.disposition.nextRetryAt,
      reversalPaymentId: input.reversalPaymentId,
    });
  }

  async postSettlement(input: PostSettlementInput): Promise<PostSettlementResult> {
    // The whole point: this resolves only once the "transaction" has committed.
    const created = !this.postedTransactionIds.has(input.paymentIntentId);
    if (created) this.postedTransactionIds.add(input.paymentIntentId);
    this.events.push(created ? "postSettlement:created" : "postSettlement:duplicate");
    return {
      paymentId: this.nextPaymentId,
      created,
      amountCents: input.attempt.amountCents,
      principalCents: input.attempt.amountCents - 700,
      interestCents: 700,
      lateFeeCents: 0,
      remainingBalanceCents: 9_900_000,
      dueDate: input.attempt.dueDate,
      paymentDate: input.settledAt,
    };
  }

  async postReversal(input: PostReversalInput): Promise<PostReversalResult> {
    this.reversalsPosted += 1;
    this.events.push("postReversal");
    return { reversalPaymentId: 900, created: true };
  }

  async setMandateStatus(mandateId: number, status: "revoked" | "invalid") {
    this.mandateStatusWrites.push({ mandateId, status });
    const m = this.mandates.find((x) => x.id === mandateId);
    if (m) m.status = status;
  }

  async setAutopayEnabled(noteId: number, _organizationId: number, enabled: boolean) {
    this.autopayFlagWrites.push({ noteId, enabled });
    const n = this.notes.find((x) => x.id === noteId);
    if (n) n.autoPayEnabled = enabled;
  }

  async markAttemptSettled(attemptId: number, paymentId: number, settledAt: Date) {
    this.events.push("markAttemptSettled");
    this.patch(attemptId, { status: "succeeded", paymentId, settledAt });
  }

  private patch(attemptId: number, patch: Partial<AchDebitAttempt>) {
    const idx = this.attempts.findIndex((a) => a.id === attemptId);
    if (idx >= 0) this.attempts[idx] = { ...this.attempts[idx], ...patch };
  }
}

class FakeProcessor implements AchProcessor {
  submissions: SubmitDebitInput[] = [];
  nextState: ProcessorDebitState = { state: "pending" };
  states: ProcessorDebitState[] = [];

  async submitDebit(input: SubmitDebitInput) {
    this.submissions.push(input);
    // Stripe returns the SAME PaymentIntent for a replayed idempotency key.
    return {
      ok: true as const,
      paymentIntentId: `pi_${input.idempotencyKey}`,
      state: this.nextState,
    };
  }

  async getDebitState(): Promise<ProcessorDebitState> {
    return this.states.shift() ?? { state: "pending" };
  }
}

function makeDeps(store: FakeStore, processor: FakeProcessor, simulated = false): AchAutopayDeps & {
  emitted: Array<{ paymentId: number }>;
} {
  const emitted: Array<{ paymentId: number }> = [];
  return {
    store,
    processor,
    emitPaymentReceived: (event) => {
      store.events.push("emit");
      emitted.push({ paymentId: event.paymentId });
    },
    isSimulated: () => simulated,
    now: () => NOW,
    emitted,
  };
}

// ───────────────────────────────────────────────────────────────────────────

describe("ACH autopay — pure helpers", () => {
  it("derives the period key from the due date's UTC day", () => {
    expect(periodKeyForDueDate(DUE)).toBe("2026-08-01");
  });

  it("builds a deterministic idempotency key per (note, period, attempt)", () => {
    expect(idempotencyKeyFor(42, "2026-08-01", 1)).toBe("ach:note:42:2026-08-01:a1");
    // The attempt number is part of the key — a permitted re-presentment is a
    // DIFFERENT debit, not a retry of the same one.
    expect(idempotencyKeyFor(42, "2026-08-01", 2)).toBe("ach:note:42:2026-08-01:a2");
  });

  it("sums payment + service fee + escrow with independent cent rounding", () => {
    expect(scheduledDebitAmountCents(makeNote())).toBe(102_500);
    expect(
      scheduledDebitAmountCents(makeNote({ taxEscrowEnabled: true, monthlyTaxEscrow: "83.34" })),
    ).toBe(110_834);
  });

  it("states who debits, how much, how often, and how to cancel", () => {
    const text = buildAuthorizationText({
      lenderName: "Acme Land Co",
      amountCents: 117_875,
      scheduleDescription: "monthly, on the 1st of each month",
      noteReference: "Note #42",
    });
    expect(text).toContain("Acme Land Co");
    expect(text).toContain("$1,178.75");
    expect(text).toContain("monthly, on the 1st of each month");
    expect(text.toLowerCase()).toContain("cancel");
  });
});

describe("ACH autopay — a debit requires a stored authorization", () => {
  let store: FakeStore;
  let processor: FakeProcessor;

  beforeEach(() => {
    store = new FakeStore();
    processor = new FakeProcessor();
  });

  it("REFUSES and never contacts the processor when no mandate exists", async () => {
    const note = makeNote();
    store.notes.push(note);
    // Deliberately no mandate row.
    const deps = makeDeps(store, processor);

    const outcome = await submitDebitForNote(deps, note, NOW);

    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toBe("no_mandate");
    expect(processor.submissions).toHaveLength(0);
    expect(store.attempts).toHaveLength(0);
  });

  it("REFUSES when the stored mandate is only pending (bank not confirmed)", async () => {
    const note = makeNote();
    store.notes.push(note);
    store.mandates.push(makeMandate({ status: "pending", confirmedAt: null }));
    const deps = makeDeps(store, processor);

    const outcome = await submitDebitForNote(deps, note, NOW);

    expect(outcome.reason).toBe("no_mandate"); // no ACTIVE mandate is visible at all
    expect(processor.submissions).toHaveLength(0);
  });

  it("REFUSES when the amount exceeds the authorized ceiling", async () => {
    const note = makeNote({ monthlyPayment: "5000.00" });
    store.notes.push(note);
    store.mandates.push(makeMandate({ maxAmountCents: 110_000 }));
    const deps = makeDeps(store, processor);

    const outcome = await submitDebitForNote(deps, note, NOW);

    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toBe("amount_exceeds_mandate");
    expect(processor.submissions).toHaveLength(0);
  });

  it("REFUSES when a revoked mandate is the only record", () => {
    const result = evaluateDebitEligibility({
      note: makeNote(),
      mandate: makeMandate({ status: "revoked" }),
      amountCents: 102_500,
      now: NOW,
      priorAttempts: 0,
    });
    expect(result).toMatchObject({ eligible: false, reason: "mandate_not_active" });
  });

  it("REFUSES a mandate belonging to a different note", () => {
    const result = evaluateDebitEligibility({
      note: makeNote({ id: 42 }),
      mandate: makeMandate({ noteId: 43 }),
      amountCents: 102_500,
      now: NOW,
      priorAttempts: 0,
    });
    expect(result).toMatchObject({ eligible: false, reason: "mandate_wrong_note" });
  });
});

describe("ACH autopay — autopay off means no debit", () => {
  it("REFUSES a note whose autopay flag is off, even with an active mandate", async () => {
    const store = new FakeStore();
    const processor = new FakeProcessor();
    const note = makeNote({ autoPayEnabled: false });
    store.notes.push(note);
    store.mandates.push(makeMandate());
    const deps = makeDeps(store, processor);

    const outcome = await submitDebitForNote(deps, note, NOW);

    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toBe("autopay_disabled");
    expect(processor.submissions).toHaveLength(0);
    expect(store.attempts).toHaveLength(0);
  });

  it("never even scans a note with autopay off in the full cycle", async () => {
    const store = new FakeStore();
    const processor = new FakeProcessor();
    store.notes.push(makeNote({ id: 1, autoPayEnabled: false }));
    store.notes.push(makeNote({ id: 2, autoPayEnabled: null }));
    store.mandates.push(makeMandate({ id: 11, noteId: 1 }));
    store.mandates.push(makeMandate({ id: 12, noteId: 2 }));

    const result = await submitDueDebits(makeDeps(store, processor));

    expect(result.scanned).toBe(0);
    expect(result.submitted).toBe(0);
    expect(processor.submissions).toHaveLength(0);
  });

  it("creates NOTHING under simulation mode", async () => {
    const store = new FakeStore();
    const processor = new FakeProcessor();
    store.notes.push(makeNote());
    store.mandates.push(makeMandate());

    const result = await submitDueDebits(makeDeps(store, processor, /* simulated */ true));

    expect(result.submitted).toBe(0);
    expect(result.scanned).toBe(0);
    expect(processor.submissions).toHaveLength(0);
    expect(store.attempts).toHaveLength(0);
  });

  it("REFUSES a note that is not yet due", async () => {
    const store = new FakeStore();
    const processor = new FakeProcessor();
    const note = makeNote({ nextPaymentDate: new Date("2026-09-01T00:00:00.000Z") });
    store.notes.push(note);
    store.mandates.push(makeMandate());

    const outcome = await submitDebitForNote(makeDeps(store, processor), note, NOW);

    expect(outcome.reason).toBe("not_yet_due");
    expect(processor.submissions).toHaveLength(0);
  });
});

describe("ACH autopay — IDEMPOTENCY: exactly one debit per (note, period)", () => {
  let store: FakeStore;
  let processor: FakeProcessor;
  let deps: AchAutopayDeps;
  let note: AutopayNote;

  beforeEach(() => {
    store = new FakeStore();
    processor = new FakeProcessor();
    note = makeNote();
    store.notes.push(note);
    store.mandates.push(makeMandate());
    deps = makeDeps(store, processor);
  });

  it("a DOUBLE SUBMIT produces ONE debit (second call is refused as already-attempted)", async () => {
    const first = await submitDebitForNote(deps, note, NOW);
    const second = await submitDebitForNote(deps, note, NOW);

    expect(first.status).toBe("submitted");
    expect(second.status).toBe("refused");
    expect(second.reason).toBe("already_attempted");
    expect(processor.submissions).toHaveLength(1);
    expect(store.attempts).toHaveLength(1);
  });

  it("CONCURRENT submits produce ONE debit — the claim loser never reaches the processor", async () => {
    const [a, b] = await Promise.all([
      submitDebitForNote(deps, note, NOW),
      submitDebitForNote(deps, note, NOW),
    ]);

    const submitted = [a, b].filter((o) => o.status === "submitted");
    const refused = [a, b].filter((o) => o.status === "refused");
    expect(submitted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toBe("already_attempted");
    expect(processor.submissions).toHaveLength(1);
    expect(store.attempts).toHaveLength(1);
    expect(store.events.filter((e) => e === "claimLost")).toHaveLength(1);
  });

  it("a JOB RE-RUN over the same due note produces ONE debit", async () => {
    const first = await submitDueDebits(deps);
    const second = await submitDueDebits(deps);

    expect(first.submitted).toBe(1);
    expect(second.submitted).toBe(0);
    expect(second.refused).toBe(1);
    expect(processor.submissions).toHaveLength(1);
  });

  it("replays the SAME idempotency key to the processor as the claimed row carries", async () => {
    await submitDebitForNote(deps, note, NOW);
    expect(processor.submissions[0].idempotencyKey).toBe("ach:note:42:2026-08-01:a1");
    expect(store.attempts[0].idempotencyKey).toBe(processor.submissions[0].idempotencyKey);
  });

  it("a CRASH between claim and submit is recovered as a cancel, not a second live debit", async () => {
    // Reconciliation sees a `created` attempt with no PaymentIntent — the exact
    // residue of a crash after the claim. It must cancel the claim (so the
    // period is not wedged) and must never invent a settlement.
    const { reconcileInFlightDebits } = await import("../../server/services/achAutopay");
    await store.claimAttempt({
      organizationId: note.organizationId,
      noteId: note.id,
      mandateId: 5,
      periodKey: "2026-08-01",
      attemptNumber: 1,
      idempotencyKey: idempotencyKeyFor(note.id, "2026-08-01", 1),
      amountCents: 102_500,
      dueDate: DUE,
      retryOfAttemptId: null,
    });

    await reconcileInFlightDebits(deps);

    expect(store.attempts[0].status).toBe("canceled");
    expect(store.postedTransactionIds.size).toBe(0);
    expect(processor.submissions).toHaveLength(0);
  });

  it("a settlement processed TWICE posts one ledger row and emits once", async () => {
    await submitDebitForNote(deps, note, NOW);
    const attempt = store.attempts[0];
    const settled: ProcessorDebitState = { state: "succeeded", chargeId: "ch_1" };

    await applyProcessorState(deps, attempt, settled, NOW);
    await applyProcessorState(deps, store.attempts[0], settled, NOW);

    expect(store.events.filter((e) => e === "postSettlement:created")).toHaveLength(1);
    expect(store.events.filter((e) => e === "postSettlement:duplicate")).toHaveLength(1);
    expect(store.events.filter((e) => e === "emit")).toHaveLength(1);
  });

  it("never exceeds the NACHA presentment limit for a period", () => {
    const result = evaluateDebitEligibility({
      note: makeNote(),
      mandate: makeMandate(),
      amountCents: 102_500,
      now: NOW,
      priorAttempts: MAX_ATTEMPTS_PER_PERIOD,
      nextRetryAt: new Date(NOW.getTime() - 1000),
    });
    expect(result).toMatchObject({ eligible: false, reason: "max_attempts_exhausted" });
  });
});

describe("ACH autopay — payment.received is emitted only AFTER the commit", () => {
  let store: FakeStore;
  let processor: FakeProcessor;

  beforeEach(() => {
    store = new FakeStore();
    processor = new FakeProcessor();
    store.notes.push(makeNote());
    store.mandates.push(makeMandate());
  });

  it("emits strictly after postSettlement resolves and after the attempt is linked", async () => {
    const deps = makeDeps(store, processor);
    await submitDebitForNote(deps, makeNote(), NOW);
    store.events.length = 0;

    await applyProcessorState(deps, store.attempts[0], { state: "succeeded", chargeId: "ch_1" }, NOW);

    expect(store.events).toEqual([
      "postSettlement:created",
      "markAttemptSettled",
      "emit",
    ]);
  });

  it("does NOT emit on the duplicate branch (nothing was created)", async () => {
    const deps = makeDeps(store, processor);
    await submitDebitForNote(deps, makeNote(), NOW);
    // Pre-poison the ledger so postSettlement reports created: false.
    store.postedTransactionIds.add(`pi_ach:note:42:2026-08-01:a1`);
    store.events.length = 0;

    await applyProcessorState(deps, store.attempts[0], { state: "succeeded", chargeId: "ch_1" }, NOW);

    expect(store.events).toEqual(["postSettlement:duplicate", "markAttemptSettled"]);
    expect(store.events).not.toContain("emit");
  });

  it("does NOT emit while the debit is still in flight", async () => {
    const deps = makeDeps(store, processor);
    await submitDebitForNote(deps, makeNote(), NOW);
    store.events.length = 0;

    const applied = await applyProcessorState(deps, store.attempts[0], { state: "pending" }, NOW);

    expect(applied).toBe("pending");
    expect(store.events).not.toContain("emit");
    expect(store.postedTransactionIds.size).toBe(0);
  });

  it("does NOT emit for an unrecognised processor state — it stays in flight", async () => {
    const deps = makeDeps(store, processor);
    await submitDebitForNote(deps, makeNote(), NOW);
    store.events.length = 0;

    const applied = await applyProcessorState(
      deps,
      store.attempts[0],
      { state: "unknown", detail: "some_new_stripe_status" },
      NOW,
    );

    expect(applied).toBe("pending");
    expect(store.events).toEqual([]);
  });
});

describe("ACH autopay — returns (NSF) never fabricate a reversal", () => {
  it("posts NO reversal when the returned debit had never posted", async () => {
    const store = new FakeStore();
    const processor = new FakeProcessor();
    store.notes.push(makeNote());
    store.mandates.push(makeMandate());
    const deps = makeDeps(store, processor);
    await submitDebitForNote(deps, makeNote(), NOW);

    // paymentId is still null — nothing was ever posted to the ledger.
    await applyReturn(deps, store.attempts[0], classifyAchReturn("R01"), NOW, "pi_x");

    expect(store.reversalsPosted).toBe(0);
    expect(store.attempts[0].status).toBe("returned");
    expect(store.attempts[0].returnCode).toBe("R01");
  });

  it("posts exactly one reversal when the debit HAD posted", async () => {
    const store = new FakeStore();
    const processor = new FakeProcessor();
    store.notes.push(makeNote());
    store.mandates.push(makeMandate());
    const deps = makeDeps(store, processor);
    await submitDebitForNote(deps, makeNote(), NOW);
    store.attempts[0] = { ...store.attempts[0], paymentId: 500 };

    await applyReturn(deps, store.attempts[0], classifyAchReturn("R01"), NOW, "pi_x");

    expect(store.reversalsPosted).toBe(1);
  });

  it("R01 (insufficient funds) schedules a bounded re-presentment and leaves autopay on", () => {
    const disposition = planReturnDisposition({
      returnCode: classifyAchReturn("R01"),
      attemptNumber: 1,
      returnedAt: NOW,
    });
    expect(disposition.retry).toBe(true);
    expect(disposition.nextRetryAt).toBeInstanceOf(Date);
    expect(disposition.disableAutopay).toBe(false);
    expect(disposition.revokeMandate).toBe(false);
  });

  it("R10 (unauthorized) revokes the mandate AND turns autopay off", async () => {
    const store = new FakeStore();
    const processor = new FakeProcessor();
    store.notes.push(makeNote());
    store.mandates.push(makeMandate());
    const deps = makeDeps(store, processor);
    await submitDebitForNote(deps, makeNote(), NOW);

    await applyReturn(deps, store.attempts[0], classifyAchReturn("R10"), NOW, "pi_x");

    expect(store.mandateStatusWrites).toEqual([{ mandateId: 5, status: "revoked" }]);
    expect(store.autopayFlagWrites).toEqual([{ noteId: 42, enabled: false }]);
    // And with autopay off + mandate revoked, the next cycle debits nothing.
    const result = await submitDueDebits(deps);
    expect(result.submitted).toBe(0);
    expect(processor.submissions).toHaveLength(1); // still just the original
  });

  it("R02 (account closed) invalidates the instrument and turns autopay off", async () => {
    const store = new FakeStore();
    const processor = new FakeProcessor();
    store.notes.push(makeNote());
    store.mandates.push(makeMandate());
    const deps = makeDeps(store, processor);
    await submitDebitForNote(deps, makeNote(), NOW);

    await applyReturn(deps, store.attempts[0], classifyAchReturn("R02"), NOW, "pi_x");

    expect(store.mandateStatusWrites).toEqual([{ mandateId: 5, status: "invalid" }]);
    expect(store.autopayFlagWrites).toEqual([{ noteId: 42, enabled: false }]);
  });
});
