/**
 * Refund automation S2, against a real Postgres (design 2026-11 §5, Realdb).
 *
 * Mirrors the PKG-3 settlement-proof pattern: Stripe is stubbed at the client
 * seam (server/stripeClient), everything else is real — the refund_requests
 * rows, the executor's conditional-update claim, the webhook handler's GL and
 * financial-ledger posts, the dead-letter table and the SLA sweep.
 *
 * What a fake cannot evaluate: the SQL (conditional claim, unique
 * external_event_id, the dead-letter upsert) and that the REAL
 * WebhookHandlers.processChargeRefunded lands the refund posts single-counted
 * when the synthetic charge.refunded event is delivered twice.
 *
 * Only stubbed: Stripe, outbound email, the founder-ask channel, the logger.
 * Runs where ACREOS_REAL_DATABASE_URL is set (CI builds the schema); elsewhere
 * it SKIPS, and a skip is not proof.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

useRealDb("refundGuarantee.realdb.test.ts");

const DAY_MS = 24 * 60 * 60 * 1000;

type Charge = Record<string, any>;
const stripeState = vi.hoisted(() => ({
  charges: [] as Charge[],
  refundSeq: 0,
  // Plain function types, not ReturnType<typeof vi.fn>: that is
  // Mock<Procedure | Constructable>, which TS refuses to call (TS2348) at the
  // seam spreads below. The values assigned are vi.fn mocks; the assertions
  // read them through expect(), which does not care about the declared type.
  refundsCreate: undefined as unknown as (...args: any[]) => Promise<any>,
  subscriptionsCancel: undefined as unknown as (...args: any[]) => Promise<any>,
  glFails: false,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/emailService", () => ({ emailService: { sendEmail: vi.fn(async () => ({})) } }));
vi.mock("../../server/services/solene/founderCollab", () => ({
  askFounder: vi.fn(async () => ({ askId: 1, pagerFired: false, pagerEventId: null, deduped: false })),
}));
vi.mock("../../server/routes-subscription", () => ({ recordSubscriptionHistoryEvent: vi.fn(async () => undefined) }));

// The client seam: a Stripe whose reads come from stripeState and whose refund
// writes are spies. Nothing past this line is faked.
vi.mock("../../server/stripeClient", () => {
  const stripe = () => {
    const sorted = () => [...stripeState.charges].sort((a, b) => a.created - b.created);
    return {
      charges: {
        list: async () => ({ data: [...stripeState.charges].sort((a, b) => b.created - a.created), has_more: false }),
        retrieve: async (id: string) => {
          const c = stripeState.charges.find((x) => x.id === id);
          if (!c) throw new Error(`no such charge ${id}`);
          return c;
        },
      },
      invoices: {
        list: async () => {
          const first = sorted()[0];
          return { data: first ? [{ id: `in_${first.id}`, created: first.created, status: "paid", amount_paid: first.amount, subscription: first.subscription }] : [], has_more: false };
        },
      },
      invoicePayments: {
        list: async () => ({ data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: sorted()[0]?.payment_intent } }] }),
      },
      paymentIntents: { retrieve: async () => ({ latest_charge: sorted()[0]?.id }) },
      refunds: { create: (...a: unknown[]) => stripeState.refundsCreate(...a) },
      subscriptions: { cancel: (...a: unknown[]) => stripeState.subscriptionsCancel(...a) },
    };
  };
  return { getUncachableStripeClient: async () => stripe() };
});

// The one controllable seam inside the real webhook path: the recognition GL
// post can be made to fail so the gl_refund dead-letter branch is exercised.
vi.mock("../../server/services/recognitionWorker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/recognitionWorker")>();
  return {
    ...actual,
    recordStripeChargeRefunded: (args: Parameters<typeof actual.recordStripeChargeRefunded>[0]) =>
      stripeState.glFails ? Promise.reject(new Error("recognition post forced to fail")) : actual.recordStripeChargeRefunded(args),
  };
});

const tag = `rg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const orgIds: number[] = [];

async function makeOrg(opts: { interval?: "month" | "year"; tier?: string } = {}) {
  const { db } = await import("../../server/db");
  const { organizations } = await import("@shared/schema");
  const n = orgIds.length;
  const slug = `${tag}-${n}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: `Refund Realdb ${n}`,
      slug,
      ownerId: `${slug}-owner`,
      subscriptionTier: opts.tier ?? "pro",
      subscriptionStatus: "active",
      billingInterval: opts.interval ?? "month",
      stripeCustomerId: `cus_${slug}`,
      stripeSubscriptionId: `sub_${slug}`,
    } as any)
    .returning();
  orgIds.push(org.id);
  return org as { id: number; name: string; stripeCustomerId: string; stripeSubscriptionId: string };
}

const chargeFor = (org: { id: number; stripeSubscriptionId: string }, amount: number, daysAgo: number, label: string): Charge => ({
  id: `ch_${tag}_${label}`,
  amount,
  created: Math.floor((Date.now() - daysAgo * DAY_MS) / 1000),
  status: "succeeded",
  paid: true,
  refunded: false,
  disputed: false,
  amount_refunded: 0,
  payment_intent: `pi_${tag}_${label}`,
  subscription: org.stripeSubscriptionId,
});

async function intake(org: { id: number; name: string; stripeCustomerId: string; stripeSubscriptionId: string }) {
  const { requestGuaranteeRefund } = await import("../../server/services/refunds/requestGuaranteeRefund");
  return requestGuaranteeRefund({
    organization: { id: org.id, name: org.name, stripeCustomerId: org.stripeCustomerId, stripeSubscriptionId: org.stripeSubscriptionId },
    userId: `${tag}-user`,
    reason: "not for me",
    actor: { userId: `${tag}-user` },
  });
}

async function refundRows(orgId: number) {
  const { db } = await import("../../server/db");
  const { refundRequests } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(refundRequests).where(eq(refundRequests.organizationId, orgId));
}

async function ledgerRowsFor(externalEventId: string) {
  const { db } = await import("../../server/db");
  const { financialLedger } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(financialLedger).where(eq(financialLedger.externalEventId, externalEventId));
}

async function glRowsFor(orgId: number, chargeId: string) {
  const { db } = await import("../../server/db");
  const { accountLedgerEntries } = await import("@shared/schema");
  const { and, eq } = await import("drizzle-orm");
  return db
    .select()
    .from(accountLedgerEntries)
    .where(and(eq(accountLedgerEntries.organizationId, orgId), eq(accountLedgerEntries.referenceId, `charge.refunded:${chargeId}`)));
}

/** The synthetic charge.refunded Stripe would send after the refund the executor created. */
function refundedEvent(org: { stripeCustomerId: string }, ch: Charge, refundId: string) {
  return {
    id: ch.id,
    customer: org.stripeCustomerId,
    amount: ch.amount,
    amount_refunded: ch.amount,
    refunded: true,
    invoice: `in_${ch.id}`,
    refunds: { data: [{ id: refundId }] },
  } as any;
}

