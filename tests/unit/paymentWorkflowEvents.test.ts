/**
 * Wave B "wire the engine" — payment.* workflow events.
 *
 * `emitPaymentEvent` shipped with zero call sites, so every note-servicing
 * and rent automation hanging off `payment.received` / `payment.missed` sat
 * idle. These tests pin the four emit sites and, more importantly, the
 * money-path discipline around them:
 *
 *   1. exactly ONE emit per posted payment row (never per retry);
 *   2. the emit happens AFTER the ledger write commits;
 *   3. an emit that throws NEVER fails the payment.
 *
 * No DATABASE_URL required — the db module and the workflow engine's
 * emitter are both mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
// `emitPaymentEvent` is replaced; every other real export of the workflow
// engine stays intact (other modules in the import graph use them).
const { emitSpy, dbMock, callOrder } = vi.hoisted(() => ({
  emitSpy: vi.fn(),
  dbMock: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  callOrder: [] as string[],
}));

vi.mock("../../server/services/workflow-engine", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, emitPaymentEvent: emitSpy };
});

vi.mock("../../server/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: dbMock };
});

import {
  buildNotePaymentEventData,
  daysLateForNotePayment,
  emitNotePaymentWorkflowEvent,
  type PostedNotePayment,
} from "../../server/routes-notes";
import {
  buildRentPaymentEventData,
  daysLateForRentPayment,
  emitRentPaymentReceived,
  registerRentLedgerRoutes,
  type PostedRentPayment,
} from "../../server/routes-rent-ledger";
import {
  buildBorrowerPaymentEventData,
  daysLateForBorrowerPayment,
  emitBorrowerPaymentReceived,
  type PostedBorrowerPayment,
} from "../../server/routes-borrower";
import {
  emitPaymentMissedForFinding,
  classifyPaymentsDue,
} from "../../server/services/notePaymentDueDetector";

beforeEach(() => {
  emitSpy.mockReset();
  emitSpy.mockImplementation(() => {
    callOrder.push("emit");
  });
  dbMock.select.mockReset();
  dbMock.insert.mockReset();
  dbMock.update.mockReset();
  dbMock.transaction.mockReset();
  callOrder.length = 0;
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

function postedNotePayment(over: Partial<PostedNotePayment> = {}): PostedNotePayment {
  return {
    organizationId: 7,
    noteId: "note-uuid-1",
    noteNumber: "N-1001",
    payerName: "Maria Delgado",
    paymentId: "payment-uuid-1",
    paymentType: "regular",
    paymentMethod: "ach",
    paymentDate: "2026-07-05",
    principalCents: 20_000,
    interestCents: 30_000,
    escrowCents: 0,
    lateFeeCents: 0,
    unappliedCents: 0,
    scheduledPaymentAmountCents: 50_000,
    paymentDueDay: 1,
    remainingBalanceCents: 1_980_000,
    unappliedBalanceCents: 0,
    noteStatus: "performing",
    ...over,
  };
}

function postedRentPayment(over: Partial<PostedRentPayment> = {}): PostedRentPayment {
  return {
    organizationId: 7,
    leaseId: "lease-uuid-1",
    paymentId: "rent-payment-uuid-1",
    rentChargeId: "charge-uuid-1",
    amountCents: 140_000,
    isPartial: false,
    payorType: "tenant",
    method: "ach",
    receivedAt: "2026-07-05",
    dueDate: "2026-07-01",
    chargeAmountCents: 140_000,
    chargeBalanceAfterCents: 0,
    legalPosture: "ok",
    ...over,
  };
}

function postedBorrowerPayment(over: Partial<PostedBorrowerPayment> = {}): PostedBorrowerPayment {
  return {
    organizationId: 7,
    noteId: 42,
    paymentId: 9001,
    amountCents: 50_000,
    principalCents: 20_000,
    interestCents: 30_000,
    lateFeeCents: 0,
    scheduledPaymentCents: 50_000,
    dueDate: new Date("2026-07-01T00:00:00.000Z"),
    paymentDate: new Date("2026-07-06T00:00:00.000Z"),
    remainingBalanceCents: 1_980_000,
    paymentMethod: "card",
    source: "borrower_portal",
    ...over,
  };
}

// ── Acquired-note ledger ─────────────────────────────────────────────────────

describe("acquired-note payments → payment.received", () => {
  it("emits exactly once, as payment.received, for a regular payment", () => {
    emitNotePaymentWorkflowEvent(postedNotePayment());

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitSpy.mock.calls[0];
    expect(event).toBe("payment.received");
    expect(orgId).toBe(7);
    // note_payments is uuid-keyed; the real id rides in data.
    expect(entityId).toBe(0);
    expect(data.paymentId).toBe("payment-uuid-1");
    expect(data.noteId).toBe("note-uuid-1");
  });

  it("carries what workflow conditions need: amount, full/partial, note id, days late", () => {
    const data = buildNotePaymentEventData(postedNotePayment());
    expect(data.amountCents).toBe(50_000);
    expect(data.amount).toBe(500);
    expect(data.isFullPayment).toBe(true);
    expect(data.isPartial).toBe(false);
    expect(data.noteId).toBe("note-uuid-1");
    expect(data.borrowerName).toBe("Maria Delgado");
    // due day 1, paid the 5th
    expect(data.daysLate).toBe(4);
    expect(data.remainingBalanceCents).toBe(1_980_000);
  });

  it("a partial payment reports the unapplied cash as the amount and flags partial", () => {
    const data = buildNotePaymentEventData(
      postedNotePayment({
        paymentType: "partial",
        principalCents: 0,
        interestCents: 0,
        unappliedCents: 15_000,
        unappliedBalanceCents: 15_000,
      }),
    );
    expect(data.amountCents).toBe(15_000);
    expect(data.isPartial).toBe(true);
    expect(data.isFullPayment).toBe(false);
    expect(data.paymentType).toBe("partial");
  });

  it("an unapplied_apply nets to zero new cash (funds were already held)", () => {
    const data = buildNotePaymentEventData(
      postedNotePayment({
        paymentType: "unapplied_apply",
        principalCents: 20_000,
        interestCents: 30_000,
        unappliedCents: -50_000,
      }),
    );
    expect(data.amountCents).toBe(0);
  });

  it("a payoff flags isPayoff and reports the zeroed balance", () => {
    const data = buildNotePaymentEventData(
      postedNotePayment({
        paymentType: "payoff",
        principalCents: 1_980_000,
        remainingBalanceCents: 0,
        noteStatus: "paid_off",
      }),
    );
    expect(data.isPayoff).toBe(true);
    expect(data.remainingBalanceCents).toBe(0);
    expect(data.noteStatus).toBe("paid_off");
  });

  it("an NSF reversal is a MISSED payment, not a receipt", () => {
    emitNotePaymentWorkflowEvent(
      postedNotePayment({
        paymentType: "nsf_reversal",
        principalCents: -20_000,
        interestCents: -30_000,
      }),
    );
    expect(emitSpy).toHaveBeenCalledTimes(1);
    const [event, , , data] = emitSpy.mock.calls[0];
    expect(event).toBe("payment.missed");
    expect(data.amountCents).toBe(-50_000);
    expect(data.reason).toBe("nsf_reversal");
  });

  it("never invents lateness when the note has no due day", () => {
    expect(daysLateForNotePayment("2026-07-05", null)).toBeNull();
    expect(buildNotePaymentEventData(postedNotePayment({ paymentDueDay: null })).daysLate).toBeNull();
  });

  it("clamps the due day to short months and reports 0 for on-time/early", () => {
    // Due day 31 in February → Feb 28 (2026 is not a leap year).
    expect(daysLateForNotePayment("2026-03-02", 31)).toBe(0); // paid before Mar 31
    expect(daysLateForNotePayment("2026-02-28", 31)).toBe(0);
    expect(daysLateForNotePayment("2026-02-01", 31)).toBe(0);
    expect(daysLateForNotePayment("2026-07-01", 1)).toBe(0);
  });

  it("an emit that throws does NOT fail the payment", () => {
    emitSpy.mockImplementation(() => {
      throw new Error("workflow engine exploded");
    });
    expect(() => emitNotePaymentWorkflowEvent(postedNotePayment())).not.toThrow();
  });
});

// ── Rent ledger ──────────────────────────────────────────────────────────────

describe("rent payments → payment.received", () => {
  it("emits exactly once with lease id, amount, partial flag and days late", () => {
    emitRentPaymentReceived(postedRentPayment({ receivedAt: "2026-07-09" }));

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitSpy.mock.calls[0];
    expect(event).toBe("payment.received");
    expect(orgId).toBe(7);
    expect(entityId).toBe(0); // rent_payments is uuid-keyed
    expect(data.leaseId).toBe("lease-uuid-1");
    expect(data.paymentId).toBe("rent-payment-uuid-1");
    expect(data.amountCents).toBe(140_000);
    expect(data.isPartial).toBe(false);
    expect(data.isFullPayment).toBe(true);
    expect(data.daysLate).toBe(8);
  });

  it("a partial rent payment reports the remaining charge balance", () => {
    const data = buildRentPaymentEventData(
      postedRentPayment({ amountCents: 70_000, isPartial: true, chargeBalanceAfterCents: 70_000 }),
    );
    expect(data.isPartial).toBe(true);
    expect(data.isFullPayment).toBe(false);
    expect(data.chargeBalanceAfterCents).toBe(70_000);
  });

  it("never invents lateness for a payment that applied to no open charge", () => {
    expect(daysLateForRentPayment(null, "2026-07-05")).toBeNull();
    const data = buildRentPaymentEventData(
      postedRentPayment({ rentChargeId: null, dueDate: null, chargeBalanceAfterCents: null }),
    );
    expect(data.daysLate).toBeNull();
    expect(data.isFullPayment).toBeNull();
  });

  it("an emit that throws does NOT fail the payment", () => {
    emitSpy.mockImplementation(() => {
      throw new Error("workflow engine exploded");
    });
    expect(() => emitRentPaymentReceived(postedRentPayment())).not.toThrow();
  });
});

// ── Rent route: ordering + one-emit-per-payment through the real handler ─────

type Handler = (req: any, res: any) => Promise<unknown>;

/** Thenable query-chain stub: any builder method returns itself; awaiting resolves to `result`. */
function chain(result: unknown) {
  const link: any = {
    from: () => link,
    where: () => link,
    orderBy: () => link,
    limit: () => link,
    values: () => link,
    set: () => link,
    returning: () => Promise.resolve(result),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return link;
}

function captureRentPaymentHandler(): Handler {
  const routes: Array<{ path: string; args: unknown[] }> = [];
  const app: any = {
    get: (path: string, ...args: unknown[]) => routes.push({ path, args }),
    post: (path: string, ...args: unknown[]) => routes.push({ path, args }),
  };
  registerRentLedgerRoutes(app);
  const route = routes.find((r) => r.path === "/api/leases/:id/payments");
  if (!route) throw new Error("rent payment route not registered");
  return route.args[route.args.length - 1] as Handler;
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe("POST /api/leases/:id/payments — emit happens after the transaction commits", () => {
  const lease = { id: "lease-uuid-1", organizationId: 7 };
  const openCharge = {
    id: "charge-uuid-1",
    amountCents: 140_000,
    paidCents: 0,
    balanceCents: 140_000,
    lateFeeCents: 0,
    legalPosture: "ok",
    legalPostureAt: null,
    dueDate: "2026-07-01",
  };

  function primeDb() {
    dbMock.select
      .mockReturnValueOnce(chain([lease]))
      .mockReturnValueOnce(chain([openCharge]));
    dbMock.transaction.mockImplementation(async (cb: any) => {
      callOrder.push("tx:begin");
      const tx = {
        insert: () => chain([{ id: "rent-payment-uuid-1" }]),
        update: () => chain(undefined),
      };
      const out = await cb(tx);
      callOrder.push("tx:commit");
      return out;
    });
  }

  const req = () => ({
    params: { id: "lease-uuid-1" },
    body: { amountCents: 140_000, receivedAt: "2026-07-05", method: "ach" },
    organization: { id: 7 },
    user: { id: "user-1" },
  });

  it("posts the payment, then emits exactly one payment.received", async () => {
    primeDb();
    const handler = captureRentPaymentHandler();
    const res = fakeRes();

    await handler(req(), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.payment.id).toBe("rent-payment-uuid-1");
    expect(emitSpy).toHaveBeenCalledTimes(1);
    // The ordering that matters on a money path: commit BEFORE emit.
    expect(callOrder).toEqual(["tx:begin", "tx:commit", "emit"]);
  });

  it("still returns 201 with the payment when the emit throws", async () => {
    primeDb();
    emitSpy.mockImplementation(() => {
      throw new Error("workflow engine exploded");
    });
    const handler = captureRentPaymentHandler();
    const res = fakeRes();

    await handler(req(), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.payment.id).toBe("rent-payment-uuid-1");
    // No 500 body, no error envelope.
    expect(res.body.error).toBeUndefined();
  });

  it("a failed transaction posts nothing and emits nothing", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([lease]))
      .mockReturnValueOnce(chain([openCharge]));
    dbMock.transaction.mockImplementation(async () => {
      throw new Error("deadlock detected");
    });
    const handler = captureRentPaymentHandler();
    const res = fakeRes();

    await handler(req(), res);

    expect(emitSpy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });
});

// ── Borrower portal ──────────────────────────────────────────────────────────

describe("borrower portal payments → payment.received", () => {
  it("emits exactly once with the real (numeric) payment id as entityId", () => {
    emitBorrowerPaymentReceived(postedBorrowerPayment());

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitSpy.mock.calls[0];
    expect(event).toBe("payment.received");
    expect(orgId).toBe(7);
    expect(entityId).toBe(9001); // payments.id is serial
    expect(data.noteId).toBe(42);
    expect(data.amount).toBe(500);
    expect(data.isFullPayment).toBe(true);
    expect(data.daysLate).toBe(5);
    expect(data.source).toBe("borrower_portal");
  });

  it("flags a short payment as partial and a zero balance as paid off", () => {
    const partial = buildBorrowerPaymentEventData(postedBorrowerPayment({ amountCents: 10_000 }));
    expect(partial.isPartial).toBe(true);
    expect(partial.isFullPayment).toBe(false);

    const payoff = buildBorrowerPaymentEventData(postedBorrowerPayment({ remainingBalanceCents: 0 }));
    expect(payoff.isPaidOff).toBe(true);
  });

  it("never invents lateness or a full/partial verdict without stored terms", () => {
    expect(daysLateForBorrowerPayment(null, new Date())).toBeNull();
    const data = buildBorrowerPaymentEventData(
      postedBorrowerPayment({ dueDate: null, scheduledPaymentCents: null }),
    );
    expect(data.daysLate).toBeNull();
    expect(data.dueDate).toBeNull();
    expect(data.isFullPayment).toBeNull();
    expect(data.isPartial).toBeNull();
  });

  it("an emit that throws does NOT fail the payment", () => {
    emitSpy.mockImplementation(() => {
      throw new Error("workflow engine exploded");
    });
    expect(() => emitBorrowerPaymentReceived(postedBorrowerPayment())).not.toThrow();
  });
});

// ── Delinquency detection ────────────────────────────────────────────────────

describe("note payment due detector → payment.missed", () => {
  const now = new Date("2026-07-29T00:00:00.000Z");

  function overdueFinding() {
    const [finding] = classifyPaymentsDue(
      [{ id: 42, organizationId: 7, nextPaymentDate: new Date("2026-07-01T00:00:00.000Z") }],
      now,
    );
    return finding;
  }

  it("classifies a past-due note as overdue and emits it once", () => {
    const finding = overdueFinding();
    expect(finding.classification).toBe("overdue");

    emitPaymentMissedForFinding(finding);

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitSpy.mock.calls[0];
    expect(event).toBe("payment.missed");
    expect(orgId).toBe(7);
    expect(entityId).toBe(42); // no payment row exists — the note IS the entity
    expect(data.noteId).toBe(42);
    expect(data.dueDate).toBe("2026-07-01");
    expect(data.daysLate).toBe(28);
    expect(data.dedupeKey).toBe("note-payment:42:2026-07-01:overdue");
  });

  it("an emit that throws does NOT break the scan", () => {
    emitSpy.mockImplementation(() => {
      throw new Error("workflow engine exploded");
    });
    expect(() => emitPaymentMissedForFinding(overdueFinding())).not.toThrow();
  });

  it("the scan only emits for NEW overdue findings — the dedupe ledger gates it", () => {
    const src = require("fs").readFileSync(
      require("path").join(process.cwd(), "server/services/notePaymentDueDetector.ts"),
      "utf-8",
    );
    // The emit sits inside the publish try-block, after `published += 1`,
    // and behind the overdue check — so an already-published finding
    // (skipped by `alreadyPublished.has`) never reaches it.
    const publishIdx = src.indexOf("result.published += 1;");
    const emitIdx = src.indexOf("emitPaymentMissedForFinding(f);");
    const skipIdx = src.indexOf("if (alreadyPublished.has(f.dedupeKey)) continue;");
    expect(publishIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(publishIdx);
    expect(skipIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeLessThan(emitIdx);
    expect(src).toContain('if (f.classification === "overdue") {');
  });
});
