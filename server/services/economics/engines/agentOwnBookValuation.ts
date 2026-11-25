/**
 * The agent-investor OWN-BOOK valuation engine — the registered engine for
 * the `agent_investor` vertical (Step-0 gap sheet agent_investor.md, work
 * item 5, engine half).
 *
 * WHAT IT ANSWERS. "For a property I would buy for MY OWN book: what is it
 * worth on the evidence I have, what is the most I can offer, and what do I
 * expect to make at the asking price?" Only the agent's own-book purchase is
 * decided here. A client-book deal is not the agent's own decision — the
 * agent is not the buyer, the outcome is not theirs to grade — so this engine
 * takes no client inputs and renders no client-facing opinion.
 *
 * A PURE CALCULATOR OVER PROVIDED INPUTS. Every number it reads was handed
 * to it in the scenario inputs: comparable sales the OPERATOR selected, and/or
 * an AVM value PROVIDED as an input. It never calls ATTOM, never touches the
 * residential-comps seam, never fetches anything. Where a comp or an AVM came
 * from is the operator's record to keep; what the engine guarantees is that
 * each input's origin is frozen into the scenario's assumptions, so a later
 * reader can see exactly what the estimate rested on.
 *
 * AN ESTIMATE, NOTHING MORE. The output is an ESTIMATE of value reconciled
 * from the provided inputs. The engine's vocabulary contains no stronger
 * word for it: the classification assumption pins `estimate`, and no metric,
 * label or basis in this file upgrades it to a licensed valuation product.
 *
 * THE ARITHMETIC.
 *   comp indication   the MEDIAN of the operator-selected comp sale prices
 *                     (a median, not a mean: one outlier sale must not drag
 *                     the value with it);
 *   AVM indication    the provided AVM value, taken as given;
 *   value estimate    both present → the simple average of the two
 *                     indications; one present → that indication;
 *   value range       low = the lowest figure among the comp prices and the
 *                     AVM value; high = the highest. AVM-only therefore gives
 *                     low = high = the AVM value — the engine invents no
 *                     spread it was not given;
 *   max allowable     value estimate less the operator's own target margin
 *   offer             (a percentage of value) less the rehab budget and the
 *                     closing costs the operator provided;
 *   profit            value estimate − asking price − rehab − closing: the
 *                     expected own-book profit if the operator pays the ask.
 *                     `profit` is what makes the decision gradeable by the
 *                     existing outcome loop (verticalEvidence: a decided
 *                     vertical must predict `total_cost` or `profit`).
 *
 * REFUSE, NEVER FABRICATE. With neither comps nor an AVM there is no evidence
 * to value from, so the engine refuses. A comp set whose prices were not
 * provided refuses, naming the missing price. With no asking/offer context
 * there is no purchase decision to grade, so it refuses. The target margin is
 * required for the same reason the wholesale engine requires the buyer's
 * rule: a defaulted margin would be an invented fact about THIS operator.
 *
 * NO COMMISSION LOGIC. Splits, forecasts and commission recording are separate
 * existing machinery (shared/commission, commissionService) and are not a
 * scenario decision; nothing here reads or writes them.
 *
 * Declares `agent_investor`: a decision under that pack counts only when it
 * cites a scenario from this engine (evidence rule v2).
 */

import {
  ScenarioEngineError,
  metric,
  requireCents,
  requireNumber,
  type EngineSpec,
  type ScenarioAssumption,
} from "@shared/economics/scenario";

const AGENT_OWN_BOOK_ENGINE_ID = "agent_own_book_valuation" as const;
/** Bumped when the formula or the mapping changes. */
const AGENT_OWN_BOOK_ENGINE_VERSION = "agent-own-book-valuation-1" as const;

/** The most comp prices one scenario may carry. */
const MAX_COMPS = 10;

function usd(cents: number): string {
  return `${cents < 0 ? "−" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`;
}

function median(sortedCents: readonly number[]): number {
  const mid = Math.floor(sortedCents.length / 2);
  return sortedCents.length % 2 === 1
    ? sortedCents[mid]
    : Math.round((sortedCents[mid - 1] + sortedCents[mid]) / 2);
}

export interface AgentOwnBookBreakdown {
  compPricesCents: number[];
  avmValueCents: number | null;
  valueEstimateCents: number;
  valueLowCents: number;
  valueHighCents: number;
  maxAllowableOfferCents: number;
  profitCents: number;
}

/**
 * The arithmetic alone, exported so a caller can re-derive the figures from
 * frozen inputs with the same function the engine froze them with.
 */
