import { db } from "../db";
import {
  sellerIntentPredictions,
  leads,
  leadActivities,
  properties,
  conversations,
  messages,
  agentEvents,
  type SellerIntentPrediction,
  type InsertSellerIntentPrediction,
  type Lead,
  type Property,
} from "@shared/schema";
import { eq, and, desc, gte, sql, count, avg } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";

interface SignalScore {
  score: number;
  indicators: string[];
}

interface UrgencySignals extends SignalScore {
  mentions?: string[];
}

interface FinancialSignals extends SignalScore {
  taxDelinquent?: boolean;
  estimatedEquity?: number;
}

interface EmotionalSignals extends SignalScore {
  lifeEvent?: string;
}

interface EngagementSignals extends SignalScore {
  responseRate?: number;
  responseSpeed?: number;
  questionTypes?: string[];
}

interface PriceFlexibilitySignals extends SignalScore {
  hasCountered?: boolean;
  counterPattern?: string;
  anchorAcceptance?: number;
}

interface CompetitionSignals extends SignalScore {
  otherOffersMentioned?: boolean;
  marketingProperty?: boolean;
}

interface AllSignals {
  urgency?: UrgencySignals;
  financial?: FinancialSignals;
  emotional?: EmotionalSignals;
  engagement?: EngagementSignals;
  priceFlexibility?: PriceFlexibilitySignals;
  competition?: CompetitionSignals;
}

type IntentLevel = "very_high" | "high" | "moderate" | "low" | "very_low";
type RecommendedApproach = "aggressive" | "standard" | "patient" | "walk_away";
type PredictionOutcome = "accepted" | "rejected" | "countered" | "no_response" | "withdrew";

const URGENCY_KEYWORDS = [
  "asap", "urgent", "quickly", "fast", "need to sell", "relocating",
  "moving", "deadline", "time sensitive", "hurry", "immediately",
  "this week", "as soon as possible", "right away"
];

const LIFE_EVENT_KEYWORDS: Record<string, string[]> = {
  divorce: ["divorce", "divorcing", "separated", "ex-wife", "ex-husband", "split"],
  inheritance: ["inherited", "inheritance", "estate", "deceased", "passed away", "probate"],
  retirement: ["retiring", "retirement", "downsizing", "moving to florida"],
  relocation: ["relocating", "moving out of state", "job transfer", "new job"],
  financial_distress: ["foreclosure", "behind on taxes", "can't afford", "debt", "bankruptcy"],
  health: ["health issues", "medical bills", "hospital", "can't maintain"],
};

const QUESTION_TYPE_KEYWORDS: Record<string, string[]> = {
  timeline: ["when", "how soon", "closing date", "timeline"],
  price: ["price", "offer", "how much", "value", "worth"],
  process: ["how does this work", "what happens next", "process", "steps"],
  terms: ["terms", "conditions", "contingencies", "cash"],
};

const SIGNAL_WEIGHTS = {
  urgency: 0.20,
  financial: 0.20,
  emotional: 0.15,
  engagement: 0.25,
  priceFlexibility: 0.10,
  competition: 0.10,
};

export class SellerIntentPredictorService {

