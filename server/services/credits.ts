import type Stripe from "stripe";
import { db, withTransaction, type PrimaryDb } from "../db";
import { eq, desc, sql, and } from "drizzle-orm";
import {
  organizations,
  creditTransactions,
  usageRecords,
  usageRates,
  USAGE_ACTION_TYPES,
  CREDIT_PACKS,
  type CreditTransaction,
  type InsertCreditTransaction,
  type UsageRecord,
  type InsertUsageRecord,
  type UsageRate,
  type UsageActionType,
  type CreditPackId,
} from "@shared/schema";
import { logger } from "../utils/logger";
import { creditsForPackPrice } from "@shared/billing/credit-packs";
import { clock } from "../utils/clock";

/** FRAUD-011: the most free usage a trial may consume. */
const TRIAL_SPENDING_CAP_CENTS = 500;
/** usage_records.metadata.fundedBy for usage the trial allowance paid for. */
const TRIAL_ALLOWANCE_FUNDING = "trial_allowance";

export class CreditService {
  async isFounder(organizationId: number): Promise<boolean> {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
      columns: { isFounder: true }
    });
    return org?.isFounder || false;
  }

  async getBalance(organizationId: number): Promise<number> {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });
    if (org?.isFounder) return 999999999;
    return Number(org?.creditBalance || 0);
  }

  async addCredits(
    organizationId: number,
    amountCents: number,
    type: CreditTransaction["type"],
    description: string,
    metadata?: InsertCreditTransaction["metadata"],
    // Run inside the caller's transaction, so a credit return commits with
    // the ledger row that justifies it — or not at all (audit of 0e54c75,
    // DEFECT-0227).
    opts: { tx?: PrimaryDb } = {},
  ): Promise<CreditTransaction> {
    // Wrap balance update + transaction log in a single DB transaction
    // to prevent ledger desync on crash (P0 fix DI-001)
    const run = async (tx: PrimaryDb) => {
      const [updated] = await tx
        .update(organizations)
        .set({
          creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric + ${amountCents}`
        })
        .where(eq(organizations.id, organizationId))
        .returning({ newBalance: sql<number>`(COALESCE(${organizations.creditBalance}, '0')::numeric)::int` });

      const newBalance = updated?.newBalance || amountCents;

      const [transaction] = await tx
        .insert(creditTransactions)
        .values({
          organizationId,
          type,
          amountCents,
          balanceAfterCents: newBalance,
          description,
          metadata,
        })
        .returning();

      return transaction;
    };
    return opts.tx ? run(opts.tx) : await withTransaction(run);
  }

  async deductCredits(
    organizationId: number,
    amountCents: number,
    description: string,
    metadata?: InsertCreditTransaction["metadata"],
    // Inside the caller's transaction: a mail debit taken in the queue's
    // transaction rolls back with it (DEFECT-0213).
    opts: { tx?: PrimaryDb } = {},
  ): Promise<CreditTransaction | null> {
    if (await this.isFounder(organizationId)) {
      const [transaction] = await (opts.tx ?? db)
        .insert(creditTransactions)
        .values({
          organizationId,
          type: "debit",
          amountCents: 0,
          balanceAfterCents: 999999999,
          description: `[Founder] ${description}`,
          metadata: { ...metadata, founderBypass: true },
        })
        .returning();
      return transaction;
    }

    // Wrap balance update + transaction log in a single DB transaction
    // to prevent ledger desync on crash (P1-SWEEP3-001)
    const debit = async (tx: PrimaryDb) => {
      const [updated] = await tx
        .update(organizations)
        .set({
          creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric - ${amountCents}`
        })
        .where(
          and(
            eq(organizations.id, organizationId),
            sql`COALESCE(${organizations.creditBalance}, '0')::numeric >= ${amountCents}`
          )
        )
        .returning({ newBalance: sql<number>`(COALESCE(${organizations.creditBalance}, '0')::numeric)::int` });

      if (!updated) {
        return null;
      }

      const [transaction] = await tx
        .insert(creditTransactions)
        .values({
          organizationId,
          type: "debit",
          amountCents: -amountCents,
          balanceAfterCents: updated.newBalance,
          description,
          metadata,
        })
        .returning();

      return transaction;
    };
    const result = opts.tx ? await debit(opts.tx) : await withTransaction(debit);

    if (!result) {
      return null;
    }

    // D2 (founder decision 2026-07-11): auto-top-up executes for real after a
    // deduction (outside the transaction — a top-up failure must never roll
    // back the deduction). Inside a CALLER's transaction the deduction is not
    // committed yet — the top-up would read the old balance, and could charge
    // a card for a debit that then rolls back — so the caller fires it after
    // commit (audit of 1694a0b).
    if (!opts.tx) this.afterDebitCommitted(organizationId);

    return result;
  }

  /**
   * Run the post-deduction auto top-up. `deductCredits` does this itself; a
   * caller that passed its own transaction calls it once that transaction
   * has committed. All guards live inside executeAutoTopUp.
   */
  afterDebitCommitted(organizationId: number): void {
    usageMeteringService.executeAutoTopUp(organizationId).catch((err: unknown) => {
      logger.error("[credits] Auto-top-up execution failed", err instanceof Error ? err : undefined);
    });
  }

  /**
   * Cents of the trial's FREE allowance still unspent, or null when the org
   * is not in an active trial.
   *
   * FRAUD-011 caps free trial usage at $5. The cap must count only what the
   * TRIAL paid for. It used to sum every "debit" row in the trial window —
   * and a debit row is only ever written when the org's OWN balance covered
   * the charge — so it counted exactly the credits the customer had bought,
   * and once they had spent $5 of their own money the trial lock refused them
   * with a full balance (Pax included). Free trial usage is now recorded as a
   * usage record tagged `fundedBy: "trial_allowance"` (see recordUsage), and
   * only those count.
   */
  async trialAllowanceRemaining(organizationId: number): Promise<number | null> {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
      columns: { trialEndsAt: true },
    });
    if (!org?.trialEndsAt || new Date(org.trialEndsAt) <= clock.now()) return null;

    const [result] = await db
      .select({
        trialFundedCents: sql<number>`COALESCE(SUM(${usageRecords.totalCostCents}), 0)::int`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.organizationId, organizationId),
          sql`${usageRecords.metadata}->>'fundedBy' = ${TRIAL_ALLOWANCE_FUNDING}`,
          sql`${usageRecords.createdAt} >= (
            SELECT ${organizations.trialEndsAt} - INTERVAL '14 days'
            FROM ${organizations}
            WHERE ${organizations.id} = ${organizationId}
          )`
        )
      );
    const consumed = result?.trialFundedCents || 0;
    return Math.max(TRIAL_SPENDING_CAP_CENTS - consumed, 0);
  }

  async hasEnoughCredits(organizationId: number, requiredCents: number): Promise<boolean> {
    if (await this.isFounder(organizationId)) return true;

    // The org's own credit (purchased packs, allowances, top-ups) pays first,
    // and is never limited by the trial cap — that cap bounds what AcreOS
    // gives away free, not what a customer spends of their own.
    const balance = await this.getBalance(organizationId);
    if (balance >= requiredCents) return true;

    // Users in an active trial get free basic usage (AI chat etc.) when their
    // balance does not cover it, capped at 500 cents ($5) of trial-funded
    // usage to prevent abuse (FRAUD-011).
    const trialRemaining = await this.trialAllowanceRemaining(organizationId);
    if (trialRemaining !== null) {
      if (requiredCents > trialRemaining) {
        logger.info(`[credits] Trial allowance exhausted for org ${organizationId}: ${TRIAL_SPENDING_CAP_CENTS - trialRemaining}¢ of ${TRIAL_SPENDING_CAP_CENTS}¢ used`);
        return false;
      }
      return true;
    }

    // Note: Trial tokens are for premium skills only, not basic AI chat
    // They are consumed via storage.consumeTrialToken() in skill permission checks
    return false;
  }

  /**
   * For actions whose real cost is physical or third-party money (printed mail):
   * only the org's OWN credit pays. The trial allowance is for cheap compute; it
   * must never fund a piece that has already been posted.
   */
  async hasEnoughOwnCredits(organizationId: number, requiredCents: number): Promise<boolean> {
    if (await this.isFounder(organizationId)) return true;
    return (await this.getBalance(organizationId)) >= requiredCents;
  }

  /**
   * Charge after a gate that used hasEnoughCredits. The org's balance pays
   * first; when it cannot, an active trial's allowance pays AND IS RECORDED
   * (usage_records.metadata.fundedBy), so the FRAUD-011 cap actually shrinks.
   * A bare deductCredits after hasEnoughCredits charged nothing in a trial and
   * left the allowance untouched: unlimited free calls.
   */
  async deductOrFundFromTrial(
    organizationId: number,
    amountCents: number,
    description: string,
    metadata: { actionType: UsageActionType } & Record<string, unknown>,
  ): Promise<"balance" | "trial" | null> {
    const debit = await this.deductCredits(
      organizationId, amountCents, description, metadata as InsertCreditTransaction["metadata"],
    );
    if (debit) return "balance";
    const remaining = await this.trialAllowanceRemaining(organizationId);
    if (remaining === null || amountCents > remaining) return null;
    await db.insert(usageRecords).values({
      organizationId,
      actionType: metadata.actionType,
      quantity: 1,
      unitCostCents: amountCents,
      totalCostCents: amountCents,
      metadata: { description, fundedBy: TRIAL_ALLOWANCE_FUNDING },
      billingMonth: clock.now().toISOString().slice(0, 7),
    });
    return "trial";
  }

  async getTransactionHistory(
    organizationId: number,
    limit: number = 50
  ): Promise<CreditTransaction[]> {
    return db.query.creditTransactions.findMany({
      where: eq(creditTransactions.organizationId, organizationId),
      orderBy: [desc(creditTransactions.createdAt)],
      limit,
    });
  }

  /**
   * Grant a PAID mail-credit recharge (POST /api/outreach/mail/credits/recharge
   * → Stripe checkout → webhook). Exactly once per checkout session.
   *
   * Where the credits land: the purchased-credit balance
   * (organizations.credit_balance). That is where mail sends spend purchased
   * credits — poolDebit draws the plan's INCLUDED monthly pool first and, once
   * it is exhausted, funds the send from this balance (the "purchased-overflow"
   * lane). The balance never resets: the monthly reset applies only to the
   * included pool (poolUsageThisMonth sums the current month and excludes
   * purchased-overflow rows), so purchased credits do not expire.
   *
   * Amount: what the customer actually PAID (session.amount_total), at the
   * canonical 1.5¢-per-credit rate, rounded down (shared/billing/credit-packs).
   *
   * Idempotency: the 'mail_credit_recharge' row is inserted FIRST, ON CONFLICT
   * DO NOTHING against credit_txn_mail_recharge_session_uniq; only the insert
   * that wins bumps the balance. A replay finds the row and grants nothing.
   */
  async applyMailCreditRecharge(
    organizationId: number,
    paidCents: number,
    stripeSessionId: string,
    stripePaymentIntentId?: string,
  ): Promise<{ granted: boolean; credits: number }> {
    const credits = creditsForPackPrice(paidCents);
    if (credits <= 0 || !stripeSessionId) return { granted: false, credits: 0 };
    return await withTransaction(async (tx) => {
      const [claim] = await tx
        .insert(creditTransactions)
        .values({
          organizationId,
          type: "mail_credit_recharge",
          amountCents: credits,
          balanceAfterCents: 0, // set below, once the bump has landed
          description: `Mail credit recharge — $${(paidCents / 100).toFixed(2)} at 1.5¢/credit`,
          stripeCheckoutSessionId: stripeSessionId,
          stripePaymentIntentId,
          metadata: { paidCents, creditPriceCents: 1.5 },
        })
        .onConflictDoNothing()
        .returning({ id: creditTransactions.id });
      if (!claim) return { granted: false, credits };
      const [updated] = await tx
        .update(organizations)
        .set({
          creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric + ${credits}`,
        })
        .where(eq(organizations.id, organizationId))
        .returning({ newBalance: sql<number>`(COALESCE(${organizations.creditBalance}, '0')::numeric)::int` });
      await tx
        .update(creditTransactions)
        .set({ balanceAfterCents: updated?.newBalance ?? credits })
        .where(and(eq(creditTransactions.id, claim.id), eq(creditTransactions.organizationId, organizationId)));
      return { granted: true, credits };
    });
  }

  async applyCreditPackPurchase(
    organizationId: number,
    packId: CreditPackId,
    stripeSessionId: string,
    stripePaymentIntentId?: string
  ): Promise<CreditTransaction> {
    const pack = CREDIT_PACKS[packId];
    if (!pack) {
      throw new Error(`Invalid credit pack: ${packId}`);
    }

    // Wrap balance update + transaction log in a single DB transaction
    // to prevent ledger desync on crash (P1-SWEEP3-002)
    return await withTransaction(async (tx) => {
      const [updated] = await tx
        .update(organizations)
        .set({
          creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric + ${pack.amountCents}`
        })
        .where(eq(organizations.id, organizationId))
        .returning({ newBalance: sql<number>`(COALESCE(${organizations.creditBalance}, '0')::numeric)::int` });

      const newBalance = updated?.newBalance || pack.amountCents;

      const [transaction] = await tx
        .insert(creditTransactions)
        .values({
          organizationId,
          type: "purchase",
          amountCents: pack.amountCents,
          balanceAfterCents: newBalance,
          description: `Purchased ${pack.name}`,
          stripeCheckoutSessionId: stripeSessionId,
          stripePaymentIntentId,
          metadata: { creditPackId: packId },
        })
        .returning();

      return transaction;
    });
  }

}

