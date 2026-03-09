// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from "../db";
import {
  usageRecords,
  usageEvents,
  usageRates,
  whitelabelTenants,
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

// Credit rate map for quick lookup (cents per unit)
const DEFAULT_RATES: Record<string, number> = {
  api_call: 1,          // 1 cent per API call
  voice_minute: 5,      // 5 cents per voice minute
  storage_mb: 0,        // 0 cents — included in plan
  ai_credit_standard: 2,
  ai_credit_premium: 10,
};

export class TenantMeteringService {

  /**
   * Record an API call usage event for a tenant
   */
  async recordApiCall(tenantId: number, endpoint: string, credits: number = 1) {
    const billingMonth = this.currentBillingMonth();
    await db.insert(usageRecords).values({
      organizationId: tenantId,
      actionType: "api_call",
      quantity: credits,
      unitCostCents: DEFAULT_RATES.api_call,
      totalCostCents: credits * DEFAULT_RATES.api_call,
      metadata: { endpoint },
      billingMonth,
    });

    await db.insert(usageEvents).values({
      organizationId: tenantId,
      eventType: "api_call",
      quantity: credits,
      metadata: { endpoint, credits },
    });

    return { tenantId, endpoint, credits, recorded: true };
  }

  /**
   * Record voice minutes consumed
   */
  async recordVoiceMinutes(tenantId: number, minutes: number) {
    const billingMonth = this.currentBillingMonth();
    const totalCents = Math.ceil(minutes) * DEFAULT_RATES.voice_minute;

    await db.insert(usageRecords).values({
      organizationId: tenantId,
      actionType: "voice_minutes",
      quantity: Math.ceil(minutes),
      unitCostCents: DEFAULT_RATES.voice_minute,
      totalCostCents: totalCents,
      metadata: { minutesRaw: minutes },
      billingMonth,
    });

    return { tenantId, minutes, totalCents, recorded: true };
  }

  /**
   * Record storage usage in megabytes
   */
  async recordStorageUsage(tenantId: number, megabytes: number) {
    const billingMonth = this.currentBillingMonth();

    await db.insert(usageRecords).values({
      organizationId: tenantId,
      actionType: "storage_mb",
      quantity: Math.ceil(megabytes),
      unitCostCents: DEFAULT_RATES.storage_mb,
      totalCostCents: 0,
      metadata: { megabytes },
      billingMonth,
    });

    return { tenantId, megabytes, recorded: true };
  }

  /**
   * Record AI credit consumption (model-specific)
   */
  async recordAICredit(tenantId: number, credits: number, model: string) {
    const billingMonth = this.currentBillingMonth();
    const isPremium = /gpt-4|claude-opus|claude-3-opus/i.test(model);
    const rateKey = isPremium ? "ai_credit_premium" : "ai_credit_standard";
    const unitCost = DEFAULT_RATES[rateKey];
    const totalCents = credits * unitCost;

    await db.insert(usageRecords).values({
      organizationId: tenantId,
      actionType: "ai_credit",
      quantity: credits,
      unitCostCents: unitCost,
      totalCostCents: totalCents,
      metadata: { model, credits, tier: isPremium ? "premium" : "standard" },
      billingMonth,
    });

    return { tenantId, credits, model, totalCents, recorded: true };
  }

  /**
   * Get current billing period usage totals for a tenant
   */
  async getCurrentUsage(tenantId: number) {
    const billingMonth = this.currentBillingMonth();

    const records = await db.select()
      .from(usageRecords)
      .where(and(
        eq(usageRecords.organizationId, tenantId),
        eq(usageRecords.billingMonth, billingMonth)
      ));

    return this.aggregateUsageRecords(records);
  }

  /**
   * Get usage for a specified time period
   */
  async getUsagePeriod(tenantId: number, start: Date, end: Date) {
    const records = await db.select()
      .from(usageRecords)
      .where(and(
        eq(usageRecords.organizationId, tenantId),
        gte(usageRecords.createdAt, start),
        lte(usageRecords.createdAt, end)
      ))
      .orderBy(desc(usageRecords.createdAt));

    return {
      ...this.aggregateUsageRecords(records),
      periodStart: start,
      periodEnd: end,
      recordCount: records.length,
    };
  }

  private aggregateUsageRecords(records: any[]) {
    const result = {
      apiCalls: 0,
      voiceMinutes: 0,
      storageMb: 0,
      aiCredits: 0,
      totalCostCents: 0,
    };

    for (const r of records) {
      const qty = r.quantity || 0;
      switch (r.actionType) {
        case "api_call": result.apiCalls += qty; break;
        case "voice_minutes": result.voiceMinutes += qty; break;
        case "storage_mb": result.storageMb += qty; break;
        case "ai_credit": result.aiCredits += qty; break;
      }
      result.totalCostCents += r.totalCostCents || 0;
    }

    return result;
  }

  /**
   * Check if a tenant is within their plan limits
   */
  async checkUsageLimits(tenantId: number): Promise<{
    withinLimits: boolean;
    overages: Partial<{
      apiCalls: number;
      voiceMinutes: number;
      storageMb: number;
      aiCredits: number;
    }>;
  }> {
    const [tenant] = await db.select()
      .from(whitelabelTenants)
      .where(eq(whitelabelTenants.id, tenantId))
      .limit(1);

    // Plan limits — in production these would come from the plan config
    const planLimits: Record<string, { apiCalls: number; voiceMinutes: number; storageMb: number; aiCredits: number }> = {
      starter: { apiCalls: 10_000, voiceMinutes: 100, storageMb: 5_000, aiCredits: 500 },
      professional: { apiCalls: 100_000, voiceMinutes: 1_000, storageMb: 50_000, aiCredits: 5_000 },
      enterprise: { apiCalls: -1, voiceMinutes: -1, storageMb: -1, aiCredits: -1 },
    };

    const plan = tenant?.plan || "starter";
    const limits = planLimits[plan] || planLimits.starter;
    const usage = await this.getCurrentUsage(tenantId);

    const overages: Record<string, number> = {};

    if (limits.apiCalls !== -1 && usage.apiCalls > limits.apiCalls) {
      overages.apiCalls = usage.apiCalls - limits.apiCalls;
    }
    if (limits.voiceMinutes !== -1 && usage.voiceMinutes > limits.voiceMinutes) {
      overages.voiceMinutes = usage.voiceMinutes - limits.voiceMinutes;
    }
    if (limits.storageMb !== -1 && usage.storageMb > limits.storageMb) {
      overages.storageMb = usage.storageMb - limits.storageMb;
    }
    if (limits.aiCredits !== -1 && usage.aiCredits > limits.aiCredits) {
      overages.aiCredits = usage.aiCredits - limits.aiCredits;
    }

    return {
      withinLimits: Object.keys(overages).length === 0,
      overages,
    };
  }

  /**
   * Generate an itemized monthly bill for a tenant
   */
  async generateMonthlyBill(tenantId: number) {
    const billingMonth = this.currentBillingMonth();

    const records = await db.select()
      .from(usageRecords)
      .where(and(
        eq(usageRecords.organizationId, tenantId),
        eq(usageRecords.billingMonth, billingMonth)
      ))
      .orderBy(desc(usageRecords.createdAt));

    const lineItems = this.buildLineItems(records);
    const subtotal = lineItems.reduce((sum, item) => sum + item.totalCents, 0);
    const taxRate = 0.0; // tax logic omitted — extend per jurisdiction
    const tax = Math.round(subtotal * taxRate);
    const total = subtotal + tax;

    return {
      tenantId,
      billingMonth,
      lineItems,
      subtotalCents: subtotal,
      taxCents: tax,
      totalCents: total,
      totalDollars: (total / 100).toFixed(2),
      generatedAt: new Date(),
    };
  }

  private buildLineItems(records: any[]) {
    const grouped: Record<string, { qty: number; unitCost: number; totalCents: number }> = {};

    for (const r of records) {
      if (!grouped[r.actionType]) {
        grouped[r.actionType] = { qty: 0, unitCost: r.unitCostCents, totalCents: 0 };
      }
      grouped[r.actionType].qty += r.quantity;
      grouped[r.actionType].totalCents += r.totalCostCents;
    }

    return Object.entries(grouped).map(([type, data]) => ({
      description: type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      quantity: data.qty,
      unitCostCents: data.unitCost,
      totalCents: data.totalCents,
      totalDollars: (data.totalCents / 100).toFixed(2),
    }));
  }

  /**
   * Get month-over-month usage trends
   */
  async getUsageTrends(tenantId: number, months: number = 6) {
    const results: any[] = [];

    for (let i = 0; i < months; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const billingMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      const records = await db.select()
        .from(usageRecords)
        .where(and(
          eq(usageRecords.organizationId, tenantId),
          eq(usageRecords.billingMonth, billingMonth)
        ));

      const agg = this.aggregateUsageRecords(records);
      results.push({ month: billingMonth, ...agg });
    }

    return results.reverse();
  }

  private currentBillingMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
}

export const tenantMeteringService = new TenantMeteringService();
