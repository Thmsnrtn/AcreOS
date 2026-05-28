/**
 * Spend Autonomy Layer — Sovereign Company Protocol v9: The Self-Running Company
 *
 * Ledger evolves from bookkeeper to ACTIVE financial manager.
 *
 * Monitors every external service cost. Identifies optimization opportunities.
 * Within approved budgets, can execute optimizations autonomously.
 * Bigger changes surface in the CEO briefing.
 *
 * "SendGrid: $180/mo for 45k emails. 28k have <1% open rate.
 *  Prune inactive recipients. Estimated savings: $60/mo. [APPROVE]"
 */

import { db } from "../db";
import {
  spendWatchers, spendOptimizations,
  type SpendWatcher, type SpendOptimization,
} from "@shared/schema";
import { eq, desc, and, gte, sql, count, sum } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { resolveAgentData } from "./agentDataResolvers";
import { strategicCompassV8Service } from "./strategicCompassV8";

// ─── Service Categories ──────────────────────────────────────────────────────

interface ServiceCostConfig {
  name: string;
  category: "compute" | "ai" | "email" | "sms" | "storage" | "payments" | "other";
  dataSource: string;       // agent codename to query
  metricsKeys: string[];    // which keys in the agent data contain cost/usage info
  optimizable: boolean;     // can Ledger propose optimizations?
}

const MONITORED_SERVICES: ServiceCostConfig[] = [
  {
    name: "OpenAI / AI Spend",
    category: "ai",
    dataSource: "ledger_finance",
    metricsKeys: ["aiSpendWeekly", "aiSpendMonthly", "semanticCacheHitRate", "tokensPerAgent"],
    optimizable: true,
  },
  {
    name: "Fly.io Compute",
    category: "compute",
    dataSource: "sentinel_devops",
    metricsKeys: ["computeCostMonthly", "avgCpuUtilization", "machineCount", "idleMachines"],
    optimizable: true,
  },
  {
    name: "SendGrid Email",
    category: "email",
    dataSource: "beacon_marketing",
    metricsKeys: ["emailCostMonthly", "emailsSent", "avgOpenRate", "inactiveRecipients"],
    optimizable: true,
  },
  {
    name: "Twilio SMS/Voice",
    category: "sms",
    dataSource: "sophie_csm",
    metricsKeys: ["smsCostMonthly", "smsVolume", "smsConversionRate"],
    optimizable: true,
  },
  {
    name: "AWS S3 Storage",
    category: "storage",
    dataSource: "atlas_cto",
    metricsKeys: ["storageCostMonthly", "storageGb", "storageGrowthRate"],
    optimizable: true,
  },
  {
    name: "Stripe Fees",
    category: "payments",
    dataSource: "forge_revenue",
    metricsKeys: ["stripeFeeMonthly", "transactionVolume", "avgTransactionSize"],
    optimizable: false,  // can't optimize Stripe fees directly
  },
];

// ─── Service ─────────────────────────────────────────────────────────────────

class SpendAutonomyService {

  /**
   * Run the weekly spend audit across all monitored services.
   * Returns a comprehensive spend report with optimization opportunities.
   */
  async runWeeklyAudit(): Promise<{
    totalBurn: number;
    services: Array<{
      name: string;
      category: string;
      cost: number;
      trend: "up" | "down" | "flat";
      trendPercent: number;
      utilization?: number;
    }>;
    optimizations: Array<{
      service: string;
      description: string;
      estimatedSavings: number;
      effort: "low" | "medium" | "high";
      autoExecutable: boolean;
    }>;
  }> {
    const compass = await strategicCompassV8Service.getActive();
    const spendMultiplier = (compass?.agentDirectives as any)?.ledger_finance?.spendMultiplier || 1.0;

    const serviceReports: any[] = [];
    const allOptimizations: any[] = [];

    // Gather data from all monitored services
    for (const service of MONITORED_SERVICES) {
      const data = await resolveAgentData(service.dataSource).catch(() => ({} as Record<string, any>));

      // Get previous watcher data for trend comparison
      const previousWatcher = await db.query.spendWatchers.findFirst({
        where: eq(spendWatchers.serviceName, service.name),
        orderBy: [desc(spendWatchers.createdAt)],
      });

      const currentCost = this.extractCost(data, service.metricsKeys);
      const previousCost = previousWatcher ? Number(previousWatcher.costAmount || 0) : currentCost;
      const trendPercent = previousCost > 0
        ? Math.round(((currentCost - previousCost) / previousCost) * 100)
        : 0;
      const trend = trendPercent > 5 ? "up" : trendPercent < -5 ? "down" : "flat";

      // Store current data point
      await db.insert(spendWatchers).values({
        serviceName: service.name,
        category: service.category,
        costAmount: currentCost.toString(),
        metrics: data,
        trend,
        trendPercent,
      });

      serviceReports.push({
        name: service.name,
        category: service.category,
        cost: currentCost,
        trend,
        trendPercent,
        utilization: data.avgCpuUtilization || data.semanticCacheHitRate || undefined,
      });

      // Generate optimization proposals for optimizable services
      if (service.optimizable && currentCost > 0) {
        const optimizations = await this.analyzeOptimization(service, data, currentCost, spendMultiplier);
        allOptimizations.push(...optimizations);
      }
    }

    // Store optimizations
    for (const opt of allOptimizations) {
      await db.insert(spendOptimizations).values({
        serviceName: opt.service,
        description: opt.description,
        estimatedSavings: opt.estimatedSavings.toString(),
        effort: opt.effort,
        autoExecutable: opt.autoExecutable,
        status: "proposed",
      });
    }

    const totalBurn = serviceReports.reduce((sum, s) => sum + s.cost, 0);

    return {
      totalBurn,
      services: serviceReports,
      optimizations: allOptimizations,
    };
  }

