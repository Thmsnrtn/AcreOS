// @vitest-environment jsdom
/**
 * Given registry state X, the public landing truthfully represents X.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE SOURCE SCAN ─────────────────────────
 * `verticalReadiness.test.ts` proves two things statically: the public
 * projection is coherent, and no public source file reads `.maturity` directly.
 * Both are worth having, and neither is proof that a visitor is told the truth.
 *
 * The OD-5 failure was exactly that gap. The gate mapped the registry through
 * its own projection, called the answer consistent, and scanned nothing a human
 * ever sees — so an audit reinstated a public endpoint publishing raw maturity
 * and the whole suite stayed green. A projection that agrees with itself proves
 * only that it is a function.
 *
 * So this file renders the actual React the landing ships and reads the DOM. It
 * drives the registry to states the live one is not in, which is the part that
 * makes it behavioural rather than a restatement: the assertions hold for
 * registry states nobody has committed yet.
 *
 * ── SINCE FD1 (2026-11-12) ──────────────────────────────────────────────────
 * The registry states the launch presentation (2 core / 3 beta / 10
 * registry_only) and the demotion table is empty, so the tiers a visitor sees
 * derive from the registry alone. The registry-only types render in the
 * landing's third, muted tier — whose copy still reads "promised, not sold"
 * (client/src/pages/landing/copy.ts, a landing follow-up outside this slice).
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 * This is one representative high-consequence surface, not screenshot
 * infrastructure for every state transition. The rule earned from the Beta
 * badge is "when a canonical transition makes a rare UI state common, exercise
 * that state in the real surface" — FD1 moved nine chips into a tier that had
 * been empty, so that tier gets exercised too.
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_IDS,
  type BusinessTypeId,
  type BusinessTypeMeta,
} from "../../shared/business-types";
import {
  PUBLIC_CLAIM_DEMOTIONS,
  publicMaturityOf,
} from "../../shared/business-types/publicClaims";
import { readinessOf } from "../../shared/business-types/readiness";
import { measureVerticalEvidence } from "../support/verticalEvidence";
import { deriveLandingTiers, Positioning } from "../../client/src/pages/landing/Positioning";

/** What the repo can actually demonstrate — the anchor that is NOT the map. */
const evidence = measureVerticalEvidence();

/**
 * The one vertical the founder promised as core on `surfaced` evidence (FD1).
 * Mirrors FD1_CORE_ON_SURFACED_EVIDENCE in verticalReadiness.test.ts; both pin
 * the same single name, and both fail when the notes vertical records a
 * decision (the entry must then go).
 */
const FD1_CORE_ON_SURFACED_EVIDENCE: Partial<Record<BusinessTypeId, string>> = {
  note_investor: "docs/company/founder-decisions-2026-11-12-launch-scope.md",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** The tier lists as the DOM actually renders them, read by aria-label. */
function renderedTiers() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Positioning />));

  const read = (label: string): string[] => {
    const ul = container!.querySelector(`ul[aria-label="${label}"]`);
    if (!ul) return [];
    return Array.from(ul.querySelectorAll("li")).map((li) => li.textContent ?? "");
  };
  return {
    core: read("Investor types with full workflow support"),
    beta: read("Investor types in beta"),
    notSold: read("Investor types on the roadmap"),
  };
}

const registryIds = (maturity: BusinessTypeMeta["maturity"]) =>
  BUSINESS_TYPE_IDS.filter((id) => BUSINESS_TYPES[id].maturity === maturity && id !== "hybrid");

