/**
 * T141 — Disposition Optimizer Routes
 *
 * GET  /api/disposition/:propertyId                — full recommendation
 * POST /api/disposition/:propertyId/refresh        — force-refresh recommendation
 * GET  /api/disposition/:propertyId/price          — optimal pricing
 * GET  /api/disposition/:propertyId/channels       — channel recommendations
 * GET  /api/disposition/:propertyId/timing         — timing analysis
 * GET  /api/disposition/:propertyId/roi            — ROI analysis
 * POST /api/disposition/:propertyId/compare        — compare strategies
 * GET  /api/disposition/ready                      — properties ready for disposition
 *
 * Lens 48 (Behavioral IDOR Probe): every `:propertyId` route here previously
 * passed the raw id straight into a service method that did `eq(properties.id, x)`
 * with NO org filter. Cross-tenant read of pricing/ROI/timing was trivial.
 * All routes now gate on assertEntityBelongsToOrg("property", ...) before
 * delegating to the optimizer service.
 */

import { Router, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { dispositionOptimizerService } from "./services/dispositionOptimizer";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { assertEntityBelongsToOrg } from "./utils/orgScope";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";

const router = Router();

/**
 * Parse :propertyId param and verify it belongs to the requesting org.
 * Returns the numeric id on success; sends a 404 (deliberately, not 403,
 * so we don't confirm existence cross-tenant) and returns null on miss.
 *
 * idempotent: true
 */
async function gatePropertyParam(req: AuthenticatedRequest, res: Response): Promise<number | null> {
  const propertyId = parseInt(req.params.propertyId, 10);
  if (Number.isNaN(propertyId)) {
    Errors.badRequest(res, "Invalid property ID");
    return null;
  }
  const orgId = getOrganizationId(req);
  const ok = await assertEntityBelongsToOrg("property", propertyId, orgId);
  if (!ok) {
    Errors.notFound(res, "Property");
    return null;
  }
  return propertyId;
}

  // ready — registered BEFORE /:propertyId so the literal path wins (2026-07-11 route-order sweep).
// Properties ready for disposition
router.get("/ready", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const properties = await dispositionOptimizerService.getPropertiesReadyForDisposition(orgId);
    res.json({ properties });
  } catch (err) {
    logger.error("disposition.ready failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// Full recommendation for a property
router.get("/:propertyId", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = await gatePropertyParam(req, res);
    if (propertyId === null) return;
    const recommendation = await dispositionOptimizerService.getRecommendationsByProperty(
      getOrganizationId(req),
      propertyId,
    );
    res.json({ recommendation: recommendation[0] ?? null });
  } catch (err) {
    logger.error("disposition.get failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// Force-refresh recommendation
router.post("/:propertyId/refresh", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = await gatePropertyParam(req, res);
    if (propertyId === null) return;
    const recommendation = await dispositionOptimizerService.generateRecommendation(
      getOrganizationId(req),
      propertyId,
    );
    res.json({ recommendation });
  } catch (err) {
    logger.error("disposition.refresh failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// Optimal pricing
router.get("/:propertyId/price", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = await gatePropertyParam(req, res);
    if (propertyId === null) return;
    const pricing = await dispositionOptimizerService.calculateOptimalPrice(propertyId);
    res.json({ pricing });
  } catch (err) {
    logger.error("disposition.price failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// Channel recommendations
router.get("/:propertyId/channels", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = await gatePropertyParam(req, res);
    if (propertyId === null) return;
    const channels = await dispositionOptimizerService.recommendChannels(propertyId);
    res.json({ channels });
  } catch (err) {
    logger.error("disposition.channels failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// Timing analysis
router.get("/:propertyId/timing", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = await gatePropertyParam(req, res);
    if (propertyId === null) return;
    const timing = await dispositionOptimizerService.analyzeTimingFactors(propertyId);
    res.json({ timing });
  } catch (err) {
    logger.error("disposition.timing failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// ROI analysis
router.get("/:propertyId/roi", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = await gatePropertyParam(req, res);
    if (propertyId === null) return;
    const roi = await dispositionOptimizerService.calculateROI(getOrganizationId(req), propertyId);
    res.json({ roi });
  } catch (err) {
    logger.error("disposition.roi failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// Strategy comparison
router.post("/:propertyId/compare", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const propertyId = await gatePropertyParam(req, res);
    if (propertyId === null) return;
    const comparison = await dispositionOptimizerService.compareStrategies(
      getOrganizationId(req),
      propertyId,
    );
    res.json({ comparison });
  } catch (err) {
    logger.error("disposition.compare failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});


export default router;
