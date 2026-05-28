/**
 * CRM Enhancements — Items 51-70
 * Lead dedup, source attribution, smart tagging, response time, aging alerts, etc.
 */

import { db } from "../db";
import { leads, activityLog } from "@shared/schema";
import { eq, and, sql, gte, desc, count, isNull } from "drizzle-orm";

// Item 51: Lead deduplication
export async function findDuplicateLeads(orgId: number): Promise<Array<{ ids: number[]; matchField: string; matchValue: string }>> {
  const results: Array<{ ids: number[]; matchField: string; matchValue: string }> = [];

  // By email
  const emailDups = await db.execute(sql`
    SELECT email, array_agg(id) as ids FROM leads
    WHERE organization_id = ${orgId} AND email IS NOT NULL AND email != ''
    GROUP BY email HAVING COUNT(*) > 1 LIMIT 20
  `);
  for (const row of (emailDups.rows || []) as any[]) {
    results.push({ ids: row.ids, matchField: "email", matchValue: row.email });
  }

  // By phone
  const phoneDups = await db.execute(sql`
    SELECT phone, array_agg(id) as ids FROM leads
    WHERE organization_id = ${orgId} AND phone IS NOT NULL AND phone != ''
    GROUP BY phone HAVING COUNT(*) > 1 LIMIT 20
  `);
  for (const row of (phoneDups.rows || []) as any[]) {
    results.push({ ids: row.ids, matchField: "phone", matchValue: row.phone });
  }

  return results;
}

// Item 52: Lead source attribution
export function categorizeLeadSource(source: string | null): string {
  if (!source) return "unknown";
  const lower = source.toLowerCase();
  if (lower.includes("csv") || lower.includes("import")) return "csv_import";
  if (lower.includes("deal") || lower.includes("feed")) return "deal_feed";
  if (lower.includes("manual") || lower.includes("entry")) return "manual_entry";
  if (lower.includes("referral")) return "referral";
  if (lower.includes("campaign")) return "campaign";
  if (lower === "sample") return "sample";
  return "other";
}

// Item 53: Smart lead tagging suggestions
export function suggestLeadTags(lead: any): string[] {
  const tags: string[] = [];
  if (lead.motivationScore && lead.motivationScore > 70) tags.push("high-motivation");
  if (lead.phone && lead.email) tags.push("full-contact");
  if (lead.county) tags.push(lead.county.toLowerCase().replace(/\s+/g, "-"));
  if (lead.status === "responded") tags.push("engaged");
  if (lead.acreage && Number(lead.acreage) > 40) tags.push("large-parcel");
  if (lead.acreage && Number(lead.acreage) < 5) tags.push("small-lot");
  return tags;
}

// Item 54: Lead response time calculation
export async function calculateAvgResponseTime(orgId: number): Promise<{ avgHours: number; median: number }> {
  // Simplified — track time from lead creation to first activity
  const recentLeads = await db.select()
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), sql`${leads.status} != 'new'`))
    .orderBy(desc(leads.updatedAt))
    .limit(50);

  if (recentLeads.length === 0) return { avgHours: 0, median: 0 };

  const responseTimes = recentLeads
    .flatMap(l => {
      if (!l.createdAt || !l.updatedAt) return [];
      return [(new Date(l.updatedAt).getTime() - new Date(l.createdAt).getTime()) / (1000 * 60 * 60)];
    });

  const avg = responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length;
  responseTimes.sort((a, b) => a - b);
  const median = responseTimes[Math.floor(responseTimes.length / 2)] || 0;

  return { avgHours: Math.round(avg * 10) / 10, median: Math.round(median * 10) / 10 };
}

// Item 55: Lead aging detection
export async function getAgingLeads(orgId: number, daysThreshold: number = 14): Promise<any[]> {
  const cutoff = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000);
  return db.select()
    .from(leads)
    .where(and(
      eq(leads.organizationId, orgId),
      sql`${leads.status} IN ('new', 'contacted')`,
      sql`${leads.updatedAt} < ${cutoff}`,
    ))
    .orderBy(leads.updatedAt)
    .limit(50);
}

// Item 59: Auto-archive stale leads
export async function archiveStaleLeads(orgId: number, days: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await db.update(leads)
    .set({ status: "archived", updatedAt: new Date() } as any)
    .where(and(
      eq(leads.organizationId, orgId),
      sql`${leads.status} IN ('new', 'contacted')`,
      sql`${leads.updatedAt} < ${cutoff}`,
    ))
    .returning({ id: leads.id });
  return result.length;
}

// Item 65: Lead scoring explanation
export function explainLeadScore(lead: any): Array<{ factor: string; impact: number; reason: string }> {
  const factors: Array<{ factor: string; impact: number; reason: string }> = [];

  if (lead.motivationScore > 70) factors.push({ factor: "Motivation", impact: 30, reason: "High seller motivation detected" });
  else if (lead.motivationScore > 40) factors.push({ factor: "Motivation", impact: 15, reason: "Moderate seller motivation" });

  if (lead.phone && lead.email) factors.push({ factor: "Contact Info", impact: 10, reason: "Both phone and email available" });
  else if (lead.phone || lead.email) factors.push({ factor: "Contact Info", impact: 5, reason: "Partial contact info" });

  if (lead.taxDelinquent) factors.push({ factor: "Tax Status", impact: 20, reason: "Tax delinquent — motivated seller signal" });
  if (lead.absenteeOwner) factors.push({ factor: "Ownership", impact: 15, reason: "Absentee owner — often more flexible" });

  return factors;
}

// Item 68: Lead conversion funnel
export async function getLeadFunnel(orgId: number): Promise<Record<string, number>> {
  const statuses = ["new", "contacted", "responded", "offer_sent", "negotiating", "deal_created", "closed"];
  const funnel: Record<string, number> = {};

  for (const status of statuses) {
    const [result] = await db.select({ count: count() })
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), eq(leads.status, status)));
    funnel[status] = result?.count || 0;
  }

  return funnel;
}
