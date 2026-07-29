/**
 * Tests for the vertical-aware Pax persona registry.
 *
 * Coverage:
 *  1. Production persona accessor (land_investing) returns full content
 *  2. Default-fallback when vertical is null / unknown
 *  3. Scaffolded-vertical accessor returns productionReady: false
 *  4. Every vertical has all required fields populated (loop)
 *  5. Competitor-name discipline: forbidden strings absent from PERSONAS
 *     per feedback_competitor_refs.md
 */

import { describe, expect, it } from "vitest";

import { PAX_VERTICALS } from "@shared/schema/pax-verticals";
import { PERSONAS, getPersona, getPersonaOrDefault } from "./personas";

describe("getPersona", () => {
  it("returns the production land_investing persona", () => {
    const p = getPersona("land_investing");
    expect(p.vertical).toBe("land_investing");
    expect(p.verticalLabel).toBe("Land Investing");
    expect(p.productionReady).toBe(true);
    expect(p.systemPromptAppendix.length).toBeGreaterThan(200);
  });

  it("returns the scaffolded mobile_homes persona with productionReady=false", () => {
    const p = getPersona("mobile_homes");
    expect(p.vertical).toBe("mobile_homes");
    expect(p.productionReady).toBe(false);
  });
});

describe("getPersonaOrDefault", () => {
  it("falls back to land_investing on null", () => {
    const p = getPersonaOrDefault(null);
    expect(p.vertical).toBe("land_investing");
  });

  it("falls back to land_investing on undefined", () => {
    const p = getPersonaOrDefault(undefined);
    expect(p.vertical).toBe("land_investing");
  });

  it("returns the requested persona for a valid vertical", () => {
    const p = getPersonaOrDefault("mobile_homes");
    expect(p.vertical).toBe("mobile_homes");
    expect(p.productionReady).toBe(false);
  });
});

describe("PERSONAS registry — completeness", () => {
  it("includes every vertical in PAX_VERTICALS", () => {
    for (const v of PAX_VERTICALS) {
      expect(PERSONAS[v]).toBeDefined();
      expect(PERSONAS[v].vertical).toBe(v);
    }
  });

  it("every persona has all required fields populated", () => {
    for (const v of PAX_VERTICALS) {
      const p = PERSONAS[v];
      expect(p.verticalLabel.length).toBeGreaterThan(0);
      expect(typeof p.productionReady).toBe("boolean");
      expect(p.domainTerminology.length).toBeGreaterThan(0);
      expect(p.exampleDealShape.length).toBeGreaterThan(0);
      expect(p.commonMistakes.length).toBeGreaterThan(0);
      expect(p.keyMetrics.length).toBeGreaterThan(0);
      expect(p.expertReferences.length).toBeGreaterThan(0);
      expect(p.systemPromptAppendix.length).toBeGreaterThan(0);
    }
  });

  it("land_investing and wholesaling are the only production-ready verticals", () => {
    // land_investing shipped production-ready at launch; wholesaling was
    // deepened in wave V2 of ruling #11. The other four stay scaffolded.
    const productionReady = PAX_VERTICALS.filter((v) => PERSONAS[v].productionReady);
    expect(productionReady).toEqual(["land_investing", "wholesaling"]);
  });

  it("scaffolded verticals include a [TODO: deepen] marker somewhere", () => {
    for (const v of PAX_VERTICALS) {
      if (PERSONAS[v].productionReady) continue;
      const haystack = JSON.stringify(PERSONAS[v]);
      expect(haystack).toMatch(/\[TODO: deepen/);
    }
  });

  it("production-ready verticals contain NO TODO markers of any kind", () => {
    for (const v of PAX_VERTICALS) {
      if (!PERSONAS[v].productionReady) continue;
      const haystack = JSON.stringify(PERSONAS[v]);
      expect(haystack).not.toContain("[TODO");
      expect(haystack).not.toContain("TODO:");
    }
  });
});

describe("wholesaling — deepened to production (wave V2 of ruling #11)", () => {
  const p = PERSONAS.wholesaling;

  it("is production-ready with the correct identity", () => {
    expect(p.vertical).toBe("wholesaling");
    expect(p.verticalLabel).toBe("Wholesaling");
    expect(p.productionReady).toBe(true);
  });

  it("matches the land_investing depth bar on every field", () => {
    // land_investing is the quality bar: 12+ terminology entries, 5+
    // mistakes, 7 metrics, 4 references, a rich deal shape, and a
    // multi-paragraph appendix.
    expect(p.domainTerminology.length).toBeGreaterThanOrEqual(10);
    expect(p.commonMistakes.length).toBeGreaterThanOrEqual(5);
    expect(p.keyMetrics.length).toBeGreaterThanOrEqual(6);
    expect(p.expertReferences.length).toBeGreaterThanOrEqual(4);
    expect(p.exampleDealShape.length).toBeGreaterThan(300);
    expect(p.systemPromptAppendix.length).toBeGreaterThan(200);
  });

  it("no field carries a TODO or scaffold disclaimer", () => {
    const haystack = JSON.stringify(p);
    expect(haystack).not.toContain("[TODO");
    expect(haystack).not.toContain("scaffolded");
    expect(haystack).not.toContain("depth is roadmap");
  });

  it("voice is grounded in the real wholesale stack — assignment vs double close, EMD, state rules, TCPA", () => {
    // Every one of these maps to shipped capability:
    //   - assignment-vs-double-close state rules → wholesaler_state_rules (W-1)
    //   - earnest-money / inspection-period discipline → earnest_money_holds (W-2)
    //   - transactional funding → double_close_deals (W-3)
    //   - buyer list / cash buyers → buyer_blasts + buyer analytics (W-4)
    //   - TCPA-compliant outreach → tcpaCompliance + dncScrub + consentEvents
    const haystack = JSON.stringify(p);
    expect(haystack).toContain("double close");
    expect(haystack).toMatch(/EMD|earnest money/i);
    expect(haystack).toMatch(/inspection period/i);
    expect(haystack).toContain("transactional fund");
    expect(haystack).toMatch(/buyer list|cash buyer/i);
    expect(haystack).toContain("TCPA");
    expect(haystack).toMatch(/license.required|advertising.restricted/i);
  });

  it("keeps the compliance guardrail: flags for attorney review, never legal advice (immutable #12)", () => {
    expect(p.systemPromptAppendix).toContain("never give legal advice");
    expect(p.systemPromptAppendix).toContain("immutable #12");
  });

  it("MAO is glossed correctly as maximum allowable offer", () => {
    // The old stub misglossed MAO as "maximum allowable offset".
    const haystack = JSON.stringify(p);
    expect(haystack).toContain("maximum allowable offer");
    expect(haystack).not.toContain("allowable offset");
  });
});

describe("competitor-name discipline (feedback_competitor_refs.md)", () => {
  // Per the founder feedback, none of these names may appear anywhere in
  // persona content — system prompts, terminology, examples, references.
  const FORBIDDEN = ["Land Geek", "GeekPay", "LG Pass", "Mark Podolsky"];
  const haystack = JSON.stringify(PERSONAS);

  for (const name of FORBIDDEN) {
    it(`does not contain "${name}"`, () => {
      expect(haystack).not.toContain(name);
    });
  }

  it("the land_investing systemPromptAppendix does not contain any forbidden competitor name", () => {
    const appendix = PERSONAS.land_investing.systemPromptAppendix;
    for (const name of FORBIDDEN) {
      expect(appendix).not.toContain(name);
    }
  });
});
