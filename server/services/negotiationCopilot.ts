import { db } from "../db";
import {
  negotiationSessions,
  deals,
  leads,
  properties,
  messages,
  agentEvents,
  sellerIntentPredictions,
  type NegotiationSession,
  type InsertNegotiationSession,
  type Deal,
  type Lead,
  type Property,
} from "@shared/schema";
import { eq, and, desc, sql, avg, count } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";

type ObjectionCategory = "price" | "timing" | "trust" | "emotional" | "competitive";
type NegotiationStrategy = "empathy" | "logic" | "urgency" | "anchor" | "silence";
type SessionOutcome = "accepted" | "rejected" | "countered" | "no_response" | "withdrew";

interface ObjectionPattern {
  keywords: string[];
  category: ObjectionCategory;
  suggestedStrategies: NegotiationStrategy[];
}

interface DetectedObjection {
  id: string;
  text: string;
  category: ObjectionCategory;
  detectedAt: string;
  resolved: boolean;
}

interface SentimentResult {
  score: number;
  indicators: string[];
}

interface CounterOfferSuggestion {
  suggestedAmount: number;
  reasoning: string;
  confidence: number;
  alternativeAmounts?: number[];
}

interface StrategyRecommendation {
  strategy: NegotiationStrategy;
  reasoning: string;
  suggestedActions: string[];
  confidence: number;
}

interface ObjectionEffectivenessResult {
  category: ObjectionCategory;
  strategy: NegotiationStrategy;
  timesUsed: number;
  successRate: number;
  avgEffectiveness: number;
}

const OBJECTION_PATTERNS: ObjectionPattern[] = [
  {
    keywords: ["too low", "worth more", "not enough", "lowball", "insulting", "ridiculous offer", "joke offer", "can get more"],
    category: "price",
    suggestedStrategies: ["logic", "anchor", "empathy"],
  },
  {
    keywords: ["need time", "think about it", "not ready", "too fast", "need to discuss", "talk to spouse", "family decision"],
    category: "timing",
    suggestedStrategies: ["urgency", "empathy", "silence"],
  },
  {
    keywords: ["don't trust", "scam", "too good", "what's the catch", "suspicious", "sounds fishy", "legit", "legitimate"],
    category: "trust",
    suggestedStrategies: ["empathy", "logic"],
  },
  {
    keywords: ["sentimental", "memories", "grew up", "family land", "hard to let go", "emotional", "attachment", "grandparents"],
    category: "emotional",
    suggestedStrategies: ["empathy", "silence"],
  },
  {
    keywords: ["other offers", "shopping around", "better deal", "another buyer", "competing offer", "someone else interested"],
    category: "competitive",
    suggestedStrategies: ["urgency", "anchor", "logic"],
  },
];

const POSITIVE_SENTIMENT_KEYWORDS = [
  "interested", "sounds good", "tell me more", "reasonable", "fair",
  "willing", "open to", "consider", "works for me", "let's do it",
  "agree", "deal", "yes", "okay", "sure", "great", "perfect"
];

const NEGATIVE_SENTIMENT_KEYWORDS = [
  "no", "not interested", "too low", "waste of time", "ridiculous",
  "insulting", "forget it", "pass", "decline", "never", "stop contacting",
  "remove me", "unsubscribe", "don't contact", "absolutely not"
];

const STRATEGY_PROMPTS: Record<NegotiationStrategy, string> = {
  empathy: "Show understanding and validate their feelings while gently guiding toward a resolution.",
  logic: "Use facts, data, and logical reasoning to address their concern with market comparables and clear value proposition.",
  urgency: "Create a sense of urgency with time-limited aspects while remaining professional and not pushy.",
  anchor: "Reinforce the original offer as fair while remaining open to small adjustments, maintaining price anchoring.",
  silence: "Acknowledge their point briefly and give them space to consider, with a gentle follow-up timeframe.",
};

