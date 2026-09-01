/**
 * Statute-register ratchet — the meta-gate over the compliance inventory.
 *
 * Statute-implementing code is indistinguishable from ordinary code: nothing
 * marks it, nothing lists it, and in one recent program FIVE separate legal
 * obligations were encoded materially wrong while passing every gate. The
 * register (shared/governance/statuteRegister.ts) is the list. This ratchet is
 * what stops the list from rotting into fiction:
 *
 *   1. Every `codeSites` path must resolve — a register pointing at a deleted
 *      file is a compliance claim with no implementation behind it.
 *   2. Every `unit-test` enforcement claim must name a test file that exists —
 *      otherwise "checked by a test" is just a word in a data structure.
 *   3. Ids are unique and stably namespaced.
 *   4. The UNREVIEWED count may only SHRINK. That number is the honest
 *      headline — how many laws this platform implements that no lawyer has
 *      read — and the register's whole purpose is to drive it down.
 *   5. Nothing may claim `attorney-reviewed` without a date. (Today, nothing
 *      may claim it at all: nothing in this repo has been.)
 *
 * Modelled on tests/unit/constitution.test.ts. When a statute gets a real
 * review, change its reviewStatus in the register and LOWER the baseline below
 * in the SAME commit — fix the occurrence, not the baseline.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  STATUTE_REGISTER,
  statuteById,
  unreviewed,
  unenforced,
  refusalOnly,
  type StatuteEntry,
} from "@shared/governance/statuteRegister";

const ROOT = path.resolve(__dirname, "../..");

/**
 * Entries implementing a legal obligation that NO LAWYER HAS READ.
 * May only DECREASE.
 *
 * 2026-08-01 (initial): 29 of 31 entries. Expected to be high — a solo founder
 *   with zero customers and no counsel on retainer. The two exceptions are
 *   `founder-reviewed` against dated decisions in
 *   docs/company/founder-decisions-2026-07-28.md:
 *     - money.no-platform-custody (§15, "be the rail, not the provider")
 *     - tcpa.dnc-and-litigator-scrub (§13, DNC vendor + coverage)
 *   Neither is an attorney review, and both carry a `reviewScope` saying
 *   exactly what the founder did and did not decide.
 *
 *   Lowering this number requires a REAL review recorded somewhere citable —
 *   not a session's confidence that the code looks right.
 */
const UNREVIEWED_BASELINE = 29;

const isTestFile = (p: string) => /\.test\.tsx?$/.test(p);

describe("statute register — shape", () => {
  it("is not empty", () => {
    expect(STATUTE_REGISTER.length).toBeGreaterThan(0);
  });

  it("every entry has the required non-empty fields", () => {
    for (const e of STATUTE_REGISTER) {
      expect(e.id, "id").toBeTruthy();
      expect(e.citation, `${e.id} citation`).toBeTruthy();
      expect(e.what, `${e.id} what`).toBeTruthy();
      expect(e.codeSites.length, `${e.id} codeSites`).toBeGreaterThan(0);
      expect(e.enforcement.refs.length, `${e.id} enforcement.refs`).toBeGreaterThan(0);
      expect(e.failureMode, `${e.id} failureMode`).toBeTruthy();
    }
  });

  it("failureMode says what happens to whom, not just 'it breaks'", () => {
    // The field that makes the register worth reading. A one-clause
    // failureMode is a placeholder; hold a floor so it stays a sentence.
    const thin = STATUTE_REGISTER.filter((e) => e.failureMode.length < 60).map((e) => e.id);
    expect(thin, `failureMode too thin to be useful: ${thin.join(", ")}`).toEqual([]);
  });

  it("ids are unique and kebab/dot-namespaced", () => {
    const ids = STATUTE_REGISTER.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
  });

  it("statuteById round-trips", () => {
    expect(statuteById("respa.early-intervention-36d")?.enforcement.kind).toBe("unit-test");
    expect(statuteById("nope")).toBeUndefined();
  });
});

