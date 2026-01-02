import { db } from "../db";
import { eq } from "drizzle-orm";
import { campaigns, type Campaign, type InsertCampaignOptimization } from "@shared/schema";
import { storage } from "../storage";
import { usageMeteringService } from "./credits";
import OpenAI from "openai";

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export interface CampaignMetrics {
  openRate: number;
  clickRate: number;
  responseRate: number;
  costPerResponse: number;
  deliveryRate: number;
}

export interface OptimizationSuggestion {
  type: "content" | "timing" | "audience" | "budget";
  suggestion: string;
  reasoning: string;
  priority: "high" | "medium" | "low";
}

const PERFORMANCE_BENCHMARKS = {
  openRate: { poor: 15, good: 25 },
  clickRate: { poor: 2, good: 5 },
  responseRate: { poor: 1, good: 3 },
  costPerResponse: { poor: 50, good: 20 },
  deliveryRate: { poor: 90, good: 98 },
};

export class CampaignOptimizerService {
  analyzeCampaignPerformance(campaign: Campaign): CampaignMetrics {
    const totalSent = campaign.totalSent || 0;
    const totalDelivered = campaign.totalDelivered || 0;
    const totalOpened = campaign.totalOpened || 0;
    const totalClicked = campaign.totalClicked || 0;
    const totalResponded = campaign.totalResponded || 0;
    const spent = Number(campaign.spent) || 0;

    const deliveryRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;
    const openRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
    const clickRate = totalOpened > 0 ? (totalClicked / totalOpened) * 100 : 0;
    const responseRate = totalSent > 0 ? (totalResponded / totalSent) * 100 : 0;
    const costPerResponse = totalResponded > 0 ? spent / totalResponded : spent;

    return {
      openRate: Number(openRate.toFixed(2)),
      clickRate: Number(clickRate.toFixed(2)),
      responseRate: Number(responseRate.toFixed(2)),
      costPerResponse: Number(costPerResponse.toFixed(2)),
      deliveryRate: Number(deliveryRate.toFixed(2)),
    };
  }

