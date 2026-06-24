import { describe, it, expect } from "vitest";
import {
  sampleBeta,
  scorePlays,
  selectPlay,
  efficacyOf,
  makeSeededRng,
  pooledPrior,
  type PlayStats,
  type Rng,
} from "../../server/services/autopilot/efficacy";

/** Deterministic PRNG (mulberry32) so every statistical test is exact + repeatable. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("autopilot efficacy — Thompson sampling over real outcomes", () => {
  it("sampleBeta always returns a value in [0,1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 500; i++) {
      const x = sampleBeta(1 + Math.floor(i / 10), 1 + (i % 7), rng);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(Number.isFinite(x)).toBe(true);
    }
  });

  it("selectPlay returns null only for an empty candidate set", () => {
    expect(selectPlay([], mulberry32(1))).toBeNull();
    expect(selectPlay([{ playId: "a", successes: 0, failures: 0 }], mulberry32(1))).toBe("a");
  });

  it("COLD START = rotation: with no data, selection is ~uniform (no premature lock-in)", () => {
    const plays: PlayStats[] = ["a", "b", "c", "d"].map((playId) => ({ playId, successes: 0, failures: 0 }));
    const rng = mulberry32(42);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 4000; i++) counts[selectPlay(plays, rng)!]++;
    // each of 4 plays should get roughly a quarter — assert none is starved or dominant
    for (const k of ["a", "b", "c", "d"]) {
      expect(counts[k]).toBeGreaterThan(4000 * 0.15);
      expect(counts[k]).toBeLessThan(4000 * 0.35);
    }
  });

  it("EXPLOITS a clear winner: a strongly-approved play is picked the large majority of the time", () => {
    const plays: PlayStats[] = [
      { playId: "winner", successes: 40, failures: 2 },
      { playId: "loser", successes: 2, failures: 40 },
      { playId: "meh", successes: 10, failures: 10 },
    ];
    const rng = mulberry32(7);
    let winnerPicks = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) if (selectPlay(plays, rng) === "winner") winnerPicks++;
    expect(winnerPicks / N).toBeGreaterThan(0.8);
  });

  it("STILL EXPLORES the unknown: an untested play isn't starved next to a modest known one", () => {
    const plays: PlayStats[] = [
      { playId: "known", successes: 6, failures: 4 }, // ~0.6, but only 10 samples
      { playId: "untested", successes: 0, failures: 0 }, // wide prior
    ];
    const rng = mulberry32(99);
    let untestedPicks = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) if (selectPlay(plays, rng) === "untested") untestedPicks++;
    // the untested play must still get meaningfully explored (not killed off)
    expect(untestedPicks / N).toBeGreaterThan(0.2);
  });

  it("scorePlays exposes the real track record + a deterministic posterior mean", () => {
    const scored = scorePlays([{ playId: "p", successes: 3, failures: 1 }], mulberry32(1));
    expect(scored[0].n).toBe(4);
    expect(scored[0].posteriorMean).toBeCloseTo((1 + 3) / (2 + 4), 6); // (α)/(α+β)
  });

  it("efficacyOf is the deterministic Laplace-smoothed rate (for the letter)", () => {
    expect(efficacyOf({ playId: "p", successes: 0, failures: 0 })).toEqual({ rate: 0.5, n: 0 });
    expect(efficacyOf({ playId: "p", successes: 4, failures: 0 }).rate).toBeCloseTo(5 / 6, 6);
    expect(efficacyOf({ playId: "p", successes: 4, failures: 0 }).n).toBe(4);
  });

  it("makeSeededRng is deterministic per seed and produces values in [0,1)", () => {
    const a = makeSeededRng(12345);
    const b = makeSeededRng(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    // different seeds diverge
    expect(makeSeededRng(1)()).not.toBe(makeSeededRng(2)());
  });

  it("is deterministic: same seed ⇒ identical selections", () => {
    const plays: PlayStats[] = [
      { playId: "a", successes: 5, failures: 5 },
      { playId: "b", successes: 7, failures: 3 },
    ];
    const seq1 = Array.from({ length: 50 }, (_, i) => selectPlay(plays, mulberry32(123))![0]);
    const seq2 = Array.from({ length: 50 }, (_, i) => selectPlay(plays, mulberry32(123))![0]);
    expect(seq1).toEqual(seq2);
  });
});

describe("T3 (#14) — pooled (hierarchical) prior", () => {
  it("contributes nothing at cold-start → scoring stays exactly Beta(1,1)", () => {
    expect(pooledPrior([])).toEqual({ alpha: 0, beta: 0 });
    expect(pooledPrior([{ playId: "a", successes: 0, failures: 0 }])).toEqual({ alpha: 0, beta: 0 });
  });

  it("reflects the org's pooled success rate as prior pseudo-counts", () => {
    // 8 successes / 2 failures across plays → pooled mean 0.8, strength 2.
    const prior = pooledPrior([
      { playId: "a", successes: 5, failures: 1 },
      { playId: "b", successes: 3, failures: 1 },
    ]);
    expect(prior.alpha).toBeCloseTo(1.6, 5); // 2 * 0.8
    expect(prior.beta).toBeCloseTo(0.4, 5); // 2 * 0.2
  });

  it("lifts an UNPROVEN play's posterior toward the pooled mean (not a blind 0.5)", () => {
    const stats: PlayStats[] = [
      { playId: "proven", successes: 20, failures: 1 },
      { playId: "fresh", successes: 0, failures: 0 },
    ];
    const rng = makeSeededRng(1);
    const flat = scorePlays(stats, rng).find((p) => p.playId === "fresh")!;
    const pooled = scorePlays(stats, rng, pooledPrior(stats)).find((p) => p.playId === "fresh")!;
    expect(flat.posteriorMean).toBeCloseTo(0.5, 5); // Beta(1,1)
    expect(pooled.posteriorMean).toBeGreaterThan(0.5); // inherits the org's strong track record
  });
});
