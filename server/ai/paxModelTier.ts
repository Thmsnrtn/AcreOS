/**
 * paxModelTier (ai layer) — COST-AWARE MODEL ROUTING BY PAX TURN TYPE.
 *
 * Andrei (#7, Tahoe) — a second, complementary routing axis to the
 * subscription-tier router in `server/services/paxModelTier.ts`.
 *
 *   server/services/paxModelTier.ts  → "what's the MOST CAPABLE model this
 *                                       org's *plan* is allowed to run?"
 *                                       (the TIER CEILING — billing side)
 *   server/ai/paxModelTier.ts (here) → "given the ceiling, what's the
 *                                       LOWEST-CAPABLE model that still
 *                                       PASSES the eval for THIS TURN TYPE?"
 *                                       (the TASK-TYPE FLOOR — cost side)
 *
 * The insight (Andrei's lens, item #7): data-grounded answers are mostly
 * careful *extraction + restatement* of facts the tool layer already
 * retrieved — a job a cheaper model does well. We reserve the top model
 * (Opus) for genuine multi-parcel reasoning. So we classify each Pax turn
 * into a `PaxTaskType` and route the cheapest model whose routing is
 * supported by a GREEN data-grounding eval for that task type.
 *
 * ── HARD SAFETY GATE ─────────────────────────────────────────────────────
 * A turn type is only ever routed *below the tier ceiling* when:
 *   (1) `DATA_GROUNDING_EVAL_GREEN` is true (the Wave-2 eval set is passing),
 *       AND
 *   (2) the per-task-type policy explicitly opts in (`evalSupported: true`).
 * Flip `DATA_GROUNDING_EVAL_GREEN` to false and EVERY task type falls back
 * to the tier ceiling — a single-switch, fully reversible kill. This honours
 * Andrei's dependency: "#3 eval set must be green first; cannot route
 * customer-facing synthesis below Beatrice's safety bar without an eval
 * supporting it."
 *
 * ── REVERSIBILITY ────────────────────────────────────────────────────────
 * Everything here is a pure function of (taskType, tierCeilingModel, config).
 * No DB reads, no side effects. The default config is `DEFAULT_ROUTING_CONFIG`;
 * callers can pass an override (or disable routing entirely) so the behaviour
 * is testable and instantly reversible without a deploy.
 *
 * Pricing (per 1M tokens, claude-api skill 2026-06):
 *   Opus 4.8      $5 in / $25 out   — top reasoning tier (current best)
 *   Sonnet 4.6    $3 in / $15 out   — extraction + grounded synthesis
 *   Haiku 4.5     $1 in / $5  out   — short lookups / restatement / formatting
 * Routing a flood-zone restatement turn from Opus → Haiku is a ~5x input /
 * ~5x output unit-cost cut on the most common Pax turn shape.
 */

import { logger } from "../utils/logger";
// Model IDs come from the SINGLE source of truth (server/services/models.ts) —
// the same one aiRouter uses. Before this, OPUS was pinned to a STALE
// claude-opus-4-7 here while aiRouter pinned a different Opus, so the two
// "pick the top model" systems disagreed. Importing keeps them in lock-step.
import { MODELS } from "../services/models";

// ── Model capability rungs (OpenRouter ids match aiRouter.ts conventions) ────
// Ordered LOW → HIGH capability. `rank` is the comparison key used to clamp a
// task-type pick to never exceed the tier ceiling.
export const PAX_ROUTE_MODEL_HAIKU = MODELS.HAIKU;
export const PAX_ROUTE_MODEL_SONNET = MODELS.SONNET;
export const PAX_ROUTE_MODEL_OPUS = MODELS.OPUS;

/** Capability ladder. Higher rank = more capable = more expensive. */
const MODEL_RANK: Record<string, number> = {
  [PAX_ROUTE_MODEL_HAIKU]: 1,
  [PAX_ROUTE_MODEL_SONNET]: 2,
  [PAX_ROUTE_MODEL_OPUS]: 3,
};

