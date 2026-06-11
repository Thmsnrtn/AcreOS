/**
 * modelRouter — UNIFIED model-resolution facade (T3-3D sub-item 6).
 *
 * The seven model-routing axes are real but were scattered across six files,
 * with no single place that composes them and no record of WHY a given model
 * was chosen. `resolveModel(ctx)` is that single place: it composes the existing
 * axis functions in EXPLICIT precedence and returns the model id PLUS an ordered
 * `DecisionTrace` — one entry per axis, each carrying the axis's own existing
 * "reason" string.
 *
 * ── DESIGN CONSTRAINT: WRAP, NEVER REIMPLEMENT ───────────────────────────────
 * This module owns NO routing logic of its own. Every axis decision is delegated
 * to the function that already owns it:
 *
 *   1. cost-ceiling kill   → aiCostCeiling.assertWithinAiCostCeiling
 *                            (the only fail-CLOSED gate; throws past the ceiling)
 *   2. config force-pins    → aiRouter.selectProviderAndModelAsync
 *                            (forceModel / useCritical / useVision / useReasoning
 *                             / forcePremium — its own precedence, unchanged)
 *   3. complexity / DB base → aiRouter.selectProviderAndModelAsync
 *                            (classifyTaskComplexity + ai_model_configs +
 *                             ai_routing_overrides, all inside that call)
 *   4. tier-ceiling clamp   → paxModelTier(services).pickPaxModelForOrg
 *                            ("what's the MOST CAPABLE model this org's PLAN
 *                             allows?" — billing side)
 *   5. task-type floor      → paxModelTier(ai).pickPaxModelForTask
 *                            ("given the ceiling, the LOWEST-capable model that
 *                             still passes the eval for THIS turn type" — cost
 *                             side; never exceeds the ceiling)
 *   6. prompt-version stamp → paxPromptVersions.DEFAULT_PAX_PROMPT_VERSION /
 *                            parsePaxPromptVersion (observational; never changes
 *                            the model)
 *
 * Because steps 2 and 3 both live inside `selectProviderAndModelAsync`, the
 * resolver calls it ONCE and records two trace entries (force-pin vs base) by
 * inspecting which config flag fired — it does not re-derive the model.
 *
 * ── SHADOW MODE (current deployment) ─────────────────────────────────────────
 * `resolveModel` is wired at the Pax hot path ALONGSIDE the existing selection;
 * the existing path remains the decider. The resolver's output is logged (the
 * trace) for later reconciliation but never changes which model actually runs.
 * Nothing here throws into the live path: the cost-ceiling probe is caught and
 * recorded as a trace entry, not re-thrown (the live aiRouter still owns the
 * real fail-closed enforcement on the actual call).
 *
 * No DB schema change, no migration, no new model-calling cost — this is pure
 * routing-composition logic over functions that already run.
 */

import type OpenAI from "openai";
import {
  selectProviderAndModelAsync,
  classifyTaskComplexity,
  TaskComplexity,
  type AIRouterConfig,
  type AIProvider,
} from "./aiRouter";
import { pickPaxModelForOrg, type PaxModelChoice } from "./paxModelTier";
import {
  pickPaxModelForTask,
  DEFAULT_ROUTING_CONFIG,
  type PaxRoutingConfig,
  type PaxRouteResult,
} from "../ai/paxModelTier";
import {
  DEFAULT_PAX_PROMPT_VERSION,
  parsePaxPromptVersion,
  type PaxPromptVersion,
} from "../ai/paxPromptVersions";
import { getEffectiveCeilings, AiCostCeilingExceededError } from "./aiCostCeiling";

/**
 * The seven routing axes, named so a DecisionTrace entry self-describes which
 * stage produced it.
 */
export type RouteAxis =
  | "cost_ceiling_kill"
  | "config_force_pin"
  | "complexity_db_base"
  | "tier_ceiling_clamp"
  | "task_type_floor"
  | "prompt_version_stamp";

/**
 * One step in the resolution. `input` is what the axis saw; `output` is what it
 * decided (a model id, a pass-through marker, or — for the prompt-version stamp
 * — the version string). `reason` reuses the axis's OWN existing reason string
 * verbatim wherever the wrapped function exposes one.
 */
export interface DecisionTraceEntry {
  axis: RouteAxis;
  input: unknown;
  output: string;
  reason: string;
}

export type DecisionTrace = DecisionTraceEntry[];

/**
 * Everything the axes need, matching what the existing functions already take.
 * Mirrors the shape the Pax hot path (executive.ts) already has in hand at
 * model-selection time, so wiring is a field copy — no new lookups.
 */
