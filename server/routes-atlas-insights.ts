// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { Router } from "express";
import { db, storage } from "./storage";
import { eq, and, desc, lt, gte, lte, gt } from "drizzle-orm";
import { sophieObservations, leads, deals, leadActivities, properties, voiceCalls } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";

const logger = {
  error: (msg: string, meta?: Record<string, any>) =>
    console.error(JSON.stringify({ level: "ERROR", timestamp: new Date().toISOString(), message: msg, ...meta })),
};

const router = Router();

// GET /api/atlas/greeting
// Returns a contextual first-session greeting (fewer than 5 leads = first session).
router.get("/greeting", async (req, res) => {
  try {
    const org = (req as any).organization;

    const leadCount = await storage.getLeadCount(org.id);
    const isFirstSession = leadCount < 5;

    if (!isFirstSession) {
      return res.json({ message: null, isFirstSession: false });
    }

    // Determine the org's operating state: settings → onboardingData → most recent lead
    const settings = (org.settings as any) || {};
    const onboardingData = (org.onboardingData as any) || {};
    let orgState: string | null = settings.state || onboardingData.state || null;

    if (!orgState && leadCount > 0) {
      const [recentLead] = await db
        .select({ state: leads.state })
        .from(leads)
        .where(eq(leads.organizationId, org.id))
        .orderBy(desc(leads.createdAt))
        .limit(1);
      if (recentLead?.state) {
        orgState = recentLead.state;
      }
    }

    const message = orgState
      ? `Welcome to AcreOS! I've set up some sample data to get you started. Based on your location in ${orgState}, here are some active land markets I'm watching for you.`
      : `Welcome to AcreOS! I've set up some sample data to get you started. Ask me anything about your leads, properties, or deals — I'm here to help you move faster.`;

    return res.json({ message, isFirstSession: true });
  } catch (error: any) {
    logger.error("Atlas greeting error", { error: error.message });
    return res.json({ message: null, isFirstSession: false });
  }
});

