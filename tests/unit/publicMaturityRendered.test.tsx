// @vitest-environment jsdom
/**
 * Given registry state X, the public landing truthfully represents X.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE SOURCE SCAN ─────────────────────────
 * `verticalReadiness.test.ts` proves two things statically: the demotion map is
 * coherent, and no public source file reads `.maturity` directly. Both are
 * worth having, and neither is proof that a visitor is told the truth.
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
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 * This is one representative high-consequence surface, not screenshot
 * infrastructure for every state transition. The rule earned from the Beta
 * badge is "when a canonical transition makes a rare UI state common, exercise
 * that state in the real surface" — twelve chips moved into a tier that had
 * been empty, so the tier gets exercised.
 */

import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  BUSINESS_TYPES,
  type BusinessTypeId,
  type BusinessTypeMeta,
} from "../../shared/business-types";
import {
  PUBLIC_CLAIM_DEMOTIONS,
  publicMaturityOf,
  type PublicClaimDemotion,
} from "../../shared/business-types/publicClaims";
import { readinessOf } from "../../shared/business-types/readiness";
import { measureVerticalEvidence } from "../support/verticalEvidence";
import { deriveLandingTiers, Positioning } from "../../client/src/pages/landing/Positioning";

/** What the repo can actually demonstrate — the anchor that is NOT the map. */
const evidence = measureVerticalEvidence();

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
  };
}

describe("what a visitor is actually shown", () => {
  it("renders exactly the verticals the canonical projection says are core", () => {
    const { core } = renderedTiers();

    const expected = Object.values(BUSINESS_TYPES)
      .filter((m) => publicMaturityOf(m) === "core" && m.id !== "hybrid")
      .map((m) => m.label);

    expect([...core].sort()).toEqual([...expected].sort());
  });

  it("shows NO vertical as core that cannot evidence a recorded decision", () => {
    // THE ANCHOR THAT IS NOT THE MAP, and the reason tests/support exists.
    //
    // Every other assertion here derives its expectation from
    // PUBLIC_CLAIM_DEMOTIONS or publicMaturityOf, so DELETING a demotion moves
    // the expectation and the DOM together and they still agree — measured: a
    // mutation removing `commercial` passed all eight. A projection compared
    // against itself proves only that it is a function.
    //
    // This compares the rendered page against the EVIDENCE instead: a chip may
    // sit in "full workflow support" only if that vertical actually records a
    // decision snapshot in production.
    expect(
      evidence.definedWorkflowTemplateIds.size,
      "the evidence scan found no workflow templates — it broke, so the " +
        "assertion below would pass over an empty measurement",
    ).toBeGreaterThan(20);
    expect(evidence.decidingBusinessTypes.size).toBeGreaterThan(0);

    const { core } = renderedTiers();
    const dishonest = Object.values(BUSINESS_TYPES)
      .filter((m) => core.some((t) => t.startsWith(m.label)))
      .filter((m) => readinessOf(m, evidence) !== "decided")
      .map((m) => m.id);

    expect(
      dishonest,
      "the public landing advertises these as having FULL WORKFLOW SUPPORT, " +
        "and they cannot show a recorded decision. Add a PUBLIC_CLAIM_DEMOTIONS " +
        "entry, or close the loop for them.",
    ).toEqual([]);
  });

  it("labels every demoted vertical Beta in the DOM, not just in the map", () => {
    const { beta, core } = renderedTiers();

    for (const id of Object.keys(PUBLIC_CLAIM_DEMOTIONS) as BusinessTypeId[]) {
      if (id === "hybrid") continue; // carries an entry but renders no chip
      const label = BUSINESS_TYPES[id].label;
      // The chip text is "<label>Beta" — the micro-label is inside the <li>.
      expect(
        beta.some((t) => t.startsWith(label)),
        `${id} is demoted in PUBLIC_CLAIM_DEMOTIONS but is not in the rendered beta tier`,
      ).toBe(true);
      expect(
        core.some((t) => t.startsWith(label)),
        `${id} is demoted but still renders as core — a visitor is told it is fully supported`,
      ).toBe(false);
    }
  });

  it("every beta chip carries the visible qualifier, not a silent downgrade", () => {
    // A demotion nobody can see is not a demotion. If the badge were dropped,
    // the tier split would still be "correct" and the page would still claim
    // more than it can show.
    const { beta } = renderedTiers();
    expect(beta.length).toBeGreaterThan(0);
    for (const text of beta) {
      expect(text, `a beta chip rendered without its qualifier: "${text}"`).toMatch(/Beta$/);
    }
  });

  it("the rendered split matches the pure derivation exactly", () => {
    // Ties the DOM to the function the static tests reason about. Without this,
    // `deriveLandingTiers` could be correct while the component ignored it.
    const { core, beta } = renderedTiers();
    const tiers = deriveLandingTiers();
    expect(core.length).toBe(tiers.core.length);
    expect(beta.length).toBe(tiers.beta.length);
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

  it("a vertical that closes the loop and loses its demotion returns to core", () => {
    const demotions: Partial<Record<BusinessTypeId, PublicClaimDemotion>> = {
      ...PUBLIC_CLAIM_DEMOTIONS,
    };
    delete demotions.commercial;

    const tiers = deriveLandingTiers(BUSINESS_TYPES, demotions);
    expect(tiers.core.map((c) => c.id)).toContain("commercial");
    expect(tiers.beta.map((c) => c.id)).not.toContain("commercial");
  });

  it("a registry demotion to roadmap moves the chip to roadmap, muted", () => {
    // The roadmap tier is currently empty. It is the next state a truthful
    // registry could reach, and it must not render as a promise.
    const tiers = deriveLandingTiers(registryWith("commercial", "roadmap"), {});
    expect(tiers.roadmap.map((c) => c.id)).toContain("commercial");
    expect(tiers.core.map((c) => c.id)).not.toContain("commercial");
  });

  it("hybrid never renders, demoted or not — it would double-count its halves", () => {
    for (const demotions of [{}, PUBLIC_CLAIM_DEMOTIONS]) {
      const tiers = deriveLandingTiers(BUSINESS_TYPES, demotions);
      const all = [...tiers.core, ...tiers.beta, ...tiers.roadmap].map((c) => c.id);
      expect(all).not.toContain("hybrid");
    }
  });

  it("with no demotions at all, the landing would claim fourteen core verticals", () => {
    // The state OD-5 corrected, asserted so the correction cannot silently
    // revert: an empty map means the page says every vertical is fully
    // supported, which is what it did before the demotions landed.
    const tiers = deriveLandingTiers(BUSINESS_TYPES, {});
    expect(tiers.core).toHaveLength(14);
    expect(tiers.beta).toHaveLength(0);
  });
});
