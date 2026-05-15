/**
 * Team-readiness routes — Phase 5 §5 (per-seat pricing, lead assignment
 * rules, manager dashboard, Slack/Teams integrations, offer-approval queue).
 *
 * All endpoints under /api/team-readiness/* are admin-or-above gated unless
 * documented otherwise. The server is the source of truth for tier limits;
 * the client must round-trip through these endpoints to mutate state.
 */

import type { Express } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, sql, inArray } from "drizzle-orm";
import { db, storage } from "./storage";
import {
  organizations,
  teamMembers,
  leadAssignmentRules,
  orgAssignmentCursor,
  orgIntegrationsSlack,
  offerApprovals,
  offers,
  leads,
  deals,
} from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireAdminOrAbove } from "./utils/permissions";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  TIER_PRICES_CENTS,
  totalMonthlyBillCents,
  seatAddonCents,
  describeSeatPricing,
  canAddSeats,
  tierForSubscriptionTier,
  type Tier,
  type BillingInterval,
} from "@shared/billing/tier-pricing";
import type { AuthenticatedRequest } from "./types/request";

// ─── Validation schemas ─────────────────────────────────────────────────────
const upsertRuleSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(120),
  ruleType: z.enum(["round_robin", "territory", "random"]),
  priority: z.number().int().min(0).max(10000).default(100),
  territoryFilter: z.object({
    states: z.array(z.string()).optional(),
    counties: z.array(z.string()).optional(),
  }).optional(),
  weightedAssignees: z.array(z.object({
    teamMemberId: z.number().int().positive(),
    weight: z.number().int().min(1).max(100).default(1),
  })).min(1),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const slackIntegrationSchema = z.object({
  provider: z.enum(["slack", "teams"]).default("slack"),
  webhookUrl: z.string().url(),
  channelName: z.string().optional(),
  eventTypes: z.array(z.string()).default(["deal_closed", "big_lead_arrived"]),
  isActive: z.boolean().default(true),
});

const setSeatCountSchema = z.object({
  seatCount: z.number().int().min(1).max(500),
});

const offerThresholdSchema = z.object({
  requiresApprovalOffersOver: z.number().nonnegative().nullable(),
});

const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "declined"]),
  notes: z.string().max(2000).optional(),
});

const performanceQuerySchema = z.object({
  range: z.enum(["7d", "30d", "90d"]).default("30d"),
});

