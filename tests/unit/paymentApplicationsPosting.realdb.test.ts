/**
 * D4 — every posting rail writes the Reg-Z application breakdown (real DB).
 *
 * THE DEFECT (proven by the PKG-3 settlement-proof suite, delta audit Leg C):
 * payments posted through the production rails wrote a `payments` row with
 * the principal/interest/late-fee split recorded on it, but no
 * `payment_applications` row — the table the periodic-statement generator
 * sums for every past-payment figure. The generator therefore refused the
 * statement of any borrower who had actually paid (§1026.41(d)(3) skip,
 * code PAYMENTS_NOT_APPLIED): it statemented exactly the notes with no
 * posted payments and skipped exactly the notes with them.
 *
 * THE CURE these legs pin: each posting path now mirrors its own recorded
 * split into `payment_applications` inside the SAME transaction, via
 * `recordPostedPaymentApplication`. The legs drive the REAL entry points —
 * the signed Stripe webhook, ACH autopay settlement, and the serviced-note
 * posting rule the operator route calls — against a REAL Postgres, and read
 * back both ledgers plus the generated statement.
 *
 * Hand-computed expectations (never derived from the code under test):
 * $800.00 on a $120,000.00 balance at 6.00% → interest $600.00, principal
 * $200.00, new balance $119,800.00.
 *
 * The acquired-note ledger route (POST /api/notes/:id/payments) writes the
 * same mirror from its operator-supplied buckets; it is an HTTP handler, so
 * its wiring is pinned by the census block in
 * tests/unit/regZRefusesUnappliedPayments.test.ts instead of a leg here.
 *
 * Skips without ACREOS_REAL_DATABASE_URL; runs in the CI jobs that build a schema.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

// Module scope, BEFORE anything imports server/db.
useRealDb("paymentApplicationsPosting");

// Stripe is constructed from env only; the HMAC is pure/offline. Set before
// any server module is imported (all server imports below are dynamic).
process.env.STRIPE_SECRET_KEY ||= "sk_test_d4_synthetic";
const WEBHOOK_SECRET = "whsec_d4_synthetic";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const ACCESS_TOKEN = `d4_tok_${suffix}`;
const SESSION_WEBHOOK = `cs_test_d4_webhook_${suffix}`;

const describeReal = realDbAvailable ? describe : describe.skip;

describeReal("payment applications are written by the posting rails (real DB)", () => {
  let db: any;
  let schema: typeof import("../../shared/schema");
  let regz: typeof import("../../shared/schema/reg-z");
  let drizzle: typeof import("drizzle-orm");
  let WebhookHandlers: any;
  let Stripe: any;
  let orgId: number;
  let userId: any;
  let leadId: number;
  let webhookNoteId: number;
  let achNoteId: number;
  let operatorNoteId: number;

  async function insertNote(accessToken: string | null) {
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
        ...(accessToken ? { accessToken } : {}),
        amortizationSchedule: [
          { paymentNumber: 1, dueDate: "2099-02-15", payment: 800, principal: 200, interest: 600, balance: 119800, status: "pending" },
          { paymentNumber: 2, dueDate: "2099-03-15", payment: 800, principal: 201, interest: 599, balance: 119599, status: "pending" },
        ],
      } as any)
      .returning();
    return note.id as number;
  }

  async function applicationsFor(noteId: number) {
    const { eq, and } = drizzle;
    return db
      .select()
      .from(regz.paymentApplications)
      .where(
        and(
          eq(regz.paymentApplications.organizationId, orgId),
          eq(regz.paymentApplications.loanId, String(noteId)),
        ),
      );
  }

  function expectMirrorSplit(app: any, paymentId: number) {
    expect(app.loanType).toBe("note");
    expect(app.paymentId).toBe(String(paymentId));
    expect(app.appliedToPrincipalCents).toBe(20000); // $200.00
    expect(app.appliedToInterestCents).toBe(60000); // $600.00
    expect(app.appliedToEscrowCents).toBe(0);
    expect(app.appliedToFeesCents).toBe(0);
    expect(app.appliedToSuspenseCents).toBe(0);
  }

  beforeAll(async () => {
    drizzle = await import("drizzle-orm");
    schema = await import("../../shared/schema");
    regz = await import("../../shared/schema/reg-z");
    ({ db } = await import("../../server/db"));
    ({ WebhookHandlers } = await import("../../server/webhookHandlers"));
    Stripe = (await import("stripe")).default;

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: `D4 Posting ${suffix}`, slug: `d4-posting-${suffix}`, ownerId: `d4-owner-${suffix}` })
      .returning();
    orgId = org.id;

    const [user] = await db
      .insert(schema.users)
      .values({
        email: `d4-${suffix}@example.test`,
        password: "not-a-real-hash",
        firstName: "Dee",
        lastName: "Four",
      })
      .returning();
    userId = user.id;

    const [lead] = await db
      .insert(schema.leads)
      .values({ organizationId: orgId, firstName: "Bo", lastName: "Rrower" })
      .returning();
    leadId = lead.id;

    webhookNoteId = await insertNote(ACCESS_TOKEN);
    achNoteId = await insertNote(null);
    operatorNoteId = await insertNote(null);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    const { eq } = drizzle;
    if (orgId) {
      await db.delete(schema.periodicStatements).where(eq(schema.periodicStatements.organizationId, orgId));
      await db.delete(regz.paymentApplications).where(eq(regz.paymentApplications.organizationId, orgId));
      await db.delete(schema.payments).where(eq(schema.payments.organizationId, orgId));
      await db.delete(schema.notes).where(eq(schema.notes.organizationId, orgId));
      await db.delete(schema.leads).where(eq(schema.leads.organizationId, orgId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    }
  }, 60_000);

  function signedWebhookEvent(eventId: string) {
    const event = {
      id: eventId,
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: SESSION_WEBHOOK,
          object: "checkout.session",
          payment_status: "paid",
          amount_total: 80000,
          metadata: {
            type: "borrower_portal_payment",
            noteId: String(webhookNoteId),
            accessToken: ACCESS_TOKEN,
            organizationId: String(orgId),
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    return { payload: Buffer.from(payload), signature };
  }

  it("leg 1: a webhook-posted payment writes its application breakdown in the same posting", async () => {
    const { eq, and } = drizzle;
    const { payload, signature } = signedWebhookEvent(`evt_test_d4_leg1_${suffix}`);
    await WebhookHandlers.processWebhook(payload, signature);

    const payments = await db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.transactionId, SESSION_WEBHOOK), eq(schema.payments.organizationId, orgId)));
    expect(payments).toHaveLength(1);

    const apps = await applicationsFor(webhookNoteId);
    expect(apps).toHaveLength(1);
    expectMirrorSplit(apps[0], payments[0].id);
  }, 60_000);

  it("leg 2: webhook redelivery writes no second breakdown", async () => {
    const { payload, signature } = signedWebhookEvent(`evt_test_d4_leg2_${suffix}`);
    await WebhookHandlers.processWebhook(payload, signature);
    const apps = await applicationsFor(webhookNoteId);
    expect(apps).toHaveLength(1);
  }, 60_000);

  it("leg 3: the statement now generates for the note that paid, with the posted figures", async () => {
    const { eq, and } = drizzle;
    const { generateStatementsForCycle } = await import("../../server/services/periodicStatements/index");
    const now = new Date();
    await generateStatementsForCycle(orgId, now);

    const cycleStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const stmts = await db
      .select()
      .from(schema.periodicStatements)
      .where(
        and(
          eq(schema.periodicStatements.organizationId, orgId),
          eq(schema.periodicStatements.loanId, String(webhookNoteId)),
          eq(schema.periodicStatements.loanType, "note"),
        ),
      );
    const s = stmts.find((r: any) => r.cycleStart === cycleStart);
    expect(s).toBeDefined();
    expect(s.principalBalanceCents).toBe(11980000); // $119,800.00
    expect(s.ytdPrincipalCents).toBe(20000); // $200.00
    expect(s.ytdInterestCents).toBe(60000); // $600.00
  }, 60_000);

  it("leg 4: an ACH autopay settlement writes its application breakdown, once", async () => {
    const { eq } = drizzle;
    const { dbAchAutopayStore } = await import("../../server/services/achAutopay");
    const [note] = await db.select().from(schema.notes).where(eq(schema.notes.id, achNoteId));
    const settledAt = new Date();
    const input = {
      note,
      attempt: { amountCents: 80000, dueDate: new Date("2099-02-15T12:00:00Z") },
      paymentIntentId: `pi_test_d4_${suffix}`,
      settledAt,
    } as any;

    const first = await dbAchAutopayStore.postSettlement(input);
    expect(first.created).toBe(true);
    let apps = await applicationsFor(achNoteId);
    expect(apps).toHaveLength(1);
    expectMirrorSplit(apps[0], first.paymentId);

    // Settlement redelivery: the ledger row already exists, so no second
    // payment and no second breakdown.
    const second = await dbAchAutopayStore.postSettlement(input);
    expect(second.created).toBe(false);
    apps = await applicationsFor(achNoteId);
    expect(apps).toHaveLength(1);
  }, 60_000);

  it("leg 5: the operator posting rule writes its application breakdown", async () => {
    const { eq } = drizzle;
    const { postServicedNotePayment } = await import("../../server/services/borrower/portalPaymentPosting");
    const [note] = await db.select().from(schema.notes).where(eq(schema.notes.id, operatorNoteId));

    const result = await postServicedNotePayment({
      note,
      amountCents: 80000,
      transactionId: `operator_d4_${suffix}`,
      source: "operator_recorded",
      paymentMethod: "check",
      sendReceipt: false,
    });
    expect(result.outcome).toBe("posted");
    if (result.outcome !== "posted") return;

    const apps = await applicationsFor(operatorNoteId);
    expect(apps).toHaveLength(1);
    expectMirrorSplit(apps[0], result.payment.id);

    const [after] = await db.select().from(schema.notes).where(eq(schema.notes.id, operatorNoteId));
    expect(Number(after.currentBalance)).toBe(119800);
  }, 60_000);
});
