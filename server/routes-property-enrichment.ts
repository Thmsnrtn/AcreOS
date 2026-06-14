/**
 * T209 — Property Enrichment Routes
 *
 * POST /api/properties/:id/enrich        — enrich a single property
 * POST /api/properties/bulk-enrich       — enrich multiple properties (max 50)
 * GET  /api/properties/:id/enrichment    — get enrichment data for a property
 */

import { Router, type Request, type Response } from "express";
import { Errors } from "./utils/errors";
import { propertyEnrichmentService } from "./services/propertyEnrichment";
import { db } from "./db";
import { properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const router = Router();


// POST /api/properties/:id/enrich
router.post("/:id/enrich", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");

    // enrichProperty(organizationId, propertyId) — args were previously swapped.
    const result = await propertyEnrichmentService.enrichProperty(org.id, propertyId);
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// POST /api/properties/bulk-enrich
router.post("/bulk-enrich", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { propertyIds, limit = 50 } = req.body;

    if (propertyIds && !Array.isArray(propertyIds)) {
      return Errors.badRequest(res, "propertyIds must be an array");
    }

    // TODO(tsc): propertyEnrichmentService has no batchEnrich method. Enrich
    // each property individually via the existing enrichProperty(orgId, id).
    const ids: number[] = Array.isArray(propertyIds)
      ? propertyIds.map((p: any) => Number(p)).filter((n) => Number.isFinite(n)).slice(0, Math.min(limit, 50))
      : [];
    const results = [];
    for (const id of ids) {
      results.push(await propertyEnrichmentService.enrichProperty(org.id, id));
    }
    res.json({ results, count: results.length });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /api/properties/:id/enrichment
router.get("/:id/enrichment", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");

    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, org.id)))
      .limit(1);

    if (!property) return Errors.notFound(res, "Property");

    // TODO(tsc): propertyEnrichmentService has no getEnrichmentData method;
    // re-running enrichProperty returns the latest enrichment result.
    const enrichmentData = await propertyEnrichmentService.enrichProperty(org.id, propertyId);
    res.json({ propertyId, enrichment: enrichmentData });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
