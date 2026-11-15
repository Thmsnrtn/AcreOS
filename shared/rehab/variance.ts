/**
 * Rehab variance — estimate → committed → actual, per line and per project
 * (fix-and-flip package, Leg 2, §4.1 / §4.4 / §4.5).
 *
 * Pure arithmetic on the operator's own figures. Three numbers, with distinct
 * names everywhere they render:
 *   - ESTIMATE  — the line's budget, which the operator priced;
 *   - COMMITTED — what a contractor agreed to, entered by the operator or applied
 *                 from an accepted bid. A stored 0 is read as "not committed":
 *                 a line nobody has committed to is not a $0 commitment, so it
 *                 has no committed-vs-actual figure at all (null, not 0);
 *   - ACTUAL    — what was spent.
 *
 * FLAGS ARE FACTS. A flag says that a line's actual exceeds its estimate, or
 * that the project's committed total exceeds its estimate total, with the true
 * figures. No threshold ("warn at 90%") is invented here: a platform threshold
 * presented as a rule would be a platform figure dressed as judgment (§7.2).
 *
 * BID DELTAS ARE ARITHMETIC. A bid's category amount beside the estimate for
 * that category, as a dollar and percent difference. No verdict on the
 * contractor, no ranking, no "too low" threshold.
 */

export interface VarianceLineInput {
  id: string;
  category: string;
  scope: string;
  budgetCents: number;
  committedCents: number;
  spentCents: number;
}

export interface LineVariance {
  id: string;
  category: string;
  scope: string;
  estimateCents: number;
  /** Null when nothing is committed on the line (stored 0). */
  committedCents: number | null;
  actualCents: number;
  /** actual − estimate. */
  actualVsEstimateCents: number;
  /** actual − committed; null when nothing is committed. */
  actualVsCommittedCents: number | null;
}

export interface ProjectVariance {
  estimateCents: number;
  /** Sum over committed lines only. */
  committedCents: number;
  committedLineCount: number;
  uncommittedLineCount: number;
  actualCents: number;
  actualVsEstimateCents: number;
  /** actual − committed over the committed lines only; null when none is committed. */
  actualVsCommittedCents: number | null;
}

export type VarianceFlag =
  | { kind: "line_actual_over_estimate"; lineId: string; category: string; scope: string; actualCents: number; estimateCents: number; fact: string }
  | { kind: "committed_over_estimate"; committedCents: number; estimateCents: number; fact: string };

/** Whole dollars when exact; cents shown when not, so a 40¢ overrun never reads "$15,000 vs $15,000". */
const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

export function lineVariance(l: VarianceLineInput): LineVariance {
  const estimate = Number(l.budgetCents) || 0;
  const actual = Number(l.spentCents) || 0;
  const committed = Number(l.committedCents) > 0 ? Number(l.committedCents) : null;
  return {
    id: l.id,
    category: l.category,
    scope: l.scope,
    estimateCents: estimate,
    committedCents: committed,
    actualCents: actual,
    actualVsEstimateCents: actual - estimate,
    actualVsCommittedCents: committed === null ? null : actual - committed,
  };
}

export function projectVariance(lines: readonly VarianceLineInput[]): ProjectVariance {
  const v = lines.map(lineVariance);
  const committed = v.filter((l) => l.committedCents !== null);
  const estimate = v.reduce((s, l) => s + l.estimateCents, 0);
  const actual = v.reduce((s, l) => s + l.actualCents, 0);
  const committedTotal = committed.reduce((s, l) => s + (l.committedCents as number), 0);
  return {
    estimateCents: estimate,
    committedCents: committedTotal,
    committedLineCount: committed.length,
    uncommittedLineCount: v.length - committed.length,
    actualCents: actual,
    actualVsEstimateCents: actual - estimate,
    actualVsCommittedCents:
      committed.length === 0 ? null : committed.reduce((s, l) => s + l.actualCents, 0) - committedTotal,
  };
}

export function varianceFlags(lines: readonly VarianceLineInput[]): VarianceFlag[] {
  const flags: VarianceFlag[] = [];
  for (const l of lines.map(lineVariance)) {
    if (l.actualCents > l.estimateCents) {
      flags.push({
        kind: "line_actual_over_estimate",
        lineId: l.id,
        category: l.category,
        scope: l.scope,
        actualCents: l.actualCents,
        estimateCents: l.estimateCents,
        fact: `${l.scope}: spent ${usd(l.actualCents)} vs ${usd(l.estimateCents)} estimate`,
      });
    }
  }
  const p = projectVariance(lines);
  if (p.committedCents > p.estimateCents) {
    flags.push({
      kind: "committed_over_estimate",
      committedCents: p.committedCents,
      estimateCents: p.estimateCents,
      fact: `Committed ${usd(p.committedCents)} vs ${usd(p.estimateCents)} estimated across the project's lines`,
    });
  }
  return flags;
}

export interface BidCategoryDelta {
  category: string;
  bidCents: number;
  /** Sum of the project's line estimates in this category; 0 when it has none. */
  estimateCents: number;
  deltaCents: number;
  /** delta ÷ estimate, as a percent; null when there is no estimate to compare with. */
  deltaPct: number | null;
}

/** A bid's per-category amounts beside the project's own estimate for each category. */
export function bidVsEstimate(
  breakdown: Readonly<Record<string, number>>,
  lines: readonly VarianceLineInput[],
): BidCategoryDelta[] {
  return Object.entries(breakdown ?? {})
    .filter(([, cents]) => Number.isFinite(Number(cents)))
    .map(([category, cents]) => {
      const bid = Math.round(Number(cents));
      const estimate = lines.filter((l) => l.category === category).reduce((s, l) => s + (Number(l.budgetCents) || 0), 0);
      const delta = bid - estimate;
      return {
        category,
        bidCents: bid,
        estimateCents: estimate,
        deltaCents: delta,
        deltaPct: estimate > 0 ? Math.round((delta / estimate) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}

/** The status at which line estimates lock (§4.3). */
export const ESTIMATE_EDITABLE_STATUS = "planning" as const;

export const ESTIMATE_LOCK_MESSAGE =
  "This project has left planning, so its line estimates are locked — the estimate is what variance is measured against. " +
  "A scope change after work starts is a change order: priced (amount and schedule impact) and approved before the work it covers starts. " +
  "Propose one from this project's Change orders card — the recorded estimate never changes; an approved order adjusts the line's effective budget instead. " +
  "Spent and committed stay editable.";
