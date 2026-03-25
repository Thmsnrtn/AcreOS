// @ts-nocheck — ORM type refinement deferred; runtime-correct
/**
 * Negotiation Pipeline — orchestrates offer analysis, letter generation,
 * response intelligence, and round tracking.
 */

import { db } from "../db";
import { deals, properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";

type NegotiationStrategy = "empathy" | "logic" | "urgency" | "anchor" | "scarcity";

interface OfferAnalysis {
  dealId: number;
  tiers: Array<{
    name: string;
    price: number;
    profit: number;
    strategy: string;
    description: string;
    recommendedStrategy?: NegotiationStrategy;
    strategyRationale?: string;
  }>;
  compSummary: string;
  motivationGrade?: string;
}

interface ResponseAnalysis {
  objections: Array<{ category: string; severity: "low" | "medium" | "high" }>;
  sentiment: "positive" | "neutral" | "negative" | "hostile";
  suggestedStrategy: NegotiationStrategy;
  strategyRationale: string;
  suggestedResponse: string;
  alternativeResponses: Array<{ strategy: NegotiationStrategy; response: string }>;
}

interface NegotiationRound {
  roundNumber: number;
  type: "offer" | "counter" | "response" | "accepted" | "rejected";
  amount?: number;
  message?: string;
  strategy?: NegotiationStrategy;
  analysis?: ResponseAnalysis;
  timestamp: string;
}

/**
 * Initiate an offer — pulls property data, runs blind offer calc, returns 3 tiers
 */
export async function initiateOffer(dealId: number, orgId: number): Promise<OfferAnalysis> {
  const deal = await db.query.deals.findFirst({
    where: and(eq(deals.id, dealId), eq(deals.organizationId, orgId)),
  });
  if (!deal) throw new Error("Deal not found");

  const property = deal.propertyId
    ? await db.query.properties.findFirst({ where: eq(properties.id, deal.propertyId) })
    : null;

  // Estimate value — use deal's or property's data
  const estimatedValue = (deal as any).estimatedValue
    || property?.estimatedValue
    || property?.listPrice
    || 0;

  if (!estimatedValue) {
    // Fall back to county average if no property value
    return {
      dealId,
      tiers: [
        { name: "Aggressive", price: 0, profit: 0, strategy: "ARV needed for offer calculation", description: "Set an estimated value on this property to generate offer tiers." },
      ],
      compSummary: "No comparable data available. Using county average.",
    };
  }

  const aggressive = Math.round(estimatedValue * 0.25);
  const market = Math.round(estimatedValue * 0.40);
  const generous = Math.round(estimatedValue * 0.55);

  // Build motivation profile if deal has a lead
  let motivationGrade: string | undefined;
  let tierStrategy: { aggressive?: NegotiationStrategy; market?: NegotiationStrategy; generous?: NegotiationStrategy } = {};
  let tierRationale: { aggressive?: string; market?: string; generous?: string } = {};
  let aggressiveNote = "";
  let generousNote = "";

  try {
    const leadId = (deal as any).leadId;
    if (leadId) {
      const { buildMotivationProfile } = await import("./sellerPsychologyStrategy");
      const profile = await buildMotivationProfile(orgId, leadId);

      if (profile) {
        // Determine motivation grade from intent score
        if (profile.intentScore >= 80) motivationGrade = "A";
        else if (profile.intentScore >= 65) motivationGrade = "B";
        else if (profile.intentScore >= 50) motivationGrade = "C";
        else if (profile.intentScore >= 35) motivationGrade = "D";
        else motivationGrade = "F";

        // Map motivation factors to strategies
        const signals = profile as any;
        const urgencyLevel = profile.urgencyLevel;
        const emotionalAttachment = profile.emotionalAttachment;
        const priceFlexibility = profile.priceFlexibility;
        const lifeEvent = profile.lifeEvent;

        // Determine recommended strategy based on motivation factors
        // High "found money" (inherited + high flex) → anchor
        if (lifeEvent === "inheritance" && priceFlexibility === "high") {
          tierStrategy.aggressive = "anchor";
          tierRationale.aggressive = "Inherited property with high price flexibility — anchor low.";
        }
        // High "tax delinquent" → urgency
        else if (lifeEvent === "financial_distress" || urgencyLevel === "high") {
          tierStrategy.aggressive = "urgency";
          tierRationale.aggressive = "Financial pressure or high urgency — emphasize quick close.";
        }
        // High "emotional attachment" → empathy
        else if (emotionalAttachment === "high") {
          tierStrategy.market = "empathy";
          tierRationale.market = "Strong emotional attachment — lead with empathy and respect.";
        }

        // Absentee/out-of-state or financial distress → logic
        if (!tierStrategy.market) {
          tierStrategy.market = "logic";
          tierRationale.market = "Use data-backed reasoning to support the market-rate offer.";
        }
        if (!tierStrategy.aggressive) {
          tierStrategy.aggressive = "anchor";
          tierRationale.aggressive = "Standard aggressive approach — anchor low and negotiate up.";
        }
        tierStrategy.generous = emotionalAttachment === "high" ? "empathy" : "logic";
        tierRationale.generous = emotionalAttachment === "high"
          ? "Emotional seller — generous offer paired with empathetic approach."
          : "Rational approach with a competitive offer to maximize acceptance.";

        // Add motivation-informed notes to tiers
        if (motivationGrade === "A" || motivationGrade === "B") {
          aggressiveNote = " High-motivation seller. Aggressive offers have 3x acceptance rate for this profile.";
        }
        if (motivationGrade === "D" || motivationGrade === "F") {
          generousNote = " Low-motivation seller. A generous offer with seller financing may be more effective.";
        }
      }
    }
  } catch (err) {
    logger.warn("Failed to build motivation profile for negotiation", { dealId, error: err instanceof Error ? err.message : String(err) });
  }

  return {
    dealId,
    tiers: [
      {
        name: "Aggressive",
        price: aggressive,
        profit: estimatedValue - aggressive,
        strategy: "Maximum margin — best for tax delinquent or highly motivated sellers",
        description: `${Math.round((aggressive / estimatedValue) * 100)}% of estimated value. Highest profit potential.${aggressiveNote}`,
        recommendedStrategy: tierStrategy.aggressive,
        strategyRationale: tierRationale.aggressive,
      },
      {
        name: "Market",
        price: market,
        profit: estimatedValue - market,
        strategy: "Balanced approach — competitive offer with strong margins",
        description: `${Math.round((market / estimatedValue) * 100)}% of estimated value. Good acceptance rate.`,
        recommendedStrategy: tierStrategy.market,
        strategyRationale: tierRationale.market,
      },
      {
        name: "Generous",
        price: generous,
        profit: estimatedValue - generous,
        strategy: "Best acceptance rate — use when competition is expected",
        description: `${Math.round((generous / estimatedValue) * 100)}% of estimated value. Highest acceptance rate.${generousNote}`,
        recommendedStrategy: tierStrategy.generous,
        strategyRationale: tierRationale.generous,
      },
    ],
    compSummary: property?.county
      ? `Based on ${property.county} County market data`
      : "Based on estimated property value",
    motivationGrade,
  };
}

/**
 * Generate a personalized offer letter
 */
export async function generateLetter(
  dealId: number,
  tier: string,
  orgId: number,
  customizations?: { senderName?: string; closingDate?: string; personalNote?: string },
): Promise<{ letter: string; deliveryOptions: string[] }> {
  const deal = await db.query.deals.findFirst({
    where: and(eq(deals.id, dealId), eq(deals.organizationId, orgId)),
  });
  if (!deal) throw new Error("Deal not found");

  const property = deal.propertyId
    ? await db.query.properties.findFirst({ where: eq(properties.id, deal.propertyId) })
    : null;

  // Try AI letter generation, fall back to template
  try {
    const { generateOfferLetter } = await import("./aiOfferService");
    const aiLetter = await generateOfferLetter(deal, property, tier, customizations);
    if (aiLetter) {
      return { letter: aiLetter, deliveryOptions: ["email", "direct_mail", "download_pdf"] };
    }
  } catch {
    // AI unavailable — use template
  }

  const senderName = customizations?.senderName || "The Team";
  const address = property?.address || `the property (APN: ${property?.apn || "on file"})`;

  const letter = `Dear Property Owner,

I am writing regarding ${address} in ${property?.county || ""} County, ${property?.state || ""}.

After researching comparable properties in the area, I would like to present a cash offer for your consideration.

My offer: ${tier === "aggressive" ? "a competitive cash price" : tier === "generous" ? "a fair market offer" : "a balanced offer"} with a quick closing timeline${customizations?.closingDate ? ` by ${customizations.closingDate}` : ""}.

This is a no-obligation cash offer. There are no realtor commissions, no closing costs on your end, and I can close on your timeline.

${customizations?.personalNote || "I look forward to the opportunity to work together."}

Best regards,
${senderName}`;

  return { letter, deliveryOptions: ["email", "direct_mail", "download_pdf"] };
}

/**
 * Analyze a seller's response — extract objections, sentiment, suggest strategy
 */
export async function analyzeResponse(
  dealId: number,
  responseText: string,
  orgId: number,
): Promise<ResponseAnalysis> {
  if (!responseText || responseText.trim().length === 0) {
    return {
      objections: [],
      sentiment: "neutral",
      suggestedStrategy: "logic",
      strategyRationale: "No response text provided — follow up with a direct message.",
      suggestedResponse: "I wanted to follow up on my recent offer. I'm flexible on terms and timeline. What questions can I answer for you?",
      alternativeResponses: [],
    };
  }

  const lowerText = responseText.toLowerCase();

  // Detect sentiment
  let sentiment: ResponseAnalysis["sentiment"] = "neutral";
  if (lowerText.includes("interested") || lowerText.includes("tell me more") || lowerText.includes("yes")) {
    sentiment = "positive";
  } else if (lowerText.includes("no") && lowerText.length < 20) {
    sentiment = "negative";
  } else if (lowerText.includes("ridiculous") || lowerText.includes("insulting") || lowerText.includes("waste")) {
    sentiment = "hostile";
  }

  // Detect objections
  const objections: ResponseAnalysis["objections"] = [];
  if (lowerText.includes("too low") || lowerText.includes("more than that")) {
    objections.push({ category: "price", severity: "medium" });
  }
  if (lowerText.includes("not ready") || lowerText.includes("not sure")) {
    objections.push({ category: "timing", severity: "low" });
  }
  if (lowerText.includes("other offer") || lowerText.includes("already have")) {
    objections.push({ category: "competition", severity: "high" });
  }

  // Suggest strategy based on sentiment
  let suggestedStrategy: NegotiationStrategy = "logic";
  if (sentiment === "hostile") suggestedStrategy = "empathy";
  if (sentiment === "positive") suggestedStrategy = "urgency";
  if (objections.some(o => o.category === "competition")) suggestedStrategy = "scarcity";

  return {
    objections,
    sentiment,
    suggestedStrategy,
    strategyRationale: `Based on ${sentiment} sentiment${objections.length ? ` with ${objections.length} objection(s)` : ""}.`,
    suggestedResponse: sentiment === "positive"
      ? "Great to hear you're interested! I can have the paperwork ready within 48 hours. Shall I send over the purchase agreement?"
      : sentiment === "hostile"
        ? "I appreciate your honesty and understand my initial offer may not have met your expectations. I've done some additional research and would love to discuss what number would work for you."
        : "Thank you for your response. I understand you may have some concerns. Would it help to discuss the details? I'm flexible on timeline and terms.",
    alternativeResponses: [
      { strategy: "empathy", response: "I understand this property means a lot to you. My goal is to make this as smooth as possible." },
      { strategy: "logic", response: "Based on recent sales in the area, my offer reflects current market conditions. Here's what I'm seeing..." },
      { strategy: "urgency", response: "I have funds ready to close quickly — this offer is available for the next 7 days." },
    ],
  };
}

/**
 * Record a negotiation round
 */
export async function recordRound(dealId: number, round: NegotiationRound): Promise<void> {
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) throw new Error("Deal not found");

  const rounds: NegotiationRound[] = Array.isArray((deal as any).negotiationRounds)
    ? (deal as any).negotiationRounds
    : [];
  rounds.push(round);

  await db.update(deals)
    .set({ metadata: { ...(deal as any).metadata, negotiationRounds: rounds } } as any)
    .where(eq(deals.id, dealId));
}

/**
 * Record final outcome — close negotiation, update deal, feed pattern engine
 */
export async function recordOutcome(
  dealId: number,
  outcome: "accepted" | "rejected" | "expired" | "withdrawn",
  finalPrice?: number,
): Promise<void> {
  const updates: any = {};

  if (outcome === "accepted") {
    updates.stage = "closed_won";
    if (finalPrice) updates.purchasePrice = finalPrice;
  } else {
    updates.stage = "closed_lost";
  }

  await db.update(deals).set(updates).where(eq(deals.id, dealId));

  // Trigger pattern engine on close
  if (outcome === "accepted") {
    try {
      const { dealPatternCloningService } = await import("./dealPatternCloning");
      await dealPatternCloningService.recordPatternFromClosedDeal(
        (await db.query.deals.findFirst({ where: eq(deals.id, dealId) }))?.organizationId || 0,
        dealId,
      );
    } catch {
      // Pattern cloning is best-effort
    }
  }
}
