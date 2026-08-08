/**
 * Tax certificates — the redemption-clock surface (TD-2).
 *
 * Marcus's deal-killer. The math behind the clock comes from
 * services/redemptionClock.ts; this module exposes:
 *
 *   GET    /api/tax-certificates                — sorted by deadline asc
 *   POST   /api/tax-certificates                — create (computes deadline)
 *   GET    /api/tax-certificates/:id            — detail + live amount
 *   PATCH  /api/tax-certificates/:id            — update status / mark redeemed
 *   GET    /api/tax-certificates/:id/redemption-amount?asOf=YYYY-MM-DD
 *                                                 — payoff calculator
 *   DELETE /api/tax-certificates/:id            — remove (county error etc)
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  taxCertificates,
  TAX_CERT_SALE_TYPES,
  TAX_CERT_STATUSES,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  computeRedemptionDeadline,
  computeRedemptionAmount,
  STATE_REDEMPTION_RULES,
} from "./services/redemptionClock";
import {
  emitCertAcquired,
  emitCertRedeemed,
  type CertEventRow,
} from "./services/certificateEvents";

// Build the CertEventRow slice the workflow emitters need from a full
// tax_certificates row. Real columns only — the `date` columns come back as
// ISO strings.
function certEventRowFrom(row: typeof taxCertificates.$inferSelect): CertEventRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId ?? null,
    state: row.state,
    county: row.county,
    apn: row.apn,
    saleType: row.saleType,
    saleDate: row.saleDate as unknown as string,
    bidDownRateBps: row.bidDownRateBps ?? null,
    redemptionDeadline: row.redemptionDeadline as unknown as string,
    status: row.status,
    redeemedAt: (row.redeemedAt as unknown as string | null) ?? null,
    redeemedAmountCents: row.redeemedAmountCents ?? null,
  };
}

const addressSchema = z
  .object({
    line1: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  })
  .passthrough();

const createSchema = z.object({
  state: z.string().length(2),
  county: z.string().min(1).max(120),
  apn: z.string().min(1).max(120),
  certificateNumber: z.string().max(120).optional(),
  saleType: z.enum(TAX_CERT_SALE_TYPES),
  saleDate: z.string().min(1),
  purchaseAmountCents: z.number().int().nonnegative(),
  bidDownRateBps: z.number().int().min(0).max(10_000).optional(),
  ownerName: z.string().max(240).optional(),
  ownerAddress: addressSchema.optional(),
  ownerOccupiedAtSale: z.boolean().optional(),
  scraTollingApplied: z.boolean().optional(),
  listingId: z.number().int().positive().optional(),
  propertyId: z.number().int().positive().optional(),
  notes: z.string().max(8_000).optional(),
});

const patchSchema = z.object({
  status: z.enum(TAX_CERT_STATUSES).optional(),
  redeemedAt: z.string().optional(),
  redeemedAmountCents: z.number().int().nonnegative().optional(),
  ownerOccupiedAtSale: z.boolean().optional(),
  scraTollingApplied: z.boolean().optional(),
  bidDownRateBps: z.number().int().min(0).max(10_000).optional(),
  ownerName: z.string().max(240).optional(),
  ownerAddress: addressSchema.optional(),
  notes: z.string().max(8_000).optional(),
});

export function registerTaxCertificateRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── List ──────────────────────────────────────────────────────────────────
  // Default sort: redemption_deadline ASC so closest-to-expiry leads. Marcus:
  // "Cards with: parcel, certificate number, redemption date, days remaining,
  // current redemption amount, redeemer-of-record. Sort by days-remaining
  // ascending."
  app.get(
    "/api/tax-certificates",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const status = typeof req.query.status === "string" ? req.query.status : "active";
        const stateFilter = typeof req.query.state === "string" ? req.query.state.toUpperCase() : undefined;

        const conditions = [eq(taxCertificates.organizationId, orgId)];
        if ((TAX_CERT_STATUSES as readonly string[]).includes(status)) {
          conditions.push(eq(taxCertificates.status, status as any));
        }
        if (stateFilter && /^[A-Z]{2}$/.test(stateFilter)) {
          conditions.push(eq(taxCertificates.state, stateFilter));
        }

        const rows = await db
          .select()
          .from(taxCertificates)
          .where(and(...conditions))
          .orderBy(asc(taxCertificates.redemptionDeadline))
          .limit(500);

        // Decorate each row with a live redemption-amount snapshot so the
        // dashboard renders the running total without N+1 calls from the
        // client.
        const today = new Date().toISOString().slice(0, 10);
        const decorated = rows.map((row) => {
          const amt = computeRedemptionAmount({
            state: row.state,
            saleDate: row.saleDate as unknown as string,
            asOfDate: today,
            purchaseAmountCents: row.purchaseAmountCents,
            bidDownRateBps: row.bidDownRateBps ?? undefined,
          });
          const deadline = new Date(row.redemptionDeadline as unknown as string);
          const daysRemaining = Math.ceil(
            (deadline.getTime() - new Date(today).getTime()) / 86_400_000,
          );
          return {
            ...row,
            currentRedemptionAmountCents: amt.totalRedemptionCents,
            currentInterestCents: amt.interestCents,
            appliedRateBps: amt.appliedRateBps,
            modelUsed: amt.modelUsed,
            preliminary: amt.preliminary,
            daysRemaining,
          };
        });

        return res.json({
          certificates: decorated,
          asOf: today,
          // Surface the rule-coverage state so the UI can show a banner
          // when *any* rendered certificate uses preliminary math.
          rulesAttorneyReviewed: false,
        });
      } catch (err) {
        logger.error("taxCertificates.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Detail ────────────────────────────────────────────────────────────────
  app.get(
    "/api/tax-certificates/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .select()
          .from(taxCertificates)
          .where(and(eq(taxCertificates.id, req.params.id), eq(taxCertificates.organizationId, orgId)))
          .limit(1);
        if (!row) return Errors.notFound(res, "Certificate");

        const today = new Date().toISOString().slice(0, 10);
        const amt = computeRedemptionAmount({
          state: row.state,
          saleDate: row.saleDate as unknown as string,
          asOfDate: today,
          purchaseAmountCents: row.purchaseAmountCents,
          bidDownRateBps: row.bidDownRateBps ?? undefined,
        });

        const rule = STATE_REDEMPTION_RULES[row.state];
        return res.json({
          certificate: row,
          redemptionAmount: amt,
          stateRule: rule
            ? {
                citation: rule.citation,
                attorneyReviewedAt: rule.attorneyReviewedAt,
                attorneyReviewedBy: rule.attorneyReviewedBy,
                interestModel: rule.interestModel,
                redemptionPeriodMonths: rule.redemptionPeriodMonths,
                redemptionPeriodMonthsOwnerOccupied: rule.redemptionPeriodMonthsOwnerOccupied,
              }
            : null,
        });
      } catch (err) {
        logger.error("taxCertificates.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Create ────────────────────────────────────────────────────────────────
  app.post(
    "/api/tax-certificates",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const data = parsed.data;

        // Compute the redemption deadline at insert time. Per-state anchor
        // logic + owner-occupied modifier handled in the service.
        const deadline = computeRedemptionDeadline({
          state: data.state,
          saleDate: data.saleDate,
          ownerOccupied: data.ownerOccupiedAtSale,
          scraTolling: data.scraTollingApplied,
        });

        // No-redemption states (NC) get an immediate 'deed_obtained' status —
        // the certificate effectively IS the deed at sale.
        const initialStatus = deadline === null ? "deed_obtained" : "active";

        const [row] = await db
          .insert(taxCertificates)
          .values({
            organizationId: orgId,
            state: data.state.toUpperCase(),
            county: data.county,
            apn: data.apn,
            certificateNumber: data.certificateNumber ?? null,
            saleType: data.saleType,
            saleDate: data.saleDate,
            purchaseAmountCents: data.purchaseAmountCents,
            bidDownRateBps: data.bidDownRateBps ?? null,
            ownerName: data.ownerName ?? null,
            ownerAddress: data.ownerAddress ?? null,
            ownerOccupiedAtSale: data.ownerOccupiedAtSale ?? null,
            scraTollingApplied: data.scraTollingApplied ?? null,
            listingId: data.listingId ?? null,
            propertyId: data.propertyId ?? null,
            // Stash 'sale_date' as the deadline placeholder for no-redemption
            // states so the NOT NULL constraint is happy. The status flag
            // is what differentiates.
            redemptionDeadline: deadline ?? data.saleDate,
            status: initialStatus,
            notes: data.notes ?? null,
          })
          .returning();
        if (!row) return Errors.internal(res, new Error("Insert returned no row"));
        // A certificate create IS the genuine cert.acquired event — fire the
        // acquired-kickoff workflow lane. Fire-and-forget; never blocks the 201.
        emitCertAcquired(certEventRowFrom(row));
        return res.status(201).json({ certificate: row });
      } catch (err) {
        if (err instanceof Error && /unique/i.test(err.message)) {
          return Errors.badRequest(res, "A certificate already exists for this (state, county, APN, sale date)");
        }
        logger.error("taxCertificates.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Patch ─────────────────────────────────────────────────────────────────
  app.patch(
    "/api/tax-certificates/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const update: Partial<typeof taxCertificates.$inferInsert> = {
          ...parsed.data,
          updatedAt: new Date(),
        };

        // Unconditional pre-image status capture, read BEFORE the update so a
        // genuine transition INTO "redeemed" can be detected for the redeemed-
        // payoff workflow lane (a status edit that was already "redeemed" is a
        // no-op in the emitter).
        const [preImage] = await db
          .select({ status: taxCertificates.status })
          .from(taxCertificates)
          .where(and(eq(taxCertificates.id, req.params.id), eq(taxCertificates.organizationId, orgId)))
          .limit(1);
        const beforeStatus = preImage?.status ?? null;

        // If marking redeemed and amount not specified, snapshot the live
        // computed amount as of the redeemedAt date so the running total
        // is captured at the moment of redemption. Marcus: "the redemption
        // amount calculation matches the county clerk's calculation to the
        // cent" — this snapshot is what any future audit reconciles
        // against.
        if (parsed.data.status === "redeemed" && parsed.data.redeemedAmountCents === undefined) {
          const [row] = await db
            .select()
            .from(taxCertificates)
            .where(and(eq(taxCertificates.id, req.params.id), eq(taxCertificates.organizationId, orgId)))
            .limit(1);
          if (row) {
            const asOf = parsed.data.redeemedAt ?? new Date().toISOString().slice(0, 10);
            const amt = computeRedemptionAmount({
              state: row.state,
              saleDate: row.saleDate as unknown as string,
              asOfDate: asOf,
              purchaseAmountCents: row.purchaseAmountCents,
              bidDownRateBps: row.bidDownRateBps ?? undefined,
            });
            update.redeemedAmountCents = amt.totalRedemptionCents;
            if (!update.redeemedAt) update.redeemedAt = asOf;
          }
        }

        const [row] = await db
          .update(taxCertificates)
          .set(update)
          .where(and(eq(taxCertificates.id, req.params.id), eq(taxCertificates.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Certificate");
        // Fire the redeemed-payoff workflow lane ONLY on a genuine
        // active→redeemed transition. Fire-and-forget; never blocks the response.
        emitCertRedeemed(beforeStatus, certEventRowFrom(row));
        return res.json({ certificate: row });
      } catch (err) {
        logger.error("taxCertificates.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Live redemption amount calculator ─────────────────────────────────────
  app.get(
    "/api/tax-certificates/:id/redemption-amount",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const asOf = (req.query.asOf as string | undefined) ?? new Date().toISOString().slice(0, 10);
        const [row] = await db
          .select()
          .from(taxCertificates)
          .where(and(eq(taxCertificates.id, req.params.id), eq(taxCertificates.organizationId, orgId)))
          .limit(1);
        if (!row) return Errors.notFound(res, "Certificate");

        const amt = computeRedemptionAmount({
          state: row.state,
          saleDate: row.saleDate as unknown as string,
          asOfDate: asOf,
          purchaseAmountCents: row.purchaseAmountCents,
          bidDownRateBps: row.bidDownRateBps ?? undefined,
        });
        return res.json(amt);
      } catch (err) {
        logger.error("taxCertificates.amount failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Delete ────────────────────────────────────────────────────────────────
  app.delete(
    "/api/tax-certificates/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .delete(taxCertificates)
          .where(and(eq(taxCertificates.id, req.params.id), eq(taxCertificates.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Certificate");
        return res.json({ deleted: true });
      } catch (err) {
        logger.error("taxCertificates.delete failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Aggregate dashboard endpoint ─────────────────────────────────────────
  // Returns counts by status + deadline buckets for the /redemption-clock
  // page header. Single round-trip instead of computing client-side.
  app.get(
    "/api/tax-certificates/dashboard/summary",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const today = new Date().toISOString().slice(0, 10);
        const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
        const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

        const [{ active = 0 } = {}] = await db
          .select({ active: sql<number>`COUNT(*)::int` })
          .from(taxCertificates)
          .where(and(eq(taxCertificates.organizationId, orgId), eq(taxCertificates.status, "active")));

        const [{ overdue = 0 } = {}] = await db
          .select({ overdue: sql<number>`COUNT(*)::int` })
          .from(taxCertificates)
          .where(and(
            eq(taxCertificates.organizationId, orgId),
            eq(taxCertificates.status, "active"),
            sql`${taxCertificates.redemptionDeadline} < ${today}`,
          ));

        const [{ within30 = 0 } = {}] = await db
          .select({ within30: sql<number>`COUNT(*)::int` })
          .from(taxCertificates)
          .where(and(
            eq(taxCertificates.organizationId, orgId),
            eq(taxCertificates.status, "active"),
            sql`${taxCertificates.redemptionDeadline} BETWEEN ${today} AND ${in30}`,
          ));

        const [{ within90 = 0 } = {}] = await db
          .select({ within90: sql<number>`COUNT(*)::int` })
          .from(taxCertificates)
          .where(and(
            eq(taxCertificates.organizationId, orgId),
            eq(taxCertificates.status, "active"),
            sql`${taxCertificates.redemptionDeadline} BETWEEN ${today} AND ${in90}`,
          ));

        const [{ totalCapital = 0 } = {}] = await db
          .select({ totalCapital: sql<number>`COALESCE(SUM(${taxCertificates.purchaseAmountCents}), 0)::bigint` })
          .from(taxCertificates)
          .where(and(eq(taxCertificates.organizationId, orgId), eq(taxCertificates.status, "active")));

        return res.json({
          asOf: today,
          activeCount: Number(active),
          overdueCount: Number(overdue),
          within30Count: Number(within30),
          within90Count: Number(within90),
          totalCapitalCents: Number(totalCapital),
        });
      } catch (err) {
        logger.error("taxCertificates.dashboard failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
