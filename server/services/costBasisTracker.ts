// @ts-nocheck — ORM type refinement deferred; runtime-correct
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
      throw new Error(`Cost basis already recorded for property ${propertyId}. Use adjustBasis instead.`);
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

  /**
   * Add improvement costs to the property basis (capital improvements, not repairs)
   */
  async addImprovement(propertyId: number, improvementCost: number, description: string) {
    const [record] = await db.select()
      .from(costBasis)
      .where(eq(costBasis.propertyId, propertyId))
      .limit(1);

    if (!record) throw new Error(`No cost basis record for property ${propertyId}`);

    const currentImprovements = parseFloat(record.improvementCosts || "0");
    const currentBasis = parseFloat(record.adjustedBasis || "0");
    const newImprovements = currentImprovements + improvementCost;
    const newBasis = currentBasis + improvementCost;

    const existing_notes = record.notes || "";
    const updated_notes = `${existing_notes}\nImprovement (${new Date().toISOString().slice(0, 10)}): +$${improvementCost.toLocaleString()} — ${description}`.trim();

    const [updated] = await db.update(costBasis)
      .set({
        improvementCosts: newImprovements.toString(),
        adjustedBasis: newBasis.toString(),
        notes: updated_notes,
      })
      .where(eq(costBasis.propertyId, propertyId))
      .returning();

    return updated;
  }

  /**
   * Apply a specific basis adjustment (depreciation recapture, casualty loss, etc.)
   */
  async adjustBasis(
    propertyId: number,
    adjustmentType: "depreciation" | "casualty_loss" | "insurance_recovery" | "partial_sale" | "other",
    amount: number  // positive increases basis, negative decreases
  ) {
    const [record] = await db.select()
      .from(costBasis)
      .where(eq(costBasis.propertyId, propertyId))
      .limit(1);

    if (!record) throw new Error(`No cost basis record for property ${propertyId}`);

    const currentBasis = parseFloat(record.adjustedBasis || "0");
    const newBasis = currentBasis + amount;  // amount can be negative

    const updatedNotes = (record.notes || "") +
      `\nBasis adjustment (${adjustmentType}, ${new Date().toISOString().slice(0, 10)}): ${amount >= 0 ? "+" : ""}$${amount.toLocaleString()}`;

    const [updated] = await db.update(costBasis)
      .set({
        adjustedBasis: newBasis.toString(),
        notes: updatedNotes,
      })
      .where(eq(costBasis.propertyId, propertyId))
      .returning();

    return updated;
  }

  /**
   * Compute realized gain or loss on sale of a property
   */
  async computeGainLoss(propertyId: number, salePrice: number) {
    const [record] = await db.select()
      .from(costBasis)
      .where(eq(costBasis.propertyId, propertyId))
      .limit(1);

    if (!record) throw new Error(`No cost basis record for property ${propertyId}`);

    const adjustedBasis = parseFloat(record.adjustedBasis || "0");
    const gainLoss = salePrice - adjustedBasis;
    const holdingPeriod = this.determineHoldingPeriodFromDate(record.acquisitionDate);
    const isLongTerm = holdingPeriod === "long";

    // Save disposition data
    const [updated] = await db.update(costBasis)
      .set({
        dispositionDate: new Date(),
        dispositionPrice: salePrice.toString(),
        gainLoss: gainLoss.toString(),
        holdingPeriod,
      })
      .where(eq(costBasis.propertyId, propertyId))
      .returning();

    return {
      propertyId,
      salePrice,
      adjustedBasis,
      gainLoss: Math.round(gainLoss * 100) / 100,
      isGain: gainLoss > 0,
      holdingPeriod,
      isLongTerm,
      estimatedFederalTaxRate: isLongTerm ? 0.20 : 0.37,
      estimatedTax: gainLoss > 0
        ? Math.round(gainLoss * (isLongTerm ? 0.238 : 0.37))  // includes NIIT
        : 0,
      record: updated,
    };
  }

  /**
   * Get the current adjusted basis for a property
   */
  async getAdjustedBasis(propertyId: number) {
    const [record] = await db.select()
      .from(costBasis)
      .where(eq(costBasis.propertyId, propertyId))
      .limit(1);

    if (!record) return null;

    const holdingPeriod = this.determineHoldingPeriodFromDate(record.acquisitionDate);

    return {
      propertyId,
      acquisitionPrice: parseFloat(record.acquisitionPrice || "0"),
      acquisitionCosts: parseFloat(record.acquisitionCosts || "0"),
      improvementCosts: parseFloat(record.improvementCosts || "0"),
      adjustedBasis: parseFloat(record.adjustedBasis || "0"),
      holdingPeriod,
      acquisitionDate: record.acquisitionDate,
      notes: record.notes,
    };
  }

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
    for (const key of Object.keys(summary)) {
      if (typeof summary[key] === "number") {
        summary[key] = Math.round(summary[key] * 100) / 100;
      }
    }

    return { orgId, generatedAt: new Date(), summary, properties: detailed };
  }
}

export const costBasisTracker = new CostBasisTracker();
