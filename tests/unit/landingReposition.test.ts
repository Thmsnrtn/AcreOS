/**
 * Founder ruling #12(a) (docs/company/founder-decisions-2026-07-28.md,
 * 2026-07-29 addendum) — the landing page repositions from "Built for
 * Land Investors." to PROPERTY INVESTORS generally, with land kept as
 * the honestly-named deepest wedge (credibility proof, not the gate).
 *
 * Pins:
 *   1. The primary framings (hero title, hero eyebrow, positioning
 *      headline) speak to property investors, not to a single vertical.
 *   2. The land wedge stays visible and honestly labeled — the hero
 *      eyebrow names the depth, the data band is labeled as the land
 *      toolkit rather than pretending universality.
 *   3. The old exclusive gate ("Built for Land Investors.") cannot
 *      silently return as any primary framing.
 *   4. Claims-contract sync: the hero wedge sentence — the page's one
 *      consolidation claim — appears VERBATIM in
 *      scripts/audit-public-claims.ts, so a copy edit that skips the
 *      truth-engine update (its stated contract) fails here.
 *   5. The wedge keeps the five-verb mechanic (find / mail / reply /
 *      close / service) and does NOT reintroduce the "only platform"
 *      comparative, which was defensible against the land category
 *      only, not the broader property-investor field.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { LANDING_COPY } from "../../client/src/pages/landing/copy";

const REPO_ROOT = resolve(__dirname, "..", "..");

describe("landing reposition — property investors, land as the wedge (ruling #12(a))", () => {
  it("primary framings address property investors", () => {
    expect(LANDING_COPY.hero.title.join(" ")).toMatch(/property investors/i);
    expect(LANDING_COPY.positioning.primary).toBe(
      "Built for property investors.",
    );
    expect(LANDING_COPY.features.title).toMatch(/property investor/i);
  });

  it("keeps land as the honestly-labeled deepest wedge, not the gate", () => {
    // The eyebrow names the depth fact right next to the audience.
    expect(LANDING_COPY.hero.eyebrow).toMatch(/deepest in land/i);
    // The land-only federal data band is labeled as the land toolkit.
    expect(LANDING_COPY.data.eyebrow).toMatch(/land toolkit/i);
    expect(LANDING_COPY.hero.agenciesLabel).toMatch(/land toolkit/i);
    // The positioning band states the wedge alongside the tier chips.
    expect(LANDING_COPY.positioning.inProduct).toMatch(/deepest in land/i);
  });

  it("does not regress to the old single-vertical gate", () => {
    const primaries = [
      LANDING_COPY.hero.eyebrow,
      LANDING_COPY.hero.title.join(" "),
      LANDING_COPY.positioning.primary,
      LANDING_COPY.features.title,
    ];
    for (const p of primaries) {
      expect(p).not.toMatch(/built for land investors/i);
      expect(p).not.toMatch(/for land investors\.?$/i);
    }
  });

  it("hero wedge keeps the five-verb mechanic and drops the 'only platform' comparative", () => {
    const wedge = LANDING_COPY.hero.wedge.toLowerCase();
    for (const verb of ["find", "mail", "repl", "close", "service"]) {
      expect(wedge, `wedge must carry the "${verb}" verb`).toContain(verb);
    }
    expect(wedge).not.toContain("only platform");
  });

  it("hero wedge is registered verbatim in the truth-engine audit (claims contract)", () => {
    const audit = readFileSync(
      join(REPO_ROOT, "scripts", "audit-public-claims.ts"),
      "utf8",
    );
    expect(audit).toContain(LANDING_COPY.hero.wedge);
  });
});
