/**
 * A declared maturity may not exceed evidenced readiness.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 * All fifteen verticals in `shared/business-types.ts` declare
 * `maturity: "core"`. Exactly one — `fix_and_flip` — closes the canonical loop.
 *
 * Every vertical has a real surface (measured: 4–7 spotlight modules, 2–5
 * workflow templates, every declared template id defined in the engine). What
 * thirteen of them lack is a recorded decision. The gap is the loop, not the
 * surface.
 *
 * The existing guard could not catch it. `customerPersonas.test.ts` checks
 * maturity only inside `if (displayName.includes("(waitlist)"))` /
 * `("(beta)")`, and no persona display name contains either string — both
 * matches in that catalog are in comments. It iterates thirty personas and
 * asserts nothing (measured: 30 personas, 0 tagged). That test is not deleted
 * here: it guards a real invariant (a tag must not contradict the registry) and
 * simply has an empty population. This file guards the invariant it could never
 * reach — the label itself.
 *
 * ── EVERY FACT BELOW IS MEASURED FROM SOURCE ────────────────────────────────
 * Nothing is hand-listed. A hand-written fact would make the projection agree
 * with itself, which is the failure this file exists to prevent. The vacuity
 * guards run FIRST, because a scan that silently finds nothing would report the
 * most flattering possible answer.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUSINESS_TYPES, BUSINESS_TYPE_IDS, type BusinessTypeId } from "../../shared/business-types";
import {
  overclaims,
  projectReadiness,
  readinessOf,
  READINESS_TIERS,
  type VerticalEvidence,
} from "../../shared/business-types/readiness";
import {
  PUBLIC_CLAIM_DEMOTIONS,
  assertDemotionsValid,
  publicMaturityOf,
} from "../../shared/business-types/publicClaims";
import { measureVerticalEvidence } from "../support/verticalEvidence";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Comment lines removed — prose about a defect is not the defect. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** Every .ts/.tsx file under a directory, repo-relative. */
function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(child));
    else if (/\.tsx?$/.test(e.name) && !e.name.includes(".test.")) out.push(child);
  }
  return out;
}


// ── Measure the evidence ────────────────────────────────────────────────────

/**
 * MEASURED FROM SOURCE, and shared with publicMaturityRendered.test.tsx.
 *
 * It was defined here and had to move: the rendered test needed the SAME
 * measurement as an anchor independent of the demotion map, and a second copy
 * would have been two definitions of "what this repo can show" free to drift.
 */
const evidence: VerticalEvidence = measureVerticalEvidence();

/**
 * MEASURED 2026-08-17: 13 of 15 verticals declare `core` on evidence that does
 * not reach `decided`. DOWN-ONLY.
 *
 * This number is the gap between what AcreOS SAYS and what it can SHOW. It is
 * frozen rather than fixed because closing it two ways are both legitimate and
 * only one is mine to choose: WIRE the vertical into the canonical loop
 * (engineering), or RELABEL it (a customer-facing claim, and therefore a
 * founder decision — queued as OD-5). Lower this in the commit that earns it,
 * whichever way it is earned.
 */
const MATURITY_OVERCLAIM_BASELINE = 13;

describe("the evidence scan is real (vacuity guards, first)", () => {
  it("found the workflow templates the engine defines", () => {
    // If this scan silently returns nothing, every vertical drops to `declared`
    // and the overclaim count INFLATES — a failure that looks like a finding.
    expect(
      evidence.definedWorkflowTemplateIds.size,
      "no `id: \"tpl_…\"` definitions found in workflow-engine.ts — the scan " +
        "broke; do not trust the readiness projection below.",
    ).toBeGreaterThan(20);
  });

  it("found at least one underwritten and one deciding vertical", () => {
    // The mirror failure: a scan that finds nothing would make every vertical
    // look equally unproven and hide which one actually works.
    expect(
      evidence.underwrittenBusinessTypes.size,
      "no production scenario writer found — routes-flip-analyzer.ts should " +
        "supply engineId flip_mao",
    ).toBeGreaterThan(0);
    expect(
      evidence.decidingBusinessTypes.size,
      "no production decision writer found — flip-analyzer and lot-pricing " +
        "should both call recordDecision(",
    ).toBeGreaterThan(0);
  });

  it("covers every registered vertical", () => {
    const rows = projectReadiness(BUSINESS_TYPES, evidence);
    expect(rows).toHaveLength(BUSINESS_TYPE_IDS.length);
  });
});

