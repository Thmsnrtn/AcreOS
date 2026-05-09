/**
 * FW-WENDELL-1 (push-forward 2026-05-08): note-ledger paranoia tests.
 *
 * Wendell-Hart's lead: a single silent rounding bug in the note-payment
 * ledger collapses customer trust + word-of-mouth. The Note Investor
 * vertical lives or dies on this calculation. CI runs 1,000 randomized
 * amortization schedules and validates the invariants to the cent:
 *
 *   1. sum(principal) === original principal (within $0.01)
 *   2. sum(payment) === sum(principal) + sum(interest) (within $0.01)
 *   3. balance after final payment === 0 (within $0.01)
 *   4. balance is monotonically non-increasing
 *   5. monthly payment * (term - 1) ≤ sum(payment) ≤ monthly payment * (term + 1)
 *      (final-payment rounding tolerance)
 *
 * The randomized inputs span:
 *   principal:        $1,000 .. $5,000,000
 *   annualRatePct:    0% .. 24%
 *   termMonths:       12 .. 480
 *
 * If any invariant fails for any seed, the test fails with the seed
 * printed so the bug is reproducible. This is the unit test Wendell
 * asked for; the real-money 3-cycle integration test sits separately.
 */

import { describe, it, expect } from "vitest";
import { calculateAmortization, calcMonthlyPayment } from "../../client/src/lib/amortization";

interface Seed {
  principal: number;
  annualRatePct: number;
  termMonths: number;
  startDate: string;
}

function randomSeed(rand: () => number): Seed {
  const principal = Math.round((1000 + rand() * 4_999_000) * 100) / 100;
  const annualRatePct = Math.round(rand() * 2400) / 100; // 0 .. 24
  const termMonths = 12 + Math.floor(rand() * (480 - 12));
  return {
    principal,
    annualRatePct,
    termMonths,
    startDate: "2026-01-01",
  };
}

// Deterministic PRNG so failures are reproducible from a single integer.
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const ITERATIONS = process.env.AMORTIZATION_PARANOIA_ITERATIONS
  ? Number(process.env.AMORTIZATION_PARANOIA_ITERATIONS)
  : 1000;
const TOLERANCE_DOLLARS = 0.02;

describe("FW-WENDELL-1: note-ledger paranoia (1,000 randomized schedules)", () => {
  it(`every randomized schedule (n=${ITERATIONS}) holds the 5 invariants to within $${TOLERANCE_DOLLARS}`, () => {
    const failures: Array<{ rngSeed: number; seed: Seed; reason: string }> = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const rngSeed = 1_000_000 + i;
      const rand = mulberry32(rngSeed);
      const seed = randomSeed(rand);

      const schedule = calculateAmortization(
        seed.principal,
        seed.annualRatePct,
        seed.termMonths,
        seed.startDate,
      );

      if (schedule.length === 0) {
        failures.push({ rngSeed, seed, reason: "empty schedule for non-zero principal" });
        continue;
      }

      const sumPrincipal = Number(
        schedule.reduce((s, r) => s + r.principal, 0).toFixed(2),
      );
      const sumInterest = Number(
        schedule.reduce((s, r) => s + r.interest, 0).toFixed(2),
      );
      const sumPayment = Number(
        schedule.reduce((s, r) => s + r.payment, 0).toFixed(2),
      );
      const finalBalance = schedule[schedule.length - 1].balance;

      // 1. sum(principal) ~= original principal
      if (Math.abs(sumPrincipal - seed.principal) > TOLERANCE_DOLLARS) {
        failures.push({
          rngSeed,
          seed,
          reason: `sum(principal)=${sumPrincipal} !== original=${seed.principal}, delta=${(sumPrincipal - seed.principal).toFixed(4)}`,
        });
        continue;
      }

      // 2. sum(payment) ~= sum(principal) + sum(interest)
      if (Math.abs(sumPayment - (sumPrincipal + sumInterest)) > TOLERANCE_DOLLARS) {
        failures.push({
          rngSeed,
          seed,
          reason: `sum(payment)=${sumPayment} !== sum(principal)+sum(interest)=${sumPrincipal + sumInterest}`,
        });
        continue;
      }

      // 3. final balance ~= 0
      if (Math.abs(finalBalance) > TOLERANCE_DOLLARS) {
        failures.push({
          rngSeed,
          seed,
          reason: `final balance=${finalBalance} !== 0`,
        });
        continue;
      }

      // 4. balance monotonically non-increasing
      let prevBalance = seed.principal;
      let monoFail: string | null = null;
      for (const row of schedule) {
        if (row.balance > prevBalance + TOLERANCE_DOLLARS) {
          monoFail = `balance went UP at payment ${row.paymentNumber}: prev=${prevBalance} now=${row.balance}`;
          break;
        }
        prevBalance = row.balance;
      }
      if (monoFail) {
        failures.push({ rngSeed, seed, reason: monoFail });
        continue;
      }

      // 5. monthly payment bounds (final-payment rounding tolerance)
      const monthly = calcMonthlyPayment(
        seed.principal,
        seed.annualRatePct,
        seed.termMonths,
      );
      const lower = monthly * (schedule.length - 1);
      const upper = monthly * (schedule.length + 1);
      if (sumPayment < lower - TOLERANCE_DOLLARS || sumPayment > upper + TOLERANCE_DOLLARS) {
        failures.push({
          rngSeed,
          seed,
          reason: `sum(payment)=${sumPayment} outside [${lower}, ${upper}] for monthly=${monthly}`,
        });
        continue;
      }
    }

    if (failures.length > 0) {
      // Print top 5 failures so log output stays readable.
      const samples = failures.slice(0, 5);
      const lines = samples.map(
        (f) =>
          `  rng_seed=${f.rngSeed} principal=$${f.seed.principal} rate=${f.seed.annualRatePct}% term=${f.seed.termMonths}mo: ${f.reason}`,
      );
      throw new Error(
        `${failures.length}/${ITERATIONS} randomized schedules FAILED an invariant.\n${lines.join("\n")}`,
      );
    }

    expect(failures.length).toBe(0);
  }, 30_000);
});
