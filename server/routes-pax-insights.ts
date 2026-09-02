import { Router } from "express";
import { db, storage } from "./storage";
import { eq, and, desc, lt, gte, lte, gt, sql } from "drizzle-orm";
import { paxObservations, paxNudges, leads, deals, leadActivities, properties } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { executeTool } from "./ai/tools";
import { getOrgAutonomyLevel } from "./services/autonomyGuardrails";
import {
  upsertPendingDraft,
  claimDraftForSend,
  recordDraftSendResult,
} from "./services/paxDraftService";
import {
  approvePendingAction,
  rejectPendingAction,
  listPendingActions,
  countPendingActions,
  toolChannel,
  toolRecipientRef,
} from "./services/approvalKernel";
import type { PendingAction } from "@shared/schema";
import { z } from "zod";

const router = Router();

// GET /api/pax/greeting
// Returns a contextual first-session greeting (fewer than 5 leads = first session).
router.get("/greeting", async (req, res) => {
  try {
    const org = req.organization;

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

    // Only claim sample data exists if it was actually seeded — onboarding sets
    // onboardingData.sampleDataLoaded (server/services/onboarding.ts). Saying
    // "I've set up some sample data" when none was loaded is a fabrication
    // (truth-ratchet); the greeting must reflect the org's real state.
    const sampleDataLoaded = onboardingData.sampleDataLoaded === true;
    const sampleClause = sampleDataLoaded ? " I've set up some sample data to get you started." : "";

    const message = orgState
      ? `Welcome to AcreOS!${sampleClause} Based on your location in ${orgState}, here are some active land markets I'm watching for you.`
      : `Welcome to AcreOS!${sampleClause} Ask me anything about your leads, properties, or deals — I'm here to help you move faster.`;

    return res.json({ message, isFirstSession: true });
  } catch (error: any) {
    logger.error("Pax greeting error", { error: error.message });
    return res.json({ message: null, isFirstSession: false });
  }
});

// GET /api/pax/insights
router.get("/insights", async (req, res) => {
  try {
    const org = req.organization;
    const now = new Date();

    // ── 1. Pax observations (status = 'detected', ordered severity desc, createdAt desc, limit 10) ──
    const rawObservations = await db
      .select({
        id: paxObservations.id,
        type: paxObservations.type,
        severity: paxObservations.severity,
        title: paxObservations.title,
        description: paxObservations.description,
        metadata: paxObservations.metadata,
        createdAt: paxObservations.createdAt,
      })
      .from(paxObservations)
      .where(
        and(
          eq(paxObservations.organizationId, org.id),
          eq(paxObservations.status, "detected")
        )
      )
      // Order by severity (high > medium > low > info) then by createdAt desc
      .orderBy(
        desc(
          // Derive a numeric rank so we can sort by it
          // We use a CASE expression via sql`` but drizzle supports it via sql tag
          // Instead we'll sort client-side after fetch to keep it simple
          paxObservations.createdAt
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

    // ── 4a. (removed 2026-08-01) Voice-pipeline motivated callers rode on the
    // voice_calls table, dropped with the Voice / AI voice kill. With every
    // writer deleted the query could only ever return empty — surfacing a
    // permanently-empty "motivated voice callers" panel would be a lying
    // surface, so the field was removed rather than stubbed. ──

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
      generatedAt: now.toISOString(),
    });
  } catch (error: any) {
    logger.error("Pax insights error", { error: error.message });
    res.status(500).json({ message: "Failed to load Pax insights" });
  }
});

