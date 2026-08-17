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
  // ── RETIRED 2026-08-17 (OD-5): GET /api/trust/verticals ─────────────────
  // It served the 15 business types with their raw `maturity`, unauthenticated
  // and cached for an hour, and it was removed for two independent reasons.
  //
  // It had ZERO callers. Its own comment said it existed "so the landing page
  // can filter 'shipping today' vs 'beta' vs 'roadmap'" — the landing derives
  // its tiers from the registry directly (Positioning.tsx) and never called
  // this. A public endpoint whose stated consumer does not consume it is the
  // built-but-unwired shape this repo keeps finding, on a surface anyone could
  // hit.
  //
  // And it published `v.maturity` unfiltered, so it respected no demotion. The
  // landing had a conservatism channel; this did not. Thirteen verticals
  // declare `core` on evidence that reaches only `surfaced`, and the founder's
  // decision was to demote the public claim — which this endpoint would have
  // silently contradicted, one hour of cache at a time. Two public surfaces
  // disagreeing about the same fact is worse than either being wrong alone.
  //
  // If a public vertical registry is ever wanted again, it must render
  // `publicMaturityOf()` from shared/business-types/publicClaims.ts, never
  // `meta.maturity` — and `verticalReadiness.test.ts` will fail it if it does
  // not.

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
