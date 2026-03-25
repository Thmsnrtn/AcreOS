/**
 * Data Portability + Transparency — full data export, AI reasoning,
 * and contribution reporting.
 */

import { db } from "../db";
import { leads, deals, properties, notes, campaigns } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

// ── Full Data Export ────────────────────────────────────────────────

export interface DataExport {
  exportedAt: string;
  orgId: number;
  format: "json";
  sections: {
    leads: any[];
    deals: any[];
    properties: any[];
    notes: any[];
    campaigns: any[];
  };
  metadata: {
    totalRecords: number;
    exportVersion: string;
  };
}

export async function generateFullExport(orgId: number): Promise<DataExport> {
  const [orgLeads, orgDeals, orgProperties, orgNotes, orgCampaigns] = await Promise.all([
    db.select().from(leads).where(eq(leads.organizationId, orgId)).limit(10000),
    db.select().from(deals).where(eq(deals.organizationId, orgId)).limit(10000),
    db.select().from(properties).where(eq(properties.organizationId, orgId)).limit(10000),
    db.select().from(notes).where(eq(notes.organizationId, orgId)).limit(10000),
    db.select().from(campaigns).where(eq(campaigns.organizationId, orgId)).limit(1000),
  ]);

  const totalRecords = orgLeads.length + orgDeals.length + orgProperties.length + orgNotes.length + orgCampaigns.length;

  logger.info("Full data export generated", { orgId, totalRecords });

  return {
    exportedAt: new Date().toISOString(),
    orgId,
    format: "json",
    sections: {
      leads: orgLeads,
      deals: orgDeals,
      properties: orgProperties,
      notes: orgNotes,
      campaigns: orgCampaigns,
    },
    metadata: {
      totalRecords,
      exportVersion: "1.0",
    },
  };
}

// ── AI Reasoning Transparency ───────────────────────────────────────

export interface AIReasoningEntry {
  id: string;
  feature: string;
  decision: string;
  reasoning: string;
  inputs: Record<string, any>;
  confidence: number;
  timestamp: string;
}

export function buildAIReasoningExplanation(
  feature: string,
  decision: string,
  inputs: Record<string, any>,
  confidence: number
): AIReasoningEntry {
  const reasoning = generateReasoning(feature, inputs, confidence);

  return {
    id: `air_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    feature,
    decision,
    reasoning,
    inputs,
    confidence,
    timestamp: new Date().toISOString(),
  };
}

function generateReasoning(feature: string, inputs: Record<string, any>, confidence: number): string {
  switch (feature) {
    case "lcs":
      return `Land Credit Score computed from ${Object.keys(inputs).length} factors. Location score weighted at ${inputs.locationWeight || 25}%, physical at ${inputs.physicalWeight || 20}%. Confidence ${confidence}% based on ${inputs.comparableCount || 0} comparable data points.`;
    case "offer":
      return `Offer amount recommended based on ${inputs.comparableCount || 0} comparable sales, ${inputs.marketTrend || "stable"} market conditions, and desirability score of ${inputs.desirabilityScore || "N/A"}/100.`;
    case "intent":
      return `Seller intent score of ${inputs.score || 0}/100 derived from ${inputs.signalCount || 0} behavioral signals: urgency (${inputs.urgency || 0}%), engagement (${inputs.engagement || 0}%), price flexibility (${inputs.priceFlexibility || 0}%).`;
    case "disposition":
      return `Disposition strategy recommended based on ${inputs.acres || 0} acres, purchase price of $${inputs.buyPrice?.toLocaleString() || 0}, and ${inputs.hasUtilities ? "available" : "unavailable"} utilities.`;
    default:
      return `Decision made with ${confidence}% confidence using ${Object.keys(inputs).length} input factors.`;
  }
}

// ── Contribution Reporting ──────────────────────────────────────────

export interface ContributionReport {
  orgId: number;
  generatedAt: string;
  dataContributed: {
    properties: number;
    deals: number;
    marketData: number;
  };
  dataConsumed: {
    compsLookups: number;
    enrichmentCalls: number;
    aiGenerations: number;
  };
  netContribution: "positive" | "neutral" | "negative";
  impactScore: number;
}

export async function generateContributionReport(orgId: number): Promise<ContributionReport> {
  const [propCount] = await db.select({ cnt: leads.id }).from(properties)
    .where(eq(properties.organizationId, orgId));
  const [dealCount] = await db.select({ cnt: deals.id }).from(deals)
    .where(eq(deals.organizationId, orgId));

  const propertiesContributed = Number((propCount as any)?.cnt || 0) ? 1 : 0;
  const dealsContributed = Number((dealCount as any)?.cnt || 0) ? 1 : 0;

  // Simplified — real implementation would track API usage
  const contributed = propertiesContributed + dealsContributed;
  const netContribution = contributed >= 2 ? "positive" : contributed === 1 ? "neutral" : "negative";

  return {
    orgId,
    generatedAt: new Date().toISOString(),
    dataContributed: {
      properties: propertiesContributed,
      deals: dealsContributed,
      marketData: 0,
    },
    dataConsumed: {
      compsLookups: 0,
      enrichmentCalls: 0,
      aiGenerations: 0,
    },
    netContribution,
    impactScore: contributed * 50,
  };
}
