/**
 * Founder Autopilot — per-domain earned-autonomy state machine (the Trust Ledger).
 *
 * P0 batch 3. Generalizes the EXISTING earned-autonomy algorithm
 * (autonomyGuardrails: promote on a clean track record, instant circuit-breaker
 * demote on anomaly) from its Pax-customer-send scope to a per founder-ops
 * DOMAIN scope (growth / support / deploy / ops / finance). It is NOT a
 * competing copy of the Pax autonomy — that governs customer sends and stays as
 * is; this governs whether a founder-ops DOMAIN may act on its own.
 *
 * Levels (ordered):
 *   observe          — sensing only; no outward action
 *   draft            — produces artifacts but a human must approve before they go out
 *   execute_gated    — auto-executes IF the rest of the policy-gate stack passes
 *   autonomous_gated — auto-executes with minimal escalation (still fully gated)
 *
 * Higher autonomy = LESS human escalation, never FEWER gates. Even
 * autonomous_gated passes the full policy-gate stack (compliance/eval/budget/
 * witnessed-send) — this state machine only decides the AUTONOMY gate within it.
 *
 * The pure core (level math + gate mapping + promotion test) is exported and
 * unit-tested without a DB; the DB-backed functions wrap it.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { domainAutonomyLevels } from "@shared/schema";
import { logger } from "../../utils/logger";
import type { AutopilotDomain, GateResult, PolicyAction } from "./policyGate";

export const DOMAIN_AUTONOMY_LEVELS = ["observe", "draft", "execute_gated", "autonomous_gated"] as const;
export type DomainAutonomyLevel = (typeof DOMAIN_AUTONOMY_LEVELS)[number];

export const AUTOPILOT_DOMAINS: readonly AutopilotDomain[] = ["growth", "support", "deploy", "ops", "finance"];

/** Clean cycles required to auto-promote one level. Conservative by default. */
export const PROMOTION_THRESHOLD = Number(process.env.AUTOPILOT_PROMOTION_THRESHOLD ?? 10);

// ── Pure core (no DB — unit-tested directly) ─────────────────────────────────

export function levelRank(level: DomainAutonomyLevel): number {
  return DOMAIN_AUTONOMY_LEVELS.indexOf(level);
}

/** One level up, or null if already at the top. */
export function nextLevel(level: DomainAutonomyLevel): DomainAutonomyLevel | null {
  const i = levelRank(level);
  return i < DOMAIN_AUTONOMY_LEVELS.length - 1 ? DOMAIN_AUTONOMY_LEVELS[i + 1] : null;
}

/** One level down, floored at observe. */
export function prevLevel(level: DomainAutonomyLevel): DomainAutonomyLevel {
  const i = levelRank(level);
  return i > 0 ? DOMAIN_AUTONOMY_LEVELS[i - 1] : "observe";
}

/** Whether a clean-cycle count earns promotion at the current level. */
export function shouldPromote(level: DomainAutonomyLevel, cleanCount: number, threshold = PROMOTION_THRESHOLD): boolean {
  return nextLevel(level) !== null && cleanCount >= threshold;
}

/**
 * The AUTONOMY gate's verdict for a domain at a given level: may an action
 * auto-execute? observe → block (sensing only); draft → escalate (human must
 * approve the draft); execute_gated / autonomous_gated → pass (other gates still
 * apply).
 */
/**
 * Days-of-trust each level contributes to the autonomy horizon. A transparent,
 * honest mapping — NOT a measurement of actual unattended uptime, but a
 * derivation of how much the system has *earned* the right to run alone.
 */
const LEVEL_HORIZON_DAYS: Record<DomainAutonomyLevel, number> = {
  observe: 0,
  draft: 0.5,
  execute_gated: 2,
  autonomous_gated: 4,
};

const AUTONOMY_HORIZON_CAP_DAYS = 21;

/**
 * Derive the autonomy-horizon (how many days the company can run without
 * needing the founder) from the Trust Ledger. Pure + total. Floored at 1 (an
 * unproven system is glanced at daily) and capped at 21. Replaces the old hard
 * stub with a real function of earned autonomy.
 */
export function deriveAutonomyHorizonDays(levels: DomainAutonomyLevel[]): number {
  const sum = levels.reduce((acc, l) => acc + (LEVEL_HORIZON_DAYS[l] ?? 0), 0);
  return Math.min(AUTONOMY_HORIZON_CAP_DAYS, Math.max(1, Math.round(1 + sum)));
}

