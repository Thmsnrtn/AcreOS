/**
 * Buy-and-hold vertical BH-6 — maintenance ticketing.
 *
 * Imelda §2.8: "Buildium has a tenant portal where my tenant submits a
 * leaky disposal with a photo, it routes to me, I dispatch to my plumber
 * Roberto, Roberto closes the ticket with an invoice, the invoice posts
 * to that property's expense ledger. That's a four-actor workflow
 * (tenant, landlord, vendor, accountant). AcreOS has none of those
 * actors except landlord."
 *
 * FF-3 already shipped contractors (vendor entity + W-9 + 1099-NEC), so
 * BH-6 reuses that table as the vendor side.
 *
 *   GET    /api/maintenance-tickets             — list w/ filter
 *   GET    /api/maintenance-tickets/:id         — single
 *   POST   /api/maintenance-tickets             — create (landlord-side)
 *   PATCH  /api/maintenance-tickets/:id         — update status/severity/notes
 *   POST   /api/maintenance-tickets/:id/dispatch — assign to a contractor
 *   POST   /api/maintenance-tickets/:id/complete — mark done w/ invoice
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  maintenanceTickets,
  contractors,
  properties,
  TICKET_STATUSES,
  TICKET_SEVERITIES,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
// Audit Wave 1 (buy_and_hold beta→core): the maintenance-triage template never
// ran because nothing emitted maintenance.request_received. This POST is the one
// create path, so it is the emit seam. Fire-and-forget — see rentalEvents.ts.
import { emitMaintenanceRequestReceived } from "./services/rentalEvents";

const ticketSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  leaseId: z.string().uuid().optional(),
  submittedByTenantId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().optional(),  // 'plumbing' | 'hvac' | etc — free-form for now
  severity: z.enum(TICKET_SEVERITIES).default("standard"),
});

const updateSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  severity: z.enum(TICKET_SEVERITIES).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  repairNotes: z.string().optional(),
});

const dispatchSchema = z.object({
  contractorId: z.string().uuid(),
});

const completeSchema = z.object({
  repairNotes: z.string().optional(),
  invoiceCents: z.coerce.number().int().nonnegative().optional(),
  invoicePaidAt: z.string().optional(),
});

export function registerMaintenanceTicketRoutes(app: Express): void {
  app.get("/api/maintenance-tickets", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const propertyId = req.query.propertyId ? parseInt(String(req.query.propertyId), 10) : null;
      const conditions = [eq(maintenanceTickets.organizationId, orgId)];
      if (status) conditions.push(eq(maintenanceTickets.status, status as any));
      if (propertyId) conditions.push(eq(maintenanceTickets.propertyId, propertyId));
      const rows = await db.select().from(maintenanceTickets).where(and(...conditions))
        .orderBy(desc(maintenanceTickets.submittedAt));
      return res.json({ tickets: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/maintenance-tickets/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [t] = await db.select().from(maintenanceTickets)
        .where(and(eq(maintenanceTickets.id, req.params.id), eq(maintenanceTickets.organizationId, orgId)));
      if (!t) return Errors.notFound(res, "Ticket");

      // SEC (2026-09-04): scoped to the org. The parent ticket is
      // ownership-checked, but `assignedContractorId` is not a value this
      // server derived — the dispatch route below wrote it straight from a
      // request body, and `assigned_contractor_id` is a SOFT FK
      // (shared/schema/rental.ts) so Postgres accepts a contractor belonging
      // to any tenant. Without this predicate, dispatching to another org's
      // contractor id made this route return that contractor's name, business
      // name, email, phone and trades. "The parent was checked" only carries
      // to a child whose KEY the platform also chose.
      let assignedContractor = null;
      if (t.assignedContractorId) {
        const [c] = await db.select({
          id: contractors.id, name: contractors.name, businessName: contractors.businessName,
          email: contractors.email, phone: contractors.phone, trades: contractors.trades,
        }).from(contractors).where(and(
          eq(contractors.id, t.assignedContractorId),
          eq(contractors.organizationId, orgId),
        ));
        assignedContractor = c ?? null;
      }
      return res.json({ ticket: t, assignedContractor });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/maintenance-tickets", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = ticketSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [created] = await db.insert(maintenanceTickets).values({
        organizationId: orgId,
        propertyId: parsed.data.propertyId,
        leaseId: parsed.data.leaseId ?? null,
        submittedByTenantId: parsed.data.submittedByTenantId ?? null,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        category: parsed.data.category ?? null,
        severity: parsed.data.severity,
        status: "open",
      }).returning();

      logger.info("[BH-6] maintenance ticket created", { orgId, userId, ticketId: created.id, severity: parsed.data.severity });

      // Audit Wave 1 (buy_and_hold beta→core) — maintenance.request_received. The
      // ticket row is committed; fire the triage template's event. Fire-and-forget:
      // rentalEvents resolves property/tenant/org off the request path and a
      // workflow fault never fails the create. A landlord-logged ticket (no
      // submittedByTenantId) resolves a null tenant, which honestly suppresses the
      // tenant-acknowledgment email rather than fabricating a recipient.
      emitMaintenanceRequestReceived(created);

      return res.status(201).json({ ticket: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/maintenance-tickets/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      // Status transitions stamp timestamps.
      if (parsed.data.status === "triaging") updates.triagedAt = new Date();
      if (parsed.data.status === "completed") updates.completedAt = new Date();

      const [updated] = await db.update(maintenanceTickets).set(updates)
        .where(and(eq(maintenanceTickets.id, req.params.id), eq(maintenanceTickets.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Ticket");
      return res.json({ ticket: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/maintenance-tickets/:id/dispatch", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = dispatchSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // SEC (2026-09-04): a body-supplied FK must be in the caller's tenant.
      // `contractorId` arrives from the request and was stored with no check
      // at all; `assigned_contractor_id` is a soft FK, so the database will
      // not catch it either. Storing another org's contractor id then made
      // GET /api/maintenance-tickets/:id disclose that contractor's contact
      // details. Same rule, same reason as the rehab-line-item check in
      // routes-contractors.ts.
      const [contractor] = await db
        .select({ id: contractors.id })
        .from(contractors)
        .where(and(
          eq(contractors.id, parsed.data.contractorId),
          eq(contractors.organizationId, orgId),
        ))
        .limit(1);
      if (!contractor) return Errors.notFound(res, "Contractor");

      const [updated] = await db.update(maintenanceTickets).set({
        assignedContractorId: parsed.data.contractorId,
        status: "dispatched",
        dispatchedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(maintenanceTickets.id, req.params.id),
        eq(maintenanceTickets.organizationId, orgId),
      )).returning();
      if (!updated) return Errors.notFound(res, "Ticket");

      logger.info("[BH-6] ticket dispatched", { orgId, userId, ticketId: updated.id, contractorId: parsed.data.contractorId });
      return res.json({ ticket: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/maintenance-tickets/:id/complete", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = completeSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [updated] = await db.update(maintenanceTickets).set({
        status: "completed",
        completedAt: new Date(),
        repairNotes: parsed.data.repairNotes ?? null,
        invoiceCents: parsed.data.invoiceCents ?? null,
        invoicePaidAt: parsed.data.invoicePaidAt ? new Date(parsed.data.invoicePaidAt) : null,
        updatedAt: new Date(),
      }).where(and(
        eq(maintenanceTickets.id, req.params.id),
        eq(maintenanceTickets.organizationId, orgId),
      )).returning();
      if (!updated) return Errors.notFound(res, "Ticket");

      logger.info("[BH-6] ticket completed", { orgId, userId, ticketId: updated.id, invoiceCents: parsed.data.invoiceCents });
      return res.json({ ticket: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