  /**
   * Analyze a specific service for optimization opportunities.
   */
  private async analyzeOptimization(
    service: ServiceCostConfig,
    data: Record<string, any>,
    currentCost: number,
    spendMultiplier: number,
  ): Promise<Array<{
    service: string;
    description: string;
    estimatedSavings: number;
    effort: "low" | "medium" | "high";
    autoExecutable: boolean;
  }>> {
    try {
      const response = await routeAITask({
        taskType: "spend_optimization",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: `You are Ledger, the Finance & Billing Lead. Analyze service spend data and identify concrete optimization opportunities. Be specific with dollar amounts. Only propose realistic, actionable optimizations.

Current spend multiplier from strategic compass: ${spendMultiplier}x (${spendMultiplier > 1 ? "growth mode — spending is encouraged" : spendMultiplier < 1 ? "efficiency mode — cuts are encouraged" : "balanced"})`,
          },
          {
            role: "user",
            content: `Service: ${service.name} (${service.category})
Current monthly cost: $${currentCost}
Data: ${JSON.stringify(data, null, 2)}

Identify 0-2 optimization opportunities. Only propose if there's a clear, quantifiable saving.

Respond in JSON:
{
  "optimizations": [
    {
      "description": "Specific, actionable optimization description",
      "estimatedSavings": 50,
      "effort": "low|medium|high",
      "autoExecutable": false
    }
  ]
}

If no optimizations are found, return: { "optimizations": [] }`,
          },
        ],
        responseFormat: "json",
        temperature: 0.3,
      });

      const parsed = JSON.parse(response.content);
      return (parsed.optimizations || []).map((opt: any) => ({
        service: service.name,
        description: opt.description,
        estimatedSavings: opt.estimatedSavings || 0,
        effort: opt.effort || "medium",
        autoExecutable: opt.autoExecutable || false,
      }));
    } catch {
      return [];
    }
  }

  /**
   * CEO approves a spend optimization.
   */
  async approveOptimization(optimizationId: number): Promise<void> {
    await db.update(spendOptimizations)
      .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(spendOptimizations.id, optimizationId));
  }

  /**
   * CEO skips an optimization.
   */
  async skipOptimization(optimizationId: number): Promise<void> {
    await db.update(spendOptimizations)
      .set({ status: "skipped", updatedAt: new Date() })
      .where(eq(spendOptimizations.id, optimizationId));
  }

  /**
   * Mark an optimization as executed.
   */
  async markExecuted(optimizationId: number, actualSavings?: number): Promise<void> {
    await db.update(spendOptimizations)
      .set({
        status: "executed",
        actualSavings: actualSavings?.toString() || null,
        executedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(spendOptimizations.id, optimizationId));
  }

  /** Get pending optimization proposals */
  async getPendingOptimizations(): Promise<SpendOptimization[]> {
    return db.query.spendOptimizations.findMany({
      where: eq(spendOptimizations.status, "proposed"),
      orderBy: [desc(spendOptimizations.estimatedSavings)],
    });
  }

  /** Get recent spend watchers */
  async getRecentWatchers(limit = 20): Promise<SpendWatcher[]> {
    return db.query.spendWatchers.findMany({
      orderBy: [desc(spendWatchers.createdAt)],
      limit,
    });
  }

  /** Get spend by category */
  async getSpendByCategory(): Promise<Array<{ category: string; totalCost: number }>> {
    const watchers = await db.query.spendWatchers.findMany({
      orderBy: [desc(spendWatchers.createdAt)],
    });

    // Get latest watcher per service
    const latestByService = new Map<string, any>();
    for (const w of watchers) {
      if (!latestByService.has(w.serviceName)) {
        latestByService.set(w.serviceName, w);
      }
    }

    const byCategory = new Map<string, number>();
    for (const w of latestByService.values()) {
      const current = byCategory.get(w.category) || 0;
      byCategory.set(w.category, current + Number(w.costAmount || 0));
    }

    return Array.from(byCategory.entries()).map(([category, totalCost]) => ({ category, totalCost }));
  }

  /** Extract cost from agent data */
  private extractCost(data: Record<string, any>, metricsKeys: string[]): number {
    for (const key of metricsKeys) {
      if (key.toLowerCase().includes("cost") || key.toLowerCase().includes("spend") || key.toLowerCase().includes("fee")) {
        const value = data[key];
        if (typeof value === "number") return value;
      }
    }
    return 0;
  }
}

export const spendAutonomyService = new SpendAutonomyService();
