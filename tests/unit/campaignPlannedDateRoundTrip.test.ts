/**
 * A campaign's planned date is the day the customer picked, in every timezone.
 *
 * The form did `new Date("2026-11-01")` (UTC midnight) and the detail card did
 * `format(new Date(campaign.scheduledDate), 'PPP')` in local time, so anyone
 * west of UTC saw "Oct 31" for a Nov 1 pick. The date now round-trips through
 * `client/src/lib/calendar-date.ts`: stored at 12:00 UTC, read by UTC parts.
 *
 * Runs in a timezone west of UTC on purpose — in UTC the defect is invisible.
 */
import { describe, it, expect, vi, afterAll } from "vitest";

// Hoisted above the import below: an Intl formatter captures the process
// timezone when it is constructed, at module load.
const ORIGINAL_TZ = vi.hoisted(() => {
  const original = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  return original;
});
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

import {
  calendarDateFromInput,
  calendarDateToInput,
  formatCalendarDate,
} from "@/lib/calendar-date";

/** What the server hands back: the JSON wire form of the stored Date. */
const overTheWire = (d: Date) => JSON.parse(JSON.stringify({ d })).d as string;

describe("planned date round-trip", () => {
  it("VACUITY: this process really is west of UTC", () => {
    expect(new Date("2026-11-01").getDate()).toBe(31); // the defect's precondition
  });

  it("a Nov 1 pick displays as Nov 1 and re-fills the input as 2026-11-01", () => {
    const picked = calendarDateFromInput("2026-11-01")!;
    const stored = overTheWire(picked);
    expect(formatCalendarDate(stored)).toBe("Nov 1, 2026");
    expect(calendarDateToInput(stored)).toBe("2026-11-01");
    expect(calendarDateToInput(picked)).toBe("2026-11-01");
  });

  it("rows already stored at UTC midnight (the old form) display on the picked day", () => {
    const legacy = new Date("2026-11-01").toISOString(); // 2026-11-01T00:00:00.000Z
    expect(formatCalendarDate(legacy)).toBe("Nov 1, 2026");
    expect(calendarDateToInput(legacy)).toBe("2026-11-01");
  });

  it("empty and invalid input are nothing, never a fabricated date", () => {
    expect(calendarDateFromInput("")).toBeUndefined();
    expect(calendarDateFromInput("not-a-date")).toBeUndefined();
    expect(formatCalendarDate(null)).toBe("—");
    expect(calendarDateToInput(undefined)).toBe("");
  });

  it("the campaign form and detail card use these helpers, not a local-time parse", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(
      fs.readFileSync(path.resolve(__dirname, "../../client/src/components/campaigns-content.tsx"), "utf8"),
    );
    expect(src).toContain("calendarDateFromInput(e.target.value)");
    expect(src).toContain("formatCalendarDate(campaign.scheduledDate)");
    expect(src).not.toMatch(/format\(new Date\(campaign\.scheduledDate\)/);
    // Honest copy: nothing on the server sends on this date.
    expect(src).toMatch(/not sent automatically/i);
  });
});