export class NegotiationCopilotService {
  private generateId(): string {
    return `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async startSession(
    organizationId: number,
    dealId: number,
    leadId: number,
    initialOffer: number,
    sellerAsk: number
  ): Promise<NegotiationSession> {
    const [deal] = await db.select().from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.organizationId, organizationId)));

    if (!deal) {
      throw new Error(`Deal ${dealId} not found`);
    }

    const [lead] = await db.select().from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));

    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }

    const session: InsertNegotiationSession = {
      organizationId,
      dealId,
      leadId,
      status: "active",
      currentOfferAmount: initialOffer.toString(),
      sellerAskAmount: sellerAsk.toString(),
      negotiationRound: 1,
      objections: [],
      suggestedResponses: [],
      counterOfferHistory: [{
        round: 1,
        ourOffer: initialOffer,
        timestamp: new Date().toISOString(),
        notes: "Initial offer",
      }],
      sentimentHistory: [],
    };

    const [inserted] = await db.insert(negotiationSessions)
      .values(session)
      .returning();

    await db.insert(agentEvents).values({
      organizationId,
      eventType: "negotiation_session_started",
      eventSource: "system",
      payload: {
        sessionId: inserted.id,
        dealId,
        leadId,
        initialOffer,
        sellerAsk,
      },
      relatedEntityType: "deal",
      relatedEntityId: dealId,
    });

    return inserted;
  }

  async detectObjection(
    sessionId: number,
    messageText: string
  ): Promise<DetectedObjection | null> {
    const [session] = await db.select().from(negotiationSessions)
      .where(eq(negotiationSessions.id, sessionId));

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const lowerMessage = messageText.toLowerCase();
    let detectedCategory: ObjectionCategory | null = null;
    let matchedKeywords: string[] = [];

    for (const pattern of OBJECTION_PATTERNS) {
      for (const keyword of pattern.keywords) {
        if (lowerMessage.includes(keyword)) {
          detectedCategory = pattern.category;
          matchedKeywords.push(keyword);
        }
      }
      if (detectedCategory) break;
    }

    if (!detectedCategory) {
      const aiCategory = await this.aiDetectObjection(messageText);
      if (aiCategory) {
        detectedCategory = aiCategory;
      }
    }

    if (!detectedCategory) {
      return null;
    }

    const objection: DetectedObjection = {
      id: this.generateId(),
      text: messageText,
      category: detectedCategory,
      detectedAt: new Date().toISOString(),
      resolved: false,
    };

    const existingObjections = (session.objections as DetectedObjection[]) || [];
    existingObjections.push(objection);

    await db.update(negotiationSessions)
      .set({
        objections: existingObjections,
        updatedAt: new Date(),
      })
      .where(eq(negotiationSessions.id, sessionId));

    await db.insert(agentEvents).values({
      organizationId: session.organizationId,
      eventType: "objection_detected",
      eventSource: "system",
      payload: {
        sessionId,
        objectionId: objection.id,
        category: detectedCategory,
        matchedKeywords,
      },
      relatedEntityType: "deal",
      relatedEntityId: session.dealId,
    });

    return objection;
  }

  private async aiDetectObjection(messageText: string): Promise<ObjectionCategory | null> {
    const openai = getOpenAIClient();
    if (!openai) return null;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are analyzing seller messages in land deal negotiations. 
Classify the message as one of these objection types, or "none" if no objection is present:
- price: concerns about offer being too low
- timing: needs more time to decide
- trust: suspicious of the buyer or deal
- emotional: sentimental attachment to property
- competitive: mentions other buyers or offers

Respond with only the category name or "none".`,
          },
          {
            role: "user",
            content: messageText,
          },
        ],
        max_tokens: 20,
        temperature: 0.1,
      });

      const result = response.choices[0]?.message?.content?.toLowerCase().trim();
      if (result && result !== "none" && ["price", "timing", "trust", "emotional", "competitive"].includes(result)) {
        return result as ObjectionCategory;
      }
    } catch (error) {
      console.error("AI objection detection failed:", error);
    }

    return null;
  }

  categorizeObjection(objectionText: string): ObjectionCategory {
    const lowerText = objectionText.toLowerCase();

    for (const pattern of OBJECTION_PATTERNS) {
      for (const keyword of pattern.keywords) {
        if (lowerText.includes(keyword)) {
          return pattern.category;
        }
      }
    }

    return "price";
  }

  async generateResponse(
    sessionId: number,
    objectionId: string,
    strategy?: NegotiationStrategy
  ): Promise<string> {
    const [session] = await db.select().from(negotiationSessions)
      .where(eq(negotiationSessions.id, sessionId));

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const objections = (session.objections as DetectedObjection[]) || [];
    const objection = objections.find(o => o.id === objectionId);

    if (!objection) {
      throw new Error(`Objection ${objectionId} not found in session`);
    }

    const selectedStrategy = strategy || this.getDefaultStrategy(objection.category);
    const strategyPrompt = STRATEGY_PROMPTS[selectedStrategy];

    const [deal] = await db.select().from(deals)
      .where(eq(deals.id, session.dealId));
    const [lead] = await db.select().from(leads)
      .where(eq(leads.id, session.leadId));

    let property: Property | undefined;
    if (deal?.propertyId) {
      const [prop] = await db.select().from(properties)
        .where(eq(properties.id, deal.propertyId));
      property = prop;
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return this.getFallbackResponse(objection.category, selectedStrategy);
    }

    try {
      const context = this.buildNegotiationContext(session, deal!, lead!, property);

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert land deal negotiator helping craft responses to seller objections.
Strategy to use: ${selectedStrategy}
Approach: ${strategyPrompt}

Keep responses:
- Professional and respectful
- Concise (2-3 sentences max)
- Focused on moving the deal forward
- Land deal specific when relevant`,
          },
          {
            role: "user",
            content: `Context:
${context}

Seller's objection (${objection.category}): "${objection.text}"

Generate a response using the ${selectedStrategy} strategy.`,
          },
        ],
        max_tokens: 200,
        temperature: 0.7,
      });

      const generatedResponse = response.choices[0]?.message?.content || this.getFallbackResponse(objection.category, selectedStrategy);

      const suggestedResponses = (session.suggestedResponses as Array<{
        id: string;
        text: string;
        strategy: string;
        confidence: number;
        generatedAt: string;
        used: boolean;
        outcome?: string;
      }>) || [];

      suggestedResponses.push({
        id: this.generateId(),
        text: generatedResponse,
        strategy: selectedStrategy,
        confidence: 0.8,
        generatedAt: new Date().toISOString(),
        used: false,
      });

      await db.update(negotiationSessions)
        .set({
          suggestedResponses,
          updatedAt: new Date(),
        })
        .where(eq(negotiationSessions.id, sessionId));

      return generatedResponse;
    } catch (error) {
      console.error("AI response generation failed:", error);
      return this.getFallbackResponse(objection.category, selectedStrategy);
    }
  }

  private getDefaultStrategy(category: ObjectionCategory): NegotiationStrategy {
    const pattern = OBJECTION_PATTERNS.find(p => p.category === category);
    return pattern?.suggestedStrategies[0] || "empathy";
  }

  private buildNegotiationContext(
    session: NegotiationSession,
    deal: Deal,
    lead: Lead,
    property?: Property
  ): string {
    const lines: string[] = [];

    lines.push(`Current offer: $${session.currentOfferAmount}`);
    lines.push(`Seller's ask: $${session.sellerAskAmount}`);
    lines.push(`Negotiation round: ${session.negotiationRound}`);

    if (property) {
      lines.push(`Property: ${property.sizeAcres || "Unknown"} acres in ${property.county}, ${property.state}`);
    }

    lines.push(`Lead name: ${lead.firstName} ${lead.lastName}`);

    const counterHistory = (session.counterOfferHistory as Array<{ round: number; ourOffer: number; theirCounter?: number }>) || [];
    if (counterHistory.length > 1) {
      lines.push(`Previous counter-offers: ${counterHistory.map(c => `Round ${c.round}: Our $${c.ourOffer}${c.theirCounter ? `, Their $${c.theirCounter}` : ""}`).join("; ")}`);
    }

    return lines.join("\n");
  }

  private getFallbackResponse(category: ObjectionCategory, strategy: NegotiationStrategy): string {
    const fallbacks: Record<ObjectionCategory, Record<NegotiationStrategy, string>> = {
      price: {
        empathy: "I completely understand wanting the best value for your property. Let me share some comparable sales data that informed our offer.",
        logic: "Our offer is based on recent sales of similar properties in your area. I'd be happy to walk you through the analysis.",
        urgency: "I want to be upfront - we have a limited acquisition budget this quarter, and I'd hate for you to miss this opportunity.",
        anchor: "Our offer reflects the fair market value based on current conditions. We're confident in our analysis but open to discussion.",
        silence: "I appreciate you sharing your perspective. Take your time to consider, and let me know if you have any questions.",
      },
      timing: {
        empathy: "I understand this is a big decision. What timeline would work better for you?",
        logic: "While I respect your need for time, property values can fluctuate. Making a decision soon could work in your favor.",
        urgency: "I completely understand, though I should mention we're actively looking at other properties in the area.",
        anchor: "Take the time you need. Our offer remains firm, and I'm here when you're ready to proceed.",
        silence: "Of course. I'll follow up in a few days to see where you are in your decision-making process.",
      },
      trust: {
        empathy: "I hear your concerns, and they're completely valid. Let me share some references and explain exactly how our process works.",
        logic: "We're a legitimate land acquisition company. I can provide our business registration, references, and explain our standard closing process.",
        urgency: "I understand your caution. We work with reputable title companies and can provide any documentation you need.",
        anchor: "Your trust is important to us. We've closed many deals in your area and would be happy to connect you with previous sellers.",
        silence: "I appreciate your candor. Please feel free to do your due diligence, and I'm here to answer any questions.",
      },
      emotional: {
        empathy: "I can tell this property means a great deal to you and your family. That emotional connection is completely understandable.",
        logic: "Many of our sellers feel the same way initially. The property will continue to exist and potentially benefit a new family.",
        urgency: "I understand the attachment. Sometimes letting go can also mean preserving those memories while gaining financial freedom.",
        anchor: "Your feelings about the property are valid. Our offer reflects its fair value and the care you've put into it.",
        silence: "I understand. This is a personal decision. Take your time, and I'm here when you're ready to talk more.",
      },
      competitive: {
        empathy: "It makes sense to explore all your options. I want to make sure you get the best deal possible.",
        logic: "I'd encourage you to compare offers carefully - consider closing costs, timelines, and certainty of close, not just price.",
        urgency: "I understand you're weighing options. Just know our offer is time-sensitive, and we're ready to close quickly.",
        anchor: "We're confident in our offer. Many sellers find that when comparing all factors, we provide the best overall value.",
        silence: "I respect that. Take your time to compare, and let me know if you have any questions about our offer.",
      },
    };

    return fallbacks[category][strategy];
  }

  async suggestCounterOffer(sessionId: number): Promise<CounterOfferSuggestion> {
    const [session] = await db.select().from(negotiationSessions)
      .where(eq(negotiationSessions.id, sessionId));

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const currentOffer = parseFloat(session.currentOfferAmount || "0");
    const sellerAsk = parseFloat(session.sellerAskAmount || "0");
    const round = session.negotiationRound || 1;
    const lastCounter = parseFloat(session.lastCounterAmount || "0");

    const gap = sellerAsk - currentOffer;
    const incrementFactor = Math.max(0.05, 0.20 - (round * 0.03));

    let baseIncrement = gap * incrementFactor;
    let sellerMotivationAdjustment = 1.0;

    const intentPredictions = await db.select()
      .from(sellerIntentPredictions)
      .where(eq(sellerIntentPredictions.leadId, session.leadId))
      .orderBy(desc(sellerIntentPredictions.createdAt))
      .limit(1);

    if (intentPredictions.length > 0) {
      const intentScore = intentPredictions[0].intentScore;
      if (intentScore >= 80) {
        sellerMotivationAdjustment = 0.7;
      } else if (intentScore >= 60) {
        sellerMotivationAdjustment = 0.85;
      } else if (intentScore <= 30) {
        sellerMotivationAdjustment = 1.15;
      }
    }

    baseIncrement = baseIncrement * sellerMotivationAdjustment;

    const sentimentHistory = (session.sentimentHistory as Array<{ score: number }>) || [];
    if (sentimentHistory.length > 0) {
      const avgSentiment = sentimentHistory.reduce((sum, s) => sum + s.score, 0) / sentimentHistory.length;
      if (avgSentiment > 0.3) {
        baseIncrement = baseIncrement * 0.9;
      } else if (avgSentiment < -0.3) {
        baseIncrement = baseIncrement * 1.1;
      }
    }

    const suggestedAmount = Math.round(currentOffer + baseIncrement);
    const maxOffer = sellerAsk * 0.95;
    const finalSuggestion = Math.min(suggestedAmount, maxOffer);

    const alternativeAmounts = [
      Math.round(currentOffer + (baseIncrement * 0.5)),
      Math.round(currentOffer + (baseIncrement * 1.5)),
    ].filter(a => a > currentOffer && a < sellerAsk);

    const confidence = Math.max(0.5, 0.9 - (round * 0.1));

    const reasoning = this.buildCounterOfferReasoning(
      currentOffer,
      sellerAsk,
      finalSuggestion,
      round,
      sellerMotivationAdjustment
    );

    return {
      suggestedAmount: finalSuggestion,
      reasoning,
      confidence,
      alternativeAmounts,
    };
  }

  private buildCounterOfferReasoning(
    currentOffer: number,
    sellerAsk: number,
    suggested: number,
    round: number,
    motivationFactor: number
  ): string {
    const gap = sellerAsk - currentOffer;
    const movement = suggested - currentOffer;
    const movementPercent = ((movement / gap) * 100).toFixed(1);

    let reasoning = `Moving ${movementPercent}% of the gap ($${movement.toLocaleString()}) from current offer.`;

    if (round > 2) {
      reasoning += " Using smaller increments as negotiations progress.";
    }

    if (motivationFactor < 1) {
      reasoning += " Seller shows high motivation, suggesting room for smaller increases.";
    } else if (motivationFactor > 1) {
      reasoning += " Seller shows low motivation, suggesting larger increases may be needed.";
    }

    return reasoning;
  }

  async recordCounterOffer(
    sessionId: number,
    ourOffer: number,
    theirCounter?: number
  ): Promise<void> {
    const [session] = await db.select().from(negotiationSessions)
      .where(eq(negotiationSessions.id, sessionId));

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const history = (session.counterOfferHistory as Array<{
      round: number;
      ourOffer: number;
      theirCounter?: number;
      timestamp: string;
      notes?: string;
    }>) || [];

    const newRound = (session.negotiationRound || 1) + 1;

    history.push({
      round: newRound,
      ourOffer,
      theirCounter,
      timestamp: new Date().toISOString(),
    });

    await db.update(negotiationSessions)
      .set({
        counterOfferHistory: history,
        currentOfferAmount: ourOffer.toString(),
        lastCounterAmount: theirCounter?.toString() || session.lastCounterAmount,
        negotiationRound: newRound,
        updatedAt: new Date(),
      })
      .where(eq(negotiationSessions.id, sessionId));

    await db.insert(agentEvents).values({
      organizationId: session.organizationId,
      eventType: "counter_offer_recorded",
      eventSource: "system",
      payload: {
        sessionId,
        round: newRound,
        ourOffer,
        theirCounter,
      },
      relatedEntityType: "deal",
      relatedEntityId: session.dealId,
    });
  }

  async analyzeSentiment(sessionId: number, messageText: string): Promise<SentimentResult> {
    const [session] = await db.select().from(negotiationSessions)
      .where(eq(negotiationSessions.id, sessionId));

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const lowerMessage = messageText.toLowerCase();
    const indicators: string[] = [];
    let score = 0;

    for (const keyword of POSITIVE_SENTIMENT_KEYWORDS) {
      if (lowerMessage.includes(keyword)) {
        score += 0.15;
        indicators.push(`+positive: "${keyword}"`);
      }
    }

    for (const keyword of NEGATIVE_SENTIMENT_KEYWORDS) {
      if (lowerMessage.includes(keyword)) {
        score -= 0.15;
        indicators.push(`-negative: "${keyword}"`);
      }
    }

    score = Math.max(-1, Math.min(1, score));

    const openai = getOpenAIClient();
    if (openai && indicators.length === 0) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `Analyze the sentiment of this message from a property seller in a negotiation. 
Return a JSON object with: { "score": number (-1 to 1), "indicators": string[] }
-1 is very negative, 0 is neutral, 1 is very positive.`,
            },
            { role: "user", content: messageText },
          ],
          max_tokens: 100,
          temperature: 0.1,
          response_format: { type: "json_object" },
        });

        const result = JSON.parse(response.choices[0]?.message?.content || "{}");
        if (typeof result.score === "number") {
          score = Math.max(-1, Math.min(1, result.score));
        }
        if (Array.isArray(result.indicators)) {
          indicators.push(...result.indicators);
        }
      } catch (error) {
        console.error("AI sentiment analysis failed:", error);
      }
    }

    const sentimentHistory = (session.sentimentHistory as Array<{
      timestamp: string;
      score: number;
      indicators: string[];
    }>) || [];

    sentimentHistory.push({
      timestamp: new Date().toISOString(),
      score,
      indicators,
    });

    await db.update(negotiationSessions)
      .set({
        sentimentHistory,
        updatedAt: new Date(),
      })
      .where(eq(negotiationSessions.id, sessionId));

    return { score, indicators };
  }

  async getRecommendedStrategy(sessionId: number): Promise<StrategyRecommendation> {
    const [session] = await db.select().from(negotiationSessions)
      .where(eq(negotiationSessions.id, sessionId));

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const objections = (session.objections as DetectedObjection[]) || [];
    const sentimentHistory = (session.sentimentHistory as Array<{ score: number }>) || [];
    const round = session.negotiationRound || 1;

    let strategy: NegotiationStrategy = "empathy";
    let reasoning = "";
    const suggestedActions: string[] = [];
    let confidence = 0.7;

    if (objections.length > 0) {
      const unresolvedObjections = objections.filter(o => !o.resolved);
      if (unresolvedObjections.length > 0) {
        const latestObjection = unresolvedObjections[unresolvedObjections.length - 1];
        const pattern = OBJECTION_PATTERNS.find(p => p.category === latestObjection.category);
        strategy = pattern?.suggestedStrategies[0] || "empathy";
        reasoning = `Unresolved ${latestObjection.category} objection detected.`;
        suggestedActions.push(`Address the ${latestObjection.category} concern directly`);
      }
    }

    if (sentimentHistory.length > 0) {
      const recentSentiments = sentimentHistory.slice(-3);
      const avgSentiment = recentSentiments.reduce((sum, s) => sum + s.score, 0) / recentSentiments.length;

      if (avgSentiment < -0.3) {
        strategy = "empathy";
        reasoning += " Seller sentiment is negative, prioritize relationship building.";
        suggestedActions.push("Focus on validating their concerns before pushing forward");
        confidence -= 0.1;
      } else if (avgSentiment > 0.3) {
        strategy = "anchor";
        reasoning += " Seller sentiment is positive, maintain current position.";
        suggestedActions.push("Reinforce value proposition while seller is receptive");
        confidence += 0.1;
      }
    }

    if (round >= 4) {
      strategy = "urgency";
      reasoning += " Multiple rounds completed, consider creating urgency.";
      suggestedActions.push("Introduce soft deadline or competing priorities");
    }

    const currentOffer = parseFloat(session.currentOfferAmount || "0");
    const sellerAsk = parseFloat(session.sellerAskAmount || "0");
    const gapPercentage = ((sellerAsk - currentOffer) / sellerAsk) * 100;

    if (gapPercentage < 10) {
      suggestedActions.push("Gap is small - consider splitting the difference");
    } else if (gapPercentage > 40) {
      suggestedActions.push("Significant gap remains - use logic to justify position");
    }

    const openai = getOpenAIClient();
    if (openai) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are an expert negotiation strategist for land deals. 
Analyze the negotiation state and recommend ONE strategy from: empathy, logic, urgency, anchor, silence.
Return JSON: { "strategy": string, "reasoning": string, "actions": string[] }`,
            },
            {
              role: "user",
              content: `Negotiation state:
- Round: ${round}
- Current offer: $${currentOffer}
- Seller ask: $${sellerAsk}
- Gap: ${gapPercentage.toFixed(1)}%
- Recent objections: ${objections.slice(-2).map(o => o.category).join(", ") || "none"}
- Recent sentiment: ${sentimentHistory.slice(-1).map(s => s.score).join(", ") || "unknown"}`,
            },
          ],
          max_tokens: 200,
          temperature: 0.3,
          response_format: { type: "json_object" },
        });

        const result = JSON.parse(response.choices[0]?.message?.content || "{}");
        if (result.strategy && ["empathy", "logic", "urgency", "anchor", "silence"].includes(result.strategy)) {
          strategy = result.strategy;
        }
        if (result.reasoning) {
          reasoning = result.reasoning;
        }
        if (Array.isArray(result.actions)) {
          suggestedActions.push(...result.actions);
        }
        confidence = 0.85;
      } catch (error) {
        console.error("AI strategy recommendation failed:", error);
      }
    }

    return {
      strategy,
      reasoning: reasoning || "Default recommendation based on negotiation state.",
      suggestedActions: Array.from(new Set(suggestedActions)),
      confidence: Math.min(1, Math.max(0, confidence)),
    };
  }

  async closeSession(
    sessionId: number,
    outcome: SessionOutcome,
    finalAmount?: number
  ): Promise<void> {
    const [session] = await db.select().from(negotiationSessions)
      .where(eq(negotiationSessions.id, sessionId));

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const status = outcome === "accepted" ? "won" : outcome === "rejected" ? "lost" : "stalled";

    let profitMargin: string | null = null;
    if (finalAmount && session.currentOfferAmount) {
      const initialOffer = parseFloat(session.currentOfferAmount);
      const margin = ((finalAmount - initialOffer) / initialOffer) * 100;
      profitMargin = margin.toFixed(2);
    }

    await db.update(negotiationSessions)
      .set({
        status,
        outcome,
        finalAmount: finalAmount?.toString(),
        profitMargin,
        updatedAt: new Date(),
      })
      .where(eq(negotiationSessions.id, sessionId));

    await db.insert(agentEvents).values({
      organizationId: session.organizationId,
      eventType: "negotiation_session_closed",
      eventSource: "system",
      payload: {
        sessionId,
        outcome,
        finalAmount,
        rounds: session.negotiationRound,
      },
      relatedEntityType: "deal",
      relatedEntityId: session.dealId,
    });
  }

  async recordLessonsLearned(sessionId: number, lessons: string): Promise<void> {
    const [session] = await db.select().from(negotiationSessions)
      .where(eq(negotiationSessions.id, sessionId));

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await db.update(negotiationSessions)
      .set({
        lessonsLearned: lessons,
        updatedAt: new Date(),
      })
      .where(eq(negotiationSessions.id, sessionId));
  }

  async getSessionHistory(
    organizationId: number,
    dealId: number
  ): Promise<NegotiationSession[]> {
    const sessions = await db.select()
      .from(negotiationSessions)
      .where(and(
        eq(negotiationSessions.organizationId, organizationId),
        eq(negotiationSessions.dealId, dealId)
      ))
      .orderBy(desc(negotiationSessions.createdAt));

    return sessions;
  }

  async analyzeObjectionEffectiveness(
    organizationId: number
  ): Promise<ObjectionEffectivenessResult[]> {
    const sessions = await db.select()
      .from(negotiationSessions)
      .where(and(
        eq(negotiationSessions.organizationId, organizationId),
        sql`${negotiationSessions.outcome} IS NOT NULL`
      ));

    const effectivenessMap = new Map<string, {
      category: ObjectionCategory;
      strategy: NegotiationStrategy;
      uses: number;
      successes: number;
      totalEffectiveness: number;
    }>();

    for (const session of sessions) {
      const objections = (session.objections as Array<{
        category: ObjectionCategory;
        responseUsed?: string;
        resolved: boolean;
        effectiveness?: number;
      }>) || [];

      const responses = (session.suggestedResponses as Array<{
        strategy: string;
        used: boolean;
        outcome?: string;
      }>) || [];

      const isSuccess = session.outcome === "accepted";

      for (const objection of objections) {
        for (const response of responses.filter(r => r.used)) {
          const key = `${objection.category}-${response.strategy}`;

          const existing = effectivenessMap.get(key) || {
            category: objection.category,
            strategy: response.strategy as NegotiationStrategy,
            uses: 0,
            successes: 0,
            totalEffectiveness: 0,
          };

          existing.uses++;
          if (isSuccess) existing.successes++;
          if (objection.effectiveness) {
            existing.totalEffectiveness += objection.effectiveness;
          }

          effectivenessMap.set(key, existing);
        }
      }
    }

    return Array.from(effectivenessMap.values()).map(e => ({
      category: e.category,
      strategy: e.strategy,
      timesUsed: e.uses,
      successRate: e.uses > 0 ? e.successes / e.uses : 0,
      avgEffectiveness: e.uses > 0 ? e.totalEffectiveness / e.uses : 0,
    })).sort((a, b) => b.successRate - a.successRate);
  }
}

export const negotiationCopilotService = new NegotiationCopilotService();
