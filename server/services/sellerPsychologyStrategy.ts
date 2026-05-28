/**
 * Seller Psychology → Negotiation Strategy
 *
 * Bridges seller intent predictions (motivation, urgency, emotional state)
 * into concrete negotiation strategy selection, offer tier recommendations,
 * and Deal Feed motivation signals.
 */

import { db } from "../db";
import { sellerIntentPredictions, leads, deals, properties } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { logger } from "../utils/logger";

// ── Types ───────────────────────────────────────────────────────────

type NegotiationStrategy = "empathy" | "logic" | "urgency" | "anchor" | "silence";

export interface MotivationProfile {
  leadId: number;
  intentScore: number;
  intentLevel: string;
  primaryMotivation: string | null;
  lifeEvent: string | null;
  urgencyLevel: "high" | "medium" | "low";
  priceFlexibility: "high" | "medium" | "low";
  emotionalAttachment: "high" | "medium" | "low";
}

export interface StrategySelection {
  primaryStrategy: NegotiationStrategy;
  secondaryStrategy: NegotiationStrategy;
  reasoning: string;
  openingApproach: string;
  avoidStrategies: NegotiationStrategy[];
  talkingPoints: string[];
}

export interface OfferTierRecommendation {
  tier: "aggressive" | "standard" | "competitive";
  percentOfMarket: number;
  reasoning: string;
  adjustmentFactors: { factor: string; impact: number; explanation: string }[];
}

export interface DealFeedMotivationSignal {
  leadId: number;
  dealId?: number;
  motivationLabel: string;
  motivationColor: "green" | "yellow" | "red";
  shortDescription: string;
  suggestedAction: string;
}

// ── Build Motivation Profile ────────────────────────────────────────

export async function buildMotivationProfile(
  orgId: number,
  leadId: number
): Promise<MotivationProfile | null> {
  const [prediction] = await db.select()
    .from(sellerIntentPredictions)
    .where(and(
      eq(sellerIntentPredictions.leadId, leadId),
      eq(sellerIntentPredictions.organizationId, orgId),
    ))
    .orderBy(desc(sellerIntentPredictions.createdAt))
    .limit(1);

  if (!prediction) return null;

  const signals = (prediction.signals as any) || {};
  const urgencyScore = signals.urgency?.score ?? 0;
  const emotionalScore = signals.emotional?.score ?? 0;
  const priceFlexScore = signals.priceFlexibility?.score ?? 0;
  const lifeEvent = signals.emotional?.lifeEvent || null;

  return {
    leadId,
    intentScore: prediction.intentScore,
    intentLevel: prediction.intentLevel,
    primaryMotivation: prediction.recommendedApproach || null,
    lifeEvent,
    urgencyLevel: urgencyScore >= 70 ? "high" : urgencyScore >= 40 ? "medium" : "low",
    priceFlexibility: priceFlexScore >= 60 ? "high" : priceFlexScore >= 30 ? "medium" : "low",
    emotionalAttachment: emotionalScore >= 60 ? "high" : emotionalScore >= 30 ? "medium" : "low",
  };
}

// ── Strategy Selection ──────────────────────────────────────────────

export function selectNegotiationStrategy(profile: MotivationProfile): StrategySelection {
  let primary: NegotiationStrategy = "empathy";
  let secondary: NegotiationStrategy = "logic";
  const avoid: NegotiationStrategy[] = [];
  const talkingPoints: string[] = [];
  let reasoning = "";
  let openingApproach = "";

  // High emotional attachment → lead with empathy, never use urgency
  if (profile.emotionalAttachment === "high") {
    primary = "empathy";
    secondary = "silence";
    avoid.push("urgency");
    reasoning = "Seller has strong emotional connection to the property. Lead with understanding.";
    openingApproach = "Acknowledge the property's personal significance before discussing numbers.";
    talkingPoints.push("Ask about the property's history and what it means to them");
    talkingPoints.push("Validate their feelings before transitioning to business");

    if (profile.lifeEvent === "inheritance") {
      talkingPoints.push("Be sensitive about the loss — this land represents a loved one");
    } else if (profile.lifeEvent === "divorce") {
      talkingPoints.push("Keep the conversation straightforward — avoid mentioning family");
    }
  }
  // High urgency + high price flexibility → anchor low, move fast
  else if (profile.urgencyLevel === "high" && profile.priceFlexibility === "high") {
    primary = "anchor";
    secondary = "urgency";
    reasoning = "Seller is motivated and price-flexible. Anchor at a strong position and emphasize speed.";
    openingApproach = "Lead with your ability to close fast. Present a firm initial offer.";
    talkingPoints.push("Emphasize cash offer and quick closing timeline");
    talkingPoints.push("Mention your track record of closing on schedule");
  }
  // High urgency + low price flexibility → logic with urgency
  else if (profile.urgencyLevel === "high" && profile.priceFlexibility === "low") {
    primary = "logic";
    secondary = "urgency";
    reasoning = "Seller needs to sell but has firm price expectations. Use data to justify your offer.";
    openingApproach = "Lead with market comparables and data. Show them the reality.";
    talkingPoints.push("Present comparable sales data to support your offer");
    talkingPoints.push("Highlight market conditions that favor acting now");
    avoid.push("silence"); // they need action, not waiting
  }
  // Low urgency → patience and logic
  else if (profile.urgencyLevel === "low") {
    primary = "logic";
    secondary = "silence";
    avoid.push("urgency");
    reasoning = "Seller is not in a rush. Build the case logically and give them time.";
    openingApproach = "Present a well-researched offer with supporting data. No pressure.";
    talkingPoints.push("Provide thorough market analysis");
    talkingPoints.push("Offer to answer questions at their pace");
  }
  // Default: standard approach
  else {
    primary = "empathy";
    secondary = "logic";
    reasoning = "Balanced motivation. Build rapport first, then use data.";
    openingApproach = "Warm introduction, then transition to a fair offer backed by data.";
    talkingPoints.push("Introduce yourself and your company briefly");
    talkingPoints.push("Transition naturally from rapport to business");
  }

  // Life event adjustments
  if (profile.lifeEvent === "financial_distress") {
    talkingPoints.push("Be compassionate about their situation — offer is a lifeline, not a lowball");
    if (!avoid.includes("urgency")) {
      secondary = "urgency";
    }
  } else if (profile.lifeEvent === "retirement") {
    talkingPoints.push("Frame the sale as funding their next chapter");
  }

  // Intent score adjustments
  if (profile.intentScore >= 80) {
    talkingPoints.push("High seller motivation detected — maintain your position");
  } else if (profile.intentScore <= 30) {
    talkingPoints.push("Low motivation — consider whether this lead is worth pursuing now");
  }

  return {
    primaryStrategy: primary,
    secondaryStrategy: secondary,
    reasoning,
    openingApproach,
    avoidStrategies: avoid,
    talkingPoints,
  };
}

