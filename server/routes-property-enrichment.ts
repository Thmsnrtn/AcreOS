/**
 * T209 — Property Enrichment Routes
 *
 * POST /api/properties/:id/enrich        — enrich a single property
 * POST /api/properties/bulk-enrich       — enrich multiple properties (max 50)
 * GET  /api/properties/:id/enrichment    — get enrichment data for a property
 */

import { Router, type Request, type Response } from "express";
import { propertyEnrichmentService } from "./services/propertyEnrichment";
import { db } from "./db";
import { properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

function getOrg(req: Request) { return (req as any).org; }

// POST /api/properties/:id/enrich
router.post("/:id/enrich", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });

    const result = await propertyEnrichmentService.enrichProperty(propertyId, org.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties/bulk-enrich
router.post("/bulk-enrich", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { propertyIds, limit = 50 } = req.body;

    if (propertyIds && !Array.isArray(propertyIds)) {
      return res.status(400).json({ error: "propertyIds must be an array" });
    }

    const result = await propertyEnrichmentService.batchEnrich(
      propertyIds ?? null,
      org.id,
      Math.min(limit, 50)
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id/enrichment
router.get("/:id/enrichment", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });

    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, org.id)))
      .limit(1);

    if (!property) return res.status(404).json({ error: "Property not found" });

    const enrichmentData = await propertyEnrichmentService.getEnrichmentData(propertyId, org.id);
    res.json({ propertyId, enrichment: enrichmentData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
