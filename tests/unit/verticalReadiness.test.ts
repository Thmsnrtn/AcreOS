/**
 * A declared maturity may not exceed evidenced readiness.
 *
 * ── SINCE FD1 (2026-11-12) ──────────────────────────────────────────────────
 * The registry states the launch presentation itself — 4 core / 1 beta / 10
 * registry_only since Tax's 2026-11-19 lift (fd1LaunchScope.test.ts) — and the public demotion table is
 * empty. The ratchet below therefore counts ONE gap: `tax_lien_deed`,
 * promised as core by founder decision on evidence that reaches
 * `surfaced`. (`note_investor` stood here too until 2026-11-20, when its
 * price-to-yield desk started recording decisions and the gap closed.)
 * Those gaps are
 * named in a dated register (FD1_CORE_ON_SURFACED_EVIDENCE) rather than
 * tolerated silently, and each closes when its vertical records a decision.
 *
 * ── WHAT WAS WRONG (as measured 2026-08-17) ─────────────────────────────────
 * All fifteen verticals in `shared/business-types.ts` declared
 * `maturity: "core"`. Exactly one — `fix_and_flip` — closed the canonical loop.
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
import { BUSINESS_TYPES, BUSINESS_TYPE_IDS, registryPublicTier, type BusinessTypeId } from "../../shared/business-types";
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
import { CAPABILITIES } from "../../shared/governance/evidenceLadder";
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
// 13 → 12 on 2026-10-21: land released. Buy-and-hold's decision route is held
// back (claude/buy-and-hold-underwriting) until its journey is evidenced.
// 12 → 11 on 2026-11-03: buy-and-hold's decision desk re-mounted on main
// (server/routes-buy-and-hold-underwriting.ts), so its measured evidence
// reaches `decided`.
// 11 → 10 on 2026-11-05: the wholesale decision desk mounted
// (server/routes-wholesale-underwriting.ts, engine wholesale_mao), so
// residential_wholesaler's measured evidence reaches `decided`.
// 10 → 1 on 2026-11-15: FD1 (founder decision 2026-11-12) RELABELLED the
// registry to the launch presentation — the second of the two legitimate ways
// above. Nine `core` labels became `beta` or `registry_only` (each requiring
// only `surfaced`, which every vertical reaches). MEASURED by this test's own
// run before the number was lowered: "overclaims dropped to 1". The one left is
// note_investor — public core by founder decision on `surfaced` evidence,
// registered below in FD1_CORE_ON_SURFACED_EVIDENCE.
// 1 → 2 on 2026-11-19: tax_lien_deed LIFTED beta → core on journey proof
// (the founder counted Tax proven 2026-11-19; walk record
// journey-walk-tax-2026-11). Its code evidence still reaches only
// `surfaced` (no decision desk yet), so the lift registers it below
// beside note_investor — a founder-decided public core on surfaced
// evidence, counted here rather than hidden.
// 2 → 1 on 2026-11-20: note_investor EARNED its way off the register —
// the price-to-yield engine + decision desk (Step 0 N3+N4) record
// decisions citing gradeable scenarios, so its measured evidence reaches
// `decided` and the exemption is deleted below (N5 integrator lift).
// tax_lien_deed remains the one founder-decided public core on surfaced
// evidence.
const MATURITY_OVERCLAIM_BASELINE = 1;

/**
 * FOUNDER-DECIDED PUBLIC CORE ON SURFACED EVIDENCE (FD1, 2026-11-12).
 *
 * The one place a public `core` claim may stand on less than a recorded
 * decision, and only because the founder decided it by name.
 *
 * The register's first member was note_investor (FD1, 2026-11-12 — one of
 * the two launch promises, its evidence then reaching only `surfaced`).
 * It LEFT on 2026-11-20: the price-to-yield engine + decision desk
 * (Step 0 N3+N4) record decisions, its measured evidence reaches
 * `decided`, and the exemption closed exactly as designed (N5 lift).
 *
 * tax_lien_deed JOINED 2026-11-19, on the same terms, and is now the
 * sole entry: its journey is
 * proven (the founder counted Tax proven 2026-11-19; walk record
 * journey-walk-tax-2026-11) but its code evidence reaches only `surfaced`
 * (four live cert emitters, no production decision desk yet), so its public
 * `core` claim likewise stands on the founder's decision, by name.
 *
 * Not a waiver. Each entry fails loudly when:
 *   - it no longer OVERCLAIMS (the vertical records a decision → the gap is
 *     closed → delete the entry and lower the ratchet);
 *   - its registry maturity is not `core` (then it needs no exemption);
 *   - its decision file does not exist;
 *   - the set is widened without changing the pinned list below.
 */
