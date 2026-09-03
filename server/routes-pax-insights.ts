import { Router } from "express";
import { db } from "./db";
import { storage } from "./storage";
import { eq, and, asc, desc, gte, lte, gt, sql, inArray, isNull } from "drizzle-orm";
import {
  paxObservations,
  paxNudges,
  leads,
  deals,
  properties,
  pendingActions,
  connectedMailboxes,
  type PendingAction,
} from "@shared/schema";
import { logger } from "./utils/logger";
import { Errors, sendError } from "./utils/errors";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getUserId } from "./types/request";
import {
  approvePendingAction,
  rejectPendingAction,
  revisePendingAction,
  countPendingActions,
  toolChannel,
} from "./services/approvalKernel";
import { executeApprovedAsk } from "./services/paxAskExecutors";
import { summarizeAsk } from "./services/paxAskSummary";
import { getPaxControls } from "./services/paxControls";
import { PARKED_STATES } from "@shared/pax-controls";
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

// ── Approval kernel endpoints (2026-06-10, Tier 1A elevation blueprint) ─────
// The ONLY path from a frozen pending_actions row to execution. The kernel
// (executeTool / executeSupportTool / the borrower ladder) freezes every ask
// as a pending_actions row; the human tap lands here; the kernel re-verifies
// org ownership + expiry + content hash against the FROZEN args and replays
// exactly that row through the rail that owns its tool name
// (server/services/paxAskExecutors.ts). Idempotent: a double-tap returns the
// first result instead of double-sending.
//
// The witnessed first-follow-up lane (paxDraftService + pax_drafts) that used
// to sit here was a SECOND approval mechanism with zero client callers; it is
// gone (AUTONOMY_SPEC.md §3d) — one kernel only.

