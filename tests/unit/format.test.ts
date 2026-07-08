/**
 * W2-2 (t3-uiux-census) — house date primitives in client/src/lib/format.ts.
 *
 * Deterministic: every formatRelative assertion passes an explicit `now`;
 * absolute-date assertions construct Dates via the local-time constructor
 * (mid-day) so they render identically in any timezone.
 */

import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";

// Local-time constructor — month is 0-indexed (5 = June).
const JUN_11 = new Date(2026, 5, 11, 21, 47, 0);

describe("formatDate", () => {
  it("renders the house convention 'Jun 11, 2026'", () => {
    expect(formatDate(JUN_11)).toBe("Jun 11, 2026");
  });

  it("accepts ISO strings and epoch millis", () => {
    expect(formatDate(JUN_11.toISOString())).toBe(formatDate(JUN_11));
    expect(formatDate(JUN_11.getTime())).toBe("Jun 11, 2026");
  });

  it("returns em dash for null/undefined/invalid", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatDate("")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("renders 'Jun 11, 2026 · 9:47 PM' (middot house convention)", () => {
    expect(formatDateTime(JUN_11)).toBe("Jun 11, 2026 · 9:47 PM");
  });

  it("returns em dash for null/invalid", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("garbage")).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = new Date(2026, 5, 11, 12, 0, 0);
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("renders 'just now' under a minute", () => {
    expect(formatRelative(now, now)).toBe("just now");
    expect(formatRelative(ago(30_000), now)).toBe("just now");
    expect(formatRelative(ago(59_999), now)).toBe("just now");
  });

  it("renders minutes under an hour", () => {
    expect(formatRelative(ago(MINUTE), now)).toBe("1m ago");
    expect(formatRelative(ago(5 * MINUTE), now)).toBe("5m ago");
    expect(formatRelative(ago(59 * MINUTE + 59_000), now)).toBe("59m ago");
  });

  it("renders hours under a day", () => {
    expect(formatRelative(ago(HOUR), now)).toBe("1h ago");
    expect(formatRelative(ago(2 * HOUR), now)).toBe("2h ago");
    expect(formatRelative(ago(23 * HOUR + 59 * MINUTE), now)).toBe("23h ago");
  });

  it("renders days up to a week", () => {
    expect(formatRelative(ago(DAY), now)).toBe("1d ago");
    expect(formatRelative(ago(3 * DAY), now)).toBe("3d ago");
    expect(formatRelative(ago(7 * DAY), now)).toBe("7d ago");
  });

  it("falls back to formatDate past 7 days", () => {
    const old = ago(8 * DAY); // Jun 3, 2026 local
    expect(formatRelative(old, now)).toBe(formatDate(old));
    expect(formatRelative(old, now)).toBe("Jun 3, 2026");
  });

  it("treats small future skew as 'just now', larger future as absolute date", () => {
    expect(formatRelative(new Date(now.getTime() + 30_000), now)).toBe("just now");
    const future = new Date(now.getTime() + 3 * DAY);
    expect(formatRelative(future, now)).toBe(formatDate(future));
  });

  it("accepts epoch millis for `now`", () => {
    expect(formatRelative(ago(2 * HOUR), now.getTime())).toBe("2h ago");
  });

  it("returns em dash for null/invalid", () => {
    expect(formatRelative(null, now)).toBe("—");
    expect(formatRelative("bogus", now)).toBe("—");
  });
});
