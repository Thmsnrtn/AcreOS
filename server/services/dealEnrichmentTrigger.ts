/**
 * Enrich a deal's property, off the request path, after the write commits.
 * Callers: POST /api/deals (new deal), PUT /api/deals/:id (property changed),
 * and the lead → deal conversion in routes-leads.ts (new deal). Moved here
 * from routes-deals.ts so they share one copy.
 */
import { storage } from "../storage";
import { propertyEnrichmentService } from "./propertyEnrichment";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

export async function triggerDealEnrichmentAsync(
  organizationId: number,
  dealId: number,
  propertyId: number
): Promise<void> {
  Promise.resolve().then(async () => {
    try {
      await storage.updateDeal(dealId, { enrichmentStatus: "pending" }, undefined, organizationId);
      const enrichmentResult = await propertyEnrichmentService.enrichProperty(organizationId, propertyId);
      const enrichmentPayload = {
        enrichedAt: enrichmentResult.enrichedAt.toISOString(),
        lookupTimeMs: enrichmentResult.lookupTimeMs,
        parcel: enrichmentResult.parcel,
        hazards: enrichmentResult.hazards,
        environment: enrichmentResult.environment,
        infrastructure: enrichmentResult.infrastructure,
        demographics: enrichmentResult.demographics,
        publicLands: enrichmentResult.publicLands,
        transportation: enrichmentResult.transportation,
        water: enrichmentResult.water,
        scores: enrichmentResult.scores,
        errors: enrichmentResult.errors,
      };
      await storage.updateDeal(dealId, {
        enrichmentStatus: "completed",
        enrichedAt: clock.now(),
        enrichmentData: enrichmentPayload as any,
      }, undefined, organizationId);
      logger.info("Deal and property enrichment completed", { dealId, propertyId, organizationId, lookupTimeMs: enrichmentResult.lookupTimeMs });
    } catch (err) {
      logger.error("Deal enrichment failed", { dealId, propertyId, organizationId, error: String(err) });
      try {
        await storage.updateDeal(dealId, { enrichmentStatus: "failed", enrichmentData: { errors: { enrichment: String(err) } } as any }, undefined, organizationId);
      } catch (updateErr) {
        logger.error("Failed to update deal enrichment status", { dealId, error: String(updateErr) });
      }
    }
  });
}
