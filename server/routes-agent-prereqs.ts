/**
 * Rosy River — agent-loop prerequisite health endpoint.
 *
 *   GET /api/founder/agent-prereqs
 *
 * Runs every external dependency the autonomous agent loop relies on
 * and reports green/red per check. Founder hits this post-deploy to
 * confirm the Fly machine (or local dev) is wired correctly for:
 *
 *   - gh CLI installed + authenticated → required for C3 PR generation
 *   - git working tree + remote → required for Stage 4-5
 *   - EVOLUTION_DEPLOY_VIA_PR env flag → toggles PR mode
 *   - OpenRouter API key → required for Stages 1/2/3
 *   - Database connectivity → required for everything
 *   - Required tables present → migrate.mjs has run
 *
 * Returns 200 with a structured report regardless of green/red so the
 * founder can see exactly which step blocks the loop. The check itself
 * never blocks the deploy — it's diagnostic.
 */

import type { Express, Response } from "express";
import { execSync } from "child_process";
import { db } from "./db";
import { evolutionCircuitBreaker, customAutonomyRules } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

interface Check {
  name: string;
  category: "agent_loop" | "git_pr" | "data" | "config";
  ok: boolean;
  detail: string;
  fix?: string;
}

function runSync(cmd: string, timeoutMs = 5_000): { ok: boolean; out: string } {
  try {
    const out = execSync(cmd, {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: "pipe",
      timeout: timeoutMs,
    });
    return { ok: true, out: out.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const out = (e.stdout?.toString() ?? e.stderr?.toString() ?? e.message ?? "").trim();
    return { ok: false, out };
  }
}

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // ── gh CLI ────────────────────────────────────────────────────────────
  const ghInstalled = runSync("which gh");
  if (!ghInstalled.ok) {
    checks.push({
      name: "gh CLI installed",
      category: "git_pr",
      ok: false,
      detail: "gh not found on PATH",
      fix: "apt install gh (Debian) / brew install gh (mac). On Fly: add to Dockerfile.",
    });
  } else {
    checks.push({
      name: "gh CLI installed",
      category: "git_pr",
      ok: true,
      detail: ghInstalled.out,
    });

    const ghAuth = runSync("gh auth status");
    checks.push({
      name: "gh CLI authenticated",
      category: "git_pr",
      ok: ghAuth.ok,
      detail: ghAuth.out.slice(0, 200),
      fix: ghAuth.ok ? undefined : "Run `gh auth login` or set GH_TOKEN. Token needs repo + workflow scopes.",
    });
  }

  // ── Git working tree + remote ─────────────────────────────────────────
  const gitStatus = runSync("git rev-parse --git-dir");
  checks.push({
    name: "git repository",
    category: "git_pr",
    ok: gitStatus.ok,
    detail: gitStatus.ok ? "found" : gitStatus.out,
    fix: gitStatus.ok ? undefined : "Server must run inside the git working tree.",
  });

  if (gitStatus.ok) {
    const gitRemote = runSync("git remote get-url origin");
    checks.push({
      name: "git remote origin",
      category: "git_pr",
      ok: gitRemote.ok,
      detail: gitRemote.out,
      fix: gitRemote.ok ? undefined : "Set up the GitHub remote: git remote add origin git@github.com:org/repo.git",
    });

    const gitUser = runSync("git config user.email");
    checks.push({
      name: "git committer identity",
      category: "git_pr",
      ok: gitUser.ok && gitUser.out.length > 0,
      detail: gitUser.out || "(unset)",
      fix: gitUser.out ? undefined : "git config --global user.email + user.name (evolution branch commits need this).",
    });
  }

  // ── EVOLUTION_DEPLOY_VIA_PR flag ──────────────────────────────────────
  const prMode = process.env.EVOLUTION_DEPLOY_VIA_PR !== "false";
  checks.push({
    name: "EVOLUTION_DEPLOY_VIA_PR",
    category: "config",
    ok: true, // both states are valid; reporting current value
    detail: prMode ? "PR mode (default)" : "legacy direct-mark deploy",
  });

  // ── OpenRouter ────────────────────────────────────────────────────────
  const orKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  checks.push({
    name: "OpenRouter API key",
    category: "agent_loop",
    ok: Boolean(orKey && orKey.length > 10),
    detail: orKey ? "set" : "missing",
    fix: orKey ? undefined : "Set AI_INTEGRATIONS_OPENROUTER_API_KEY (Fly secret). Required for Stage 1/2/3 LLM calls.",
  });

  // ── Database connectivity ─────────────────────────────────────────────
  try {
    await db.execute(sql`SELECT 1`);
    checks.push({
      name: "database connectivity",
      category: "data",
      ok: true,
      detail: "reachable",
    });
  } catch (err) {
    checks.push({
      name: "database connectivity",
      category: "data",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      fix: "Check DATABASE_URL secret + network reachability.",
    });
  }

  // ── Required tables present (the Rosy-River-adjacent ones) ────────────
  try {
    const [breakerRow] = await db
      .select({ id: evolutionCircuitBreaker.id })
      .from(evolutionCircuitBreaker)
      .limit(1);
    checks.push({
      name: "evolution_circuit_breaker table",
      category: "data",
      ok: true,
      detail: breakerRow ? "row #1 present" : "table empty (will initialize on first run)",
    });
  } catch (err) {
    checks.push({
      name: "evolution_circuit_breaker table",
      category: "data",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      fix: "Run `node scripts/migrate.mjs` to create missing tables.",
    });
  }

  // ── Seeded autonomy rules ─────────────────────────────────────────────
  try {
    const [ruleCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customAutonomyRules)
      .where(eq(customAutonomyRules.organizationId, 1));
    const n = Number(ruleCount?.n ?? 0);
    checks.push({
      name: "custom_autonomy_rules seeded",
      category: "data",
      ok: n > 0,
      detail: `${n} rule(s) for org 1`,
      fix: n > 0 ? undefined : "Run `node scripts/migrate.mjs` to seed canonical hard-stop + founder-approval rules.",
    });
  } catch (err) {
    checks.push({
      name: "custom_autonomy_rules seeded",
      category: "data",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return checks;
}

export function registerAgentPrereqsRoute(app: Express): void {
  app.get(
    "/api/founder/agent-prereqs",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const checks = await runChecks();
        const allOk = checks.every((c) => c.ok);
        const byCategory: Record<string, { ok: number; failed: number }> = {};
        for (const c of checks) {
          if (!byCategory[c.category]) byCategory[c.category] = { ok: 0, failed: 0 };
          if (c.ok) byCategory[c.category].ok++;
          else byCategory[c.category].failed++;
        }
        return res.json({
          allOk,
          generatedAt: new Date().toISOString(),
          summary: byCategory,
          checks,
        });
      } catch (err: unknown) {
        logger.error("[agent-prereqs] failed", err);
        return Errors.internal(res, err);
      }
    },
  );
}
