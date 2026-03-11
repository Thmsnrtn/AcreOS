import { db } from "../db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  sequencePerformance,
  leads,
  leadActivities,
  agentEvents,
  campaignSequences,
  type SequencePerformance,
  type InsertSequencePerformance,
} from "@shared/schema";
import { getOpenAIClient } from "../utils/openaiClient";

export interface MessagePerformanceParams {
  sequenceId?: number;
  sequenceName: string;
  channel: "email" | "sms" | "mail";
  messagePosition: number;
  templateContent?: string;
  subjectLine?: string;
  event: "sent" | "delivered" | "opened" | "clicked" | "replied" | "converted" | "unsubscribed" | "bounced";
  variant?: string;
}

export interface SequenceAnalysis {
  sequenceId: number;
  sequenceName: string;
  totalMessages: number;
  overallMetrics: {
    totalSent: number;
    totalDelivered: number;
    totalOpened: number;
    totalClicked: number;
    totalReplied: number;
    totalConverted: number;
    averageOpenRate: number;
    averageClickRate: number;
    averageReplyRate: number;
    averageConversionRate: number;
  };
  messagePerformance: Array<{
    position: number;
    channel: string;
    sent: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
    conversionRate: number;
    isTopPerformer: boolean;
    isBottomPerformer: boolean;
  }>;
  bestPerformingMessage: number | null;
  worstPerformingMessage: number | null;
}

export interface OptimizationSuggestion {
  type: "subject_line" | "timing" | "content" | "segment" | "channel";
  suggestion: string;
  reasoning: string;
  priority: "high" | "medium" | "low";
  messagePosition?: number;
}

export interface ABTestSetup {
  performanceRecordIds: number[];
  testName: string;
  variants: string[];
  startedAt: Date;
}

export interface ABTestResult {
  hasWinner: boolean;
  winningVariant?: string;
  confidenceLevel: number;
  sampleSizeReached: boolean;
  metrics: Record<string, {
    sent: number;
    delivered: number;
    opened: number;
    replied: number;
    openRate: number;
    replyRate: number;
  }>;
}

export interface ChannelPerformance {
  channel: string;
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  totalConverted: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  conversionRate: number;
  costEfficiency: number;
}

const MIN_SAMPLE_SIZE = 100;
const STATISTICAL_CONFIDENCE_THRESHOLD = 0.95;

export class SequenceOptimizerService {
  async recordMessagePerformance(
    organizationId: number,
    params: MessagePerformanceParams
  ): Promise<SequencePerformance> {
    const {
      sequenceId,
      sequenceName,
      channel,
      messagePosition,
      templateContent,
      subjectLine,
      event,
      variant,
    } = params;

    const existing = await db.query.sequencePerformance.findFirst({
      where: and(
        eq(sequencePerformance.organizationId, organizationId),
        eq(sequencePerformance.sequenceName, sequenceName),
        eq(sequencePerformance.messagePosition, messagePosition),
        eq(sequencePerformance.channel, channel),
        variant ? eq(sequencePerformance.variant, variant) : sql`${sequencePerformance.variant} IS NULL`
      ),
    });

    if (existing) {
      const updates: Partial<SequencePerformance> = {
        updatedAt: new Date(),
      };

      switch (event) {
        case "sent":
          updates.totalSent = (existing.totalSent || 0) + 1;
          break;
        case "delivered":
          updates.delivered = (existing.delivered || 0) + 1;
          break;
        case "opened":
          updates.opened = (existing.opened || 0) + 1;
          break;
        case "clicked":
          updates.clicked = (existing.clicked || 0) + 1;
          break;
        case "replied":
          updates.replied = (existing.replied || 0) + 1;
          break;
        case "converted":
          updates.converted = (existing.converted || 0) + 1;
          break;
        case "unsubscribed":
          updates.unsubscribed = (existing.unsubscribed || 0) + 1;
          break;
        case "bounced":
          updates.bounced = (existing.bounced || 0) + 1;
          break;
      }

      const delivered = updates.delivered ?? existing.delivered ?? 0;
      const opened = updates.opened ?? existing.opened ?? 0;
      const clicked = updates.clicked ?? existing.clicked ?? 0;
      const replied = updates.replied ?? existing.replied ?? 0;
      const converted = updates.converted ?? existing.converted ?? 0;

      if (delivered > 0) {
        updates.openRate = (opened / delivered).toFixed(4);
        updates.replyRate = (replied / delivered).toFixed(4);
        updates.conversionRate = (converted / delivered).toFixed(4);
      }
      if (opened > 0) {
        updates.clickRate = (clicked / opened).toFixed(4);
      }

      const [updated] = await db
        .update(sequencePerformance)
        .set(updates)
        .where(eq(sequencePerformance.id, existing.id))
        .returning();

      return updated;
    } else {
      const newRecord: InsertSequencePerformance = {
        organizationId,
        sequenceId: sequenceId ?? null,
        sequenceName,
        channel,
        messagePosition,
        templateContent: templateContent ?? null,
        subjectLine: subjectLine ?? null,
        variant: variant ?? null,
        totalSent: event === "sent" ? 1 : 0,
        delivered: event === "delivered" ? 1 : 0,
        opened: event === "opened" ? 1 : 0,
        clicked: event === "clicked" ? 1 : 0,
        replied: event === "replied" ? 1 : 0,
        converted: event === "converted" ? 1 : 0,
        unsubscribed: event === "unsubscribed" ? 1 : 0,
        bounced: event === "bounced" ? 1 : 0,
        openRate: "0",
        clickRate: "0",
        replyRate: "0",
        conversionRate: "0",
      };

      const [created] = await db
        .insert(sequencePerformance)
        .values(newRecord)
        .returning();

      return created;
    }
  }

