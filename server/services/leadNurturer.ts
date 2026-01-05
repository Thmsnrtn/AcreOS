import { db } from "../db";
import { eq } from "drizzle-orm";
import { leads, type Lead, type NurturingStage, type InsertLeadActivity } from "@shared/schema";
import { storage } from "../storage";
import { usageMeteringService } from "./credits";
import { alertingService } from "./alerting";
import OpenAI from "openai";

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export type ScoreFactors = {
  responseRecency?: number;
  emailEngagement?: number;
  sourceBonus?: number;
  statusBonus?: number;
  recencyPenalty?: number;
  total?: number;
};

const SCORING_WEIGHTS = {
  responseWithin7Days: 40,
  emailOpenPoints: 10,
  maxEmailEngagement: 30,
  referralSourceBonus: 15,
  websiteSourceBonus: 10,
  negotiatingStatusBonus: 25,
  interestedStatusBonus: 15,
  respondedStatusBonus: 20,
  qualifiedStatusBonus: 20,
  acceptedStatusBonus: 35,
  underContractBonus: 35,
  deadStatusPenalty: -50,
  daysSinceContactPenalty: -2,
  maxRecencyPenalty: -20,
};

const STAGE_THRESHOLDS = {
  hot: 80,
  warm: 50,
  cold: 20,
};

export class LeadNurturerService {
  calculateLeadScore(lead: Lead): { score: number; factors: ScoreFactors } {
    const factors: ScoreFactors = {};
    let score = 50;

    const lastContact = lead.lastContactedAt || lead.createdAt;
    const daysSinceContact = lastContact 
      ? Math.floor((Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24))
      : 30;

    if (lead.responses && lead.responses > 0 && daysSinceContact <= 7) {
      factors.responseRecency = SCORING_WEIGHTS.responseWithin7Days;
      score += SCORING_WEIGHTS.responseWithin7Days;
    }

    const emailOpens = lead.emailOpens || 0;
    const emailClicks = lead.emailClicks || 0;
    const emailEngagement = Math.min(
      (emailOpens * SCORING_WEIGHTS.emailOpenPoints) + (emailClicks * 15),
      SCORING_WEIGHTS.maxEmailEngagement
    );
    if (emailEngagement > 0) {
      factors.emailEngagement = emailEngagement;
      score += emailEngagement;
    }

    let sourceBonus = 0;
    if (lead.source === "referral") {
      sourceBonus = SCORING_WEIGHTS.referralSourceBonus;
    } else if (lead.source === "website") {
      sourceBonus = SCORING_WEIGHTS.websiteSourceBonus;
    }
    if (sourceBonus > 0) {
      factors.sourceBonus = sourceBonus;
      score += sourceBonus;
    }

    let statusBonus = 0;
    switch (lead.status) {
      case "negotiating":
        statusBonus = SCORING_WEIGHTS.negotiatingStatusBonus;
        break;
      case "interested":
        statusBonus = SCORING_WEIGHTS.interestedStatusBonus;
        break;
      case "responded":
        statusBonus = SCORING_WEIGHTS.respondedStatusBonus;
        break;
      case "qualified":
        statusBonus = SCORING_WEIGHTS.qualifiedStatusBonus;
        break;
      case "accepted":
      case "under_contract":
        statusBonus = SCORING_WEIGHTS.acceptedStatusBonus;
        break;
      case "dead":
        statusBonus = SCORING_WEIGHTS.deadStatusPenalty;
        break;
    }
    if (statusBonus !== 0) {
      factors.statusBonus = statusBonus;
      score += statusBonus;
    }

    const recencyPenalty = Math.max(
      daysSinceContact * SCORING_WEIGHTS.daysSinceContactPenalty,
      SCORING_WEIGHTS.maxRecencyPenalty
    );
    if (recencyPenalty < 0) {
      factors.recencyPenalty = recencyPenalty;
      score += recencyPenalty;
    }

    score = Math.max(0, Math.min(100, score));
    factors.total = score;

    return { score, factors };
  }

