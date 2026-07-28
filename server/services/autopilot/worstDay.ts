/**
 * worstDay.ts — the founder's single worst-day number.
 *
 * Founder-trust audit (2026-07): the autopilot's spending caps live in six
 * mechanisms across four units (cents/day, cents/month, per-transaction,
 * per-request), so no one could answer the layperson question "if everything
 * went maximally wrong autonomously in ONE day, what's the most it could
 * cost?" This module composes the REAL enforced constants into one bound:
 *
 *   boundCents = min(hardCapCents, spendRemainingCents) + aiDailyCeilingCents
 *
 *   AI side   — AI_PLATFORM_DAILY_CEILING_CENTS (default 1500 = $15/day),
 *               the only fail-CLOSED gate in the AI cost stack
 *               (server/services/aiCostCeiling.ts).
 *   Money side — the sum of the current month's remaining per-agent budget
 *               envelopes (financialAuthorityGate.getBudgetSummary), bounded
 *               above by the absolute FINANCIAL_HARD_CAP_CENTS (default
 *               2_500_000 = $25,000). Per-transaction, autonomous spends are
 *               constitutionally capped at $500 (>$500 is founder-only).
 *
 * HONESTY CONTRACT (no-fabrication): a component that cannot be read is
 * returned as null — never as a zero pretending to be real — and boundCents
 * is null unless every component resolved. The caveats array states the
 * model's real limits verbatim; the UI must show them, not summarize them
 * into false comfort.
 *
 * Structure: `composeWorstDayBound` is a PURE function over WorstDayInputs so
 * the composition math is unit-testable without a DB; `loadWorstDayInputs`
 * is the thin DB/env loader that feeds it.
 */

import { logger } from "../../utils/logger";

/** Mirrors aiCostCeiling.ts PLATFORM_DEFAULT_DAILY_CEILING_CENTS_FALLBACK. */
const AI_PLATFORM_DAILY_CEILING_DEFAULT_CENTS = 1500;

export interface WorstDayInputs {
  /** Platform-wide fail-closed AI daily ceiling, cents. null = unreadable. */
  aiDailyCeilingCents: number | null;
  /**
   * Current-month remaining cents per agent budget envelope.
   * null = the envelope table was unreadable (NOT the same as an empty
   * month — that is an empty array, which is also treated as unknowable
   * because envelopes are created lazily with default budgets on first
   * spend, so "no envelopes yet" never means "no spending possible").
   */
  envelopeRemainingCents: number[] | null;
  /** Absolute per-request financial hard cap, cents. null = unreadable. */
  hardCapCents: number | null;
}

export interface WorstDayBound {
  aiDailyCeilingCents: number | null;
  spendRemainingCents: number | null;
  hardCapCents: number | null;
  /** min(hardCap, spendRemaining) + aiCeiling; null when any input is unknown. */
  boundCents: number | null;
  caveats: string[];
}

/**
 * Pure composition of the worst-day bound. No I/O — feed it via
 * loadWorstDayInputs() in production, or literals in tests.
 */
export function composeWorstDayBound(inputs: WorstDayInputs): WorstDayBound {
  const caveats: string[] = [];

  const aiDailyCeilingCents =
    inputs.aiDailyCeilingCents != null &&
    Number.isFinite(inputs.aiDailyCeilingCents) &&
    inputs.aiDailyCeilingCents >= 0
      ? inputs.aiDailyCeilingCents
      : null;
  if (aiDailyCeilingCents === null) {
    caveats.push(
      "The platform AI daily ceiling could not be read, so no AI-side number is included — nothing here is a guess.",
    );
  }

  const hardCapCents =
    inputs.hardCapCents != null &&
    Number.isFinite(inputs.hardCapCents) &&
    inputs.hardCapCents >= 0
      ? inputs.hardCapCents
      : null;
  if (hardCapCents === null) {
    caveats.push(
      "The absolute financial hard cap could not be read, so no money-side number is included.",
    );
  }

  let spendRemainingCents: number | null = null;
  if (inputs.envelopeRemainingCents === null) {
    caveats.push(
      "The agent budget envelopes could not be read, so no money-side number is included.",
    );
  } else if (inputs.envelopeRemainingCents.length === 0) {
    caveats.push(
      "No agent budget envelopes exist for this month yet. Envelopes are created with default budgets the first time an agent spends, so 'none yet' does NOT mean 'nothing can be spent' — the money side is unknowable right now and is shown as nothing rather than a guess.",
    );
  } else {
    // Overspent envelopes (negative remaining) contribute 0 — an agent
    // cannot spend negative money, and counting it would understate the bound.
    spendRemainingCents = inputs.envelopeRemainingCents.reduce(
      (sum, r) => sum + (Number.isFinite(r) ? Math.max(0, r) : 0),
      0,
    );
  }

  const boundCents =
    aiDailyCeilingCents !== null && spendRemainingCents !== null && hardCapCents !== null
      ? Math.min(hardCapCents, spendRemainingCents) + aiDailyCeilingCents
      : null;

  if (boundCents !== null) {
    // The model's honest limits — always shown when a number is shown.
    caveats.push(
      "There is no per-day cap on money below the monthly envelopes — in the worst case, everything remaining in this month's envelopes could go out in a single day. That is exactly what this number assumes.",
      "Budget envelopes reset monthly, so this number climbs back up at the start of each month.",
      "Any single autonomous transaction is capped at $500 — anything larger always waits for you. The worst case is therefore many small transactions, not one big one.",
      "This bound covers the metered rails: agent budget envelopes and platform AI spend. Costs that don't flow through those rails (e.g. infrastructure bills) are not included.",
    );
  }

  return { aiDailyCeilingCents, spendRemainingCents, hardCapCents, boundCents, caveats };
}

/**
 * Thin loader — reads the same sources the runtime enforces against.
 * Each read fails to null independently (composeWorstDayBound turns nulls
 * into honest caveats), never to a fabricated zero.
 */
export async function loadWorstDayInputs(): Promise<WorstDayInputs> {
  // AI side — identical env semantics to aiCostCeiling.getPlatformDailyCeilingCents
  // (which is module-private there; the default is locked by aiCostCeilingDefault.test.ts).
  let aiDailyCeilingCents: number | null = AI_PLATFORM_DAILY_CEILING_DEFAULT_CENTS;
  const fromEnv = process.env.AI_PLATFORM_DAILY_CEILING_CENTS;
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n > 0) aiDailyCeilingCents = n;
  }

  // Money side — current-month envelopes + the live hard cap, via the same
  // getBudgetSummary the founder briefing uses.
  let envelopeRemainingCents: number[] | null = null;
  let hardCapCents: number | null = null;
  try {
    const { financialAuthorityGate } = await import("../financialAuthorityGate");
    const summary = await financialAuthorityGate.getBudgetSummary();
    envelopeRemainingCents = summary.envelopes.map((e) => e.remainingCents);
    hardCapCents = summary.hardCapCents;
  } catch (err) {
    logger.warn(
      "[worstDay] budget summary unreadable — money side of the worst-day bound will be null",
      err instanceof Error ? err : undefined,
    );
  }

  return { aiDailyCeilingCents, envelopeRemainingCents, hardCapCents };
}
