/**
 * Agent Trigger Monitor — Proactive Intelligence Engine
 *
 * The missing link between "reactive agent" and "truly autonomous agent."
 *
 * This service continuously watches the database for actionable states and
 * automatically fires the right specialist agent — no user input required.
 *
 * Design philosophy:
 *  - The user configures goals and thresholds once.
 *  - The platform does the work.
 *  - The user reviews results and approves actions (if autonomy is < full_auto).
 *
 * Trigger categories (in priority order):
 *  1. HOT_LEAD_STALLED      Hot lead uncontacted 12h+ → communications agent
 *  2. FOLLOW_UP_DUE         nextFollowUpAt timestamp reached → communications agent
 *  3. NEW_LEAD_NO_PLAN      New lead 30min old with no task → nurture plan
 *  4. PAYMENT_OVERDUE       Note payment past due → operations alert
 *  5. DEAL_STALLED          Deal dormant 7d+ → deals strategy agent
 *  6. PROPERTY_NEEDS_DD     Property without due-diligence → research agent
 *  7. DAILY_DIGEST          7am every day → operations summary
 *  8. WEEKLY_PERFORMANCE    Monday 7am → performance analysis
 */

import { db } from "../db";
import { leads, properties, deals, notes, agentTasks, agentRuns, organizations } from "@shared/schema";
import { eq, and, lt, isNull, ne, gte, lte, desc, sql, count } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentTriggerType =
  | "hot_lead_stalled"
  | "follow_up_due"
  | "new_lead_no_plan"
  | "payment_overdue"
  | "deal_stalled"
  | "property_needs_dd"
  | "daily_digest"
  | "weekly_performance";

export interface AgentTrigger {
  type: AgentTriggerType;
  organizationId: number;
  priority: number;    // 1 = highest urgency, 10 = lowest
  agentType: string;
  input: Record<string, any>;
  description: string;
  relatedLeadId?: number;
  relatedPropertyId?: number;
  relatedDealId?: number;
}

// ─── Dedup: prevent same trigger from firing more than once per hour ──────────

const firedTriggers = new Map<string, number>(); // key → timestamp
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function alreadyFired(key: string): boolean {
  const t = firedTriggers.get(key);
  if (!t) return false;
  if (Date.now() - t > DEDUP_WINDOW_MS) { firedTriggers.delete(key); return false; }
  return true;
}

function markFired(key: string): void {
  firedTriggers.set(key, Date.now());
  // Prune map occasionally
  if (firedTriggers.size > 2000) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [k, v] of firedTriggers) if (v < cutoff) firedTriggers.delete(k);
  }
}

// ─── Monitor ──────────────────────────────────────────────────────────────────

class AgentTriggerMonitor {
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastDailyDate: string | null = null;
  private lastWeeklyDate: string | null = null;

  // Config
  private readonly HOT_LEAD_STALL_H = 12;
  private readonly DEAL_STALL_DAYS = 7;
  private readonly NEW_LEAD_GRACE_MIN = 30;
  private readonly MAX_TRIGGERS_PER_ORG = 15;
  private readonly DAILY_DIGEST_HOUR = 7;
  private readonly WEEKLY_DAY = 1; // Monday

  start(intervalMs = 5 * 60 * 1000): void {
    if (this.intervalHandle) return;
    console.log(`[AgentTriggerMonitor] Starting — poll every ${intervalMs / 1000}s`);
    this.runScan().catch(e => console.error("[AgentTriggerMonitor] initial scan error:", e));
    this.intervalHandle = setInterval(() => {
      this.runScan().catch(e => console.error("[AgentTriggerMonitor] scan error:", e));
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null; }
    console.log("[AgentTriggerMonitor] Stopped.");
  }

  // ─── Main scan ─────────────────────────────────────────────────────────────

  async runScan(): Promise<{ queued: number }> {
    let queued = 0;

    try {
      const orgs = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.subscriptionStatus, "active"));

      for (const org of orgs) {
        const triggers = await this.detectTriggers(org.id);
        queued += await this.enqueue(triggers);
      }

      await this.checkTimeBased(orgs.map(o => o.id));

      // Update agent run metadata
      await this.recordRun(queued);
    } catch (err) {
      console.error("[AgentTriggerMonitor] scan error:", err);
    }