const FD1_CORE_ON_SURFACED_EVIDENCE: Partial<Record<BusinessTypeId, { decidedOn: string; decision: string }>> = {
  tax_lien_deed: {
    decidedOn: "2026-11-19",
    decision: "docs/company/founder-decisions-2026-11-12-launch-scope.md",
  },
};
const isFounderDecidedCore = (id: string) => id in FD1_CORE_ON_SURFACED_EVIDENCE;

/**
 * HELD PENDING JOURNEY PROOF (founder decision 2026-11-05, Option B —
 * docs/company/founder-decisions-2026-11-05-buy-and-hold.md).
 *
 * This file measures evidence FROM SOURCE: a mounted decision writer makes a
 * vertical `decided`. The public claim, though, waits on JOURNEY evidence — the
 * scripted staging run in the Readiness Atlas. Between the two, a vertical can
 * be code-`decided` and still deliberately `beta`. This register names that
 * state explicitly instead of letting the OD-5 rules below force the lift in
 * the same commit as the mount.
 *
 * It is not a waiver. Every entry is held to all of these, and each one fails
 * loudly:
 *   - it must MEASURE `decided` (an entry for an unclosed vertical is stale);
 *   - its public demotion must still exist and be `beta` (lifting it ends the
 *     hold, and the entry must go with it);
 *   - its ladder entry must NOT claim the loop (the ladder flips only on the
 *     journey proof, in the same commit that deletes the entry);
 *   - it expires: after `reviewBy` the gate fails until the founder lifts the
 *     claim on the Atlas row or re-dates the hold;
 *   - the register is pinned: adding a vertical here is a founder decision.
 *
 * LIFTED 2026-11-05 (founder decision, addendum to the file above): buy_and_hold's
 * post-merge staging journey proof passed, so its demotion was removed, its
 * ladder entry flipped to "decided" and its entry here deleted, in one commit.
 * The register is now EMPTY and pinned empty, and nothing below consults it:
 * the OD-5 assertions ("no demotion is stale", "covers exactly", the ladder
 * agreement) hold with no exemption at all. A future hold therefore needs a new
 * founder decision AND a deliberate re-wiring of the exemption — it cannot come
 * back by adding a line here.
 *
 * RE-WIRED 2026-11-07 for residential_wholesaler, as the paragraph above
 * requires: a founder decision (docs/company/founder-decisions-2026-11-05-wholesale.md,
 * confirmed by the coordinator) AND the exemption visibly restored at the three
 * OD-5 sites below (`isHeld`). The wholesale package's Leg 5 staging walk is
 * the proof that ends it, in its own lift PR — the same path buy_and_hold took.
 *
 * LIFTED 2026-11-18 for residential_wholesaler: the scoped revenue-loop
 * journey walk passed green end-to-end on staging (first walk + post-fix
 * re-walk + send-half run; walk record journey-walk-wholesale-2026-11), so
 * its registry maturity was lifted to `core`, its ladder entry flipped to
 * `decided`, and its entry here deleted, in one commit — recorded as an
 * addendum in its decision file. The register is EMPTY again and pinned
 * empty; the lifted state is pinned by name in the block below.
 */
