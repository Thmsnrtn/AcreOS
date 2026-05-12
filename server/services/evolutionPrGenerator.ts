/**
 * Rosy River C3 — GitHub PR generation for the evolution pipeline.
 *
 * Replaces the implicit "Stage 5 marks deployed → 30-min regression
 * check" flow with an explicit "Stage 5 opens a PR → founder reviews
 * in GitHub → merge triggers deployment" flow.
 *
 * Why this exists: the original evolution pipeline committed to a
 * throwaway branch and never pushed it. "Deploy" was logical, not
 * physical — Fly always ran whatever was on main. That meant the
 * founder had no GitHub-side review surface for autonomous changes.
 *
 * After this change:
 *   - Stage 4 still commits to `evolution/<id>-<timestamp>` locally
 *   - Stage 5 PUSHES that branch and OPENS a PR via `gh`
 *   - The PR body contains pre-mortem + rollback + gauntlet provenance
 *   - The PR is labelled `agent-proposed` so founder can filter
 *   - History row gets pr_number + pr_url
 *
 * Falls back to the old "logical deploy" flow if EVOLUTION_DEPLOY_VIA_PR
 * env is explicitly set to "false" — gives us an emergency kill switch.
 *
 * Requires `gh auth login` to have been run on the host (Fly machine).
 * In dev, the founder's local gh credentials are used.
 */

import { execSync } from "child_process";
import { db } from "../db";
import { evolutionHistory, agentTasks } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

const log = (msg: string, meta?: Record<string, unknown>) =>
  logger.info(`[evolution-pr] ${msg}`, { source: "evolution-pr", metadata: meta });
const logError = (msg: string, meta?: Record<string, unknown>) =>
  logger.error(`[evolution-pr] ${msg}`, undefined, { source: "evolution-pr", metadata: meta });

/**
 * True when we should ship via PR rather than direct-mark-deployed. Default
 * is true; set EVOLUTION_DEPLOY_VIA_PR=false to revert to the legacy flow.
 */
export function isPrModeEnabled(): boolean {
  return process.env.EVOLUTION_DEPLOY_VIA_PR !== "false";
}

/**
 * Push the evolution branch to origin and open a GitHub PR via `gh`.
 * Returns the PR number + URL on success, or null on any failure.
 *
 * Idempotent against the same branch: if the branch is already pushed
 * AND a PR is open for it, returns the existing PR.
 */
