/**
 * Pillar U — monthly pillar review cron wrapper.
 *
 * Invokes scripts/pillar-review.ts and pushes a summary to
 * /founder/now via decisionsInboxItems when stale or dead pillars
 * are found.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { db } from "../db";
import { decisionsInboxItems, agentEvents } from "@shared/schema";
import { logger } from "../utils/logger";

export async function runPillarReviewJob(): Promise<{
  reportPath: string;
  staleCount: number;
  deadCount: number;
}> {
  const repoRoot = process.cwd();
  const scriptPath = path.join(repoRoot, "scripts/pillar-review.ts");
  try {
    execSync(`npx tsx "${scriptPath}"`, { cwd: repoRoot, stdio: "inherit" });
  } catch (err) {
    logger.error("[pillar-review] script execution failed", err);
    return { reportPath: "", staleCount: 0, deadCount: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(repoRoot, `docs/archive/exhaustive-completion/pillar-review-${today}.md`);
  if (!fs.existsSync(reportPath)) {
    return { reportPath: "", staleCount: 0, deadCount: 0 };
  }
  const content = fs.readFileSync(reportPath, "utf-8");
  const staleMatch = content.match(/Stale.*\*\*(\d+)\*\*/);
  const deadMatch = content.match(/Dead.*\*\*(\d+)\*\*/);
  const staleCount = staleMatch ? parseInt(staleMatch[1], 10) : 0;
  const deadCount = deadMatch ? parseInt(deadMatch[1], 10) : 0;

  if (staleCount === 0 && deadCount === 0) {
    logger.info("[pillar-review] no stale or dead pillars — quiet pass");
    return { reportPath, staleCount: 0, deadCount: 0 };
  }

  try {
    const { getFounderPrimaryOrgId } = await import("./founder");
    const orgId = await getFounderPrimaryOrgId();
    await db.insert(agentEvents).values({
      organizationId: orgId,
      eventType: "pillar_review_complete",
      eventSource: "pillar_reviewer",
      payload: {
        agentCodename: "pillar_reviewer",
        staleCount,
        deadCount,
        reportPath: path.relative(repoRoot, reportPath),
        actionUrl: "/founder/now#pillar-review",
        title: `Pillar review: ${staleCount} stale, ${deadCount} dead`,
      },
    });

    await db.insert(decisionsInboxItems).values({
      itemType: "pillar_review",
      riskLevel: deadCount > 0 ? "medium" : "low",
      urgencyScore: deadCount > 0 ? 60 : 35,
      sophieAnalysis:
        `Monthly pillar review found ${staleCount} stale pillar${staleCount === 1 ? "" : "s"} ` +
        `and ${deadCount} dead pillar${deadCount === 1 ? "" : "s"}. ` +
        `See ${path.relative(repoRoot, reportPath)} for the per-pillar breakdown.`,
      recommendedAction: "Review and decide which pillars to archive. The script will not auto-archive — founder veto applies.",
      recommendedActionLabel: "Review pillar inventory",
      organizationId: orgId,
      status: "pending",
      ownerAgentCodename: "pillar_reviewer",
    });
  } catch (err) {
    logger.error("[pillar-review] failed to write inbox item", err);
  }

  return { reportPath, staleCount, deadCount };
}
