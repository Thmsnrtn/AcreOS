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

export async function registerVAEngineRoutes(app: Express): Promise<void> {
  const api = app;

  // MARKETING LISTS (VA Replacement Engine)
  // ============================================

  api.get("/api/marketing-lists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const lists = await storage.getMarketingLists(org.id);
      res.json(lists);
    } catch (error: any) {
      console.error("Get marketing lists error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch marketing lists" });
    }
  });

  api.get("/api/marketing-lists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const list = await storage.getMarketingListById(org.id, id);
      if (!list) {
        return res.status(404).json({ message: "Marketing list not found" });
      }
      res.json(list);
    } catch (error: any) {
      console.error("Get marketing list error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch marketing list" });
    }
  });

  api.post("/api/marketing-lists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertMarketingListSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const list = await storage.createMarketingList(validated);
      res.status(201).json(list);
    } catch (error: any) {
      console.error("Create marketing list error:", error);
      res.status(400).json({ message: error.message || "Failed to create marketing list" });
    }
  });

  api.patch("/api/marketing-lists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getMarketingListById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Marketing list not found" });
      }
      const list = await storage.updateMarketingList(org.id, id, req.body);
      res.json(list);
    } catch (error: any) {
      console.error("Update marketing list error:", error);
      res.status(400).json({ message: error.message || "Failed to update marketing list" });
    }
  });

  api.delete("/api/marketing-lists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getMarketingListById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Marketing list not found" });
      }
      await storage.deleteMarketingList(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete marketing list error:", error);
      res.status(500).json({ message: error.message || "Failed to delete marketing list" });
    }
  });

  // ============================================
  // OFFER BATCHES (VA Replacement Engine)
  // ============================================

  api.get("/api/offer-batches", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const batches = await storage.getOfferBatches(org.id);
      res.json(batches);
    } catch (error: any) {
      console.error("Get offer batches error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offer batches" });
    }
  });

  api.get("/api/offer-batches/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const batch = await storage.getOfferBatchById(org.id, id);
      if (!batch) {
        return res.status(404).json({ message: "Offer batch not found" });
      }
      const batchOffers = await storage.getOffersByBatch(org.id, id);
      res.json({ ...batch, offersCount: batchOffers.length });
    } catch (error: any) {
      console.error("Get offer batch error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offer batch" });
    }
  });

  api.get("/api/offer-batches/:id/offers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const batch = await storage.getOfferBatchById(org.id, id);
      if (!batch) {
        return res.status(404).json({ message: "Offer batch not found" });
      }
      const batchOffers = await storage.getOffersByBatch(org.id, id);
      res.json(batchOffers);
    } catch (error: any) {
      console.error("Get offers in batch error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offers in batch" });
    }
  });

  api.post("/api/offer-batches", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertOfferBatchSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const batch = await storage.createOfferBatch(validated);
      res.status(201).json(batch);
    } catch (error: any) {
      console.error("Create offer batch error:", error);
      res.status(400).json({ message: error.message || "Failed to create offer batch" });
    }
  });

  api.patch("/api/offer-batches/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferBatchById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer batch not found" });
      }
      const batch = await storage.updateOfferBatch(org.id, id, req.body);
      res.json(batch);
    } catch (error: any) {
      console.error("Update offer batch error:", error);
      res.status(400).json({ message: error.message || "Failed to update offer batch" });
    }
  });

  api.delete("/api/offer-batches/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferBatchById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer batch not found" });
      }
      await storage.deleteOfferBatch(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete offer batch error:", error);
      res.status(500).json({ message: error.message || "Failed to delete offer batch" });
    }
  });

  // ============================================
  // OFFERS (VA Replacement Engine)
  // ============================================

  api.get("/api/offers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Get offers error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offers" });
    }
  });

  api.get("/api/offers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const offer = await storage.getOfferById(org.id, id);
      if (!offer) {
        return res.status(404).json({ message: "Offer not found" });
      }
      res.json(offer);
    } catch (error: any) {
      console.error("Get offer error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offer" });
    }
  });

  api.post("/api/offers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertOfferSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const offer = await storage.createOffer(validated);
      res.status(201).json(offer);
    } catch (error: any) {
      console.error("Create offer error:", error);
      res.status(400).json({ message: error.message || "Failed to create offer" });
    }
  });

  api.patch("/api/offers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer not found" });
      }
      const offer = await storage.updateOffer(org.id, id, req.body);
      res.json(offer);
    } catch (error: any) {
      console.error("Update offer error:", error);
      res.status(400).json({ message: error.message || "Failed to update offer" });
    }
  });

  api.delete("/api/offers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer not found" });
      }
      await storage.deleteOffer(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete offer error:", error);
      res.status(500).json({ message: error.message || "Failed to delete offer" });
    }
  });

  // ============================================
  // SELLER COMMUNICATIONS (VA Replacement Engine)
  // ============================================

  api.get("/api/seller-communications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      let comms = await storage.getSellerCommunications(org.id);
      
      const leadId = req.query.leadId ? parseInt(req.query.leadId as string) : undefined;
      if (leadId) {
        comms = comms.filter(c => c.leadId === leadId);
      }
      
      res.json(comms);
    } catch (error: any) {
      console.error("Get seller communications error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch seller communications" });
    }
  });

  api.get("/api/seller-communications/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const leadId = parseInt(req.params.leadId);
      const comms = await storage.getSellerCommunicationsByLead(leadId);
      res.json(comms);
    } catch (error: any) {
      console.error("Get seller communications by lead error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch seller communications" });
    }
  });

  api.get("/api/seller-communications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const comm = await storage.getSellerCommunicationById(org.id, id);
      if (!comm) {
        return res.status(404).json({ message: "Seller communication not found" });
      }
      res.json(comm);
    } catch (error: any) {
      console.error("Get seller communication error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch seller communication" });
    }
  });

  api.post("/api/seller-communications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertSellerCommunicationSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const comm = await storage.createSellerCommunication(validated);
      res.status(201).json(comm);
    } catch (error: any) {
      console.error("Create seller communication error:", error);
      res.status(400).json({ message: error.message || "Failed to create seller communication" });
    }
  });

  // ============================================
  // AD POSTINGS (VA Replacement Engine)
  // ============================================

  api.get("/api/ad-postings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const postings = await storage.getAdPostings(org.id);
      res.json(postings);
    } catch (error: any) {
      console.error("Get ad postings error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch ad postings" });
    }
  });

  api.get("/api/ad-postings/property/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const postings = await storage.getAdPostingsByProperty(propertyId);
      res.json(postings);
    } catch (error: any) {
      console.error("Get ad postings by property error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch ad postings" });
    }
  });

  api.get("/api/ad-postings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const posting = await storage.getAdPostingById(org.id, id);
      if (!posting) {
        return res.status(404).json({ message: "Ad posting not found" });
      }
      res.json(posting);
    } catch (error: any) {
      console.error("Get ad posting error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch ad posting" });
    }
  });

  api.post("/api/ad-postings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertAdPostingSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const posting = await storage.createAdPosting(validated);
      res.status(201).json(posting);
    } catch (error: any) {
      console.error("Create ad posting error:", error);
      res.status(400).json({ message: error.message || "Failed to create ad posting" });
    }
  });

  api.patch("/api/ad-postings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getAdPostingById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Ad posting not found" });
      }
      const posting = await storage.updateAdPosting(org.id, id, req.body);
      res.json(posting);
    } catch (error: any) {
      console.error("Update ad posting error:", error);
      res.status(400).json({ message: error.message || "Failed to update ad posting" });
    }
  });

  api.delete("/api/ad-postings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getAdPostingById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Ad posting not found" });
      }
      await storage.deleteAdPosting(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete ad posting error:", error);
      res.status(500).json({ message: error.message || "Failed to delete ad posting" });
    }
  });

  // ============================================
  // BUYER PREQUALIFICATIONS (VA Replacement Engine)
  // ============================================

  api.get("/api/buyer-prequalifications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const prequalifications = await storage.getBuyerPrequalifications(org.id);
      res.json(prequalifications);
    } catch (error: any) {
      console.error("Get buyer prequalifications error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer prequalifications" });
    }
  });

  api.get("/api/buyer-prequalifications/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const leadId = parseInt(req.params.leadId);
      const prequal = await storage.getBuyerPrequalificationByLead(leadId);
      if (!prequal) {
        return res.status(404).json({ message: "Buyer prequalification not found for this lead" });
      }
      res.json(prequal);
    } catch (error: any) {
      console.error("Get buyer prequalification by lead error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer prequalification" });
    }
  });

  api.get("/api/buyer-prequalifications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const prequal = await storage.getBuyerPrequalificationById(org.id, id);
      if (!prequal) {
        return res.status(404).json({ message: "Buyer prequalification not found" });
      }
      res.json(prequal);
    } catch (error: any) {
      console.error("Get buyer prequalification error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer prequalification" });
    }
  });

  api.post("/api/buyer-prequalifications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertBuyerPrequalificationSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const prequal = await storage.createBuyerPrequalification(validated);
      res.status(201).json(prequal);
    } catch (error: any) {
      console.error("Create buyer prequalification error:", error);
      res.status(400).json({ message: error.message || "Failed to create buyer prequalification" });
    }
  });

  api.patch("/api/buyer-prequalifications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getBuyerPrequalificationById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Buyer prequalification not found" });
      }
      const prequal = await storage.updateBuyerPrequalification(org.id, id, req.body);
      res.json(prequal);
    } catch (error: any) {
      console.error("Update buyer prequalification error:", error);
      res.status(400).json({ message: error.message || "Failed to update buyer prequalification" });
    }
  });

  api.delete("/api/buyer-prequalifications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getBuyerPrequalificationById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Buyer prequalification not found" });
      }
      await storage.deleteBuyerPrequalification(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete buyer prequalification error:", error);
      res.status(500).json({ message: error.message || "Failed to delete buyer prequalification" });
    }
  });

  // ============================================
  // COLLECTION SEQUENCES (VA Replacement Engine)
  // ============================================

  api.get("/api/collection-sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const sequences = await storage.getCollectionSequences(org.id);
      res.json(sequences);
    } catch (error: any) {
      console.error("Get collection sequences error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection sequences" });
    }
  });

  api.get("/api/collection-sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const sequence = await storage.getCollectionSequenceById(org.id, id);
      if (!sequence) {
        return res.status(404).json({ message: "Collection sequence not found" });
      }
      res.json(sequence);
    } catch (error: any) {
      console.error("Get collection sequence error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection sequence" });
    }
  });

  api.post("/api/collection-sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertCollectionSequenceSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const sequence = await storage.createCollectionSequence(validated);
      res.status(201).json(sequence);
    } catch (error: any) {
      console.error("Create collection sequence error:", error);
      res.status(400).json({ message: error.message || "Failed to create collection sequence" });
    }
  });

  api.patch("/api/collection-sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getCollectionSequenceById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Collection sequence not found" });
      }
      const sequence = await storage.updateCollectionSequence(org.id, id, req.body);
      res.json(sequence);
    } catch (error: any) {
      console.error("Update collection sequence error:", error);
      res.status(400).json({ message: error.message || "Failed to update collection sequence" });
    }
  });

  api.delete("/api/collection-sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getCollectionSequenceById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Collection sequence not found" });
      }
      await storage.deleteCollectionSequence(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete collection sequence error:", error);
      res.status(500).json({ message: error.message || "Failed to delete collection sequence" });
    }
  });

  // ============================================
  // COLLECTION ENROLLMENTS (VA Replacement Engine)
  // ============================================

  api.get("/api/collection-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const enrollments = await storage.getCollectionEnrollments(org.id);
      res.json(enrollments);
    } catch (error: any) {
      console.error("Get collection enrollments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection enrollments" });
    }
  });

  api.get("/api/collection-enrollments/note/:noteId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const noteId = parseInt(req.params.noteId);
      const enrollments = await storage.getCollectionEnrollmentsByNote(noteId);
      res.json(enrollments);
    } catch (error: any) {
      console.error("Get collection enrollments by note error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection enrollments" });
    }
  });

  api.get("/api/collection-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const enrollment = await storage.getCollectionEnrollmentById(org.id, id);
      if (!enrollment) {
        return res.status(404).json({ message: "Collection enrollment not found" });
      }
      res.json(enrollment);
    } catch (error: any) {
      console.error("Get collection enrollment error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection enrollment" });
    }
  });

  api.post("/api/collection-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertCollectionEnrollmentSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const enrollment = await storage.createCollectionEnrollment(validated);
      res.status(201).json(enrollment);
    } catch (error: any) {
      console.error("Create collection enrollment error:", error);
      res.status(400).json({ message: error.message || "Failed to create collection enrollment" });
    }
  });

  api.patch("/api/collection-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getCollectionEnrollmentById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Collection enrollment not found" });
      }
      const enrollment = await storage.updateCollectionEnrollment(org.id, id, req.body);
      res.json(enrollment);
    } catch (error: any) {
      console.error("Update collection enrollment error:", error);
      res.status(400).json({ message: error.message || "Failed to update collection enrollment" });
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
      console.error("Get county research list error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch county research" });
    }
  });

  api.get("/api/county-research/lookup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const state = req.query.state as string;
      const county = req.query.county as string;
      
      if (!state || !county) {
        return res.status(400).json({ message: "Both state and county query parameters are required" });
      }
      
      const research = await storage.getCountyResearch(state, county);
      if (!research) {
        return res.status(404).json({ message: "County research not found" });
      }
      res.json(research);
    } catch (error: any) {
      console.error("Get county research by state/county error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch county research" });
    }
  });

  api.get("/api/county-research/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const research = await storage.getCountyResearchById(id);
      if (!research) {
        return res.status(404).json({ message: "County research not found" });
      }
      res.json(research);
    } catch (error: any) {
      console.error("Get county research error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch county research" });
    }
  });

  api.post("/api/county-research", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const validated = insertCountyResearchSchema.parse(req.body);
      const research = await storage.createCountyResearch(validated);
      res.status(201).json(research);
    } catch (error: any) {
      console.error("Create county research error:", error);
      res.status(400).json({ message: error.message || "Failed to create county research" });
    }
  });

  api.patch("/api/county-research/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getCountyResearchById(id);
      if (!existing) {
        return res.status(404).json({ message: "County research not found" });
      }
      const research = await storage.updateCountyResearch(id, req.body);
      res.json(research);
    } catch (error: any) {
      console.error("Update county research error:", error);
      res.status(400).json({ message: error.message || "Failed to update county research" });
    }
  });

  // ============================================
  // BUYER RESERVATIONS (Phase 4)
  // ============================================

  api.get("/api/buyer-reservations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const reservations = await storage.getBuyerReservations(org.id);
      res.json(reservations);
    } catch (error: any) {
      console.error("Get buyer reservations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer reservations" });
    }
  });

  api.get("/api/buyer-reservations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const reservation = await storage.getBuyerReservationById(org.id, id);
      if (!reservation) {
        return res.status(404).json({ message: "Buyer reservation not found" });
      }
      res.json(reservation);
    } catch (error: any) {
      console.error("Get buyer reservation error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer reservation" });
    }
  });

  api.get("/api/properties/:propertyId/reservations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.propertyId);
      const reservations = await storage.getBuyerReservationsByProperty(org.id, propertyId);
      res.json(reservations);
    } catch (error: any) {
      console.error("Get property reservations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property reservations" });
    }
  });

  api.post("/api/buyer-reservations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const reservation = await storage.createBuyerReservation({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(reservation);
    } catch (error: any) {
      console.error("Create buyer reservation error:", error);
      res.status(400).json({ message: error.message || "Failed to create buyer reservation" });
    }
  });

  api.patch("/api/buyer-reservations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getBuyerReservationById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Buyer reservation not found" });
      }
      const reservation = await storage.updateBuyerReservation(org.id, id, req.body);
      res.json(reservation);
    } catch (error: any) {
      console.error("Update buyer reservation error:", error);
      res.status(400).json({ message: error.message || "Failed to update buyer reservation" });
    }
  });

  api.delete("/api/buyer-reservations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteBuyerReservation(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "Buyer reservation not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete buyer reservation error:", error);
      res.status(500).json({ message: error.message || "Failed to delete buyer reservation" });
    }
  });

  // ============================================
  // ESCROW CHECKLISTS (Phase 4)
  // ============================================

  api.get("/api/escrow-checklists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const checklists = await storage.getEscrowChecklists(org.id);
      res.json(checklists);
    } catch (error: any) {
      console.error("Get escrow checklists error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch escrow checklists" });
    }
  });

  api.get("/api/escrow-checklists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const checklist = await storage.getEscrowChecklistById(org.id, id);
      if (!checklist) {
        return res.status(404).json({ message: "Escrow checklist not found" });
      }
      res.json(checklist);
    } catch (error: any) {
      console.error("Get escrow checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch escrow checklist" });
    }
  });

  api.get("/api/deals/:dealId/escrow-checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = parseInt(req.params.dealId);
      const checklist = await storage.getEscrowChecklistByDeal(org.id, dealId);
      res.json(checklist);
    } catch (error: any) {
      console.error("Get deal escrow checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch deal escrow checklist" });
    }
  });

  api.post("/api/escrow-checklists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const checklist = await storage.createEscrowChecklist({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(checklist);
    } catch (error: any) {
      console.error("Create escrow checklist error:", error);
      res.status(400).json({ message: error.message || "Failed to create escrow checklist" });
    }
  });

  api.patch("/api/escrow-checklists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getEscrowChecklistById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Escrow checklist not found" });
      }
      const checklist = await storage.updateEscrowChecklist(org.id, id, req.body);
      res.json(checklist);
    } catch (error: any) {
      console.error("Update escrow checklist error:", error);
      res.status(400).json({ message: error.message || "Failed to update escrow checklist" });
    }
  });

  api.delete("/api/escrow-checklists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteEscrowChecklist(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "Escrow checklist not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete escrow checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to delete escrow checklist" });
    }
  });

  // ============================================
  // CLOSING PACKETS (Phase 4)
  // ============================================

  api.get("/api/closing-packets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const packets = await storage.getClosingPackets(org.id);
      res.json(packets);
    } catch (error: any) {
      console.error("Get closing packets error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch closing packets" });
    }
  });

  api.get("/api/closing-packets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const packet = await storage.getClosingPacketById(org.id, id);
      if (!packet) {
        return res.status(404).json({ message: "Closing packet not found" });
      }
      res.json(packet);
    } catch (error: any) {
      console.error("Get closing packet error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch closing packet" });
    }
  });

  api.get("/api/deals/:dealId/closing-packets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = parseInt(req.params.dealId);
      const packets = await storage.getClosingPacketsByDeal(org.id, dealId);
      res.json(packets);
    } catch (error: any) {
      console.error("Get deal closing packets error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch deal closing packets" });
    }
  });

  api.post("/api/closing-packets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const packet = await storage.createClosingPacket({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(packet);
    } catch (error: any) {
      console.error("Create closing packet error:", error);
      res.status(400).json({ message: error.message || "Failed to create closing packet" });
    }
  });

  api.patch("/api/closing-packets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getClosingPacketById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Closing packet not found" });
      }
      const packet = await storage.updateClosingPacket(org.id, id, req.body);
      res.json(packet);
    } catch (error: any) {
      console.error("Update closing packet error:", error);
      res.status(400).json({ message: error.message || "Failed to update closing packet" });
    }
  });

  api.delete("/api/closing-packets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteClosingPacket(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "Closing packet not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete closing packet error:", error);
      res.status(500).json({ message: error.message || "Failed to delete closing packet" });
    }
  });

  // ============================================
  // AUTOPAY ENROLLMENTS (Phase 4)
  // ============================================

  api.get("/api/autopay-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const enrollments = await storage.getAutopayEnrollments(org.id);
      res.json(enrollments);
    } catch (error: any) {
      console.error("Get autopay enrollments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch autopay enrollments" });
    }
  });

  api.get("/api/autopay-enrollments/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const enrollments = await storage.getActiveAutopayEnrollments(org.id);
      res.json(enrollments);
    } catch (error: any) {
      console.error("Get active autopay enrollments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch active autopay enrollments" });
    }
  });

  api.get("/api/autopay-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const enrollment = await storage.getAutopayEnrollmentById(org.id, id);
      if (!enrollment) {
        return res.status(404).json({ message: "Autopay enrollment not found" });
      }
      res.json(enrollment);
    } catch (error: any) {
      console.error("Get autopay enrollment error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch autopay enrollment" });
    }
  });

  api.get("/api/notes/:noteId/autopay", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.noteId);
      const enrollment = await storage.getAutopayEnrollmentByNote(org.id, noteId);
      res.json(enrollment);
    } catch (error: any) {
      console.error("Get note autopay enrollment error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch note autopay enrollment" });
    }
  });

  api.post("/api/autopay-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const enrollment = await storage.createAutopayEnrollment({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(enrollment);
    } catch (error: any) {
      console.error("Create autopay enrollment error:", error);
      res.status(400).json({ message: error.message || "Failed to create autopay enrollment" });
    }
  });

  api.patch("/api/autopay-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getAutopayEnrollmentById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Autopay enrollment not found" });
      }
      const enrollment = await storage.updateAutopayEnrollment(org.id, id, req.body);
      res.json(enrollment);
    } catch (error: any) {
      console.error("Update autopay enrollment error:", error);
      res.status(400).json({ message: error.message || "Failed to update autopay enrollment" });
    }
  });

  api.delete("/api/autopay-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteAutopayEnrollment(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "Autopay enrollment not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete autopay enrollment error:", error);
      res.status(500).json({ message: error.message || "Failed to delete autopay enrollment" });
    }
  });

  // ============================================
  // PAYOFF QUOTES (Phase 4)
  // ============================================

  api.get("/api/payoff-quotes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const quotes = await storage.getPayoffQuotes(org.id);
      res.json(quotes);
    } catch (error: any) {
      console.error("Get payoff quotes error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch payoff quotes" });
    }
  });

  api.get("/api/payoff-quotes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const quote = await storage.getPayoffQuoteById(org.id, id);
      if (!quote) {
        return res.status(404).json({ message: "Payoff quote not found" });
      }
      res.json(quote);
    } catch (error: any) {
      console.error("Get payoff quote error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch payoff quote" });
    }
  });

  api.get("/api/notes/:noteId/payoff-quotes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.noteId);
      const quotes = await storage.getPayoffQuotesByNote(org.id, noteId);
      res.json(quotes);
    } catch (error: any) {
      console.error("Get note payoff quotes error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch note payoff quotes" });
    }
  });

  api.post("/api/payoff-quotes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const quote = await storage.createPayoffQuote({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(quote);
    } catch (error: any) {
      console.error("Create payoff quote error:", error);
      res.status(400).json({ message: error.message || "Failed to create payoff quote" });
    }
  });

  api.patch("/api/payoff-quotes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getPayoffQuoteById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Payoff quote not found" });
      }
      const quote = await storage.updatePayoffQuote(org.id, id, req.body);
      res.json(quote);
    } catch (error: any) {
      console.error("Update payoff quote error:", error);
      res.status(400).json({ message: error.message || "Failed to update payoff quote" });
    }
  });

  // ============================================
  // TRUST LEDGER (Phase 4)
  // ============================================

  api.get("/api/trust-ledger", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entries = await storage.getTrustLedgerEntries(org.id);
      res.json(entries);
    } catch (error: any) {
      console.error("Get trust ledger entries error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch trust ledger entries" });
    }
  });

  api.get("/api/trust-ledger/balance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const balance = await storage.getTrustBalance(org.id);
      res.json({ balance });
    } catch (error: any) {
      console.error("Get trust ledger balance error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch trust ledger balance" });
    }
  });

  api.get("/api/notes/:noteId/trust-ledger", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.noteId);
      const entries = await storage.getTrustLedgerByNote(org.id, noteId);
      res.json(entries);
    } catch (error: any) {
      console.error("Get note trust ledger entries error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch note trust ledger entries" });
    }
  });

  api.post("/api/trust-ledger", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entry = await storage.createTrustLedgerEntry({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(entry);
    } catch (error: any) {
      console.error("Create trust ledger entry error:", error);
      res.status(400).json({ message: error.message || "Failed to create trust ledger entry" });
    }
  });

  // ============================================
  // DELINQUENCY ESCALATIONS (Phase 4)
  // ============================================

  api.get("/api/delinquency-escalations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const escalations = await storage.getDelinquencyEscalations(org.id);
      res.json(escalations);
    } catch (error: any) {
      console.error("Get delinquency escalations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch delinquency escalations" });
    }
  });

  api.get("/api/delinquency-escalations/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const escalations = await storage.getActiveDelinquencyEscalations(org.id);
      res.json(escalations);
    } catch (error: any) {
      console.error("Get active delinquency escalations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch active delinquency escalations" });
    }
  });

  api.get("/api/delinquency-escalations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const escalation = await storage.getDelinquencyEscalationById(org.id, id);
      if (!escalation) {
        return res.status(404).json({ message: "Delinquency escalation not found" });
      }
      res.json(escalation);
    } catch (error: any) {
      console.error("Get delinquency escalation error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch delinquency escalation" });
    }
  });

  api.get("/api/notes/:noteId/delinquency", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.noteId);
      const escalation = await storage.getDelinquencyEscalationByNote(org.id, noteId);
      res.json(escalation ? [escalation] : []);
    } catch (error: any) {
      console.error("Get note delinquency escalations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch note delinquency escalations" });
    }
  });

  api.post("/api/delinquency-escalations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const escalation = await storage.createDelinquencyEscalation({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(escalation);
    } catch (error: any) {
      console.error("Create delinquency escalation error:", error);
      res.status(400).json({ message: error.message || "Failed to create delinquency escalation" });
    }
  });

  api.patch("/api/delinquency-escalations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getDelinquencyEscalationById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Delinquency escalation not found" });
      }
      const escalation = await storage.updateDelinquencyEscalation(org.id, id, req.body);
      res.json(escalation);
    } catch (error: any) {
      console.error("Update delinquency escalation error:", error);
      res.status(400).json({ message: error.message || "Failed to update delinquency escalation" });
    }
  });

  // ============================================
  // DD ASSIGNMENTS (Phase 4)
  // ============================================

  api.get("/api/dd-assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const assignments = await storage.getDDAssignments(org.id);
      res.json(assignments);
    } catch (error: any) {
      console.error("Get DD assignments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch DD assignments" });
    }
  });

  api.get("/api/dd-assignments/pending", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const assignments = await storage.getPendingDDAssignments(org.id);
      res.json(assignments);
    } catch (error: any) {
      console.error("Get pending DD assignments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch pending DD assignments" });
    }
  });

  api.get("/api/dd-assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const assignment = await storage.getDDAssignmentById(org.id, id);
      if (!assignment) {
        return res.status(404).json({ message: "DD assignment not found" });
      }
      res.json(assignment);
    } catch (error: any) {
      console.error("Get DD assignment error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch DD assignment" });
    }
  });

  api.get("/api/properties/:propertyId/dd-assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.propertyId);
      const assignments = await storage.getDDAssignmentsByProperty(org.id, propertyId);
      res.json(assignments);
    } catch (error: any) {
      console.error("Get property DD assignments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property DD assignments" });
    }
  });

  api.post("/api/dd-assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const assignment = await storage.createDDAssignment({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(assignment);
    } catch (error: any) {
      console.error("Create DD assignment error:", error);
      res.status(400).json({ message: error.message || "Failed to create DD assignment" });
    }
  });

  api.patch("/api/dd-assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getDDAssignmentById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "DD assignment not found" });
      }
      const assignment = await storage.updateDDAssignment(org.id, id, req.body);
      res.json(assignment);
    } catch (error: any) {
      console.error("Update DD assignment error:", error);
      res.status(400).json({ message: error.message || "Failed to update DD assignment" });
    }
  });

  api.delete("/api/dd-assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteDDAssignment(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "DD assignment not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete DD assignment error:", error);
      res.status(500).json({ message: error.message || "Failed to delete DD assignment" });
    }
  });

  // ============================================
  // SWOT REPORTS (Phase 4)
  // ============================================

  api.get("/api/swot-reports", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const reports = await storage.getSwotReports(org.id);
      res.json(reports);
    } catch (error: any) {
      console.error("Get SWOT reports error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch SWOT reports" });
    }
  });

  api.get("/api/swot-reports/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const report = await storage.getSwotReportById(org.id, id);
      if (!report) {
        return res.status(404).json({ message: "SWOT report not found" });
      }
      res.json(report);
    } catch (error: any) {
      console.error("Get SWOT report error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch SWOT report" });
    }
  });

  api.get("/api/properties/:propertyId/swot-report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.propertyId);
      const report = await storage.getSwotReportByProperty(org.id, propertyId);
      res.json(report);
    } catch (error: any) {
      console.error("Get property SWOT report error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property SWOT report" });
    }
  });

  api.post("/api/swot-reports", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const report = await storage.createSwotReport({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(report);
    } catch (error: any) {
      console.error("Create SWOT report error:", error);
      res.status(400).json({ message: error.message || "Failed to create SWOT report" });
    }
  });

  api.patch("/api/swot-reports/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getSwotReportById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "SWOT report not found" });
      }
      const report = await storage.updateSwotReport(org.id, id, req.body);
      res.json(report);
    } catch (error: any) {
      console.error("Update SWOT report error:", error);
      res.status(400).json({ message: error.message || "Failed to update SWOT report" });
    }
  });

  // ============================================
  // GO/NO-GO MEMOS (Phase 4)
  // ============================================

  api.get("/api/go-nogo-memos", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const memos = await storage.getGoNogoMemos(org.id);
      res.json(memos);
    } catch (error: any) {
      console.error("Get Go/No-Go memos error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch Go/No-Go memos" });
    }
  });

  api.get("/api/go-nogo-memos/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const memo = await storage.getGoNogoMemoById(org.id, id);
      if (!memo) {
        return res.status(404).json({ message: "Go/No-Go memo not found" });
      }
      res.json(memo);
    } catch (error: any) {
      console.error("Get Go/No-Go memo error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch Go/No-Go memo" });
    }
  });

  api.get("/api/properties/:propertyId/go-nogo-memo", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.propertyId);
      const memo = await storage.getGoNogoMemoByProperty(org.id, propertyId);
      res.json(memo);
    } catch (error: any) {
      console.error("Get property Go/No-Go memo error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property Go/No-Go memo" });
    }
  });

  api.post("/api/go-nogo-memos", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const memo = await storage.createGoNogoMemo({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(memo);
    } catch (error: any) {
      console.error("Create Go/No-Go memo error:", error);
      res.status(400).json({ message: error.message || "Failed to create Go/No-Go memo" });
    }
  });

  api.patch("/api/go-nogo-memos/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getGoNogoMemoById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Go/No-Go memo not found" });
      }
      const memo = await storage.updateGoNogoMemo(org.id, id, req.body);
      res.json(memo);
    } catch (error: any) {
      console.error("Update Go/No-Go memo error:", error);
      res.status(400).json({ message: error.message || "Failed to update Go/No-Go memo" });
    }
  });

  // ============================================
  // WRITING STYLE PROFILES
  // ============================================

  const writingStyleService = await import("./services/writingStyle");

  api.get("/api/writing-styles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const profiles = await writingStyleService.getAllStyleProfiles(org.id);
      res.json(profiles);
    } catch (error: any) {
      console.error("Get writing styles error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch writing styles" });
    }
  });

  api.get("/api/writing-styles/current", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      let profile = await writingStyleService.getWritingStyleProfile(org.id, user.id);
      if (!profile) {
        profile = await writingStyleService.createWritingStyleProfile(org.id, user.id);
      }
      res.json(profile);
    } catch (error: any) {
      console.error("Get current writing style error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch writing style" });
    }
  });

  api.post("/api/writing-styles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { name } = req.body;
      const profile = await writingStyleService.createWritingStyleProfile(org.id, user.id, name);
      res.status(201).json(profile);
    } catch (error: any) {
      console.error("Create writing style error:", error);
      res.status(400).json({ message: error.message || "Failed to create writing style" });
    }
  });

  api.post("/api/writing-styles/:id/samples", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { context, content } = req.body;
      await writingStyleService.addSampleMessage(id, context || "general", content);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Add sample message error:", error);
      res.status(400).json({ message: error.message || "Failed to add sample message" });
    }
  });

  api.post("/api/writing-styles/:id/analyze", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const analysis = await writingStyleService.analyzeWritingStyle(id);
      res.json(analysis);
    } catch (error: any) {
      console.error("Analyze writing style error:", error);
      res.status(400).json({ message: error.message || "Failed to analyze writing style" });
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
      console.error("Generate styled response error:", error);
      res.status(400).json({ message: error.message || "Failed to generate response" });
    }
  });

  api.post("/api/writing-styles/:id/import", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
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
      console.error("Import messages error:", error);
      res.status(400).json({ message: error.message || "Failed to import messages" });
    }
  });

  api.delete("/api/writing-styles/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await writingStyleService.deleteStyleProfile(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete writing style error:", error);
      res.status(500).json({ message: error.message || "Failed to delete writing style" });
    }
  });

  // ============================================
  // VA ENGINE — PERFORMANCE METRICS, AUDIT TRAIL, TASKS & WORKFLOWS
  // ============================================

  // GET /api/va/metrics — VA performance metrics
  api.get("/api/va/metrics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("VA metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch VA metrics" });
    }
  });

  // GET /api/va/audit-trail — full audit log of VA actions
  api.get("/api/va/audit-trail", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("VA audit trail error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch audit trail" });
    }
  });

  // POST /api/va/tasks/:id/verify — verify task completion
  api.post("/api/va/tasks/:id/verify", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const taskId = req.params.id;
      const { verified, notes } = req.body;

      const orgRecord = await storage.getOrganization(org.id);
      const tasks: any[] = (orgRecord as any)?.settings?.va_tasks || [];
      const taskIndex = tasks.findIndex((t: any) => t.id === taskId);

      if (taskIndex === -1) {
        return res.status(404).json({ message: "Task not found" });
      }

      tasks[taskIndex] = {
        ...tasks[taskIndex],
        verified: verified !== false,
        verifiedAt: new Date().toISOString(),
        verificationNotes: notes,
        updatedAt: new Date().toISOString(),
      };

      await storage.updateOrganization(org.id, {
        settings: {
          ...(orgRecord as any)?.settings,
          va_tasks: tasks,
        },
      } as any);

      res.json({ success: true, task: tasks[taskIndex] });
    } catch (error: any) {
      console.error("Verify task error:", error);
      res.status(500).json({ message: error.message || "Failed to verify task" });
    }
  });

  // POST /api/va/escalate — escalate task to human supervisor
  api.post("/api/va/escalate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { taskId, reason, urgency = "medium", supervisorUserId } = req.body;

      if (!taskId || !reason) {
        return res.status(400).json({ message: "taskId and reason are required" });
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
      console.error("Escalate task error:", error);
      res.status(500).json({ message: error.message || "Failed to escalate task" });
    }
  });

  // GET /api/va/scheduled — list scheduled tasks with next run times
  api.get("/api/va/scheduled", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;

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
      console.error("Get scheduled tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch scheduled tasks" });
    }
  });

  // POST /api/va/workflows — create multi-step workflow
  api.post("/api/va/workflows", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { name, description, steps, triggerType = "manual", triggerConfig } = req.body;

      if (!name || !steps || !Array.isArray(steps) || steps.length === 0) {
        return res.status(400).json({ message: "name and steps[] are required" });
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
      const workflows: any[] = (orgRecord as any)?.settings?.va_workflows || [];
      workflows.push(workflow);

      await storage.updateOrganization(org.id, {
        settings: {
          ...(orgRecord as any)?.settings,
          va_workflows: workflows,
        },
      } as any);

      res.status(201).json({ success: true, workflow });
    } catch (error: any) {
      console.error("Create workflow error:", error);
      res.status(500).json({ message: error.message || "Failed to create workflow" });
    }
  });

  // GET /api/va/workflows — list workflows
  api.get("/api/va/workflows", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const orgRecord = await storage.getOrganization(org.id);
      const workflows: any[] = (orgRecord as any)?.settings?.va_workflows || [];
      res.json({ workflows });
    } catch (error: any) {
      console.error("Get workflows error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch workflows" });
    }
  });

  // ============================================

}
