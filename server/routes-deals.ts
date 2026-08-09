import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { DEAL_STATUS_TRANSITIONS as SHARED_DEAL_TRANSITIONS } from "@shared/lifecycle/pipeline-status";
import { insertDealSchema } from "@shared/schema";
import type { DueDiligenceChecklistItem, InsertDeal } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { leadScoringService } from "./services/leadScoring";
import { propertyEnrichmentService } from "./services/propertyEnrichment";
import { checkUsageLimit } from "./services/usageLimits";
import { db, withTransaction } from "./db";
import { outcomeTelemetry, dueDiligenceItems, deals, contractAssignments, CONTRACT_ASSIGNMENT_STATUSES } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  STAGE_BENCHMARK_DAYS,
  DEFAULT_STAGE_BENCHMARK_DAYS,
  foldDealAggregates,
  type DealAggregateRow,
} from "./services/dealAggregates";
import { checkUsury } from "./services/usury";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { type AuthenticatedRequest, getOrganization, getOrganizationId } from "./types/request";
import {
  getAllHandoffs,
  getHandoffsForDeal,
  initiateHandoff,
  updateHandoffChecklist,
  completeHandoff,
} from "./services/dealHandoffService";
// Wave B "Wire the engine": deal automations never ran because nothing emitted
// deal.created / deal.stage_changed. Both emitters are fire-and-forget and
// no-op unless the status genuinely changed — see services/dealEvents.ts.
import { emitDealCreated, emitDealStageChanged } from "./services/dealEvents";
// Audit Wave 1 (residential_wholesaler beta→core): the wholesaler contract and
// assignment templates never ran because nothing emitted deal.contract_signed /
// deal.assignment_pending. Both emitters are fire-and-forget and no-op unless the
// status genuinely transitions — see services/wholesaleEvents.ts.
import { emitContractSigned, emitAssignmentPending } from "./services/wholesaleEvents";

// F-D39: small helper used by the due-diligence-item routes below to resolve
// `(itemId, orgId) → item` only when the item's parent property belongs to
// the caller's org. Without this gate, callers were mutating/deleting items
// across tenants by guessing the numeric id.
async function getDueDiligenceItemOrgScoped(itemId: number, orgId: number) {
  const [item] = await db.select().from(dueDiligenceItems).where(eq(dueDiligenceItems.id, itemId));
  if (!item || item.propertyId == null) return null;
  const property = await storage.getProperty(orgId, item.propertyId);
  return property ? item : null;
}

// Partial update schema for PUT endpoints
const updateDealSchema = insertDealSchema.partial();

// Task 211: Offer amount validation constants
const MIN_OFFER_AMOUNT = 0;         // exclusive lower bound
const MAX_OFFER_AMOUNT = 1_000_000_000; // $1 billion — typo guard

/**
 * Validate offer-amount fields on a raw deal payload.
 * Returns an error message string if invalid, or null if OK.
 */
function validateOfferAmounts(data: Record<string, any>): string | null {
  const fields = [
    { key: "offerAmount", label: "Offer amount" },
    { key: "acceptedAmount", label: "Accepted amount" },
    { key: "purchasePrice", label: "Purchase price" },
  ];
  for (const { key, label } of fields) {
    if (data[key] === undefined || data[key] === null || data[key] === "") continue;
    const val = Number(data[key]);
    if (isNaN(val)) return `${label} must be a valid number`;
    if (val <= MIN_OFFER_AMOUNT) return `${label} must be greater than $0`;
    if (val > MAX_OFFER_AMOUNT) return `${label} exceeds the maximum allowed value of $1,000,000,000`;
  }
  return null;
}

// Helper function to trigger deal enrichment asynchronously (non-blocking)
async function triggerDealEnrichmentAsync(
  organizationId: number,
  dealId: number,
  propertyId: number
): Promise<void> {
  Promise.resolve().then(async () => {
    try {
      await storage.updateDeal(dealId, { enrichmentStatus: "pending" }, undefined, organizationId);
      const enrichmentResult = await propertyEnrichmentService.enrichProperty(organizationId, propertyId);
      const enrichmentPayload = {
        enrichedAt: enrichmentResult.enrichedAt.toISOString(),
        lookupTimeMs: enrichmentResult.lookupTimeMs,
        parcel: enrichmentResult.parcel,
        hazards: enrichmentResult.hazards,
        environment: enrichmentResult.environment,
        infrastructure: enrichmentResult.infrastructure,
        demographics: enrichmentResult.demographics,
        publicLands: enrichmentResult.publicLands,
        transportation: enrichmentResult.transportation,
        water: enrichmentResult.water,
        scores: enrichmentResult.scores,
        errors: enrichmentResult.errors,
      };
      await storage.updateDeal(dealId, {
        enrichmentStatus: "completed",
        enrichedAt: new Date(),
        enrichmentData: enrichmentPayload as any,
      }, undefined, organizationId);
      logger.info("Deal and property enrichment completed", { dealId, propertyId, organizationId, lookupTimeMs: enrichmentResult.lookupTimeMs });
    } catch (err) {
      logger.error("Deal enrichment failed", { dealId, propertyId, organizationId, error: String(err) });
      try {
        await storage.updateDeal(dealId, { enrichmentStatus: "failed", enrichmentData: { errors: { enrichment: String(err) } } as any }, undefined, organizationId);
      } catch (updateErr) {
        logger.error("Failed to update deal enrichment status", { dealId, error: String(updateErr) });
      }
    }
  });
}

// T0-10 — query params for GET /api/deals/aggregates. `type` mirrors the
// client's pipeline type filter so the header KPIs stay in sync with it.
const dealAggregatesQuerySchema = z.object({
  type: z.enum(["all", "acquisition", "disposition"]).default("all"),
});

// Zod schema for pagination query params
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  // agent_investor pipeline filter (migration 0226). 'client' matches client-book
  // AND legacy-null deals (a null book was always a client deal); 'own_investment'
  // matches only the explicitly tagged own-book deals. Omitted = no book filter.
  book: z.enum(["client", "own_investment"]).optional(),
});

