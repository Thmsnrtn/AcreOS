import { Router, type Request, type Response } from 'express';

// Tax Researcher service retired 2026-06-08 — the standalone /tax-researcher page
// and its taxResearcher-service-backed endpoints (/auctions, /scan, /delinquent,
// /alerts, /watchlist, /redemption-rates, /surface-to-radar) were removed.
// This router is INTENTIONALLY retained because the self-contained, drizzle-backed
// endpoints below (/county-summary, /auction-worksheet, /listings/:id [+ /bid-log])
// remain in active use by the surviving County Detail, Courthouse Mode, and
// Auction Worksheet surfaces. tax_sale_* tables are left orphaned for a later sweep.

const router = Router();

// ── TD-4: Auction worksheet + bid log ───────────────────────────────────────
// Marcus: "A pre-auction worksheet that lets me set max bid + walk-away
// condition + partner-split rules per parcel. Today this is paper."

import { z } from "zod";
import { and, asc, desc as descOrder, eq } from "drizzle-orm";
import { db as drizzleDb } from "./db";
import {
  taxSaleListings,
  auctionBidLog,
  AUCTION_BID_ACTIONS,
  TAX_LISTING_ACQUISITION_SOURCES,
} from "@shared/schema";
import { Errors } from "./utils/errors";

const partnerSplitSchema = z.array(z.object({
  investorName: z.string().min(1).max(240),
  splitBps: z.number().int().min(0).max(10_000),
}));

