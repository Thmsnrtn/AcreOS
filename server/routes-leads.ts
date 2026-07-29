import type { Express, Response } from "express";
import { getOrganization, getUserId, type AuthenticatedRequest } from "./types/request";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, sql, and, desc, lt, inArray, or } from "drizzle-orm";
import { insertLeadSchema, leads, properties, deals } from "@shared/schema";
import { LEAD_STATUSES, isLeadStatus, validateLeadTransition } from "@shared/lifecycle/pipeline-status";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { checkUsageLimit } from "./services/usageLimits";
import { usageLimitGate } from "./middleware/usageLimitGate";
import { requireScope } from "./middleware/roleScope";
import { leadNurturerService } from "./services/leadNurturer";
import { leadScoringService } from "./services/leadScoring";
import { skipTracingService, type SkipTraceResult } from "./services/skipTracingService";
import { attachPermissionContext, type UserPermissionContext } from "./utils/permissions";
import { alertingService } from "./services/alerting";
import { propertyEnrichmentService } from "./services/propertyEnrichment";
import { requirePermission } from "./utils/permissions";
import { usageMeteringService, creditService } from "./services/credits";
import { parseCSV, importLeads, exportLeadsToCSV, getExpectedColumns, type ExportFilters } from "./services/importExport";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { assertUserIsOrgMember } from "./utils/orgScope";
import { createLeadContract } from "@shared/contracts";
// Wave B "Wire the engine" — lead.* workflow events. Fire-and-forget: these
// helpers never throw, so an automation failure can never fail a lead write.
import { emitLeadCreated, emitLeadUpdated, safeEmitLeadEvent } from "./services/leadEvents";
import { validateResponse } from "./utils/contractResponse";
import { createUploadMiddleware, validateFileMiddleware } from "./middleware/fileUploadSecurity";

// Partial update schema for PUT endpoints
const updateLeadSchema = insertLeadSchema.partial();

// Task #Phase5: Zod schemas for bulk operations (mirrors bulkIdsSchema in routes-properties.ts)
const bulkLeadIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "ids must be a non-empty array"),
});
const bulkLeadUpdateSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "ids must be a non-empty array"),
  updates: updateLeadSchema,
});

// Zod schemas for lead operations
const checkDuplicatesSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
}).refine(
  (data) => data.firstName || data.lastName || data.email || data.phone || data.address,
  { message: "At least one search field is required" }
);

const mergeLeadsSchema = z.object({
  primaryId: z.number().int().positive("primaryId must be a positive integer"),
  duplicateId: z.number().int().positive("duplicateId must be a positive integer"),
}).refine(
  (data) => data.primaryId !== data.duplicateId,
  { message: "primaryId and duplicateId must be different" }
);

const MAX_CSV_IMPORT_ROWS = 500;

/**
 * Truth-immutable (Quinn): map a real skip-trace provider result into the
 * stored `skip_traces.results` shape. This NEVER mints `verified: true` —
 * the providers return a confidence score, not a source-asserted
 * verification, so every contact is recorded as unverified. Exported so the
 * no-fabrication invariant is unit-testable in isolation.
 */
export function mapSkipTraceResults(trace: SkipTraceResult): {
  results: {
    phones: { number: string; type: string; verified: boolean }[];
    emails: { email: string; verified: boolean }[];
    relatives: { name: string }[];
    addresses?: { address: string; type: string; current: boolean }[];
    ageRange?: string;
  };
  hasAny: boolean;
} {
  const phones = trace.contacts
    .filter((c) => c.type === "phone")
    .map((c) => ({ number: c.value, type: c.lineType ?? "unknown", verified: false }));
  const emails = trace.contacts
    .filter((c) => c.type === "email")
    .map((c) => ({ email: c.value, verified: false }));
  const relatives = trace.contacts
    .filter((c) => c.type === "relative")
    .map((c) => ({ name: c.value }));

  const hasAny =
    phones.length > 0 || emails.length > 0 || relatives.length > 0 || !!trace.owner;

  return {
    hasAny,
    results: {
      phones,
      emails,
      relatives,
      ...(trace.owner?.address
        ? { addresses: [{ address: trace.owner.address, type: "current", current: true }] }
        : {}),
      ...(trace.owner?.age != null ? { ageRange: String(trace.owner.age) } : {}),
    },
  };
}

const upload = createUploadMiddleware({ maxSizeMB: 5, allowedTypes: ["text"] });
const validateCSV = validateFileMiddleware(["text"]);

// Zod schema for pagination query params
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  // Server-side search. Matches across name, email, phone, address,
  // city, state, zip via ILIKE. Empty string ignored. Capped at 100
  // chars to keep planner cost bounded (and to make obvious abuse
  // visible at request validation time).
  q: z.string().max(100).optional(),
});

