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

  it("land_investing is the only production-ready vertical at launch", () => {
    const productionReady = PAX_VERTICALS.filter((v) => PERSONAS[v].productionReady);
    expect(productionReady).toEqual(["land_investing"]);
  });

  it("scaffolded verticals include a [TODO: deepen] marker somewhere", () => {
    for (const v of PAX_VERTICALS) {
      if (PERSONAS[v].productionReady) continue;
      const haystack = JSON.stringify(PERSONAS[v]);
      expect(haystack).toMatch(/\[TODO: deepen/);
    }
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
