/**
 * The measurement-defaults gate, gated.
 *
 * ── WHY A TEST FOR A LINT ───────────────────────────────────────────────────
 * `lint:no-fabrication` is the cautionary tale this file exists to avoid
 * repeating. It enforces "no invented numbers, no fake activity, no
 * placeholder data presented as real" — by scanning for `Math.random`. So it
 * proves a SYMBOL is absent and says nothing about the shape that actually
 * shipped four times to live customer surfaces:
 *
 *     compsMedianPricePerAcre || 1000   -> a billable AVM
 *     marketData?.avgDaysOnMarket || 90 -> a market intelligence report
 *     parcel.acreage || 5               -> three dollar offer amounts
 *     parcel.acreage ?? 1               -> an offer batch
 *
 * `check-measurement-defaults.mjs` is the falsified-against-the-behaviour
 * version. A gate like that is only worth its baseline if it demonstrably
 * FIRES, so this file mutates the thing it governs and watches it fail — and
 * asserts the negative direction too, because a gate that fires on everything
 * gets disabled within a week.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../..");
const LINT = path.join(ROOT, "scripts/check-measurement-defaults.mjs");

/** Measured 2026-09-04. Down-only: a fix DELETES its baseline line. */
const BASELINE_CEILING = 106;
// 100 -> 106 on 2026-09-04, same day and the same single permitted reason: the
// GATE got wider. Two more rule families landed —
//
//   RULE D, a HARDCODED ROW: a name-like key bound to a string literal beside
//   an observation-only measurement bound to a number, in one object literal.
//   `{ feature: "Deal Feed", dailyReturnRate: 0.72 }`, five of them, feeding
//   the founder's briefing a per-feature return rate measured from nothing.
//
//   RULE E, a MEASUREMENT DERIVED FROM ARRAY POSITION: `usagePercent: 75 + i * 8`
//   and `daysToLimit: 14 - i * 3`, attached to REAL organization names and
//   presented as "orgs approaching plan limits". The org was real; the
//   percentage was its index.
//
// `check-no-fabrication.mjs` read that file every run and passed it, because it
// forbids non-deterministic value SOURCES — Math.random, seeded PRNGs — and a
// hardcoded constant is perfectly deterministic. Same lie, quieter mechanism.
// The seven new entries are the two families rule D was deliberately narrowed
// AROUND (a commission schedule and base/bull/bear scenarios, both DECISIONS,
// both overridable) and they carry their reasons in the register. The
// fabrications that motivated the rules were FIXED in the same commit, and one
// existing entry was DELETED because the fix removed it.
//
// 69 -> 100 earlier on 2026-09-04, and this is the ONE reason a ceiling here may rise:
// the GATE got wider, not the codebase worse. Three new rule families landed in
// the same commit — a delta key bound to a literal (`dealsChange: 0`), the
// ternary spelling of the same claim (`= prev > 0 ? … : 0`), and a measurement
// multiplied by an assumed growth factor (`totalRevenue * 1.1`) — plus
// `revenue|mrr|arr|spend|cost` added to the measurement vocabulary, which
// widened rule A as well. 69 described a gate that could not see any of that.
//
// The 42 entries that appeared are UNTRIAGED debt, frozen so the new rules can
// fail on anything NEW while the existing population is read down; the register
// itself says so. The four defects that motivated the rules —
// getExecutiveMetrics' three hardcoded deltas and getRevenueMetrics'
// `totalRevenue * 1.1` — were FIXED in that same commit and are deliberately
// not in the register.
//
// A raise for any other reason is a regression wearing a ceiling change.
// 72 -> 69 on 2026-08-18: the last three of the market-measurement group.
// `pasturePerAcre || 1000` produced a $1,250 offer QUOTED TO A PROPERTY OWNER
// in the outreach message; `opportunityScore || 50` produced "Test with 500
// letters" — an instruction to spend money — for a county nothing had scored;
// `marketHealthScore || 50` reported a mid-range market health for a metric
// row that carries none. The first two are the only places in this campaign
// where a fabricated default became a COMMITMENT rather than a score.
// 75 -> 72 on 2026-08-18: the three `dataIntelligenceEngine` county signals.
// `medianDomDays ?? 180` awarded 5 of 35 market-health points to a county
// nobody had measured; `dataQualityScore ?? 0.5` awarded 4 of 20 on the axis
// that is ABOUT how much data exists; `medianHouseholdIncome ?? 50000` asserted
// a demographic. `scoreCounty({})` returned a real TIER — a buy/avoid
// instruction — from those three plus `ruralUrbanCode ?? 5`.
// 77 -> 75 on 2026-08-18: both `note.gracePeriodDays || 10` sites. They printed
// a ten-day grace period into a promissory note (SIGNATURES block included) for
// a note whose record either states nothing or explicitly states ZERO — the
// `||` fires on 0 — while `acquiredNoteAging` measured that same note against
// zero days. The gate reported them stale the moment they were fixed, which is
// the register working; locked in per its down-only rule.
/** Expressions the walk must keep seeing; 2,031 measured 2026-08-18. */
const EXPRESSION_FLOOR = 600;

