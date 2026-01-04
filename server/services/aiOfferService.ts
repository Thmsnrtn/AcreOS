import OpenAI from "openai";
import { 
  getComparableProperties, 
  calculateMarketValue, 
  calculateOfferPrices,
  calculateDesirabilityScore,
  type CompsSearchResult,
  type PropertyAttributes 
} from "./comps";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface PropertyData {
  id?: number;
  apn?: string;
  address?: string;
  county: string;
  state: string;
  sizeAcres: number;
  latitude?: number;
  longitude?: number;
  zoning?: string;
  terrain?: string;
  roadAccess?: string;
  utilities?: {
    electric?: boolean;
    water?: boolean;
    sewer?: boolean;
    gas?: boolean;
  };
  assessedValue?: number;
  marketValue?: number;
  daysOnMarket?: number;
  ownerSituation?: string;
}

export interface OfferSuggestion {
  strategyName: string;
  offerAmount: number;
  confidence: number;
  reasoning: string;
  marketValuePercent: number;
}

export interface GenerateOfferResponse {
  success: boolean;
  estimatedMarketValue: number;
  suggestions: OfferSuggestion[];
  marketAnalysis: {
    averagePricePerAcre: number;
    medianPricePerAcre: number;
    comparablesCount: number;
    marketTrend: string;
  };
  propertyScore: {
    totalScore: number;
    grade: string;
    factors: Array<{ name: string; score: number; maxScore: number; description: string }>;
  };
  aiReasoning: string;
  error?: string;
}

export interface OfferLetterRequest {
  property: PropertyData;
  offerAmount: number;
  buyerName: string;
  buyerCompany?: string;
  buyerPhone?: string;
  buyerEmail?: string;
  tone: "professional" | "friendly" | "urgent";
  terms?: {
    earnestMoney?: number;
    closingDays?: number;
    contingencies?: string[];
    additionalTerms?: string;
  };
  sellerName?: string;
}

export interface OfferLetterResponse {
  success: boolean;
  letter: string;
  subject: string;
  error?: string;
}

export interface AcceptancePredictionRequest {
  property: PropertyData;
  offerAmount: number;
  estimatedMarketValue: number;
  sellerMotivation?: "unknown" | "low" | "medium" | "high";
  competingOffers?: boolean;
  historicalAcceptanceRate?: number;
}

export interface AcceptanceFactor {
  name: string;
  impact: "positive" | "negative" | "neutral";
  weight: number;
  description: string;
}

export interface AcceptancePredictionResponse {
  success: boolean;
  probability: number;
  confidenceLevel: "low" | "medium" | "high";
  factors: AcceptanceFactor[];
  recommendation: string;
  error?: string;
}