describe("readiness is a projection of evidence", () => {
  it("fix_and_flip reaches `decided` — the one vertical that closes the loop", () => {
    // The positive control. Without it, an overclaim count could be produced by
    // a projection that never awards anything.
    expect(readinessOf(BUSINESS_TYPES.fix_and_flip, evidence)).toBe("decided");
  });

  it("subdivider reaches `decided` too — it records, even though it cannot be graded", () => {
    // routes-lot-pricing.ts:351 records a decision. It hardcodes
    // `reviewDueAt: null` (:419) so those decisions never enter the due sweep
    // and can never be graded — a real defect, but a SEPARATE one. Readiness
    // measures what is recorded, not what is gradeable; conflating them here
    // would hide the grading defect inside a maturity number.
    expect(readinessOf(BUSINESS_TYPES.subdivider, evidence)).toBe("decided");
  });

  it("a vertical with no templates and no modules is only `declared`", () => {
    // SYNTHETIC ON PURPOSE. This began as a scan of the real registry for bare
    // verticals and passed while matching NOTHING — no vertical is bare, so the
    // loop asserted zero times and the bottom rung of the ladder went untested
    // by the very file written to end vacuous guards. Constructed input cannot
    // develop an empty population.
    const bare = {
      ...BUSINESS_TYPES.commercial,
      id: "not_a_registered_vertical" as BusinessTypeId,
      workflowTemplateIds: [],
      spotlightModules: [],
    };
    expect(readinessOf(bare, evidence)).toBe("declared");
  });

  it("a declared template id the engine does not define earns nothing", () => {
    // The cheapest possible way to fake a tier is to add a string to an array.
    const fake = {
      ...BUSINESS_TYPES.commercial,
      workflowTemplateIds: ["tpl_this_does_not_exist"],
      spotlightModules: [],
    };
    expect(readinessOf(fake, evidence)).toBe("declared");
  });

  it("every declared template id resolves — none of the shortfall is a typo", () => {
    // Worth stating separately from the ratchet: if verticals were short on
    // evidence because they cited templates that do not exist, the fix would be
    // trivial and clerical. They do not. Every id is real, so the shortfall is
    // structural and no amount of registry tidying closes it.
    const dangling = BUSINESS_TYPE_IDS.flatMap((id) =>
      BUSINESS_TYPES[id].workflowTemplateIds
        .filter((t) => !evidence.definedWorkflowTemplateIds.has(t))
        .map((t) => `${id} → ${t}`),
    );
    expect(dangling, "a vertical cites a workflow template the engine never defines").toEqual([]);
  });
});

describe("a declared maturity may not exceed evidenced readiness", () => {
  const rows = projectReadiness(BUSINESS_TYPES, evidence);
  const over = rows.filter((r) => r.overclaims);

  it(`overclaims stay at or below ${MATURITY_OVERCLAIM_BASELINE}`, () => {
    const listing = over
      .map((r) => `  ${r.id}: declares "${r.declared}" (needs ${r.required}) but evidences ${r.evidenced}`)
      .join("\n");
    expect(
      over.length,
      `A vertical claims more maturity than this repository can show.\n${listing}\n\n` +
        "Close it by WIRING the vertical into the canonical loop, or by " +
        "RELABELLING it — the second is a customer-facing claim and a founder " +
        "decision (OD-5). Do not raise this number.",
    ).toBeLessThanOrEqual(MATURITY_OVERCLAIM_BASELINE);
  });

  it("the baseline is not stale — lock in any reduction", () => {
    // The mirror direction, the same discipline every other ratchet here uses:
    // a drop that is not locked in is free headroom for the next overclaim.
    expect(
      over.length,
      `overclaims dropped to ${over.length} — LOWER MATURITY_OVERCLAIM_BASELINE ` +
        "to that number in the same commit that earned it.",
    ).toBe(MATURITY_OVERCLAIM_BASELINE);
  });

  it("the gap is the loop, not the surface — every overclaimer is `surfaced`", () => {
    // The single most useful fact this file produces. Not one overclaiming
    // vertical is short of a SURFACE; all thirteen have modules and real
    // templates and stop dead before a recorded decision. If a vertical ever
    // drops to `declared` this fails, and it should: shipping a vertical with
    // no surface at all is a different and worse defect than not closing.
    const notSurfaced = over.filter((r) => r.evidenced !== "surfaced");
    expect(
      notSurfaced.map((r) => `${r.id}=${r.evidenced}`),
      "an overclaiming vertical is no longer merely unclosed — read the tier",
    ).toEqual([]);
  });

  it("records that `underwritten` awards nobody today", () => {
    // Honesty about the ladder itself. `fix_and_flip` is the only vertical with
    // a production scenario writer and it ALSO records decisions, so it
    // short-circuits to `decided` and the middle rung is currently unreachable
    // from real evidence. Stated rather than left to look load-bearing; the
    // synthetic controls above are what actually exercise the lower tiers.
    const underwrittenOnly = rows.filter((r) => r.evidenced === "underwritten");
    expect(underwrittenOnly.map((r) => r.id)).toEqual([]);
  });

  it("names which verticals are honest, so the number is not a mystery", () => {
    const honest = rows.filter((r) => !r.overclaims).map((r) => r.id);
    expect(honest, "no vertical's label is supported by evidence").not.toEqual([]);
    // fix_and_flip is the one that genuinely closes the loop; subdivider
    // records decisions. Both can honestly carry `core` today.
    expect(honest).toContain("fix_and_flip");
  });
});

