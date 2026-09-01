/**
 * Founder Autopilot — the immune-response wire (step-away gap #4).
 *
 * Until now every organ existed but nothing connected them: npm_watch RECORDED
 * advisories, planSecurityResponse could PLAN, runGatedSelfPatch could ACT —
 * and no caller ever ran the chain. This module is the nervous system:
 *
 *   npm audit → dependencyAudit.parseAudit → immuneSystem.planSecurityResponse
 *     → [auto class]      selfPatch.runGatedSelfPatch (env switch + earned
 *                         autonomy + codeChangeGate on the REAL diff → PR only)
 *     → [witnessed class] one deduped founder ask (never a daily re-nag)
 *     → ALWAYS            an autopilot_immune_reports row (the honesty ledger
 *                         the board report + Control door read)
 *
 * Safety posture (unchanged from the organs' own contracts):
 *   • runGatedSelfPatch opens a PULL REQUEST at most — CI + deploy gate +
 *     founder review still stand between the patch and prod.
 *   • The security ladder rides the OPS domain of the Trust Ledger: safe-class
 *     auto-PR is "earned" only at execute_gated or above. Cold start = every
 *     fix routes to the founder.
 *   • Every failure degrades to an honest report row, never a crash — this
 *     runs inside the daily npm_watch job and must not kill it.
 */

import { desc } from "drizzle-orm";
import { db } from "../../db";
import { autopilotImmuneReports, type AutopilotImmuneReportRow } from "@shared/schema/autopilot-immune";
import { logger } from "../../utils/logger";
import { parseAudit, type AuditSummary } from "./dependencyAudit";
import { planSecurityResponse, immuneSystemLine, type RepairPlan } from "./immuneSystem";

/** Marker the witnessed-class founder ask carries, used to dedup across days. */
export const IMMUNE_ASK_MARKER = "Security advisories need your call";

export interface ImmuneResponseResult {
  ok: boolean;
  line: string;
  summary: AuditSummary | null;
  plan: RepairPlan | null;
  autoMergeEarned: boolean;
  selfPatch: { ran: boolean; reason: string; prUrl?: string };
  askCreated: boolean;
  reportId: number | null;
}

/**
 * Whether the security ladder has earned safe-class auto-PR. Security repairs
 * ride the OPS domain of the Trust Ledger (there is no separate "security"
 * domain — dependency hygiene IS ops). execute_gated or above qualifies;
 * observe/draft (the cold-start states) route everything to the founder.
 */