export function registerDealRoutes(app: Express): void {
  const api = app;

  // DEALS (Acquisitions/Dispositions)
  // ============================================

  api.get("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;

    const pagination = paginationQuerySchema.safeParse(req.query);
    if (!pagination.success) {
      return Errors.badRequest(res, "Invalid pagination parameters", pagination.error.issues);
    }
    const { page, pageSize, sortBy, sortOrder, book } = pagination.data;

    const result = await storage.getDealsPaginated(org.id, { page, pageSize, sortBy, sortOrder }, { book });

    res.json({
      data: result.data,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  });
  
  // ── T0-10: Deals header aggregates ────────────────────────────────────
  // GET /api/deals/aggregates — org-scoped SQL aggregation feeding the
  // Deals door header KPIs + stage-distribution bar. The header previously
  // reduced ONE page of the paginated list (25 rows), so orgs with >25
  // deals saw wrong pipeline/closed/stalled numbers. Registered BEFORE
  // /api/deals/:id so the literal path wins over the :id matcher.
  // GET /api/deals/coach — D4: surface the autopilot deal-coach (next-best
  // actions over the pipeline) to the customer, inside the Deals door.
  // Registered BEFORE /api/deals/:id — it previously sat at the tail of this
  // file, so the :id matcher captured "coach" (parseInt → NaN) and every
  // Deals-door load 500'd this widget (found by the wedge E2E, 2026-07-08).
  app.get("/api/deals/coach", isAuthenticated, getOrCreateOrg, async (req, res) => {
    // The deal-coach is a secondary advisory widget inside the Deals door. It
    // must NEVER 500 the request — a failure here would break the whole door.
    // Degrade to an empty coach and log loudly so the underlying error stays
    // observable (Errors.internal previously masked the door behind a 500).
    try {
      const { getDealCoachForOrg } = await import("./services/autopilot/dealActions");
      const items = await getDealCoachForOrg(req.organization.id);
      res.json({ items });
    } catch (err: any) {
      logger.error(
        "[deals/coach] failed — degrading to empty coach so the Deals door still renders",
        err instanceof Error ? err : new Error(String(err?.message ?? err)),
        { metadata: { organizationId: req.organization?.id } },
      );
      res.json({ items: [], degraded: true });
    }
  });

  api.get("/api/deals/aggregates", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = dealAggregatesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid aggregates parameters", parsed.error.issues);
      }
      const { type } = parsed.data;

      // Per-stage benchmark (days) as a SQL CASE, generated from the shared
      // constant so server thresholds can't drift from the client's copy.
      // Keys/values are compile-time constants — safe for sql.raw.
      const benchmarkCase = sql`(case ${deals.status} ${sql.raw(
        Object.entries(STAGE_BENCHMARK_DAYS)
          .map(([stage, days]) => `when '${stage}' then ${days}`)
          .join(" ")
      )} else ${sql.raw(String(DEFAULT_STAGE_BENCHMARK_DAYS))} end)`;
      // Whole days since last update — mirrors differenceInDays() on the
      // client. Deals with no updatedAt count as 0 days (healthy).
      const daysInStage = sql`floor(extract(epoch from (now() - coalesce(${deals.updatedAt}, now()))) / 86400)`;

      const where =
        type === "all"
          ? eq(deals.organizationId, orgId)
          : and(eq(deals.organizationId, orgId), eq(deals.type, type));

      const rows: DealAggregateRow[] = await db
        .select({
          status: deals.status,
          type: deals.type,
          count: sql<number>`count(*)::int`,
          // Same fallback chain the client used: offer amount, else accepted.
          // W3.3: sum in integer CENTS (::bigint), never ::float8 — the old
          // cast accumulated float error in the door-header KPIs. Dollars
          // reappear only in foldDealAggregates' response edge.
          pipelineValueCents: sql<number>`coalesce(sum(round(coalesce(${deals.offerAmount}, ${deals.acceptedAmount}, 0) * 100)), 0)::bigint`,
          acceptedValueCents: sql<number>`coalesce(sum(round(coalesce(${deals.acceptedAmount}, 0) * 100)), 0)::bigint`,
          stalledCount: sql<number>`(count(*) filter (where ${daysInStage} >= ${benchmarkCase} * 2))::int`,
          // ceil() because client day-counts are integers compared against a
          // fractional 1.25x threshold. Includes stalled; folded out later.
          warnAtLeastCount: sql<number>`(count(*) filter (where ${daysInStage} >= ceil(${benchmarkCase} * 1.25)))::int`,
        })
        .from(deals)
        .where(where)
        .groupBy(deals.status, deals.type);

      res.json(foldDealAggregates(rows));
    } catch (error) {
      logger.error("Failed to compute deal aggregates", { organizationId: req.organizationId });
      return Errors.internal(res, error);
    }
  });

  // W6.2 — the single-track view. Every slice page (leads, campaigns,
  // deals, inbox) shows one fragment; this endpoint unions the activity
  // events of the deal, its property, AND the seller lead (bridged via
  // property.sellerId — deals carry no leadId) into one chronological
  // lead → mail → response → offer → contract → close track.
  api.get("/api/deals/:id/track", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      if (!Number.isFinite(dealId)) return Errors.badRequest(res, "Invalid deal id");
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
      const events: any[] = await storage.getActivityEvents(org.id, "deal", dealId, eventTypes);

      let sellerLeadId: number | null = null;
      if (deal.propertyId) {
        try {
          const propertyEvents = await storage.getActivityEvents(org.id, "property", deal.propertyId, eventTypes);
          events.push(...propertyEvents);
          const property = await storage.getProperty(org.id, deal.propertyId);
          if (property?.sellerId) {
            sellerLeadId = property.sellerId;
            const leadEvents = await storage.getActivityEvents(org.id, "lead", property.sellerId, eventTypes);
            events.push(...leadEvents);
          }
        } catch {
          // Partial track beats no track — the deal's own events still return.
        }
      }

      // W6.2b — the real sources. offers / seller_communications /
      // campaign_responses / mail_shipment_pieces never wrote
      // activity_events, so without this the "single track" was mostly
      // stage changes and notes. Mapped at query time (string ids — can't
      // collide with the serial ids above); best-effort like the rest.
      try {
        const { getStitchedSourceEvents } = await import("./services/dealTrack");
        const sourceEvents = await getStitchedSourceEvents(org.id, {
          leadId: sellerLeadId,
          propertyId: deal.propertyId,
        });
        events.push(
          ...(eventTypes ? sourceEvents.filter((e) => eventTypes.includes(e.eventType)) : sourceEvents),
        );
      } catch {
        // Same stance: the activity_events track still returns.
      }

      const seen = new Set<number | string>();
      const merged = events
        .filter((e: any) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
        .sort((a: any, b: any) => {
          const dateA = new Date(a.eventDate || a.createdAt).getTime();
          const dateB = new Date(b.eventDate || b.createdAt).getTime();
          return dateB - dateA;
        });

      res.json(merged);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── CMA (Comparative Market Analysis) — agent_investor only ───────────────
  // GET /api/deals/:id/cma — the licensed-agent CMA over the deal's SUBJECT
  // property: sold house comps + an AVM, pulled through the EXISTING ATTOM
  // residential seam (server/services/residentialComps.ts). This is capability
  // wiring, not a data plane — no new vendor, no bulk ingest, no new table.
  //
  // Gating: agent_investor's subject is residential (2026-08 founder decision
  // reclassifying agent_investor as residential-routed; see
  // RESIDENTIAL_BUSINESS_TYPES in shared/models/persona-mapping.ts). Any other
  // persona 404s here — a CMA is an agent deliverable and land verticals keep
  // the parcel plane.
  //
  // HONESTY (refuse-not-fabricate): when the org has no ATTOM connection
  // (platform key or BYOK), the seam returns { status: "unavailable",
  // reason: "attom_not_connected" }; this route surfaces that verbatim with
  // empty comps and a null valuation — a land comp is NEVER substituted and no
  // AVM/CMA number is invented. A deal with no resolvable subject address
  // refuses honestly rather than guessing a location. Mirrors the honest
  // ATTOM-routed pattern in server/routes-flip-analyzer.ts (/api/flip-analyzer/comps).
  api.get("/api/deals/:id/cma", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res) => {
    try {
      const orgId = getOrganizationId(req);
      const org = getOrganization(req);

      // Persona gate: CMA is the agent_investor surface. Refuse (404) rather
      // than confirm the resource exists for personas that shouldn't reach it.
      const businessType = org.onboardingData?.businessType ?? null;
      if (businessType !== "agent_investor") {
        return Errors.notFound(res, "CMA");
      }

      const dealId = Number(req.params.id);
      if (!Number.isFinite(dealId)) return Errors.badRequest(res, "Invalid deal id");

      const deal = await storage.getDeal(orgId, dealId);
      if (!deal) return Errors.notFound(res, "Deal");
      if (!deal.propertyId) {
        // Refuse honestly: a CMA needs a subject property. Never fabricate one.
        return res.json({
          status: "unavailable",
          reason: "no_subject_property",
          message:
            "This deal has no linked property, so there's no subject to run a CMA on. Link a property to this deal first.",
          comps: [],
          valuation: null,
          subject: null,
        });
      }

      const property = await storage.getProperty(orgId, deal.propertyId);
      if (!property) return Errors.notFound(res, "Property");

      const lat = property.latitude !== null && property.latitude !== undefined ? Number(property.latitude) : NaN;
      const lng = property.longitude !== null && property.longitude !== undefined ? Number(property.longitude) : NaN;
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
      const hasAddress = !!(property.address && property.city && property.state && property.zip);

      const subject = {
        propertyId: property.id,
        address: property.address ?? null,
        city: property.city ?? null,
        state: property.state ?? null,
        zip: property.zip ?? null,
        latitude: hasCoords ? lat : null,
        longitude: hasCoords ? lng : null,
      };

      if (!hasCoords && !hasAddress) {
        // Refuse rather than guess a location: a CMA pulled for the wrong
        // subject is worse than no CMA.
        return res.json({
          status: "unavailable",
          reason: "subject_not_locatable",
          message:
            "This property has no coordinates and no complete street address, so a CMA can't be pulled for it. Add the address (or geocode the parcel) first.",
          comps: [],
          valuation: null,
          subject,
        });
      }

      const {
        getResidentialComps,
        getResidentialValuation,
        extractResidentialComps,
        extractResidentialAvm,
      } = await import("./services/residentialComps");

      const residentialSubject = hasCoords
        ? ({ kind: "coordinates", latitude: lat, longitude: lng } as const)
        : ({
            kind: "address",
            street: property.address as string,
            city: property.city as string,
            state: property.state as string,
            zip: property.zip as string,
          } as const);

      const compsOutcome = await getResidentialComps(orgId, residentialSubject);

      // ATTOM not connected (or the platform pool can't cover the lookup):
      // surface the seam's honest unavailable state verbatim. Substitute
      // nothing — no land comps, no invented AVM.
      if (compsOutcome.status !== "ok") {
        return res.json({
          status: compsOutcome.status,
          reason: compsOutcome.status === "unavailable" ? compsOutcome.reason : "no_data",
          message: compsOutcome.message,
          comps: [],
          valuation: null,
          subject,
        });
      }

      const comps = extractResidentialComps(compsOutcome.result.data);

      // The AVM is the CMA's headline number. It rides the same ATTOM seam, so
      // it only runs when comps succeeded (ATTOM is connected). Anything other
      // than an "ok" outcome yields a null valuation — never a fabricated one.
      const valuationOutcome = await getResidentialValuation(orgId, residentialSubject);
      const valuation =
        valuationOutcome.status === "ok"
          ? extractResidentialAvm(valuationOutcome.result.data)
          : null;

      logger.info("[deals/cma] residential CMA pulled for agent_investor", {
        source: "routes-deals",
        metadata: {
          organizationId: orgId,
          dealId,
          propertyId: property.id,
          comps: comps.length,
          hasValuation: valuation !== null,
          byok: compsOutcome.byok,
        },
      });

      return res.json({
        status: "ok",
        comps,
        valuation,
        subject,
        credentialSource: compsOutcome.byok ? "organization" : "platform",
        provenance:
          "Sold comparables and AVM from ATTOM Data via the residential seam. ATTOM does not report post-rehab condition — adjust per comp yourself.",
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── W6.1 — contract assignments (the wholesaler's defining mechanic) ──────
  // Record: original contract (this deal) → end buyer → fee → assignment doc.
  // The e-sign pipeline already exists (Assignment Contract system template,
  // /api/documents/generate, request-signature with the state-disclosure
  // gate); these endpoints add the missing assignment RECORD so the fee is
  // real data instead of the netProfit proxy.
  const assignmentCreateSchema = z.object({
    endBuyerProfileId: z.number().int().positive().optional(),
    endBuyerName: z.string().max(200).optional(),
    assignmentFeeCents: z.number().int().nonnegative(),
    originalContractDate: z.string().optional(), // yyyy-mm-dd
    notes: z.string().max(4000).optional(),
  });

  api.get("/api/deals/:id/assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");
      const rows = await db
        .select()
        .from(contractAssignments)
        .where(and(eq(contractAssignments.organizationId, org.id), eq(contractAssignments.dealId, dealId)));
      res.json(rows);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/deals/:id/assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      const parsed = assignmentCreateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      if (!parsed.data.endBuyerProfileId && !parsed.data.endBuyerName) {
        return Errors.badRequest(res, "Provide an end buyer (profile id or name)");
      }

      // Assignment-legality guard: surface the state rule with the record so
      // the client can warn/block per wholesalerStateRules (license_required,
      // advertising_restricted, double_close_only recommendations).
      let stateRule: unknown = null;
      try {
        const property = deal.propertyId ? await storage.getProperty(org.id, deal.propertyId) : null;
        if (property?.state) {
          const { wholesalerStateRules } = await import("@shared/schema");
          const [rule] = await db
            .select()
            .from(wholesalerStateRules)
            .where(eq(wholesalerStateRules.state, property.state));
          stateRule = rule ?? null;
        }
      } catch { /* rule lookup is advisory */ }

      const [created] = await db
        .insert(contractAssignments)
        .values({
          organizationId: org.id,
          dealId,
          endBuyerProfileId: parsed.data.endBuyerProfileId ?? null,
          endBuyerName: parsed.data.endBuyerName ?? null,
          assignmentFeeCents: parsed.data.assignmentFeeCents,
          originalContractDate: parsed.data.originalContractDate ?? null,
          notes: parsed.data.notes ?? null,
          status: "draft",
        })
        .returning();

      res.status(201).json({ assignment: created, stateRule });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  api.patch("/api/deals/:dealId/assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);
      const updateSchema = z.object({
        status: z.enum(CONTRACT_ASSIGNMENT_STATUSES).optional(),
        assignmentFeeCents: z.number().int().nonnegative().optional(),
        generatedDocumentId: z.number().int().positive().optional(),
        endBuyerProfileId: z.number().int().positive().nullable().optional(),
        endBuyerName: z.string().max(200).nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
      });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // Capture the pre-image status BEFORE the update — it is the pre-image for
      // the deal.assignment_pending transition below (audit Wave 1, wholesaler
      // beta→core). Org-scoped so a cross-tenant guess reads nothing.
      const [beforeAssignment] = await db
        .select({ status: contractAssignments.status })
        .from(contractAssignments)
        .where(and(eq(contractAssignments.id, id), eq(contractAssignments.organizationId, org.id)));

      const [updated] = await db
        .update(contractAssignments)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(contractAssignments.id, id), eq(contractAssignments.organizationId, org.id)))
        .returning();
      if (!updated) return Errors.notFound(res, "Assignment");

      // Audit Wave 1 (wholesaler beta→core) — deal.assignment_pending. An
      // assignment genuinely reaching "sent_for_signature" is the pending-signature
      // moment the template handles. Resolve the deal→property join for the honest
      // address/state, then fire. Wrapped so a lookup failure never fails the
      // assignment write; the emitter also no-ops unless the transition is genuine.
      if (beforeAssignment && beforeAssignment.status !== "sent_for_signature" && updated.status === "sent_for_signature") {
        try {
          const deal = await storage.getDeal(org.id, updated.dealId);
          const property = deal?.propertyId
            ? await storage.getProperty(org.id, deal.propertyId)
            : null;
          emitAssignmentPending(beforeAssignment.status, updated, {
            propertyAddress: property?.address ?? null,
            state: property?.state ?? null,
          });
        } catch (err) {
          logger.warn("deal.assignment_pending emit failed (non-fatal)", {
            metadata: { assignmentId: id, error: err instanceof Error ? err.message : String(err) },
          });
        }
      }

      res.json(updated);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // handoffs — registered BEFORE /api/deals/:id so the literal path wins (2026-07-11 route-order sweep).
  // GET /api/deals/handoffs — list all handoffs for the org
  app.get("/api/deals/handoffs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const handoffs = await getAllHandoffs(req.organization.id);
      res.json(handoffs);
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  api.get("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const deal = await storage.getDeal(org.id, Number(req.params.id));
    if (!deal) return Errors.notFound(res, "Deal");
    res.json(deal);
  });

  api.post("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;

      // Task 211: validate offer amounts before parsing
      const offerValidationError = validateOfferAmounts(req.body);
      if (offerValidationError) {
        return Errors.badRequest(res, offerValidationError);
      }

      const input = insertDealSchema.parse({ ...req.body, organizationId: org.id });

      // Usury hard block: check analysisResults.interestRate against state law before saving
      const dealInterestRate = input.analysisResults?.interestRate;
      if (dealInterestRate && input.propertyId) {
        const property = await storage.getProperty(org.id, input.propertyId);
        if (property?.state) {
          const usury = checkUsury(property.state, Number(dealInterestRate));
          if (usury.warningLevel === 'violation') {
            return Errors.badRequest(res, `Interest rate ${dealInterestRate}% exceeds ${property.state} usury limit of ${usury.maxAllowedRate}%. This transaction cannot be saved.`, {
              code: 'USURY_VIOLATION',
              limit: usury.maxAllowedRate,
              rate: dealInterestRate,
              state: property.state,
            });
          }
        }
      }

      // Wrap deal creation + audit log in a transaction so both succeed or
      // both roll back — prevents orphaned deals with no audit trail.
      const user = req.user as any;
      const userId = user?.id || user?.id;

      const deal = await withTransaction(async () => {
        // insertDealSchema strips organizationId; the repo write requires it.
        const newDeal = await storage.createDeal({ ...input, organizationId: org.id });
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId,
          action: "create",
          entityType: "deal",
          entityId: newDeal.id,
          changes: { after: input, fields: Object.keys(input) },
          ipAddress: req.ip || req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
        });
        return newDeal;
      });

      // Wave B — deal.created workflow trigger. Fire-and-forget: an automation
      // failure must never fail the deal write that just committed.
      emitDealCreated(org.id, deal);

      // Trigger async enrichment if deal has a propertyId (non-blocking)
      if (deal.propertyId) {
        triggerDealEnrichmentAsync(org.id, deal.id, deal.propertyId);
      }

      // Phase 3 Week 14 — Activation telemetry. A new deal row is the
      // first-offer-made signal (offers and deals share a creation path
      // in the v1 funnel; we re-fire on the offers table once it lands).
      try {
        const { recordActivationEventAsync } = await import("./services/activation");
        recordActivationEventAsync({
          orgId: org.id,
          userId,
          eventName: "first_offer_made",
          eventValue: { dealId: deal.id, offerAmount: deal.offerAmount },
        });
      } catch { /* non-fatal */ }

      res.status(201).json(deal);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(
          res,
          "Validation failed",
          err.issues.map((e) => ({ field: e.path?.join?.(".") || "", message: e.message })),
        );
      }
      return Errors.internal(res, err as Error);
    }
  });

  // Valid deal status transitions — no skipping states (Task #210).
  // W3.4: the table now lives in shared/lifecycle/pipeline-status.ts so the
  // bulk route and services validate against the SAME machine. String-keyed
  // view because existing rows may carry legacy statuses.
  const DEAL_STATUS_TRANSITIONS: Record<string, readonly string[]> = SHARED_DEAL_TRANSITIONS;

  api.put("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const existingDeal = await storage.getDeal(org.id, dealId);
      if (!existingDeal) return Errors.notFound(res, "Deal");

      // Task 211: validate offer amounts before parsing
      const offerValidationError = validateOfferAmounts(req.body);
      if (offerValidationError) {
        return Errors.badRequest(res, offerValidationError);
      }

      const validated = updateDealSchema.parse(req.body);

      // Task #210: Enforce deal status state machine transitions
      if (validated.status && validated.status !== existingDeal.status) {
        const currentStatus = existingDeal.status || "negotiating";
        const allowedNext = DEAL_STATUS_TRANSITIONS[currentStatus];
        if (allowedNext && !allowedNext.includes(validated.status)) {
          return Errors.badRequest(res, `Cannot transition from ${currentStatus} to ${validated.status}`);
        }
      }

      // Usury hard block: check updated analysisResults.interestRate against state law before saving
      const updatedInterestRate = validated.analysisResults?.interestRate ?? existingDeal.analysisResults?.interestRate;
      const updatedPropertyId = validated.propertyId ?? existingDeal.propertyId;
      if (updatedInterestRate && updatedPropertyId) {
        const property = await storage.getProperty(org.id, updatedPropertyId);
        if (property?.state) {
          const usury = checkUsury(property.state, Number(updatedInterestRate));
          if (usury.warningLevel === 'violation') {
            return Errors.badRequest(res, `Interest rate ${updatedInterestRate}% exceeds ${property.state} usury limit of ${usury.maxAllowedRate}%. This transaction cannot be saved.`, {
              code: 'USURY_VIOLATION',
              limit: usury.maxAllowedRate,
              rate: updatedInterestRate,
              state: property.state,
            });
          }
        }
      }

      const deal = await storage.updateDeal(dealId, validated, undefined, org.id);

      // Wave B — deal.stage_changed. `existingDeal` is the real pre-image, so
      // previousData carries the honest prior stage. No-ops emit nothing: the
      // helper compares statuses and returns early when they match.
      emitDealStageChanged(org.id, existingDeal, deal);

      // Audit Wave 1 (wholesaler beta→core) — deal.contract_signed. A deal
      // genuinely entering escrow (accepted → in_escrow, the only path in per
      // DEAL_STATUS_TRANSITIONS) is a signed purchase agreement. Resolve the
      // property for the honest address, then fire. The whole block is wrapped so
      // a property-lookup failure never fails the deal write that just committed;
      // the emitter itself also no-ops unless the transition is genuine.
      if (existingDeal.status !== "in_escrow" && deal.status === "in_escrow") {
        try {
          const property = deal.propertyId
            ? await storage.getProperty(org.id, deal.propertyId)
            : null;
          emitContractSigned(existingDeal.status, deal, {
            propertyAddress: property?.address ?? null,
          });
        } catch (err) {
          logger.warn("deal.contract_signed emit failed (non-fatal)", {
            metadata: { dealId, error: err instanceof Error ? err.message : String(err) },
          });
        }
      }

      // Outcome loop (S2c): a deal reaching a terminal status feeds the LCS
      // calibration loop automatically. This was previously reachable only
      // through the manual /api/ml/record-outcome route, so in practice no
      // closed deal ever recorded an outcome. Fire-and-forget — calibration
      // must never block or fail the customer's update.
      const terminalOutcome =
        validated.status && validated.status !== existingDeal.status
          ? validated.status === "closed"
            ? ("won" as const)
            : validated.status === "dead" || validated.status === "cancelled"
              ? ("lost" as const)
              : null
          : null;
      if (terminalOutcome) {
        import("./services/outcomeCalibrationLoop")
          .then(({ onDealClosed }) => onDealClosed(org.id, dealId, terminalOutcome))
          .catch((err) =>
            logger.warn("Deal outcome calibration hook failed (non-fatal)", {
              metadata: { dealId, error: err instanceof Error ? err.message : String(err) },
            }),
          );
      }
      // Referral loop (S2d): a WON deal is the referred org's activation
      // moment — reward the referral (idempotent; no-op when the org wasn't
      // referred). Previously the reward endpoint had zero callers, so no
      // referral ever converted.
      if (terminalOutcome === "won") {
        import("./services/referralReward")
          .then(({ applyReferralRewardForOrg }) => applyReferralRewardForOrg(org.id))
          .catch((err) =>
            logger.warn("Referral reward hook failed (non-fatal)", {
              metadata: { dealId, error: err instanceof Error ? err.message : String(err) },
            }),
          );
      }

      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "deal",
        entityId: dealId,
        changes: { before: existingDeal, after: deal, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      // Trigger async enrichment if propertyId was added or changed (non-blocking)
      const propertyChanged = validated.propertyId && validated.propertyId !== existingDeal.propertyId;
      if (propertyChanged && deal.propertyId) {
        triggerDealEnrichmentAsync(org.id, deal.id, deal.propertyId);
      }
      
      // Magnus §1 — ML training snapshots on deal close / cancel.
      // `closed` is treated as closed_won; `cancelled` is treated as
      // closed_lost. Both fire the deal_outcome snapshot. closed_won also
      // pairs the AVM-vs-actual snapshot if the property had a recent AVM.
      const isFirstClose = validated.status === "closed" && existingDeal.status !== "closed";
      const isFirstCancel = validated.status === "cancelled" && existingDeal.status !== "cancelled";
      if (isFirstClose || isFirstCancel) {
        try {
          const { recordSnapshotAsync, pairOutcomeAsync } = await import("./services/mlSnapshots");
          const wonOrLost = isFirstClose ? "closed_won" : "closed_lost";
          const acceptedAmount = deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : null;
          const offerAmount = deal.offerAmount ? parseFloat(String(deal.offerAmount)) : null;

          recordSnapshotAsync({
            snapshotType: "deal_outcome",
            subjectType: "deal",
            subjectId: String(deal.id),
            orgId: org.id,
            // Decision was made when the offer was sent / deal entered the
            // pipeline; we don't have that timestamp readily available so
            // use createdAt as the closest proxy.
            decisionAt: deal.createdAt ? new Date(deal.createdAt as any) : new Date(),
            outcomeAt: new Date(),
            features: {
              dealType: deal.type,
              propertyId: deal.propertyId,
              offerAmount,
              analysisResults: deal.analysisResults ?? null,
              // TODO(tsc): deals has no sequenceId column; telemetry feature
              // left null until/if a sequence linkage is added.
              sequenceId: null,
            },
            labels: {
              outcome: wonOrLost,
              acceptedAmount,
              status: validated.status,
            },
          });

          // Pair the AVM snapshot with the actual sale price (closed_won only).
          if (isFirstClose && deal.propertyId && acceptedAmount) {
            pairOutcomeAsync({
              snapshotType: "avm_vs_actual",
              subjectType: "property",
              subjectId: String(deal.propertyId),
              outcomeLabels: {
                actualSalePrice: acceptedAmount,
                dealId: deal.id,
              },
              outcomeAt: new Date(),
            });

            // Feed the closed deal's REAL sale price into the valuation training
            // corpus (transaction_training) — the arm's-length ground truth the
            // weekly retrain + MAE-gated promotion flywheel trains on. Until now
            // the actual only landed in mlSnapshots, which nothing trains from,
            // so this proprietary signal (an on-platform closed price) was
            // stranded and the moat could never learn from real deals. The row
            // is anonymized by recordTransactionForTraining, deduped by
            // transaction_hash, non-blocking, and marked high-quality because an
            // on-platform close IS an arm's-length transaction.
            void (async () => {
              try {
                const prop = await storage.getProperty(org.id, deal.propertyId!);
                const acres = prop?.sizeAcres != null ? Number(prop.sizeAcres) : 0;
                if (prop?.state && prop?.county && Number.isFinite(acres) && acres > 0) {
                  const { acreOSValuation } = await import("./services/acreOSValuation");
                  await acreOSValuation.recordTransactionForTraining(
                    String(org.id),
                    {
                      propertyId: String(deal.propertyId),
                      salePrice: acceptedAmount,
                      saleDate: new Date(),
                      acres,
                      pricePerAcre: acceptedAmount / acres,
                      location: {
                        state: prop.state,
                        county: prop.county,
                        zipCode: prop.zip ?? "",
                        latitude: prop.latitude != null ? Number(prop.latitude) : 0,
                        longitude: prop.longitude != null ? Number(prop.longitude) : 0,
                      },
                      characteristics: {
                        zoning: prop.zoning ?? undefined,
                        roadAccess: prop.roadAccess ?? undefined,
                        topography: prop.terrain ?? undefined,
                      },
                      marketConditions: {
                        quarterlyInterestRate: 0,
                        localUnemploymentRate: 0,
                        populationGrowth: 0,
                        nearbyDevelopment: false,
                      },
                    },
                    "high",
                  );
                }
              } catch (err) {
                logger.warn("[deal-close] recordTransactionForTraining failed", {
                  dealId: deal.id,
                  err: err instanceof Error ? err.message : String(err),
                });
              }
            })();
          }

          // Pair the lead-conversion snapshot — closed = converted, cancelled = dismissed.
          // Look up the property's leadId so we can pair on the right subject.
          try {
            const property = deal.propertyId
              ? await storage.getProperty(org.id, deal.propertyId)
              : null;
            if (property && property.sellerId) {
              pairOutcomeAsync({
                snapshotType: "lead_conversion",
                subjectType: "lead",
                subjectId: String(property.sellerId),
                outcomeLabels: {
                  outcome: isFirstClose ? "converted" : "dismissed",
                  dealId: deal.id,
                  acceptedAmount,
                },
                outcomeAt: new Date(),
              });
            }
          } catch { /* non-fatal */ }
        } catch { /* non-fatal */ }
      }

      // Track conversion when deal is closed (for lead scoring feedback loop)
      if (validated.status === "closed" && existingDeal.status !== "closed") {
        // Phase 5 §5 Part D (team readiness) — fire deal_closed Slack/Teams
        // event. Non-blocking so a misconfigured webhook can never wedge
        // the deal-close path.
        try {
          const { dispatchTeamEvent } = await import("./services/teamWebhookDispatcher");
          await dispatchTeamEvent(org.id, "deal_closed", {
            title: "Deal closed",
            body: `Deal #${deal.id} closed${deal.acceptedAmount ? ` at $${Number(deal.acceptedAmount).toLocaleString()}` : ""}.`,
            context: {
              dealId: deal.id,
              acceptedAmount: deal.acceptedAmount,
              dealType: deal.type,
            },
          });
        } catch { /* non-fatal */ }

        // Wave 2 pass C — auto-record the closing agent's commission
        // (agent_investor commission wedge). Fire-and-forget, consistent with
        // the other close-seam side effects: it must NEVER fail the close.
        // HONESTY GATE: record ONLY when (a) the deal has an assigned agent and
        // (b) the org has EXPLICITLY saved a commission tier config. When no
        // config exists we skip silently — recording against DEFAULT_CONFIG
        // would fabricate a commission the operator never set up. Correct
        // signature: recordDealCommission(orgId, teamMemberId, dealId,
        // salePriceCents) — teamMemberId is the deal's assigned agent.
        if (deal.assignedTo != null) {
          const saleAmount = deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : 0;
          if (Number.isFinite(saleAmount) && saleAmount > 0) {
            void (async () => {
              try {
                const { hasCommissionConfig, recordDealCommission } = await import("./services/commissionService");
                // STAGE 1 (migration 0226) — client vs own book: an
                // 'own_investment' deal is the agent's OWN P&L, never a brokerage
                // commission. Skip it the same way we skip an unconfigured org —
                // recording a commission on the operator's own buy/sell would
                // fabricate a number with no client behind it. NULL book = client
                // (what a deal always was), so only the explicit own_investment
                // tag short-circuits here.
                if (deal.dealBook === "own_investment") return;
                if (!(await hasCommissionConfig(org.id))) return; // no config → skip, never fabricate
                await recordDealCommission(
                  org.id,
                  deal.assignedTo!,
                  deal.id,
                  Math.round(saleAmount * 100),
                );
              } catch (err) {
                logger.warn("[deal-close] commission auto-record failed", {
                  dealId: deal.id,
                  err: err instanceof Error ? err.message : String(err),
                });
              }
            })();
          }
        }

        try {
          // Get the property to find associated lead
          const property = await storage.getProperty(org.id, deal.propertyId);
          if (property && property.sellerId) {
            const dealValue = deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : undefined;
            await leadScoringService.recordConversion(property.sellerId, org.id, "deal_closed", {
              dealValue,
              profitMargin: deal.analysisResults?.netProfit,
            });
          }
        } catch (conversionErr) {
          logger.error("Failed to record conversion", conversionErr instanceof Error ? conversionErr : undefined);
        }

        // Phase 3 Week 14 — Activation telemetry. First closed deal is a
        // major activation milestone (lead → close conversion).
        try {
          const userIdForEvent = req.user?.id || req.user?.id;
          const { recordActivationEventAsync } = await import("./services/activation");
          recordActivationEventAsync({
            orgId: org.id,
            userId: userIdForEvent,
            eventName: "first_deal_closed",
            eventValue: { dealId: deal.id, acceptedAmount: deal.acceptedAmount },
          });
        } catch { /* non-fatal */ }

        // Write outcome telemetry for the feedback loop (non-blocking)
        db.insert(outcomeTelemetry).values({
          organizationId: org.id,
          outcomeType: "deal_won",
          outcome: {
            success: true,
            value: deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : undefined,
            details: { dealType: deal.type, stage: deal.status },
          },
          contributingFactors: {
            offerAmount: deal.offerAmount ? parseFloat(String(deal.offerAmount)) : undefined,
            sequenceUsed: undefined, // TODO(tsc): deals has no sequenceId column
            marketConditions: deal.analysisResults ?? undefined,
          },
          relatedDealId: deal.id,
          relatedPropertyId: deal.propertyId ?? undefined,
        }).catch(() => {});

        // Fire Pillar 3 market signal contribution (non-blocking)
        import("./services/marketNetworkContributor").then(({ contributeClosedDealToNetwork }) => {
          contributeClosedDealToNetwork(deal.id, org.id).catch((err: unknown) => {
            logger.error("Market signal contribution failed", { error: err instanceof Error ? err.message : String(err) });
          });
        }).catch((err: unknown) => {
          logger.error("Failed to load marketNetworkContributor", { error: err instanceof Error ? err.message : String(err) });
        });

        // Auto-fingerprint closed deal for pattern cloning (non-blocking)
        import("./services/dealPatternCloning").then(({ dealPatternCloningService }) => {
          dealPatternCloningService.recordPatternFromClosedDeal(org.id, deal.id).catch((err) => {
            logger.error("deal pattern fingerprint failed", { error: err instanceof Error ? err.message : String(err) });
          });
        }).catch(() => {});
      }

      // Magnus §1 — offer-acceptance training snapshots. Decision is "offer
      // sent"; outcome is "accepted | countered | cancelled". The offer is
      // identified by the deal id since AcreOS doesn't have a separate
      // offers table — `offer_sent` status on the deal is the canonical
      // offer-sent event.
      if (validated.status === "offer_sent" && existingDeal.status !== "offer_sent") {
        try {
          const { recordSnapshotAsync } = await import("./services/mlSnapshots");
          recordSnapshotAsync({
            snapshotType: "offer_acceptance",
            subjectType: "deal",
            subjectId: String(deal.id),
            orgId: org.id,
            decisionAt: new Date(),
            features: {
              dealType: deal.type,
              propertyId: deal.propertyId,
              offerAmount: deal.offerAmount ? parseFloat(String(deal.offerAmount)) : null,
              analysisResults: deal.analysisResults ?? null,
            },
            labels: {
              status: "offer_sent",
            },
          });
        } catch { /* non-fatal */ }
      }

      // Pair offer outcome on accepted / countered / cancelled.
      const offerOutcomeReached =
        (validated.status === "accepted" && existingDeal.status !== "accepted") ||
        (validated.status === "countered" && existingDeal.status !== "countered") ||
        (validated.status === "cancelled" && existingDeal.status !== "cancelled");
      if (offerOutcomeReached) {
        try {
          const { pairOutcomeAsync } = await import("./services/mlSnapshots");
          pairOutcomeAsync({
            snapshotType: "offer_acceptance",
            subjectType: "deal",
            subjectId: String(deal.id),
            outcomeLabels: {
              outcome:
                validated.status === "accepted"
                  ? "accepted"
                  : validated.status === "cancelled"
                    ? "declined"
                    : "countered",
              acceptedAmount: deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : null,
            },
            outcomeAt: new Date(),
          });
        } catch { /* non-fatal */ }
      }

      // Push notification when deal is accepted (T61)
      if (validated.status === "accepted" && existingDeal.status !== "accepted") {
        setImmediate(async () => {
          try {
            const { notifyDealAccepted } = await import("./services/pushNotificationService");
            const user = req.user as any;
            const userId = user?.id ?? user?.id;
            if (userId) {
              const property = await storage.getProperty(org.id, deal.propertyId);
              await notifyDealAccepted(
                org.id,
                userId,
                deal.id,
                (property as any)?.address || `Property #${deal.propertyId}`
              );
            }
          } catch (_) {}
        });
      }
      
      res.json(deal);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, "Validation failed", err.issues.map(e => ({ field: e.path.join('.'), message: e.message })));
      }
      // Task 219: surface optimistic-lock conflicts as 409 Conflict
      if (err instanceof Error && err.message.includes("modified by another request")) {
        return Errors.badRequest(res, err.message);
      }
      throw err;
    }
  });

  // Manual deal enrichment trigger endpoint
  const enrichDealSchema = z.object({
    forceRefresh: z.boolean().optional().default(false),
  });

  api.post("/api/deals/:id/enrich", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const parsed = enrichDealSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const forceRefresh = parsed.data.forceRefresh;
      
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) {
        return Errors.notFound(res, "Deal");
      }

      if (!deal.propertyId) {
        return Errors.badRequest(res, "Deal has no associated property");
      }

      // Get the property to find coordinates
      const property = await storage.getProperty(org.id, deal.propertyId);
      if (!property) {
        return Errors.badRequest(res, "Property not found");
      }

      const lat = property.latitude ? parseFloat(String(property.latitude)) : null;
      const lng = property.longitude ? parseFloat(String(property.longitude)) : null;

      if (!lat || !lng) {
        return Errors.badRequest(res, "Property missing coordinates");
      }
      
      // Mark as pending
      await storage.updateDeal(dealId, { enrichmentStatus: "pending" }, undefined, org.id);

      // Perform enrichment synchronously for manual trigger (so user can see result)
      const enrichmentResult = await propertyEnrichmentService.enrichByCoordinates(lat, lng, {
        propertyId: deal.propertyId,
        state: property.state || undefined,
        county: property.county || undefined,
        apn: property.apn || undefined,
        forceRefresh,
      });
      
      // Save enrichment data to deal (all categories)
      const updatedDeal = await storage.updateDeal(dealId, {
        enrichmentStatus: "completed",
        enrichedAt: new Date(),
        enrichmentData: {
          enrichedAt: enrichmentResult.enrichedAt.toISOString(),
          lookupTimeMs: enrichmentResult.lookupTimeMs,
          hazards: enrichmentResult.hazards,
          environment: enrichmentResult.environment,
          epaFacilities: enrichmentResult.epaFacilities,
          stormHistory: enrichmentResult.stormHistory,
          infrastructure: enrichmentResult.infrastructure,
          demographics: enrichmentResult.demographics,
          publicLands: enrichmentResult.publicLands,
          transportation: enrichmentResult.transportation,
          water: enrichmentResult.water,
          elevation: enrichmentResult.elevation,
          climate: enrichmentResult.climate,
          agriculturalValues: enrichmentResult.agriculturalValues,
          landCover: enrichmentResult.landCover,
          cropland: enrichmentResult.cropland,
          plss: enrichmentResult.plss,
          watershed: enrichmentResult.watershed,
          femaNri: enrichmentResult.femaNri,
          usdaClu: enrichmentResult.usdaClu,
          scores: enrichmentResult.scores,
          errors: enrichmentResult.errors,
        } as any,
      }, undefined, org.id);

      logger.info("Manual deal enrichment completed", { dealId, propertyId: deal.propertyId, lookupTimeMs: enrichmentResult.lookupTimeMs });
      
      res.json({
        message: "Enrichment completed",
        deal: updatedDeal,
        enrichmentResult,
      });
    } catch (err) {
      logger.error("Manual deal enrichment failed", { dealId: req.params.id, error: String(err) });
      Errors.internal(res, err instanceof Error ? err : new Error("Enrichment failed"));
    }
  });
  
  // ============================================
  // DUE DILIGENCE TEMPLATES & CHECKLISTS
  // ============================================
  
  api.get("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const templates = await storage.getDueDiligenceTemplates(org.id);
    if (templates.length === 0) {
      const initialized = await storage.initializeDefaultTemplates(org.id);
      return res.json(initialized);
    }
    res.json(templates);
  });
  
  api.get("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const template = await storage.getDueDiligenceTemplate(org.id, Number(req.params.id));
    // 2026-06-10 (T0-2): the F-D39 org check landed on PUT/DELETE but this GET
    // was missed — cross-tenant read IDOR. 404 (not 403) so we never confirm
    // another org's template exists.
    if (!template || template.organizationId !== org.id) return Errors.notFound(res, "Template");
    res.json(template);
  });

  const createDueDiligenceTemplateSchema = z.object({
    name: z.string().min(1, "Template name is required"),
    description: z.string().optional(),
    category: z.string().optional(),
    items: z.array(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      category: z.string().optional(),
      priority: z.string().optional(),
    })).optional(),
  });

  api.post("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = createDueDiligenceTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      // Map the request's loose item shape into the persisted
      // DueDiligenceChecklistItem shape ({ id, category, name, required }).
      const items = (parsed.data.items ?? []).map((item, idx) => ({
        id: `item_${idx}`,
        category: item.category ?? parsed.data.category ?? "general",
        name: item.title,
        description: item.description,
        required: item.priority === "required" || item.priority === "high",
      }));
      const template = await storage.createDueDiligenceTemplate({
        name: parsed.data.name,
        items,
        organizationId: org.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.issues[0].message);
      }
      throw err;
    }
  });

  const updateDueDiligenceTemplateSchema = createDueDiligenceTemplateSchema.partial();

  api.put("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const parsed = updateDueDiligenceTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    // F-D39: refuse to mutate another org's template.
    const existing = await storage.getDueDiligenceTemplate(org.id, Number(req.params.id));
    if (!existing || existing.organizationId !== org.id) return Errors.notFound(res, "Template");
    // Map loose request items into the persisted DueDiligenceChecklistItem shape.
    const updates: Partial<{ name: string; items: DueDiligenceChecklistItem[]; isDefault: boolean }> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.items !== undefined) {
      updates.items = parsed.data.items.map((item, idx) => ({
        id: `item_${idx}`,
        category: item.category ?? parsed.data.category ?? "general",
        name: item.title,
        description: item.description,
        required: item.priority === "required" || item.priority === "high",
      }));
    }
    const template = await storage.updateDueDiligenceTemplate(Number(req.params.id), updates);
    if (!template) return Errors.notFound(res, "Template");
    res.json(template);
  });

  api.delete("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    // F-D39: refuse to delete another org's template.
    const existing = await storage.getDueDiligenceTemplate(org.id, Number(req.params.id));
    if (!existing || existing.organizationId !== org.id) return Errors.notFound(res, "Template");
    await storage.deleteDueDiligenceTemplate(Number(req.params.id));
    res.status(204).send();
  });

  api.get("/api/properties/:id/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const propertyId = Number(req.params.id);
    // F-D39: refuse to list another org's checklist.
    const property = await storage.getProperty(org.id, propertyId);
    if (!property) return Errors.notFound(res, "Property");
    const items = await storage.getPropertyDueDiligence(propertyId);
    res.json(items);
  });
  
  const applyTemplateSchema = z.object({
    templateId: z.number().int().positive("templateId is required"),
  });

  api.post("/api/properties/:id/due-diligence/apply-template", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = applyTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { templateId } = parsed.data;
      const propertyId = Number(req.params.id);
      // F-D39: both the property AND the template must belong to this org. Either
      // mismatch hides as 404 to avoid leaking which side was the cross-tenant ref.
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) return Errors.notFound(res, "Property");
      const template = await storage.getDueDiligenceTemplate(org.id, templateId);
      if (!template || template.organizationId !== org.id) return Errors.notFound(res, "Template");
      const items = await storage.applyTemplateToProperty(org.id, propertyId, templateId);
      res.json(items);
    } catch (err: any) {
      Errors.badRequest(res, err.message || "Failed to apply template");
    }
  });
  
  const createDueDiligenceItemSchema = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    category: z.string().optional(),
    priority: z.string().optional(),
    completed: z.boolean().optional(),
    notes: z.string().optional(),
    dueDate: z.string().optional(),
  });

  api.post("/api/properties/:id/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      const parsed = createDueDiligenceItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      // F-D39: refuse to attach a checklist item to another org's property.
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) return Errors.notFound(res, "Property");
      // Map the request shape to the due_diligence_items columns
      // (itemName/category are notNull; priority/description/dueDate are not
      // columns on this table and are dropped).
      const item = await storage.createDueDiligenceItem({
        propertyId,
        itemName: parsed.data.title,
        category: parsed.data.category ?? "general",
        completed: parsed.data.completed ?? false,
        notes: parsed.data.notes,
      });
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.issues[0].message);
      }
      throw err;
    }
  });

  const updateDueDiligenceItemSchema = createDueDiligenceItemSchema.partial();

  api.put("/api/due-diligence/items/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const parsed = updateDueDiligenceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const user = req.user as any;
    const userId = user?.id || user?.id;
    const updates = { ...parsed.data } as any;
    if (updates.completed === true && userId) {
      updates.completedBy = userId;
    }
    // F-D39: org-scoped via parent property.
    const existing = await getDueDiligenceItemOrgScoped(Number(req.params.id), org.id);
    if (!existing) return Errors.notFound(res, "Item");
    const item = await storage.updateDueDiligenceItem(Number(req.params.id), updates);
    if (!item) return Errors.notFound(res, "Item");
    res.json(item);
  });

  api.delete("/api/due-diligence/items/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    // F-D39: org-scoped via parent property.
    const existing = await getDueDiligenceItemOrgScoped(Number(req.params.id), org.id);
    if (!existing) return Errors.notFound(res, "Item");
    await storage.deleteDueDiligenceItem(Number(req.params.id));
    res.status(204).send();
  });

  // ============================================
  // PROPERTY ANALYSIS CHAT
  // ============================================
  
  api.post("/api/properties/:id/analyze", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      const analyzeSchema = z.object({
        message: z.string().min(1, "Message is required").max(10000),
        conversationHistory: z.array(z.object({
          role: z.string(),
          content: z.string(),
        })).optional(),
      });
      const parsed = analyzeSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { message, conversationHistory } = parsed.data;
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return Errors.limitExceeded(res, "AI request limit reached. Upgrade to continue.", { docsSlug: "limit-ai-requests" });
      }

      // Credit check for deal AI chat
      const { CreditService } = await import('./services/credits');
      const dealCreditService = new CreditService();
      const hasCredits = await dealCreditService.hasEnoughCredits(org.id, 2);
      if (!hasCredits) {
        return res.status(402).json({ error: "Insufficient credits", message: "Purchase credits to use AI deal analysis." });
      }

      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const { ResearchIntelligenceAgent, DealsAcquisitionAgent, skillRegistry } = await import('./services/core-agents');
      // Panel-300 90-15 / gap E: migrated from direct OpenAI to routeAITask.
      const { routeAITask, TaskComplexity } = await import('./services/aiRouter');
      
      const researchAgent = new ResearchIntelligenceAgent();
      const dealsAgent = new DealsAcquisitionAgent();
      
      const propertyContext = `
Property Information:
- APN: ${property.apn}
- Location: ${property.address || 'N/A'}, ${property.city || 'N/A'}, ${property.county}, ${property.state}
- Size: ${property.sizeAcres || 'Unknown'} acres
- Status: ${property.status}
- Zoning: ${property.zoning || 'Unknown'}
- Market Value: ${property.marketValue ? `$${Number(property.marketValue).toLocaleString()}` : 'Unknown'}
- Purchase Price: ${property.purchasePrice ? `$${Number(property.purchasePrice).toLocaleString()}` : 'Unknown'}
- Assessed Value: ${property.assessedValue ? `$${Number(property.assessedValue).toLocaleString()}` : 'Unknown'}
- Road Access: ${property.roadAccess || 'Unknown'}
- Terrain: ${property.terrain || 'Unknown'}
- Coordinates: ${property.latitude && property.longitude ? `${property.latitude}, ${property.longitude}` : 'Not available'}
- Description: ${property.description || 'None'}
`;

      const researchSkills = researchAgent.getAvailableSkills();
      const dealsSkills = dealsAgent.getAvailableSkills();
      const allSkills = [...researchSkills, ...dealsSkills];
      
      const skillsContext = allSkills.map(s => `- ${s.name}: ${s.description}`).join('\n');
      
      const historyContext = conversationHistory && conversationHistory.length > 0
        ? conversationHistory.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')
        : '';

      const systemPrompt = `You are an AI property analyst for AcreOS, a platform for LAND investors (vacant rural/raw land — not houses, not commercial). Your job is to analyze raw-land parcels, assess risks, compute valuations, and help the user make a go/no-go investment decision using the math and vocabulary that land investors actually use.

${propertyContext}

Available capabilities you can discuss:
${skillsContext}

LAND-SPECIFIC RULES (never violate these):

- Blind-offer / cash-acquisition pricing: offer at 20–40% of Fair Market Value (FMV), NOT near 100%. A typical cash flip offers 25–35% of FMV. If the user's FMV is uncertain, hedge accordingly. Do NOT suggest offers at 70–100% of FMV for a cash acquisition — that is residential-offer math, not land-investing math.
- Seller-finance / terms pricing: sell at 100–150% of FMV (above retail) with 10–30% down and 8–12% interest on a 60–120 month amortizing note. Buyer cash is the scarcity; terms command a premium.
- For cash offers: low = 20% of FMV, target = 25–30% of FMV, high = 40% of FMV. Show the math so the user can see why each anchor was chosen.
- Arizona assessment ratio: AZ assesses vacant land at 16% of Full Cash Value (FCV), so implied FMV = assessed value / 0.16. Never treat the county assessed value as market value.
- New Mexico, Colorado, Nevada, Oregon: prior-appropriation water regime; water rights are separate property interests, commonly severed.
- Texas: mineral rights commonly severed; always flag if it's a Permian Basin county. 25-month redemption on tax-deed rural land.
- Florida: flood zone + wetlands + HOA are the three dominant risk flags on rural lots; surface every one.
- Landlocked / legal access is the #1 dealbreaker in raw land. ALWAYS check whether the parcel has recorded legal access before any offer is generated. A landlocked parcel is worth 10–20% of an otherwise identical accessible parcel.

STATE-BY-STATE TAX-DELINQUENT & PROCEDURAL PRIMER (surface when the parcel is in one of these states and the user is discussing distress, tax delinquency, or lien/deed mechanics):

- **Arizona (AZ)**: tax-LIEN state. County treasurer holds annual lien auction in February. Lien certificate buyer earns 16% max interest. 3-year redemption window; after that the lien holder can petition for a treasurer's deed. Vacant-land FCV assessment ratio 16%. Water rights in prior-appropriation regime; wells inside Active Management Areas (Maricopa, Pima) require permits.
- **Texas (TX)**: tax-DEED state. Counties hold tax-deed auctions (strike-off sales). 25-month post-sale redemption on non-homestead rural land; 6 months on homestead. Mineral rights commonly severed — ALWAYS flag Permian Basin counties (Reeves, Loving, Martin, Midland, Upton, Crane) where severed minerals materially change surface value.
- **Florida (FL)**: tax-LIEN state, then tax-deed sale. Lien certificate buyers earn up to 18%. After 2 years the certificate holder can apply for a tax-deed auction. HOA liens survive tax-deed sales in many FL counties — verify HOA status before bidding.
- **Colorado (CO)**: hybrid. Annual lien sale by treasurer; 3-year redemption before treasurer's deed. Strictest prior-appropriation water regime in the country — water rights are ADJUDICATED separately and commonly severed.
- **New Mexico (NM)**: tax-deed state (NMSA §7-38). 3-year redemption post-sale. Very low per-acre prices in Luna, Torrance, Valencia, Sierra counties. BLM-adjacent marketing is common.
- **Nevada (NV)**: tax-DEED state. 2-year redemption. ~85% of NV land is federally owned — private inventory concentrates near population centers.
- **Oregon (OR)**: foreclosure-style 2-year redemption before treasurer deed. Land-use planning (LCDC, UGB) heavily restricts development.
- **Missouri (MO)**: tax-lien state with a 1-year redemption; then sold to investor as "collector's deed."
- **Arkansas (AR)**: tax-DEED state; 30-day redemption post-sale. AR assesses property at 20% of appraised market value for all classes.

When the user asks about a distressed parcel in any of these states, cite the lien/deed regime + redemption window + any state-specific quirk (water, minerals, HOA, federal land) that affects the buyer's rights and upside.

INTERNATIONAL BUYERS: if the user's locale suggests they're based outside the US (currency mentions, time-zone hints, residency, or account country), add: US tax-delinquent acquisition requires either (a) a US-based title company for closing, (b) awareness of FIRPTA withholding rules if the property is later sold, and (c) understanding that foreign buyers face identical lien/deed mechanics but may need a US address for service of notices. Do NOT convert US dollars to the user's local currency unless they ask — respect that they are investing in USD.

When responding:
1. Use the property data provided to give specific, actionable insights. If a field is missing (e.g., zoning, access, flood zone), say so explicitly rather than inventing a value.
2. Quote specific dollars and percentages. Show the formula: "$X market value × 0.28 = $Y offer."
3. Reference the land-specific rules above when they apply to the asked question.
4. For financing questions, use seller-finance terms (8–12% interest, 5–10 year terms) — not 10–15% generic real estate numbers.
5. Be concise but thorough. One or two sections per question is ideal.
6. Suggest follow-up questions that help the user close the gap between "I know about this parcel" and "I know whether to offer on it."

${historyContext ? `\nConversation history:\n${historyContext}\n` : ''}`;

      const response = await routeAITask({
        taskType: "property_analysis_chat",
        complexity: TaskComplexity.MODERATE,
        taskTier: "critical", // customer-facing analyst surface
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        maxTokens: 1500,
      }, { orgId: org.id });

      const aiResponse = response.content || "I couldn't generate a response. Please try again.";

      // Deduct credits after successful AI call
      dealCreditService.deductCredits(org.id, 2, 'Deal AI analysis').catch(() => {});

      const suggestions = generateSuggestions(message, property);

      res.json({
        response: aiResponse,
        suggestions,
        actions: [],
      });
    } catch (err: any) {
      logger.error("Property analysis error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to analyze property"));
    }
  });

  function generateSuggestions(message: string, property: any): string[] {
    const suggestions: string[] = [];
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('flood') || lowerMessage.includes('risk') || lowerMessage.includes('environmental')) {
      suggestions.push("What about wetlands on this property?");
      suggestions.push("Are there EPA sites nearby?");
    } else if (lowerMessage.includes('offer') || lowerMessage.includes('price')) {
      suggestions.push("What financing terms would work?");
      suggestions.push("What's a fair market value?");
    } else if (lowerMessage.includes('financing') || lowerMessage.includes('payment')) {
      suggestions.push("What if I do a 5-year term instead?");
      suggestions.push("Generate an offer letter");
    } else if (lowerMessage.includes('similar') || lowerMessage.includes('comp')) {
      suggestions.push("What's the price per acre for this area?");
      suggestions.push("How long do similar properties take to sell?");
    } else {
      if (!property.marketValue) {
        suggestions.push("What's the estimated market value?");
      }
      if (property.latitude && property.longitude) {
        suggestions.push("Run environmental risk assessment");
      }
      suggestions.push("Calculate seller financing options");
    }
    
    return suggestions.slice(0, 3);
  }

  // ============================================
  // DUE DILIGENCE CHECKLISTS (Enhanced)
  // ============================================
  
  api.get("/api/due-diligence/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      const checklist = await storage.getOrCreateDueDiligenceChecklist(org.id, propertyId);
      res.json(checklist);
    } catch (error: any) {
      logger.error("Get due diligence checklist error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to fetch checklist"));
    }
  });

  api.put("/api/due-diligence/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      // F-D39: verify property ownership before touching its checklist. Previously
      // getDueDiligenceChecklist(propertyId) returned any org's checklist as long
      // as the propertyId existed, and the subsequent updateChecklist(existing.id)
      // wrote into that foreign org's row.
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) return Errors.notFound(res, "Property");
      const existing = await storage.getDueDiligenceChecklist(propertyId);
      if (!existing) {
        return Errors.notFound(res, "Checklist");
      }
      const updated = await storage.updateDueDiligenceChecklist(existing.id, req.body);
      res.json(updated);
    } catch (error: any) {
      logger.error("Update due diligence checklist error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to update checklist"));
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/flood-zone", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const { dataSourceLookupService } = await import('./services/data-source-lookup');

      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupFloodZone({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          zone: "Unknown (No coordinates)",
          riskLevel: "unknown",
          lastUpdated: new Date().toISOString(),
          source: "N/A",
          details: { message: "Property has no coordinates for flood zone lookup" },
        });
      }
    } catch (error: any) {
      logger.error("Flood zone lookup error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup flood zone"));
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/wetlands", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const { dataSourceLookupService } = await import('./services/data-source-lookup');

      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupWetlands({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          hasWetlands: false,
          classification: null,
          percentage: 0,
          source: "N/A",
          lastUpdated: new Date().toISOString(),
          details: { message: "Property has no coordinates for wetlands lookup" },
        });
      }
    } catch (error: any) {
      logger.error("Wetlands lookup error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup wetlands"));
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/soil", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const { dataSourceLookupService } = await import('./services/data-source-lookup');

      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupSoilData({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          soilType: "Unknown",
          drainage: "unknown",
          suitability: "unknown",
          source: "N/A",
          lastUpdated: new Date().toISOString(),
          details: { message: "Property has no coordinates for soil data lookup" },
        });
      }
    } catch (error: any) {
      logger.error("Soil data lookup error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup soil data"));
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/environmental", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const { dataSourceLookupService } = await import('./services/data-source-lookup');

      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupEpaData({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          superfundSites: [],
          nearestSiteDistance: null,
          riskLevel: "unknown",
          source: "N/A",
          lastUpdated: new Date().toISOString(),
          details: { message: "Property has no coordinates for EPA data lookup" },
        });
      }
    } catch (error: any) {
      logger.error("EPA environmental lookup error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup EPA data"));
    }
  });

  // Maren #6 (Tahoe): confidence-aware diligence checklist annotations.
  // Runs the free open-data environmental lookups (flood / wetlands / soil /
  // EPA) and maps each to an honest, advisory annotation ("FEMA says Zone X —
  // likely clears; verify") with a verdict + confidence + source + vintage.
  // ANNOTATION ONLY: this NEVER checks off a checklist item — the human still
  // verifies. Categories with no coordinates return an honest "unknown".
  api.get(
    "/api/due-diligence/:propertyId/annotations",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res) => {
      try {
        const orgId = getOrganizationId(req);
        const propertyId = Number(req.params.propertyId);
        if (!Number.isInteger(propertyId) || propertyId <= 0) {
          return Errors.badRequest(res, "Invalid property id");
        }

        const property = await storage.getProperty(orgId, propertyId);
        if (!property) return Errors.notFound(res, "Property");

        const { dataSourceLookupService } = await import("./services/data-source-lookup");
        const { annotateEnvironmentalChecklist } = await import("./services/checklistAnnotation");

        // Without coordinates we can't run coordinate-based open data; return
        // honest "unknown" annotations rather than fabricating anything.
        if (!property.latitude || !property.longitude) {
          return res.json({
            annotations: annotateEnvironmentalChecklist({}),
            hasCoordinates: false,
          });
        }

        const opts = {
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        };

        // Run the four lookups in parallel; a single failed source must not
        // sink the whole request — annotate the ones that resolved, mark the
        // rest unknown (Maren #1: a real "Unknown" beats a fake value).
        const [flood, wetlands, soil, environmental] = await Promise.allSettled([
          dataSourceLookupService.lookupFloodZone(opts),
          dataSourceLookupService.lookupWetlands(opts),
          dataSourceLookupService.lookupSoilData(opts),
          dataSourceLookupService.lookupEpaData(opts),
        ]);

        const annotations = annotateEnvironmentalChecklist({
          ...(flood.status === "fulfilled" ? { flood: flood.value.data } : {}),
          ...(wetlands.status === "fulfilled" ? { wetlands: wetlands.value.data } : {}),
          ...(soil.status === "fulfilled" ? { soil: soil.value.data } : {}),
          ...(environmental.status === "fulfilled"
            ? { environmental: environmental.value.data }
            : {}),
        });

        res.json({ annotations, hasCoordinates: true });
      } catch (error: any) {
        logger.error(
          "Diligence annotation error",
          error instanceof Error ? error : undefined,
        );
        Errors.internal(
          res,
          error instanceof Error ? error : new Error("Failed to build checklist annotations"),
        );
      }
    },
  );

  api.post("/api/due-diligence/:propertyId/lookup/tax", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);

      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      // Source order: (a) tax value already stored on the property row
      // (populated by an earlier parcel fetch), (b) tax value embedded in
      // parcelData JSONB, (c) live re-fetch via the parcel pipeline
      // (County GIS → RapidAPI → Regrid) which returns taxAmount.
      let annualTax: number | null = null;
      let assessedValue: number | null = null;
      let source: string | null = null;
      let lastUpdated: string | null = null;
      let providerNote: string | null = null;

      const rawTax = (property as any).taxAmount;
      if (rawTax !== null && rawTax !== undefined && rawTax !== "") {
        const parsed = parseFloat(String(rawTax));
        if (!Number.isNaN(parsed) && parsed > 0) {
          annualTax = parsed;
          source = "Property record";
          lastUpdated = (property as any).updatedAt?.toISOString?.() || null;
        }
      }

      const parcelData: any = (property as any).parcelData ?? null;
      if (annualTax === null && parcelData?.taxAmount) {
        const parsed = parseFloat(String(parcelData.taxAmount));
        if (!Number.isNaN(parsed) && parsed > 0) {
          annualTax = parsed;
          source = parcelData.source ? `Parcel cache (${parcelData.source})` : "Parcel cache";
          lastUpdated = parcelData.lastUpdated || null;
        }
      }

      // Pull assessed value from any provider that already populated it.
      const assessedRaw =
        (property as any).assessedValue ??
        parcelData?.assessedValue ??
        null;
      if (assessedRaw !== null && assessedRaw !== undefined && assessedRaw !== "") {
        const parsed = parseFloat(String(assessedRaw));
        if (!Number.isNaN(parsed) && parsed > 0) assessedValue = parsed;
      }

      // If we still have no tax value but have coordinates or an APN, try
      // one live parcel lookup — caches the result for future calls.
      if (annualTax === null) {
        try {
          const { lookupParcelByAPN, lookupParcelByCoordinates } =
            await import("./services/parcel");
          let lookup: any = null;
          if (property.apn && property.state && property.county) {
            lookup = await lookupParcelByAPN(
              property.apn,
              `${property.state}/${property.county}`,
              org.id,
            );
          } else if (property.latitude && property.longitude) {
            lookup = await lookupParcelByCoordinates(
              Number(property.latitude),
              Number(property.longitude),
            );
          }
          if (lookup?.found && lookup.parcel?.data?.taxAmount) {
            const parsed = parseFloat(String(lookup.parcel.data.taxAmount));
            if (!Number.isNaN(parsed) && parsed > 0) {
              annualTax = parsed;
              source = `Live (${lookup.source})`;
              lastUpdated = new Date().toISOString();
            }
          } else if (lookup && !lookup.found) {
            providerNote = lookup.error || "Parcel not found in any provider";
          }
        } catch (lookupErr: any) {
          logger.warn(`[tax-lookup] live parcel fetch failed: ${lookupErr?.message ?? lookupErr}`);
          providerNote = "Live parcel lookup failed — try Fetch Map first";
        }
      }

      // Derive a tax rate only when both inputs are real.
      const taxRate =
        annualTax !== null && assessedValue !== null && assessedValue > 0
          ? Number((annualTax / assessedValue).toFixed(6))
          : null;

      if (annualTax === null) {
        // No fabricated numbers — be explicit that we don't have data yet.
        return res.json({
          annualTax: null,
          assessedValue,
          backTaxes: null,
          taxSaleStatus: "unknown",
          lastPaidDate: null,
          source: null,
          lastUpdated: null,
          details: {
            message:
              providerNote ||
              "Tax data not yet available for this parcel. Run Fetch Map to pull parcel data, or add an ATTOM API key in Settings → Integrations for assessor-grade detail.",
            taxYear: null,
            assessedValue,
            taxRate: null,
            exemptions: [],
          },
        });
      }

      // We have real tax data. backTaxes / taxSaleStatus / lastPaidDate /
      // exemptions are county-treasurer-specific and not available from
      // Regrid / county GIS — return null rather than fabricate.
      res.json({
        annualTax,
        assessedValue,
        backTaxes: null,
        taxSaleStatus: "unknown",
        lastPaidDate: null,
        source,
        lastUpdated,
        details: {
          taxYear: new Date().getFullYear(),
          assessedValue,
          taxRate,
          exemptions: [],
          note:
            "Tax-sale status and back-tax history require a county-treasurer integration — not surfaced here yet.",
        },
      });
    } catch (error: any) {
      logger.error("Tax lookup error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup tax info"));
    }
  });

  // ============================================
  // DUE DILIGENCE REPORT GENERATION
  // ============================================

  api.get("/api/properties/:id/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Verify property belongs to organization
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const report = await generateDueDiligenceReport(org.id, propertyId, {
        includeComps,
        includeAI,
      });

      res.json(report);
    } catch (error: any) {
      logger.error("Due diligence report error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to generate report"));
    }
  });

  api.get("/api/properties/:id/report/pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Verify property belongs to organization
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const jsPDF = (await import("jspdf")).jsPDF;
      
      const report = await generateDueDiligenceReport(org.id, propertyId, {
        includeComps,
        includeAI,
      });
      
      // Generate PDF
      const doc = new jsPDF();
      let y = 20;
      const lineHeight = 7;
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      
      // Header
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Due Diligence Report", margin, y);
      y += lineHeight * 2;
      
      // Property Summary
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Property Summary", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Property: ${report.summary.propertyName}`, margin, y);
      y += lineHeight;
      doc.text(`APN: ${report.summary.apn}`, margin, y);
      y += lineHeight;
      doc.text(`Address: ${report.summary.address}`, margin, y);
      y += lineHeight;
      doc.text(`County: ${report.summary.county}, ${report.summary.state}`, margin, y);
      y += lineHeight;
      doc.text(`Generated: ${new Date(report.summary.generatedAt).toLocaleString()}`, margin, y);
      y += lineHeight * 2;
      
      // Parcel Information
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Parcel Information", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Size: ${report.parcelInfo.acres ? `${report.parcelInfo.acres} acres` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Zoning: ${report.parcelInfo.zoning || "Unknown"}`, margin, y);
      y += lineHeight;
      if (report.parcelInfo.legalDescription) {
        const lines = doc.splitTextToSize(`Legal Description: ${report.parcelInfo.legalDescription}`, contentWidth);
        doc.text(lines, margin, y);
        y += lineHeight * lines.length;
      }
      y += lineHeight;
      
      // Ownership
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Ownership Information", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Owner: ${report.ownership.currentOwner || "Unknown"}`, margin, y);
      y += lineHeight;
      if (report.ownership.ownerAddress) {
        doc.text(`Owner Address: ${report.ownership.ownerAddress}`, margin, y);
        y += lineHeight;
      }
      y += lineHeight;
      
      // Tax Information
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Tax Information", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Assessed Value: ${report.taxes.assessedValue ? `$${report.taxes.assessedValue.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Annual Tax: ${report.taxes.taxAmount ? `$${report.taxes.taxAmount.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight * 2;
      
      // Check if we need a new page
      if (y > 240) {
        doc.addPage();
        y = 20;
      }
      
      // Market Analysis
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Market Analysis", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Price Per Acre: ${report.marketAnalysis.pricePerAcre ? `$${report.marketAnalysis.pricePerAcre.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Estimated Value: ${report.marketAnalysis.estimatedValue ? `$${report.marketAnalysis.estimatedValue.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Market Trend: ${report.marketAnalysis.marketTrend}`, margin, y);
      y += lineHeight;
      
      if (report.marketAnalysis.offerPrices) {
        y += lineHeight;
        const offers = report.marketAnalysis.offerPrices;
        doc.text(`Conservative: $${offers.conservative.min.toLocaleString()} - $${offers.conservative.max.toLocaleString()}`, margin, y);
        y += lineHeight;
        doc.text(`Standard: $${offers.standard.min.toLocaleString()} - $${offers.standard.max.toLocaleString()}`, margin, y);
        y += lineHeight;
        doc.text(`Aggressive: $${offers.aggressive.min.toLocaleString()} - $${offers.aggressive.max.toLocaleString()}`, margin, y);
      }
      y += lineHeight * 2;
      
      // Check if we need a new page
      if (y > 240) {
        doc.addPage();
        y = 20;
      }
      
      // Risk Assessment
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Risk Assessment", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      
      if (report.risks.accessIssues.length > 0) {
        doc.text("Access Issues:", margin, y);
        y += lineHeight;
        report.risks.accessIssues.forEach(issue => {
          doc.text(`  - ${issue}`, margin, y);
          y += lineHeight;
        });
      }
      
      if (report.risks.zoningRestrictions.length > 0) {
        doc.text("Zoning Restrictions:", margin, y);
        y += lineHeight;
        report.risks.zoningRestrictions.forEach(restriction => {
          doc.text(`  - ${restriction}`, margin, y);
          y += lineHeight;
        });
      }
      y += lineHeight;
      
      // AI Summary
      if (report.aiSummary) {
        if (y > 180) {
          doc.addPage();
          y = 20;
        }
        
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("AI Analysis", margin, y);
        y += lineHeight;
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const aiLines = doc.splitTextToSize(report.aiSummary, contentWidth);
        doc.text(aiLines, margin, y);
      }
      
      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text(
          `AcreOS Due Diligence Report - Page ${i} of ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: "center" }
        );
      }
      
      // Send PDF
      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="due-diligence-${report.summary.apn}.pdf"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      logger.error("PDF generation error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to generate PDF"));
    }
  });

  api.get("/api/properties/:id/report/summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      
      const { getQuickPropertySummary } = await import("./services/dueDiligence");
      const summary = await getQuickPropertySummary(org.id, propertyId);
      
      if (!summary) {
        return Errors.notFound(res, "Property");
      }

      res.json(summary);
    } catch (error: any) {
      logger.error("Quick summary error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to get summary"));
    }
  });
  
  // ============================================
  // DEAL CHECKLIST TEMPLATES
  // ============================================
  
  api.get("/api/checklist-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const templates = await storage.getChecklistTemplates(org.id);
    if (templates.length === 0) {
      const initialized = await storage.initializeDefaultChecklistTemplates(org.id);
      return res.json(initialized);
    }
    res.json(templates);
  });
  
  api.get("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const template = await storage.getChecklistTemplate(org.id, Number(req.params.id));
    // 2026-06-10 (T0-2): same GET/PUT asymmetry as DD templates — the F-D39
    // org check covered PUT/DELETE but missed GET. 404 hides existence.
    if (!template || template.organizationId !== org.id) return Errors.notFound(res, "Template");
    res.json(template);
  });

  api.post("/api/checklist-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const template = await storage.createChecklistTemplate({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.issues[0].message);
      }
      throw err;
    }
  });

  api.put("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    // F-D39: refuse to mutate another org's checklist template.
    const existing = await storage.getChecklistTemplate(org.id, Number(req.params.id));
    if (!existing || existing.organizationId !== org.id) return Errors.notFound(res, "Template");
    const template = await storage.updateChecklistTemplate(Number(req.params.id), req.body);
    if (!template) return Errors.notFound(res, "Template");
    res.json(template);
  });

  api.delete("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    // F-D39: refuse to delete another org's checklist template.
    const existing = await storage.getChecklistTemplate(org.id, Number(req.params.id));
    if (!existing || existing.organizationId !== org.id) return Errors.notFound(res, "Template");
    await storage.deleteChecklistTemplate(Number(req.params.id));
    res.status(204).send();
  });
  
  // ============================================
  // DEAL CHECKLISTS
  // ============================================
  
  api.get("/api/deals/:id/checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const dealId = Number(req.params.id);
    // Task #2: Verify deal belongs to org before returning checklist (IDOR prevention)
    const deal = await storage.getDeal(org.id, dealId);
    if (!deal) return Errors.notFound(res, "Deal");
    const checklist = await storage.getDealChecklist(dealId);
    if (!checklist) {
      return res.json(null);
    }
    const completed = checklist.items.filter(item => item.checkedAt).length;
    res.json({
      ...checklist,
      completionStatus: {
        completed,
        total: checklist.items.length,
        percentage: Math.round((completed / checklist.items.length) * 100),
      },
    });
  });
  
  api.post("/api/deals/:id/checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      // Task #2: Verify deal belongs to org (IDOR prevention)
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");
      const { templateId } = req.body;
      if (!templateId) {
        return Errors.badRequest(res, "templateId is required");
      }
      const checklist = await storage.applyChecklistTemplateToDeal(org.id, dealId, templateId);
      res.status(201).json(checklist);
    } catch (err: any) {
      Errors.badRequest(res, err.message || "Failed to apply template");
    }
  });

  api.patch("/api/deals/:id/checklist/items/:itemId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      // Task #2: Verify deal belongs to org (IDOR prevention)
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");
      const user = req.user as any;
      const userId = user?.id || user?.id;
      const { checked, documentUrl } = req.body;

      const checklist = await storage.updateDealChecklistItem(
        dealId,
        req.params.itemId,
        { checked, documentUrl, checkedBy: userId }
      );
      res.json(checklist);
    } catch (err: any) {
      Errors.badRequest(res, err.message || "Failed to update checklist item");
    }
  });
  
  api.get("/api/deals/:id/stage-gate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const dealId = Number(req.params.id);
    // Task #2: Verify deal belongs to org (IDOR prevention)
    const deal = await storage.getDeal(org.id, dealId);
    if (!deal) return Errors.notFound(res, "Deal");
    const result = await storage.checkStageGate(dealId);
    res.json(result);
  });

  api.get("/api/deals/:id/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Task #2: Pass org.id to getDeal to scope query (IDOR prevention)
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) {
        return Errors.notFound(res, "Deal");
      }

      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const report = await generateDueDiligenceReport(org.id, deal.propertyId, {
        includeComps,
        includeAI,
      });
      
      res.json({
        ...report,
        deal: {
          id: deal.id,
          type: deal.type,
          status: deal.status,
          offerAmount: deal.offerAmount,
          acceptedAmount: deal.acceptedAmount,
        },
      });
    } catch (error: any) {
      logger.error("Deal due diligence report error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to generate report"));
    }
  });
  
  // Enhanced deal stage update with stage gate check
  api.patch("/api/deals/:id/stage", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stage, force } = req.body;
      const dealId = Number(req.params.id);
      const org = req.organization;

      const existingDeal = await storage.getDeal(org.id, dealId);
      if (!existingDeal) return Errors.notFound(res, "Deal");

      // Task #210: Enforce deal status state machine transitions
      const currentStatus = existingDeal.status || "negotiating";
      const allowedNext = DEAL_STATUS_TRANSITIONS[currentStatus];
      if (allowedNext && !allowedNext.includes(stage)) {
        return Errors.badRequest(res, `Cannot transition from ${currentStatus} to ${stage}`);
      }

      if (!force) {
        const stageGate = await storage.checkStageGate(dealId);
        if (!stageGate.canAdvance) {
          return Errors.badRequest(res, "Cannot advance stage: incomplete required checklist items", { incompleteItems: stageGate.incompleteItems });
        }
      }

      const deal = await storage.updateDeal(dealId, { status: stage }, undefined, org.id);
      if (!deal) return Errors.notFound(res, "Deal");

      // Wave B — this is the Kanban drag / keyboard-move path (client
      // `updateDealStage` → PATCH /api/deals/:id/stage), not just the deal
      // form. It is the most common way a stage actually changes, so the
      // trigger has to fire from here too.
      emitDealStageChanged(org.id, existingDeal, deal);

      res.json(deal);
    } catch (err: any) {
      Errors.badRequest(res, err.message || "Failed to update stage");
    }
  });

  // Bulk operations
  api.post("/api/deals/bulk-delete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return Errors.badRequest(res, "ids must be a non-empty array");
      }
      const deletedCount = await storage.bulkDeleteDeals(org.id, ids);
      res.json({ deletedCount });
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to bulk delete deals"));
    }
  });

  api.post("/api/deals/bulk-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { ids, updates } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return Errors.badRequest(res, "ids must be a non-empty array");
      }
      if (!updates || typeof updates !== "object") {
        return Errors.badRequest(res, "updates must be an object");
      }

      // Wave B — a bulk stage move is N real transitions, one per deal. Only
      // pay for the pre-image read when `status` is actually part of the
      // update; rows whose status is unchanged emit nothing. A pre-image read
      // failure degrades to "no events" and never fails the bulk write.
      const bulkStatus = typeof updates.status === "string" ? updates.status : null;
      let beforeDeals: Array<Awaited<ReturnType<typeof storage.getDeal>>> = [];
      if (bulkStatus) {
        try {
          const numericIds = ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id));
          beforeDeals = await Promise.all(numericIds.map((id: number) => storage.getDeal(org.id, id)));
        } catch (err) {
          logger.warn("Bulk deal stage pre-image read skipped (non-fatal)", {
            metadata: { orgId: org.id, error: err instanceof Error ? err.message : String(err) },
          });
        }
      }

      const updatedCount = await storage.bulkUpdateDeals(org.id, ids, updates);

      for (const before of beforeDeals) {
        if (!before) continue;
        emitDealStageChanged(org.id, before, { ...before, status: bulkStatus });
      }

      res.json({ updatedCount });
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to bulk update deals"));
    }
  });

  // ─── T23 + T49: Generate Offer Letter PDF + (optionally) send for e-signature ─
  api.post("/api/deals/:id/offer-letter-pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const deal = await storage.getDeal(org.id, Number(req.params.id));
      if (!deal) return Errors.notFound(res, "Deal");

      // The deals table has no apn/propertyAddress — those live on the
      // linked property. Hydrate here so the PDF has the real parcel
      // data instead of "Unknown APN / (no address)". The existing
      // code referenced deal.apn, deal.propertyAddress, and
      // deal.purchasePrice — all undefined at runtime.
      const property = deal.propertyId
        ? await storage.getProperty(org.id, deal.propertyId).catch(() => null)
        : null;

      const { generateOfferLetterPdf } = await import("./services/offerLetterPdf");
      const { sendForEsign, sellerEmail, sellerName, ...offerData } = req.body;

      const propertyAddress = property
        ? [property.address, property.city, property.state, property.zip]
            .filter(Boolean)
            .join(", ")
        : undefined;

      const buffer = await generateOfferLetterPdf({
        orgName: org.name || "Buyer",
        orgEmail: org.settings?.companyEmail,
        orgPhone: org.settings?.companyPhone,
        sellerName: sellerName || "Property Owner",
        apn: property?.apn || "Unknown",
        propertyAddress: propertyAddress || offerData.propertyAddress,
        legalDescription: property?.legalDescription || offerData.legalDescription,
        acres: property?.sizeAcres != null ? Number(property.sizeAcres) : offerData.acres,
        state: property?.state || offerData.state,
        county: property?.county || offerData.county,
        purchasePrice: Number(deal.acceptedAmount || deal.offerAmount || offerData.purchasePrice || 0),
        earnestMoneyDeposit: offerData.earnestMoneyDeposit,
        closingDays: offerData.closingDays ?? 30,
        offerExpirationDays: offerData.offerExpirationDays ?? 10,
        ...offerData,
      });

      if (sendForEsign && sellerEmail) {
        // Native e-sign path. The previous branch routed to
        // eSigningService.sendOfferLetterForSignature() — a function that
        // was never exported and would 500 at runtime. Now: save the PDF
        // as a generated document, stamp a seller signer, mint an HMAC
        // signing link per server/services/signingTokens.ts, return the
        // link for the operator to paste into their own outreach.
        const { makeSigningToken } = await import("./services/signingTokens");
        const title = `Purchase Offer — ${propertyAddress || property?.apn || `Deal #${deal.id}`}`;
        const signerId = `signer-${Date.now()}-seller`;
        const signers = [
          {
            id: signerId,
            name: sellerName || "Seller",
            email: sellerEmail,
            role: "seller",
            order: 1,
          },
        ];
        const genDoc = await storage.createGeneratedDocument({
          organizationId: org.id,
          name: title,
          type: "offer_letter",
          dealId: deal.id,
          propertyId: deal.propertyId ?? null,
          // Content is the base64-encoded PDF since we don't have file storage
          // wired in this path — the public signing page will surface a link
          // for the seller to read the letter (PDF served via /pdf route).
          content: null,
          status: "pending_signature",
          esignProvider: "native",
          esignStatus: "pending",
          signers,
          sentAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
        const base = (process.env.APP_URL || req.headers.origin || "").toString().replace(/\/$/, "");
        const url = `${base}/sign/${genDoc.id}?s=${encodeURIComponent(signerId)}&t=${makeSigningToken(genDoc.id, signerId)}`;
        return res.json({
          pdfGenerated: true,
          documentId: genDoc.id,
          signingLinks: [
            { signerId, name: signers[0].name, email: sellerEmail, role: "seller", url },
          ],
        });
      }

      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="offer-${deal.id}.pdf"`);
      res.send(buffer);
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // -----------------------------------------------------------------------
  // Deal Handoff Workflow (T55)
  // -----------------------------------------------------------------------


  // GET /api/deals/:dealId/handoffs — handoffs for a specific deal
  app.get("/api/deals/:dealId/handoffs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const handoffs = await getHandoffsForDeal(req.organization.id, parseInt(req.params.dealId));
      res.json(handoffs);
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // POST /api/deals/:dealId/handoffs — initiate a handoff
  app.post("/api/deals/:dealId/handoffs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { fromTeamMemberId, toTeamMemberId, fromRole, toRole, notes, customChecklist } = req.body;
      if (!fromTeamMemberId || !toTeamMemberId || !fromRole || !toRole) {
        return Errors.badRequest(res, "fromTeamMemberId, toTeamMemberId, fromRole, and toRole are required");
      }
      const handoff = await initiateHandoff(req.organization.id, {
        dealId: parseInt(req.params.dealId),
        fromTeamMemberId,
        toTeamMemberId,
        fromRole,
        toRole,
        notes: notes || "",
        customChecklist,
      });
      res.status(201).json(handoff);
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // PATCH /api/deals/handoffs/:handoffId/checklist/:itemId — toggle checklist item
  app.patch("/api/deals/handoffs/:handoffId/checklist/:itemId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { completed } = req.body;
      const handoff = await updateHandoffChecklist(
        req.organization.id,
        req.params.handoffId,
        req.params.itemId,
        !!completed
      );
      res.json(handoff);
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // POST /api/deals/handoffs/:handoffId/complete — complete the handoff
  app.post("/api/deals/handoffs/:handoffId/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const handoff = await completeHandoff(req.organization.id, req.params.handoffId);
      res.json(handoff);
    } catch (err: any) {
      Errors.badRequest(res, err.message);
    }
  });

  // POST /api/deals/:id/advance-stage — move a deal to the next pipeline stage.
  // Used by the SwipeableCard right-swipe gesture on mobile deal cards.
  // Respects the same state-machine transition table as the PUT endpoint.
  app.post("/api/deals/:id/advance-stage", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res) => {
    try {
      const orgId = getOrganizationId(req);
      const dealId = Number(req.params.id);
      if (isNaN(dealId)) return Errors.badRequest(res, "Invalid deal ID");

      const existingDeal = await storage.getDeal(orgId, dealId);
      if (!existingDeal) return Errors.notFound(res, "Deal");

      const currentStatus = existingDeal.status || "negotiating";
      const allowedNext = DEAL_STATUS_TRANSITIONS[currentStatus];
      if (!allowedNext || allowedNext.length === 0) {
        return Errors.badRequest(res, `Deal is already at its final stage (${currentStatus})`);
      }

      // Advance to the first non-cancelled next stage — skip "cancelled" so a
      // right-swipe can never accidentally cancel a deal.
      const nextStatus = allowedNext.find((s) => s !== "cancelled");
      if (!nextStatus) {
        return Errors.badRequest(res, `No forward stage available from ${currentStatus}`);
      }

      const deal = await storage.updateDeal(dealId, { status: nextStatus }, undefined, orgId);

      // Wave B — the swipe/advance path is a stage transition like any other.
      emitDealStageChanged(orgId, existingDeal, deal);

      const user = req.user as any;
      const userId = user?.id;
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "update",
        entityType: "deal",
        entityId: dealId,
        changes: { before: { status: currentStatus }, after: { status: nextStatus }, fields: ["status"] },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      logger.info("Deal advanced via swipe gesture", { dealId, orgId, from: currentStatus, to: nextStatus });
      res.json({ deal, previousStatus: currentStatus, nextStatus });
    } catch (err) {
      return Errors.internal(res, err as Error);
    }
  });

  // =========================================================================
  // Dual-agency disclosure TRACKER (STAGE 3 — record-only, migration 0226)
  // -------------------------------------------------------------------------
  // Behind the existing Deals door. This RECORDS what the operator asserts and
  // uploads — it NEVER generates, sends, or e-signs a disclosure. Legal-signing
  // is a founder-only hard-stop, so there is deliberately no document generation,
  // no counterparty send, and no e-signature path here. `disclosureDocRef` is a
  // reference to a document the OPERATOR uploaded ELSEWHERE; it is stored, not
  // produced. Every response echoes recordOnly:true to make this explicit.
  // =========================================================================
  const RECORD_ONLY_NOTICE =
    "Record only. AcreOS does not generate, send, or e-sign dual-agency disclosures — " +
    "legal signing is founder-restricted. This tracks a disclosure you produced and handled elsewhere.";

  // GET /api/deals/:id/dual-agency — read the recorded tracker for a deal.
  api.get("/api/deals/:id/dual-agency", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res) => {
    try {
      const orgId = getOrganizationId(req);
      const dealId = parseInt(req.params.id, 10);
      if (!Number.isInteger(dealId)) return Errors.badRequest(res, "Invalid deal id");
      const deal = await storage.getDeal(orgId, dealId);
      if (!deal) return Errors.notFound(res, "Deal");
      res.json({
        dealId: deal.id,
        dualAgencySide: deal.dualAgencySide ?? null,
        disclosureAcknowledgedAt: deal.disclosureAcknowledgedAt ?? null,
        disclosureDocRef: deal.disclosureDocRef ?? null,
        recordOnly: true,
        notice: RECORD_ONLY_NOTICE,
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // PUT /api/deals/:id/dual-agency — record (human-initiated) the tracker.
  // Only writes operator-provided values; performs no generation or signing.
  const dualAgencySchema = z.object({
    dualAgencySide: z.enum(["seller", "buyer", "dual"]).nullable().optional(),
    // Convenience: true stamps the acknowledgement at "now", false clears it.
    disclosureAcknowledged: z.boolean().optional(),
    // Or set an explicit acknowledgement date the operator is recording.
    disclosureAcknowledgedAt: z.string().datetime().nullable().optional(),
    // A reference (URL/id) to a document the OPERATOR uploaded elsewhere.
    disclosureDocRef: z.string().max(2048).nullable().optional(),
  });

  api.put("/api/deals/:id/dual-agency", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res) => {
    try {
      const orgId = getOrganizationId(req);
      const dealId = parseInt(req.params.id, 10);
      if (!Number.isInteger(dealId)) return Errors.badRequest(res, "Invalid deal id");
      const parsed = dualAgencySchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const deal = await storage.getDeal(orgId, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      const body = parsed.data;
      const updates: Partial<InsertDeal> = {};
      if (body.dualAgencySide !== undefined) updates.dualAgencySide = body.dualAgencySide;
      if (body.disclosureDocRef !== undefined) updates.disclosureDocRef = body.disclosureDocRef;
      // Explicit date wins; otherwise the boolean toggles the acknowledgement.
      if (body.disclosureAcknowledgedAt !== undefined) {
        updates.disclosureAcknowledgedAt = body.disclosureAcknowledgedAt
          ? new Date(body.disclosureAcknowledgedAt)
          : null;
      } else if (body.disclosureAcknowledged !== undefined) {
        updates.disclosureAcknowledgedAt = body.disclosureAcknowledged ? new Date() : null;
      }

      const updated = await storage.updateDeal(dealId, updates, undefined, orgId);
      res.json({
        dealId: updated.id,
        dualAgencySide: updated.dualAgencySide ?? null,
        disclosureAcknowledgedAt: updated.disclosureAcknowledgedAt ?? null,
        disclosureDocRef: updated.disclosureDocRef ?? null,
        recordOnly: true,
        notice: RECORD_ONLY_NOTICE,
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

}
