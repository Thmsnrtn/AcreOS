/**
 * Tax-lot triage against the ignorance map — V-Tax-1 T1. Pure.
 *
 * For one lot: what is KNOWN (with where it came from), what is UNKNOWN, and
 * what resolving each unknown costs — ordered so diligence goes first where
 * it can change the bid decision most for the least cost.
 *
 *   - Unknown is never clean. "Searched, none found" and "never searched" are
 *     different states, and neither is a value. Missing is null, never 0.
 *   - Cost is a KIND, not a dollar figure: free inside AcreOS, the operator's
 *     own time, or a paid search outside AcreOS. AcreOS does not know what a
 *     title search costs in a given county, so it does not say.
 *   - The order is a SCREEN, stated as one: each fact carries a decision
 *     weight (how much it can move the bid decision, 1–5) and the order is
 *     weight ÷ cost rank, ties broken by weight. Both numbers are shown, so
 *     the order can be checked, not trusted.
 */

export type ResolveCost = "free_in_acreos" | "your_time" | "paid_outside";

export const RESOLVE_COST_RANK: Record<ResolveCost, number> = { free_in_acreos: 1, your_time: 2, paid_outside: 3 };
export const RESOLVE_COST_LABEL: Record<ResolveCost, string> = {
  free_in_acreos: "free in AcreOS",
  your_time: "your time",
  paid_outside: "a paid search outside AcreOS",
};

export type TriageFactKey = "parcelMatch" | "marketValue" | "amountOwed" | "redemptionPeriod" | "seniorLiens" | "occupancy" | "access";

/** How much each fact can move the bid decision (1–5). Stated, not measured. */
export const DECISION_WEIGHT: Record<TriageFactKey, number> = {
  seniorLiens: 5, // a senior lien can wipe out the position
  marketValue: 5, // the ceiling on what the lot is worth
  redemptionPeriod: 4, // how long capital is locked, and whether the deed can be held
  amountOwed: 4, // the floor of the bid
  parcelMatch: 3, // gates the public-record value and the APID
  access: 3, // landlocked or unbuildable lots are discards
  occupancy: 2, // affects possession, not the price floor
};

export const TRIAGE_ORDER_BASIS =
  "Ordered by how much each fact can change the bid decision (weight 1–5) against what resolving it costs (free in AcreOS, your time, a paid outside search). A screen to direct diligence, not a measurement.";

export type FactState =
  | { status: "known"; value: string; source: string }
  | { status: "searched_none"; reason: string; source: string }
  | { status: "unknown"; reason: string };

export interface TriageFact {
  key: TriageFactKey;
  label: string;
  state: FactState;
  /** How to resolve it; null when known. */
  resolve: null | { how: string; cost: ResolveCost };
  weight: number;
}

export interface LotTriageInput {
  /** The lot's parcel match: matched (with any public-record value), searched-none, or not searched. */
  parcel: { status: "matched"; marketValueCents: number | null; valueSource: string | null } | { status: "searched_none"; reason: string } | { status: "not_searched"; reason: string };
  /** The market value the list states, if any. */
  listMarketValueCents: number | null;
  /** The amount owed the list states, if any. */
  amountOwedCents: number | null;
  /** The county watch's stated redemption period, if any. */
  redemptionPeriod: { months: number; source: string } | null;
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function triageLot(i: LotTriageInput): { facts: TriageFact[]; unknownsInOrder: TriageFactKey[] } {
  const facts: TriageFact[] = [];
  const add = (key: TriageFactKey, label: string, state: FactState, resolve: TriageFact["resolve"]) =>
    facts.push({ key, label, state, resolve: state.status === "known" ? null : resolve, weight: DECISION_WEIGHT[key] });

  add(
    "parcelMatch",
    "Public-record parcel",
    i.parcel.status === "matched"
      ? { status: "known", value: "matched by county parcel id", source: "AcreOS public-record parcels" }
      : i.parcel.status === "searched_none"
        ? { status: "searched_none", reason: i.parcel.reason, source: "AcreOS public-record parcels" }
        : { status: "unknown", reason: i.parcel.reason },
    { how: "check the parcel id against the county's records and correct it on a re-import", cost: "your_time" },
  );

  const recordValue = i.parcel.status === "matched" ? i.parcel.marketValueCents : null;
  add(
    "marketValue",
    "Market value",
    i.listMarketValueCents !== null
      ? { status: "known", value: usd(i.listMarketValueCents), source: "the tax list" }
      : recordValue !== null
        ? { status: "known", value: usd(recordValue), source: i.parcel.status === "matched" && i.parcel.valueSource ? i.parcel.valueSource : "public record" }
        : { status: "unknown", reason: i.parcel.status === "matched" ? "the matched parcel carries no market value" : "neither the list nor a matched parcel states one" },
    i.parcel.status === "matched"
      ? { how: "get a valuation (comparable sales or an appraisal)", cost: "paid_outside" }
      : { how: "correct the parcel id so it matches a public-record parcel (its value then reads for free), or get a valuation", cost: "your_time" },
  );

  add(
    "amountOwed",
    "Amount owed",
    i.amountOwedCents !== null ? { status: "known", value: usd(i.amountOwedCents), source: "the tax list" } : { status: "unknown", reason: "the list does not state it" },
    { how: "ask the county tax office for the amount due", cost: "your_time" },
  );

  add(
    "redemptionPeriod",
    "Redemption period",
    i.redemptionPeriod ? { status: "known", value: `${i.redemptionPeriod.months} months`, source: i.redemptionPeriod.source } : { status: "unknown", reason: "not stated on this county's watch" },
    { how: "state it on the county watch from the county's sale notice or statute", cost: "your_time" },
  );

  add("seniorLiens", "Senior liens", { status: "unknown", reason: "no lien search has been performed" }, { how: "order a title or lien search", cost: "paid_outside" });
  add("occupancy", "Occupancy", { status: "unknown", reason: "not checked" }, { how: "a drive-by or the county's homestead records", cost: "your_time" });
  add("access", "Legal access / buildability", { status: "unknown", reason: "not checked" }, { how: "check road frontage and easements on the county map", cost: "your_time" });

  const unknownsInOrder = facts
    .filter((f) => f.state.status !== "known")
    .sort((a, b) => b.weight / RESOLVE_COST_RANK[b.resolve!.cost] - a.weight / RESOLVE_COST_RANK[a.resolve!.cost] || b.weight - a.weight)
    .map((f) => f.key);
  return { facts, unknownsInOrder };
}
