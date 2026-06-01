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

function computeAutonomyHorizon(): AutonomyHorizon {
  // Phase Zero-Zero honest defaults.
  // Stability: product shipped and auth-reset bug is closed, but no 90-day
  //   uptime data yet → 42 (translates to ~25 days).
  // Reserves: $0 MRR, burn ~$24/mo, but Tom is personally floating infra →
  //   indefinite in practice, but no formal reserve account → 30 (18 days).
  // Compliance: ToS v1 and Privacy v1 just drafted by Beatrice (latest commit),
  //   no formal audit yet → 35 (21 days).
  // Customer health: 0 paying customers, no churn/NPS data → 20 (12 days).
  // Decision velocity: team is operational but Tom is the only human, so
  //   effectively 0% team-resolved on hard decisions → 25 (15 days).
  const axes = {
    stability: {
      score: 42,
      label: "Stability",
      evidence: "Auth-reset closed. No 90-day SLA data yet.",
    },
    reserves: {
      score: 30,
      label: "Reserves",
      evidence: "$0 MRR. Burn ~$24/mo. No formal reserve account.",
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
  } as const;

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
        const autonomyHorizon = computeAutonomyHorizon();

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