function run(...args: string[]): { out: string; ok: boolean } {
  try {
    return { out: execFileSync("node", [LINT, ...args], { cwd: ROOT, encoding: "utf8" }), ok: true };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer };
    return { out: String(e.stdout ?? "") + String(e.stderr ?? ""), ok: false };
  }
}

/**
 * Runs the REAL gate over a throwaway tree containing one file.
 *
 * It used to write `__measurement_probe__.ts` into the live
 * `server/services`, run, and delete it. vitest runs test files in parallel and
 * ~69 other suites walk `server/**`, so any of them could list the probe and
 * then fail to read it — producing a RED in an unrelated test, with an fs stack
 * trace rather than an assertion. That happened twice on 2026-08-20, in
 * `modelPrefixGate` and then in `moneyCustodyHardStop`.
 *
 * Tolerating ENOENT in every reader treats the symptom and needs sixty-nine
 * edits that will drift. Not creating and destroying files inside the tree
 * everything else is reading is the fix, so the gate grew a `--root` flag —
 * the same one `lint-reachability` has always had, which is why its self-test
 * never had this problem.
 */
function withProbe(source: string): { out: string; ok: boolean } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "measurement-probe-"));
  const services = path.join(dir, "server", "services");
  fs.mkdirSync(services, { recursive: true });
  fs.writeFileSync(path.join(services, "probe.ts"), source);
  try {
    return run("--root", dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("the gate is wired and sees a real population", () => {
  // 120s, not the 30s default: this shells out to the REAL gate over ~1500
  // files. Its sibling in reachabilityGate.test.ts timed out under the full
  // suite's parallelism on 2026-08-19 — a red that looks like a finding and
  // is not. Same budget here, for the same reason.
  it("passes on the current tree, at or below its ceiling", () => {
    const { out, ok } = run();
    expect(out, `the lint is not passing:\n${out}`).toContain("[measurement-defaults] PASS");
    expect(ok).toBe(true);

    const m = /baseline (\d+), new (\d+), stale (\d+)/.exec(out);
    expect(m, `the verdict line changed shape:\n${out}`).not.toBeNull();
    expect(
      Number(m![1]),
      "the register GREW. Every entry is a measured field replaced by a " +
        "constant. Make the absence representable; do not baseline it.",
    ).toBeLessThanOrEqual(BASELINE_CEILING);
    expect(Number(m![2]), "a new measurement default").toBe(0);
    expect(
      Number(m![3]),
      "a baseline entry no longer matches — delete the line in the commit " +
        "that fixed it. A stale-high baseline is free headroom.",
    ).toBe(0);
  }, 120_000);

  it("walks a real population and self-tests its own predicate (vacuity)", () => {
    const { out } = run();
    const m = /walked (\d+) server files; (\d+) `x\.y \?\? N` expressions considered; predicate self-test: (\d+)\/(\d+) correct/.exec(out);
    expect(m, `the coverage line is gone:\n${out}`).not.toBeNull();
    expect(Number(m![1]), "the server walk collapsed").toBeGreaterThan(500);
    expect(
      Number(m![2]),
      `only ${m![2]} expressions considered (floor ${EXPRESSION_FLOOR}). A walk ` +
        "that sees nothing certifies every number in the repo. Do NOT lower " +
        "this floor.",
    ).toBeGreaterThan(EXPRESSION_FLOOR);
    expect(Number(m![3]), "the predicate self-test is not fully passing").toBe(Number(m![4]));
    expect(Number(m![4]), "the predicate self-test lost its cases").toBeGreaterThanOrEqual(8);
  });
});

describe("it fires on the behaviour, not on a literal", () => {
  it("catches the exact deal-feed acreage default", () => {
    const { out, ok } = withProbe(
      "export function priceParcel(parcel: { acreage?: number | null }, perAcre: number) {\n" +
        "  return perAcre * (parcel.acreage || 5);\n}\n",
    );
    expect(out).toContain("probe.ts");
    expect(out).toMatch(/parcel\.acreage \|\| 5/);
    expect(ok, "the lint reported the finding and still exited zero").toBe(false);
  });

  it("catches an EQUIVALENT representation — different metric, different operator, different number", () => {
    // The gate must govern "a measured field silently becomes a constant",
    // not the specific constants that were there when it was written.
    const { out, ok } = withProbe(
      "export function readIncome(row: { medianHouseholdIncome?: number | null }) {\n" +
        "  return row.medianHouseholdIncome ?? 48250;\n}\n",
    );
    expect(out).toMatch(/row\.medianHouseholdIncome \?\? 48250/);
    expect(ok).toBe(false);
  });

  it("does NOT fire on a caller-supplied knob", () => {
    // The discriminator, from the other side. A gate that fires on every `??`
    // is disabled within a week, and then guards nothing at all.
    const { out, ok } = withProbe(
      "export function windowDays(opts: { days?: number }) {\n  return opts.days ?? 30;\n}\n",
    );
    expect(out, `a caller-supplied default was flagged:\n${out}`).toContain(
      "[measurement-defaults] PASS",
    );
    expect(ok).toBe(true);
  });

  it("does NOT fire on a zero default", () => {
    // 0 is the honest empty and the standard divide-by-zero guard.
    const { out, ok } = withProbe(
      "export function total(row: { salesVolume?: number | null }) {\n  return row.salesVolume || 0;\n}\n",
    );
    expect(out).toContain("[measurement-defaults] PASS");
    expect(ok).toBe(true);
  });

  // ── RULE D — the hardcoded row (added 2026-09-04) ─────────────────────────
  // The motivating source, verbatim from what shipped in
  // leadingIndicators.computeLeadingIndicators. Kept as a fixture rather than
  // a memory: the code is fixed, and the only thing that can prove the gate
  // still governs it is the defect itself, run through the gate.

  it("catches a hardcoded row: a labelled feature beside an invented rate", () => {
    const { out, ok } = withProbe(
      "export const stickiness = [\n" +
        '  { feature: "Deal Feed", dailyReturnRate: 0.72 },\n' +
        '  { feature: "Pipeline", dailyReturnRate: 0.68 },\n' +
        "];\n",
    );
    expect(out, `the hardcoded rows were not reported:\n${out}`).toMatch(
      /dailyReturnRate\s*:\s*row 0\.72/,
    );
    expect(out).toMatch(/dailyReturnRate\s*:\s*row 0\.68/);
    expect(ok).toBe(false);
  });

  it("does NOT fire on a DECIDED rate in a labelled row", () => {
    // The discriminator from the other side, and the reason rule D uses a
    // narrower vocabulary than rule A. A retention period, a price and a
    // permit duration are things the company DECIDES; firing on them would put
    // ~100 legitimate constants in the register and teach the next author that
    // this gate is noise.
    const { out, ok } = withProbe(
      "export const policy = [\n" +
        '  { name: "Audit log", retainDays: 730 },\n' +
        '  { name: "SMS", costCents: 3 },\n' +
        "];\n",
    );
    expect(out, `a decided constant was flagged:\n${out}`).toContain(
      "[measurement-defaults] PASS",
    );
    expect(ok).toBe(true);
  });

  // ── RULE E — the measurement made of array position ───────────────────────

  it("catches a measurement computed from a loop index", () => {
    const { out, ok } = withProbe(
      "export function signals(orgs: { id: number; name: string }[]) {\n" +
        "  return orgs.map((org, i) => ({\n" +
        "    orgId: org.id,\n" +
        "    orgName: org.name,\n" +
        "    usagePercent: 75 + i * 8,\n" +
        "    daysToLimit: 14 - i * 3,\n" +
        "  }));\n}\n",
    );
    expect(out, `a percentage made of array position was not reported:\n${out}`).toMatch(
      /usagePercent\s*:\s*index/,
    );
    expect(out).toMatch(/daysToLimit\s*:\s*index/);
    expect(ok).toBe(false);
  });

  it("does NOT fire when the index is ADDRESSING DATA", () => {
    // The first draft of rule E fired on `stages[i - 1].count`,
    // `snapshots[i - 1].autonomyScore` and `processedCount: i + 1` — three
    // legitimate ways of walking real rows. `i + 1` is a position;
    // `75 + i * 8` is a percentage invented from one.
    const { out, ok } = withProbe(
      "export function funnel(stages: { count: number }[]) {\n" +
        "  return stages.map((s, i) => ({\n" +
        "    dropoffPercent: i > 0 && stages[i - 1].count > 0\n" +
        "      ? Math.round((1 - s.count / stages[i - 1].count) * 100)\n" +
        "      : 0,\n" +
        "    processedCount: i + 1,\n" +
        "  }));\n}\n",
    );
    expect(out, `a real funnel computation was flagged:\n${out}`).toContain(
      "[measurement-defaults] PASS",
    );
    expect(ok).toBe(true);
  });
});
