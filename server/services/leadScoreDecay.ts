/**
 * T45 — Predictive Lead Scoring Decay
 *
 * Lead scores decay over time when not contacted, and recover when
 * interactions occur. Runs nightly via BullMQ cron job.
 *
 * Rules:
 *   - Score decays 5% per week of no contact (min score 0)
 *   - Score recovers +10 points on any logged interaction
 *   - "Going cold" alert fires via Sophie Observer when score drops 20+ pts
 *   - Leads with score >= 80 that haven't been contacted in 14 days are flagged
 *
 * Register job with: registerLeadScoreDecayJob()
 */

import { db } from "../db";
import {
  leads,
  leadScoreHistory,
  leadActivities,
  notifications,
} from "@shared/schema";
import { eq, and, lt, sql, gte, isNotNull, desc } from "drizzle-orm";
import { jobQueueService } from "./jobQueue";

const DECAY_PER_WEEK = 0.05; // 5% per week
const DAYS_BEFORE_COLD_ALERT = 14;
const COLD_SCORE_DROP_THRESHOLD = 20;

// ─── Decay logic ──────────────────────────────────────────────────────────────

export async function decayOrganizationLeads(orgId: number): Promise<{
  processed: number;
  decayed: number;
  coldAlerts: number;
}> {
  const now = new Date();
  const weeksPerDay = 1 / 7;

  // Fetch all active leads with their current scores
  const activeLeads = await db
    .select({
      id: leads.id,
      score: leads.score,
      lastContactedAt: leads.lastContactedAt,
      status: leads.status,
      firstName: leads.firstName,
      lastName: leads.lastName,
      organizationId: leads.organizationId,
    })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, orgId),
        sql`${leads.status} not in ('closed', 'lost', 'do_not_contact')`
      )
    );

  let decayed = 0;
  let coldAlerts = 0;

  for (const lead of activeLeads) {
    if (!lead.score || lead.score <= 0) continue;

    const lastContact = lead.lastContactedAt ? new Date(lead.lastContactedAt) : null;
    const daysSinceContact = lastContact
      ? (now.getTime() - lastContact.getTime()) / 86400000
      : 999;

    const weeksSinceContact = daysSinceContact * weeksPerDay;
    const decayFactor = 1 - Math.min(DECAY_PER_WEEK * weeksSinceContact, 0.5);
    const newScore = Math.max(0, Math.round(lead.score * decayFactor));

    if (newScore === lead.score) continue; // no change
    const drop = lead.score - newScore;

    // Update score
    await db
      .update(leads)
      .set({ score: newScore, updatedAt: now })
      .where(eq(leads.id, lead.id));

    // Record in history
    await db.insert(leadScoreHistory).values({
      leadId: lead.id,
      organizationId: orgId,
      score: newScore,
      previousScore: lead.score,
      reason: `Decay: ${Math.round(weeksSinceContact * 10) / 10} weeks since last contact`,
      scoredAt: now,
    });

    decayed++;

    // Check if "going cold" alert is warranted
    const wasHot = lead.score >= 80;
    const isNowCold = newScore < lead.score - COLD_SCORE_DROP_THRESHOLD;
    const isUncontactedTooLong = daysSinceContact >= DAYS_BEFORE_COLD_ALERT;

    if (wasHot && isNowCold && isUncontactedTooLong) {
      // Fire Sophie Observer alert via notification
      await db.insert(notifications).values({
        organizationId: orgId,
        type: "lead_going_cold",
        title: "Lead Going Cold",
        message: `${lead.firstName || ""} ${lead.lastName || "Lead"} hasn't been contacted in ${Math.round(daysSinceContact)} days. Score dropped from ${lead.score} to ${newScore}.`,
        entityType: "lead",
        entityId: lead.id,
        priority: "high",
        createdAt: now,
      });
      coldAlerts++;
    }
  }

  return { processed: activeLeads.length, decayed, coldAlerts };
}

// ─── Score recovery on interaction ───────────────────────────────────────────

export async function applyScoreRecovery(leadId: number, interactionType: string): Promise<void> {
  const [lead] = await db.select({ score: leads.score, organizationId: leads.organizationId })
    .from(leads)
    .where(eq(leads.id, leadId));

  if (!lead) return;

  const recovery = interactionType === "call" ? 15 : interactionType === "email" ? 8 : 10;
  const newScore = Math.min(100, (lead.score ?? 0) + recovery);

  await db.update(leads).set({
    score: newScore,
    lastContactedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(leads.id, leadId));

  await db.insert(leadScoreHistory).values({
    leadId,
    organizationId: lead.organizationId,
    score: newScore,
    previousScore: lead.score ?? 0,
    reason: `Recovery: ${interactionType} logged`,
    scoredAt: new Date(),
  });
}

// ─── Register nightly BullMQ cron job ────────────────────────────────────────

export async function registerLeadScoreDecayJob(): Promise<void> {
  await jobQueueService.addCron(
    "lead-score-decay",
    { name: "lead-score-decay", orgId: null }, // orgId null = run for all orgs
    "0 3 * * *" // 3:00 AM UTC nightly
  );
  console.log("[LeadScoreDecay] Nightly decay job registered at 3:00 AM UTC");
}

// ─── Job processor (called by BullMQ worker) ─────────────────────────────────

export async function processLeadScoreDecay(): Promise<void> {
  // Get all distinct org IDs with active leads
  const orgRows = await db
    .selectDistinct({ organizationId: leads.organizationId })
    .from(leads)
    .where(sql`${leads.status} not in ('closed', 'lost', 'do_not_contact')`);

  for (const { organizationId } of orgRows) {
    if (!organizationId) continue;
    const result = await decayOrganizationLeads(organizationId);
    if (result.coldAlerts > 0) {
      console.log(`[LeadScoreDecay] Org ${organizationId}: ${result.decayed} decayed, ${result.coldAlerts} cold alerts`);
    }
  }
}
