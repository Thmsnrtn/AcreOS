/**
 * Elite Features Routes
 *
 * New API endpoints for:
 * - Property Tax Escrow (GET/POST/PUT on notes)
 * - E-Signing (send, status, webhook, cancel, remind)
 * - Automated Due Diligence Engine (run, get results)
 * - Meta Ads (Lead Ad webhook, campaign creation, stats)
 * - Actum Processing (profile creation, batch payment run)
 * - Listing Syndication (syndicate, update, take down)
 * - Bookkeeping (annual report, 1099s, P&L, QuickBooks)
 * - VA Management (tasks CRUD, SOPs, standup digest, metrics)
 * - State Document Config (get state requirements)
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";

// Services
import * as propertyTaxService from "./services/propertyTaxService";
import * as eSigningService from "./services/eSigningService";
import { runAutoDueDiligence } from "./services/dueDiligenceEngine";
import * as metaAdsService from "./services/metaAdsService";
import * as actumProcessing from "./services/actumProcessing";
import * as listingSyndication from "./services/listingSyndication";
import * as bookkeeping from "./services/bookkeeping";
import * as vaManagement from "./services/vaManagement";
import { getStateConfig, getDeedTypeLabel, getLandContractLabel, getRecordingEstimate, getTransferTaxAmount } from "./services/stateDocumentConfig";
import { db } from "./db";
import { properties, notes, organizations, generatedDocuments } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const auth = [isAuthenticated, getOrCreateOrg];

export async function registerEliteFeatureRoutes(app: Express): Promise<void> {

  // ============================================
  // PROPERTY TAX ESCROW
  // ============================================

  app.get("/api/notes/:id/tax-escrow", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.id);
      const status = await propertyTaxService.getNoteEscrowStatus(noteId, org.id);
      if (!status) return res.status(404).json({ message: "Note not found" });
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notes/:id/tax-escrow/enable", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.id);
      const { annualPropertyTax, nextTaxDueDate, countyTaxPortalUrl } = req.body;
      if (!annualPropertyTax || !nextTaxDueDate) {
        return res.status(400).json({ message: "annualPropertyTax and nextTaxDueDate required" });
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notes/:id/tax-escrow/disable", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      await propertyTaxService.disableTaxEscrow(org.id, parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notes/:id/tax-escrow/record-payment", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.id);
      const { taxYear, installment, amountPaid, paymentDate, countyConfirmationNumber, paymentMethod, notes: paymentNotes, receiptUrl, propertyId } = req.body;
      const result = await propertyTaxService.recordTaxPaymentFromEscrow(org.id, {
        noteId, propertyId, taxYear, installment, amountPaid: parseFloat(amountPaid),
        paymentDate: new Date(paymentDate), countyConfirmationNumber, paymentMethod,
        notes: paymentNotes, receiptUrl
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tax-escrow/portfolio-summary", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const summary = await propertyTaxService.getPortfolioTaxSummary(org.id);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tax-escrow/county-portal", ...auth, async (req: Request, res: Response) => {
    const { state, county } = req.query as { state: string; county: string };
    const url = propertyTaxService.getCountyTaxPortalUrl(state || "", county);
    res.json({ url });
  });

  // ============================================
  // E-SIGNING
  // ============================================

  app.post("/api/documents/:id/send-for-signature", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const documentId = parseInt(req.params.id);
      const { title, subject, message, signers, testMode, expiresAt } = req.body;

      if (!signers?.length) return res.status(400).json({ message: "At least one signer required" });

      const result = await eSigningService.sendDocumentForSignature({
        documentId, organizationId: org.id, title, subject, message,
        signers, testMode: testMode ?? (process.env.NODE_ENV !== "production"),
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/esign/status/:signatureRequestId", ...auth, async (req: Request, res: Response) => {
    try {
      const status = await eSigningService.getSignatureRequestStatus(req.params.signatureRequestId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/esign/remind/:signatureRequestId", ...auth, async (req: Request, res: Response) => {
    try {
      const { signerEmail } = req.body;
      await eSigningService.resendSignatureReminder(req.params.signatureRequestId, signerEmail);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/esign/cancel/:signatureRequestId", ...auth, async (req: Request, res: Response) => {
    try {
      await eSigningService.cancelSignatureRequest(req.params.signatureRequestId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Webhook from Dropbox Sign (no auth — signature verified by HMAC header)
  app.post("/api/webhooks/dropbox-sign", async (req: Request, res: Response) => {
    try {
      await eSigningService.processDropboxSignWebhook(req.body);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Dropbox Sign webhook error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // AUTOMATED DUE DILIGENCE ENGINE
  // ============================================

  app.post("/api/properties/:id/auto-due-diligence", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.id);

      const [property] = await db.select().from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, org.id)));

      if (!property) return res.status(404).json({ message: "Property not found" });

      const lat = property.latitude ? parseFloat(String(property.latitude)) : req.body.lat;
      const lng = property.longitude ? parseFloat(String(property.longitude)) : req.body.lng;

      if (!lat || !lng) {
        return res.status(400).json({ message: "Property latitude/longitude required to run due diligence" });
      }

      const acreage = property.sizeAcres ? parseFloat(String(property.sizeAcres)) : undefined;
      const report = await runAutoDueDiligence(propertyId, org.id, lat, lng, acreage);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

  // Lead Ad submission webhook
  app.post("/api/webhooks/meta-lead-ads", async (req: Request, res: Response) => {
    try {
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
      console.error("Meta Lead Ads webhook error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/meta-ads/campaigns", ...auth, async (req: Request, res: Response) => {
    try {
      const {
        propertyId, campaignName, dailyBudgetCents, targetStates, targetZipCodes,
        targetRadiusMiles, targetLat, targetLng, listingUrl, imageUrl, headline,
        primaryText, callToAction
      } = req.body;
      const org = (req as any).organization;
      const result = await metaAdsService.createLandListingCampaign({
        propertyId, orgId: org.id, campaignName, dailyBudgetCents,
        targetStates, targetZipCodes, targetRadiusMiles, targetLat, targetLng,
        listingUrl, imageUrl, headline, primaryText, callToAction
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/meta-ads/campaigns/:campaignId/stats", ...auth, async (req: Request, res: Response) => {
    try {
      const stats = await metaAdsService.getAdPerformance(req.params.campaignId);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/meta-ads/sync-catalog", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const { catalogId } = req.body;
      const appUrl = process.env.APP_URL || req.headers.origin as string;
      const result = await metaAdsService.syncPropertyCatalog(org.id, catalogId, appUrl);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // ACTUM PROCESSING (ACH)
  // ============================================

  app.post("/api/actum/create-profile", ...auth, async (req: Request, res: Response) => {
    try {
      const { firstName, lastName, email, routingNumber, accountNumber, accountType, bankName } = req.body;
      const result = await actumProcessing.createActumPaymentProfile({
        firstName, lastName, email, routingNumber, accountNumber, accountType, bankName
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/actum/batch-payment-run", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const result = await actumProcessing.runMonthlyActumPaymentBatch(org.id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/actum/ach-return-codes", ...auth, (req: Request, res: Response) => {
    res.json(actumProcessing.ACH_RETURN_CODES);
  });

  // Actum webhook
  app.post("/api/webhooks/actum", async (req: Request, res: Response) => {
    try {
      await actumProcessing.processActumWebhook(req.body);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Actum webhook error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // LISTING SYNDICATION
  // ============================================

  app.get("/api/syndication/platforms", ...auth, (req: Request, res: Response) => {
    res.json(Object.values(listingSyndication.PLATFORMS));
  });

  app.post("/api/listings/:id/syndicate", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const { platforms, overrides } = req.body;

      if (!platforms?.length) return res.status(400).json({ message: "platforms array required" });

      // Load property from listing
      const { storage } = await import("./storage");
      const listing = await storage.getPropertyListing(org.id, parseInt(req.params.id));
      if (!listing) return res.status(404).json({ message: "Listing not found" });

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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/syndication/take-down", ...auth, async (req: Request, res: Response) => {
    try {
      const { platform, externalListingId } = req.body;
      const result = await listingSyndication.takeDownListing(platform, externalListingId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // BOOKKEEPING & TAX
  // ============================================

  app.get("/api/bookkeeping/annual-interest-report", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const taxYear = parseInt(req.query.year as string) || new Date().getFullYear() - 1;
      const report = await bookkeeping.generateAnnualInterestReport(org.id, taxYear);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/bookkeeping/1099-int", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const taxYear = parseInt(req.query.year as string) || new Date().getFullYear() - 1;
      const forms = await bookkeeping.generate1099IntForms(org.id, taxYear);
      res.json({ taxYear, forms });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/bookkeeping/portfolio-summary", ...auth, async (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const taxYear = parseInt(req.query.year as string) || new Date().getFullYear() - 1;
      const summary = await bookkeeping.getPortfolioAnnualSummary(org.id, taxYear);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/bookkeeping/quickbooks/auth-url", ...auth, (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const url = bookkeeping.getQboOAuthUrl(org.id);
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // STATE DOCUMENT CONFIG
  // ============================================

  app.get("/api/state-documents/:state", ...auth, (req: Request, res: Response) => {
    const config = getStateConfig(req.params.state);
    if (!config) return res.status(404).json({ message: "State not found" });
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
      res.status(500).json({ message: err.message });
    }
  });

  // Calculate VA metrics
  app.post("/api/va/metrics", ...auth, (req: Request, res: Response) => {
    try {
      const { tasks, userId, period } = req.body;
      const metrics = vaManagement.calculateVaMetrics(tasks || [], userId, period || "week");
      res.json(metrics);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create a task
  app.post("/api/va/tasks", ...auth, (req: Request, res: Response) => {
    try {
      const org = (req as any).organization;
      const task = vaManagement.createTask({ ...req.body, organizationId: org.id });
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update a task
  app.put("/api/va/tasks/:id", ...auth, (req: Request, res: Response) => {
    try {
      const { task, updates } = req.body;
      const updated = vaManagement.updateTask(task, updates);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  console.log("✅ Elite feature routes registered");
}