// PATCH /tax-researcher/listings/:id — update worksheet fields
router.patch('/listings/:id', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return Errors.badRequest(res, "Invalid listing id");
    const parsed = z.object({
      maxBidCents: z.number().int().nonnegative().nullable().optional(),
      walkAwayAboveCents: z.number().int().nonnegative().nullable().optional(),
      walkAwayCondition: z.string().max(500).nullable().optional(),
      partnerSplit: partnerSplitSchema.nullable().optional(),
      acquisitionSource: z.enum(TAX_LISTING_ACQUISITION_SOURCES).optional(),
      status: z.string().max(40).optional(),
      notes: z.string().max(4_000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: parsed.error.flatten() });

    const update = {
      ...parsed.data,
      updatedAt: new Date(),
    };
    const [row] = await drizzleDb
      .update(taxSaleListings)
      .set(update as any)
      .where(and(eq(taxSaleListings.id, id), eq(taxSaleListings.organizationId, org.id)))
      .returning();
    if (!row) return Errors.notFound(res, "Listing");
    res.json({ listing: row });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /tax-researcher/listings/:id/bid-log
router.get('/listings/:id/bid-log', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return Errors.badRequest(res, "Invalid listing id");
    const rows = await drizzleDb
      .select()
      .from(auctionBidLog)
      .where(and(eq(auctionBidLog.organizationId, org.id), eq(auctionBidLog.listingId, id)))
      .orderBy(descOrder(auctionBidLog.performedAt));
    res.json({ entries: rows });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// POST /tax-researcher/listings/:id/bid-log — log an action
router.post('/listings/:id/bid-log', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return Errors.badRequest(res, "Invalid listing id");
    const parsed = z.object({
      action: z.enum(AUCTION_BID_ACTIONS),
      amountCents: z.number().int().nonnegative().optional(),
      notes: z.string().max(2_000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: parsed.error.flatten() });

    const [listing] = await drizzleDb
      .select({ id: taxSaleListings.id })
      .from(taxSaleListings)
      .where(and(eq(taxSaleListings.id, id), eq(taxSaleListings.organizationId, org.id)))
      .limit(1);
    if (!listing) return Errors.notFound(res, "Listing");

    const userId = (req.user as any)?.id || (req.user as any)?.id || null;

    const [entry] = await drizzleDb
      .insert(auctionBidLog)
      .values({
        organizationId: org.id,
        listingId: id,
        action: parsed.data.action,
        amountCents: parsed.data.amountCents ?? null,
        performedByUserId: userId,
        notes: parsed.data.notes ?? null,
      })
      .returning();

    // Mirror terminal actions onto the listing status for at-a-glance state.
    if (parsed.data.action === "won") {
      await drizzleDb
        .update(taxSaleListings)
        .set({
          status: "won",
          bidAmount: parsed.data.amountCents != null ? String(parsed.data.amountCents / 100) : undefined,
          bidDate: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(eq(taxSaleListings.id, id));
    } else if (parsed.data.action === "outbid" || parsed.data.action === "passed") {
      await drizzleDb
        .update(taxSaleListings)
        .set({ status: "lost", updatedAt: new Date() } as any)
        .where(eq(taxSaleListings.id, id));
    }

    res.status(201).json({ entry });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /tax-researcher/county-summary?state=TN&county=Shelby
// Aggregates counts for the county hub (TD-5). Marcus: "Click a county,
// see its auction schedule, its delinquent-owner list, its redemption
// clock, its mailer drops."
router.get('/county-summary', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const state = (req.query.state as string | undefined)?.toUpperCase();
    const county = req.query.county as string | undefined;
    if (!state || !county) {
      return Errors.badRequest(res, "state + county query params required");
    }

    const today = new Date().toISOString().slice(0, 10);
    const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

    // We need: leads (drizzle), tax_certificates, tax_sale_listings,
    // tax_sale_auctions counts. Use sql tagged for COUNT readability.
    const { sql: sqlTag } = await import("drizzle-orm");
    const { leads: leadsTbl, taxCertificates, taxSaleListings, taxSaleAuctions } = await import("@shared/schema");

    // Scope the count to this org's leads in the requested county (leads.county
    // is populated from parcel data / tax-delinquent imports). Falls back to
    // including leads with no county recorded so it degrades gracefully during
    // the backfill window.
    const { or: orFn, isNull: isNullFn } = await import("drizzle-orm");
    const [{ leadsCount = 0 } = {}] = await drizzleDb
      .select({ leadsCount: sqlTag<number>`COUNT(*)::int` })
      .from(leadsTbl)
      .where(and(
        eq(leadsTbl.organizationId, org.id),
        eq(leadsTbl.state, state),
        orFn(isNullFn(leadsTbl.county), eq(leadsTbl.county, county)),
      ));

    const [{ activeCerts = 0 } = {}] = await drizzleDb
      .select({ activeCerts: sqlTag<number>`COUNT(*)::int` })
      .from(taxCertificates)
      .where(and(
        eq(taxCertificates.organizationId, org.id),
        eq(taxCertificates.status, "active"),
        eq(taxCertificates.state, state),
        eq(taxCertificates.county, county),
      ));

    const [{ overdueCerts = 0 } = {}] = await drizzleDb
      .select({ overdueCerts: sqlTag<number>`COUNT(*)::int` })
      .from(taxCertificates)
      .where(and(
        eq(taxCertificates.organizationId, org.id),
        eq(taxCertificates.status, "active"),
        eq(taxCertificates.state, state),
        eq(taxCertificates.county, county),
        sqlTag`${taxCertificates.redemptionDeadline} < ${today}`,
      ));

    const [{ upcomingAuctions = 0 } = {}] = await drizzleDb
      .select({ upcomingAuctions: sqlTag<number>`COUNT(*)::int` })
      .from(taxSaleAuctions)
      .where(and(
        eq(taxSaleAuctions.organizationId, org.id),
        eq(taxSaleAuctions.state, state),
        eq(taxSaleAuctions.county, county),
        sqlTag`${taxSaleAuctions.auctionDate} >= ${today}::timestamp`,
        sqlTag`${taxSaleAuctions.auctionDate} <= ${in90}::timestamp`,
      ));

    const [{ worksheetCount = 0 } = {}] = await drizzleDb
      .select({ worksheetCount: sqlTag<number>`COUNT(*)::int` })
      .from(taxSaleListings)
      .where(and(
        eq(taxSaleListings.organizationId, org.id),
        eq(taxSaleListings.state, state),
        eq(taxSaleListings.county, county),
        sqlTag`${taxSaleListings.bidAmount} IS NOT NULL`,
      ));

    res.json({
      state,
      county,
      asOf: today,
      delinquentLeadsCount: Number(leadsCount),
      activeCertsCount: Number(activeCerts),
      overdueCertsCount: Number(overdueCerts),
      upcomingAuctions90dCount: Number(upcomingAuctions),
      worksheetItemsCount: Number(worksheetCount),
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /tax-researcher/auction-worksheet — flat list optionally filtered by
// auctionId and acquisitionSource (Marcus / Lens 17: OTC + private are
// higher-margin paths; surfacing the filter chip is the first step toward
// sorting/scoring by source).
router.get('/auction-worksheet', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const auctionIdQ = req.query.auctionId ? parseInt(req.query.auctionId as string, 10) : undefined;
    const sourceQ = typeof req.query.acquisitionSource === "string"
      ? req.query.acquisitionSource
      : undefined;
    const conds = [eq(taxSaleListings.organizationId, org.id)];
    if (auctionIdQ && !Number.isNaN(auctionIdQ)) {
      conds.push(eq(taxSaleListings.auctionId, auctionIdQ));
    }
    if (sourceQ && (TAX_LISTING_ACQUISITION_SOURCES as readonly string[]).includes(sourceQ)) {
      conds.push(eq(taxSaleListings.acquisitionSource, sourceQ as any));
    }
    const rows = await drizzleDb
      .select()
      .from(taxSaleListings)
      .where(and(...conds))
      .orderBy(asc(taxSaleListings.minimumBid));
    res.json({ listings: rows });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
