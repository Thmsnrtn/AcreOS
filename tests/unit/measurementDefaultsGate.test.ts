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
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../..");
const LINT = path.join(ROOT, "scripts/check-measurement-defaults.mjs");

/** Measured 2026-08-18. Down-only: a fix DELETES its baseline line. */
const BASELINE_CEILING = 75;
// 77 -> 75 on 2026-08-18: both `note.gracePeriodDays || 10` sites. They printed
// a ten-day grace period into a promissory note (SIGNATURES block included) for
// a note whose record either states nothing or explicitly states ZERO — the
// `||` fires on 0 — while `acquiredNoteAging` measured that same note against
// zero days. The gate reported them stale the moment they were fixed, which is
// the register working; locked in per its down-only rule.
/** Expressions the walk must keep seeing; 2,031 measured 2026-08-18. */
const EXPRESSION_FLOOR = 600;

function run(): { out: string; ok: boolean } {
  try {
    return { out: execFileSync("node", [LINT], { cwd: ROOT, encoding: "utf8" }), ok: true };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer };
    return { out: String(e.stdout ?? "") + String(e.stderr ?? ""), ok: false };
  }
}

/** Writes a probe under server/services (where the walk goes), runs, removes. */
function withProbe(source: string): { out: string; ok: boolean } {
  const file = path.join(ROOT, "server/services", "__measurement_probe__.ts");
  fs.writeFileSync(file, source);
  try {
    return run();
  } finally {
    fs.unlinkSync(file);
  }
}

describe("the gate is wired and sees a real population", () => {
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
  });

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
    expect(out).toContain("__measurement_probe__.ts");
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
});