// GET /api/pax/pax-suggestions
// Returns top 3-5 actionable suggestions from recent high-confidence pax observations
router.get("/pax-suggestions", async (req, res) => {
  try {
    const org = req.organization;
    const now = new Date();
    const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);

    // Fetch recent observations with confidence > 70 (stored as 0-100 integer)
    const recentObs = await db
      .select({
        id: paxObservations.id,
        type: paxObservations.type,
        severity: paxObservations.severity,
        title: paxObservations.title,
        description: paxObservations.description,
        confidenceScore: paxObservations.confidenceScore,
        metadata: paxObservations.metadata,
        detectedAt: paxObservations.detectedAt,
      })
      .from(paxObservations)
      .where(
        and(
          eq(paxObservations.organizationId, org.id),
          eq(paxObservations.status, "detected"),
          gte(paxObservations.detectedAt, seventyTwoHoursAgo),
          gt(paxObservations.confidenceScore, 70)
        )
      )
      .orderBy(desc(paxObservations.confidenceScore), desc(paxObservations.detectedAt))
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

    // Fill remaining slots from stale leads (up to 3 total).
    //
    // Confidence here is NOT a model output — this is a deterministic
    // staleness rule. The former hand-coded 0.82 was fabricated. We now derive
    // it from the REAL signal the rule measures: how far past the 21-day
    // staleness cutoff the lead is. A lead 42+ days cold (2× the cutoff) is a
    // maximal-confidence follow-up candidate; a lead just over 21 days is a
    // weaker one; a lead never contacted is treated as maximally stale.
    const STALE_CUTOFF_DAYS = 21;
    for (const lead of staleFiltered) {
      if (suggestions.length >= 3) break;
      const daysSince = lead.lastContactedAt
        ? Math.floor((now.getTime() - new Date(lead.lastContactedAt).getTime()) / (24 * 60 * 60 * 1000))
        : null;
      const daysText = daysSince != null ? `${daysSince} days ago` : "never";
      // Never-contacted ⇒ maximal staleness signal (1.0). Otherwise scale by how
      // far past the cutoff, capped at 2× the cutoff. Floor at 0.5 so a
      // just-triggered rule isn't reported as near-zero.
      const stalenessSignal =
        daysSince == null ? 1 : Math.min(1, daysSince / (STALE_CUTOFF_DAYS * 2));
      const confidence = Math.round((0.5 + 0.45 * stalenessSignal) * 100) / 100;
      suggestions.push({
        id: `stale-${lead.id}`,
        suggestion: `Follow up with ${lead.firstName} ${lead.lastName}`,
        rationale: `Last contacted ${daysText}. Re-engaging stale leads improves conversion rates.`,
        action: lead.email ? "send_email" : "create_task",
        actionLabel: lead.email ? "Send Email" : "Create Task",
        actionUrl: `/leads?highlight=${lead.id}`,
        entityId: lead.id,
        entityType: "lead",
        confidence,
      });
    }

    res.json({ suggestions: suggestions.slice(0, 3), generatedAt: now.toISOString() });
  } catch (error: any) {
    logger.error("Pax suggestions error", { error: error.message });
    res.status(500).json({ message: "Failed to load Pax suggestions" });
  }
});

// ============================================================================
// WITNESSED FIRST-FOLLOW-UP SEND (Maren / "Pax acted" proof)
//
// The minimum proof that Pax is an OPERATOR, not just an advisor: Pax drafts
// the first follow-up to the stalest emailable lead, the human taps "Send",
// and Pax sends it through the real autonomyGuardrails kernel (envelope + TCPA
// + audit). NOTHING sends without an explicit human tap — the draft endpoint
// never sends; only the approve-and-send endpoint does, and only when the
// human invoked it.
// ============================================================================

const STALE_CUTOFF_DAYS = 21;

/**
 * Finds the single best stale lead to follow up with: not closed/dead, has an
 * email, and is the most overdue for contact. Reuses the same staleness rule as
 * /pax-suggestions. Returns null when there's nothing actionable.
 */
async function findStalestEmailableLead(orgId: number) {
  const now = Date.now();
  const cutoff = now - STALE_CUTOFF_DAYS * 24 * 60 * 60 * 1000;

  const candidates = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      status: leads.status,
      lastContactedAt: leads.lastContactedAt,
    })
    .from(leads)
    .where(eq(leads.organizationId, orgId))
    .orderBy(leads.lastContactedAt)
    .limit(50);

  const stale = candidates.filter((l) => {
    if (["closed", "dead", "lost"].includes(l.status ?? "")) return false;
    if (!l.email) return false;
    if (!l.lastContactedAt) return true; // never contacted ⇒ maximally stale
    return new Date(l.lastContactedAt).getTime() < cutoff;
  });

  return stale[0] ?? null;
}

