/**
 * Feature flag service — design-system §8 state machine.
 *
 * Resolves whether a flag is enabled for a given user context (userId,
 * tier, isFounder). Wraps the platform_feature_flags table with the
 * 5-state evaluation logic. Per-request caching keeps DB hits to one
 * read per request even when many `requireFlag` calls fire.
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  platformFeatureFlags,
  type FeatureFlagState,
  FEATURE_FLAG_STATES,
} from "@shared/schema";
import { logger } from "../utils/logger";

export interface FlagContext {
  userId?: string;
  tier?: string;
  isFounder?: boolean;
  /** Email used for founder check when isFounder isn't pre-resolved. */
  email?: string;
}

export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  state: FeatureFlagState;
  audience: { betaUserIds?: string[] };
  changedBy?: string | null;
  changedAt?: Date | null;
  controlledRoutes: string[];
}

const KNOWN_TIERS = new Set(["free", "starter", "pro", "scale", "enterprise"]);

function rowToFlag(row: typeof platformFeatureFlags.$inferSelect): FeatureFlag {
  // `state` may be null on rows from before the migration backfill ran;
  // fall back to enabled boolean to avoid 404ing existing features in
  // mid-deploy.
  const state = (row.state as FeatureFlagState | null) ?? (row.enabled ? "on" : "off");
  return {
    key: row.key,
    label: row.label,
    description: row.description,
    state,
    audience: (row.audience ?? {}) as { betaUserIds?: string[] },
    changedBy: row.changedBy,
    changedAt: row.changedAt,
    controlledRoutes: (row.controlledRoutes ?? []) as string[],
  };
}

export function evaluateFlag(flag: FeatureFlag, ctx: FlagContext): boolean {
  switch (flag.state) {
    case "on":
      return true;
    case "off":
      return false;
    case "founder-only":
      return !!ctx.isFounder;
    case "beta": {
      if (ctx.isFounder) return true;
      const ids = flag.audience.betaUserIds ?? [];
      return !!(ctx.userId && ids.includes(ctx.userId));
    }
    case "tier:free":
    case "tier:starter":
    case "tier:pro":
    case "tier:scale": {
      if (ctx.isFounder) return true;
      const required = flag.state.split(":")[1];
      return ctx.tier === required;
    }
    default:
      return false;
  }
}

export const featureFlagService = {
  async getAll(): Promise<FeatureFlag[]> {
    try {
      const rows = await db
        .select()
        .from(platformFeatureFlags)
        .orderBy(platformFeatureFlags.key);
      return rows.map(rowToFlag);
    } catch (err) {
      logger.warn("featureFlags.getAll failed; returning empty", { err: String(err) });
      return [];
    }
  },

  async getByKey(key: string): Promise<FeatureFlag | null> {
    try {
      const [row] = await db
        .select()
        .from(platformFeatureFlags)
        .where(eq(platformFeatureFlags.key, key))
        .limit(1);
      return row ? rowToFlag(row) : null;
    } catch (err) {
      logger.warn("featureFlags.getByKey failed", { key, err: String(err) });
      return null;
    }
  },

  async isEnabled(key: string, ctx: FlagContext): Promise<boolean> {
    const flag = await this.getByKey(key);
    if (!flag) {
      // Missing flag — fail closed (treat as off) EXCEPT for founders, who
      // bypass while flag is being provisioned (mirrors existing featureGate
      // behavior).
      return !!ctx.isFounder;
    }
    return evaluateFlag(flag, ctx);
  },

  async setFlag(
    key: string,
    update: Partial<{ state: FeatureFlagState; audience: { betaUserIds?: string[] }; enabled: boolean }>,
    changedBy: string | undefined,
  ): Promise<FeatureFlag | null> {
    const set: Record<string, unknown> = { changedBy: changedBy ?? null, changedAt: new Date(), updatedAt: new Date() };
    if (update.state !== undefined) {
      if (!FEATURE_FLAG_STATES.includes(update.state)) {
        throw new Error(`Invalid feature flag state: ${update.state}`);
      }
      set.state = update.state;
      // Keep enabled in sync for back-compat consumers.
      set.enabled = update.state === "on";
    }
    if (update.audience !== undefined) set.audience = update.audience;
    if (update.enabled !== undefined && update.state === undefined) {
      set.enabled = update.enabled;
      set.state = update.enabled ? "on" : "off";
    }
    const [updated] = await db
      .update(platformFeatureFlags)
      .set(set)
      .where(eq(platformFeatureFlags.key, key))
      .returning();
    if (!updated) return null;
    return rowToFlag(updated);
  },
};

/**
 * Build a FlagContext from an Express request. Looks for `req.user`,
 * `req.organization`, and falls back to email-based founder check.
 */
export function buildFlagContext(req: {
  user?: any;
  organization?: any;
  isFounder?: boolean;
}): FlagContext {
  const tier = req.organization?.subscriptionTier;
  return {
    userId: req.user?.id ? String(req.user.id) : req.user?.claims?.sub,
    tier: typeof tier === "string" ? tier : undefined,
    isFounder: !!req.isFounder || !!req.organization?.isFounder,
    email: req.user?.claims?.email || req.user?.email,
  };
}

export const KNOWN_FLAG_TIER_VALUES = KNOWN_TIERS;
