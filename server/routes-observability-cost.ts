/**
 * routes-observability-cost — founder-only Sentry cost observability endpoint.
 *
 * GET /api/founder/observability-cost
 *
 * Surfaces the current Sentry sampling rates and a projected monthly volume
 * estimate, plus recommended sampling rates so we stay under the free-tier
 * ceiling (5k errors / 10k performance units / 50 replays per month).
 *
 * If `SENTRY_AUTH_TOKEN` and `SENTRY_ORG_SLUG` are set, we also pull live
 * stats from Sentry's stats API. Otherwise we fall back to "estimate" mode
 * derived from active-customer count × per-customer error/perf assumptions.
 */

import type { Express, Response } from "express";
import { sql } from "drizzle-orm";

import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

import { db } from "./db";
import { organizations } from "@shared/schema";

// ─── Free-tier ceilings (May 2026) ──────────────────────────────────────────
const FREE_TIER = {
  errors: 5_000,
  performanceUnits: 10_000,
  replays: 50,
} as const;

// ─── Per-customer baseline assumptions ──────────────────────────────────────
// Tuned from production telemetry (Wave 6 hygiene run, commit 4e6d5c08).
// "Per customer" here means per paying customer org, averaged over the month
// — not per daily active. Roughly half of customers are active on a given day
// and an active session is ~30 page-loads. So per customer per day:
//   - 0.3 unfiltered errors (post beforeSend filter)
//   - 15 page-loads on average (30 page-loads × 50% DAU)
//   - 0.5 user sessions on average (1 session × 50% DAU)
const PER_CUSTOMER_PER_DAY = {
  rawErrors: 0.3,
  pageLoads: 15,
  sessions: 0.5,
} as const;

interface CostProjection {
  customers: number;
  rates: {
    tracesSampleRate: number;
    replaysSessionSampleRate: number;
    replaysOnErrorSampleRate: number;
    profilesSampleRate: number;
  };
  monthly: {
    errors: number;
    performanceUnits: number;
    replays: number;
  };
  freeTier: typeof FREE_TIER;
  withinFreeTier: boolean;
  recommendation: string;
}

function readNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function projectMonthlyVolume(customers: number, rates: CostProjection["rates"]): CostProjection {
  // 30 days/month for round numbers.
  const errorsPerMonth = Math.round(customers * PER_CUSTOMER_PER_DAY.rawErrors * 30);
  // Each sampled trace = 1 perf unit on the new Sentry SKU. Page loads * traces rate.
  const perfPerMonth = Math.round(
    customers * PER_CUSTOMER_PER_DAY.pageLoads * 30 * rates.tracesSampleRate,
  );
  // Replays: session-sampled + error-triggered (which we approximate as
  // errors * replaysOnErrorSampleRate, capped at the error count).
  const sessionReplays = customers * PER_CUSTOMER_PER_DAY.sessions * 30 * rates.replaysSessionSampleRate;
  const errorReplays = errorsPerMonth * rates.replaysOnErrorSampleRate;
  const replaysPerMonth = Math.round(sessionReplays + errorReplays);

  const within =
    errorsPerMonth <= FREE_TIER.errors &&
    perfPerMonth <= FREE_TIER.performanceUnits &&
    replaysPerMonth <= FREE_TIER.replays;

  let recommendation: string;
  if (within) {
    recommendation = "Within free-tier ceiling. No action needed.";
  } else {
    const advice: string[] = [];
    if (errorsPerMonth > FREE_TIER.errors) {
      advice.push("Errors over free tier — extend beforeSend noise filters.");
    }
    if (perfPerMonth > FREE_TIER.performanceUnits) {
      const targetRate = Math.max(
        0.001,
        rates.tracesSampleRate * (FREE_TIER.performanceUnits / Math.max(perfPerMonth, 1)),
      );
      advice.push(
        `Performance over free tier — drop VITE_SENTRY_TRACES_RATE to ~${targetRate.toFixed(3)}.`,
      );
    }
    if (replaysPerMonth > FREE_TIER.replays) {
      const targetRate = Math.max(
        0.0,
        rates.replaysSessionSampleRate *
          (Math.max(0, FREE_TIER.replays - errorReplays) / Math.max(sessionReplays, 1)),
      );
      advice.push(
        `Replays over free tier — drop VITE_SENTRY_REPLAY_SESSION_RATE to ~${targetRate.toFixed(4)}.`,
      );
    }
    recommendation = advice.join(" ");
  }

  return {
    customers,
    rates,
    monthly: {
      errors: errorsPerMonth,
      performanceUnits: perfPerMonth,
      replays: replaysPerMonth,
    },
    freeTier: FREE_TIER,
    withinFreeTier: within,
    recommendation,
  };
}

export function registerObservabilityCostRoutes(app: Express): void {
  app.get(
    "/api/founder/observability-cost",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(
            res,
            "Observability cost dashboard is restricted to founders",
          );
        }

        // Active customer count = orgs with onboarding completed.
        const [{ count: activeCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(organizations)
          .where(sql`${organizations.onboardingCompleted} = true`);

        const customers = Number(activeCount) || 0;

        const rates = {
          tracesSampleRate: readNumberEnv("VITE_SENTRY_TRACES_RATE", 0.05),
          replaysSessionSampleRate: readNumberEnv(
            "VITE_SENTRY_REPLAY_SESSION_RATE",
            0.01,
          ),
          replaysOnErrorSampleRate: readNumberEnv(
            "VITE_SENTRY_REPLAY_ON_ERROR_RATE",
            1.0,
          ),
          profilesSampleRate: readNumberEnv("VITE_SENTRY_PROFILES_RATE", 0.0),
        };

        const projection = projectMonthlyVolume(customers, rates);
        // Also project the same usage at 100 customers, the founder's planning bar.
        const at100 = projectMonthlyVolume(100, rates);

        // Optional: if we have a SENTRY_AUTH_TOKEN, query the stats API for
        // the live last-30-day usage. We do this best-effort — failures
        // fall back to the projection-only response.
        let live: { errors: number; performanceUnits: number; replays: number } | null = null;
        const sentryToken = process.env.SENTRY_AUTH_TOKEN;
        const sentryOrg = process.env.SENTRY_ORG_SLUG;
        if (sentryToken && sentryOrg) {
          try {
            // Sentry stats API: docs.sentry.io/api/organizations/retrieve-event-counts-for-an-organization-v2/
            const url = `https://sentry.io/api/0/organizations/${encodeURIComponent(sentryOrg)}/stats_v2/?statsPeriod=30d&interval=1d&groupBy=category&field=sum(quantity)`;
            const r = await fetch(url, {
              headers: { Authorization: `Bearer ${sentryToken}` },
              signal: AbortSignal.timeout(4000),
            });
            if (r.ok) {
              const data = (await r.json()) as {
                groups?: Array<{
                  by?: { category?: string };
                  totals?: { "sum(quantity)"?: number };
                }>;
              };
              const totals = { errors: 0, performanceUnits: 0, replays: 0 };
              for (const g of data.groups ?? []) {
                const cat = g.by?.category;
                const q = Number(g.totals?.["sum(quantity)"] ?? 0);
                if (cat === "error") totals.errors += q;
                else if (cat === "transaction" || cat === "transaction_indexed") totals.performanceUnits += q;
                else if (cat === "replay") totals.replays += q;
              }
              live = totals;
            }
          } catch (err) {
            logger.warn({ err }, "[observability-cost] Sentry stats API failed; using projection only");
          }
        }

        return res.json({
          source: live ? "live+projection" : "projection",
          live,
          current: projection,
          at100Customers: at100,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
