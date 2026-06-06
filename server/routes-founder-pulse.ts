/**
 * /api/founder/pulse — Solene's daily one-line, rendered as structured data.
 *
 * Founder-only. Returns everything the /founder home surface needs to
 * narrate the current state of the company back to Tom:
 *
 *   - asOf, sha, health:      live system signals
 *   - commitsLast24h, recent: last 5 commits via child_process git log
 *   - mrr, burnRate, runway:  capital position (Phase Zero-Zero honest defaults)
 *   - autonomyHorizon:        5-axis score → days Tom can step away
 *   - phase:                  current phase name, days in, active OKR
 *   - decisionsWaiting:       placeholder (0) until task-tracking is wired
 *
 * Pattern: isAuthenticated + getOrCreateOrg + requireFounder.
 * Identical gate as routes-founder-customers.ts.
 */

import type { Express, Response } from "express";
import { execSync } from "child_process";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { getBucketBalance } from "./services/financial-ledger";
import { dbForReads } from "./db-replica";
import { financialLedger } from "@shared/schema";
import { and, eq, gte, sum } from "drizzle-orm";
import {
  RESERVE_FLOOR_RULE,
  assembleReserveFloorCheck,
  type ReserveBucketName,
} from "@shared/finance/reserve-floor";

// ─── Autonomy Horizon scoring ──────────────────────────────────────────────
// Charter §"Autonomy Horizon — scoring":
//   Each axis 0-100. Horizon = MIN(all five).
//   Linear map: 100 → 1200 days, 50 → 30 days, 0 → 0 days.
//   Current Phase Zero-Zero honest defaults — every axis scores low
//   because the evidence base isn't wired yet. Scores will rise
//   as telemetry, billing, and compliance pipelines populate.

function scoreToDays(score: number): number {
  if (score <= 0) return 0;
  if (score >= 100) return 1200;
  // Piecewise linear: 0→0, 50→30, 100→1200
  if (score <= 50) {
    return Math.round((score / 50) * 30);
  }
  return Math.round(30 + ((score - 50) / 50) * 1170);
}

interface AxisScore {
  score: number;   // 0–100
  days: number;    // scoreToDays(score)
  label: string;
  evidence: string;
}

interface AutonomyHorizon {
  days: number;
  axes: {
    stability: AxisScore;
    reserves: AxisScore;
    compliance: AxisScore;
    customerHealth: AxisScore;
    decisionVelocity: AxisScore;
  };
  weakestLink: string;
}

// ─── Reserves — live read from financial_ledger ───────────────────────────
//
// Bug 2 fix (2026-06-06): the Reserves axis used to be a hardcoded score=30.
// Pulse now reads the real reserve-bucket balances out of `financial_ledger`
// (the Pillar 1 source-of-truth wired in by Wave H2) and compares them to
// the constitutional floor in `shared/finance/reserve-floor.ts`. The axis
// score is now derived from the actual reserves-vs-floor headroom so Pulse
// becomes a live capital signal instead of a UI stub.

interface ReservesLive {
  /** Combined balance of (tax_reserve + refund_reserve + profit_reserve), cents. */
  reservesTotalCents: number;
  /** Trailing-window revenue (denominator for the floor), cents. */
  trailingRevenueCents: number;
  /** Floor target in cents (= trailingRevenue × minFraction). */
  floorCents: number;
  /** Headroom (positive) or breach (negative), cents. */
  headroomCents: number;
  /** Whether reserves are currently below the constitutional floor. */
  belowFloor: boolean;
  /** Percentage of floor — 100 = exactly at floor, <100 = below. */
  percentOfFloor: number;
  /** Per-bucket balances for the inspector breakdown. */
  buckets: Record<ReserveBucketName, number>;
  /** When reserves were last sampled. */
  asOf: string;
}

async function loadReservesLive(): Promise<ReservesLive> {
  const now = new Date();
  const windowStart = new Date(
    now.getTime() - RESERVE_FLOOR_RULE.trailingWindowDays * 24 * 60 * 60 * 1000,
  );

  // Per-bucket balances, in parallel.
  const bucketBalances = await Promise.all(
    RESERVE_FLOOR_RULE.reserveBuckets.map(async (bucket) => {
      const cents = await getBucketBalance(bucket);
      return [bucket, cents] as const;
    }),
  );
  const buckets = Object.fromEntries(bucketBalances) as Record<ReserveBucketName, number>;
  const reservesTotalCents = bucketBalances.reduce((sum, [, cents]) => sum + cents, 0);

  // Trailing-90-day revenue across all orgs. Replica-routed.
  const reader = await dbForReads("founder-pulse.reserves-trailing-revenue");
  const [revRow] = await reader
    .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.category, "revenue"),
        gte(financialLedger.postedAt, windowStart),
      ),
    );
  const trailingRevenueCents = revRow?.total ?? 0;

  const check = assembleReserveFloorCheck({
    reservesTotalCents,
    trailingRevenueCents,
  });

  // Percent-of-floor; clamp to 0 when there is no floor (no revenue yet).
  const percentOfFloor =
    check.floorCents > 0
      ? Math.round((reservesTotalCents / check.floorCents) * 100)
      : reservesTotalCents > 0
        ? 100
        : 0;

  return {
    reservesTotalCents,
    trailingRevenueCents,
    floorCents: check.floorCents,
    headroomCents: check.headroomCents,
    belowFloor: check.belowFloor,
    percentOfFloor,
    buckets,
    asOf: now.toISOString(),
  };
}