  async analyzeSequencePerformance(
    organizationId: number,
    sequenceId: number
  ): Promise<SequenceAnalysis> {
    const sequence = await db.query.campaignSequences.findFirst({
      where: and(
        eq(campaignSequences.id, sequenceId),
        eq(campaignSequences.organizationId, organizationId)
      ),
    });

    if (!sequence) {
      throw new Error(`Sequence ${sequenceId} not found`);
    }

    const performanceRecords = await db.query.sequencePerformance.findMany({
      where: and(
        eq(sequencePerformance.organizationId, organizationId),
        eq(sequencePerformance.sequenceId, sequenceId)
      ),
      orderBy: [sequencePerformance.messagePosition],
    });

    let totalSent = 0;
    let totalDelivered = 0;
    let totalOpened = 0;
    let totalClicked = 0;
    let totalReplied = 0;
    let totalConverted = 0;

    const messagePerformance = performanceRecords.map((record) => {
      const sent = record.totalSent || 0;
      const delivered = record.delivered || 0;
      const opened = record.opened || 0;
      const clicked = record.clicked || 0;
      const replied = record.replied || 0;
      const converted = record.converted || 0;

      totalSent += sent;
      totalDelivered += delivered;
      totalOpened += opened;
      totalClicked += clicked;
      totalReplied += replied;
      totalConverted += converted;

      const openRate = delivered > 0 ? (opened / delivered) * 100 : 0;
      const clickRate = opened > 0 ? (clicked / opened) * 100 : 0;
      const replyRate = delivered > 0 ? (replied / delivered) * 100 : 0;
      const conversionRate = delivered > 0 ? (converted / delivered) * 100 : 0;

      return {
        position: record.messagePosition,
        channel: record.channel,
        sent,
        openRate: Number(openRate.toFixed(2)),
        clickRate: Number(clickRate.toFixed(2)),
        replyRate: Number(replyRate.toFixed(2)),
        conversionRate: Number(conversionRate.toFixed(2)),
        isTopPerformer: false,
        isBottomPerformer: false,
      };
    });

    if (messagePerformance.length > 0) {
      const sortedByReply = [...messagePerformance].sort(
        (a, b) => b.replyRate - a.replyRate
      );
      sortedByReply[0].isTopPerformer = true;
      sortedByReply[sortedByReply.length - 1].isBottomPerformer = true;
    }

    const bestPerformingMessage =
      messagePerformance.find((m) => m.isTopPerformer)?.position ?? null;
    const worstPerformingMessage =
      messagePerformance.find((m) => m.isBottomPerformer)?.position ?? null;

    const count = messagePerformance.length || 1;
    const averageOpenRate =
      messagePerformance.reduce((acc, m) => acc + m.openRate, 0) / count;
    const averageClickRate =
      messagePerformance.reduce((acc, m) => acc + m.clickRate, 0) / count;
    const averageReplyRate =
      messagePerformance.reduce((acc, m) => acc + m.replyRate, 0) / count;
    const averageConversionRate =
      messagePerformance.reduce((acc, m) => acc + m.conversionRate, 0) / count;

    return {
      sequenceId,
      sequenceName: sequence.name,
      totalMessages: messagePerformance.length,
      overallMetrics: {
        totalSent,
        totalDelivered,
        totalOpened,
        totalClicked,
        totalReplied,
        totalConverted,
        averageOpenRate: Number(averageOpenRate.toFixed(2)),
        averageClickRate: Number(averageClickRate.toFixed(2)),
        averageReplyRate: Number(averageReplyRate.toFixed(2)),
        averageConversionRate: Number(averageConversionRate.toFixed(2)),
      },
      messagePerformance,
      bestPerformingMessage,
      worstPerformingMessage,
    };
  }