/**
 * Resolve any model id to a rung on our ladder. Unknown ids (e.g. a vision
 * fallback like gpt-4o, or a future Opus alias) are treated as TOP capability
 * so we NEVER accidentally downgrade something we don't recognise.
 */
function rankOf(model: string): number {
  if (model in MODEL_RANK) return MODEL_RANK[model];
  if (model.includes("opus")) return 3;
  if (model.includes("sonnet")) return 2;
  if (model.includes("haiku")) return 1;
  // Unknown → treat as top so the clamp can only ever route *down* to a
  // recognised cheaper rung when we're confident, never up.
  return 99;
}

// ── Pax turn taxonomy ────────────────────────────────────────────────────────
export type PaxTaskType =
  /** Pure restatement of a single retrieved fact ("what's the flood zone?"). */
  | "data_lookup_restate"
  /** Summarise / digest a property's enrichment blob — extraction-heavy. */
  | "data_summary"
  /** Short formatting / templating / list reshaping. No reasoning. */
  | "formatting"
  /** Multi-parcel comparison, valuation, strategy — genuine reasoning. */
  | "multi_parcel_reasoning"
  /** Anything we haven't classified — the safe default. */
  | "general";

// ── Eval gate ────────────────────────────────────────────────────────────────
/**
 * THE GATE. Mirrors the state of the Wave-2 data-grounding eval set
 * (server/ai/dataGroundingEvalCases.ts, DATA_GROUNDING_VERSION "dg-v1",
 * surface=pax_inbox). The eval shipped GREEN in Wave 2 — the safe* outputs
 * pass and adversarial* outputs trip the gate (asserted in
 * dataGroundingEvalCases.test.ts).
 *
 * This is the single reversible switch: set to `false` and no task type is
 * ever routed below its tier ceiling, regardless of per-type policy. Andrei's
 * rule: no sub-ceiling routing of customer-facing synthesis without a green
 * eval supporting it.
 */
export const DATA_GROUNDING_EVAL_GREEN = true;

/**
 * The eval version this gate is keyed to. If the eval set is re-versioned and
 * re-baselined, bump this alongside DATA_GROUNDING_EVAL_GREEN so the routing
 * decision is always traceable to a specific eval run.
 */
export const ROUTING_EVAL_VERSION = "dg-v1";

// ── Per-task-type routing policy ─────────────────────────────────────────────
export interface TaskTypePolicy {
  /**
   * The CHEAPEST model this task type may run on when the eval gate is open.
   * The actual choice is `min(floorModel, tierCeiling)` by capability rank —
   * we never exceed the tier the org is paying for, and never go below this
   * floor.
   */
  floorModel: string;
  /**
   * Whether the data-grounding eval supports routing this task type below the
   * tier ceiling. `false` → always run at the tier ceiling (no downgrade),
   * even when the global gate is open. This is how we keep reasoning turns on
   * the top model.
   */
  evalSupported: boolean;
  /** Human note for the changelog / audit. */
  rationale: string;
}

export interface PaxRoutingConfig {
  /** Master switch: routing entirely off → always use the tier ceiling. */
  enabled: boolean;
  /** Per-task-type policies. */
  policies: Record<PaxTaskType, TaskTypePolicy>;
}

/**
 * DEFAULT policy. Extraction/restatement/formatting route down (eval-backed);
 * multi-parcel reasoning and "general" stay at the tier ceiling.
 */