// ── Offer Tier Recommendation ───────────────────────────────────────

export function recommendOfferTier(profile: MotivationProfile): OfferTierRecommendation {
  const factors: { factor: string; impact: number; explanation: string }[] = [];
  let basePercent = 55; // default: 55% of market value

  // Urgency adjustments
  if (profile.urgencyLevel === "high") {
    factors.push({ factor: "High urgency", impact: -5, explanation: "Seller needs to move fast — lower offer more likely accepted" });
    basePercent -= 5;
  } else if (profile.urgencyLevel === "low") {
    factors.push({ factor: "Low urgency", impact: +5, explanation: "Seller can wait — need a more competitive offer" });
    basePercent += 5;
  }

  // Price flexibility
  if (profile.priceFlexibility === "high") {
    factors.push({ factor: "Price flexible", impact: -3, explanation: "Seller has shown willingness to negotiate on price" });
    basePercent -= 3;
  } else if (profile.priceFlexibility === "low") {
    factors.push({ factor: "Price firm", impact: +5, explanation: "Seller has firm price expectations" });
    basePercent += 5;
  }

  // Emotional attachment
  if (profile.emotionalAttachment === "high") {
    factors.push({ factor: "Emotional attachment", impact: +3, explanation: "Seller needs to feel the property is valued" });
    basePercent += 3;
  }

  // Life events
  if (profile.lifeEvent === "financial_distress") {
    factors.push({ factor: "Financial distress", impact: -5, explanation: "Seller may accept lower offers due to financial pressure" });
    basePercent -= 5;
  } else if (profile.lifeEvent === "inheritance") {
    factors.push({ factor: "Inherited property", impact: -2, explanation: "Inherited properties often have less price anchoring" });
    basePercent -= 2;
  }

  // Intent score
  if (profile.intentScore >= 75) {
    factors.push({ factor: "High intent score", impact: -3, explanation: "Strong signals of willingness to sell" });
    basePercent -= 3;
  } else if (profile.intentScore <= 35) {
    factors.push({ factor: "Low intent score", impact: +5, explanation: "Seller may not be serious — need compelling offer" });
    basePercent += 5;
  }

  // Clamp
  basePercent = Math.max(40, Math.min(75, basePercent));

  let tier: "aggressive" | "standard" | "competitive";
  if (basePercent <= 48) tier = "aggressive";
  else if (basePercent <= 58) tier = "standard";
  else tier = "competitive";

  return {
    tier,
    percentOfMarket: basePercent,
    reasoning: `Based on seller's ${profile.urgencyLevel} urgency, ${profile.priceFlexibility} price flexibility, and ${profile.emotionalAttachment} emotional attachment.`,
    adjustmentFactors: factors,
  };
}

// ── Deal Feed Motivation Signals ────────────────────────────────────

export async function getDealFeedMotivationSignals(
  orgId: number,
  dealIds: number[]
): Promise<DealFeedMotivationSignal[]> {
  const signals: DealFeedMotivationSignal[] = [];

  for (const dealId of dealIds) {
    // deals has no leadId; the seller lead lives on the linked property.
    const [deal] = await db.select({ leadId: properties.sellerId, id: deals.id })
      .from(deals)
      .innerJoin(properties, eq(deals.propertyId, properties.id))
      .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)))
      .limit(1);

    if (!deal?.leadId) continue;

    const profile = await buildMotivationProfile(orgId, deal.leadId);
    if (!profile) continue;

    let label: string;
    let color: "green" | "yellow" | "red";
    let shortDesc: string;
    let action: string;

    if (profile.intentScore >= 70) {
      label = "Motivated Seller";
      color = "green";
      shortDesc = profile.lifeEvent
        ? `${profile.lifeEvent.replace(/_/g, " ")} — likely to accept`
        : "Strong intent signals detected";
      action = "Move fast — send offer today";
    } else if (profile.intentScore >= 40) {
      label = "Warm Seller";
      color = "yellow";
      shortDesc = "Moderate motivation — may need nurturing";
      action = "Follow up with market data and a fair offer";
    } else {
      label = "Cold Seller";
      color = "red";
      shortDesc = "Low intent — may not be ready to sell";
      action = "Add to drip campaign and revisit in 30 days";
    }

    signals.push({
      leadId: deal.leadId,
      dealId,
      motivationLabel: label,
      motivationColor: color,
      shortDescription: shortDesc,
      suggestedAction: action,
    });
  }

  return signals;
}
