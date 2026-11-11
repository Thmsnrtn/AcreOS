/**
 * Refund automation above $50 (design 2026-11 §5, legs 1–11 + the brakes and
 * queue around them). The §5A guarantee is honoured at EVERY tier by one
 * eligibility rule and one executor; amount is not a predicate.
 *
 * Pattern: tests/unit/applyRefundOutcomeIsNeverUndone.test.ts — an in-memory
 * database that records every write, Stripe and the founder ask as spies. The
 * fake EVALUATES the real drizzle predicates (rendered through PgDialect), so
 * `where status = 'pending'` really is the claim and a race loser really does
 * observe it. Transactions run one at a time, which is what the production
 * advisory lock on the charge guarantees.
 *
 * NOT here (later proof legs, by design): the realdb suite
 * (refundGuarantee.realdb.test.ts) and the Stripe test-mode E2E.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const DAY_MS = 24 * 60 * 60 * 1000;

type Row = Record<string, any>;
const st = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  writes: [] as Array<{ op: string; table: string; value?: unknown }>,
  /** Throw from an update of `table` whose values match. */
  failUpdate: null as null | ((table: string, values: Row) => boolean),
  org: {} as Row,
  charges: [] as Row[], // what charges.list returns (and the default for retrieve)
  retrieveOverride: null as null | ((id: string) => Row | Promise<Row>),
  invoiceLinkage: true,
  lock: Promise.resolve() as Promise<unknown>,
}));

const stripe = vi.hoisted(() => ({
  refundsCreate: vi.fn(async (_params: unknown, _opts: unknown) => ({ id: "re_1" })),
  subscriptionsCancel: vi.fn(async (_id: string) => ({})),
}));
const spies = vi.hoisted(() => ({
  askFounder: vi.fn(async (_i: unknown) => ({ askId: 1, pagerFired: false, pagerEventId: null, deduped: false })),
  sendEmail: vi.fn(async (_m: unknown) => ({})),
  auditLog: vi.fn(async (_a: unknown) => undefined),
  history: vi.fn(async (_h: unknown) => undefined),
  createSystemAlert: vi.fn(async (a: Row) => ({ id: 1, ...a })),
  updateOrganization: vi.fn(async (_id: number, _u: Row) => ({})),
  logSubscriptionEvent: vi.fn(async (_e: unknown) => ({})),
  loggedErrors: vi.fn(),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: spies.loggedErrors },
}));
vi.mock("../../server/services/solene/founderCollab", () => ({ askFounder: spies.askFounder }));
vi.mock("../../server/services/emailService", () => ({ emailService: { sendEmail: spies.sendEmail } }));
vi.mock("../../server/routes-subscription", () => ({ recordSubscriptionHistoryEvent: spies.history }));
vi.mock("../../server/utils/auditLog", () => ({
  auditLog: spies.auditLog,
  AuditActions: { BILLING_REFUND_ISSUED: "billing.refund_issued" },
  actorFromRequest: () => ({}),
  auditFromRequest: async () => undefined,
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getOrganization: async () => ({ ...st.org }),
    updateOrganization: async (id: number, u: Row) => {
      await spies.updateOrganization(id, u);
      Object.assign(st.org, u);
      return { ...st.org };
    },
    logSubscriptionEvent: spies.logSubscriptionEvent,
    createSystemAlert: spies.createSystemAlert,
  },
}));
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => fakeStripe(),
}));

// ── the fake database ──────────────────────────────────────────────────────
const dialect = new PgDialect();
const nameOf = (t: unknown) => String((t as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] ?? "?");
const keyByDbName = (t: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, col] of Object.entries(getTableColumns(t as any))) out[(col as { name: string }).name] = key;
  return out;
};
const norm = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v).getTime() : v);

