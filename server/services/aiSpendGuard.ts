/**
 * aiSpendGuard — cost-ceiling + telemetry for AI surfaces that cannot go
 * through routeAITask.
 *
 * Audit F-16-1 / F-08-4: vaService and supportAgent build their own OpenAI
 * client and call gpt-4o directly, escaping the platform cost ceiling, the
 * per-org quota, and telemetry. They CANNOT be migrated to routeAITask like
 * the single-shot surfaces (docs/openai-bypass-migration.md) because they are
 * tool-calling agents and `routeAITask`'s message shape has no `tool` role and
 * its response has no `tool_calls` — routing them through it would break the
 * agent loop entirely.
 *
 * This module gives those agents the two protections that matter most without
 * touching their tool-calling loop:
 *   1. assertAiSpendAllowed(orgId) — the SAME platform daily cost-ceiling gate
 *      routeAITask runs, so a runaway/expensive agent stops when the platform
 *      is over budget instead of spending unbounded past the ceiling.
 *   2. recordExternalAiSpend(...) — writes an aiTelemetryEvents row so the
 *      agent's spend shows in /founder/financials COGS AND counts toward the
 *      ceiling's own 24h sum (without this the ceiling can't see this spend).
 *
 * The full migration (these agents through a tool-aware router) remains the
 * real unblock; it is tracked in docs/openai-bypass-migration.md.
 */

import { assertWithinAiCostCeiling } from "./aiCostCeiling";
import { computeCostUsd } from "./aiCostRates";
import { logger } from "../utils/logger";

/**
 * Throws AiCostCeilingExceededError (code AI_COST_CEILING_EXCEEDED) when the
 * platform is over its daily AI spend ceiling. Call at the ENTRY of a
 * non-router AI agent so it respects the same envelope routeAITask enforces.
 */
export async function assertAiSpendAllowed(orgId: number | null): Promise<void> {
  await assertWithinAiCostCeiling(orgId);
}

/**
 * Record one non-router model call in aiTelemetryEvents (fire-and-forget, never
 * throws). Mirrors aiRouter's own telemetry write so external-agent spend lands
 * in the same table the ceiling sums and the COGS rollup reads.
 */
export function recordExternalAiSpend(input: {
  orgId: number | null;
  taskType: string;
  model: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  success?: boolean;
}): void {
  void (async () => {
    try {
      const promptTokens = Math.max(0, Math.trunc(input.promptTokens ?? 0));
      const completionTokens = Math.max(0, Math.trunc(input.completionTokens ?? 0));
      const usd = computeCostUsd(input.model, promptTokens, completionTokens);
      const { db } = await import("../db");
      const { aiTelemetryEvents } = await import("@shared/schema");
      await db.insert(aiTelemetryEvents).values({
        organizationId: input.orgId,
        taskType: input.taskType,
        provider: input.provider ?? "openai",
        model: input.model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostCents: (usd * 100).toFixed(4),
        success: input.success ?? true,
      });
    } catch (err) {
      logger.warn("[aiSpendGuard] failed to record external AI spend", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      });
    }
  })();
}
