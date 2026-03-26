/**
 * Closing workflow routes — checklist, document package, attorney sharing.
 */

import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { storage, db } from "./storage";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { generateClosingChecklist } from "./services/closingChecklistGenerator";
import { dealChecklists } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";

export function registerClosingRoutes(app: Express): void {

  // Generate or retrieve closing checklist for a deal
  app.post("/api/deals/:id/closing-checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      const property = deal.propertyId ? await storage.getProperty(org.id, deal.propertyId) : null;
      const state = property?.state || req.body.state || "TX";
      const closingDate = deal.closingDate || req.body.closingDate;

      if (!closingDate) {
        return Errors.badRequest(res, "Closing date required to generate checklist");
      }

      const isSellerFinanced = !!(deal as any).analysisResults?.interestRate;
      const result = await generateClosingChecklist(dealId, state, closingDate, isSellerFinanced);

      res.json({
        ...result,
        state,
        message: `Closing checklist created — ${result.count} items based on ${state} requirements.`,
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Get closing checklist for a deal
  app.get("/api/deals/:id/closing-checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      const checklists = await db.select().from(dealChecklists)
        .where(eq(dealChecklists.dealId, dealId))
        .limit(1);

      if (checklists.length === 0) {
        return res.json({ items: [], count: 0 });
      }

      res.json({
        items: checklists[0].items,
        count: (checklists[0].items as any[])?.length || 0,
        completedAt: checklists[0].completedAt,
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Update checklist item (toggle completion)
  app.patch("/api/deals/:id/closing-checklist/:itemId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const itemId = req.params.itemId;
      const { completed, note } = req.body;

      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      const checklists = await db.select().from(dealChecklists)
        .where(eq(dealChecklists.dealId, dealId))
        .limit(1);

      if (checklists.length === 0) return Errors.notFound(res, "Checklist");

      const items = checklists[0].items as any[];
      const item = items.find((i: any) => i.id === itemId);
      if (!item) return Errors.notFound(res, "Checklist item");

      item.completed = !!completed;
      if (completed) item.completedAt = new Date().toISOString();
      if (note !== undefined) item.note = note;

      await db.update(dealChecklists)
        .set({ items: items as any })
        .where(eq(dealChecklists.dealId, dealId));

      const completedCount = items.filter((i: any) => i.completed).length;
      res.json({ items, completed: completedCount, total: items.length });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Prepare closing package
  app.post("/api/deals/:id/closing-package", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      const property = deal.propertyId ? await storage.getProperty(org.id, deal.propertyId) : null;

      // Validate required fields
      const missing: string[] = [];
      if (!deal.closingDate) missing.push("closing date");
      if (!property?.state) missing.push("property state");

      if (missing.length > 0) {
        return Errors.badRequest(
          res,
          `Complete the deal details before generating closing documents. Missing: ${missing.join(", ")}.`
        );
      }

      // Generate documents via the documents service
      const documents: { name: string; type: string; generated: boolean }[] = [];

      try {
        const { generateWarrantyDeed } = await import("./services/documents");
        await generateWarrantyDeed(org.id, dealId);
        documents.push({ name: "Deed", type: "deed", generated: true });
      } catch {
        documents.push({ name: "Deed", type: "deed", generated: false });
      }

      try {
        const { generateSettlementStatement } = await import("./services/documents");
        await generateSettlementStatement(org.id, dealId);
        documents.push({ name: "Closing Statement", type: "settlement", generated: true });
      } catch {
        documents.push({ name: "Closing Statement", type: "settlement", generated: false });
      }

      // Seller-financed extras
      const isSellerFinanced = !!(deal as any).analysisResults?.interestRate;
      if (isSellerFinanced) {
        try {
          const { generatePromissoryNote } = await import("./services/documents");
          await generatePromissoryNote(org.id, dealId);
          documents.push({ name: "Promissory Note", type: "note", generated: true });
        } catch {
          documents.push({ name: "Promissory Note", type: "note", generated: false });
        }

        try {
          const { generateDeedOfTrust } = await import("./services/documents");
          await generateDeedOfTrust(org.id, dealId);
          documents.push({ name: "Deed of Trust", type: "deed_of_trust", generated: true });
        } catch {
          documents.push({ name: "Deed of Trust", type: "deed_of_trust", generated: false });
        }
      }

      res.json({
        documents,
        generated: documents.filter(d => d.generated).length,
        total: documents.length,
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Share deal with attorney — generate time-limited link
  app.post("/api/deals/:id/share", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Store in shared_deal_links table
      await db.execute(sql`
        INSERT INTO shared_deal_links (deal_id, organization_id, token, expires_at)
        VALUES (${dealId}, ${org.id}, ${token}, ${expiresAt})
        ON CONFLICT DO NOTHING
      `);

      const shareUrl = `${req.protocol}://${req.get("host")}/shared/deal/${token}`;

      res.json({
        url: shareUrl,
        token,
        expiresAt: expiresAt.toISOString(),
        message: "Shareable link copied — expires in 7 days. Anyone with this link can view this deal's details.",
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Public shared deal view (no auth required)
  app.get("/api/shared/deal/:token", async (req, res) => {
    try {
      const { token } = req.params;

      const result = await db.execute(sql`
        SELECT * FROM shared_deal_links
        WHERE token = ${token} AND expires_at > NOW()
        LIMIT 1
      `);

      const link = result.rows?.[0] as any;
      if (!link) return Errors.notFound(res, "Shared link");

      const deal = await storage.getDeal(link.organization_id, link.deal_id);
      if (!deal) return Errors.notFound(res, "Deal");

      const property = deal.propertyId
        ? await storage.getProperty(link.organization_id, deal.propertyId)
        : null;

      // Get closing checklist
      const checklists = await db.select().from(dealChecklists)
        .where(eq(dealChecklists.dealId, link.deal_id))
        .limit(1);

      const items = (checklists[0]?.items as any[]) || [];

      // Include trust tier and score on shared links
      let trustTier = "new";
      let trustScore: number | null = null;
      try {
        const { computeInvestorTrustScore } = await import("./services/investorNetworkService");
        const trust = await computeInvestorTrustScore(link.organization_id);
        trustTier = trust.tier;
        trustScore = trust.total;
      } catch (_) { /* trust unavailable */ }

      res.json({
        trustTier,
        trustScore,
        deal: {
          id: deal.id,
          status: deal.status,
          offerAmount: deal.offerAmount,
          acceptedAmount: deal.acceptedAmount,
          closingDate: deal.closingDate,
          closingCosts: deal.closingCosts,
          titleCompany: deal.titleCompany,
        },
        property: property ? {
          address: property.address,
          city: property.city,
          state: property.state,
          county: property.county,
          sizeAcres: property.sizeAcres,
          apn: property.apn,
        } : {},
        compliance: {},
        checklist: {
          total: items.length,
          completed: items.filter((i: any) => i.completed).length,
          items: items.map((i: any) => ({
            title: i.title,
            completed: !!i.completed,
            dueDate: i.dueDate,
          })),
        },
        documents: [],
        expiresAt: link.expires_at,
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });
}
