import { db } from "../db";
import { leads, campaigns, campaignResponses, offerBatches, mailingOrders } from "@shared/schema";
import { eq, and, gte, count, inArray, sql } from "drizzle-orm";
import {
  countTouchesByLead,
  fatigueLevelForTouchCount,
  FATIGUE_SUPPRESS_TOUCHES_90D,
  FATIGUE_WATCH_TOUCHES_90D,
} from "./compliance/contactFrequency";
import { logger } from "../utils/logger";

export interface OverlapReport {
  totalLeads: number;
  duplicateLeads: number;      // leads on 2+ campaigns
  wastedMailings: number;      // estimated duplicate sends
  estimatedWastedCost: number; // at $1.50/mailer
  fatigueRisk: LeadFatigue[];
  recommendations: string[];
}

export interface LeadFatigue {
  leadId: number;
  name: string;
  email: string | null;
  touchCount: number;          // REAL outbound touches recorded in last 90 days
  campaignCount: number;       // # different campaigns
  lastContact: Date | null;
  fatigueLevel: "ok" | "watch" | "suppress";
}

export class CampaignOverlapDetector {

  async generateOverlapReport(orgId: number): Promise<OverlapReport> {
    // Get all leads for org
    const orgLeads = await db.select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      responses: leads.responses,
      sourceCampaignId: leads.sourceCampaignId,
      lastContactedAt: leads.lastContactedAt,
    }).from(leads).where(eq(leads.organizationId, orgId));

    // Get campaign responses to count actual touches per lead (last 90 days)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const responses = await db.select({
      leadId: campaignResponses.leadId,
      campaignId: campaignResponses.campaignId,
    }).from(campaignResponses).where(
      and(
        eq(campaignResponses.organizationId, orgId),
        gte(campaignResponses.responseDate, ninetyDaysAgo)
      )
    );

    // Group by lead ID to find overlaps
    const leadCampaignMap = new Map<number, Set<number>>();
    for (const r of responses) {
      if (!r.leadId) continue;
      if (!leadCampaignMap.has(r.leadId)) leadCampaignMap.set(r.leadId, new Set());
      leadCampaignMap.get(r.leadId)!.add(r.campaignId!);
    }

    // Also include source campaign
    for (const lead of orgLeads) {
      if (lead.sourceCampaignId) {
        if (!leadCampaignMap.has(lead.id)) leadCampaignMap.set(lead.id, new Set());
        leadCampaignMap.get(lead.id)!.add(lead.sourceCampaignId);
      }
    }

    const duplicateLeadIds = Array.from(leadCampaignMap.entries())
      .filter(([, campaignSet]) => campaignSet.size >= 2)
      .map(([id]) => id);

    // Build fatigue list.
    //
    // TRUTH FIX (2026-07-29): `touchCount` used to read `leads.responses` —
    // a count of INBOUND responses — as "a proxy for touch count". So the
    // report's `suppress` verdict was about how often the lead answered, not
    // how often we contacted them. Now that the verdict is ENFORCED at the
    // SMS choke point, the report and the gate must count the same thing:
    // real outbound touches recorded in the touch ledger over 90 days
    // (services/compliance/contactFrequency.ts). Leads with no ledger rows
    // count 0 — an honest "we have no record of contacting them", never a
    // fabricated estimate.
    let touchCounts = new Map<number, number>();
    try {
      touchCounts = await countTouchesByLead(orgId);
    } catch (err) {
      // Report degraded rather than invented: counts stay 0 and the caller
      // sees no fatigue rows rather than made-up ones.
      logger.error(
        "[campaignOverlapDetector] touch-ledger read failed — fatigue counts unavailable for this report",
        err instanceof Error ? err : undefined,
        { metadata: { organizationId: orgId } },
      );
    }

    const fatigueRisk: LeadFatigue[] = [];
    for (const lead of orgLeads) {
      const campaignSet = leadCampaignMap.get(lead.id);
      const touchCount = touchCounts.get(lead.id) ?? 0;
      const campaignCount = campaignSet?.size || 0;

      // Thresholds live in contactFrequency.ts so the number the report
      // prints is the number the send gate enforces.
      const fatigueLevel: LeadFatigue["fatigueLevel"] = fatigueLevelForTouchCount(touchCount);

      if (fatigueLevel !== "ok" || campaignCount >= 2) {
        fatigueRisk.push({
          leadId: lead.id,
          name: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown",
          email: lead.email,
          touchCount,
          campaignCount,
          lastContact: lead.lastContactedAt || null,
          fatigueLevel,
        });
      }
    }

    const wastedMailings = duplicateLeadIds.length * 1.5; // avg 1.5 extra sends per duplicate

    const recommendations: string[] = [];
    if (duplicateLeadIds.length > 0) recommendations.push(`${duplicateLeadIds.length} leads are on multiple campaigns — consider deduplication`);
    const suppressCount = fatigueRisk.filter(f => f.fatigueLevel === "suppress").length;
    if (suppressCount > 0) recommendations.push(`${suppressCount} leads have ${FATIGUE_SUPPRESS_TOUCHES_90D}+ touches in 90 days — outbound to them is already being refused by the contact-frequency cap`);
    const watchCount = fatigueRisk.filter(f => f.fatigueLevel === "watch").length;
    if (watchCount > 0) recommendations.push(`${watchCount} leads show fatigue (${FATIGUE_WATCH_TOUCHES_90D}-${FATIGUE_SUPPRESS_TOUCHES_90D - 1} touches) — reduce contact frequency`);

    return {
      totalLeads: orgLeads.length,
      duplicateLeads: duplicateLeadIds.length,
      wastedMailings: Math.round(wastedMailings),
      estimatedWastedCost: Math.round(wastedMailings * 1.50 * 100) / 100,
      fatigueRisk: fatigueRisk.sort((a, b) => b.touchCount - a.touchCount).slice(0, 100),
      recommendations,
    };
  }
}

export const campaignOverlapDetector = new CampaignOverlapDetector();
