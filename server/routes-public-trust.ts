/**
 * Pillar D / D8 — Customer-facing trust + compliance surface.
 *
 * Public endpoints anyone can hit (no auth) so prospective customers can
 * verify our trust posture before signing up.
 *
 *   GET /api/trust/sub-processors  →  list of signed vendors (from
 *                                     dataProcessingAgreements)
 *
 * Future endpoints to land here: /api/trust/policies, /api/trust/breach-policy,
 * /api/trust/posture.
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { dataProcessingAgreements } from "@shared/schema";
import { inArray, desc } from "drizzle-orm";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

export function registerPublicTrustRoutes(app: Express): void {
  app.get("/api/trust/sub-processors", async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          vendorName: dataProcessingAgreements.vendorName,
          status: dataProcessingAgreements.status,
          scope: dataProcessingAgreements.scope,
          signedDate: dataProcessingAgreements.signedDate,
          expiresAt: dataProcessingAgreements.expiresAt,
        })
        .from(dataProcessingAgreements)
        .where(inArray(dataProcessingAgreements.status, ["signed", "expired"]))
        .orderBy(desc(dataProcessingAgreements.signedDate));

      // 1-hour public cache. The vendor list changes on the order of weeks.
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
      return res.json({
        subProcessors: rows,
        lastUpdated: new Date().toISOString(),
        policyUrl: "/security",
      });
    } catch (err: unknown) {
      logger.error("[trust] sub-processors fetch failed", err);
      return Errors.internal(res, err);
    }
  });
}
