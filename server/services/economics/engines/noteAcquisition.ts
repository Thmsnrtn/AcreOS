/**
 * The note acquisition engine: the registered adapter over
 * shared/calculators/noteAcquisition.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently:
 *   - an omitted closing cost is excluded from total cost (platform default);
 *   - an omitted payment is replaced by the derived level payment (derived);
 *   - an omitted balloon month means the note runs to the end of its term
 *     (platform default);
 * and, when the operator's own payment does not fit the term, the consequence
 * the schedule found (paid off early, or a balance left at maturity), so a
 * yield built on an inconsistent payment cannot read as a clean one.
 *
 * It declares the `note_investor` vertical: a decision under that pack counts
 * only when it cites a scenario from this engine (evidence rule v2). It does
 * NOT touch the regulated payoff arithmetic (notePayoff.ts /
 * notePaymentMath.ts): this is a purchase decision, not a servicing quote.
 */
import {
  ScenarioEngineError,
  metric,
  optionalCents,
  requireCents,
  requireNumber,
  type EngineSpec,
  type ScenarioAssumption,
} from "@shared/economics/scenario";
import {
  NOTE_ACQUISITION_ENGINE_ID,
  NOTE_ACQUISITION_ENGINE_VERSION,
  NoteAcquisitionInputError,
  computeNoteAcquisition,
} from "@shared/calculators/noteAcquisition";

function optionalNumber(inputs: Record<string, number | string>, key: string): number | null {
  return inputs[key] === undefined ? null : requireNumber(inputs, key);
}

function usd(cents: number): string {
  // Deterministic, no locale lookup: this text is persisted in the scenario's
  // assumptions, and a locale-dependent string would make the frozen record
  // depend on the machine that computed it.
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * A last collection more than this far from the regular payment is worth
 * saying out loud. A derived level payment's rounding residue is a few cents
 * (a few dollars on a long note); a payment that does not fit the term leaves
 * far more.
 */
const MATURITY_RESIDUE_NOTICE_CENTS = 100;

export const noteAcquisitionEngine: EngineSpec = {
  id: NOTE_ACQUISITION_ENGINE_ID,
  version: NOTE_ACQUISITION_ENGINE_VERSION,
  label: "Note acquisition (yield if it pays as agreed, discount to face)",
  verticals: ["note_investor"],
  produces: ["total_cost", "acquisition_cost", "discount_to_face", "irr", "profit", "hold_months", "payoff_total"],

  compute(inputs) {
    const normalised = {
      unpaidPrincipalCents: requireCents(inputs, "unpaidPrincipalCents"),
      noteRatePct: requireNumber(inputs, "noteRatePct"),
      remainingTermMonths: requireNumber(inputs, "remainingTermMonths"),
      monthlyPaymentCents: optionalCents(inputs, "monthlyPaymentCents"),
      purchasePriceCents: requireCents(inputs, "purchasePriceCents"),
      closingCostsCents: optionalCents(inputs, "closingCostsCents"),
      balloonMonth: optionalNumber(inputs, "balloonMonth"),
    };

    let out;
    try {
      out = computeNoteAcquisition(normalised);
    } catch (err) {
      if (err instanceof NoteAcquisitionInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    if (normalised.closingCostsCents === null) {
      assumptions.push({
        key: "closing_costs",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No closing or due-diligence cost was entered, so total cost, profit and yield leave it out. Enter title, BPO, collateral review and servicing set-up costs before relying on them",
      });
    }
    if (out.paymentDerived) {
      assumptions.push({
        key: "monthly_payment",
        value: `${usd(out.paymentCents)} a month`,
        origin: "derived",
        basis: "No monthly payment was entered, so the level payment that pays off this balance at the note rate over the remaining term is used. Enter the payment on the note if it differs",
      });
    }
    if (normalised.balloonMonth === null) {
      assumptions.push({
        key: "balloon",
        value: "none — runs to the end of the term",
        origin: "platform-default",
        basis: "No balloon month was entered, so the note is modelled as paying until the end of its remaining term. Enter the balloon month if the note has one",
      });
    }
    // Consequences of the operator's OWN payment not fitting the term. A
    // derived payment fits by construction, so these only fire for an entered one.
    if (!out.paymentDerived && out.paidOffEarly) {
      assumptions.push({
        key: "early_payoff",
        value: `paid off in month ${out.lastMonth}`,
        origin: "derived",
        basis: `At ${usd(out.paymentCents)} a month the balance is paid off before month ${normalised.balloonMonth ?? normalised.remainingTermMonths}, so collections stop there. Check the payment and remaining term`,
      });
    }
    if (
      !out.paymentDerived &&
      !out.paidOffEarly &&
      normalised.balloonMonth === null &&
      out.finalCollectionCents - out.paymentCents > MATURITY_RESIDUE_NOTICE_CENTS
    ) {
      assumptions.push({
        key: "maturity_balance",
        value: `${usd(out.finalCollectionCents)} in month ${out.lastMonth}`,
        origin: "derived",
        basis: `At ${usd(out.paymentCents)} a month the balance is not paid off by the end of the term, so the rest is collected with the last payment. Check the payment and remaining term`,
      });
    }

    const wire: Record<string, number> = {};
    for (const [k, v] of Object.entries(normalised)) if (v !== null) wire[k] = v;

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("total_cost", out.totalCostCents),
        // What it costs to TAKE IT DOWN (price + closing/due diligence) — what Today asks at "Acquired".
        metric("acquisition_cost", normalised.purchasePriceCents + (normalised.closingCostsCents ?? 0)),
        metric("discount_to_face", out.discountToFace),
        metric("irr", out.irr),
        metric("profit", out.profitCents),
        metric("hold_months", out.lastMonth),
        metric("payoff_total", out.balloonPayoffCents),
      ],
    };
  },
};
