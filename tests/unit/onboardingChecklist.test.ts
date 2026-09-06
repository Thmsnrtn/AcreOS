/**
 * Onboarding rebuild (2026-07-29 audit) — vertical-aware getting-started
 * checklist.
 *
 * Pins the four audit fixes:
 *   1. Reachability: the checklist mounts on /today OUTSIDE the
 *      showEmptyState branch (source ratchet below) and its visibility
 *      helper is independent of empty-state / hasAnyData.
 *   2. Re-keyed on the 15-value businessType taxonomy — every declared
 *      business type has its own item list, from ONE config.
 *   3. Honesty: every item's completion maps to a REAL signal computed by
 *      GET /api/onboarding/checklist-status; no status → nothing complete.
 *   4. Skipped-onboarding users still see it: neither the component source
 *      nor the visibility helper keys on onboardingCompleted / skipped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

import {
  CHECKLISTS_BY_BUSINESS_TYPE,
  CHECKLIST_SIGNALS,
  CONNECT_SERVICES_ITEM,
  computeChecklistProgress,
  getChecklistItems,
  isItemComplete,
  resolveChecklistBusinessType,
  shouldShowChecklist,
  type ChecklistStatus,
} from "../../client/src/lib/onboarding-checklist";
import { BUSINESS_TYPE_IDS } from "../../shared/business-types";
import { BUSINESS_TYPE_TO_PERSONA } from "../../shared/models/persona-mapping";
import { stripComments } from "../helpers/stripComments";

const ALL_FALSE: ChecklistStatus = {
  hasLead: false,
  hasImport: false,
  hasCampaign: false,
  hasDeal: false,
  hasNotePayment: false,
  hasPropertyLookup: false,
  hasConnectedService: false,
};

const ALL_TRUE: ChecklistStatus = {
  hasLead: true,
  hasImport: true,
  hasCampaign: true,
  hasDeal: true,
  hasNotePayment: true,
  hasPropertyLookup: true,
  hasConnectedService: true,
};

describe("checklist config — 15-vertical coverage (audit fix #2)", () => {
  it("defines a checklist for every declared business type, and no extras", () => {
    const configured = Object.keys(CHECKLISTS_BY_BUSINESS_TYPE).sort();
    expect(configured).toEqual([...BUSINESS_TYPE_IDS].sort());
  });

  for (const bt of BUSINESS_TYPE_IDS) {
    it(`${bt}: has 2+ required steps, all well-formed`, () => {
      const items = CHECKLISTS_BY_BUSINESS_TYPE[bt];
      expect(items.length).toBeGreaterThanOrEqual(2);
      const ids = items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length); // unique ids per vertical
      for (const item of items) {
        expect(item.title.length).toBeGreaterThan(0);
        expect(item.description.length).toBeGreaterThan(0);
        expect(item.href.startsWith("/")).toBe(true);
        expect(item.icon).toBeDefined();
        expect(item.optional).toBeUndefined(); // required lists carry no optional items
      }
    });
  }

  it("getChecklistItems appends exactly one optional connect-services nudge", () => {
    for (const bt of BUSINESS_TYPE_IDS) {
      const items = getChecklistItems(bt);
      const optional = items.filter((i) => i.optional);
      expect(optional).toEqual([CONNECT_SERVICES_ITEM]);
      expect(items[items.length - 1]).toBe(CONNECT_SERVICES_ITEM);
    }
  });

  it("landlord-family types share the landlord loop with their own nouns", () => {
    const landlordFamily = BUSINESS_TYPE_IDS.filter(
      (bt) => BUSINESS_TYPE_TO_PERSONA[bt] === "landlord",
    );
    expect(landlordFamily.length).toBeGreaterThanOrEqual(4);
    for (const bt of landlordFamily) {
      const signals = CHECKLISTS_BY_BUSINESS_TYPE[bt].map((i) => i.signal);
      expect(signals).toEqual(["hasPropertyLookup", "hasLead", "hasDeal"]);
    }
    // Per-type vocabulary, not one blob:
    expect(CHECKLISTS_BY_BUSINESS_TYPE.multifamily[0].title).toMatch(/building/i);
    expect(CHECKLISTS_BY_BUSINESS_TYPE.mobile_home[0].title).toMatch(/park/i);
  });

  it("verticals speak their own vocabulary", () => {
    const titlesOf = (bt: (typeof BUSINESS_TYPE_IDS)[number]) =>
      CHECKLISTS_BY_BUSINESS_TYPE[bt].map((i) => `${i.title} ${i.description}`).join(" | ");
    expect(titlesOf("tax_lien_deed")).toMatch(/certificate/i);
    expect(titlesOf("tax_lien_deed")).toMatch(/redemption/i);
    expect(titlesOf("note_investor")).toMatch(/note/i);
    expect(titlesOf("land_flipper")).toMatch(/county list/i);
    expect(titlesOf("buy_and_hold")).toMatch(/propert/i);
    expect(titlesOf("residential_wholesaler")).toMatch(/contract|assignment/i);
    expect(titlesOf("creative_finance")).toMatch(/subject-to|carr/i);
    expect(titlesOf("fix_and_flip")).toMatch(/flip|rehab/i);
    expect(titlesOf("subdivider")).toMatch(/parent parcel/i);
  });
});

describe("checklist honesty — real completion signals only (audit fix #3)", () => {
  it("every item (all verticals + optional) names a real /checklist-status signal", () => {
    const signalSet = new Set<string>(CHECKLIST_SIGNALS);
    for (const bt of BUSINESS_TYPE_IDS) {
      for (const item of getChecklistItems(bt)) {
        expect(signalSet.has(item.signal)).toBe(true);
      }
    }
  });

  it("no loaded status → nothing is complete (never fabricate progress)", () => {
    for (const bt of BUSINESS_TYPE_IDS) {
      const items = getChecklistItems(bt);
      for (const item of items) {
        expect(isItemComplete(item, undefined)).toBe(false);
      }
      const progress = computeChecklistProgress(items, undefined);
      expect(progress.completedCount).toBe(0);
      expect(progress.allComplete).toBe(false);
    }
  });

  it("all-false status → zero progress; all-true → complete", () => {
    for (const bt of BUSINESS_TYPE_IDS) {
      const items = getChecklistItems(bt);
      expect(computeChecklistProgress(items, ALL_FALSE)).toMatchObject({
        completedCount: 0,
        progressPct: 0,
        allComplete: false,
      });
      const done = computeChecklistProgress(items, ALL_TRUE);
      expect(done.allComplete).toBe(true);
      expect(done.completedCount).toBe(done.requiredCount);
    }
  });

  it("the optional connect-services item never blocks completion", () => {
    const status: ChecklistStatus = { ...ALL_TRUE, hasConnectedService: false };
    for (const bt of BUSINESS_TYPE_IDS) {
      const progress = computeChecklistProgress(getChecklistItems(bt), status);
      expect(progress.allComplete).toBe(true);
    }
  });

  it("dropped steps stay dropped: no item invents an unbacked signal", () => {
    // The audit's wished-for steps with no cheap real signal must NOT appear:
    // buy-box, auction watch, tenants, servicer-connection-as-required.
    for (const bt of BUSINESS_TYPE_IDS) {
      const text = getChecklistItems(bt)
        .filter((i) => !i.optional)
        .map((i) => `${i.id} ${i.title} ${i.description}`)
        .join(" | ")
        .toLowerCase();
      expect(text).not.toMatch(/buy[- ]box/);
      expect(text).not.toMatch(/auction watch/);
      expect(text).not.toMatch(/tenant/);
      expect(text).not.toMatch(/servicer/);
    }
  });
});

describe("business-type resolution", () => {
  it("passes a valid businessType straight through", () => {
    for (const bt of BUSINESS_TYPE_IDS) {
      expect(resolveChecklistBusinessType(bt, "land")).toBe(bt);
    }
  });

  it("falls back through investorType for legacy orgs", () => {
    expect(resolveChecklistBusinessType(undefined, "notes")).toBe("note_investor");
    expect(resolveChecklistBusinessType(null, "both")).toBe("hybrid");
    expect(resolveChecklistBusinessType(undefined, "land")).toBe("land_flipper");
    expect(resolveChecklistBusinessType(undefined, undefined)).toBe("land_flipper");
    expect(resolveChecklistBusinessType("not_a_type", "notes")).toBe("note_investor");
  });
});

describe("checklist visibility (audit fixes #1 + #4)", () => {
  it("shows while steps remain, independent of any data/empty-state input", () => {
    expect(
      shouldShowChecklist({ dismissed: false, statusLoaded: true, allComplete: false }),
    ).toBe(true);
  });

  it("hides when dismissed, complete, or status not yet loaded", () => {
    expect(
      shouldShowChecklist({ dismissed: true, statusLoaded: true, allComplete: false }),
    ).toBe(false);
    expect(
      shouldShowChecklist({ dismissed: false, statusLoaded: true, allComplete: true }),
    ).toBe(false);
    expect(
      shouldShowChecklist({ dismissed: false, statusLoaded: false, allComplete: false }),
    ).toBe(false);
  });

  const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

  it("ratchet: /today mounts the checklist OUTSIDE the empty-state branch", () => {
    const today = read("client/src/pages/today.tsx");
    // Exactly one JSX mount…
    const mounts = today.match(/<GettingStartedChecklist \/>/g) ?? [];
    expect(mounts).toHaveLength(1);
    // …at top level of the page (6-space indent, like the other unconditional
    // sections) — NOT nested inside the showEmptyState conditional (which
    // indents its children 8+ spaces).
    expect(today).toMatch(/^ {6}<GettingStartedChecklist \/>$/m);
    expect(today).not.toMatch(/^ {8,}<GettingStartedChecklist \/>$/m);
  });

  it("ratchet: the component never keys on empty-state or skipped-onboarding", () => {
    const source = read("client/src/components/getting-started-checklist.tsx");
    // Guard identifiers as gating INPUTS (comments may mention them — strip those).
    const code = stripComments(source);
    expect(code).not.toMatch(/showEmptyState/);
    expect(code).not.toMatch(/hasAnyData/);
    expect(code).not.toMatch(/onboardingCompleted/);
    expect(code).not.toMatch(/\bskipped\b/);
    // And it is driven by the shared config, not a private investorType fork.
    expect(code).toMatch(/resolveChecklistBusinessType/);
    expect(code).toMatch(/@\/lib\/onboarding-checklist/);
    expect(code).not.toMatch(/PERSONA_CHECKLISTS/);
  });
});
