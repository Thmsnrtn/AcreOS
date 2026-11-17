/**
 * B-2 — borrower chargebacks on the lender's OWN connected account.
 *
 * Before this wire, the Connect endpoint subscribed to no dispute events:
 * Stripe clawed a disputed borrower payment back while the AcreOS ledger
 * stood serene and the lender was never told. These suites run the REAL
 * handler + escalation sweep against injected seams (the outbox-reaper DI
 * pattern), so every leg is proven without a database or a Stripe account:
 *
 *   created  → the ledger row is flagged (dispute_* only), the founder is
 *              alerted, the lender is notified, response.by is recorded;
 *   updated  → the flag syncs silently (the sweep owns deadline pressure);
 *   closed   → the outcome is recorded + raised — and NO reversal is ever
 *              posted: every write the handler can make is asserted to
 *              carry dispute_* keys only, because reversal stays a
 *              founder/lender judgment (drills record B-2);
 *   refusals → a dispute that is not a borrower payment is left alone; a
 *              borrower payment with no ledger row pages the founder
 *              instead of passing silently; an org mismatch writes nothing;
 *   sweep    → T-72h fires once, T-24h fires once (overdue included), a
 *              dispute first seen inside 24h fires the 24h tier only, and
 *              a failed tier is not stamped (it retries next run).
 */
import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import {
  processBorrowerChargeDispute,
  runConnectDisputeEscalationSweep,
  type ConnectDisputeDeps,
  type DisputeFlagPatch,
  type OpenDisputeRow,
} from "../../server/services/connectDisputes";

const NOW = new Date("2026-11-17T12:00:00.000Z");
const DUE_BY = new Date("2026-11-27T12:00:00.000Z"); // NOW + 10 days

function makeDispute(overrides: Partial<Stripe.Dispute> = {}): Stripe.Dispute {
  return {
    id: "dp_test_123",
    object: "dispute",
    amount: 8000,
    charge: "ch_test_123",
    payment_intent: "pi_test_123",
    reason: "fraudulent",
    status: "needs_response",
    created: Math.floor(NOW.getTime() / 1000),
    currency: "usd",
    evidence_details: { due_by: Math.floor(DUE_BY.getTime() / 1000), has_evidence: false, past_due: false, submission_count: 0 },
    is_charge_refundable: true,
    livemode: false,
    metadata: {},
    ...overrides,
  } as Stripe.Dispute;
}

interface Harness {
  deps: ConnectDisputeDeps;
  patches: { paymentId: number; patch: DisputeFlagPatch }[];
  alerts: Parameters<ConnectDisputeDeps["createSystemAlert"]>[0][];
  notices: Parameters<ConnectDisputeDeps["notifyLender"]>[0][];
}

function makeHarness(overrides: Partial<ConnectDisputeDeps> = {}): Harness {
  const patches: Harness["patches"] = [];
  const alerts: Harness["alerts"] = [];
  const notices: Harness["notices"] = [];
  const deps: ConnectDisputeDeps = {
    findBorrowerSession: async () => ({ id: "cs_test_123", organizationId: 102 }),
    // The production seam is org-scoped: the row only exists inside its org.
    findPaymentBySessionId: async (_sessionId, organizationId) =>
      organizationId === 102 ? { id: 41, organizationId: 102, noteId: 53 } : null,
    findOrgIdByConnectedAccount: async () => 102,
    updatePaymentDispute: async (paymentId, _organizationId, patch) => {
      patches.push({ paymentId, patch });
    },
    createSystemAlert: async (alert) => {
      alerts.push(alert);
    },
    notifyLender: async (notice) => {
      notices.push(notice);
    },
    listOpenDisputes: async () => [],
    now: () => NOW,
    ...overrides,
  };
  return { deps, patches, alerts, notices };
}

/** The no-auto-reversal pin: a flag write may carry dispute_* keys ONLY. */
function expectDisputeKeysOnly(patch: DisputeFlagPatch) {
  const keys = Object.keys(patch);
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) {
    expect(key, `flag write carried a non-dispute key: ${key}`).toMatch(/^dispute[A-Z]/);
  }
}