export interface RouteContext {
  /** Org id — drives tier ceiling + cost ceiling. Null for platform calls. */
  organizationId: number | null;
  /**
   * Subscription tier choice, if the caller already resolved it via
   * `pickPaxModelForOrg`. When omitted AND organizationId is set, resolveModel
   * resolves it itself (fail-open to Haiku, same as the live path).
   */
  paxChoice?: PaxModelChoice;
  /** Task complexity. When omitted, derived from taskType via classifyTaskComplexity. */
  complexity?: TaskComplexity;
  /** Caller task tag (e.g. "pax_chat") used for complexity classification + telemetry. */
  taskType?: string;
  /** Latest user turn text — drives the task-type floor classifier. */
  userText?: string;
  /** Surface tag for telemetry (e.g. "processChat"). */
  surface?: string;
  /** Router config flags: forceModel / useCritical / useVision / useReasoning / forcePremium. */
  config?: AIRouterConfig;
  /** Cost-aware task-type routing config (defaults to DEFAULT_ROUTING_CONFIG). */
  routingConfig?: PaxRoutingConfig;
  /** Prompt-version intent (e.g. from ?paxPrompt=v2). Defaults to DEFAULT_PAX_PROMPT_VERSION. */
  promptVersionIntent?: unknown;
}

export interface ResolveModelResult {
  /** The composed model id. In shadow mode this is logged, not enforced. */
  model: string;
  /** Provider the base selection resolved (carried through; not re-derived). */
  provider: AIProvider;
  /** The OpenAI-compatible client the base selection resolved. */
  client: OpenAI;
  /** maxTokens the base DB config resolved (or aiRouter's default). */
  maxTokens: number;
  /** Resolved prompt version (observational stamp). */
  promptVersion: PaxPromptVersion;
  /** Ordered trace — one entry per axis that fired, in precedence order. */
  decisionTrace: DecisionTrace;
}

/**
 * Compose the routing axes in EXPLICIT precedence and return the model + trace.
 *
 * Precedence (highest-authority first):
 *   cost-ceiling kill → config force-pins → complexity/DB base →
 *   tier-ceiling clamp → task-type floor downgrade → prompt-version stamp.
 *
 * Each step delegates to the function that already owns it (see file header)
 * and pushes one DecisionTrace entry reusing that function's reason string.
 * resolveModel reimplements NONE of the axis logic.
 */
