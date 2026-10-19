/**
 * Money and comparable quantities render in tabular Inter, not the mono face.
 *
 * The Fieldstone type system (founder decision 2026-10-18): Fraunces for
 * headings, Inter for interface text AND financial figures with tabular
 * figures, the mono face only for identifiers and code. The repo's idiom for
 * a figure was `font-mono tabular-nums` (195 class strings across 48 files on
 * 2026-10-18, e.g. the Deals pipeline value); identifiers use `font-mono`
 * alone. `tabular-nums` is the discriminator, so a class string holding BOTH
 * is a figure set in the wrong face.
 *
 * Population: every string literal in client/src. Mutation probe: put
 * `font-mono` back on deals.tsx's text-pipeline-value.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const CLIENT = path.resolve(__dirname, "../../client/src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(tsx?)$/.test(e.name)) out.push(f);
  }
  return out;
}

describe("figures use tabular Inter", () => {
  const files = walk(CLIENT);
  let tabularStrings = 0;
  const offenders: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/(["'`])((?:(?!\1)[^\n\\])*)\1/g)) {
      const cls = m[2];
      if (!/\btabular-nums\b/.test(cls)) continue;
      tabularStrings += 1;
      if (/\bfont-mono\b/.test(cls)) offenders.push(`${path.relative(CLIENT, f)}: "${cls.slice(0, 80)}"`);
    }
  }

  it("reads a real population", () => {
    expect(files.length).toBeGreaterThan(600);
    // ~1,000+ tabular-nums class strings on 2026-10-18.
    expect(tabularStrings, "the class-string scan broke").toBeGreaterThan(500);
  });

  it("no class string sets a tabular figure in the mono face", () => {
    expect(offenders, "drop font-mono: figures are Inter with tabular-nums").toEqual([]);
  });
});
