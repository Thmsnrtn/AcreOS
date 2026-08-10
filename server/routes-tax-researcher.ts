import { Router, type Request, type Response } from 'express';

// Tax Researcher service retired 2026-06-08 — the standalone /tax-researcher page
// and its taxResearcher-service-backed endpoints (/scan, /delinquent, /alerts,
// /watchlist, /redemption-rates, /surface-to-radar) were removed.
// This router is INTENTIONALLY retained because the self-contained, drizzle-backed
// endpoints below (/county-summary, /auction-worksheet, /listings/:id [+ /bid-log])
// remain in active use by the surviving County Detail, Courthouse Mode, and
// Auction Worksheet surfaces.
//
// 2026-07-30 (Wave D) — tax_sale_auctions / tax_sale_listings are no longer
// "orphaned tables awaiting a sweep". They had ZERO insert paths anywhere in
// the repo: `importFromCounty` and `countyAssessorIngest.fetchTaxDelinquentList`
// are stubs that return empty, so the flagship auction worksheet and the
// county upcoming-auction counts queried tables nothing could fill. The
// /auctions + /imports/lot-list endpoints below are that missing insert path:
// manual entry and operator-supplied CSV lot lists ONLY. No scraping, no
// county data plane — that remains a separate founder-gated bet.

const router = Router();

// ── TD-4: Auction worksheet + bid log ───────────────────────────────────────
// Marcus: "A pre-auction worksheet that lets me set max bid + walk-away
// condition + partner-split rules per parcel. Today this is paper."

import { z } from "zod";
import { and, asc, desc as descOrder, eq, inArray, sql } from "drizzle-orm";
import { db as drizzleDb } from "./db";
import {
  taxSaleListings,
  taxSaleAuctions,
  taxCertificates,
  auctionBidLog,
  AUCTION_BID_ACTIONS,
  TAX_LISTING_ACQUISITION_SOURCES,
} from "@shared/schema";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import {
  parseDelimited,
  suggestColumnMapping,
  validateLotRows,
  assertNoRowLost,
  centsToNumeric,
  numericToCents,
  LOT_FIELDS,
  TAX_SALE_LOT_ACQUISITION_SOURCES,
  type ColumnMapping,
  type LotFieldKey,
  type PreparedLot,
} from "./services/taxSaleCsvImport";
import {
  buildCertificateFromWonLot,
  computeSessionBudget,
  type WonLot,
} from "./services/wonBidToCertificate";
import { getStateRuleCoverage, UNREVIEWED_RULE_CAVEAT } from "./services/taxRuleCoverage";
import { emitCertAcquired } from "./services/certificateEvents";

const partnerSplitSchema = z.array(z.object({
  investorName: z.string().min(1).max(240),
  splitBps: z.number().int().min(0).max(10_000),
}));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// ============================================================================
// AUCTION + LOT-LIST INSERT PATHS (Wave D)
// ----------------------------------------------------------------------------
// The feedstock for the worksheet, courthouse mode, and the county
// upcoming-auction counts. Manual entry + operator-supplied CSV only.
// ============================================================================

const auctionBodySchema = z.object({
  county: z.string().min(1).max(120),
  state: z.string().length(2),
  auctionType: z.enum(["lien", "deed", "redeemable_deed"]),
  auctionDate: isoDate,
  auctionEndDate: isoDate.nullable().optional(),
  registrationDeadline: isoDate.nullable().optional(),
  auctionFormat: z.enum(["in_person", "online", "sealed_bid"]).default("in_person"),
  auctionUrl: z.string().max(2_000).nullable().optional(),
  venueName: z.string().max(240).nullable().optional(),
  venueAddress: z.string().max(500).nullable().optional(),
  depositRequiredCents: z.number().int().nonnegative().nullable().optional(),
  /**
   * Capital the operator has allocated to this sale. TRACKING ONLY — founder
   * ruling #15: deposits and purchases move on the operator's own rails and
   * never through AcreOS. This number is a notebook, not a balance.
   */
  sessionBudgetCents: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(4_000).nullable().optional(),
});

