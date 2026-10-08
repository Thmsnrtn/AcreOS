/**
 * Elite Features Routes
 *
 * New API endpoints for:
 * - Property Tax Escrow (GET/POST/PUT on notes)
 * - E-Signing (send, status, webhook, cancel, remind)
 * - Automated Due Diligence Engine (run, get results)
 * - Meta Ads (Lead Ad webhook, campaign creation, stats)
 * - Listing Syndication (syndicate, update, take down)
 * - Bookkeeping (annual report, 1099s, P&L, QuickBooks)
 * - VA Management (tasks CRUD, SOPs, standup digest, metrics)
 * - State Document Config (get state requirements)
 */

import { OCCUPIED_TARGET_STATUSES, MANUAL_POSTING } from "./services/listingWithdrawal";
import { offerabilityRefusal } from "./services/listability";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { getOrganization, getOrganizationId, type AuthenticatedRequest } from "./types/request";
import { requireFounder } from "./auth/clerkAuth";
import { verifyMetaWebhookSignature } from "./middleware/metaWebhookSignature";
import { addMonths } from "./utils/dateUtils";
import { resolveFounderOrganization } from "./services/founder";
import { requireQualified1099Output } from "./services/form1099Refusal";

// Services
import * as propertyTaxService from "./services/propertyTaxService";
import { runAutoDueDiligence } from "./services/dueDiligenceEngine";
import * as metaAdsService from "./services/metaAdsService";
import * as listingSyndication from "./services/listingSyndication";
import * as bookkeeping from "./services/bookkeeping";
import * as vaManagement from "./services/vaManagement";
import { getStateConfig, getDeedTypeLabel, getLandContractLabel, getRecordingEstimate, getTransferTaxAmount } from "./services/stateDocumentConfig";
import { db } from "./db";
import { properties, notes, organizations, generatedDocuments, organizationIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";

const auth = [isAuthenticated, getOrCreateOrg];

/**
 * Daily ceiling on the PLATFORM ad account, in cents. $500/day — the same
 * figure as the constitution's founder-only spend hard-stop, deliberately.
 * Raising it is a code change someone has to justify, not a request field.
 */
const MAX_DAILY_AD_BUDGET_CENTS = 50_000;

// ── VA task + SOP request shapes (BLOCKERS B9, founder ruling 2026-08-13) ────
//
// Validated rather than spread: these endpoints now WRITE, and the previous
// versions took whole objects from the request body — the update endpoint took
// the record it was "updating" from the caller. `organizationId` is absent from
// every shape below on purpose; it comes from the authenticated request, never
// from the body.
const VA_TASK_CATEGORY = z.enum([
  "research", "outreach", "data_entry", "document_prep",
  "follow_up", "marketing", "admin", "other",
]);
const VA_TASK_PRIORITY = z.enum(["low", "medium", "high", "urgent"]);
const VA_TASK_STATUS = z.enum([
  "pending", "in_progress", "completed", "blocked", "cancelled",
]);

const createVaTaskSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  category: VA_TASK_CATEGORY.optional(),
  priority: VA_TASK_PRIORITY.optional(),
  status: VA_TASK_STATUS.optional(),
  assignedToUserId: z.string().min(1).max(255).optional(),
  leadId: z.number().int().positive().optional(),
  propertyId: z.number().int().positive().optional(),
  dealId: z.number().int().positive().optional(),
  noteId: z.number().int().positive().optional(),
  sopId: z.string().max(100).optional(),
  dueDate: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().nonnegative().max(10_000).optional(),
});

const updateVaTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  category: VA_TASK_CATEGORY.optional(),
  priority: VA_TASK_PRIORITY.optional(),
  status: VA_TASK_STATUS.optional(),
  assignedToUserId: z.string().min(1).max(255).optional(),
  dueDate: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().nonnegative().max(10_000).optional(),
  actualMinutes: z.number().int().nonnegative().max(10_000).optional(),
  completionNotes: z.string().max(5000).optional(),
  attachmentUrls: z.array(z.string().url()).max(20).optional(),
  loomUrl: z.string().url().optional(),
  // completedAt / startedAt are DERIVED from the status transition, never
  // accepted: a caller-supplied completion time is how "tasks completed this
  // week" becomes a number someone typed.
});

