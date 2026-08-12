import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import {
  insertMarketingListSchema, insertOfferBatchSchema, insertOfferSchema,
  insertSellerCommunicationSchema, insertAdPostingSchema, insertBuyerPrequalificationSchema,
  insertCollectionSequenceSchema, insertCollectionEnrollmentSchema, insertCountyResearchSchema,
} from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { omitProtectedFields } from "./utils/updatePayload";

export async function registerVAEngineRoutes(app: Express): Promise<void> {
  const api = app;

  // MARKETING LISTS (VA Replacement Engine)
  // ============================================

  api.get("/api/marketing-lists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const lists = await storage.getMarketingLists(org.id);
      res.json(lists);
    } catch (error: any) {
      logger.error("Get marketing lists error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/marketing-lists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const list = await storage.getMarketingListById(org.id, id);
      if (!list) {
        return Errors.notFound(res, "Marketing list");
      }
      res.json(list);
    } catch (error: any) {
      logger.error("Get marketing list error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/marketing-lists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const validated = insertMarketingListSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const list = await storage.createMarketingList(validated);
      res.status(201).json(list);
    } catch (error: any) {
      logger.error("Create marketing list error", error);
      Errors.badRequest(res, error.message || "Failed to create marketing list");
    }
  });

  api.patch("/api/marketing-lists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getMarketingListById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Marketing list");
      }
      const list = await storage.updateMarketingList(org.id, id, omitProtectedFields(req.body));
      res.json(list);
    } catch (error: any) {
      logger.error("Update marketing list error", error);
      Errors.badRequest(res, error.message || "Failed to update marketing list");
    }
  });

  api.delete("/api/marketing-lists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getMarketingListById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Marketing list");
      }
      await storage.deleteMarketingList(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete marketing list error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // OFFER BATCHES (VA Replacement Engine)
  // ============================================

  api.get("/api/offer-batches", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const batches = await storage.getOfferBatches(org.id);
      res.json(batches);
    } catch (error: any) {
      logger.error("Get offer batches error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/offer-batches/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const batch = await storage.getOfferBatchById(org.id, id);
      if (!batch) {
        return Errors.notFound(res, "Offer batch");
      }
      const batchOffers = await storage.getOffersByBatch(org.id, id);
      res.json({ ...batch, offersCount: batchOffers.length });
    } catch (error: any) {
      logger.error("Get offer batch error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/offer-batches/:id/offers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const batch = await storage.getOfferBatchById(org.id, id);
      if (!batch) {
        return Errors.notFound(res, "Offer batch");
      }
      const batchOffers = await storage.getOffersByBatch(org.id, id);
      res.json(batchOffers);
    } catch (error: any) {
      logger.error("Get offers in batch error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/offer-batches", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const validated = insertOfferBatchSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const batch = await storage.createOfferBatch(validated);
      res.status(201).json(batch);
    } catch (error: any) {
      logger.error("Create offer batch error", error);
      Errors.badRequest(res, error.message || "Failed to create offer batch");
    }
  });

  api.patch("/api/offer-batches/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferBatchById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Offer batch");
      }
      const batch = await storage.updateOfferBatch(org.id, id, omitProtectedFields(req.body));
      res.json(batch);
    } catch (error: any) {
      logger.error("Update offer batch error", error);
      Errors.badRequest(res, error.message || "Failed to update offer batch");
    }
  });

  api.delete("/api/offer-batches/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferBatchById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Offer batch");
      }
      await storage.deleteOfferBatch(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete offer batch error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // OFFERS (VA Replacement Engine)
  // ============================================

  api.get("/api/offers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      let orgOffers = await storage.getOffers(org.id);
      
      const batchId = req.query.batchId ? parseInt(req.query.batchId as string) : undefined;
      const leadId = req.query.leadId ? parseInt(req.query.leadId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      if (batchId) {
        orgOffers = orgOffers.filter(o => o.batchId === batchId);
      }
      if (leadId) {
        orgOffers = orgOffers.filter(o => o.leadId === leadId);
      }
      if (status) {
        orgOffers = orgOffers.filter(o => o.status === status);
      }
      
      res.json(orgOffers);
    } catch (error: any) {
      logger.error("Get offers error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/offers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const offer = await storage.getOfferById(org.id, id);
      if (!offer) {
        return Errors.notFound(res, "Offer");
      }
      res.json(offer);
    } catch (error: any) {
      logger.error("Get offer error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/offers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const validated = insertOfferSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const offer = await storage.createOffer(validated);

      // Phase 5 §5 Part E (team readiness) — offer approval workflow.
      // If org.requiresApprovalOffersOver is set and this offer's max
      // amount exceeds it, create an offer_approvals row and freeze the
      // offer in "draft" until an admin approves. The Slack/Teams
      // dispatcher fires "offer_pending_approval" so reviewers see it
      // in real time.
      try {
        const threshold = (org as any).requiresApprovalOffersOver;
        const cashOffer = parseFloat(String(validated.cashOffer ?? 0)) || 0;
        const termsOffer = parseFloat(String(validated.termsOffer ?? 0)) || 0;
        const offerAmount = Math.max(cashOffer, termsOffer);
        if (threshold != null && offerAmount > parseFloat(String(threshold))) {
          const userId = req.user?.id ?? null;
          const { db } = await import("./storage");
          const { offerApprovals } = await import("@shared/schema");
          await db.insert(offerApprovals).values({
            organizationId: org.id,
            offerId: offer.id,
            submittedBy: userId,
            status: "pending",
            thresholdAmount: String(threshold),
            offerAmount: String(offerAmount),
          });
          // Hold the offer until reviewer acts.
          await storage.updateOffer(org.id, offer.id, { status: "draft" } as any);

          const { dispatchTeamEvent } = await import("./services/teamWebhookDispatcher");
          await dispatchTeamEvent(org.id, "offer_pending_approval", {
            title: "Offer awaiting approval",
            body: `Offer #${offer.id} for $${offerAmount.toLocaleString()} exceeds your $${parseFloat(String(threshold)).toLocaleString()} approval threshold.`,
            context: { offerId: offer.id, offerAmount, threshold },
          });
        }
      } catch (err) {
        logger.warn("offer-approval routing failed (non-fatal)", { error: (err as Error).message });
      }

      res.status(201).json(offer);
    } catch (error: any) {
      logger.error("Create offer error", error);
      Errors.badRequest(res, error.message || "Failed to create offer");
    }
  });

  api.patch("/api/offers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Offer");
      }
      const offer = await storage.updateOffer(org.id, id, omitProtectedFields(req.body));

      // ── Close the loop: an offer resolving IS an outcome ──────────────────
      //
      // `offer_accepted` and `offer_rejected` have been in OUTCOME_KINDS since
      // the outcome layer shipped and were used by nothing. This is the moment
      // they describe, and recording it here is what makes the decision that
      // drafted the offer gradeable at all.
      //
      // ONLY ON A TRANSITION. Re-patching an already-accepted offer must not
      // record a second outcome — the outcomes table is append-only, so a
      // duplicate is permanent and would double-count in every calibration
      // built above it.
      //
      // NO ACTUALS, and that is the honest part. An accepted offer resolves the
      // OFFER; it measures none of what the decision forecast. Profit, ROI and
      // total cost are unknown until the deal closes and resells, so the outcome
      // records the fact with an empty `actuals` list and the variance layer
      // reports those metrics as `unmeasured` — which is true — rather than
      // being handed the offer amount dressed up as a realised number.
      //
      // Best-effort: an offer status update must never fail because its
      // bookkeeping did.
      const nextStatus = typeof req.body?.status === "string" ? req.body.status : null;
      const resolvedKind =
        nextStatus === "accepted"
          ? "offer_accepted"
          : nextStatus === "rejected"
            ? "offer_rejected"
            : null;
      if (
        resolvedKind &&
        existing.status !== nextStatus &&
        existing.decisionSnapshotId != null
      ) {
        try {
          const { recordOutcome } = await import("./services/outcomes/outcomeStore");
          await recordOutcome(org.id, {
            decisionSnapshotId: existing.decisionSnapshotId,
            kind: resolvedKind,
            summary:
              resolvedKind === "offer_accepted"
                ? "The seller accepted the offer. Nothing about the forecast is measured yet — profit and ROI are known only after close and resale."
                : "The seller rejected the offer.",
            actuals: [],
            // The moment it was OBSERVED. `respondedAt` is the seller's own
            // response time when the caller supplied one; otherwise now. It is
            // never back-dated to the offer's creation, which would make every
            // response look instant.
            observedAt: offer?.respondedAt ? new Date(offer.respondedAt) : new Date(),
          });
        } catch (err) {
          logger.warn(
            "[offers] status resolved but the outcome was not recorded",
            err instanceof Error ? err : undefined,
          );
        }
      }

      res.json(offer);
    } catch (error: any) {
      logger.error("Update offer error", error);
      Errors.badRequest(res, error.message || "Failed to update offer");
    }
  });

  api.delete("/api/offers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Offer");
      }
      await storage.deleteOffer(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete offer error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // SELLER COMMUNICATIONS (VA Replacement Engine)
  // ============================================

  api.get("/api/seller-communications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      let comms = await storage.getSellerCommunications(org.id);
      
      const leadId = req.query.leadId ? parseInt(req.query.leadId as string) : undefined;
      if (leadId) {
        comms = comms.filter(c => c.leadId === leadId);
      }
      
      res.json(comms);
    } catch (error: any) {
      logger.error("Get seller communications error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/seller-communications/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const leadId = parseInt(req.params.leadId);
      // 2026-06-10 (T0-2 sweep): verify the lead belongs to this org —
      // previously any org's seller communications were readable by leadId.
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) return Errors.notFound(res, "Lead");
      const comms = await storage.getSellerCommunicationsByLead(leadId);
      res.json(comms);
    } catch (error: any) {
      logger.error("Get seller communications by lead error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/seller-communications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const comm = await storage.getSellerCommunicationById(org.id, id);
      if (!comm) {
        return Errors.notFound(res, "Seller communication");
      }
      res.json(comm);
    } catch (error: any) {
      logger.error("Get seller communication error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/seller-communications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const validated = insertSellerCommunicationSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const comm = await storage.createSellerCommunication(validated);
      res.status(201).json(comm);
    } catch (error: any) {
      logger.error("Create seller communication error", error);
      Errors.badRequest(res, error.message || "Failed to create seller communication");
    }
  });

  // ============================================
  // AD POSTINGS (VA Replacement Engine)
  // ============================================

  api.get("/api/ad-postings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const postings = await storage.getAdPostings(org.id);
      res.json(postings);
    } catch (error: any) {
      logger.error("Get ad postings error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/ad-postings/property/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = parseInt(req.params.propertyId);
      // 2026-06-10 (T0-2 sweep): verify the property belongs to this org.
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) return Errors.notFound(res, "Property");
      const postings = await storage.getAdPostingsByProperty(propertyId);
      res.json(postings);
    } catch (error: any) {
      logger.error("Get ad postings by property error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/ad-postings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const posting = await storage.getAdPostingById(org.id, id);
      if (!posting) {
        return Errors.notFound(res, "Ad posting");
      }
      res.json(posting);
    } catch (error: any) {
      logger.error("Get ad posting error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/ad-postings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const validated = insertAdPostingSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const posting = await storage.createAdPosting(validated);
      res.status(201).json(posting);
    } catch (error: any) {
      logger.error("Create ad posting error", error);
      Errors.badRequest(res, error.message || "Failed to create ad posting");
    }
  });

  api.patch("/api/ad-postings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getAdPostingById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Ad posting");
      }
      const posting = await storage.updateAdPosting(org.id, id, omitProtectedFields(req.body));
      res.json(posting);
    } catch (error: any) {
      logger.error("Update ad posting error", error);
      Errors.badRequest(res, error.message || "Failed to update ad posting");
    }
  });

  api.delete("/api/ad-postings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getAdPostingById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Ad posting");
      }
      await storage.deleteAdPosting(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete ad posting error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // BUYER PREQUALIFICATIONS (VA Replacement Engine)
  // ============================================

  api.get("/api/buyer-prequalifications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const prequalifications = await storage.getBuyerPrequalifications(org.id);
      res.json(prequalifications);
    } catch (error: any) {
      logger.error("Get buyer prequalifications error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/buyer-prequalifications/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const leadId = parseInt(req.params.leadId);
      const prequal = await storage.getBuyerPrequalificationByLead(leadId);
      // 2026-06-10 (T0-2 sweep): 404 on cross-tenant prequalification —
      // never confirm another org's record exists.
      if (!prequal || prequal.organizationId !== org.id) {
        return Errors.notFound(res, "Buyer prequalification");
      }
      res.json(prequal);
    } catch (error: any) {
      logger.error("Get buyer prequalification by lead error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/buyer-prequalifications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const prequal = await storage.getBuyerPrequalificationById(org.id, id);
      if (!prequal) {
        return Errors.notFound(res, "Buyer prequalification");
      }
      res.json(prequal);
    } catch (error: any) {
      logger.error("Get buyer prequalification error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/buyer-prequalifications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const validated = insertBuyerPrequalificationSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const prequal = await storage.createBuyerPrequalification(validated);
      res.status(201).json(prequal);
    } catch (error: any) {
      logger.error("Create buyer prequalification error", error);
      Errors.badRequest(res, error.message || "Failed to create buyer prequalification");
    }
  });

  api.patch("/api/buyer-prequalifications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getBuyerPrequalificationById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Buyer prequalification");
      }
      const prequal = await storage.updateBuyerPrequalification(org.id, id, omitProtectedFields(req.body));
      res.json(prequal);
    } catch (error: any) {
      logger.error("Update buyer prequalification error", error);
      Errors.badRequest(res, error.message || "Failed to update buyer prequalification");
    }
  });

  api.delete("/api/buyer-prequalifications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getBuyerPrequalificationById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Buyer prequalification");
      }
      await storage.deleteBuyerPrequalification(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete buyer prequalification error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // COLLECTION SEQUENCES (VA Replacement Engine)
  // ============================================

  api.get("/api/collection-sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const sequences = await storage.getCollectionSequences(org.id);
      res.json(sequences);
    } catch (error: any) {
      logger.error("Get collection sequences error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/collection-sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const sequence = await storage.getCollectionSequenceById(org.id, id);
      if (!sequence) {
        return Errors.notFound(res, "Collection sequence");
      }
      res.json(sequence);
    } catch (error: any) {
      logger.error("Get collection sequence error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/collection-sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const validated = insertCollectionSequenceSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const sequence = await storage.createCollectionSequence(validated);
      res.status(201).json(sequence);
    } catch (error: any) {
      logger.error("Create collection sequence error", error);
      Errors.badRequest(res, error.message || "Failed to create collection sequence");
    }
  });

  api.patch("/api/collection-sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getCollectionSequenceById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Collection sequence");
      }
      const sequence = await storage.updateCollectionSequence(org.id, id, omitProtectedFields(req.body));
      res.json(sequence);
    } catch (error: any) {
      logger.error("Update collection sequence error", error);
      Errors.badRequest(res, error.message || "Failed to update collection sequence");
    }
  });

  api.delete("/api/collection-sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getCollectionSequenceById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Collection sequence");
      }
      await storage.deleteCollectionSequence(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete collection sequence error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // COLLECTION ENROLLMENTS (VA Replacement Engine)
  // ============================================

  api.get("/api/collection-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const enrollments = await storage.getCollectionEnrollments(org.id);
      res.json(enrollments);
    } catch (error: any) {
      logger.error("Get collection enrollments error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/collection-enrollments/note/:noteId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.noteId);
      // 2026-06-10 (T0-2 sweep): verify the note belongs to this org.
      const note = await storage.getNote(org.id, noteId);
      if (!note) return Errors.notFound(res, "Note");
      const enrollments = await storage.getCollectionEnrollmentsByNote(noteId);
      res.json(enrollments);
    } catch (error: any) {
      logger.error("Get collection enrollments by note error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/collection-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const enrollment = await storage.getCollectionEnrollmentById(org.id, id);
      if (!enrollment) {
        return Errors.notFound(res, "Collection enrollment");
      }
      res.json(enrollment);
    } catch (error: any) {
      logger.error("Get collection enrollment error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/collection-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const validated = insertCollectionEnrollmentSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const enrollment = await storage.createCollectionEnrollment(validated);
      res.status(201).json(enrollment);
    } catch (error: any) {
      logger.error("Create collection enrollment error", error);
      Errors.badRequest(res, error.message || "Failed to create collection enrollment");
    }
  });

  api.patch("/api/collection-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getCollectionEnrollmentById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Collection enrollment");
      }
      const enrollment = await storage.updateCollectionEnrollment(org.id, id, omitProtectedFields(req.body));
      res.json(enrollment);
    } catch (error: any) {
      logger.error("Update collection enrollment error", error);
      Errors.badRequest(res, error.message || "Failed to update collection enrollment");
    }
  });

  // ============================================
  // COUNTY RESEARCH (VA Replacement Engine)
  // ============================================

  api.get("/api/county-research", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const research = await storage.getCountyResearchList();
      res.json(research);
    } catch (error: any) {
      logger.error("Get county research list error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/county-research/lookup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const state = req.query.state as string;
      const county = req.query.county as string;
      
      if (!state || !county) {
        return Errors.badRequest(res, "Both state and county query parameters are required");
      }
      
      const research = await storage.getCountyResearch(state, county);
      if (!research) {
        return Errors.notFound(res, "County research");
      }
      res.json(research);
    } catch (error: any) {
      logger.error("Get county research by state/county error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/county-research/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const research = await storage.getCountyResearchById(id);
      if (!research) {
        return Errors.notFound(res, "County research");
      }
      res.json(research);
    } catch (error: any) {
      logger.error("Get county research error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/county-research", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const validated = insertCountyResearchSchema.parse(req.body);
      const research = await storage.createCountyResearch(validated);
      res.status(201).json(research);
    } catch (error: any) {
      logger.error("Create county research error", error);
      Errors.badRequest(res, error.message || "Failed to create county research");
    }
  });

  api.patch("/api/county-research/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getCountyResearchById(id);
      if (!existing) {
        return Errors.notFound(res, "County research");
      }
      // SECURITY (2026-07 audit): county_research is GLOBAL reference data
      // shared across every tenant (no organizationId column), and this
      // handler previously piped raw req.body into the update — any
      // authenticated user in any org could overwrite the assessor/GIS
      // contacts every other tenant relies on, on any column. Validate the
      // payload; global writes stay possible (community-maintained data)
      // but only through the schema's known fields.
      const parsed = insertCountyResearchSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const research = await storage.updateCountyResearch(id, parsed.data);
      res.json(research);
    } catch (error: any) {
      logger.error("Update county research error", error);
      Errors.badRequest(res, error.message || "Failed to update county research");
    }
  });

  // ============================================
  // BUYER RESERVATIONS (Phase 4)
  // ============================================

  api.get("/api/buyer-reservations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const reservations = await storage.getBuyerReservations(org.id);
      res.json(reservations);
    } catch (error: any) {
      logger.error("Get buyer reservations error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/buyer-reservations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const reservation = await storage.getBuyerReservationById(org.id, id);
      if (!reservation) {
        return Errors.notFound(res, "Buyer reservation");
      }
      res.json(reservation);
    } catch (error: any) {
      logger.error("Get buyer reservation error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/properties/:propertyId/reservations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = parseInt(req.params.propertyId);
      const reservations = await storage.getBuyerReservationsByProperty(org.id, propertyId);
      res.json(reservations);
    } catch (error: any) {
      logger.error("Get property reservations error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/buyer-reservations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const reservation = await storage.createBuyerReservation({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(reservation);
    } catch (error: any) {
      logger.error("Create buyer reservation error", error);
      Errors.badRequest(res, error.message || "Failed to create buyer reservation");
    }
  });

  api.patch("/api/buyer-reservations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getBuyerReservationById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Buyer reservation");
      }
      const reservation = await storage.updateBuyerReservation(org.id, id, omitProtectedFields(req.body));
      res.json(reservation);
    } catch (error: any) {
      logger.error("Update buyer reservation error", error);
      Errors.badRequest(res, error.message || "Failed to update buyer reservation");
    }
  });

  api.delete("/api/buyer-reservations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteBuyerReservation(org.id, id);
      if (!success) {
        return Errors.notFound(res, "Buyer reservation");
      }
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete buyer reservation error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // ESCROW CHECKLISTS (Phase 4)
  // ============================================

  api.get("/api/escrow-checklists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const checklists = await storage.getEscrowChecklists(org.id);
      res.json(checklists);
    } catch (error: any) {
      logger.error("Get escrow checklists error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/escrow-checklists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const checklist = await storage.getEscrowChecklistById(org.id, id);
      if (!checklist) {
        return Errors.notFound(res, "Escrow checklist");
      }
      res.json(checklist);
    } catch (error: any) {
      logger.error("Get escrow checklist error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/deals/:dealId/escrow-checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = parseInt(req.params.dealId);
      const checklist = await storage.getEscrowChecklistByDeal(org.id, dealId);
      res.json(checklist);
    } catch (error: any) {
      logger.error("Get deal escrow checklist error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/escrow-checklists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const checklist = await storage.createEscrowChecklist({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(checklist);
    } catch (error: any) {
      logger.error("Create escrow checklist error", error);
      Errors.badRequest(res, error.message || "Failed to create escrow checklist");
    }
  });

  api.patch("/api/escrow-checklists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getEscrowChecklistById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Escrow checklist");
      }
      const checklist = await storage.updateEscrowChecklist(org.id, id, omitProtectedFields(req.body));
      res.json(checklist);
    } catch (error: any) {
      logger.error("Update escrow checklist error", error);
      Errors.badRequest(res, error.message || "Failed to update escrow checklist");
    }
  });

  api.delete("/api/escrow-checklists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteEscrowChecklist(org.id, id);
      if (!success) {
        return Errors.notFound(res, "Escrow checklist");
      }
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete escrow checklist error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // CLOSING PACKETS (Phase 4)
  // ============================================

  api.get("/api/closing-packets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const packets = await storage.getClosingPackets(org.id);
      res.json(packets);
    } catch (error: any) {
      logger.error("Get closing packets error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/closing-packets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const packet = await storage.getClosingPacketById(org.id, id);
      if (!packet) {
        return Errors.notFound(res, "Closing packet");
      }
      res.json(packet);
    } catch (error: any) {
      logger.error("Get closing packet error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/deals/:dealId/closing-packets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = parseInt(req.params.dealId);
      const packets = await storage.getClosingPacketsByDeal(org.id, dealId);
      res.json(packets);
    } catch (error: any) {
      logger.error("Get deal closing packets error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/closing-packets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const packet = await storage.createClosingPacket({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(packet);
    } catch (error: any) {
      logger.error("Create closing packet error", error);
      Errors.badRequest(res, error.message || "Failed to create closing packet");
    }
  });

  api.patch("/api/closing-packets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getClosingPacketById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Closing packet");
      }
      const packet = await storage.updateClosingPacket(org.id, id, omitProtectedFields(req.body));
      res.json(packet);
    } catch (error: any) {
      logger.error("Update closing packet error", error);
      Errors.badRequest(res, error.message || "Failed to update closing packet");
    }
  });

  api.delete("/api/closing-packets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteClosingPacket(org.id, id);
      if (!success) {
        return Errors.notFound(res, "Closing packet");
      }
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete closing packet error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // AUTOPAY ENROLLMENTS (Phase 4)
  // ============================================

  api.get("/api/autopay-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const enrollments = await storage.getAutopayEnrollments(org.id);
      res.json(enrollments);
    } catch (error: any) {
      logger.error("Get autopay enrollments error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/autopay-enrollments/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const enrollments = await storage.getActiveAutopayEnrollments(org.id);
      res.json(enrollments);
    } catch (error: any) {
      logger.error("Get active autopay enrollments error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/autopay-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const enrollment = await storage.getAutopayEnrollmentById(org.id, id);
      if (!enrollment) {
        return Errors.notFound(res, "Autopay enrollment");
      }
      res.json(enrollment);
    } catch (error: any) {
      logger.error("Get autopay enrollment error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/notes/:noteId/autopay", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.noteId);
      const enrollment = await storage.getAutopayEnrollmentByNote(org.id, noteId);
      res.json(enrollment);
    } catch (error: any) {
      logger.error("Get note autopay enrollment error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/autopay-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const enrollment = await storage.createAutopayEnrollment({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(enrollment);
    } catch (error: any) {
      logger.error("Create autopay enrollment error", error);
      Errors.badRequest(res, error.message || "Failed to create autopay enrollment");
    }
  });

  api.patch("/api/autopay-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getAutopayEnrollmentById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Autopay enrollment");
      }
      const enrollment = await storage.updateAutopayEnrollment(org.id, id, omitProtectedFields(req.body));
      res.json(enrollment);
    } catch (error: any) {
      logger.error("Update autopay enrollment error", error);
      Errors.badRequest(res, error.message || "Failed to update autopay enrollment");
    }
  });

  api.delete("/api/autopay-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteAutopayEnrollment(org.id, id);
      if (!success) {
        return Errors.notFound(res, "Autopay enrollment");
      }
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete autopay enrollment error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // PAYOFF QUOTES (Phase 4)
  // ============================================

  api.get("/api/payoff-quotes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const quotes = await storage.getPayoffQuotes(org.id);
      res.json(quotes);
    } catch (error: any) {
      logger.error("Get payoff quotes error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/payoff-quotes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const quote = await storage.getPayoffQuoteById(org.id, id);
      if (!quote) {
        return Errors.notFound(res, "Payoff quote");
      }
      res.json(quote);
    } catch (error: any) {
      logger.error("Get payoff quote error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/notes/:noteId/payoff-quotes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.noteId);
      const quotes = await storage.getPayoffQuotesByNote(org.id, noteId);
      res.json(quotes);
    } catch (error: any) {
      logger.error("Get note payoff quotes error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/payoff-quotes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const quote = await storage.createPayoffQuote({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(quote);
    } catch (error: any) {
      logger.error("Create payoff quote error", error);
      Errors.badRequest(res, error.message || "Failed to create payoff quote");
    }
  });

  api.patch("/api/payoff-quotes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getPayoffQuoteById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Payoff quote");
      }
      const quote = await storage.updatePayoffQuote(org.id, id, omitProtectedFields(req.body));
      res.json(quote);
    } catch (error: any) {
      logger.error("Update payoff quote error", error);
      Errors.badRequest(res, error.message || "Failed to update payoff quote");
    }
  });

  // ============================================
  // TRUST LEDGER (Phase 4)
  // ============================================

  api.get("/api/trust-ledger", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const entries = await storage.getTrustLedgerEntries(org.id);
      res.json(entries);
    } catch (error: any) {
      logger.error("Get trust ledger entries error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/trust-ledger/balance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const balance = await storage.getTrustBalance(org.id);
      res.json({ balance });
    } catch (error: any) {
      logger.error("Get trust ledger balance error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/notes/:noteId/trust-ledger", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.noteId);
      const entries = await storage.getTrustLedgerByNote(org.id, noteId);
      res.json(entries);
    } catch (error: any) {
      logger.error("Get note trust ledger entries error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/trust-ledger", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const entry = await storage.createTrustLedgerEntry({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(entry);
    } catch (error: any) {
      logger.error("Create trust ledger entry error", error);
      Errors.badRequest(res, error.message || "Failed to create trust ledger entry");
    }
  });

  // ============================================
  // DELINQUENCY ESCALATIONS (Phase 4)
  // ============================================

  api.get("/api/delinquency-escalations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const escalations = await storage.getDelinquencyEscalations(org.id);
      res.json(escalations);
    } catch (error: any) {
      logger.error("Get delinquency escalations error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/delinquency-escalations/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const escalations = await storage.getActiveDelinquencyEscalations(org.id);
      res.json(escalations);
    } catch (error: any) {
      logger.error("Get active delinquency escalations error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/delinquency-escalations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const escalation = await storage.getDelinquencyEscalationById(org.id, id);
      if (!escalation) {
        return Errors.notFound(res, "Delinquency escalation");
      }
      res.json(escalation);
    } catch (error: any) {
      logger.error("Get delinquency escalation error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/notes/:noteId/delinquency", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.noteId);
      const escalation = await storage.getDelinquencyEscalationByNote(org.id, noteId);
      res.json(escalation ? [escalation] : []);
    } catch (error: any) {
      logger.error("Get note delinquency escalations error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/delinquency-escalations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const escalation = await storage.createDelinquencyEscalation({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(escalation);
    } catch (error: any) {
      logger.error("Create delinquency escalation error", error);
      Errors.badRequest(res, error.message || "Failed to create delinquency escalation");
    }
  });

  api.patch("/api/delinquency-escalations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getDelinquencyEscalationById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Delinquency escalation");
      }
      const escalation = await storage.updateDelinquencyEscalation(org.id, id, omitProtectedFields(req.body));
      res.json(escalation);
    } catch (error: any) {
      logger.error("Update delinquency escalation error", error);
      Errors.badRequest(res, error.message || "Failed to update delinquency escalation");
    }
  });

  // ============================================
  // DD ASSIGNMENTS (Phase 4)
  // ============================================

  api.get("/api/dd-assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const assignments = await storage.getDDAssignments(org.id);
      res.json(assignments);
    } catch (error: any) {
      logger.error("Get DD assignments error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/dd-assignments/pending", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const assignments = await storage.getPendingDDAssignments(org.id);
      res.json(assignments);
    } catch (error: any) {
      logger.error("Get pending DD assignments error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/dd-assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const assignment = await storage.getDDAssignmentById(org.id, id);
      if (!assignment) {
        return Errors.notFound(res, "DD assignment");
      }
      res.json(assignment);
    } catch (error: any) {
      logger.error("Get DD assignment error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/properties/:propertyId/dd-assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = parseInt(req.params.propertyId);
      const assignments = await storage.getDDAssignmentsByProperty(org.id, propertyId);
      res.json(assignments);
    } catch (error: any) {
      logger.error("Get property DD assignments error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/dd-assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const assignment = await storage.createDDAssignment({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(assignment);
    } catch (error: any) {
      logger.error("Create DD assignment error", error);
      Errors.badRequest(res, error.message || "Failed to create DD assignment");
    }
  });

  api.patch("/api/dd-assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getDDAssignmentById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "DD assignment");
      }
      const assignment = await storage.updateDDAssignment(org.id, id, omitProtectedFields(req.body));
      res.json(assignment);
    } catch (error: any) {
      logger.error("Update DD assignment error", error);
      Errors.badRequest(res, error.message || "Failed to update DD assignment");
    }
  });

  api.delete("/api/dd-assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteDDAssignment(org.id, id);
      if (!success) {
        return Errors.notFound(res, "DD assignment");
      }
      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete DD assignment error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // SWOT REPORTS (Phase 4)
  // ============================================

  api.get("/api/swot-reports", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const reports = await storage.getSwotReports(org.id);
      res.json(reports);
    } catch (error: any) {
      logger.error("Get SWOT reports error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/swot-reports/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const report = await storage.getSwotReportById(org.id, id);
      if (!report) {
        return Errors.notFound(res, "SWOT report");
      }
      res.json(report);
    } catch (error: any) {
      logger.error("Get SWOT report error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/properties/:propertyId/swot-report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = parseInt(req.params.propertyId);
      const report = await storage.getSwotReportByProperty(org.id, propertyId);
      res.json(report);
    } catch (error: any) {
      logger.error("Get property SWOT report error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/swot-reports", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const report = await storage.createSwotReport({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(report);
    } catch (error: any) {
      logger.error("Create SWOT report error", error);
      Errors.badRequest(res, error.message || "Failed to create SWOT report");
    }
  });

  api.patch("/api/swot-reports/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getSwotReportById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "SWOT report");
      }
      const report = await storage.updateSwotReport(org.id, id, omitProtectedFields(req.body));
      res.json(report);
    } catch (error: any) {
      logger.error("Update SWOT report error", error);
      Errors.badRequest(res, error.message || "Failed to update SWOT report");
    }
  });

  // ============================================
  // GO/NO-GO MEMOS (Phase 4)
  // ============================================

  api.get("/api/go-nogo-memos", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const memos = await storage.getGoNogoMemos(org.id);
      res.json(memos);
    } catch (error: any) {
      logger.error("Get Go/No-Go memos error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/go-nogo-memos/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const memo = await storage.getGoNogoMemoById(org.id, id);
      if (!memo) {
        return Errors.notFound(res, "Go/No-Go memo");
      }
      res.json(memo);
    } catch (error: any) {
      logger.error("Get Go/No-Go memo error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/properties/:propertyId/go-nogo-memo", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = parseInt(req.params.propertyId);
      const memo = await storage.getGoNogoMemoByProperty(org.id, propertyId);
      res.json(memo);
    } catch (error: any) {
      logger.error("Get property Go/No-Go memo error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/go-nogo-memos", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const memo = await storage.createGoNogoMemo({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(memo);
    } catch (error: any) {
      logger.error("Create Go/No-Go memo error", error);
      Errors.badRequest(res, error.message || "Failed to create Go/No-Go memo");
    }
  });

  api.patch("/api/go-nogo-memos/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getGoNogoMemoById(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Go/No-Go memo");
      }
      const memo = await storage.updateGoNogoMemo(org.id, id, omitProtectedFields(req.body));
      res.json(memo);
    } catch (error: any) {
      logger.error("Update Go/No-Go memo error", error);
      Errors.badRequest(res, error.message || "Failed to update Go/No-Go memo");
    }
  });

  // ============================================
  // WRITING STYLE PROFILES
  // ============================================

  const writingStyleService = await import("./services/writingStyle");

  api.get("/api/writing-styles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const profiles = await writingStyleService.getAllStyleProfiles(org.id);
      res.json(profiles);
    } catch (error: any) {
      logger.error("Get writing styles error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/writing-styles/current", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      let profile = await writingStyleService.getWritingStyleProfile(org.id, user.id);
      if (!profile) {
        profile = await writingStyleService.createWritingStyleProfile(org.id, user.id);
      }
      res.json(profile);
    } catch (error: any) {
      logger.error("Get current writing style error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/writing-styles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { name } = req.body;
      const profile = await writingStyleService.createWritingStyleProfile(org.id, user.id, name);
      res.status(201).json(profile);
    } catch (error: any) {
      logger.error("Create writing style error", error);
      Errors.badRequest(res, error.message || "Failed to create writing style");
    }
  });

  api.post("/api/writing-styles/:id/samples", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { context, content } = req.body;
      await writingStyleService.addSampleMessage(id, context || "general", content);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Add sample message error", error);
      Errors.badRequest(res, error.message || "Failed to add sample message");
    }
  });

  api.post("/api/writing-styles/:id/analyze", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const analysis = await writingStyleService.analyzeWritingStyle(id);
      res.json(analysis);
    } catch (error: any) {
      logger.error("Analyze writing style error", error);
      Errors.badRequest(res, error.message || "Failed to analyze writing style");
    }
  });

  api.post("/api/writing-styles/:id/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { recipientName, topic, intent, propertyDetails, previousMessages } = req.body;
      const result = await writingStyleService.generateStyledResponse(id, {
        recipientName,
        topic,
        intent: intent || "general",
        propertyDetails,
        previousMessages,
      });
      res.json(result);
    } catch (error: any) {
      logger.error("Generate styled response error", error);
      Errors.badRequest(res, error.message || "Failed to generate response");
    }
  });

  api.post("/api/writing-styles/:id/import", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const id = parseInt(req.params.id);
      const { limit } = req.body;
      const count = await writingStyleService.importMessagesFromConversations(
        org.id,
        user.id,
        id,
        limit || 20
      );
      res.json({ imported: count });
    } catch (error: any) {
      logger.error("Import messages error", error);
      Errors.badRequest(res, error.message || "Failed to import messages");
    }
  });

  api.delete("/api/writing-styles/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await writingStyleService.deleteStyleProfile(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete writing style error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // VA ENGINE — PERFORMANCE METRICS, AUDIT TRAIL, TASKS & WORKFLOWS
  // ============================================

  // GET /api/va/metrics — VA performance metrics
  api.get("/api/va/metrics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { period = "week" } = req.query;

      // Build metrics from tasks stored in org settings
      const orgRecord = await storage.getOrganization(org.id);
      const tasks: any[] = (orgRecord as any)?.settings?.va_tasks || [];

      const now = new Date();
      const periodStart =
        period === "today"
          ? new Date(now.setHours(0, 0, 0, 0))
          : period === "month"
          ? new Date(now.getFullYear(), now.getMonth(), 1)
          : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const periodTasks = tasks.filter(
        (t: any) => new Date(t.createdAt) >= periodStart
      );
      const completed = periodTasks.filter((t: any) => t.status === "completed");
      const totalMinutes = completed.reduce(
        (sum: number, t: any) => sum + (t.actualMinutes || t.estimatedMinutes || 0),
        0
      );

      const byType: Record<string, number> = {};
      for (const t of completed) {
        byType[t.category] = (byType[t.category] || 0) + 1;
      }

      res.json({
        period,
        tasksCompleted: completed.length,
        tasksAssigned: periodTasks.length,
        successRate:
          periodTasks.length > 0
            ? Math.round((completed.length / periodTasks.length) * 100)
            : 0,
        timeSavedHours: Math.round((totalMinutes / 60) * 10) / 10,
        tasksByType: Object.entries(byType).map(([type, count]) => ({ type, count })),
      });
    } catch (error: any) {
      logger.error("VA metrics error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/va/audit-trail — full audit log of VA actions
  api.get("/api/va/audit-trail", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { limit = "50", offset = "0" } = req.query;

      const orgRecord = await storage.getOrganization(org.id);
      const tasks: any[] = (orgRecord as any)?.settings?.va_tasks || [];

      const completed = tasks
        .filter((t: any) => t.completedAt || t.status !== "pending")
        .sort(
          (a: any, b: any) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .slice(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string));

      const auditEntries = completed.map((t: any) => ({
        taskId: t.id,
        title: t.title,
        category: t.category,
        status: t.status,
        assignedToUserId: t.assignedToUserId,
        assignedByUserId: t.assignedByUserId,
        completedAt: t.completedAt,
        updatedAt: t.updatedAt,
        completionNotes: t.completionNotes,
        actualMinutes: t.actualMinutes,
        reasoning: t.completionNotes || "Task completed as assigned",
        result: t.status,
      }));

      res.json({ auditTrail: auditEntries, total: tasks.length });
    } catch (error: any) {
      logger.error("VA audit trail error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/va/tasks/:id/verify — verify task completion
  api.post("/api/va/tasks/:id/verify", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const taskId = req.params.id;
      const { verified, notes } = req.body;

      const orgRecord = await storage.getOrganization(org.id);
      const tasks: any[] = (orgRecord as any)?.settings?.va_tasks || [];
      const taskIndex = tasks.findIndex((t: any) => t.id === taskId);

      if (taskIndex === -1) {
        return Errors.notFound(res, "Task");
      }

      tasks[taskIndex] = {
        ...tasks[taskIndex],
        verified: verified !== false,
        verifiedAt: new Date().toISOString(),
        verificationNotes: notes,
        updatedAt: new Date().toISOString(),
      };

      // 2026-07 audit: atomic jsonb_set on the va_tasks key only — the old
      // whole-object spread clobbered concurrently-written sibling settings
      // keys (mailMode, aiSettings, …) with this handler's stale copy.
      {
        const { db } = await import("./db");
        const { organizations } = await import("@shared/schema");
        const { sql: sqlTag, eq: eqOp } = await import("drizzle-orm");
        await db
          .update(organizations)
          .set({
            settings: sqlTag`jsonb_set(COALESCE(${organizations.settings}, '{}'), '{va_tasks}', ${JSON.stringify(tasks)}::jsonb)` as any,
            updatedAt: new Date(),
          })
          .where(eqOp(organizations.id, org.id));
      }

      res.json({ success: true, task: tasks[taskIndex] });
    } catch (error: any) {
      logger.error("Verify task error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/va/escalate — escalate task to human supervisor
  api.post("/api/va/escalate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { taskId, reason, urgency = "medium", supervisorUserId } = req.body;

      if (!taskId || !reason) {
        return Errors.badRequest(res, "taskId and reason are required");
      }

      const escalation = {
        id: `esc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        taskId,
        reason,
        urgency,
        escalatedByUserId: user.id,
        supervisorUserId: supervisorUserId || null,
        escalatedAt: new Date().toISOString(),
        status: "open",
      };

      const orgRecord = await storage.getOrganization(org.id);
      const escalations: any[] = (orgRecord as any)?.settings?.va_escalations || [];
      escalations.push(escalation);

      await storage.updateOrganization(org.id, {
        settings: {
          ...(orgRecord as any)?.settings,
          va_escalations: escalations,
        },
      } as any);

      res.status(201).json({ success: true, escalation });
    } catch (error: any) {
      logger.error("Escalate task error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/va/scheduled — list scheduled tasks with next run times
  api.get("/api/va/scheduled", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;

      const orgRecord = await storage.getOrganization(org.id);
      const scheduled: any[] = (orgRecord as any)?.settings?.va_scheduled_tasks || [];

      // Compute next run time for each scheduled task
      const enriched = scheduled.map((task: any) => {
        const now = new Date();
        let nextRunAt: string | null = null;

        if (task.cronExpression === "daily") {
          const next = new Date(now);
          next.setDate(next.getDate() + 1);
          next.setHours(task.runAtHour || 9, 0, 0, 0);
          nextRunAt = next.toISOString();
        } else if (task.cronExpression === "weekly") {
          const next = new Date(now);
          next.setDate(next.getDate() + 7);
          nextRunAt = next.toISOString();
        } else if (task.cronExpression === "monthly") {
          const next = new Date(now);
          next.setMonth(next.getMonth() + 1, 1);
          nextRunAt = next.toISOString();
        } else if (task.nextRunAt) {
          nextRunAt = task.nextRunAt;
        }

        return { ...task, nextRunAt };
      });

      res.json({ scheduledTasks: enriched });
    } catch (error: any) {
      logger.error("Get scheduled tasks error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/va/workflows — create multi-step workflow
  /** Bounded because this array lives in a blob read on every request. */
  const MAX_VA_WORKFLOWS = 50;

  api.post("/api/va/workflows", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { name, description, steps, triggerType = "manual", triggerConfig } = req.body;

      if (!name || !steps || !Array.isArray(steps) || steps.length === 0) {
        return Errors.badRequest(res, "name and steps[] are required");
      }

      const workflow = {
        id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        organizationId: org.id,
        createdByUserId: user.id,
        name,
        description: description || "",
        triggerType,
        triggerConfig: triggerConfig || {},
        steps: steps.map((step: any, idx: number) => ({
          stepNumber: idx + 1,
          title: step.title,
          category: step.category || "other",
          description: step.description || "",
          assignToRole: step.assignToRole || "va",
          estimatedMinutes: step.estimatedMinutes || 30,
          dependsOnStep: step.dependsOnStep || null,
        })),
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const orgRecord = await storage.getOrganization(org.id);
      const workflows = orgRecord?.settings?.va_workflows ?? [];

      // BOUNDED, because of where these live. `organizations.settings` is
      // SELECTed in full on every org-scoped request (getOrCreateOrg →
      // getOrganizationByOwner), so this array rides along on every read the
      // product does — and this route had no cap and no delete path, only
      // create and list, so it grew forever. The webhook endpoint list in the
      // neighbouring blob has capped at 10 since it was written.
      if (workflows.length >= MAX_VA_WORKFLOWS) {
        return Errors.badRequest(
          res,
          `Maximum ${MAX_VA_WORKFLOWS} VA workflows per organization. ` +
            `Delete one you no longer use first.`,
        );
      }

      await storage.updateOrganization(org.id, {
        settings: {
          ...(orgRecord?.settings ?? {}),
          va_workflows: [...workflows, workflow],
        },
      });

      res.status(201).json({ success: true, workflow });
    } catch (error: any) {
      logger.error("Create workflow error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/va/workflows — list workflows
  api.get("/api/va/workflows", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const orgRecord = await storage.getOrganization(org.id);
      const workflows = orgRecord?.settings?.va_workflows ?? [];
      res.json({ workflows });
    } catch (error: any) {
      logger.error("Get workflows error", error);
      Errors.internal(res, error);
    }
  });

  // DELETE /api/va/workflows/:id — remove one.
  //
  // Added WITH the cap, not after it. A cap on a collection that cannot be
  // pruned is a wall: the org reaches it once and can never create another
  // workflow, which is a worse outcome than the unbounded growth it replaces.
  api.delete("/api/va/workflows/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const orgRecord = await storage.getOrganization(org.id);
      const workflows = orgRecord?.settings?.va_workflows ?? [];
      const remaining = workflows.filter((w) => w.id !== req.params.id);

      // Say so rather than reporting a no-op as a deletion.
      if (remaining.length === workflows.length) {
        return Errors.notFound(res, "Workflow");
      }

      await storage.updateOrganization(org.id, {
        settings: {
          ...(orgRecord?.settings ?? {}),
          va_workflows: remaining,
        },
      });

      res.json({ success: true, deleted: req.params.id, remaining: remaining.length });
    } catch (error: any) {
      logger.error("Delete workflow error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================

}
