/**
 * Intelligent Priority Action — surfaces the single most important thing.
 */

import { storage } from "../storage";

export interface PriorityActionResult {
  action: string;
  headline: string;
  entityType?: string;
  entityId?: number;
  ctaLabel: string;
  ctaRoute: string;
}

export async function getTopPriority(orgId: number): Promise<PriorityActionResult> {
  const defaultResult: PriorityActionResult = {
    action: "all_caught_up",
    headline: "You're all caught up. Your portfolio is working for you.",
    ctaLabel: "View Dashboard",
    ctaRoute: "/",
  };

  try {
    const leads = await storage.getLeads(orgId);
    const deals = await storage.getDeals(orgId);

    // 1. Unread seller responses
    const responded = leads.filter(l => l.status === "responded" && l.type === "seller");
    if (responded.length > 0) {
      return {
        action: "review_responses",
        headline: `${responded.length} seller${responded.length !== 1 ? "s" : ""} responded to your campaign — review now`,
        entityType: "lead",
        ctaLabel: "Review Responses",
        ctaRoute: "/leads?status=responded",
      };
    }

    // 2. Accepted deals needing closing process
    const accepted = deals.filter(d => d.status === "accepted" || d.status === "in_escrow");
    if (accepted.length > 0) {
      return {
        action: "close_deal",
        headline: `Deal #${accepted[0].id} was accepted — start the closing process`,
        entityType: "deal",
        entityId: accepted[0].id,
        ctaLabel: "Start Closing",
        ctaRoute: `/deals/${accepted[0].id}`,
      };
    }

    // 3. Stale leads — no campaign after 7+ days
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const stale = leads.filter(l => l.status === "new" && l.createdAt && new Date(l.createdAt) < sevenDaysAgo);
    if (stale.length > 0) {
      return {
        action: "create_campaign",
        headline: `${stale.length} lead${stale.length !== 1 ? "s" : ""} haven't been contacted — create a campaign`,
        ctaLabel: "Create Campaign",
        ctaRoute: "/campaigns?action=create",
      };
    }

    // 4. Overdue notes
    try {
      const notes = await storage.getNotes(orgId);
      const overdue = notes.filter((n: any) => n.daysDelinquent > 0 || n.delinquencyStatus !== "current");
      if (overdue.length > 0) {
        return {
          action: "review_delinquencies",
          headline: `${overdue.length} note payment${overdue.length !== 1 ? "s" : ""} overdue — review delinquencies`,
          ctaLabel: "Review Notes",
          ctaRoute: "/finance",
        };
      }
    } catch {}

    // 5. No leads
    if (leads.length === 0) {
      return {
        action: "import_leads",
        headline: "Import your first leads to get started",
        ctaLabel: "Import Leads",
        ctaRoute: "/leads?action=import",
      };
    }

    return defaultResult;
  } catch {
    return defaultResult;
  }
}