export function gateResultForLevel(level: DomainAutonomyLevel): GateResult {
  switch (level) {
    case "observe":
      return { gate: "autonomy", status: "block", reason: "domain at OBSERVE — sensing only, no outward action" };
    case "draft":
      return { gate: "autonomy", status: "escalate", reason: "domain at DRAFT — produces drafts; a human must approve before it goes out" };
    case "execute_gated":
    case "autonomous_gated":
      return { gate: "autonomy", status: "pass" };
  }
}

// ── DB-backed state machine ──────────────────────────────────────────────────

/** Seed every domain at the safe default (observe) if not already present. */
export async function ensureDomainsSeeded(): Promise<void> {
  for (const domain of AUTOPILOT_DOMAINS) {
    await db
      .insert(domainAutonomyLevels)
      .values({ domain, level: "observe", cleanCycleCount: 0 })
      .onConflictDoNothing({ target: domainAutonomyLevels.domain });
  }
}

export async function getDomainLevel(domain: AutopilotDomain): Promise<DomainAutonomyLevel> {
  const [row] = await db
    .select({ level: domainAutonomyLevels.level })
    .from(domainAutonomyLevels)
    .where(eq(domainAutonomyLevels.domain, domain))
    .limit(1);
  return (row?.level as DomainAutonomyLevel | undefined) ?? "observe";
}

/**
 * Record a clean cycle for a domain; auto-promote one level when the threshold
 * is reached (resetting the counter). Returns the resulting level.
 */
export async function recordCleanCycle(domain: AutopilotDomain, threshold = PROMOTION_THRESHOLD): Promise<DomainAutonomyLevel> {
  const [row] = await db
    .select({ level: domainAutonomyLevels.level, cleanCycleCount: domainAutonomyLevels.cleanCycleCount })
    .from(domainAutonomyLevels)
    .where(eq(domainAutonomyLevels.domain, domain))
    .limit(1);
  const level = (row?.level as DomainAutonomyLevel | undefined) ?? "observe";
  const nextCount = (row?.cleanCycleCount ?? 0) + 1;

  if (shouldPromote(level, nextCount, threshold)) {
    // Calibration-as-safety-signal: if the system is OVER-confident (predicting
    // more success than it delivers), HOLD the promotion until calibration
    // recovers — accrue the count but don't widen autonomy while it's fooling
    // itself. Dynamic import keeps this module cycle-free.
    let holdForCalibration = false;
    try {
      const { getCalibrationPairs } = await import("./experienceLog");
      const { calibrationReport } = await import("./forecast");
      holdForCalibration = calibrationReport(await getCalibrationPairs()).grade === "over-confident";
    } catch {
      holdForCalibration = false;
    }
    if (holdForCalibration) {
      await db
        .update(domainAutonomyLevels)
        .set({ cleanCycleCount: nextCount, updatedAt: new Date() })
        .where(eq(domainAutonomyLevels.domain, domain));
      logger.warn("[autopilot] promotion HELD — calibration over-confident", { domain, level });
      return level;
    }

    // Decision-QUALITY gate (wire-for-real: decisionEval). Clean cycles count
    // ACTIONS that didn't trip a guardrail, but "didn't break" ≠ "made good
    // calls". Hold the promotion if the domain has enough resolved decisions to
    // trust the number AND its hit-rate is below the floor — earn autonomy by
    // deciding WELL, not just by deciding often. Cold start never holds.
    let holdForQuality = false;
    try {
      const { shouldHoldPromotionForQuality } = await import("./decisionEval");
      holdForQuality = await shouldHoldPromotionForQuality(domain);
    } catch {
      holdForQuality = false;
    }
    if (holdForQuality) {
      await db
        .update(domainAutonomyLevels)
        .set({ cleanCycleCount: nextCount, updatedAt: new Date() })
        .where(eq(domainAutonomyLevels.domain, domain));
      logger.warn("[autopilot] promotion HELD — decision quality below floor", { domain, level });
      return level;
    }
    const promoted = nextLevel(level)!;
    await db
      .update(domainAutonomyLevels)
      .set({ level: promoted, cleanCycleCount: 0, lastPromotedAt: new Date(), updatedAt: new Date() })
      .where(eq(domainAutonomyLevels.domain, domain));
    logger.info("[autopilot] domain promoted", { domain, from: level, to: promoted });
    return promoted;
  }

  await db
    .update(domainAutonomyLevels)
    .set({ cleanCycleCount: nextCount, updatedAt: new Date() })
    .where(eq(domainAutonomyLevels.domain, domain));
  return level;
}

/**
 * Circuit-breaker demotion: drop a domain one level (floored at observe) and
 * reset its clean-cycle progress. Fired by anomaly detectors / gate-failure
 * spikes / a founder override.
 */
