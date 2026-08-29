import { db } from "../db";
import {
  costBasis,
  properties,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

const SHORT_TERM_MONTHS = 12;  // IRS: ≤12 months = short-term

export class CostBasisTracker {

  /**
   * Record the initial acquisition of a property and establish cost basis
   */
  async recordAcquisition(
    propertyId: number,
    orgId: number,
    acquisitionData: {
      acquisitionDate: Date;
      acquisitionPrice: number;
      acquisitionCosts: number;  // closing costs, title, survey, etc.
      notes?: string;
    }
  ) {
    // Check for existing basis record
    const [existing] = await db.select()
      .from(costBasis)
      .where(and(
        eq(costBasis.propertyId, propertyId),
        eq(costBasis.organizationId, orgId)
      ))
      .limit(1);

    if (existing) {
      throw new Error(`Cost basis already recorded for property ${propertyId}.`);
    }

    const adjustedBasis = acquisitionData.acquisitionPrice + acquisitionData.acquisitionCosts;

    const [record] = await db.insert(costBasis).values({
      organizationId: orgId,
      propertyId,
      acquisitionDate: acquisitionData.acquisitionDate,
      acquisitionPrice: acquisitionData.acquisitionPrice.toString(),
      acquisitionCosts: acquisitionData.acquisitionCosts.toString(),
      improvementCosts: "0",
      adjustedBasis: adjustedBasis.toString(),
      holdingPeriod: "short",  // will be updated as time passes
      notes: acquisitionData.notes,
    }).returning();

    return record;
  }

  // addImprovement, adjustBasis, computeGainLoss, getAdjustedBasis deleted 2026-08-29 — zero callers, adversarially verified (rule-1 register close-out).

  /**
   * Determine holding period (short/long) from acquisition date
   */
  determineHoldingPeriod(propertyId: number): Promise<"short" | "long"> {
    return db.select()
      .from(costBasis)
      .where(eq(costBasis.propertyId, propertyId))
      .limit(1)
      .then(([record]) => {
        if (!record || !record.acquisitionDate) return "short";
        return this.determineHoldingPeriodFromDate(record.acquisitionDate);
      });
  }

  private determineHoldingPeriodFromDate(acquisitionDate: Date | string | null): "short" | "long" {
    if (!acquisitionDate) return "short";
    const acquired = new Date(acquisitionDate);
    const monthsHeld = (Date.now() - acquired.getTime()) / (30.44 * 24 * 3600 * 1000);
    return monthsHeld > SHORT_TERM_MONTHS ? "long" : "short";
  }

  /**
   * Generate a comprehensive cost basis report for an org
   */
  async generateCostBasisReport(orgId: number) {
    const records = await db.select()
      .from(costBasis)
      .where(eq(costBasis.organizationId, orgId))
      .orderBy(desc(costBasis.createdAt));

    const summary = {
      totalProperties: records.length,
      totalAcquisitionCost: 0,
      totalAdjustedBasis: 0,
      totalImprovements: 0,
      totalRealizedGains: 0,
      totalRealizedLosses: 0,
      longTermCount: 0,
      shortTermCount: 0,
    };

    const detailed = records.map(r => {
      const acqPrice = parseFloat(r.acquisitionPrice || "0");
      const acqCosts = parseFloat(r.acquisitionCosts || "0");
      const improvements = parseFloat(r.improvementCosts || "0");
      const adjBasis = parseFloat(r.adjustedBasis || "0");
      const gainLoss = parseFloat(r.gainLoss || "0");
      const holdingPeriod = this.determineHoldingPeriodFromDate(r.acquisitionDate);

      summary.totalAcquisitionCost += acqPrice + acqCosts;
      summary.totalAdjustedBasis += adjBasis;
      summary.totalImprovements += improvements;

      if (r.dispositionDate) {
        if (gainLoss >= 0) summary.totalRealizedGains += gainLoss;
        else summary.totalRealizedLosses += Math.abs(gainLoss);
      }

      if (holdingPeriod === "long") summary.longTermCount++;
      else summary.shortTermCount++;

      return {
        propertyId: r.propertyId,
        acquisitionDate: r.acquisitionDate,
        acquisitionPrice: acqPrice,
        acquisitionCosts: acqCosts,
        improvements,
        adjustedBasis: adjBasis,
        dispositionDate: r.dispositionDate,
        dispositionPrice: r.dispositionPrice ? parseFloat(r.dispositionPrice) : null,
        gainLoss: r.dispositionDate ? gainLoss : null,
        holdingPeriod,
        status: r.dispositionDate ? "disposed" : "active",
      };
    });

    // Round summary numbers
    for (const key of Object.keys(summary) as Array<keyof typeof summary>) {
      if (typeof summary[key] === "number") {
        summary[key] = Math.round(summary[key] * 100) / 100;
      }
    }

    return { orgId, generatedAt: new Date(), summary, properties: detailed };
  }
}

export const costBasisTracker = new CostBasisTracker();