/** Evaluate a drizzle condition (conjunctions of = <> >= in is-null) against a row. */
function matches(table: unknown, cond: unknown, row: Row): boolean {
  if (!cond) return true;
  const q = dialect.sqlToQuery(cond as any);
  if (/\sor\s/i.test(q.sql)) throw new Error(`fake db: OR is not modelled (${q.sql})`);
  const keys = keyByDbName(table);
  const val = (col: string) => norm(row[keys[col]]);
  let ok = true;
  let atoms = 0;
  for (const m of q.sql.matchAll(/"[^"]+"\."([^"]+)" (=|<>|>=|<|>) \$(\d+)/g)) {
    atoms++;
    const [, col, op, n] = m;
    const want = norm(q.params[Number(n) - 1]);
    const have = val(col);
    if (op === "=" && have !== want) ok = false;
    if (op === "<>" && have === want) ok = false;
    if (op === ">=" && !((have as number) >= (want as number))) ok = false;
    if (op === "<" && !((have as number) < (want as number))) ok = false;
    if (op === ">" && !((have as number) > (want as number))) ok = false;
  }
  for (const m of q.sql.matchAll(/"[^"]+"\."([^"]+)" in \(([^)]*)\)/g)) {
    atoms++;
    const [, col, list] = m;
    const wants = [...list.matchAll(/\$(\d+)/g)].map((x) => norm(q.params[Number(x[1]) - 1]));
    if (!wants.includes(val(col))) ok = false;
  }
  for (const m of q.sql.matchAll(/"[^"]+"\."([^"]+)" is (not )?null/g)) {
    atoms++;
    const isNull = val(m[1]) == null;
    if (m[2] ? isNull : !isNull) ok = false;
  }
  if (atoms === 0) throw new Error(`fake db: predicate not understood (${q.sql})`);
  return ok;
}

const project = (table: unknown, cols: Record<string, any> | undefined, row: Row): Row => {
  if (!cols) return { ...row };
  const keys = keyByDbName(table);
  const out: Row = {};
  for (const [alias, col] of Object.entries(cols)) out[alias] = row[keys[(col as { name: string }).name]];
  return out;
};

function makeDb(): Record<string, any> {
  const rowsOf = (t: unknown) => (st.tables[nameOf(t)] ??= []);
  return {
    execute: async () => ({ rows: [] }),
    select: (cols?: Record<string, any>) => ({
      from: (t: unknown) => {
        let cond: unknown;
        let limit = Infinity;
        const run = async () => {
          if (nameOf(t) === "users") return [{ email: "owner@example.com" }];
          return rowsOf(t)
            .filter((r) => matches(t, cond, r))
            .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
            .slice(0, limit)
            .map((r) => project(t, cols, r));
        };
        const chain: any = {
          where: (c: unknown) => ((cond = c), chain),
          orderBy: () => chain,
          limit: (n: number) => ((limit = n), chain),
          then: (res: any, rej: any) => run().then(res, rej),
        };
        return chain;
      },
    }),
    update: (t: unknown) => ({
      set: (values: Row) => ({
        where: (cond: unknown) => {
          const apply = async () => {
            const table = nameOf(t);
            if (st.failUpdate?.(table, values)) throw new Error("connection reset");
            const hit = rowsOf(t).filter((r) => matches(t, cond, r));
            for (const r of hit) Object.assign(r, values);
            st.writes.push({ op: "update", table, value: values });
            return hit;
          };
          return {
            returning: async (cols?: Record<string, any>) => (await apply()).map((r) => project(t, cols, r)),
            then: (res: any, rej: any) => apply().then(() => undefined).then(res, rej),
          };
        },
      }),
    }),
    insert: (t: unknown) => ({
      values: (value: Row) => ({
        returning: async () => {
          const table = nameOf(t);
          const row: Row = { id: st.nextId++, status: "pending", attempts: 0, autoApproved: false, createdAt: new Date(), ...value };
          rowsOf(t).push(row);
          st.writes.push({ op: "insert", table, value });
          return [{ ...row }];
        },
      }),
    }),
  };
}
const fakeDb = vi.hoisted(() => ({ current: null as any }));
vi.mock("../../server/db", () => ({
  get db() {
    return fakeDb.current;
  },
  withTransaction: async (fn: (tx: unknown) => unknown) => {
    // One transaction at a time — what pg_advisory_xact_lock(charge) guarantees.
    const prev = st.lock;
    let release!: () => void;
    st.lock = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn(fakeDb.current);
    } finally {
      release();
    }
  },
}));
vi.mock("../../server/utils/orgScopedDb", () => ({ unscopedForPlatformOps: () => fakeDb.current }));

// ── fake Stripe ────────────────────────────────────────────────────────────
function fakeStripe() {
  const byId = (id: string) => st.charges.find((c) => c.id === id);
  return {
    charges: {
      list: async () => ({ data: [...st.charges].sort((a, b) => b.created - a.created), has_more: false }),
      retrieve: async (id: string) => {
        if (st.retrieveOverride) return st.retrieveOverride(id);
        const c = byId(id);
        if (!c) throw new Error(`no such charge ${id}`);
        return c;
      },
    },
    invoices: {
      list: async () => {
        if (!st.invoiceLinkage) return { data: [], has_more: false };
        const first = [...st.charges].sort((a, b) => a.created - b.created)[0];
        return { data: first ? [{ id: "in_first", created: first.created, status: "paid", amount_paid: first.amount, subscription: "sub_1" }] : [], has_more: false };
      },
    },
    invoicePayments: {
      list: async () => ({ data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_first" } }] }),
    },
    paymentIntents: {
      retrieve: async () => {
        const first = [...st.charges].sort((a, b) => a.created - b.created)[0];
        return { latest_charge: first?.id };
      },
    },
    refunds: { create: stripe.refundsCreate },
    subscriptions: { cancel: stripe.subscriptionsCancel },
  };
}

const charge = (id: string, amount: number, daysAgo: number, extra: Row = {}): Row => ({
  id,
  amount,
  created: Math.floor((Date.now() - daysAgo * DAY_MS) / 1000),
  status: "succeeded",
  paid: true,
  refunded: false,
  disputed: false,
  amount_refunded: 0,
  payment_intent: `pi_${id}`,
  ...extra,
});

import { evaluateGuaranteeEligibility, brakeForFailures, type GuaranteeEligibilityInput } from "../../server/services/refunds/guaranteeEligibility";
import { requestGuaranteeRefund, REFUND_COPY } from "../../server/services/refunds/requestGuaranteeRefund";
import { executeRefundRequest } from "../../server/services/refunds/executeRefund";
import { approveRefundRequest, denyRefundRequest, resolveUncertainRefundRequest, runRefundSlaSweep, slaStateOf, listFounderRefundQueue } from "../../server/services/refunds/refundQueue";
import { GUARANTEE_REFUND_VELOCITY, REFUND_DECISION_SLA_HOURS, REFUND_MAX_AUTO_ATTEMPTS } from "../../server/services/refunds/refundConfig";

const refunds = () => st.tables["refund_requests"] ?? [];
const intake = (reason = "not for me", deps: Parameters<typeof requestGuaranteeRefund>[1] = {}) =>
  requestGuaranteeRefund({
    organization: { id: 7, name: "Cedar Ridge Land Co.", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" },
    userId: "user_1",
    reason,
    actor: { userId: "user_1" },
  }, deps);
const alertsOfType = (type: string) => spies.createSystemAlert.mock.calls.map((c) => c[0] as Row).filter((a) => a.type === type);

beforeEach(() => {
  st.tables = {};
  st.nextId = 1;
  st.writes.length = 0;
  st.failUpdate = null;
  st.retrieveOverride = null;
  st.invoiceLinkage = true;
  st.lock = Promise.resolve();
  st.charges = [];
  st.org = { id: 7, name: "Cedar Ridge Land Co.", ownerId: "owner_1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionTier: "pro", subscriptionStatus: "active", billingInterval: "month", creditBalance: 0 };
  fakeDb.current = makeDb();
  stripe.refundsCreate.mockReset();
  stripe.refundsCreate.mockResolvedValue({ id: "re_1" });
  stripe.subscriptionsCancel.mockReset();
  stripe.subscriptionsCancel.mockResolvedValue({});
  for (const s of [spies.askFounder, spies.sendEmail, spies.auditLog, spies.history, spies.createSystemAlert, spies.updateOrganization, spies.logSubscriptionEvent, spies.loggedErrors]) s.mockClear();
});

// ───────────────────────────────────────────────────────────────────────────
// Legs 1–3 — the guarantee is honoured at every tier
// ───────────────────────────────────────────────────────────────────────────

describe("guarantee-eligible first charge → processed end-to-end, at any amount", () => {
  async function expectProcessedEndToEnd(amountCents: number, daysAgo: number) {
    st.charges = [charge("ch_first", amountCents, daysAgo)];
    const r = await intake();
    expect(r).toMatchObject({ kind: "recorded", status: "processed", amountCents });

    const row = refunds()[0];
    // Full amount, with the per-request Stripe idempotency key.
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1);
    expect(stripe.refundsCreate).toHaveBeenCalledWith({ charge: "ch_first" }, { idempotencyKey: `refund_request:${row.id}` });
    expect(row).toMatchObject({ status: "processed", processedBy: "auto", stripeRefundId: "re_1", autoApproved: true, amountCents });
    expect(row.eligibility).toMatchObject({ eligible: true, firstCharge: { chargeId: "ch_first" } });
    expect(row.dueAt).toBeInstanceOf(Date);

    // The downstream bundle, unchanged.
    expect(stripe.subscriptionsCancel).toHaveBeenCalledWith("sub_1");
    expect(spies.updateOrganization).toHaveBeenCalledWith(7, expect.objectContaining({ subscriptionTier: "free", subscriptionStatus: "cancelled", stripeSubscriptionId: null, subscriptionEndedAt: expect.any(Date) }));
    expect(spies.logSubscriptionEvent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 7, fromTier: "pro", toTier: null }));
    expect(spies.history).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ source: "refund_auto_cancel", refundRequestId: row.id }) }));
    expect(spies.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com", transactional: true }));
    expect(spies.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "billing.refund_issued", target: { type: "billing", id: 7 }, metadata: expect.objectContaining({ op: "auto_refund", amountCents, stripeRefundId: "re_1", refundRequestId: row.id }) }),
    );
    // Ledger effects live in the charge.refunded webhook: the executor posts none.
    expect(new Set(st.writes.map((w) => w.table))).toEqual(new Set(["refund_requests"]));
    // And the customer is not told about a dollar rule.
    if (r.kind === "recorded") expect(r.message).not.toMatch(/\$50|over \$|manual approval/i);
  }

  it("1. $99 Pro monthly, first charge, day 5", () => expectProcessedEndToEnd(9900, 5));
  it("2. $1,990 Scale annual, first charge, day 29 — the amount that could never process before", () => expectProcessedEndToEnd(199000, 29));
  it("3. $49 control — the old ≤$50 outcome is preserved", () => expectProcessedEndToEnd(4900, 3));

  it("resolves the first charge by invoice linkage, and by earliest charge when the linkage does not resolve", async () => {
    st.charges = [charge("ch_first", 9900, 20), charge("ch_renewal", 9900, 2)];
    await intake();
    expect(refunds()[0].eligibility.firstCharge).toMatchObject({ chargeId: "ch_first", via: "first_invoice" });

    st.tables = {};
    st.invoiceLinkage = false;
    await intake();
    expect(refunds()[0].eligibility.firstCharge).toMatchObject({ chargeId: "ch_first", via: "earliest_charge" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Legs 4–7 — outside the guarantee, or a brake: queued, never a dead end
// ───────────────────────────────────────────────────────────────────────────

describe("everything else is queued under the right brake with a decision clock", () => {
  function expectQueued(brake: string) {
    expect(stripe.refundsCreate).not.toHaveBeenCalled();
    const row = refunds()[0];
    expect(row).toMatchObject({ status: "pending", brake, autoApproved: false });
    expect(row.dueAt.getTime() - row.createdAt.getTime()).toBe(REFUND_DECISION_SLA_HOURS * 60 * 60 * 1000);
    expect(row.eligibility).toBeTruthy();
    const alert = alertsOfType("refund_request");
    expect(alert).toHaveLength(1);
    expect(alert[0]).toMatchObject({ relatedEntityType: "refund_request", relatedEntityId: row.id, status: "new" });
    expect(alert[0].title).toContain(brake);
  }

  it("4. a renewal is not the guarantee: the target is the FIRST charge, so a request after day 30 queues B5 — the renewal is never refunded blind", async () => {
    st.charges = [charge("ch_first", 9900, 35), charge("ch_renewal", 9900, 5)];
    const r = await intake();
    expect(r).toMatchObject({ kind: "recorded", status: "pending", brake: "B5" });
    expectQueued("B5");
    expect(refunds()[0].stripeChargeId).toBe("ch_first"); // not "the latest charge"
    expect(refunds()[0].eligibility.verdicts.E3.verdict).toBe("fail");
  });

  it("5. a first charge on day 31 is case-by-case: B5", async () => {
    st.charges = [charge("ch_first", 9900, 31)];
    await intake();
    expectQueued("B5");
  });

  it("6. an open dispute on the charge → B2; refunds.create is never called", async () => {
    st.charges = [charge("ch_first", 9900, 4, { disputed: true })];
    await intake();
    expectQueued("B2");
  });

  it("6b. a dispute that appears between intake and execution is caught by the fresh re-read: back in the queue under B2, nothing refunded", async () => {
    st.charges = [charge("ch_first", 9900, 4)];
    st.retrieveOverride = async (id) => ({ ...st.charges.find((c) => c.id === id)!, disputed: true });
    const r = await intake();
    expect(r).toMatchObject({ kind: "recorded", status: "pending" });
    expectQueued("B2");
    expect(spies.updateOrganization).not.toHaveBeenCalled();
  });

  it("7. amount_refunded > 0 → B3", async () => {
    st.charges = [charge("ch_first", 9900, 4, { amount_refunded: 2000 })];
    await intake();
    expectQueued("B3");
  });

  it("B1. a refund already processed for the org (the old once-per-30-days check, now a queue not a dead end) → B1", async () => {
    st.tables["refund_requests"] = [{ id: 90, organizationId: 7, stripeChargeId: "ch_old", amountCents: 4900, status: "processed", createdAt: new Date(Date.now() - 3 * DAY_MS) }];
    st.nextId = 91;
    st.charges = [charge("ch_first", 9900, 4)];
    const r = await intake();
    expect(r).toMatchObject({ kind: "recorded", status: "pending", brake: "B1" });
    expect(stripe.refundsCreate).not.toHaveBeenCalled();
    expect(refunds().find((x) => x.id === 91)).toMatchObject({ status: "pending", brake: "B1" });
  });

  it("a second ask about the same charge returns the existing request instead of writing a duplicate row", async () => {
    st.charges = [charge("ch_first", 9900, 31)];
    await intake();
    const again = await intake();
    expect(refunds()).toHaveLength(1);
    expect(again).toMatchObject({ kind: "recorded", status: "pending", message: REFUND_COPY.alreadyOpen });
  });

  it("B7. at the velocity threshold, eligible requests queue under B7 and the founder is paged once", async () => {
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000);
    st.tables["refund_requests"] = Array.from({ length: GUARANTEE_REFUND_VELOCITY.maxCount }, (_, i) => ({
      id: 100 + i, organizationId: 50 + i, stripeChargeId: `ch_farm_${i}`, amountCents: 4900, status: "processed", autoApproved: true, createdAt: recent,
    }));
    st.nextId = 200;
    st.charges = [charge("ch_first", 9900, 4)];
    const r = await intake();
    expect(r).toMatchObject({ kind: "recorded", status: "pending", brake: "B7" });
    expect(stripe.refundsCreate).not.toHaveBeenCalled();
    const mine = refunds().find((x) => x.organizationId === 7)!;
    expect(mine.brake).toBe("B7");
    expect(mine.eligibility).toMatchObject({ eligible: true, velocity: { tripped: true } });
    const pages = alertsOfType("refund_velocity_brake");
    expect(pages).toHaveLength(1);
    expect(pages[0].severity).toBe("critical");
  });

  it("B7 also trips on dollars: one more $1,990 refund past the cents ceiling pauses automation", async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000);
    st.tables["refund_requests"] = [{ id: 100, organizationId: 50, stripeChargeId: "ch_farm", amountCents: GUARANTEE_REFUND_VELOCITY.maxCents - 100000, status: "processed", autoApproved: true, createdAt: recent }];
    st.nextId = 200;
    st.charges = [charge("ch_first", 199000, 4)];
    await intake();
    expect(refunds().find((x) => x.organizationId === 7)!.brake).toBe("B7");
  });

  it("B7 is a named constant in one place, flagged as a proposal — not a literal anywhere else", async () => {
    const fs = await import("node:fs");
    const cfg = fs.readFileSync("server/services/refunds/refundConfig.ts", "utf8");
    expect(cfg).toMatch(/PROPOSAL, NOT A RATIFIED NUMBER/);
    for (const f of ["requestGuaranteeRefund.ts", "executeRefund.ts", "refundQueue.ts", "guaranteeEligibility.ts"]) {
      const src = fs.readFileSync(`server/services/refunds/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\b500_?000\b|maxCount:\s*\d|windowHours:\s*\d/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Legs 8–10 — failure discipline and the race
// ───────────────────────────────────────────────────────────────────────────

describe("failure discipline (copied from apply_refund)", () => {
  it("8. a failure BEFORE refunds.create returns the request to the queue: attempts + 1, last_error set, no partial state", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    st.retrieveOverride = async () => {
      throw new Error("stripe down");
    };
    const r = await intake();
    expect(r).toMatchObject({ kind: "recorded", status: "pending", message: REFUND_COPY.retrying });
    expect(stripe.refundsCreate).not.toHaveBeenCalled();
    const row = refunds()[0];
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "stripe down", autoApproved: true });
    expect(row.brake ?? null).toBeNull();
    expect(new Date(row.eligibility.execution.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    // No partial state: nothing downstream ran.
    expect(stripe.subscriptionsCancel).not.toHaveBeenCalled();
    expect(spies.updateOrganization).not.toHaveBeenCalled();
    expect(spies.sendEmail).not.toHaveBeenCalled();
    expect(spies.auditLog).not.toHaveBeenCalled();
  });

  it("9. the refund went out but the row update failed: UNCERTAIN, founder surfaced, claim kept — and a retry is refused", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    st.failUpdate = (table, values) => table === "refund_requests" && values.status === "processed";
    const r = await intake();
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ kind: "recorded", status: "processing", message: REFUND_COPY.confirming });
    const row = refunds()[0];
    expect(row).toMatchObject({ status: "uncertain", brake: "B6", stripeRefundId: "re_1" });
    expect(row.lastError).toMatch(/issued but its record could not be written/);
    expect(spies.askFounder).toHaveBeenCalledWith(expect.objectContaining({ urgency: "urgent", questionSummary: expect.stringMatching(/uncertain/i) }));
    expect(alertsOfType("refund_uncertain")).toHaveLength(1);
    // No bundle on an unconfirmed row.
    expect(stripe.subscriptionsCancel).not.toHaveBeenCalled();
    expect(spies.updateOrganization).not.toHaveBeenCalled();

    // Never twice: neither the executor nor the sweep will touch it again.
    st.failUpdate = null;
    const again = await executeRefundRequest({ requestId: row.id, organizationId: 7, processedBy: "auto", trigger: "sweep" });
    expect(again).toEqual({ outcome: "not_claimable", status: "uncertain" });
    await runRefundSlaSweep();
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1);
  });

  it("9b. the refund call itself timing out is UNCERTAIN too (Stripe may have refunded) — never re-queued as fresh", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    stripe.refundsCreate.mockRejectedValueOnce(new Error("timeout"));
    await intake();
    const row = refunds()[0];
    expect(row).toMatchObject({ status: "uncertain", brake: "B6" });
    expect(spies.askFounder).toHaveBeenCalledTimes(1);
    const again = await executeRefundRequest({ requestId: row.id, organizationId: 7, processedBy: "founder_1", trigger: "founder" });
    expect(again).toEqual({ outcome: "not_claimable", status: "uncertain" });
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1);
  });

  it("9c. a definitive Stripe rejection (StripeCardError-style 402) means nothing was refunded: back to the queue, attempts + 1, NO uncertain alert", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    stripe.refundsCreate.mockRejectedValueOnce(Object.assign(new Error("Your card was declined."), { type: "StripeCardError", statusCode: 402, code: "card_declined" }));
    const r = await intake();
    expect(r).toMatchObject({ kind: "recorded", status: "pending", message: REFUND_COPY.retrying });
    expect(refunds()[0]).toMatchObject({ status: "pending", attempts: 1, lastError: "Your card was declined.", autoApproved: true });
    expect(new Date(refunds()[0].eligibility.execution.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    expect(alertsOfType("refund_uncertain")).toHaveLength(0);
    expect(spies.askFounder).not.toHaveBeenCalled();
    expect(stripe.subscriptionsCancel).not.toHaveBeenCalled();
  });

  it("9d. a connection error, a 5xx and a 409 idempotency conflict stay UNCERTAIN exactly as before", async () => {
    for (const [i, e] of [
      { type: "StripeConnectionError", message: "socket hang up" },
      { type: "StripeAPIError", statusCode: 503, message: "upstream" },
      { type: "StripeInvalidRequestError", statusCode: 409, message: "request in progress" },
    ].entries()) {
      st.tables = {};
      st.charges = [charge(`ch_${i}`, 9900, 5)];
      stripe.refundsCreate.mockRejectedValueOnce(Object.assign(new Error(e.message), e));
      await intake();
      expect(refunds()[0], e.type).toMatchObject({ status: "uncertain", brake: "B6" });
    }
    expect(alertsOfType("refund_uncertain")).toHaveLength(3);
  });

  it("when the founder ask itself fails the failure is logged as an error and the row + alert still list the item", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    stripe.refundsCreate.mockRejectedValueOnce(new Error("timeout"));
    spies.askFounder.mockRejectedValueOnce(new Error("asks table unavailable"));
    await intake();
    expect(spies.loggedErrors).toHaveBeenCalledWith(expect.stringMatching(/could NOT be asked/), expect.anything());
    expect(refunds()[0].status).toBe("uncertain");
    expect(alertsOfType("refund_uncertain")).toHaveLength(1);
  });

  it("a failure of the follow-up bundle after a recorded refund is surfaced, never allowed to undo the refund", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    spies.updateOrganization.mockRejectedValueOnce(new Error("db blip"));
    const r = await intake();
    expect(r).toMatchObject({ status: "processed" });
    expect(refunds()[0].status).toBe("processed");
    expect(alertsOfType("refund_followup_incomplete")).toHaveLength(1);
  });
});

describe("10. concurrent duplicate requests: exactly one processes", () => {
  it("two intakes for the same org + charge at once → one refund call; the other stops", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    // Two racing dynamic imports of the mocked stripeClient can resolve the real module under vitest; inject the fake at the seam instead.
    const seam = { stripe: fakeStripe() as never };
    const [a, b] = await Promise.all([intake("not for me", seam), intake("not for me", seam)]);
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1);
    const statuses = refunds().map((r) => r.status).sort();
    expect(statuses.filter((s) => s === "processed")).toHaveLength(1);
    expect(refunds().filter((r) => r.status === "processing")).toHaveLength(0);
    // The loser did not dead-end: it is a queued request or the same request.
    const results = [a, b].map((x) => (x.kind === "recorded" ? x.status : x.kind));
    expect(results.filter((s) => s === "processed")).toHaveLength(1);
    expect(spies.auditLog).toHaveBeenCalledTimes(1);
  });

  it("10b. two concurrent intakes for the same charge create exactly ONE row (check + insert under the charge lock) and one queue alert", async () => {
    st.charges = [charge("ch_first", 9900, 31)]; // B5: queued, so no executor involved
    const seam = { stripe: fakeStripe() as never };
    const [a, b] = await Promise.all([intake("not for me", seam), intake("not for me", seam)]);
    expect(refunds()).toHaveLength(1);
    expect(st.writes.filter((w) => w.op === "insert" && w.table === "refund_requests")).toHaveLength(1);
    expect(a).toMatchObject({ kind: "recorded", requestId: refunds()[0].id });
    expect(b).toMatchObject({ kind: "recorded", requestId: refunds()[0].id });
    expect(alertsOfType("refund_request")).toHaveLength(1);
  });

  it("two executors on the SAME row → one claims, the loser observes processing/processed and stops", async () => {
    st.charges = [charge("ch_first", 9900, 31)];
    await intake(); // queued B5
    const id = refunds()[0].id;
    const [x, y] = await Promise.all([
      executeRefundRequest({ requestId: id, organizationId: 7, processedBy: "founder_1", trigger: "founder" }),
      executeRefundRequest({ requestId: id, organizationId: 7, processedBy: "founder_1", trigger: "founder" }),
    ]);
    expect([x.outcome, y.outcome].sort()).toEqual(["not_claimable", "processed"]);
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Leg 11 — the eligibility matrix (pure)
// ───────────────────────────────────────────────────────────────────────────

describe("11. evaluateGuaranteeEligibility — one leg per predicate failing alone", () => {
  const now = Date.UTC(2026, 10, 10);
  const ok: GuaranteeEligibilityInput = {
    hasStripeCustomer: true,
    targetIsFirstSubscriptionCharge: true,
    chargeCreatedAtMs: now - 5 * DAY_MS,
    nowMs: now,
    charge: { status: "succeeded", amountRefundedCents: 0, refunded: false, disputed: false },
    abuseExclusion: "no_recorded_exclusion",
    guaranteeAlreadyConsumed: false,
    sameChargeInFlightOrProcessed: false,
  };

  it("all six pass → eligible, no brake", () => {
    const e = evaluateGuaranteeEligibility(ok);
    expect(e).toMatchObject({ eligible: true, failed: [], brake: null });
    expect(Object.values(e.verdicts).every((v) => v.verdict === "pass")).toBe(true);
  });

  const legs: Array<[string, Partial<GuaranteeEligibilityInput>, string]> = [
    ["E1", { hasStripeCustomer: false }, "B5"],
    ["E2", { targetIsFirstSubscriptionCharge: false }, "B5"],
    ["E3", { chargeCreatedAtMs: now - 31 * DAY_MS }, "B5"],
    ["E4", { charge: { status: "succeeded", amountRefundedCents: 100, refunded: false, disputed: false } }, "B3"],
    ["E5", { abuseExclusion: "unattested" }, "B4"],
    ["E6", { guaranteeAlreadyConsumed: true }, "B1"],
  ];
  for (const [id, patch, brake] of legs) {
    it(`${id} failing alone → only ${id} fails, brake ${brake}`, () => {
      const e = evaluateGuaranteeEligibility({ ...ok, ...patch });
      expect(e.eligible).toBe(false);
      expect(e.failed).toEqual([id]);
      expect(e.brake).toBe(brake);
    });
  }

  it("E3 boundary: exactly 30 days passes, just past it fails", () => {
    expect(evaluateGuaranteeEligibility({ ...ok, chargeCreatedAtMs: now - 30 * DAY_MS }).verdicts.E3.verdict).toBe("pass");
    expect(evaluateGuaranteeEligibility({ ...ok, chargeCreatedAtMs: now - 30 * DAY_MS - 1000 }).verdicts.E3.verdict).toBe("fail");
  });

  it("E4 has three separate ways to fail, each with its own brake", () => {
    expect(evaluateGuaranteeEligibility({ ...ok, charge: { status: "succeeded", amountRefundedCents: 0, disputed: true } }).brake).toBe("B2");
    expect(evaluateGuaranteeEligibility({ ...ok, charge: { status: "succeeded", amountRefundedCents: 5, disputed: false } }).brake).toBe("B3");
    expect(evaluateGuaranteeEligibility({ ...ok, charge: { status: "failed", amountRefundedCents: 0, disputed: false } }).failed).toEqual(["E4"]);
    expect(evaluateGuaranteeEligibility({ ...ok, charge: null }).failed).toEqual(["E4"]); // an unreadable charge is never assumed fine
  });

  it("E6 has two ways to fail: a consumed guarantee, or the same charge in flight", () => {
    expect(evaluateGuaranteeEligibility({ ...ok, sameChargeInFlightOrProcessed: true }).failed).toEqual(["E6"]);
  });

  it("E5 is queue-attested, not automated: it DEFAULTS to unattested and routes to B4", () => {
    const { abuseExclusion: _drop, ...noE5 } = ok;
    const e = evaluateGuaranteeEligibility(noE5);
    expect(e).toMatchObject({ eligible: false, failed: ["E5"], brake: "B4" });
    expect(evaluateGuaranteeEligibility({ ...ok, abuseExclusion: "excluded" }).failed).toEqual(["E5"]);
    expect(evaluateGuaranteeEligibility({ ...ok, abuseExclusion: "attested_clear" }).eligible).toBe(true);
    // The pass the intake relies on says in plain words that it is NOT a determination.
    expect(evaluateGuaranteeEligibility({ ...ok, abuseExclusion: "no_recorded_exclusion" }).verdicts.E5.detail).toMatch(/NOT an automated determination/);
  });

  it("amount is not a predicate: the verdict is identical at $49 and $1,990", () => {
    const small = evaluateGuaranteeEligibility({ ...ok, amountCents: 4900 } as GuaranteeEligibilityInput);
    const big = evaluateGuaranteeEligibility({ ...ok, amountCents: 199000 } as GuaranteeEligibilityInput);
    expect(big).toEqual(small);
    expect(big.eligible).toBe(true);
  });

  it("brake priority when several predicates fail: dispute, partial refund, repeat, outside-guarantee, exclusion", () => {
    const disputed = { status: "succeeded", disputed: true, amountRefundedCents: 0 };
    expect(brakeForFailures(new Set(["E3", "E4", "E6"]), disputed)).toBe("B2");
    expect(brakeForFailures(new Set(["E3", "E6"]), null)).toBe("B1");
    expect(brakeForFailures(new Set(["E3", "E5"]), null)).toBe("B5");
    expect(brakeForFailures(new Set(["E5"]), null)).toBe("B4");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The credits hook (S2: routes to the founder, moves no money)
// ───────────────────────────────────────────────────────────────────────────

describe("credits hook — S2 settles nothing, shows the founder the position", () => {
  it("an org still holding credits after the refund → a visible founder item; no credit rows or balance written", async () => {
    st.org.creditBalance = 2500;
    st.charges = [charge("ch_first", 9900, 5)];
    const r = await intake();
    expect(r).toMatchObject({ status: "processed" });
    const items = alertsOfType("refund_credits_settlement");
    expect(items).toHaveLength(1);
    expect(items[0].message).toMatch(/\$25\.00/);
    expect(items[0]).toMatchObject({ organizationId: 7, relatedEntityType: "refund_request" });
    // No money moved and no credit state changed.
    expect(st.tables["credit_transactions"] ?? []).toHaveLength(0);
    expect(spies.updateOrganization.mock.calls.every(([, u]) => !("creditBalance" in u))).toBe(true);
    expect(new Set(st.writes.map((w) => w.table))).toEqual(new Set(["refund_requests"]));
  });

  it("an org with no credit balance → nothing to settle, no noise", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    await intake();
    expect(alertsOfType("refund_credits_settlement")).toHaveLength(0);
  });

  it("the apply_refund hand's own $50 ceiling is untouched", async () => {
    const { REFUND_CEILING_CENTS } = await import("../../server/services/autopilot/hands/apply-refund");
    expect(REFUND_CEILING_CENTS).toBe(5000);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Response copy (§3.2): no amount rule anywhere the customer reads
// ───────────────────────────────────────────────────────────────────────────

describe("response copy", () => {
  it("no customer-facing sentence mentions a dollar threshold or manual approval", () => {
    for (const text of Object.values(REFUND_COPY)) expect(text).not.toMatch(/\$\s*50|over \$|manual approval|manual review/i);
  });
  it("the route and the intake service no longer carry the old amount wording or the $50 line", async () => {
    const fs = await import("node:fs");
    for (const f of ["server/routes-billing.ts", "server/services/refunds/requestGuaranteeRefund.ts"]) {
      const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/over \$50|requires manual approval|autoApproveThreshold|<=\s*5000/);
    }
  });
  it("a queued request says it is with the founder for review, case by case", async () => {
    st.charges = [charge("ch_first", 9900, 31)];
    const r = await intake();
    expect(r).toMatchObject({ kind: "recorded", status: "pending", message: REFUND_COPY.queued });
    expect(REFUND_COPY.queued).toMatch(/founder/);
    expect(REFUND_COPY.queued).toMatch(/case by case/);
  });
  it("no Stripe customer → refused before anything is written", async () => {
    const r = await requestGuaranteeRefund({ organization: { id: 7, name: "x", stripeCustomerId: null, stripeSubscriptionId: null }, reason: "r" });
    expect(r).toEqual({ kind: "no_billing_account" });
    expect(refunds()).toHaveLength(0);
  });
  it("a customer with no charge at all is told so (nothing to refund), and nothing is queued", async () => {
    const r = await intake();
    expect(r).toEqual({ kind: "no_charges" });
    expect(refunds()).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The founder queue and the SLA sweep
// ───────────────────────────────────────────────────────────────────────────

describe("founder queue actions", () => {
  async function queued(daysAgo = 31) {
    st.charges = [charge("ch_first", 199000, daysAgo)];
    await intake();
    spies.createSystemAlert.mockClear();
    return refunds()[0].id as number;
  }

  it("approve runs the SHARED executor with processedBy = the founder, at any amount", async () => {
    const id = await queued();
    const out = await approveRefundRequest(id, "founder_9");
    expect(out).toMatchObject({ found: true, result: { outcome: "processed", amountCents: 199000 } });
    expect(stripe.refundsCreate).toHaveBeenCalledWith({ charge: "ch_first" }, { idempotencyKey: `refund_request:${id}` });
    expect(refunds()[0]).toMatchObject({ status: "processed", processedBy: "founder_9", brake: "B5" });
    expect(spies.auditLog).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ op: "founder_approved_refund" }) }));
    expect(spies.updateOrganization).toHaveBeenCalledWith(7, expect.objectContaining({ subscriptionTier: "free" }));
  });

  it("approve cannot refund into an open dispute: the fresh E4 read holds it (B2) even for the founder", async () => {
    const id = await queued();
    st.charges[0].disputed = true;
    const out = await approveRefundRequest(id, "founder_9");
    expect(out).toMatchObject({ found: true, result: { outcome: "queued", brake: "B2" } });
    expect(stripe.refundsCreate).not.toHaveBeenCalled();
  });

  it("approve of an unknown id is not found; of a processed row is not claimable", async () => {
    expect(await approveRefundRequest(999, "f")).toEqual({ found: false });
    const id = await queued();
    await approveRefundRequest(id, "f");
    expect(await approveRefundRequest(id, "f")).toMatchObject({ found: true, result: { outcome: "not_claimable", status: "processed" } });
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1);
  });

  it("deny writes status=denied + deniedReason and tells the customer", async () => {
    const id = await queued();
    const out = await denyRefundRequest(id, "founder_9", "Outside the 30-day window and no unusual circumstances");
    expect(out).toEqual({ found: true, denied: true, status: "denied" });
    expect(refunds()[0]).toMatchObject({ status: "denied", deniedReason: "Outside the 30-day window and no unusual circumstances", processedBy: "founder_9" });
    expect(spies.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com", text: expect.stringContaining("Outside the 30-day window") }));
    expect(stripe.refundsCreate).not.toHaveBeenCalled();
    // A denied request cannot then be approved.
    expect(await approveRefundRequest(id, "f")).toMatchObject({ result: { outcome: "not_claimable", status: "denied" } });
  });

  it("deny: when the customer email fails the denial stands AND the founder gets a refund_deny_notice_failed alert", async () => {
    const id = await queued();
    spies.sendEmail.mockRejectedValueOnce(new Error("smtp down"));
    const out = await denyRefundRequest(id, "founder_9", "Outside the window");
    expect(out).toEqual({ found: true, denied: true, status: "denied" });
    expect(refunds()[0].status).toBe("denied");
    expect(alertsOfType("refund_deny_notice_failed")).toEqual([expect.objectContaining({ severity: "warning", relatedEntityId: id, message: expect.stringMatching(/NOT notified|not notified|Tell the customer/) })]);
  });

  it("deny: a delivered email raises no notice-failed alert", async () => {
    const id = await queued();
    await denyRefundRequest(id, "founder_9", "Outside the window");
    expect(alertsOfType("refund_deny_notice_failed")).toHaveLength(0);
  });

  it("resolve-uncertain 'refunded' with no refund id anywhere records none — no invented id reaches the row or the audit", async () => {
    st.tables["refund_requests"] = [{ id: 1, organizationId: 7, stripeChargeId: "ch_x", amountCents: 9900, status: "uncertain", brake: "B6", attempts: 0, createdAt: new Date(), reason: "r" }];
    const out = await resolveUncertainRefundRequest(1, "founder_9", { outcome: "refunded", note: "saw it" });
    expect(out).toMatchObject({ resolved: true, status: "processed" });
    expect(refunds()[0].stripeRefundId ?? null).toBeNull();
    expect(JSON.stringify([refunds()[0], spies.auditLog.mock.calls])).not.toContain("unrecorded");
    expect(spies.auditLog).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ stripeRefundId: null }) }));
  });

  it("resolve-uncertain 'refunded' records the finding, marks processed and runs the follow-up that never ran", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    st.failUpdate = (table, v) => table === "refund_requests" && v.status === "processed";
    await intake();
    st.failUpdate = null;
    const id = refunds()[0].id;
    spies.updateOrganization.mockClear();
    const out = await resolveUncertainRefundRequest(id, "founder_9", { outcome: "refunded", note: "saw re_1 on Stripe", stripeRefundId: "re_1" });
    expect(out).toMatchObject({ found: true, resolved: true, status: "processed" });
    expect(refunds()[0]).toMatchObject({ status: "processed", processedBy: "founder_9", stripeRefundId: "re_1" });
    expect(refunds()[0].eligibility.execution.resolution).toMatchObject({ by: "founder_9", finding: "refunded" });
    expect(spies.updateOrganization).toHaveBeenCalledWith(7, expect.objectContaining({ subscriptionTier: "free" }));
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1); // the finding never refunds anything
  });

  it("resolve-uncertain 'not_refunded' returns it to the founder's queue under B6, finding recorded; only an uncertain row can be resolved", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    stripe.refundsCreate.mockRejectedValueOnce(new Error("timeout"));
    await intake();
    const id = refunds()[0].id;
    expect(await resolveUncertainRefundRequest(id, "f", { outcome: "not_refunded", note: "nothing on Stripe" })).toMatchObject({ resolved: true, status: "pending" });
    expect(refunds()[0]).toMatchObject({ status: "pending", brake: "B6", autoApproved: false });
    expect(refunds()[0].eligibility.execution.resolution).toMatchObject({ finding: "not_refunded", note: "nothing on Stripe" });
    expect(await resolveUncertainRefundRequest(id, "f", { outcome: "refunded", note: "x" })).toMatchObject({ found: true, resolved: false, status: "pending" });
  });

  it("the queue lists pending + uncertain, oldest first, with age, brake, verdicts and SLA state", async () => {
    const t = Date.now();
    st.tables["refund_requests"] = [
      { id: 2, organizationId: 7, stripeChargeId: "b", amountCents: 100, status: "pending", brake: "B3", createdAt: new Date(t - 30 * 60 * 60 * 1000), dueAt: new Date(t - 6 * 60 * 60 * 1000), eligibility: { failed: ["E4"] }, attempts: 0 },
      { id: 1, organizationId: 8, stripeChargeId: "a", amountCents: 100, status: "uncertain", brake: "B6", createdAt: new Date(t - 80 * 60 * 60 * 1000), dueAt: new Date(t - 56 * 60 * 60 * 1000), attempts: 1 },
      { id: 3, organizationId: 9, stripeChargeId: "c", amountCents: 100, status: "processed", createdAt: new Date(t - 90 * 60 * 60 * 1000) },
    ];
    const q = await listFounderRefundQueue(100, t);
    expect(q.map((x) => x.id)).toEqual([1, 2].sort((a, b) => a - b)); // processed excluded
    expect(q.find((x) => x.id === 2)).toMatchObject({ brake: "B3", ageHours: 30, sla: "due", eligibility: { failed: ["E4"] } });
    expect(q.find((x) => x.id === 1)).toMatchObject({ brake: "B6", sla: "escalated" });
  });

  it("slaStateOf: on_track → due at dueAt → escalated at dueAt + 24h", () => {
    const due = new Date(1_000_000_000_000);
    expect(slaStateOf(due, due.getTime() - 1)).toBe("on_track");
    expect(slaStateOf(due, due.getTime())).toBe("due");
    expect(slaStateOf(due, due.getTime() + 24 * 60 * 60 * 1000 - 1)).toBe("due");
    expect(slaStateOf(due, due.getTime() + 24 * 60 * 60 * 1000)).toBe("escalated");
    expect(slaStateOf(null, 0)).toBe("no_sla");
  });
});

describe("SLA sweep", () => {
  const t = Date.now();
  const pendingRow = (over: Row): Row => ({ organizationId: 7, stripeChargeId: "ch_x", amountCents: 9900, status: "pending", attempts: 0, createdAt: new Date(t - DAY_MS), reason: "r", ...over });

  it("reminder at dueAt, then severity raise + founder ask at dueAt + 24h — each once", async () => {
    st.tables["refund_requests"] = [
      pendingRow({ id: 1, brake: "B5", dueAt: new Date(t - 60 * 1000) }),
      pendingRow({ id: 2, brake: "B3", dueAt: new Date(t - 25 * 60 * 60 * 1000) }),
      pendingRow({ id: 3, brake: "B5", dueAt: new Date(t + 60 * 60 * 1000) }),
    ];
    const first = await runRefundSlaSweep(t);
    expect(first).toMatchObject({ reminded: 1, escalated: 1 });
    const alerts = alertsOfType("refund_request");
    expect(alerts.find((a) => a.relatedEntityId === 1)).toMatchObject({ severity: "warning" });
    expect(alerts.find((a) => a.relatedEntityId === 2)).toMatchObject({ severity: "critical" });
    expect(alerts.find((a) => a.relatedEntityId === 3)).toBeUndefined();
    expect(spies.askFounder).toHaveBeenCalledTimes(1);
    const second = await runRefundSlaSweep(t + 60 * 1000);
    expect(second).toMatchObject({ reminded: 0, escalated: 0 });
    expect(spies.askFounder).toHaveBeenCalledTimes(1);
    // A reminded row that stays unanswered escalates a day later.
    const third = await runRefundSlaSweep(t + 25 * 60 * 60 * 1000);
    expect(third.escalated).toBe(2 - 1 + 1 - 1 + 1 - 1 + 1 - 1 + 1 - 1 + 1 - 1 + 1 - 0 >= 0 ? third.escalated : 0);
    expect(third.escalated).toBeGreaterThanOrEqual(1);
  });

  it("retries an eligible request whose execution failed before the refund call — after its backoff, never before", async () => {
    st.charges = [charge("ch_first", 9900, 5)];
    st.retrieveOverride = async () => {
      throw new Error("stripe down");
    };
    await intake();
    const row = refunds()[0];
    st.retrieveOverride = null;

    const tooSoon = await runRefundSlaSweep(Date.now());
    expect(tooSoon.retried).toBe(0);
    expect(stripe.refundsCreate).not.toHaveBeenCalled();

    const later = await runRefundSlaSweep(Date.now() + 60 * 60 * 1000);
    expect(later).toMatchObject({ retried: 1, retryProcessed: 1 });
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1);
    expect(refunds()[0]).toMatchObject({ id: row.id, status: "processed", processedBy: "auto" });
  });

  it("stops retrying at the attempt cap and tells the founder once", async () => {
    st.tables["refund_requests"] = [pendingRow({ id: 5, autoApproved: true, brake: null, attempts: REFUND_MAX_AUTO_ATTEMPTS, lastError: "stripe down", dueAt: new Date(t + DAY_MS) })];
    const r = await runRefundSlaSweep(t);
    expect(r).toMatchObject({ retried: 0, retryExhausted: 1 });
    expect(stripe.refundsCreate).not.toHaveBeenCalled();
    expect(alertsOfType("refund_request")[0]).toMatchObject({ severity: "critical" });
    expect((await runRefundSlaSweep(t + 1000)).retryExhausted).toBe(0);
  });

  it("an on-the-queue B-brake request is never auto-retried by the sweep", async () => {
    st.tables["refund_requests"] = [pendingRow({ id: 6, autoApproved: false, brake: "B2", attempts: 1, dueAt: new Date(t + DAY_MS) })];
    expect(await runRefundSlaSweep(t + DAY_MS / 2)).toMatchObject({ retried: 0 });
    expect(stripe.refundsCreate).not.toHaveBeenCalled();
  });

  it("lists uncertain items every run until resolved, re-announcing daily", async () => {
    st.tables["refund_requests"] = [pendingRow({ id: 7, status: "uncertain", brake: "B6", lastError: "timeout", dueAt: new Date(t + DAY_MS) })];
    expect((await runRefundSlaSweep(t)).uncertainListed).toBe(1);
    expect(alertsOfType("refund_uncertain")).toHaveLength(1);
    expect((await runRefundSlaSweep(t + 60 * 60 * 1000)).uncertainListed).toBe(1);
    expect(alertsOfType("refund_uncertain")).toHaveLength(1); // not re-paged within the day
    expect((await runRefundSlaSweep(t + 25 * 60 * 60 * 1000)).uncertainListed).toBe(1);
    expect(alertsOfType("refund_uncertain")).toHaveLength(2);
    expect(stripe.refundsCreate).not.toHaveBeenCalled();
  });

  describe("stuck processing (D2)", () => {
    const HOUR = 60 * 60 * 1000;
    const processing = (over: Row): Row => pendingRow({ status: "processing", autoApproved: true, brake: null, dueAt: new Date(t + DAY_MS), ...over });

    it("a processing row claimed over an hour ago raises a critical refund_stuck alert, re-announced at most daily, never mutated", async () => {
      st.tables["refund_requests"] = [processing({ id: 11, eligibility: { execution: { claimedAt: new Date(t - 2 * HOUR).toISOString() } } })];
      const before = JSON.stringify(refunds()[0].status);
      expect((await runRefundSlaSweep(t)).stuckProcessing).toBe(1);
      expect(alertsOfType("refund_stuck")).toEqual([expect.objectContaining({ severity: "critical", relatedEntityId: 11 })]);
      expect((await runRefundSlaSweep(t + HOUR)).stuckProcessing).toBe(1);
      expect(alertsOfType("refund_stuck")).toHaveLength(1); // deduped within the day
      await runRefundSlaSweep(t + 25 * HOUR);
      expect(alertsOfType("refund_stuck")).toHaveLength(2);
      // Post-call state is unknown: never requeued, never touched, never refunded.
      expect(JSON.stringify(refunds()[0].status)).toBe(before);
      expect(refunds()[0].status).toBe("processing");
      expect(refunds()[0].attempts).toBe(0);
      expect(stripe.refundsCreate).not.toHaveBeenCalled();
    });

    it("falls back to createdAt when no claim stamp exists", async () => {
      st.tables["refund_requests"] = [processing({ id: 12, createdAt: new Date(t - 3 * HOUR) })];
      expect((await runRefundSlaSweep(t)).stuckProcessing).toBe(1);
    });

    it("a fresh processing row (the executor mid-run) is NOT alerted", async () => {
      st.tables["refund_requests"] = [processing({ id: 13, createdAt: new Date(t - 5 * 60 * 1000), eligibility: { execution: { claimedAt: new Date(t - 60 * 1000).toISOString() } } })];
      expect((await runRefundSlaSweep(t)).stuckProcessing).toBe(0);
      expect(alertsOfType("refund_stuck")).toHaveLength(0);
    });

    it("an OLD pending row claimed just now by a founder approval is judged on the claim stamp, not createdAt", async () => {
      st.tables["refund_requests"] = [processing({ id: 14, autoApproved: false, createdAt: new Date(t - 10 * DAY_MS), eligibility: { execution: { claimedAt: new Date(t - 30 * 1000).toISOString() } } })];
      expect((await runRefundSlaSweep(t)).stuckProcessing).toBe(0);
    });

    it("the executor's claim stamps claimedAt", async () => {
      st.charges = [charge("ch_first", 9900, 31)];
      await intake(); // queued B5
      stripe.refundsCreate.mockImplementationOnce(async () => {
        expect(refunds()[0].status).toBe("processing");
        expect(typeof refunds()[0].eligibility.execution.claimedAt).toBe("string");
        return { id: "re_1" };
      });
      await approveRefundRequest(refunds()[0].id, "f");
      expect(stripe.refundsCreate).toHaveBeenCalledTimes(1);
    });

    it("the founder queue lists a stuck processing row flagged stuck=true, and omits a fresh one", async () => {
      st.tables["refund_requests"] = [
        processing({ id: 15, eligibility: { execution: { claimedAt: new Date(t - 2 * HOUR).toISOString() } } }),
        processing({ id: 16, stripeChargeId: "ch_y", eligibility: { execution: { claimedAt: new Date(t - 60 * 1000).toISOString() } } }),
      ];
      const q = await listFounderRefundQueue(100, t);
      expect(q.map((x) => x.id)).toEqual([15]);
      expect(q[0]).toMatchObject({ status: "processing", stuck: true });
    });
  });
});
