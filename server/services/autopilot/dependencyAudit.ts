/**
 * Founder Autopilot — dependency audit analyzer (Elite Vision H2: immune system).
 *
 * Pure parsing of `npm audit --json` into a structured summary + the candidate
 * auto-fixable advisories. It does NOT run npm and does NOT apply anything — it
 * turns the audit output into a decision the immune system can plan around. The
 * actual "apply fix → branch → PR" is gated behind codeChangeGate + earned
 * autonomy + the off-by-default git capability.
 *
 * Conservative: a candidate is only "auto-fixable" when npm reports a non-major
 * fix is available. The FINAL safe_auto call is still codeChangeGate's, made
 * against the real lockfile diff (patch-only) — this module never upgrades the
 * verdict, it only narrows the field.
 */

export type AuditSeverity = "info" | "low" | "moderate" | "high" | "critical";

export interface AuditCandidate {
  name: string;
  severity: AuditSeverity;
  /** A non-major fix is available (npm `fixAvailable` is an object, not major). */
  autoFixable: boolean;
  /** npm flagged the available fix as a semver-major bump (breaking). */
  isSemVerMajor: boolean;
  fixVersion: string | null;
}

export interface AuditSummary {
  total: number;
  bySeverity: Record<AuditSeverity, number>;
  candidates: AuditCandidate[];
}

const SEVERITIES: AuditSeverity[] = ["info", "low", "moderate", "high", "critical"];

function emptyBySeverity(): Record<AuditSeverity, number> {
  return { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
}

/**
 * Parse the `npm audit --json` object (npm 7+ schema). Tolerant: unknown shapes
 * degrade to an empty summary rather than throwing.
 */
export function parseAudit(json: unknown): AuditSummary {
  const out: AuditSummary = { total: 0, bySeverity: emptyBySeverity(), candidates: [] };
  if (!json || typeof json !== "object") return out;
  const vulns = (json as Record<string, unknown>).vulnerabilities;
  if (!vulns || typeof vulns !== "object") return out;

  for (const [name, raw] of Object.entries(vulns as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    const severity: AuditSeverity = SEVERITIES.includes(v.severity as AuditSeverity) ? (v.severity as AuditSeverity) : "info";
    out.total += 1;
    out.bySeverity[severity] += 1;

    const fix = v.fixAvailable;
    let autoFixable = false;
    let isSemVerMajor = false;
    let fixVersion: string | null = null;
    if (fix === true) {
      autoFixable = true; // a fix exists; majorness unknown → treat as non-major candidate
    } else if (fix && typeof fix === "object") {
      const f = fix as Record<string, unknown>;
      isSemVerMajor = f.isSemVerMajor === true;
      autoFixable = !isSemVerMajor;
      fixVersion = typeof f.version === "string" ? f.version : null;
    }
    out.candidates.push({ name, severity, autoFixable, isSemVerMajor, fixVersion });
  }
  return out;
}

/** The advisories npm can fix WITHOUT a breaking (major) bump — the field the
 * immune system narrows to before codeChangeGate makes the final safe_auto call. */
export function autoFixCandidates(summary: AuditSummary): AuditCandidate[] {
  return summary.candidates.filter((c) => c.autoFixable && !c.isSemVerMajor);
}

/** Severity at or above which a vuln must be acted on (matches the CI SLA spirit). */
export function actionableCandidates(summary: AuditSummary): AuditCandidate[] {
  return summary.candidates.filter((c) => c.severity === "high" || c.severity === "critical");
}