  async predictIntent(
    organizationId: number,
    leadId: number,
    propertyId?: number
  ): Promise<SellerIntentPrediction> {
    const [lead] = await db.select().from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));

    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }

    let property: Property | undefined;
    if (propertyId) {
      const [prop] = await db.select().from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));
      property = prop;
    }

    const [
      urgencySignals,
      financialSignals,
      emotionalSignals,
      engagementSignals,
      priceFlexibilitySignals,
      competitionSignals
    ] = await Promise.all([
      this.analyzeUrgencySignals(leadId),
      this.analyzeFinancialSignals(leadId, propertyId),
      this.analyzeEmotionalSignals(leadId),
      this.analyzeEngagementSignals(leadId),
      this.analyzePriceFlexibility(leadId),
      this.analyzeCompetitionSignals(leadId)
    ]);

    const signals: AllSignals = {
      urgency: urgencySignals,
      financial: financialSignals,
      emotional: emotionalSignals,
      engagement: engagementSignals,
      priceFlexibility: priceFlexibilitySignals,
      competition: competitionSignals,
    };

    const intentScore = this.calculateIntentScore(signals);
    const intentLevel = this.determineIntentLevel(intentScore);
    const confidence = this.calculateConfidence(signals);

    const [recommendedApproach, approachReasoning] = await this.generateApproachRecommendation(signals, intentLevel);
    const suggestedOfferRange = propertyId 
      ? await this.suggestOfferRange(propertyId, signals)
      : undefined;

    const prediction: InsertSellerIntentPrediction = {
      organizationId,
      leadId,
      propertyId: propertyId ?? null,
      intentScore,
      intentLevel,
      confidence: confidence.toString(),
      signals: {
        urgency: urgencySignals,
        financial: financialSignals,
        emotional: emotionalSignals,
        engagement: engagementSignals,
        priceFlexibility: priceFlexibilitySignals,
        competition: competitionSignals,
      },
      recommendedApproach,
      approachReasoning,
      suggestedOfferRange,
    };

    const [inserted] = await db.insert(sellerIntentPredictions)
      .values(prediction)
      .returning();

    await db.insert(agentEvents).values({
      organizationId,
      eventType: "seller_intent_predicted",
      eventSource: "system",
      payload: {
        predictionId: inserted.id,
        leadId,
        propertyId,
        intentScore,
        intentLevel,
      },
      relatedEntityType: "lead",
      relatedEntityId: leadId,
    });

    return inserted;
  }

  async analyzeUrgencySignals(leadId: number): Promise<UrgencySignals> {
    const messageContent = await this.getLeadMessageContent(leadId);
    const indicators: string[] = [];
    const mentions: string[] = [];

    let score = 50;

    const lowerContent = messageContent.toLowerCase();
    for (const keyword of URGENCY_KEYWORDS) {
      if (lowerContent.includes(keyword)) {
        mentions.push(keyword);
        score += 10;
      }
    }

    if (mentions.length > 0) {
      indicators.push(`Found ${mentions.length} urgency keywords in messages`);
    }

    const activities = await db.select().from(leadActivities)
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt))
      .limit(20);

    const recentActivities = activities.filter(a => {
      const activityDate = new Date(a.createdAt!);
      const daysSince = (Date.now() - activityDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 7;
    });

    if (recentActivities.length >= 3) {
      indicators.push("High recent activity (3+ in last week)");
      score += 15;
    }

    score = Math.min(100, Math.max(0, score));

    return { score, indicators, mentions };
  }

  async analyzeFinancialSignals(leadId: number, propertyId?: number): Promise<FinancialSignals> {
    const indicators: string[] = [];
    let score = 50;
    let taxDelinquent = false;
    let estimatedEquity: number | undefined;

    if (propertyId) {
      const [property] = await db.select().from(properties)
        .where(eq(properties.id, propertyId));

      if (property) {
        const dueDiligence = property.dueDiligenceData as { taxDelinquent?: boolean; taxOwed?: number } | null;
        if (dueDiligence?.taxDelinquent) {
          taxDelinquent = true;
          indicators.push("Property is tax delinquent");
          score += 25;
        }

        const assessedValue = property.assessedValue ? parseFloat(property.assessedValue) : null;
        const marketValue = property.marketValue ? parseFloat(property.marketValue) : null;
        const taxOwed = dueDiligence?.taxOwed ?? 0;

        if (assessedValue && marketValue) {
          estimatedEquity = marketValue - taxOwed;
          const equityRatio = estimatedEquity / marketValue;

          if (equityRatio < 0.2) {
            indicators.push("Low equity position");
            score += 20;
          } else if (equityRatio > 0.8) {
            indicators.push("High equity position");
            score -= 10;
          }
        }
      }
    }

    const messageContent = await this.getLeadMessageContent(leadId);
    const lowerContent = messageContent.toLowerCase();

    const financialKeywords = ["behind on taxes", "foreclosure", "debt", "can't afford", "need cash", "financial"];
    for (const keyword of financialKeywords) {
      if (lowerContent.includes(keyword)) {
        indicators.push(`Mentioned: "${keyword}"`);
        score += 10;
        break;
      }
    }

    score = Math.min(100, Math.max(0, score));

    return { score, indicators, taxDelinquent, estimatedEquity };
  }

  async analyzeEmotionalSignals(leadId: number): Promise<EmotionalSignals> {
    const messageContent = await this.getLeadMessageContent(leadId);
    const indicators: string[] = [];
    let score = 50;
    let lifeEvent: string | undefined;

    const lowerContent = messageContent.toLowerCase();

    for (const [event, keywords] of Object.entries(LIFE_EVENT_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lowerContent.includes(keyword)) {
          lifeEvent = event;
          indicators.push(`Life event detected: ${event}`);
          score += 20;
          break;
        }
      }
      if (lifeEvent) break;
    }

    const emotionalPhrases = [
      "don't want to deal with", "burden", "stress", "tired of",
      "just want it gone", "not using it", "forgot about it"
    ];

    for (const phrase of emotionalPhrases) {
      if (lowerContent.includes(phrase)) {
        indicators.push(`Emotional detachment: "${phrase}"`);
        score += 10;
        break;
      }
    }

    score = Math.min(100, Math.max(0, score));

    return { score, indicators, lifeEvent };
  }

  async analyzeEngagementSignals(leadId: number): Promise<EngagementSignals> {
    const indicators: string[] = [];
    let score = 50;
    const questionTypes: string[] = [];

    const [lead] = await db.select().from(leads)
      .where(eq(leads.id, leadId));

    if (!lead) {
      return { score: 50, indicators: [], responseRate: 0, questionTypes: [] };
    }

    const activities = await db.select().from(leadActivities)
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt));

    const outboundCount = activities.filter(a => 
      a.type === "email_sent" || a.type === "sms_sent" || a.type === "call_made"
    ).length;

    const responses = lead.responses || 0;
    const responseRate = outboundCount > 0 ? responses / outboundCount : 0;

    if (responseRate >= 0.5) {
      indicators.push("High response rate (50%+)");
      score += 25;
    } else if (responseRate >= 0.25) {
      indicators.push("Moderate response rate (25%+)");
      score += 10;
    } else if (responseRate === 0) {
      indicators.push("No responses yet");
      score -= 15;
    }

    let responseSpeed: number | undefined;
    const inboundActivities = activities.filter(a => 
      a.type === "email_received" || a.type === "sms_received" || a.type === "call_received"
    );

    if (inboundActivities.length >= 2) {
      const responseTimes: number[] = [];
      for (let i = 0; i < inboundActivities.length - 1; i++) {
        const timeDiff = new Date(inboundActivities[i].createdAt!).getTime() - 
                         new Date(inboundActivities[i + 1].createdAt!).getTime();
        responseTimes.push(timeDiff / (1000 * 60 * 60));
      }
      responseSpeed = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

      if (responseSpeed <= 24) {
        indicators.push("Fast response time (<24 hours)");
        score += 15;
      }
    }

    const messageContent = await this.getLeadMessageContent(leadId);
    const lowerContent = messageContent.toLowerCase();

    for (const [qType, keywords] of Object.entries(QUESTION_TYPE_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lowerContent.includes(keyword)) {
          questionTypes.push(qType);
          break;
        }
      }
    }

    if (questionTypes.includes("timeline")) {
      indicators.push("Asked about timeline");
      score += 10;
    }
    if (questionTypes.includes("process")) {
      indicators.push("Asked about process");
      score += 5;
    }

    score = Math.min(100, Math.max(0, score));

    return { score, indicators, responseRate, responseSpeed, questionTypes };
  }

  async analyzePriceFlexibility(leadId: number): Promise<PriceFlexibilitySignals> {
    const indicators: string[] = [];
    let score = 50;
    let hasCountered = false;
    let counterPattern: string | undefined;
    let anchorAcceptance: number | undefined;

    const messageContent = await this.getLeadMessageContent(leadId);
    const lowerContent = messageContent.toLowerCase();

    const counterKeywords = ["counter", "what about", "could you do", "i was thinking", "my price"];
    for (const keyword of counterKeywords) {
      if (lowerContent.includes(keyword)) {
        hasCountered = true;
        indicators.push("Has counter-offered or negotiated");
        score += 10;
        break;
      }
    }

    const flexibleKeywords = ["willing to negotiate", "open to offers", "make an offer", "what can you offer"];
    for (const keyword of flexibleKeywords) {
      if (lowerContent.includes(keyword)) {
        indicators.push("Shows price flexibility");
        score += 15;
        break;
      }
    }

    const firmKeywords = ["firm on price", "won't go lower", "not negotiable", "final offer"];
    for (const keyword of firmKeywords) {
      if (lowerContent.includes(keyword)) {
        indicators.push("Price appears firm");
        score -= 20;
        counterPattern = "firm";
        break;
      }
    }

    if (!counterPattern && hasCountered) {
      counterPattern = "flexible";
    }

    score = Math.min(100, Math.max(0, score));

    return { score, indicators, hasCountered, counterPattern, anchorAcceptance };
  }

  async analyzeCompetitionSignals(leadId: number): Promise<CompetitionSignals> {
    const indicators: string[] = [];
    let score = 50;
    let otherOffersMentioned = false;
    let marketingProperty = false;

    const messageContent = await this.getLeadMessageContent(leadId);
    const lowerContent = messageContent.toLowerCase();

    const competitorKeywords = ["other offers", "another buyer", "someone else", "highest bidder", "multiple offers"];
    for (const keyword of competitorKeywords) {
      if (lowerContent.includes(keyword)) {
        otherOffersMentioned = true;
        indicators.push("Mentioned other offers/buyers");
        score -= 15;
        break;
      }
    }

    const listingKeywords = ["listed", "realtor", "real estate agent", "zillow", "mls", "for sale by owner"];
    for (const keyword of listingKeywords) {
      if (lowerContent.includes(keyword)) {
        marketingProperty = true;
        indicators.push("Property may be actively marketed");
        score -= 10;
        break;
      }
    }

    const exclusiveKeywords = ["only talking to you", "not listed", "off market", "haven't listed"];
    for (const keyword of exclusiveKeywords) {
      if (lowerContent.includes(keyword)) {
        indicators.push("Exclusive opportunity");
        score += 20;
        break;
      }
    }

    score = Math.min(100, Math.max(0, score));

    return { score, indicators, otherOffersMentioned, marketingProperty };
  }

  calculateIntentScore(signals: AllSignals): number {
    let weightedSum = 0;
    let totalWeight = 0;

    if (signals.urgency) {
      weightedSum += signals.urgency.score * SIGNAL_WEIGHTS.urgency;
      totalWeight += SIGNAL_WEIGHTS.urgency;
    }

    if (signals.financial) {
      weightedSum += signals.financial.score * SIGNAL_WEIGHTS.financial;
      totalWeight += SIGNAL_WEIGHTS.financial;
    }

    if (signals.emotional) {
      weightedSum += signals.emotional.score * SIGNAL_WEIGHTS.emotional;
      totalWeight += SIGNAL_WEIGHTS.emotional;
    }

    if (signals.engagement) {
      weightedSum += signals.engagement.score * SIGNAL_WEIGHTS.engagement;
      totalWeight += SIGNAL_WEIGHTS.engagement;
    }

    if (signals.priceFlexibility) {
      weightedSum += signals.priceFlexibility.score * SIGNAL_WEIGHTS.priceFlexibility;
      totalWeight += SIGNAL_WEIGHTS.priceFlexibility;
    }

    if (signals.competition) {
      weightedSum += signals.competition.score * SIGNAL_WEIGHTS.competition;
      totalWeight += SIGNAL_WEIGHTS.competition;
    }

    if (totalWeight === 0) return 50;

    return Math.round(weightedSum / totalWeight);
  }

  determineIntentLevel(score: number): IntentLevel {
    if (score >= 80) return "very_high";
    if (score >= 65) return "high";
    if (score >= 50) return "moderate";
    if (score >= 35) return "low";
    return "very_low";
  }

  calculateConfidence(signals: AllSignals): number {
    let signalCount = 0;
    let indicatorCount = 0;

    const signalKeys = Object.keys(signals) as (keyof AllSignals)[];
    for (const key of signalKeys) {
      const signal = signals[key];
      if (signal) {
        signalCount++;
        indicatorCount += signal.indicators.length;
      }
    }

    const baseConfidence = signalCount / 6;
    const indicatorBonus = Math.min(0.3, indicatorCount * 0.03);

    return Math.min(0.95, baseConfidence * 0.7 + indicatorBonus + 0.2);
  }

  async generateApproachRecommendation(
    signals: AllSignals,
    intentLevel: IntentLevel
  ): Promise<[RecommendedApproach, string]> {
    const openai = getOpenAIClient();

    if (!openai) {
      return this.generateFallbackRecommendation(signals, intentLevel);
    }

    try {
      const signalsSummary = this.formatSignalsForAI(signals);

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert real estate negotiation advisor. Based on seller signals, recommend a negotiation approach.
            
Approaches:
- aggressive: Move quickly with strong initial offer, push for fast close
- standard: Balanced approach with room for negotiation
- patient: Take time, build rapport, don't rush
- walk_away: Signals suggest low probability of deal, not worth pursuing

Respond with JSON: {"approach": "<approach>", "reasoning": "<2-3 sentence explanation>"}`
          },
          {
            role: "user",
            content: `Intent Level: ${intentLevel}

Signals Analysis:
${signalsSummary}

What negotiation approach do you recommend?`
          }
        ],
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content;
      if (content) {
        const parsed = JSON.parse(content);
        return [parsed.approach as RecommendedApproach, parsed.reasoning];
      }
    } catch (error) {
      console.error("[SellerIntentPredictor] AI recommendation failed:", error);
    }

    return this.generateFallbackRecommendation(signals, intentLevel);
  }

  private generateFallbackRecommendation(
    signals: AllSignals,
    intentLevel: IntentLevel
  ): [RecommendedApproach, string] {
    switch (intentLevel) {
      case "very_high":
        return ["aggressive", "High intent signals suggest seller is motivated. Move quickly with competitive offer."];
      case "high":
        return ["standard", "Good buying signals. Standard negotiation approach with fair initial offer."];
      case "moderate":
        return ["patient", "Mixed signals. Take time to build rapport and understand seller motivation."];
      case "low":
        return ["patient", "Low intent indicators. Focus on relationship building before making offers."];
      case "very_low":
        return ["walk_away", "Very low probability of deal. Consider focusing resources elsewhere."];
    }
  }

  private formatSignalsForAI(signals: AllSignals): string {
    const parts: string[] = [];

    if (signals.urgency) {
      parts.push(`Urgency (${signals.urgency.score}/100): ${signals.urgency.indicators.join(", ") || "No indicators"}`);
    }
    if (signals.financial) {
      parts.push(`Financial (${signals.financial.score}/100): ${signals.financial.indicators.join(", ") || "No indicators"}`);
    }
    if (signals.emotional) {
      parts.push(`Emotional (${signals.emotional.score}/100): ${signals.emotional.indicators.join(", ") || "No indicators"}`);
    }
    if (signals.engagement) {
      parts.push(`Engagement (${signals.engagement.score}/100): ${signals.engagement.indicators.join(", ") || "No indicators"}`);
    }
    if (signals.priceFlexibility) {
      parts.push(`Price Flexibility (${signals.priceFlexibility.score}/100): ${signals.priceFlexibility.indicators.join(", ") || "No indicators"}`);
    }
    if (signals.competition) {
      parts.push(`Competition (${signals.competition.score}/100): ${signals.competition.indicators.join(", ") || "No indicators"}`);
    }

    return parts.join("\n");
  }

  async suggestOfferRange(
    propertyId: number,
    signals: AllSignals
  ): Promise<{ min: number; optimal: number; max: number } | undefined> {
    const [property] = await db.select().from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) return undefined;

    const marketValue = property.marketValue ? parseFloat(property.marketValue) : null;
    const assessedValue = property.assessedValue ? parseFloat(property.assessedValue) : null;

    const baseValue = marketValue || assessedValue;
    if (!baseValue) return undefined;

    const intentScore = this.calculateIntentScore(signals);
    const urgencyBonus = signals.urgency?.score || 50;
    const flexibilityBonus = signals.priceFlexibility?.score || 50;

    const motivationFactor = (intentScore + urgencyBonus + flexibilityBonus) / 300;
    const discountMultiplier = 0.5 + (0.3 * (1 - motivationFactor));

    const optimal = Math.round(baseValue * discountMultiplier);
    const min = Math.round(optimal * 0.85);
    const max = Math.round(optimal * 1.15);

    return { min, optimal, max };
  }

  async recordOutcome(
    predictionId: number,
    outcome: PredictionOutcome
  ): Promise<void> {
    const [prediction] = await db.select().from(sellerIntentPredictions)
      .where(eq(sellerIntentPredictions.id, predictionId));

    if (!prediction) {
      throw new Error(`Prediction ${predictionId} not found`);
    }

    const predictionAccurate = this.evaluatePredictionAccuracy(prediction, outcome);

    await db.update(sellerIntentPredictions)
      .set({
        actualOutcome: outcome,
        outcomeRecordedAt: new Date(),
        predictionAccurate,
        updatedAt: new Date(),
      })
      .where(eq(sellerIntentPredictions.id, predictionId));

    await db.insert(agentEvents).values({
      organizationId: prediction.organizationId,
      eventType: "seller_intent_outcome_recorded",
      eventSource: "system",
      payload: {
        predictionId,
        intentLevel: prediction.intentLevel,
        intentScore: prediction.intentScore,
        outcome,
        accurate: predictionAccurate,
      },
      relatedEntityType: "lead",
      relatedEntityId: prediction.leadId,
    });
  }

  private evaluatePredictionAccuracy(
    prediction: SellerIntentPrediction,
    outcome: PredictionOutcome
  ): boolean {
    const positiveOutcomes: PredictionOutcome[] = ["accepted", "countered"];
    const isPositiveOutcome = positiveOutcomes.includes(outcome);

    const highIntentLevels: IntentLevel[] = ["very_high", "high"];
    const predictedHighIntent = highIntentLevels.includes(prediction.intentLevel as IntentLevel);

    return isPositiveOutcome === predictedHighIntent;
  }

  async analyzeAccuracy(organizationId: number): Promise<{
    totalPredictions: number;
    verifiedPredictions: number;
    overallAccuracy: number;
    accuracyByLevel: Record<IntentLevel, { total: number; accurate: number; accuracy: number }>;
    recentAccuracy: number;
  }> {
    const allPredictions = await db.select().from(sellerIntentPredictions)
      .where(eq(sellerIntentPredictions.organizationId, organizationId));

    const verifiedPredictions = allPredictions.filter(p => p.actualOutcome !== null);
    const accuratePredictions = verifiedPredictions.filter(p => p.predictionAccurate === true);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentPredictions = verifiedPredictions.filter(p => 
      p.outcomeRecordedAt && new Date(p.outcomeRecordedAt) >= thirtyDaysAgo
    );
    const recentAccurate = recentPredictions.filter(p => p.predictionAccurate === true);

    const levels: IntentLevel[] = ["very_high", "high", "moderate", "low", "very_low"];
    const accuracyByLevel: Record<IntentLevel, { total: number; accurate: number; accuracy: number }> = {} as any;

    for (const level of levels) {
      const levelPredictions = verifiedPredictions.filter(p => p.intentLevel === level);
      const levelAccurate = levelPredictions.filter(p => p.predictionAccurate === true);

      accuracyByLevel[level] = {
        total: levelPredictions.length,
        accurate: levelAccurate.length,
        accuracy: levelPredictions.length > 0 
          ? Math.round((levelAccurate.length / levelPredictions.length) * 100) 
          : 0,
      };
    }

    return {
      totalPredictions: allPredictions.length,
      verifiedPredictions: verifiedPredictions.length,
      overallAccuracy: verifiedPredictions.length > 0 
        ? Math.round((accuratePredictions.length / verifiedPredictions.length) * 100)
        : 0,
      accuracyByLevel,
      recentAccuracy: recentPredictions.length > 0
        ? Math.round((recentAccurate.length / recentPredictions.length) * 100)
        : 0,
    };
  }

  async getLeadPredictions(
    organizationId: number,
    leadId: number
  ): Promise<SellerIntentPrediction[]> {
    return db.select().from(sellerIntentPredictions)
      .where(and(
        eq(sellerIntentPredictions.organizationId, organizationId),
        eq(sellerIntentPredictions.leadId, leadId)
      ))
      .orderBy(desc(sellerIntentPredictions.createdAt));
  }

  private async getLeadMessageContent(leadId: number): Promise<string> {
    const leadConversations = await db.select().from(conversations)
      .where(eq(conversations.leadId, leadId));

    if (leadConversations.length === 0) {
      return "";
    }

    const conversationIds = leadConversations.map(c => c.id);

    const leadMessages = await db.select().from(messages)
      .where(sql`${messages.conversationId} IN (${sql.join(conversationIds, sql`, `)})`)
      .orderBy(desc(messages.createdAt))
      .limit(50);

    return leadMessages.map(m => m.content).join(" ");
  }
}

export const sellerIntentPredictorService = new SellerIntentPredictorService();