describe("what a visitor is actually shown", () => {
  it("renders exactly the verticals the canonical projection says are core", () => {
    const { core } = renderedTiers();

    const expected = Object.values(BUSINESS_TYPES)
      .filter((m) => publicMaturityOf(m) === "core" && m.id !== "hybrid")
      .map((m) => m.label);

    expect([...core].sort()).toEqual([...expected].sort());
  });

  it("shows NO vertical as core that cannot evidence a recorded decision — except the one FD1 names", () => {
    // THE ANCHOR THAT IS NOT THE MAP, and the reason tests/support exists.
    //
    // Every other assertion here derives its expectation from the registry or
    // publicMaturityOf, so flipping a registry value moves the expectation and
    // the DOM together and they still agree. A projection compared against
    // itself proves only that it is a function.
    //
    // This compares the rendered page against the EVIDENCE instead: a chip may
    // sit in "full workflow support" only if that vertical actually records a
    // decision snapshot in production — or the founder decided it by name
    // (FD1: note_investor), in which case the exemption must be exactly that
    // set, dated and cited, and nothing wider.
    expect(
      evidence.definedWorkflowTemplateIds.size,
      "the evidence scan found no workflow templates — it broke, so the " +
        "assertion below would pass over an empty measurement",
    ).toBeGreaterThan(20);
    expect(evidence.decidingBusinessTypes.size).toBeGreaterThan(0);

    const { core } = renderedTiers();
    const withoutDecision = Object.values(BUSINESS_TYPES)
      .filter((m) => core.some((t) => t.startsWith(m.label)))
      .filter((m) => readinessOf(m, evidence) !== "decided")
      .map((m) => m.id);

    expect(
      withoutDecision.filter((id) => !(id in FD1_CORE_ON_SURFACED_EVIDENCE)),
      "the public landing advertises these as having FULL WORKFLOW SUPPORT, " +
        "and they cannot show a recorded decision. Lower the registry maturity " +
        "(FD1 is the presentation of record), or close the loop for them.",
    ).toEqual([]);
    // The exemption is exactly what the page needs — not a budget.
    expect(withoutDecision.sort()).toEqual(Object.keys(FD1_CORE_ON_SURFACED_EVIDENCE).sort());
    for (const [id, decision] of Object.entries(FD1_CORE_ON_SURFACED_EVIDENCE)) {
      expect(fs.existsSync(path.resolve(__dirname, "../..", decision!)), `${id}: ${decision}`).toBe(true);
    }
  });

  it("labels every registry-beta vertical Beta in the DOM, not just in the registry", () => {
    const { beta, core } = renderedTiers();
    const betaIds = registryIds("beta");
    expect(betaIds.length, "no beta vertical in the registry — the loop below is vacuous").toBeGreaterThan(0);

    for (const id of betaIds) {
      const label = BUSINESS_TYPES[id].label;
      // The chip text is "<label>Beta" — the micro-label is inside the <li>.
      expect(
        beta.some((t) => t.startsWith(label)),
        `${id} is beta in the registry but is not in the rendered beta tier`,
      ).toBe(true);
      expect(
        core.some((t) => t.startsWith(label)),
        `${id} is beta but still renders as core — a visitor is told it is fully supported`,
      ).toBe(false);
    }
  });

  it("every beta chip carries the visible qualifier, not a silent downgrade", () => {
    // A beta label nobody can see is not a label. If the badge were dropped,
    // the tier split would still be "correct" and the page would still claim
    // more than it can show.
    const { beta } = renderedTiers();
    expect(beta.length).toBeGreaterThan(0);
    for (const text of beta) {
      expect(text, `a beta chip rendered without its qualifier: "${text}"`).toMatch(/Beta$/);
    }
  });

  it("every registry-only vertical renders in the muted 'not sold' tier — never as core or beta (FD1)", () => {
    const { core, beta, notSold } = renderedTiers();
    const registryOnly = registryIds("registry_only");
    expect(registryOnly.length, "no registry_only vertical — the loop below is vacuous").toBeGreaterThan(0);

    for (const id of registryOnly) {
      const label = BUSINESS_TYPES[id].label;
      expect(notSold.some((t) => t.startsWith(label)), `${id} is registry-only but not in the rendered not-sold tier`).toBe(true);
      expect(core.some((t) => t.startsWith(label)), `${id} is registry-only but renders as core`).toBe(false);
      expect(beta.some((t) => t.startsWith(label)), `${id} is registry-only but renders as beta`).toBe(false);
    }
    // And nothing else lands there: the tier is exactly the registry-only set.
    expect(notSold.length).toBe(registryOnly.length);
  });

  it("the rendered split matches the pure derivation exactly", () => {
    // Ties the DOM to the function the static tests reason about. Without this,
    // `deriveLandingTiers` could be correct while the component ignored it.
    const { core, beta, notSold } = renderedTiers();
    const tiers = deriveLandingTiers();
    expect(core.length).toBe(tiers.core.length);
    expect(beta.length).toBe(tiers.beta.length);
    expect(notSold.length).toBe(tiers.roadmap.length);
  });
});