const HELD_PENDING_JOURNEY_PROOF: Partial<Record<BusinessTypeId, { heldSince: string; reviewBy: string; decision: string }>> = {};
const isHeld = (id: string) => id in HELD_PENDING_JOURNEY_PROOF;

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
    // vertical is short of a SURFACE; each has modules and real templates and
    // stops dead before a recorded decision. If a vertical ever drops to
    // `declared` this fails, and it should: shipping a vertical with no surface
    // at all is a different and worse defect than not closing.
    const notSurfaced = over.filter((r) => r.evidenced !== "surfaced");
    expect(
      notSurfaced.map((r) => `${r.id}=${r.evidenced}`),
      "an overclaiming vertical is no longer merely unclosed — read the tier",
    ).toEqual([]);
  });

  it("every remaining overclaim is a founder-decided public core, by name (FD1)", () => {
    // The ratchet says HOW MANY; this says WHICH, so a tolerated gap
    // cannot be quietly swapped for a different vertical at the same count.
    expect(over.map((r) => r.id).sort()).toEqual(Object.keys(FD1_CORE_ON_SURFACED_EVIDENCE).sort());
    for (const r of over) {
      expect(r.declared, `${r.id} is exempted but is not declared core`).toBe("core");
    }
  });

  it("the FD1 register cannot rot: each entry still overclaims, is dated, and cites a decision file that exists", () => {
    const entries = Object.entries(FD1_CORE_ON_SURFACED_EVIDENCE) as Array<[BusinessTypeId, { decidedOn: string; decision: string }]>;
    expect(entries.map(([id]) => id)).toEqual(["tax_lien_deed"]);
    for (const [id, e] of entries) {
      expect(BUSINESS_TYPES[id].maturity, `${id} is not core — it needs no exemption; remove it`).toBe("core");
      expect(
        overclaims(BUSINESS_TYPES[id], evidence),
        `${id} no longer overclaims (it records a decision) — delete its register entry and lower the ratchet`,
      ).toBe(true);
      expect(e.decidedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fs.existsSync(path.join(ROOT, e.decision)), e.decision).toBe(true);
    }
  });

  it("tax_lien_deed's 2026-11-19 lift is pinned by name: core in the registry, still `surfaced` in code, registered above", () => {
    // The lifted state, pinned so that quietly reverting the maturity or
    // deleting the register entry fails here as well as in the ratchet.
    // Tax earned core by JOURNEY proof (founder counted it proven
    // 2026-11-19; walk record journey-walk-tax-2026-11, N3 send leg in
    // simulation mode under the zero-real-mail rule, footnote on the
    // record) — not by recording a decision, so unlike buy_and_hold and
    // residential_wholesaler it still measures `surfaced` and its core
    // claim stands on the FD1 register — as note_investor's did, until
    // its desk earned it off the register on 2026-11-20.
    expect(BUSINESS_TYPES.tax_lien_deed.maturity).toBe("core");
    expect(readinessOf(BUSINESS_TYPES.tax_lien_deed, evidence)).toBe("surfaced");
    expect(FD1_CORE_ON_SURFACED_EVIDENCE.tax_lien_deed?.decidedOn).toBe("2026-11-19");
    const doc = fs.readFileSync(
      path.resolve(__dirname, "../..", "docs/company/founder-decisions-2026-11-12-launch-scope.md"),
      "utf8",
    );
    expect(doc).toMatch(/\*\*Membership lifted 2026-11-19 \(Tax beta → core\)\.\*\*/);
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

describe("no PUBLIC claim outruns the evidence (OD-5, under FD1)", () => {
  // This is a HARD ZERO outside the FD1 register, not a ratchet, and the
  // difference matters.
  //
  // Under OD-5 the registry said `core` fifteen times and the demotion table
  // lowered the public claim. Under FD1 the registry states the public promise
  // itself, so the public tier IS the registry tier (registry_only → "not
  // sold"). What a STRANGER is told before they can check still has no excuse
  // to outrun the evidence — except the one the founder gave by name
  // (FD1_CORE_ON_SURFACED_EVIDENCE), which is pinned above and expires on its
  // own terms.
  const rows = projectReadiness(BUSINESS_TYPES, evidence);

  it("every vertical's public tier is supported by its evidence, outside the FD1 register", () => {
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
          // A public tier is judged by the REGISTRY tier it stands for: the
          // "not sold" tier is what registry_only projects to, and it demands
          // `surfaced` (readiness.ts), not the nothing `roadmap` demands.
          bad: overclaims({ ...meta, maturity: publicTier === "roadmap" ? "registry_only" : publicTier }, evidence),
        };
      })
      .filter((r) => r.bad);

    expect(
      over.filter((r) => !isFounderDecidedCore(r.id)).map((r) => `${r.id}: publicly "${r.publicTier}" but evidences ${r.evidenced}`),
      "A PUBLIC surface claims more than this repository can show. Lower the " +
        "registry maturity in shared/business-types.ts (FD1 is the presentation " +
        "of record), or close the loop for that vertical.",
    ).toEqual([]);
    // The register covers exactly what overclaims publicly — no spare
    // exemption may sit there budgeting for a future overclaim.
    expect(over.map((r) => r.id).sort()).toEqual(Object.keys(FD1_CORE_ON_SURFACED_EVIDENCE).sort());
  });

  it("the public tier IS the registry's projection — no table in between (FD1)", () => {
    // The conservatism channel is kept for a future founder decision, but today
    // it must be empty: a non-empty table means the registry and the public
    // promise have drifted apart again, and the registry is the thing to fix.
    expect(PUBLIC_CLAIM_DEMOTIONS).toEqual({});
    for (const id of BUSINESS_TYPE_IDS) {
      expect(publicMaturityOf(BUSINESS_TYPES[id]), id).toBe(registryPublicTier(BUSINESS_TYPES[id].maturity));
    }
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

    // A no-op / promote: demoting a synthetic registry where `commercial` is
    // `roadmap` up to `beta` must be refused.
    const asRoadmap = {
      ...BUSINESS_TYPES,
      commercial: { ...BUSINESS_TYPES.commercial, maturity: "roadmap" as const },
    };
    expect(() => assertDemotionsValid({ commercial: ok }, asRoadmap)).toThrow(
      /must move a vertical DOWN/,
    );

    // FD1: a registry_only vertical is ALREADY told as "not sold". "Demoting" it
    // to roadmap is a no-op and to beta is a promote — both refused, judged on
    // the public tier the registry projects. commercial is registry_only live.
    expect(BUSINESS_TYPES.commercial.maturity).toBe("registry_only");
    expect(() => assertDemotionsValid({ commercial: ok })).toThrow(/must move a vertical DOWN/);
    expect(() => assertDemotionsValid({ commercial: { ...ok, to: "roadmap" } })).toThrow(
      /must move a vertical DOWN/,
    );

    // A vertical that is not in the registry at all.
    expect(() =>
      assertDemotionsValid({ not_a_vertical: ok } as never),
    ).toThrow(/not in the registry/);

    // And the happy path still passes, so the throws above are not universal:
    // buy_and_hold is core, so beta is a genuine DOWN move.
    expect(() => assertDemotionsValid({ buy_and_hold: ok })).not.toThrow();
  });

  it("no demotion is stale — a vertical that closed the loop must be released", () => {
    // The mirror direction. A vertical that starts recording decisions has
    // EARNED its `core` claim back, and leaving the demotion in place would
    // understate the product indefinitely — the same rot as an overclaim,
    // pointing the other way.
    const stale = Object.keys(PUBLIC_CLAIM_DEMOTIONS).filter((id) => {
      const meta = BUSINESS_TYPES[id as BusinessTypeId];
      // A vertical held pending its journey proof keeps its demotion on
      // purpose; the held-register block below holds it to its own rules.
      return readinessOf(meta, evidence) === "decided" && !isHeld(id);
    });
    expect(
      stale,
      "these verticals now evidence `decided` and no longer need a public " +
        "demotion — remove their PUBLIC_CLAIM_DEMOTIONS entries.",
    ).toEqual([]);
  });

  it("the registry carries the conservatism: every vertical that cannot show `decided` is below core publicly, except the FD1 register", () => {
    // Under OD-5 this asserted the demotion table was exactly the complement of
    // the verticals that close the loop. Under FD1 the same invariant lives in
    // the registry: a vertical that cannot show `decided` (or is held for its
    // journey proof) must not PROJECT to core — unless the founder named it.
    const cannotShowCore = BUSINESS_TYPE_IDS.filter(
      (id) => readinessOf(BUSINESS_TYPES[id], evidence) !== "decided" || isHeld(id),
    );
    const toldCore = cannotShowCore.filter((id) => publicMaturityOf(BUSINESS_TYPES[id]) === "core");
    expect(toldCore.sort()).toEqual(Object.keys(FD1_CORE_ON_SURFACED_EVIDENCE).sort());
    // Vacuity: the population is real — most verticals still cannot show decided.
    expect(cannotShowCore.length).toBeGreaterThan(5);
  });
});

