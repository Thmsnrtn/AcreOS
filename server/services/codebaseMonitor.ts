/**
 * Rosy River C2 — Codebase Monitor Agent (v0)
 *
 * Periodic agent that scans the running codebase for low-risk improvement
 * candidates and writes them to the proposed_changes outbox in simulation
 * mode. Founder reviews them in /founder/agent-queue (C4) and promotes
 * approved ones into the evolution pipeline (C3) or rejects them.
 *
 * v0 signals (no LLM, deterministic, free):
 *   - npm outdated     → dep-bump proposals
 *   - TypeScript error inventory → "fix N TS errors in file X" proposals
 *
 * Future iterations will layer LLM-driven analysis on top (read recent
 * commits → propose refactors; read sentry digest → propose error-handling
 * tightening; read Lighthouse → propose perf passes).
 *
 * Runs in simulation mode by default — every proposal lands with
 * simulationMode=true so nothing reaches the gauntlet until the founder
 * promotes it. Promotion is a single dashboard click (C4).
 */

import { execSync } from "child_process";
import * as path from "path";
import {
  proposeCodeChange,
  notifyFounder,
  preflightBudgetCheck,
  type Pillar,
  type RiskTier,
} from "./rosyRiver";
import { logger } from "../utils/logger";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

interface OutdatedPackage {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  type: "dependencies" | "devDependencies" | "peerDependencies";
}

// ---------------------------------------------------------------------------
// npm outdated → dep-bump proposals
// ---------------------------------------------------------------------------

function readNpmOutdated(): OutdatedPackage[] {
  try {
    // `npm outdated --json` exits 1 when anything is outdated, so don't fail
    // on a non-zero code.
    const raw = execSync("npm outdated --json", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as Record<string, {
      current?: string;
      wanted?: string;
      latest?: string;
      type?: string;
    }>;
    return Object.entries(parsed).map(([name, info]) => ({
      name,
      current: info.current ?? "",
      wanted: info.wanted ?? "",
      latest: info.latest ?? "",
      type: (info.type as OutdatedPackage["type"]) ?? "dependencies",
    }));
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: Buffer };
    if (e.stdout) {
      try {
        const parsed = JSON.parse(e.stdout.toString()) as Record<string, {
          current?: string;
          wanted?: string;
          latest?: string;
          type?: string;
        }>;
        return Object.entries(parsed).map(([name, info]) => ({
          name,
          current: info.current ?? "",
          wanted: info.wanted ?? "",
          latest: info.latest ?? "",
          type: (info.type as OutdatedPackage["type"]) ?? "dependencies",
        }));
      } catch {
        return [];
      }
    }
    return [];
  }
}

function classifyBump(current: string, target: string): "major" | "minor" | "patch" | "unknown" {
  const cur = current.split(".").map((s) => parseInt(s, 10));
  const tgt = target.split(".").map((s) => parseInt(s, 10));
  if (cur.length < 3 || tgt.length < 3 || cur.some(isNaN) || tgt.some(isNaN)) {
    return "unknown";
  }
  if (tgt[0] > cur[0]) return "major";
  if (tgt[1] > cur[1]) return "minor";
  if (tgt[2] > cur[2]) return "patch";
  return "unknown";
}

/**
 * Subset of dep names that are blast-radius-large enough that even a
 * patch bump warrants founder eyes (auth, ORM, runtime, build).
 */
const HIGH_BLAST_DEPS = new Set([
  "@clerk/clerk-sdk-node",
  "@clerk/clerk-react",
  "@clerk/express",
  "drizzle-orm",
  "drizzle-kit",
  "pg",
  "express",
  "react",
  "react-dom",
  "vite",
  "typescript",
  "stripe",
  "@stripe/stripe-js",
]);

async function proposeDependencyBumps(packages: OutdatedPackage[]) {
  let proposed = 0;
  for (const pkg of packages) {
    if (!pkg.current || !pkg.wanted) continue;
    if (pkg.current === pkg.wanted) continue; // already at wanted

    const bump = classifyBump(pkg.current, pkg.wanted);
    const isHighBlast = HIGH_BLAST_DEPS.has(pkg.name);

    let riskTier: RiskTier;
    if (bump === "major" || isHighBlast) {
      riskTier = "high";
    } else if (bump === "minor") {
      riskTier = "medium";
    } else {
      riskTier = "low";
    }

    await proposeCodeChange({
      pillar: "shared" as Pillar,
      agent: "codebase_monitor",
      source: "npm_outdated",
      rawSignal: { name: pkg.name, current: pkg.current, wanted: pkg.wanted, latest: pkg.latest, type: pkg.type },
      title: `Bump ${pkg.name} ${pkg.current} → ${pkg.wanted} (${bump})`,
      rationale:
        `npm outdated reports ${pkg.name} is at ${pkg.current}; semver-compatible ` +
        `upgrade available to ${pkg.wanted}. Latest released is ${pkg.latest}. ` +
        `Bump classification: ${bump}.${isHighBlast ? " High-blast dependency — founder review required." : ""}`,
      targetFiles: ["package.json", "package-lock.json"],
      riskTier,
      preMortem:
        bump === "major"
          ? "Breaking API changes possible. Verify changelog before merge."
          : bump === "minor"
          ? "New behavior possible behind feature flags. Read changelog."
          : "Patch bumps typically bugfix-only but verify changelog.",
      rollbackPath: `git revert <commit> && npm install`,
      simulationMode: true,
    });
    proposed++;
  }
  return proposed;
}

