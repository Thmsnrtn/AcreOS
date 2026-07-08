/**
 * Founder Autopilot — frontier trust (self-aware safety). The moat.
 *
 * Three capabilities that let autonomy go FURTHER without becoming reckless:
 *
 *  1. Adversarial pre-mortem — before a high-stakes action runs, an independent
 *     skeptic argues why it's a mistake. A fatal objection vetoes the action
 *     (it escalates to the founder instead). The skeptic defaults to NOT fatal,
 *     so it only blocks genuinely serious problems.
 *
 *  2. Calibration-as-safety-signal — if the system becomes OVER-confident (its
 *     predictions run higher than reality), autonomy auto-tightens: promotions
 *     are held until calibration recovers. A system that notices it's fooling
 *     itself, and pulls back.
 *
 *  3. Constitutional-drift sentinel — a pure scan of recent behavior for
 *     invariant violations (e.g. a customer-facing action that auto-ran instead
 *     of going through witnessed-send). Drift → alert.
 *
 * The decision cores are pure + testable; the skeptic's model call is injected.
 */
import type { RankedMove } from "./decide";
import type { CalibrationReport } from "./forecast";
import { bindingFor } from "./act";

// ── 1. Adversarial pre-mortem ────────────────────────────────────────────────

/** A move is high-stakes if it moves money or reaches a customer. */
export function isHighStakes(move: RankedMove): boolean {
  if (move.domain === "finance") return true;
  return bindingFor(move.kind).isCustomerFacing;
}

export interface SkepticVerdict {
  fatal: boolean;
  objection: string;
}

export function buildSkepticPrompt(move: RankedMove, forecastNote?: string): string {
  return [
    "You are a skeptic reviewing an autonomous company's proposed action BEFORE it runs.",
    "Your job is a pre-mortem: assume it could go wrong, and argue specifically how.",
    "Flag fatal=true ONLY for a genuinely serious problem: legal/compliance risk, customer harm, an irreversible mistake, or clear waste. Otherwise fatal=false.",
    "",
    `Proposed action: ${move.kind} (${move.domain}). Rationale: ${move.rationale}`,
    forecastNote ? `Forecast: ${forecastNote}` : "",
    "",
    'Respond ONLY with JSON: {"fatal": <boolean>, "objection": "<one specific sentence, or empty if none>"}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Parse + shape-validate the skeptic JSON. Pure. Null on garbage (→ no veto). */
export function parseSkeptic(raw: string): SkepticVerdict | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    if (typeof o.fatal !== "boolean") return null;
    return { fatal: o.fatal, objection: typeof o.objection === "string" ? o.objection : "" };
  } catch {
    return null;
  }
}

export interface PremortemDeps {
  callModel: (prompt: string) => Promise<string>;
}

/**
 * Run the pre-mortem for a high-stakes move. Returns a veto + objection when the
 * skeptic finds a fatal flaw; null otherwise (not high-stakes, model error, or
 * no objection). Fails OPEN to "no veto" on error — the other gates still bind,
 * so a skeptic outage can't wedge the loop; it just loses this extra check.
 */
export async function runPremortem(
  move: RankedMove,
  deps: PremortemDeps,
  forecastNote?: string,
): Promise<{ veto: boolean; objection: string } | null> {
  if (!isHighStakes(move)) return null;
  try {
    const raw = await deps.callModel(buildSkepticPrompt(move, forecastNote));
    const v = parseSkeptic(raw);
    if (v?.fatal) return { veto: true, objection: v.objection || "A skeptic flagged a serious risk." };
    return null;
  } catch {
    return null;
  }
}

// ── 2. Calibration-as-safety-signal ──────────────────────────────────────────

export interface CalibrationSafety {
  /** Hold autonomy promotions until calibration recovers. */
  holdPromotions: boolean;
  reason: string;
}

/** Decide the safety response to a calibration report. Pure. */
export function calibrationSafetyAction(report: CalibrationReport): CalibrationSafety {
  if (report.grade === "over-confident") {
    return {
      holdPromotions: true,
      reason: `Calibration is over-confident over ${report.n} predictions — holding autonomy promotions until it recovers.`,
    };
  }
  return { holdPromotions: false, reason: "" };
}

// ── 3. Constitutional-drift sentinel ─────────────────────────────────────────

export interface DriftFinding {
  severity: "warn" | "critical";
  code: string;
  message: string;
}

/**
 * Scan recent autopilot actions for invariant violations. Pure. Today it checks
 * the load-bearing one: a customer-facing action must NEVER auto-run — it must
 * go through witnessed-send (escalated). An auto-run customer-facing action is a
 * critical drift from the constitution.
 */
export function detectDrift(
  experiences: Array<{ moveKind: string; outcome: string }>,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  let bypass = 0;
  for (const e of experiences) {
    if (e.outcome === "acted" && bindingFor(e.moveKind).isCustomerFacing) bypass += 1;
  }
  if (bypass > 0) {
    findings.push({
      severity: "critical",
      code: "witnessed_send_bypass",
      message: `${bypass} customer-facing action(s) auto-ran without witnessed-send — a constitutional invariant was bypassed.`,
    });
  }
  return findings;
}