describe("statute register — every pointer is real", () => {
  it("every codeSites path resolves to a file that exists", () => {
    const missing: string[] = [];
    for (const e of STATUTE_REGISTER) {
      for (const site of e.codeSites) {
        if (!fs.existsSync(path.join(ROOT, site))) missing.push(`${e.id} → ${site}`);
      }
    }
    expect(
      missing,
      `codeSites pointing at files that do not exist (the register claims an ` +
        `implementation that is gone):\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("every enforcement ref resolves to a file that exists", () => {
    const missing: string[] = [];
    for (const e of STATUTE_REGISTER) {
      for (const ref of e.enforcement.refs) {
        if (!fs.existsSync(path.join(ROOT, ref))) missing.push(`${e.id} → ${ref}`);
      }
    }
    expect(missing, `stale enforcement pointers:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every entry claiming enforcement 'unit-test' names a test file that exists", () => {
    const bad: string[] = [];
    for (const e of STATUTE_REGISTER) {
      if (e.enforcement.kind !== "unit-test") continue;
      const tests = e.enforcement.refs.filter(
        (r) => isTestFile(r) && fs.existsSync(path.join(ROOT, r)),
      );
      if (tests.length === 0) bad.push(e.id);
    }
    expect(
      bad,
      `entries claiming 'unit-test' with no existing *.test.ts ref — the claim ` +
        `is unbacked: ${bad.join(", ")}`,
    ).toEqual([]);
  });

  it("entries claiming 'ratchet' also name a test file", () => {
    const bad = STATUTE_REGISTER.filter(
      (e) =>
        e.enforcement.kind === "ratchet" &&
        !e.enforcement.refs.some((r) => isTestFile(r) && fs.existsSync(path.join(ROOT, r))),
    ).map((e) => e.id);
    expect(bad, `'ratchet' entries with no ratchet test: ${bad.join(", ")}`).toEqual([]);
  });

  // Audit F-15-2: the checks above verify a pointer FILE EXISTS — not that it
  // actually enforces the statute. A statute tagged 'unit-test' pointing at an
  // empty or fully-skipped test file passed green ("false assurance ships
  // green"). These two assertions verify the CLAIM, not just the pointer:
  // the enforcement test must contain real assertions and must not be skipped.
  it("every 'unit-test' enforcement ref actually asserts something (not a hollow file)", () => {
    const hollow: string[] = [];
    for (const e of STATUTE_REGISTER) {
      if (e.enforcement.kind !== "unit-test") continue;
      for (const ref of e.enforcement.refs) {
        if (!isTestFile(ref)) continue;
        const full = path.join(ROOT, ref);
        if (!fs.existsSync(full)) continue; // existence is the prior test's job
        if (!/\bexpect\s*\(/.test(fs.readFileSync(full, "utf8"))) hollow.push(`${e.id} → ${ref}`);
      }
    }
    expect(
      hollow,
      `'unit-test' enforcement refs with NO expect() — the register claims the ` +
        `statute is tested but the file asserts nothing:\n${hollow.join("\n")}`,
    ).toEqual([]);
  });

  it("no 'unit-test' enforcement ref is entirely skipped (a skipped enforcement test is a false green)", () => {
    const skipped: string[] = [];
    for (const e of STATUTE_REGISTER) {
      if (e.enforcement.kind !== "unit-test") continue;
      for (const ref of e.enforcement.refs) {
        if (!isTestFile(ref)) continue;
        const full = path.join(ROOT, ref);
        if (!fs.existsSync(full)) continue;
        const src = fs.readFileSync(full, "utf8");
        const liveCases = (src.match(/\b(?:it|test)\s*\(/g) || []).length;
        const skippedCases = (src.match(/\b(?:it|test|describe)\s*\.\s*(?:skip|todo)\s*\(/g) || []).length;
        const topSkippedSuite = /\bdescribe\s*\.\s*(?:skip|todo)\s*\(/.test(src);
        // Flagged only when the file has tests but ZERO of them can run — i.e.
        // a top-level describe.skip, or every it/test is .skip/.todo. This
        // never false-positives on a large file with one unrelated skip.
        if ((topSkippedSuite || (skippedCases > 0 && liveCases === 0)) && (liveCases + skippedCases) > 0) {
          skipped.push(`${e.id} → ${ref}`);
        }
      }
    }
    expect(
      skipped,
      `'unit-test' enforcement refs that are entirely skipped — the assertion ` +
        `never runs, so the statute is unenforced behind a green pointer:\n${skipped.join("\n")}`,
    ).toEqual([]);
  });
});

describe("statute register — review honesty", () => {
  it("no entry claims 'attorney-reviewed' (nothing in this repo has been)", () => {
    const claimed = STATUTE_REGISTER.filter(
      (e) => e.reviewStatus === "attorney-reviewed",
    ).map((e) => e.id);
    expect(
      claimed,
      `entries claiming attorney review: ${claimed.join(", ")}. If an attorney ` +
        `HAS reviewed one, delete this assertion and keep the dated-review one ` +
        `below — but only with the engagement recorded in docs/.`,
    ).toEqual([]);
  });

  it("no reviewed entry lacks a date", () => {
    const undated = STATUTE_REGISTER.filter(
      (e) => e.reviewStatus !== "UNREVIEWED" && !e.reviewedAt,
    ).map((e) => e.id);
    expect(
      undated,
      `reviewed without a date — an undated review is not a review: ${undated.join(", ")}`,
    ).toEqual([]);
  });

  it("review dates are ISO YYYY-MM-DD and reviews name their scope", () => {
    for (const e of STATUTE_REGISTER as readonly StatuteEntry[]) {
      if (e.reviewStatus === "UNREVIEWED") continue;
      expect(e.reviewedAt, `${e.id} reviewedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        e.reviewScope,
        `${e.id} must state WHAT the review actually covered — a bare ` +
          `'founder-reviewed' overstates a decision about something adjacent`,
      ).toBeTruthy();
    }
  });

  it("every founder-reviewed entry points at a docs/company decision that exists", () => {
    const bad: string[] = [];
    for (const e of STATUTE_REGISTER) {
      if (e.reviewStatus !== "founder-reviewed") continue;
      const match = /docs\/company\/[\w.-]+\.md/.exec(e.reviewScope ?? "");
      if (!match || !fs.existsSync(path.join(ROOT, match[0]))) bad.push(e.id);
    }
    expect(
      bad,
      `founder-reviewed entries whose recorded decision cannot be found: ${bad.join(", ")}`,
    ).toEqual([]);
  });
});

describe("statute register ratchet — UNREVIEWED may only shrink", () => {
  it("the UNREVIEWED count never exceeds the baseline", () => {
    const debt = unreviewed().map((e) => e.id);
    expect(
      debt.length,
      `UNREVIEWED statute implementations (${debt.length}) exceed the baseline ` +
        `(${UNREVIEWED_BASELINE}). This number is how many laws AcreOS implements ` +
        `that no lawyer has read. Adding a NEW statute implementation without a ` +
        `review raises it — which is the signal. If you genuinely got one ` +
        `reviewed, lower the baseline in the same commit. Current: ${debt.join(", ")}`,
    ).toBeLessThanOrEqual(UNREVIEWED_BASELINE);
  });

  it("and never sits below it — a review must be locked in", () => {
    // Bidirectional as of 2026-08-19. The upper bound alone meant that getting
    // five statutes reviewed silently created five unclaimed slots for new
    // UNREVIEWED implementations, and the next session could add them green.
    // The comment above already told the reviewer to lower the baseline in the
    // same commit; this makes it so.
    const debt = unreviewed().map((e) => e.id);
    expect(
      debt.length,
      `UNREVIEWED statute implementations (${debt.length}) are BELOW the baseline ` +
        `(${UNREVIEWED_BASELINE}). A review landed — lower UNREVIEWED_BASELINE to ` +
        `${debt.length} in this same commit, or the headroom becomes free slots for ` +
        `the next unreviewed implementation.`,
    ).toBeGreaterThanOrEqual(UNREVIEWED_BASELINE);
  });

  it("vacuity: the register is populated and the predicates select from it", () => {
    // Every count above is derived from STATUTE_REGISTER. If the register were
    // empty, or `unreviewed()` stopped matching, all three bounds would hold
    // trivially and this file would certify a compliance posture nobody has.
    expect(STATUTE_REGISTER.length).toBeGreaterThan(20);
    expect(unreviewed().length).toBeGreaterThan(0);
  });

  it("reports the enforcement mix (informational, and a floor on real coverage)", () => {
    // Not a threshold to game — a visible split so a wave that converts a
    // tested statute back to prose-only shows up in the diff.
    const prose = unenforced().map((e) => e.id);
    const refusal = refusalOnly().map((e) => e.id);
    expect(prose.length + refusal.length).toBeLessThan(STATUTE_REGISTER.length);
    // Audit F-15-2: prose-only statutes have NO automated backstop — the exact
    // "false assurance ships green" shape. Freeze the count down-only (mirrors
    // constitution.ts unenforcedHardStops): a NEW prose-only statute fails, and
    // adding a real test/gate + reclassifying is the only way to lower it.
    const PROSE_ONLY_BASELINE = 3;
    const REFUSAL_ONLY_BASELINE = 1;
    expect(
      prose.length,
      `prose-only statutes (${prose.length}) exceed the baseline (${PROSE_ONLY_BASELINE}). ` +
        `Each implements a law with NO automated enforcement. Add a real test/gate and ` +
        `reclassify, then lower the baseline. Current: ${prose.join(", ")}`,
    ).toBeLessThanOrEqual(PROSE_ONLY_BASELINE);
    expect(
      refusal.length,
      `refusal-path-only statutes (${refusal.length}) exceed the baseline ` +
        `(${REFUSAL_ONLY_BASELINE}): ${refusal.join(", ")}`,
    ).toBeLessThanOrEqual(REFUSAL_ONLY_BASELINE);
    // Both directions, for the same reason as UNREVIEWED: converting a
    // prose-only statute to a real gate is the whole point, and leaving the
    // baseline high hands the next session a free slot to add another.
    expect(
      prose.length,
      `prose-only statutes (${prose.length}) are BELOW the baseline ` +
        `(${PROSE_ONLY_BASELINE}) — a statute gained real enforcement. Lower ` +
        `PROSE_ONLY_BASELINE to ${prose.length} in this same commit.`,
    ).toBeGreaterThanOrEqual(PROSE_ONLY_BASELINE);
    expect(
      refusal.length,
      `refusal-path-only statutes (${refusal.length}) are BELOW the baseline ` +
        `(${REFUSAL_ONLY_BASELINE}). Lower REFUSAL_ONLY_BASELINE to ${refusal.length} ` +
        `in this same commit.`,
    ).toBeGreaterThanOrEqual(REFUSAL_ONLY_BASELINE);
    // The five obligations the audits actually got wrong must never fall back
    // to prose — they are the reason this file exists.
    for (const id of [
      "respa.early-intervention-36d",
      "regz.periodic-statement-due-date",
      "regz.periodic-statement-delivery-timing",
      "irs.pub1220-fire-layout",
      "tx.late-fee-cap-92019",
    ]) {
      expect(statuteById(id), `${id} missing from the register`).toBeDefined();
      expect(statuteById(id)!.enforcement.kind, `${id} lost its test`).toBe("unit-test");
    }
  });
});
