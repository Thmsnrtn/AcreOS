/**
 * The customer outcome metric (W5b): deals an org has CLOSED and the profit
 * those closings REALISED — from closed-deal records only, with a label that
 * says exactly what is counted, and a refusal instead of a number when the
 * cost basis is missing.
 *
 * WHAT COUNTS
 *   Deals closed — deals whose status is a closed status
 *     (CLOSED_DEAL_STATUSES), not soft-deleted, split by side.
 *   Realised profit — per property with a CLOSED DISPOSITION (a sale):
 *     sale price  = the disposition deal's accepted amount, else the
 *                   property's recorded sold price;
 *     cost basis  = the closed acquisition deal's accepted amount on the same
 *                   property, else the property's recorded purchase price;
 *     less the closing costs recorded on those two deals (missing = none
 *     recorded, and the label says how many deals had them).
 *   EXCLUDED and named: an owner-financed sale (a note exists on the
 *   property) — its profit arrives over the life of the note, so none of it is
 *   "realised" at closing; and a sale with no recorded sale price.
 *
 * REFUSAL. If ANY counted sale has no cost basis, no profit figure is shown
 * at all — a total over the sales that happen to have one would read as the
 * whole — and the refusal names how many sales need a purchase price.
 *
 * Nothing here estimates, defaults, or fills a gap. Pure; browser-safe.
 */

export interface OutcomeDealRecord {
  id: number;
  type: string; // "acquisition" | "disposition"
  propertyId: number;
  acceptedAmount: string | number | null;
  closingCosts: string | number | null;
  closingDate: Date | string | null;
}

export interface OutcomePropertyRecord {
  id: number;
  purchasePrice: string | number | null;
  soldPrice: string | number | null;
}

export interface CustomerOutcomeInput {
  closedDeals: OutcomeDealRecord[];
  properties: OutcomePropertyRecord[];
  /** Properties carrying a seller-financed note (owner-financed sales). */
  ownerFinancedPropertyIds: ReadonlySet<number> | number[];
}

export interface CustomerOutcome {
  dealsClosed: { total: number; acquisitions: number; dispositions: number; other: number };
  realisedProfit:
    | { status: "shown"; cents: number; salesCounted: number }
    | { status: "refused"; reason: string; salesMissingCostBasis: number; propertyIds: number[] }
    | { status: "no_sales"; reason: string };
  excluded: { ownerFinancedSales: number; salesMissingSalePrice: number };
  closingCostsRecordedOn: number;
  /** The label every surface shows with the numbers. */
  included: string;
}

/** Money as exact cents, or null when it is not recorded (never 0 for missing). */
function centsOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

const CUSTOMER_OUTCOME_LABEL =
  "Counted from your closed deals only. Realised profit = each closed sale's price minus that parcel's purchase price " +
  "and the closing costs recorded on its buy and sell deals. Owner-financed sales are left out (their profit arrives with the note payments).";

export function computeCustomerOutcome(input: CustomerOutcomeInput): CustomerOutcome {
  const ownerFinanced = input.ownerFinancedPropertyIds instanceof Set
    ? input.ownerFinancedPropertyIds
    : new Set(input.ownerFinancedPropertyIds as number[]);
  const props = new Map(input.properties.map((p) => [p.id, p]));
  const acquisitions = input.closedDeals.filter((d) => d.type === "acquisition");
  const dispositions = input.closedDeals.filter((d) => d.type === "disposition");
  const acqByProperty = new Map<number, OutcomeDealRecord>();
  for (const a of acquisitions) if (!acqByProperty.has(a.propertyId)) acqByProperty.set(a.propertyId, a);

  let profitCents = 0;
  let salesCounted = 0;
  let ownerFinancedSales = 0;
  let salesMissingSalePrice = 0;
  let closingCostsRecordedOn = 0;
  const missingBasis: number[] = [];

  for (const sale of dispositions) {
    if (ownerFinanced.has(sale.propertyId)) {
      ownerFinancedSales++;
      continue;
    }
    const prop = props.get(sale.propertyId);
    const salePrice = centsOrNull(sale.acceptedAmount) ?? centsOrNull(prop?.soldPrice);
    if (salePrice === null) {
      salesMissingSalePrice++;
      continue;
    }
    const buy = acqByProperty.get(sale.propertyId);
    const basis = centsOrNull(buy?.acceptedAmount) ?? centsOrNull(prop?.purchasePrice);
    if (basis === null) {
      missingBasis.push(sale.propertyId);
      continue;
    }
    let costs = 0;
    for (const d of [buy, sale]) {
      const c = centsOrNull(d?.closingCosts);
      if (c !== null) {
        costs += c;
        closingCostsRecordedOn++;
      }
    }
    profitCents += salePrice - basis - costs;
    salesCounted++;
  }

  const dealsClosed = {
    total: input.closedDeals.length,
    acquisitions: acquisitions.length,
    dispositions: dispositions.length,
    other: input.closedDeals.length - acquisitions.length - dispositions.length,
  };
  const excluded = { ownerFinancedSales, salesMissingSalePrice };

  let realisedProfit: CustomerOutcome["realisedProfit"];
  if (missingBasis.length > 0) {
    realisedProfit = {
      status: "refused",
      reason: `${missingBasis.length} closed sale${missingBasis.length === 1 ? " has" : "s have"} no purchase price on record, so realised profit isn't shown. Add what you paid for ${missingBasis.length === 1 ? "that parcel" : "those parcels"}.`,
      salesMissingCostBasis: missingBasis.length,
      propertyIds: missingBasis.slice(0, 50),
    };
  } else if (salesCounted === 0) {
    realisedProfit = {
      status: "no_sales",
      reason: dispositions.length === 0 ? "No closed sales yet — profit is realised when you sell." : "No closed sale can be counted yet (see what was left out).",
    };
  } else {
    realisedProfit = { status: "shown", cents: profitCents, salesCounted };
  }

  return { dealsClosed, realisedProfit, excluded, closingCostsRecordedOn, included: CUSTOMER_OUTCOME_LABEL };
}

export interface PlatformOutcomeAggregate {
  orgsWithAClosedDeal: number;
  dealsClosed: number;
  salesCounted: number;
  /** Sum over orgs whose profit is shown; orgs refused for a missing basis are NOT in it. */
  realisedProfitCents: number;
  orgsProfitShown: number;
  orgsProfitRefused: number;
  label: string;
}

/** The founder Letter's view: totals across orgs, no org identifiers. */
export function aggregateCustomerOutcomes(perOrg: CustomerOutcome[]): PlatformOutcomeAggregate {
  const withClose = perOrg.filter((o) => o.dealsClosed.total > 0);
  let profit = 0;
  let shown = 0;
  let refused = 0;
  let sales = 0;
  for (const o of withClose) {
    if (o.realisedProfit.status === "shown") {
      profit += o.realisedProfit.cents;
      sales += o.realisedProfit.salesCounted;
      shown++;
    } else if (o.realisedProfit.status === "refused") refused++;
  }
  return {
    orgsWithAClosedDeal: withClose.length,
    dealsClosed: withClose.reduce((s, o) => s + o.dealsClosed.total, 0),
    salesCounted: sales,
    realisedProfitCents: profit,
    orgsProfitShown: shown,
    orgsProfitRefused: refused,
    label:
      "Customers' closed-deal records only, summed across organizations (no organization is named). Realised profit sums only " +
      "organizations whose every counted sale has a purchase price on record; the others are counted as refused, not as zero.",
  };
}