export function computeAgentOwnBookValuation(
  inputs: Record<string, number | string>,
): AgentOwnBookBreakdown & { normalised: Record<string, number> } {
  // ── The evidence: operator-selected comps and/or a provided AVM value ──
  const rawCount = inputs.compCount;
  const compCount =
    rawCount === undefined ? 0 : requireNumber(inputs, "compCount");
  if (!Number.isInteger(compCount) || compCount < 0 || compCount > MAX_COMPS) {
    throw new ScenarioEngineError(
      `"compCount" must be an integer between 0 and ${MAX_COMPS}`,
    );
  }

  const compPricesCents: number[] = [];
  for (let i = 1; i <= compCount; i++) {
    const key = `comp${i}SalePriceCents`;
    if (inputs[key] === undefined) {
      throw new ScenarioEngineError(
        `Comparable sale ${i} was counted in "compCount" but its sale price ("${key}") was not provided — a comp without a price is not evidence`,
      );
    }
    const price = requireCents(inputs, key);
    if (price <= 0) {
      throw new ScenarioEngineError(`"${key}" must be positive`);
    }
    compPricesCents.push(price);
  }

  let avmValueCents: number | null = null;
  if (inputs.avmValueCents !== undefined) {
    avmValueCents = requireCents(inputs, "avmValueCents");
    if (avmValueCents <= 0) {
      throw new ScenarioEngineError('"avmValueCents" must be positive');
    }
  }

  if (compPricesCents.length === 0 && avmValueCents === null) {
    throw new ScenarioEngineError(
      'No valuation evidence was provided: supply at least one operator-selected comparable sale ("compCount" + "comp{i}SalePriceCents") or an AVM value ("avmValueCents") — the engine values only from inputs it is given and never fetches its own',
    );
  }

  // ── The offer context: without an ask there is no decision to grade ──
  if (inputs.askingPriceCents === undefined) {
    throw new ScenarioEngineError(
      'No offer context was provided: "askingPriceCents" (the asking price the offer is weighed against) is required',
    );
  }
  const askingPriceCents = requireCents(inputs, "askingPriceCents");
  if (askingPriceCents <= 0) {
    throw new ScenarioEngineError('"askingPriceCents" must be positive');
  }

  const targetMarginPct = requireNumber(inputs, "targetMarginPct");
  if (targetMarginPct < 0 || targetMarginPct >= 100) {
    throw new ScenarioEngineError(
      '"targetMarginPct" must be at least 0 and below 100 (percentage points)',
    );
  }

  const rehabEstimateCents =
    inputs.rehabEstimateCents === undefined
      ? 0
      : requireCents(inputs, "rehabEstimateCents");
  if (rehabEstimateCents < 0) {
    throw new ScenarioEngineError('"rehabEstimateCents" cannot be negative');
  }
  const closingCostCents =
    inputs.closingCostCents === undefined
      ? 0
      : requireCents(inputs, "closingCostCents");
  if (closingCostCents < 0) {
    throw new ScenarioEngineError('"closingCostCents" cannot be negative');
  }

  // ── Reconcile the indications into one estimate and an honest range ──
  const sorted = [...compPricesCents].sort((a, b) => a - b);
  const indications: number[] = [];
  if (sorted.length > 0) indications.push(median(sorted));
  if (avmValueCents !== null) indications.push(avmValueCents);
  const valueEstimateCents = Math.round(
    indications.reduce((s, v) => s + v, 0) / indications.length,
  );
  const evidence = [...compPricesCents, ...(avmValueCents !== null ? [avmValueCents] : [])];
  const valueLowCents = Math.min(...evidence);
  const valueHighCents = Math.max(...evidence);

  const maxAllowableOfferCents =
    Math.round((valueEstimateCents * (100 - targetMarginPct)) / 100) -
    rehabEstimateCents -
    closingCostCents;
  const profitCents =
    valueEstimateCents - askingPriceCents - rehabEstimateCents - closingCostCents;

  const normalised: Record<string, number> = {
    compCount,
    askingPriceCents,
    targetMarginPct,
    rehabEstimateCents,
    closingCostCents,
  };
  compPricesCents.forEach((p, idx) => {
    normalised[`comp${idx + 1}SalePriceCents`] = p;
  });
  if (avmValueCents !== null) normalised.avmValueCents = avmValueCents;

  return {
    compPricesCents,
    avmValueCents,
    valueEstimateCents,
    valueLowCents,
    valueHighCents,
    maxAllowableOfferCents,
    profitCents,
    normalised,
  };
}