  calculateOptimizationScore(campaign: Campaign): number {
    const metrics = this.analyzeCampaignPerformance(campaign);
    let score = 50;

    if (metrics.openRate >= PERFORMANCE_BENCHMARKS.openRate.good) {
      score += 15;
    } else if (metrics.openRate >= PERFORMANCE_BENCHMARKS.openRate.poor) {
      score += 5;
    } else {
      score -= 10;
    }

    if (metrics.clickRate >= PERFORMANCE_BENCHMARKS.clickRate.good) {
      score += 15;
    } else if (metrics.clickRate >= PERFORMANCE_BENCHMARKS.clickRate.poor) {
      score += 5;
    } else {
      score -= 10;
    }

    if (metrics.responseRate >= PERFORMANCE_BENCHMARKS.responseRate.good) {
      score += 20;
    } else if (metrics.responseRate >= PERFORMANCE_BENCHMARKS.responseRate.poor) {
      score += 5;
    } else {
      score -= 15;
    }

    if (metrics.costPerResponse <= PERFORMANCE_BENCHMARKS.costPerResponse.good) {
      score += 10;
    } else if (metrics.costPerResponse <= PERFORMANCE_BENCHMARKS.costPerResponse.poor) {
      score += 0;
    } else {
      score -= 10;
    }

    if (metrics.deliveryRate >= PERFORMANCE_BENCHMARKS.deliveryRate.good) {
      score += 10;
    } else if (metrics.deliveryRate >= PERFORMANCE_BENCHMARKS.deliveryRate.poor) {
      score += 0;
    } else {
      score -= 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  identifyIssues(metrics: CampaignMetrics): string[] {
    const issues: string[] = [];

    if (metrics.openRate < PERFORMANCE_BENCHMARKS.openRate.poor) {
      issues.push("low_open_rate");
    }
    if (metrics.clickRate < PERFORMANCE_BENCHMARKS.clickRate.poor) {
      issues.push("low_click_rate");
    }
    if (metrics.responseRate < PERFORMANCE_BENCHMARKS.responseRate.poor) {
      issues.push("low_response_rate");
    }
    if (metrics.costPerResponse > PERFORMANCE_BENCHMARKS.costPerResponse.poor) {
      issues.push("high_cost_per_response");
    }
    if (metrics.deliveryRate < PERFORMANCE_BENCHMARKS.deliveryRate.poor) {
      issues.push("low_delivery_rate");
    }

    return issues;
  }

  async generateOptimizations(campaign: Campaign): Promise<OptimizationSuggestion[]> {
    const openai = getOpenAIClient();
    if (!openai) {
      console.log("OpenAI API key not configured, skipping AI optimization generation");
      return this.generateFallbackOptimizations(campaign);
    }

    const metrics = this.analyzeCampaignPerformance(campaign);
    const issues = this.identifyIssues(metrics);

    if (issues.length === 0) {
      return [];
    }

    const prompt = `You are a marketing optimization expert for land investment campaigns. Analyze this campaign and provide specific, actionable suggestions.

Campaign Details:
- Name: ${campaign.name}
- Type: ${campaign.type}
- Subject: ${campaign.subject || "Not specified"}
- Content Preview: ${campaign.content?.substring(0, 200) || "Not available"}

Current Performance Metrics:
- Open Rate: ${metrics.openRate}% (Benchmark: ${PERFORMANCE_BENCHMARKS.openRate.poor}% poor, ${PERFORMANCE_BENCHMARKS.openRate.good}% good)
- Click Rate: ${metrics.clickRate}% (Benchmark: ${PERFORMANCE_BENCHMARKS.clickRate.poor}% poor, ${PERFORMANCE_BENCHMARKS.clickRate.good}% good)
- Response Rate: ${metrics.responseRate}% (Benchmark: ${PERFORMANCE_BENCHMARKS.responseRate.poor}% poor, ${PERFORMANCE_BENCHMARKS.responseRate.good}% good)
- Cost Per Response: $${metrics.costPerResponse} (Benchmark: $${PERFORMANCE_BENCHMARKS.costPerResponse.poor} poor, $${PERFORMANCE_BENCHMARKS.costPerResponse.good} good)
- Delivery Rate: ${metrics.deliveryRate}%

Identified Issues: ${issues.join(", ")}

Target Criteria: ${JSON.stringify(campaign.targetCriteria || {})}

Provide 2-4 specific optimization suggestions. For each suggestion, specify:
1. Type: one of "content", "timing", "audience", or "budget"
2. A specific, actionable suggestion
3. Clear reasoning explaining why this will improve performance
4. Priority: "high", "medium", or "low" based on potential impact

Respond in JSON format:
{
  "suggestions": [
    {
      "type": "content",
      "suggestion": "Specific actionable suggestion",
      "reasoning": "Why this will help",
      "priority": "high"
    }
  ]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return parsed.suggestions || [];
      }
    } catch (error) {
      console.error("Error generating AI optimizations:", error);
      return this.generateFallbackOptimizations(campaign);
    }

    return [];
  }

  generateFallbackOptimizations(campaign: Campaign): OptimizationSuggestion[] {
    const metrics = this.analyzeCampaignPerformance(campaign);
    const suggestions: OptimizationSuggestion[] = [];

    if (metrics.openRate < PERFORMANCE_BENCHMARKS.openRate.poor) {
      suggestions.push({
        type: "content",
        suggestion: "Improve your subject line with personalization and urgency. Include the recipient's name or property location, and add action-oriented language like 'Quick Question' or 'Time-Sensitive Offer'.",
        reasoning: `Your open rate of ${metrics.openRate}% is below the ${PERFORMANCE_BENCHMARKS.openRate.poor}% benchmark. Subject lines are the primary driver of open rates.`,
        priority: "high",
      });
    }

    if (metrics.clickRate < PERFORMANCE_BENCHMARKS.clickRate.poor) {
      suggestions.push({
        type: "content",
        suggestion: "Add a clear, prominent call-to-action button or link. Use action verbs like 'Get Your Free Offer' or 'See Your Property Value'. Place CTAs both at the top and bottom of your content.",
        reasoning: `Your click rate of ${metrics.clickRate}% is below the ${PERFORMANCE_BENCHMARKS.clickRate.poor}% benchmark. Clear CTAs with compelling copy drive more clicks.`,
        priority: "high",
      });
    }

    if (metrics.responseRate < PERFORMANCE_BENCHMARKS.responseRate.poor) {
      suggestions.push({
        type: "audience",
        suggestion: "Refine your target audience criteria. Focus on property owners with higher motivation indicators such as out-of-state owners, properties with back taxes, or inherited properties.",
        reasoning: `Your response rate of ${metrics.responseRate}% is below the ${PERFORMANCE_BENCHMARKS.responseRate.poor}% benchmark. Better audience targeting leads to higher-quality leads.`,
        priority: "high",
      });
    }

    if (metrics.costPerResponse > PERFORMANCE_BENCHMARKS.costPerResponse.poor) {
      suggestions.push({
        type: "budget",
        suggestion: "Consider reallocating budget to higher-performing segments. Pause spending on lists or demographics with zero responses, and increase investment in segments showing positive engagement.",
        reasoning: `Your cost per response of $${metrics.costPerResponse} exceeds the $${PERFORMANCE_BENCHMARKS.costPerResponse.poor} benchmark. Budget optimization can significantly improve ROI.`,
        priority: "medium",
      });
    }

    if (metrics.deliveryRate < PERFORMANCE_BENCHMARKS.deliveryRate.poor) {
      suggestions.push({
        type: "audience",
        suggestion: "Clean your mailing list by removing invalid addresses and duplicates. Verify addresses using a postal validation service before sending.",
        reasoning: `Your delivery rate of ${metrics.deliveryRate}% indicates list quality issues. Poor deliverability wastes budget and reduces campaign effectiveness.`,
        priority: "medium",
      });
    }

    return suggestions;
  }

  async optimizeCampaign(campaign: Campaign): Promise<{
    metrics: CampaignMetrics;
    score: number;
    suggestions: OptimizationSuggestion[];
    savedOptimizations: number;
  }> {
    const metrics = this.analyzeCampaignPerformance(campaign);
    const score = this.calculateOptimizationScore(campaign);
    const suggestions = await this.generateOptimizations(campaign);

    let savedOptimizations = 0;
    for (const suggestion of suggestions) {
      try {
        await storage.createCampaignOptimization({
          organizationId: campaign.organizationId,
          campaignId: campaign.id,
          type: suggestion.type,
          suggestion: suggestion.suggestion,
          reasoning: suggestion.reasoning,
          priority: suggestion.priority,
          implemented: false,
        });
        savedOptimizations++;
      } catch (err) {
        console.error("Error saving optimization suggestion:", err);
      }
    }

    await db.update(campaigns)
      .set({
        lastOptimizedAt: new Date(),
        optimizationScore: score,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaign.id));

    return { metrics, score, suggestions, savedOptimizations };
  }

  async processOrganizationCampaigns(
    organizationId: number,
    options: { limit?: number } = {}
  ): Promise<{
    processed: number;
    totalSuggestions: number;
    creditsUsed: number;
    errors: string[];
  }> {
    const { limit = 5 } = options;
    const result = {
      processed: 0,
      totalSuggestions: 0,
      creditsUsed: 0,
      errors: [] as string[],
    };

    try {
      const campaignsToProcess = await storage.getCampaignsNeedingOptimization(organizationId);
      
      for (const campaign of campaignsToProcess.slice(0, limit)) {
        const usageResult = await usageMeteringService.recordUsage(
          organizationId,
          "ai_response",
          1,
          { feature: "campaign_optimization", campaignId: campaign.id }
        );

        if (usageResult.insufficientCredits) {
          result.errors.push(`Insufficient credits for campaign ${campaign.id} optimization`);
          break;
        }

        result.creditsUsed += 1;

        try {
          const optimizationResult = await this.optimizeCampaign(campaign);
          result.processed++;
          result.totalSuggestions += optimizationResult.savedOptimizations;
        } catch (err) {
          result.errors.push(`Failed to optimize campaign ${campaign.id}: ${err}`);
        }
      }
    } catch (err) {
      result.errors.push(`Process error: ${err}`);
    }

    return result;
  }

  async getCampaignAnalytics(organizationId: number): Promise<{
    totalCampaigns: number;
    activeCampaigns: number;
    averageOpenRate: number;
    averageClickRate: number;
    averageResponseRate: number;
    totalSpent: number;
    totalResponses: number;
    averageCostPerResponse: number;
    topPerformingCampaigns: Array<{
      id: number;
      name: string;
      responseRate: number;
      score: number;
    }>;
    campaignsNeedingAttention: number;
  }> {
    const allCampaigns = await storage.getCampaigns(organizationId);
    
    let totalOpenRate = 0;
    let totalClickRate = 0;
    let totalResponseRate = 0;
    let totalSpent = 0;
    let totalResponses = 0;
    let activeCampaigns = 0;
    let needingAttention = 0;
    const campaignsWithMetrics: Array<{
      id: number;
      name: string;
      responseRate: number;
      score: number;
    }> = [];

    for (const campaign of allCampaigns) {
      const metrics = this.analyzeCampaignPerformance(campaign);
      const score = this.calculateOptimizationScore(campaign);

      totalOpenRate += metrics.openRate;
      totalClickRate += metrics.clickRate;
      totalResponseRate += metrics.responseRate;
      totalSpent += Number(campaign.spent) || 0;
      totalResponses += campaign.totalResponded || 0;

      if (campaign.status === "active") {
        activeCampaigns++;
      }

      if (score < 50) {
        needingAttention++;
      }

      campaignsWithMetrics.push({
        id: campaign.id,
        name: campaign.name,
        responseRate: metrics.responseRate,
        score,
      });
    }

    const campaignCount = allCampaigns.length || 1;

    return {
      totalCampaigns: allCampaigns.length,
      activeCampaigns,
      averageOpenRate: Number((totalOpenRate / campaignCount).toFixed(2)),
      averageClickRate: Number((totalClickRate / campaignCount).toFixed(2)),
      averageResponseRate: Number((totalResponseRate / campaignCount).toFixed(2)),
      totalSpent,
      totalResponses,
      averageCostPerResponse: totalResponses > 0 
        ? Number((totalSpent / totalResponses).toFixed(2)) 
        : 0,
      topPerformingCampaigns: campaignsWithMetrics
        .sort((a, b) => b.responseRate - a.responseRate)
        .slice(0, 5),
      campaignsNeedingAttention: needingAttention,
    };
  }
}

export const campaignOptimizerService = new CampaignOptimizerService();
