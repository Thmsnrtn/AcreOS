import { describe, it, expect } from "vitest";
import { visitDurationMinutes } from "../../server/routes-field-scout";

describe("visitDurationMinutes — derived field-scout visit duration", () => {
  it("computes whole minutes between started_at and completed_at", () => {
    expect(visitDurationMinutes("2026-06-15T10:00:00Z", "2026-06-15T10:23:00Z")).toBe(23);
    expect(visitDurationMinutes(new Date("2026-06-15T10:00:00Z"), new Date("2026-06-15T10:30:30Z"))).toBe(31); // rounds
  });

  it("returns null when either timestamp is missing", () => {
    expect(visitDurationMinutes(null, "2026-06-15T10:23:00Z")).toBeNull();
    expect(visitDurationMinutes("2026-06-15T10:00:00Z", undefined)).toBeNull();
    expect(visitDurationMinutes(null, null)).toBeNull();
  });

  it("returns null for non-positive or invalid intervals (no negative durations)", () => {
    expect(visitDurationMinutes("2026-06-15T10:23:00Z", "2026-06-15T10:00:00Z")).toBeNull(); // end before start
    expect(visitDurationMinutes("2026-06-15T10:00:00Z", "2026-06-15T10:00:00Z")).toBeNull(); // zero
    expect(visitDurationMinutes("not-a-date", "2026-06-15T10:23:00Z")).toBeNull();
  });
});
