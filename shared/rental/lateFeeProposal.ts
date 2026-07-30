/**
 * Late-fee PROPOSAL — compute what a state's rule would allow, and stop there.
 *
 * The 50-state `late_fee_rules` table (statutory caps, grace days, citations)
 * has been seeded since BH-1 and nothing ever proposed a fee from it. The only
 * consumer was `POST /api/rent-charges/:id/apply-late-fee`, which an operator
 * had to know to call, per charge, from a page that never surfaced the amount.
 *
 * A proposal is not a charge. This module computes a number and an
 * explanation; posting it onto a tenant's ledger is a separate, explicit
 * operator confirmation (`confirmFeeCents` must echo the proposed figure, so
 * an operator can never confirm an amount they were never shown).
 *
 * Cap discipline
 * ──────────────
 *   - The percentage cap is floored, not rounded: a cap of 10% of $1,400.05
 *     yields 14000, never 14001. One cent over a statutory cap is still over.
 *   - `capped: true` records that the computed fee was reduced to the cap.
 *     The uncapped figure is kept so the ledger can explain the reduction.
 *   - Where the property's unit count is unknowable (the statutory percentage
 *     in states like TX keys off it) BOTH branches are computed and the LOWER
 *     fee wins. Never overcharging under either reality is the only safe
 *     resolution of an unknown.
 *
 * Pure module: no DB, no clock. `daysLate` is computed by the caller from the
 * charge's due date.
 */

/** `late_fee_rules` row with its `numeric` columns already parsed to numbers. */
export interface LateFeeRuleData {
  state: string;
  /** Fraction, e.g. 0.1 for 10%. Properties with < 4 units. */
  capPctSmallProperty: number | null;
  /** Fraction. Properties with 4+ units. */
  capPctLargeProperty: number | null;
  capFlatCents: number | null;
  graceDays: number;
  initialFeeCents: number | null;
  perDayCents: number | null;
  citation: string | null;
}

export type LateFeeProposalStatus =
  | "proposed"
  | "no_rule_for_state"
  | "within_grace"
  | "not_late"
  | "no_fee_in_rule";

export type LateFeeUnitBranch = "large_4_plus" | "small_under_4" | "conservative_unknown";

export interface LateFeeProposal {
  status: LateFeeProposalStatus;
  /** What the operator would be confirming. 0 for every non-"proposed" status. */
  proposedFeeCents: number;
  /** Fee before the statutory cap was applied. Equals proposed when uncapped. */
  uncappedFeeCents: number;
  /** The binding cap in cents, null when the rule sets none. */
  capCents: number | null;
  capped: boolean;
  graceDays: number | null;
  daysLate: number;
  state: string;
  citation: string | null;
  unitBranch: LateFeeUnitBranch;
  explanation: string;
  /** Always true. A proposal never posts itself. */
  readonly requiresOperatorConfirmation: true;
}

/** Parse a raw `late_fee_rules` row (drizzle `numeric` ⇒ string) into numbers. */
export function parseLateFeeRuleRow(row: {
  state: string;
  capPctSmallProperty: string | number | null;
  capPctLargeProperty: string | number | null;
  capFlatCents: number | null;
  graceDays: number;
  initialFeeCents: number | null;
  perDayCents: number | null;
  citation: string | null;
}): LateFeeRuleData {
  const num = (v: string | number | null): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    state: row.state,
    capPctSmallProperty: num(row.capPctSmallProperty),
    capPctLargeProperty: num(row.capPctLargeProperty),
    capFlatCents: row.capFlatCents ?? null,
    graceDays: row.graceDays ?? 0,
    initialFeeCents: row.initialFeeCents ?? null,
    perDayCents: row.perDayCents ?? null,
    citation: row.citation ?? null,
  };
}

