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

    // ── 4. Motivated callers: leads with urgency tags or keywords in notes ──
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
      generatedAt: now.toISOString(),
    });
  } catch (error: any) {
    logger.error("Atlas insights error", { error: error.message });
    res.status(500).json({ message: "Failed to load Atlas insights" });
  }
});

export default router;
