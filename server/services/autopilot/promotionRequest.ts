/**
 * Founder Autopilot — Horizon A2: the FOUNDER GATE on autonomy promotions.
 *
 * Constitutional basis: Sovereign Principle 10 — "No agent may unilaterally
 * expand its own authority"; promotions/demotions are Class B decisions.
 *
 * Reaching the clean-cycle threshold (domainAutonomy.recordCleanCycle) no
 * longer widens autonomy by itself. It calls requestPromotion(), which:
 *   1. refuses STRUCTURALLY any promotion whose evidence cites a hard-stop
 *      class (hardStops.ts, mature-machine §1.4 + §4 final row: pricing_changes,
 *      legal_signing, spend_over_500_usd, customer_data_deletion are NEVER
 *      autonomous, forever — no shadow record, however clean, changes that);
 *   2. declines to fire (logged) below SHADOW_MIN_PAIRS resolved shadow pairs —
 *      the counter simply holds at threshold and the domain can sit there
 *      indefinitely until evidence accumulates; nothing is padded;
 *   3. otherwise raises ONE open 'shadow_promotion_request' decisions-inbox
 *      card (deduped per domain+targetLevel; routed through the interrupt
 *      arbiter as Class B — a machine-initiated interrupt) carrying the
 *      current→target level, clean-cycle count, the shadow-agreement numbers,
 *      and the 3 most recent misses verbatim.
 *
 * ONLY the founder's tap applies the level (applyPromotionAnswer → the same
 * setDomainLevel the manual Control-Center Grant button uses — that button
 * remains the founder's sovereign override, Sovereign Principle 9, unchanged).
 * "Not yet" halves the clean-cycle counter: a re-ask is re-earned, not a nag.
 *
 * Demotion (recordAnomaly) is untouched and stays automatic — the circuit
 * breaker never waits for a tap. This module only TIGHTENS.
 *
 * Dependency-injected (act.ts pattern) → unit-testable with zero DB.
 */
import { logger } from "../../utils/logger";
import type { AutopilotDomain } from "./policyGate";
import { HARD_STOPS, matchHardStopHand, type HardStop } from "./hardStops";
import {
  getDomainLevel,
  holdPromotionProgress,
  nextLevel,
  setDomainLevel,
  DOMAIN_AUTONOMY_LEVELS,
  type DomainAutonomyLevel,
} from "./domainAutonomy";
import {
  computeShadowAgreement,
  formatShadowAgreementLine,
  SHADOW_MIN_PAIRS,
  type ShadowAgreement,
} from "./shadowAgreement";

/** decisions_inbox_items.item_type for the promotion card (text column — no migration). */
export const SHADOW_PROMOTION_ITEM_TYPE = "shadow_promotion_request";

/** The card's two tap options (2.3 phone-answerable style). */
export const PROMOTION_OPTION_GRANT = "grant";
export const PROMOTION_OPTION_HOLD = "hold";

/** What the requester knows at threshold time. */
export interface PromotionRequestEvidence {
  currentLevel: DomainAutonomyLevel;
  cleanCycleCount: number;
  threshold: number;
}

/** What lands in the card's contextBundle.shadowPromotion. Levels are plain
 * strings at this seam (the card is a founder surface; validation of the
 * target level happens where the level is APPLIED — applyPromotionAnswer). */
export interface ShadowPromotionCardInput {
  domain: string;
  fromLevel: string;
  toLevel: string;
  cleanCycleCount: number;
  threshold: number;
  agreement: ShadowAgreement;
}

export interface PromotionRequestResult {
  created: boolean;
  reason:
    | "card_created"
    | "card_already_open"
    | "at_top_level"
    | "insufficient_shadow_evidence"
    | "hard_stop_excluded"
    | "card_creation_failed";
  itemId?: number | null;
  detail?: string;
}

export interface PromotionRequestDeps {
  computeAgreement: (domain: string) => Promise<ShadowAgreement>;
  createCard: (input: ShadowPromotionCardInput) => Promise<{ itemId: number | null; created: boolean }>;
}

const defaultDeps: PromotionRequestDeps = {
  computeAgreement: computeShadowAgreement,
  createCard: async (input) => {
    // Dynamic import: decisionsInbox is a founder-surface module; keep this
    // kernel module free of a static edge into it (outcomeLedger pattern).
    const { decisionsInboxService } = await import("../decisionsInbox");
    return decisionsInboxService.createShadowPromotionRequest(input);
  },
};

