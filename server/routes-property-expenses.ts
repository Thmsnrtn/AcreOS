/**
 * Property expenses — the operating-cost ledger (Wave 3, multifamily → core).
 *
 * NOI needs two axes: income (rent, held by the rent ledger) and operating
 * EXPENSE, which had no store. So NOI was ASSUMED — a flat ~40%-of-rent guess.
 * `property_expenses` (shared/schema/rental.ts) replaces the guess with what the
 * operator actually spent. This file is the WRITE PATH; the NOI wiring that
 * reads these rows is a separate, later stage and is deliberately not here.
 *
 *   POST   /api/properties/:id/expenses                    — record an expense
 *   GET    /api/properties/:id/expenses                    — list (optional date range)
 *   PATCH  /api/rentals/expenses/:id                       — edit
 *   DELETE /api/rentals/expenses/:id                       — delete
 *   POST   /api/properties/:id/expenses/import-maintenance — roll completed
 *                                                            maintenance invoices in
 *
 * These hang off the EXISTING property + rentals surfaces (no new top-level nav
 * — a standing founder hard-stop). The expenses UI is a TAB on /leases, behind
 * the Rentals module.
 *
 * MONEY POSTURE (founder ruling "be the rail, not the provider"): this is a
 * LEDGER of money the operator ALREADY spent, on their own account, elsewhere.
 * Nothing here moves, holds, collects or charges a cent. `amountCents` is a
 * recorded fact, not a balance and not an instruction to pay. Every surface must
 * read as "record what you spent", never "we'll pay it".
 *
 * `isOperating` is DERIVED SERVER-SIDE from isOperatingCategory(category) on
 * every write and is never accepted from the client — a client cannot slip a
 * financing cost (mortgage_interest) or a non-cash allowance (depreciation) into
 * the operating number that NOI is built from.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, gte, lte, desc, isNotNull, gt } from "drizzle-orm";
import { db } from "./db";
import {
  properties,
  propertyExpenses,
  rentalUnits,
  maintenanceTickets,
} from "@shared/schema";
import {
  PROPERTY_EXPENSE_CATEGORIES,
  isOperatingCategory,
} from "@shared/rental/propertyExpense";
import { buildBulkCreateReport } from "@shared/rental/unitInventory";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

/** A calendar day the operator asserts — YYYY-MM-DD, and a real date. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), "Not a real date");

// `isOperating` is DELIBERATELY absent from this schema. It is derived from the
// category server-side; accepting it from the client would let a caller post a
// financing cost as an operating expense. Exported so tests/unit exercises the
// REAL validator (no drift between a test-local mirror and the route).
export const expenseCreateSchema = z.object({
  category: z.enum(PROPERTY_EXPENSE_CATEGORIES),
  amountCents: z.coerce.number().int().nonnegative().max(1_000_000_000_00),
  incurredOn: isoDate,
  unitId: z.string().trim().min(1).optional(),
  vendor: z.string().trim().max(200).optional(),
  description: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

// Edit: every field optional (category flips isOperating with it), but the row's
// property/org/source/sourceRef are immovable — a rolled-in maintenance expense
// cannot be re-pointed at a different ticket from here.
const expenseUpdateSchema = z.object({
  category: z.enum(PROPERTY_EXPENSE_CATEGORIES).optional(),
  amountCents: z.coerce.number().int().nonnegative().max(1_000_000_000_00).optional(),
  incurredOn: isoDate.optional(),
  unitId: z.string().trim().min(1).nullable().optional(),
  vendor: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const importMaintenanceSchema = z.object({
  // The window of completed tickets to roll in, by completion date. Both
  // inclusive; both optional (omit for "all completed, invoiced tickets").
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Confirm the property exists AND belongs to this org. Returns its id, or null
 * — the caller turns null into a 404 so a cross-tenant property id can never
 * leak a row or accept a write.
 */
async function ownedPropertyId(orgId: number, rawPropertyId: string): Promise<number | null> {
  const propertyId = Number.parseInt(rawPropertyId, 10);
  if (!Number.isFinite(propertyId)) return null;
  const [prop] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)));
  return prop ? propertyId : null;
}

/**
 * If the caller attached the expense to a unit, that unit must exist, belong to
 * this org, and sit on THIS property. Returns "ok" | "not_found" | "wrong_property".
 * A unit from another building would misattribute the spend on the property P&L.
 */
