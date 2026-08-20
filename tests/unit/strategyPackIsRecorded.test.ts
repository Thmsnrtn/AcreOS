/**
 * A decision made under a strategy is a decision that says so.
 *
 * ── THE GAP ─────────────────────────────────────────────────────────────────
 * `decision_snapshots.strategy_pack_id` and `scenarios.strategy_pack_id` record
 * "which rules shaped this" (BI91). `PRODUCT.md` recorded that the column
 * existed and that "every production caller writes null", and called closing
 * that the highest-leverage architectural work available.
 *
 * The type's own docblock says null means "no pack applied … so 'no pack' is
 * explicit". But all four canonical `recordDecision` call sites are VERTICAL
 * surfaces — the fix-and-flip analyzer, lot pricing, the blind-offer wizard and
 * the offer-letter batch. Null there was never "no pack applied"; it was a fact
 * nobody wrote down. Losing provenance you hold is the same defect as inventing
 * provenance you do not, pointed the other way.
 *
 * ── NO SECOND TAXONOMY ──────────────────────────────────────────────────────
 * A strategy pack IS a business type. The product already has exactly one
 * canonical list of investor archetypes (`BUSINESS_TYPE_IDS`), and the obvious
 * mistake would have been to invent a pack registry beside it and let the two
 * drift. `StrategyPackId` is an alias, not a new list — so this file checks the
 * ids against the real registry, and an invented pack fails here as well as at
 * the type level.
 *
 * ── VERSION STAYS NULL ──────────────────────────────────────────────────────
 * `strategy_pack_version` is null everywhere and must stay so until a versioned
 * pack ARTIFACT exists. The snapshot renderer already prints
 * `under <id>@unversioned`, which is an honest rendering of a pack that is named
 * but not yet cut. Writing "1.0" beside a real id would manufacture a version
 * nobody issued — the same fabrication this repo refuses everywhere else.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUSINESS_TYPE_IDS, isStrategyPackId } from "../../shared/business-types";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) =>
  stripCommentsPreservingLines(readFileSync(resolve(ROOT, rel), "utf8"));

/**
 * The vertical surfaces that record a canonical decision, and the pack each one
 * is made under. NAMED, not counted: a count is satisfied by any file writing
 * any id, which is exactly how a check goes green over the surface that still
 * writes null.
 */
const VERTICAL_DECISION_SITES: Array<{ file: string; pack: string; why: string }> = [
  { file: "server/routes-flip-analyzer.ts", pack: "fix_and_flip", why: "the fix-and-flip analyzer" },
  { file: "server/routes-lot-pricing.ts", pack: "subdivider", why: "lot pricing is the subdivider surface" },
  { file: "server/routes-data-intelligence.ts", pack: "land_flipper", why: "the blind-offer wizard is the land loop" },
  { file: "server/routes-team-messaging.ts", pack: "land_flipper", why: "the offer-letter batch prices land" },
];

/** Every `strategyPackId: <literal>` written anywhere in production server code. */
function packLiterals(rel: string): string[] {
  const out: string[] = [];
  const re = /strategyPackId\s*:\s*("([^"]*)"|'([^']*)'|null)/g;
  let m: RegExpExecArray | null;
  const src = read(rel);
  while ((m = re.exec(src)) !== null) out.push(m[2] ?? m[3] ?? "null");
  return out;
}

describe("vacuity — the sites and the registry are real", () => {
  it("the canonical registry is populated and the alias resolves through it", () => {
    expect(BUSINESS_TYPE_IDS.length, "the business-type registry is empty").toBeGreaterThan(8);
    expect(isStrategyPackId("land_flipper")).toBe(true);
    expect(
      isStrategyPackId("not_a_real_pack"),
      "isStrategyPackId accepts anything — it is not reading the registry",
    ).toBe(false);
    expect(isStrategyPackId(null)).toBe(false);
  });

  it("each named site still records a decision at all", () => {
    for (const site of VERTICAL_DECISION_SITES) {
      const src = read(site.file);
      expect(src, `${site.file} no longer calls recordDecision — re-derive this list`).toContain(
        "recordDecision(",
      );
      expect(packLiterals(site.file).length, `${site.file} writes no strategyPackId at all`).
        toBeGreaterThan(0);
    }
  });
});

describe("every vertical decision names the pack that shaped it", () => {
  for (const site of VERTICAL_DECISION_SITES) {
    it(`${site.file} records ${site.pack} — ${site.why}`, () => {
      const written = packLiterals(site.file);
      expect(
        written,
        `${site.file} records its decision with strategyPackId null. It is a ` +
          `vertical surface, so null is not "no pack applied" — it is a fact ` +
          `this route holds and did not write down.`,
      ).toContain(site.pack);
      expect(written).not.toContain("null");
    });
  }
});

describe("what is written is real, and no version is invented", () => {
  it("no production route writes a pack id outside the canonical registry", () => {
    // Defence in depth: the type already makes an invented id a compile error.
    // This catches the same mistake arriving as an `as any`, a widened alias, or
    // a literal in a file the type does not reach.
    const files = VERTICAL_DECISION_SITES.map((s) => s.file);
    for (const f of files) {
      for (const lit of packLiterals(f)) {
        if (lit === "null") continue;
        expect(
          isStrategyPackId(lit),
          `${f} writes strategyPackId "${lit}", which is not in BUSINESS_TYPE_IDS. ` +
            `A strategy pack IS a business type; there is no second taxonomy.`,
        ).toBe(true);
      }
    }
  });

  it("strategyPackVersion is still null everywhere — no manufactured version", () => {
    for (const site of VERTICAL_DECISION_SITES) {
      const src = read(site.file);
      const versions = [...src.matchAll(/strategyPackVersion\s*:\s*([^,\n]+)/g)].map((m) =>
        m[1].trim(),
      );
      expect(versions.length, `${site.file} stopped writing strategyPackVersion`).toBeGreaterThan(0);
      for (const v of versions) {
        expect(
          v,
          `${site.file} writes strategyPackVersion ${v}. No versioned pack artifact ` +
            `exists, so any value here is a version nobody cut. The renderer ` +
            `already prints "@unversioned" for null, which is the honest form.`,
        ).toBe("null");
      }
    }
  });
});
