/**
 * expensiveEndpointGuard — Phase 0 protection for AI/comps/Mapbox endpoints.
 *
 * Stacks two checks before any expensive call fans out to Anthropic /
 * OpenAI / Mapbox / comps providers:
 *
 *   1. Per-user 60-second sliding window cap (varies by endpoint shape:
 *      chat = 30/min, comps = 20/min, today-payload = 10/min). This is
 *      finer-grained than the org-level aiRateLimit + ensures one user can't
 *      saturate their own org's budget in seconds.
 *
 *   2. Per-org daily USD token budget — tier-aware defaults:
 *        free          $0.50/day
 *        trial         $2.00/day
 *        starter       $10.00/day
 *        pro           $50.00/day
 *        scale         $200.00/day
 *        enterprise    unlimited
 *      Founder + isFounder orgs skip the check entirely.
 *
 * On exceed, returns Errors.limitExceeded with a structured payload the
 * client UI renders as "You've hit today's budget — upgrade or wait until
 * tomorrow". Never silently fails.
 *
 * # Why this is separate from usageLimitGate
 *
 * usageLimitGate counts resource creation (leads, deals). This guard meters
 * AI USD spend. They run alongside each other — usageLimitGate enforces
 * the per-tier feature gates while expensiveEndpointGuard enforces the
 * cost ceiling that protects margins.
 *
 * # Why this is separate from aiRateLimit / aiLimiter
 *
 * aiLimiter caps per-user request count regardless of cost.
 * aiRateLimit caps per-org req/min and req/hour.
 * expensiveEndpointGuard caps per-org $USD/day — the actual margin defense.
 * All three stack cleanly; the most-restrictive trips first.
 */

import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/request";
import { createRateLimiter } from "./rateLimit";
import { sumTodayUsd } from "../services/aiQuotaService";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";

/**
 * Per-tier default USD/day budget. Read once on first call; can be
 * overridden per-org via organizations.orgAiQuotaDailyUsd (existing column).
 *
 * "trial" is the explicit free-tier trial bonus — orgs with trialEndsAt
 * in the future get the higher cap; orgs that consumed the trial fall
 * back to the bare free tier. This mirrors how shared/billing decides
 * trial vs free for everything else.
 *
 * 0 means "unlimited" (founder + enterprise).
 */
const TIER_DAILY_USD_BUDGET: Record<string, number> = {
  free: 0.5,
  trial: 2.0,
  starter: 10.0,
  pro: 50.0,
  scale: 200.0,
  enterprise: 0,
  founder: 0,
};

function isInTrial(org: { trialEndsAt?: Date | string | null; trialUsed?: boolean | null } | undefined): boolean {
  if (!org) return false;
  if (org.trialUsed) return false;
  const ends = org.trialEndsAt;
  if (!ends) return false;
  const ms = typeof ends === "string" ? Date.parse(ends) : ends.getTime();
  return Number.isFinite(ms) && ms > Date.now();
}

/**
 * Resolve the effective daily USD cap for the org:
 *   1. Founder / enterprise → 0 (unlimited)
 *   2. Org-level override (organizations.orgAiQuotaDailyUsd > 0)
 *   3. Trial tier if trialEndsAt is in the future and !trialUsed
 *   4. Tier default from TIER_DAILY_USD_BUDGET
 *   5. Free-tier floor
 */
function resolveDailyBudgetUsd(req: AuthenticatedRequest): number {
  const org = req.organization as
    | (AuthenticatedRequest["organization"] & {
        orgAiQuotaDailyUsd?: string | number | null;
        trialEndsAt?: Date | string | null;
        trialUsed?: boolean | null;
      })
    | undefined;
  if (req.isFounder) return 0;
  const tier = (org?.subscriptionTier ?? "free").toLowerCase();
  if (tier === "enterprise" || tier === "founder") return 0;

  // Per-org override takes precedence if set to a finite > 0 value.
  const override = org?.orgAiQuotaDailyUsd;
  if (override !== null && override !== undefined) {
    const v = typeof override === "string" ? parseFloat(override) : Number(override);
    // 50.00 is the platform-wide default from the schema. We treat "50"
    // as "use the tier default" rather than override, so an admin must
    // explicitly bump it above 50 (or below) for the override to take.
    if (Number.isFinite(v) && v > 0 && Math.abs(v - 50.0) > 0.001) return v;
  }

  if (tier === "free" && isInTrial(org)) {
    return TIER_DAILY_USD_BUDGET.trial;
  }

  return TIER_DAILY_USD_BUDGET[tier] ?? TIER_DAILY_USD_BUDGET.free;
}

// ── Per-user 60-second sliding cap ──────────────────────────────────────────
// One limiter per (endpointLabel, requestsPerMinute) tuple, memoized so we
// don't allocate fresh closures per request. Keyed by user-id (authenticated
// route, so user is always present).

const perUserLimiters = new Map<string, ReturnType<typeof createRateLimiter>>();

function getPerUserLimiter(label: string, perMinute: number) {
  const key = `${label}:${perMinute}`;
  let limiter = perUserLimiters.get(key);
  if (!limiter) {
    limiter = createRateLimiter(
      { maxRequests: perMinute, windowMs: 60 * 1000 },
      (req) => `ee:${label}:user:${(req as AuthenticatedRequest).user?.id ?? "anon"}`,
    );
    perUserLimiters.set(key, limiter);
  }
  return limiter;
}