function fmtUsd(cents: number): string {
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

/** The binding cap for one unit-count branch, in integer cents. Floored. */
function capForBranch(
  rule: LateFeeRuleData,
  monthlyRentCents: number,
  branch: "large_4_plus" | "small_under_4",
): number | null {
  const pct = branch === "large_4_plus" ? rule.capPctLargeProperty : rule.capPctSmallProperty;
  const byPct = pct !== null ? Math.floor(monthlyRentCents * pct) : null;
  const flat = rule.capFlatCents ?? null;
  if (byPct === null) return flat;
  if (flat === null) return byPct;
  return Math.min(byPct, flat);
}

function proposeForBranch(args: {
  rule: LateFeeRuleData;
  monthlyRentCents: number;
  daysLate: number;
  branch: "large_4_plus" | "small_under_4";
}): { feeCents: number; uncappedCents: number; capCents: number | null; capped: boolean } {
  const { rule, monthlyRentCents, daysLate, branch } = args;
  const capCents = capForBranch(rule, monthlyRentCents, branch);

  const daysAfterGrace = Math.max(0, daysLate - rule.graceDays);
  const initial = rule.initialFeeCents ?? 0;
  const perDay = (rule.perDayCents ?? 0) * daysAfterGrace;
  let uncapped = initial + perDay;

  // A rule that encodes only a cap (the common "10% of monthly rent" form)
  // proposes the cap itself — that IS the fee the statute contemplates.
  if (uncapped === 0 && capCents !== null) uncapped = capCents;

  const feeCents = capCents !== null ? Math.min(uncapped, capCents) : uncapped;
  return { feeCents, uncappedCents: uncapped, capCents, capped: capCents !== null && uncapped > capCents };
}

/**
 * Propose a late fee for one overdue charge.
 *
 * @param knownUnitCountFloor A FLOOR on the property's unit count derived from
 *        real data (distinct units this org has leased at the property). ≥ 4
 *        selects the large-property branch with certainty; < 4 means the true
 *        count is unknowable from our data, so both branches are computed and
 *        the lower fee wins.
 */
export function proposeLateFee(args: {
  rule: LateFeeRuleData | null;
  monthlyRentCents: number;
  daysLate: number;
  knownUnitCountFloor: number;
  state: string;
}): LateFeeProposal {
  const base = {
    proposedFeeCents: 0,
    uncappedFeeCents: 0,
    capCents: null as number | null,
    capped: false,
    daysLate: args.daysLate,
    state: args.state.toUpperCase(),
    citation: args.rule?.citation ?? null,
    unitBranch: "conservative_unknown" as LateFeeUnitBranch,
    requiresOperatorConfirmation: true as const,
  };

  if (!args.rule) {
    return {
      ...base,
      status: "no_rule_for_state",
      graceDays: null,
      explanation:
        `No late-fee rule is on record for ${base.state}, so AcreOS proposes no fee. ` +
        "Confirm the statutory cap and grace period for this jurisdiction before charging anything.",
    };
  }

  const rule = args.rule;
  if (args.daysLate <= 0) {
    return {
      ...base,
      status: "not_late",
      graceDays: rule.graceDays,
      explanation: `Not past due — no late fee. (${base.state} allows ${rule.graceDays}-day grace.)`,
    };
  }
  if (args.daysLate <= rule.graceDays) {
    return {
      ...base,
      status: "within_grace",
      graceDays: rule.graceDays,
      explanation:
        `${args.daysLate} day(s) late, inside the ${rule.graceDays}-day statutory grace period` +
        `${rule.citation ? ` (${rule.citation})` : ""}. No fee may be charged yet.`,
    };
  }

  const certainLarge = args.knownUnitCountFloor >= 4;
  const large = proposeForBranch({ ...args, rule, branch: "large_4_plus" });
  const small = proposeForBranch({ ...args, rule, branch: "small_under_4" });

  let picked: ReturnType<typeof proposeForBranch>;
  let unitBranch: LateFeeUnitBranch;
  let conservativeNote = "";
  if (certainLarge) {
    picked = large;
    unitBranch = "large_4_plus";
  } else if (large.feeCents === small.feeCents) {
    picked = small;
    unitBranch = "small_under_4";
  } else {
    picked = large.feeCents < small.feeCents ? large : small;
    unitBranch = "conservative_unknown";
    conservativeNote =
      " Property unit count is not on record, and the statutory cap keys off it — the LOWER cap branch was used " +
      "so the proposal cannot overcharge under either reality.";
  }

  if (picked.feeCents <= 0) {
    return {
      ...base,
      status: "no_fee_in_rule",
      graceDays: rule.graceDays,
      capCents: picked.capCents,
      unitBranch,
      explanation:
        `${base.state} rule on record sets no chargeable late fee (no flat fee, no per-day amount, no cap) ` +
        `${rule.citation ? `(${rule.citation}) ` : ""}— AcreOS proposes no fee.${conservativeNote}`,
    };
  }

  const capBits =
    picked.capCents !== null
      ? picked.capped
        ? ` Computed ${fmtUsd(picked.uncappedCents)} exceeded the statutory cap of ${fmtUsd(picked.capCents)} — CAPPED to the cap.`
        : ` Statutory cap is ${fmtUsd(picked.capCents)}; the proposal is under it.`
      : " No statutory cap is encoded for this state.";

  return {
    ...base,
    status: "proposed",
    proposedFeeCents: picked.feeCents,
    uncappedFeeCents: picked.uncappedCents,
    capCents: picked.capCents,
    capped: picked.capped,
    graceDays: rule.graceDays,
    unitBranch,
    explanation:
      `${args.daysLate} days late (${rule.graceDays}-day grace) → proposed fee ${fmtUsd(picked.feeCents)}.` +
      `${capBits}${conservativeNote}` +
      `${rule.citation ? ` Rule: ${rule.citation}.` : ""} Requires operator confirmation before it is charged.`,
  };
}