/**
 * STRUCTURAL hard-stop exclusion — pure. Provenance: hardStops.ts
 * (mature-machine §1.4 + §4, final row): pricing_changes, legal_signing,
 * spend_over_500_usd, customer_data_deletion are NEVER autonomous, forever.
 * A promotion request is screened on the domain name AND every capability its
 * shadow evidence cites, against BOTH the literal hard-stop class names and
 * the same HARD_STOP_HAND_PATTERNS the hands registry enforces at boot.
 * Returns the violated class, or null when clean.
 */
export function promotionHardStopViolation(
  domain: string,
  capabilities: readonly string[],
): HardStop | null {
  for (const name of [domain, ...capabilities]) {
    if ((HARD_STOPS as readonly string[]).includes(name)) return name as HardStop;
    const matched = matchHardStopHand(name, "");
    if (matched) return matched;
  }
  return null;
}

/** CEO-plain rendering of a level for the card body / option label. */
function plainLevel(level: string): string {
  const words: Record<string, string> = {
    observe: "watching only",
    draft: "drafts — you approve",
    execute_gated: "acts — safety-checked",
    autonomous_gated: "independent — safety-checked",
  };
  return words[level] ?? level;
}

/** The card's analysis text — every number computed from real matched pairs. Pure. */
export function buildPromotionCardBody(input: ShadowPromotionCardInput): string {
  const a = input.agreement;
  const lines: string[] = [
    `The ${input.domain} domain has earned promotion eligibility: ${input.cleanCycleCount}/${input.threshold} clean cycles at "${plainLevel(input.fromLevel)}".`,
    `Requested: ${input.fromLevel} → ${input.toLevel} ("${plainLevel(input.toLevel)}"). Nothing changes unless you grant it.`,
    `Shadow agreement (calls it would have made vs. how rulings actually resolved): ${a.matched}/${a.total} matched over the trailing ${a.windowWeeks} weeks${a.pendingPairs > 0 ? ` (${a.pendingPairs} pair${a.pendingPairs === 1 ? "" : "s"} still unresolved — excluded, never counted)` : ""}.`,
  ];
  if (a.misses.length > 0) {
    lines.push("Most recent disagreements:");
    for (const m of a.misses) {
      lines.push(`• ${m.when ?? "undated"} — ${m.moveKind}: shadow called "${m.shadowCall}"; ${m.actualRuling}`);
    }
  } else {
    lines.push("No disagreements in the window.");
  }
  return lines.join("\n");
}

/**
 * Raise the founder promotion card for a domain at threshold. Never widens
 * autonomy itself; never throws (a failure is a logged non-event — the
 * counter already holds at threshold, so nothing is lost).
 */
export async function requestPromotion(
  domain: AutopilotDomain,
  evidence: PromotionRequestEvidence,
  deps: Partial<PromotionRequestDeps> = {},
): Promise<PromotionRequestResult> {
  const dd = { ...defaultDeps, ...deps };
  const toLevel = nextLevel(evidence.currentLevel);
  if (!toLevel) return { created: false, reason: "at_top_level" };

  let agreement: ShadowAgreement;
  try {
    agreement = await dd.computeAgreement(domain);
  } catch (err) {
    logger.warn(
      "[autopilot/promotion] shadow-agreement read failed — no card (fails closed)",
      err instanceof Error ? err : undefined,
    );
    return { created: false, reason: "insufficient_shadow_evidence", detail: "agreement unavailable" };
  }

  // 1. Hard-stop classes are NEVER promotion-eligible, regardless of record.
  const violation = promotionHardStopViolation(domain, agreement.capabilities);
  if (violation) {
    logger.warn("[autopilot/promotion] REFUSED — evidence cites a hard-stop class (never autonomous, forever)", {
      metadata: { domain, toLevel, hardStop: violation },
    });
    return { created: false, reason: "hard_stop_excluded", detail: violation };
  }

  // 2. Honest minimum: below SHADOW_MIN_PAIRS resolved pairs the card does not
  // fire. The counter holds at threshold — the domain can sit at-threshold
  // indefinitely until evidence accumulates. Say so in the log; pad nothing.
  if (agreement.total < SHADOW_MIN_PAIRS) {
    const detail = `insufficient shadow evidence: ${agreement.total} of ${SHADOW_MIN_PAIRS} minimum pairs`;
    logger.info(`[autopilot/promotion] card NOT created — ${detail}; counter holds at threshold`, {
      metadata: { domain, toLevel, pendingPairs: agreement.pendingPairs },
    });
    return { created: false, reason: "insufficient_shadow_evidence", detail };
  }

  try {
    const { itemId, created } = await dd.createCard({
      domain,
      fromLevel: evidence.currentLevel,
      toLevel,
      cleanCycleCount: evidence.cleanCycleCount,
      threshold: evidence.threshold,
      agreement,
    });
    return { created, reason: created ? "card_created" : "card_already_open", itemId };
  } catch (err) {
    logger.warn("[autopilot/promotion] card creation failed — level unchanged", err instanceof Error ? err : undefined);
    return { created: false, reason: "card_creation_failed" };
  }
}

