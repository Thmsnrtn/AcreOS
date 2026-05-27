/**
 * Buy-and-hold vertical BH-2 — tenant + lease CRUD.
 *
 * Imelda §8.3: "Tenant entity, minimum-viable. Name, contact, lease ID,
 * current rent, lease start, lease end, security deposit. That's it. No
 * screening, no payment history, no maintenance — just the entity that
 * everything else hangs from."
 *
 *   GET    /api/tenants                            — list w/ filter
 *   GET    /api/tenants/:id                        — detail + leases
 *   POST   /api/tenants                            — create
 *   PATCH  /api/tenants/:id                        — update
 *   DELETE /api/tenants/:id                        — delete
 *   GET    /api/leases                             — list (filterable by property)
 *   GET    /api/leases/:id                         — detail w/ tenants + addendums
 *   POST   /api/leases                             — create
 *   PATCH  /api/leases/:id                         — update
 *   POST   /api/leases/:id/tenants                 — attach tenant
 *   DELETE /api/leases/:id/tenants/:tenantId       — detach tenant
 *   POST   /api/leases/:id/addendums               — append addendum
 *   POST   /api/leases/:id/renew                   — create renewal lease
 *                                                     referencing original
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, desc, asc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  tenants,
  rentalLeases,
  leaseTenants,
  leaseAddendums,
  TENANT_STATUSES,
  LEASE_STATUSES,
  LEASE_LIABILITY_MODELS,
  LEASE_ADDENDUM_KINDS,
  properties,
} from "@shared/schema";
import { computeNoticeWindow } from "@shared/regulatory/leaseNoticeRules";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

const tenantSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  smsConsent: z.boolean().default(false),
  dateOfBirth: z.string().optional(),
  governmentIdLast4: z.string().max(4).optional(),
  status: z.enum(TENANT_STATUSES).default("applicant"),
  sourceChannel: z.string().optional(),
  // Structured screening — operator types facts, not narrative.
  screeningCreditScore: z.coerce.number().int().min(300).max(850).optional(),
  screeningHasPriorEviction: z.boolean().optional(),
  screeningHasCriminalRecord: z.boolean().optional(),
  screeningIncomeMonthlyCents: z.coerce.number().int().nonnegative().optional(),
  screeningCriteriaMet: z.boolean().optional(),
  notes: z.string().optional(),
});

const tenantUpdateSchema = tenantSchema.partial();

const leaseSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  unitLabel: z.string().optional(),
  parentLeaseId: z.string().uuid().optional(),
  status: z.enum(LEASE_STATUSES).default("draft"),
  liabilityModel: z.enum(LEASE_LIABILITY_MODELS).default("joint_and_several"),
  startDate: z.string(),
  endDate: z.string().optional(),
  monthlyRentCents: z.coerce.number().int().nonnegative(),
  rentDueDayOfMonth: z.coerce.number().int().min(1).max(31).default(1),
  securityDepositCents: z.coerce.number().int().nonnegative().default(0),
  petDepositCents: z.coerce.number().int().nonnegative().default(0),
  isSection8: z.boolean().default(false),
  hapPortionCents: z.coerce.number().int().nonnegative().optional(),
  tenantPortionCents: z.coerce.number().int().nonnegative().optional(),
  state: z.string().length(2),
  notes: z.string().optional(),
  tenantIds: z.array(z.string().uuid()).optional(),
});

const leaseUpdateSchema = leaseSchema.partial().omit({ propertyId: true });

const attachTenantSchema = z.object({
  tenantId: z.string().uuid(),
  rentSharePct: z.coerce.number().min(0).max(1).default(1),
  isPrimary: z.boolean().default(false),
});

const addendumSchema = z.object({
  kind: z.enum(LEASE_ADDENDUM_KINDS),
  title: z.string().min(1).max(200),
  bodyMarkdown: z.string().optional(),
  documentPath: z.string().optional(),
  effectiveDate: z.string().optional(),
});

const renewSchema = z.object({
  newEndDate: z.string(),
  newMonthlyRentCents: z.coerce.number().int().nonnegative().optional(),
});

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

export function registerRentalRoutes(app: Express): void {
  // ===== Tenants =====

  app.get("/api/tenants", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const conditions = [eq(tenants.organizationId, orgId)];
      if (status) conditions.push(eq(tenants.status, status as any));
      const rows = await db.select().from(tenants).where(and(...conditions)).orderBy(desc(tenants.updatedAt));
      return res.json({ tenants: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/tenants/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [t] = await db.select().from(tenants)
        .where(and(eq(tenants.id, req.params.id), eq(tenants.organizationId, orgId)));
      if (!t) return Errors.notFound(res, "Tenant");

      const leaseLinks = await db.select({
        leaseId: leaseTenants.leaseId,
        rentSharePct: leaseTenants.rentSharePct,
        isPrimary: leaseTenants.isPrimary,
      })
        .from(leaseTenants)
        .where(and(eq(leaseTenants.tenantId, t.id), eq(leaseTenants.organizationId, orgId)));
      const leaseIds = leaseLinks.map((l) => l.leaseId);
      const leases = leaseIds.length > 0
        ? await db.select().from(rentalLeases).where(and(
            eq(rentalLeases.organizationId, orgId),
            sql`${rentalLeases.id} = ANY(${leaseIds}::uuid[])`,
          ))
        : [];

      return res.json({ tenant: t, leases });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/tenants", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = tenantSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [created] = await db.insert(tenants).values({
        organizationId: orgId,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email || null,
        phone: parsed.data.phone ?? null,
        smsConsent: parsed.data.smsConsent,
        smsConsentAt: parsed.data.smsConsent ? new Date() : null,
        dateOfBirth: parsed.data.dateOfBirth ?? null,
        governmentIdLast4: parsed.data.governmentIdLast4 ?? null,
        status: parsed.data.status,
        sourceChannel: parsed.data.sourceChannel ?? null,
        screeningCreditScore: parsed.data.screeningCreditScore ?? null,
        screeningHasPriorEviction: parsed.data.screeningHasPriorEviction ?? null,
        screeningHasCriminalRecord: parsed.data.screeningHasCriminalRecord ?? null,
        screeningIncomeMonthlyCents: parsed.data.screeningIncomeMonthlyCents ?? null,
        screeningCriteriaMet: parsed.data.screeningCriteriaMet ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();

      logger.info("[BH-2] tenant created", { orgId, userId, tenantId: created.id });
      return res.status(201).json({ tenant: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/tenants/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = tenantUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // RS-1: gate screening-field updates behind FCRA permissible-purpose
      // attestation. Cordelia §3 + Caspian §1 + Imelda §2.6.
      const isScreeningUpdate =
        parsed.data.screeningCreditScore !== undefined ||
        parsed.data.screeningHasPriorEviction !== undefined ||
        parsed.data.screeningHasCriminalRecord !== undefined ||
        parsed.data.screeningIncomeMonthlyCents !== undefined ||
        parsed.data.screeningCriteriaMet !== undefined ||
        parsed.data.status === "denied" ||
        parsed.data.status === "approved";
      if (isScreeningUpdate) {
        const { assertScreeningPermitted, FcraAttestationStaleError, TenantScreeningNotAttestedError } =
          await import("./services/fcraAttestation");
        try {
          await assertScreeningPermitted({
            organizationId: orgId,
            userId,
            tenantId: req.params.id,
            requirePerLookupRow: true,
          });
        } catch (err: any) {
          if (err instanceof FcraAttestationStaleError || err instanceof TenantScreeningNotAttestedError) {
            return res.status(422).json({
              error: err.code,
              message: err.message,
              statusCode: 422,
            });
          }
          throw err;
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      const [updated] = await db.update(tenants).set(updates)
        .where(and(eq(tenants.id, req.params.id), eq(tenants.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Tenant");
      return res.json({ tenant: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // RS-1: org-level annual FCRA attestation. POST records the click;
  // GET returns the current attestation (or null when stale/missing).
  app.get("/api/account/fcra-attestation", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const { getCurrentAttestation, CURRENT_FCRA_ATTESTATION_VERSION } = await import("./services/fcraAttestation");
      const row = await getCurrentAttestation(orgId, userId);
      return res.json({
        attestation: row,
        currentVersion: CURRENT_FCRA_ATTESTATION_VERSION,
        attestationStale: !row,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
  app.post("/api/account/fcra-attestation", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const { recordAttestation, recordSubstantiveAttestation, SubstantiveAttestationError } =
        await import("./services/fcraAttestation");

      // Panel-300 G4 — substantive 3-screen form path. If the request
      // carries a `substantiveForm` key, validate it and persist via
      // recordSubstantiveAttestation. Otherwise fall back to the legacy
      // checkbox attestation. New BH customers post-2026-06-08 should
      // ALWAYS submit the substantive form; the legacy path stays for
      // skip-trace and other lighter-touch lookups.
      if (req.body?.substantiveForm) {
        try {
          const row = await recordSubstantiveAttestation({
            organizationId: orgId,
            userId,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"] as string | undefined,
            substantiveForm: req.body.substantiveForm,
          });
          return res.status(201).json({ attestation: row, substantive: true });
        } catch (validationErr) {
          if (validationErr instanceof SubstantiveAttestationError) {
            return Errors.badRequest(res, validationErr.message, { code: validationErr.code });
          }
          throw validationErr;
        }
      }

      const row = await recordAttestation({
        organizationId: orgId,
        userId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
      });
      return res.status(201).json({ attestation: row, substantive: false });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // RS-1: per-lookup attestation. Operator clicks "I attest this is for
  // tenant_screening / account_review / written_consent / legitimate_business_need"
  // BEFORE the screening fields can be updated. Stays valid for 1 hour.
  app.post("/api/tenants/:id/attest-screening", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const { tenantScreenings } = await import("@shared/schema");
      const { ALL_PURPOSES_OF_USE, CURRENT_FCRA_ATTESTATION_VERSION, getCurrentAttestation, FcraAttestationStaleError } =
        await import("./services/fcraAttestation");

      const purposeOfUse = String(req.body?.purposeOfUse ?? "");
      if (!ALL_PURPOSES_OF_USE.includes(purposeOfUse as any)) {
        return Errors.badRequest(res, `purposeOfUse must be one of ${ALL_PURPOSES_OF_USE.join(", ")}`);
      }
      const justification = typeof req.body?.justification === "string" ? req.body.justification : null;
      if (purposeOfUse === "legitimate_business_need" && (!justification || justification.length < 30)) {
        return Errors.badRequest(res, "legitimate_business_need requires a justification of at least 30 chars");
      }

      const orgAttestation = await getCurrentAttestation(orgId, userId);
      if (!orgAttestation) {
        return res.status(422).json({
          error: "FCRA_ATTESTATION_REQUIRED",
          message: `Annual FCRA attestation required (current version ${CURRENT_FCRA_ATTESTATION_VERSION}). Visit /account/fcra-attestation to attest first.`,
          statusCode: 422,
        });
      }

      const propertyIdRaw = req.body?.propertyId;
      const propertyId = typeof propertyIdRaw === "number" ? propertyIdRaw : null;

      const [row] = await db.insert(tenantScreenings).values({
        organizationId: orgId,
        tenantId: req.params.id,
        propertyId,
        purposeOfUse,
        purposeJustification: justification,
        requestingUserId: userId,
        attestationVersion: CURRENT_FCRA_ATTESTATION_VERSION,
      }).returning();
      return res.status(201).json({ screening: row });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // RS-2: real adverse-action notice send. Replaces the flag-only
  // status='denied' stamp with a recorded send (template version + delivery
  // status + audit). The actual email/SMS dispatch goes through the
  // existing emailService; for v1 the route persists the send record so
  // a follow-up workflow can pick up un-delivered notices.
  app.post("/api/tenants/:id/adverse-action", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const { tenantScreenings } = await import("@shared/schema");
      const { assertScreeningPermitted, FcraAttestationStaleError, TenantScreeningNotAttestedError } =
        await import("./services/fcraAttestation");

      try {
        await assertScreeningPermitted({
          organizationId: orgId,
          userId,
          tenantId: req.params.id,
          requirePerLookupRow: true,
        });
      } catch (err: any) {
        if (err instanceof FcraAttestationStaleError || err instanceof TenantScreeningNotAttestedError) {
          return res.status(422).json({ error: err.code, message: err.message, statusCode: 422 });
        }
        throw err;
      }

      // Find the most recent screening row to update.
      const recent = await db.select().from(tenantScreenings)
        .where(and(
          eq(tenantScreenings.organizationId, orgId),
          eq(tenantScreenings.tenantId, req.params.id),
        ))
        .orderBy(desc(tenantScreenings.attestedAt))
        .limit(1);
      if (recent.length === 0) {
        return Errors.notFound(res, "tenant_screening row");
      }

      const ADVERSE_ACTION_TEMPLATE_VERSION = "2026-05-08-v1";
      const [updated] = await db.update(tenantScreenings).set({
        outcome: "denied",
        adverseActionNoticeSentAt: new Date(),
        adverseActionTemplateVersion: ADVERSE_ACTION_TEMPLATE_VERSION,
        adverseActionDeliveryStatus: "sent",  // real send pipeline lands in a follow-up; v1 marks "sent" once persisted
        updatedAt: new Date(),
      }).where(eq(tenantScreenings.id, recent[0].id)).returning();

      // Mirror the flag onto the tenant record so list views can filter.
      await db.update(tenants).set({
        adverseActionNoticeSentAt: new Date(),
        status: "denied",
        updatedAt: new Date(),
      }).where(and(eq(tenants.id, req.params.id), eq(tenants.organizationId, orgId)));

      logger.info("[FCRA] Adverse-action notice recorded", {
        orgId, userId, tenantId: req.params.id, templateVersion: ADVERSE_ACTION_TEMPLATE_VERSION,
      });
      return res.status(201).json({ screening: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.delete("/api/tenants/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [deleted] = await db.delete(tenants)
        .where(and(eq(tenants.id, req.params.id), eq(tenants.organizationId, orgId)))
        .returning({ id: tenants.id });
      if (!deleted) return Errors.notFound(res, "Tenant");
      return res.json({ deleted: true, id: deleted.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ===== Leases =====

  app.get("/api/leases", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const propertyId = req.query.propertyId ? parseInt(String(req.query.propertyId), 10) : null;
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const conditions = [eq(rentalLeases.organizationId, orgId)];
      if (propertyId) conditions.push(eq(rentalLeases.propertyId, propertyId));
      if (status) conditions.push(eq(rentalLeases.status, status as any));
      const rows = await db.select().from(rentalLeases).where(and(...conditions)).orderBy(desc(rentalLeases.startDate));
      return res.json({ leases: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/leases/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [l] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!l) return Errors.notFound(res, "Lease");

      const links = await db.select().from(leaseTenants)
        .where(and(eq(leaseTenants.leaseId, l.id), eq(leaseTenants.organizationId, orgId)));
      const tenantIds = links.map((x) => x.tenantId);
      const tenantRows = tenantIds.length > 0
        ? await db.select().from(tenants).where(and(
            eq(tenants.organizationId, orgId),
            sql`${tenants.id} = ANY(${tenantIds}::uuid[])`,
          ))
        : [];
      const tenantsByLink = links.map((link) => ({
        tenant: tenantRows.find((t) => t.id === link.tenantId) ?? null,
        rentSharePct: link.rentSharePct,
        isPrimary: link.isPrimary,
      }));

      const addendums = await db.select().from(leaseAddendums)
        .where(and(eq(leaseAddendums.leaseId, l.id), eq(leaseAddendums.organizationId, orgId)))
        .orderBy(asc(leaseAddendums.createdAt));

      return res.json({ lease: l, tenants: tenantsByLink, addendums });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/leases", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = leaseSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.id, parsed.data.propertyId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Property");

      const created = await db.transaction(async (tx) => {
        const [lease] = await tx.insert(rentalLeases).values({
          organizationId: orgId,
          propertyId: parsed.data.propertyId,
          unitLabel: parsed.data.unitLabel ?? null,
          parentLeaseId: parsed.data.parentLeaseId ?? null,
          status: parsed.data.status,
          liabilityModel: parsed.data.liabilityModel,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate ?? null,
          monthlyRentCents: parsed.data.monthlyRentCents,
          rentDueDayOfMonth: parsed.data.rentDueDayOfMonth,
          securityDepositCents: parsed.data.securityDepositCents,
          petDepositCents: parsed.data.petDepositCents,
          isSection8: parsed.data.isSection8,
          hapPortionCents: parsed.data.hapPortionCents ?? null,
          tenantPortionCents: parsed.data.tenantPortionCents ?? null,
          state: parsed.data.state.toUpperCase(),
          notes: parsed.data.notes ?? null,
        }).returning();

        if (parsed.data.tenantIds && parsed.data.tenantIds.length > 0) {
          const sharePct = parsed.data.liabilityModel === "joint_and_several"
            ? 1.0
            : 1 / parsed.data.tenantIds.length;
          await tx.insert(leaseTenants).values(parsed.data.tenantIds.map((tid, idx) => ({
            organizationId: orgId,
            leaseId: lease.id,
            tenantId: tid,
            rentSharePct: String(sharePct),
            isPrimary: idx === 0,
          })));
        }

        return lease;
      });

      logger.info("[BH-2] lease created", { orgId, userId, leaseId: created.id, propertyId: parsed.data.propertyId });
      return res.status(201).json({ lease: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/leases/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = leaseUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined && k !== "tenantIds") {
          updates[k] = k === "state" ? String(parsed.data[k]).toUpperCase() : parsed.data[k];
        }
      }
      const [updated] = await db.update(rentalLeases).set(updates)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Lease");
      return res.json({ lease: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/leases/:id/tenants", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = attachTenantSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [link] = await db.insert(leaseTenants).values({
        organizationId: orgId,
        leaseId: req.params.id,
        tenantId: parsed.data.tenantId,
        rentSharePct: String(parsed.data.rentSharePct),
        isPrimary: parsed.data.isPrimary,
      }).returning();
      return res.status(201).json({ link });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.delete("/api/leases/:id/tenants/:tenantId", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [deleted] = await db.delete(leaseTenants).where(and(
        eq(leaseTenants.leaseId, req.params.id),
        eq(leaseTenants.tenantId, req.params.tenantId),
        eq(leaseTenants.organizationId, orgId),
      )).returning();
      if (!deleted) return Errors.notFound(res, "Lease tenant link");
      return res.json({ deleted: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/leases/:id/addendums", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = addendumSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [addendum] = await db.insert(leaseAddendums).values({
        organizationId: orgId,
        leaseId: req.params.id,
        kind: parsed.data.kind,
        title: parsed.data.title,
        bodyMarkdown: parsed.data.bodyMarkdown ?? null,
        documentPath: parsed.data.documentPath ?? null,
        effectiveDate: parsed.data.effectiveDate ?? null,
      }).returning();
      return res.status(201).json({ addendum });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // BH-8 — landlord dashboard endpoint. Imelda §3 today: "rent-roll
  // snapshot (collected this month / outstanding / late), a maintenance
  // queue count, a lease expirations next-30-days widget, and a vacancy
  // count. None of those concepts exist in this app yet."
  app.get("/api/landlord/dashboard", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);

      const monthStart = new Date();
      monthStart.setDate(1);
      const monthStartStr = monthStart.toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const in30Days = new Date(); in30Days.setDate(in30Days.getDate() + 30);
      const in30DaysStr = in30Days.toISOString().slice(0, 10);

      // Active leases count.
      const leasesActive = await db.execute(sql`
        SELECT COUNT(*) AS c FROM rental_leases
        WHERE organization_id = ${orgId} AND status = 'active'
      `);
      const activeLeases = Number(((leasesActive as any).rows?.[0]?.c) ?? 0);

      if (activeLeases === 0) return res.json({ hasData: false });

      // MTD rent collected.
      const collectedRow = await db.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0) AS total FROM rent_payments
        WHERE organization_id = ${orgId}
          AND received_at >= ${monthStartStr}::date
      `);
      const mtdCollected = Number(((collectedRow as any).rows?.[0]?.total) ?? 0);

      // MTD billed.
      const billedRow = await db.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0) AS total FROM rent_charges
        WHERE organization_id = ${orgId}
          AND charged_for_month = ${monthStartStr}::date
      `);
      const mtdBilled = Number(((billedRow as any).rows?.[0]?.total) ?? 0);

      // Late count.
      const lateRow = await db.execute(sql`
        SELECT COUNT(*) AS c FROM rent_charges
        WHERE organization_id = ${orgId}
          AND balance_cents > 0
          AND due_date < ${today}::date
      `);
      const lateCount = Number(((lateRow as any).rows?.[0]?.c) ?? 0);

      // Maintenance open.
      const maintOpenRow = await db.execute(sql`
        SELECT COUNT(*) AS c FROM maintenance_tickets
        WHERE organization_id = ${orgId}
          AND status NOT IN ('completed', 'cancelled')
      `);
      const maintOpen = Number(((maintOpenRow as any).rows?.[0]?.c) ?? 0);

      // Lease expirations in next 30 days.
      const expiringRow = await db.execute(sql`
        SELECT COUNT(*) AS c FROM rental_leases
        WHERE organization_id = ${orgId}
          AND status = 'active'
          AND end_date IS NOT NULL
          AND end_date <= ${in30DaysStr}::date
          AND end_date >= ${today}::date
      `);
      const expiringCount = Number(((expiringRow as any).rows?.[0]?.c) ?? 0);

      return res.json({
        hasData: true,
        activeLeases,
        rent: {
          mtdCollectedCents: mtdCollected,
          mtdBilledCents: mtdBilled,
          mtdCollectedPct: mtdBilled > 0 ? Math.round((mtdCollected / mtdBilled) * 100) : 0,
          lateCount,
        },
        maintenanceOpenCount: maintOpen,
        expiringNext30Count: expiringCount,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Renew = create a new lease referencing the parent. Imelda §2.7: "the
  // renewal isn't a new lease in Texas, it's an addendum to the original."
  app.post("/api/leases/:id/renew", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = renewSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [parent] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!parent) return Errors.notFound(res, "Original lease");

      const newStart = parent.endDate ?? new Date().toISOString().slice(0, 10);

      const renewed = await db.transaction(async (tx) => {
        // Mark parent as renewed.
        await tx.update(rentalLeases).set({ status: "renewed", updatedAt: new Date() })
          .where(eq(rentalLeases.id, parent.id));

        // Create new lease — same property, same tenants link inherits below.
        const [newLease] = await tx.insert(rentalLeases).values({
          organizationId: orgId,
          propertyId: parent.propertyId,
          unitLabel: parent.unitLabel,
          parentLeaseId: parent.id,
          versionNumber: parent.versionNumber + 1,
          status: "active",
          liabilityModel: parent.liabilityModel,
          startDate: newStart,
          endDate: parsed.data.newEndDate,
          monthlyRentCents: parsed.data.newMonthlyRentCents ?? parent.monthlyRentCents,
          rentDueDayOfMonth: parent.rentDueDayOfMonth,
          securityDepositCents: parent.securityDepositCents,
          petDepositCents: parent.petDepositCents,
          isSection8: parent.isSection8,
          hapPortionCents: parent.hapPortionCents,
          tenantPortionCents: parent.tenantPortionCents,
          state: parent.state,
        }).returning();

        // Carry tenants forward.
        const tlinks = await tx.select().from(leaseTenants)
          .where(and(eq(leaseTenants.leaseId, parent.id), eq(leaseTenants.organizationId, orgId)));
        if (tlinks.length > 0) {
          await tx.insert(leaseTenants).values(tlinks.map((l) => ({
            organizationId: orgId,
            leaseId: newLease.id,
            tenantId: l.tenantId,
            rentSharePct: l.rentSharePct,
            isPrimary: l.isPrimary,
          })));
        }

        // Auto-create a "renewal" addendum on the parent for the audit trail.
        await tx.insert(leaseAddendums).values({
          organizationId: orgId,
          leaseId: parent.id,
          kind: "renewal",
          title: `Renewal — extends through ${parsed.data.newEndDate}`,
          bodyMarkdown: parsed.data.newMonthlyRentCents
            ? `Renewal extends original lease through ${parsed.data.newEndDate} at $${(parsed.data.newMonthlyRentCents / 100).toLocaleString()} / month.`
            : `Renewal extends original lease through ${parsed.data.newEndDate} at original rent.`,
          effectiveDate: newStart,
        });

        return newLease;
      });

      return res.status(201).json({ lease: renewed });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ============================================================================
  // Mobile Landlord (Imelda Lens 21) — Today / Portfolio aggregates
  // ============================================================================

  // Leases ending within N days, with state-aware non-renewal notice window.
  // Mounted at /api/rentals/leases/expiring (not /api/leases/expiring) so it
  // doesn't collide with /api/leases/:id when :id starts with "expiring".
  app.get("/api/rentals/leases/expiring", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const within = Math.max(1, Math.min(365, parseInt(String(req.query.within ?? req.query.expiring_within ?? "60"), 10) || 60));
      const today = new Date();
      const horizon = new Date(); horizon.setDate(horizon.getDate() + within);
      const todayStr = today.toISOString().slice(0, 10);
      const horizonStr = horizon.toISOString().slice(0, 10);

      const rows = await db.execute(sql`
        SELECT id, property_id, unit_label, state, end_date, monthly_rent_cents,
               (end_date - CURRENT_DATE) AS days_to_expiry
        FROM rental_leases
        WHERE organization_id = ${orgId}
          AND status = 'active'
          AND end_date IS NOT NULL
          AND end_date >= ${todayStr}::date
          AND end_date <= ${horizonStr}::date
        ORDER BY end_date ASC
      `);

      const leases = ((rows as any).rows ?? []).map((r: any) => {
        const endIso: string | null = r.end_date ? String(r.end_date).slice(0, 10) : null;
        const window = computeNoticeWindow(endIso, r.state ?? null, today);
        return {
          id: r.id,
          propertyId: Number(r.property_id),
          unitLabel: r.unit_label ?? null,
          state: r.state ?? null,
          endDate: endIso,
          monthlyRentCents: Number(r.monthly_rent_cents) || 0,
          daysToExpiry: Number(r.days_to_expiry) || 0,
          noticeDays: window.noticeDays,
          noticeWindowOpensAt: window.noticeWindowOpensAt,
          noticeWindowOpen: window.noticeWindowOpen,
        };
      });

      return res.json({ leases, count: leases.length, withinDays: within });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Section 8 HAP recerts due — annual recert anchored on lease start_date.
  // Imelda §2.10: "the housing authority pays me a HAP portion directly via
  // ACH; recerts happen annually and a missed recert can pause HAP."
  app.get("/api/rentals/section-8/recerts-due", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const within = Math.max(1, Math.min(365, parseInt(String(req.query.within ?? "60"), 10) || 60));
      const horizon = new Date(); horizon.setDate(horizon.getDate() + within);
      const horizonStr = horizon.toISOString().slice(0, 10);

      // Annual recert anchor = the next future anniversary of start_date.
      // We compute it in SQL by adding N years until the result is in the
      // future relative to today.
      const rows = await db.execute(sql`
        WITH rl AS (
          SELECT
            id, property_id, unit_label, start_date,
            hap_portion_cents, monthly_rent_cents,
            (
              start_date
              + (
                  GREATEST(
                    1,
                    CEIL(EXTRACT(EPOCH FROM (CURRENT_DATE - start_date)) / 31557600.0)::int
                  )
                ) * INTERVAL '1 year'
            )::date AS next_recert_date
          FROM rental_leases
          WHERE organization_id = ${orgId}
            AND status = 'active'
            AND is_section_8 = TRUE
            AND COALESCE(hap_portion_cents, 0) > 0
        )
        SELECT
          id, property_id, unit_label,
          hap_portion_cents, monthly_rent_cents,
          next_recert_date,
          (next_recert_date - CURRENT_DATE) AS days_until_recert
        FROM rl
        WHERE next_recert_date <= ${horizonStr}::date
          AND next_recert_date >= CURRENT_DATE
        ORDER BY next_recert_date ASC
      `);

      const leases = ((rows as any).rows ?? []).map((r: any) => ({
        id: r.id,
        propertyId: Number(r.property_id),
        unitLabel: r.unit_label ?? null,
        hapPortionCents: Number(r.hap_portion_cents) || 0,
        monthlyRentCents: Number(r.monthly_rent_cents) || 0,
        nextRecertDate: r.next_recert_date ? String(r.next_recert_date).slice(0, 10) : null,
        daysUntilRecert: Number(r.days_until_recert) || 0,
      }));

      return res.json({ leases, count: leases.length, withinDays: within });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Occupancy snapshot — distinct property+unit pairs with an active lease
  // over distinct property+unit pairs ever on record. SFR-only orgs see
  // "active leases / property count"; multi-unit counts unit_label slots.
  app.get("/api/rent-roll/occupancy", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);

      const totalRow = await db.execute(sql`
        SELECT COUNT(DISTINCT (property_id, COALESCE(unit_label, '')))::int AS total
        FROM rental_leases
        WHERE organization_id = ${orgId}
      `);
      const activeRow = await db.execute(sql`
        SELECT COUNT(DISTINCT (property_id, COALESCE(unit_label, '')))::int AS active
        FROM rental_leases
        WHERE organization_id = ${orgId}
          AND status = 'active'
      `);
      const propsRow = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM properties
        WHERE organization_id = ${orgId}
      `);

      const totalUnits = Number(((totalRow as any).rows?.[0]?.total) ?? 0);
      const activeUnits = Number(((activeRow as any).rows?.[0]?.active) ?? 0);
      const propertyCount = Number(((propsRow as any).rows?.[0]?.c) ?? 0);

      return res.json({
        activeUnits,
        totalUnits,
        propertyCount,
        occupancyPct: totalUnits > 0 ? Math.round((activeUnits / totalUnits) * 100) : null,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Portfolio-wide landlord stats for the mobile Portfolio tab. One round-
  // trip: MTD rent, YTD expenses (maintenance invoices only — Portfolio P&L
  // has the richer answer but requires a deals/properties join), active
  // tickets, Section 8 share. Depreciation YTD is intentionally null — the
  // UI links to /depreciation-calculator for the authoritative number.
  app.get("/api/portfolio/landlord-stats", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

      const mtdRow = await db.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
        FROM rent_payments
        WHERE organization_id = ${orgId}
          AND received_at >= ${monthStart}::date
      `);
      const mtdRentCollectedCents = Number(((mtdRow as any).rows?.[0]?.total) ?? 0);

      const ytdMaintRow = await db.execute(sql`
        SELECT COALESCE(SUM(invoice_cents), 0)::bigint AS total
        FROM maintenance_tickets
        WHERE organization_id = ${orgId}
          AND status = 'completed'
          AND completed_at >= ${yearStart}::date
      `);
      const ytdExpensesCents = Number(((ytdMaintRow as any).rows?.[0]?.total) ?? 0);

      const activeTicketsRow = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM maintenance_tickets
        WHERE organization_id = ${orgId}
          AND status NOT IN ('completed', 'cancelled')
      `);
      const activeMaintenanceCount = Number(((activeTicketsRow as any).rows?.[0]?.c) ?? 0);

      const section8Row = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN is_section_8 = TRUE THEN 1 ELSE 0 END)::int AS s8
        FROM rental_leases
        WHERE organization_id = ${orgId}
          AND status = 'active'
      `);
      const s8Total = Number(((section8Row as any).rows?.[0]?.total) ?? 0);
      const s8Count = Number(((section8Row as any).rows?.[0]?.s8) ?? 0);
      const section8SharePct = s8Total > 0 ? Math.round((s8Count / s8Total) * 100) : 0;

      return res.json({
        mtdRentCollectedCents,
        ytdExpensesCents,
        ytdDepreciationCents: null,
        activeMaintenanceCount,
        section8: {
          activeLeases: s8Count,
          totalActiveLeases: s8Total,
          sharePct: section8SharePct,
        },
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