describe.runIf(realDbAvailable)("guarantee refunds: intake → process → ledger (real database)", () => {
  vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS, hookTimeout: REPO_SWEEP_TIMEOUT_MS });

  beforeAll(async () => {
    await import("../../server/db");
  });

  beforeEach(() => {
    stripeState.charges = [];
    stripeState.glFails = false;
    stripeState.refundsCreate = vi.fn(async () => ({ id: `re_${tag}_${++stripeState.refundSeq}` }));
    stripeState.subscriptionsCancel = vi.fn(async () => ({}));
  });

  afterAll(async () => {
    if (orgIds.length === 0) return;
    const { db } = await import("../../server/db");
    const schema = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");
    const attempt = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* best-effort fixture cleanup */
      }
    };
    await attempt(() => db.delete(schema.refundRequests).where(inArray(schema.refundRequests.organizationId, orgIds)));
    await attempt(() => db.delete(schema.ledgerDeadLetters).where(inArray(schema.ledgerDeadLetters.organizationId, orgIds)));
    await attempt(() => db.delete(schema.financialLedger).where(inArray(schema.financialLedger.organizationId, orgIds)));
    await attempt(() => db.delete(schema.accountLedgerEntries).where(inArray(schema.accountLedgerEntries.organizationId, orgIds)));
    await attempt(() => db.delete(schema.chartOfAccounts).where(inArray(schema.chartOfAccounts.organizationId, orgIds)));
    await attempt(() => db.delete(schema.systemAlerts).where(inArray(schema.systemAlerts.organizationId, orgIds)));
    await attempt(() => db.delete(schema.organizations).where(inArray(schema.organizations.id, orgIds)));
  });

  it("$99 Pro monthly, first charge, day 5: intake processes it in full with the idempotency key; the replayed charge.refunded lands once", async () => {
    const org = await makeOrg();
    const ch = chargeFor(org, 9900, 5, "99");
    stripeState.charges = [ch];

    const r = await intake(org);
    expect(r).toMatchObject({ kind: "recorded", status: "processed", amountCents: 9900 });

    const [row] = await refundRows(org.id);
    expect(row).toMatchObject({ status: "processed", processedBy: "auto", autoApproved: true, amountCents: 9900, stripeChargeId: ch.id });
    expect(row.stripeRefundId).toMatch(new RegExp(`^re_${tag}_`));
    expect(stripeState.refundsCreate).toHaveBeenCalledTimes(1);
    expect(stripeState.refundsCreate).toHaveBeenCalledWith({ charge: ch.id }, { idempotencyKey: `refund_request:${row.id}` });
    expect(stripeState.subscriptionsCancel).toHaveBeenCalledWith(org.stripeSubscriptionId);

    // The same request again does not refund twice.
    await intake(org);
    expect(stripeState.refundsCreate).toHaveBeenCalledTimes(1);

    // Stripe's webhook for that refund — delivered twice.
    const { WebhookHandlers } = await import("../../server/webhookHandlers");
    const event = refundedEvent(org, ch, row.stripeRefundId as string);
    await WebhookHandlers.processChargeRefunded(event);
    await WebhookHandlers.processChargeRefunded(event);

    const fin = await ledgerRowsFor(`stripe:refund:${row.stripeRefundId}`);
    expect(fin).toHaveLength(1);
    expect(fin[0]).toMatchObject({ organizationId: org.id, bucket: "refund_reserve", amountCents: -9900 });
    const gl = await glRowsFor(org.id, ch.id);
    expect(gl).toHaveLength(2); // one balanced tuple: DR revenue / CR cash — not doubled by the redelivery
  });

  it("$1,990 Scale annual, first charge, day 29 — the amount that could never process before — is processed and single-counted", async () => {
    const org = await makeOrg({ interval: "year", tier: "scale" });
    const ch = chargeFor(org, 199000, 29, "1990");
    stripeState.charges = [ch];

    const r = await intake(org);
    expect(r).toMatchObject({ kind: "recorded", status: "processed", amountCents: 199000 });
    const [row] = await refundRows(org.id);
    expect(row).toMatchObject({ status: "processed", processedBy: "auto", amountCents: 199000 });
    expect(stripeState.refundsCreate).toHaveBeenCalledWith({ charge: ch.id }, { idempotencyKey: `refund_request:${row.id}` });

    const { WebhookHandlers } = await import("../../server/webhookHandlers");
    const event = refundedEvent(org, ch, row.stripeRefundId as string);
    await WebhookHandlers.processChargeRefunded(event);
    await WebhookHandlers.processChargeRefunded(event);
    const fin = await ledgerRowsFor(`stripe:refund:${row.stripeRefundId}`);
    expect(fin).toHaveLength(1);
    expect(fin[0].amountCents).toBe(-199000);
    expect(await glRowsFor(org.id, ch.id)).toHaveLength(2);
  });

  it("a failing recognition GL post is dead-lettered as gl_refund, and the financial-ledger refund still posts", async () => {
    const org = await makeOrg();
    const ch = chargeFor(org, 9900, 3, "glfail");
    stripeState.charges = [ch];
    await intake(org);
    const [row] = await refundRows(org.id);

    stripeState.glFails = true;
    const { WebhookHandlers } = await import("../../server/webhookHandlers");
    await WebhookHandlers.processChargeRefunded(refundedEvent(org, ch, row.stripeRefundId as string));

    const { db } = await import("../../server/db");
    const { ledgerDeadLetters } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { glRefundDeadLetterId } = await import("../../server/services/ledgerDeadLetter");
    const dead = await db.select().from(ledgerDeadLetters).where(eq(ledgerDeadLetters.externalEventId, glRefundDeadLetterId(ch.id)));
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ kind: "gl_refund", status: "pending", organizationId: org.id });
    expect(dead[0].lastError).toContain("recognition post forced to fail");

    expect(await glRowsFor(org.id, ch.id)).toHaveLength(0); // the GL post did not land
    expect(await ledgerRowsFor(`stripe:refund:${row.stripeRefundId}`)).toHaveLength(1); // the ledger post is independent of it
  });

  it("a queued request moves due → reminded → escalated by the SLA sweep, each stamp firing once, against real rows", async () => {
    const { db } = await import("../../server/db");
    const { refundRequests } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { runRefundSlaSweep } = await import("../../server/services/refunds/refundQueue");

    const org = await makeOrg();
    const now = Date.now();
    const insert = async (label: string, dueAt: Date) => {
      const [r] = await db
        .insert(refundRequests)
        .values({
          organizationId: org.id,
          stripeChargeId: `ch_${tag}_${label}`,
          amountCents: 9900,
          reason: "late",
          status: "pending",
          autoApproved: false,
          brake: "B5",
          dueAt,
          eligibility: { eligible: false, failed: ["E3"] },
        } as any)
        .returning();
      return r.id as number;
    };
    const onTrack = await insert("ontrack", new Date(now + 6 * 60 * 60 * 1000));
    const due = await insert("due", new Date(now - 2 * 60 * 60 * 1000));
    const overdue = await insert("overdue", new Date(now - 30 * 60 * 60 * 1000));
    const execOf = async (id: number) => {
      const [r] = await db.select().from(refundRequests).where(eq(refundRequests.id, id));
      return { status: r.status, exec: ((r.eligibility as any)?.execution ?? {}) as Record<string, string> };
    };

    await runRefundSlaSweep(now);
    expect((await execOf(onTrack)).exec).toEqual({});
    expect((await execOf(due)).exec.remindedAt).toBeTruthy();
    expect((await execOf(due)).exec.escalatedAt).toBeUndefined();
    const overdueState = await execOf(overdue);
    expect(overdueState.exec.escalatedAt).toBeTruthy();
    const stampedAt = overdueState.exec.escalatedAt;

    // A second sweep re-fires nothing it already stamped, and every request is still pending (the sweep never decides).
    await runRefundSlaSweep(now + 60_000);
    expect((await execOf(overdue)).exec.escalatedAt).toBe(stampedAt);
    expect((await execOf(due)).status).toBe("pending");

    // Time passes: the due request is now past its escalation window and escalates; the on-track one becomes due.
    await runRefundSlaSweep(now + 26 * 60 * 60 * 1000);
    expect((await execOf(due)).exec.escalatedAt).toBeTruthy();
    expect((await execOf(onTrack)).exec.remindedAt).toBeTruthy();
  });
});
