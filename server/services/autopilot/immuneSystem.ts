/**
 * Founder Autopilot — immune-system planner (Elite Vision H2).
 *
 * Turns a parsed npm-audit summary into a GATED repair plan: which advisories
 * the system may auto-fix (safe class, subject to a second codeChangeGate pass
 * on the real diff), which must be witnessed by the founder (breaking upgrades),
 * and which to skip (no fix). It PLANS; it never executes. Execution (npm audit
 * fix → branch → PR → CI → deploy) is gated behind earned autonomy + the
 * off-by-default git capability.
 *
 * The plan is pure → unit-testable, and conservative: auto only when autonomy is
 * earned AND the fix is non-major; a high/critical with only a breaking fix
 * always escalates to the founder rather than being silently skipped.
 */
import type { AuditSummary, AuditCandidate, AuditSeverity } from "./dependencyAudit";
import { autoFixCandidates } from "./dependencyAudit";

export type RepairAction = "auto_pr" | "witnessed" | "skip";

export interface RepairPlanItem {
  name: string;
  severity: AuditSeverity;
  action: RepairAction;
  reason: string;
}

export interface RepairPlan {
  items: RepairPlanItem[];
  autoCount: number;
  witnessedCount: number;
  skipCount: number;
}

/**
 * Build the gated repair plan.
 * @param autoMergeEarned whether the security domain has earned safe-class
 *        auto-PR autonomy on the Trust Ledger. When false, every fix routes to
 *        the founder (witnessed) — the cold-start-safe default.
 */
export function planSecurityResponse(summary: AuditSummary, autoMergeEarned: boolean): RepairPlan {
  const autoSet = new Set(autoFixCandidates(summary).map((c) => c.name));
  const items: RepairPlanItem[] = summary.candidates.map((c) => classifyOne(c, autoSet.has(c.name), autoMergeEarned));
  return {
    items,
    autoCount: items.filter((i) => i.action === "auto_pr").length,
    witnessedCount: items.filter((i) => i.action === "witnessed").length,
    skipCount: items.filter((i) => i.action === "skip").length,
  };
}

function classifyOne(c: AuditCandidate, isAutoFixable: boolean, autoMergeEarned: boolean): RepairPlanItem {
  const high = c.severity === "high" || c.severity === "critical";
  if (isAutoFixable) {
    if (autoMergeEarned) {
      return { name: c.name, severity: c.severity, action: "auto_pr", reason: "non-major fix + security domain has earned safe-class auto-PR (still passes CI + codeChangeGate on the real diff)" };
    }
    return { name: c.name, severity: c.severity, action: "witnessed", reason: "non-major fix available, but auto-PR autonomy not yet earned → founder approves" };
  }
  // No non-major fix. A breaking (major) fix for a high/critical vuln must reach
  // the founder; otherwise it's a no-actionable-fix skip.
  if (high && c.isSemVerMajor) {
    return { name: c.name, severity: c.severity, action: "witnessed", reason: "only a breaking (major) fix is available for a high/critical vuln → founder must decide" };
  }
  return { name: c.name, severity: c.severity, action: "skip", reason: c.fixVersion ? "fix is breaking + severity below action threshold" : "no fix available yet" };
}

/** One-line immune-system status for the daily letter. Pure. */
export function immuneSystemLine(plan: RepairPlan): string {
  if (plan.items.length === 0) return "Dependency health: no advisories.";
  return `Dependency health: ${plan.items.length} advisory(ies) — ${plan.autoCount} auto-fixable, ${plan.witnessedCount} need your call, ${plan.skipCount} no safe fix yet.`;
}