  segmentLead(score: number): NurturingStage {
    if (score >= STAGE_THRESHOLDS.hot) return "hot";
    if (score >= STAGE_THRESHOLDS.warm) return "warm";
    if (score >= STAGE_THRESHOLDS.cold) return "cold";
    return "dead";
  }

  async generateFollowUp(lead: Lead): Promise<{ message: string; subject?: string } | null> {
    const openai = getOpenAIClient();
    if (!openai) {
      console.log("OpenAI API key not configured, skipping AI follow-up generation");
      return null;
    }

    const context = {
      firstName: lead.firstName,
      lastName: lead.lastName,
      type: lead.type,
      status: lead.status,
      source: lead.source,
      city: lead.city,
      state: lead.state,
      nurturingStage: lead.nurturingStage,
      daysSinceLastContact: lead.lastContactedAt
        ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24))
        : null,
    };

    const prompt = `You are a professional land investment company representative. Generate a personalized follow-up email for a lead.

Lead Context:
- Name: ${context.firstName} ${context.lastName}
- Type: ${context.type === "seller" ? "Property seller" : "Property buyer"}
- Current Status: ${context.status}
- Lead Source: ${context.source || "Unknown"}
- Location: ${context.city || ""}, ${context.state || ""}
- Engagement Level: ${context.nurturingStage}
${context.daysSinceLastContact ? `- Days since last contact: ${context.daysSinceLastContact}` : ""}

Generate a brief, professional follow-up email that:
1. Is warm but professional
2. References their situation appropriately
3. Includes a clear call-to-action
4. Is no more than 150 words

Respond in JSON format:
{
  "subject": "Email subject line",
  "message": "Email body text"
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return {
          subject: parsed.subject,
          message: parsed.message,
        };
      }
    } catch (error) {
      console.error("Error generating follow-up message:", error);
    }

    return null;
  }

  async scheduleFollowUp(leadId: number, date: Date): Promise<Lead> {
    const [updated] = await db
      .update(leads)
      .set({
        nextFollowUpAt: date,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))
      .returning();
    return updated;
  }

  getNextFollowUpDate(stage: NurturingStage): Date {
    const now = new Date();
    switch (stage) {
      case "hot":
        return new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
      case "warm":
        return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      case "cold":
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    }
  }

  async scoreLead(lead: Lead): Promise<Lead> {
    const { score, factors } = this.calculateLeadScore(lead);
    const stage = this.segmentLead(score);
    
    const updated = await storage.updateLeadScore(lead.id, score, factors);
    
    if (updated.nurturingStage !== stage) {
      await db
        .update(leads)
        .set({ nurturingStage: stage, updatedAt: new Date() })
        .where(eq(leads.id, lead.id));
    }

    return { ...updated, nurturingStage: stage };
  }

  async processLeadsForOrg(
    organizationId: number,
    options: { scoringLimit?: number; generateFollowUps?: boolean; checkAging?: boolean } = {}
  ): Promise<{
    scored: number;
    followUpsScheduled: number;
    followUpsGenerated: number;
    creditsUsed: number;
    agingAlertsCreated: number;
    errors: string[];
  }> {
    const JOB_TYPE = `lead_nurturing_${organizationId}`;
    const { scoringLimit = 50, generateFollowUps = true, checkAging = true } = options;
    const result = {
      scored: 0,
      followUpsScheduled: 0,
      followUpsGenerated: 0,
      creditsUsed: 0,
      agingAlertsCreated: 0,
      errors: [] as string[],
    };

    try {
      await storage.setJobStatus(JOB_TYPE, 'running');
      
      const cursor = await storage.getJobCursor(JOB_TYPE);
      const lastProcessedId = cursor?.lastProcessedId || 0;
      
      const leadsNeedingScoring = await storage.getLeadsNeedingScoring(organizationId, scoringLimit);
      const unprocessedLeads = leadsNeedingScoring.filter(l => l.id > lastProcessedId);
      
      let maxProcessedId = lastProcessedId;
      for (const lead of unprocessedLeads) {
        try {
          const scoredLead = await this.scoreLead(lead);
          result.scored++;

          const nextFollowUp = this.getNextFollowUpDate(scoredLead.nurturingStage as NurturingStage);
          await this.scheduleFollowUp(lead.id, nextFollowUp);
          result.followUpsScheduled++;

          await storage.createLeadActivity({
            organizationId,
            leadId: lead.id,
            type: "score_updated",
            description: `Score updated from ${lead.score || 'none'} to ${scoredLead.score}`,
            metadata: {
              oldScore: lead.score,
              newScore: scoredLead.score,
              factors: scoredLead.scoreFactors,
              stage: scoredLead.nurturingStage,
            },
          });
          maxProcessedId = Math.max(maxProcessedId, lead.id);
          await storage.updateJobCursor(JOB_TYPE, maxProcessedId, 'running');
        } catch (err) {
          result.errors.push(`Failed to score lead ${lead.id}: ${err}`);
        }
      }

      if (generateFollowUps) {
        const leadsDueForFollowUp = await storage.getLeadsDueForFollowUp(organizationId);
        
        for (const lead of leadsDueForFollowUp.slice(0, 10)) {
          if (lead.nurturingStage === "dead") continue;

          const usageResult = await usageMeteringService.recordUsage(
            organizationId,
            "ai_response",
            1,
            { feature: "lead_nurturing", leadId: lead.id }
          );

          if (usageResult.insufficientCredits) {
            result.errors.push(`Insufficient credits for AI follow-up on lead ${lead.id}`);
            break;
          }

          result.creditsUsed += 1;

          try {
            const followUp = await this.generateFollowUp(lead);
            
            if (followUp) {
              result.followUpsGenerated++;

              await storage.createLeadActivity({
                organizationId,
                leadId: lead.id,
                type: "ai_followup_generated",
                description: `AI generated follow-up: ${followUp.subject}`,
                metadata: {
                  subject: followUp.subject,
                  messagePreview: followUp.message.substring(0, 100),
                },
              });

              await db
                .update(leads)
                .set({
                  lastAIMessageAt: new Date(),
                  nextFollowUpAt: this.getNextFollowUpDate(lead.nurturingStage as NurturingStage),
                  updatedAt: new Date(),
                })
                .where(eq(leads.id, lead.id));
            }
          } catch (err) {
            result.errors.push(`Failed to generate follow-up for lead ${lead.id}: ${err}`);
          }
        }
      }
      
      await storage.setJobStatus(JOB_TYPE, 'idle');
    } catch (err) {
      result.errors.push(`Process error: ${err}`);
      await storage.setJobStatus(JOB_TYPE, 'failed');
    }

    if (checkAging) {
      try {
        const agingResult = await alertingService.checkLeadAging(organizationId);
        result.agingAlertsCreated = agingResult.alertsCreated;
      } catch (err) {
        result.errors.push(`Aging check error: ${err}`);
      }
    }

    return result;
  }

  async getLeadInsights(organizationId: number): Promise<{
    totalLeads: number;
    byStage: Record<NurturingStage, number>;
    averageScore: number;
    leadsNeedingAttention: number;
    recentActivity: { type: string; count: number }[];
  }> {
    const allLeads = await storage.getLeads(organizationId);
    
    const byStage: Record<NurturingStage, number> = {
      hot: 0,
      warm: 0,
      cold: 0,
      dead: 0,
      new: 0,
    };

    let totalScore = 0;
    let scoredCount = 0;
    let needingAttention = 0;

    for (const lead of allLeads) {
      const stage = (lead.nurturingStage || "new") as NurturingStage;
      byStage[stage] = (byStage[stage] || 0) + 1;

      if (lead.score !== null && lead.score !== undefined) {
        totalScore += lead.score;
        scoredCount++;
      }

      if (lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) <= new Date()) {
        needingAttention++;
      }
    }

    return {
      totalLeads: allLeads.length,
      byStage,
      averageScore: scoredCount > 0 ? Math.round(totalScore / scoredCount) : 0,
      leadsNeedingAttention: needingAttention,
      recentActivity: [],
    };
  }
}

export const leadNurturerService = new LeadNurturerService();