describe("processBorrowerChargeDispute — created", () => {
  it("flags the ledger row with the deadline, alerts the founder, notifies the lender", async () => {
    const h = makeHarness();
    const outcome = await processBorrowerChargeDispute("charge.dispute.created", makeDispute(), "acct_lender", h.deps);

    expect(outcome).toEqual({ matched: true, paymentId: 41, noteId: 53, organizationId: 102 });

    expect(h.patches).toHaveLength(1);
    expect(h.patches[0].paymentId).toBe(41);
    expectDisputeKeysOnly(h.patches[0].patch);
    expect(h.patches[0].patch.disputeId).toBe("dp_test_123");
    expect(h.patches[0].patch.disputeStatus).toBe("needs_response");
    expect(h.patches[0].patch.disputeReason).toBe("fraudulent");
    expect(h.patches[0].patch.disputeAmountCents).toBe(8000);
    expect(h.patches[0].patch.disputeDueBy).toEqual(DUE_BY);
    expect(h.patches[0].patch.disputeOpenedAt).toEqual(NOW);
    expect(h.patches[0].patch.disputeClosedAt).toBeUndefined();

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].severity).toBe("critical");
    expect(h.alerts[0].organizationId).toBe(102);
    expect(h.alerts[0].type).toBe("borrower_charge_dispute");
    expect(h.alerts[0].message).toContain(DUE_BY.toISOString());
    expect(h.alerts[0].message).toMatch(/No ledger reversal was posted/);

    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toMatchObject({ orgId: 102, noteId: 53, disputeId: "dp_test_123", kind: "opened", amountCents: 8000, dueBy: DUE_BY });
  });

  it("still flags and raises when Stripe shows no due_by", async () => {
    const h = makeHarness();
    const dispute = makeDispute({ evidence_details: { due_by: null, has_evidence: false, past_due: false, submission_count: 0 } as Stripe.Dispute.EvidenceDetails });
    const outcome = await processBorrowerChargeDispute("charge.dispute.created", dispute, "acct_lender", h.deps);
    expect(outcome.matched).toBe(true);
    expect(h.patches[0].patch.disputeDueBy).toBeNull();
    expect(h.alerts).toHaveLength(1);
    expect(h.notices[0].dueBy).toBeNull();
  });
});

describe("processBorrowerChargeDispute — updated", () => {
  it("syncs the flag (status + moved deadline) without alerting or notifying", async () => {
    const h = makeHarness();
    const moved = new Date(DUE_BY.getTime() - 24 * 3600 * 1000);
    const dispute = makeDispute({
      status: "under_review",
      evidence_details: { due_by: Math.floor(moved.getTime() / 1000), has_evidence: true, past_due: false, submission_count: 1 } as Stripe.Dispute.EvidenceDetails,
    });
    const outcome = await processBorrowerChargeDispute("charge.dispute.updated", dispute, "acct_lender", h.deps);
    expect(outcome.matched).toBe(true);
    expect(h.patches).toHaveLength(1);
    expectDisputeKeysOnly(h.patches[0].patch);
    expect(h.patches[0].patch.disputeStatus).toBe("under_review");
    expect(h.patches[0].patch.disputeDueBy).toEqual(moved);
    expect(h.patches[0].patch.disputeOpenedAt).toBeUndefined();
    expect(h.alerts).toHaveLength(0);
    expect(h.notices).toHaveLength(0);
  });
});

describe("processBorrowerChargeDispute — closed", () => {
  it("closed WON: outcome stamped, info alert, lender told — and no reversal write exists to make", async () => {
    const h = makeHarness();
    const outcome = await processBorrowerChargeDispute("charge.dispute.closed", makeDispute({ status: "won" }), "acct_lender", h.deps);
    expect(outcome.matched).toBe(true);
    expect(h.patches).toHaveLength(1);
    expectDisputeKeysOnly(h.patches[0].patch);
    expect(h.patches[0].patch.disputeStatus).toBe("won");
    expect(h.patches[0].patch.disputeClosedAt).toEqual(NOW);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].severity).toBe("info");
    expect(h.notices[0].kind).toBe("closed_won");
  });

  it("closed LOST: warning alert says plainly the ledger still shows the payment and nothing was reversed", async () => {
    const h = makeHarness();
    await processBorrowerChargeDispute("charge.dispute.closed", makeDispute({ status: "lost" }), "acct_lender", h.deps);
    expect(h.patches).toHaveLength(1);
    expectDisputeKeysOnly(h.patches[0].patch);
    expect(h.alerts[0].severity).toBe("warning");
    expect(h.alerts[0].message).toMatch(/NO reversal was posted automatically/);
    expect(h.notices[0].kind).toBe("closed_lost");
  });
});