/** Build the follow-up draft for a stale lead. Deterministic, honest copy. */
function buildFollowUpDraft(lead: { firstName: string | null; lastName: string | null }) {
  const name = (lead.firstName || "there").trim();
  const subject = `Following up on your land${lead.firstName ? `, ${name}` : ""}`;
  const message =
    `Hi ${name},\n\n` +
    `I wanted to follow up and see if you're still thinking about your land. ` +
    `If now's a good time to talk through your options — or if anything has changed — ` +
    `just reply to this email and I'll get right back to you.\n\n` +
    `Looking forward to hearing from you.`;
  return { subject, message };
}

// GET /api/pax/first-follow-up/draft
// Pax drafts (does NOT send) a follow-up to the stalest emailable lead.
// 2026-06-10 (T0-6): the draft is now PERSISTED server-side at generation
// time — approval references draftId + contentHash, never client content.
router.get("/first-follow-up/draft", async (req: AuthenticatedRequest, res) => {
  try {
    const org = req.organization!;
    const lead = await findStalestEmailableLead(org.id);
    if (!lead) {
      return res.json({ available: false, draft: null });
    }
    const { subject, message } = buildFollowUpDraft(lead);
    const autonomyLevel = await getOrgAutonomyLevel(org.id);
    const draftRow = await upsertPendingDraft({
      organizationId: org.id,
      leadId: lead.id,
      channel: "email",
      toAddress: lead.email!,
      subject,
      message,
    });
    return res.json({
      available: true,
      autonomyLevel,
      lead: {
        id: lead.id,
        name: `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim(),
        email: lead.email,
      },
      draftId: draftRow.id,
      contentHash: draftRow.contentHash,
      draft: { subject, message },
    });
  } catch (error: any) {
    logger.error("Pax first-follow-up draft error", { error: error.message });
    return Errors.internal(res, error);
  }
});

// 2026-06-10 (T0-6): approval is by draftId + content hash. The old schema
// took client-resupplied subject/message, which meant the human's tap blessed
// whatever the client sent — approval was not bound to the draft Pax wrote.
const approveSendSchema = z.object({
  draftId: z.number().int().positive(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/, "Invalid content hash"),
});

// POST /api/pax/first-follow-up/approve-and-send
// The witnessed tap: the human approved this exact draft, so Pax sends the
// STORED draft through the guarded send path ({ trustedApproval: true }
// unlocks the kernel send) and emits a value event recording that Pax acted.
// Idempotent: the pending→sent claim inside claimDraftForSend means a
// double-tap sends once — the second tap returns the first result.
router.post("/first-follow-up/approve-and-send", async (req: AuthenticatedRequest, res) => {
  try {
    const org = req.organization!;
    const parsed = approveSendSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { draftId, contentHash } = parsed.data;

    const claim = await claimDraftForSend(org.id, draftId, contentHash);

    if (claim.outcome === "not_found") {
      return Errors.notFound(res, "Draft");
    }
    if (claim.outcome === "hash_mismatch") {
      return Errors.badRequest(
        res,
        "This approval doesn't match the stored draft. Refresh, review the draft again, and re-approve.",
      );
    }
    if (claim.outcome === "already_sent") {
      // Second tap — return the first result instead of re-sending.
      return res.json({
        success: true,
        sent: true,
        alreadySent: true,
        data: { messageId: claim.draft.sentMessageId ?? null },
      });
    }

    const draft = claim.draft;

    // Send the STORED draft through the real Pax tool path with the trusted
    // server-side approval option. executeTool routes send_email through
    // autonomyGuardrails: rate-limit + TCPA + recordAutonomousSend. Without
    // trustedApproval this same call would return a draft and send nothing.
    const result = await executeTool(
      "send_email",
      { lead_id: draft.leadId, subject: draft.subject, message: draft.message },
      org,
      { trustedApproval: true },
    );

    const messageId: string | null = (result.data as any)?.messageId ?? null;
    // On failure this releases the claim back to 'pending' so the human can
    // retry; on success it stores the provider message id for idempotent
    // replays of the second tap.
    await recordDraftSendResult(org.id, draft.id, {
      success: result.success,
      messageId,
    });

    if (!result.success) {
      return Errors.badRequest(res, result.error || "Pax could not send the follow-up");
    }

    // Value event: a measurable record that Pax SENT something on the human's
    // approval. This is the "Pax acted" signal the pricing thesis is built on.
    await storage.logActivity({
      organizationId: org.id,
      agentType: "pax",
      action: "pax_value_event",
      entityType: "lead",
      entityId: draft.leadId,
      description: "Pax sent a witnessed first follow-up email after human approval",
      metadata: {
        valueEvent: "first_follow_up_sent",
        channel: "email",
        witnessed: true,
        approvedByHuman: true,
        draftId: draft.id,
        messageId,
      },
    });

    return res.json({ success: true, sent: true, data: result.data });
  } catch (error: any) {
    logger.error("Pax first-follow-up approve-and-send error", { error: error.message });
    return Errors.internal(res, error);
  }
});

// ── Approval kernel endpoints (2026-06-10, Tier 1A elevation blueprint) ─────
// The ONLY path from a frozen pending_actions row to execution. executeTool
// freezes every approval-required tool call as a pending_actions row; the
// human tap lands here; the kernel re-verifies org ownership + expiry +
// content hash against the FROZEN args and executes exactly that row with
// the trusted server-side approval option. Idempotent: a double-tap returns
// the first result instead of double-sending.

function parsePendingActionId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// POST /api/pax/pending-actions/:id/approve
router.post("/pending-actions/:id/approve", async (req: AuthenticatedRequest, res) => {
  try {
    const org = req.organization!;
    const pendingActionId = parsePendingActionId(req.params.id);
    if (!pendingActionId) {
      return Errors.badRequest(res, "Invalid pending action id");
    }
    const userId = getUserId(req);

    const outcome = await approvePendingAction({
      organizationId: org.id,
      pendingActionId,
      approvedByUserId: userId,
      // The kernel executes EXACTLY the frozen row through the real tool
      // path; trustedApproval is the server-side option the model can never
      // set. Without it this same call would re-freeze instead of sending.
      execute: (toolName, args) =>
        executeTool(toolName, args as Record<string, any>, org, {
          trustedApproval: true,
          userId,
        }),
    });

    switch (outcome.outcome) {
      case "not_found":
        return Errors.notFound(res, "Pending action");
      case "expired":
        return Errors.badRequest(
          res,
          "This action has expired. Ask Pax to draft it again so you can review a fresh version.",
        );
      case "rejected":
        return Errors.badRequest(res, "This action was rejected and can no longer be executed.");
      case "hash_mismatch":
        return Errors.badRequest(
          res,
          "This action failed integrity verification and will not be executed. Ask Pax to draft it again.",
        );
      case "in_flight":
        // Concurrent tap lost the race while the first is still executing.
        return res.json({ success: true, executed: false, inFlight: true });
      case "execution_failed":
        return Errors.badRequest(res, outcome.error);
      case "already_executed":
        // Idempotency: the second tap returns the first result — no re-send.
        return res.json({
          success: true,
          executed: true,
          alreadyExecuted: true,
          result: outcome.result,
        });
      case "executed": {
        // Value event: a measurable record that Pax ACTED on a human's
        // witnessed approval (same discipline as the first-follow-up send).
        await storage.logActivity({
          organizationId: org.id,
          agentType: "pax",
          action: "pax_value_event",
          entityType: "pending_action",
          entityId: outcome.action.id,
          description: `Pax executed ${outcome.action.toolName} after human approval`,
          metadata: {
            valueEvent: "approved_action_executed",
            toolName: outcome.action.toolName,
            channel: toolChannel(outcome.action.toolName),
            witnessed: true,
            approvedByHuman: true,
            pendingActionId: outcome.action.id,
          },
        });
        return res.json({ success: true, executed: true, result: outcome.result });
      }
      default:
        // Exhaustive switch — unreachable; satisfies noImplicitReturns.
        return Errors.internal(res, new Error("Unhandled approval outcome"));
    }
  } catch (error: any) {
    logger.error("Pax pending-action approve error", { error: error.message });
    return Errors.internal(res, error);
  }
});

// POST /api/pax/pending-actions/:id/reject
router.post("/pending-actions/:id/reject", async (req: AuthenticatedRequest, res) => {
  try {
    const org = req.organization!;
    const pendingActionId = parsePendingActionId(req.params.id);
    if (!pendingActionId) {
      return Errors.badRequest(res, "Invalid pending action id");
    }

    const outcome = await rejectPendingAction({
      organizationId: org.id,
      pendingActionId,
    });

    if (outcome.outcome === "not_found") {
      return Errors.notFound(res, "Pending action");
    }
    if (outcome.outcome === "already_executed") {
      return Errors.badRequest(res, "This action already executed and cannot be rejected.");
    }
    return res.json({ success: true, rejected: true });
  } catch (error: any) {
    logger.error("Pax pending-action reject error", { error: error.message });
    return Errors.internal(res, error);
  }
});

// ── Review-queue reads (autonomy clarity program, 2026-09-02) ───────────────
// The customer-side view of the kernel's frozen rows: what is waiting on a
// human tap right now. Same auth/org scoping as approve/reject above
// (isAuthenticated + getOrCreateOrg at the mount; the org comes from
// req.organization, never from the client). Each read is ONE indexed query
// and shares the router-wide paxChatGuard (30/min) with chat — keep them
// cheap; the badge polls slowly and refetches on `pending_action.created`.

/**
 * Card shape for one review-queue row. Never the raw row: resultSummary,
 * contentHash and the approver stay server-side; the card needs what a human
 * reads to decide — what, to whom, over which channel, and how long it lives.
 */
function pendingActionCard(row: PendingAction) {
  const args = row.args as Record<string, unknown>;
  return {
    id: row.id,
    toolName: row.toolName,
    channel: toolChannel(row.toolName),
    recipient: toolRecipientRef(row.toolName, args),
    args,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

const PENDING_LIST_ROUTE_MAX = 100;

// GET /api/pax/pending-actions?limit=50 — live (pending, unexpired) actions, newest first.
router.get("/pending-actions", async (req: AuthenticatedRequest, res) => {
  try {
    const org = req.organization!;
    const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, PENDING_LIST_ROUTE_MAX) : 50;
    const rows = await listPendingActions(org.id, { limit });
    return res.json({ actions: rows.map(pendingActionCard) });
  } catch (error: unknown) {
    logger.error("Pax pending-actions list error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Errors.internal(res, error);
  }
});

// GET /api/pax/pending-actions/count — badge count, same predicate as the list.
router.get("/pending-actions/count", async (req: AuthenticatedRequest, res) => {
  try {
    const org = req.organization!;
    const count = await countPendingActions(org.id);
    return res.json({ count });
  } catch (error: unknown) {
    logger.error("Pax pending-actions count error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Errors.internal(res, error);
  }
});

// PATCH /api/pax/nudges/:nudgeId/snooze
router.patch("/nudges/:nudgeId/snooze", async (req, res) => {
  try {
    const org = req.organization;
    const nudgeId = parseInt(req.params.nudgeId);
    const { hours = 24 } = req.body; // default snooze 24 hours

    const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);

    await db.update(paxNudges)
      .set({
        snoozedUntil,
        snoozeCount: sql`${paxNudges.snoozeCount} + 1`,
        actionType: "snoozed",
      } as any)
      .where(and(
        eq(paxNudges.id as any, nudgeId),
        eq(paxNudges.organizationId as any, org.id)
      ));

    res.json({ success: true, snoozedUntil });
  } catch (e: any) {
    Errors.internal(res, e);
  }
});

// PATCH /api/pax/nudges/:nudgeId/action
router.patch("/nudges/:nudgeId/action", async (req, res) => {
  try {
    const org = req.organization;
    const nudgeId = parseInt(req.params.nudgeId);

    await db.update(paxNudges)
      .set({
        actionedAt: new Date(),
        actionType: "actioned",
        dismissedAt: new Date(),
      } as any)
      .where(and(
        eq(paxNudges.id as any, nudgeId),
        eq(paxNudges.organizationId as any, org.id)
      ));

    res.json({ success: true });
  } catch (e: any) {
    Errors.internal(res, e);
  }
});

export default router;