describe("no PUBLIC claim outruns the evidence (OD-5)", () => {
  // This is a HARD ZERO, not a ratchet, and the difference matters.
  //
  // The registry ratchet above is frozen at 13 because `maturity` still says
  // `core` — that is the founder's deliberate choice, since `core` describes
  // the in-app experience a paying customer actually gets. But what a STRANGER
  // is told before they can check has no such excuse, and after the OD-5
  // demotions there is no gap left to tolerate. A ratchet here would be
  // budgeting for an overclaim nobody needs.
  const rows = projectReadiness(BUSINESS_TYPES, evidence);

  it("every vertical's public tier is supported by its evidence", () => {
    // Reuses `overclaims` — the SAME law the registry ratchet uses — by asking
    // it about a vertical wearing its public tier instead of its declared one.
    // Re-deriving "does this tier need that evidence?" here would be a second
    // copy of the ladder, free to drift from the first.
    const over = rows
      .map((r) => {
        const meta = BUSINESS_TYPES[r.id];
        const publicTier = publicMaturityOf(meta);
        return {
          id: r.id,
          publicTier,
          evidenced: r.evidenced,
          bad: overclaims({ ...meta, maturity: publicTier }, evidence),
        };
      })
      .filter((r) => r.bad);

    expect(
      over.map((r) => `${r.id}: publicly "${r.publicTier}" but evidences ${r.evidenced}`),
      "A PUBLIC surface claims more than this repository can show. Add a " +
        "PUBLIC_CLAIM_DEMOTIONS entry in shared/business-types/publicClaims.ts " +
        "with a written reason and a date, or close the loop for that vertical.",
    ).toEqual([]);
  });

  it("no public surface publishes raw `maturity`", () => {
    // THE ASSERTION THIS BLOCK CLAIMED TO MAKE AND DID NOT.
    //
    // Everything else here maps over BUSINESS_TYPES and calls publicMaturityOf
    // itself, so it proves the MAP is coherent — not that any surface consults
    // it. An audit put the retired endpoint back, rendering `v.maturity`
    // directly, and this file stayed green. Two comments (routes-public-trust.ts
    // and OWNER_DECISIONS_PENDING.md) meanwhile promised the opposite. A gate
    // that scans nothing plus prose asserting that it does is worse than
    // silence, because it retires the suspicion that would have found it.
    //
    // Public = reachable without authentication: the landing/marketing pages,
    // and any server route file registering a handler with no auth middleware.
    const files = [
      ...walk("client/src/pages/landing"),
      ...walk("client/src/pages/marketing"),
      "server/routes-public-trust.ts",
      "server/routes-public.ts",
      "server/routes-seo.ts",
    ].filter((f) => fs.existsSync(path.join(ROOT, f)));

    expect(
      files.length,
      "no public surface files found — the scan broke, so the [] below is meaningless",
    ).toBeGreaterThan(3);

    const offenders: string[] = [];
    for (const f of files) {
      const src = codeOnly(read(f));
      // `.maturity` read off a registry entry, in code, not through the accessor.
      for (const m of src.matchAll(/(\w+)\.maturity\b/g)) {
        // publicClaims.ts is allowed to read it — it is the thing that maps it.
        if (m[1] === "meta" && src.includes("publicMaturityOf(")) continue;
        offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      "a PUBLIC surface reads `.maturity` directly. Render " +
        "publicMaturityOf() from shared/business-types/publicClaims.ts instead " +
        "— raw maturity ignores the demotion map, which is how two public " +
        "surfaces came to disagree in the first place.",
    ).toEqual([]);
  });

  it("the demotion map is well-formed (reason, date, direction)", () => {
    // Same validator the landing runs at module load, exercised here so a bad
    // entry fails a test rather than a page render.
    expect(() => assertDemotionsValid()).not.toThrow();
  });

  it("the validator rejects each malformed shape (positive controls)", () => {
    // `not.toThrow()` above proves only that the CURRENT map is valid. It would
    // pass just as happily against a validator whose branches never fire — and
    // an audit found exactly that: the `decidedOn` ISO-date branch had no test
    // reaching it. Each rule is exercised on constructed input, which cannot go
    // vacuous the way a scan over the live map can.
    const ok = { to: "beta" as const, reason: "r", decidedOn: "2026-08-17" };

    expect(() =>
      assertDemotionsValid({ commercial: { ...ok, reason: "   " } }),
    ).toThrow(/non-empty reason/);

    expect(() =>
      assertDemotionsValid({ commercial: { ...ok, decidedOn: "soon" } }),
    ).toThrow(/ISO date/);

    expect(() =>
      assertDemotionsValid({ commercial: { ...ok, decidedOn: "17-08-2026" } }),
    ).toThrow(/ISO date/);

    // A no-op / promote: `commercial` declares `core`, so demoting a synthetic
    // registry where it is already `roadmap` up to `beta` must be refused.
    const asRoadmap = {
      ...BUSINESS_TYPES,
      commercial: { ...BUSINESS_TYPES.commercial, maturity: "roadmap" as const },
    };
    expect(() => assertDemotionsValid({ commercial: ok }, asRoadmap)).toThrow(
      /must move a vertical DOWN/,
    );

    // A vertical that is not in the registry at all.
    expect(() =>
      assertDemotionsValid({ not_a_vertical: ok } as never),
    ).toThrow(/not in the registry/);

    // And the happy path still passes, so the throws above are not universal.
    expect(() => assertDemotionsValid({ commercial: ok })).not.toThrow();
  });

  it("no demotion is stale — a vertical that closed the loop must be released", () => {
    // The mirror direction. A vertical that starts recording decisions has
    // EARNED its `core` claim back, and leaving the demotion in place would
    // understate the product indefinitely — the same rot as an overclaim,
    // pointing the other way.
    const stale = Object.keys(PUBLIC_CLAIM_DEMOTIONS).filter((id) => {
      const meta = BUSINESS_TYPES[id as BusinessTypeId];
      return readinessOf(meta, evidence) === "decided";
    });
    expect(
      stale,
      "these verticals now evidence `decided` and no longer need a public " +
        "demotion — remove their PUBLIC_CLAIM_DEMOTIONS entries.",
    ).toEqual([]);
  });

  it("covers exactly the verticals that cannot show `decided`", () => {
    // Positive control against a map that is merely large. The demoted set must
    // be precisely the complement of the verticals that close the loop —
    // neither a vertical missing (an overclaim) nor an extra one (an
    // understatement) can pass.
    const cannotShowCore = BUSINESS_TYPE_IDS.filter(
      (id) => readinessOf(BUSINESS_TYPES[id], evidence) !== "decided",
    ).sort();
    expect(Object.keys(PUBLIC_CLAIM_DEMOTIONS).sort()).toEqual(cannotShowCore);
  });
});

describe("the tier ladder cannot be quietly reordered", () => {
  it("stays weakest-first, because index comparison is the mechanism", () => {
    // `overclaims()` compares indices. Reordering this array silently inverts
    // the law rather than breaking it loudly.
    expect([...READINESS_TIERS]).toEqual(["declared", "surfaced", "underwritten", "decided"]);
  });
});
