/**
 * Buy-and-hold vertical BH-5 — rent-roll uploader on /parcels/:id.
 *
 * Imelda §8.2 (what I'd build first, item 2): "When I'm evaluating a
 * 6-plex, I get a rent roll PDF or CSV from the seller. Drop it in.
 * AcreOS parses it, shows me current tenants by unit, current rent,
 * lease end dates, and computes a rough NOI. […] this is the moment a
 * landlord-buyer says 'oh, this thing gets it.'"
 *
 *   POST /api/parcels/:id/rent-roll/preview   — preview NOI without writing
 *   POST /api/parcels/:id/rent-roll/import    — create tenants+leases+charges
 *
 * Input shape (CSV-parsed client-side, posted as JSON):
 *   {
 *     state: "TX",
 *     monthlyOpExpenseEstimateCents?: number,
 *     vacancyRate?: number,
 *     units: [
 *       { unit: "1A", tenantFirst: "Maria", tenantLast: "Lopez",
 *         email?, phone?, rentCents: 140000, leaseEnd: "2026-08-31" },
 *       ...
 *     ]
 *   }
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import {
  tenants,
  rentalLeases,
  leaseTenants,
  rentCharges,
  properties,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const unitSchema = z.object({
  unit: z.string().min(1).max(64),
  tenantFirst: z.string().optional(),
  tenantLast: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  rentCents: z.coerce.number().int().nonnegative(),
  securityDepositCents: z.coerce.number().int().nonnegative().optional(),
  leaseStart: z.string().optional(),
  leaseEnd: z.string().optional(),
  isVacant: z.boolean().default(false),
});

const rentRollSchema = z.object({
  state: z.string().length(2),
  monthlyOpExpenseEstimateCents: z.coerce.number().int().nonnegative().optional(),
  vacancyRate: z.coerce.number().min(0).max(1).optional(),  // 0.05 = 5%
  units: z.array(unitSchema).min(1).max(200),
});

interface NoiSnapshot {
  unitCount: number;
  occupiedCount: number;
  vacantCount: number;
  grossPotentialRentMonthlyCents: number;
  collectedRentMonthlyCents: number;
  vacancyAdjMonthlyCents: number;
  opExpenseMonthlyCents: number;
  noiMonthlyCents: number;
  noiAnnualCents: number;
  capRateAtAskingPct: number | null;
}

function computeNoi(parsed: z.infer<typeof rentRollSchema>, askingPriceCents: number | null): NoiSnapshot {
  const occupied = parsed.units.filter((u) => !u.isVacant);
  const grossPotential = parsed.units.reduce((s, u) => s + u.rentCents, 0);
  const collected = occupied.reduce((s, u) => s + u.rentCents, 0);
  const vacancyAdj = parsed.vacancyRate !== undefined
    ? Math.round(grossPotential * parsed.vacancyRate)
    : grossPotential - collected;
  const opex = parsed.monthlyOpExpenseEstimateCents ?? Math.round(collected * 0.40);  // Imelda: ~40% rule of thumb
  const noiMonthly = collected - vacancyAdj - opex;
  const noiAnnual = noiMonthly * 12;
  const capRate = askingPriceCents && askingPriceCents > 0
    ? noiAnnual / askingPriceCents
    : null;
  return {
    unitCount: parsed.units.length,
    occupiedCount: occupied.length,
    vacantCount: parsed.units.length - occupied.length,
    grossPotentialRentMonthlyCents: grossPotential,
    collectedRentMonthlyCents: collected,
    vacancyAdjMonthlyCents: vacancyAdj,
    opExpenseMonthlyCents: opex,
    noiMonthlyCents: noiMonthly,
    noiAnnualCents: noiAnnual,
    capRateAtAskingPct: capRate !== null ? Math.round(capRate * 10000) / 100 : null,  // pct, 2dp
  };
}

export function registerRentRollImportRoutes(app: Express): void {
  app.post("/api/parcels/:id/rent-roll/preview", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const propId = parseInt(req.params.id, 10);
      const parsed = rentRollSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db.select({
        id: properties.id, listPrice: properties.listPrice, marketValue: properties.marketValue,
      }).from(properties)
        .where(and(eq(properties.id, propId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Parcel");

      const askingCents = prop.listPrice
        ? Math.round(parseFloat(prop.listPrice) * 100)
        : prop.marketValue
          ? Math.round(parseFloat(prop.marketValue) * 100)
          : null;

      const noi = computeNoi(parsed.data, askingCents);
      return res.json({ noi, units: parsed.data.units });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/parcels/:id/rent-roll/import", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const propId = parseInt(req.params.id, 10);
      const parsed = rentRollSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db.select().from(properties)
        .where(and(eq(properties.id, propId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Parcel");

      const summary = await db.transaction(async (tx) => {
        let createdTenants = 0;
        let createdLeases = 0;
        let createdCharges = 0;

        for (const u of parsed.data.units) {
          if (u.isVacant) continue;
          if (!u.tenantFirst && !u.tenantLast) continue;  // skip rows without tenant identity

          const [tenant] = await tx.insert(tenants).values({
            organizationId: orgId,
            firstName: u.tenantFirst ?? "(unknown)",
            lastName: u.tenantLast ?? "(unknown)",
            email: u.email || null,
            phone: u.phone ?? null,
            status: "active",
            sourceChannel: "rent_roll_import",
          }).returning();
          createdTenants++;

          const startDate = u.leaseStart ?? new Date().toISOString().slice(0, 10);
          const [lease] = await tx.insert(rentalLeases).values({
            organizationId: orgId,
            propertyId: propId,
            unitLabel: u.unit,
            status: "active",
            liabilityModel: "joint_and_several",
            startDate,
            endDate: u.leaseEnd ?? null,
            monthlyRentCents: u.rentCents,
            rentDueDayOfMonth: 1,
            securityDepositCents: u.securityDepositCents ?? 0,
            petDepositCents: 0,
            isSection8: false,
            state: parsed.data.state.toUpperCase(),
            notes: "Imported from seller's rent roll at acquisition.",
          }).returning();
          createdLeases++;

          await tx.insert(leaseTenants).values({
            organizationId: orgId,
            leaseId: lease.id,
            tenantId: tenant.id,
            rentSharePct: "1",
            isPrimary: true,
          });

          // Seed the current-month rent charge so the ledger isn't empty.
          const month = new Date();
          const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
          await tx.insert(rentCharges).values({
            organizationId: orgId,
            leaseId: lease.id,
            chargedForMonth: monthStart.toISOString().slice(0, 10),
            dueDate: monthStart.toISOString().slice(0, 10),
            amountCents: u.rentCents,
            paidCents: 0,
            balanceCents: u.rentCents,
          }).onConflictDoNothing();
          createdCharges++;
        }

        return { createdTenants, createdLeases, createdCharges };
      });

      const askingCents = prop.listPrice
        ? Math.round(parseFloat(prop.listPrice) * 100)
        : prop.marketValue
          ? Math.round(parseFloat(prop.marketValue) * 100)
          : null;
      const noi = computeNoi(parsed.data, askingCents);

      logger.info("[BH-5] rent roll imported", { orgId, userId, propId, ...summary });
      return res.status(201).json({ ...summary, noi });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
