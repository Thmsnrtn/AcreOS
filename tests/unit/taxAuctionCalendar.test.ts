/**
 * V-Tax-1 T3b — the auction calendar in the county's time zone and the
 * bidder-registration gate. Pure. SYNTHETIC.
 *
 *   - a local wall-clock time becomes the right instant in the county's zone,
 *     across zones and across a DST change, whatever zone the process is in;
 *   - with no zone stated, no time is shown and no countdown is computed,
 *     even when a time of day was given;
 *   - a date-only registration deadline is "closed" only once its date has
 *     passed everywhere, never earlier;
 *   - registration: an item whose requirement is not stated is open, never
 *     assumed not required; "registered as a bidder" can only be done.
 */
import { describe, expect, it } from "vitest";
import { auctionCalendar, registrationStanding, type AuctionCalendarRecord } from "@shared/tax/auctionCalendar";

const zone = (value: string) => ({ value, source: "SYNTHETIC county sale notice", asOf: "2026-10-01" });
const rec = (r: Partial<AuctionCalendarRecord>): AuctionCalendarRecord => ({ timeZone: null, startTimeLocal: null, registrationDeadline: null, funds: null, ...r });
const now = new Date("2026-10-29T12:00:00Z");
const startOf = (saleDate: string, r: AuctionCalendarRecord) => auctionCalendar(saleDate, r, now).start;

describe("a sale time is the county's", () => {
  const cases: Array<[string, string, string, string]> = [
    ["America/Phoenix", "2026-11-04", "10:00", "2026-11-04T17:00:00.000Z"], // MST, no DST
    ["America/New_York", "2026-11-04", "10:00", "2026-11-04T15:00:00.000Z"], // EST, after fall-back
    ["America/Chicago", "2026-07-01", "10:00", "2026-07-01T15:00:00.000Z"], // CDT
    ["America/Chicago", "2026-03-08", "10:00", "2026-03-08T15:00:00.000Z"], // the day DST starts, after the jump
    ["Pacific/Honolulu", "2026-12-01", "09:30", "2026-12-01T19:30:00.000Z"],
  ];
  for (const [z, d, t, iso] of cases) {
    it(`${d} ${t} in ${z} is ${iso}`, () => {
      const m = startOf(d, rec({ timeZone: zone(z), startTimeLocal: t }));
      expect(m).toMatchObject({ status: "timed", local: `${d} ${t}`, zone: z, instant: iso });
    });
  }

  it("counts down from now to the county's instant", () => {
    const m = startOf("2026-10-30", rec({ timeZone: zone("America/Chicago"), startTimeLocal: "10:00" }));
    expect(m).toMatchObject({ status: "timed", hoursFromNow: 27 }); // 2026-10-30 15:00Z − 2026-10-29 12:00Z
  });
});

describe("no zone, no time", () => {
  it("a stated time with no zone shows the date only, and says why", () => {
    expect(startOf("2026-11-04", rec({ startTimeLocal: "10:00" }))).toEqual({ status: "date_only", date: "2026-11-04", why: "the county's time zone is not stated, so no time is shown" });
  });
  it("a zone with no time shows the date only", () => {
    expect(startOf("2026-11-04", rec({ timeZone: zone("America/Chicago") }))).toMatchObject({ status: "date_only", why: "no time of day is stated" });
  });
  it("no calendar at all is a date, not a time", () => {
    expect(auctionCalendar("2026-11-04", null, now).start).toMatchObject({ status: "date_only" });
  });
});

describe("the registration deadline", () => {
  it("timed: closed once its instant has passed", () => {
    const at = (iso: string) => auctionCalendar("2026-11-04", rec({ timeZone: zone("America/Chicago"), registrationDeadline: { date: "2026-10-29", timeLocal: "17:00", source: "SYNTHETIC" } }), new Date(iso)).registration!;
    expect(at("2026-10-29T21:59:00Z").closed).toBe(false); // 16:59 CDT
    expect(at("2026-10-29T22:01:00Z").closed).toBe(true); // 17:01 CDT
  });
  it("date-only: never claimed closed while the date is still running anywhere", () => {
    const at = (iso: string) => auctionCalendar("2026-11-04", rec({ registrationDeadline: { date: "2026-10-29", timeLocal: null, source: "SYNTHETIC" } }), new Date(iso)).registration!;
    expect(at("2026-10-30T06:00:00Z").closed).toBe(false); // still Oct 29 in parts of the US
    expect(at("2026-10-30T12:00:00Z").closed).toBe(true); // Oct 29 is over everywhere
  });
});

describe("registration is a stage gate", () => {
  const req = (status: "required" | "not_required") => ({ status, source: "SYNTHETIC county bidder packet", asOf: "2026-10-01" });
  const done = { at: "2026-10-28T15:00:00.000Z", byUserId: "u", note: "SYNTHETIC receipt" };

  it("nothing stated is incomplete, and nothing is assumed not required", () => {
    const s = registrationStanding(null);
    expect(s.complete).toBe(false);
    expect(s.items.map((i) => [i.key, i.state])).toEqual([
      ["deposit", "not_stated"], ["funds", "not_stated"], ["entity_docs", "not_stated"], ["w9", "not_stated"], ["bidder_registration", "required_open"],
    ]);
  });
  it("each item resolved by done or a sourced not-required completes it; registering is always required", () => {
    const s = registrationStanding({
      deposit: { requirement: req("required"), done },
      funds: { requirement: req("required"), done },
      entity_docs: { requirement: req("not_required"), done: null },
      w9: { requirement: req("required"), done },
      bidder_registration: { requirement: null, done },
    });
    expect(s.complete).toBe(true);
    expect(s.items.find((i) => i.key === "entity_docs")!.why).toBe("not required — SYNTHETIC county bidder packet, as of 2026-10-01");
  });
  it("one required item not done keeps the gate shut", () => {
    const s = registrationStanding({
      deposit: { requirement: req("required"), done: null },
      funds: { requirement: req("not_required"), done: null },
      entity_docs: { requirement: req("not_required"), done: null },
      w9: { requirement: req("not_required"), done: null },
      bidder_registration: { requirement: null, done },
    });
    expect(s.complete).toBe(false);
    expect(s.items.filter((i) => i.state === "required_open").map((i) => i.key)).toEqual(["deposit"]);
  });
  it("a stated not-required does not stand in for registering as a bidder", () => {
    const s = registrationStanding({ bidder_registration: { requirement: req("not_required"), done: null } });
    expect(s.items.find((i) => i.key === "bidder_registration")!.state).toBe("required_open");
  });
});
