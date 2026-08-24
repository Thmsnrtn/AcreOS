/**
 * Do AcreOS's own usury sources agree about a state? If not, say so.
 *
 * ── THE FOUNDER RULING THIS IMPLEMENTS (2026-08-24) ─────────────────────────
 * "Treat the 25-state disagreement as external legal proof debt. Do not choose a
 * legal answer by preferring one internal implementation. Where authoritative
 * jurisdiction-specific evidence is unresolved, legal/compliance classification
 * must fail to INDETERMINATE, not guess compliant/noncompliant."
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Three tables in this repository describe the same thing — a state's general
 * civil usury cap — and disagree for 25 states:
 *
 *   server/services/usuryCeiling.ts   civil / commercial / real-estate ceilings
 *   server/services/usury.ts          a single maxRate per state (the one every
 *                                     production surface currently calls)
 *   shared/regulatory/rmloAdvisor.ts  general civil caps in basis points
 *
 * `tests/unit/usuryConsistency.test.ts` has pinned those disagreements since
 * 2026-08-01. Nothing acted on them, because acting meant deciding which table
 * is right — a legal determination, and the one thing the
 * minimum-necessary-responsibility posture says AcreOS must not make.
 *
 * The ruling above resolves that deadlock without resolving the law: where the
 * sources conflict, AcreOS states that it cannot determine the cap. That is a
 * true statement about AcreOS's evidence, and it requires no legal opinion.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 * It does not pick a winner, average, or take the most conservative value.
 * Taking the lowest cap would look prudent and would still be a legal claim —
 * "this rate is usurious in your state" is an assertion whether it errs high or
 * low, and an operator who priced a note off it would be relying on a number
 * AcreOS invented from a disagreement.
 *
 * It is also NOT the canonical source the same ruling calls for: "single,
 * versioned, source-backed and jurisdiction/effective-date aware; reconcile and
 * retire the duplicate only after the underlying legal evidence is verified."
 * This is the refusal that makes the current state safe to operate while that
 * evidence is gathered. When the canonical table exists, this module's whole job
 * is to be deleted.
 */

import { getAllStateLimits } from "./usuryCeiling";
import { checkUsury } from "./usury";
import { advise } from "@shared/regulatory/rmloAdvisor";

/** A cap in percent per annum. `null` = the source says "no general cap". */
type Cap = number | null;

export type UsuryConsensus =
  | {
      status: "agreed";
      /** null = every source that knows this state says there is no general cap. */
      capPercent: Cap;
      sources: Record<string, Cap>;
    }
  | {
      status: "indeterminate";
      reason: string;
      /** What each source that knows this state actually says. */
      sources: Record<string, Cap>;
    };

/** usury.ts's view, normalised. `undefined` = the state is not in its table. */
function fromUsuryTable(state: string): Cap | undefined {
  const r = checkUsury(state, 1);
  if (r.statuteNote === "Unknown") return undefined;
  // usury.ts documents maxRate 0 as its "no statutory cap" sentinel (SD).
  return r.maxAllowedRate === 0 ? null : r.maxAllowedRate;
}

/** usuryCeiling.ts's general civil ceiling. */
function fromCeilingTable(state: string): Cap | undefined {
  const row = getAllStateLimits().find((s) => s.stateCode === state);
  return row ? row.civilCeiling : undefined;
}

/** rmloAdvisor's general civil cap, in percent. */
function fromRmloAdvisor(state: string): Cap | undefined {
  const out = advise({
    state,
    collateralType: "vacant_land",
    loanAmountCents: 10_000_000,
    annualRateBps: 100,
    isOriginating: true,
    isBusinessPurpose: true,
  });
  if (out.stateUsuryCapNote.includes("not in advisor's reference table")) return undefined;
  return out.stateUsuryCapBps === null ? null : out.stateUsuryCapBps / 100;
}

/**
 * The consensus of AcreOS's sources for one state.
 *
 * A state no source knows is INDETERMINATE, not "no cap": absence of a row is
 * absence of evidence, and rendering it as "uncapped" would be the same
 * fabrication in the permissive direction.
 */
export function usuryConsensus(stateCode: string): UsuryConsensus {
  const state = (stateCode ?? "").trim().toUpperCase();
  const raw: Record<string, Cap | undefined> = {
    "usuryCeiling.civilCeiling": fromCeilingTable(state),
    "usury.maxRate": fromUsuryTable(state),
    "rmloAdvisor.generalCap": fromRmloAdvisor(state),
  };

  const known = Object.entries(raw).filter(([, v]) => v !== undefined) as Array<[string, Cap]>;
  const sources = Object.fromEntries(known);

  if (known.length === 0) {
    return {
      status: "indeterminate",
      reason: `No usury source in AcreOS covers ${state || "this state"}.`,
      sources,
    };
  }

  const values = known.map(([, v]) => v);
  const allAgree = values.every((v) => v === values[0]);
  if (allAgree) return { status: "agreed", capPercent: values[0], sources };

  const rendered = known
    .map(([name, v]) => `${name}=${v === null ? "no cap" : `${v}%`}`)
    .join(", ");
  return {
    status: "indeterminate",
    reason:
      `AcreOS's own sources disagree about ${state}'s general usury cap (${rendered}), ` +
      `so it cannot say whether a rate is lawful there. Verify the governing statute ` +
      `with counsel for this transaction.`,
    sources,
  };
}