export function registerLeadRoutes(app: Express): void {
  const api = app;

  // LEADS (CRM)
  // ============================================

  api.get("/api/leads", isAuthenticated, getOrCreateOrg, attachPermissionContext(), async (req, res) => {
    const org = req.organization;
    const context = req.permissionContext as UserPermissionContext | undefined;
    const stage = req.query.stage as string | undefined;
    const assignedToFilter = req.query.assignedTo as string | undefined;

    // Parse pagination params
    const pagination = paginationQuerySchema.safeParse(req.query);
    if (!pagination.success) {
      return Errors.badRequest(res, "Invalid pagination parameters", pagination.error.issues);
    }
    const { page, pageSize, sortBy, sortOrder, q } = pagination.data;

    // Build SQL-level assignedTo filter to avoid full-table scan
    let sqlAssignedTo: number | null | undefined;
    if (context?.permissions.viewOnlyAssignedLeads) {
      sqlAssignedTo = context.teamMemberId ?? null;
    } else if (assignedToFilter) {
      const assignedToId = Number(assignedToFilter);
      if (!isNaN(assignedToId)) {
        sqlAssignedTo = assignedToId;
      } else if (assignedToFilter === "unassigned") {
        sqlAssignedTo = null;
      }
    }

    const trimmedQ = q?.trim() || undefined;
    const filters: { assignedTo?: number | null; q?: string } | undefined =
      sqlAssignedTo !== undefined || trimmedQ
        ? { ...(sqlAssignedTo !== undefined ? { assignedTo: sqlAssignedTo } : {}), ...(trimmedQ ? { q: trimmedQ } : {}) }
        : undefined;

    // W5.3: stage filtering + pagination now run in SQL (the score formula
    // is mirrored in leadRepo.computedScoreSql). The old path loaded the
    // ENTIRE org's leads into memory and scored them in JS on every
    // request — O(org size) per page view.
    if (stage && ["hot", "warm", "cold", "dead"].includes(stage)) {
      const result = await storage.getLeadsByComputedStage(
        org.id,
        stage as "hot" | "warm" | "cold" | "dead",
        { page, pageSize },
        filters,
      );
      const data = result.data.map(lead => {
        const { score, factors } = leadNurturerService.calculateLeadScore(lead);
        const computedStage = leadNurturerService.segmentLead(score);
        return { ...lead, score, scoreFactors: factors, nurturingStage: computedStage };
      });
      return res.json({ data, total: result.total, page, pageSize, totalPages: result.totalPages });
    }

    // Server-side pagination with SQL LIMIT/OFFSET
    const result = await storage.getLeadsPaginated(org.id, { page, pageSize, sortBy, sortOrder }, filters);

    const leadsWithScores = result.data.map(lead => {
      const { score, factors } = leadNurturerService.calculateLeadScore(lead);
      const computedStage = leadNurturerService.segmentLead(score);
      return { ...lead, score, scoreFactors: factors, nurturingStage: computedStage };
    });

    res.json({
      data: leadsWithScores,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  });
  
  // Paginated leads endpoint for infinite scroll
  api.get("/api/leads/paginated", isAuthenticated, getOrCreateOrg, attachPermissionContext(), async (req, res) => {
    const org = req.organization;
    const context = req.permissionContext as UserPermissionContext | undefined;
    const stage = req.query.stage as string | undefined;
    const assignedToFilter = req.query.assignedTo as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const cursor = req.query.cursor as string | undefined;

    // Build SQL-level assignedTo filter to avoid full-table scan
    let sqlAssignedTo: number | null | undefined;
    if (context?.permissions.viewOnlyAssignedLeads) {
      sqlAssignedTo = context.teamMemberId ?? null;
    } else if (assignedToFilter) {
      const assignedToId = Number(assignedToFilter);
      if (!isNaN(assignedToId)) {
        sqlAssignedTo = assignedToId;
      } else if (assignedToFilter === "unassigned") {
        sqlAssignedTo = null;
      }
    }

    // W5.3: cursor pagination + stage filter now run in SQL — the old path
    // loaded EVERY lead in the org into memory on every scroll tick.
    const stageFilter = stage && ["hot", "warm", "cold", "dead"].includes(stage)
      ? (stage as "hot" | "warm" | "cold" | "dead")
      : undefined;
    const cursorId = cursor ? Number(cursor) : undefined;
    const result = await storage.getLeadsCursor(
      org.id,
      { limit, cursor: Number.isFinite(cursorId) ? cursorId : undefined, stage: stageFilter },
      sqlAssignedTo !== undefined ? { assignedTo: sqlAssignedTo } : undefined,
    );

    const paginatedLeads = result.data.map(lead => {
      const { score, factors } = leadNurturerService.calculateLeadScore(lead);
      const computedStage = leadNurturerService.segmentLead(score);
      return {
        ...lead,
        score,
        scoreFactors: factors,
        nurturingStage: computedStage,
      };
    });

    const total = result.total;
    const hasMore = result.hasMore;
    const nextCursor = hasMore ? String(paginatedLeads[paginatedLeads.length - 1]?.id) : null;
    
    res.json({
      data: paginatedLeads,
      nextCursor,
      hasMore,
      total,
    });
  });

  // Focus List: Top 10 leads not contacted in last 24 hours
  api.get("/api/leads/focus", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const allLeads = await storage.getLeads(org.id);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Score all leads and filter those not contacted in 24h
    const leadsWithScores = allLeads
      .map(lead => {
        const { score, factors } = leadNurturerService.calculateLeadScore(lead);
        const stage = leadNurturerService.segmentLead(score);
        return {
          ...lead,
          score,
          scoreFactors: factors,
          nurturingStage: stage,
        };
      })
      .filter(lead => {
        // Exclude dead leads
        if (lead.nurturingStage === "dead") return false;
        // Include if never contacted or not contacted in last 24h
        if (!lead.lastContactedAt) return true;
        return new Date(lead.lastContactedAt) < twentyFourHoursAgo;
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);
    
    res.json(leadsWithScores);
  });

  // Lead Nurturing Endpoints - Must be before /api/leads/:id to avoid route conflict
  api.get("/api/leads/insights", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const insights = await leadNurturerService.getLeadInsights(org.id);
    res.json(insights);
  });

  api.get("/api/leads/aging", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const agingLeads = await alertingService.getAgingLeads(org.id);
    res.json(agingLeads);
  });

  // duplicate-clusters — registered BEFORE /api/leads/:id so the literal
  // path wins; the :id matcher was capturing "duplicate-clusters" and
  // 400ing the dedupe page (2026-07-11 full-app sweep).
  // Batch dedupe scan — find every cluster of likely-duplicate leads
  // across the org. Result sorted by cluster size so operators work
  // highest-leverage merges first. Used by /leads/dedupe UI.
  api.get("/api/leads/duplicate-clusters", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = getOrganization(req);
      const { findDuplicateClusters } = await import("./services/leadDedupeScanner");
      const clusters = await findDuplicateClusters(org.id);
      res.json({ clusters });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // export — registered BEFORE /api/leads/:id so the literal path wins (2026-07-11 route-order sweep).
  api.get("/api/leads/export", isAuthenticated, getOrCreateOrg, requirePermission("canExportData"), async (req, res) => {
    const org = req.organization;
    const csv = await exportLeadsToCSV(org.id);
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leads-${date}.csv"`);
    res.send(csv);
  });

  api.get("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) return Errors.notFound(res, "Lead");
    res.json(lead);
  });
  

  // Check for duplicate leads before creating
  api.post("/api/leads/check-duplicates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = checkDuplicatesSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { firstName, lastName, email, phone, address } = parsed.data;

      const duplicates = await storage.findDuplicateLeads(org.id, {
        firstName,
        lastName,
        email,
        phone,
        address,
      });
      
      res.json({
        hasDuplicates: duplicates.length > 0,
        duplicates: duplicates.map(d => ({
          id: d.id,
          firstName: d.firstName,
          lastName: d.lastName,
          email: d.email,
          phone: d.phone,
          mailingAddress: d.address,
          status: d.status,
          createdAt: d.createdAt,
        })),
      });
    } catch (err) {
      logger.error("Check duplicates error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  // Merge two leads
  api.post("/api/leads/merge", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = mergeLeadsSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { primaryId, duplicateId } = parsed.data;

      const merged = await storage.mergeLeads(org.id, primaryId, duplicateId);
      
      res.json({
        success: true,
        message: "Leads merged successfully",
        lead: merged,
      });
    } catch (err) {
      logger.error("Merge leads error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.post("/api/leads", isAuthenticated, getOrCreateOrg, requireScope("deal_write"), usageLimitGate("leads"), async (req, res) => {
    try {
      const org = req.organization;
      
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Lead limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan to add more leads.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      // T3-3E Phase 3 — contract request validation. `leadCreateRequestSchema`
      // is `insertLeadSchema.passthrough()`, so this is the canonical insert
      // parse PLUS the transport-only extras the handler reads later
      // (latitude/longitude for enrichment, consentText/pageUrl for the TCPA
      // evidence chain). organizationId is attached from the authed org, not
      // the wire body. On failure → 422 via Errors.validationFailed.
      const parsedBody = createLeadContract.requestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return Errors.validationFailed(res, parsedBody.error.issues);
      }
      const input = parsedBody.data as typeof parsedBody.data & {
        organizationId?: number;
        assignedTo?: number | null;
        state?: string | null;
      };

      // Lens 48 — assignedTo from body must point at an active member
      // of the requesting org. Otherwise an attacker can create a lead
      // "assigned" to a user in another tenant.
      if ((input as any).assignedTo != null) {
        const ok = await assertUserIsOrgMember(String((input as any).assignedTo), org.id);
        if (!ok) return Errors.badRequest(res, "assignedTo must be a member of this organization");
      }

      // Phase 5 §5 (team readiness) — auto-assign via lead_assignment_rules
      // when caller did not specify assignedTo. Errors are swallowed inside
      // assignLead() so a misconfigured rule cannot break lead intake.
      if (input.assignedTo == null) {
        try {
          const { assignLead } = await import("./services/leadAssigner");
          const autoAssignee = await assignLead(org.id, {
            state: input.state ?? null,
            county: (input as any).county ?? null,
          });
          if (autoAssignee != null) {
            (input as any).assignedTo = autoAssignee;
          }
        } catch { /* non-fatal */ }
      }

      // insertLeadSchema strips organizationId; the repo write requires it.
      const lead = await storage.createLead({ ...input, organizationId: org.id });

      // Wave B — the "New Lead Received" trigger finally fires. Emitted from
      // the persisted row (never the request body) so workflow conditions
      // match on what was actually stored.
      emitLeadCreated(org.id, lead);

      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "lead",
        entityId: lead.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      // ── TCPA / CAN-SPAM evidence chain ─────────────────────────────────
      // If the lead was created with tcpaConsent=true, capture the
      // disclosure that was shown + the checkbox state + the IP/UA. Without
      // this row we have nothing to put in front of a jury when plaintiff
      // demands "prove they consented." The legal-language source-of-truth
      // for `consentText` lives in client/src/lib/consentDisclosure.ts;
      // route handlers pass it through verbatim from req.body.
      const inputAny = input as any;
      if (inputAny.tcpaConsent === true) {
        try {
          const { recordConsentGranted } = await import("./services/consentEvents");
          const sourceRaw = (inputAny.consentSource ?? "website") as string;
          const allowedSources = new Set([
            "website",
            "phone_ivr",
            "written",
            "sms_double_optin",
            "imported",
            "admin_manual",
          ]);
          await recordConsentGranted({
            organizationId: org.id,
            leadId: lead.id,
            channels: ["sms", "email", "phone", "direct_mail"],
            source: (allowedSources.has(sourceRaw) ? sourceRaw : "admin_manual") as any,
            consentText: (req.body.consentText ?? req.body.consent_text ?? null) as string | null,
            checkboxChecked:
              typeof req.body.consentCheckboxChecked === "boolean"
                ? req.body.consentCheckboxChecked
                : true, // default: tcpaConsent=true implies checkbox was checked
            ipAddress: req.ip || (req.socket?.remoteAddress ?? null),
            userAgent: (req.headers["user-agent"] as string) || null,
            pageUrl: (req.body.pageUrl ?? req.headers.referer ?? null) as string | null,
            recordedBy: userId ? String(userId) : "api",
            metadata: { route: "POST /api/leads" },
          });
        } catch {
          /* non-fatal — leads.tcpaConsent already set, audit row missing */
        }
      }

      // Phase 3 Week 14 — Activation telemetry. Idempotent FIRST-occurrence.
      try {
        const { recordActivationEventAsync } = await import("./services/activation");
        recordActivationEventAsync({
          orgId: org.id,
          userId,
          eventName: "first_lead_added",
          eventValue: { leadId: lead.id },
        });
      } catch { /* non-fatal */ }

      // Beatrice (CRO) — ADVISORY OFAC/sanctions screening of the counterparty
      // name. Fire-and-forget: NEVER blocks lead creation and NEVER throws. A
      // `potential_match` is recorded in sanctions_screenings and becomes a
      // founder-visible flag for MANUAL review — it is an advisory screen, not
      // a legal determination, and does not stop this action.
      try {
        const { screenCounterpartyAsync } = await import("./services/compliance/ofacScreening");
        const counterpartyName = [lead.firstName, lead.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
        if (counterpartyName) {
          screenCounterpartyAsync({
            organizationId: org.id,
            subjectType: "lead",
            subjectId: String(lead.id),
            name: counterpartyName,
          });
        }
      } catch { /* non-fatal — advisory only */ }

      // Magnus §1 — capture lead features at creation time. Outcome is paired
      // when (a) the lead's property closes a deal (converted) or (b) the
      // lead is dismissed via DELETE /api/leads/:id. Skip-trace and property
      // attributes that exist now are the load-bearing features.
      try {
        const { recordSnapshotAsync } = await import("./services/mlSnapshots");
        const inputAny = input as any;
        recordSnapshotAsync({
          snapshotType: "lead_conversion",
          subjectType: "lead",
          subjectId: String(lead.id),
          orgId: org.id,
          decisionAt: new Date(),
          features: {
            source: inputAny.source ?? null,
            campaignId: inputAny.campaignId ?? null,
            ownerName: inputAny.ownerName ?? null,
            propertyState: inputAny.state ?? null,
            propertyCounty: inputAny.county ?? null,
            acres: inputAny.acres ?? null,
            assessedValue: inputAny.assessedValue ?? null,
            taxDelinquent: inputAny.taxDelinquent ?? null,
            taxDelinquentAmount: inputAny.taxDelinquentAmount ?? null,
            yearsOwned: inputAny.yearsOwned ?? null,
            ownerState: inputAny.ownerState ?? null,
            outOfStateOwner: inputAny.outOfStateOwner ?? null,
            skipTraced: inputAny.phone || inputAny.email ? true : false,
          },
          labels: {},
        });
      } catch { /* non-fatal */ }

      const { latitude, longitude } = req.body;
      if (latitude && longitude) {
        Promise.resolve().then(async () => {
          try {
            await propertyEnrichmentService.enrichLead(
              org.id,
              lead.id,
              { latitude: parseFloat(latitude), longitude: parseFloat(longitude) }
            );
            logger.info("Lead enrichment completed", { leadId: lead.id, organizationId: org.id });
          } catch (err) {
            logger.error("Lead enrichment failed", { leadId: lead.id, error: (err as Error).message });
          }
        });
      }

      // Cycle 13: fire lead.created webhook asynchronously. Never blocks
      // the response; failures are logged inside the dispatcher.
      void (async () => {
        try {
          const { webhookLeadCreated } = await import("./services/webhookDispatcher");
          await webhookLeadCreated(org.id, lead);
        } catch (err) {
          logger.warn("lead.created webhook dispatch failed", {
            leadId: lead.id,
            error: (err as Error).message,
          });
        }
      })();

      // Phase 5 §5 Part D (team readiness) — fire big_lead_arrived event
      // when score >= 80. Non-blocking; failures are swallowed inside the
      // dispatcher.
      const leadScore = (lead as any).score ?? null;
      if (leadScore != null && leadScore >= 80) {
        void (async () => {
          try {
            const { dispatchTeamEvent } = await import("./services/teamWebhookDispatcher");
            await dispatchTeamEvent(org.id, "big_lead_arrived", {
              title: "High-score lead arrived",
              body: `Lead #${lead.id} (${(lead as any).firstName ?? ""} ${(lead as any).lastName ?? ""}) scored ${leadScore}.`,
              context: {
                leadId: lead.id,
                score: leadScore,
                source: (lead as any).source ?? null,
                state: (lead as any).state ?? null,
              },
            });
          } catch { /* non-fatal */ }
        })();
      }

      // T3-3E Phase 3 — contract response validation. dev/test throws on a
      // drift between this handler and the contract; prod warns + sends the
      // payload unchanged. Does NOT alter the response shape.
      res
        .status(201)
        .json(
          validateResponse(
            createLeadContract.responseSchema,
            lead,
            "POST /api/leads",
          ),
        );
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, "Validation failed", err.issues.map(e => ({ field: e.path.join('.'), message: e.message })));
      }
      throw err;
    }
  });

  api.put("/api/leads/:id", isAuthenticated, getOrCreateOrg, attachPermissionContext(), async (req, res) => {
    try {
      const org = req.organization;
      const leadId = Number(req.params.id);

      const existingLead = await storage.getLead(org.id, leadId);
      if (!existingLead) return Errors.notFound(res, "Lead");

      // Lens 48 — `viewOnlyAssignedLeads` was enforced on GET /api/leads
      // but NOT on the PUT path. A VA gated to assigned-leads-only could
      // mutate any lead in the org by guessing the numeric id. Re-assert
      // here so the gate holds across read AND write.
      const context = (req as AuthenticatedRequest).permissionContext;
      const callerId = req.user?.id ?? null;
      if (context?.permissions.viewOnlyAssignedLeads) {
        const assignedTo = (existingLead as any).assignedTo;
        if (assignedTo == null || String(assignedTo) !== String(callerId)) {
          return Errors.forbidden(res, "You can only modify leads assigned to you");
        }
      }

      const validated = updateLeadSchema.parse(req.body);

      // W3.4 — lead status is a real vocabulary with validated transitions
      // (shared/lifecycle/pipeline-status). Funnel metrics key off these
      // strings; a typo here used to silently vanish a lead from every
      // conversion query.
      if (validated.status && validated.status !== existingLead.status) {
        const transitionError = validateLeadTransition(existingLead.status, validated.status);
        if (transitionError) {
          return Errors.badRequest(res, transitionError);
        }
      }

      // Lens 48 — `assignedTo` from body must point at a member of the
      // requesting org. Without this check a customer admin could assign
      // a lead to a user in a different tenant (creating dangling
      // notifications + reporting confusion).
      if ((validated as any).assignedTo != null) {
        const targetUserId = String((validated as any).assignedTo);
        const ok = await assertUserIsOrgMember(targetUserId, org.id);
        if (!ok) return Errors.badRequest(res, "assignedTo must be a member of this organization");
      }

      const lead = await storage.updateLead(leadId, validated, org.id);

      // Wave B — `lead.status_changed` when the status really moved,
      // `lead.updated` for any other MATERIAL field, and NOTHING at all when
      // the PUT was a no-op (a no-op emit would wake every idle automation
      // on every save-without-changes).
      emitLeadUpdated(org.id, existingLead, lead, Object.keys(validated));

      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "lead",
        entityId: leadId,
        changes: { before: existingLead, after: lead, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      const { score, factors } = leadNurturerService.calculateLeadScore(lead!);
      const nurturingStage = leadNurturerService.segmentLead(score);
      
      await storage.updateLeadScore(leadId, score, factors);
      
      // latitude/longitude are not lead columns; read them from the raw body
      // (caller may supply coordinates for enrichment only).
      const latitude = req.body?.latitude;
      const longitude = req.body?.longitude;
      if (latitude && longitude) {
        Promise.resolve().then(async () => {
          try {
            await propertyEnrichmentService.enrichLead(
              org.id,
              leadId,
              { latitude: parseFloat(String(latitude)), longitude: parseFloat(String(longitude)) }
            );
            logger.info("Lead enrichment completed", { leadId, organizationId: org.id });
          } catch (err) {
            logger.error("Lead enrichment failed", { leadId, error: (err as Error).message });
          }
        });
      }
      
      res.json({
        ...lead,
        score,
        scoreFactors: factors,
        nurturingStage,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, "Validation failed", err.issues.map(e => ({ field: e.path.join('.'), message: e.message })));
      }
      throw err;
    }
  });
  
  api.delete("/api/leads/:id", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    if (isNaN(leadId)) {
      return Errors.badRequest(res, "Invalid lead ID");
    }
    const existingLead = await storage.getLead(org.id, leadId);
    if (!existingLead) {
      return Errors.notFound(res, "Lead");
    }

    // Soft delete: set deletedAt instead of hard deleting
    const user = req.user as any;
    const userId = user?.id || user?.id;
    await db.update(leads).set({
      deletedAt: new Date(),
      deletedBy: userId || null,
    }).where(eq(leads.id, leadId));

    await storage.createAuditLogEntry({
      organizationId: org.id,
      userId,
      action: "delete",
      entityType: "lead",
      entityId: leadId,
      changes: { before: existingLead, fields: ["soft_deleted"] },
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers["user-agent"],
    });

    res.status(204).send();
  });

  // Restore a soft-deleted lead
  api.patch("/api/leads/:id/restore", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    if (isNaN(leadId)) {
      return Errors.badRequest(res, "Invalid lead ID");
    }

    // Find the lead even if soft-deleted
    const [lead] = await db.select().from(leads).where(
      and(eq(leads.id, leadId), eq(leads.organizationId, org.id))
    ).limit(1);
    if (!lead) {
      return Errors.notFound(res, "Lead");
    }

    const [restored] = await db.update(leads).set({
      deletedAt: null,
      deletedBy: null,
    }).where(eq(leads.id, leadId)).returning();

    // Wave B — restoring a soft-deleted lead really does change its state,
    // so automations should see it. Restoring an ALREADY-active lead changed
    // nothing, so it emits nothing.
    if (lead.deletedAt != null && restored) {
      safeEmitLeadEvent(
        "lead.updated",
        org.id,
        leadId,
        { ...restored, changedFields: ["deletedAt"] },
        { ...lead },
      );
    }

    res.json({ message: "Lead restored", id: leadId });
  });
  
  api.post("/api/leads/:id/enrich", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const leadId = Number(req.params.id);
      
      if (isNaN(leadId)) {
        return Errors.badRequest(res, "Invalid lead ID");
      }

      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return Errors.notFound(res, "Lead");
      }

      const enrichSchema = z.object({
        latitude: z.union([z.number(), z.string()]).transform(Number).pipe(z.number()),
        longitude: z.union([z.number(), z.string()]).transform(Number).pipe(z.number()),
        forceRefresh: z.boolean().optional(),
      });
      const parsed = enrichSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { latitude, longitude, forceRefresh } = parsed.data;

      const result = await propertyEnrichmentService.enrichLead(
        org.id,
        leadId,
        { latitude, longitude },
        forceRefresh === true
      );
      
      if (!result) {
        return Errors.badRequest(res, "Enrichment failed - coordinates required");
      }

      logger.info("Manual lead enrichment completed", { leadId, organizationId: org.id });
      // Lenore §1 — first_lead_enriched is fired inside enrichLead()
      // itself so every enrichment path (manual, auto-on-create, bulk)
      // captures it. No fire here.

      res.json({
        success: true,
        message: "Lead enriched successfully",
        enrichment: result,
      });
    } catch (err) {
      logger.error("Manual lead enrichment failed", { error: (err as Error).message });
      Errors.internal(res, err);
    }
  });
  
  api.post("/api/leads/bulk-delete", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req, res) => {
    try {
      const org = req.organization;
      const parsed = bulkLeadIdsSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, parsed.error.issues[0].message);
      }
      const { ids } = parsed.data;

      const deletedCount = await storage.bulkDeleteLeads(org.id, ids);
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_delete",
        entityType: "lead",
        entityId: 0,
        metadata: { ids, count: deletedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ deletedCount });
    } catch (error: any) {
      logger.error("Bulk delete leads error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });
  
  api.post("/api/leads/bulk-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = bulkLeadUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, parsed.error.issues[0].message);
      }
      const { ids, updates } = parsed.data;

      // Wave B — snapshot the BEFORE rows once. They serve both the W3.4
      // transition gate below and the per-lead workflow-event diff after the
      // write, so this is one extra read for the whole batch, not per lead.
      const beforeLeads = await storage.getLeadsByIds(org.id, ids);

      // W3.4 — a bulk status write must be a valid status value AND a legal
      // transition for every targeted lead (same machine as the single-lead
      // PUT; this route used to accept any string).
      if (typeof (updates as Record<string, unknown>).status === "string") {
        const nextStatus = (updates as Record<string, string>).status;
        if (!isLeadStatus(nextStatus)) {
          return Errors.badRequest(
            res,
            `"${nextStatus}" is not a valid lead status (expected one of: ${LEAD_STATUSES.join(", ")})`,
          );
        }
        const blocked = beforeLeads
          .map((l) => ({ id: l.id, error: validateLeadTransition(l.status, nextStatus) }))
          .filter((b): b is { id: number; error: string } => b.error !== null);
        if (blocked.length > 0) {
          return Errors.badRequest(
            res,
            `${blocked.length} lead(s) cannot move to "${nextStatus}": ${blocked[0].error}`,
            { blocked },
          );
        }
      }

      const updatedCount = await storage.bulkUpdateLeads(org.id, ids, updates);

      // Wave B — one event per lead that ACTUALLY changed. Re-read the
      // persisted rows rather than reconstructing `{...before, ...updates}`
      // so the payload is real data. Leads the bulk write left untouched
      // emit nothing.
      if (updatedCount > 0 && beforeLeads.length > 0) {
        try {
          const attempted = Object.keys(updates);
          const afterLeads = await storage.getLeadsByIds(org.id, ids);
          const afterById = new Map(afterLeads.map((l) => [l.id, l]));
          for (const before of beforeLeads) {
            emitLeadUpdated(org.id, before, afterById.get(before.id), attempted);
          }
        } catch (emitErr) {
          logger.warn("Bulk lead workflow events skipped (non-fatal)", {
            organizationId: org.id,
            error: emitErr instanceof Error ? emitErr : String(emitErr),
          });
        }
      }

      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_update",
        entityType: "lead",
        entityId: 0,
        changes: { after: updates },
        metadata: { ids, count: updatedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ updatedCount });
    } catch (error: any) {
      logger.error("Bulk update leads error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });
  
  api.get("/api/leads/:id/activities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    // Task #2: Verify lead belongs to org (IDOR prevention)
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) return Errors.notFound(res, "Lead");
    const limit = Math.min(100, req.query.limit ? Number(req.query.limit) : 50);
    const activities = await storage.getLeadActivities(leadId, limit);
    res.json(activities);
  });

  // POST /api/leads/:id/contact-event — Hank fix.
  // Tap-to-call/text was a raw `tel:`/`sms:` href, so MorningBrief's
  // "Nd since contact" chip, the stale-lead signal, and the lead-score
  // sort were all fed by a `lastContactedAt` that never moved when the
  // user touched the dialer chip. This endpoint is fired BEFORE the
  // tel: link opens so the data layer sees the call happen even if the
  // user never returns to the app.
  const contactEventSchema = z.object({
    channel: z.enum(["phone", "sms"]),
    method: z.enum(["tap", "manual"]).default("tap"),
    outcome: z
      .enum(["hot", "warm", "cold", "no_answer", "wrong_number"])
      .optional(),
  });
  api.post(
    "/api/leads/:id/contact-event",
    isAuthenticated,
    getOrCreateOrg,
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const userId = req.user?.id ?? null;
        const leadId = Number(req.params.id);
        if (!Number.isFinite(leadId)) {
          return Errors.badRequest(res, "Invalid lead id");
        }
        const existing = await storage.getLead(org.id, leadId);
        if (!existing) return Errors.notFound(res, "Lead");
        const parsed = contactEventSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return Errors.badRequest(
            res,
            "Validation failed",
            parsed.error.issues.map((e) => ({
              field: e.path.join("."),
              message: e.message,
            })),
          );
        }
        const { channel, method, outcome } = parsed.data;
        const now = new Date();

        // 1) Bump lastContactedAt on the lead row. We do this even for
        //    outcome-only follow-ups (so the post-call "wrong number"
        //    tap still confirms the data point we already wrote in the
        //    no-outcome path).
        const updated = await storage.updateLead(
          leadId,
          { lastContactedAt: now } as any,
          org.id,
        );

        // 2) Append a leadActivities row. Type is the channel-specific
        //    attempt; when an outcome is provided we widen the type so
        //    the timeline shows "phone_outcome: hot" etc.
        const activityType = outcome
          ? `${channel}_outcome`
          : `${channel}_attempt`;
        await storage.createLeadActivity({
          leadId,
          organizationId: org.id,
          type: activityType,
          description: outcome
            ? `Tap-to-${channel === "phone" ? "call" : "text"} outcome: ${outcome}`
            : `Tap-to-${channel === "phone" ? "call" : "text"}`,
          metadata: {
            channel,
            method,
            source: "tap-to-call",
            outcome: outcome ?? null,
            at: now.toISOString(),
          },
          performedBy: userId ? Number(userId) || null : null,
        } as any);

        logger.info("Lead contact event logged", {
          leadId,
          orgId: org.id,
          channel,
          method,
          outcome: outcome ?? null,
        });

        res.json({
          ok: true,
          leadId,
          lastContactedAt: updated.lastContactedAt,
          channel,
          method,
          outcome: outcome ?? null,
        });
      } catch (err) {
        logger.warn("Contact event log failed", {
          leadId: req.params.id,
          error: (err as Error)?.message,
        });
        return Errors.internal(res, err as Error);
      }
    },
  );

  api.get("/api/leads/:id/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const leadId = Number(req.params.id);
      
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return Errors.notFound(res, "Lead");
      }

      const allProperties = await storage.getProperties(org.id);
      const linkedProperties = allProperties.filter(p => p.sellerId === leadId);

      res.json(linkedProperties);
    } catch (error: any) {
      logger.error("Get lead properties error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // Timeline endpoints for communication history
  api.get("/api/leads/:id/timeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
    const includeDealChanges = req.query.includeDealChanges !== "false";

    const events = await storage.getActivityEvents(org.id, "lead", leadId, eventTypes);

    // Also fetch related deal stage changes and campaign touches for a richer timeline
    if (includeDealChanges) {
      try {
        // W6.2 bug fix: this used to query deal events with entityId=leadId —
        // deal events are keyed by DEAL id, so the merge silently returned
        // nothing since it shipped. The real bridge is lead → properties
        // (sellerId) → deals (propertyId).
        const sellerProps = await db
          .select({ id: properties.id })
          .from(properties)
          .where(and(eq(properties.organizationId, org.id), eq(properties.sellerId, leadId)));
        const dealRows = sellerProps.length > 0
          ? await db
              .select({ id: deals.id })
              .from(deals)
              .where(and(eq(deals.organizationId, org.id), inArray(deals.propertyId, sellerProps.map((p) => p.id))))
          : [];
        const existingIds = new Set(events.map((e: any) => e.id));
        for (const d of dealRows) {
          const dealEvents = await storage.getActivityEvents(org.id, "deal", d.id, undefined);
          for (const de of dealEvents) {
            if (!existingIds.has((de as any).id)) {
              existingIds.add((de as any).id);
              events.push(de);
            }
          }
        }
        // Sort merged list by date descending
        events.sort((a: any, b: any) => {
          const dateA = new Date(a.eventDate || a.createdAt).getTime();
          const dateB = new Date(b.eventDate || b.createdAt).getTime();
          return dateB - dateA;
        });
      } catch {
        // If deal events fail, still return the lead events
      }
    }

    res.json(events);
  });

  api.get("/api/properties/:id/timeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const propertyId = Number(req.params.id);
    const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
    const events = await storage.getActivityEvents(org.id, "property", propertyId, eventTypes);
    res.json(events);
  });

  api.get("/api/deals/:id/timeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const dealId = Number(req.params.id);
    const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
    const events = await storage.getActivityEvents(org.id, "deal", dealId, eventTypes);
    res.json(events);
  });

  api.post("/api/leads/:id/score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) {
      return Errors.notFound(res, "Lead");
    }

    const scoredLead = await leadNurturerService.scoreLead(lead);
    res.json({
      lead: scoredLead,
      score: scoredLead.score,
      scoreFactors: scoredLead.scoreFactors,
      nurturingStage: scoredLead.nurturingStage,
    });
  });

  // ============================================
  // BETTY-STYLE LEAD SCORING
  // ============================================
  
  api.post("/api/leads/:id/betty-score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    const triggerSource = req.body.triggerSource || "manual";
    
    try {
      const result = await leadScoringService.scoreLead(leadId, org.id, triggerSource);
      res.json({
        success: true,
        score: result.score,
        normalizedScore: result.normalizedScore,
        recommendation: result.recommendation,
        factors: result.factors,
        scoredAt: result.scoredAt,
      });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.post("/api/leads/batch-score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const { leadIds, triggerSource = "batch" } = req.body;
    
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return Errors.badRequest(res, "leadIds array is required");
    }

    if (leadIds.length > 100) {
      return Errors.badRequest(res, "Maximum 100 leads per batch");
    }
    
    try {
      const results = await leadScoringService.batchScoreLeads(leadIds, org.id, triggerSource);
      res.json({
        success: true,
        scored: results.length,
        results: results.map(r => ({
          leadId: r.leadId,
          score: r.score,
          recommendation: r.recommendation,
        })),
      });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.get("/api/leads/:id/score-history", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    
    try {
      const history = await leadScoringService.getScoreHistory(leadId, limit);
      res.json(history);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.get("/api/scoring/profiles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    
    try {
      const profile = await leadScoringService.getOrCreateDefaultProfile(org.id);
      res.json([profile]);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.get("/api/scoring/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    
    try {
      const stats = await leadScoringService.getScoringStats(org.id);
      res.json(stats);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.post("/api/leads/:id/conversion", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    const { conversionType, campaignId, campaignType, touchNumber, dealValue, profitMargin } = req.body;
    
    if (!conversionType) {
      return Errors.badRequest(res, "conversionType is required");
    }
    
    try {
      await leadScoringService.recordConversion(leadId, org.id, conversionType, {
        campaignId,
        campaignType,
        touchNumber,
        dealValue,
        profitMargin,
      });
      res.json({ success: true });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.post("/api/leads/:id/nurture", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const leadId = Number(req.params.id);
    
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) {
      return Errors.notFound(res, "Lead");
    }

    const usageResult = await usageMeteringService.recordUsage(
      org.id,
      "ai_chat",
      1,
      { feature: "lead_nurturing", leadId }
    );

    if (usageResult.insufficientCredits) {
      return res.status(402).json({
        message: "Insufficient credits for AI follow-up generation",
        error: "INSUFFICIENT_CREDITS",
      });
    }

    const followUp = await leadNurturerService.generateFollowUp(lead);
    
    if (!followUp) {
      return Errors.internal(res, new Error("Failed to generate follow-up message"));
    }

    await storage.createLeadActivity({
      organizationId: org.id,
      leadId,
      type: "ai_followup_generated",
      description: `AI generated follow-up: ${followUp.subject}`,
      metadata: {
        subject: followUp.subject,
        messagePreview: followUp.message.substring(0, 100),
      },
    });

    res.json({
      subject: followUp.subject,
      message: followUp.message,
      creditsUsed: 1,
    });
  });
  
  
  api.post("/api/leads/import", isAuthenticated, getOrCreateOrg, upload.single("file"), validateCSV, async (req, res) => {
    try {
      const org = req.organization;
      const file = req.file;
      
      if (!file) {
        return Errors.badRequest(res, "No file uploaded");
      }

      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);

      if (csvData.length === 0) {
        return Errors.badRequest(res, "CSV file is empty or has no data rows");
      }

      // Check row count limit
      if (csvData.length > MAX_CSV_IMPORT_ROWS) {
        return Errors.badRequest(res, `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Your file has ${csvData.length} rows. Please split into smaller files.`);
      }
      
      // Pre-check usage limits before importing
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (usageCheck.limit !== null) {
        const wouldExceed = usageCheck.current + csvData.length > usageCheck.limit;
        if (wouldExceed) {
          return res.status(429).json({
            message: `Import would exceed your plan limit of ${usageCheck.limit} leads (current: ${usageCheck.current}, importing: ${csvData.length}). Upgrade your plan to import more leads.`,
            current: usageCheck.current,
            importing: csvData.length,
            limit: usageCheck.limit,
            tier: usageCheck.tier,
          });
        }
      }
      
      const result = await importLeads(csvData, org.id);
      res.json(result);
    } catch (err) {
      logger.error("Lead import error", err instanceof Error ? err : undefined);
      Errors.badRequest(res, err instanceof Error ? err.message : "Failed to import leads");
    }
  });
  
  api.post("/api/leads/import/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), validateCSV, async (req, res) => {
    try {
      const file = req.file;
      
      if (!file) {
        return Errors.badRequest(res, "No file uploaded");
      }

      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);

      if (csvData.length === 0) {
        return Errors.badRequest(res, "CSV file is empty or has no data rows");
      }

      const headers = Object.keys(csvData[0]);
      const preview = csvData.slice(0, 5);
      const expectedColumns = getExpectedColumns("leads");
      
      res.json({
        totalRows: csvData.length,
        headers,
        preview,
        expectedColumns,
      });
    } catch (err) {
      logger.error("Lead import preview error", err instanceof Error ? err : undefined);
      Errors.badRequest(res, err instanceof Error ? err.message : "Failed to parse CSV");
    }
  });

  // CSV importer with column auto-mapping + APN dedupe (Hank fix).
  // Accepts pre-mapped rows from the client (the parsed + user-confirmed
  // header → field mapping happens in CsvImportSheet). Runs the insert
  // in a transactional batch and reports per-row outcomes so the user
  // can see exactly which rows were skipped (existing APN) vs invalid.
  const csvImportRowSchema = z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    ownerName: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    apn: z.string().optional(),
  });
  const csvImportBodySchema = z.object({
    rows: z.array(csvImportRowSchema).min(1).max(MAX_CSV_IMPORT_ROWS),
  });
  api.post(
    "/api/leads/csv-import",
    isAuthenticated,
    getOrCreateOrg,
    requireScope("deal_write"),
    usageLimitGate("leads"),
    async (req, res) => {
      try {
        const org = (req as AuthenticatedRequest).organization;
        const parsed = csvImportBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return Errors.badRequest(
            res,
            "Validation failed",
            parsed.error.issues.map((e) => ({
              field: e.path.join("."),
              message: e.message,
            })),
          );
        }
        const { rows } = parsed.data;

        // 1) Collect APNs for dedupe lookup.
        const incomingApns = Array.from(
          new Set(
            rows
              .map((r) => (r.apn ?? "").trim())
              .filter((a) => a.length > 0),
          ),
        );

        // 2) Existing-APN lookup. Org-scoped — different orgs may
        //    legitimately have the same APN as a lead.
        let existingApns = new Set<string>();
        if (incomingApns.length > 0) {
          const existing = await db
            .select({ apn: leads.apn })
            .from(leads)
            .where(
              and(
                eq(leads.organizationId, org.id),
                inArray(leads.apn, incomingApns),
              ),
            );
          existingApns = new Set(
            existing
              .map((r) => (r.apn ?? "").trim())
              .filter((a) => a.length > 0),
          );
        }

        // 3) Within-file APN dedupe — keep first occurrence.
        const seenApnInFile = new Set<string>();

        const errors: Array<{ row: number; message: string }> = [];
        let imported = 0;
        let skippedExisting = 0;
        let skippedInvalid = 0;
        let skippedDuplicateInFile = 0;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const apn = (row.apn ?? "").trim();

          // First/last name fallback: when CSV only has an "Owner Name"
          // column (common on county lists), split on the first space.
          let firstName = row.firstName?.trim() ?? "";
          let lastName = row.lastName?.trim() ?? "";
          if ((!firstName || !lastName) && row.ownerName) {
            const parts = row.ownerName.trim().split(/\s+/);
            firstName = firstName || parts[0] || "";
            lastName = lastName || parts.slice(1).join(" ") || parts[0] || "";
          }

          if (!firstName || !lastName) {
            skippedInvalid++;
            errors.push({
              row: i + 1,
              message: "Missing required firstName/lastName (and no usable ownerName).",
            });
            continue;
          }

          if (apn) {
            if (existingApns.has(apn)) {
              skippedExisting++;
              continue;
            }
            if (seenApnInFile.has(apn)) {
              skippedDuplicateInFile++;
              continue;
            }
            seenApnInFile.add(apn);
          }

          try {
            // `.returning()` (added Wave B) — we need the persisted row to
            // emit lead.created with a real entity id. Without it the
            // workflow event would have nothing to point at.
            const [insertedLead] = await db.insert(leads).values({
              organizationId: org.id,
              type: "seller",
              firstName,
              lastName,
              email: row.email?.trim() || null,
              phone: row.phone?.trim() || null,
              address: row.address?.trim() || null,
              city: row.city?.trim() || null,
              state: row.state?.trim() || null,
              zip: row.zip?.trim() || null,
              apn: apn || null,
              source: "csv_import",
              status: "new",
            }).returning();
            imported++;
            // One event per imported lead. See the volume note on
            // importLeads() in services/importExport.ts — the engine queues
            // these and drains them serially off the request path.
            emitLeadCreated(org.id, insertedLead);
          } catch (insertErr) {
            skippedInvalid++;
            errors.push({
              row: i + 1,
              message: (insertErr as Error)?.message ?? "Insert failed",
            });
          }
        }

        logger.info("CSV import completed", {
          orgId: org.id,
          total: rows.length,
          imported,
          skippedExisting,
          skippedInvalid,
          skippedDuplicateInFile,
        });

        res.json({
          imported,
          skippedExisting,
          skippedInvalid,
          skippedDuplicateInFile,
          errors: errors.slice(0, 50), // cap to keep payload bounded
        });
      } catch (err) {
        logger.error(
          "CSV import failed",
          err instanceof Error ? err : undefined,
        );
        Errors.internal(res, err as Error);
      }
    },
  );

  // Tax Delinquent List Import (Phase 2.5)
  api.post("/api/leads/import/tax-delinquent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { mappedData, columnMapping } = req.body;

      if (!mappedData || !Array.isArray(mappedData)) {
        return Errors.badRequest(res, "No mapped data provided");
      }

      if (mappedData.length === 0) {
        return Errors.badRequest(res, "No records to import");
      }

      if (mappedData.length > MAX_CSV_IMPORT_ROWS) {
        return Errors.badRequest(res, `Import exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Please split into smaller batches.`);
      }

      // Check usage limits
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (usageCheck.limit !== null) {
        const wouldExceed = usageCheck.current + mappedData.length > usageCheck.limit;
        if (wouldExceed) {
          return res.status(429).json({
            message: `Import would exceed your plan limit of ${usageCheck.limit} leads`,
            current: usageCheck.current,
            importing: mappedData.length,
            limit: usageCheck.limit,
          });
        }
      }

      const results = { successCount: 0, errorCount: 0, errors: [] as any[] };

      // Build all lead data upfront, collecting any parse errors per row
      const validLeads: { index: number; data: any }[] = [];
      for (let i = 0; i < mappedData.length; i++) {
        try {
          const row = mappedData[i];

          // Parse name into first and last name
          let firstName = "Unknown";
          let lastName = "Owner";
          if (row.owner_name) {
            const nameParts = row.owner_name.trim().split(/\s+/);
            firstName = nameParts[0] || "Unknown";
            lastName = nameParts.slice(1).join(" ") || "Owner";
          }

          validLeads.push({
            index: i,
            data: {
              organizationId: org.id,
              type: "seller" as const,
              firstName,
              lastName,
              address: row.property_address || row.mailing_address || "",
              city: "",
              state: row.state || "",
              zip: "",
              source: "tax_delinquent",
              status: "new" as const,
              notes: [
                row.parcel_id ? `Parcel ID: ${row.parcel_id}` : "",
                row.assessed_value ? `Assessed Value: $${row.assessed_value}` : "",
                row.taxes_owed ? `Taxes Owed: $${row.taxes_owed}` : "",
                row.tax_year ? `Tax Year: ${row.tax_year}` : "",
                row.county ? `County: ${row.county}` : "",
              ].filter(Boolean).join("\n"),
              tags: ["tax_delinquent", row.county || "unknown"].filter(Boolean) as string[],
            },
          });
        } catch (err) {
          results.errorCount++;
          results.errors.push({
            row: i + 1,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      // Batch insert in chunks of 100 to avoid oversized queries
      const BATCH_SIZE = 100;
      for (let i = 0; i < validLeads.length; i += BATCH_SIZE) {
        const chunk = validLeads.slice(i, i + BATCH_SIZE);
        try {
          const created = await storage.createLeadsBatch(chunk.map(c => c.data));
          results.successCount += created.length;
          // Wave B — one lead.created per imported row (no batch event exists
          // in the engine's contract; see the volume note on importLeads()).
          for (const lead of created) emitLeadCreated(org.id, lead);
        } catch (err) {
          // If batch fails, fall back to individual inserts for this chunk
          for (const item of chunk) {
            try {
              const single = await storage.createLead(item.data);
              results.successCount++;
              emitLeadCreated(org.id, single);
            } catch (innerErr) {
              results.errorCount++;
              results.errors.push({
                row: item.index + 1,
                error: innerErr instanceof Error ? innerErr.message : "Unknown error",
              });
            }
          }
        }
      }

      res.json({
        totalRows: mappedData.length,
        ...results,
      });
    } catch (err) {
      logger.error("Tax delinquent import error", err instanceof Error ? err : undefined);
      Errors.badRequest(res, err instanceof Error ? err.message : "Failed to import tax delinquent list");
    }
  });

  // ============================================
  // SKIP TRACES (Phase 2.4)
  // ============================================

  api.get("/api/skip-traces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const traces = await storage.getSkipTraces(org.id);
    res.json(traces);
  });

  api.get("/api/skip-traces/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const trace = await storage.getSkipTrace(org.id, Number(req.params.id));
    if (!trace) return Errors.notFound(res, "Skip trace");
    res.json(trace);
  });

  api.get("/api/skip-traces/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const trace = await storage.getSkipTraceByLead(org.id, Number(req.params.leadId));
    res.json(trace || null);
  });

  api.post("/api/skip-traces", isAuthenticated, getOrCreateOrg, requireScope("tenant_pii_write"), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = getOrganization(req);
      const userId = getUserId(req);
      const { leadId, inputData, purposeOfUse, justification } = req.body;

      if (!leadId) {
        return Errors.badRequest(res, "Lead ID is required");
      }

      // FW-WYNNE-1 (push-forward 2026-05-08): permissible-purpose gate.
      // Wynne-Ohaegbu §1: skip-trace is FCRA-adjacent under §1681b(a)(3)(F).
      // Operator must claim purpose + justification at query time AND have
      // a current annual FCRA attestation. Persist both for class-action
      // defense audit trail.
      const { assertSkipTracePermitted, FcraAttestationStaleError, SkipTracePurposeRequiredError } =
        await import("./services/fcraAttestation");
      let attestationVersion: string;
      try {
        const result = await assertSkipTracePermitted({
          organizationId: org.id,
          userId,
          purposeOfUse,
          justification,
        });
        attestationVersion = result.attestationVersion;
      } catch (err) {
        if (err instanceof SkipTracePurposeRequiredError) {
          return Errors.badRequest(res, err.message, { code: err.code });
        }
        if (err instanceof FcraAttestationStaleError) {
          return res.status(403).json({
            error: "FCRA_ATTESTATION_REQUIRED",
            message: err.message,
            statusCode: 403,
          });
        }
        throw err;
      }

      // Check if lead exists
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return Errors.notFound(res, "Lead");
      }

      // Truth-immutable: skip-trace MUST resolve through a real provider.
      // If no skip-trace provider is configured, return an honest
      // "unavailable" state and record NO cost — never fabricate PII.
      if (!skipTracingService.isConfigured()) {
        logger.warn("Skip trace requested but no provider configured", {
          source: "routes-leads",
          metadata: { organizationId: org.id, leadId },
        });
        return res.json({
          status: "unavailable",
          message: "No skip-trace provider configured",
        });
      }

      // Create pending skip trace. Cost is left null until the real
      // provider returns — we never pre-charge for a result we don't have.
      const skipTrace = await storage.createSkipTrace({
        organizationId: org.id,
        leadId,
        inputData: inputData || {
          name: `${lead.firstName} ${lead.lastName}`,
          address: lead.address || "",
        },
        status: "processing",
        costCents: null,
        requestedAt: new Date(),
        purposeOfUse,
        justification,
        attestingUserId: userId,
        attestationVersion,
      });

      // Route through the real skip-tracing service (BatchSkipTracing /
      // REISkip via the registry). The service owns provider selection,
      // cross-customer caching, and the canonical ledger debit — so we
      // never charge here and never fabricate a contact.
      try {
        const trace = await skipTracingService.trace(
          {
            firstName: lead.firstName,
            lastName: lead.lastName,
            address: lead.address ?? undefined,
            city: lead.city ?? undefined,
            state: lead.state ?? undefined,
            zip: lead.zip ?? undefined,
          },
          org.id,
        );

        if (!trace.success) {
          const updated = await storage.updateSkipTrace(skipTrace.id, {
            status: "no_results",
            provider: trace.source === "none" ? null : trace.source,
            completedAt: new Date(),
          });
          return res.json(updated);
        }

        // Map the provider's real contacts into the stored shape. The helper
        // NEVER mints verified:true — providers return a confidence score, not
        // a source-asserted verification.
        const { results, hasAny } = mapSkipTraceResults(trace);

        const creditCents = Number(process.env.SKIP_TRACE_CREDIT_CENTS ?? 20);
        const updated = await storage.updateSkipTrace(skipTrace.id, {
          status: hasAny ? "completed" : "no_results",
          provider: trace.source,
          // Real cost only — the ledger debit was already posted by the
          // service; this is the displayed unit cost, not a second charge.
          costCents: hasAny ? (trace.creditsUsed ?? 1) * creditCents : 0,
          results,
          completedAt: new Date(),
        });
        return res.json(updated);
      } catch (err) {
        logger.error("Skip trace lookup failed", err instanceof Error ? err : undefined);
        const failed = await storage.updateSkipTrace(skipTrace.id, {
          status: "failed",
          costCents: 0,
          completedAt: new Date(),
        });
        return res.json(failed);
      }
    } catch (err) {
      logger.error("Skip trace error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  

}