function parsePendingActionId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// POST /api/pax/pending-actions/:id/approve
router.post("/pending-actions/:id/approve", async (req: AuthenticatedRequest, res) => {
  try {
    const org = getOrganization(req);
    const pendingActionId = parsePendingActionId(req.params.id);
    if (!pendingActionId) {
      return Errors.badRequest(res, "Invalid pending action id");
    }
    const userId = getUserId(req);

    // The frozen source_ref rides along to the executor (a support ask's
    // ticket, a borrower rung's note) — read org-scoped, never from the client.
    const [frozen] = await db
      .select({ sourceRef: pendingActions.sourceRef })
      .from(pendingActions)
      .where(and(eq(pendingActions.id, pendingActionId), eq(pendingActions.organizationId, org.id)))
      .limit(1);
    if (!frozen) return Errors.notFound(res, "Pending action");

    const outcome = await approvePendingAction({
      organizationId: org.id,
      pendingActionId,
      approvedByUserId: userId,
      // The kernel executes EXACTLY the frozen row through the rail that
      // owns the tool name, with the tap as the trusted approval. The
      // executor writes the attributed receipt ("What Pax did") — one tap,
      // one row; this route no longer logs its own pax_value_event.
      execute: (toolName, args) =>
        executeApprovedAsk(toolName, args, {
          org,
          userId,
          pendingActionId,
          sourceRef: frozen.sourceRef ?? null,
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
      case "executed":
        return res.json({ success: true, executed: true, result: outcome.result });
      default:
        // Exhaustive switch — unreachable; satisfies noImplicitReturns.
        return Errors.internal(res, new Error("Unhandled approval outcome"));
    }
  } catch (error: unknown) {
    logger.error("Pax pending-action approve error", error instanceof Error ? error : undefined);
    return Errors.internal(res, error);
  }
});

// POST /api/pax/pending-actions/:id/reject
router.post("/pending-actions/:id/reject", async (req: AuthenticatedRequest, res) => {
  try {
    const org = getOrganization(req);
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
  } catch (error: unknown) {
    logger.error("Pax pending-action reject error", error instanceof Error ? error : undefined);
    return Errors.internal(res, error);
  }
});

// POST /api/pax/pending-actions/:id/revise { args } — Edit on the ask card
// (AUTONOMY_SPEC.md §4.5). The human's args are validated against the tool's
// OWN definition inside the kernel; the old row is claimed pending→rejected
// and the revised row inserted in ONE transaction, so a double tap yields one
// new row, one approval, one send. 200 { id } · 404 other org / missing ·
// 409 not pending · 422 invalid args.
const reviseSchema = z.object({ args: z.record(z.string(), z.unknown()) }).strict();

router.post("/pending-actions/:id/revise", async (req: AuthenticatedRequest, res) => {
  try {
    const org = getOrganization(req);
    const pendingActionId = parsePendingActionId(req.params.id);
    if (!pendingActionId) {
      return Errors.badRequest(res, "Invalid pending action id");
    }
    const parsed = reviseSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const userId = getUserId(req);

    const outcome = await revisePendingAction({
      organizationId: org.id,
      pendingActionId,
      userId,
      args: parsed.data.args as Record<string, unknown>,
    });

    if (outcome.ok) {
      return res.json({ id: outcome.newId });
    }
    switch (outcome.reason) {
      case "not_found":
        return Errors.notFound(res, "Pending action");
      case "not_pending":
        return sendError(
          res,
          409,
          "Conflict",
          "This ask is no longer waiting — it was approved, rejected, edited or expired. Refresh to see the current one.",
        );
      case "invalid_args":
        return Errors.validationFailed(res, outcome.details ?? []);
      default:
        return Errors.internal(res, new Error("Unhandled revision outcome"));
    }
  } catch (error: unknown) {
    logger.error("Pax pending-action revise error", error instanceof Error ? error : undefined);
    return Errors.internal(res, error);
  }
});

// ── "Waiting for your tap" (autonomy clarity program, spec §4.5) ────────────
// The customer-side view of the kernel's frozen rows: what is waiting on a
// human tap right now, SERVER-formatted by summarizeAsk so the rail, the
// pinned strip, Today's queue and the support chat render one wording. Same
// auth/org scoping as approve/reject above (isAuthenticated + getOrCreateOrg
// at the mount; the org comes from req.organization, never from the client).
// Each read is a couple of indexed queries and shares the router-wide
// paxChatGuard (30/min) with chat — keep them cheap; the badge polls slowly
// and refetches on `pax.needs_you`.

const NEEDS_YOU_DEFAULT_LIMIT = 50;
const NEEDS_YOU_MAX_LIMIT = 100;
/** Expired asks stay listed this long under the glossary's expired line. */
const EXPIRED_LISTING_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The statuses this queue reads for `pending_actions`, DERIVED from
 * PARKED_STATES (shared/pax-controls.ts) — the same registry the page and
 * tests/unit/needsYouCountIsComplete.test.ts read. A parked state added to
 * the registry that this list does not read is exactly what that gate fails.
 */
const PARKED_PENDING_ACTION_STATUSES: string[] = PARKED_STATES
  .filter((s) => s.startsWith("pending_actions:"))
  .map((s) => s.slice("pending_actions:".length));

/**
 * The org's live asks (parked, unexpired) ordered by expiry — soonest first —
 * plus the asks that expired within the last 7 days, newest expiry first.
 * Org-scoped in BOTH queries (asserted on the rendered SQL by the gates).
 */
async function readNeedsYouRows(organizationId: number, limit: number, now: Date) {
  const live = await db
    .select()
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.organizationId, organizationId),
        inArray(pendingActions.status, PARKED_PENDING_ACTION_STATUSES),
        gt(pendingActions.expiresAt, now),
      ),
    )
    .orderBy(asc(pendingActions.expiresAt))
    .limit(limit);
  const expiredSince = new Date(now.getTime() - EXPIRED_LISTING_MS);
  const expired = await db
    .select()
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.organizationId, organizationId),
        // A parked row past its TTL the sweep has not stamped yet reads as
        // expired too — the readers apply the live predicate themselves.
        inArray(pendingActions.status, [...PARKED_PENDING_ACTION_STATUSES, "expired"]),
        lte(pendingActions.expiresAt, now),
        gte(pendingActions.expiresAt, expiredSince),
      ),
    )
    .orderBy(desc(pendingActions.expiresAt))
    .limit(limit);
  return { live, expired };
}

