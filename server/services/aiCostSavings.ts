/**
 * The AI cost-savings summary, as a pure function.
 *
 * ── WHY IT IS OUT HERE ──────────────────────────────────────────────────────
 * This is arithmetic on usage rows that produces a DOLLAR FIGURE SHOWN TO THE
 * CUSTOMER ("what you paid", "what the same work would have cost"). It lived
 * inline in `GET /api/ai/cost-savings`, where testing it meant mounting the
 * whole AI router. Out here it takes rows and returns numbers, so every rule
 * below is checkable with no mocks at all.
 *
 * ── WHAT IT REFUSES, AND WHY THAT IS THE POINT ──────────────────────────────
 * The inline version defaulted a missing `provider` to "openai", a missing
 * `model` to "gpt-4o", and — for a record carrying neither a cost nor token
 * counts — assumed `AVG_TOKENS_PER_CALL = 1000` and priced that. Three invented
 * inputs feeding a figure labelled as what the customer actually spent. It also
 * priced an unknown model at the premium rate, which inflated both the spend and
 * the "savings" computed against it.
 *
 * A call that cannot be priced is now COUNTED and reported (`unpricedCalls`),
 * never estimated. A total that silently covers fewer calls than were made is
 * the same lie one step quieter, which is why the count is returned rather than
 * dropped.
 *
 * Pricing comes from `services/models.ts` — the one table. There used to be a
 * second one inline here with four hardcoded blended rates, two of them keyed
 * on ids no provider serves (`gpt-4o`, `gpt-4o-mini` are OpenAI's bare names;
 * the platform calls OpenRouter) and one on the retired
 * `deepseek/deepseek-reasoner`.
 */
import { MODELS, priceFor, isKnownModel } from "./models";

/** The metadata shape `usage_records` carries for an `ai_chat` row. */
export interface AiUsageMetadata {
  provider?: string;
  model?: string;
  estimatedCost?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AiUsageRecord {
  quantity: number;
  metadata?: AiUsageMetadata | null;
}

export interface ProviderCostRow {
  provider: string;
  calls: number;
  actualCost: number;
  potentialCost: number;
  savings: number;
}

export interface CostSavingsSummary {
  /** Calls that could be PRICED. */
  totalCalls: number;
  /** Calls refused: no model, unknown model, no provider, or no evidence. */
  unpricedCalls: number;
  totalActualCost: number;
  totalPotentialCost: number;
  totalSavings: number;
  savingsPercent: number;
  byProvider: ProviderCostRow[];
}

/**
 * Blended per-million rate, `(input + output) / 2`.
 *
 * The same 1:1 assumption the old hardcoded table made, but DERIVED from the
 * canonical rates so it cannot go stale. Used only where token counts are
 * absent and a single scalar is unavoidable.
 */
function blendedRate(model: string): number {
  const r = priceFor(model);
  return (r.input + r.output) / 2;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function summariseCostSavings(records: readonly AiUsageRecord[]): CostSavingsSummary {
  // The counterfactual baseline: what the premium vision-tier model would have
  // cost. Read from the table rather than pinned at a literal.
  const baselineRate = blendedRate(MODELS.VISION);

  const byProvider: Record<string, { calls: number; actualCost: number; potentialCost: number }> = {};
  let unpricedCalls = 0;
  let totalCalls = 0;
  let totalActualCost = 0;
  let totalPotentialCost = 0;

  for (const record of records) {
    const metadata = (record.metadata ?? {}) as AiUsageMetadata;
    const quantity = Number.isFinite(record.quantity) ? record.quantity : 0;

    const model = metadata.model;
    if (!model || !isKnownModel(model)) {
      unpricedCalls += quantity;
      continue;
    }
    const provider = metadata.provider;
    if (!provider) {
      unpricedCalls += quantity;
      continue;
    }

    let actualCost: number;
    let potentialCost: number;

    if (metadata.promptTokens !== undefined && metadata.completionTokens !== undefined) {
      // The best evidence: real token counts, priced with the model's real
      // input and output rates rather than a 1:1 blend.
      const rate = priceFor(model);
      actualCost =
        (metadata.promptTokens * rate.input + metadata.completionTokens * rate.output) / 1_000_000;
      potentialCost =
        ((metadata.promptTokens + metadata.completionTokens) * baselineRate) / 1_000_000;
    } else if (metadata.estimatedCost !== undefined && metadata.estimatedCost > 0) {
      // A recorded cost with no token counts. The counterfactual can only be a
      // ratio of blended rates — said plainly so nobody mistakes it for a
      // measurement of the alternative.
      actualCost = metadata.estimatedCost;
      potentialCost = actualCost * (baselineRate / blendedRate(model));
    } else {
      unpricedCalls += quantity;
      continue;
    }

    byProvider[provider] ??= { calls: 0, actualCost: 0, potentialCost: 0 };
    byProvider[provider].calls += quantity;
    byProvider[provider].actualCost += actualCost * quantity;
    byProvider[provider].potentialCost += potentialCost * quantity;

    totalCalls += quantity;
    totalActualCost += actualCost * quantity;
    totalPotentialCost += potentialCost * quantity;
  }

  const totalSavings = totalPotentialCost - totalActualCost;

  return {
    totalCalls,
    unpricedCalls,
    totalActualCost: round4(totalActualCost),
    totalPotentialCost: round4(totalPotentialCost),
    totalSavings: round4(totalSavings),
    savingsPercent:
      totalPotentialCost > 0 ? Math.round((totalSavings / totalPotentialCost) * 1000) / 10 : 0,
    byProvider: Object.entries(byProvider).map(([provider, d]) => ({
      provider,
      calls: d.calls,
      actualCost: round4(d.actualCost),
      potentialCost: round4(d.potentialCost),
      savings: round4(d.potentialCost - d.actualCost),
    })),
  };
}
