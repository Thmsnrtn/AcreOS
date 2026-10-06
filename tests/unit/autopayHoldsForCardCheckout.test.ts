/**
 * autopayHoldsForCardCheckout.test.ts — autopay does not debit a note whose
 * borrower may be paying the same installment by card, and does not debit
 * through a rail that was deleted.
 *
 * DEFECT-0265 (4), the open ordering (W10.5): the card checkout refuses while
 * an ACH debit is in flight, but autopay eligibility never looked for a card
 * Checkout in progress (`notes.pendingCheckoutSessionId`, written by
 * routes-borrower.ts when the borrower opens Checkout, cleared by the posting
 * when THAT session's payment posts). A debit started while the borrower was
 * on the card page could pay the installment twice.
 *
 * A Stripe Checkout session lives 24h (the builder sets no `expires_at`), and
 * Stripe re-delivers a completed session's webhook for up to three days. The
 * slot carries its own timestamp, `notes.pending_checkout_opened_at` (0261),
 * written and cleared with it: a slot opened more than 24h + 72h ago cannot
 * name a session that is still open or still being posted.
 *
 * The first draft bounded the slot by `notes.updated_at`. The dunning job and
 * the reminder sender refresh that daily on a past-due note, so one abandoned
 * Checkout held every debit forever (W10.5 audit). A slot written before 0261
 * has no stamp and is not held — exactly as before the hold existed.
 *
 * Also W10.5: the Actum rail was deleted 2026-07-29. A stored mandate on any
 * rail other than the one this engine implements is refused with that reason —
 * never debited through Stripe as if it were a Stripe mandate.
 */
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  submitDueDebits,
  evaluateDebitEligibility,
  type AchAutopayDeps,
  type AchAutopayStore,
  type AchProcessor,
  type AutopayNote,
  type ClaimAttemptInput,
  type SubmitDebitInput,
} from "../../server/services/achAutopay";
import type { AchDebitAttempt, AchMandate } from "@shared/schema/ach-autopay";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const NOW = new Date("2026-08-01T12:00:00.000Z");
const DUE = new Date("2026-08-01T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

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
    pendingCheckoutSessionId: null,
    pendingCheckoutOpenedAt: null,
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
    authorizationChallengeId: null,
    revokedAt: null,
    revokedReason: null,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-20T00:05:00.000Z"),
    ...overrides,
  };
}

/** Just enough store: one note, one mandate, attempts claimed in memory. */
function harness(note: AutopayNote, mandate: AchMandate = makeMandate()) {
  const claims: ClaimAttemptInput[] = [];
  const submissions: SubmitDebitInput[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("not used by the submit cycle");
  };
  const store: AchAutopayStore = {
    listAutopayDueNotes: async () => [note],
    lenderServicingPhase: async () => ({ phase: "full" }),
    getNote: async () => note,
    getActiveMandateForNote: async () => mandate,
    getMandateById: async () => mandate,
    listAttemptsForPeriod: async () => [],
    claimAttempt: async (input) => {
      claims.push(input);
      return {
        id: claims.length,
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
      } satisfies AchDebitAttempt;
    },
    markAttemptSubmitted: async () => {},
    markAttemptFailed: async () => {},
    markAttemptCanceled: async () => {},
    listInFlightAttempts: async () => [],
    recordReturn: async () => {},
    postSettlement: unused,
    postReversal: unused,
    setMandateStatus: async () => {},
    setAutopayEnabled: async () => {},
    markAttemptSettled: async () => {},
  };
  const processor: AchProcessor = {
    submitDebit: async (input) => {
      submissions.push(input);
      return { ok: true, paymentIntentId: `pi_${input.idempotencyKey}`, state: { state: "pending" } };
    },
    getDebitState: async () => ({ state: "pending" }),
  };
  const deps: AchAutopayDeps = {
    store,
    processor,
    emitPaymentReceived: () => {},
    isSimulated: () => false,
    now: () => NOW,
  };
  return { deps, claims, submissions };
}

