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
 *     unitKind?: "unit" | "pad" | "suite",   // default for rows that omit it
 *     units: [
 *       { unit: "1A", tenantFirst: "Maria", tenantLast: "Lopez",
 *         email?, phone?, rentCents: 140000, leaseEnd: "2026-08-31",
 *         kind?: "unit" | "pad" | "suite" },
 *       ...
 *     ]
 *   }
 *
 * RE-IMPORT SEMANTICS — see the block comment above the tenancy guard in the
 * import handler. The short version: units and tenancies are idempotent
 * (re-uploading the same roll adds neither), PEOPLE are not de-duplicated
 * because there is no natural key for a human, and every row that produces
 * nothing is COUNTED and returned with a reason. The endpoint never reports a
 * success whose numbers do not add up to the payload it was handed.
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
  RENTAL_UNIT_KINDS,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { normalizeUnitLabel } from "./routes-rentals";

const unitSchema = z.object({
  // `.trim()` is load-bearing, not tidiness. Migration 0219 backfilled
  // `rental_units.label` as TRIM(unit_label); a raw " 3B" here is a DIFFERENT
  // label from the backfilled "3B", so `rental_units_org_property_label_uk`
  // waves it through and the building ends up with two 3Bs — both of which sit
  // in the occupancy denominator. Every write site trims through
  // `normalizeUnitLabel` (server/routes-rentals.ts).
  unit: z.string().trim().min(1).max(64),
  tenantFirst: z.string().optional(),
  tenantLast: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  rentCents: z.coerce.number().int().nonnegative(),
  securityDepositCents: z.coerce.number().int().nonnegative().optional(),
  leaseStart: z.string().optional(),
  leaseEnd: z.string().optional(),
  isVacant: z.boolean().default(false),
  // unit | pad | suite. A mobile-home park's rentable slot is a PAD (the
  // tenant owns the home and rents the ground); a strip centre's is a SUITE.
  // Nothing is inferred from a blank — an omitted kind falls back to the
  // roll-level `unitKind`, and that defaults to 'unit'. Guessing 'pad' from,
  // say, the property's structure_type would put a fact in the record that
  // nobody asserted.
  kind: z.enum(RENTAL_UNIT_KINDS).optional(),
});

const rentRollSchema = z.object({
  state: z.string().length(2),
  monthlyOpExpenseEstimateCents: z.coerce.number().int().nonnegative().optional(),
  vacancyRate: z.coerce.number().min(0).max(1).optional(),  // 0.05 = 5%
  /** Applies to every row that does not carry its own `kind`. */
  unitKind: z.enum(RENTAL_UNIT_KINDS).default("unit"),
  units: z.array(unitSchema).min(1).max(200),
});

/** Why a payload row produced no tenancy. Returned to the caller, never swallowed. */
type SkippedRowReason = "unit_unresolved" | "no_tenant_identity";

