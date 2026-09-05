/**
 * An update builder whose fields are ALL optional must refuse to emit a statement.
 *
 * Drizzle renders `.set({})` as `UPDATE <table> SET  WHERE …` — a Postgres
 * SYNTAX ERROR, not a no-op. So a builder that adds every field conditionally
 * and never seeds one is a 500 waiting for a caller who patches nothing:
 *
 *     const updateData: Record<string, any> = {};
 *     if (updates.name !== undefined) updateData.name = updates.name;
 *     …
 *     await db.update(t).set(updateData)          ← empty when nothing was passed
 *
 * Two shapes already make this safe elsewhere in the repo, and both count:
 *   SEEDED   the object starts with a field that is always present
 *            (`{ updatedAt: new Date() }`, `{ status }`, `{ changedAt: … }`)
 *   GUARDED  an explicit `Object.keys(x).length` check before the statement
 *            (`marketWatchlist.updateEntry` returns the current row; the
 *            voice-call handlers wrap the write in `length > 0`)
 *
 * ── WHY THIS TEST'S OWN SCAN IS THE INTERESTING PART ────────────────────────
 * The scan that found this reported FOUR sites. Three were false positives, and
 * each taught the predicate something:
 *
 *   browserAutomation   seeded with `{ status }` — SHORTHAND, so the seed
 *                       contains no `:` and a naive "does the seed have a
 *                       colon" test called it empty.
 *   voiceCallAI (×2)    guarded with `length > 0` wrapping the write, not
 *                       `=== 0` returning early — the same property, the other
 *                       polarity.
 *
 * One real site remained: `governanceBrainV13.updatePolicy`. A scan that had
 * been trusted rather than hand-checked would have "fixed" three files that
 * were already correct and reported a 4× larger problem than exists.
 *
 * So both spellings of each shape are recognised here, and the population is
 * DERIVED — a fifth builder of this shape is what has to fail.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const SERVER = path.join(ROOT, "server");

/** `const <name>: Record<string, unknown|any> = { <seed> }` */
const BUILDER = /const\s+([A-Za-z_$][\w$]*)\s*:\s*Record<string,\s*(?:unknown|any)>\s*=\s*\{([^}]*)\}/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (f.endsWith(".ts") && !f.endsWith(".test.ts")) out.push(f);
  }
  return out;
}

interface Site { file: string; line: number; name: string; seeded: boolean; guarded: boolean }

function scan(): Site[] {
  const sites: Site[] = [];
  for (const abs of walk(SERVER)) {
    const src = stripComments(fs.readFileSync(abs, "utf8"));
    for (const m of src.matchAll(BUILDER)) {
      const [name, seed] = [m[1], m[2].trim()];
      const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 4000);
      if (!after.includes(`.set(${name})`)) continue;
      // A seed counts whether written `{ a: b }` or shorthand `{ a }`.
      const seeded = seed.length > 0 && /[A-Za-z_$]/.test(seed);
      // A guard counts in EITHER polarity: an early return on empty, or the
      // write wrapped in a non-empty check.
      const guarded = new RegExp(
        `Object\\.keys\\(\\s*${name}\\s*\\)\\.length\\s*(?:===?\\s*0|>\\s*0|!==?\\s*0|>=\\s*1)`,
      ).test(after);
      sites.push({
        file: path.relative(ROOT, abs).split(path.sep).join("/"),
        line: src.slice(0, m.index!).split("\n").length,
        name,
        seeded,
        guarded,
      });
    }
  }
  return sites;
}

describe("update builders with all-optional fields never emit an empty SET", () => {
  const sites = scan();

  it("finds the builders (vacuity)", () => {
    // Measured 2026-09-05. A parser that stops matching reports zero
    // offenders, which is exactly what a clean codebase looks like.
    expect(sites.length).toBeGreaterThanOrEqual(8);
  });

  it("recognises BOTH safe shapes, so the scan does not invent work", () => {
    // These three were the scan's own false positives. If a future edit to the
    // predicate stops recognising shorthand seeds or `length > 0` guards, this
    // is what says so — rather than three correct files getting "fixed".
    const byFile = (f: string) => sites.filter((s) => s.file.endsWith(f));
    const browser = byFile("services/browserAutomation.ts");
    expect(browser.length, "browserAutomation builder not found").toBeGreaterThan(0);
    expect(browser.some((s) => s.seeded), "shorthand seed `{ status }` not recognised").toBe(true);

    const voice = byFile("services/voiceCallAI.ts");
    expect(voice.length, "voiceCallAI builders not found").toBeGreaterThanOrEqual(2);
    expect(voice.every((s) => s.guarded), "`length > 0` guard not recognised").toBe(true);
  });

  it("no builder is both unseeded and unguarded", () => {
    const offenders = sites
      .filter((s) => !s.seeded && !s.guarded)
      .map((s) => `${s.file}:${s.line} (const ${s.name})`);
    expect(offenders).toEqual([]);
  });
});
