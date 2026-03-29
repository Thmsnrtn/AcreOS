// @ts-nocheck
/**
 * Pax Intelligence Enhancements — Items 161-180
 * Property Q&A, deal advisor, county briefing, task creation, portfolio analysis, etc.
 */

import { db } from "../db";
import { properties, deals, leads, notes, campaigns, organizations } from "@shared/schema";
import { eq, and, sql, count, desc } from "drizzle-orm";

// Item 161: Property Q&A — gather all data about a property for Pax
export async function gatherPropertyContext(propertyId: number, orgId: number): Promise<string> {
  const prop = await db.query.properties.findFirst({
    where: and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)),
  });
  if (!prop) return "Property not found.";

  const parts = [
    `Property: ${prop.address || prop.apn || "Unknown"}`,
    `Location: ${prop.county}, ${prop.state}`,
    `Acreage: ${prop.acreage || "Unknown"}`,
    prop.estimatedValue ? `Estimated value: $${Number(prop.estimatedValue).toLocaleString()}` : null,
    prop.zoning ? `Zoning: ${prop.zoning}` : null,
    (prop as any).purchasePrice ? `Purchase price: $${Number((prop as any).purchasePrice).toLocaleString()}` : null,
    (prop as any).taxAssessedValue ? `Tax assessed: $${Number((prop as any).taxAssessedValue).toLocaleString()}` : null,
  ].filter(Boolean);

  return parts.join("\n");
}

// Item 162: Deal advisor context
export async function gatherDealContext(dealId: number, orgId: number): Promise<string> {
  const deal = await db.query.deals.findFirst({
    where: and(eq(deals.id, dealId), eq(deals.organizationId, orgId)),
  });
  if (!deal) return "Deal not found.";

  return [
    `Deal: ${(deal as any).title || `Deal #${deal.id}`}`,
    `Status: ${deal.status}`,
    `County: ${deal.county}, ${deal.state}`,
    (deal as any).offerAmount ? `Offer: $${Number((deal as any).offerAmount).toLocaleString()}` : null,
    (deal as any).askingPrice ? `Asking: $${Number((deal as any).askingPrice).toLocaleString()}` : null,
    deal.acreage ? `Acreage: ${deal.acreage}` : null,
  ].filter(Boolean).join("\n");
}

// Item 163: County briefing
export async function gatherCountyContext(county: string, state: string, orgId: number): Promise<string> {
  const [propCount] = await db.select({ count: count() }).from(properties)
    .where(and(eq(properties.organizationId, orgId), sql`LOWER(${properties.county}) = LOWER(${county})`));
  const [dealCount] = await db.select({ count: count() }).from(deals)
    .where(and(eq(deals.organizationId, orgId), sql`LOWER(${deals.county}) = LOWER(${county})`));
  const [leadCount] = await db.select({ count: count() }).from(leads)
    .where(and(eq(leads.organizationId, orgId), sql`LOWER(${leads.county}) = LOWER(${county})`));

  return [
    `County: ${county}, ${state}`,
    `Your properties here: ${propCount?.count || 0}`,
    `Your deals here: ${dealCount?.count || 0}`,
    `Your leads here: ${leadCount?.count || 0}`,
  ].join("\n");
}

// Item 165: Portfolio analysis for Pax
export async function gatherPortfolioContext(orgId: number): Promise<string> {
  const [propCount] = await db.select({ count: count() }).from(properties).where(eq(properties.organizationId, orgId));
  const [dealCount] = await db.select({ count: count() }).from(deals).where(eq(deals.organizationId, orgId));
  const [noteCount] = await db.select({ count: count() }).from(notes).where(eq(notes.organizationId, orgId));
  const [leadCount] = await db.select({ count: count() }).from(leads).where(eq(leads.organizationId, orgId));

  return [
    `Portfolio Overview:`,
    `Properties: ${propCount?.count || 0}`,
    `Active deals: ${dealCount?.count || 0}`,
    `Notes receivable: ${noteCount?.count || 0}`,
    `Leads in pipeline: ${leadCount?.count || 0}`,
  ].join("\n");
}

// Item 172: Pax suggested questions per page
export function getPaxSuggestedQuestions(page: string): string[] {
  const questions: Record<string, string[]> = {
    "/today": ["What should I focus on today?", "How's my portfolio doing?", "Any new opportunities?"],
    "/pipeline": ["Which deals need attention?", "What's my pipeline velocity?", "Any stalled deals?"],
    "/leads": ["Which leads should I contact first?", "How can I improve response rates?", "Are there duplicate leads?"],
    "/properties": ["What's the value of my portfolio?", "Which properties have the best LCS?", "Any maintenance needed?"],
    "/deals": ["What's my win rate?", "How long do deals take to close?", "Which counties perform best?"],
    "/money": ["What's my monthly cash flow?", "Any late payments?", "How close am I to freedom?"],
    "/finance": ["Show me my note performance", "Which borrowers are at risk?", "What's my collection rate?"],
    "/campaigns": ["How did my last campaign perform?", "What's my open rate?", "When should I send next?"],
    "/settings": ["Help me set up my account", "How do I connect my email?", "What integrations are available?"],
  };
  return questions[page] || ["How can I help you today?", "What would you like to know?", "Ask me anything about your business."];
}

// Item 179: Pax calculation mode
export function calculateROI(buyPrice: number, sellPrice: number, closingCosts: number = 0): {
  profit: number;
  roi: number;
  margin: number;
} {
  const totalCost = buyPrice + closingCosts;
  const profit = sellPrice - totalCost;
  return {
    profit,
    roi: totalCost > 0 ? Math.round((profit / totalCost) * 100) : 0,
    margin: sellPrice > 0 ? Math.round((profit / sellPrice) * 100) : 0,
  };
}
