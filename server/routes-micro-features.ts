/**
 * Section 1: Daily Workflow Micro-Features
 * - Quick capture lead from field (OCR)
 * - Neighbor outreach
 * - Closing cost estimates
 * - Activity timeline
 * - Unified search
 * - Priority action
 */

import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { storage } from "./storage";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { estimateClosingCosts } from "./services/closingCostEstimator";

export function registerMicroFeatureRoutes(app: Express): void {

  // ─── Quick Capture Lead from Field (1c) ───────────────────────────
  app.post("/api/leads/quick-capture", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { image } = req.body;

      if (!image || typeof image !== "string") {
        return Errors.badRequest(res, "Base64 image required");
      }

      // OCR via documentIntelligence
      let extractedText = "";
      try {
        const { documentIntelligenceService } = await import("./services/documentIntelligence");
        const dataUrl = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;
        // Use extractText directly with a temp doc record
        const doc = await documentIntelligenceService.uploadDocument(org.id, {
          documentType: "other",
          name: "Quick Capture — Field Photo",
          fileUrl: dataUrl,
        });
        extractedText = await documentIntelligenceService.extractText(doc.id, dataUrl);
      } catch (err) {
        logger.error("Quick capture OCR failed", err instanceof Error ? err : undefined);
      }

      // Extract contact info from OCR text
      const extracted = extractContactInfo(extractedText);

      if (!extracted.phone && !extracted.name && !extracted.address) {
        return res.json({
          lead: null,
          extracted,
          imageAttached: true,
          message: "No readable contact info found",
        });
      }

      // Create lead with whatever we captured
      const nameParts = (extracted.name || "Unknown").split(" ");
      const lead = await storage.createLead({
        organizationId: org.id,
        firstName: nameParts[0] || "Unknown",
        lastName: nameParts.slice(1).join(" ") || "",
        phone: extracted.phone || undefined,
        address: extracted.address || undefined,
        source: "field_capture",
        status: "new",
        type: "seller",
        notes: `Captured from field photo. OCR text: ${extractedText.substring(0, 500)}`,
      });

      res.json({
        lead: { id: lead.id, firstName: lead.firstName, phone: lead.phone },
        extracted,
        imageAttached: true,
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Neighbor Outreach (1d) ───────────────────────────────────────
  app.get("/api/properties/:id/neighbors", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      const property = await storage.getProperty(org.id, propertyId);

      if (!property) return Errors.notFound(res, "Property");

      if (!property.latitude || !property.longitude) {
        return res.json({ neighbors: [], message: "Property coordinates required for neighbor lookup" });
      }

      // Use parcel service to find adjacent parcels
      let neighbors: Array<{
        apn: string;
        owner?: string;
        ownerAddress?: string;
        acres?: number;
        distance?: number;
      }> = [];

      try {
        // Search for nearby parcels within ~0.25 mile radius
        const { lookupNearbyParcels } = await import("./services/parcel");
        if (typeof lookupNearbyParcels === "function") {
          const nearby = await lookupNearbyParcels(
            property.latitude,
            property.longitude,
            0.25,
            property.apn || undefined
          );
          neighbors = nearby;
        }
      } catch {
        // Parcel service may not have neighbor lookup — use property table fallback
        const allProps = await storage.getProperties(org.id);
        neighbors = allProps
          .filter((p) => {
            if (p.id === propertyId || !p.latitude || !p.longitude) return false;
            const dist = haversine(
              property.latitude!, property.longitude!,
              p.latitude, p.longitude
            );
            return dist <= 0.5; // within 0.5 miles
          })
          .map((p) => ({
            apn: p.apn || `prop-${p.id}`,
            owner: (p as any).parcelData?.owner,
            ownerAddress: (p as any).parcelData?.ownerAddress,
            acres: p.sizeAcres ? Number(p.sizeAcres) : undefined,
            distance: haversine(property.latitude!, property.longitude!, p.latitude!, p.longitude!),
          }))
          .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))
          .slice(0, 20);
      }

      res.json({ neighbors });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Closing Cost Estimate (1e) ───────────────────────────────────
  app.get("/api/closing-costs/estimate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { state, county, salePrice, annualTax } = req.query;

      if (!state || !county || !salePrice) {
        return Errors.badRequest(res, "state, county, and salePrice are required");
      }

      const price = Number(salePrice);
      if (!isFinite(price) || price <= 0) {
        return Errors.badRequest(res, "salePrice must be a positive number");
      }

      const tax = annualTax ? Number(annualTax) : undefined;
      const estimate = estimateClosingCosts(
        String(state),
        String(county),
        price,
        tax && isFinite(tax) ? tax : undefined
      );

      res.json(estimate);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Activity Timeline (2e) ───────────────────────────────────────
  app.get("/api/activity/:entityType/:entityId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { entityType, entityId } = req.params;

      const validTypes = ["lead", "deal", "property", "note"];
      if (!validTypes.includes(entityType)) {
        return Errors.badRequest(res, `entityType must be one of: ${validTypes.join(", ")}`);
      }

      const id = Number(entityId);
      if (!isFinite(id)) return Errors.badRequest(res, "entityId must be a number");

      // Pull from activity log
      const { db } = await import("./storage");
      const { activityLog } = await import("@shared/schema");
      const { eq, and, desc } = await import("drizzle-orm");

      const events = await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.organizationId, org.id),
            eq(activityLog.entityType, entityType),
            eq(activityLog.entityId, id)
          )
        )
        .orderBy(desc(activityLog.eventDate))
        .limit(100);

      res.json({ events });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Unified Search (2a) ──────────────────────────────────────────
  app.get("/api/search", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const q = String(req.query.q || "").trim();

      if (!q || q.length < 2) {
        return res.json({ results: [], query: q });
      }

      const { fullTextSearch } = await import("./services/fullTextSearch");

      // Search across entities in parallel
      const [searchResults] = await Promise.allSettled([
        fullTextSearch.search(org.id, q, 25),
      ]);

      const results = searchResults.status === "fulfilled" ? searchResults.value : [];

      // Group by type
      const grouped: Record<string, typeof results> = {};
      for (const r of results) {
        const type = r.type || "other";
        if (!grouped[type]) grouped[type] = [];
        if (grouped[type].length < 5) grouped[type].push(r);
      }

      res.json({ results: grouped, query: q, total: results.length });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Priority Action (2c) ─────────────────────────────────────────
  app.get("/api/dashboard/priority", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const priority = await getTopPriority(org.id);
      res.json(priority);
    } catch (error) {
      Errors.internal(res, error);
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractContactInfo(text: string): { phone?: string; name?: string; address?: string } {
  if (!text) return {};

  // Phone: match US phone patterns
  const phoneMatch = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[^\d]/g, "").replace(/^(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : undefined;

  // Name: look for "Call [Name]" or "Contact [Name]" or lines that look like names
  const nameMatch = text.match(/(?:call|contact|owner|agent|listing)\s*:?\s*([A-Z][a-z]+ [A-Z][a-z]+)/i);
  const name = nameMatch ? nameMatch[1] : undefined;

  // Address: look for street number + street name patterns
  const addrMatch = text.match(/\d{1,5}\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,3}\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Hwy|Road|Street|Avenue|Drive|Lane|Court)/i);
  const address = addrMatch ? addrMatch[0] : undefined;

  return { phone, name, address };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getTopPriority(orgId: number) {
  const defaultPriority = {
    action: "all_caught_up" as const,
    headline: "You're all caught up. Your portfolio is working for you.",
    ctaLabel: "View Dashboard",
    ctaRoute: "/",
  };

  try {
    const leads = await storage.getLeads(orgId);
    const deals = await storage.getDeals(orgId);

    // 1. Unread seller responses
    const responded = leads.filter(
      (l) => l.status === "responded" && l.type === "seller"
    );
    if (responded.length > 0) {
      return {
        action: "review_responses",
        headline: `${responded.length} seller${responded.length !== 1 ? "s" : ""} responded to your campaign — review now`,
        entityType: "lead",
        ctaLabel: "Review Responses",
        ctaRoute: "/leads?status=responded",
      };
    }

    // 2. Accepted deals with no closing checklist
    const accepted = deals.filter((d) => d.status === "accepted" || d.status === "in_escrow");
    if (accepted.length > 0) {
      return {
        action: "close_deal",
        headline: `Deal "${accepted[0].propertyId ? `#${accepted[0].id}` : accepted[0].id}" was accepted — start the closing process`,
        entityType: "deal",
        entityId: accepted[0].id,
        ctaLabel: "Start Closing",
        ctaRoute: `/deals/${accepted[0].id}`,
      };
    }

    // 3. Leads with no campaign after 7+ days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stale = leads.filter(
      (l) => l.status === "new" && l.createdAt && new Date(l.createdAt) < sevenDaysAgo
    );
    if (stale.length > 0) {
      return {
        action: "create_campaign",
        headline: `${stale.length} lead${stale.length !== 1 ? "s" : ""} haven't been contacted — create a campaign`,
        ctaLabel: "Create Campaign",
        ctaRoute: "/campaigns?action=create",
      };
    }

    // 4. Overdue note payments (check via notes)
    try {
      const notes = await storage.getNotes(orgId);
      const overdue = notes.filter((n: any) => n.daysDelinquent > 0 || n.delinquencyStatus !== "current");
      if (overdue.length > 0) {
        return {
          action: "review_delinquencies",
          headline: `${overdue.length} note payment${overdue.length !== 1 ? "s" : ""} overdue — review delinquencies`,
          ctaLabel: "Review Notes",
          ctaRoute: "/finance",
        };
      }
    } catch {}

    // 5. No leads at all
    if (leads.length === 0) {
      return {
        action: "import_leads",
        headline: "Import your first leads to get started",
        ctaLabel: "Import Leads",
        ctaRoute: "/leads?action=import",
      };
    }

    // 6. Default
    return defaultPriority;
  } catch {
    return defaultPriority;
  }
}
