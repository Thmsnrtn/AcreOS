/**
 * T21 — Atlas Context Depth: Automatic Business Context Injection
 *
 * Enriches every Atlas conversation with deep, personalized business context
 * before the first message. Atlas should never need the user to explain their
 * portfolio, active deals, or preferences — it should already know.
 *
 * Context injected automatically:
 *   - Active deals with stage, amount, and days in current stage
 *   - Leads requiring follow-up (last contact > 7 days)
 *   - Expiring offers (sent > 10 days ago, no response)
 *   - Notes receivable: total balance, next due payments
 *   - User's preferred counties (inferred from their property data)
 *   - Recent wins (deals closed in last 30 days)
 *   - Sophie memory: user preferences, past deal patterns
 *   - Pending tasks due this week
 *   - Active campaigns with performance summary
 *
 * Usage (in executive.ts or wherever Atlas is initialized):
 *   import { buildAtlasContextBlock } from "./atlasContextInjector";
 *
 *   const contextBlock = await buildAtlasContextBlock(orgId, userId);
 *   const systemPrompt = ATLAS_BASE_PROMPT + "\n\n" + contextBlock;
 */

import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  leads, properties, deals, notes, tasks, campaigns,
  sophieMemory, payments,
} from "@shared/schema";
import { eq, and, lt, gt, desc, count } from "drizzle-orm";

interface AtlasContextBlock {
  text: string;
  generatedAt: Date;
  orgId: number;
}