    return { queued };
  }

  // ─── Per-org trigger detection ─────────────────────────────────────────────

  private async detectTriggers(orgId: number): Promise<AgentTrigger[]> {
    const [t1, t2, t3, t4, t5, t6] = await Promise.all([
      this.detectHotLeadStalls(orgId),
      this.detectFollowUpsDue(orgId),
      this.detectNewLeadsWithNoPlan(orgId),
      this.detectOverduePayments(orgId),
      this.detectStalledDeals(orgId),
      this.detectPropertiesNeedingDD(orgId),
    ]);

    const all = [...t1, ...t2, ...t3, ...t4, ...t5, ...t6];
    // Sort by priority, cap to prevent storms
    return all.sort((a, b) => a.priority - b.priority).slice(0, this.MAX_TRIGGERS_PER_ORG);
  }

  // ─── Individual detectors ──────────────────────────────────────────────────

  /** Hot leads untouched for 12h */
  private async detectHotLeadStalls(orgId: number): Promise<AgentTrigger[]> {
    const cutoff = new Date(Date.now() - this.HOT_LEAD_STALL_H * 3600_000);
    const rows = await db
      .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        eq(leads.nurturingStage, "hot"),
        ne(leads.status, "dead"), ne(leads.status, "closed"),
        lt(leads.lastContactedAt, cutoff)
      ))
      .limit(5);

    return rows
      .filter(l => !alreadyFired(`hot:${orgId}:${l.id}`))
      .map(l => ({
        type: "hot_lead_stalled" as AgentTriggerType,
        organizationId: orgId,
        priority: 1,
        agentType: "communications",
        input: { action: "nurture_lead", leadId: l.id, stage: "hot", urgency: "high" },
        description: `Hot lead ${l.firstName} ${l.lastName} uncontacted ${this.HOT_LEAD_STALL_H}h+`,
        relatedLeadId: l.id,
      }));
  }

  /** nextFollowUpAt is in the past */
  private async detectFollowUpsDue(orgId: number): Promise<AgentTrigger[]> {
    const now = new Date();
    const rows = await db
      .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, nurturingStage: leads.nurturingStage })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        lt(leads.nextFollowUpAt, now),
        ne(leads.status, "dead"), ne(leads.status, "closed"),
        ne(leads.doNotContact, true)
      ))
      .limit(5);

    return rows
      .filter(l => !alreadyFired(`followup:${orgId}:${l.id}`))
      .map(l => ({
        type: "follow_up_due" as AgentTriggerType,
        organizationId: orgId,
        priority: 2,
        agentType: "communications",
        input: { action: "nurture_lead", leadId: l.id, stage: l.nurturingStage ?? "warm" },
        description: `Scheduled follow-up due for ${l.firstName} ${l.lastName}`,
        relatedLeadId: l.id,
      }));
  }

  /** New leads 30min+ old with no pending agent tasks */
  private async detectNewLeadsWithNoPlan(orgId: number): Promise<AgentTrigger[]> {
    const graceEnd = new Date(Date.now() - this.NEW_LEAD_GRACE_MIN * 60_000);
    const dayAgo = new Date(Date.now() - 24 * 3600_000);

    const newLeads = await db
      .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        eq(leads.status, "new"),
        lt(leads.createdAt, graceEnd),
        gte(leads.createdAt, dayAgo)
      ))
      .limit(5);

    const triggers: AgentTrigger[] = [];
    for (const lead of newLeads) {
      if (alreadyFired(`newlead:${orgId}:${lead.id}`)) continue;

      const existing = await db
        .select({ id: agentTasks.id })
        .from(agentTasks)
        .where(and(
          eq(agentTasks.organizationId, orgId),
          eq(agentTasks.relatedLeadId, lead.id),
          eq(agentTasks.status, "pending")
        ))
        .limit(1);

      if (existing.length === 0) {
        triggers.push({
          type: "new_lead_no_plan" as AgentTriggerType,
          organizationId: orgId,
          priority: 3,
          agentType: "communications",
          input: { action: "nurture_lead", leadId: lead.id, stage: "new", previousInteractions: "none" },
          description: `New lead ${lead.firstName} ${lead.lastName} has no nurture plan`,
          relatedLeadId: lead.id,
        });
      }
    }
    return triggers;
  }

  /** Seller financing notes with past-due payments */
  private async detectOverduePayments(orgId: number): Promise<AgentTrigger[]> {
    const now = new Date();
    const rows = await db
      .select({ id: notes.id, propertyId: notes.propertyId })
      .from(notes)
      .where(and(
        eq(notes.organizationId, orgId),
        eq(notes.status, "active"),
        lt(notes.nextPaymentDate, now)
      ))
      .limit(10);

    return rows
      .filter(n => !alreadyFired(`payment:${orgId}:${n.id}`))
      .map(n => ({
        type: "payment_overdue" as AgentTriggerType,
        organizationId: orgId,
        priority: 1,
        agentType: "operations",
        input: {
          action: "generate_alert",
          type: "payment_overdue",
          severity: "high",
          details: `Note #${n.id} has a past-due payment`,
        },
        description: `Seller financing note #${n.id} payment is overdue`,
        relatedPropertyId: n.propertyId ?? undefined,
      }));
  }

  /** Deals not updated in DEAL_STALL_DAYS */
  private async detectStalledDeals(orgId: number): Promise<AgentTrigger[]> {
    const cutoff = new Date(Date.now() - this.DEAL_STALL_DAYS * 86400_000);
    const rows = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        ne(deals.status, "closed_won"), ne(deals.status, "closed_lost"),
        lt(deals.updatedAt, cutoff)
      ))
      .limit(3);

    return rows
      .filter(d => !alreadyFired(`deal:${orgId}:${d.id}`))
      .map(d => ({
        type: "deal_stalled" as AgentTriggerType,
        organizationId: orgId,
        priority: 4,
        agentType: "deals",
        input: {
          action: "suggest_strategy",
          scenario: `Deal #${d.id} has stalled — needs re-engagement strategy`,
          constraints: "Seller may have gone cold; propose low-friction re-opener",
        },
        description: `Deal #${d.id} dormant ${this.DEAL_STALL_DAYS}+ days`,
        relatedDealId: d.id,
      }));
  }

  /** Properties with no lat/lng (means no enrichment done yet) */
  private async detectPropertiesNeedingDD(orgId: number): Promise<AgentTrigger[]> {
    const rows = await db
      .select({ id: properties.id, address: properties.address })
      .from(properties)
      .where(and(
        eq(properties.organizationId, orgId),
        isNull(properties.latitude)
      ))
      .limit(3);

    return rows
      .filter(p => !alreadyFired(`propdd:${orgId}:${p.id}`))
      .map(p => ({
        type: "property_needs_dd" as AgentTriggerType,
        organizationId: orgId,
        priority: 5,
        agentType: "research",
        input: { action: "enrich_property", propertyId: p.id },
        description: `Property ${p.address ?? `#${p.id}`} missing due diligence`,
        relatedPropertyId: p.id,
      }));
  }

  // ─── Time-based triggers ───────────────────────────────────────────────────

  private async checkTimeBased(orgIds: number[]): Promise<void> {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const hour = now.getHours();
    const dow = now.getDay();

    if (hour === this.DAILY_DIGEST_HOUR && this.lastDailyDate !== dateStr) {
      this.lastDailyDate = dateStr;
      for (const orgId of orgIds) {
        await this.insertTask({
          type: "daily_digest", organizationId: orgId, priority: 7, agentType: "operations",
          input: { action: "run_digest", timeframe: "today" },
          description: "Daily morning digest",
        });
      }
    }

    if (dow === this.WEEKLY_DAY && hour === this.DAILY_DIGEST_HOUR && this.lastWeeklyDate !== dateStr) {
      this.lastWeeklyDate = dateStr;
      for (const orgId of orgIds) {
        await this.insertTask({
          type: "weekly_performance", organizationId: orgId, priority: 8, agentType: "operations",
          input: { action: "analyze_performance", timeframe: "this week" },
          description: "Weekly performance analysis",
        });
      }
    }
  }

  // ─── Enqueue triggers as agent tasks ──────────────────────────────────────

  private async enqueue(triggers: AgentTrigger[]): Promise<number> {
    let queued = 0;
    for (const trigger of triggers) {
      const dedupKey = `${trigger.type}:${trigger.organizationId}:${trigger.relatedLeadId ?? trigger.relatedPropertyId ?? trigger.relatedDealId ?? "global"}`;
      if (alreadyFired(dedupKey)) continue;

      await this.insertTask(trigger);
      markFired(dedupKey);
      queued++;
    }
    return queued;
  }

  private async insertTask(trigger: AgentTrigger): Promise<void> {
    try {
      await db.insert(agentTasks).values({
        organizationId: trigger.organizationId,
        agentType: trigger.agentType,
        status: "pending",
        priority: trigger.priority,
        input: {
          ...trigger.input,
          _triggerType: trigger.type,
          _autoFired: true,
          _description: trigger.description,
        } as any,
        relatedLeadId: trigger.relatedLeadId ?? null,
        relatedPropertyId: trigger.relatedPropertyId ?? null,
        relatedDealId: trigger.relatedDealId ?? null,
        requiresReview: trigger.priority <= 2,
      });
      console.log(`[AgentTriggerMonitor] Queued ${trigger.type} for org ${trigger.organizationId}: ${trigger.description}`);
    } catch (err) {
      console.error(`[AgentTriggerMonitor] Failed to insert ${trigger.type}:`, err);
    }
  }

  private async recordRun(queued: number): Promise<void> {
    try {
      await db
        .insert(agentRuns)
        .values({
          agentName: "agent_trigger_monitor",
          status: "completed",
          lastRunAt: new Date(),
          nextRunAt: new Date(Date.now() + 5 * 60_000),
          processedCount: queued,
          errorCount: 0,
        })
        .onConflictDoUpdate({
          target: agentRuns.agentName,
          set: {
            status: "completed",
            lastRunAt: new Date(),
            nextRunAt: new Date(Date.now() + 5 * 60_000),
            processedCount: sql`${agentRuns.processedCount} + ${queued}`,
          },
        });
    } catch {
      // Non-critical
    }
  }

  /** Manually trigger a scan for a single org (useful for testing / on-demand) */
  async forceScan(organizationId: number): Promise<{ triggers: AgentTrigger[]; queued: number }> {
    const triggers = await this.detectTriggers(organizationId);
    const queued = await this.enqueue(triggers);
    return { triggers, queued };
  }

  getStatus(): { running: boolean; dedupCacheSize: number } {
    return { running: this.intervalHandle !== null, dedupCacheSize: firedTriggers.size };
  }
}

export const agentTriggerMonitor = new AgentTriggerMonitor();
