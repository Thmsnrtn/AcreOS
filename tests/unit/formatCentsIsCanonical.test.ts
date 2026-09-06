/**
 * One name, one function — and the register that proves it, derived rather than
 * written down.
 *
 * `shared/finance/cents.ts` declared itself "the canonical home" for
 * `formatCents` and then listed its rivals in prose: *"Four other `formatCents`
 * exist and only TWO of them are the same function."* At HEAD there were
 * **seven**, and the comment named three. Nothing was wrong with the sentence
 * when it was written; it simply had no way to notice the eighth copy, because a
 * hand-written register cannot count.
 *
 * THE COPIES WERE NOT ALL THE SAME FUNCTION, which is exactly why the ledger had
 * already warned that a blind "de-duplicate formatCents" sweep would change
 * behaviour. Four distinct implementations shared one name:
 *
 *   - `shared/rental/camReconciliation.ts` and `.../utilityBillback.ts` —
 *     byte-identical to the canonical, exported, and imported by nobody.
 *   - `server/services/wonBidToCertificate.ts` — `toLocaleString("en-US")`.
 *   - `.../MRRTrajectory.tsx` and `.../BusinessIntelligence.tsx` — ABBREVIATING
 *     ($1.2M / $3.4K), duplicated verbatim between the two files.
 *   - `.../founder-ai-observatory.tsx` — a one-line alias for `usd()`.
 *
 * Every one of them had a canonical counterpart already in the repo, and every
 * one differed from it somewhere:
 *
 * **The certificate copy.** The canonical renderer is locale-independent BY
 * DESIGN, and says why: `toLocaleString` renders differently per runtime ICU
 * build, so *"a figure frozen into a decision record would not read back
 * identically."* The strings it feeds are frozen into a tax-certificate
 * document — the exact case that rationale was written for.
 *
 * **The abbreviating copies.** `client/src/lib/format.ts#dollarsCompact` already
 * existed and already did this, better on two inputs. It compares `Math.abs`
 * where the copies compared the SIGNED value, so `-$25,000` rendered as
 * `$-25000` — unabbreviated and comma-less — on components whose entire purpose
 * is dense abbreviated display. And it returns `—` for null where the copies
 * returned **`$0`**, because `null / 100 === 0` in JavaScript.
 *
 * **NEITHER IS REACHABLE TODAY, and that is stated rather than dressed up.** The
 * business-intelligence endpoint `COALESCE`s its sums to 0 and the trajectory
 * endpoint clamps its projection with `Math.max(0, …)`, so no producer emits a
 * null or a negative into these components. Unit 93 recorded the same honesty
 * for `syntheticChecks`: the direction is the point. A missing ARR rendering as
 * `$0` is a definite favourable answer standing in for an unknown one, which is
 * this program's most-repeated defect, and the fix is to stop maintaining a
 * private copy that can drift into it.
 *
 * WHAT THIS FILE PINS is the derivation, not a list. It scans source for
 * `formatCents` DEFINITIONS and requires exactly one, in the canonical module.
 * The old comment failed because it was prose; a test that hardcoded the same
 * seven paths would fail the same way on the eighth.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatCents } from "@shared/finance/cents";
import { dollarsCompact } from "../../client/src/lib/format";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const CANONICAL = "shared/finance/cents.ts";

/** Every `.ts`/`.tsx` under the three product trees, tests excluded. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
      out.push(path.relative(ROOT, full));
    }
  };
  for (const tree of ["server", "client/src", "shared"]) walk(path.join(ROOT, tree));
  return out.sort();
}

/** A DEFINITION, not a call: `function formatCents(` / `const formatCents =`. */
const DEFINITION = /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+formatCents\s*\(|(?:^|\s)(?:export\s+)?const\s+formatCents\s*[:=]/;

function definitionSites(): string[] {
  const found: string[] = [];
  for (const rel of sourceFiles()) {
    const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    if (DEFINITION.test(src)) found.push(rel);
  }
  return found;
}

describe("formatCents names exactly one function", () => {
  it("the scan finds definitions at all (vacuity guard)", () => {
    // If the regex or the walk broke, "exactly one" would pass at zero and this
    // file would be enforcing nothing. The canonical must be among the hits.
    const sites = definitionSites();
    expect(sites.length, "the definition scan found nothing — the regex or the walk is broken")
      .toBeGreaterThan(0);
    expect(sites).toContain(CANONICAL);
  });

  it("and that one lives in the canonical module", () => {
    expect(
      definitionSites(),
      "`formatCents` is defined in more than one place again. Before this unit it " +
        "named FOUR different functions across seven definitions — exact, " +
        "locale-dependent, abbreviating, and an alias — so a de-duplication sweep " +
        "would have changed behaviour. If a surface needs a different rendering, " +
        "give it a different NAME: `dollarsCompact` for the abbreviated form, " +
        "`usd` for dollar-valued input, both in client/src/lib/format.ts.",
    ).toEqual([CANONICAL]);
  });

  it("the scan covers all three trees, not just shared", () => {
    // Five of the seven copies lived outside shared/. A scan narrowed to the
    // canonical's own tree would have reported success while four rivals stood.
    const files = sourceFiles();
    for (const tree of ["server/", "client/src/", "shared/"]) {
      expect(files.some((f) => f.startsWith(tree)), `${tree} is outside the scan`).toBe(true);
    }
  });
});

describe("the canonical module no longer keeps its register in prose", () => {
  const raw = fs.readFileSync(path.join(ROOT, CANONICAL), "utf8");

  it("does not restate a count that cannot notice the next copy", () => {
    // Read RAW: the claim being retired is itself a comment. The old sentence
    // said "Four other `formatCents` exist" while seven did.
    expect(
      raw,
      "shared/finance/cents.ts is counting its rivals in prose again. That number " +
        "was wrong at HEAD and had no way to become right; point at the derived " +
        "test instead.",
    ).not.toMatch(/(Four|Five|Six|Seven|\d+)\s+other\s+`?formatCents`?\s+exist/i);
  });

  it("points at the derivation that replaced it", () => {
    expect(raw).toMatch(/formatCentsIsCanonical/);
  });
});

describe("the replacements behave the same on every reachable input", () => {
  it("the certificate renderer's values are unchanged", () => {
    // wonBidToCertificate feeds bid amounts, minimums and a budget already
    // clamped at zero. The old `toLocaleString("en-US")` and the canonical agree
    // on all of them; they diverge only on negatives, which none can be.
    const localeCopy = (cents: number) =>
      `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    for (const cents of [0, 1, 99, 100, 12_345, 99_999, 1_234_567, 250_000_000]) {
      expect(formatCents(cents), `diverged at ${cents}`).toBe(localeCopy(cents));
    }
  });

  it("the canonical renders negatives its own way, which is why they diverge", () => {
    // The one input where the certificate copy and the canonical disagree, and
    // the reason the swap needed the reachability argument above rather than
    // just a byte comparison. Pinned because the reasoning depends on it: assert
    // the SHAPE, or a change to canonical's minus sign would quietly make the
    // whole justification untrue.
    expect(formatCents(-123_456)).toBe("−$1,234.56");
    expect(
      `$${(-123_456 / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ).toBe("$-1,234.56");
  });

  it("the compact renderer differs from the copies ONLY where nothing reaches", () => {
    // The copies, verbatim as they were. Agreement on the reachable domain is
    // what makes this unit behaviour-preserving; the divergences are the reason
    // it is worth doing at all.
    const copy = (cents: number): string => {
      const dollars = cents / 100;
      if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
      if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
      return `$${dollars.toFixed(0)}`;
    };
    for (const cents of [0, 100, 99_999, 100_000, 250_000_000]) {
      expect(dollarsCompact(cents), `non-negative value diverged at ${cents}`).toBe(copy(cents));
    }
    // Negative: the copies stopped abbreviating and dropped the separators.
    expect(dollarsCompact(-250_000_000)).toBe("$-2.5M");
    expect(copy(-250_000_000)).toBe("$-2500000");
    // Null: `null / 100 === 0`, so the copies answered a missing figure with $0.
    expect(dollarsCompact(null)).toBe("—");
    expect(copy(null as unknown as number)).toBe("$0");
  });
});