export async function generateOfferSuggestions(
  property: PropertyData
): Promise<GenerateOfferResponse> {
  try {
    if (!property.latitude || !property.longitude) {
      return {
        success: false,
        estimatedMarketValue: 0,
        suggestions: [],
        marketAnalysis: {
          averagePricePerAcre: 0,
          medianPricePerAcre: 0,
          comparablesCount: 0,
          marketTrend: "unknown",
        },
        propertyScore: {
          totalScore: 0,
          grade: "N/A",
          factors: [],
        },
        aiReasoning: "",
        error: "Property coordinates are required for market analysis",
      };
    }

    const compsResult = await getComparableProperties(
      property.latitude,
      property.longitude,
      5,
      {
        minAcreage: property.sizeAcres * 0.5,
        maxAcreage: property.sizeAcres * 2,
        maxResults: 20,
      }
    );

    const marketAnalysis = calculateMarketValue(property.sizeAcres, compsResult.comps);
    
    let estimatedMarketValue = marketAnalysis?.estimatedValue || 0;
    if (!estimatedMarketValue && property.marketValue) {
      estimatedMarketValue = Number(property.marketValue);
    }
    if (!estimatedMarketValue && property.assessedValue) {
      estimatedMarketValue = Number(property.assessedValue) * 1.1;
    }

    const propertyAttributes: PropertyAttributes = {
      roadAccess: property.roadAccess,
      utilities: property.utilities,
      terrain: property.terrain,
      zoning: property.zoning,
      sizeAcres: property.sizeAcres,
      city: property.address,
    };
    const desirabilityScore = calculateDesirabilityScore(propertyAttributes);

    const offerPrices = calculateOfferPrices(estimatedMarketValue);

    const prompt = `You are an expert real estate investment analyst specializing in land acquisitions. Analyze this property and provide strategic offer recommendations.

Property Details:
- Location: ${property.county}, ${property.state}
- Size: ${property.sizeAcres} acres
- Zoning: ${property.zoning || "Unknown"}
- Terrain: ${property.terrain || "Unknown"}
- Road Access: ${property.roadAccess || "Unknown"}
- Utilities: ${JSON.stringify(property.utilities || {})}
- Assessed Value: ${property.assessedValue ? "$" + Number(property.assessedValue).toLocaleString() : "Unknown"}
- Days on Market: ${property.daysOnMarket || "Unknown"}

Market Analysis:
- Estimated Market Value: $${estimatedMarketValue.toLocaleString()}
- Average Price/Acre in Area: $${marketAnalysis?.averagePricePerAcre?.toLocaleString() || "Unknown"}
- Comparable Sales: ${compsResult.comps.filter(c => c.salePrice).length}
- Desirability Score: ${desirabilityScore.totalScore}/100 (Grade: ${desirabilityScore.grade})

Pre-calculated Offer Ranges:
- Conservative (40-50%): $${offerPrices.conservative.min.toLocaleString()} - $${offerPrices.conservative.max.toLocaleString()}
- Standard (50-65%): $${offerPrices.standard.min.toLocaleString()} - $${offerPrices.standard.max.toLocaleString()}
- Aggressive (65-80%): $${offerPrices.aggressive.min.toLocaleString()} - $${offerPrices.aggressive.max.toLocaleString()}

Provide exactly 3 offer strategies as JSON with this structure:
{
  "suggestions": [
    {
      "strategyName": "Conservative Cash Offer",
      "offerAmount": <number>,
      "confidence": <number 0-100>,
      "reasoning": "<brief explanation>",
      "marketValuePercent": <number>
    }
  ],
  "aiReasoning": "<overall analysis and recommendation>",
  "marketTrend": "stable" | "increasing" | "decreasing"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      success: true,
      estimatedMarketValue,
      suggestions: parsed.suggestions || [
        {
          strategyName: "Conservative Offer",
          offerAmount: offerPrices.conservative.max,
          confidence: 75,
          reasoning: "Based on market comparables and property characteristics",
          marketValuePercent: 50,
        },
        {
          strategyName: "Standard Offer",
          offerAmount: Math.round((offerPrices.standard.min + offerPrices.standard.max) / 2),
          confidence: 65,
          reasoning: "Balanced approach for typical market conditions",
          marketValuePercent: 57,
        },
        {
          strategyName: "Aggressive Offer",
          offerAmount: offerPrices.aggressive.min,
          confidence: 55,
          reasoning: "Higher offer for competitive situations or high-value properties",
          marketValuePercent: 65,
        },
      ],
      marketAnalysis: {
        averagePricePerAcre: marketAnalysis?.averagePricePerAcre || 0,
        medianPricePerAcre: marketAnalysis?.medianPricePerAcre || 0,
        comparablesCount: compsResult.comps.length,
        marketTrend: parsed.marketTrend || "stable",
      },
      propertyScore: {
        totalScore: desirabilityScore.totalScore,
        grade: desirabilityScore.grade,
        factors: desirabilityScore.factors,
      },
      aiReasoning: parsed.aiReasoning || "Analysis based on comparable sales and property attributes.",
    };
  } catch (error) {
    console.error("Error generating offer suggestions:", error);
    return {
      success: false,
      estimatedMarketValue: 0,
      suggestions: [],
      marketAnalysis: {
        averagePricePerAcre: 0,
        medianPricePerAcre: 0,
        comparablesCount: 0,
        marketTrend: "unknown",
      },
      propertyScore: {
        totalScore: 0,
        grade: "N/A",
        factors: [],
      },
      aiReasoning: "",
      error: error instanceof Error ? error.message : "Failed to generate offer suggestions",
    };
  }
}

export async function generateOfferLetter(
  request: OfferLetterRequest
): Promise<OfferLetterResponse> {
  try {
    const toneInstructions = {
      professional: "Use formal, business language. Be direct and clear. Maintain a professional tone throughout.",
      friendly: "Be warm and personable while remaining professional. Build rapport with the seller. Show genuine interest.",
      urgent: "Convey a sense of urgency and motivation. Emphasize quick closing timeline. Show strong interest and ability to act fast.",
    };

    const prompt = `Generate a professional offer letter for a land purchase.

Property Details:
- Address/Location: ${request.property.address || `${request.property.county}, ${request.property.state}`}
- APN: ${request.property.apn || "N/A"}
- Size: ${request.property.sizeAcres} acres
- County: ${request.property.county}
- State: ${request.property.state}

Offer Details:
- Offer Amount: $${request.offerAmount.toLocaleString()}
- Earnest Money: ${request.terms?.earnestMoney ? "$" + request.terms.earnestMoney.toLocaleString() : "Negotiable"}
- Closing Timeline: ${request.terms?.closingDays ? request.terms.closingDays + " days" : "30 days"}
- Contingencies: ${request.terms?.contingencies?.join(", ") || "Standard due diligence"}
${request.terms?.additionalTerms ? `- Additional Terms: ${request.terms.additionalTerms}` : ""}

Buyer Information:
- Name: ${request.buyerName}
${request.buyerCompany ? `- Company: ${request.buyerCompany}` : ""}
${request.buyerPhone ? `- Phone: ${request.buyerPhone}` : ""}
${request.buyerEmail ? `- Email: ${request.buyerEmail}` : ""}

${request.sellerName ? `Seller Name: ${request.sellerName}` : ""}

Tone: ${request.tone}
Instructions: ${toneInstructions[request.tone]}

Generate a complete offer letter in JSON format:
{
  "subject": "<email subject line>",
  "letter": "<full letter content with proper formatting, paragraphs separated by \\n\\n>"
}

The letter should:
1. Open with a greeting
2. Clearly state the offer amount and property
3. Highlight key terms
4. Include a call to action
5. Close professionally with buyer contact information`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      success: true,
      letter: parsed.letter || "",
      subject: parsed.subject || `Offer to Purchase Property - ${request.property.county}, ${request.property.state}`,
    };
  } catch (error) {
    console.error("Error generating offer letter:", error);
    return {
      success: false,
      letter: "",
      subject: "",
      error: error instanceof Error ? error.message : "Failed to generate offer letter",
    };
  }
}

export async function predictAcceptanceProbability(
  request: AcceptancePredictionRequest
): Promise<AcceptancePredictionResponse> {
  try {
    const offerRatio = request.offerAmount / request.estimatedMarketValue;
    const factors: AcceptanceFactor[] = [];

    if (offerRatio >= 0.75) {
      factors.push({
        name: "Offer vs Market Value",
        impact: "positive",
        weight: 25,
        description: `Offer at ${(offerRatio * 100).toFixed(0)}% of market value is competitive`,
      });
    } else if (offerRatio >= 0.55) {
      factors.push({
        name: "Offer vs Market Value",
        impact: "neutral",
        weight: 15,
        description: `Offer at ${(offerRatio * 100).toFixed(0)}% of market value is within typical range`,
      });
    } else {
      factors.push({
        name: "Offer vs Market Value",
        impact: "negative",
        weight: -10,
        description: `Offer at ${(offerRatio * 100).toFixed(0)}% of market value is below typical range`,
      });
    }

    if (request.property.daysOnMarket !== undefined) {
      if (request.property.daysOnMarket > 180) {
        factors.push({
          name: "Days on Market",
          impact: "positive",
          weight: 20,
          description: "Property listed for 6+ months increases seller motivation",
        });
      } else if (request.property.daysOnMarket > 90) {
        factors.push({
          name: "Days on Market",
          impact: "positive",
          weight: 10,
          description: "Property listed for 3+ months suggests moderate seller motivation",
        });
      } else {
        factors.push({
          name: "Days on Market",
          impact: "neutral",
          weight: 5,
          description: "Recently listed property - seller expectations may be high",
        });
      }
    }

    const motivationWeights = {
      high: { weight: 25, impact: "positive" as const, description: "High seller motivation increases acceptance likelihood" },
      medium: { weight: 10, impact: "neutral" as const, description: "Moderate seller motivation - standard negotiation expected" },
      low: { weight: -10, impact: "negative" as const, description: "Low seller motivation may require higher offer" },
      unknown: { weight: 5, impact: "neutral" as const, description: "Unknown seller motivation - proceed with standard approach" },
    };

    const motivation = request.sellerMotivation || "unknown";
    factors.push({
      name: "Seller Motivation",
      ...motivationWeights[motivation],
    });

    if (request.competingOffers === true) {
      factors.push({
        name: "Competition",
        impact: "negative",
        weight: -15,
        description: "Competing offers may drive up required price",
      });
    } else if (request.competingOffers === false) {
      factors.push({
        name: "Competition",
        impact: "positive",
        weight: 10,
        description: "No known competing offers - stronger negotiating position",
      });
    }

    if (request.historicalAcceptanceRate !== undefined) {
      const rate = request.historicalAcceptanceRate;
      if (rate >= 0.3) {
        factors.push({
          name: "Historical Acceptance",
          impact: "positive",
          weight: 10,
          description: `Historical ${(rate * 100).toFixed(0)}% acceptance rate in this market`,
        });
      } else {
        factors.push({
          name: "Historical Acceptance",
          impact: "negative",
          weight: -5,
          description: `Historical ${(rate * 100).toFixed(0)}% acceptance rate suggests competitive market`,
        });
      }
    }

    const propertyAttributes = {
      roadAccess: request.property.roadAccess,
      utilities: request.property.utilities,
      terrain: request.property.terrain,
      zoning: request.property.zoning,
      sizeAcres: request.property.sizeAcres,
    };
    const desirability = calculateDesirabilityScore(propertyAttributes);
    
    if (desirability.totalScore < 40) {
      factors.push({
        name: "Property Desirability",
        impact: "positive",
        weight: 10,
        description: "Lower desirability score may mean less competition",
      });
    } else if (desirability.totalScore > 70) {
      factors.push({
        name: "Property Desirability",
        impact: "negative",
        weight: -5,
        description: "High desirability may attract multiple buyers",
      });
    }

    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const baseProbability = 35;
    let probability = Math.min(95, Math.max(5, baseProbability + totalWeight));

    if (offerRatio >= 0.95) probability = Math.min(95, probability + 15);
    if (offerRatio < 0.40) probability = Math.max(5, probability - 20);

    let confidenceLevel: "low" | "medium" | "high" = "medium";
    if (factors.length >= 4 && !factors.some(f => f.name === "Seller Motivation" && f.description.includes("Unknown"))) {
      confidenceLevel = "high";
    } else if (factors.length < 3) {
      confidenceLevel = "low";
    }

    let recommendation: string;
    if (probability >= 70) {
      recommendation = "Strong chance of acceptance. This offer is competitive and well-positioned.";
    } else if (probability >= 50) {
      recommendation = "Moderate chance of acceptance. Consider strengthening terms or following up quickly.";
    } else if (probability >= 30) {
      recommendation = "Lower chance of acceptance. May need to increase offer or improve terms.";
    } else {
      recommendation = "Challenging acceptance likelihood. Consider significant offer adjustment or alternative properties.";
    }

    return {
      success: true,
      probability: Math.round(probability),
      confidenceLevel,
      factors,
      recommendation,
    };
  } catch (error) {
    console.error("Error predicting acceptance probability:", error);
    return {
      success: false,
      probability: 0,
      confidenceLevel: "low",
      factors: [],
      recommendation: "",
      error: error instanceof Error ? error.message : "Failed to predict acceptance probability",
    };
  }
}
