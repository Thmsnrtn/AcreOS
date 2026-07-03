/**
 * Founder Autopilot — gated self-patch (Elite Vision D1: H2 last mile).
 *
 * The immune system's MOTOR half: turn the immuneSystem repair plan into an
 * actual fix that reaches prod — for the SAFE CLASS ONLY (dependency patch
 * bumps), and never by a path that skips a human or the tests. Safety is layered:
 *
 *   1. Hard env switch SELF_PATCH_ENABLED (off by default) — nothing runs unless
 *      the founder turned it on.
 *   2. Earned autonomy — the security domain must have earned safe-class auto-PR
 *      on the Trust Ledger (passed in; cold-start everything is witnessed).
 *   3. codeChangeGate re-classifies the REAL diff produced by `npm audit fix`,
 *      not the audit's prediction. If the fix touched anything beyond package
 *      files, or did a non-patch bump, it is DOWNGRADED to witnessed — no auto-PR.
 *   4. It opens a PULL REQUEST. It NEVER merges to main. The full CI suite, the
 *      deploy gate, and the founder's review still stand between the patch and prod.
 *
 * The git/gh operations are INJECTED (GitOps) so this module is unit-testable
 * without touching a repo, and so prod only constructs the real runner when the
 * switch is on. Pure orchestration + hard gates; the dangerous side effects live
 * behind the interface.
 */
import { parseAudit, autoFixCandidates } from "./dependencyAudit";
import { classifyCodeChange, type DepChange } from "./codeChangeGate";
import { logger } from "../../utils/logger";

/** The real-world side effects, injected. In prod these shell out via git/gh. */
export interface GitOps {
  /** Run `npm audit --json` and return the parsed object. */
  audit(): Promise<unknown>;
  /** Create + checkout a fresh branch off main. */
  createBranch(name: string): Promise<void>;
  /** Run `npm audit fix` (no --force) and return what actually changed. */
  runAuditFix(): Promise<{ files: string[]; depChanges: DepChange[] }>;
  /** Commit the staged change. */
  commit(message: string): Promise<void>;
  /** Push the branch to origin. */
  push(branch: string): Promise<void>;
  /** Open a PR from `branch` into main; returns the PR url. */
  openPr(branch: string, title: string, body: string): Promise<string>;
}

export interface SelfPatchResult {
  ran: boolean;
  reason: string;
  prUrl?: string;
  /** Items the plan routed to the founder instead of auto-PR. */
  witnessedCount: number;
}

/**
 * The master switch — DB-backed via autopilot_settings (a Control Center tap)
 * with the env SELF_PATCH_ENABLED as the fallback default, matching the
 * dispatch/publish/cognition pattern. Settings unavailable → env only
 * (safe-off unless the founder set the secret).
 */
async function switchEnabled(): Promise<boolean> {
  try {
    const { isSelfPatchEnabled } = await import("./settings");
    return await isSelfPatchEnabled();
  } catch {
    return process.env.SELF_PATCH_ENABLED === "true";
  }
}

/**
 * Attempt one gated self-patch cycle. Returns a structured result; performs a
 * real PR only when every gate passes. Never throws past its own boundary
 * (a self-repair attempt must never crash the caller).
 *
 * @param autoMergeEarned whether the security domain has earned safe-class auto-PR.
 * @param branchSuffix    a caller-supplied unique suffix (no Date.now in module).
 */
export async function runGatedSelfPatch(
  git: GitOps,
  autoMergeEarned: boolean,
  branchSuffix: string,
): Promise<SelfPatchResult> {
  try {
    if (!(await switchEnabled())) return { ran: false, reason: "self-patch switch is off (Control Center / SELF_PATCH_ENABLED)", witnessedCount: 0 };
    if (!autoMergeEarned) return { ran: false, reason: "security domain has not earned safe-class auto-PR (everything witnessed)", witnessedCount: 0 };

    const summary = parseAudit(await git.audit());
    const candidates = autoFixCandidates(summary);
    if (candidates.length === 0) return { ran: false, reason: "no non-major auto-fixable advisories", witnessedCount: 0 };

    // Run the fix on a branch and inspect what ACTUALLY changed.
    const branch = `autopilot/security-patch-${branchSuffix}`;
    await git.createBranch(branch);
    const change = await git.runAuditFix();

    if (change.files.length === 0) {
      return { ran: false, reason: "audit fix produced no changes", witnessedCount: 0 };
    }

    // The decisive gate: classify the REAL diff. Only a clean patch-only dep
    // change may auto-PR; anything else falls back to the founder.
    const verdict = classifyCodeChange({ files: change.files, depChanges: change.depChanges });
    if (verdict.class !== "safe_auto") {
      logger.warn("[autopilot/selfPatch] real diff not safe_auto — abandoning auto-PR, leaving for founder", { metadata: { class: verdict.class, reasons: verdict.reasons } });
      return { ran: false, reason: `real diff classified ${verdict.class} — ${verdict.reasons.join("; ")}; left for the founder`, witnessedCount: 1 };
    }

    const bumpList = change.depChanges.map((d) => `${d.name} ${d.fromVersion}→${d.toVersion}`).join(", ");
    await git.commit(`chore(security): autopilot dependency patch — ${bumpList}`);
    await git.push(branch);
    const prUrl = await git.openPr(
      branch,
      `Autopilot security patch: ${bumpList}`,
      [
        "Autonomous dependency patch opened by the autopilot immune system (safe class only).",
        "",
        `Advisories addressed: ${candidates.map((c) => `${c.name} (${c.severity})`).join(", ")}`,
        `Changes (patch bumps only): ${bumpList}`,
        "",
        "This is a PULL REQUEST, not a merge — the full CI suite, the deploy gate, and your review all still apply. Nothing reached prod autonomously.",
      ].join("\n"),
    );
    logger.warn("[autopilot/selfPatch] safe-class security PR opened autonomously", { metadata: { prUrl, branch } });
    return { ran: true, reason: "safe-class dependency patch PR opened", prUrl, witnessedCount: summary.candidates.length - candidates.length };
  } catch (err) {
    logger.warn("[autopilot/selfPatch] gated self-patch failed (non-fatal)", err instanceof Error ? err : undefined);
    return { ran: false, reason: `error: ${err instanceof Error ? err.message : String(err)}`, witnessedCount: 0 };
  }
}
