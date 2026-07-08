import { describe, it, expect } from "vitest";
import { computeUptimePct, SAMPLE_INTERVAL_MS } from "../../server/services/autopilot/uptime";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 1_750_000_000_000;

/** Build perfect 1/min samples from `startAgoMs` ago up to `endAgoMs` ago. */
function beats(startAgoMs: number, endAgoMs: number): number[] {
  const out: number[] = [];
  for (let t = NOW - startAgoMs; t <= NOW - endAgoMs; t += SAMPLE_INTERVAL_MS) out.push(t);
  return out;
}

describe("autopilot uptime sense — real, from heartbeat gaps", () => {
  it("perfect continuous heartbeats over a day ⇒ ~100% uptime", () => {
    const u = computeUptimePct(beats(24 * HOUR, 0), { now: NOW });
    expect(u).not.toBeNull();
    expect(u!).toBeGreaterThanOrEqual(99.9);
    expect(u!).toBeLessThanOrEqual(100);
  });

  it("HONESTY: too little measured data ⇒ null (caller keeps the conservative default)", () => {
    expect(computeUptimePct([], { now: NOW })).toBeNull();
    // only 10 minutes of data — below the 1h minimum
    expect(computeUptimePct(beats(10 * MIN, 0), { now: NOW })).toBeNull();
  });

  it("a real gap is counted as downtime and lowers the number", () => {
    // 24h of beats, but a 2h hole in the middle (worker was down)
    const firstHalf = beats(24 * HOUR, 13 * HOUR); // 24h..13h ago
    const secondHalf = beats(11 * HOUR, 0); // 11h..now  → 2h gap (13h..11h)
    const u = computeUptimePct([...firstHalf, ...secondHalf], { now: NOW });
    expect(u).not.toBeNull();
    // ~2h down out of ~24h measured ≈ 91-92% — clearly below 100, above 80
    expect(u!).toBeLessThan(93);
    expect(u!).toBeGreaterThan(88);
  });

  it("normal jitter within the grace window is NOT counted as downtime", () => {
    // beats every ~2min (2x expected) for 3h — within the 3x grace → still ~100%
    const out: number[] = [];
    for (let t = NOW - 3 * HOUR; t <= NOW; t += 2 * MIN) out.push(t);
    const u = computeUptimePct(out, { now: NOW });
    expect(u!).toBeGreaterThanOrEqual(99.9);
  });

  it("a currently-ongoing outage (stale trailing heartbeat) drags uptime down now", () => {
    // healthy for 24h, then nothing for the last 3h (still down right now)
    const u = computeUptimePct(beats(24 * HOUR, 3 * HOUR), { now: NOW });
    expect(u).not.toBeNull();
    expect(u!).toBeLessThan(90); // ~3h of the ~21h measured span is down
  });

  it("is order-independent (unsorted input)", () => {
    const samples = beats(6 * HOUR, 0);
    const shuffled = [...samples].reverse();
    expect(computeUptimePct(shuffled, { now: NOW })).toBe(computeUptimePct(samples, { now: NOW }));
  });

  it("clamps to [0,100] and never returns NaN", () => {
    const u = computeUptimePct(beats(2 * HOUR, 0), { now: NOW });
    expect(Number.isFinite(u!)).toBe(true);
    expect(u!).toBeGreaterThanOrEqual(0);
    expect(u!).toBeLessThanOrEqual(100);
  });
});
