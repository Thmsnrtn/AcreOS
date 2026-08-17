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

/** Raised when someone tries to set a flag whose subsystem is deleted. */
export class RetiredFeatureFlagError extends Error {
  constructor(public readonly key: string, public readonly verdict: string) {
    super(`${key} is retired: ${verdict}`);
    this.name = "RetiredFeatureFlagError";
  }
}

/**
 * Flag rows that survive in the database for subsystems whose CODE IS DELETED.
 *
 * `platform_feature_flags` is seeded by migration and outlives the features it
 * names. Three seeds refer to subsystems removed under deletion-ledger KILL
 * verdicts, and nothing in `server/` or `client/src` references any of them —
 * no `requireLadderFlag`, no `requireFlag`, and no client route for the paths
 * they control (`/vision-ai`, `/voice`, `/negotiation` are all gone from
 * App.tsx).
 *
 * Unit 76 CREATED one of them, and that is why this exists: executing the
 * negotiation copilot's KILL deleted the router, the service, the page and the
 * client route, and left `feature_negotiation_copilot` sitting in the flag
 * catalogue. A KILL is not finished while its switch is still on the wall.
 *
 * WHY THIS MATTERS MORE SINCE THE FLAG WRITES WERE FIXED. Before unit 81, two
 * of the three founder toggles wrote a back-compat column nothing read, so
 * flipping any flag was inert. Now the toggles work — which turns a dead row
 * from a curiosity into a live control that reports success and changes
 * nothing, on a console whose whole job is telling the founder what is on.
 *
 * So: hidden from `getAll` (and therefore from the console and from
 * `/api/config/features`), ABSENT from `getByKey`, and refused by `setFlag`.
 * The ROWS are left in place — deleting platform rows is the same class of
 * action as the 2026-08-01 table drops, which took an explicit founder ruling,
 * and this list makes them inert either way.
 *
 * A key comes off this list when its subsystem is genuinely rebuilt, in the same
 * change that rebuilds it. `featureFlagRetiredKeys.test.ts` checks both
 * directions: every key here must still be unreferenced, and every deleted
 * subsystem's flag must still be here.
 */
export const RETIRED_FLAG_KEYS: Record<string, string> = {
  feature_vision_ai:
    "KILL executed 2026-08-01 — routes-vision-ai.ts, services/visionAI.ts and " +
    "pages/vision-ai.tsx are deleted, and both satellite tables were dropped.",
  feature_voice_ai:
    "KILL executed 2026-08-01 — the voice pipeline (routes-voice.ts, " +
    "services/voiceAI.ts, callRouting.ts) and its two tables are gone.",
  feature_negotiation_copilot:
    "KILL executed 2026-08-13 — routes-negotiation.ts, " +
    "services/negotiationCopilot.ts, pages/negotiation-copilot.tsx and the " +
    "three ai-operations copilot endpoints are deleted.",
};

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
      // Retired keys are filtered HERE rather than at each caller, so the
      // founder console, /api/config/features and anything else reading the
      // catalogue all see the same set. See RETIRED_FLAG_KEYS.
      return rows.filter((r) => !(r.key in RETIRED_FLAG_KEYS)).map(rowToFlag);
    } catch (err) {
      logger.warn("featureFlags.getAll failed; returning empty", { err: String(err) });
      return [];
    }
  },

  async getByKey(key: string): Promise<FeatureFlag | null> {
    // A retired key reads as ABSENT, not as off. `isEnabled` treats a missing
    // flag as "off for everyone except a founder provisioning it", which is the
    // right answer for a subsystem that no longer exists — and it keeps a stored
    // `state: "on"` from ever being honoured.
    if (key in RETIRED_FLAG_KEYS) return null;
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
    // Refused rather than silently ignored: a console that accepts a change to
    // a dead flag and reports success is the exact failure this list exists to
    // stop. Both admin routes render it as 404.
    if (key in RETIRED_FLAG_KEYS) {
      throw new RetiredFeatureFlagError(key, RETIRED_FLAG_KEYS[key]);
    }
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
    userId: req.user?.id ? String(req.user.id) : req.user?.id,
    tier: typeof tier === "string" ? tier : undefined,
    isFounder: !!req.isFounder || !!req.organization?.isFounder,
    email: req.user?.email || req.user?.email,
  };
}

export const KNOWN_FLAG_TIER_VALUES = KNOWN_TIERS;
