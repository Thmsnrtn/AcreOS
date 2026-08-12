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

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireFounder } from "./auth/clerkAuth";
import { addMonths } from "./utils/dateUtils";

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

export async function registerEliteFeatureRoutes(app: Express): Promise<void> {

  // ============================================
  // PAYMENT-TYPE: SCHEDULED vs UNSCHEDULED PAYMENT TYPES
  // Scheduled: moves next payment date forward, triggers service fees
  // Unscheduled: early/extra payment, no date change, no service fee trigger
  // ============================================

  app.post("/api/notes/:id/record-payment", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.id);
      const {
        amount,
        paymentDate,
        paymentType = "scheduled", // "scheduled" | "unscheduled"
        paymentMethod,
        transactionId,
        notes: paymentNotes,
      } = req.body;

      if (!amount || !paymentDate) {
        return Errors.badRequest(res, "amount and paymentDate are required");
      }

      const [note] = await db.select().from(notes)
        .where(and(eq(notes.id, noteId), eq(notes.organizationId, org.id)));

      if (!note) return Errors.notFound(res, "Note");

      const currentBalance = parseFloat(note.currentBalance || "0");
      const interestRate = parseFloat(note.interestRate || "0");
      const monthlyRate = interestRate / 100 / 12;
      const paidAmount = parseFloat(amount);

      // Calculate principal/interest split
      const interestDue = currentBalance * monthlyRate;
      const principalPaid = Math.max(0, paidAmount - interestDue);
      const newBalance = Math.max(0, currentBalance - principalPaid);

      // Service fee only applies to SCHEDULED payments (standard parity)
      const serviceFeeAmount = paymentType === "scheduled"
        ? parseFloat(note.serviceFee || "0")
        : 0;

      // Tax escrow credit only on SCHEDULED payments
      if (paymentType === "scheduled" && note.taxEscrowEnabled) {
        await propertyTaxService.creditMonthlyTaxEscrow(noteId, org.id);
      }

      // Insert payment record
      await db.insert((await import("@shared/schema")).payments).values({
        organizationId: org.id,
        noteId,
        amount: String(paidAmount),
        principalAmount: String(principalPaid),
        interestAmount: String(Math.min(paidAmount, interestDue)),
        feeAmount: String(serviceFeeAmount),
        lateFeeAmount: "0",
        paymentDate: new Date(paymentDate),
        dueDate: note.nextPaymentDate || new Date(paymentDate),
        paymentMethod: paymentMethod || note.paymentMethod || "manual",
        transactionId,
        status: "completed",
        processedAt: new Date(),
      });

      // Update note balance
      const updateData: any = { currentBalance: String(newBalance) };

      // Only advance next payment date for SCHEDULED payments
      if (paymentType === "scheduled" && note.nextPaymentDate) {
        const nextDate = addMonths(new Date(note.nextPaymentDate), 1);
        updateData.nextPaymentDate = nextDate;
      }

      // Check if paid off
      if (newBalance <= 0) {
        updateData.status = "paid_off";
        updateData.autoPayEnabled = false;
      }

      await db.update(notes).set(updateData).where(eq(notes.id, noteId));

      res.json({
        success: true,
        paymentType,
        principalPaid: Math.round(principalPaid * 100) / 100,
        interestPaid: Math.round(Math.min(paidAmount, interestDue) * 100) / 100,
        serviceFeeTrigger: serviceFeeAmount > 0,
        newBalance: Math.round(newBalance * 100) / 100,
        paidOff: newBalance <= 0,
        nextPaymentDateAdvanced: paymentType === "scheduled",
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

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

  // Webhook verification challenge
  app.get("/api/webhooks/meta-lead-ads", (req: Request, res: Response) => {
    const challenge = metaAdsService.verifyMetaWebhook(
      req.query["hub.mode"] as string,
      req.query["hub.verify_token"] as string,
      req.query["hub.challenge"] as string
    );
    if (challenge) return res.send(challenge);
    res.status(403).send("Forbidden");
  });

  // Lead Ad submission webhook — verify X-Hub-Signature-256 (DEFECT-0008)
  app.post("/api/webhooks/meta-lead-ads", async (req: Request, res: Response) => {
    try {
      // Verify Meta webhook signature
      const signature = req.headers["x-hub-signature-256"] as string;
      const appSecret = process.env.META_APP_SECRET;
      if (appSecret && signature) {
        const crypto = await import("crypto");
        const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(body).digest("hex");
        if (signature !== expected) {
          logger.warn("[meta-leads] Webhook signature mismatch — rejecting");
          return Errors.unauthorized(res);
        }
      }

      const entries = req.body?.entry || [];
      for (const entry of entries) {
        for (const change of entry.changes || []) {
          if (change.field === "leadgen") {
            const { leadgen_id, form_id, ad_id, campaign_name, page_id } = change.value || {};
            // Determine org from page_id mapping (simplified: use default org for now)
            const orgId = parseInt(process.env.DEFAULT_ORG_ID || "1");
            await metaAdsService.processLeadAdSubmission(
              orgId, leadgen_id, form_id, ad_id, campaign_name
            );
          }
        }
      }
      res.json({ success: true });
    } catch (err: any) {
      logger.error("Meta Lead Ads webhook error", err);
      Errors.internal(res, err);
    }
  });

  // FOUNDER-ONLY, and it should have been from the start.
  //
  // `metaAdsService` posts to graph.facebook.com against META_AD_ACCOUNT_ID
  // with META_ACCESS_TOKEN — ONE PLATFORM AD ACCOUNT FOR ALL ORGS. So a
  // campaign created here spends AcreOS's money, and this route was gated by
  // `[isAuthenticated, getOrCreateOrg]` alone: any member, va or viewer of any
  // organization could open it, name their own `dailyBudgetCents`, and bill it
  // to the platform. No cap, no credit deduction, no simulation guard.
  //
  // The founder has already ruled on this exact shape, IN THIS FILE, twenty
  // lines below: the ACTUM ACH endpoints were deleted on 2026-07-29 ("be the
  // rail, not the provider") because one platform ACTUM_MERCHANT_ID for all
  // orgs meant money moving on AcreOS's own account. The ads routes are the
  // same pattern and were not brought under the same ruling — a rule applied
  // to some surfaces and not others, at the highest stakes in the repo.
  //
  // Gated rather than deleted: deleting live routes is the founder's call and
  // the ACTUM precedent says that is how it gets made. See BLOCKERS B11.
  app.post("/api/meta-ads/campaigns", ...auth, requireFounder, async (req: Request, res: Response) => {
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

  app.get("/api/meta-ads/campaigns/:campaignId/stats", ...auth, async (req: Request, res: Response) => {
    try {
      const stats = await metaAdsService.getAdPerformance(req.params.campaignId);
      res.json(stats);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Founder-only for the same reason: it writes into the PLATFORM catalog on
  // the platform's ad account, using the platform token.
  app.post("/api/meta-ads/sync-catalog", ...auth, requireFounder, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const { catalogId } = req.body;
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
      const { platforms, overrides } = req.body;

      if (!platforms?.length) return Errors.badRequest(res, "platforms array required");

      // Load property from listing
      const { storage } = await import("./storage");
      const listing = await storage.getPropertyListing(org.id, parseInt(req.params.id));
      if (!listing) return Errors.notFound(res, "Listing");

      const [property] = await db.select().from(properties)
        .where(and(eq(properties.id, listing.propertyId), eq(properties.organizationId, org.id)));

      const [orgData] = await db.select().from(organizations).where(eq(organizations.id, org.id));

      const normalizedListing = await listingSyndication.buildNormalizedListing(property, orgData, {
        askingPrice: parseFloat(listing.askingPrice || "0"),
        sellerFinancingAvailable: listing.sellerFinancingAvailable || false,
        downPaymentMin: listing.downPaymentMin ? parseFloat(listing.downPaymentMin) : undefined,
        monthlyPaymentMin: listing.monthlyPaymentMin ? parseFloat(listing.monthlyPaymentMin) : undefined,
        interestRate: listing.interestRate ? parseFloat(listing.interestRate) : undefined,
        ...overrides,
      });

      const results = await listingSyndication.syndicateListing(normalizedListing, platforms);
      res.json({ results });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/syndication/take-down", ...auth, async (req: Request, res: Response) => {
    try {
      const { platform, externalListingId } = req.body;
      const result = await listingSyndication.takeDownListing(platform, externalListingId);
      res.json(result);
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

  app.get("/api/bookkeeping/1099-int", ...auth, async (req: Request, res: Response) => {
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

  app.get("/api/bookkeeping/portfolio-summary", ...auth, async (req: Request, res: Response) => {
    try {
      const org = req.organization;
      const taxYear = parseInt(req.query.year as string) || new Date().getFullYear() - 1;
      const summary = await bookkeeping.getPortfolioAnnualSummary(org.id, taxYear);
      res.json(summary);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

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

  // Create a task — REFUSED, because it never stored one.
  //
  // `vaManagement.createTask` is a PURE FUNCTION: it stamps an id and
  // timestamps onto its input and returns the object. Nothing persisted it.
  // `VA_TASKS_KEY = "va_tasks"` is declared in that module and never used, and
  // no code anywhere in the repo writes `settings.va_tasks` — the only write is
  // a jsonb_set inside `/api/va/tasks/:id/verify`, which read-modify-writes an
  // array nothing ever populates.
  //
  // So this returned 200 with a task-shaped object that existed only in the
  // response body. A caller could not tell a stored record from a fabricated
  // one, which is the whole reason 501 is the honest answer and 200 was not.
  // See BLOCKERS B9 — building the persistence layer, or removing the
  // subsystem, is a founder decision; continuing to claim a save is not.
  app.post("/api/va/tasks", ...auth, (_req: Request, res: Response) => {
    return Errors.notImplemented(
      res,
      "VA tasks are not stored. There is no persistence layer behind this " +
        "endpoint — no code writes organizations.settings.va_tasks — so a task " +
        "created here would exist only in this response. See BLOCKERS B9.",
    );
  });

  // Update a task — REFUSED for the same reason, and one more.
  //
  // It took `{ task, updates }` FROM THE REQUEST BODY, merged them in memory
  // and returned the result. It never read or wrote storage, and it ignored
  // `:id` entirely — the caller supplied the record it was "updating", so the
  // endpoint was a merge function with a URL.
  app.put("/api/va/tasks/:id", ...auth, (_req: Request, res: Response) => {
    return Errors.notImplemented(
      res,
      "VA tasks are not stored, so there is nothing here to update. This " +
        "endpoint merged two objects from the request body and ignored :id " +
        "entirely. See BLOCKERS B9.",
    );
  });

  logger.info("✅ Elite feature routes registered");
}