export async function openPullRequestForEvolution(
  historyId: number,
  branchName: string,
): Promise<{ prNumber: number; prUrl: string } | null> {
  if (!isPrModeEnabled()) {
    log("PR mode disabled — skipping", { historyId, branchName });
    return null;
  }

  // Pull the history + the originating proposal so we can stuff context
  // into the PR body (pre-mortem, rollback, target file, gauntlet stages).
  const [history] = await db
    .select()
    .from(evolutionHistory)
    .where(eq(evolutionHistory.id, historyId))
    .limit(1);
  if (!history) {
    logError("history row not found", { historyId });
    return null;
  }

  let proposalContext = "";
  if (history.proposalId) {
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, history.proposalId))
      .limit(1);
    if (task) {
      const output = (task.output as Record<string, unknown> | null) ?? {};
      const input = (task.input as Record<string, unknown> | null) ?? {};
      proposalContext = [
        output.title ? `**Title:** ${String(output.title)}` : "",
        output.rationale ? `**Rationale:** ${String(output.rationale)}` : "",
        output.preMortem ? `**Pre-mortem:** ${String(output.preMortem)}` : "",
        output.rollbackPath ? `**Rollback:** \`${String(output.rollbackPath)}\`` : "",
        input.pillar ? `**Pillar:** ${String(input.pillar)}` : "",
        input.source ? `**Source signal:** ${String(input.source)}` : "",
        output.autoMergeEligible !== undefined
          ? `**Auto-merge eligible:** ${output.autoMergeEligible ? "yes" : `no — ${output.autoMergeReason ?? "unknown"}`}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  }

  // Push the branch. The branch should already exist locally from Stage 4.
  try {
    execSync(`git push -u origin ${branchName}`, {
      cwd: process.cwd(),
      stdio: "pipe",
      encoding: "utf-8",
    });
    log("branch pushed", { historyId, branchName });
  } catch (err: unknown) {
    const stderr =
      (err as { stderr?: Buffer })?.stderr?.toString() ?? String(err);
    // If the branch already exists upstream and the local is current, that's
    // fine — proceed to open the PR. If the upstream has diverged, log and
    // bail.
    if (!/everything up-to-date|already exists/i.test(stderr)) {
      logError("branch push failed", { historyId, branchName, stderr: stderr.slice(0, 500) });
      return null;
    }
  }

  // Check whether a PR already exists for this branch — re-running should
  // surface the existing one rather than fail.
  try {
    const existing = execSync(
      `gh pr list --head ${branchName} --json number,url --limit 1`,
      { cwd: process.cwd(), encoding: "utf-8", stdio: "pipe" },
    );
    const parsed = JSON.parse(existing) as Array<{ number: number; url: string }>;
    if (parsed.length > 0) {
      log("PR already exists for branch", { historyId, prNumber: parsed[0].number });
      await db
        .update(evolutionHistory)
        .set({
          prNumber: parsed[0].number,
          prUrl: parsed[0].url,
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(evolutionHistory.id, historyId));
      return { prNumber: parsed[0].number, prUrl: parsed[0].url };
    }
  } catch (err) {
    // Listing failed — proceed to create. Not fatal here.
    log("gh pr list failed (treating as no existing PR)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Compose the PR body.
  const title = history.proposalDescription
    ? `agent: ${history.proposalDescription}`.slice(0, 140)
    : `agent: evolution ${historyId}`;
  const stagesCompleted = (history.stagesCompleted as string[] | null) ?? [];
  const body = [
    proposalContext,
    "",
    `### Provenance`,
    `- Evolution history id: \`${historyId}\``,
    `- Branch: \`${branchName}\``,
    `- Target file: \`${history.targetFile}\``,
    `- Commit: \`${history.commitHash ?? "—"}\``,
    `- Gauntlet stages passed: ${stagesCompleted.length > 0 ? stagesCompleted.join(", ") : "none recorded"}`,
    "",
    `### How this got here`,
    `1. An agent (codebase monitor / planner / etc.) wrote a proposal into \`agentTasks\`.`,
    `2. The evolution pipeline ran the 6-stage safety gauntlet (code gen → adversarial review → intent verification → static analysis → deploy → regression check).`,
    `3. All gates passed and this PR was opened automatically.`,
    "",
    `### Founder action`,
    `- Review the diff below.`,
    `- Approve to merge into main and trigger the regression check.`,
    `- Close to abandon — the agent's proposal will be marked rejected and won't be re-proposed (decision-log RAG remembers).`,
    "",
    `<sub>🤖 Generated by AcreOS evolution pipeline · Rosy River C3</sub>`,
  ].join("\n");

  // Open the PR. `--label` will fail if the label doesn't exist in the repo;
  // we try with the label, and if that fails, retry without.
  let prNumber: number | null = null;
  let prUrl: string | null = null;
  try {
    const args = [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branchName,
      "--title",
      JSON.stringify(title),
      "--body",
      JSON.stringify(body),
      "--label",
      "agent-proposed",
    ];
    const out = execSync(`gh ${args.join(" ")}`, {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: "pipe",
    });
    const urlMatch = out.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
    if (urlMatch) {
      prUrl = urlMatch[0];
      prNumber = parseInt(urlMatch[1], 10);
    }
  } catch (err: unknown) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? "";
    // Retry without the label if the label doesn't exist.
    if (/could not add label|not found/i.test(stderr)) {
      try {
        const out = execSync(
          `gh pr create --base main --head ${branchName} --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}`,
          { cwd: process.cwd(), encoding: "utf-8", stdio: "pipe" },
        );
        const urlMatch = out.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
        if (urlMatch) {
          prUrl = urlMatch[0];
          prNumber = parseInt(urlMatch[1], 10);
        }
      } catch (retryErr) {
        logError("gh pr create retry failed", {
          historyId,
          error: retryErr instanceof Error ? retryErr.message : String(retryErr),
        });
        return null;
      }
    } else {
      logError("gh pr create failed", { historyId, stderr: stderr.slice(0, 500) });
      return null;
    }
  }

  if (!prNumber || !prUrl) {
    logError("PR creation succeeded but URL not parsed", { historyId });
    return null;
  }

  await db
    .update(evolutionHistory)
    .set({
      prNumber,
      prUrl,
      updatedAt: new Date(),
    } as Record<string, unknown>)
    .where(eq(evolutionHistory.id, historyId));

  log("PR opened", { historyId, prNumber, prUrl });
  return { prNumber, prUrl };
}