describe("the Evidence Ladder states the same vertical truth (one rule, not two)", () => {
  // shared/governance/evidenceLadder.ts carries an entry per vertical whose claim
  // and caveat reach the founder (scorecard, outlook). It once restated the OD-5
  // demotions by hand, so releasing land here would have left the
  // ladder telling the founder both were "beta". Pinned against the SERIALIZED
  // entries and the MEASURED tier, not against the ladder's own helper.
  const decided = (id: BusinessTypeId) => readinessOf(BUSINESS_TYPES[id], evidence) === "decided";
  const entry = (id: BusinessTypeId) => CAPABILITIES.find((c) => c.id === `vertical.${id}`);

  it("every registered vertical has a ladder entry", () => {
    expect(BUSINESS_TYPE_IDS.filter((id) => !entry(id))).toEqual([]);
  });

  it("a ladder entry claims the loop exactly when the measurement says `decided`", () => {
    const disagree = BUSINESS_TYPE_IDS.filter(
      // A held vertical's ladder waits for the journey proof, like its claim.
      (id) => /closes the canonical loop/.test(entry(id)?.claim ?? "") !== (decided(id) && !isHeld(id)),
    ).map((id) => `${id}: ladder "${entry(id)?.claim}", measured ${readinessOf(BUSINESS_TYPES[id], evidence)}`);
    expect(disagree).toEqual([]);
  });

  it("a ladder caveat states the public tier exactly as publicMaturityOf projects it (FD1)", () => {
    // The ladder used to restate OD-5 by hand ("the public claim is beta"). It
    // now reads the registry's projection; this pins the SERIALIZED caveat
    // wording to publicMaturityOf, per tier, so neither can drift from the other.
    const caveat = (id: BusinessTypeId) => entry(id)?.caveat ?? "";
    const claimsLoop = (id: BusinessTypeId) => /closes the canonical loop/.test(entry(id)?.claim ?? "");
    const disagree = BUSINESS_TYPE_IDS.filter((id) => {
      const tier = publicMaturityOf(BUSINESS_TYPES[id]);
      const saysBeta = /public claim is beta/.test(caveat(id));
      const saysNotSold = /not in the public promise/.test(caveat(id));
      // A public-core vertical carries the "core" wording only when it stands
      // on surfaced evidence (the FD1 register); a decided public core has no
      // public caveat at all.
      const saysCore = /public claim is core/.test(caveat(id));
      return (
        saysBeta !== (tier === "beta") ||
        saysNotSold !== (tier === "roadmap") ||
        saysCore !== (tier === "core" && !claimsLoop(id))
      );
    }).map((id) => `${id}: public "${publicMaturityOf(BUSINESS_TYPES[id])}", caveat "${caveat(id)}"`);
    expect(disagree).toEqual([]);
    // Vacuity: all three wordings occur on the live ladder.
    expect(BUSINESS_TYPE_IDS.some((id) => /public claim is beta/.test(caveat(id)))).toBe(true);
    expect(BUSINESS_TYPE_IDS.some((id) => /not in the public promise/.test(caveat(id)))).toBe(true);
    expect(BUSINESS_TYPE_IDS.some((id) => /public claim is core/.test(caveat(id)))).toBe(true);
  });

  it("a ladder caveat says `not yet gradeable` exactly for a decided vertical the measurement cannot grade", () => {
    const disagree = BUSINESS_TYPE_IDS.filter((id) => {
      const says = /not yet gradeable/.test(entry(id)?.caveat ?? "");
      const is = evidence.decidingBusinessTypes.has(id) && !measured.gradeableBusinessTypes.has(id);
      return says !== is;
    });
    expect(disagree).toEqual([]);
  });
});

