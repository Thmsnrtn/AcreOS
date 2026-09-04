/**
 * The founder's leading indicators must be measured, or absent — never plausible.
 *
 * ── WHAT SHIPPED ────────────────────────────────────────────────────────────
 * `GET /api/founder/leading-indicators` returned six indicators. Four were
 * invented, and one of those four named real organizations beside invented
 * figures:
 *
 *   featureStickiness    five hardcoded constants (0.72, 0.68, 0.85, 0.45,
 *                        0.31) labelled "daily return rate".
 *   supportCategoryShift three categories derived from ONE real user_feedback
 *                        count by arithmetic — `count - 2`, `count * 0.3`,
 *                        `count * 0.2` — with hardcoded up/down arrows.
 *                        `user_feedback` has no category column. `support_cases`
 *                        does, and was imported by this file and never read.
 *   expansionSignals     the first three orgs by `limit(10).slice(0, 3)`, with
 *                        `usagePercent: 75 + i * 8` and `daysToLimit: 14 - i * 3`.
 *   referralPropensity   `totalOrgs * 0.1` and `totalOrgs * 0.3`.
 *
 * `check-no-fabrication.mjs` read this file every run and passed it: it forbids
 * non-deterministic value SOURCES, and a constant is deterministic. Rules D and
 * E of check-measurement-defaults.mjs now cover the shapes generically, with
 * canaries built from this exact source.
 *
 * ── WHAT THIS FILE PINS THAT NO GATE CAN ────────────────────────────────────
 * Two properties that are about MEANING rather than shape:
 *
 *   1. `referralPropensity` stays null. There is no referral data in this
 *      schema — no referrals table, no referral-link events, nothing recording
 *      a referrer. Rule D exempts zero (it is the honest empty for a count), so
 *      `activeReferrers: 0` would sail through every gate while telling the
 *      founder we measured zero referrers. We did not measure anything.
 *
 *   2. "No data" is null, never 0, in every field that can be absent. A
 *      briefing that reports 0 when it failed to read is the same lie in a
 *      quieter voice — and this is the shape the catch block returns, which is
 *      the path nobody exercises and therefore the one that rots.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const SRC = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/leadingIndicators.ts"), "utf8"),
);

describe("leading indicators", () => {
  it("reports no referral propensity, because nothing measures referrals", () => {
    expect(
      SRC,
      "referralPropensity is no longer typed as null. If referral tracking now " +
        "exists, this test should assert the MEASUREMENT; if it does not, a " +
        "number here is invented. There is no third option.",
    ).toMatch(/referralPropensity:\s*null;/);
    expect(
      SRC,
      "the returned value is not literally null. `activeReferrers: 0` would " +
        "pass every gate in this repository and still tell the founder we " +
        "counted zero referrers rather than that we cannot count them.",
    ).toMatch(/referralPropensity:\s*null,/);
    expect(
      SRC,
      "a referral figure is being derived from an organization count again.",
    ).not.toMatch(/activeReferrers|referralLinkClicks/);
  });

  it("distinguishes 'not measured' from 'measured zero' in every optional field", () => {
    // Each of these is a field whose absence is possible and meaningful.
    for (const field of [
      "changePercent",
      "dailyReturnRate",
      "avgPagesPerSession",
      "daysToLimit",
    ]) {
      expect(
        SRC,
        `${field} is no longer nullable. Its absence then renders as 0, which ` +
          "reads as a measurement of nothing rather than nothing measured.",
      // toContain, not a built RegExp. The first version of this line was
      // `new RegExp(\`${field}:\\s*number \\| null\`)`, and the escaping
      // collapsed the pipe into an ALTERNATION: the pattern became
      // `field:\s*number` OR ` null`, and " null" occurs all over this file, so
      // the assertion matched unconditionally. It passed before AND after the
      // type was changed back to `number` — found by mutating the type and
      // watching the test stay green, which is the only way that class is ever
      // found.
      ).toContain(`${field}: number | null`);
    }
  });

  it("takes support categories from the column that has them", () => {
    expect(
      SRC,
      "the support-category shift no longer groups by supportCases.category. " +
        "The previous version manufactured three categories from a " +
        "user_feedback count while this column sat imported and unread.",
    ).toContain("groupBy(supportCases.category)");
    expect(
      SRC,
      "user_feedback is being read for categories again. It has no category " +
        "column — only `page` and free-text `feedback`.",
    ).not.toContain("userFeedback");
  });

  it("derives the door list from the canonical nav model, and measures each door", () => {
    // The five customer doors are a standing founder decision (CLAUDE.md).
    for (const slug of ["today", "map", "deals", "money", "ai-hub"]) {
      expect(SRC, `the ${slug} door is missing from the stickiness population`).toContain(
        `door: "${slug}"`,
      );
    }
    expect(
      SRC,
      "the return rate is no longer computed from users and returning users, " +
        "so it is a number with nothing behind it.",
    ).toContain("returningUsers / users");
  });

  it("uses the shared plan limits rather than its own", () => {
    expect(
      SRC,
      "expansion signals no longer read the shared plan-limit table. Two " +
        "definitions of 'approaching your limit' is one too many — the upsell " +
        "email in jobs/growthAutomation.ts reads the same one.",
    ).toContain('from "./planLimits"');
    expect(
      SRC,
      "a usage percentage is being computed from something other than a real " +
        "count against a real limit.",
    ).toMatch(/usagePercent:\s*Math\.round\(usage \* 100\)/);
  });

  it("the failure path returns absence, not zeros", () => {
    const at = SRC.indexOf("const empty: LeadingIndicators");
    expect(at, "the no-data shape is gone").toBeGreaterThan(-1);
    const shape = SRC.slice(at, SRC.indexOf("};", at) + 2);
    expect(shape).toMatch(/changePercent:\s*null/);
    expect(shape).toMatch(/avgPagesPerSession:\s*null/);
    expect(shape).toMatch(/trend:\s*"unknown"/);
    expect(shape).toMatch(/referralPropensity:\s*null/);
  });
});
