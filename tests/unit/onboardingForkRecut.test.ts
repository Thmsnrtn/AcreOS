/**
 * P1-11 S2 — onboarding fork re-cut (X-1 build half, FD1 launch presentation).
 *
 * S1 (PR #592) re-cut the REGISTRY: 2 core + 3 beta public, 10 registry_only
 * (Wholesale lifted to core 2026-11-18 and Tax 2026-11-19: 4 core + 1 beta).
 * The onboarding wizard was the remaining surface still offering all 15 —
 * its CORE_CHOICES even led with a registry_only type (hybrid) and its
 * default selection was land_flipper. This suite pins the re-cut fork:
 *
 *   1. The wizard offers EXACTLY the registry's production-ready set
 *      (core + beta = 5) — departed (registry_only) types are not offered.
 *   2. The core/beta split the wizard renders is the registry's split,
 *      derived in code from `BUSINESS_TYPES[value].maturity`, not a local
 *      list — a registry maturity flip must move the fork with it.
 *   3. The default selection is note_investor (the lead core vertical).
 *
 * The expected sets are DERIVED from the registry at runtime and also
 * pinned to the exact FD1 five, so neither the registry nor the wizard
 * can drift silently in either direction.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_IDS,
  isProductionReady,
  type BusinessTypeId,
} from "../../shared/business-types";

const wizardSrc = readFileSync(
  path.resolve(__dirname, "../../client/src/pages/onboarding-v2.tsx"),
  "utf8",
);

/** The literal choice rows the wizard carries UI copy for. */
function presentedMetaIds(): string[] {
  const start = wizardSrc.indexOf("const PRESENTED_CHOICE_META");
  const end = wizardSrc.indexOf("const CORE_CHOICES");
  expect(start, "PRESENTED_CHOICE_META block found").toBeGreaterThan(-1);
  expect(end, "CORE_CHOICES derivation found").toBeGreaterThan(start);
  const block = wizardSrc.slice(start, end);
  return [...block.matchAll(/value:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

const registryIdsByTier = (tier: string): BusinessTypeId[] =>
  BUSINESS_TYPE_IDS.filter((id) => BUSINESS_TYPES[id].maturity === tier);

describe("onboarding fork — FD1 presentation (P1-11 S2)", () => {
  it("offers exactly the FD1 five: 4 core + 1 beta, nothing else", () => {
    const offered = presentedMetaIds().sort();
    expect(offered).toEqual(
      ["buy_and_hold", "land_flipper", "note_investor", "residential_wholesaler", "tax_lien_deed"].sort(),
    );
    // …and that exact five is the registry's production-ready set, derived
    // from the registry itself (not a second hard-coded truth).
    const productionReady = BUSINESS_TYPE_IDS.filter((id) => isProductionReady(id)).sort();
    expect(offered).toEqual(productionReady);
  });

  it("no registry_only (departed) type is offered as a choice", () => {
    const offered = new Set(presentedMetaIds());
    for (const id of registryIdsByTier("registry_only")) {
      expect(offered.has(id), `${id} must not be offered`).toBe(false);
      expect(wizardSrc).not.toContain(`value: "${id}"`);
    }
    expect(registryIdsByTier("registry_only")).toHaveLength(10);
  });

  it("the core/beta split is derived from the registry, not a local list", () => {
    expect(wizardSrc).toContain('from "@shared/business-types"');
    expect(wizardSrc).toContain('BUSINESS_TYPES as BUSINESS_TYPE_REGISTRY');
    expect(wizardSrc).toMatch(
      /CORE_CHOICES = PRESENTED_CHOICE_META\.filter\([\s\S]*?BUSINESS_TYPE_REGISTRY\[value\]\.maturity === "core"/,
    );
    expect(wizardSrc).toMatch(
      /BETA_CHOICES = PRESENTED_CHOICE_META\.filter\([\s\S]*?BUSINESS_TYPE_REGISTRY\[value\]\.maturity === "beta"/,
    );
    // The meta rows' own tier membership matches the registry's split:
    // core rows are exactly the registry's core set, beta rows its beta set.
    const meta = presentedMetaIds();
    expect(meta.filter((id) => BUSINESS_TYPES[id as BusinessTypeId].maturity === "core").sort()).toEqual(
      registryIdsByTier("core").sort(),
    );
    expect(meta.filter((id) => BUSINESS_TYPES[id as BusinessTypeId].maturity === "beta").sort()).toEqual(
      registryIdsByTier("beta").sort(),
    );
    // The presented set is gated on production-readiness in code, so a
    // meta row for a departed type could never render.
    expect(wizardSrc).toContain("isProductionReady(value)");
  });

  it("defaults to note_investor, the lead core vertical", () => {
    expect(wizardSrc).toContain('useState<BusinessType>("note_investor")');
    expect(wizardSrc).not.toContain('useState<BusinessType>("land_flipper")');
    expect(BUSINESS_TYPES.note_investor.maturity).toBe("core");
  });

  it("renders core up front and beta behind the disclosure, testids stable", () => {
    expect(wizardSrc).toContain("{CORE_CHOICES.map(");
    expect(wizardSrc).toContain("{BETA_CHOICES.map(");
    expect(wizardSrc).toContain('data-testid="details-show-all-investor-types"');
    expect(wizardSrc).toContain("Show beta investor types");
  });

  it("an existing registry_only book is named, not silently flipped (re-run note)", () => {
    // resolveWizardPrefill can still hold a departed type for an existing
    // org; the wizard must surface that state instead of showing no
    // selection at all.
    expect(wizardSrc).toContain('data-testid="current-type-note"');
    expect(wizardSrc).toContain("!PRESENTED_BUSINESS_TYPES.has(businessType)");
  });
});