const listVaTasksSchema = z.object({
  assignedToUserId: z.string().min(1).max(255).optional(),
  status: VA_TASK_STATUS.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const createVaSopSchema = z.object({
  title: z.string().min(1).max(300),
  category: VA_TASK_CATEGORY.optional(),
  description: z.string().max(5000).optional(),
  steps: z
    .array(
      z.object({
        stepNumber: z.number().int().positive(),
        instruction: z.string().min(1).max(2000),
        videoUrl: z.string().url().optional(),
      }),
    )
    .max(50)
    .optional(),
  estimatedMinutes: z.number().int().nonnegative().max(10_000).optional(),
  derivedFromDefaultTitle: z.string().max(300).optional(),
});

export async function registerEliteFeatureRoutes(app: Express): Promise<void> {

  // ============================================
  // PAYMENT-TYPE: SCHEDULED vs UNSCHEDULED PAYMENT TYPES
  // Scheduled: moves next payment date forward, triggers service fees
  // Unscheduled: early/extra payment, no date change, no service fee trigger
  // ============================================

  // POST /api/notes/:id/record-payment — DELETED 2026-08-13 (founder ruling on
  // BLOCKERS B10: `acquired_notes` / `note_payments` is the successor to
  // `notes` / `payments`, so the legacy writers are a migration list and this
  // route was the named deletion candidate).
  //
  // It had NO caller. The record-payment modal posts to
  // `/api/notes/:id/payments` in routes-notes.ts — the cents-family route,
  // which validates with zod, takes an Idempotency-Key, holds the note row
  // inside a transaction and returns a schedule and delinquency outcome. No
  // client, no OpenAPI entry, no test referenced this one.
  //
  // Five things were wrong with it, and the ruling makes fixing them wasted
  // work rather than four separate units:
  //
  //   1. It reimplemented the principal/interest split IN FLOATS —
  //      `interestDue = currentBalance * monthlyRate` — while
  //      `splitPaymentCents` exists and three of the four payment recorders use
  //      it. `shared/finance/cents.ts` states the house rule: money is summed
  //      and compared in integer cents, never in JS floats.
  //   2. NOT TRANSACTIONAL. A bare payment insert followed by a separate note
  //      update: a failure between them left a recorded payment against an
  //      unreduced balance. `storage.createPayment`, which this bypassed, wraps
  //      both in `withTransaction` with `SELECT FOR UPDATE` and a version check.
  //   3. It credited TAX ESCROW BEFORE the payment insert, so a later failure
  //      left an escrow credit with no payment behind it.
  //   4. The note UPDATE carried NO ORGANIZATION PREDICATE — `where(eq(notes.id,
  //      noteId))` alone, on money. The org-scoped SELECT above it gated the
  //      path in practice, which is why it was never exploitable, but it is
  //      exactly the shape check-org-scoped-fetch's rule 2 exists to catch.
  //   5. `const updateData: any` erased the type of the row being written.
  //
  // The legacy model's remaining writers are pinned by
  // tests/unit/legacyNoteModelIsTerminal.test.ts and may only shrink.

  // ============================================
  // PROPERTY TAX ESCROW
  // ============================================

  app.get("/api/notes/:id/tax-escrow", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.id);
      const status = await propertyTaxService.getNoteEscrowStatus(noteId, org.id);
      if (!status) return Errors.notFound(res, "Note");
      res.json(status);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/notes/:id/tax-escrow/enable", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.id);
      const { annualPropertyTax, nextTaxDueDate, countyTaxPortalUrl } = req.body;
      if (!annualPropertyTax || !nextTaxDueDate) {
        return Errors.badRequest(res, "annualPropertyTax and nextTaxDueDate required");
      }
      await propertyTaxService.enableTaxEscrow(
        org.id, noteId,
        parseFloat(annualPropertyTax),
        new Date(nextTaxDueDate),
        countyTaxPortalUrl
      );
      const status = await propertyTaxService.getNoteEscrowStatus(noteId, org.id);
      res.json({ success: true, escrowStatus: status });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/notes/:id/tax-escrow/disable", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      await propertyTaxService.disableTaxEscrow(org.id, parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/notes/:id/tax-escrow/record-payment", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.id);
      const { taxYear, installment, amountPaid, paymentDate, countyConfirmationNumber, paymentMethod, notes: paymentNotes, receiptUrl, propertyId } = req.body;
      const result = await propertyTaxService.recordTaxPaymentFromEscrow(org.id, {
        noteId, propertyId, taxYear, installment, amountPaid: parseFloat(amountPaid),
        paymentDate: new Date(paymentDate), countyConfirmationNumber, paymentMethod,
        notes: paymentNotes, receiptUrl
      });
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.get("/api/tax-escrow/portfolio-summary", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const summary = await propertyTaxService.getPortfolioTaxSummary(org.id);
      res.json(summary);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.get("/api/tax-escrow/county-portal", ...auth, async (req: Request, res: Response) => {
    const { state, county } = req.query as { state: string; county: string };
    const url = propertyTaxService.getCountyTaxPortalUrl(state || "", county);
    res.json({ url });
  });

  // ============================================
  // E-SIGNING — native flow only.
  //
  // The Dropbox Sign integration was removed; AcreOS ships its own
  // signing stack. Use the native endpoints:
  //   POST /api/generated-documents/:id/request-signature
  //   POST /api/public/sign/:docId
  // ============================================

  // ============================================
  // AUTOMATED DUE DILIGENCE ENGINE
  // ============================================

  app.post("/api/properties/:id/auto-due-diligence", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const propertyId = parseInt(req.params.id);

      const [property] = await db.select().from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, org.id)));

      if (!property) return Errors.notFound(res, "Property");

      const lat = property.latitude ? parseFloat(String(property.latitude)) : req.body.lat;
      const lng = property.longitude ? parseFloat(String(property.longitude)) : req.body.lng;

      if (!lat || !lng) {
        return Errors.badRequest(res, "Property latitude/longitude required to run due diligence");
      }

      const acreage = property.sizeAcres ? parseFloat(String(property.sizeAcres)) : undefined;
      const report = await runAutoDueDiligence(propertyId, org.id, lat, lng, acreage);
      res.json(report);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // META ADS
  // ============================================
  // The lead-ads webhook (GET + POST /api/webhooks/meta-lead-ads) is NOT here:
  // Meta carries no session, so it is registered ahead of the `/api` session
  // catch-all by `registerMetaLeadAdsWebhookRoutes` (bottom of this file).

  // ── META ADS: A FOUNDER INSTRUMENT, PERMANENTLY (founder ruling 2026-08-13) ──
  //
  // B11 asked whether paid advertising is a platform activity or a customer
  // feature. The founder answered: *"this was meant for me as the founder to run
  // ads for this AcreOS only. Never for a customer to be able to run their own
  // ads."* So the gate unit 50 added as an interim measure is the PERMANENT
  // answer, and these routes moved into the `/api/founder/*` instrument
  // namespace, where the URL itself states who they are for.
  //
  // WHY THE PLATFORM AD ACCOUNT IS CORRECT HERE AND FATAL FOR PAYMENTS.
  // `metaAdsService` posts to graph.facebook.com against META_AD_ACCOUNT_ID with
  // META_ACCESS_TOKEN — ONE PLATFORM AD ACCOUNT. Under "be the rail, not the
  // provider" (2026-07-29, which deleted the ACTUM ACH endpoints forty lines
  // below) that shape is fatal for CUSTOMER money: one platform
  // ACTUM_MERCHANT_ID for all orgs meant borrower money moving on AcreOS's own
  // merchant account. Advertising is the mirror image — AcreOS's own money, on
  // AcreOS's own account, spent by the only person authorised to spend it. No
  // customer money moves and no customer is a party to it. The ruling that
  // forbids the first is the ruling that permits this, and the only thing
  // keeping them apart is that there is NO CUSTOMER PATH IN. That is what the
  // gates below and the test are for.
  //
  // The $500/day ceiling stays even though the caller is the founder: the
  // hard-stop is "spends >$500 are founder-only", not "spends are unbounded once
  // a founder is on the call", and a typo in a cents field is three orders of
  // magnitude from its intent.
  //
  // Registered in shared/governance/constitution.ts as `ads.founder-only-rail`;
  // pinned by tests/unit/metaAdsFounderOnly.test.ts.
  app.post("/api/founder/meta-ads/campaigns", ...auth, requireFounder, async (req: Request, res: Response) => {
    try {
      const {
        propertyId, campaignName, dailyBudgetCents, targetStates, targetZipCodes,
        targetRadiusMiles, targetLat, targetLng, listingUrl, imageUrl, headline,
        primaryText, callToAction
      } = req.body;
      const org = req.organization;

      // A ceiling on a number that goes straight into `daily_budget`. The
      // founder gate makes this the founder's own spend, which is exactly why
      // a typo is still worth catching: the constitution's hard-stop is
      // "spends >$500 are founder-only", not "spends are unbounded once a
      // founder is on the call".
      const budget = Number(dailyBudgetCents);
      if (!Number.isInteger(budget) || budget <= 0) {
        return Errors.badRequest(res, "dailyBudgetCents must be a positive integer number of cents");
      }
      if (budget > MAX_DAILY_AD_BUDGET_CENTS) {
        return Errors.badRequest(
          res,
          `dailyBudgetCents ${budget} exceeds the ${MAX_DAILY_AD_BUDGET_CENTS}-cent daily ceiling ` +
            `on the platform ad account. Raise the ceiling deliberately, in code, rather than per request.`,
        );
      }
      const result = await metaAdsService.createLandListingCampaign({
        propertyId, orgId: org.id, campaignName, dailyBudgetCents,
        targetStates, targetZipCodes, targetRadiusMiles, targetLat, targetLng,
        listingUrl, imageUrl, headline, primaryText, callToAction
      });
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // This one carried NO founder gate until 2026-08-13 — `...auth` alone. Spend is
  // not the only thing worth withholding: `getAdPerformance` reads spend,
  // impressions, clicks and cost-per-lead for ANY campaign id on the platform ad
  // account, so any authenticated member of any org could read AcreOS's own
  // marketing performance by iterating ids. Gating creation and leaving the reads
  // open is the half-applied rule this whole block is about.
  app.get("/api/founder/meta-ads/campaigns/:campaignId/stats", ...auth, requireFounder, async (req: Request, res: Response) => {
    try {
      if (!metaAdsService.graphIdSegment(req.params.campaignId)) {
        return Errors.badRequest(res, "campaignId must be a Meta Graph object id (digits)");
      }
      const stats = await metaAdsService.getAdPerformance(req.params.campaignId);
      res.json(stats);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Founder-only for the same reason: it writes into the PLATFORM catalog on
  // the platform's ad account, using the platform token.
  app.post("/api/founder/meta-ads/sync-catalog", ...auth, requireFounder, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const { catalogId } = req.body;
      if (!metaAdsService.graphIdSegment(catalogId)) {
        return Errors.badRequest(res, "catalogId must be a Meta Graph object id (digits)");
      }
      const appUrl = process.env.APP_URL || req.headers.origin as string;
      const result = await metaAdsService.syncPropertyCatalog(org.id, catalogId, appUrl);
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // ACTUM PROCESSING (ACH) — DELETED 2026-07-29
  // --------------------------------------------
  // Founder ruling "be the rail, not the provider". These three endpoints made
  // AcreOS the merchant of record for every customer's borrower debits: one
  // platform ACTUM_MERCHANT_ID for all orgs, so borrower money would have moved
  // on AcreOS's own merchant account. Deleted:
  //   POST /api/actum/create-profile      — accepted RAW bank routing +
  //                                         account numbers in the request
  //                                         body. AcreOS must never receive
  //                                         them; the live rail collects bank
  //                                         details directly into the lender's
  //                                         own Stripe account and stores
  //                                         last4 only (achMandateSetup.ts).
  //   POST /api/actum/batch-payment-run   — called a runner that had already
  //                                         been retired to a refusal.
  //   GET  /api/actum/ach-return-codes    — read-only taxonomy dump, zero
  //                                         callers; the taxonomy is consumed
  //                                         server-side by achAutopay.ts.
  // What survives in server/services/actumProcessing.ts is ONLY the NACHA
  // R01–R29 return-code taxonomy, which is rail-agnostic and is what the live
  // Stripe us_bank_account autopay path classifies returns against.
  // ============================================
  // LISTING SYNDICATION
  // ============================================

  app.get("/api/syndication/platforms", ...auth, (req: Request, res: Response) => {
    res.json(Object.values(listingSyndication.PLATFORMS));
  });

  app.post("/api/listings/:id/syndicate", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      // No `overrides` (DEFECT-0182): the body could change the price and
      // terms a portal showed without the listing ever recording them.
      // Known platforms only, canonical (Lands of America posts as Land.com),
      // each once — or an alias re-posts over a live posting (DEFECT-0182 audit).
      const platforms = listingSyndication.normalizePlatformRequest((req.body as { platforms?: unknown })?.platforms);

      if (platforms.length === 0) return Errors.badRequest(res, "platforms array required (known platforms)");

      // Load property from listing
      const { storage } = await import("./storage");
      const listing = await storage.getPropertyListing(org.id, parseInt(req.params.id));
      if (!listing) return Errors.notFound(res, "Listing");
      // A withdrawn or sold listing is off the market; re-listing goes
      // through publish (DEFECT-0182).
      if (listing.status !== "active") {
        return Errors.badRequest(res, `This listing is ${listing.status}. Publish it first; channels only receive active listings.`);
      }
      // Never post a second copy onto a channel where one is live or still
      // coming down: the new external id would orphan the old posting, which
      // could then never be taken down.
      const priorTargets = listing.syndicationTargets ?? [];
      const occupied = platforms.filter((p) =>
        priorTargets.some((t) => listingSyndication.canonicalPlatform(t.platform) === p && OCCUPIED_TARGET_STATUSES.includes(t.status)),
      );
      if (occupied.length > 0) {
        return Errors.badRequest(
          res,
          `Already live or still being withdrawn on: ${occupied.join(", ")}. Take it down there first.`,
        );
      }

      const [property] = await db.select().from(properties)
        .where(and(eq(properties.id, listing.propertyId), eq(properties.organizationId, org.id)));
      if (!property) return Errors.notFound(res, "Property for listing");
      // Only land the org holds can be syndicated (DEFECT-0174).
      const notOfferable = offerabilityRefusal(property.status);
      if (notOfferable) return Errors.badRequest(res, notOfferable);

      const [orgData] = await db.select().from(organizations).where(eq(organizations.id, org.id));

      const normalizedListing = await listingSyndication.buildNormalizedListing(property, orgData, {
        askingPrice: parseFloat(listing.askingPrice || "0"),
        sellerFinancingAvailable: listing.sellerFinancingAvailable || false,
        downPaymentMin: listing.downPaymentMin ? parseFloat(listing.downPaymentMin) : undefined,
        monthlyPaymentMin: listing.monthlyPaymentMin ? parseFloat(listing.monthlyPaymentMin) : undefined,
        interestRate: listing.interestRate ? parseFloat(listing.interestRate) : undefined,
      });

      const results = await listingSyndication.syndicateListing(normalizedListing, platforms);
      // Record every outcome on the listing (DEFECT-0182): this returned the
      // results and saved nothing, so a posting made here had no stored
      // external id and could never be taken down.
      const nextTargets = [...priorTargets];
      for (const r of results) {
        const manual = r.success && r.requiresManualAction && !r.listingId;
        const record = {
          platform: listingSyndication.canonicalPlatform(r.platform),
          listingId: r.listingId,
          listingUrl: r.listingUrl,
          status: manual ? MANUAL_POSTING : r.success ? "active" : "failed",
          postedAt: r.success && !manual ? new Date().toISOString() : undefined,
          error: r.success ? undefined : r.error,
        };
        const idx = nextTargets.findIndex((t) => listingSyndication.canonicalPlatform(t.platform) === record.platform);
        if (idx >= 0) nextTargets[idx] = { ...nextTargets[idx], ...record };
        else nextTargets.push(record);
      }
      await storage.updatePropertyListing(listing.id, { syndicationTargets: nextTargets }, org.id);
      res.json({ results });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Take one syndicated listing down (DEFECT-0173). This accepted `platform`
  // and ANY `externalListingId` from the body and sent a DELETE with the
  // platform's own credentials — a request that could remove another
  // tenant's live listing — and reported success whatever the provider
  // answered. Now the caller names ITS listing; the external id comes from
  // that listing's saved target; the provider's answer decides the result,
  // which is written back to the target.
  app.post("/api/syndication/take-down", ...auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = getOrganization(req);
      const { storage } = await import("./storage");
      const listingId = Number(req.body?.listingId);
      const platform = typeof req.body?.platform === "string" ? req.body.platform : "";
      if (!Number.isInteger(listingId) || listingId <= 0 || !platform) {
        return Errors.badRequest(res, "listingId and platform are required");
      }
      const listing = await storage.getPropertyListing(org.id, listingId);
      if (!listing) return Errors.notFound(res, "Listing");
      const targets = (listing.syndicationTargets ?? []) as Array<{ platform: string; listingId?: string; status: string; error?: string }>;
      const target = targets.find((t) => t.platform === platform);
      if (!target || !target.listingId) {
        return Errors.notFound(res, "Syndicated listing on that platform");
      }
      if (!listingSyndication.TAKE_DOWN_PLATFORMS.includes(platform)) {
        return Errors.badRequest(res, `${platform} has no take-down API — remove it on the platform and record that here`);
      }
      const result = await listingSyndication.takeDownListing(
        platform as Parameters<typeof listingSyndication.takeDownListing>[0],
        target.listingId,
      );
      const updatedTargets = targets.map((t) =>
        t === target
          ? result.success
            ? { ...t, status: "removed", error: undefined, removalSource: "provider" as const, removedAt: new Date().toISOString(), removedBy: req.user?.id }
            : { ...t, status: "withdrawal_failed", error: result.error }
          : t,
      );
      await storage.updatePropertyListing(listing.id, { syndicationTargets: updatedTargets }, org.id);
      res.json({ ...result, platform, listingId: listing.id });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // BOOKKEEPING & TAX
  // ============================================

  app.get("/api/bookkeeping/annual-interest-report", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const taxYear = parseInt(req.query.year as string) || new Date().getFullYear() - 1;
      const report = await bookkeeping.generateAnnualInterestReport(org.id, taxYear);
      res.json(report);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // DEFECT-0101 — same refusal as GET /api/bookkeeping/1099; see form1099Refusal.ts.
  app.get("/api/bookkeeping/1099-int", ...auth, requireQualified1099Output(), async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const taxYear = parseInt(req.query.year as string) || new Date().getFullYear() - 1;
      const forms = await bookkeeping.generate1099IntForms(org.id, taxYear);
      res.json({ taxYear, forms });
    } catch (err: any) {
      if (err instanceof bookkeeping.TaxIdentityError) {
        return res.status(422).json({
          error: "tax_identity_missing",
          code: err.code,
          message: err.message,
          orgId: err.orgId,
          noteId: err.noteId,
        });
      }
      Errors.internal(res, err);
    }
  });

  // GET /api/bookkeeping/portfolio-summary lives in server/routes-bookkeeping.ts:107
  // (mounted at routes.ts:2265) — the single code path. The duplicate here was
  // dead AND worse: on `?year=abc` it silently reported last year's numbers under
  // the caller-supplied label, where the live one returns an explicit 400. For a
  // TAX report that difference matters. Do not re-add it.

  app.get("/api/bookkeeping/quickbooks/auth-url", ...auth, (req: Request, res: Response) => {
    try {
      if (!process.env.QBO_CLIENT_ID) {
        return res.status(503).json({
          error: "integration_not_configured",
          message: "QuickBooks integration is not enabled on this deployment (QBO_CLIENT_ID is not set).",
          statusCode: 503,
        });
      }
      const org = req.organization;
      const url = bookkeeping.getQboOAuthUrl(org.id);
      res.json({ url });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/bookkeeping/quickbooks/sync", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;

      // Retrieve stored QBO tokens from the integrations table
      const [integration] = await db
        .select()
        .from(organizationIntegrations)
        .where(and(eq(organizationIntegrations.organizationId, org.id), eq(organizationIntegrations.provider, "quickbooks")))
        .limit(1);

      if (!integration?.credentials) {
        return Errors.badRequest(res, "QuickBooks is not connected. Visit Settings > Integrations to connect.");
      }

      const creds = integration.credentials as any;
      if (!creds.accessToken || !creds.realmId) {
        return Errors.badRequest(res, "QuickBooks credentials incomplete. Please reconnect.");
      }

      // Default: sync payments from the last 30 days (or caller-supplied fromDate)
      const fromDate = req.body?.fromDate ? new Date(req.body.fromDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await bookkeeping.syncPaymentsToQbo(org.id, {
        accessToken: creds.accessToken,
        refreshToken: creds.refreshToken ?? "",
        realmId: creds.realmId,
        expiresAt: creds.expiresAt ?? "",
      }, fromDate);

      res.json({ success: true, ...result });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // STATE DOCUMENT CONFIG
  // ============================================

  app.get("/api/state-documents/:state", ...auth, (req: Request, res: Response) => {
    const config = getStateConfig(req.params.state);
    if (!config) return Errors.notFound(res, "State");
    res.json(config);
  });

  app.get("/api/state-documents/:state/recording-estimate", ...auth, (req: Request, res: Response) => {
    const pages = parseInt(req.query.pages as string) || 4;
    const estimate = getRecordingEstimate(req.params.state, pages);
    res.json({ state: req.params.state, estimatedFee: estimate, pageCount: pages });
  });

  app.get("/api/state-documents/:state/transfer-tax", ...auth, (req: Request, res: Response) => {
    const salePrice = parseFloat(req.query.salePrice as string) || 0;
    const tax = getTransferTaxAmount(req.params.state, salePrice);
    const config = getStateConfig(req.params.state);
    res.json({ state: req.params.state, salePrice, transferTax: tax, notes: config?.transferTaxNotes });
  });

  app.get("/api/state-documents", ...auth, (req: Request, res: Response) => {
    // Return summary of all states (just key fields for the picker)
    const { STATE_DOCUMENT_CONFIGS } = require("./services/stateDocumentConfig");
    const summary = Object.values(STATE_DOCUMENT_CONFIGS).map((c: any) => ({
      state: c.state,
      stateName: c.stateName,
      primaryDeedType: c.primaryDeedType,
      primaryDeedLabel: getDeedTypeLabel(c.primaryDeedType),
      landContractName: c.landContractName,
      landContractLabel: getLandContractLabel(c.landContractName),
      notaryRequired: c.notaryRequired,
      witnessCount: c.witnessCount,
      attorneyRequired: c.attorneyStateForClosing,
      lienInstrument: c.lienInstrument,
    }));
    res.json(summary);
  });

  // ============================================
  // VA MANAGEMENT
  // ============================================

  // Default SOPs
  app.get("/api/va/sops/defaults", ...auth, (req: Request, res: Response) => {
    res.json(vaManagement.DEFAULT_SOPS);
  });

  // Generate standup digest (uses org settings to store tasks)
  app.post("/api/va/standup-digest", ...auth, async (req: Request, res: Response) => {
    try {
      const { tasks, userId, vaName, date } = req.body;
      const digest = vaManagement.generateStandupDigest(
        tasks || [], userId, vaName, date ? new Date(date) : undefined
      );
      res.json(digest);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Calculate VA metrics
  app.post("/api/va/metrics", ...auth, (req: Request, res: Response) => {
    try {
      const { tasks, userId, period } = req.body;
      const metrics = vaManagement.calculateVaMetrics(tasks || [], userId, period || "week");
      res.json(metrics);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Create a task. This used to refuse with 501, and the refusal was right at
  // the time: `createTask` was a PURE FUNCTION that stamped an id onto its input
  // and returned it, so a 200 here described a record that existed only in that
  // response body. `VA_TASKS_KEY` was declared and never used; nothing in the
  // repo wrote `organizations.settings.va_tasks`.
  //
  // BLOCKERS B9 held the decision — build the layer or delete the subsystem —
  // and the founder ruled on 2026-08-13 to build it. `va_tasks` is a real table
  // with a migration (0235), and this endpoint now stores what it returns.
  app.post("/api/va/tasks", ...auth, async (req: Request, res: Response) => {
    try {
      const parsed = createVaTaskSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const task = await vaManagement.createTask(getOrganizationId(req), {
        ...parsed.data,
        // Who assigned it is the caller, not a request field — a body-supplied
        // assigner is an audit trail anyone can write their own name out of.
        assignedByUserId: req.user?.id,
      });
      // 200, not 201: the `res-status-raw` ratchet counts every `res.status(`
      // because that is how error responses bypass the Errors helpers, and a
      // status code no caller reads is not worth a line of that budget. The
      // created task, id and all, is in the body either way.
      res.json(task);
    } catch (err: unknown) {
      Errors.internal(res, err);
    }
  });

  // List tasks. NEW, and the reason the create endpoint is worth having: a
  // subsystem that can store a task but never show it back is the same dead end
  // in a different place.
  app.get("/api/va/tasks", ...auth, async (req: Request, res: Response) => {
    try {
      const parsed = listVaTasksSchema.safeParse(req.query);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const tasks = await vaManagement.listTasks(getOrganizationId(req), parsed.data);
      res.json({ tasks });
    } catch (err: unknown) {
      Errors.internal(res, err);
    }
  });

  // One task, or a 404 that does not confirm the row exists elsewhere.
  app.get("/api/va/tasks/:id", ...auth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return Errors.badRequest(res, "task id must be an integer");
      res.json(await vaManagement.getTask(getOrganizationId(req), id));
    } catch (err: unknown) {
      if (err instanceof vaManagement.VaTaskNotInOrgError) return Errors.notFound(res, "Task");
      Errors.internal(res, err);
    }
  });

  // Update a task. This also used to refuse, for one more reason than the
  // create did: it took `{ task, updates }` FROM THE REQUEST BODY, merged them
  // in memory, returned the result, and IGNORED `:id` entirely — a merge
  // function with a URL. It now reads the stored row within the caller's
  // organization, applies the patch, and derives the lifecycle stamps itself.
  app.put("/api/va/tasks/:id", ...auth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return Errors.badRequest(res, "task id must be an integer");
      const parsed = updateVaTaskSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      res.json(await vaManagement.updateTask(getOrganizationId(req), id, parsed.data));
    } catch (err: unknown) {
      if (err instanceof vaManagement.VaTaskNotInOrgError) return Errors.notFound(res, "Task");
      Errors.internal(res, err);
    }
  });

  // The org's own SOP library, which `SOP_LIBRARY_KEY` was declared for and
  // never written to. Distinct from GET /api/va/sops/defaults above: that
  // serves DEFAULT_SOPS, AcreOS's own procedure catalogue, versioned with the
  // code. This serves what the ORG wrote.
  app.get("/api/va/sops", ...auth, async (req: Request, res: Response) => {
    try {
      res.json({ sops: await vaManagement.listSops(getOrganizationId(req)) });
    } catch (err: unknown) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/va/sops", ...auth, async (req: Request, res: Response) => {
    try {
      const parsed = createVaSopSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const sop = await vaManagement.createSop(getOrganizationId(req), {
        ...parsed.data,
        createdByUserId: req.user?.id,
      });
      res.json(sop);
    } catch (err: unknown) {
      Errors.internal(res, err);
    }
  });

  logger.info("✅ Elite feature routes registered");
}

/**
 * Meta Lead Ads webhook — GET (subscription challenge) + POST (lead delivery).
 *
 * Registered by `registerRoutes` BEFORE the `/api` session catch-all, like the
 * other provider callbacks: Meta carries no session, and each half verifies
 * Meta itself, fail closed, before reading anything —
 *   GET  — `hub.verify_token` against META_WEBHOOK_VERIFY_TOKEN (constant time;
 *          unset token → refused);
 *   POST — `verifyMetaWebhookSignature`: X-Hub-Signature-256 over the RAW body
 *          keyed by META_APP_SECRET (unset secret or absent header → refused).
 * tests/unit/inboundWebhooksReachAnonymously.test.ts boots the app to pin both.
 *
 * WHERE THE LEADS GO (owner decision 2026-10-08). These are leads from
 * AcreOS's OWN lead ads — the founder-only ad rail (`ads.founder-only-rail`) —
 * so they belong to the FOUNDER's organisation, resolved by the canonical
 * `resolveFounderOrganization()`. The handler used to write into
 * `DEFAULT_ORG_ID`, else org 1: a guessed tenant, and on a multi-tenant
 * database org 1 can be a customer. Now, when the founder org cannot be named
 * unambiguously, NOTHING is written: the refusal is logged loudly with the
 * leadgen ids (Meta keeps each lead retrievable by id, so none is lost) and
 * Meta gets a 200, because a non-2xx makes Meta retry a delivery that will be
 * refused identically until the configuration is fixed.
 * Pinned by tests/unit/metaLeadAdsFounderOrg.test.ts.
 */
/** Meta's `hub.challenge` is an integer; nothing else is ever echoed. */
const META_CHALLENGE = /^\d{1,64}$/;

export function registerMetaLeadAdsWebhookRoutes(app: Express) {
  // Webhook verification challenge. Anonymous by design (Meta has no session),
  // so the echo is the reflected-XSS shape: `hub.challenge` comes from the
  // query string and goes back in the body. Meta's challenge is an integer, so
  // anything that is not 1–64 ASCII digits is refused BEFORE the token is
  // even compared, and the echo is sent as text/plain, never text/html.
  // Query values are read as strings only — `?hub.challenge=a&hub.challenge=b`
  // parses to an array, which is not a challenge.
  app.get("/api/webhooks/meta-lead-ads", (req: Request, res: Response) => {
    const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : "");
    const challengeParam = q("hub.challenge");
    const challenge = META_CHALLENGE.test(challengeParam)
      ? metaAdsService.verifyMetaWebhook(q("hub.mode"), q("hub.verify_token"), challengeParam)
      : null;
    if (challenge && META_CHALLENGE.test(challenge)) return res.type("text/plain").send(challenge);
    Errors.forbidden(res, "Meta webhook verification failed");
  });

  // Lead Ad submission webhook. The signature check used to live inline here and
  // was fail-open twice: no `META_APP_SECRET` meant no verification at all, and
  // a caller who simply OMITTED the header skipped it even when the secret was
  // set. This endpoint creates leads, so an unsigned POST wrote rows into a real
  // pipeline. `verifyMetaWebhookSignature` fails closed on both, hashes the raw
  // body rather than a re-serialisation of it, and compares in constant time —
  // the same shape as the Twilio and inbound-email verifiers.
  app.post("/api/webhooks/meta-lead-ads", verifyMetaWebhookSignature, async (req: Request, res: Response) => {
    try {
      const leadgen: Array<{ leadgen_id: string; form_id: string; ad_id: string; campaign_name: string }> = [];
      for (const entry of req.body?.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === "leadgen") leadgen.push(change.value || {});
        }
      }
      if (leadgen.length === 0) return res.json({ success: true, written: 0 });

      const destination = await resolveFounderOrganization();
      if (!destination.ok) {
        logger.error("[meta-lead-ads] founder organisation unresolved — refusing to write leads", {
          metadata: {
            detail: {
              reason: destination.reason,
              candidates: destination.candidates,
              leadgenIds: leadgen.map((l) => l.leadgen_id),
            },
          },
        });
        return res.json({ success: false, written: 0, refused: destination.reason });
      }

      let written = 0;
      for (const { leadgen_id, form_id, ad_id, campaign_name } of leadgen) {
        const r = await metaAdsService.processLeadAdSubmission(
          destination.organizationId, leadgen_id, form_id, ad_id, campaign_name
        );
        if (r.created) written++;
      }
      res.json({ success: true, written });
    } catch (err: any) {
      logger.error("Meta Lead Ads webhook error", err);
      Errors.internal(res, err);
    }
  });
}