export class UsageMeteringService {
  private creditService = new CreditService();

  async getRate(actionType: UsageActionType): Promise<number> {
    const rate = await db.query.usageRates.findFirst({
      where: and(
        eq(usageRates.actionType, actionType),
        eq(usageRates.isActive, true)
      ),
    });

    if (rate) {
      return rate.unitCostCents;
    }

    return USAGE_ACTION_TYPES[actionType]?.defaultCostCents || 0;
  }

  async calculateCost(actionType: UsageActionType, quantity: number = 1): Promise<number> {
    const unitCost = await this.getRate(actionType);
    return unitCost * quantity;
  }

  async estimateCampaignCost(
    actionType: "email_sent" | "sms_sent" | "direct_mail",
    recipientCount: number
  ): Promise<{ unitCost: number; totalCost: number; insufficientCredits: boolean; balance: number }> {
    const unitCost = await this.getRate(actionType);
    const totalCost = unitCost * recipientCount;
    return {
      unitCost,
      totalCost,
      insufficientCredits: false,
      balance: 0,
    };
  }

  async estimateCampaignCostForOrg(
    organizationId: number,
    actionType: "email_sent" | "sms_sent" | "direct_mail",
    recipientCount: number
  ): Promise<{ unitCost: number; totalCost: number; insufficientCredits: boolean; balance: number }> {
    const unitCost = await this.getRate(actionType);
    const totalCost = unitCost * recipientCount;
    const balance = await this.creditService.getBalance(organizationId);
    
    return {
      unitCost,
      totalCost,
      insufficientCredits: balance < totalCost,
      balance,
    };
  }

