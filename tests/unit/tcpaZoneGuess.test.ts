/**
 * A guessed timezone is not a known one, on the path the law governs.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `getZoneForPhone` returned `AREA_CODE_TZ[areaCode] ?? 'America/New_York'`, so
 * its answer meant BOTH "this recipient's zone" and "we had no idea and picked
 * the easternmost continental zone". `isWithinQuietHours` then applied a single
 * 8 AM–9 PM window to that guess.
 *
 * MEASURED: at 12:30 UTC, New York is 08:30 and Los Angeles is 05:30. So an
 * unmapped area code was CLEARED TO SEND to someone who may be asleep — a TCPA
 * §64.1200(c)(1) violation — while the file's own header promised the opposite:
 * "when in doubt, it skews toward blocking (we use the wider envelope, treating
 * ambiguity as 'do not send')". The stated safety property was not implemented.
 *
 * 907 (Alaska) and 808 (Hawaii) were also unmapped, so they took the Eastern
 * guess too: 8 AM Eastern is 4 AM in Anchorage and 2 AM in Honolulu.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry, `ac17a1f` — a value whose absence is indistinguishable from a
 * deliberate one. Here the collapsed pair is "known zone" and "defaulted zone",
 * and the cost of the collapse is a call at 5:30 in the morning.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveZoneForPhone,
  isWithinQuietHours,
} from "../../server/services/tcpaCompliance";

describe("a guessed zone is reported as a guess", () => {
  it("a mapped area code resolves as KNOWN", () => {
    expect(resolveZoneForPhone("+1 503 555 0100")).toEqual({
      zone: "America/Los_Angeles",
      inferred: false,
    });
  });

  it("Alaska and Hawaii are known, not guessed", () => {
    // Both were unmapped and fell through to Eastern — which puts the window's
    // 8 AM at 4 AM in Anchorage and 2 AM in Honolulu.
    expect(resolveZoneForPhone("+1 907 555 0100")).toEqual({
      zone: "America/Anchorage",
      inferred: false,
    });
    expect(resolveZoneForPhone("+1 808 555 0100")).toEqual({
      zone: "Pacific/Honolulu",
      inferred: false,
    });
  });

  it("an unmapped area code says so instead of pretending", () => {
    const r = resolveZoneForPhone("+1 999 555 0100");
    expect(r.inferred).toBe(true);
    // It still returns a zone to compute with; what changed is that the caller
    // can tell it is a default.
    expect(r.zone).toBe("America/New_York");
  });
});

afterEach(() => vi.useRealTimers());

describe("an unknown zone uses the wider envelope", () => {
  /** Fix the clock by checking a real instant through the public API. */
  const at = (utcHour: number, utcMinute: number) => {
    const d = new Date(Date.UTC(2026, 7, 18, utcHour, utcMinute));
    vi.useFakeTimers();
    vi.setSystemTime(d);
  };

  it("BLOCKS the hour that is 08:30 Eastern but 05:30 Pacific", () => {
    // The exact instant that used to be cleared. This is the whole finding.
    at(12, 30);
    const res = isWithinQuietHours("+1 999 555 0100");
    expect(res.blocked, "an unknown-zone send was cleared at 05:30 Pacific").toBe(true);
    expect(res.reason).toMatch(/UNKNOWN/);
    expect(res.reason).toMatch(/America\/Los_Angeles/);
  });

  it("still ALLOWS an hour that is inside the window everywhere", () => {
    // The envelope must narrow the window, not close it — otherwise the fix
    // would silently stop all sends to unmapped numbers.
    at(20, 0); // 16:00 New York, 13:00 Los Angeles
    expect(isWithinQuietHours("+1 999 555 0100").blocked).toBe(false);
  });

  it("does NOT narrow the window for a KNOWN zone", () => {
    // A Pacific number at 08:30 Pacific is legitimately sendable. The envelope
    // applies to ambiguity only; applying it to known zones would cost real
    // sends for no safety gain.
    at(15, 30); // 08:30 Los Angeles
    expect(isWithinQuietHours("+1 503 555 0100").blocked).toBe(false);
  });

  it("an explicit lead zone is trusted over the area code", () => {
    at(15, 30); // 08:30 Los Angeles, 11:30 New York
    expect(isWithinQuietHours("+1 999 555 0100", "America/New_York").blocked).toBe(false);
  });
});