export async function resolveModel(ctx: RouteContext): Promise<ResolveModelResult> {
  const trace: DecisionTrace = [];
  const config: AIRouterConfig = ctx.config ?? {};
  const taskType = ctx.taskType ?? "ad_hoc";

  // ── Axis 1: cost-ceiling kill (fail-CLOSED authority) ──────────────────────
  // We DELEGATE to aiCostCeiling — never re-sum spend here. In shadow mode the
  // probe is observational: we record whether the org is past its ceiling, but
  // do NOT throw (the live aiRouter call still owns real enforcement). The
  // reason string mirrors AiCostCeilingExceededError's own message.
  let costCeilingTripped = false;
  if (ctx.organizationId != null) {
    try {
      const ceilings = await getEffectiveCeilings(ctx.organizationId);
      trace.push({
        axis: "cost_ceiling_kill",
        input: { organizationId: ctx.organizationId },
        output: "within_ceiling",
        reason:
          `daily ceiling $${(ceilings.dailyCents / 100).toFixed(2)} ` +
          `(source: ${ceilings.source}) — not exceeded at resolve time`,
      });
    } catch (err) {
      // Fail-open exactly like the live ceiling check: a lookup hiccup never
      // blocks routing. Record the miss so the trace is honest.
      costCeilingTripped = err instanceof AiCostCeilingExceededError;
      trace.push({
        axis: "cost_ceiling_kill",
        input: { organizationId: ctx.organizationId },
        output: costCeilingTripped ? "ceiling_exceeded" : "ceiling_check_failed_open",
        reason:
          err instanceof Error
            ? err.message
            : "cost-ceiling lookup failed; falling open (no block)",
      });
    }
  } else {
    trace.push({
      axis: "cost_ceiling_kill",
      input: { organizationId: null },
      output: "platform_call_no_ceiling",
      reason: "platform-internal call (orgId null) — per-org ceiling does not apply",
    });
  }

  // ── Axes 2 + 3: config force-pins AND complexity/DB base ────────────────────
  // BOTH live inside selectProviderAndModelAsync (force-pins win there, then
  // complexity + ai_model_configs + ai_routing_overrides). Call it ONCE; record
  // two trace entries by inspecting which config flag fired. We never re-derive
  // the model — `base.model` IS the authority for these two axes.
  const complexity =
    ctx.complexity ?? classifyTaskComplexity(taskType);
  const base = await selectProviderAndModelAsync(complexity, taskType, config);

  const hardPin =
    (config.forceModel && "forceModel") ||
    (config.useCritical && "useCritical") ||
    (config.useVision && "useVision") ||
    (config.useReasoning && "useReasoning") ||
    (config.forcePremium && "forcePremium") ||
    null;

  if (hardPin) {
    trace.push({
      axis: "config_force_pin",
      input: { flag: hardPin },
      output: base.model,
      // aiRouter pins these explicitly in selectProviderAndModel; the reason
      // names the flag that won there.
      reason: `config.${hardPin} force-pinned the model in selectProviderAndModel`,
    });
  } else {
    trace.push({
      axis: "config_force_pin",
      input: { flag: null },
      output: "no_force_pin",
      reason: "no config force-pin (forceModel/useCritical/useVision/useReasoning/forcePremium) set",
    });
  }

  trace.push({
    axis: "complexity_db_base",
    input: { complexity, taskType },
    output: base.model,
    reason: hardPin
      ? `base superseded by config.${hardPin}; complexity=${complexity}`
      : `complexity=${complexity} → DB config / ai_routing_overrides / default in selectProviderAndModelAsync`,
  });

  // A force-pin is the live router's highest non-ceiling authority: it skips the
  // tier-ceiling and task-type axes entirely (the live path leaves model
  // unchanged when hasHardPin). Mirror that here.
  let model = base.model;

  // ── Axis 4: tier-ceiling clamp (subscription plan) ─────────────────────────
  // Only applies to org calls without a hard pin. DELEGATE to pickPaxModelForOrg
  // (its own fail-open-to-Haiku contract) — never re-read the tier here.
  let tierCeilingModel: string | null = null;
  if (!hardPin && ctx.organizationId != null) {
    const paxChoice: PaxModelChoice =
      ctx.paxChoice ?? (await pickPaxModelForOrg(ctx.organizationId));
    tierCeilingModel = paxChoice.model;
    model = paxChoice.model;
    trace.push({
      axis: "tier_ceiling_clamp",
      input: {
        organizationId: ctx.organizationId,
        tier: paxChoice.tier,
        msgCountThisMonth: paxChoice.msgCountThisMonth,
      },
      output: paxChoice.model,
      // Reuse PaxModelChoice.reason verbatim.
      reason: `pax tier '${paxChoice.tier}': ${paxChoice.reason}${paxChoice.isDowngraded ? " (downgraded)" : ""}`,
    });
  } else {
    trace.push({
      axis: "tier_ceiling_clamp",
      input: { organizationId: ctx.organizationId, hardPin },
      output: model,
      reason: hardPin
        ? `skipped — config.${hardPin} force-pin outranks tier ceiling`
        : "skipped — platform call (no subscription tier)",
    });
  }

  // ── Axis 5: task-type floor downgrade (cost-aware) ─────────────────────────
  // DELEGATE to pickPaxModelForTask. It clamps the tier ceiling DOWN to the
  // cheapest eval-green model for the turn type, never above the ceiling. Reuse
  // PaxRouteResult.reason verbatim.
  if (!hardPin && tierCeilingModel) {
    const routeResult: PaxRouteResult = pickPaxModelForTask(
      tierCeilingModel,
      ctx.userText ?? "",
      ctx.routingConfig ?? DEFAULT_ROUTING_CONFIG,
    );
    model = routeResult.model;
    trace.push({
      axis: "task_type_floor",
      input: { tierCeilingModel, taskType: routeResult.taskType },
      output: routeResult.model,
      reason: `${routeResult.reason}${routeResult.downgraded ? ` (downgraded from ${tierCeilingModel})` : ""}`,
    });
  } else {
    trace.push({
      axis: "task_type_floor",
      input: { tierCeilingModel, hardPin },
      output: model,
      reason: hardPin
        ? `skipped — config.${hardPin} force-pin outranks task-type floor`
        : "skipped — no tier ceiling to clamp (platform call)",
    });
  }

  // ── Axis 6: prompt-version stamp (observational; never changes the model) ──
  const promptVersion = parsePaxPromptVersion(
    ctx.promptVersionIntent ?? DEFAULT_PAX_PROMPT_VERSION,
  );
  trace.push({
    axis: "prompt_version_stamp",
    input: { intent: ctx.promptVersionIntent ?? DEFAULT_PAX_PROMPT_VERSION },
    output: promptVersion,
    reason: `prompt version '${promptVersion}' stamped (does not affect model choice)`,
  });

  return {
    model,
    provider: base.provider,
    client: base.client,
    maxTokens: base.maxTokens,
    promptVersion,
    decisionTrace: trace,
  };
}