/**
 * Map live reserves → autonomy-horizon axis score (0-100).
 *
 * Heuristic:
 *   - No trailing revenue yet (Phase Zero-Zero, $0 MRR): keep a low honest
 *     baseline (30) — there's nothing to score against, and the floor is
 *     trivially satisfied by holding zero reserves against zero revenue.
 *   - Reserves at-or-above floor (percentOfFloor >= 100): score climbs from
 *     60 (just at floor) toward 95 (3× floor) as headroom grows.
 *   - Below floor: score degrades from 60 down to 10 as the breach widens.
 */
function reservesAxisScore(live: ReservesLive): {
  score: number;
  evidence: string;
} {
  if (live.trailingRevenueCents <= 0) {
    return {
      score: 30,
      evidence: `No trailing revenue. Reserves $${(live.reservesTotalCents / 100).toFixed(2)}.`,
    };
  }
  const pct = live.percentOfFloor;
  let score: number;
  if (pct >= 100) {
    // 100 → 60, 200 → 80, 300+ → 95.
    score = Math.min(95, 60 + Math.round((pct - 100) / 10));
  } else {
    // 99 → 59, 50 → 30, 0 → 10.
    score = Math.max(10, Math.round(10 + (pct / 100) * 50));
  }
  return {
    score,
    evidence: `Reserves $${(live.reservesTotalCents / 100).toFixed(2)} (${pct}% of $${(live.floorCents / 100).toFixed(2)} floor).`,
  };
}

interface ComputeHorizonArgs {
  reservesLive: ReservesLive;
}

function computeAutonomyHorizon(args: ComputeHorizonArgs): AutonomyHorizon {
  // Phase Zero-Zero honest defaults — every axis except Reserves is still
  // computed from honest stubs because the evidence base isn't wired yet.
  // Stability: product shipped and auth-reset bug is closed, but no 90-day
  //   uptime data yet → 42 (translates to ~25 days).
  // Reserves: NOW LIVE — derived from financial_ledger via Wave H2.
  // Compliance: ToS v1 and Privacy v1 just drafted by Beatrice (latest commit),
  //   no formal audit yet → 35 (21 days).
  // Customer health: 0 paying customers, no churn/NPS data → 20 (12 days).
  // Decision velocity: team is operational but Tom is the only human, so
  //   effectively 0% team-resolved on hard decisions → 25 (15 days).
  const reservesScored = reservesAxisScore(args.reservesLive);
  const axes = {
    stability: {
      score: 42,
      label: "Stability",
      evidence: "Auth-reset closed. No 90-day SLA data yet.",
    },
    reserves: {
      score: reservesScored.score,
      label: "Reserves",
      evidence: reservesScored.evidence,
    },
    compliance: {
      score: 35,
      label: "Compliance",
      evidence: "ToS v1 + Privacy v1 drafted. No formal audit yet.",
    },
    customerHealth: {
      score: 20,
      label: "Customer Health",
      evidence: "0 paying customers. NPS / churn not yet measurable.",
    },
    decisionVelocity: {
      score: 25,
      label: "Decision Velocity",
      evidence: "Team operational. Tom is the only human decision-maker.",
    },
  };

  const axisEntries = Object.entries(axes) as [keyof typeof axes, typeof axes[keyof typeof axes]][];
  const scored = axisEntries.map(([key, ax]) => [key, { ...ax, days: scoreToDays(ax.score) }] as [keyof typeof axes, AxisScore]);
  const scoredMap = Object.fromEntries(scored) as AutonomyHorizon["axes"];

  const minEntry = scored.reduce((min, entry) => (entry[1].score < min[1].score ? entry : min));
  const horizonDays = scoreToDays(minEntry[1].score);

  return {
    days: horizonDays,
    axes: scoredMap,
    weakestLink: minEntry[1].label,
  };
}

// ─── Git helpers ───────────────────────────────────────────────────────────

interface CommitRow {
  sha: string;
  shortSha: string;
  author: string;
  message: string;
  date: string;
  githubUrl: string;
}

