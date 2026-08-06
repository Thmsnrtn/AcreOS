import type Stripe from "stripe";
import { db, withTransaction } from "../db";
import { eq, desc, sql, and } from "drizzle-orm";
import {
  organizations,
  creditTransactions,
  usageRecords,
  usageRates,
  USAGE_ACTION_TYPES,
  CREDIT_PACKS,
  SUBSCRIPTION_TIERS,
  type CreditTransaction,
  type InsertCreditTransaction,
  type UsageRecord,
  type InsertUsageRecord,
  type UsageRate,
  type UsageActionType,
  type CreditPackId,
  type SubscriptionTier,
} from "@shared/schema";
import { logger } from "../utils/logger";

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
    metadata?: InsertCreditTransaction["metadata"]
  ): Promise<CreditTransaction> {
    // Wrap balance update + transaction log in a single DB transaction
    // to prevent ledger desync on crash (P0 fix DI-001)
    return await withTransaction(async (tx) => {
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
    });
  }

  async deductCredits(
    organizationId: number,
    amountCents: number,
    description: string,
    metadata?: InsertCreditTransaction["metadata"]
  ): Promise<CreditTransaction | null> {
    if (await this.isFounder(organizationId)) {
      const [transaction] = await db
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
    const result = await withTransaction(async (tx) => {
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
    });

    if (!result) {
      return null;
    }

    // D2 (founder decision 2026-07-11): auto-top-up executes for real after a
    // deduction (outside the transaction — a top-up failure must never roll
    // back the deduction). All guards live inside executeAutoTopUp.
    usageMeteringService.executeAutoTopUp(organizationId).catch((err: unknown) => {
      logger.error("[credits] Auto-top-up execution failed", err instanceof Error ? err : undefined);
    });

    return result;
  }

  async hasEnoughCredits(organizationId: number, requiredCents: number): Promise<boolean> {
    if (await this.isFounder(organizationId)) return true;

    // Check if user is in trial period - allow basic AI chat during trial
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
      columns: { trialEndsAt: true, subscriptionTier: true }
    });

    // Users in active trial period get free basic AI chat, but capped at 500 cents ($5)
    // to prevent abuse (FRAUD-011)
    if (org?.trialEndsAt && new Date(org.trialEndsAt) > new Date()) {
      const TRIAL_SPENDING_CAP_CENTS = 500;

      // Sum all debit transactions during this trial period
      const [result] = await db
        .select({
          totalDebits: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amountCents})), 0)::int`
        })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.organizationId, organizationId),
            eq(creditTransactions.type, "debit"),
            sql`${creditTransactions.createdAt} >= (
              SELECT ${organizations.trialEndsAt} - INTERVAL '14 days'
              FROM ${organizations}
              WHERE ${organizations.id} = ${organizationId}
            )`
          )
        );

      const totalDebits = result?.totalDebits || 0;
      if (totalDebits + requiredCents > TRIAL_SPENDING_CAP_CENTS) {
        logger.info(`[credits] Trial spending cap reached for org ${organizationId}: ${totalDebits}¢ spent of ${TRIAL_SPENDING_CAP_CENTS}¢ cap`);
        return false;
      }

      return true;
    }

    // Note: Trial tokens are for premium skills only, not basic AI chat
    // They are consumed via storage.consumeTrialToken() in skill permission checks

    const balance = await this.getBalance(organizationId);
    return balance >= requiredCents;
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

  async applyMonthlyAllowance(organizationId: number, tier: SubscriptionTier): Promise<CreditTransaction | null> {
    const tierConfig = SUBSCRIPTION_TIERS[tier];
    if (!tierConfig || !tierConfig.limits.monthlyCredits) {
      return null;
    }

    const allowance = tierConfig.limits.monthlyCredits;
    const currentMonth = new Date().toISOString().slice(0, 7);

    // DEFECT-0007: Use atomic INSERT ... ON CONFLICT DO NOTHING on the
    // (organization_id, allowance_month) unique index to prevent double-granting
    // when concurrent instances both attempt to apply the same month's allowance.
    return await withTransaction(async (tx) => {
      // Atomically update credit balance
      const [updated] = await tx
        .update(organizations)
        .set({
          creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric + ${allowance}`
        })
        .where(eq(organizations.id, organizationId))
        .returning({ newBalance: sql<number>`(COALESCE(${organizations.creditBalance}, '0')::numeric)::int` });

      const newBalance = updated?.newBalance || allowance;

      // Try to insert the allowance record — if the unique constraint on
      // (organization_id, allowance_month) conflicts, no row is returned
      // and we know another instance already granted this month's allowance.
      const result = await tx
        .insert(creditTransactions)
        .values({
          organizationId,
          type: "monthly_allowance",
          amountCents: allowance,
          balanceAfterCents: newBalance,
          description: `Monthly credit allowance for ${tierConfig.name} plan`,
          allowanceMonth: currentMonth,
          metadata: { month: currentMonth },
        })
        .onConflictDoNothing()
        .returning();

      if (result.length === 0) {
        // Conflict — allowance already granted this month. Roll back the balance
        // update by reversing it (the entire transaction will handle this correctly
        // since we're in a withTransaction block, but we explicitly undo to be safe).
        await tx
          .update(organizations)
          .set({
            creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric - ${allowance}`
          })
          .where(eq(organizations.id, organizationId));
        return null;
      }

      return result[0];
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
    const billingMonth = new Date().toISOString().slice(0, 7);

    if (autoDeduct && totalCost > 0) {
      const deductResult = await this.creditService.deductCredits(
        organizationId,
        totalCost,
        `${USAGE_ACTION_TYPES[actionType]?.name || actionType} x${quantity}`,
        { actionType, quantity }
      );

      if (!deductResult) {
        return { record: null, deducted: false, insufficientCredits: true };
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
    const month = billingMonth || new Date().toISOString().slice(0, 7);

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
        .set({ unitCostCents, updatedAt: new Date() })
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
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
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
        .where(eq(users.clerkUserId, org.ownerId))
        .limit(1);
      recipientEmail = owner?.email ?? null;
    } catch {
      recipientEmail = null;
    }

    const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
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

  // Apply monthly tier allowance to organization
  // DEFECT-0007: Uses atomic INSERT ... ON CONFLICT DO NOTHING on the
  // (organization_id, allowance_month) unique index to prevent double-granting.
  async applyMonthlyAllowance(organizationId: number): Promise<CreditTransaction | null> {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });

    if (!org) return null;

    const tier = (org.subscriptionTier || 'free') as SubscriptionTier;
    const tierInfo = SUBSCRIPTION_TIERS[tier];
    const monthlyCredits = tierInfo?.limits?.monthlyCredits || 0;

    if (!tierInfo || monthlyCredits <= 0) {
      return null;
    }

    const currentMonth = new Date().toISOString().slice(0, 7);

    return await withTransaction(async (tx) => {
      // Update credit balance first
      const [updated] = await tx
        .update(organizations)
        .set({
          creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric + ${monthlyCredits}`
        })
        .where(eq(organizations.id, organizationId))
        .returning({ newBalance: sql<number>`(COALESCE(${organizations.creditBalance}, '0')::numeric)::int` });

      // Atomically try to insert the allowance record.
      // The unique index on (organization_id, allowance_month) prevents duplicates.
      const result = await tx
        .insert(creditTransactions)
        .values({
          organizationId,
          type: 'allowance',
          amountCents: monthlyCredits,
          balanceAfterCents: updated?.newBalance || monthlyCredits,
          description: `Monthly ${tierInfo.name} tier allowance`,
          allowanceMonth: currentMonth,
          metadata: {
            tier,
            month: currentMonth,
          },
        })
        .onConflictDoNothing()
        .returning();

      if (result.length === 0) {
        // Conflict — allowance already granted this month. Reverse balance update.
        await tx
          .update(organizations)
          .set({
            creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric - ${monthlyCredits}`
          })
          .where(eq(organizations.id, organizationId));
        logger.info(`Monthly allowance already applied for org ${organizationId} in ${currentMonth}, skipping`);
        return null;
      }

      logger.info(`Applied monthly allowance: Org ${organizationId}, Tier ${tier}, Amount: $${(monthlyCredits / 100).toFixed(2)}`);
      return result[0];
    });
  }

  // Process all organizations for monthly allowance (called at billing cycle)
  async processMonthlyAllowances(): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;

    // Get all paid organizations
    const paidOrgs = await db
      .select()
      .from(organizations)
      .where(
        sql`${organizations.subscriptionTier} IN ('starter', 'pro', 'scale') 
            AND ${organizations.subscriptionStatus} = 'active'`
      );

    for (const org of paidOrgs) {
      try {
        await this.applyMonthlyAllowance(org.id);
        processed++;
      } catch (err) {
        logger.error(`Failed to apply monthly allowance for org ${org.id}`, err);
        failed++;
      }
    }

    logger.info(`Monthly allowances processed: ${processed} success, ${failed} failed`);
    return { processed, failed };
  }

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