  async recordUsage(
    organizationId: number,
    actionType: UsageActionType,
    quantity: number = 1,
    metadata?: InsertUsageRecord["metadata"],
    autoDeduct: boolean = true
  ): Promise<{ record: UsageRecord | null; deducted: boolean; insufficientCredits: boolean }> {
    const unitCost = await this.getRate(actionType);
    const totalCost = unitCost * quantity;
    const billingMonth = clock.now().toISOString().slice(0, 7);

    if (autoDeduct && totalCost > 0) {
      const deductResult = await this.creditService.deductCredits(
        organizationId,
        totalCost,
        `${USAGE_ACTION_TYPES[actionType]?.name || actionType} x${quantity}`,
        { actionType, quantity }
      );

      if (!deductResult) {
        // The org's own balance could not pay. In an active trial the free
        // allowance pays instead, while it lasts — and is RECORDED, so the
        // FRAUD-011 cap counts trial-funded usage and nothing else.
        const trialRemaining = await this.creditService.trialAllowanceRemaining(organizationId);
        if (trialRemaining === null || totalCost > trialRemaining) {
          return { record: null, deducted: false, insufficientCredits: true };
        }
        const [trialRecord] = await db
          .insert(usageRecords)
          .values({
            organizationId,
            actionType,
            quantity,
            unitCostCents: unitCost,
            totalCostCents: totalCost,
            metadata: { ...(metadata ?? {}), fundedBy: TRIAL_ALLOWANCE_FUNDING },
            billingMonth,
          })
          .returning();
        return { record: trialRecord, deducted: false, insufficientCredits: false };
      }
    }

    const [record] = await db
      .insert(usageRecords)
      .values({
        organizationId,
        actionType,
        quantity,
        unitCostCents: unitCost,
        totalCostCents: totalCost,
        metadata,
        billingMonth,
      })
      .returning();

    return { record, deducted: autoDeduct && totalCost > 0, insufficientCredits: false };
  }

