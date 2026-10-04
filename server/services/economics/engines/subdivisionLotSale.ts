/**
 * The subdivision lot-sale engine: the registered adapter over
 * shared/calculators/subdivisionLotSale.ts.
 *
 * The adapter's job is the boundary. It reads each locked lot price from its
 * own `lotPriceCents_<childParcelId>` key, validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently. An omitted survey, plat, permit,
 * improvement or carry figure is excluded from total cost, and it must appear
 * as an assumption with its origin, never as a measured $0. An omitted parent
 * cost basis leaves total cost, profit and ROI uncomputed (null), and that is
 * declared too, because without them the decision cannot be graded.
 *
 * It declares the `subdivider` vertical: the lot-pricing lock records its
 * decision under that pack, citing a scenario from this engine (evidence rule
 * v2).
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
  SUBDIVISION_LOT_SALE_ENGINE_ID,
  SUBDIVISION_LOT_SALE_ENGINE_VERSION,
  SubdivisionLotSaleInputError,
  computeSubdivisionLotSale,
  lotIdOfInputKey,
  lotPriceInputKey,
} from "@shared/calculators/subdivisionLotSale";

/** Optional cost lines: wire key, assumption key, and the plain name of the cost. */
const OPTIONAL_COSTS = [
  { key: "surveyCents", assumption: "survey_cost", what: "survey" },
  { key: "platCents", assumption: "plat_cost", what: "plat (engineering and recording)" },
  { key: "permitsCents", assumption: "permit_cost", what: "permit and approval fee" },
  { key: "improvementsCents", assumption: "improvement_cost", what: "improvement (roads, utilities, clearing)" },
] as const;

export const subdivisionLotSaleEngine: EngineSpec = {
  id: SUBDIVISION_LOT_SALE_ENGINE_ID,
  version: SUBDIVISION_LOT_SALE_ENGINE_VERSION,
  label: "Subdivision lot sale (locked grid sell-out, cost, profit)",
  verticals: ["subdivider"],
  produces: ["gross_sellout", "net_proceeds", "total_cost", "profit", "roi", "hold_months"],

  compute(inputs) {
    // Every lot key, in child-parcel order, so the frozen inputs read the same
    // however the caller ordered them.
    const lotIds: number[] = [];
    for (const key of Object.keys(inputs)) {
      const id = lotIdOfInputKey(key);
      if (id === null) continue;
      // One lot, one key: "lotPriceCents_07" would parse to lot 7 and count
      // lot 7 twice next to "lotPriceCents_7" (V2 audit). Only the canonical
      // spelling is accepted, so the frozen inputs reproduce the metrics.
      if (key !== lotPriceInputKey(id)) {
        throw new ScenarioEngineError(`Scenario input "${key}" is not a canonical lot key (expected "${lotPriceInputKey(id)}")`);
      }
      lotIds.push(id);
    }
    lotIds.sort((a, b) => a - b);
    const lotPricesCents = lotIds.map((id) => requireCents(inputs, lotPriceInputKey(id)));

    const normalised = {
      sellingCostPct: requireNumber(inputs, "sellingCostPct"),
      monthsToSellOut: requireNumber(inputs, "monthsToSellOut"),
      parentBasisCents: optionalCents(inputs, "parentBasisCents"),
      surveyCents: optionalCents(inputs, "surveyCents"),
      platCents: optionalCents(inputs, "platCents"),
      permitsCents: optionalCents(inputs, "permitsCents"),
      improvementsCents: optionalCents(inputs, "improvementsCents"),
      monthlyCarryCents: optionalCents(inputs, "monthlyCarryCents"),
    };

    let out;
    try {
      out = computeSubdivisionLotSale({ lotPricesCents, ...normalised });
    } catch (err) {
      if (err instanceof SubdivisionLotSaleInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    if (normalised.parentBasisCents === null) {
      assumptions.push({
        key: "parent_basis",
        value: "not entered — total cost and profit not computed",
        origin: "platform-default",
        basis:
          "No cost basis for the parent parcel was entered or recorded, so total cost, profit and ROI " +
          "are left uncomputed rather than shown without the land. Without them this decision's outcome cannot be graded.",
      });
    }
    for (const c of OPTIONAL_COSTS) {
      if (normalised[c.key] === null) {
        assumptions.push({
          key: c.assumption,
          value: "not entered — excluded",
          origin: "platform-default",
          basis: `No ${c.what} cost was entered, so total cost leaves it out. Enter your figure before relying on profit.`,
        });
      }
    }
    if (normalised.monthlyCarryCents === null) {
      assumptions.push({
        key: "carry",
        value: "not entered — excluded",
        origin: "platform-default",
        basis:
          `No monthly carrying cost was entered, so total cost counts no taxes, insurance or interest ` +
          `over the ${out.holdMonths}-month sell-out.`,
      });
    }

    const wire: Record<string, number> = {};
    lotIds.forEach((id, n) => {
      wire[lotPriceInputKey(id)] = lotPricesCents[n];
    });
    for (const [k, v] of Object.entries(normalised)) if (v !== null) wire[k] = v;

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("gross_sellout", out.grossSelloutCents),
        metric("net_proceeds", out.netProceedsCents),
        metric("total_cost", out.totalCostCents),
        metric("profit", out.profitCents),
        metric("roi", out.roi),
        metric("hold_months", out.holdMonths),
      ],
    };
  },
};
