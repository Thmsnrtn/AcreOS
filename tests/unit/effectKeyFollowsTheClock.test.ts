/**
 * The autopilot's exactly-once effect key buckets on THE clock, not the wall.
 *
 * Measured 2026-10-07: a 30-day founder simulation published 2 articles, not
 * ~30. Every Writer dispatch after the first carried the same idempotency key,
 * because `computeEffectKey` was fed `Date.now()` and a compressed month runs
 * in a few real minutes — one or two 30-minute buckets for the whole month.
 *
 * The semantic property: two ticks a simulated day apart produce DIFFERENT
 * keys even when they run in the same real second, and two ticks inside one
 * window (a genuine double-fire) produce the SAME key. Both directions are
 * asserted, so a key that ignores time entirely also fails.
 */
import { afterEach, describe, expect, it } from "vitest";
import { computeEffectKey, effectKeyNow } from "../../server/services/solene/dispatchQueue";
import { clock, setSimulatedClockOffset } from "../../server/utils/clock";

const parts = { domain: "growth", moveKind: "grow_owned_channels", playId: "owned_county_guides", targetId: null };

afterEach(() => setSimulatedClockOffset(0));

describe("effect key follows the one clock", () => {
  it("a simulated day later is a different effect, in the same real second", () => {
    setSimulatedClockOffset(0);
    const day1 = effectKeyNow(parts);
    setSimulatedClockOffset(24 * 3600_000);
    const day2 = effectKeyNow(parts);
    expect(day2).not.toBe(day1);
  });

  it("a double-fire inside one window is the same effect", () => {
    // Pin to the start of a window so +1 minute cannot cross a boundary.
    const start = Math.floor(Date.now() / (30 * 60_000) + 1) * (30 * 60_000);
    setSimulatedClockOffset(start - Date.now());
    const a = effectKeyNow(parts);
    setSimulatedClockOffset(start + 60_000 - Date.now());
    const b = effectKeyNow(parts);
    expect(b).toBe(a);
  });

  it("is exactly computeEffectKey at clock.nowMs() (one rule, not two)", () => {
    const w = 30 * 60_000;
    const mid = Math.floor(Date.now() / w) * w + w / 2 + 7 * 24 * 3600_000;
    setSimulatedClockOffset(mid - Date.now());
    const t = clock.nowMs();
    expect(effectKeyNow(parts)).toBe(computeEffectKey({ ...parts, nowMs: t }));
  });
});