function getRecentCommits(limit = 5): CommitRow[] {
  try {
    const raw = execSync(
      `git log -${limit} --pretty=format:"%H|%an|%s|%ci" --no-merges`,
      { encoding: "utf8", timeout: 5000 },
    ).trim();
    if (!raw) return [];

    return raw.split("\n").map((line) => {
      const [sha, author, message, date] = line.split("|");
      const shortSha = (sha ?? "").slice(0, 7);
      return {
        sha: sha ?? "",
        shortSha,
        author: author ?? "",
        message: message ?? "",
        date: date?.trim() ?? "",
        githubUrl: `https://github.com/thmsnrtn/AcreOS/commit/${sha ?? ""}`,
      };
    });
  } catch (err) {
    logger.warn("[founder-pulse] git log failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function getCommitsLast24h(): number {
  try {
    const raw = execSync(
      `git log --since="24 hours ago" --pretty=format:"%H" --no-merges`,
      { encoding: "utf8", timeout: 5000 },
    ).trim();
    if (!raw) return 0;
    return raw.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

// ─── Phase + capital ───────────────────────────────────────────────────────

// Phase Zero-Zero started 2026-05-31 (constitution + charter signed).
const PHASE_ZERO_ZERO_START = new Date("2026-05-31T00:00:00Z");
const MRR_CENTS = 0;
const BURN_RATE_CENTS = 2400; // ~$24/mo (Fly.io + domain + misc)

function getDaysInPhase(): number {
  const now = new Date();
  const diffMs = now.getTime() - PHASE_ZERO_ZERO_START.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

// ─── Route ────────────────────────────────────────────────────────────────

export function registerFounderPulseRoutes(app: Express) {
  app.get(
    "/api/founder/pulse",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const now = new Date();
        const sha = process.env.VITE_GIT_SHA ?? "dev";
        const daysInPhase = getDaysInPhase();
        const recentCommits = getRecentCommits(5);
        const commitsLast24h = getCommitsLast24h();
        const reservesLive = await loadReservesLive();
        const autonomyHorizon = computeAutonomyHorizon({ reservesLive });

        // Runway: indefinite at $0 MRR (expense is $24/mo, Tom is funding
        // infra personally). We report it honestly as "funded by founder"
        // rather than inflating a runway number from personal assets.
        const runwayMonths: number | null = null; // null = "funded by founder"

        const payload = {
          asOf: now.toISOString(),
          sha,
          // health: 200 means the API that is serving this response is alive.
          health: 200,
          commitsLast24h,
          recentCommits,

          // Capital
          mrr: MRR_CENTS / 100,
          mrrCents: MRR_CENTS,
          burnRate: BURN_RATE_CENTS / 100,
          burnRateCents: BURN_RATE_CENTS,
          runwayMonths,
          runwayLabel: "Founder-funded",
          // Phase 2 gate: founder draw activates at $1,000 MRR
          founderDrawTarget: 1500, // $/mo at Phase 2
          founderDrawMrrTrigger: 1000, // $1,000 MRR
          founderDrawEtaMonths: null, // unknown until revenue starts

          // Autonomy Horizon
          autonomyHorizon,

          // Reserves (live from financial_ledger — Pillar 1 / Wave H2).
          // Independent of the autonomyHorizon.axes.reserves axis so the
          // founder cockpit can render the raw bucket numbers alongside
          // the derived score.
          reserves: {
            totalCents: reservesLive.reservesTotalCents,
            total: reservesLive.reservesTotalCents / 100,
            floorCents: reservesLive.floorCents,
            floor: reservesLive.floorCents / 100,
            headroomCents: reservesLive.headroomCents,
            headroom: reservesLive.headroomCents / 100,
            percentOfFloor: reservesLive.percentOfFloor,
            belowFloor: reservesLive.belowFloor,
            trailingRevenueCents: reservesLive.trailingRevenueCents,
            trailingRevenue: reservesLive.trailingRevenueCents / 100,
            trailingWindowDays: RESERVE_FLOOR_RULE.trailingWindowDays,
            buckets: reservesLive.buckets,
            asOf: reservesLive.asOf,
          },

          // Phase
          phase: {
            name: "Phase Zero-Zero",
            label: "Stabilize",
            daysIn: daysInPhase,
            okr: "Reach Phase 1: $200 MRR by August 1, 2026",
            okrTargetMrr: 200,
            okrDeadline: "2026-08-01",
            progressPct: Math.min(100, Math.round((MRR_CENTS / 100 / 200) * 100)),
          },

          // Decisions waiting (placeholder — wire to task-tracking at Phase 1)
          decisionsWaiting: 0,
        };

        logger.info("[founder-pulse] served", {
          sha,
          autonomyDays: autonomyHorizon.days,
          commitsLast24h,
          daysInPhase,
        });

        return res.json(payload);
      } catch (error) {
        logger.error("[founder-pulse] failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return Errors.internal(res, error);
      }
    },
  );
}