async function validateUnit(
  orgId: number,
  propertyId: number,
  unitId: string,
): Promise<"ok" | "not_found" | "wrong_property"> {
  const [unit] = await db
    .select({ id: rentalUnits.id, propertyId: rentalUnits.propertyId })
    .from(rentalUnits)
    .where(and(eq(rentalUnits.id, unitId), eq(rentalUnits.organizationId, orgId)));
  if (!unit) return "not_found";
  if (unit.propertyId !== propertyId) return "wrong_property";
  return "ok";
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

export function registerPropertyExpenseRoutes(app: Express): void {
  // ── Create ────────────────────────────────────────────────────────────────
  app.post("/api/properties/:id/expenses", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);

      const propertyId = await ownedPropertyId(orgId, req.params.id);
      if (propertyId === null) return Errors.notFound(res, "Property");

      const parsed = expenseCreateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      if (parsed.data.unitId) {
        const unitCheck = await validateUnit(orgId, propertyId, parsed.data.unitId);
        if (unitCheck === "not_found") return Errors.notFound(res, "Rental unit");
        if (unitCheck === "wrong_property") {
          return Errors.badRequest(res, "That unit belongs to a different property. An expense is filed against the building the unit is in.", {
            code: "PROPERTY_EXPENSE_UNIT_MISMATCH",
          });
        }
      }

      // The operating flag is the category's, not the client's.
      const isOperating = isOperatingCategory(parsed.data.category);

      const [created] = await db.insert(propertyExpenses).values({
        organizationId: orgId,
        propertyId,
        unitId: parsed.data.unitId ?? null,
        category: parsed.data.category,
        amountCents: parsed.data.amountCents,
        incurredOn: parsed.data.incurredOn,
        isOperating,
        source: "manual",
        sourceRef: null,
        vendor: parsed.data.vendor ?? null,
        description: parsed.data.description ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();

      logger.info("[W3] property expense created", {
        orgId, userId, propertyId, expenseId: created.id, category: created.category, isOperating,
      });
      return res.json({ expense: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── List ──────────────────────────────────────────────────────────────────
  app.get("/api/properties/:id/expenses", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);

      const propertyId = await ownedPropertyId(orgId, req.params.id);
      if (propertyId === null) return Errors.notFound(res, "Property");

      // Optional [from, to] window on incurredOn. A malformed date is a client
      // error, not a silently-ignored filter.
      const rangeParse = z.object({ from: isoDate.optional(), to: isoDate.optional() })
        .safeParse({ from: req.query.from, to: req.query.to });
      if (!rangeParse.success) return Errors.validationFailed(res, rangeParse.error.issues);

      const conditions = [
        eq(propertyExpenses.organizationId, orgId),
        eq(propertyExpenses.propertyId, propertyId),
      ];
      if (rangeParse.data.from) conditions.push(gte(propertyExpenses.incurredOn, rangeParse.data.from));
      if (rangeParse.data.to) conditions.push(lte(propertyExpenses.incurredOn, rangeParse.data.to));

      const rows = await db.select().from(propertyExpenses)
        .where(and(...conditions))
        .orderBy(desc(propertyExpenses.incurredOn), desc(propertyExpenses.createdAt));

      return res.json({ expenses: rows, count: rows.length });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Edit ────────────────────────────────────────────────────────────────
  app.patch("/api/rentals/expenses/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);

      const parsed = expenseUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // Read the current row first: the unit-belongs-to-this-property check and
      // the category→isOperating derivation both need the row's propertyId.
      const [existing] = await db.select().from(propertyExpenses)
        .where(and(eq(propertyExpenses.id, req.params.id), eq(propertyExpenses.organizationId, orgId)));
      if (!existing) return Errors.notFound(res, "Expense");

      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (parsed.data.category !== undefined) {
        updates.category = parsed.data.category;
        // Re-derive the operating flag whenever the category moves — it is never
        // set independently of the category it describes.
        updates.isOperating = isOperatingCategory(parsed.data.category);
      }
      if (parsed.data.amountCents !== undefined) updates.amountCents = parsed.data.amountCents;
      if (parsed.data.incurredOn !== undefined) updates.incurredOn = parsed.data.incurredOn;
      if (parsed.data.unitId !== undefined) {
        if (parsed.data.unitId === null) {
          updates.unitId = null;
        } else {
          const unitCheck = await validateUnit(orgId, existing.propertyId, parsed.data.unitId);
          if (unitCheck === "not_found") return Errors.notFound(res, "Rental unit");
          if (unitCheck === "wrong_property") {
            return Errors.badRequest(res, "That unit belongs to a different property.", {
              code: "PROPERTY_EXPENSE_UNIT_MISMATCH",
            });
          }
          updates.unitId = parsed.data.unitId;
        }
      }
      if (parsed.data.vendor !== undefined) updates.vendor = parsed.data.vendor;
      if (parsed.data.description !== undefined) updates.description = parsed.data.description;
      if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

      const [updated] = await db.update(propertyExpenses).set(updates)
        .where(and(eq(propertyExpenses.id, req.params.id), eq(propertyExpenses.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Expense");

      logger.info("[W3] property expense updated", { orgId, userId, expenseId: updated.id });
      return res.json({ expense: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Delete ──────────────────────────────────────────────────────────────
  app.delete("/api/rentals/expenses/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);

      const [deleted] = await db.delete(propertyExpenses)
        .where(and(eq(propertyExpenses.id, req.params.id), eq(propertyExpenses.organizationId, orgId)))
        .returning({ id: propertyExpenses.id });
      if (!deleted) return Errors.notFound(res, "Expense");

      logger.info("[W3] property expense deleted", { orgId, userId, expenseId: deleted.id });
      return res.json({ deleted: true, id: deleted.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Roll completed maintenance invoices into the ledger ────────────────────
  // A completed maintenance ticket carries an invoice; that money is a repair
  // expense but lives on the tickets table, invisible to NOI. This promotes each
  // invoiced, completed ticket into a property_expenses row (category 'repairs',
  // source 'maintenance_invoice', sourceRef = ticket.id).
  //
  // IDEMPOTENT BY CONSTRUCTION. The partial UNIQUE (org, source, source_ref)
  // absorbs a re-run via onConflictDoNothing, so a second roll-in of the same
  // window writes nothing new. Like the unit bulk-create, it reports created vs
  // existed (by ticket id) so a re-run reads as "0 new" rather than as a fresh
  // import — an operator must never come to believe the same repair was spent
  // twice.
  app.post("/api/properties/:id/expenses/import-maintenance", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);

      const propertyId = await ownedPropertyId(orgId, req.params.id);
      if (propertyId === null) return Errors.notFound(res, "Property");

      const parsed = importMaintenanceSchema.safeParse(req.body ?? {});
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // Completed, actually-invoiced tickets on this property. `invoiceCents > 0`
      // excludes a completed ticket that closed with no cost — a $0 expense is
      // not money spent, and posting it would be noise on the P&L.
      const conditions = [
        eq(maintenanceTickets.organizationId, orgId),
        eq(maintenanceTickets.propertyId, propertyId),
        eq(maintenanceTickets.status, "completed"),
        isNotNull(maintenanceTickets.invoiceCents),
        gt(maintenanceTickets.invoiceCents, 0),
      ];
      if (parsed.data.from) conditions.push(gte(maintenanceTickets.completedAt, new Date(`${parsed.data.from}T00:00:00Z`)));
      if (parsed.data.to) conditions.push(lte(maintenanceTickets.completedAt, new Date(`${parsed.data.to}T23:59:59Z`)));

      const tickets = await db.select({
        id: maintenanceTickets.id,
        title: maintenanceTickets.title,
        invoiceCents: maintenanceTickets.invoiceCents,
        completedAt: maintenanceTickets.completedAt,
        submittedAt: maintenanceTickets.submittedAt,
      }).from(maintenanceTickets).where(and(...conditions));

      const attempted = tickets.map((t) => t.id);

      if (attempted.length === 0) {
        // Nothing to attempt is a result, not an error — report the empty shape
        // so the client renders "0 new / 0 already there" uniformly.
        return res.json({
          propertyId,
          ...buildBulkCreateReport([], []),
        });
      }

      // 'repairs' is an operating category, so isOperating is true for every
      // rolled row. Derived through the same predicate as manual entry rather
      // than hardcoded, so it cannot drift if 'repairs' is ever reclassified.
      const isOperating = isOperatingCategory("repairs");

      const inserted = await db.insert(propertyExpenses).values(
        tickets.map((t) => {
          const when = t.completedAt ?? t.submittedAt ?? new Date();
          return {
            organizationId: orgId,
            propertyId,
            unitId: null,
            category: "repairs" as const,
            amountCents: t.invoiceCents as number,
            incurredOn: when.toISOString().slice(0, 10),
            isOperating,
            source: "maintenance_invoice" as const,
            sourceRef: t.id,
            description: t.title,
            vendor: null,
            notes: null,
          };
        }),
      ).onConflictDoNothing().returning({ sourceRef: propertyExpenses.sourceRef });

      const createdRefs = inserted
        .map((r) => r.sourceRef)
        .filter((r): r is string => r !== null);

      const report = buildBulkCreateReport(attempted, createdRefs);

      logger.info("[W3] maintenance invoices rolled into expense ledger", {
        orgId, userId, propertyId,
        attempted: report.attemptedCount,
        created: report.createdCount,
        existed: report.existedCount,
      });

      return res.json({ propertyId, ...report });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
