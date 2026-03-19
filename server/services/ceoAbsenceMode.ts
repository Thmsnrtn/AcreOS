// @ts-nocheck
/**
 * CEO Absence Mode — Sovereign Company Protocol v6
 *
 * "I'm away for 3 days." Everything changes:
 * - Agent trust scores temporarily boosted (they can do more autonomously)
 * - Non-urgent decisions batched (no notification spam)
 * - Only true emergencies break through
 * - When CEO returns: comprehensive summary of everything that happened
 *
 * This is the ultimate test of the self-running company.
 * If your AI team can't run things for 3 days, the system isn't ready.
 */

import { db } from "../db";
import { ceoAbsenceMode, companyAgents } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AbsenceConfig {
  durationHours: number;
  trustBoost?: number;       // default 15
  emergencyOnly?: boolean;   // only break through for critical
}

interface BatchedItem {
  type: string;
  summary: string;
  agentCodename: string;
  priority: string;
  timestamp: string;
  data?: any;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class CEOAbsenceService {

  /** Activate absence mode */
  async activate(config: AbsenceConfig): Promise<number> {
    // Deactivate any existing absence mode
    await this.deactivate();

    const endsAt = new Date(Date.now() + config.durationHours * 60 * 60 * 1000);
    const trustBoost = config.trustBoost || 15;

    const [absence] = await db.insert(ceoAbsenceMode).values({
      isActive: true,
      startedAt: new Date(),
      endsAt,
      trustBoost,
      batchedItems: [],
      emergencyBreaks: [],
    }).returning({ id: ceoAbsenceMode.id });

    // Boost all agent trust scores temporarily
    const agents = await companyAgentService.getAll();
    for (const agent of agents) {
      await companyAgentService.updateTrustScore(agent.codename, trustBoost);
    }

    return absence.id;
  }

  /** Deactivate absence mode and generate return briefing */
  async deactivate(): Promise<string | null> {
    const current = await this.getCurrent();
    if (!current) return null;

    // Restore trust scores (remove boost)
    const agents = await companyAgentService.getAll();
    for (const agent of agents) {
      await companyAgentService.updateTrustScore(agent.codename, -(current.trustBoost || 15));
    }

    // Generate return briefing
    const briefing = await this.generateReturnBriefing(current);

    await db.update(ceoAbsenceMode)
      .set({
        isActive: false,
        returnBriefing: briefing,
        updatedAt: new Date(),
      })
      .where(eq(ceoAbsenceMode.id, current.id));

    return briefing;
  }

  /** Check if absence mode is currently active */
  async isActive(): Promise<boolean> {
    const current = await this.getCurrent();
    if (!current) return false;

    // Auto-deactivate if past end time
    if (current.endsAt && new Date() > new Date(current.endsAt)) {
      await this.deactivate();
      return false;
    }

    return true;
  }

  /** Get current absence mode record */
  async getCurrent(): Promise<any | null> {
    return db.query.ceoAbsenceMode.findFirst({
      where: eq(ceoAbsenceMode.isActive, true),
      orderBy: [desc(ceoAbsenceMode.createdAt)],
    });
  }

  /** Get the most recent absence record (active or not) */
  async getLatest(): Promise<any | null> {
    return db.query.ceoAbsenceMode.findFirst({
      orderBy: [desc(ceoAbsenceMode.createdAt)],
    });
  }

  /** Batch a non-urgent item for when the CEO returns */
  async batchItem(item: BatchedItem): Promise<void> {
    const current = await this.getCurrent();
    if (!current) return;

    const batchedItems = [...((current.batchedItems as BatchedItem[]) || []), item];

    await db.update(ceoAbsenceMode)
      .set({ batchedItems, updatedAt: new Date() })
      .where(eq(ceoAbsenceMode.id, current.id));
  }

  /** Record an emergency break (something so critical it had to interrupt) */
  async recordEmergencyBreak(agentCodename: string, reason: string, actionTaken: string): Promise<void> {
    const current = await this.getCurrent();
    if (!current) return;

    const emergencyBreaks = [...((current.emergencyBreaks as any[]) || []), {
      agentCodename,
      reason,
      timestamp: new Date().toISOString(),
      actionTaken,
    }];

    await db.update(ceoAbsenceMode)
      .set({ emergencyBreaks, updatedAt: new Date() })
      .where(eq(ceoAbsenceMode.id, current.id));
  }

  /** Should a notification break through absence mode? */
  shouldBreakThrough(priority: string, severity: string): boolean {
    // Only critical/emergency items break through
    return priority === "critical" || severity === "critical";
  }

  /** Generate the return briefing — everything that happened while CEO was away */
  private async generateReturnBriefing(absence: any): Promise<string> {
    const batchedItems = (absence.batchedItems as BatchedItem[]) || [];
    const emergencyBreaks = (absence.emergencyBreaks as any[]) || [];
    const startedAt = new Date(absence.startedAt);
    const hoursAway = Math.round((Date.now() - startedAt.getTime()) / (1000 * 60 * 60));

    // Get agent reports for the period
    const agents = await companyAgentService.getAll();
    const agentSummaries: string[] = [];
    for (const agent of agents.slice(0, 5)) { // Top 5 by trust
      try {
        const report = await companyAgentService.generateReport(agent.codename);
        agentSummaries.push(`${agent.title}: ${report.summary}`);
      } catch {}
    }

    try {
      const response = await routeAITask({
        taskType: "return_briefing",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are generating a "Welcome Back" briefing for a CEO who was away. Be concise, organized, and highlight what matters most. Use sections.`,
          },
          {
            role: "user",
            content: `Generate a return briefing for a CEO who was away for ${hoursAway} hours.

Emergencies that occurred (${emergencyBreaks.length}):
${emergencyBreaks.map(e => `- ${e.agentCodename}: ${e.reason} → ${e.actionTaken}`).join("\n") || "None — all clear."}

Batched items waiting for review (${batchedItems.length}):
${batchedItems.slice(0, 10).map(i => `- [${i.priority}] ${i.agentCodename}: ${i.summary}`).join("\n") || "None."}
${batchedItems.length > 10 ? `... and ${batchedItems.length - 10} more` : ""}

Agent status reports:
${agentSummaries.join("\n")}

Write a brief, scannable return briefing. Start with the most important thing. Use plain language.`,
          },
        ],
        maxTokens: 500,
        temperature: 0.3,
      });

      return response.content;
    } catch {
      return `Welcome back. You were away for ${hoursAway} hours. ${emergencyBreaks.length} emergencies handled. ${batchedItems.length} items batched for your review.`;
    }
  }
}

export const ceoAbsenceService = new CEOAbsenceService();