describe("processBorrowerChargeDispute — refusals", () => {
  it("a dispute on the lender's own unrelated charge is left alone", async () => {
    const h = makeHarness({ findBorrowerSession: async () => null });
    const outcome = await processBorrowerChargeDispute("charge.dispute.created", makeDispute(), "acct_lender", h.deps);
    expect(outcome).toEqual({ matched: false, reason: "not_borrower_payment" });
    expect(h.patches).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
    expect(h.notices).toHaveLength(0);
  });

  it("a borrower payment with no ledger row pages the founder instead of passing silently", async () => {
    const h = makeHarness({ findPaymentBySessionId: async () => null });
    const outcome = await processBorrowerChargeDispute("charge.dispute.created", makeDispute(), "acct_lender", h.deps);
    expect(outcome.matched).toBe(false);
    expect(outcome.reason).toBe("no_ledger_row");
    expect(h.patches).toHaveLength(0);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].severity).toBe("critical");
    expect(h.alerts[0].organizationId).toBe(102);
    expect(h.alerts[0].title).toMatch(/unrecorded payment/);
  });

  it("an org mismatch between session and ledger row refuses the write", async () => {
    const h = makeHarness({ findBorrowerSession: async () => ({ id: "cs_test_123", organizationId: 999 }) });
    const outcome = await processBorrowerChargeDispute("charge.dispute.created", makeDispute(), "acct_lender", h.deps);
    expect(outcome.matched).toBe(false);
    expect(outcome.reason).toBe("org_mismatch");
    expect(h.patches).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
  });

  it("a dispute with no connected account is unresolvable and writes nothing", async () => {
    const h = makeHarness();
    const outcome = await processBorrowerChargeDispute("charge.dispute.created", makeDispute(), null, h.deps);
    expect(outcome).toEqual({ matched: false, reason: "unresolvable" });
    expect(h.patches).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
  });
});

describe("runConnectDisputeEscalationSweep", () => {
  function openRow(overrides: Partial<OpenDisputeRow> = {}): OpenDisputeRow {
    return {
      id: 41,
      organizationId: 102,
      noteId: 53,
      disputeId: "dp_test_123",
      disputeAmountCents: 8000,
      disputeDueBy: DUE_BY,
      disputeEscalation72hAt: null,
      disputeEscalation24hAt: null,
      ...overrides,
    };
  }

  it("a dispute 10 days out fires nothing", async () => {
    const h = makeHarness({ listOpenDisputes: async () => [openRow()] });
    const r = await runConnectDisputeEscalationSweep(h.deps);
    expect(r).toEqual({ scanned: 1, escalated72h: 0, escalated24h: 0 });
    expect(h.alerts).toHaveLength(0);
    expect(h.patches).toHaveLength(0);
  });

  it("T-72h: warning alert + lender notice + the 72h stamp (stamp carries no other columns)", async () => {
    const due = new Date(NOW.getTime() + 50 * 3600 * 1000);
    const h = makeHarness({ listOpenDisputes: async () => [openRow({ disputeDueBy: due })] });
    const r = await runConnectDisputeEscalationSweep(h.deps);
    expect(r.escalated72h).toBe(1);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].severity).toBe("warning");
    expect(h.notices[0].kind).toBe("deadline_72h");
    expect(h.patches).toHaveLength(1);
    expect(h.patches[0].patch).toEqual({ disputeEscalation72hAt: NOW });
  });

  it("an already-stamped 72h tier never refires", async () => {
    const due = new Date(NOW.getTime() + 50 * 3600 * 1000);
    const h = makeHarness({ listOpenDisputes: async () => [openRow({ disputeDueBy: due, disputeEscalation72hAt: new Date(NOW.getTime() - 3600e3) })] });
    const r = await runConnectDisputeEscalationSweep(h.deps);
    expect(r.escalated72h).toBe(0);
    expect(h.alerts).toHaveLength(0);
  });

  it("T-24h: critical alert + notice + both stamps when the 72h tier was never sent", async () => {
    const due = new Date(NOW.getTime() + 10 * 3600 * 1000);
    const h = makeHarness({ listOpenDisputes: async () => [openRow({ disputeDueBy: due })] });
    const r = await runConnectDisputeEscalationSweep(h.deps);
    expect(r.escalated24h).toBe(1);
    expect(h.alerts[0].severity).toBe("critical");
    expect(h.notices[0].kind).toBe("deadline_24h");
    expect(h.patches[0].patch).toEqual({ disputeEscalation24hAt: NOW, disputeEscalation72hAt: NOW });
  });

  it("an overdue dispute fires the 24h tier", async () => {
    const due = new Date(NOW.getTime() - 2 * 3600 * 1000);
    const h = makeHarness({ listOpenDisputes: async () => [openRow({ disputeDueBy: due })] });
    const r = await runConnectDisputeEscalationSweep(h.deps);
    expect(r.escalated24h).toBe(1);
  });

  it("a failed tier is not stamped and does not stop the sweep", async () => {
    const due = new Date(NOW.getTime() + 10 * 3600 * 1000);
    const failing = openRow({ id: 41, disputeId: "dp_fail", disputeDueBy: due });
    const healthy = openRow({ id: 42, disputeId: "dp_ok", noteId: 54, disputeDueBy: due });
    let calls = 0;
    const h = makeHarness({
      listOpenDisputes: async () => [failing, healthy],
      createSystemAlert: async (alert) => {
        calls++;
        if (calls === 1) throw new Error("alert store down");
        h.alerts.push(alert);
      },
    });
    const r = await runConnectDisputeEscalationSweep(h.deps);
    expect(r.escalated24h).toBe(1); // only the healthy row
    expect(h.patches).toHaveLength(1);
    expect(h.patches[0].paymentId).toBe(42);
  });
});