export const agentOwnBookValuationEngine: EngineSpec = {
  id: AGENT_OWN_BOOK_ENGINE_ID,
  version: AGENT_OWN_BOOK_ENGINE_VERSION,
  label: "Agent own-book valuation estimate (from your selected comps and/or a provided AVM value)",
  verticals: ["agent_investor"],
  produces: [
    "estimated_value",
    "estimated_value_low",
    "estimated_value_high",
    "max_allowable_offer",
    "profit",
  ],

  compute(inputs) {
    const r = computeAgentOwnBookValuation(inputs);
    const n = r.normalised;

    const assumptions: ScenarioAssumption[] = [
      {
        key: "valuation_classification",
        value: "estimate",
        origin: "derived",
        basis:
          "This output is an estimate of value reconciled only from the inputs recorded in this scenario. It is not a licensed valuation product and carries no credential behind it.",
      },
    ];
    r.compPricesCents.forEach((price, idx) => {
      assumptions.push({
        key: `comp_${idx + 1}_sale_price`,
        value: price,
        unit: "cents",
        origin: "user",
        basis: `Comparable sale ${idx + 1}: ${usd(price)} — selected and provided by the operator as an input; this engine does not fetch comparable sales.`,
      });
    });
    if (r.avmValueCents !== null) {
      assumptions.push({
        key: "avm_value",
        value: r.avmValueCents,
        unit: "cents",
        origin: "user",
        basis: `AVM value ${usd(r.avmValueCents)} — provided by the operator as an input; this engine does not call any valuation provider.`,
      });
    }
    assumptions.push(
      {
        key: "value_estimate",
        value: r.valueEstimateCents,
        unit: "cents",
        origin: "derived",
        basis:
          r.compPricesCents.length > 0 && r.avmValueCents !== null
            ? `Estimate ${usd(r.valueEstimateCents)}: the simple average of the comp median and the provided AVM value. Range ${usd(r.valueLowCents)}–${usd(r.valueHighCents)} spans every figure provided.`
            : r.compPricesCents.length > 0
              ? `Estimate ${usd(r.valueEstimateCents)}: the median of the ${r.compPricesCents.length} operator-selected comp sale prices. Range ${usd(r.valueLowCents)}–${usd(r.valueHighCents)} is the lowest to the highest comp price.`
              : `Estimate ${usd(r.valueEstimateCents)}: the provided AVM value, taken as given. No range is stated because no other figure was provided.`,
      },
      {
        key: "asking_price",
        value: n.askingPriceCents,
        unit: "cents",
        origin: "user",
        basis: `Asking price ${usd(n.askingPriceCents)} — the offer context the operator provided.`,
      },
      {
        key: "target_margin",
        value: n.targetMarginPct,
        unit: "percent",
        origin: "user",
        basis: `The operator's own target margin of ${n.targetMarginPct}% of the estimated value, required before an offer is allowable. No platform margin was substituted.`,
      },
    );
    if (inputs.rehabEstimateCents !== undefined) {
      assumptions.push({
        key: "rehab_estimate",
        value: n.rehabEstimateCents,
        unit: "cents",
        origin: "user",
        basis: `Rehab budget ${usd(n.rehabEstimateCents)} \u2014 provided by the operator as an input and deducted from the allowable offer and the expected profit.`,
      });
    }
    if (n.rehabEstimateCents === 0 && inputs.rehabEstimateCents === undefined) {
      assumptions.push({
        key: "rehab_estimate",
        value: 0,
        unit: "cents",
        origin: "user",
        basis: "No rehab budget was provided, so none is deducted. This records an absence, not an estimate that the property needs no work.",
      });
    }
    if (inputs.closingCostCents !== undefined) {
      assumptions.push({
        key: "closing_costs",
        value: n.closingCostCents,
        unit: "cents",
        origin: "user",
        basis: `Closing costs ${usd(n.closingCostCents)} \u2014 provided by the operator as an input and deducted from the allowable offer and the expected profit.`,
      });
    }
    if (n.closingCostCents === 0 && inputs.closingCostCents === undefined) {
      assumptions.push({
        key: "closing_costs",
        value: 0,
        unit: "cents",
        origin: "user",
        basis: "No closing costs were provided, so none are deducted. This records an absence, not an estimate that closing is free.",
      });
    }

    return {
      normalisedInputs: r.normalised,
      assumptions,
      metrics: [
        metric("estimated_value", r.valueEstimateCents),
        metric("estimated_value_low", r.valueLowCents),
        metric("estimated_value_high", r.valueHighCents),
        metric("max_allowable_offer", r.maxAllowableOfferCents),
        // Expected own-book profit at the asking price — the figure an
        // outcome grades this decision against.
        metric("profit", r.profitCents),
      ],
    };
  },
};
