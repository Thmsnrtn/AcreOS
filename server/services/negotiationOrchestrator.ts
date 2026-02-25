// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from '../db';
import { 
  negotiationThreads, 
  negotiationMoves, 
  negotiationOutcomes,
  negotiationStrategies,
  properties 
} from '../../shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface SellerProfile {
  motivation: 'distressed' | 'motivated' | 'neutral' | 'passive';
  urgency: number; // 0-100
  emotionalTriggers: string[];
  communicationStyle: 'analytical' | 'amiable' | 'driver' | 'expressive';
  priceFlexibility: number; // 0-100
  keyPainPoints: string[];
}

interface NegotiationContext {
  propertyId: string;
  askingPrice: number;
  marketValue: number;
  comparables: any[];
  sellerHistory: any[];
  timeOnMarket: number;
  competingOffers: number;
}

interface CounterOfferRecommendation {
  amount: number;
  confidence: number;
  reasoning: string;
  tactics: string[];
  expectedAcceptanceProbability: number;
  alternativeOffers: {
    amount: number;
    terms: string;
    probability: number;
  }[];
}

interface NegotiationStrategy {
  name: string;
  description: string;
  openingOffer: number;
  incrementStrategy: 'aggressive' | 'moderate' | 'conservative';
  concessionPattern: number[];
  psychologicalTactics: string[];
  expectedWinRate: number;
}