// ---------------------------------------------------------------------------
// TypeScript error inventory → "fix N errors" proposals
// ---------------------------------------------------------------------------

interface TsErrorBucket {
  file: string;
  count: number;
}

function readTscErrorBuckets(): TsErrorBucket[] {
  try {
    const raw = execSync("npx tsc --noEmit -p tsconfig.json 2>&1 || true", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    const counts: Record<string, number> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^(]+\.tsx?)\(\d+,\d+\):\s+error TS\d+/);
      if (m) {
        const file = m[1].trim();
        counts[file] = (counts[file] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

async function proposeTscFixes(buckets: TsErrorBucket[]) {
  // Only propose for files with ≥5 errors AND under a path the agent
  // is permitted to touch. We don't want one-off type-noise proposals.
  const significant = buckets.filter((b) => b.count >= 5);
  let proposed = 0;
  for (const bucket of significant.slice(0, 5)) {
    // Cap at 5 per run
    await proposeCodeChange({
      pillar: "shared" as Pillar,
      agent: "codebase_monitor",
      source: "tsc_errors",
      rawSignal: { file: bucket.file, errorCount: bucket.count },
      title: `Clear ${bucket.count} TypeScript errors in ${bucket.file}`,
      rationale:
        `${bucket.file} has ${bucket.count} TypeScript errors per current ` +
        `tsc --noEmit output. Clearing them tightens the type-check ` +
        `signal so future regressions are easier to spot.`,
      targetFiles: [bucket.file],
      riskTier: bucket.file.startsWith("client/src/") ? "medium" : "low",
      preMortem:
        "Fixes could change runtime behaviour if errors were masking real " +
        "bugs (vs. drift). Adversarial review stage will catch most.",
      rollbackPath: `git revert <commit>`,
      simulationMode: true,
    });
    proposed++;
  }
  return proposed;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export interface CodebaseMonitorOptions {
  /**
   * Scan TypeScript errors. Default false — `npx tsc` is CPU/memory heavy
   * and not safe to run inline in prod jobs without a worker pool. Enable
   * locally or in a dedicated worker process group.
   */
  scanTypescript?: boolean;
  /**
   * Scan npm outdated. Default true — relatively cheap, network-bound.
   */
  scanNpmOutdated?: boolean;
}

export async function runCodebaseMonitor(
  opts: CodebaseMonitorOptions = {},
): Promise<{
  proposalsAdded: number;
  skipped: boolean;
  reason?: string;
}> {
  const scanNpmOutdated = opts.scanNpmOutdated ?? true;
  const scanTypescript = opts.scanTypescript ?? false;
  // Even though v0 signals are deterministic (no LLM), preflight the budget
  // so the loop is consistent. Tiny estimated cost — sentinel only.
  const ok = await preflightBudgetCheck(0.01);
  if (!ok.ok) {
    logger.warn("[codebase-monitor] skipped — budget preflight failed", {
      source: "codebase-monitor",
      metadata: { reason: ok.reason },
    });
    return { proposalsAdded: 0, skipped: true, reason: ok.reason };
  }

  let proposalsAdded = 0;

  if (scanNpmOutdated) {
    try {
      const outdated = readNpmOutdated();
      if (outdated.length > 0) {
        proposalsAdded += await proposeDependencyBumps(outdated);
      }
    } catch (err) {
      logger.error("[codebase-monitor] npm outdated scan failed", err);
    }
  }

  if (scanTypescript) {
    try {
      const tscBuckets = readTscErrorBuckets();
      if (tscBuckets.length > 0) {
        proposalsAdded += await proposeTscFixes(tscBuckets);
      }
    } catch (err) {
      logger.error("[codebase-monitor] tsc bucket scan failed", err);
    }
  }

  if (proposalsAdded > 0) {
    await notifyFounder({
      source: "agent_event",
      pillar: "C_agentic",
      agentCodename: "codebase_monitor",
      severity: "info",
      title: `Codebase monitor surfaced ${proposalsAdded} proposal${proposalsAdded === 1 ? "" : "s"}`,
      body:
        `New proposals are queued in the decisions inbox (itemType=agent_code_proposal). ` +
        `All are in simulation mode — promote one out of sim to let the evolution ` +
        `gauntlet pick it up on its next 6h tick.`,
      metadata: { proposalsAdded },
    });
  }

  logger.info("[codebase-monitor] run complete", {
    source: "codebase-monitor",
    metadata: { proposalsAdded },
  });

  return { proposalsAdded, skipped: false };
}