export const DEFAULT_ROUTING_CONFIG: PaxRoutingConfig = {
  enabled: true,
  policies: {
    data_lookup_restate: {
      floorModel: PAX_ROUTE_MODEL_HAIKU,
      evalSupported: true,
      rationale:
        "Single retrieved fact restated with source/vintage — Haiku passes the dg-v1 hit/miss eval; cheapest rung.",
    },
    data_summary: {
      floorModel: PAX_ROUTE_MODEL_SONNET,
      evalSupported: true,
      rationale:
        "Digest of an enrichment blob is extraction-heavy but multi-field; Sonnet is the lowest rung the dg-v1 eval supports.",
    },
    formatting: {
      floorModel: PAX_ROUTE_MODEL_HAIKU,
      evalSupported: true,
      rationale: "Pure formatting/templating, no factual claims — Haiku.",
    },
    multi_parcel_reasoning: {
      floorModel: PAX_ROUTE_MODEL_OPUS,
      evalSupported: false,
      rationale:
        "Genuine cross-parcel reasoning/valuation — reserve the top model; never downgrade.",
    },
    general: {
      floorModel: PAX_ROUTE_MODEL_OPUS,
      evalSupported: false,
      rationale:
        "Unclassified turn — default to the tier ceiling; no downgrade without an eval-supported classification.",
    },
  },
};

// ── Turn classifier ──────────────────────────────────────────────────────────
// Heuristic, intentionally conservative: when in doubt we return "general"
// (which never downgrades). This is the cheap-to-run pre-pass; the goal is to
// catch the obvious extraction/restatement turns, not to be a perfect NLU.

const MULTI_PARCEL_PATTERNS: RegExp[] = [
  /\bcompare\b/i,
  /\bvs\.?\b/i,
  /\bwhich (?:one|parcel|lot|property)\b/i,
  /\bbetween (?:these|the)\b/i,
  /\bportfolio\b/i,
  /\bvaluation\b/i,
  /\bappraise\b/i,
  /\bstrateg/i,
  /\bmultiple (?:parcels|properties|lots)\b/i,
  /\brank\b/i,
  /\bbest (?:deal|option|parcel)\b/i,
];

