/**
 * TRUST SEAM — SHADOW MODE ONLY (stage-4 turn 11,
 * docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md §1d, phase 2).
 *
 * The single riskiest translation in the whole consolidation is replacing
 * the companyAgents trust-tier check inside two LIVE safety gates with the
 * autopilot domain ledger. This module makes that translation OBSERVABLE
 * before it is ever load-bearing: both gates keep returning their legacy
 * verdicts unchanged, and additionally ask this seam for its verdict; every
 * DIVERGENCE is counted here and logged with full context. After ≥1 week on
 * the real 2-min/5-min/30-min cadences, the divergence log — not an asserted
 * equivalence — is the evidence that licenses (or blocks) the turn-12/13
 * flips.
 *
 * Verdict semantics, fail-closed at every edge:
 *  - a NEVER_PROMOTE / hard-stop action id → "block", structurally — the
 *    map cannot express a domain for it, so no ledger level can ever allow
 *    it (the hardStops derivation stays pinned by agentAuthorityCeiling +
 *    hardStopLaneCoverage).
 *  - an UNMAPPED action → "escalate" — unknown is never allowed.
 *  - a mapped action answers from the domain's earned level:
 *    observe → "block" (the domain may not act outwardly at all),
 *    draft → "escalate" (propose, don't do),
 *    execute_gated / autonomous_gated → "allow" (the rest of the policy
 *    stack still applies — this seam is one gate, not the whole ladder).
 *  - a ledger read that THROWS → "escalate" (a check that cannot run is not
 *    a check that passed).
 *
 * The counters are in-memory (reset on restart) because every divergence is
 * ALSO logger.warn'd with full context — the durable record is the log
 * stream; the counters are the cheap live read for the admin panel.
 */
import { logger } from "../../utils/logger";
import { getDomainLevel } from "./domainAutonomy";
import type { AutopilotDomain } from "./policyGate";
import { isNeverPromote } from "../agentAuthorityGate";

export type SeamVerdict = "allow" | "escalate" | "block";

/**
 * Action → policy domain, hand-curated from the REAL registries (the
 * executionEngine actionRegistry and the authority-gate vocabulary). An
 * action absent here escalates; adding one is a deliberate edit, reviewed
 * with the map's fail-closed contract in mind.
 */
export const ACTION_DOMAIN_MAP: Readonly<Record<string, AutopilotDomain>> = {
  // customer-touch / retention
  send_follow_up: "support",
  send_churn_intervention: "support",
  send_alert: "ops",
  // deals / money-adjacent (financial hard checks stay in their own gates)
  advance_deal_stage: "finance",
  flag_deal_risk: "finance",
  // internal work items
  create_task: "ops",
  complete_task: "ops",
  update_lead_status: "growth",
  generate_report: "ops",
  store_learning: "ops",
  // platform operations
  restart_failed_job: "deploy",
  activate_degradation_mode: "deploy",
  deactivate_degradation_mode: "deploy",
  escalate_to_founder: "ops",
};

export interface SeamAnswer {
  verdict: SeamVerdict;
  domain: AutopilotDomain | null;
  level: string | null;
  reason: string;
}

export async function seamVerdict(action: string): Promise<SeamAnswer> {
  if (isNeverPromote(action)) {
    return { verdict: "block", domain: null, level: null, reason: `hard-stop class: ${action} is never promotable` };
  }
  const domain = ACTION_DOMAIN_MAP[action] ?? null;
  if (!domain) {
    return { verdict: "escalate", domain: null, level: null, reason: `unmapped action "${action}" — unknown is never allowed` };
  }
  let level;
  try {
    level = await getDomainLevel(domain);
  } catch (err) {
    return {
      verdict: "escalate",
      domain,
      level: null,
      reason: `ledger read failed (${err instanceof Error ? err.message : String(err)}) — a check that cannot run has not passed`,
    };
  }
  if (level === "execute_gated" || level === "autonomous_gated") {
    return { verdict: "allow", domain, level, reason: `domain ${domain} earned ${level}` };
  }
  if (level === "draft") {
    return { verdict: "escalate", domain, level, reason: `domain ${domain} at draft — propose, don't do` };
  }
  return { verdict: "block", domain, level, reason: `domain ${domain} at observe — no outward action` };
}

// ── Shadow comparison ──────────────────────────────────────────────────────

interface ShadowCounters {
  comparisons: number;
  agreements: number;
  divergences: number;
  /** legacy allowed, seam would not (the dangerous direction for the flip). */
  seamStricter: number;
  /** legacy refused, seam would allow (widening — must be ~zero to flip). */
  seamLooser: number;
  byAction: Record<string, { comparisons: number; divergences: number }>;
  startedAt: string;
}

const counters: ShadowCounters = {
  comparisons: 0,
  agreements: 0,
  divergences: 0,
  seamStricter: 0,
  seamLooser: 0,
  byAction: {},
  startedAt: new Date().toISOString(),
};

/**
 * Record one shadow comparison. NEVER throws, never changes behavior —
 * callers fire-and-forget it after computing their legacy verdict.
 */
export async function shadowCompare(input: {
  gate: "executionEngine" | "agentAuthorityGate";
  agentCodename: string;
  action: string;
  legacyAllowed: boolean;
}): Promise<void> {
  try {
    const seam = await seamVerdict(input.action);
    const seamAllowed = seam.verdict === "allow";
    counters.comparisons += 1;
    const slot = (counters.byAction[input.action] ??= { comparisons: 0, divergences: 0 });
    slot.comparisons += 1;
    if (seamAllowed === input.legacyAllowed) {
      counters.agreements += 1;
      return;
    }
    counters.divergences += 1;
    slot.divergences += 1;
    if (input.legacyAllowed && !seamAllowed) counters.seamStricter += 1;
    else counters.seamLooser += 1;
    logger.warn("[trustSeam] SHADOW DIVERGENCE", {
      metadata: {
        gate: input.gate,
        agent: input.agentCodename,
        action: input.action,
        legacyAllowed: input.legacyAllowed,
        seamVerdict: seam.verdict,
        seamDomain: seam.domain,
        seamLevel: seam.level,
        seamReason: seam.reason,
        direction: input.legacyAllowed ? "seam-stricter" : "seam-LOOSER",
      },
    });
  } catch (err) {
    // Shadow machinery must never disturb the live gate.
    logger.debug?.(
      `[trustSeam] shadow comparison failed silently: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function getShadowCounters(): ShadowCounters {
  return JSON.parse(JSON.stringify(counters));
}