interface GuardOptions {
  /** Short label used in log + key (e.g. "today", "pax-chat", "comps"). */
  label: string;
  /** Per-user requests/minute cap. */
  perMinute: number;
}

/**
 * Factory: per-endpoint guard combining the sliding window + budget check.
 * Returns Express middleware that runs the user-level cap first (cheap,
 * in-memory/Redis) then the org-level USD budget (DB read). On either
 * trip, sends Errors.limitExceeded with structured details.
 */
export function expensiveEndpointGuard(opts: GuardOptions) {
  const limiter = getPerUserLimiter(opts.label, opts.perMinute);

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    // Step 1: per-user 60s sliding cap.
    let userCapTripped = false;
    let userCapRetryAfter = 60;
    await new Promise<void>((resolve) => {
      let settled = false;
      const originalStatus = res.status.bind(res);
      const originalJson = res.json.bind(res);
      // Detect the inner limiter's 429 by hooking res.status. If it's 429
      // we capture and abort; otherwise let the response proceed.
      (res as any).status = (code: number) => {
        if (code === 429) {
          userCapTripped = true;
          const fakeJson = {
            json: (body: { retryAfter?: number } | unknown) => {
              if (body && typeof body === "object" && "retryAfter" in body) {
                const ra = (body as { retryAfter?: unknown }).retryAfter;
                if (typeof ra === "number") userCapRetryAfter = ra;
              }
              // Restore handlers so respondBudgetExceeded can use them.
              (res as any).status = originalStatus;
              (res as any).json = originalJson;
              if (!settled) { settled = true; resolve(); }
              return res;
            },
            end: () => res,
            setHeader: (n: string, v: string | number | readonly string[]) => res.setHeader(n, v),
          };
          return fakeJson as unknown as Response;
        }
        return originalStatus(code);
      };
      Promise.resolve(
        limiter(req, res, () => {
          // Pass-through — restore status/json before continuing.
          (res as any).status = originalStatus;
          (res as any).json = originalJson;
          if (!settled) { settled = true; resolve(); }
        }),
      ).catch(() => {
        (res as any).status = originalStatus;
        (res as any).json = originalJson;
        if (!settled) { settled = true; resolve(); }
      });
    });

    if (userCapTripped) {
      res.setHeader("Retry-After", String(userCapRetryAfter));
      return Errors.limitExceeded(
        res,
        {
          route: opts.label,
          lane: "per-user-60s",
          retryAfterSeconds: userCapRetryAfter,
          reason: "per_user_burst_cap",
          perMinute: opts.perMinute,
          message: `You're sending ${opts.label} requests faster than the burst cap (${opts.perMinute}/minute). Wait ${userCapRetryAfter}s.`,
        },
        { docsSlug: "expensive-endpoint-burst" },
      );
    }

    // Step 2: per-org daily USD budget.
    if (req.isFounder) return next();
    const orgId = req.organizationId;
    if (!orgId) return next(); // Pre-org request (rare on these routes).

    const capUsd = resolveDailyBudgetUsd(req);
    if (capUsd <= 0) return next(); // Unlimited tier.

    let usedToday = 0;
    try {
      usedToday = await sumTodayUsd(orgId);
    } catch (err) {
      // Accounting read failure must not block users. Log + pass.
      logger.warn("[expensiveEndpointGuard] sumTodayUsd failed — failing open", {
        metadata: { orgId, label: opts.label, error: err instanceof Error ? err.message : String(err) },
      });
      return next();
    }

    if (usedToday >= capUsd) {
      // Soft-degrade — structured payload, never silent.
      return Errors.limitExceeded(
        res,
        {
          route: opts.label,
          lane: "per-org-daily-budget",
          tier: (req.organization?.subscriptionTier ?? "free"),
          usedUsdToday: Number(usedToday.toFixed(4)),
          capUsd,
          retryAfterSeconds: secondsUntilUtcMidnight(),
          reason: "daily_budget_exhausted",
          message:
            `You've hit today's AI budget for your plan ($${capUsd.toFixed(2)}). ` +
            `Upgrade your plan or wait until tomorrow — the budget resets at 00:00 UTC.`,
          upgradeUrl: "/settings#billing",
        },
        { docsSlug: "ai-daily-budget" },
      );
    }

    next();
  };
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));
  return Math.max(0, Math.floor((tomorrow.getTime() - now.getTime()) / 1000));
}

// Pre-built guards for the four hot endpoints. Numbers come from the parent
// task brief — chat is the biggest user-facing burst risk (30/min covers
// "typing a fast follow-up" without enabling brute-force token burning);
// today is a one-shot dashboard load that should never need 10+ per minute;
// comps is human-paced (search → click → search again).
export const todayGuard = expensiveEndpointGuard({ label: "today", perMinute: 10 });
export const paxChatGuard = expensiveEndpointGuard({ label: "pax-chat", perMinute: 30 });
export const compsGuard = expensiveEndpointGuard({ label: "comps", perMinute: 20 });
