/**
 * Bid discipline — V-Tax-1 T3. Pure.
 *
 * The max bid is DERIVED from the rights stack the operator records, never
 * typed as a bare number:
 *
 *     max bid = what the lot is worth
 *             − what stands ahead of the buyer (liens the operator's own
 *               title or lien search says survive the sale)
 *             − other taxes the buyer would have to pay
 *             − costs to clear and hold (quiet title, closing, holding)
 *             − the operator's required return
 *
 *   - Every line carries its source and as-of date. "Searched, none found" is
 *     a stated line with a source; "not searched" is missing, never 0. A stack
 *     with a missing line derives nothing and says which lines are missing.
 *   - The derivation is a SCREEN, labelled as one: arithmetic on the
 *     operator's inputs, not an appraisal. The recorded line items are the
 *     decision record (`MaxBidRecord`), so a max bid can always be traced to
 *     the lines that produced it.
 *   - AcreOS does not decide which liens survive a tax sale. That is a legal
 *     reading of the operator's title work, so the line is named for what the
 *     operator recorded ("liens your search says survive"), never "senior
 *     liens" as a determination.
 */

export type StackLineKey = "value" | "survivingLiens" | "otherTaxes";

/** One stated amount: known with its source, searched with none found, or not known. */
export type StackAmount =
  | { status: "known"; amountCents: number; source: string; asOf: string }
  | { status: "searched_none"; source: string; asOf: string }
  | { status: "unknown" };

export interface StackCost {
  label: string;
  amountCents: number;
  source: string;
}

export type RequiredReturn =
  | { kind: "cents"; amountCents: number }
  | { kind: "pct_of_value"; bps: number };

export interface RightsStackInput {
  /** What the lot is worth. Searched-none is not a value, so it derives nothing. */
  value: StackAmount;
  /** Liens the operator's own title or lien search says survive the sale. */
  survivingLiens: StackAmount;
  /** Other taxes the buyer would have to pay (other years, other jurisdictions). */
  otherTaxes: StackAmount;
  /** Costs to clear title and hold. `null` = not stated; `[]` = stated as none. */
  costs: StackCost[] | null;
  /** The operator's own required return. `null` = not stated. */
  requiredReturn: RequiredReturn | null;
}

export const STACK_LINE_LABEL: Record<StackLineKey | "costs" | "requiredReturn", string> = {
  value: "What the lot is worth",
  survivingLiens: "Liens your search says survive the sale",
  otherTaxes: "Other taxes you would have to pay",
  costs: "Costs to clear title and hold",
  requiredReturn: "Your required return",
};

export const MAX_BID_SCREEN_LABEL =
  "A screen: your stated value minus what you recorded ahead of you, your costs and your required return. Arithmetic on your inputs, not an appraisal; AcreOS does not decide which liens survive a sale.";

export interface StackLineOut {
  key: StackLineKey | "costs" | "requiredReturn";
  label: string;
  /** +1 adds to the max (value only); −1 subtracts. */
  sign: 1 | -1;
  amountCents: number;
  basis: string;
}

export type MaxBidScreen =
  | {
      status: "derived";
      maxBidCents: number;
      /** True when the stack leaves nothing: any bid misses the required return. */
      leavesNothing: boolean;
      lines: StackLineOut[];
      label: string;
    }
  | {
      status: "refused";
      missing: Array<{ key: StackLineKey | "costs" | "requiredReturn"; label: string; why: string }>;
      label: string;
    };

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function amountLine(key: StackLineKey, a: StackAmount, sign: 1 | -1): StackLineOut | null {
  if (a.status === "unknown") return null;
  if (a.status === "searched_none") {
    return { key, label: STACK_LINE_LABEL[key], sign, amountCents: 0, basis: `searched, none found — ${a.source}, as of ${a.asOf}` };
  }
  return { key, label: STACK_LINE_LABEL[key], sign, amountCents: a.amountCents, basis: `${a.source}, as of ${a.asOf}` };
}