describe("autopay holds while a card Checkout may be paying the installment", () => {
  it("refuses — before any claim or processor call — when the borrower opened Checkout an hour ago", async () => {
    const h = harness(
      makeNote({ pendingCheckoutSessionId: "cs_live_open", pendingCheckoutOpenedAt: new Date(NOW.getTime() - HOUR) }),
    );
    const cycle = await submitDueDebits(h.deps);
    expect(cycle.submitted).toBe(0);
    expect(cycle.refused).toBe(1);
    expect(cycle.outcomes[0]).toMatchObject({ status: "refused", reason: "card_checkout_in_progress" });
    expect(cycle.outcomes[0].message).toMatch(/card/i);
    expect(h.claims).toHaveLength(0);
    expect(h.submissions).toHaveLength(0);
  });

  it("still refuses after the session's 24h life while Stripe may still deliver its completion (3 days)", async () => {
    const h = harness(
      makeNote({ pendingCheckoutSessionId: "cs_live_maybe_paid", pendingCheckoutOpenedAt: new Date(NOW.getTime() - 72 * HOUR) }),
    );
    const cycle = await submitDueDebits(h.deps);
    expect(cycle.outcomes[0]).toMatchObject({ status: "refused", reason: "card_checkout_in_progress" });
    expect(h.submissions).toHaveLength(0);
  });

  it("a slot written before it carried a timestamp is not held — no slot can block autopay forever", async () => {
    const h = harness(makeNote({ pendingCheckoutSessionId: "cs_live_pre_0261", pendingCheckoutOpenedAt: null }));
    const cycle = await submitDueDebits(h.deps);
    expect(cycle.outcomes[0]).toMatchObject({ status: "submitted" });
    expect(h.submissions).toHaveLength(1);
  });

  it("the bound is the slot's OWN stamp: a row the dunning job touched an hour ago still debits 97h after Checkout opened", async () => {
    // The audit's scenario: updated_at refreshed daily on a past-due note.
    const note = { ...makeNote({ pendingCheckoutSessionId: "cs_live_abandoned", pendingCheckoutOpenedAt: new Date(NOW.getTime() - 97 * HOUR) }), updatedAt: new Date(NOW.getTime() - HOUR) };
    const h = harness(note as AutopayNote);
    const cycle = await submitDueDebits(h.deps);
    expect(cycle.outcomes[0]).toMatchObject({ status: "submitted" });
  });

  it("holds while the stamp is in the future (clock skew is not evidence of age)", async () => {
    const h = harness(
      makeNote({ pendingCheckoutSessionId: "cs_live_skew", pendingCheckoutOpenedAt: new Date(NOW.getTime() + HOUR) }),
    );
    const cycle = await submitDueDebits(h.deps);
    expect(cycle.outcomes[0]).toMatchObject({ status: "refused", reason: "card_checkout_in_progress" });
  });

  it("debits once the slot is provably older than the session's life plus the webhook retry window", async () => {
    const h = harness(
      makeNote({ pendingCheckoutSessionId: "cs_live_abandoned", pendingCheckoutOpenedAt: new Date(NOW.getTime() - 97 * HOUR) }),
    );
    const cycle = await submitDueDebits(h.deps);
    expect(cycle.outcomes[0]).toMatchObject({ status: "submitted" });
    expect(h.submissions).toHaveLength(1);
  });

  it("debits normally with no Checkout slot", async () => {
    const h = harness(makeNote({ pendingCheckoutSessionId: null, pendingCheckoutOpenedAt: new Date(NOW.getTime() - HOUR) }));
    const cycle = await submitDueDebits(h.deps);
    expect(cycle.outcomes[0]).toMatchObject({ status: "submitted" });
    expect(h.submissions).toHaveLength(1);
  });

  it("the pure gate answers the same (one rule, not a cycle-only check)", () => {
    const r = evaluateDebitEligibility({
      note: makeNote({ pendingCheckoutSessionId: "cs_live_open", pendingCheckoutOpenedAt: new Date(NOW.getTime() - HOUR) }),
      mandate: makeMandate(),
      amountCents: 102_500,
      now: NOW,
      priorAttempts: 0,
    });
    expect(r).toMatchObject({ eligible: false, reason: "card_checkout_in_progress" });
  });
});

describe("autopay refuses a stored mandate on a deleted rail", () => {
  it("an `actum` mandate is refused with the reason, never sent to Stripe as if it were a Stripe mandate", async () => {
    const h = harness(makeNote(), makeMandate({ rail: "actum" }));
    const cycle = await submitDueDebits(h.deps);
    expect(cycle.outcomes[0]).toMatchObject({ status: "refused", reason: "mandate_rail_unsupported" });
    expect(cycle.outcomes[0].message).toMatch(/actum/);
    expect(h.claims).toHaveLength(0);
    expect(h.submissions).toHaveLength(0);
  });

  it("any rail other than the implemented one is refused (not just the literal `actum`)", () => {
    const r = evaluateDebitEligibility({
      note: makeNote(),
      mandate: makeMandate({ rail: "ach_actum" }),
      amountCents: 102_500,
      now: NOW,
      priorAttempts: 0,
    });
    expect(r).toMatchObject({ eligible: false, reason: "mandate_rail_unsupported" });
  });
});

// ── The bound rests on one property of the writers ─────────────────────────
// The slot's stamp bounds it only if every write that PUTS a session id in the
// slot writes the stamp in the same statement (and every clear clears both).
// A writer that set the slot without it would leave the session unbounded —
// read as "written before 0261" and not held — so the shapes are pinned here.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("the Checkout slot's writers stamp its opened-at time", () => {
  const files = walk("server");

  it("reads the server tree", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("every write of a session id into the slot goes through storage.updateNote", () => {
    const hits: string[] = [];
    const bad: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, "utf8"));
      for (const line of code.split("\n")) {
        // Any property write or assignment of a value into the slot — except a
        // clear to null, a type annotation, and a column reference/definition
        // (`notes.pendingCheckoutSessionId`, `text(…)`, `z.string()`).
        const m = /pendingCheckoutSessionId\??\s*(?::|=(?!=))\s*(.*)$/.exec(line);
        if (m && !/^(null\b|string\b|notes\.|text\(|z\.)/.test(m[1].trim())) {
          hits.push(`${f}: ${line.trim()}`);
          if (!/storage\.updateNote\(/.test(line) || !/pendingCheckoutOpenedAt:\s*new Date\(\)/.test(line)) bad.push(`${f}: ${line.trim()}`);
        }
      }
    }
    // Vacuity: the two Checkout routes in routes-borrower.ts.
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(bad).toEqual([]);
  });

  it("no raw SQL writes the column", () => {
    const raw = files.filter((f) => /pending_checkout_session_id/.test(stripComments(readFileSync(f, "utf8"))));
    expect(raw).toEqual([]);
  });

  it("the posting clears the stamp with the slot, against the LOCKED row", () => {
    const code = stripComments(readFileSync("server/services/borrower/portalPaymentPosting.ts", "utf8"));
    expect(code).toMatch(
      /if \(lockedNote\.pendingCheckoutSessionId === transactionId\) \{\s*notePatch\.pendingCheckoutSessionId = null;\s*notePatch\.pendingCheckoutOpenedAt = null;/,
    );
  });
});
