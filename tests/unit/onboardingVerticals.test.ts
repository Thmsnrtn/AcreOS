/**
 * Onboarding wizard logic — founder ruling #12(b) (tailored / skippable /
 * re-runnable onboarding for all 15 verticals).
 *
 * Pins the per-vertical config the wizard (client/src/pages/onboarding-v2.tsx)
 * is driven by:
 *   1. Every one of the 15 registry verticals (shared/business-types.ts) has
 *      a config entry — exactly, no extras, no gaps.
 *   2. Every finishing destination (and note-role job link) is a REAL route
 *      registered in client/src/App.tsx — no dead-end finishes.
 *   3. Tailoring is real: the ruling's named examples speak their vertical's
 *      language and land on the right surface.
 *   4. Re-run prefill never silently flips the org back to the land_flipper
 *      default — unknown/missing stored values yield null (no prefill), and
 *      a stored valid vertical is honored verbatim.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { BUSINESS_TYPE_IDS } from "@shared/business-types";
import {
  VERTICAL_ONBOARDING,
  NOTE_ROLE_DATA_OVERRIDES,
  getVerticalOnboarding,
  getDataStepCopy,
  resolveWizardPrefill,
} from "@/lib/onboarding-verticals";

const appTsx = readFileSync(
  path.resolve(__dirname, "../../client/src/App.tsx"),
  "utf8",
);

/** True when App.tsx registers the route (query/hash stripped). */
function isRegisteredRoute(href: string): boolean {
  const routePath = href.split(/[?#]/)[0];
  return appTsx.includes(`path="${routePath}"`);
}

describe("VERTICAL_ONBOARDING — 15-vertical coverage", () => {
  it("covers every registry vertical, exactly", () => {
    const configured = Object.keys(VERTICAL_ONBOARDING).sort();
    const registry = [...BUSINESS_TYPE_IDS].sort();
    expect(configured).toEqual(registry);
  });

  it("every entry has non-empty tailored copy and a finish destination", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      const v = VERTICAL_ONBOARDING[id];
      expect(v.noun.length, id).toBeGreaterThan(0);
      expect(v.dataTitle[0].length, id).toBeGreaterThan(0);
      expect(v.dataTitle[1].length, id).toBeGreaterThan(0);
      expect(v.dataSub.length, id).toBeGreaterThan(20);
      expect(v.finish.path.startsWith("/"), id).toBe(true);
      expect(v.finish.cta.length, id).toBeGreaterThan(0);
      expect(v.finish.blurb.length, id).toBeGreaterThan(20);
    }
  });

  it("every finishing destination is a route registered in App.tsx", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      const { path: dest } = VERTICAL_ONBOARDING[id].finish;
      expect(isRegisteredRoute(dest), `${id} → ${dest}`).toBe(true);
    }
  });

  it("every note-role job link points at a registered route", () => {
    for (const [role, o] of Object.entries(NOTE_ROLE_DATA_OVERRIDES)) {
      expect(isRegisteredRoute(o.jobHref), `${role} → ${o.jobHref}`).toBe(true);
    }
  });
});

describe("Tailoring — the ruling's named examples", () => {
  it("tax_lien_deed speaks certificates and finishes on the redemption clock", () => {
    const v = VERTICAL_ONBOARDING.tax_lien_deed;
    expect(v.noun).toBe("certificates");
    expect(v.dataSub.toLowerCase()).toContain("certificate");
    expect(v.finish.path).toBe("/redemption-clock");
  });

  it("buy_and_hold speaks rentals and finishes on the rent roll", () => {
    const v = VERTICAL_ONBOARDING.buy_and_hold;
    expect(v.noun).toBe("rentals");
    expect(v.dataSub.toLowerCase()).toMatch(/rent/);
    expect(v.finish.path).toBe("/rent-roll");
  });

  it("note_investor finishes on the Finance door (note book)", () => {
    expect(VERTICAL_ONBOARDING.note_investor.finish.path).toBe("/money");
  });

  it("subdivider keeps its own identity (the W2.5 orphan can't regress)", () => {
    const v = VERTICAL_ONBOARDING.subdivider;
    expect(v.dataSub.toLowerCase()).toMatch(/parcel|lot|acreage/);
    expect(v.finish.path).toBe("/maps");
  });

  it("data-step copy differs across verticals (no one-size-fits-all)", () => {
    const subs = BUSINESS_TYPE_IDS.map((id) => VERTICAL_ONBOARDING[id].dataSub);
    // At least 12 distinct dataSub strings among 15 (land_flipper /
    // agent_investor legitimately share framing; wholesale duplication would
    // mean the tailoring collapsed back to generic copy).
    expect(new Set(subs).size).toBeGreaterThanOrEqual(12);
  });
});

