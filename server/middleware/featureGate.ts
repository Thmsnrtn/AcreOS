/**
 * Server-side feature flag gate middleware.
 *
 * Checks the `platform_feature_flags` table for a given flag key.
 * If the flag exists and is enabled, the request proceeds.
 * If the flag is disabled or missing, a 404 is returned.
 * If the table doesn't exist (e.g. fresh DB), access is allowed by default
 * so the app doesn't break during initial setup.
 *
 * Usage:
 *   import { featureGate } from "./middleware/featureGate";
 *   app.use("/api/marketplace", featureGate("feature_marketplace"), marketplaceRouter);
 */

import { db } from "../storage";
import { platformFeatureFlags } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

export function featureGate(flagKey: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [flag] = await db
        .select()
        .from(platformFeatureFlags)
        .where(eq(platformFeatureFlags.key, flagKey))
        .limit(1);

      if (flag && flag.enabled) {
        return next();
      }

      // Flag missing or disabled — treat route as unavailable
      return res.status(404).json({ message: "Feature not available" });
    } catch {
      // If feature flags table doesn't exist or DB error, allow access
      // so the app is usable during initial setup / migrations
      return next();
    }
  };
}
