/**
 * A Stripe refund reaches financial_ledger even when the recognition GL post
 * fails, and a GL failure is never silent.
 *
 * THE DEFECT (G4 money-lifecycle proof, staging, 2026-10-21): a full $49
 * refund succeeded at Stripe and `charge.refunded` was claimed, yet no refund
 * row ever landed in financial_ledger, so the org still netted +4900¢.
 * processChargeRefunded awaited recordStripeChargeRefunded (the recognition GL
 * post) BEFORE postRefund (the financial_ledger post), inside one try/catch.
 * The GL post threw (no chart of accounts), the catch swallowed it, postRefund
 * never ran, and nothing was dead-lettered.
 *
 * Driven through the REAL handler with only its collaborators mocked, so a
 * reordering, a re-merged try, or a catch that drops the dead letter fails
 * here. The vacuity case first: with both posts healthy, both run and nothing
 * is dead-lettered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = { id: 41 };

const recognition = vi.hoisted(() => ({ recordStripeChargeRefunded: vi.fn() }));
vi.mock("../../server/services/recognitionWorker", () => recognition);

const ledger = vi.hoisted(() => ({ postRefund: vi.fn() }));
vi.mock("../../server/services/financial-ledger", () => ledger);

const dlq = vi.hoisted(() => ({ recordLedgerDeadLetter: vi.fn(async () => true) }));
vi.mock("../../server/services/ledgerDeadLetter", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/services/ledgerDeadLetter")>();
  return { ...real, recordLedgerDeadLetter: dlq.recordLedgerDeadLetter };
});

const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({ logger: log }));

vi.mock("../../server/services/creatorProgram", () => ({ voidCreatorConversionForInvoice: vi.fn(async () => undefined) }));
vi.mock("../../server/storage", () => ({
  storage: { getOrganizationByStripeCustomerId: vi.fn(async () => ORG) },
}));

import { WebhookHandlers } from "../../server/webhookHandlers";

/** A fully refunded $49 charge, as staging's G4 run produced it. */
function fullRefund(): any {
  return {
    id: "ch_g4",
    customer: "cus_g4",
    amount: 4900,
    amount_refunded: 4900,
    refunded: false, // skip the creator-conversion branch; not under test
    invoice: "in_g4",
    refunds: { data: [{ id: "re_g4" }] },
  };
}

beforeEach(() => {
  recognition.recordStripeChargeRefunded.mockReset().mockResolvedValue({ posted: true, legs: 2 });
  ledger.postRefund.mockReset().mockResolvedValue({ row: null, inserted: true });
  dlq.recordLedgerDeadLetter.mockClear();
  log.error.mockClear();
});

describe("charge.refunded posts the financial_ledger refund whatever the GL does", () => {
  it("VACUITY: with both posts healthy, both run and nothing is dead-lettered", async () => {
    await WebhookHandlers.processChargeRefunded(fullRefund());
    expect(recognition.recordStripeChargeRefunded).toHaveBeenCalledTimes(1);
    expect(ledger.postRefund).toHaveBeenCalledTimes(1);
    expect(dlq.recordLedgerDeadLetter).not.toHaveBeenCalled();
  });

  it("(a) the GL post throws → the financial_ledger refund still posts, in full", async () => {
    recognition.recordStripeChargeRefunded.mockRejectedValue(
      new Error("recognitionWorker: org 41 has no 1000 (Cash) account; seed chart_of_accounts first."),
    );
    await WebhookHandlers.processChargeRefunded(fullRefund());
    expect(ledger.postRefund).toHaveBeenCalledTimes(1);
    expect(ledger.postRefund).toHaveBeenCalledWith({
      organizationId: 41,
      amountCents: 4900,
      externalEventId: "stripe:refund:re_g4",
      originalRevenueEventId: "stripe:invoice:in_g4",
    });
  });

  it("(b) the GL failure is dead-lettered as gl_refund with its replayable args, and logged at error", async () => {
    const glErr = new Error("recognitionWorker: org 41 has no 1000 (Cash) account; seed chart_of_accounts first.");
    recognition.recordStripeChargeRefunded.mockRejectedValue(glErr);
    await WebhookHandlers.processChargeRefunded(fullRefund());

    const calls = dlq.recordLedgerDeadLetter.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: "gl_refund",
      externalEventId: "gl:charge.refunded:ch_g4",
      organizationId: 41,
      error: glErr,
    });
    // The payload IS the GL post's own argument, so the replay re-runs the
    // identical (idempotent) call.
    expect(calls[0].payload).toEqual(recognition.recordStripeChargeRefunded.mock.calls[0][0]);
    expect(calls[0].payload).toMatchObject({ chargeId: "ch_g4", organizationId: 41, amountRefundedCents: 4900 });
    expect(log.error).toHaveBeenCalled();
  });

  it("both posts fail → two distinct dead letters, neither masks the other", async () => {
    recognition.recordStripeChargeRefunded.mockRejectedValue(new Error("gl down"));
    ledger.postRefund.mockRejectedValue(new Error("ledger down"));
    await WebhookHandlers.processChargeRefunded(fullRefund());
    const keys = dlq.recordLedgerDeadLetter.mock.calls.map((c: any[]) => [c[0].kind, c[0].externalEventId]);
    expect(keys).toEqual([
      ["gl_refund", "gl:charge.refunded:ch_g4"],
      ["refund", "stripe:refund:re_g4"],
    ]);
  });

  it("the ledger post fails while the GL succeeds → only the ledger refund is dead-lettered", async () => {
    ledger.postRefund.mockRejectedValue(new Error("ledger down"));
    await WebhookHandlers.processChargeRefunded(fullRefund());
    const kinds = dlq.recordLedgerDeadLetter.mock.calls.map((c: any[]) => c[0].kind);
    expect(kinds).toEqual(["refund"]);
  });
});