describe("getDataStepCopy — note-role fork", () => {
  it("note_investor forks per role with a real first-job link", () => {
    const invest = getDataStepCopy("note_investor", "invest");
    const originate = getDataStepCopy("note_investor", "originate");
    const service = getDataStepCopy("note_investor", "service");
    expect(invest.jobHref).toBe("/notes?action=new");
    expect(originate.jobHref).toBe("/settings?tab=tax-compliance");
    expect(service.jobHref).toBe("/notes?action=new");
    expect(invest.dataSub).not.toBe(originate.dataSub);
    expect(invest.dataSub).not.toBe(service.dataSub);
  });

  it("non-note verticals ignore noteRole and carry no job link", () => {
    const copy = getDataStepCopy("tax_lien_deed", "originate");
    expect(copy.dataSub).toBe(VERTICAL_ONBOARDING.tax_lien_deed.dataSub);
    expect(copy.jobLabel).toBeNull();
    expect(copy.jobHref).toBeNull();
  });
});

describe("getVerticalOnboarding — unknown input", () => {
  it("falls back to land_flipper copy for unknown/missing types", () => {
    expect(getVerticalOnboarding(undefined)).toBe(VERTICAL_ONBOARDING.land_flipper);
    expect(getVerticalOnboarding(null)).toBe(VERTICAL_ONBOARDING.land_flipper);
    expect(getVerticalOnboarding("not_a_type")).toBe(VERTICAL_ONBOARDING.land_flipper);
  });

  it("returns the exact entry for every valid id", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      expect(getVerticalOnboarding(id)).toBe(VERTICAL_ONBOARDING[id]);
    }
  });
});

describe("resolveWizardPrefill — re-run must never flip the org's type", () => {
  it("missing/garbage stored data yields NO prefill (nulls, not defaults)", () => {
    expect(resolveWizardPrefill(undefined)).toEqual({ businessType: null, noteRole: null });
    expect(resolveWizardPrefill(null)).toEqual({ businessType: null, noteRole: null });
    expect(resolveWizardPrefill({})).toEqual({ businessType: null, noteRole: null });
    expect(resolveWizardPrefill({ businessType: 42, noteRole: {} })).toEqual({
      businessType: null,
      noteRole: null,
    });
    expect(
      resolveWizardPrefill({ businessType: "vacation_rental", noteRole: "landlord" }),
    ).toEqual({ businessType: null, noteRole: null });
  });

  it("every stored valid vertical is honored verbatim (incl. subdivider)", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      expect(resolveWizardPrefill({ businessType: id }).businessType).toBe(id);
    }
  });

  it("stored noteRole survives a reset round-trip", () => {
    const prefill = resolveWizardPrefill({
      businessType: "note_investor",
      noteRole: "originate",
    });
    expect(prefill).toEqual({ businessType: "note_investor", noteRole: "originate" });
  });

  it("never returns the land_flipper default unless it was actually stored", () => {
    expect(resolveWizardPrefill({ businessType: "tax_lien_deed" }).businessType).toBe(
      "tax_lien_deed",
    );
    expect(resolveWizardPrefill({ businessType: "" }).businessType).toBeNull();
    expect(resolveWizardPrefill({ businessType: "land_flipper" }).businessType).toBe(
      "land_flipper",
    );
  });
});

describe("skip + re-run wiring (source-pinned)", () => {
  const wizardSrc = readFileSync(
    path.resolve(__dirname, "../../client/src/pages/onboarding-v2.tsx"),
    "utf8",
  );
  const settingsSrc = readFileSync(
    path.resolve(__dirname, "../../client/src/pages/settings.tsx"),
    "utf8",
  );

  it("the wizard calls POST /api/onboarding/skip (the route has a caller now)", () => {
    expect(wizardSrc).toContain('"/api/onboarding/skip"');
    expect(wizardSrc).toContain('data-testid="button-skip-onboarding"');
  });

  it("Settings re-run calls reset and routes straight to the wizard", () => {
    expect(settingsSrc).toContain('"/api/onboarding/reset"');
    expect(settingsSrc).toContain('setLocation("/onboarding-v2")');
    // Honest labeling: the button re-runs onboarding, not a "tour".
    expect(settingsSrc).not.toContain("Restart Tour");
  });

  it("the dead use-tour stub is gone", () => {
    expect(() =>
      readFileSync(path.resolve(__dirname, "../../client/src/hooks/use-tour.ts")),
    ).toThrow();
  });
});