  async getUsageSummary(
    organizationId: number,
    billingMonth?: string
  ): Promise<{ actionType: string; count: number; totalCost: number }[]> {
    const month = billingMonth || clock.now().toISOString().slice(0, 7);

    const results = await db
      .select({
        actionType: usageRecords.actionType,
        count: sql<number>`SUM(${usageRecords.quantity})::int`,
        totalCost: sql<number>`SUM(${usageRecords.totalCostCents})::int`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.organizationId, organizationId),
          eq(usageRecords.billingMonth, month)
        )
      )
      .groupBy(usageRecords.actionType);

    return results;
  }

  async getRecentUsage(organizationId: number, limit: number = 50): Promise<UsageRecord[]> {
    return db.query.usageRecords.findMany({
      where: eq(usageRecords.organizationId, organizationId),
      orderBy: [desc(usageRecords.createdAt)],
      limit,
    });
  }

  async getAllRates(): Promise<UsageRate[]> {
    return db.query.usageRates.findMany({
      where: eq(usageRates.isActive, true),
    });
  }

  async updateRate(actionType: UsageActionType, unitCostCents: number): Promise<UsageRate> {
    const existing = await db.query.usageRates.findFirst({
      where: eq(usageRates.actionType, actionType),
    });

    if (existing) {
      const [updated] = await db
        .update(usageRates)
        .set({ unitCostCents, updatedAt: clock.now() })
        .where(eq(usageRates.id, existing.id))
        .returning();
      return updated;
    }

    const actionInfo = USAGE_ACTION_TYPES[actionType];
    const [created] = await db
      .insert(usageRates)
      .values({
        actionType,
        displayName: actionInfo?.name || actionType,
        unitCostCents,
        description: `Cost per ${actionInfo?.name || actionType}`,
      })
      .returning();

    return created;
  }

  // Check if auto-top-up should trigger and return the amount to add
  async checkAutoTopUp(organizationId: number): Promise<{ shouldTopUp: boolean; amountCents: number }> {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });

    if (!org || !org.autoTopUpEnabled) {
      return { shouldTopUp: false, amountCents: 0 };
    }

    const balance = Number(org.creditBalance || 0);
    const threshold = org.autoTopUpThresholdCents || 200;
    const topUpAmount = org.autoTopUpAmountCents || 2500;

    if (balance < threshold) {
      return { shouldTopUp: true, amountCents: topUpAmount };
    }

    return { shouldTopUp: false, amountCents: 0 };
  }

  // D2 (founder decision 2026-07-11): execute the auto-top-up for real.
  //
  // Rules, in order:
  //   - Customer settings decide IF and HOW MUCH (autoTopUpEnabled /
  //     threshold / amount) — but the permanent $500/action hard-stop binds
  //     ABOVE customer config: no single auto charge ever exceeds $500.
  //   - Idempotent per dip: skip if an auto top-up was charged in the last
  //     hour (the ledger is the guard), and the Stripe idempotency key is
  //     keyed to (org, hour) so even a race can't double-charge.
  //   - Off-session PaymentIntent against the customer's card on file
  //     (SetupIntent flow in routes-billing.ts). No card → honest skip.
  //   - Credits are added ONLY after the charge succeeds. Every outcome is
  //     Letter-visible via logActivity and the customer gets a receipt
  //     (success) or an action-needed email (decline).
  //   - Idles silently while Stripe is unconfigured; live with the keys.
  async executeAutoTopUp(organizationId: number): Promise<{ executed: boolean; reason: string }> {
    const AUTO_TOP_UP_HARD_STOP_CENTS = 50_000; // $500/action — permanent house hard-stop

    const { shouldTopUp, amountCents: configuredCents } = await this.checkAutoTopUp(organizationId);
    if (!shouldTopUp) return { executed: false, reason: "not_triggered" };

    let stripe: Stripe; // audit F-06-1: typed the money SDK client (was untyped)
    try {
      const { getUncachableStripeClient } = await import("../stripeClient");
      stripe = await getUncachableStripeClient();
    } catch {
      logger.info(`[credits] Auto-top-up idle for org ${organizationId} — Stripe not configured yet (D2 goes live with keys)`);
      return { executed: false, reason: "stripe_unconfigured" };
    }

    const amountCents = Math.min(configuredCents, AUTO_TOP_UP_HARD_STOP_CENTS);

    // Ledger-based idempotency: one auto charge per org per hour, max.
    const oneHourAgo = new Date(clock.nowMs() - 60 * 60 * 1000);
    const [recent] = await db
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.organizationId, organizationId),
          eq(creditTransactions.type, "topup"),
          sql`${creditTransactions.metadata} ->> 'auto' = 'true'`,
          sql`${creditTransactions.createdAt} >= ${oneHourAgo}`,
        ),
      )
      .limit(1);
    if (recent) return { executed: false, reason: "recent_auto_topup" };

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });
    if (!org?.stripeCustomerId) {
      logger.warn(`[credits] Auto-top-up skipped for org ${organizationId} — no Stripe customer/card on file`);
      return { executed: false, reason: "no_card_on_file" };
    }

    // Resolve the card on file (set by the SetupIntent flow).
    let paymentMethodId: string | null = null;
    try {
      const customer = await stripe.customers.retrieve(org.stripeCustomerId);
      paymentMethodId =
        (customer as any)?.invoice_settings?.default_payment_method ?? null;
      if (!paymentMethodId) {
        const pms = await stripe.paymentMethods.list({ customer: org.stripeCustomerId, type: "card", limit: 1 });
        paymentMethodId = pms?.data?.[0]?.id ?? null;
      }
    } catch (err: any) {
      logger.warn(`[credits] Auto-top-up card lookup failed for org ${organizationId}: ${err?.message}`);
      return { executed: false, reason: "card_lookup_failed" };
    }
    if (!paymentMethodId) {
      logger.warn(`[credits] Auto-top-up skipped for org ${organizationId} — no card on file`);
      return { executed: false, reason: "no_card_on_file" };
    }

    // Receipt recipient: the owner's email (organizations has no email column).
    let recipientEmail: string | null = null;
    try {
      const { users } = await import("@shared/models/auth");
      const [owner] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, org.ownerId))
        .limit(1);
      recipientEmail = owner?.email ?? null;
    } catch {
      recipientEmail = null;
    }

    const hourBucket = clock.now().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: "usd",
          customer: org.stripeCustomerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: `AcreOS credit auto-top-up ($${(amountCents / 100).toFixed(2)})`,
          metadata: { organizationId: String(organizationId), kind: "auto_top_up" },
        },
        { idempotencyKey: `auto-topup:${organizationId}:${hourBucket}` },
      );

      // Credits land ONLY after the charge succeeded.
      await creditService.addCredits(organizationId, amountCents, "topup", "Auto-top-up (card on file)", {
        auto: "true",
        paymentIntentId: intent.id,
      } as any);

      logger.info(`[credits] Auto-top-up SUCCEEDED for org ${organizationId}: ${amountCents}¢ (pi ${intent.id})`);
      const { logActivity } = await import("./systemActivityLogger");
      logActivity({
        orgId: organizationId,
        job: "billing",
        action: "auto_top_up_succeeded",
        summary: `Auto-top-up charged $${(amountCents / 100).toFixed(2)} to the card on file and credited the balance`,
        metadata: { amountCents, paymentIntentId: intent.id },
      }).catch(() => {});

      // Receipt — best-effort, never blocks the credit.
      try {
        const { emailService } = await import("./emailService");
        if (recipientEmail) {
          await emailService.sendEmail({
            to: recipientEmail,
            subject: `Receipt: $${(amountCents / 100).toFixed(2)} AcreOS credit top-up`,
            html: `<p>Hi ${org.name},</p><p>Your credit balance dropped below your auto-top-up threshold, so we charged your card on file <strong>$${(amountCents / 100).toFixed(2)}</strong> and credited your balance. You can adjust or disable auto-top-up any time in Settings → Billing.</p>`,
            text: `Hi ${org.name},\n\nYour credit balance dropped below your auto-top-up threshold, so we charged your card on file $${(amountCents / 100).toFixed(2)} and credited your balance.\n\nAdjust or disable auto-top-up any time in Settings → Billing.`,
          });
        }
      } catch (mailErr) {
        logger.warn(`[credits] Auto-top-up receipt email failed for org ${organizationId}`);
      }

      return { executed: true, reason: "charged" };
    } catch (err: any) {
      const reason = (err?.message || String(err)).slice(0, 200);
      logger.warn(`[credits] Auto-top-up charge FAILED for org ${organizationId}: ${reason}`);
      const { logActivity } = await import("./systemActivityLogger");
      logActivity({
        orgId: organizationId,
        job: "billing",
        action: "auto_top_up_failed",
        summary: `Auto-top-up charge failed — ${reason}`,
        metadata: { amountCents, reason },
      }).catch(() => {});

      try {
        const { emailService } = await import("./emailService");
        if (recipientEmail) {
          await emailService.sendEmail({
            to: recipientEmail,
            subject: "Action needed: your AcreOS auto-top-up didn't go through",
            html: `<p>Hi ${org.name},</p><p>We tried to top up your credit balance from your card on file, but the charge didn't go through. Your balance was not changed and you were not charged. Please update your card in Settings → Billing to keep auto-top-up working.</p>`,
            text: `Hi ${org.name},\n\nWe tried to top up your credit balance from your card on file, but the charge didn't go through. You were not charged. Update your card in Settings → Billing to keep auto-top-up working.`,
          });
        }
      } catch {
        /* best-effort */
      }
      return { executed: false, reason: "charge_failed" };
    }
  }

  // A monthly "tier allowance" grant used to live here (and a sibling on
  // CreditService): it credited SUBSCRIPTION_TIERS[tier].limits.monthlyCredits
  // to the purchased-credit wallet for every active paid org — $250/mo on the
  // $79 Scale plan, ~3x that tier's whole 8,000-credit pool, on the platform's
  // dime. It had zero production callers and was removed (2026-10 cost
  // efficiency) rather than left one wiring away from live. The plan's included
  // usage is the tier creditPool (shared/billing/tier-limits.ts), drawn by
  // creditPool.poolDebit — there is no second, larger grant.
  // creditGrantPathsAreBounded.test.ts fails if any grant path returns.

  // Update auto-top-up settings for an organization
  async updateAutoTopUpSettings(
    organizationId: number,
    enabled: boolean,
    thresholdCents?: number,
    amountCents?: number
  ): Promise<void> {
    await db
      .update(organizations)
      .set({
        autoTopUpEnabled: enabled,
        ...(thresholdCents !== undefined && { autoTopUpThresholdCents: thresholdCents }),
        ...(amountCents !== undefined && { autoTopUpAmountCents: amountCents }),
      })
      .where(eq(organizations.id, organizationId));
  }
}

export const creditService = new CreditService();
export const usageMeteringService = new UsageMeteringService();
