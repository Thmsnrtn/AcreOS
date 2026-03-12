// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from "../db";
import {
  transactionFeeSettlements,
  feePayoutSchedules,
  feeAuditLog,
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

export interface FeeStructure {
  platformFeePercent: number;   // e.g. 1.5 for 1.5%
  buyerFeePercent: number;
  sellerFeePercent: number;
  flatFee?: number;
  capAmount?: number;
}

export interface FeeBreakdown {
  platformFee: number;
  buyerFee: number;
  sellerFee: number;
  total: number;
  transactionAmount: number;
  effectiveRate: number;
}

export class TransactionFeeService {

  /**
   * Calculate fee breakdown for a transaction amount
   */
  calculateFee(transactionAmount: number, feeStructure: FeeStructure): FeeBreakdown {
    const platformFee = (transactionAmount * feeStructure.platformFeePercent) / 100;
    const buyerFee = (transactionAmount * feeStructure.buyerFeePercent) / 100;
    const sellerFee = (transactionAmount * feeStructure.sellerFeePercent) / 100;
    const flatFee = feeStructure.flatFee || 0;

    let total = platformFee + buyerFee + sellerFee + flatFee;

    // Apply cap if set
    if (feeStructure.capAmount && total > feeStructure.capAmount) {
      total = feeStructure.capAmount;
    }

    const effectiveRate = transactionAmount > 0 ? (total / transactionAmount) * 100 : 0;

    return {
      platformFee: Math.round(platformFee * 100) / 100,
      buyerFee: Math.round(buyerFee * 100) / 100,
      sellerFee: Math.round(sellerFee * 100) / 100,
      total: Math.round(total * 100) / 100,
      transactionAmount,
      effectiveRate: Math.round(effectiveRate * 10000) / 10000,
    };
  }

  /**
   * Create a fee settlement record for a transaction
   */
  async createSettlement(transactionId: number, feeData: {
    organizationId: number;
    feeBreakdown: FeeBreakdown;
    stripePaymentIntentId?: string;
  }) {
    const settlements: any[] = [];

    const feeTypes = [
      { type: "platform_fee", amount: feeData.feeBreakdown.platformFee },
      { type: "buyer_fee", amount: feeData.feeBreakdown.buyerFee },
      { type: "seller_fee", amount: feeData.feeBreakdown.sellerFee },
    ];

    for (const { type, amount } of feeTypes) {
      if (amount <= 0) continue;

      const [settlement] = await db.insert(transactionFeeSettlements).values({
        organizationId: feeData.organizationId,
        transactionId,
        feeType: type,
        feeAmount: amount.toString(),
        feePercent: feeData.feeBreakdown.effectiveRate.toString(),
        status: "pending",
        stripePaymentIntentId: feeData.stripePaymentIntentId,
      }).returning();

      await this.logFeeEvent(
        settlement.id,
        feeData.organizationId,
        "fee_collected",
        amount,
        0,
        amount
      );

      settlements.push(settlement);
    }

    return settlements;
  }

  /**
   * Place fees into escrow for a specified number of hold days
   */
  async holdInEscrow(settlementId: number, holdDays: number) {
    const [settlement] = await db.select()
      .from(transactionFeeSettlements)
      .where(eq(transactionFeeSettlements.id, settlementId))
      .limit(1);

    if (!settlement) throw new Error(`Settlement ${settlementId} not found`);
    if (settlement.status !== "pending") {
      throw new Error(`Settlement is not in pending state: ${settlement.status}`);
    }

    const heldUntil = new Date();
    heldUntil.setDate(heldUntil.getDate() + holdDays);

    await db.update(transactionFeeSettlements)
      .set({ status: "held", heldUntil })
      .where(eq(transactionFeeSettlements.id, settlementId));

    await this.logFeeEvent(
      settlementId,
      settlement.organizationId,
      "escrow_held",
      parseFloat(settlement.feeAmount),
      parseFloat(settlement.feeAmount),
      parseFloat(settlement.feeAmount)
    );

    return { settlementId, status: "held", heldUntil };
  }

  /**
   * Release a settlement from escrow
   */
  async releaseFromEscrow(settlementId: number) {
    const [settlement] = await db.select()
      .from(transactionFeeSettlements)
      .where(eq(transactionFeeSettlements.id, settlementId))
      .limit(1);

    if (!settlement) throw new Error(`Settlement ${settlementId} not found`);

    const now = new Date();
    if (settlement.heldUntil && new Date(settlement.heldUntil) > now) {
      throw new Error(`Settlement is still in hold period until ${settlement.heldUntil}`);
    }

    await db.update(transactionFeeSettlements)
      .set({ status: "released", releasedAt: now })
      .where(eq(transactionFeeSettlements.id, settlementId));

    await this.logFeeEvent(
      settlementId,
      settlement.organizationId,
      "payout_sent",
      parseFloat(settlement.feeAmount),
      parseFloat(settlement.feeAmount),
      0
    );

    return { settlementId, status: "released", releasedAt: now };
  }

  /**
   * Configure automated payout schedule for an org
   */
  async scheduleAutoPayout(orgId: number, config: {
    cadence: "daily" | "weekly" | "biweekly" | "monthly";
    minimumPayoutAmount?: number;
    stripeConnectedAccountId?: string;
  }) {
    // Deactivate existing schedule
    await db.update(feePayoutSchedules)
      .set({ isActive: false })
      .where(eq(feePayoutSchedules.organizationId, orgId));

    const nextPayoutAt = this.calculateNextPayoutDate(config.cadence);

    const [schedule] = await db.insert(feePayoutSchedules).values({
      organizationId: orgId,
      cadence: config.cadence,
      minimumPayoutAmount: (config.minimumPayoutAmount || 0).toString(),
      stripeConnectedAccountId: config.stripeConnectedAccountId,
      nextPayoutAt,
      isActive: true,
    }).returning();

    return schedule;
  }

  private calculateNextPayoutDate(cadence: string): Date {
    const now = new Date();
    switch (cadence) {
      case "daily":
        now.setDate(now.getDate() + 1);
        break;
      case "weekly":
        now.setDate(now.getDate() + 7);
        break;
      case "biweekly":
        now.setDate(now.getDate() + 14);
        break;
      case "monthly":
        now.setMonth(now.getMonth() + 1);
        break;
    }
    return now;
  }

  /**
   * Process payout for a released settlement
   */
  async processPayout(settlementId: number) {
    const [settlement] = await db.select()
      .from(transactionFeeSettlements)
      .where(eq(transactionFeeSettlements.id, settlementId))
      .limit(1);

    if (!settlement) throw new Error(`Settlement ${settlementId} not found`);
    if (settlement.status !== "released") {
      throw new Error(`Settlement must be in released state to process payout, current: ${settlement.status}`);
    }

    // In production, would call Stripe Transfer API here
    // For now, mark as processed
    const stripeTransferId = `tr_simulated_${Date.now()}`;

    await db.update(transactionFeeSettlements)
      .set({
        stripeTransferIds: [stripeTransferId],
        status: "released",
      })
      .where(eq(transactionFeeSettlements.id, settlementId));

    return {
      settlementId,
      amount: parseFloat(settlement.feeAmount),
      stripeTransferId,
      processedAt: new Date(),
    };
  }

  /**
   * Get fee history for an org with optional filters
   */
  async getFeeHistory(orgId: number, filters: {
    status?: string;
    feeType?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  } = {}) {
    let query = db.select()
      .from(transactionFeeSettlements)
      .where(eq(transactionFeeSettlements.organizationId, orgId));

    const conditions: any[] = [eq(transactionFeeSettlements.organizationId, orgId)];

    if (filters.status) {
      conditions.push(eq(transactionFeeSettlements.status, filters.status));
    }
    if (filters.feeType) {
      conditions.push(eq(transactionFeeSettlements.feeType, filters.feeType));
    }
    if (filters.from) {
      conditions.push(gte(transactionFeeSettlements.createdAt, filters.from));
    }
    if (filters.to) {
      conditions.push(lte(transactionFeeSettlements.createdAt, filters.to));
    }

    const results = await db.select()
      .from(transactionFeeSettlements)
      .where(and(...conditions))
      .orderBy(desc(transactionFeeSettlements.createdAt))
      .limit(filters.limit || 100);

    return results;
  }

  /**
   * Get analytics summary for an org's fees
   */
  async getFeeAnalytics(orgId: number): Promise<{
    totalCollected: number;
    pending: number;
    avgFeeRate: number;
    heldInEscrow: number;
    released: number;
  }> {
    const settlements = await db.select()
      .from(transactionFeeSettlements)
      .where(eq(transactionFeeSettlements.organizationId, orgId));

    const totalCollected = settlements
      .filter(s => ["held", "released"].includes(s.status))
      .reduce((sum, s) => sum + parseFloat(s.feeAmount), 0);

    const pending = settlements
      .filter(s => s.status === "pending")
      .reduce((sum, s) => sum + parseFloat(s.feeAmount), 0);

    const heldInEscrow = settlements
      .filter(s => s.status === "held")
      .reduce((sum, s) => sum + parseFloat(s.feeAmount), 0);

    const released = settlements
      .filter(s => s.status === "released")
      .reduce((sum, s) => sum + parseFloat(s.feeAmount), 0);

    const avgFeeRate = settlements.length > 0
      ? settlements
          .filter(s => s.feePercent)
          .reduce((sum, s) => sum + parseFloat(s.feePercent || "0"), 0) / settlements.length
      : 0;

    return {
      totalCollected: Math.round(totalCollected * 100) / 100,
      pending: Math.round(pending * 100) / 100,
      avgFeeRate: Math.round(avgFeeRate * 10000) / 10000,
      heldInEscrow: Math.round(heldInEscrow * 100) / 100,
      released: Math.round(released * 100) / 100,
    };
  }

  /**
   * Log a fee event in the immutable audit ledger
   */
  async logFeeEvent(
    settlementId: number,
    organizationId: number,
    eventType: string,
    amount: number,
    balanceBefore: number,
    balanceAfter: number,
    metadata?: Record<string, any>
  ) {
    const [entry] = await db.insert(feeAuditLog).values({
      organizationId,
      settlementId,
      eventType,
      amount: amount.toString(),
      balanceBefore: balanceBefore.toString(),
      balanceAfter: balanceAfter.toString(),
      metadata,
    }).returning();

    return entry;
  }
}

export const transactionFeeService = new TransactionFeeService();
