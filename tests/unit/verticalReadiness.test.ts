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

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
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
import {
  LEGACY_DECISION_ROUTE_OWNER,
  analyzeRouteSource,
  clientCalls,
  creditVerticals,
  endpointOf,
  engineVerticals,
  measureVerticalEvidence,
  routeMounts,
} from "../support/verticalEvidence";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


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
const measured = measureVerticalEvidence();
const evidence: VerticalEvidence = measured;

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
const MATURITY_OVERCLAIM_BASELINE = 11;

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

  it("land_flipper reaches `decided` — the blind-offer commit is land's loop (rule v2)", () => {
    // routes-data-intelligence.ts records a land_deal scenario and a decision
    // under the land_flipper pack that cites it. Under the old file-ownership
    // map it counted for nobody, because the wizard is reachable from the Map
    // door by every persona. decision-memos/2026-10-04-vertical-program.md §3.
    expect(readinessOf(BUSINESS_TYPES.land_flipper, evidence)).toBe("decided");
    expect(measured.decidedBy.get("land_flipper")).toContain("server/routes-data-intelligence.ts");
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

describe("evidence rule v2 — engine-owned decisions (2026-10-04)", () => {
  const engines = engineVerticals();
  const K = new Map<string, string>([["LAND_DEAL_ENGINE_ID", "land_deal"]]);
  /** Real store imports, so the parser trusts the calls. */
  const IMPORTS = `import { recordScenario } from "./services/economics/scenarioStore";
import { recordDecision } from "./services/decisions/decisionStore";
import { recordUnderwrittenDecision } from "./services/underwriting/verticalDecision";
`;
  const facts = (body: string) => analyzeRouteSource("server/routes-x.ts", IMPORTS + body, K);

  it("vacuity: every route file is read, and the engine registry declares verticals", () => {
    expect(measured.routeFilesRead).toBeGreaterThan(250);
    const declaring = [...engines.values()].filter((e) => e.verticals.length > 0);
    expect(declaring.length).toBeGreaterThanOrEqual(4);
  });

  it("every declared vertical is a registered business type", () => {
    const bad = [...engines.entries()].flatMap(([id, e]) =>
      e.verticals.filter((v) => !BUSINESS_TYPE_IDS.includes(v)).map((v) => `${id} → ${v}`),
    );
    expect(bad).toEqual([]);
  });

  it("canary: a decision is tied to the engine of the scenario it CITES", () => {
    const f = facts(`router.post("/offer", async () => {
      const s = await recordScenario(o, { engineId: "flip_mao", inputs: {} });
      await recordDecision(o, { strategyPackId: "fix_and_flip", reviewDueAt: d ?? null }, new Date(), [s.id]);
    });`);
    expect(f.decisions).toEqual([{ pack: "fix_and_flip", citedEngineIds: ["flip_mao"], reviewHardNull: false, handlerPath: "/offer" }]);
  });

  it("canary: a scenario recorded by ANOTHER handler is not this decision's evidence", () => {
    // The audit's cross-handler attack: handler A records multifamily_noi; handler
    // B records land_deal and a multifamily decision. Per-file matching credited it.
    const f = facts(`router.post("/a", async () => { const s = await recordScenario(o, { engineId: "multifamily_noi" }); });
      router.post("/b", async () => {
        const s = await recordScenario(o, { engineId: "land_deal" });
        await recordDecision(o, { strategyPackId: "multifamily", reviewDueAt: d }, new Date(), [s.id]);
      });`);
    expect(f.decisions[0].citedEngineIds).toEqual(["land_deal"]);
    const c = creditVerticals([{ file: "server/routes-x.ts", facts: f, reachable: [true] }], engines);
    expect(c.deciding.has("multifamily")).toBe(false);
  });

  it("canary: an engine id given as an imported or `as const` constant resolves", () => {
    expect(
      facts(`import { LAND_DEAL_ENGINE_ID } from "@shared/calculators/landDeal";\nawait recordScenario(o, { engineId: LAND_DEAL_ENGINE_ID });`).scenarioEngineIds,
    ).toEqual(["land_deal"]);
    expect(
      facts(`const { LAND_DEAL_ENGINE_ID } = await import("@shared/calculators/landDeal");\nawait recordScenario(o, { engineId: LAND_DEAL_ENGINE_ID });`).scenarioEngineIds,
    ).toEqual(["land_deal"]);
    // The same NAME, not imported, is some other value.
    expect(facts(`await recordScenario(o, { engineId: LAND_DEAL_ENGINE_ID });`).scenarioEngineIds).toEqual([]);
    expect(facts(`const E = "flip_mao" as const; await recordScenario(o, { engineId: E });`).scenarioEngineIds).toEqual(["flip_mao"]);
  });

  it("canary: a constant from an UNRELATED scope does not resolve", () => {
    const f = facts(`function other() { const P = "fix_and_flip"; }
      router.post("/x", async () => { await recordDecision(o, { strategyPackId: P, reviewDueAt: d }, new Date(), []); });`);
    expect(f.decisions[0].pack).toBeNull();
  });

  it("canary: computed pack, uncited decision, and every spelling of 'never review' are seen for what they are", () => {
    const f = facts(`router.post("/x", async () => {
      const s = await recordScenario(o, { engineId: "flip_mao" });
      await recordDecision(o, { strategyPackId: pack, reviewDueAt: null }, new Date(), [s.id]);
      await recordDecision(o, { strategyPackId: "land_flipper", reviewDueAt: undefined });
      await recordDecision(o, { strategyPackId: "land_flipper" }, new Date(), [s.id]);
      const NONE = null;
      await recordDecision(o, { strategyPackId: "land_flipper", reviewDueAt: NONE }, new Date(), [s.id]);
      const reviewDueAt = d;
      await recordDecision(o, { strategyPackId: "land_flipper", reviewDueAt }, new Date(), [s.id]);
    });`);
    expect(f.decisions.map((d) => [d.pack, d.citedEngineIds.length > 0, d.reviewHardNull])).toEqual([
      [null, true, true],
      ["land_flipper", false, true],
      ["land_flipper", true, true],
      ["land_flipper", true, true],
      ["land_flipper", true, false],
    ]);
  });

  it("canary: the kit's one-call shape carries engine, pack and review date", () => {
    const f = facts(`router.post("/underwrite", async () => {
      await recordUnderwrittenDecision(o, { engineId: "rental_acquisition", strategyPackId: "buy_and_hold", reviewDueAt: due });
    });`);
    expect(f.decisions[0]).toEqual({ pack: "buy_and_hold", citedEngineIds: ["rental_acquisition"], reviewHardNull: false, handlerPath: "/underwrite" });
  });

  it("canary: a local function named like the kit or the stores is not trusted", () => {
    const f = analyzeRouteSource("server/routes-x.ts", `async function recordUnderwrittenDecision(o, x) {}
      router.post("/u", async () => { await recordUnderwrittenDecision(o, { engineId: "rental_acquisition", strategyPackId: "buy_and_hold", reviewDueAt: d }); });`, K);
    expect(f).toEqual({ scenarioEngineIds: [], decisions: [], optionalReviewSchema: false });
  });

  it("canary: an alias, a method, a late spread, a `let` and a shadowing parameter are not evidence", () => {
    // Re-audit of V0 (2026-10-04): each of these was read as the real thing.
    const alias = analyzeRouteSource(
      "server/routes-x.ts",
      `import { other as recordDecision } from "./services/decisions/decisionStore";
       router.post("/a", async () => { await recordDecision(o, { strategyPackId: "fix_and_flip", reviewDueAt: d }, new Date(), []); });`,
      K,
    );
    expect(alias.decisions).toEqual([]);

    const method = facts(`router.post("/a", async () => { await svc.recordDecision(o, { strategyPackId: "fix_and_flip", reviewDueAt: d }, new Date(), []); });`);
    expect(method.decisions).toEqual([]);

    const spread = facts(`router.post("/a", async () => {
      await recordUnderwrittenDecision(o, { engineId: "rental_acquisition", strategyPackId: "buy_and_hold", reviewDueAt: d, ...override });
    });`);
    expect(spread.decisions[0]).toMatchObject({ pack: null, citedEngineIds: [], reviewHardNull: true });

    const early = facts(`router.post("/a", async () => {
      await recordUnderwrittenDecision(o, { ...base, engineId: "rental_acquisition", strategyPackId: "buy_and_hold", reviewDueAt: d });
    });`);
    expect(early.decisions[0]).toMatchObject({ pack: "buy_and_hold", citedEngineIds: ["rental_acquisition"], reviewHardNull: false });

    const mutable = facts(`router.post("/a", async () => {
      let P = "fix_and_flip";
      const s = await recordScenario(o, { engineId: "flip_mao" });
      await recordDecision(o, { strategyPackId: P, reviewDueAt: d }, new Date(), [s.id]);
    });`);
    expect(mutable.decisions[0].pack).toBeNull();

    const shadow = facts(`router.post("/a", async () => {
      const s = await recordScenario(o, { engineId: "flip_mao" });
      const later = async (s) => recordDecision(o, { strategyPackId: "fix_and_flip", reviewDueAt: d }, new Date(), [s.id]);
    });`);
    expect(shadow.decisions[0].citedEngineIds).toEqual([]);
  });

  it("canary: a comment naming the calls is not a call", () => {
    expect(facts(`// recordScenario(o, { engineId: "flip_mao" }); recordDecision(o, { strategyPackId: "fix_and_flip" }, x, [1]);\nconst y = 1;`)).toEqual({ scenarioEngineIds: [], decisions: [], optionalReviewSchema: false });
  });

  it("reachability: mounts resolve, endpoints compose, and only a client CALL counts", () => {
    const mounts = routeMounts(`import r from "./routes-x";\napp.use('/api/x', isAuthenticated, r);`);
    expect(mounts.get("server/routes-x.ts")).toBe("/api/x");
    expect(endpointOf("server/routes-x.ts", "/underwrite", mounts)).toBe("/api/x/underwrite");
    expect(endpointOf("server/routes-y.ts", "/underwrite", mounts)).toBeNull();
    // An absolute path proves nothing on its own: the file must be registered.
    expect(endpointOf("server/routes-y.ts", "/api/y/offer", mounts)).toBeNull();
    const registered = routeMounts(`import { registerY } from "./routes-y";\nregisterY(app);`);
    expect(endpointOf("server/routes-y.ts", "/api/y/offer", registered)).toBe("/api/y/offer");
    // Imported but never called: built and unwired.
    expect(routeMounts(`import { registerY } from "./routes-y";\n`).has("server/routes-y.ts")).toBe(false);
    expect(clientCalls("/api/x/underwrite", `apiRequest("POST", "/api/x/underwrite", b)`)).toBe(true);
    expect(clientCalls("/api/p/:id/lock", "apiRequest(\"POST\", `/api/p/${id}/lock`)")).toBe(true);
    expect(clientCalls("/api/x/underwrite", `apiRequest("POST", "/api/x/underwrite-all", b)`)).toBe(false);
  });

  it("an unreachable decision credits nothing", () => {
    const f = facts(`router.post("/u", async () => { await recordUnderwrittenDecision(o, { engineId: "rental_acquisition", strategyPackId: "buy_and_hold", reviewDueAt: d }); });`);
    expect(creditVerticals([{ file: "server/routes-x.ts", facts: f, reachable: [false] }], engines).deciding.size).toBe(0);
    expect(creditVerticals([{ file: "server/routes-x.ts", facts: f, reachable: [true] }], engines).deciding.has("buy_and_hold")).toBe(true);
  });

  it("gradeability is universal: one route that never reviews makes the vertical ungradeable", () => {
    const good = facts(`router.post("/a", async () => { await recordUnderwrittenDecision(o, { engineId: "rental_acquisition", strategyPackId: "buy_and_hold", reviewDueAt: d }); });`);
    const bad = facts(`router.post("/b", async () => { await recordUnderwrittenDecision(o, { engineId: "rental_acquisition", strategyPackId: "buy_and_hold", reviewDueAt: null }); });`);
    const c = creditVerticals(
      [
        { file: "server/routes-a.ts", facts: good, reachable: [true] },
        { file: "server/routes-b.ts", facts: bad, reachable: [true] },
      ],
      engines,
    );
    expect(c.deciding.has("buy_and_hold")).toBe(true);
    expect(c.gradeable.has("buy_and_hold")).toBe(false);
    expect(c.ungradeable.get("buy_and_hold")).toEqual(["server/routes-b.ts"]);
  });

  it("canary: a route schema that lets the review date be OMITTED is ungradeable", () => {
    const decide = `router.post("/a", async () => {
        const s = await recordScenario(o, { engineId: "flip_mao" });
        await recordDecision(o, { strategyPackId: "fix_and_flip", reviewDueAt: input.reviewDueAt ?? null }, new Date(), [s.id]);
      });`;
    for (const chain of [
      "z.string().datetime().nullable().optional()",
      "z.coerce.date().nullish()",
      "z.string().nullable().default(null)",
      "z.string().datetime().nullable().catch(null)",
      "z.string().datetime().nullable().or(z.undefined())",
      "z.preprocess((v) => v ?? null, z.string().nullable())",
    ]) {
      const f = facts(`const schema = z.object({ reviewDueAt: ${chain} });\n${decide}`);
      expect(f.optionalReviewSchema, chain).toBe(true);
      const c = creditVerticals([{ file: "server/routes-x.ts", facts: f, reachable: [true] }], engines);
      expect(c.deciding.has("fix_and_flip"), chain).toBe(true);
      expect(c.gradeable.has("fix_and_flip"), chain).toBe(false);
    }
    // A quoted key, and `.partial()` over a schema that names it, omit it too.
    expect(facts(`const s = z.object({ "reviewDueAt": z.string().optional() });`).optionalReviewSchema).toBe(true);
    expect(facts(`const base = z.object({ reviewDueAt: z.string().nullable() });\nconst s = base.partial();`).optionalReviewSchema).toBe(true);
    expect(facts(`const rules = z.object({ feePct: z.number() }).partial();`).optionalReviewSchema).toBe(false);
    const required = facts(`const schema = z.object({ reviewDueAt: z.coerce.date().nullable().refine((d) => d === null) });\n${decide}`);
    expect(required.optionalReviewSchema).toBe(false);
    expect(creditVerticals([{ file: "server/routes-x.ts", facts: required, reachable: [true] }], engines).gradeable.has("fix_and_flip")).toBe(true);
  });

  it("a composite is decided only when every part is, and underwritten likewise", () => {
    const meta = BUSINESS_TYPES.hybrid;
    const ev = (deciding: BusinessTypeId[], underwritten: BusinessTypeId[] = []): VerticalEvidence => ({
      definedWorkflowTemplateIds: evidence.definedWorkflowTemplateIds,
      underwrittenBusinessTypes: new Set(underwritten),
      decidingBusinessTypes: new Set(deciding),
    });
    expect(readinessOf(meta, ev(["land_flipper"]))).toBe("surfaced");
    expect(readinessOf(meta, ev(["land_flipper", "note_investor"]))).toBe("decided");
    expect(readinessOf(meta, ev(["land_flipper"], ["note_investor"]))).toBe("underwritten");
    // A composite cannot be decided on its own id — it has no loop of its own.
    expect(readinessOf(meta, ev(["hybrid"]))).toBe("surfaced");
  });

  it("the legacy file-ownership map only shrinks, and holds no vertical the engine rule already earns", () => {
    expect(Object.keys(LEGACY_DECISION_ROUTE_OWNER)).toEqual(["server/routes-lot-pricing.ts"]);
    for (const [file, owner] of Object.entries(LEGACY_DECISION_ROUTE_OWNER)) {
      const viaEngines = (measured.decidedBy.get(owner) ?? []).filter((f) => f !== file);
      expect(viaEngines, `${owner} now decides through an engine — remove its legacy entry`).toEqual([]);
    }
  });
});

describe("a decided vertical is gradeable (the loop can close on reality)", () => {
  /**
   * Down-only. subdivider's lot-pricing lock records no scenario and hard-codes
   * reviewDueAt: null, so none of its decisions is ever asked for an outcome.
   * Wave V2 gives it both and removes it from here.
   */
  const NOT_YET_GRADEABLE: readonly BusinessTypeId[] = ["subdivider"];
  const gradeable = measured.gradeableBusinessTypes;

  it("vacuity: the gradeable set is real", () => {
    expect(gradeable.has("fix_and_flip")).toBe(true);
    expect(gradeable.has("land_flipper")).toBe(true);
  });

  it("every decided vertical takes a review date and predicts what an outcome measures", () => {
    // A composite (hybrid) is never in decidingBusinessTypes itself — its tier
    // is derived from its parts in readinessOf — so it needs no exclusion here.
    const decided = BUSINESS_TYPE_IDS.filter((id) => evidence.decidingBusinessTypes.has(id));
    // Universal, not existential: gradeableBusinessTypes already drops a vertical
    // when ANY of its crediting decisions is ungradeable; the offending route
    // files are named so the failure says where to look.
    const ungradeable = decided
      .filter((id) => !gradeable.has(id) && !NOT_YET_GRADEABLE.includes(id))
      .map((id) => `${id}: ${(measured.ungradeable.get(id) ?? []).join(", ")}`);
    expect(
      ungradeable,
      "a vertical decides but can never be graded: its route hard-codes reviewDueAt null, or " +
        "its engine predicts neither total_cost nor profit (the metrics the outcome prompt measures).",
    ).toEqual([]);
  });

  it("the exceptions list cannot rot", () => {
    for (const id of NOT_YET_GRADEABLE) {
      expect(gradeable.has(id), `${id} is gradeable now — remove it from NOT_YET_GRADEABLE`).toBe(false);
    }
  });
});