describe("the surface follows the registry, for states the registry is not in", () => {
  // The behavioural half. Each case drives a synthetic registry/demotion pair
  // and asserts the DERIVATION the component renders from. A hardcoded list
  // would pass all of these while representing nothing.

  const registryWith = (
    id: BusinessTypeId,
    maturity: BusinessTypeMeta["maturity"],
  ): Record<BusinessTypeId, BusinessTypeMeta> => ({
    ...BUSINESS_TYPES,
    [id]: { ...BUSINESS_TYPES[id], maturity },
  });

  it("a registry promotion to core returns the chip to core — no table in between", () => {
    // commercial is registry_only live. Promote it in a synthetic registry and
    // the derivation must follow the registry, with the demotion table empty.
    const tiers = deriveLandingTiers(registryWith("commercial", "core"), {});
    expect(tiers.core.map((c) => c.id)).toContain("commercial");
    expect(tiers.beta.map((c) => c.id)).not.toContain("commercial");
    expect(tiers.roadmap.map((c) => c.id)).not.toContain("commercial");
  });

  it("a registry demotion to roadmap moves the chip to roadmap, muted", () => {
    const tiers = deriveLandingTiers(registryWith("land_flipper", "roadmap"), {});
    expect(tiers.roadmap.map((c) => c.id)).toContain("land_flipper");
    expect(tiers.core.map((c) => c.id)).not.toContain("land_flipper");
  });

  it("a registry move to registry_only renders in the same 'not sold' tier as roadmap (FD1)", () => {
    const tiers = deriveLandingTiers(registryWith("land_flipper", "registry_only"), {});
    expect(tiers.roadmap.map((c) => c.id)).toContain("land_flipper");
    expect(tiers.core.map((c) => c.id)).not.toContain("land_flipper");
    expect(tiers.beta.map((c) => c.id)).not.toContain("land_flipper");
  });

  it("hybrid never renders, demoted or not — it would double-count its halves", () => {
    for (const demotions of [{}, PUBLIC_CLAIM_DEMOTIONS]) {
      const tiers = deriveLandingTiers(BUSINESS_TYPES, demotions);
      const all = [...tiers.core, ...tiers.beta, ...tiers.roadmap].map((c) => c.id);
      expect(all).not.toContain("hybrid");
    }
  });

  it("the live registry with no demotions is the FD1 presentation: 2 core, 3 beta, 9 not sold", () => {
    // Under OD-5 this asserted the opposite — that an empty table meant
    // fourteen core chips. FD1 moved the conservatism into the registry, so the
    // table being empty now yields the founder's presentation, not a lie.
    const tiers = deriveLandingTiers(BUSINESS_TYPES, {});
    expect(tiers.core.map((c) => c.id).sort()).toEqual(["buy_and_hold", "note_investor"]);
    expect(tiers.beta.map((c) => c.id).sort()).toEqual(["land_flipper", "residential_wholesaler", "tax_lien_deed"]);
    expect(tiers.roadmap).toHaveLength(9);
  });

  it("canary: an all-core registry with no demotions would claim fourteen core — the OD-5 state", () => {
    // The state OD-5 corrected and FD1 ended, asserted so the derivation is
    // shown to be sensitive to the registry: if the component hardcoded the
    // FD1 split, this synthetic registry would not move it.
    const allCore = Object.fromEntries(
      BUSINESS_TYPE_IDS.map((id) => [id, { ...BUSINESS_TYPES[id], maturity: "core" as const }]),
    ) as Record<BusinessTypeId, BusinessTypeMeta>;
    const tiers = deriveLandingTiers(allCore, {});
    expect(tiers.core).toHaveLength(14);
    expect(tiers.beta).toHaveLength(0);
    expect(tiers.roadmap).toHaveLength(0);
  });
});