const DATA_LOOKUP_PATTERNS: RegExp[] = [
  /\bflood (?:zone|risk)\b/i,
  /\bwetland/i,
  /\bsoil\b/i,
  /\bacreage\b/i,
  /\bhow many acres\b/i,
  /\bzoning\b/i,
  /\bwho owns\b/i,
  /\bowner\b/i,
  /\bapn\b/i,
  /\bparcel (?:number|id)\b/i,
  /\bwhat(?:'s| is) the (?:flood|soil|zoning|acreage)\b/i,
  /\bis (?:it|this (?:parcel|lot)) (?:in a flood|wet|buildable)\b/i,
];

const SUMMARY_PATTERNS: RegExp[] = [
  /\bsummar/i,
  /\boverview\b/i,
  /\bdigest\b/i,
  /\btell me about (?:this|the) (?:parcel|lot|property)\b/i,
  /\bwhat do (?:we|you) know about\b/i,
  /\bgive me the (?:rundown|snapshot|highlights)\b/i,
];

const FORMATTING_PATTERNS: RegExp[] = [
  /\bformat\b/i,
  /\bmake (?:a|this) (?:list|table|bullet)/i,
  /\brewrite\b/i,
  /\bas a (?:table|list|bullet points)\b/i,
  /\bclean up\b/i,
];

/**
 * Classify a Pax turn from its user text. Pure + deterministic.
 *
 * Precedence is deliberate: multi-parcel reasoning wins over a data keyword
 * ("compare the flood zones of these two lots" is reasoning, not a lookup),
 * so we never downgrade a comparison just because it mentions "flood".
 */
export function classifyPaxTaskType(userText: string): PaxTaskType {
  const text = (userText ?? "").trim();
  if (!text) return "general";

  if (MULTI_PARCEL_PATTERNS.some((re) => re.test(text))) {
    return "multi_parcel_reasoning";
  }
  if (FORMATTING_PATTERNS.some((re) => re.test(text))) {
    return "formatting";
  }
  if (SUMMARY_PATTERNS.some((re) => re.test(text))) {
    return "data_summary";
  }
  if (DATA_LOOKUP_PATTERNS.some((re) => re.test(text))) {
    return "data_lookup_restate";
  }
  return "general";
}

// ── The router ───────────────────────────────────────────────────────────────
export interface PaxRouteResult {
  /** The model to actually run this turn on. */
  model: string;
  /** The classified task type. */
  taskType: PaxTaskType;
  /** The tier-ceiling model the cost-router started from. */
  tierCeilingModel: string;
  /** Whether the cost-router moved the choice below the tier ceiling. */
  downgraded: boolean;
  /** Why the choice landed where it did (for telemetry / audit). */
  reason:
    | "routing_disabled"
    | "eval_not_green"
    | "task_not_eval_supported"
    | "ceiling_below_floor"
    | "downgraded_to_floor";
}

/**
 * Pick the cost-optimal Pax model for a turn, never exceeding the tier ceiling
 * and never below the eval-supported floor for the turn type.
 *
 * @param tierCeilingModel  The model resolved by the subscription-tier router
 *                          (server/services/paxModelTier.ts → PaxModelChoice.model).
 *                          This is the MAX capability the org's plan allows.
 * @param userText          The latest user turn text (for classification).
 * @param config            Routing config (defaults to DEFAULT_ROUTING_CONFIG).
 */
export function pickPaxModelForTask(
  tierCeilingModel: string,
  userText: string,
  config: PaxRoutingConfig = DEFAULT_ROUTING_CONFIG,
): PaxRouteResult {
  const taskType = classifyPaxTaskType(userText);

  const base: Omit<PaxRouteResult, "model" | "downgraded" | "reason"> = {
    taskType,
    tierCeilingModel,
  };

  // Master switch off → never downgrade.
  if (!config.enabled) {
    return { ...base, model: tierCeilingModel, downgraded: false, reason: "routing_disabled" };
  }

  // Global eval gate closed → never downgrade ANY task type.
  if (!DATA_GROUNDING_EVAL_GREEN) {
    return { ...base, model: tierCeilingModel, downgraded: false, reason: "eval_not_green" };
  }

  const policy = config.policies[taskType];

  // Task type not eval-supported (reasoning / general) → stay at ceiling.
  if (!policy.evalSupported) {
    return {
      ...base,
      model: tierCeilingModel,
      downgraded: false,
      reason: "task_not_eval_supported",
    };
  }

  const ceilingRank = rankOf(tierCeilingModel);
  const floorRank = rankOf(policy.floorModel);

  // If the tier ceiling is already at/below the floor (e.g. a Free org whose
  // ceiling is Haiku and the floor is Sonnet), there's nothing to downgrade —
  // run at the ceiling. We never route ABOVE the ceiling.
  if (ceilingRank <= floorRank) {
    return {
      ...base,
      model: tierCeilingModel,
      downgraded: false,
      reason: "ceiling_below_floor",
    };
  }

  // Downgrade to the eval-supported floor for this turn type.
  return {
    ...base,
    model: policy.floorModel,
    downgraded: true,
    reason: "downgraded_to_floor",
  };
}

/**
 * Convenience wrapper that also emits a structured telemetry log. Use this on
 * the hot Pax path; use `pickPaxModelForTask` directly in tests.
 */
export function routePaxModelForTurn(args: {
  organizationId: number;
  tierCeilingModel: string;
  userText: string;
  surface: string;
  config?: PaxRoutingConfig;
}): PaxRouteResult {
  const result = pickPaxModelForTask(
    args.tierCeilingModel,
    args.userText,
    args.config ?? DEFAULT_ROUTING_CONFIG,
  );
  if (result.downgraded) {
    logger.info("[pax-cost-route]", {
      metadata: {
        organizationId: args.organizationId,
        surface: args.surface,
        taskType: result.taskType,
        tierCeilingModel: result.tierCeilingModel,
        routedModel: result.model,
        reason: result.reason,
        evalVersion: ROUTING_EVAL_VERSION,
      },
    });
  }
  return result;
}
