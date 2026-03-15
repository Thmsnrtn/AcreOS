// paxNudges.ts — Proactive ambient intelligence for Pax
// Runs as a background job every 6 hours; generates insight cards per org.

import { db } from "../db";
import { eq, and, lt, isNull, count, desc, gte } from "drizzle-orm";
import {
  organizations, leads, properties, deals, tasks,
  paxNudges,
  type Organization,
} from "@shared/schema";

const MAX_NUDGES_PER_ORG = 5;
// Interval before regenerating nudges for an org (6 hours)
const REGEN_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function generateNudgesForOrg(org: Organization): Promise<void> {
  const orgId = org.id;
  const now = new Date();

  // Clear old/expired nudges first (older than 24 hours and not dismissed)
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await db.delete(paxNudges as any)
    .where(and(
      eq((paxNudges as any).organizationId, orgId),
      isNull((paxNudges as any).dismissedAt),
      lt((paxNudges as any).createdAt, cutoff)
    ) as any);

  const nudgesToInsert: any[] = [];

  // ── Stale leads (no activity in 14+ days) ────────────────────────────────
  try {
    const staleCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const staleLeads = await db.select({ id: leads.id, name: leads.name, status: leads.status })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        lt(leads.updatedAt as any, staleCutoff)
      ))
      .limit(10);
    const activeStale = staleLeads.filter(l => !["closed", "converted", "lost"].includes(l.status ?? ""));
    if (activeStale.length >= 3) {
      nudgesToInsert.push({
        organizationId: orgId,
        content: `${activeStale.length} leads haven't been contacted in 14+ days. Time to follow up?`,
        category: "stale_leads",
        entityType: "lead",
        priority: 2,
        actionPrompt: `/followup — I have ${activeStale.length} stale leads. Prioritize them and draft outreach messages.`,
      });
    }
  } catch {}

  // ── Stuck deals (in same stage for 30+ days) ─────────────────────────────
  try {
    const stuckCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const stuckDeals = await db.select({ id: deals.id, name: deals.name, status: deals.status, dealValue: deals.dealValue })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        lt(deals.updatedAt as any, stuckCutoff)
      ))
      .limit(5);
    const activeStuck = stuckDeals.filter(d => !["closed", "lost", "cancelled"].includes(d.status ?? ""));
    if (activeStuck.length > 0) {
      const topDeal = activeStuck[0];
      nudgesToInsert.push({
        organizationId: orgId,
        content: `Deal "${topDeal.name}" has been in "${topDeal.status}" for 30+ days. Deals typically close in 21 days — needs attention.`,
        category: "stuck_deal",
        entityType: "deal",
        entityId: topDeal.id,
        priority: 1,
        actionPrompt: `Analyze deal "${topDeal.name}" (ID: ${topDeal.id}). What's blocking progress and what should I do next?`,
      });
    }
  } catch {}

  // ── Overdue tasks ──────────────────────────────────────────────────────────
  try {
    const overdueTasks = await db.select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
      .from(tasks)
      .where(and(
        eq(tasks.organizationId, orgId),
        lt(tasks.dueDate as any, now),
        eq(tasks.status, "pending")
      ))
      .limit(5);
    if (overdueTasks.length >= 2) {
      nudgesToInsert.push({
        organizationId: orgId,
        content: `${overdueTasks.length} tasks are overdue. The oldest: "${overdueTasks[0]?.title}".`,
        category: "task_due",
        priority: 3,
        actionPrompt: `/tasks — I have ${overdueTasks.length} overdue tasks. Help me prioritize and tackle them.`,
      });
    }
  } catch {}

  // ── Pipeline health ───────────────────────────────────────────────────────
  try {
    const allDeals = await db.select({ id: deals.id, status: deals.status, dealValue: deals.dealValue })
      .from(deals)
      .where(eq(deals.organizationId, orgId));
    const activeDeals = allDeals.filter(d => !["closed", "lost", "cancelled"].includes(d.status ?? ""));
    const totalValue = activeDeals.reduce((s, d) => s + Number(d.dealValue ?? 0), 0);
    if (activeDeals.length > 0 && totalValue > 0) {
      nudgesToInsert.push({
        organizationId: orgId,
        content: `You have ${activeDeals.length} active deals worth $${totalValue.toLocaleString()} in your pipeline. Run a pipeline analysis to identify the best opportunities.`,
        category: "opportunity",
        priority: 4,
        actionPrompt: `/pipeline — Analyze my current pipeline of ${activeDeals.length} deals. Which have the highest probability of closing and what should I focus on?`,
      });
    }
  } catch {}

  // ── Lead count milestone ──────────────────────────────────────────────────
  try {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const newLeads = await db.select({ id: leads.id })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        gte(leads.createdAt as any, thirtyDaysAgo)
      ));
    if (newLeads.length >= 5) {
      nudgesToInsert.push({
        organizationId: orgId,
        content: `${newLeads.length} new leads added this month. Score and prioritize them to keep your pipeline fresh.`,
        category: "opportunity",
        priority: 5,
        actionPrompt: `/score — I have ${newLeads.length} new leads this month. Score them and identify the best acquisition opportunities.`,
      });
    }
  } catch {}

  // Insert up to MAX_NUDGES_PER_ORG new nudges
  const toInsert = nudgesToInsert.slice(0, MAX_NUDGES_PER_ORG);
  if (toInsert.length > 0) {
    await db.insert(paxNudges as any).values(toInsert);
    console.log(`[PaxNudges] Generated ${toInsert.length} nudges for org ${orgId}`);
  }
}

export async function processPaxNudges(): Promise<void> {
  try {
    const allOrgs = await db.select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.isActive as any, true))
      .limit(100);

    for (const org of allOrgs) {
      try {
        await generateNudgesForOrg(org as Organization);
      } catch (err) {
        console.error(`[PaxNudges] Error for org ${org.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[PaxNudges] Fatal error:", err);
  }
}