/**
 * The org's connected sending identity per channel, in the customer's
 * words, for the card's "from" line. Read from the rows that prove a
 * connection (an unrevoked BYOK credential; a connected mailbox) — a channel
 * with no such row gets NO entry, and summarizeAsk prints the glossary's
 * "no sending identity connected" line for it. Returns null when the lookup
 * itself failed, so a failed read never prints as "nothing connected".
 */
async function resolveSendingIdentities(
  organizationId: number,
): Promise<Partial<Record<string, string>> | null> {
  try {
    const { listByokCredentials } = await import("./services/byok/key-vault");
    const credentials = await listByokCredentials(organizationId);
    const active = new Set(credentials.filter((c) => !c.revokedAt).map((c) => c.channel));
    const identities: Partial<Record<string, string>> = {};
    if (active.has("twilio")) identities.sms = "your Twilio number";
    else if (active.has("telnyx")) identities.sms = "your Telnyx number";
    if (active.has("sendgrid")) identities.email = "your SendGrid sender";
    else if (active.has("ses")) identities.email = "your Amazon SES sender";

    const mailboxes = await db
      .select({ provider: connectedMailboxes.provider, emailAddress: connectedMailboxes.emailAddress })
      .from(connectedMailboxes)
      .where(
        and(
          eq(connectedMailboxes.organizationId, organizationId),
          eq(connectedMailboxes.status, "connected"),
          isNull(connectedMailboxes.revokedAt),
        ),
      )
      .limit(1);
    const mailbox = mailboxes[0];
    if (mailbox) {
      const label = mailbox.provider === "gmail" ? "Gmail" : mailbox.provider === "outlook" ? "Outlook" : mailbox.provider;
      identities.email = `your ${label} (${mailbox.emailAddress})`;
    }
    return identities;
  } catch (error: unknown) {
    logger.warn("[pax-insights] Could not read the org's sending identities — the card will not name one", {
      orgId: organizationId,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

/** Channels whose identity this route can verify from a row. Others get no "from" claim. */
const RESOLVABLE_CHANNELS: ReadonlySet<string> = new Set(["sms", "email"]);

// GET /api/pax/needs-you?limit=50
router.get("/needs-you", async (req: AuthenticatedRequest, res) => {
  try {
    const org = getOrganization(req);
    const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, NEEDS_YOU_MAX_LIMIT) : NEEDS_YOU_DEFAULT_LIMIT;
    const now = new Date();

    // Attribution only: the org's zone for the expiry line. A tap is the
    // human acting; the stance never gates this read.
    const controls = await getPaxControls(org.id);
    const [{ live, expired }, identities] = await Promise.all([
      readNeedsYouRows(org.id, limit, now),
      resolveSendingIdentities(org.id),
    ]);

    const toItem = (row: PendingAction, status: "pending" | "expired") => {
      const summary = summarizeAsk(
        {
          id: row.id,
          toolName: row.toolName,
          args: row.args as Record<string, unknown>,
          status,
          expiresAt: row.expiresAt,
          origin: row.origin ?? null,
          reason: row.reason ?? null,
          sourceRef: row.sourceRef ?? null,
        },
        { timeZone: controls.timezone, identities: identities ?? undefined, now },
      );
      const channel = row.toolName === "send_borrower_reminder"
        ? String((row.args as Record<string, unknown>).channel ?? "")
        : toolChannel(row.toolName);
      // No claim about a channel this route cannot verify from a row.
      const from = identities && RESOLVABLE_CHANNELS.has(channel) ? summary.from : null;
      return {
        ...summary,
        from,
        id: row.id,
        status,
        expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
      };
    };

    return res.json({
      items: [...live.map((r) => toItem(r, "pending")), ...expired.map((r) => toItem(r, "expired"))],
    });
  } catch (error: unknown) {
    logger.error("Pax needs-you list error", error instanceof Error ? error : undefined);
    return Errors.internal(res, error);
  }
});

// GET /api/pax/needs-you/count — badge count, the kernel's live predicate.
router.get("/needs-you/count", async (req: AuthenticatedRequest, res) => {
  try {
    const org = getOrganization(req);
    const count = await countPendingActions(org.id);
    return res.json({ count });
  } catch (error: unknown) {
    logger.error("Pax needs-you count error", error instanceof Error ? error : undefined);
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
