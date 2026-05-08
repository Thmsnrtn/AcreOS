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
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

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
      const parsed = tenantUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      // FCRA adverse-action stamp when status flips to denied.
      if (parsed.data.status === "denied") {
        updates.adverseActionNoticeSentAt = new Date();
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
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

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
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

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
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

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
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

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

  // Renew = create a new lease referencing the parent. Imelda §2.7: "the
  // renewal isn't a new lease in Texas, it's an addendum to the original."
  app.post("/api/leases/:id/renew", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = renewSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

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
}