// ─── Registration ───────────────────────────────────────────────────────────
export function registerTeamReadinessRoutes(app: Express): void {
  // ── Per-seat pricing ───────────────────────────────────────────────────
  app.get(
    "/api/team-readiness/billing-summary",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const tier = tierForSubscriptionTier(org.subscriptionTier);
        const interval = (org.billingInterval as BillingInterval) || "monthly";
        const seatCount = (org as any).seatCount ?? 1;

        if (!tier) {
          return res.json({
            tier: null,
            seatCount,
            interval,
            description: "Free tier — upgrade to add seats.",
            baseCents: 0,
            seatAddonCents: 0,
            totalCents: 0,
            canAddMoreSeats: false,
          });
        }

        return res.json({
          tier,
          seatCount,
          interval,
          description: describeSeatPricing(tier, seatCount, interval),
          baseCents: TIER_PRICES_CENTS[tier].priceMonthlyCents,
          seatAddonCents: seatAddonCents(tier, seatCount, interval),
          totalCents: totalMonthlyBillCents(tier, seatCount, interval),
          maxSeats: TIER_PRICES_CENTS[tier].maxSeats,
          perSeatCents: TIER_PRICES_CENTS[tier].priceMonthlyPerSeatCents,
          canAddMoreSeats: canAddSeats(tier, seatCount + 1),
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/team-readiness/seat-count",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const parsed = setSeatCountSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const tier = tierForSubscriptionTier(org.subscriptionTier);
        if (!tier) return Errors.forbidden(res, "Free tier cannot add seats — upgrade required");
        if (!canAddSeats(tier, parsed.data.seatCount)) {
          return Errors.forbidden(
            res,
            `Tier ${tier} is capped at ${TIER_PRICES_CENTS[tier].maxSeats} seat(s). Upgrade to Pro or Scale to add more.`,
          );
        }

        await db
          .update(organizations)
          .set({ seatCount: parsed.data.seatCount, updatedAt: new Date() })
          .where(eq(organizations.id, org.id));

        // Stripe subscription update is delegated to the existing
        // server/stripeService — we record the desired state here and the
        // billing reconciler picks it up on next webhook tick. This keeps
        // the route fast even when Stripe is unreachable.
        try {
          const { syncSeatAddon } = await import("./services/billing/seatBilling");
          await syncSeatAddon(org.id, parsed.data.seatCount).catch((e) => {
            logger.warn("syncSeatAddon failed (non-fatal)", { error: (e as Error).message });
          });
        } catch { /* non-fatal */ }

        return res.json({ ok: true, seatCount: parsed.data.seatCount });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Pre-flight check before sending an invite ─────────────────────────
  app.get(
    "/api/team-readiness/invite-preflight",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const tier = tierForSubscriptionTier(org.subscriptionTier);
        const seatCount = (org as any).seatCount ?? 1;

        // Count active members to know the next seat the invite will fill.
        const [{ count: activeCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.organizationId, org.id),
              eq(teamMembers.isActive, true),
            ),
          );

        const requestedSeat = activeCount + 1;
        const needsUpgrade = !tier ||
          !canAddSeats(tier, requestedSeat);
        const needsSeatPurchase = tier !== null &&
          canAddSeats(tier, requestedSeat) &&
          requestedSeat > seatCount;

        return res.json({
          tier,
          seatCount,
          activeMembers: activeCount,
          requestedSeat,
          needsUpgrade,
          needsSeatPurchase,
          additionalMonthlyCents: tier
            ? seatAddonCents(tier, requestedSeat, (org.billingInterval as BillingInterval) || "monthly") -
              seatAddonCents(tier, seatCount, (org.billingInterval as BillingInterval) || "monthly")
            : 0,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Lead assignment rules ──────────────────────────────────────────────
  app.get(
    "/api/team-readiness/lead-assignment-rules",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const rows = await db
          .select()
          .from(leadAssignmentRules)
          .where(eq(leadAssignmentRules.organizationId, org.id))
          .orderBy(asc(leadAssignmentRules.priority));
        return res.json({ rules: rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/team-readiness/lead-assignment-rules",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const parsed = upsertRuleSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const data = parsed.data;
        if (data.id) {
          const [updated] = await db
            .update(leadAssignmentRules)
            .set({
              name: data.name,
              ruleType: data.ruleType,
              priority: data.priority,
              territoryFilter: data.territoryFilter ?? null,
              weightedAssignees: data.weightedAssignees,
              isDefault: data.isDefault,
              isActive: data.isActive,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(leadAssignmentRules.id, data.id),
                eq(leadAssignmentRules.organizationId, org.id),
              ),
            )
            .returning();
          if (!updated) return Errors.notFound(res, "Rule");
          return res.json({ rule: updated });
        }

        const [created] = await db
          .insert(leadAssignmentRules)
          .values({
            organizationId: org.id,
            name: data.name,
            ruleType: data.ruleType,
            priority: data.priority,
            territoryFilter: data.territoryFilter ?? null,
            weightedAssignees: data.weightedAssignees,
            isDefault: data.isDefault,
            isActive: data.isActive,
          })
          .returning();

        return res.status(201).json({ rule: created });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.delete(
    "/api/team-readiness/lead-assignment-rules/:id",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid rule id");
        const [deleted] = await db
          .delete(leadAssignmentRules)
          .where(
            and(
              eq(leadAssignmentRules.id, id),
              eq(leadAssignmentRules.organizationId, org.id),
            ),
          )
          .returning();
        if (!deleted) return Errors.notFound(res, "Rule");
        return res.json({ ok: true });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/team-readiness/lead-assignment-rules/test",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const sample = z
          .object({ state: z.string().optional(), county: z.string().optional() })
          .safeParse(req.body);
        if (!sample.success) return Errors.validationFailed(res, sample.error.issues);

        const { assignLead } = await import("./services/leadAssigner");
        const teamMemberId = await assignLead(org.id, sample.data);
        return res.json({ teamMemberId });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Slack / Teams integrations ─────────────────────────────────────────
  app.get(
    "/api/team-readiness/slack-integrations",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const rows = await db
          .select()
          .from(orgIntegrationsSlack)
          .where(eq(orgIntegrationsSlack.organizationId, org.id));
        // Redact webhookUrl in list view — only the host is useful for UI.
        const redacted = rows.map((r) => ({
          ...r,
          webhookUrl: r.webhookUrl ? maskWebhookUrl(r.webhookUrl) : null,
        }));
        return res.json({ integrations: redacted });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/team-readiness/slack-integrations",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const parsed = slackIntegrationSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const data = parsed.data;
        // Upsert on (org, provider).
        const [existing] = await db
          .select()
          .from(orgIntegrationsSlack)
          .where(
            and(
              eq(orgIntegrationsSlack.organizationId, org.id),
              eq(orgIntegrationsSlack.provider, data.provider),
            ),
          );

        let row;
        if (existing) {
          [row] = await db
            .update(orgIntegrationsSlack)
            .set({
              webhookUrl: data.webhookUrl,
              channelName: data.channelName ?? null,
              eventTypes: data.eventTypes,
              isActive: data.isActive,
              updatedAt: new Date(),
            })
            .where(eq(orgIntegrationsSlack.id, existing.id))
            .returning();
        } else {
          [row] = await db
            .insert(orgIntegrationsSlack)
            .values({
              organizationId: org.id,
              provider: data.provider,
              webhookUrl: data.webhookUrl,
              channelName: data.channelName ?? null,
              eventTypes: data.eventTypes,
              isActive: data.isActive,
            })
            .returning();
        }

        return res.status(existing ? 200 : 201).json({
          integration: { ...row!, webhookUrl: maskWebhookUrl(row!.webhookUrl) },
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.delete(
    "/api/team-readiness/slack-integrations/:id",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
        const [deleted] = await db
          .delete(orgIntegrationsSlack)
          .where(
            and(
              eq(orgIntegrationsSlack.id, id),
              eq(orgIntegrationsSlack.organizationId, org.id),
            ),
          )
          .returning();
        if (!deleted) return Errors.notFound(res, "Integration");
        return res.json({ ok: true });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Offer-approval threshold + queue ──────────────────────────────────
  app.put(
    "/api/team-readiness/offer-approval-threshold",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const parsed = offerThresholdSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        await db
          .update(organizations)
          .set({
            requiresApprovalOffersOver: parsed.data.requiresApprovalOffersOver === null
              ? null
              : String(parsed.data.requiresApprovalOffersOver),
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, org.id));

        return res.json({ ok: true, threshold: parsed.data.requiresApprovalOffersOver });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/team-readiness/offer-approvals",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const rows = await db
          .select()
          .from(offerApprovals)
          .where(eq(offerApprovals.organizationId, org.id))
          .orderBy(desc(offerApprovals.createdAt))
          .limit(200);
        return res.json({ approvals: rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/team-readiness/offer-approvals/:id/decision",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
        const parsed = approvalDecisionSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const user = (req as any).user;
        const reviewerId = user?.claims?.sub || user?.id || null;

        const [existing] = await db
          .select()
          .from(offerApprovals)
          .where(
            and(
              eq(offerApprovals.id, id),
              eq(offerApprovals.organizationId, org.id),
            ),
          );
        if (!existing) return Errors.notFound(res, "Approval");
        if (existing.status !== "pending") {
          return Errors.badRequest(res, `Approval already ${existing.status}`);
        }

        const [updated] = await db
          .update(offerApprovals)
          .set({
            status: parsed.data.decision,
            reviewerId,
            reviewerNotes: parsed.data.notes ?? null,
            decidedAt: new Date(),
          })
          .where(eq(offerApprovals.id, id))
          .returning();

        // Sync linked offer status: approved → "approved", declined → "draft".
        if (parsed.data.decision === "approved") {
          await db
            .update(offers)
            .set({ status: "approved", updatedAt: new Date() })
            .where(eq(offers.id, existing.offerId));
        } else {
          await db
            .update(offers)
            .set({ status: "draft", updatedAt: new Date() })
            .where(eq(offers.id, existing.offerId));
        }

        // Audit-log every approval/decline (Phase 5 §5 Part E #18).
        await storage
          .createAuditLogEntry({
            organizationId: org.id,
            userId: reviewerId,
            action: parsed.data.decision === "approved" ? "approve" : "decline",
            entityType: "offer_approval",
            entityId: existing.id,
            changes: { after: { status: parsed.data.decision }, fields: ["status"] },
            ipAddress: req.ip || null,
            userAgent: req.headers["user-agent"] || null,
            metadata: {
              offerId: existing.offerId,
              thresholdAmount: existing.thresholdAmount,
              offerAmount: existing.offerAmount,
              notes: parsed.data.notes ?? null,
            },
          })
          .catch((e) => logger.warn("audit log failed", { error: (e as Error).message }));

        return res.json({ approval: updated });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Manager dashboard — per-rep performance ────────────────────────────
  app.get(
    "/api/team-readiness/rep-performance",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const parsed = performanceQuerySchema.safeParse(req.query);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const days = parsed.data.range === "7d" ? 7 : parsed.data.range === "90d" ? 90 : 30;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const performance = await getRepPerformance(org.id, since);
        return res.json({ range: parsed.data.range, since: since.toISOString(), performance });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Per-rep performance rollup. Returns one row per active team member with
 * leadsAssigned / leadsContacted / dealsOpened / dealsClosed / mrrContrib.
 *
 * MRR contribution is computed from closed-won deals' purchasePrice in the
 * window — the proxy for "how much revenue did this rep close" without
 * needing a finance-team-grade attribution model.
 */
async function getRepPerformance(orgId: number, since: Date): Promise<Array<{
  teamMemberId: number;
  displayName: string | null;
  email: string | null;
  role: string;
  leadsAssigned: number;
  leadsContacted: number;
  dealsOpened: number;
  dealsClosed: number;
  mrrContribCents: number;
}>> {
  const members = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.organizationId, orgId),
        eq(teamMembers.isActive, true),
      ),
    );

  if (members.length === 0) return [];
  const memberIds = members.map((m) => m.id);

  // Leads assigned in window
  const leadsAssignedRows = await db
    .select({
      assignedTo: leads.assignedTo,
      cnt: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, orgId),
        gte(leads.createdAt, since),
        inArray(leads.assignedTo, memberIds),
      ),
    )
    .groupBy(leads.assignedTo);

  // Leads contacted = lastContactedAt in window
  const leadsContactedRows = await db
    .select({
      assignedTo: leads.assignedTo,
      cnt: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, orgId),
        gte(leads.lastContactedAt, since),
        inArray(leads.assignedTo, memberIds),
      ),
    )
    .groupBy(leads.assignedTo);

  // Deals opened / closed — use deals table if it has assignedTo column
  // (schema.ts L4484). Group by assignedTo with status filter.
  const dealsOpenedRows = await db
    .select({
      assignedTo: deals.assignedTo,
      cnt: sql<number>`count(*)::int`,
    })
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, orgId),
        gte(deals.createdAt, since),
        inArray(deals.assignedTo, memberIds),
      ),
    )
    .groupBy(deals.assignedTo);

  const dealsClosedRows = await db
    .select({
      assignedTo: deals.assignedTo,
      cnt: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${deals.acceptedAmount}), 0)::text`,
    })
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, orgId),
        eq(deals.status, "closed"),
        gte(deals.createdAt, since),
        inArray(deals.assignedTo, memberIds),
      ),
    )
    .groupBy(deals.assignedTo);

  const byMember = new Map<number, {
    leadsAssigned: number;
    leadsContacted: number;
    dealsOpened: number;
    dealsClosed: number;
    mrrContribCents: number;
  }>();
  for (const id of memberIds) {
    byMember.set(id, {
      leadsAssigned: 0,
      leadsContacted: 0,
      dealsOpened: 0,
      dealsClosed: 0,
      mrrContribCents: 0,
    });
  }
  for (const r of leadsAssignedRows) {
    if (r.assignedTo != null) byMember.get(r.assignedTo)!.leadsAssigned = r.cnt;
  }
  for (const r of leadsContactedRows) {
    if (r.assignedTo != null) byMember.get(r.assignedTo)!.leadsContacted = r.cnt;
  }
  for (const r of dealsOpenedRows) {
    if (r.assignedTo != null) byMember.get(r.assignedTo)!.dealsOpened = r.cnt;
  }
  for (const r of dealsClosedRows) {
    if (r.assignedTo != null) {
      const entry = byMember.get(r.assignedTo)!;
      entry.dealsClosed = r.cnt;
      entry.mrrContribCents = Math.round(parseFloat(r.revenue) * 100);
    }
  }

  return members.map((m) => ({
    teamMemberId: m.id,
    displayName: m.displayName,
    email: m.email,
    role: m.role,
    ...byMember.get(m.id)!,
  }));
}

function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return "***";
  }
}
