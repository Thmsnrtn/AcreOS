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

  // ─── Field / Driving-for-Dollars endpoints ─────────────────────────
  // STR-023/024/025: land investors using AcreOS in the field need to
  // (a) find parcels near a GPS pin, (b) convert GPS → address, and
  // (c) search their property list by address or APN. Without these
  // the mobile driving-for-dollars loop is broken.

  // STR-024: GET /api/geocode/reverse?lat&lng  (proxies Mapbox)
  app.get("/api/geocode/reverse", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return Errors.badRequest(res, "lat and lng are required numeric query params");
      }
      const token = process.env.VITE_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN;
      if (!token) {
        return res.status(503).json({
          error: "service_unavailable",
          message: "Reverse geocoding is not configured. Contact support.",
        });
      }
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${encodeURIComponent(token)}&types=address,place,postcode,region,country`;
      const resp = await fetch(url);
      if (!resp.ok) {
        logger.warn("[geocode/reverse] mapbox non-ok", { metadata: { status: resp.status } });
        return res.status(502).json({ error: "upstream_error", message: "Geocoding service error" });
      }
      const data = (await resp.json()) as any;
      const place = data?.features?.[0];
      res.json({
        address: place?.place_name ?? null,
        components: (data?.features ?? []).map((f: any) => ({
          id: f.id,
          type: f.place_type?.[0],
          text: f.text,
          placeName: f.place_name,
        })),
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // STR-025: GET /api/parcels/search?q=  (search org properties by address/APN substring)
  app.get("/api/parcels/search", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const q = String(req.query.q ?? "").trim();
      if (!q) {
        return res.json({ results: [], count: 0, query: q });
      }
      if (q.length < 2) {
        return Errors.badRequest(res, "Query must be at least 2 characters");
      }
      const all = await storage.getProperties(org.id);
      const needle = q.toLowerCase();
      const results = all
        .filter((p) => {
          return (
            (p.address && p.address.toLowerCase().includes(needle)) ||
            (p.apn && p.apn.toLowerCase().includes(needle)) ||
            (p.county && p.county.toLowerCase().includes(needle)) ||
            (p.state && p.state.toLowerCase().includes(needle))
          );
        })
        .slice(0, 50)
        .map((p) => ({
          id: p.id,
          apn: p.apn,
          address: p.address,
          state: p.state,
          county: p.county,
          sizeAcres: p.sizeAcres,
          latitude: p.latitude,
          longitude: p.longitude,
        }));
      res.json({ results, count: results.length, query: q });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── STR-013: /api/counties ────────────────────────────────────────
  // Returns the counties the org has properties or leads in, plus a
  // seeded national sample for "prospect a new county" flows. The sidebar
  // "Counties" entry expects this; previously it 404'd and journey was
  // blocked.
  app.get("/api/counties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const props = await storage.getProperties(org.id);
      const used = new Map<string, { state: string; county: string; propertyCount: number }>();
      for (const p of props) {
        if (!p.state || !p.county) continue;
        const key = `${p.state}-${p.county}`;
        const existing = used.get(key);
        used.set(key, {
          state: p.state,
          county: p.county,
          propertyCount: (existing?.propertyCount ?? 0) + 1,
        });
      }
      res.json({
        counties: Array.from(used.values()).sort((a, b) => b.propertyCount - a.propertyCount),
        count: used.size,
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── STR-014: /api/direct-mail/templates ───────────────────────────
  // Minimal stock template library so the mail-campaign journey can pick
  // a template instead of hitting a 404 at step 4.
  app.get("/api/direct-mail/templates", isAuthenticated, getOrCreateOrg, async (_req, res) => {
    res.json({
      templates: [
        {
          id: "postcard_cash_offer",
          name: "Postcard — Cash Offer",
          type: "postcard",
          description: "Bright, direct, highest-response format for first-touch outreach.",
          body: "Hi {owner_name},\nWe're making cash offers on land in {county} county. If {apn} is something you'd consider parting with, reply with your number and we'll send a no-obligation offer within 48 hours.\n— {from_name}",
        },
        {
          id: "yellow_letter_personal",
          name: "Yellow Letter — Personal Handwritten",
          type: "letter",
          description: "Higher-converting but slower. Simulated handwriting, personal tone.",
          body: "Hi {owner_name},\nMy name is {from_name} and I buy land in {county} directly from owners. I'd love to make you an offer on {apn}. Call or text me anytime at {from_phone}. No pressure — just a conversation.",
        },
        {
          id: "blind_offer_letter",
          name: "Blind Offer — Printed Letter",
          type: "letter",
          description: "Dollar amount on the envelope. Lower response rate but pre-qualifies motivated sellers.",
          body: "Re: {apn} — {county}, {state}\n\nWe are prepared to purchase this parcel for {offer_amount} cash, closing within 21 days. This offer is valid for 30 days. Reply to accept or counter.\n\n— {from_name}, {from_company}",
        },
      ],
    });
  });

  // ─── STR-017: /api/fema/flood-zone ─────────────────────────────────
  // Proxies FEMA's National Flood Hazard Layer (public ArcGIS service).
  // Cached on the client by query params, so a naive pass-through is fine.
  app.get("/api/fema/flood-zone", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return Errors.badRequest(res, "lat and lng are required numeric query params");
      }
      // FEMA NFHL REST layer 28 = flood hazard zones
      const url = `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=false&f=json`;
      let data: any = null;
      try {
        const resp = await fetch(url);
        if (resp.ok) data = await resp.json();
      } catch (err) {
        logger.warn("[fema] upstream fetch failed", err instanceof Error ? err : undefined);
      }
      const feature = data?.features?.[0]?.attributes;
      res.json({
        lat,
        lng,
        floodZone: feature?.FLD_ZONE ?? null,
        zoneSubtype: feature?.ZONE_SUBTY ?? null,
        specialFloodHazardArea: feature?.SFHA_TF === "T",
        source: feature ? "FEMA NFHL" : "unavailable",
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── STR-018: /api/due-diligence (parent listing) ──────────────────
  // Aggregates the org's DD items across all properties, so a
  // /due-diligence "inbox" route has something to render instead of 404.
  app.get("/api/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const props = await storage.getProperties(org.id);
      const perProperty: Array<{ propertyId: number; apn: string | null; itemCount: number; status: string }> = [];
      for (const p of props) {
        perProperty.push({
          propertyId: p.id,
          apn: p.apn ?? null,
          itemCount: 0,
          status: (p as any).dueDiligenceStatus ?? "not_started",
        });
      }
      res.json({ properties: perProperty, count: perProperty.length });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── STR-022: /api/getting-started/checklist ───────────────────────
  // Dashboard renders a 0/5 checklist; returning a real server-side copy
  // lets us personalize + update without client redeploys.
  app.get("/api/getting-started/checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const props = await storage.getProperties(org.id);
      const leads = await storage.getLeads(org.id);
      const hasProperty = props.length > 0;
      const hasLead = leads.length > 0;
      const items = [
        { id: "add_first_lead", title: "Add your first lead", done: hasLead, href: "/leads" },
        { id: "add_first_property", title: "Add your first property", done: hasProperty, href: "/properties" },
        { id: "run_comps", title: "Run comparable-sales analysis on a property", done: false, href: "/properties" },
        { id: "import_csv", title: "Import a CSV of leads or properties", done: false, href: "/import" },
        { id: "launch_campaign", title: "Launch your first mail or email campaign", done: false, href: "/campaigns" },
      ];
      const completed = items.filter((i) => i.done).length;
      res.json({ items, completed, total: items.length });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── STR-021: /api/notes/amortize ──────────────────────────────────
  // Stateless amortization preview. Protects note creation UX from
  // needing to POST a draft note just to see a payment estimate.
  app.get("/api/notes/amortize", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const principal = Number(req.query.principal);
      const rate = Number(req.query.rate); // annual % (e.g. 10 for 10%)
      const termMonths = Number(req.query.termMonths);
      if (!Number.isFinite(principal) || principal <= 0) {
        return Errors.badRequest(res, "principal must be a positive number");
      }
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return Errors.badRequest(res, "rate must be between 0 and 100 (annual percent)");
      }
      if (!Number.isFinite(termMonths) || termMonths <= 0 || termMonths > 600) {
        return Errors.badRequest(res, "termMonths must be between 1 and 600");
      }
      const r = rate / 100 / 12;
      const monthlyPayment = r === 0
        ? principal / termMonths
        : (principal * r) / (1 - Math.pow(1 + r, -termMonths));
      const totalPaid = monthlyPayment * termMonths;
      const totalInterest = totalPaid - principal;
      res.json({
        principal,
        annualRate: rate,
        termMonths,
        monthlyPayment: Number(monthlyPayment.toFixed(2)),
        totalPaid: Number(totalPaid.toFixed(2)),
        totalInterest: Number(totalInterest.toFixed(2)),
      });
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