interface SkippedRow {
  unit: string;
  reason: SkippedRowReason;
  message: string;
}

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
        let existingLeases = 0;
        let createdCharges = 0;
        let vacantRows = 0;
        const skippedRows: SkippedRow[] = [];

        for (const u of parsed.data.units) {
          // ONE normalisation, shared with the lease/unit writers. See
          // `normalizeUnitLabel` in server/routes-rentals.ts.
          const label = normalizeUnitLabel(u.unit);
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
            label,
            // Set on CREATE only — a conflict below leaves the operator's own
            // kind alone rather than resetting a park's pads to 'unit'.
            kind: u.kind ?? parsed.data.unitKind,
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
                eq(rentalUnits.label, label),
              ));
            if (!existing) {
              // Only reachable if the conflict came from something other than
              // the (org, property, label) index. This used to `continue` on a
              // logger.warn alone: for an OCCUPIED row that dropped the tenant,
              // the lease AND the charge, while every returned counter stayed
              // silent — the API reported success over numbers that did not add
              // up to the payload. Count it and hand it back with a reason.
              logger.warn("[BH-5] rent roll: unit insert conflicted but no matching unit found", {
                orgId, propId, label,
              });
              skippedRows.push({
                unit: label,
                reason: "unit_unresolved",
                message:
                  "The unit row could not be created or found, so no tenant, lease or rent charge was written for this line. " +
                  "Nothing about it was imported — re-upload this row once the conflict is resolved.",
              });
              continue;
            }
            unitId = existing.id;
            existingUnits++;
          }

          if (u.isVacant) {
            // Not a skip: the unit persisted above, which is the whole point of
            // carrying vacant lines. There is simply no tenancy to write.
            vacantRows++;
            continue;
          }

          if (!u.tenantFirst && !u.tenantLast) {
            // An occupied line with nobody on it. The unit is saved, but the
            // tenancy is NOT — say so rather than let the caller assume their
            // occupied row became a lease.
            skippedRows.push({
              unit: label,
              reason: "no_tenant_identity",
              message:
                "Row is marked occupied but carries no tenant first or last name, so no tenant or lease was created. " +
                "The unit itself was saved and will show as vacant until a lease is added.",
            });
            continue;
          }

          // ── RE-IMPORT: what is idempotent here, and what deliberately is not.
          //
          // The unit insert has always been conflict-guarded. Nothing below it
          // was, so a second upload of the same roll created a second ACTIVE
          // lease on every unit (two active tenancies on one unit — which the
          // occupancy LATERAL then has to de-duplicate to stay under 100%) plus
          // a duplicate tenant per row. The endpoint called itself idempotent
          // while doing that.
          //
          // DECISION: guard the TENANCY, not the person.
          //
          //   * A unit that already carries an active lease is left completely
          //     alone — no tenant, no lease, no charge — and counted as
          //     `existingLeases`. A rent roll is a snapshot of who is sitting
          //     in the building; re-uploading the same snapshot asserts the same
          //     tenancy, not a second one. This is the case that was corrupting
          //     data, and it is now a no-op.
          //
          //   * PEOPLE are still never de-duplicated, and that is deliberate.
          //     There is no natural key for a human: matching on name would
          //     merge two different Maria Lopezes into one tenant record, and
          //     matching on email would miss the majority of rent rolls, which
          //     carry no email at all. Merging the wrong two people is a far
          //     worse failure than a duplicate row, so we refuse to guess. The
          //     path that reaches an insert is now the genuinely new-tenancy
          //     path: a unit with no active lease.
          //
          //   * A re-import onto a unit whose lease has ENDED therefore does
          //     create a new tenant + lease. That is correct — a new tenancy in
          //     the same unit is a new tenancy — and the summary reports it.
          const [activeLease] = await tx.select({ id: rentalLeases.id })
            .from(rentalLeases)
            .where(and(
              eq(rentalLeases.organizationId, orgId),
              eq(rentalLeases.unitId, unitId),
              eq(rentalLeases.status, "active"),
            ));
          if (activeLease) {
            existingLeases++;
            continue;
          }

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
            unitLabel: label,
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

        return {
          createdUnits,
          existingUnits,
          createdTenants,
          createdLeases,
          existingLeases,
          createdCharges,
          vacantRows,
          skippedRowCount: skippedRows.length,
          skippedRows,
        };
      });

      const askingCents = prop.listPrice
        ? Math.round(parseFloat(prop.listPrice) * 100)
        : prop.marketValue
          ? Math.round(parseFloat(prop.marketValue) * 100)
          : null;
      const noi = computeNoi(parsed.data, askingCents);

      logger.info("[BH-5] rent roll imported", {
        orgId, userId, propId,
        rowsSubmitted: parsed.data.units.length,
        createdUnits: summary.createdUnits,
        existingUnits: summary.existingUnits,
        createdTenants: summary.createdTenants,
        createdLeases: summary.createdLeases,
        existingLeases: summary.existingLeases,
        createdCharges: summary.createdCharges,
        vacantRows: summary.vacantRows,
        skippedRowCount: summary.skippedRowCount,
      });
      // `rowsSubmitted` is returned so the caller can check the arithmetic
      // itself: units created + already-present + skipped must equal it.
      return res.status(201).json({
        ...summary,
        rowsSubmitted: parsed.data.units.length,
        noi,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
