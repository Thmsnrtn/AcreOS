/**
 * The clock ratchet reads what it claims to read.
 *
 * `scripts/check-clock-reads.mjs` (wired as `lint:clock-reads`) counts direct
 * wall-clock reads in server/ outside server/utils/clock.ts and may only
 * shrink. A count gate is only as good as (a) the SHAPES it recognises and
 * (b) the POPULATION it walks, so this file pins both:
 *
 *   - one canary per shape that reads "now" — including the equivalent
 *     representations a rename-the-symbol fix would slip through (an alias of
 *     `Date.now`, `globalThis.Date`, `Date["now"]`, `Date()`, a paren-less
 *     `new Date`, `performance.timeOrigin`);
 *   - non-reads that must NOT count (a conversion `new Date(x)`, comments,
 *     strings), so the gate does not read its own documentation;
 *   - the population: every non-test source file under server/ is walked,
 *     the clock module is the only exclusion, and the floors hold.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs gate module, no type declarations
import { findClockReads, measure, serverPopulation, CLOCK_MODULE } from "../../scripts/check-clock-reads.mjs";

type Read = { shape: string; line: number };
const reads = (src: string, f = "x.ts"): Read[] => findClockReads(src, f);

describe("clock ratchet — shapes", () => {
  const counted: Array<[string, string]> = [
    ["Date.now()", "const t = Date.now();"],
    ["Date.now (reference)", "const n = Date.now; n();"],
    ["Date.now (reference)", "setDefault(Date.now);"],
    ["Date.now()", "const t = globalThis.Date.now();"],
    ['Date["now"]', 'const t = Date["now"]();'],
    ["new Date()", "const d = new Date();"],
    ["new Date()", "const d = new Date;"],
    ["new Date()", "const d = new globalThis.Date();"],
    ["Date()", "const s = Date();"],
    ["performance.timeOrigin", "const t = performance.timeOrigin + performance.now();"],
  ];
  for (const [shape, src] of counted) {
    it(`counts ${shape} in \`${src}\``, () => {
      const r = reads(src);
      expect(r.map((x) => x.shape)).toContain(shape);
    });
  }

  it("counts the read nested inside a conversion", () => {
    expect(reads("const d = new Date(Date.now() + 5);").map((x) => x.shape)).toEqual(["Date.now()"]);
  });

  it("does not count conversions, comments or strings", () => {
    const src = [
      "const d = new Date(row.createdAt);",
      "const e = new Date(2026, 0, 1);",
      "// we used to call Date.now() here; new Date() too",
      "/* Date.now() */",
      'const s = "new Date() and Date.now()";',
      "const t = `Date.now()`;",
      "const r = /Date\\.now\\(\\)/;",
    ].join("\n");
    expect(reads(src)).toEqual([]);
  });

  it("parses TSX and JS members of the population", () => {
    expect(reads("const x = <div>{new Date().getFullYear()}</div>;", "a.tsx")).toHaveLength(1);
    expect(reads("module.exports = () => Date.now();", "a.cjs")).toHaveLength(1);
  });
});

describe("clock ratchet — population", () => {
  it("walks every non-test source file under server/ except exactly the clock", () => {
    const { files, dirCount } = serverPopulation();
    const cfg = JSON.parse(readFileSync("scripts/ratchets/clock-reads.json", "utf8"));
    expect(files.length).toBeGreaterThanOrEqual(cfg.minima.files);
    expect(dirCount).toBeGreaterThanOrEqual(cfg.minima.dirs);
    expect(files).not.toContain(CLOCK_MODULE);
    expect(files.some((f: string) => f.startsWith("server/jobs/"))).toBe(true);
    expect(files.some((f: string) => f.startsWith("server/services/solene/"))).toBe(true);
    expect(files.some((f: string) => /^server\/routes[-.]/.test(f))).toBe(true);
    expect(files.some((f: string) => /\.test\./.test(f))).toBe(false);
  });

  it("the clock module itself really reads the wall clock (so excluding it is the only exemption)", () => {
    expect(reads(readFileSync(CLOCK_MODULE, "utf8"), CLOCK_MODULE).length).toBeGreaterThan(0);
  });

  it("the measured count equals the baseline (it may only shrink, and a shrink lowers it)", () => {
    const cfg = JSON.parse(readFileSync("scripts/ratchets/clock-reads.json", "utf8"));
    const m = measure();
    expect(m.unreadable).toEqual([]);
    expect(m.total).toBe(cfg.baselineCount);
  });
});
