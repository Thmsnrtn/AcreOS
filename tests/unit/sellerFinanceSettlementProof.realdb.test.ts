/**
 * PKG-3 — seller-finance settlement proof (legs 1–7).
 *
 * Legs: 1 signed happy path; 2 redelivery (same event / same session, new
 * event); 3 late fee after grace; 4 periodic statement; 5 declined/unpaid is
 * neutral; 6 cross-tenant metadata refused; 7 payment-link variant +
 * connected-account tenant check. Legs run in file order; legs 2 and 4 depend
 * on leg 1.
 *
 * LEG 7: payment-link sessions (metadata paymentType 'note_payment', no
 * borrower token) post through the same posting rule when — and only when —
 * the event's connected account is the metadata org's own Stripe Connect
 * account. The leg calls `WebhookHandlers.processPaymentLinkNotePayment`
 * directly with a plain session object: Connect-endpoint signature
 * verification is upstream plumbing, exercised live only in the owed live
 * leg. A foreign connected account is refused (no row, no balance movement).
 *
 * LEG 3 arithmetic (note2, hand-computed): $25 late fee assessed on the
 * 2026-10-01 installment (39+ days past due vs 10-day grace at the real clock);
 * pay $880 = $800 installment + $80 excess; fee collected $25 from the excess;
 * split on $855 → interest $600 / principal $255; balance $119,745.
 *
 * LEG 1:
 * A signed Stripe `checkout.session.completed` for a borrower-portal payment is
 * driven through the REAL `WebhookHandlers.processWebhook` against a REAL
 * Postgres. Expectations are HAND-COMPUTED (never derived from
 * `splitPaymentCents`):
 *
 *   payment $800.00 on balance $120,000.00 at 6.00%
 *   monthly interest = 120000 * 600bps / 120000 = $600.00
 *   principal        = 800 - 600                = $200.00
 *   late fee         = $0 (due date 2099-02-15 is in the future)
 *   new balance      = 120000 - 200             = $119,800.00
 *
 * Units (portalPaymentPosting.ts:381-394): `payments.amount`, `principal_amount`,
 * `interest_amount`, `late_fee_amount` are DOLLAR numerics written as strings
 * ((cents/100).toString(), e.g. "600" — compare numerically, not textually).
 * There is no `source` column on `payments`; the source is carried on the
 * `payment.received` event only, so it is asserted as `payment_method = 'card'`
 * and `status = 'completed'`.
 *
 * Skips without ACREOS_REAL_DATABASE_URL; runs in the CI jobs that build a schema.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

// Module scope, BEFORE anything imports server/db.
useRealDb("sellerFinanceSettlementProof");

// Stripe is constructed from env only; the HMAC is pure/offline. Set before
// any server module is imported (all server imports below are dynamic).
process.env.STRIPE_SECRET_KEY ||= "sk_test_pkg3_synthetic";
const WEBHOOK_SECRET = "whsec_pkg3_synthetic";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const ACCESS_TOKEN = `pkg3_tok_${suffix}`;
const ACCESS_TOKEN_2 = `pkg3_tok2_${suffix}`;
const ACCESS_TOKEN_3 = `pkg3_tok3_${suffix}`;
const CONNECT_ACCT = `acct_test_pkg3_${suffix}`;
const SESSION_LEG1 =`cs_test_pkg3_leg1_${suffix}`;

const describeReal = realDbAvailable ? describe : describe.skip;

describeReal("seller-finance settlement proof (real DB)", () => {
  let db: any;
  let schema: typeof import("../../shared/schema");
  let drizzle: typeof import("drizzle-orm");
  let WebhookHandlers: any;
  let Stripe: any;
  let orgId: number;
  let userId: any;
  let leadId: number;
  let noteId: number;
  let note2Id: number;
  let note3Id: number;
  let note4Id: number;
  let org2Id: number;

  beforeAll(async () => {
    drizzle = await import("drizzle-orm");
    schema = await import("../../shared/schema");
    ({ db } = await import("../../server/db"));
    ({ WebhookHandlers } = await import("../../server/webhookHandlers"));
    Stripe = (await import("stripe")).default;

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: `PKG3 Proof ${suffix}`, slug: `pkg3-proof-${suffix}` })
      .returning();
    orgId = org.id;

    const [user] = await db
      .insert(schema.users)
      .values({
        email: `pkg3-${suffix}@example.test`,
        password: "not-a-real-hash",
        firstName: "Pkg",
        lastName: "Three",
      })
      .returning();
    userId = user.id;

    const [lead] = await db
      .insert(schema.leads)
      .values({ organizationId: orgId, firstName: "Bo", lastName: "Rrower" })
      .returning();
    leadId = lead.id;

    const [note] = await db
      .insert(schema.notes)
      .values({
        organizationId: orgId,
        borrowerId: leadId,
        originalPrincipal: "120000.00",
        currentBalance: "120000.00",
        interestRate: "6.00",
        termMonths: 360,
        monthlyPayment: "800.00",
        startDate: new Date("2099-01-15T12:00:00Z"),
        firstPaymentDate: new Date("2099-02-15T12:00:00Z"),
        nextPaymentDate: new Date("2099-02-15T12:00:00Z"),
        status: "active",
        atrExemptionCode: "legacy",
        accessToken: ACCESS_TOKEN,
        amortizationSchedule: [
          { paymentNumber: 1, dueDate: "2099-02-15", payment: 800, principal: 200, interest: 600, balance: 119800, status: "pending" },
          { paymentNumber: 2, dueDate: "2099-03-15", payment: 800, principal: 201, interest: 599, balance: 119599, status: "pending" },
        ],
      } as any)
      .returning();
    noteId = note.id;

    const [org2] = await db
      .insert(schema.organizations)
      .values({ name: `PKG3 Proof Other ${suffix}`, slug: `pkg3-proof-other-${suffix}` })
      .returning();
    org2Id = org2.id;

    // note2: past-due installment with a $25 late fee, 10-day grace (leg 3).
    const [n2] = await db
      .insert(schema.notes)
      .values({
        organizationId: orgId,
        borrowerId: leadId,
        originalPrincipal: "120000.00",
        currentBalance: "120000.00",
        interestRate: "6.00",
        termMonths: 360,
        monthlyPayment: "800.00",
        lateFee: "25.00",
        gracePeriodDays: 10,
        startDate: new Date("2026-09-01T12:00:00Z"),
        firstPaymentDate: new Date("2026-10-01T12:00:00Z"),
        nextPaymentDate: new Date("2026-10-01T12:00:00Z"),
        status: "active",
        atrExemptionCode: "legacy",
        accessToken: ACCESS_TOKEN_2,
        amortizationSchedule: [
          { paymentNumber: 1, dueDate: "2026-10-01", payment: 800, principal: 200, interest: 600, balance: 119800, status: "pending" },
          { paymentNumber: 2, dueDate: "2026-11-01", payment: 800, principal: 201, interest: 599, balance: 119599, status: "pending" },
        ],
      } as any)
      .returning();
    note2Id = n2.id;

    // note3: untouched target for legs 5–6 (future due date, no late fee).
    const [n3] = await db
      .insert(schema.notes)
      .values({
        organizationId: orgId,
        borrowerId: leadId,
        originalPrincipal: "120000.00",
        currentBalance: "120000.00",
        interestRate: "6.00",
        termMonths: 360,
        monthlyPayment: "800.00",
        startDate: new Date("2099-01-15T12:00:00Z"),
        firstPaymentDate: new Date("2099-02-15T12:00:00Z"),
        nextPaymentDate: new Date("2099-02-15T12:00:00Z"),
        status: "active",
        atrExemptionCode: "legacy",
        accessToken: ACCESS_TOKEN_3,
        amortizationSchedule: [
          { paymentNumber: 1, dueDate: "2099-02-15", payment: 800, principal: 200, interest: 600, balance: 119800, status: "pending" },
          { paymentNumber: 2, dueDate: "2099-03-15", payment: 800, principal: 201, interest: 599, balance: 119599, status: "pending" },
        ],
      } as any)
      .returning();
    note3Id = n3.id;

    // note4: payment-link target for leg 7. NO accessToken — ownership is
    // proven by the org's connected Stripe account, not a borrower token.
    const [n4] = await db
      .insert(schema.notes)
      .values({
        organizationId: orgId,
        borrowerId: leadId,
        originalPrincipal: "120000.00",
        currentBalance: "120000.00",
        interestRate: "6.00",
        termMonths: 360,
        monthlyPayment: "800.00",
        startDate: new Date("2099-01-15T12:00:00Z"),
        firstPaymentDate: new Date("2099-02-15T12:00:00Z"),
        nextPaymentDate: new Date("2099-02-15T12:00:00Z"),
        status: "active",
        atrExemptionCode: "legacy",
        amortizationSchedule: [
          { paymentNumber: 1, dueDate: "2099-02-15", payment: 800, principal: 200, interest: 600, balance: 119800, status: "pending" },
          { paymentNumber: 2, dueDate: "2099-03-15", payment: 800, principal: 201, interest: 599, balance: 119599, status: "pending" },
        ],
      } as any)
      .returning();
    note4Id = n4.id;

    await db.insert(schema.organizationIntegrations).values({
      organizationId: orgId,
      provider: "stripe_connect",
      credentials: { stripeConnectAccountId: CONNECT_ACCT },
    } as any);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    const { eq } = drizzle;
    // payments → note → lead → user → org, so the suite is rerunnable.
    if (orgId) {
      await db.delete(schema.periodicStatements).where(eq(schema.periodicStatements.organizationId, orgId));
      await db.delete(schema.lateFeeAssessments).where(eq(schema.lateFeeAssessments.organizationId, orgId));
      await db.delete(schema.payments).where(eq(schema.payments.organizationId, orgId));
      await db.delete(schema.notes).where(eq(schema.notes.organizationId, orgId));
      await db.delete(schema.leads).where(eq(schema.leads.organizationId, orgId));
      await db.delete(schema.organizationIntegrations).where(eq(schema.organizationIntegrations.organizationId, orgId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    }
    if (org2Id) {
      // none expected under org2; defensive.
      await db.delete(schema.payments).where(eq(schema.payments.organizationId, org2Id));
      await db.delete(schema.notes).where(eq(schema.notes.organizationId, org2Id));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, org2Id));
    }
  }, 60_000);

  function signedEvent(
    eventId: string,
    sessionId: string,
    amountTotal: number,
    overrides: { paymentStatus?: string; metadata?: Record<string, string> } = {},
    eventType = "checkout.session.completed",
  ) {
    const { paymentStatus = "paid", metadata = {} } = overrides;
    const event = {
      id: eventId,
      object: "event",
      type: eventType,
      data: {
        object: {
          id: sessionId,
          object: "checkout.session",
          payment_status: paymentStatus,
          amount_total: amountTotal,
          metadata: {
            type: "borrower_portal_payment",
            noteId: String(noteId),
            accessToken: ACCESS_TOKEN,
            organizationId: String(orgId),
            ...metadata,
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    return { payload: Buffer.from(payload), signature };
  }

  it("leg 1: a signed paid checkout posts one payment with the hand-computed split and moves the note", async () => {
    const { eq, and } = drizzle;
    const { payload, signature } = signedEvent(`evt_test_pkg3_leg1_${suffix}`, SESSION_LEG1, 80000);

    await WebhookHandlers.processWebhook(payload, signature);

    const rows = await db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.transactionId, SESSION_LEG1), eq(schema.payments.organizationId, orgId)));
    expect(rows).toHaveLength(1);
    const p = rows[0];
    expect(p.noteId).toBe(noteId);
    expect(Number(p.amount)).toBe(800);
    expect(Number(p.interestAmount)).toBe(600);
    expect(Number(p.principalAmount)).toBe(200);
    expect(Number(p.lateFeeAmount)).toBe(0);
    expect(p.paymentMethod).toBe("card");
    expect(p.status).toBe("completed");

    const [note] = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId));
    expect(Number(note.currentBalance)).toBe(119800);

    const schedule = note.amortizationSchedule as Array<{ paymentNumber: number; status: string }>;
    expect(schedule.find((s) => s.paymentNumber === 1)?.status).toBe("paid");
    expect(schedule.find((s) => s.paymentNumber === 2)?.status).toBe("pending");

    expect(new Date(note.nextPaymentDate as any).toISOString().slice(0, 10)).toBe("2099-03-15");
  }, 60_000);

  // Legs run SEQUENTIALLY in file order. Leg 2 and leg 4 depend on leg 1 having
  // run first (leg 2 redelivers leg 1's session; leg 4 reads the statement of
  // the balance leg 1 left behind).

  async function expectLeg1Unchanged() {
    const { eq, and } = drizzle;
    const rows = await db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.transactionId, SESSION_LEG1), eq(schema.payments.organizationId, orgId)));
    expect(rows).toHaveLength(1);
    const [note] = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId));
    expect(Number(note.currentBalance)).toBe(119800);
  }

  it("leg 2: redelivery of the same event/session posts no second row and moves nothing", async () => {
    // (a) the EXACT leg-1 event id + session id + amount, re-signed.
    const a = signedEvent(`evt_test_pkg3_leg1_${suffix}`, SESSION_LEG1, 80000);
    await WebhookHandlers.processWebhook(a.payload, a.signature);
    await expectLeg1Unchanged();

    // (b) the same session under a NEW event id (Stripe retry with a fresh event).
    const b = signedEvent(`evt_test_pkg3_leg2b_${suffix}`, SESSION_LEG1, 80000);
    await WebhookHandlers.processWebhook(b.payload, b.signature);
    await expectLeg1Unchanged();
  }, 60_000);

  it("leg 3: a payment after grace assesses a late fee, collected only from money above the installment", async () => {
    // note2: installment $800 due 2026-10-01, lateFee $25, grace 10 days.
    // At the real clock (>= 2026-11-09) it is 39+ days past due > 10 → fee $25 assessed.
    //   pay $880 = $800 installment + $80 excess
    //   fee collected from excess = min(80, 25) = $25
    //   split on 880 - 25 = $855: interest $600 (120000 * 6% / 12), principal $255
    //   new balance = 120000 - 255 = $119,745
    const { eq, and } = drizzle;
    const session = `cs_test_pkg3_leg3_${suffix}`;
    const { payload, signature } = signedEvent(`evt_test_pkg3_leg3_${suffix}`, session, 88000, {
      metadata: { noteId: String(note2Id), accessToken: ACCESS_TOKEN_2 },
    });
    await WebhookHandlers.processWebhook(payload, signature);

    const fees = await db
      .select()
      .from(schema.lateFeeAssessments)
      .where(
        and(
          eq(schema.lateFeeAssessments.organizationId, orgId),
          eq(schema.lateFeeAssessments.loanId, String(note2Id)),
        ),
      );
    expect(fees).toHaveLength(1);
    expect(fees[0].feeAmountCents).toBe(2500);
    expect(fees[0].periodStart).toBe("2026-10-01");
    expect(fees[0].status).toBe("assessed");

    const rows = await db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.transactionId, session), eq(schema.payments.organizationId, orgId)));
    expect(rows).toHaveLength(1);
    const p = rows[0];
    expect(Number(p.amount)).toBe(880);
    expect(Number(p.lateFeeAmount)).toBe(25);
    expect(Number(p.interestAmount)).toBe(600);
    expect(Number(p.principalAmount)).toBe(255);
    expect(p.status).toBe("completed");
    // parts-sum invariant: principal + interest + lateFee + fee = amount
    const parts =
      Number(p.principalAmount) + Number(p.interestAmount) + Number(p.lateFeeAmount) + Number((p as any).feeAmount ?? 0);
    expect(Math.abs(parts - Number(p.amount))).toBeLessThanOrEqual(0.05);

    const [note] = await db.select().from(schema.notes).where(eq(schema.notes.id, note2Id));
    expect(Number(note.currentBalance)).toBe(119745);
    const schedule = note.amortizationSchedule as Array<{ paymentNumber: number; status: string }>;
    expect(schedule.find((s) => s.paymentNumber === 1)?.status).toBe("paid");
    expect(new Date(note.nextPaymentDate as any).toISOString().slice(0, 10)).toBe("2026-11-01");
  }, 60_000);

  it("leg 4: the statement reflects the posted payment", async () => {
    // Depends on leg 1: note1 balance 119800 after the $200 principal / $600 interest payment.
    const { eq, and } = drizzle;
    const { generateStatementsForCycle } = await import("../../server/services/periodicStatements/index");
    const now = new Date();
    const result = await generateStatementsForCycle(orgId, now);
    expect(result.statementsGenerated).toBeGreaterThanOrEqual(1);

    const cycleStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const stmts = await db
      .select()
      .from(schema.periodicStatements)
      .where(
        and(
          eq(schema.periodicStatements.organizationId, orgId),
          eq(schema.periodicStatements.loanId, String(noteId)),
          eq(schema.periodicStatements.loanType, "note"),
        ),
      );
    const s = stmts.find((r: any) => r.cycleStart === cycleStart);
    expect(s).toBeDefined();
    expect(s.principalBalanceCents).toBe(11980000); // $119,800.00
    expect(s.ytdPrincipalCents).toBe(20000); // $200.00
    expect(s.ytdInterestCents).toBe(60000); // $600.00
  }, 60_000);

  async function expectNote3Untouched() {
    const { eq } = drizzle;
    const pays = await db.select().from(schema.payments).where(eq(schema.payments.noteId, note3Id));
    expect(pays).toHaveLength(0);
    const [note] = await db.select().from(schema.notes).where(eq(schema.notes.id, note3Id));
    expect(Number(note.currentBalance)).toBe(120000);
    const schedule = note.amortizationSchedule as Array<{ paymentNumber: number; status: string }>;
    expect(schedule[0].status).toBe("pending");
  }

  const note3Meta = () => ({ noteId: String(note3Id), accessToken: ACCESS_TOKEN_3 });

  it("leg 5: a declined/unpaid session is neutral — no row, no balance movement", async () => {
    // (a) async payment failed: never dispatched.
    const a = signedEvent(
      `evt_test_pkg3_leg5a_${suffix}`,
      `cs_test_pkg3_leg5a_${suffix}`,
      80000,
      { metadata: note3Meta() },
      "checkout.session.async_payment_failed",
    );
    await expect(WebhookHandlers.processWebhook(a.payload, a.signature)).resolves.not.toThrow();
    // (b) completed but payment_status 'unpaid': refused before any write.
    const b = signedEvent(`evt_test_pkg3_leg5b_${suffix}`, `cs_test_pkg3_leg5b_${suffix}`, 80000, {
      paymentStatus: "unpaid",
      metadata: note3Meta(),
    });
    await expect(WebhookHandlers.processWebhook(b.payload, b.signature)).resolves.not.toThrow();
    await expectNote3Untouched();
  }, 60_000);

  it("leg 6: cross-tenant metadata (wrong organizationId / noteId) is refused", async () => {
    const { eq } = drizzle;
    // (a) organizationId of ANOTHER org with note3's valid token.
    const sessA = `cs_test_pkg3_leg6a_${suffix}`;
    const a = signedEvent(`evt_test_pkg3_leg6a_${suffix}`, sessA, 80000, {
      metadata: { ...note3Meta(), organizationId: String(org2Id) },
    });
    await expect(WebhookHandlers.processWebhook(a.payload, a.signature)).resolves.not.toThrow();
    expect(await db.select().from(schema.payments).where(eq(schema.payments.transactionId, sessA))).toHaveLength(0);
    await expectNote3Untouched();

    // (b) note3's token but metadata noteId pointing at note1.
    const sessB = `cs_test_pkg3_leg6b_${suffix}`;
    const b = signedEvent(`evt_test_pkg3_leg6b_${suffix}`, sessB, 80000, {
      metadata: { accessToken: ACCESS_TOKEN_3, noteId: String(noteId) },
    });
    await expect(WebhookHandlers.processWebhook(b.payload, b.signature)).resolves.not.toThrow();
    expect(await db.select().from(schema.payments).where(eq(schema.payments.transactionId, sessB))).toHaveLength(0);
    await expectNote3Untouched();
    // note1 must not have moved either (still leg 1's result).
    await expectLeg1Unchanged();
  }, 60_000);

  it("leg 7: a payment-link session posts only when the connected account is the metadata org's own", async () => {
    const { eq } = drizzle;
    const mkSession = (id: string) =>
      ({
        id,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 80000,
        payment_link: `plink_test_pkg3_${suffix}`,
        metadata: {
          paymentType: "note_payment",
          organizationId: String(orgId),
          noteId: String(note4Id),
        },
      }) as any;

    // (a) the org's own connected account → posts through the shared rule.
    const sess = `cs_test_pkg3_leg7a_${suffix}`;
    await WebhookHandlers.processPaymentLinkNotePayment(mkSession(sess), CONNECT_ACCT);
    const rows = await db.select().from(schema.payments).where(eq(schema.payments.transactionId, sess));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(800);
    expect(Number(rows[0].interestAmount)).toBe(600);
    expect(Number(rows[0].principalAmount)).toBe(200);
    expect(Number(rows[0].lateFeeAmount)).toBe(0);
    expect(rows[0].paymentMethod).toBe("card");
    expect(rows[0].status).toBe("completed");
    const [note] = await db.select().from(schema.notes).where(eq(schema.notes.id, note4Id));
    expect(Number(note.currentBalance)).toBe(119800);
    const schedule = note.amortizationSchedule as Array<{ status: string }>;
    expect(schedule[0].status).toBe("paid");

    // (b) a foreign connected account is refused: no row, no balance movement.
    const sessWrong = `cs_test_pkg3_leg7b_${suffix}`;
    await expect(
      WebhookHandlers.processPaymentLinkNotePayment(mkSession(sessWrong), `acct_test_pkg3_WRONG_${suffix}`),
    ).resolves.not.toThrow();
    expect(await db.select().from(schema.payments).where(eq(schema.payments.transactionId, sessWrong))).toHaveLength(0);
    const [after] = await db.select().from(schema.notes).where(eq(schema.notes.id, note4Id));
    expect(Number(after.currentBalance)).toBe(119800);
  }, 60_000);
});
