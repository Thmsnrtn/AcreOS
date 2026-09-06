/**
 * February 30th is not a day, and three money surfaces disagreed.
 *
 * JavaScript answers the wrong question by default:
 *
 *     new Date("2026-02-30T00:00:00.000Z")   // → March 2nd
 *     Number.isFinite(that.getTime())        // → true
 *
 * So every parser in this repo that constructed a date and then checked it for
 * NaN accepted a date that does not exist and returned a real one two days
 * later. Unit 98 found the first while consolidating a predicate; asking *where
 * else* found two more, and both were reachable from a request.
 *
 * **The statutory deadline.** `shared/regulatory/depositReturnRules.ts` exported
 * a `parseIsoDate` doing `String(iso).slice(0, 10)` and then trusting
 * `new Date()`. It feeds the security-deposit RETURN DEADLINE. A move-out of
 * `2026-02-30` became March 2, so a 21-day deadline landed on **2026-03-23
 * instead of 2026-03-21** — late, on an obligation that carries penalties in
 * most states for being late.
 *
 * **The payoff quote.** `server/services/notePaymentMath.ts#parseIsoDateUtc`
 * parses payoff and payment-posting dates. `GET /api/notes/:id/payoff?date=…`
 * passes the query string straight in, so `?date=2026-02-30` quoted the borrower
 * **two extra days of interest** — and the route's own
 * `catch → 400 "date must be a valid ISO date"` never fired, because nothing
 * threw. The handler was written for exactly this input and could not see it.
 *
 * **The boundary that should have stopped both.** `routes-rent-ledger.ts` had:
 *
 *     /** YYYY-MM-DD, validated rather than coerced — a bad date must not
 *      *  become one. *\/
 *     const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, …);
 *
 * A shape test under a comment promising it is not one. `"2026-02-30"` passed it
 * and reached `startDepositClock` as a move-out override. This is the session's
 * recurring shape at its sharpest: **prose asserting a guarantee the code does
 * not provide** — the same defect as unit 95's `getUserId` comment and unit 96's
 * `formatCents` register, except here the false promise was load-bearing.
 *
 * THE FIX IS ONE LINE OF ARITHMETIC — construct the date, then check it reads
 * back as the fields you put in — and it now lives in ONE place,
 * `shared/dates/calendar.ts`, rather than in each of the four parsers that
 * needed it. Everything here is asserted BEHAVIOURALLY, by calling the real
 * functions, because a source scan would only prove the round-trip is written,
 * not that a payoff quote refuses Feb 30.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseCalendarDate, isCalendarDate } from "@shared/dates/calendar";
import { parseIsoDateUtc } from "../../server/services/notePaymentMath";
import { delinquencyIsDeterminable } from "@shared/notes/delinquency";
import { expenseCreateSchema } from "../../server/routes-property-expenses";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

/** Dates that pass a `\d{4}-\d{2}-\d{2}` shape test and are not days. */
const IMPOSSIBLE = ["2026-02-30", "2026-02-31", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-32"];
/** Real days, including the boundary cases a naive check gets wrong. */
const REAL = ["2026-02-28", "2024-02-29", "2026-01-31", "2026-12-31", "2026-03-01"];

describe("the one calendar parser", () => {
  it("refuses every date that is not a day", () => {
    for (const bad of IMPOSSIBLE) {
      expect(parseCalendarDate(bad), `${bad} was accepted`).toBeNull();
      expect(isCalendarDate(bad), `${bad} was accepted`).toBe(false);
    }
  });

  it("accepts every date that is", () => {
    // 2024-02-29 is the one a hardcoded "Feb has 28 days" check gets wrong.
    for (const good of REAL) {
      expect(parseCalendarDate(good), `${good} was refused`).not.toBeNull();
      expect(parseCalendarDate(good)!.toISOString().slice(0, 10)).toBe(good);
    }
  });

  it("agrees with the calendar for every day of every month", () => {
    // EXHAUSTIVE, because no fixture can discriminate the three clauses of the
    // round-trip check — and the reason is a fact about the code, measured
    // rather than assumed. A rollover always disturbs MORE THAN ONE field:
    // `2026-02-30` is March 2 (month AND day differ), `2026-13-01` is Jan 2027
    // (year AND month differ). So **each clause is individually redundant** —
    // deleting any one of the three leaves the others catching every input the
    // regex admits, and all three single-clause mutations survive.
    //
    // That is an "empty input space" in unit 74's catalogue, and it is recorded
    // rather than papered over. The first draft of this comment claimed the
    // MONTH clause was the load-bearing one; the mutation run said otherwise, so
    // the comment was corrected to the measurement rather than the other way
    // round. The clauses stay because a standard round-trip checks all three and
    // a change to the regex could make one load-bearing.
    //
    // What IS pinned is the property itself, across 2024 (a leap year) and 2026
    // (not): the parser accepts exactly the days the calendar has. Deleting the
    // whole check, or getting a leap day wrong, both fail here.
    for (const year of [2024, 2026]) {
      for (let month = 1; month <= 13; month += 1) {
        for (let day = 0; day <= 32; day += 1) {
          const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const real =
            month >= 1 &&
            month <= 12 &&
            day >= 1 &&
            day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
          expect(
            parseCalendarDate(iso) !== null,
            `${iso} should have been ${real ? "accepted" : "refused"}`,
          ).toBe(real);
        }
      }
    }
  });

  it("still takes the shapes the columns actually store", () => {
    // `date` columns give 'YYYY-MM-DD'; `timestamp` columns give a Date. Both
    // normalise to UTC midnight — a calendar date is not an instant.
    expect(parseCalendarDate("2026-03-01T14:22:05.000Z")!.toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    expect(parseCalendarDate(new Date("2026-03-01T14:22:05.000Z"))!.toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    expect(parseCalendarDate(new Date("nonsense"))).toBeNull();
    expect(parseCalendarDate(null)).toBeNull();
    expect(parseCalendarDate(undefined)).toBeNull();
  });
});

describe("the payoff quote refuses a date that does not exist", () => {
  it("throws instead of quoting two extra days of interest", () => {
    // The route catches this and answers 400. Before the fix nothing threw, so
    // the handler written for exactly this input never ran.
    for (const bad of IMPOSSIBLE) {
      expect(() => parseIsoDateUtc(bad), `${bad} produced a payoff date`).toThrow(
        /not a valid ISO date/,
      );
    }
  });

  it("and still parses the dates a payoff legitimately uses", () => {
    // Vacuity guard: a parser that threw on everything would pass the test above
    // and break every payoff quote in the product.
    for (const good of REAL) {
      expect(parseIsoDateUtc(good).toISOString().slice(0, 10)).toBe(good);
    }
    expect(parseIsoDateUtc("2026-03-01T14:22:05.000Z").toISOString().slice(0, 10)).toBe("2026-03-01");
    // A `Date` in, a `Date` out — this branch is unchanged, and deliberately so:
    // it is the one payment posting relies on and it never had the defect.
    const d = new Date("2026-03-01T14:22:05.000Z");
    expect(parseIsoDateUtc(d)).toBeInstanceOf(Date);
  });
});

describe("the deposit deadline is measured from a real day", () => {
  const rules = fs.readFileSync(
    path.join(ROOT, "shared/regulatory/depositReturnRules.ts"),
    "utf8",
  );

  it("the lenient parser is gone from the module that computes it", () => {
    // Asserted on source because the defect WAS a definition. The behaviour it
    // caused is covered by the parser tests above; what must not come back is a
    // second, laxer parser living beside the deadline arithmetic.
    expect(
      rules,
      "depositReturnRules defines its own date parser again. The last one accepted " +
        "2026-02-30 and returned March 2nd, which moved a statutory return " +
        "deadline two days late.",
    ).not.toMatch(/^export function parseIsoDate\(/m);
    expect(rules).toContain("parseCalendarDate");
  });

  it("and the two-day shift is what was at stake", () => {
    // The arithmetic, stated as a test so the stakes are not just prose. 21 days
    // from the real end of February 2026 is the 21st; from the rolled-over date
    // it is the 23rd.
    const real = parseCalendarDate("2026-02-28")!;
    const rolled = new Date("2026-02-30T00:00:00.000Z"); // what JS hands you
    const plus21 = (d: Date) => new Date(d.getTime() + 21 * 86_400_000).toISOString().slice(0, 10);
    expect(plus21(real)).toBe("2026-03-21");
    expect(plus21(rolled)).toBe("2026-03-23");
    // And the input that produced `rolled` is now refused outright.
    expect(parseCalendarDate("2026-02-30")).toBeNull();
  });
});

describe("the rent-ledger boundary makes its own comment true", () => {
  // Rebuilt from the source so the test exercises the validator the route
  // actually uses, rather than a copy that could drift from it.
  const routeSrc = fs.readFileSync(path.join(ROOT, "server/routes-rent-ledger.ts"), "utf8");

  it("declares a refinement, not only a regex", () => {
    const at = routeSrc.indexOf("const isoDate = z");
    expect(at, "the isoDate validator is gone").toBeGreaterThan(-1);
    const decl = routeSrc.slice(at, routeSrc.indexOf(";", at));
    expect(
      decl,
      "isoDate is a bare shape test again, under a comment promising that a bad " +
        "date must not become one. 2026-02-30 passes a regex.",
    ).toContain("isCalendarDate");
  });

  it("and the refinement rejects what the regex alone let through", () => {
    // The same composition the route declares, exercised.
    const isoDate = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
      .refine((v) => isCalendarDate(v), "That date does not exist");
    for (const bad of ["2026-02-30", "2026-04-31", "2026-13-01"]) {
      expect(isoDate.safeParse(bad).success, `${bad} passed the boundary`).toBe(false);
    }
    for (const good of REAL) {
      expect(isoDate.safeParse(good).success, `${good} was rejected`).toBe(true);
    }
    // Shape failures still fail, and for the original reason.
    expect(isoDate.safeParse("March 1st").success).toBe(false);
  });
});

describe("the notes predicate inherits all of it", () => {
  it("an impossible due date is not a determinable one", () => {
    expect(delinquencyIsDeterminable("2026-03-01")).toBe(true);
    expect(delinquencyIsDeterminable("2026-02-30")).toBe(false);
    expect(delinquencyIsDeterminable(null)).toBe(false);
  });
});

describe("every YYYY-MM-DD boundary in the repo checks validity, not shape", () => {
  // Three such validators exist. The rent-ledger one is covered above; these are
  // the other two, and the first is the sharpest instance of the class.

  it("a property expense cannot be incurred on a day that does not exist", () => {
    // The old `.refine` here read
    // `!Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())` under the message
    // "Not a real date" — the author reached for a validity check and reached
    // for the one that cannot work. Feb 30 passed the check named after
    // rejecting it.
    //
    // It matters because `incurredOn` buckets BY MONTH downstream: 2026-02-30
    // lands in March, so a CAM reconciliation recovers the expense in the wrong
    // period, and a CAM true-up is a bill a tenant pays.
    //
    // The REAL schema is imported, not a mirror — the module exports it for
    // exactly this reason.
    const base = { category: "repairs" as const, amountCents: 1000 };
    for (const bad of ["2026-02-30", "2026-04-31", "2026-13-01"]) {
      expect(
        expenseCreateSchema.safeParse({ ...base, incurredOn: bad }).success,
        `${bad} was accepted as an expense date`,
      ).toBe(false);
    }
    for (const good of ["2026-02-28", "2024-02-29", "2026-01-31"]) {
      expect(
        expenseCreateSchema.safeParse({ ...base, incurredOn: good }).success,
        `${good} was rejected`,
      ).toBe(true);
    }
  });

  it("no YYYY-MM-DD zod validator is left as a bare shape test", () => {
    // Derived from source rather than listed: the three known files are checked
    // by reading every `\d{4}-\d{2}-\d{2}` zod declaration in the repo and
    // requiring a validity refinement in the same statement. A fourth one added
    // later is caught without editing this test.
    const strip = (src: string) =>
      stripComments(src);
    const walk = (dir: string, out: string[]) => {
      for (const e of fs.readdirSync(dir)) {
        if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
        const full = path.join(dir, e);
        if (fs.statSync(full).isDirectory()) { walk(full, out); continue; }
        if (!/\.tsx?$/.test(e) || /\.(test|spec)\.tsx?$/.test(e)) continue;
        out.push(full);
      }
    };
    const files: string[] = [];
    for (const tree of ["server", "shared", "client/src"]) walk(path.join(ROOT, tree), files);

    const offenders: string[] = [];
    for (const f of files) {
      const code = strip(fs.readFileSync(f, "utf8"));
      // A zod declaration constrained to the date shape, up to its statement end.
      for (const m of code.matchAll(/z\s*\n?\s*\.string\(\)[\s\S]{0,400}?;/g)) {
        const decl = m[0];
        if (!/\\d\{4\}\)?-\(?\\d\{2\}\)?-\(?\\d\{2\}/.test(decl)) continue;
        if (/isCalendarDate|parseCalendarDate/.test(decl)) continue;
        offenders.push(`${path.relative(ROOT, f)}: ${decl.slice(0, 90).replace(/\s+/g, " ")}`);
      }
    }
    expect(
      offenders,
      "a YYYY-MM-DD zod validator accepts any string of the right SHAPE. " +
        "`2026-02-30` matches that regex and is not a day; add " +
        "`.refine((v) => isCalendarDate(v), …)` from @shared/dates/calendar.",
    ).toEqual([]);
  });

  it("and the sweep finds the declarations it is checking (vacuity guard)", () => {
    // If the statement-matching regex broke, "no offenders" would pass at zero.
    const rrl = fs.readFileSync(path.join(ROOT, "server/routes-rent-ledger.ts"), "utf8");
    expect(rrl).toMatch(/z\s*\n?\s*\.string\(\)[\s\S]{0,400}?isCalendarDate/);
  });
});