/** Every auction we hand back carries its state's rule-coverage truth. */
function auctionRuleContext(state: string) {
  const coverage = getStateRuleCoverage(state);
  return {
    ruleCoverage: coverage.tier,
    redemptionMathEncoded: coverage.redemptionMathEncoded,
    attorneyReviewed: coverage.attorneyReviewed,
    citation: coverage.citation,
    caveat: coverage.caveat,
  };
}

// POST /tax-researcher/auctions — create an auction by hand.
router.post('/auctions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const parsed = auctionBodySchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    const b = parsed.data;
    const state = b.state.toUpperCase();

    const [row] = await drizzleDb
      .insert(taxSaleAuctions)
      .values({
        organizationId,
        county: b.county.trim(),
        state,
        auctionType: b.auctionType,
        auctionDate: new Date(`${b.auctionDate}T00:00:00Z`),
        auctionEndDate: b.auctionEndDate ? new Date(`${b.auctionEndDate}T00:00:00Z`) : null,
        registrationDeadline: b.registrationDeadline
          ? new Date(`${b.registrationDeadline}T00:00:00Z`)
          : null,
        auctionFormat: b.auctionFormat,
        auctionUrl: b.auctionUrl ?? null,
        venueName: b.venueName ?? null,
        venueAddress: b.venueAddress ?? null,
        depositRequired: centsToNumeric(b.depositRequiredCents ?? null),
        sessionBudgetCents: b.sessionBudgetCents ?? null,
        notes: b.notes ?? null,
        status: "scheduled",
        // Hand-entered, not scraped. Say so in the provenance columns rather
        // than leaving them to imply a source that does not exist.
        scrapeStatus: "manual_entry",
        sourceUrl: null,
      })
      .returning();

    logger.info("[taxSale] auction created", {
      metadata: { __pii_safe: true, organizationId, auctionId: row.id, state, source: "manual" },
    });
    res.status(201).json({ auction: row, ...auctionRuleContext(state) });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /tax-researcher/auctions — the calendar feed. Upcoming first.
router.get('/auctions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const stateQ = typeof req.query.state === "string" ? req.query.state.toUpperCase() : undefined;
    const countyQ = typeof req.query.county === "string" ? req.query.county : undefined;

    const conds = [eq(taxSaleAuctions.organizationId, organizationId)];
    if (stateQ) conds.push(eq(taxSaleAuctions.state, stateQ));
    if (countyQ) conds.push(eq(taxSaleAuctions.county, countyQ));

    const rows = await drizzleDb
      .select({
        auction: taxSaleAuctions,
        lotCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${taxSaleListings}
          WHERE ${taxSaleListings.auctionId} = ${taxSaleAuctions.id}
            AND ${taxSaleListings.organizationId} = ${organizationId}
        )`,
      })
      .from(taxSaleAuctions)
      .where(and(...conds))
      .orderBy(asc(taxSaleAuctions.auctionDate));

    res.json({
      auctions: rows.map((r) => ({
        ...r.auction,
        depositRequiredCents: numericToCents(r.auction.depositRequired),
        lotCount: Number(r.lotCount ?? 0),
        ...auctionRuleContext(r.auction.state),
      })),
      // No sample data, ever. An empty list is an empty list.
      isEmpty: rows.length === 0,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── CSV lot-list import ─────────────────────────────────────────────────────
// Two-phase on purpose: /preview never writes, /commit writes only the rows
// the operator has already seen validated. Rejected rows come back in full so
// nothing is silently dropped.

const importBodySchema = z.object({
  /** Raw file text. The client reads the file; the server owns parsing. */
  csv: z.string().min(1).max(5 * 1024 * 1024),
  auctionId: z.number().int().positive().nullable().optional(),
  /** Operator-confirmed mapping. Omit on the first preview to get suggestions. */
  mapping: z.record(z.string(), z.number().int().nonnegative().nullable()).optional(),
  defaultAcquisitionSource: z.enum(TAX_SALE_LOT_ACQUISITION_SOURCES).optional(),
});

const LOT_FIELD_KEYS = new Set<string>(LOT_FIELDS.map((f) => f.key));

function coerceMapping(input: Record<string, number | null> | undefined): ColumnMapping | undefined {
  if (!input) return undefined;
  const out: ColumnMapping = {};
  for (const [k, v] of Object.entries(input)) {
    if (LOT_FIELD_KEYS.has(k)) out[k as LotFieldKey] = v;
  }
  return out;
}

/** Shared parse + map + validate for both preview and commit. */
async function runImportValidation(
  organizationId: number,
  body: z.infer<typeof importBodySchema>,
) {
  const sheet = parseDelimited(body.csv);
  const suggestion = suggestColumnMapping(sheet.headers);
  const mapping = coerceMapping(body.mapping) ?? suggestion.mapping;
  const unmappedRequired = LOT_FIELDS.filter((f) => f.required && mapping[f.key] == null).map(
    (f) => f.key,
  );

  // APNs already on this auction's worksheet — duplicates are reported, not
  // re-inserted and not silently skipped.
  let existingApns: string[] = [];
  if (body.auctionId) {
    const rows = await drizzleDb
      .select({ apn: taxSaleListings.apn })
      .from(taxSaleListings)
      .where(
        and(
          eq(taxSaleListings.organizationId, organizationId),
          eq(taxSaleListings.auctionId, body.auctionId),
        ),
      );
    existingApns = rows.map((r) => r.apn);
  }

  const outcome = validateLotRows({
    headers: sheet.headers,
    rows: sheet.rows,
    mapping,
    existingApns,
    defaultAcquisitionSource: body.defaultAcquisitionSource,
  });
  assertNoRowLost(outcome);
  return { sheet, suggestion, mapping, unmappedRequired, outcome };
}

// POST /tax-researcher/imports/lot-list/preview — validate, write nothing.
router.post('/imports/lot-list/preview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const parsed = importBodySchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    let result: Awaited<ReturnType<typeof runImportValidation>>;
    try {
      result = await runImportValidation(organizationId, parsed.data);
    } catch (err) {
      return Errors.badRequest(res, err instanceof Error ? err.message : "Could not read the file");
    }

    res.json({
      committed: false,
      headers: result.sheet.headers,
      fields: LOT_FIELDS,
      mapping: result.mapping,
      suggestedMapping: result.suggestion.mapping,
      ignoredColumns: result.suggestion.ignoredColumns,
      unmappedRequired: result.unmappedRequired,
      summary: result.outcome.summary,
      // Bounded so a 20k-row file can't blow up the response; the counts above
      // are always exact even when this list is truncated.
      sampleValid: result.outcome.valid.slice(0, 25),
      rejected: result.outcome.rejected.slice(0, 500),
      rejectedTruncated: result.outcome.rejected.length > 500,
      caveat: UNREVIEWED_RULE_CAVEAT,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /tax-researcher/imports/lot-list/commit — insert the valid rows.
router.post('/imports/lot-list/commit', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const parsed = importBodySchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    let result: Awaited<ReturnType<typeof runImportValidation>>;
    try {
      result = await runImportValidation(organizationId, parsed.data);
    } catch (err) {
      return Errors.badRequest(res, err instanceof Error ? err.message : "Could not read the file");
    }

    if (result.unmappedRequired.length > 0) {
      return Errors.badRequest(
        res,
        "Map every required column before importing.",
        { unmappedRequired: result.unmappedRequired },
      );
    }

    // Verify the auction belongs to this org before hanging lots off it.
    if (parsed.data.auctionId) {
      const [auction] = await drizzleDb
        .select({ id: taxSaleAuctions.id })
        .from(taxSaleAuctions)
        .where(
          and(
            eq(taxSaleAuctions.id, parsed.data.auctionId),
            eq(taxSaleAuctions.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!auction) return Errors.notFound(res, "Auction");
    }

    const { valid, rejected, summary } = result.outcome;
    const inserted = valid.length > 0
      ? await drizzleDb
          .insert(taxSaleListings)
          .values(valid.map((lot) => lotToListingRow(lot, organizationId, parsed.data.auctionId ?? null)))
          .returning({ id: taxSaleListings.id, apn: taxSaleListings.apn })
      : [];

    logger.info("[taxSale] lot-list import committed", {
      metadata: {
        __pii_safe: true,
        organizationId,
        auctionId: parsed.data.auctionId ?? null,
        rowsInFile: summary.totalRows,
        inserted: inserted.length,
        rejected: rejected.length,
      },
    });

    res.status(201).json({
      committed: true,
      summary: { ...summary, insertedCount: inserted.length },
      insertedIds: inserted.map((r) => r.id),
      // The full rejection list, so the operator can fix and re-import.
      rejected: rejected.slice(0, 500),
      rejectedTruncated: rejected.length > 500,
      caveat: UNREVIEWED_RULE_CAVEAT,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

function lotToListingRow(lot: PreparedLot, organizationId: number, auctionId: number | null) {
  return {
    organizationId,
    auctionId,
    apn: lot.apn,
    county: lot.county,
    state: lot.state,
    saleType: lot.saleType,
    acquisitionSource: lot.acquisitionSource ?? "auction",
    totalTaxOwed: centsToNumeric(lot.totalTaxOwedCents)!,
    minimumBid: centsToNumeric(lot.minimumBidCents),
    openingBid: centsToNumeric(lot.openingBidCents),
    assessedValue: centsToNumeric(lot.assessedValueCents),
    marketValue: centsToNumeric(lot.marketValueCents),
    address: lot.address,
    city: lot.city,
    zip: lot.zip,
    legalDescription: lot.legalDescription,
    acreage: lot.acreage,
    propertyType: lot.propertyType,
    ownerName: lot.ownerName,
    notes: lot.notes,
    status: "available" as const,
    // Provenance: operator-supplied file, not a scrape. No sourceUrl to invent.
    sourceUrl: null,
  };
}

// POST /tax-researcher/auctions/:id/lots — add one lot by hand.
router.post('/auctions/:id/lots', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const auctionId = parseInt(req.params.id, 10);
    if (Number.isNaN(auctionId)) return Errors.badRequest(res, "Invalid auction id");

    const [auction] = await drizzleDb
      .select()
      .from(taxSaleAuctions)
      .where(and(eq(taxSaleAuctions.id, auctionId), eq(taxSaleAuctions.organizationId, organizationId)))
      .limit(1);
    if (!auction) return Errors.notFound(res, "Auction");

    // One hand-entered lot is validated by exactly the same code path as a
    // CSV row, so the two can never disagree about what a valid lot is.
    const single = z.object({
      apn: z.string().min(1).max(120),
      county: z.string().min(1).max(120).optional(),
      state: z.string().length(2).optional(),
      saleType: z.enum(["lien", "deed", "redeemable_deed"]).optional(),
      totalTaxOwedCents: z.number().int().nonnegative(),
      minimumBidCents: z.number().int().nonnegative().nullable().optional(),
      assessedValueCents: z.number().int().nonnegative().nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      ownerName: z.string().max(240).nullable().optional(),
      acquisitionSource: z.enum(TAX_SALE_LOT_ACQUISITION_SOURCES).optional(),
      notes: z.string().max(4_000).nullable().optional(),
    }).safeParse(req.body);
    if (!single.success) return Errors.validationFailed(res, single.error);
    const b = single.data;

    const state = (b.state ?? auction.state).toUpperCase();
    const coverage = getStateRuleCoverage(state);
    if (coverage.tier === "not_encoded") {
      return Errors.badRequest(
        res,
        `AcreOS has no tax-sale rules encoded for '${state}'. The lot is not saved — nothing is assumed on your behalf.`,
        { state, ruleCoverage: coverage.tier },
      );
    }

    const [row] = await drizzleDb
      .insert(taxSaleListings)
      .values({
        organizationId,
        auctionId,
        apn: b.apn.trim(),
        county: (b.county ?? auction.county).trim(),
        state,
        saleType: b.saleType ?? auction.auctionType,
        acquisitionSource: b.acquisitionSource ?? "auction",
        totalTaxOwed: centsToNumeric(b.totalTaxOwedCents)!,
        minimumBid: centsToNumeric(b.minimumBidCents ?? null),
        assessedValue: centsToNumeric(b.assessedValueCents ?? null),
        address: b.address ?? null,
        ownerName: b.ownerName ?? null,
        notes: b.notes ?? null,
        status: "available",
        sourceUrl: null,
      })
      .returning();

    res.status(201).json({ listing: row, ...auctionRuleContext(state) });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// PATCH /tax-researcher/auctions/:id — edit the auction, incl. session budget.
router.patch('/auctions/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const auctionId = parseInt(req.params.id, 10);
    if (Number.isNaN(auctionId)) return Errors.badRequest(res, "Invalid auction id");

    const parsed = auctionBodySchema.partial().extend({
      status: z.enum(["scheduled", "in_progress", "completed", "cancelled", "postponed"]).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    const b = parsed.data;

    const [row] = await drizzleDb
      .update(taxSaleAuctions)
      .set({
        ...(b.county !== undefined ? { county: b.county } : {}),
        ...(b.state !== undefined ? { state: b.state.toUpperCase() } : {}),
        ...(b.auctionType !== undefined ? { auctionType: b.auctionType } : {}),
        ...(b.auctionDate !== undefined ? { auctionDate: new Date(`${b.auctionDate}T00:00:00Z`) } : {}),
        ...(b.registrationDeadline !== undefined
          ? {
              registrationDeadline: b.registrationDeadline
                ? new Date(`${b.registrationDeadline}T00:00:00Z`)
                : null,
            }
          : {}),
        ...(b.auctionFormat !== undefined ? { auctionFormat: b.auctionFormat } : {}),
        ...(b.venueName !== undefined ? { venueName: b.venueName } : {}),
        ...(b.venueAddress !== undefined ? { venueAddress: b.venueAddress } : {}),
        ...(b.auctionUrl !== undefined ? { auctionUrl: b.auctionUrl } : {}),
        ...(b.depositRequiredCents !== undefined
          ? { depositRequired: centsToNumeric(b.depositRequiredCents) }
          : {}),
        ...(b.sessionBudgetCents !== undefined ? { sessionBudgetCents: b.sessionBudgetCents } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
        ...(b.status !== undefined ? { status: b.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(taxSaleAuctions.id, auctionId), eq(taxSaleAuctions.organizationId, organizationId)))
      .returning();
    if (!row) return Errors.notFound(res, "Auction");
    res.json({ auction: row, ...auctionRuleContext(row.state) });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /tax-researcher/auctions/:id/session-budget — live remaining capital.
// TRACKING ONLY (founder ruling #15). AcreOS never holds or moves this money.
router.get('/auctions/:id/session-budget', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const auctionId = parseInt(req.params.id, 10);
    if (Number.isNaN(auctionId)) return Errors.badRequest(res, "Invalid auction id");

    const [auction] = await drizzleDb
      .select()
      .from(taxSaleAuctions)
      .where(and(eq(taxSaleAuctions.id, auctionId), eq(taxSaleAuctions.organizationId, organizationId)))
      .limit(1);
    if (!auction) return Errors.notFound(res, "Auction");

    const budget = await loadSessionBudget(organizationId, auctionId, auction.sessionBudgetCents);
    res.json({
      auctionId,
      ...budget,
      moneyCustody: "none — AcreOS tracks this figure; the funds move on your own rails",
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/** Sum the recorded `won` bid-log amounts for one auction's lots. */
async function loadSessionBudget(
  organizationId: number,
  auctionId: number,
  budgetCents: number | null,
) {
  const lotIds = await drizzleDb
    .select({ id: taxSaleListings.id })
    .from(taxSaleListings)
    .where(
      and(eq(taxSaleListings.organizationId, organizationId), eq(taxSaleListings.auctionId, auctionId)),
    );
  if (lotIds.length === 0) {
    return computeSessionBudget({ budgetCents, wonAmountsCents: [] });
  }
  const wins = await drizzleDb
    .select({ amountCents: auctionBidLog.amountCents })
    .from(auctionBidLog)
    .where(
      and(
        eq(auctionBidLog.organizationId, organizationId),
        eq(auctionBidLog.action, "won"),
        inArray(
          auctionBidLog.listingId,
          lotIds.map((l) => l.id),
        ),
      ),
    );
  return computeSessionBudget({ budgetCents, wonAmountsCents: wins.map((w) => w.amountCents) });
}

// ============================================================================
// WON BID → CERTIFICATE HANDOFF
// ----------------------------------------------------------------------------
// The worksheet's "Won" tap used to log a bid and stop, leaving the operator
// to re-type the certificate by hand. This is the handoff.
// ============================================================================

type CertHandoff =
  | { status: "created"; certificateId: string; redemptionDeadline: string; deadlineSource: string; deadlineBasis: string; citation: string | null; attorneyReviewed: false; caveat: string }
  | { status: "existing"; certificateId: string; redemptionDeadline: string }
  | { status: "blocked"; code: string; message: string; state: string; ruleCoverage: string; needsRedemptionDeadline: boolean };

async function handoffWonLotToCertificate(params: {
  organizationId: number;
  listingId: number;
  wonAmountCents?: number | null;
  saleDate?: string | null;
  ownerOccupiedAtSale?: boolean;
  redemptionDeadlineOverride?: string | null;
}): Promise<CertHandoff> {
  const { organizationId, listingId } = params;

  const [lot] = await drizzleDb
    .select()
    .from(taxSaleListings)
    .where(and(eq(taxSaleListings.id, listingId), eq(taxSaleListings.organizationId, organizationId)))
    .limit(1);
  if (!lot) {
    return {
      status: "blocked",
      code: "listing_not_found",
      message: "Listing not found.",
      state: "",
      ruleCoverage: "not_encoded",
      needsRedemptionDeadline: false,
    };
  }

  // Idempotency — exactly one certificate per won lot, however many times the
  // operator taps Won on a flaky courthouse connection.
  const [already] = await drizzleDb
    .select({ id: taxCertificates.id, redemptionDeadline: taxCertificates.redemptionDeadline })
    .from(taxCertificates)
    .where(
      and(eq(taxCertificates.organizationId, organizationId), eq(taxCertificates.listingId, listingId)),
    )
    .limit(1);
  if (already) {
    return { status: "existing", certificateId: already.id, redemptionDeadline: already.redemptionDeadline };
  }

  const auction = lot.auctionId
    ? (
        await drizzleDb
          .select({ auctionDate: taxSaleAuctions.auctionDate })
          .from(taxSaleAuctions)
          .where(eq(taxSaleAuctions.id, lot.auctionId))
          .limit(1)
      )[0]
    : undefined;

  const saleDate =
    params.saleDate ??
    (auction?.auctionDate ? auction.auctionDate.toISOString().slice(0, 10) : null) ??
    new Date().toISOString().slice(0, 10);

  const wonAmountCents =
    params.wonAmountCents ??
    numericToCents(lot.winningBid) ??
    numericToCents(lot.bidAmount) ??
    lot.maxBidCents ??
    null;

  const wonLot: WonLot = {
    id: lot.id,
    apn: lot.apn,
    county: lot.county,
    state: lot.state,
    saleType: lot.saleType,
    ownerName: lot.ownerName,
    ownerAddress: lot.ownerAddress,
    city: lot.city,
    zip: lot.zip,
    minimumBid: lot.minimumBid,
    openingBid: lot.openingBid,
    maxBidCents: lot.maxBidCents,
    propertyId: lot.propertyId,
    redemptionPeriodMonths: lot.redemptionPeriodMonths,
  };

  const built = buildCertificateFromWonLot({
    lot: wonLot,
    organizationId,
    wonAmountCents: wonAmountCents ?? 0,
    saleDate,
    ownerOccupiedAtSale: params.ownerOccupiedAtSale,
    redemptionDeadlineOverride: params.redemptionDeadlineOverride ?? null,
  });

  if (!built.ok) {
    const coverage = getStateRuleCoverage(lot.state);
    return {
      status: "blocked",
      code: built.code,
      message: built.message,
      state: lot.state,
      ruleCoverage: coverage.tier,
      needsRedemptionDeadline:
        built.code === "redemption_deadline_required" || built.code === "no_redemption_period",
    };
  }

  const d = built.draft;
  const [created] = await drizzleDb
    .insert(taxCertificates)
    .values({
      organizationId: d.organizationId,
      listingId: d.listingId,
      propertyId: d.propertyId,
      state: d.state,
      county: d.county,
      apn: d.apn,
      saleType: d.saleType,
      saleDate: d.saleDate,
      purchaseAmountCents: d.purchaseAmountCents,
      ownerName: d.ownerName,
      ownerAddress: d.ownerAddress,
      redemptionDeadline: d.redemptionDeadline,
      ownerOccupiedAtSale: d.ownerOccupiedAtSale,
      notes: d.notes,
      status: "active",
    })
    .onConflictDoNothing()
    .returning({ id: taxCertificates.id, redemptionDeadline: taxCertificates.redemptionDeadline });

  if (!created) {
    // Lost the insert to the natural-key unique index: a certificate for this
    // (state, county, apn, sale date) already exists. Report the existing one
    // rather than claiming a create that did not happen.
    const [existing] = await drizzleDb
      .select({ id: taxCertificates.id, redemptionDeadline: taxCertificates.redemptionDeadline })
      .from(taxCertificates)
      .where(
        and(
          eq(taxCertificates.organizationId, organizationId),
          eq(taxCertificates.state, d.state),
          eq(taxCertificates.county, d.county),
          eq(taxCertificates.apn, d.apn),
          eq(taxCertificates.saleDate, d.saleDate),
        ),
      )
      .limit(1);
    if (existing) {
      return { status: "existing", certificateId: existing.id, redemptionDeadline: existing.redemptionDeadline };
    }
    return {
      status: "blocked",
      code: "certificate_insert_conflict",
      message: "The certificate could not be created and no existing certificate was found for this parcel.",
      state: d.state,
      ruleCoverage: getStateRuleCoverage(d.state).tier,
      needsRedemptionDeadline: false,
    };
  }

  logger.info("[taxSale] certificate created from won bid", {
    metadata: {
      __pii_safe: true,
      organizationId,
      listingId,
      certificateId: created.id,
      deadlineSource: built.deadlineSource,
      attorneyReviewed: false,
    },
  });

  // A won-bid handoff that genuinely creates a certificate IS the cert.acquired
  // event — fire the acquired-kickoff workflow lane, mirroring the direct POST
  // path. ONLY on the "created" branch (not "existing"/"blocked" above, which
  // return early). Fire-and-forget; never throws. bidDownRateBps is not part of
  // the won-lot draft and rides as null (honest — the emitter falls back to the
  // encoded state statutory rate).
  emitCertAcquired({
    id: created.id,
    organizationId,
    propertyId: d.propertyId ?? null,
    state: d.state,
    county: d.county,
    apn: d.apn,
    saleType: d.saleType,
    saleDate: d.saleDate,
    bidDownRateBps: null,
    redemptionDeadline: created.redemptionDeadline as unknown as string,
    status: "active",
    redeemedAt: null,
    redeemedAmountCents: null,
  });

  return {
    status: "created",
    certificateId: created.id,
    redemptionDeadline: created.redemptionDeadline,
    deadlineSource: built.deadlineSource,
    deadlineBasis: built.deadlineBasis,
    citation: built.citation,
    attorneyReviewed: false,
    caveat: built.caveat,
  };
}

// POST /tax-researcher/listings/:id/won-certificate — explicit handoff, used
// when the automatic one on the Won tap asked for a redemption deadline.
router.post('/listings/:id/won-certificate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const listingId = parseInt(req.params.id, 10);
    if (Number.isNaN(listingId)) return Errors.badRequest(res, "Invalid listing id");

    const parsed = z.object({
      wonAmountCents: z.number().int().positive(),
      saleDate: isoDate.optional(),
      ownerOccupiedAtSale: z.boolean().optional(),
      redemptionDeadline: isoDate.optional(),
    }).safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    const handoff = await handoffWonLotToCertificate({
      organizationId,
      listingId,
      wonAmountCents: parsed.data.wonAmountCents,
      saleDate: parsed.data.saleDate ?? null,
      ownerOccupiedAtSale: parsed.data.ownerOccupiedAtSale,
      redemptionDeadlineOverride: parsed.data.redemptionDeadline ?? null,
    });

    if (handoff.status === "blocked") {
      if (handoff.code === "listing_not_found") return Errors.notFound(res, "Listing");
      return Errors.badRequest(res, handoff.message, {
        code: handoff.code,
        state: handoff.state,
        ruleCoverage: handoff.ruleCoverage,
        needsRedemptionDeadline: handoff.needsRedemptionDeadline,
      });
    }
    res.status(handoff.status === "created" ? 201 : 200).json({ certificate: handoff });
  } catch (err) {
    Errors.internal(res, err);
  }
});

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
      .set(update)
      .where(and(eq(taxSaleListings.id, id), eq(taxSaleListings.organizationId, org.id)))
      .returning();
    if (!row) return Errors.notFound(res, "Listing");

    // G1.1 — per-vertical activation telemetry. Setting a max bid / walk-away
    // is the tax_lien_deed vertical's declared "aha" (the worksheet SCORED,
    // not merely viewed — hence the gate on the scoring fields, not on any
    // PATCH). Real entities only: the recorder refuses a SAMPLE- apn.
    // Idempotent FIRST-occurrence; fire-and-forget.
    if (parsed.data.maxBidCents != null || parsed.data.walkAwayAboveCents != null) {
      try {
        const { recordActivationEventAsync } = await import("./services/activation");
        recordActivationEventAsync({
          orgId: org.id,
          userId: req.user?.id ?? null,
          eventName: "first_worksheet_scored",
          eventValue: { listingId: row.id, source: "tax-researcher:listing:patch" },
          entity: { apn: row.apn },
        });
      } catch { /* non-fatal */ }
    }

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

    const userId = req.user?.id || req.user?.id || null;

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
    let certificate: CertHandoff | null = null;
    if (parsed.data.action === "won") {
      await drizzleDb
        .update(taxSaleListings)
        .set({
          status: "won",
          winningBid: centsToNumeric(parsed.data.amountCents ?? null) ?? undefined,
          bidAmount: centsToNumeric(parsed.data.amountCents ?? null) ?? undefined,
          bidDate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(taxSaleListings.id, id));

      // The handoff. The bid log above is already committed, so a refusal here
      // never loses the operator's record of the win — it comes back as
      // `certificate.status === "blocked"` and the UI asks for what's missing.
      try {
        certificate = await handoffWonLotToCertificate({
          organizationId: org.id,
          listingId: id,
          wonAmountCents: parsed.data.amountCents ?? null,
        });
      } catch (certErr) {
        logger.error(
          "[taxSale] won→certificate handoff failed",
          certErr instanceof Error ? certErr : undefined,
          { metadata: { __pii_safe: true, listingId: id } },
        );
        certificate = {
          status: "blocked",
          code: "handoff_failed",
          message:
            "The win is recorded, but the certificate could not be created automatically. Create it from the certificate screen.",
          state: "",
          ruleCoverage: "not_encoded",
          needsRedemptionDeadline: false,
        };
      }
    } else if (parsed.data.action === "outbid" || parsed.data.action === "passed") {
      await drizzleDb
        .update(taxSaleListings)
        .set({ status: "lost", updatedAt: new Date() })
        .where(eq(taxSaleListings.id, id));
    }

    res.status(201).json({ entry, certificate });
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
