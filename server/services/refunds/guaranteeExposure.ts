/**
 * The §5A guarantee's TAIL EXPOSURE — a PURE model (roadmap P1-14, register B2).
 *
 * WHAT IT IS. The total money the published guarantee currently stands behind:
 * every covered FIRST charge still inside the window and not yet refunded under
 * it. AMOUNT IS NOT A PREDICATE in the guarantee (guaranteeEligibility.ts), so a
 * day-29 annual ($1,990) is ~10x the largest monthly exposure and a signup
 * farm's tail grows linearly per fake signup. The B7 velocity brake bounds only
 * the 24h AUTOMATION rate; nothing bounded or showed the tail itself, how fast
 * it burns down as charges age out, or how much the brake would pay on its own.
 *
 * WHAT IT IS NOT. It is not policy: it reads GUARANTEE_WINDOW_DAYS and
 * GUARANTEE_REFUND_VELOCITY and never changes them. It does not decide
 * eligibility (E1–E6 do; e.g. it does not see disputes or E5), and it is not a
 * forecast of how many customers will ask — it is the ceiling if every covered
 * charge were claimed. No I/O, no clock read (`nowMs` is passed in), no people:
 * amounts and ages only. It never throws; malformed rows are excluded.
 *
 * BOUNDARY. A charge is in the tail while age < GUARANTEE_WINDOW_DAYS and leaves
 * when its age reaches it. (E3 itself tests `ageDays <= window`, so a request
 * at exactly day 30.000 is still accepted by the rule; the model treats that
 * instant as already out so the burn-down reaches exactly 0 at day 30. A
 * charge's age is a continuum — the instant has measure zero in practice.)
 */
import { GUARANTEE_REFUND_VELOCITY, GUARANTEE_WINDOW_DAYS } from "./refundConfig";
import { TIERS, TIER_PRICES_CENTS, type Tier } from "@shared/billing/tier-pricing";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ExposureInterval = "month" | "year";

export interface ExposureCharge {
  amountCents: number | null | undefined;
  chargeCreatedAtMs: number | null | undefined;
  interval: ExposureInterval | null;
  /** Tier key, informational only (the model does not branch on it). */
  tier: string | null;
  /** A guarantee refund was already processed for this org/charge. */
  guaranteeConsumed: boolean;
}

export interface FarmScenarioRow {
  tier: Tier;
  interval: ExposureInterval;
  /** Cents one fresh signup adds to the tail (its first charge). */
  perSignupCents: number;
  /** Such signups the brake's 24h cents cap absorbs before queueing starts (also bounded by the count cap). */
  signupsUnderBrake: number;
}

export interface GuaranteeExposure {
  nowMs: number;
  windowDays: number;
  tailCents: number;
  tailCount: number;
  byIntervalCents: { month: number; year: number; unknown: number };
  largestSingleCents: number;
  /** burnDown[d] = tail remaining after d days with no new signups; length windowDays + 1. */
  burnDown: number[];
  brakeBound: { autoPayableCents: number; autoPayableCount: number; queuedRemainderCents: number };
  farmScenario: FarmScenarioRow[];
  /** Rows excluded as malformed (null/invalid amount or timestamp). */
  excludedMalformed: number;
}

const validAmount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const validMs = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** What automation could refund in 24h from these amounts: largest-first within BOTH caps. */
function applyBrake(amountsDesc: readonly number[]): { cents: number; count: number } {
  let cents = 0;
  let count = 0;
  for (const a of amountsDesc) {
    if (count + 1 > GUARANTEE_REFUND_VELOCITY.maxCount) break;
    if (cents + a > GUARANTEE_REFUND_VELOCITY.maxCents) continue; // a smaller one may still fit
    cents += a;
    count += 1;
  }
  return { cents, count };
}

/** Per-signup tail for every tier × interval, derived from the pricing table. */
export function guaranteeFarmScenario(): FarmScenarioRow[] {
  const rows: FarmScenarioRow[] = [];
  for (const tier of TIERS) {
    const p = TIER_PRICES_CENTS[tier];
    for (const [interval, perSignupCents] of [
      ["month", p.priceMonthlyCents],
      ["year", p.priceYearlyCents],
    ] as const) {
      const byCents = perSignupCents > 0 ? Math.floor(GUARANTEE_REFUND_VELOCITY.maxCents / perSignupCents) : 0;
      rows.push({ tier, interval, perSignupCents, signupsUnderBrake: Math.min(byCents, GUARANTEE_REFUND_VELOCITY.maxCount) });
    }
  }
  return rows;
}

export function computeGuaranteeExposure(charges: readonly ExposureCharge[], nowMs: number): GuaranteeExposure {
  const windowMs = GUARANTEE_WINDOW_DAYS * DAY_MS;
  const inWindow: { amount: number; ageMs: number; interval: ExposureInterval | null }[] = [];
  let excludedMalformed = 0;

  for (const c of Array.isArray(charges) ? charges : []) {
    if (!c || !validAmount(c.amountCents) || !validMs(c.chargeCreatedAtMs)) {
      excludedMalformed += 1;
      continue;
    }
    if (c.guaranteeConsumed) continue;
    const ageMs = nowMs - c.chargeCreatedAtMs;
    // A future-dated charge (clock skew) has negative age: treated as age 0, still covered.
    if (!(ageMs < windowMs)) continue;
    inWindow.push({ amount: c.amountCents, ageMs: Math.max(0, ageMs), interval: c.interval === "month" || c.interval === "year" ? c.interval : null });
  }

  const byIntervalCents = { month: 0, year: 0, unknown: 0 };
  let tailCents = 0;
  let largestSingleCents = 0;
  for (const c of inWindow) {
    tailCents += c.amount;
    if (c.amount > largestSingleCents) largestSingleCents = c.amount;
    byIntervalCents[c.interval ?? "unknown"] += c.amount;
  }

  // A charge of age a is still in the tail after d days iff a + d·DAY < window.
  const burnDown: number[] = [];
  for (let d = 0; d <= GUARANTEE_WINDOW_DAYS; d++) {
    burnDown.push(inWindow.reduce((n, c) => (c.ageMs + d * DAY_MS < windowMs ? n + c.amount : n), 0));
  }

  const paid = applyBrake(inWindow.map((c) => c.amount).sort((a, b) => b - a));

  return {
    nowMs,
    windowDays: GUARANTEE_WINDOW_DAYS,
    tailCents,
    tailCount: inWindow.length,
    byIntervalCents,
    largestSingleCents,
    burnDown,
    brakeBound: { autoPayableCents: paid.cents, autoPayableCount: paid.count, queuedRemainderCents: tailCents - paid.cents },
    farmScenario: guaranteeFarmScenario(),
    excludedMalformed,
  };
}