  async generateOptimizationSuggestions(
    organizationId: number,
    sequenceId: number
  ): Promise<OptimizationSuggestion[]> {
    const analysis = await this.analyzeSequencePerformance(organizationId, sequenceId);

    const performanceRecords = await db.query.sequencePerformance.findMany({
      where: and(
        eq(sequencePerformance.organizationId, organizationId),
        eq(sequencePerformance.sequenceId, sequenceId)
      ),
    });

    const openai = getOpenAIClient();
    if (!openai) {
      console.log("OpenAI API key not configured, using fallback suggestions");
      return this.generateFallbackSuggestions(analysis);
    }

    const prompt = `You are a marketing sequence optimization expert for land investment outreach. Analyze this sequence performance and provide specific, actionable suggestions.

Sequence: ${analysis.sequenceName}
Total Messages: ${analysis.totalMessages}

Overall Metrics:
- Total Sent: ${analysis.overallMetrics.totalSent}
- Average Open Rate: ${analysis.overallMetrics.averageOpenRate}%
- Average Click Rate: ${analysis.overallMetrics.averageClickRate}%
- Average Reply Rate: ${analysis.overallMetrics.averageReplyRate}%
- Average Conversion Rate: ${analysis.overallMetrics.averageConversionRate}%

Per-Message Performance:
${analysis.messagePerformance
  .map(
    (m) =>
      `- Position ${m.position} (${m.channel}): Open ${m.openRate}%, Click ${m.clickRate}%, Reply ${m.replyRate}%, Convert ${m.conversionRate}%${m.isTopPerformer ? " [TOP]" : ""}${m.isBottomPerformer ? " [BOTTOM]" : ""}`
  )
  .join("\n")}

Subject Lines in Use:
${performanceRecords.filter(r => r.subjectLine).map(r => `- Position ${r.messagePosition}: "${r.subjectLine}"`).join("\n") || "None tracked"}

Provide 3-5 specific optimization suggestions. For each suggestion:
1. Type: one of "subject_line", "timing", "content", "segment", or "channel"
2. Specific actionable suggestion
3. Clear reasoning
4. Priority: "high", "medium", or "low"
5. Message position if applicable

Respond in JSON:
{
  "suggestions": [
    {
      "type": "subject_line",
      "suggestion": "...",
      "reasoning": "...",
      "priority": "high",
      "messagePosition": 2
    }
  ]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        const suggestions = parsed.suggestions || [];

        for (const record of performanceRecords) {
          await db
            .update(sequencePerformance)
            .set({
              optimizationSuggestions: {
                subjectLineSuggestions: suggestions
                  .filter((s: OptimizationSuggestion) => s.type === "subject_line" && s.messagePosition === record.messagePosition)
                  .map((s: OptimizationSuggestion) => s.suggestion),
                timingSuggestions: suggestions
                  .filter((s: OptimizationSuggestion) => s.type === "timing" && s.messagePosition === record.messagePosition)
                  .map((s: OptimizationSuggestion) => s.suggestion),
                contentSuggestions: suggestions
                  .filter((s: OptimizationSuggestion) => s.type === "content" && s.messagePosition === record.messagePosition)
                  .map((s: OptimizationSuggestion) => s.suggestion),
                segmentSuggestions: suggestions
                  .filter((s: OptimizationSuggestion) => s.type === "segment")
                  .map((s: OptimizationSuggestion) => s.suggestion),
                confidence: 0.8,
                lastOptimizedAt: new Date().toISOString(),
              },
              updatedAt: new Date(),
            })
            .where(eq(sequencePerformance.id, record.id));
        }

        return suggestions;
      }
    } catch (error) {
      console.error("Error generating AI optimization suggestions:", error);
      return this.generateFallbackSuggestions(analysis);
    }

    return [];
  }

  private generateFallbackSuggestions(analysis: SequenceAnalysis): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    if (analysis.overallMetrics.averageOpenRate < 20) {
      suggestions.push({
        type: "subject_line",
        suggestion:
          "Personalize subject lines with property address or owner name. Use curiosity-driven language like 'Quick question about your land' or 'Regarding your property at [address]'",
        reasoning: `Average open rate of ${analysis.overallMetrics.averageOpenRate}% is below benchmark. Subject lines are the primary driver of open rates.`,
        priority: "high",
      });
    }

    if (analysis.overallMetrics.averageReplyRate < 2) {
      suggestions.push({
        type: "content",
        suggestion:
          "Add a clear, easy call-to-action. Ask a simple yes/no question or include a direct phone number. Make responding as frictionless as possible.",
        reasoning: `Reply rate of ${analysis.overallMetrics.averageReplyRate}% suggests content may not be compelling enough to prompt response.`,
        priority: "high",
      });
    }

    if (analysis.worstPerformingMessage !== null) {
      const worst = analysis.messagePerformance.find(
        (m) => m.position === analysis.worstPerformingMessage
      );
      if (worst && worst.replyRate < 1) {
        suggestions.push({
          type: "content",
          suggestion: `Rewrite message at position ${worst.position}. Consider a different angle - urgency, empathy, or value proposition.`,
          reasoning: `Position ${worst.position} has the lowest reply rate (${worst.replyRate}%) and may be causing sequence drop-off.`,
          priority: "high",
          messagePosition: worst.position,
        });
      }
    }

    if (analysis.totalMessages > 3) {
      suggestions.push({
        type: "timing",
        suggestion:
          "Test shorter intervals between early messages (2-3 days vs 5-7 days) to maintain momentum while leads are still warm.",
        reasoning:
          "With multiple touchpoints, timing optimization can significantly impact overall conversion.",
        priority: "medium",
      });
    }

    return suggestions;
  }

  async identifyBestPerformingSegments(
    organizationId: number,
    sequenceId: number
  ): Promise<Array<{ segment: string; replyRate: number; sampleSize: number }>> {
    const recentActivities = await db.query.leadActivities.findMany({
      where: and(
        eq(leadActivities.organizationId, organizationId),
        sql`${leadActivities.metadata}->>'sequenceId' = ${sequenceId.toString()}`
      ),
      limit: 1000,
    });

    const leadIds = Array.from(new Set(recentActivities.map((a) => a.leadId)));

    if (leadIds.length === 0) {
      return [];
    }

    const leadRecords = await db.query.leads.findMany({
      where: and(
        eq(leads.organizationId, organizationId),
        inArray(leads.id, leadIds)
      ),
    });

    const segmentStats: Record<string, { sent: number; replied: number }> = {};

    for (const lead of leadRecords) {
      const segments = [
        lead.state ? `state:${lead.state}` : null,
        lead.source ? `source:${lead.source}` : null,
        lead.nurturingStage ? `stage:${lead.nurturingStage}` : null,
      ].filter(Boolean) as string[];

      const activities = recentActivities.filter((a) => a.leadId === lead.id);
      const wasSent = activities.some((a) => a.type.includes("sent"));
      const hasReplied = activities.some((a) => a.type.includes("reply") || a.type.includes("response"));

      for (const segment of segments) {
        if (!segmentStats[segment]) {
          segmentStats[segment] = { sent: 0, replied: 0 };
        }
        if (wasSent) {
          segmentStats[segment].sent++;
          if (hasReplied) {
            segmentStats[segment].replied++;
          }
        }
      }
    }

    const segments = Object.entries(segmentStats)
      .filter(([, stats]) => stats.sent >= 10)
      .map(([segment, stats]) => ({
        segment,
        replyRate: Number(((stats.replied / stats.sent) * 100).toFixed(2)),
        sampleSize: stats.sent,
      }))
      .sort((a, b) => b.replyRate - a.replyRate);

    const performanceRecords = await db.query.sequencePerformance.findMany({
      where: and(
        eq(sequencePerformance.organizationId, organizationId),
        eq(sequencePerformance.sequenceId, sequenceId)
      ),
    });

    for (const record of performanceRecords) {
      await db
        .update(sequencePerformance)
        .set({
          bestPerformingSegments: segments.slice(0, 5),
          updatedAt: new Date(),
        })
        .where(eq(sequencePerformance.id, record.id));
    }

    return segments;
  }

  async runABTest(
    organizationId: number,
    sequenceId: number,
    messagePosition: number,
    variants: Array<{ name: string; subjectLine?: string; content?: string }>
  ): Promise<ABTestSetup> {
    const performanceRecordIds: number[] = [];

    for (const variant of variants) {
      const existing = await db.query.sequencePerformance.findFirst({
        where: and(
          eq(sequencePerformance.organizationId, organizationId),
          eq(sequencePerformance.sequenceId, sequenceId),
          eq(sequencePerformance.messagePosition, messagePosition),
          eq(sequencePerformance.variant, variant.name)
        ),
      });

      if (existing) {
        await db
          .update(sequencePerformance)
          .set({
            totalSent: 0,
            delivered: 0,
            opened: 0,
            clicked: 0,
            replied: 0,
            converted: 0,
            openRate: "0",
            clickRate: "0",
            replyRate: "0",
            conversionRate: "0",
            isWinner: false,
            updatedAt: new Date(),
          })
          .where(eq(sequencePerformance.id, existing.id));
        performanceRecordIds.push(existing.id);
      } else {
        const sequence = await db.query.campaignSequences.findFirst({
          where: eq(campaignSequences.id, sequenceId),
        });

        const [created] = await db
          .insert(sequencePerformance)
          .values({
            organizationId,
            sequenceId,
            sequenceName: sequence?.name || `Sequence ${sequenceId}`,
            channel: "email",
            messagePosition,
            variant: variant.name,
            subjectLine: variant.subjectLine,
            templateContent: variant.content,
            totalSent: 0,
            delivered: 0,
            opened: 0,
            clicked: 0,
            replied: 0,
            converted: 0,
            isWinner: false,
          })
          .returning();
        performanceRecordIds.push(created.id);
      }
    }

    await db.insert(agentEvents).values({
      organizationId,
      eventType: "ab_test_started",
      eventSource: "sequence_optimizer",
      payload: {
        sequenceId,
        messagePosition,
        variants: variants.map((v) => v.name),
        startedAt: new Date().toISOString(),
      },
      relatedEntityType: "sequence",
      relatedEntityId: sequenceId,
    });

    return {
      performanceRecordIds,
      testName: `Position ${messagePosition} A/B Test`,
      variants: variants.map((v) => v.name),
      startedAt: new Date(),
    };
  }

  async determineABTestWinner(performanceRecordId: number): Promise<ABTestResult> {
    const record = await db.query.sequencePerformance.findFirst({
      where: eq(sequencePerformance.id, performanceRecordId),
    });

    if (!record || !record.variant) {
      throw new Error("Performance record not found or not part of an A/B test");
    }

    const allVariants = await db.query.sequencePerformance.findMany({
      where: and(
        eq(sequencePerformance.organizationId, record.organizationId),
        eq(sequencePerformance.sequenceId!, record.sequenceId!),
        eq(sequencePerformance.messagePosition, record.messagePosition)
      ),
    });

    const variantMetrics: Record<
      string,
      {
        sent: number;
        delivered: number;
        opened: number;
        replied: number;
        openRate: number;
        replyRate: number;
      }
    > = {};

    let totalSampleSize = 0;

    for (const v of allVariants) {
      if (!v.variant) continue;

      const sent = v.totalSent || 0;
      const delivered = v.delivered || 0;
      const opened = v.opened || 0;
      const replied = v.replied || 0;

      totalSampleSize += sent;

      variantMetrics[v.variant] = {
        sent,
        delivered,
        opened,
        replied,
        openRate: delivered > 0 ? (opened / delivered) * 100 : 0,
        replyRate: delivered > 0 ? (replied / delivered) * 100 : 0,
      };
    }

    const sampleSizeReached = totalSampleSize >= MIN_SAMPLE_SIZE;

    if (!sampleSizeReached) {
      return {
        hasWinner: false,
        confidenceLevel: 0,
        sampleSizeReached: false,
        metrics: variantMetrics,
      };
    }

    const variantNames = Object.keys(variantMetrics);
    if (variantNames.length < 2) {
      return {
        hasWinner: false,
        confidenceLevel: 0,
        sampleSizeReached: true,
        metrics: variantMetrics,
      };
    }

    let bestVariant = variantNames[0];
    let bestReplyRate = variantMetrics[bestVariant].replyRate;

    for (const name of variantNames) {
      if (variantMetrics[name].replyRate > bestReplyRate) {
        bestReplyRate = variantMetrics[name].replyRate;
        bestVariant = name;
      }
    }

    const confidenceLevel = this.calculateConfidence(variantMetrics, bestVariant);

    const hasWinner = confidenceLevel >= STATISTICAL_CONFIDENCE_THRESHOLD;

    return {
      hasWinner,
      winningVariant: hasWinner ? bestVariant : undefined,
      confidenceLevel: Number(confidenceLevel.toFixed(3)),
      sampleSizeReached: true,
      metrics: variantMetrics,
    };
  }

  private calculateConfidence(
    metrics: Record<string, { sent: number; replyRate: number }>,
    leader: string
  ): number {
    const variantNames = Object.keys(metrics).filter((n) => n !== leader);
    if (variantNames.length === 0) return 0;

    const leaderStats = metrics[leader];
    let minConfidence = 1;

    for (const name of variantNames) {
      const other = metrics[name];
      const diff = leaderStats.replyRate - other.replyRate;
      const combinedSample = leaderStats.sent + other.sent;

      if (combinedSample < 50 || diff <= 0) {
        minConfidence = Math.min(minConfidence, 0.5);
        continue;
      }

      const relativeLift = diff / (other.replyRate || 1);
      const sampleFactor = Math.min(combinedSample / MIN_SAMPLE_SIZE, 1);
      const confidence = Math.min(0.5 + relativeLift * sampleFactor * 0.5, 0.99);

      minConfidence = Math.min(minConfidence, confidence);
    }

    return minConfidence;
  }

  async applyWinningVariant(
    sequenceId: number,
    messagePosition: number
  ): Promise<{ applied: boolean; winningVariant?: string }> {
    const variants = await db.query.sequencePerformance.findMany({
      where: and(
        eq(sequencePerformance.sequenceId, sequenceId),
        eq(sequencePerformance.messagePosition, messagePosition),
        sql`${sequencePerformance.variant} IS NOT NULL`
      ),
    });

    if (variants.length === 0) {
      return { applied: false };
    }

    const firstRecord = variants[0];
    const testResult = await this.determineABTestWinner(firstRecord.id);

    if (!testResult.hasWinner || !testResult.winningVariant) {
      return { applied: false };
    }

    const winner = variants.find((v) => v.variant === testResult.winningVariant);

    if (winner) {
      await db
        .update(sequencePerformance)
        .set({ isWinner: false, updatedAt: new Date() })
        .where(
          and(
            eq(sequencePerformance.sequenceId, sequenceId),
            eq(sequencePerformance.messagePosition, messagePosition)
          )
        );

      await db
        .update(sequencePerformance)
        .set({ isWinner: true, updatedAt: new Date() })
        .where(eq(sequencePerformance.id, winner.id));

      await db.insert(agentEvents).values({
        organizationId: winner.organizationId,
        eventType: "ab_test_winner_applied",
        eventSource: "sequence_optimizer",
        payload: {
          sequenceId,
          messagePosition,
          winningVariant: testResult.winningVariant,
          metrics: testResult.metrics,
        },
        relatedEntityType: "sequence",
        relatedEntityId: sequenceId,
      });

      return { applied: true, winningVariant: testResult.winningVariant };
    }

    return { applied: false };
  }

  async getSequenceHealthScore(
    organizationId: number,
    sequenceId: number
  ): Promise<{
    score: number;
    status: "healthy" | "needs_attention" | "critical";
    factors: Array<{ name: string; score: number; weight: number }>;
  }> {
    const analysis = await this.analyzeSequencePerformance(organizationId, sequenceId);

    const factors: Array<{ name: string; score: number; weight: number }> = [];

    const openRateScore = Math.min(analysis.overallMetrics.averageOpenRate / 30, 1) * 100;
    factors.push({ name: "Open Rate", score: openRateScore, weight: 0.2 });

    const clickRateScore = Math.min(analysis.overallMetrics.averageClickRate / 10, 1) * 100;
    factors.push({ name: "Click Rate", score: clickRateScore, weight: 0.15 });

    const replyRateScore = Math.min(analysis.overallMetrics.averageReplyRate / 5, 1) * 100;
    factors.push({ name: "Reply Rate", score: replyRateScore, weight: 0.35 });

    const conversionScore = Math.min(analysis.overallMetrics.averageConversionRate / 3, 1) * 100;
    factors.push({ name: "Conversion Rate", score: conversionScore, weight: 0.3 });

    const weightedScore = factors.reduce(
      (acc, f) => acc + f.score * f.weight,
      0
    );
    const score = Math.round(weightedScore);

    let status: "healthy" | "needs_attention" | "critical";
    if (score >= 70) {
      status = "healthy";
    } else if (score >= 40) {
      status = "needs_attention";
    } else {
      status = "critical";
    }

    return { score, status, factors };
  }

  async getChannelPerformanceComparison(
    organizationId: number
  ): Promise<ChannelPerformance[]> {
    const allRecords = await db.query.sequencePerformance.findMany({
      where: eq(sequencePerformance.organizationId, organizationId),
    });

    const channelStats: Record<
      string,
      {
        totalSent: number;
        totalDelivered: number;
        totalOpened: number;
        totalClicked: number;
        totalReplied: number;
        totalConverted: number;
      }
    > = {};

    for (const record of allRecords) {
      const channel = record.channel;
      if (!channelStats[channel]) {
        channelStats[channel] = {
          totalSent: 0,
          totalDelivered: 0,
          totalOpened: 0,
          totalClicked: 0,
          totalReplied: 0,
          totalConverted: 0,
        };
      }

      channelStats[channel].totalSent += record.totalSent || 0;
      channelStats[channel].totalDelivered += record.delivered || 0;
      channelStats[channel].totalOpened += record.opened || 0;
      channelStats[channel].totalClicked += record.clicked || 0;
      channelStats[channel].totalReplied += record.replied || 0;
      channelStats[channel].totalConverted += record.converted || 0;
    }

    const costPerMessage: Record<string, number> = {
      email: 0.002,
      sms: 0.01,
      mail: 0.75,
    };

    return Object.entries(channelStats).map(([channel, stats]) => {
      const openRate =
        stats.totalDelivered > 0
          ? (stats.totalOpened / stats.totalDelivered) * 100
          : 0;
      const clickRate =
        stats.totalOpened > 0
          ? (stats.totalClicked / stats.totalOpened) * 100
          : 0;
      const replyRate =
        stats.totalDelivered > 0
          ? (stats.totalReplied / stats.totalDelivered) * 100
          : 0;
      const conversionRate =
        stats.totalDelivered > 0
          ? (stats.totalConverted / stats.totalDelivered) * 100
          : 0;

      const cost = stats.totalSent * (costPerMessage[channel] || 0.01);
      const costEfficiency =
        stats.totalConverted > 0 ? cost / stats.totalConverted : cost;

      return {
        channel,
        totalSent: stats.totalSent,
        totalDelivered: stats.totalDelivered,
        totalOpened: stats.totalOpened,
        totalClicked: stats.totalClicked,
        totalReplied: stats.totalReplied,
        totalConverted: stats.totalConverted,
        openRate: Number(openRate.toFixed(2)),
        clickRate: Number(clickRate.toFixed(2)),
        replyRate: Number(replyRate.toFixed(2)),
        conversionRate: Number(conversionRate.toFixed(2)),
        costEfficiency: Number(costEfficiency.toFixed(2)),
      };
    });
  }
}

export const sequenceOptimizerService = new SequenceOptimizerService();