export async function recordAnomaly(domain: AutopilotDomain, reason: string): Promise<DomainAutonomyLevel> {
  const current = await getDomainLevel(domain);
  const demoted = prevLevel(current);
  await db
    .update(domainAutonomyLevels)
    .set({
      level: demoted,
      cleanCycleCount: 0,
      lastDemotedAt: new Date(),
      lastDemotionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(domainAutonomyLevels.domain, domain));
  if (demoted !== current) {
    logger.warn("[autopilot] domain demoted (circuit breaker)", { domain, from: current, to: demoted, reason });
  }
  return demoted;
}

/**
 * CP3 of Jarvis Phase 1 (Verified Act-and-Confirm; founder-approved plan
 * docs/internal/jarvis-phase0-audit.md) — the seam through which INDEPENDENT
 * verification verdicts (code-review dispatches, generic verify dispatches)
 * feed the Trust Ledger.
 *
 * A PASSED verdict counts as a verified clean cycle — it increments the SAME
 * clean-cycle counter promotions read (recordCleanCycle; no parallel ledger).
 * A FLAGGED verdict is an anomaly and takes the domain through the EXISTING
 * circuit-breaker demotion (recordAnomaly — one rung down, counter reset).
 *
 * POSTURE: this binding is the act-and-confirm coupling. It only ADDS verified
 * evidence to the ledger — unverified completions earn exactly what they earned
 * before (nothing is loosened) — and the promotion rule itself is unchanged
 * (PROMOTION_THRESHOLD clean cycles + the calibration/quality holds).
 * Verification stays observe-only for the ACTION: a flagged verdict costs the
 * domain trust; it never blocks or rolls back the work it verified.
 */
export async function recordVerifiedOutcome(
  domain: AutopilotDomain,
  passed: boolean,
  evidence: string,
): Promise<DomainAutonomyLevel> {
  if (passed) {
    return recordCleanCycle(domain);
  }
  return recordAnomaly(domain, `verification flagged: ${evidence}`.slice(0, 500));
}

/**
 * The AUTONOMY gate for the policy-gate stack. Inject this as
 * `runPolicyGateStack(action, { checkDomainAutonomy })`.
 */
export async function checkDomainAutonomyGate(action: PolicyAction): Promise<GateResult> {
  const level = await getDomainLevel(action.domain);
  return gateResultForLevel(level);
}

/**
 * Founder sovereign override — directly set a domain's autonomy level. This is
 * the reversibility/control guarantee: the founder can PAUSE a domain (set it
 * to observe) or, conversely, grant trust ahead of the earn curve. Resets the
 * clean-cycle progress and records the reason + the right timestamp so the
 * ledger reads truthfully. Validates the level against the known set.
 */
export async function setDomainLevel(
  domain: AutopilotDomain,
  level: DomainAutonomyLevel,
  reason: string,
): Promise<{ domain: AutopilotDomain; level: DomainAutonomyLevel }> {
  if (!DOMAIN_AUTONOMY_LEVELS.includes(level)) {
    throw new Error(`setDomainLevel: unknown level "${level}"`);
  }
  const current = await getDomainLevel(domain);
  const isDemotion = levelRank(level) < levelRank(current);
  const now = new Date();
  await db
    .insert(domainAutonomyLevels)
    .values({ domain, level, cleanCycleCount: 0 })
    .onConflictDoUpdate({
      target: domainAutonomyLevels.domain,
      set: {
        level,
        cleanCycleCount: 0,
        // Record on the appropriate side so the ledger's history stays honest.
        lastPromotedAt: isDemotion ? undefined : now,
        lastDemotedAt: isDemotion ? now : undefined,
        lastDemotionReason: isDemotion ? `founder: ${reason}` : undefined,
        updatedAt: now,
      },
    });
  logger.warn("[autopilot] domain level set by founder", { domain, from: current, to: level, reason });
  return { domain, level };
}

/** The Trust Ledger — every domain's current standing, for the founder UI. */
export async function getTrustLedger(): Promise<
  Array<{ domain: string; level: DomainAutonomyLevel; cleanCycleCount: number; threshold: number; lastPromotedAt: Date | null; lastDemotedAt: Date | null; lastDemotionReason: string | null }>
> {
  const rows = await db
    .select()
    .from(domainAutonomyLevels)
    .orderBy(domainAutonomyLevels.domain);
  return rows.map((r) => ({
    domain: r.domain,
    level: r.level as DomainAutonomyLevel,
    cleanCycleCount: r.cleanCycleCount,
    threshold: PROMOTION_THRESHOLD,
    lastPromotedAt: r.lastPromotedAt,
    lastDemotedAt: r.lastDemotedAt,
    lastDemotionReason: r.lastDemotionReason,
  }));
}