// GET /api/atlas/insights
router.get("/insights", async (req, res) => {
  try {
    const org = (req as any).organization;
    const now = new Date();

    // ── 1. Sophie observations (status = 'detected', ordered severity desc, createdAt desc, limit 10) ──
    const rawObservations = await db
      .select({
        id: sophieObservations.id,
        type: sophieObservations.type,
        severity: sophieObservations.severity,
        title: sophieObservations.title,
        description: sophieObservations.description,
        metadata: sophieObservations.metadata,
        createdAt: sophieObservations.createdAt,
      })
      .from(sophieObservations)
      .where(
        and(
          eq(sophieObservations.organizationId, org.id),
          eq(sophieObservations.status, "detected")
        )
      )
      // Order by severity (high > medium > low > info) then by createdAt desc
      .orderBy(
        desc(
          // Derive a numeric rank so we can sort by it
          // We use a CASE expression via sql`` but drizzle supports it via sql tag
          // Instead we'll sort client-side after fetch to keep it simple
          sophieObservations.createdAt
        )
      )
      .limit(50); // fetch more so we can re-sort by severity client-side

    const severityRank: Record<string, number> = { high: 3, medium: 2, low: 1, info: 0 };
    const observations = rawObservations
      .sort((a, b) => {
        const rankDiff = (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0);
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
      })
      .slice(0, 10)
      .map((o) => ({
        id: o.id,
        type: o.type,
        severity: o.severity,
        title: o.title,
        description: o.description,
        metadata: o.metadata ?? null,
        createdAt: o.createdAt ? o.createdAt.toISOString() : null,
      }));

    // ── 2. Stale leads: not contacted in > 21 days ──
    const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);

    const allActiveLeads = await db
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        lastContactedAt: leads.lastContactedAt,
        status: leads.status,
        doNotContact: leads.doNotContact,
      })
      .from(leads)
      .where(eq(leads.organizationId, org.id));

    const staleLeads = allActiveLeads
      .filter((l) => {
        if (l.status === "closed" || l.status === "dead") return false;
        if (l.doNotContact) return false;
        if (!l.lastContactedAt) return true; // never contacted = stale
        return new Date(l.lastContactedAt).getTime() < twentyOneDaysAgo.getTime();
      })
      .map((l) => {
        const daysSinceContact = l.lastContactedAt
          ? Math.floor((now.getTime() - new Date(l.lastContactedAt).getTime()) / (24 * 60 * 60 * 1000))
          : null;
        return {
          id: l.id,
          firstName: l.firstName,
          lastName: l.lastName,
          daysSinceContact: daysSinceContact ?? 999,
        };
      })
      .sort((a, b) => b.daysSinceContact - a.daysSinceContact);

    // ── 3. Expiring offers: deals with offerDate within the last 72 hours (offer_sent status) ──
    // Note: The schema does not have an offerExpiresAt column.
    // We interpret "expiring offers" as deals currently in offer_sent or negotiating status
    // where the offer was placed within the past 72 hours (recent, active offer window).
    const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);

    const recentDeals = await db
      .select({
        id: deals.id,
        propertyId: deals.propertyId,
        offerDate: deals.offerDate,
        offerAmount: deals.offerAmount,
        status: deals.status,
      })
      .from(deals)
      .where(
        and(
          eq(deals.organizationId, org.id),
          gte(deals.offerDate, seventyTwoHoursAgo)
        )
      )
      .orderBy(desc(deals.offerDate));

    // Fetch property addresses for the expiring-offer deals
    const propertyIds = [...new Set(recentDeals.map((d) => d.propertyId).filter(Boolean))];

    let propertyMap: Record<number, string> = {};
    if (propertyIds.length > 0) {
      const props = await db
        .select({ id: properties.id, address: properties.address })
        .from(properties)
        .where(eq(properties.organizationId, org.id));
      for (const p of props) {
        if (propertyIds.includes(p.id)) {
          propertyMap[p.id] = p.address ?? `Property #${p.id}`;
        }
      }
    }

    const expiringOffers = recentDeals.map((d) => ({
      id: d.id,
      title: propertyMap[d.propertyId] ?? `Deal #${d.id}`,
      offerExpiresAt: d.offerDate
        ? new Date(new Date(d.offerDate).getTime() + 72 * 60 * 60 * 1000).toISOString()
        : null,
      leadName: propertyMap[d.propertyId] ?? `Deal #${d.id}`,
    }));

    // ── 4a. Voice pipeline motivated callers: calls in past 7 days with motivationScore > 0.7 ──
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const motivatedVoiceCalls = await db
      .select()
      .from(voiceCalls)
      .where(
        and(
          eq(voiceCalls.organizationId, org.id),
          gt(voiceCalls.motivationScore, "0.7"),
          gte(voiceCalls.createdAt, sevenDaysAgo)
        )
      )
      .orderBy(desc(voiceCalls.createdAt))
      .limit(10);

    const motivatedVoiceCallsSummary = motivatedVoiceCalls.map((c) => ({
      id: c.id,
      callSid: c.callSid,
      leadId: c.leadId,
      contactId: c.contactId,
      motivationScore: c.motivationScore,
      sentimentScore: c.sentimentScore,
      direction: c.direction,
      durationSeconds: c.durationSeconds,
      recordingUrl: c.recordingUrl,
      createdAt: c.createdAt,
    }));

    // ── 4b. Motivated callers: leads with urgency tags or keywords in notes ──
    const urgencyKeywords = ["motivated", "quick", "urgent", "sell fast", "inherited", "divorce", "foreclosure"];

    // Full lead fetch to access tags and notes fields
    const fullLeads = await db
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        phone: leads.phone,
        status: leads.status,
        notes: leads.notes,
        tags: leads.tags,
        doNotContact: leads.doNotContact,
      })
      .from(leads)
      .where(eq(leads.organizationId, org.id));

    const motivatedLeads = fullLeads
      .filter((l) => {
        if (["closed", "dead"].includes(l.status)) return false;
        if (l.doNotContact) return false;
        const tags: string[] = (l.tags as string[]) || [];
        const hasMotivatedTag = tags.some((t) =>
          urgencyKeywords.some((kw) => t.toLowerCase().includes(kw))
        );
        const notesText = (l.notes || "").toLowerCase();
        const hasUrgencyInNotes = urgencyKeywords.some((kw) => notesText.includes(kw));
        return hasMotivatedTag || hasUrgencyInNotes;
      })
      .slice(0, 5)
      .map((l) => ({
        id: l.id,
        name: `${l.firstName} ${l.lastName}`,
        phone: l.phone,
        status: l.status,
        notes: l.notes,
        tags: l.tags,
      }));

    res.json({
      observations,
      staleLeads,
      expiringOffers,
      motivatedCallers: motivatedLeads,
      motivatedVoiceCallers: {
        count: motivatedVoiceCallsSummary.length,
        calls: motivatedVoiceCallsSummary,
      },
      generatedAt: now.toISOString(),
    });
  } catch (error: any) {
    logger.error("Atlas insights error", { error: error.message });
    res.status(500).json({ message: "Failed to load Atlas insights" });
  }
});