/** The screen. Refuses, naming each missing line, rather than treat a missing line as zero. */
export function deriveMaxBid(input: RightsStackInput): MaxBidScreen {
  const missing: Extract<MaxBidScreen, { status: "refused" }>["missing"] = [];
  if (input.value.status !== "known") {
    missing.push({
      key: "value",
      label: STACK_LINE_LABEL.value,
      why: input.value.status === "searched_none" ? "a search that found no value is not a value" : "not stated",
    });
  }
  if (input.survivingLiens.status === "unknown") {
    missing.push({ key: "survivingLiens", label: STACK_LINE_LABEL.survivingLiens, why: "no title or lien search recorded — not searched is not none" });
  }
  if (input.otherTaxes.status === "unknown") {
    missing.push({ key: "otherTaxes", label: STACK_LINE_LABEL.otherTaxes, why: "not stated — check the county for other open years" });
  }
  if (input.costs === null) missing.push({ key: "costs", label: STACK_LINE_LABEL.costs, why: "not stated — state none if there are none" });
  if (input.requiredReturn === null) missing.push({ key: "requiredReturn", label: STACK_LINE_LABEL.requiredReturn, why: "not stated — only you can set it" });
  if (missing.length > 0 || input.value.status !== "known" || input.costs === null || input.requiredReturn === null) {
    return { status: "refused", missing, label: MAX_BID_SCREEN_LABEL };
  }

  const lines: StackLineOut[] = [amountLine("value", input.value, 1)!];
  const liens = amountLine("survivingLiens", input.survivingLiens, -1);
  const taxes = amountLine("otherTaxes", input.otherTaxes, -1);
  if (liens) lines.push(liens);
  if (taxes) lines.push(taxes);
  const costCents = input.costs.reduce((s, c) => s + c.amountCents, 0);
  lines.push({
    key: "costs",
    label: STACK_LINE_LABEL.costs,
    sign: -1,
    amountCents: costCents,
    basis: input.costs.length === 0 ? "stated as none" : input.costs.map((c) => `${c.label} ${usd(c.amountCents)} (${c.source})`).join("; "),
  });
  const rr = input.requiredReturn;
  const returnCents = rr.kind === "cents" ? rr.amountCents : Math.round((input.value.amountCents * rr.bps) / 10_000);
  lines.push({
    key: "requiredReturn",
    label: STACK_LINE_LABEL.requiredReturn,
    sign: -1,
    amountCents: returnCents,
    basis: rr.kind === "cents" ? "your stated dollar return" : `your stated ${(rr.bps / 100).toFixed(2)}% of the stated value`,
  });

  const net = lines.reduce((s, l) => s + l.sign * l.amountCents, 0);
  return { status: "derived", maxBidCents: Math.max(0, net), leavesNothing: net <= 0, lines, label: MAX_BID_SCREEN_LABEL };
}

/** The decision record stored on the listing: the inputs, what they derived, and who recorded it. */
export interface MaxBidRecord {
  input: RightsStackInput;
  maxBidCents: number;
  leavesNothing: boolean;
  lines: StackLineOut[];
  recordedAt: string;
  recordedByUserId: string | null;
}

/**
 * How a bid amount stands against the listing's max. `no_max` is its own
 * state: with no max there is nothing to flag, and the UI says so rather
 * than implying the bid is within bounds.
 */
export type BidAgainstMax =
  | { status: "no_max" }
  | { status: "within"; maxBidCents: number; derived: boolean }
  | { status: "over"; maxBidCents: number; overByCents: number; derived: boolean };

export function bidAgainstMax(amountCents: number, maxBidCents: number | null, basis: MaxBidRecord | null): BidAgainstMax {
  if (maxBidCents == null) return { status: "no_max" };
  const derived = basis !== null && basis.maxBidCents === maxBidCents;
  if (amountCents > maxBidCents) return { status: "over", maxBidCents, overByCents: amountCents - maxBidCents, derived };
  return { status: "within", maxBidCents, derived };
}

// ── Discards ("lots, ditches and few gems") ───────────────────────────────

/** Why a lot is discarded before bidding. Recorded, so the discard can be checked. */
export const DISCARD_REASONS = ["unbuildable", "landlocked", "contaminated", "other"] as const;
export type DiscardReason = (typeof DISCARD_REASONS)[number];

export const DISCARD_REASON_LABEL: Record<DiscardReason, string> = {
  unbuildable: "Unbuildable",
  landlocked: "Landlocked (no legal access)",
  contaminated: "Contaminated",
  other: "Other",
};

export interface DiscardRecord {
  reason: DiscardReason;
  note: string | null;
  discardedAt: string;
  discardedByUserId: string | null;
  /** The listing status before the discard, restored on reopen. */
  priorStatus: string;
  /** Set when the operator reopens the lot; the discard stays on record. */
  reopened: null | { at: string; byUserId: string | null; note: string | null };
}

export function isDiscarded(d: DiscardRecord | null | undefined): d is DiscardRecord {
  return !!d && d.reopened === null;
}
