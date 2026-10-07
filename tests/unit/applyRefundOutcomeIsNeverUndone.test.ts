/**
 * apply_refund (round 2): once stripe.refunds.create has been CALLED, the claim
 * is never released and the credits are never given back — a timeout on a
 * refund that succeeded, or a failed bookkeeping write after it, would
 * otherwise let a retry refund the same payment twice. Such an outcome is
 * recorded as UNCERTAIN and put in front of the founder. Before the call, a
 * failure DOES release (nothing moved). And the ≤ purchase-cost rule, pinned
 * outside the DB proof.
 *
 * The database is an in-memory fake that records every write; Stripe and the
 * founder ask are spies.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  purchaseCents: 3000,
  writes: [] as Array<{ op: string; table: string; value?: unknown }>,
  failMetadataUpdate: false,
}));
const stripe = vi.hoisted(() => ({
  retrieve: vi.fn(async () => ({ latest_charge: { amount: 3000, amount_refunded: 0 } })),
  create: vi.fn(async () => ({ id: "re_1" })),
}));
const askFounder = vi.hoisted(() => vi.fn(async () => ({ askId: 1, pagerFired: false, pagerEventId: null, deduped: false })));

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({ paymentIntents: { retrieve: stripe.retrieve }, refunds: { create: stripe.create } }),
}));
vi.mock("../../server/services/solene/founderCollab", () => ({ askFounder }));

vi.mock("../../server/db", () => {
  const nameOf = (t: unknown) => String((t as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] ?? "?");
  const rowsFor = (table: string, cols: Record<string, unknown> | undefined) => {
    if (table === "credit_transactions" && cols && "amountCents" in cols) return [{ amountCents: st.purchaseCents }]; // the purchase
    if (table === "credit_transactions") return []; // no prior refund recorded
    if (table === "organizations") return [{ isFounder: false, balance: 5000 }];
    return [];
  };
  const make = (): Record<string, unknown> => ({
    execute: async () => ({ rows: [] }),
    select: (cols?: Record<string, unknown>) => ({
      from: (t: unknown) => ({
        where: () => ({ limit: async () => rowsFor(nameOf(t), cols) }),
      }),
    }),
    update: (t: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => {
          const table = nameOf(t);
          const run = async () => {
            const meta = value.metadata as { state?: string } | undefined;
            if (st.failMetadataUpdate && meta?.state === "refunded") throw new Error("connection reset");
            st.writes.push({ op: "update", table, value });
            return [{ balance: 2000 }];
          };
          const p = run();
          return { then: p.then.bind(p), catch: p.catch.bind(p), returning: () => p };
        },
      }),
    }),
    insert: (t: unknown) => ({
      values: (value: unknown) => ({
        returning: async () => {
          st.writes.push({ op: "insert", table: nameOf(t), value });
          return [{ id: 77 }];
        },
      }),
    }),
    delete: (t: unknown) => ({
      where: async () => {
        st.writes.push({ op: "delete", table: nameOf(t) });
      },
    }),
  });
  const db = make();
  return { db, withTransaction: async (fn: (tx: unknown) => unknown) => fn(make()) };
});

import { executeHandWitnessed } from "../../server/services/autopilot/hands/registry";
import "../../server/services/autopilot/hands";

const REFUND = { charge_id: "pi_abc", amount_cents: 1000, organization_id: 5 };
const released = () => st.writes.some((w) => w.op === "delete" && w.table === "credit_transactions");
// The claim takes the credits back with ONE organizations update; a release
// gives them back with a SECOND.
const creditsReturned = () => st.writes.filter((w) => w.op === "update" && w.table === "organizations").length > 1;

beforeEach(() => {
  st.purchaseCents = 3000;
  st.writes.length = 0;
  st.failMetadataUpdate = false;
  stripe.retrieve.mockClear();
  stripe.create.mockReset();
  stripe.create.mockResolvedValue({ id: "re_1" });
  askFounder.mockClear();
});

describe("apply_refund — never undo a refund that may have happened", () => {
  it("create succeeds, then the bookkeeping write fails: success, claim KEPT, no credits given back, founder told", async () => {
    st.failMetadataUpdate = true;
    const r = await executeHandWitnessed("apply_refund", REFUND, "founder_1");
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(r.success).toBe(true);
    expect(r.output).toMatch(/recordIncomplete/);
    expect(released()).toBe(false);
    expect(creditsReturned()).toBe(false);
    expect(askFounder).toHaveBeenCalledWith(expect.objectContaining({ questionSummary: expect.stringMatching(/uncertain/i) }));
  });

  it("the refund call itself fails or times out: UNCERTAIN, claim KEPT, founder told", async () => {
    stripe.create.mockRejectedValueOnce(new Error("timeout"));
    const r = await executeHandWitnessed("apply_refund", REFUND, "founder_1");
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/UNCERTAIN/);
    expect(released()).toBe(false);
    expect(creditsReturned()).toBe(false);
    expect(askFounder).toHaveBeenCalledTimes(1);
  });

  it("a failure BEFORE the refund call releases the claim (nothing moved)", async () => {
    stripe.retrieve.mockRejectedValueOnce(new Error("stripe down"));
    const r = await executeHandWitnessed("apply_refund", REFUND, "founder_1");
    expect(r.success).toBe(false);
    expect(stripe.create).not.toHaveBeenCalled();
    expect(released()).toBe(true);
    expect(creditsReturned()).toBe(true);
  });
});

describe("apply_refund — never more than the purchase cost", () => {
  it("a refund above what the purchase cost is refused before any claim or Stripe call", async () => {
    st.purchaseCents = 2000;
    const r = await executeHandWitnessed("apply_refund", { ...REFUND, amount_cents: 2500 }, "founder_1");
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/more than the purchase cost/);
    expect(st.writes).toHaveLength(0);
    expect(stripe.create).not.toHaveBeenCalled();
  });
  it("a refund equal to the purchase cost proceeds", async () => {
    st.purchaseCents = 2500;
    const r = await executeHandWitnessed("apply_refund", { ...REFUND, amount_cents: 2500 }, "founder_1");
    expect(r.success).toBe(true);
    expect(stripe.create).toHaveBeenCalledTimes(1);
  });
});
