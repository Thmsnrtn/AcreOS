/**
 * AML (Anti-Money Laundering) pattern awareness.
 * Advisory only — never auto-reports, never blocks transactions.
 * Reminds operators to consult compliance advisors.
 */

import { db } from "../db";
import { deals, payments, properties } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface AmlFlag {
  pattern: string;
  severity: "informational";
  description: string;
  advisory: string;
  dealId?: number;
  amount?: number;
  detectedAt: Date;
}

const AML_ADVISORY = "This is not a report — it's a reminder to consult your compliance advisor.";

export async function checkDealAmlPatterns(
  orgId: number,
  dealId: number,
  purchasePrice: number,
  buyerType?: string,
  buyerAddress?: string
): Promise<AmlFlag[]> {
  const flags: AmlFlag[] = [];

  // 1. Cash purchase over $10,000 by individual
  if (purchasePrice > 10000 && (!buyerType || buyerType === "individual")) {
    flags.push({
      pattern: "large_cash_purchase",
      severity: "informational",
      description: `Cash purchase of $${purchasePrice.toLocaleString()} by an individual.`,
      advisory: `AML Advisory: This transaction exceeds $10,000. ${AML_ADVISORY}`,
      dealId,
      amount: purchasePrice,
      detectedAt: new Date(),
    });
  }

  // 2. Rapid flip check — same org property bought and sold within 30 days at >50% markup
  try {
    const deal = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    if (deal.length > 0 && deal[0].propertyId) {
      const prop = await db.select().from(properties).where(eq(properties.id, deal[0].propertyId)).limit(1);
      if (prop.length > 0 && prop[0].purchasePrice && prop[0].purchaseDate) {
        const origPrice = parseFloat(prop[0].purchasePrice);
        const daysSincePurchase = Math.floor(
          (Date.now() - new Date(prop[0].purchaseDate).getTime()) / 86400000
        );
        if (daysSincePurchase <= 30 && origPrice > 0) {
          const markup = ((purchasePrice - origPrice) / origPrice) * 100;
          if (markup > 50) {
            flags.push({
              pattern: "rapid_flip",
              severity: "informational",
              description: `Property sold ${daysSincePurchase} days after purchase at ${Math.round(markup)}% markup.`,
              advisory: `AML Advisory: Rapid flip pattern detected. ${AML_ADVISORY}`,
              dealId,
              amount: purchasePrice,
              detectedAt: new Date(),
            });
          }
        }
      }
    }
  } catch (err) {
    logger.error("AML rapid flip check failed", err instanceof Error ? err : undefined);
  }

  // 3. Foreign entity indicator
  if (buyerAddress) {
    const foreignIndicators = ["foreign", "international", "overseas", "abroad"];
    const lowerAddr = buyerAddress.toLowerCase();
    if (foreignIndicators.some(f => lowerAddr.includes(f))) {
      flags.push({
        pattern: "foreign_entity",
        severity: "informational",
        description: "Purchase involves a potentially foreign entity.",
        advisory: `AML Advisory: Foreign entity involvement may require additional due diligence. ${AML_ADVISORY}`,
        dealId,
        detectedAt: new Date(),
      });
    }
  }

  // 4. Multiple cash purchases >$10K in 30 days (structuring awareness)
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const recentDeals = await db.select().from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        gte(deals.createdAt, thirtyDaysAgo)
      ));
    const cashTotal = recentDeals.reduce((sum, d) => {
      const amt = parseFloat(d.acceptedAmount || d.offerAmount || "0");
      return sum + (amt > 0 ? amt : 0);
    }, 0);
    if (cashTotal > 10000 && recentDeals.length >= 3) {
      flags.push({
        pattern: "structuring_awareness",
        severity: "informational",
        description: `${recentDeals.length} purchases totaling $${Math.round(cashTotal).toLocaleString()} in 30-day period.`,
        advisory: `AML Advisory: Multiple transactions exceeding $10,000 aggregate. ${AML_ADVISORY}`,
        dealId,
        amount: cashTotal,
        detectedAt: new Date(),
      });
    }
  } catch {}

  if (flags.length > 0) {
    logger.info("AML patterns detected", { orgId, dealId, patterns: flags.map(f => f.pattern) });
  }

  return flags;
}