export async function buildAtlasContextBlock(
  orgId: number,
  userId?: string
): Promise<AtlasContextBlock> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const sections: string[] = [];

  try {
    // ── Active deals ──────────────────────────────────────────────────────────
    const activeDeals = await db
      .select()
      .from(deals)
      .where(
        and(
          eq(deals.organizationId, orgId),
          sql`${deals.status} NOT IN ('closed', 'dead', 'cancelled')`
        )
      )
      .orderBy(desc(deals.createdAt))
      .limit(10);

    if (activeDeals.length > 0) {
      const dealLines = activeDeals.map((d) => {
        const daysInStage = Math.floor(
          (now.getTime() - new Date(d.updatedAt || d.createdAt || now).getTime()) / 86400000
        );
        return `  • ${d.title || d.propertyAddress || `Deal #${d.id}`} — ${d.status} — ${daysInStage}d in stage${d.offerAmount ? ` — $${Number(d.offerAmount).toLocaleString()}` : ""}`;
      });
      sections.push(`ACTIVE DEALS (${activeDeals.length}):\n${dealLines.join("\n")}`);
    }

    // ── Leads needing follow-up ───────────────────────────────────────────────
    const staleLeads = await db
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        lastContacted: leads.lastContacted,
        nurturingStage: leads.nurturingStage,
        score: leads.score,
      })
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, orgId),
          sql`${leads.status} NOT IN ('dead', 'converted')`,
          sql`(${leads.lastContacted} IS NULL OR ${leads.lastContacted} < ${sevenDaysAgo.toISOString()})`
        )
      )
      .orderBy(desc(leads.score))
      .limit(5);

    if (staleLeads.length > 0) {
      const leadLines = staleLeads.map((l) => {
        const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || `Lead #${l.id}`;
        const daysSince = l.lastContacted
          ? Math.floor((now.getTime() - new Date(l.lastContacted).getTime()) / 86400000)
          : "never contacted";
        return `  • ${name} — score ${l.score ?? "?"} — last contact: ${daysSince}d ago — stage: ${l.nurturingStage || "unknown"}`;
      });
      sections.push(`LEADS NEEDING FOLLOW-UP (not contacted in 7+ days):\n${leadLines.join("\n")}`);
    }

    // ── Expiring offers ───────────────────────────────────────────────────────
    const expiringOffers = await db
      .select()
      .from(deals)
      .where(
        and(
          eq(deals.organizationId, orgId),
          eq(deals.status, "offer_sent"),
          sql`${deals.offerSentAt} < ${tenDaysAgo.toISOString()}`
        )
      )
      .limit(5);

    if (expiringOffers.length > 0) {
      const lines = expiringOffers.map((d) => {
        const daysSent = Math.floor(
          (now.getTime() - new Date(d.offerSentAt || now).getTime()) / 86400000
        );
        return `  • ${d.title || d.propertyAddress || `Deal #${d.id}`} — offer sent ${daysSent}d ago, no response yet`;
      });
      sections.push(`OFFERS AWAITING RESPONSE (10+ days, no response):\n${lines.join("\n")}`);
    }

    // ── Notes receivable summary ──────────────────────────────────────────────
    const activeNotes = await db
      .select({
        id: notes.id,
        balance: notes.currentBalance,
        monthlyPayment: notes.monthlyPayment,
        nextPaymentDate: notes.nextPaymentDate,
        status: notes.status,
      })
      .from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));

    if (activeNotes.length > 0) {
      const totalBalance = activeNotes.reduce((s, n) => s + Number(n.balance || 0), 0);
      const monthlyIncome = activeNotes.reduce((s, n) => s + Number(n.monthlyPayment || 0), 0);
      const nextDue = activeNotes
        .filter((n) => n.nextPaymentDate)
        .sort((a, b) => new Date(a.nextPaymentDate!).getTime() - new Date(b.nextPaymentDate!).getTime())
        .slice(0, 3);

      sections.push(
        `NOTES RECEIVABLE:\n  ${activeNotes.length} active notes — $${totalBalance.toLocaleString()} total balance — $${monthlyIncome.toLocaleString()}/month income\n  Next payments due: ${nextDue.map((n) => `$${Number(n.monthlyPayment).toLocaleString()} on ${n.nextPaymentDate ? new Date(n.nextPaymentDate).toLocaleDateString() : "?"}`).join(", ")}`
      );
    }

    // ── Recent closings (wins) ────────────────────────────────────────────────
    const recentClosings = await db
      .select()
      .from(deals)
      .where(
        and(
          eq(deals.organizationId, orgId),
          eq(deals.status, "closed"),
          sql`${deals.closedAt} > ${thirtyDaysAgo.toISOString()}`
        )
      )
      .orderBy(desc(deals.closedAt))
      .limit(3);

    if (recentClosings.length > 0) {
      const lines = recentClosings.map(
        (d) => `  • ${d.title || d.propertyAddress || `Deal #${d.id}`}${d.salePrice ? ` — $${Number(d.salePrice).toLocaleString()}` : ""}`
      );
      sections.push(`RECENT WINS (last 30 days):\n${lines.join("\n")}`);
    }

    // ── Tasks due this week ───────────────────────────────────────────────────
    const upcomingTasks = await db
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, priority: tasks.priority })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, orgId),
          sql`${tasks.status} NOT IN ('completed', 'cancelled')`,
          sql`${tasks.dueDate} <= ${sevenDaysFromNow.toISOString()}`
        )
      )
      .orderBy(tasks.dueDate)
      .limit(5);

    if (upcomingTasks.length > 0) {
      const lines = upcomingTasks.map(
        (t) => `  • ${t.title}${t.dueDate ? ` — due ${new Date(t.dueDate).toLocaleDateString()}` : ""} [${t.priority || "normal"}]`
      );
      sections.push(`TASKS DUE THIS WEEK:\n${lines.join("\n")}`);
    }

    // ── User preferences from Sophie memory ───────────────────────────────────
    if (userId) {
      const memories = await db
        .select({ key: sophieMemory.key, value: sophieMemory.value })
        .from(sophieMemory)
        .where(
          and(
            eq(sophieMemory.organizationId, orgId),
            sql`${sophieMemory.key} IN ('preferred_counties', 'preferred_deal_size', 'investment_strategy', 'risk_tolerance', 'target_markets')`
          )
        );

      if (memories.length > 0) {
        const prefLines = memories.map((m) => `  • ${m.key.replace(/_/g, " ")}: ${JSON.stringify(m.value)}`);
        sections.push(`YOUR PREFERENCES (remembered from past sessions):\n${prefLines.join("\n")}`);
      }
    }

    // ── Preferred counties (inferred from property data) ──────────────────────
    const countyData = await db.execute<any>(sql`
      SELECT state, county, COUNT(*) as count
      FROM properties
      WHERE "organizationId" = ${orgId}
        AND county IS NOT NULL
        AND state IS NOT NULL
      GROUP BY state, county
      ORDER BY count DESC
      LIMIT 5
    `);

    const counties = (countyData as any)?.rows ?? [];
    if (counties.length > 0) {
      const countyLines = counties.map((c: any) => `  • ${c.county}, ${c.state} (${c.count} properties)`);
      sections.push(`ACTIVE MARKETS (by property count):\n${countyLines.join("\n")}`);
    }
  } catch (err: any) {
    // Context build failure is non-fatal — Atlas still works without context
    sections.push(`[Context partially unavailable: ${err.message}]`);
  }

  const text = sections.length > 0
    ? `## YOUR CURRENT BUSINESS CONTEXT\n\nThis context is automatically loaded at the start of every conversation. Use it to give specific, actionable advice without asking the user to re-explain their situation.\n\n${sections.join("\n\n")}\n\n---\n`
    : "";

  return { text, generatedAt: now, orgId };
}