export async function securityAutoMergeEarned(): Promise<boolean> {
  try {
    const { getDomainLevel, levelRank } = await import("./domainAutonomy");
    const level = await getDomainLevel("ops");
    return levelRank(level) >= levelRank("execute_gated");
  } catch (err) {
    // Fail CLOSED: if the ledger is unreadable, autonomy is not proven.
    logger.warn(
      `[immuneResponse] trust ledger unreadable — treating auto-PR as NOT earned: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Run one immune-response cycle. Never throws — returns a structured result
 * and persists the report row best-effort. Injectable audit runner for tests.
 */
export async function runImmuneResponse(
  opts: { runAudit?: () => Promise<string>; branchSuffix?: string } = {},
): Promise<ImmuneResponseResult> {
  const result: ImmuneResponseResult = {
    ok: false,
    line: "Dependency health: audit unavailable this run.",
    summary: null,
    plan: null,
    autoMergeEarned: false,
    selfPatch: { ran: false, reason: "not attempted" },
    askCreated: false,
    reportId: null,
  };

  // 1. Sense — run the audit and parse it.
  let summary: AuditSummary;
  try {
    const runAudit =
      opts.runAudit ??
      (async () => {
        const { runNpmAudit } = await import("../external-watch/npmWatch");
        return runNpmAudit();
      });
    summary = parseAudit(JSON.parse(await runAudit()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[immuneResponse] audit failed — recording honest gap: ${msg}`);
    result.line = `Dependency health: audit FAILED this run (${msg.slice(0, 120)}) — status unknown, not clean.`;
    result.reportId = await persistReport(result);
    return result;
  }
  result.summary = summary;

  // 2. Plan — the gated repair classification.
  const autoMergeEarned = await securityAutoMergeEarned();
  result.autoMergeEarned = autoMergeEarned;
  const plan = planSecurityResponse(summary, autoMergeEarned);
  result.plan = plan;
  result.line = immuneSystemLine(plan);
  result.ok = true;

  // 3. Motor (auto class) — the gated self-patch. Every hard gate lives inside
  // runGatedSelfPatch (env switch, earned autonomy, codeChangeGate on the real
  // diff); here we only add the environment-capability preflight so a deployed
  // image without git/PR credentials reports honestly instead of erroring deep.
  if (plan.autoCount > 0) {
    try {
      const { assertSelfPatchCapable, createSelfPatchGitOps } = await import("./selfPatchGitOps");
      const capability = await assertSelfPatchCapable();
      if (!capability.capable) {
        result.selfPatch = { ran: false, reason: `environment not capable: ${capability.reason}` };
      } else {
        const { runGatedSelfPatch } = await import("./selfPatch");
        const git = createSelfPatchGitOps();
        const suffix = opts.branchSuffix ?? String(Date.now());
        const patch = await runGatedSelfPatch(git, autoMergeEarned, suffix);
        result.selfPatch = { ran: patch.ran, reason: patch.reason, prUrl: patch.prUrl };
        // Leave the work tree the way we found it whether or not a PR opened.
        await git.restore();
      }
    } catch (err) {
      result.selfPatch = {
        ran: false,
        reason: `self-patch attempt errored: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else {
    result.selfPatch = { ran: false, reason: "no auto-class advisories" };
  }

  // 4. Witnessed class — ONE deduped founder ask. Re-raising the same ask
  // daily would be a nag, not a signal; if an immune ask is already open we
  // count on it.
  if (plan.witnessedCount > 0) {
    try {
      const { listOpenAsks, askFounder } = await import("../solene/founderCollab");
      const open = await listOpenAsks();
      const alreadyAsked = open.some((a) => (a.questionSummary ?? "").startsWith(IMMUNE_ASK_MARKER));
      if (!alreadyAsked) {
        const witnessed = plan.items.filter((i) => i.action === "witnessed");
        await askFounder({
          askingAgentRole: "krieger",
          questionSummary: `${IMMUNE_ASK_MARKER} (${witnessed.length})`,
          questionBody: [
            `The immune system found ${witnessed.length} advisory(ies) that need your decision:`,
            "",
            ...witnessed.map((i) => `• ${i.name} [${i.severity}] — ${i.reason}`),
            "",
            "Review the advisories and apply fixes yourself — your reply is recorded on this ask, but nothing acts on it automatically.",
          ].join("\n"),
          answerFormat: "free_text",
          urgency: plan.items.some((i) => i.action === "witnessed" && (i.severity === "critical" || i.severity === "high"))
            ? "urgent"
            : "normal",
        });
        result.askCreated = true;
      }
    } catch (err) {
      logger.warn(
        `[immuneResponse] founder ask failed (plan still recorded): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 5. Report — the honesty ledger row, always.
  result.reportId = await persistReport(result);
  logger.info(
    `[immuneResponse] cycle complete: total=${summary.total} auto=${plan.autoCount} witnessed=${plan.witnessedCount} skip=${plan.skipCount} earned=${autoMergeEarned} selfPatch=${result.selfPatch.ran ? "PR" : "no"} ask=${result.askCreated}`,
  );
  return result;
}

async function persistReport(r: ImmuneResponseResult): Promise<number | null> {
  try {
    const [row] = await db
      .insert(autopilotImmuneReports)
      .values({
        advisoriesTotal: r.summary?.total ?? 0,
        bySeverity: r.summary?.bySeverity ?? {},
        autoCount: r.plan?.autoCount ?? 0,
        witnessedCount: r.plan?.witnessedCount ?? 0,
        skipCount: r.plan?.skipCount ?? 0,
        planItems: r.plan?.items ?? [],
        line: r.line,
        autoMergeEarned: r.autoMergeEarned,
        selfPatchRan: r.selfPatch.ran,
        selfPatchReason: r.selfPatch.reason,
        selfPatchPrUrl: r.selfPatch.prUrl ?? null,
        askCreated: r.askCreated,
      })
      .returning({ id: autopilotImmuneReports.id });
    return row?.id ?? null;
  } catch (err) {
    logger.warn(
      `[immuneResponse] report persist failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Latest immune report — the board report's dependency-health source. */
export async function getLatestImmuneReport(): Promise<AutopilotImmuneReportRow | null> {
  try {
    const [row] = await db
      .select()
      .from(autopilotImmuneReports)
      .orderBy(desc(autopilotImmuneReports.ranAt))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}
