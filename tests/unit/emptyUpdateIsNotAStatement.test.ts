/**
 * An update whose SET ends up empty must refuse to emit a statement.
 *
 * Drizzle renders an empty SET as `UPDATE <table> SET  WHERE …` — a Postgres
 * SYNTAX ERROR, not a no-op. "Empty" is broader than `.set({})`: Drizzle DROPS
 * UNDEFINED VALUES, so a set whose keys are all present and whose values all
 * happen to be undefined renders the same malformed statement. The block at the
 * bottom of this file pins that mechanism against the real dialect; the scan
 * below covers the one SHAPE a source reader can see. So a builder that adds every field conditionally
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

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { organizations } from "@shared/schema";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

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

/**
 * ── THE MECHANISM, RENDERED RATHER THAN ASSUMED ───────────────────────────
 * The scan above hunts one SHAPE: an object built up conditionally and never
 * seeded. That shape is real, and `governanceBrainV13.updatePolicy` was a real
 * instance of it. But the header of this file used to say the hazard is
 * `.set({})`, and that description is too narrow — which is why a statement
 * seen in a CI postgres log,
 *
 *     update "organizations" set  where "organizations"."id" = $1
 *
 * went unexplained after that fix landed. All 51 `.update(organizations)` sites
 * in server/ were scanned for both syntactic shapes; none can produce it.
 *
 * Rendered through Drizzle's own pg dialect, the reason is plain: DRIZZLE DROPS
 * UNDEFINED VALUES. A `.set()` whose keys are all present but whose values all
 * happen to be `undefined` at runtime emits the identical malformed statement.
 * No source scan can see that — it is a question about values, not shapes.
 *
 * So the class is "an update whose SET is empty AFTER undefined values are
 * dropped", and the syntactic scan above covers one corner of it. This block
 * pins the mechanism itself so the next reader inherits the real rule instead
 * of the narrow one, and so a Drizzle upgrade that starts THROWING here (which
 * would be an improvement) is noticed rather than silently changing the risk.
 */
describe("the mechanism: Drizzle drops undefined, and an empty SET is malformed SQL", () => {
  const dialect = new PgDialect();
  const render = (set: Record<string, unknown>) => {
    // The set object is handed to the builder exactly as a caller writes it —
    // no pre-mapping — because the question is what Drizzle does with the
    // values a caller actually passes.
    const anyDialect = dialect as unknown as { buildUpdateQuery: (c: unknown) => never };
    return dialect.sqlToQuery(
      anyDialect.buildUpdateQuery({
        table: organizations,
        set,
        where: eq(organizations.id, 1),
      }),
    ).sql;
  };

  it("all-undefined values render the SAME malformed statement as {}", () => {
    const empty = render({});
    const allUndefined = render({ name: undefined, tier: undefined });
    expect(empty, "a literally empty set should render `set  where`").toMatch(/set\s+where/);
    expect(
      allUndefined,
      "if this ever stops matching the empty case, Drizzle's undefined handling " +
        "changed — re-derive the rule above before trusting the scan alone.",
    ).toBe(empty);
    // And it is exactly the line that appeared in the CI log.
    expect(allUndefined).toBe('update "organizations" set  where "organizations"."id" = $1');
  });

  it("one defined value is enough to make it a real statement", () => {
    const one = render({ name: "x", tier: undefined });
    expect(one).toMatch(/set "name" = \$1/);
    expect(one, "the undefined sibling must not appear").not.toMatch(/tier/);
  });
});