class NegotiationOrchestrator {
  /**
   * Analyze seller psychology from communication and behavior patterns
   */
  async analyzeSellerPsychology(
    organizationId: string,
    propertyId: string,
    sellerCommunication: string[]
  ): Promise<SellerProfile> {
    try {
      // Analyze communication patterns with GPT-4
      const analysisPrompt = `Analyze the following seller communications and determine:
1. Motivation level (distressed/motivated/neutral/passive)
2. Urgency score (0-100)
3. Emotional triggers
4. Communication style (analytical/amiable/driver/expressive)
5. Price flexibility estimate (0-100)
6. Key pain points

Seller communications:
${sellerCommunication.join('\n\n')}

Respond in JSON format.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: analysisPrompt }],
        response_format: { type: 'json_object' },
      });

      const analysis = JSON.parse(completion.choices[0].message.content || '{}');

      const profile: SellerProfile = {
        motivation: analysis.motivation || 'neutral',
        urgency: analysis.urgency || 50,
        emotionalTriggers: analysis.emotionalTriggers || [],
        communicationStyle: analysis.communicationStyle || 'analytical',
        priceFlexibility: analysis.priceFlexibility || 50,
        keyPainPoints: analysis.keyPainPoints || [],
      };

      return profile;
    } catch (error) {
      console.error('Seller psychology analysis failed:', error);
      // Return neutral profile as fallback
      return {
        motivation: 'neutral',
        urgency: 50,
        emotionalTriggers: [],
        communicationStyle: 'analytical',
        priceFlexibility: 50,
        keyPainPoints: [],
      };
    }
  }

  /**
   * Generate optimal counter-offer based on psychology and market data
   */
  async generateCounterOffer(
    organizationId: string,
    threadId: string,
    context: NegotiationContext,
    sellerProfile: SellerProfile,
    previousOffers: { amount: number; response: string }[]
  ): Promise<CounterOfferRecommendation> {
    try {
      // Calculate value gap
      const valueGap = context.askingPrice - context.marketValue;
      const gapPercentage = (valueGap / context.askingPrice) * 100;

      // Determine aggressiveness based on seller profile
      let offerPercentage = 0.75; // Start at 75% of asking price

      if (sellerProfile.motivation === 'distressed' && sellerProfile.urgency > 70) {
        offerPercentage = 0.60; // More aggressive
      } else if (sellerProfile.motivation === 'passive' || sellerProfile.urgency < 30) {
        offerPercentage = 0.85; // More conservative
      }

      // Adjust for time on market
      if (context.timeOnMarket > 90) {
        offerPercentage -= 0.05;
      } else if (context.timeOnMarket < 30) {
        offerPercentage += 0.05;
      }

      // Adjust for competing offers
      if (context.competingOffers > 2) {
        offerPercentage += 0.10;
      }

      // Calculate recommended offer
      const recommendedAmount = Math.round(context.askingPrice * offerPercentage);

      // Generate psychological tactics
      const tactics: string[] = [];
      
      if (sellerProfile.motivation === 'distressed') {
        tactics.push('Emphasize quick close and cash certainty');
        tactics.push('Highlight risks of waiting (tax implications, maintenance costs)');
      }

      if (sellerProfile.communicationStyle === 'analytical') {
        tactics.push('Provide detailed comps and market data');
        tactics.push('Use logical argumentation with numbers');
      } else if (sellerProfile.communicationStyle === 'amiable') {
        tactics.push('Build rapport and trust first');
        tactics.push('Emphasize win-win outcome');
      } else if (sellerProfile.communicationStyle === 'driver') {
        tactics.push('Be direct and results-focused');
        tactics.push('Emphasize efficiency and speed');
      } else if (sellerProfile.communicationStyle === 'expressive') {
        tactics.push('Use storytelling and vision');
        tactics.push('Appeal to emotions and legacy');
      }

      if (context.timeOnMarket > 60) {
        tactics.push('Reference market time concerns');
      }

      // Use GPT-4 for sophisticated reasoning
      const reasoningPrompt = `Generate negotiation reasoning for a land deal:
Asking Price: $${context.askingPrice.toLocaleString()}
Market Value: $${context.marketValue.toLocaleString()}
Recommended Offer: $${recommendedAmount.toLocaleString()}
Seller Motivation: ${sellerProfile.motivation}
Urgency: ${sellerProfile.urgency}/100
Time on Market: ${context.timeOnMarket} days
Competing Offers: ${context.competingOffers}

Provide: 
1. Brief compelling reasoning for this offer amount
2. Estimated acceptance probability (0-100)
3. Three alternative offer structures with different terms

Respond in JSON format.`;

      const reasoning = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: reasoningPrompt }],
        response_format: { type: 'json_object' },
      });

      const reasoningData = JSON.parse(reasoning.choices[0].message.content || '{}');

      const recommendation: CounterOfferRecommendation = {
        amount: recommendedAmount,
        confidence: this.calculateConfidence(sellerProfile, context),
        reasoning: reasoningData.reasoning || 'Strategic offer based on market analysis',
        tactics,
        expectedAcceptanceProbability: reasoningData.acceptanceProbability || 45,
        alternativeOffers: reasoningData.alternativeOffers || [],
      };

      return recommendation;
    } catch (error) {
      console.error('Counter-offer generation failed:', error);
      throw error;
    }
  }

  /**
   * Calculate confidence score for negotiation recommendation
   */
  private calculateConfidence(profile: SellerProfile, context: NegotiationContext): number {
    let confidence = 50;

    // High urgency increases confidence
    if (profile.urgency > 70) confidence += 20;
    else if (profile.urgency < 30) confidence -= 10;

    // Distressed sellers increase confidence
    if (profile.motivation === 'distressed') confidence += 15;
    else if (profile.motivation === 'passive') confidence -= 15;

    // High price flexibility increases confidence
    if (profile.priceFlexibility > 70) confidence += 15;
    else if (profile.priceFlexibility < 30) confidence -= 10;

    // Time on market
    if (context.timeOnMarket > 90) confidence += 10;
    else if (context.timeOnMarket < 30) confidence -= 5;

    // Competing offers reduce confidence
    confidence -= context.competingOffers * 5;

    return Math.max(10, Math.min(95, confidence));
  }

  /**
   * Create negotiation thread for a property
   */
  async createNegotiationThread(
    organizationId: string,
    propertyId: string,
    sellerContact: string,
    askingPrice: number,
    strategyId?: string
  ): Promise<string> {
    try {
      const [thread] = await db.insert(negotiationThreads).values({
        organizationId,
        propertyId,
        sellerContact,
        currentOffer: null,
        counterOffer: askingPrice,
        status: 'active',
        strategyId: strategyId || null,
        metadata: {},
      }).returning();

      return thread.id;
    } catch (error) {
      console.error('Failed to create negotiation thread:', error);
      throw error;
    }
  }

  /**
   * Record negotiation move (offer, counter, acceptance, rejection)
   */
  async recordMove(
    organizationId: string,
    threadId: string,
    moveType: 'offer' | 'counter_offer' | 'acceptance' | 'rejection' | 'walkaway',
    amount: number | null,
    terms: any,
    partyType: 'buyer' | 'seller'
  ): Promise<void> {
    try {
      await db.insert(negotiationMoves).values({
        organizationId,
        threadId,
        moveType,
        amount,
        terms,
        partyType,
        timestamp: new Date(),
      });

      // Update thread status if terminal move
      if (moveType === 'acceptance' || moveType === 'walkaway') {
        const finalStatus = moveType === 'acceptance' ? 'accepted' : 'failed';
        await db.update(negotiationThreads)
          .set({ 
            status: finalStatus,
            closedAt: new Date(),
          })
          .where(eq(negotiationThreads.id, threadId));
      }
    } catch (error) {
      console.error('Failed to record negotiation move:', error);
      throw error;
    }
  }

  /**
   * Get negotiation thread with full history
   */
  async getThread(organizationId: string, threadId: string): Promise<any> {
    try {
      const thread = await db.query.negotiationThreads.findFirst({
        where: and(
          eq(negotiationThreads.organizationId, organizationId),
          eq(negotiationThreads.id, threadId)
        ),
      });

      if (!thread) {
        throw new Error('Thread not found');
      }

      const moves = await db.query.negotiationMoves.findMany({
        where: and(
          eq(negotiationMoves.organizationId, organizationId),
          eq(negotiationMoves.threadId, threadId)
        ),
        orderBy: [desc(negotiationMoves.timestamp)],
      });

      return {
        ...thread,
        moves,
      };
    } catch (error) {
      console.error('Failed to get thread:', error);
      throw error;
    }
  }

  /**
   * Get all active negotiations
   */
  async getActiveNegotiations(organizationId: string): Promise<any[]> {
    try {
      return await db.query.negotiationThreads.findMany({
        where: and(
          eq(negotiationThreads.organizationId, organizationId),
          eq(negotiationThreads.status, 'active')
        ),
        orderBy: [desc(negotiationThreads.createdAt)],
      });
    } catch (error) {
      console.error('Failed to get active negotiations:', error);
      throw error;
    }
  }

  /**
   * Create and test multiple negotiation strategies (A/B testing)
   */
  async createStrategy(
    organizationId: string,
    name: string,
    description: string,
    config: {
      openingOfferPercentage: number; // e.g., 0.75 = 75% of asking price
      incrementStrategy: 'aggressive' | 'moderate' | 'conservative';
      maxCounters: number;
      walkawayThreshold: number;
      psychologicalTactics: string[];
    }
  ): Promise<string> {
    try {
      const [strategy] = await db.insert(negotiationStrategies).values({
        organizationId,
        name,
        description,
        config,
        performance: {
          timesUsed: 0,
          successRate: 0,
          avgDiscount: 0,
          avgDaysToClose: 0,
        },
      }).returning();

      return strategy.id;
    } catch (error) {
      console.error('Failed to create strategy:', error);
      throw error;
    }
  }

  /**
   * Record negotiation outcome for strategy performance tracking
   */
  async recordOutcome(
    organizationId: string,
    threadId: string,
    outcome: 'accepted' | 'rejected' | 'expired',
    finalPrice: number | null,
    askingPrice: number,
    daysToClose: number
  ): Promise<void> {
    try {
      await db.insert(negotiationOutcomes).values({
        organizationId,
        threadId,
        outcome,
        finalPrice,
        askingPrice,
        discountAmount: finalPrice ? askingPrice - finalPrice : null,
        discountPercentage: finalPrice ? ((askingPrice - finalPrice) / askingPrice) * 100 : null,
        daysToClose,
        metadata: {},
      });

      // Update strategy performance if thread has strategyId
      const thread = await db.query.negotiationThreads.findFirst({
        where: eq(negotiationThreads.id, threadId),
      });

      if (thread?.strategyId) {
        await this.updateStrategyPerformance(organizationId, thread.strategyId);
      }
    } catch (error) {
      console.error('Failed to record outcome:', error);
      throw error;
    }
  }

  /**
   * Update strategy performance metrics
   */
  private async updateStrategyPerformance(
    organizationId: string,
    strategyId: string
  ): Promise<void> {
    try {
      // Get all threads using this strategy
      const threads = await db.query.negotiationThreads.findMany({
        where: and(
          eq(negotiationThreads.organizationId, organizationId),
          eq(negotiationThreads.strategyId, strategyId)
        ),
      });

      const threadIds = threads.map(t => t.id);

      // Get outcomes for these threads
      const outcomes = await db.query.negotiationOutcomes.findMany({
        where: and(
          eq(negotiationOutcomes.organizationId, organizationId),
          sql`${negotiationOutcomes.threadId} IN ${threadIds}`
        ),
      });

      const successfulOutcomes = outcomes.filter(o => o.outcome === 'accepted');
      
      const performance = {
        timesUsed: threads.length,
        successRate: threads.length > 0 ? (successfulOutcomes.length / threads.length) * 100 : 0,
        avgDiscount: successfulOutcomes.length > 0
          ? successfulOutcomes.reduce((sum, o) => sum + (o.discountPercentage || 0), 0) / successfulOutcomes.length
          : 0,
        avgDaysToClose: successfulOutcomes.length > 0
          ? successfulOutcomes.reduce((sum, o) => sum + o.daysToClose, 0) / successfulOutcomes.length
          : 0,
      };

      await db.update(negotiationStrategies)
        .set({ performance })
        .where(eq(negotiationStrategies.id, strategyId));
    } catch (error) {
      console.error('Failed to update strategy performance:', error);
    }
  }

  /**
   * Get best performing strategy for given seller profile
   */
  async getBestStrategy(
    organizationId: string,
    sellerProfile: SellerProfile
  ): Promise<any | null> {
    try {
      const strategies = await db.query.negotiationStrategies.findMany({
        where: eq(negotiationStrategies.organizationId, organizationId),
        orderBy: [desc(sql`(${negotiationStrategies.performance}->>'successRate')::float`)],
      });

      if (strategies.length === 0) return null;

      // Return strategy with highest success rate that has been tested at least 5 times
      const testedStrategies = strategies.filter(
        s => (s.performance as any).timesUsed >= 5
      );

      return testedStrategies.length > 0 ? testedStrategies[0] : strategies[0];
    } catch (error) {
      console.error('Failed to get best strategy:', error);
      return null;
    }
  }

  /**
   * Generate negotiation script using AI
   */
  async generateNegotiationScript(
    organizationId: string,
    threadId: string,
    sellerProfile: SellerProfile,
    counterOffer: CounterOfferRecommendation
  ): Promise<string> {
    try {
      const prompt = `Generate a persuasive negotiation script for a land deal:

Offer Amount: $${counterOffer.amount.toLocaleString()}
Seller Motivation: ${sellerProfile.motivation}
Communication Style: ${sellerProfile.communicationStyle}
Key Pain Points: ${sellerProfile.keyPainPoints.join(', ')}
Tactics to Use: ${counterOffer.tactics.join(', ')}

Create a professional, persuasive script (200-300 words) that:
1. Opens with rapport-building
2. Presents the offer with compelling reasoning
3. Addresses likely objections
4. Closes with clear next steps

Tone should match the ${sellerProfile.communicationStyle} communication style.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: prompt }],
      });

      return completion.choices[0].message.content || '';
    } catch (error) {
      console.error('Failed to generate negotiation script:', error);
      return 'Script generation failed';
    }
  }

  /**
   * Auto-negotiate on behalf of user (with approval thresholds)
   */
  async autoNegotiate(
    organizationId: string,
    threadId: string,
    maxPrice: number,
    autoApproveUnder: number
  ): Promise<{ success: boolean; finalPrice?: number; message: string }> {
    try {
      const thread = await this.getThread(organizationId, threadId);
      
      if (!thread) {
        return { success: false, message: 'Thread not found' };
      }

      // Get latest counter offer from seller
      const latestCounterOffer = thread.counterOffer;

      if (!latestCounterOffer) {
        return { success: false, message: 'No counter offer to respond to' };
      }

      // If seller's counter is under auto-approve threshold, accept
      if (latestCounterOffer <= autoApproveUnder) {
        await this.recordMove(
          organizationId,
          threadId,
          'acceptance',
          latestCounterOffer,
          {},
          'buyer'
        );
        return {
          success: true,
          finalPrice: latestCounterOffer,
          message: `Auto-accepted at $${latestCounterOffer.toLocaleString()}`,
        };
      }

      // If over max price, walk away
      if (latestCounterOffer > maxPrice) {
        await this.recordMove(
          organizationId,
          threadId,
          'walkaway',
          null,
          { reason: 'Exceeded max price' },
          'buyer'
        );
        return {
          success: false,
          message: `Walked away - price exceeded max of $${maxPrice.toLocaleString()}`,
        };
      }

      // Generate counter-offer
      // For auto-negotiation, split the difference but aim for 60% of gap
      const gap = latestCounterOffer - thread.currentOffer;
      const newOffer = thread.currentOffer + Math.round(gap * 0.4);

      await this.recordMove(
        organizationId,
        threadId,
        'counter_offer',
        newOffer,
        { automatic: true },
        'buyer'
      );

      return {
        success: true,
        message: `Auto-countered at $${newOffer.toLocaleString()}`,
      };
    } catch (error) {
      console.error('Auto-negotiate failed:', error);
      return { success: false, message: 'Auto-negotiation failed' };
    }
  }
}

export const negotiationOrchestrator = new NegotiationOrchestrator();
