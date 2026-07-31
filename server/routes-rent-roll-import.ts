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
 *   POST /api/parcels/:id/rent-roll/import    — create units+tenants+leases+charges
 *
 * The importer persists EVERY row it is given, vacant or not. A rent roll's
 * vacant lines are the building's empty units, and they are precisely the rows
 * /api/rent-roll/occupancy needs in order to report a vacancy at all; dropping
 * them (as this file did until units existed) meant a half-empty building
 * imported as 100% occupied.
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
  rentalUnits,
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
        let createdUnits = 0;
        let existingUnits = 0;
        let createdTenants = 0;
        let createdLeases = 0;
        let createdCharges = 0;

        for (const u of parsed.data.units) {
          // The importer no longer silently drops rows. It used to open this
          // loop with `if (u.isVacant) continue;`, so a vacant unit left NO
          // record anywhere — the seller hands over the building's complete
          // unit list and we threw away exactly the rows that make occupancy
          // real. Every row now becomes a `rental_units` row; only the
          // lease/tenant/charge writes below are conditional on occupancy.
          //
          // status is 'active' for every imported row: vacant means "rentable
          // and empty", NOT 'offline'. Only an operator can tell us a unit is
          // out of service, and inferring it from a blank tenant name would
          // quietly erase the vacancy from the denominator again.
          const insertedUnits = await tx.insert(rentalUnits).values({
            organizationId: orgId,
            propertyId: propId,
            label: u.unit,
            status: "active",
            // Asking rent, ONLY from vacant rows. On an occupied row
            // `rentCents` is what the sitting tenant pays — in-place rent is
            // not market rent, and copying it here would invent an asking
            // price nobody quoted (and corrupt loss-to-lease). Occupied units
            // keep a null market rent until an operator sets one.
            marketRentCents: u.isVacant && u.rentCents > 0 ? u.rentCents : null,
            notes: "Imported from seller's rent roll at acquisition.",
            // Idempotent on re-import: the (org, property, label) unique index
            // absorbs the second run, so a re-upload neither duplicates a unit
            // nor clobbers operator edits to beds/baths/market rent/status.
            // Same pattern as the rentCharges insert below.
          }).onConflictDoNothing().returning({ id: rentalUnits.id });

          let unitId: string;
          if (insertedUnits.length > 0) {
            unitId = insertedUnits[0].id;
            createdUnits++;
          } else {
            // Conflict — the unit already exists. Read its id so the lease
            // still joins to the operator's row rather than orphaning.
            const [existing] = await tx.select({ id: rentalUnits.id })
              .from(rentalUnits)
              .where(and(
                eq(rentalUnits.organizationId, orgId),
                eq(rentalUnits.propertyId, propId),
                eq(rentalUnits.label, u.unit),
              ));
            if (!existing) {
              // Only reachable if the conflict came from something other than
              // the (org, property, label) index. Say so instead of guessing.
              logger.warn("[BH-5] rent roll: unit insert conflicted but no matching unit found", {
                orgId, propId, label: u.unit,
              });
              continue;
            }
            unitId = existing.id;
            existingUnits++;
          }

          if (u.isVacant) continue;                       // unit persisted above; no tenancy to create
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
            unitId,
            // unitLabel stays alongside unitId — it is the denormalised display
            // copy 20+ readers still use. Writers set BOTH (shared/schema/rental.ts).
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

        return { createdUnits, existingUnits, createdTenants, createdLeases, createdCharges };
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