describe("held pending journey proof — code-decided, claim still beta, and dated", () => {
  const entry = (id: string) => CAPABILITIES.find((c) => c.id === `vertical.${id}`);
  const held = Object.entries(HELD_PENDING_JOURNEY_PROOF) as Array<[BusinessTypeId, { heldSince: string; reviewBy: string; decision: string }]>;

  it("the register is exactly the founder-decided set", () => {
    // Adding a vertical here bypasses OD-5 for it. That is a founder decision,
    // so the set is pinned and widening it fails until this line is changed.
    // buy_and_hold left it on 2026-11-05 (lifted); residential_wholesaler
    // joined under its own decision file and left it on 2026-11-18 (lifted).
    // The register is empty and pinned empty.
    expect(held.map(([id]) => id)).toEqual([]);
  });

  it.each(held)("%s measures `decided` — a hold over an unclosed vertical is stale", (id) => {
    expect(BUSINESS_TYPE_IDS).toContain(id);
    expect(readinessOf(BUSINESS_TYPES[id], evidence)).toBe("decided");
  });

  it.each(held)("%s keeps its public claim at `beta` — lifting it ends the hold", (id) => {
    // Under OD-5 this read the demotion table; under FD1 the registry itself
    // said `beta` for a held vertical, and the public claim is the registry's
    // projection.
    expect(BUSINESS_TYPES[id].maturity).toBe("beta");
    expect(publicMaturityOf(BUSINESS_TYPES[id])).toBe("beta");
  });

  it.each(held)("%s's ladder entry does not claim the loop until the journey proof", (id) => {
    expect(entry(id), `no ladder entry for ${id}`).toBeDefined();
    expect(entry(id)!.claim).not.toMatch(/closes the canonical loop/);
  });

  it.each(held)("%s is dated, cites its decision, and has not expired", (id, h) => {
    expect(h.heldSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.reviewBy > h.heldSince).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, "../..", h.decision)), h.decision).toBe(true);
    expect(
      Date.now() < Date.parse(`${h.reviewBy}T23:59:59Z`),
      `${id}'s hold expired on ${h.reviewBy}. Run the journey proof and lift the claim on the Atlas row, ` +
        "or have the founder re-date the hold — do not move the date to get green.",
    ).toBe(true);
  });

  it("buy_and_hold is released from its hold: measured `decided`, no demotion entry, and the ladder claims the loop", () => {
    // The lifted state, pinned by name so that reinstating the hold or
    // reverting the ladder entry fails here as well as in the OD-5 rules above.
    // FD1 (2026-11-12) then set its REGISTRY maturity to `core` — one of the
    // two full-strength launch types, per the 2026-11-12 decision records —
    // so its public claim is core by the registry, not by a demotion. Its
    // ladder entry therefore carries NO public-tier caveat: the generator
    // states one only beside a decided vertical the founder kept below core
    // (under the S1 recording this entry said "the public claim is beta
    // (FD1)" — that was the unratified Land↔Buy-and-Hold swap; corrected
    // 2026-11-16 by founder ruling.)
    expect(readinessOf(BUSINESS_TYPES.buy_and_hold, evidence)).toBe("decided");
    expect(PUBLIC_CLAIM_DEMOTIONS.buy_and_hold).toBeUndefined();
    expect(BUSINESS_TYPES.buy_and_hold.maturity).toBe("core");
    expect(entry("buy_and_hold"), "no ladder entry for buy_and_hold").toBeDefined();
    expect(entry("buy_and_hold")!.claim).toMatch(/closes the canonical loop/);
    expect(entry("buy_and_hold")!.caveat).toBeUndefined();
  });

  it("the lift is recorded in the founder decision file", () => {
    const doc = fs.readFileSync(
      path.resolve(__dirname, "../..", "docs/company/founder-decisions-2026-11-05-buy-and-hold.md"),
      "utf8",
    );
    expect(doc).toMatch(/## Addendum — 2026-11-05: the hold is lifted/);
  });

  it("residential_wholesaler is released from its hold: measured `decided`, no demotion entry, and the ladder claims the loop", () => {
    // The lifted state, pinned by name so that reinstating the hold or
    // reverting the ladder entry fails here as well as in the OD-5 rules
    // above. The hold (founder-decisions-2026-11-05-wholesale.md) ended
    // 2026-11-18 when the scoped revenue-loop journey walk passed green
    // end-to-end on staging; FD1's registry maturity is now `core`, so its
    // public claim is core by the registry and its ladder entry carries NO
    // public-tier caveat (the generator states one only beside a decided
    // vertical the founder kept below core).
    expect(readinessOf(BUSINESS_TYPES.residential_wholesaler, evidence)).toBe("decided");
    expect(PUBLIC_CLAIM_DEMOTIONS.residential_wholesaler).toBeUndefined();
    expect(BUSINESS_TYPES.residential_wholesaler.maturity).toBe("core");
    expect(entry("residential_wholesaler"), "no ladder entry for residential_wholesaler").toBeDefined();
    expect(entry("residential_wholesaler")!.claim).toMatch(/closes the canonical loop/);
    expect(entry("residential_wholesaler")!.caveat).toBeUndefined();
  });

  it("the wholesale lift is recorded in the founder decision file", () => {
    const doc = fs.readFileSync(
      path.resolve(__dirname, "../..", "docs/company/founder-decisions-2026-11-05-wholesale.md"),
      "utf8",
    );
    expect(doc).toMatch(/## Addendum — 2026-11-18: the hold is lifted/);
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

  it("the legacy file-ownership map only shrinks, and each entry credits only its own surface's uncited decisions", () => {
    expect(Object.keys(LEGACY_DECISION_ROUTE_OWNER)).toEqual(["server/routes-lot-pricing.ts"]);
    for (const [file, owner] of Object.entries(LEGACY_DECISION_ROUTE_OWNER)) {
      // Per-surface credit (resolution (a), 2026-11-09): an entry credits the
      // decisions of the ONE route file it names — here, the lot-pricing lock
      // route's scenario-less lock decisions. Another file in the same
      // vertical deciding through an engine (the subdivision decision desk)
      // is a different surface: it neither needs this entry nor retires it.
      // The entry retires when ITS OWN route's decisions cite an engine
      // declaring the vertical — that is the removal signal, and only that.
      const ownSurface = (measured.engineDecidedBy.get(owner) ?? []).filter((f) => f === file);
      expect(ownSurface, `${file} now decides through an engine — remove its legacy entry`).toEqual([]);
      // The entry must still be load-bearing for its own surface: the route
      // still credits the vertical, through a decision citing no scenario (it
      // sits in the ungradeable set via the legacy branch). An entry whose
      // route credits nothing — or no longer credits it uncited — is dead
      // weight and must go as well.
      expect(measured.decidedBy.get(owner) ?? [], `${file} no longer credits ${owner} — remove its legacy entry`).toContain(file);
      expect(measured.ungradeable.get(owner) ?? [], `${file} records no uncited decision for ${owner} — remove its legacy entry`).toContain(file);
    }
  });

  it("canary: legacy credit is per-surface — an engine desk elsewhere in the vertical does not retire it; an engine-cited lock route does", () => {
    // The lot-pricing shape: a decision for the pack, citing no scenario.
    const lock = facts(`router.post("/lock", async () => {
      await recordDecision(o, { strategyPackId: "subdivider", reviewDueAt: null }, new Date(), []);
    });`);
    // The Leg 4 desk shape: the same pack, decided through the engine.
    const desk = facts(`router.post("/decide", async () => {
      await recordUnderwrittenDecision(o, { engineId: "subdivision_feasibility", strategyPackId: "subdivider", reviewDueAt: d });
    });`);
    const legacy: Readonly<Record<string, BusinessTypeId>> = { "server/routes-lot-pricing.ts": "subdivider" };
    const both = creditVerticals(
      [
        { file: "server/routes-lot-pricing.ts", facts: lock, reachable: [true] },
        { file: "server/routes-subdivision-decision.ts", facts: desk, reachable: [true] },
      ],
      engines,
      legacy,
    );
    // Both surfaces credit subdivider; only the desk's credit is engine-cited,
    // and only the lock route's credit is ungradeable.
    expect(both.deciding.has("subdivider")).toBe(true);
    expect(both.decidedBy.get("subdivider")).toEqual(["server/routes-lot-pricing.ts", "server/routes-subdivision-decision.ts"]);
    expect(both.engineDecidedBy.get("subdivider")).toEqual(["server/routes-subdivision-decision.ts"]);
    expect(both.ungradeable.get("subdivider")).toEqual(["server/routes-lot-pricing.ts"]);

    // The falsification direction: if the LOCK ROUTE itself cites the engine,
    // its credit moves to the engine rule — exactly the signal the map law
    // above reads as "remove its legacy entry".
    const lockCited = facts(`router.post("/lock", async () => {
      const s = await recordScenario(o, { engineId: "subdivision_feasibility", inputs: {} });
      await recordDecision(o, { strategyPackId: "subdivider", reviewDueAt: null }, new Date(), [s.id]);
    });`);
    const cited = creditVerticals([{ file: "server/routes-lot-pricing.ts", facts: lockCited, reachable: [true] }], engines, legacy);
    expect(cited.engineDecidedBy.get("subdivider")).toEqual(["server/routes-lot-pricing.ts"]);
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