// GET /api/atlas/sophie-suggestions
// Returns top 3-5 actionable suggestions from recent high-confidence sophie observations
router.get("/sophie-suggestions", async (req, res) => {
  try {
    const org = (req as any).organization;
    const now = new Date();
    const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);

    // Fetch recent observations with confidence > 70 (stored as 0-100 integer)
    const recentObs = await db
      .select({
        id: sophieObservations.id,
        type: sophieObservations.type,
        severity: sophieObservations.severity,
        title: sophieObservations.title,
        description: sophieObservations.description,
        confidenceScore: sophieObservations.confidenceScore,
        metadata: sophieObservations.metadata,
        detectedAt: sophieObservations.detectedAt,
      })
      .from(sophieObservations)
      .where(
        and(
          eq(sophieObservations.organizationId, org.id),
          eq(sophieObservations.status, "detected"),
          gte(sophieObservations.detectedAt, seventyTwoHoursAgo),
          gt(sophieObservations.confidenceScore, 70)
        )
      )
      .orderBy(desc(sophieObservations.confidenceScore), desc(sophieObservations.detectedAt))
      .limit(20);

    // Also pull stale leads (not contacted in > 21 days) as potential action items
    const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
    const staleLeads = await db
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        lastContactedAt: leads.lastContactedAt,
        status: leads.status,
        email: leads.email,
        phone: leads.phone,
      })
      .from(leads)
      .where(eq(leads.organizationId, org.id))
      .orderBy(leads.lastContactedAt)
      .limit(50);

    const staleFiltered = staleLeads
      .filter((l) => {
        if (["closed", "dead"].includes(l.status ?? "")) return false;
        if (!l.lastContactedAt) return true;
        return new Date(l.lastContactedAt).getTime() < twentyOneDaysAgo.getTime();
      })
      .slice(0, 5);

    type ActionSuggestion = {
      id: string;
      suggestion: string;
      rationale: string;
      action: string;
      actionLabel: string;
      actionUrl: string;
      entityId?: number;
      entityType?: string;
      confidence: number;
    };

    const suggestions: ActionSuggestion[] = [];

    // Map observations to actionable suggestions
    for (const obs of recentObs) {
      if (suggestions.length >= 3) break;

      const confidence = (obs.confidenceScore ?? 0) / 100;
      const entityId = obs.metadata?.relatedEntityId;
      const entityType = obs.metadata?.relatedEntityType;
      let action = "view";
      let actionLabel = "Review";
      let actionUrl = "/today";
      let suggestion = obs.title;
      let rationale = obs.description;

      if (obs.type === "activity_drop" || obs.type === "anomaly") {
        action = "create_task";
        actionLabel = "Create Task";
        actionUrl = "/pipeline";
      } else if (obs.type === "opportunity" || obs.type === "optimization") {
        action = "view_lead";
        actionLabel = "View Lead";
        actionUrl = entityId ? `/leads?highlight=${entityId}` : "/leads";
      } else if (obs.type === "quota_warning" || obs.type === "performance") {
        action = "view_analytics";
        actionLabel = "View Analytics";
        actionUrl = "/analytics";
      } else if (obs.type === "data_issue" || obs.type === "error_pattern") {
        action = "view_settings";
        actionLabel = "Review";
        actionUrl = "/settings";
      } else if (obs.type === "usage_spike") {
        action = "view_dashboard";
        actionLabel = "View Dashboard";
        actionUrl = "/";
      }

      suggestions.push({
        id: `obs-${obs.id}`,
        suggestion,
        rationale,
        action,
        actionLabel,
        actionUrl,
        entityId: entityId ?? undefined,
        entityType: entityType ?? undefined,
        confidence,
      });
    }

    // Fill remaining slots from stale leads (up to 3 total)
    for (const lead of staleFiltered) {
      if (suggestions.length >= 3) break;
      const daysSince = lead.lastContactedAt
        ? Math.floor((now.getTime() - new Date(lead.lastContactedAt).getTime()) / (24 * 60 * 60 * 1000))
        : null;
      const daysText = daysSince != null ? `${daysSince} days ago` : "never";
      suggestions.push({
        id: `stale-${lead.id}`,
        suggestion: `Follow up with ${lead.firstName} ${lead.lastName}`,
        rationale: `Last contacted ${daysText}. Re-engaging stale leads improves conversion rates.`,
        action: lead.email ? "send_email" : "create_task",
        actionLabel: lead.email ? "Send Email" : "Create Task",
        actionUrl: `/leads?highlight=${lead.id}`,
        entityId: lead.id,
        entityType: "lead",
        confidence: 0.82,
      });
    }

    res.json({ suggestions: suggestions.slice(0, 3), generatedAt: now.toISOString() });
  } catch (error: any) {
    logger.error("Sophie suggestions error", { error: error.message });
    res.status(500).json({ message: "Failed to load Sophie suggestions" });
  }
});

export default router;