// ── The founder's answer ─────────────────────────────────────────────────────

export interface PromotionAnswerDeps {
  getLevel: typeof getDomainLevel;
  setLevel: typeof setDomainLevel;
  hold: typeof holdPromotionProgress;
}

const defaultAnswerDeps: PromotionAnswerDeps = {
  getLevel: getDomainLevel,
  setLevel: setDomainLevel,
  hold: holdPromotionProgress,
};

export interface PromotionAnswerResult {
  applied: "granted" | "held" | "skipped";
  domain: string | null;
  level?: DomainAutonomyLevel;
  detail?: string;
}

/**
 * Apply the founder's tap on a shadow_promotion_request card. Called by the
 * decisions-inbox resolve routes BEFORE the card itself resolves (the A1
 * outcome-check-in interception pattern), so a partial failure can be retapped.
 *
 *   grant → setDomainLevel(domain, toLevel, "founder-approved promotion
 *           (shadow agreement N/M)") — the ONE path a promotion card widens
 *           autonomy through, and it is the founder's tap.
 *   hold  → holdPromotionProgress: counter → threshold/2. Re-ask is re-earned.
 *
 * Stale-card guard: a grant only applies when the domain still sits at the
 * card's fromLevel. If it moved (demoted by the automatic circuit breaker, or
 * already changed by the founder), the tap is honestly SKIPPED — a stale card
 * must never loosen a gate.
 */
export async function applyPromotionAnswer(
  params: {
    item: { id: number; contextBundle: Record<string, any> | null };
    optionKey: string;
  },
  deps: Partial<PromotionAnswerDeps> = {},
): Promise<PromotionAnswerResult> {
  const dd = { ...defaultAnswerDeps, ...deps };
  const sp = params.item.contextBundle?.shadowPromotion as
    | {
        domain?: string;
        fromLevel?: string;
        toLevel?: string;
        agreement?: { matched?: number; total?: number };
      }
    | undefined;
  if (!sp || typeof sp.domain !== "string" || typeof sp.toLevel !== "string") {
    // The card creator always writes shadowPromotion; its absence is a
    // programming error, never founder input to guess at (outcomeLedger rule).
    throw new Error(`[autopilot/promotion] card #${params.item.id} carries no shadowPromotion bundle`);
  }
  if (params.optionKey !== PROMOTION_OPTION_GRANT && params.optionKey !== PROMOTION_OPTION_HOLD) {
    throw new Error(`[autopilot/promotion] unknown promotion option key: ${params.optionKey}`);
  }
  const domain = sp.domain as AutopilotDomain;

  if (params.optionKey === PROMOTION_OPTION_HOLD) {
    await dd.hold(domain);
    return { applied: "held", domain };
  }

  const toLevel = sp.toLevel as DomainAutonomyLevel;
  if (!DOMAIN_AUTONOMY_LEVELS.includes(toLevel)) {
    throw new Error(`[autopilot/promotion] card #${params.item.id} carries unknown target level "${sp.toLevel}"`);
  }
  const current = await dd.getLevel(domain);
  if (sp.fromLevel && current !== sp.fromLevel) {
    logger.warn("[autopilot/promotion] stale card — domain moved since the card was raised; grant skipped", {
      metadata: { domain, cardFrom: sp.fromLevel, cardTo: sp.toLevel, current },
    });
    return { applied: "skipped", domain, detail: `domain now at "${current}", card was for "${sp.fromLevel}"` };
  }
  const matched = sp.agreement?.matched ?? 0;
  const total = sp.agreement?.total ?? 0;
  await dd.setLevel(domain, toLevel, `founder-approved promotion (shadow agreement ${matched}/${total})`);
  return { applied: "granted", domain, level: toLevel };
}

/** Re-export for card body composition in decisionsInbox. */
export { formatShadowAgreementLine };
