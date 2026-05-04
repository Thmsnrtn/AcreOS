/**
 * tests/unit/complianceValidator.test.ts — Phase 4 Week 21-22.
 *
 * Tests pure helpers in complianceValidator. The validator's main code
 * path requires a live LLM call which we mock out; these tests focus on
 * the pieces with no external deps:
 *   • parseValidatorResponse — parses strict JSON, falls back on stray text
 *   • composeDisclosure — combines canonical template + extras
 *   • cacheKey — deterministic, surface+domain-aware
 */

import { describe, it, expect, beforeEach } from "vitest";
import { __testOnly } from "../../server/services/complianceValidator";

const { parseValidatorResponse, composeDisclosure, cacheKey, clearCache, DISCLOSURE_TEMPLATES } =
  __testOnly;

beforeEach(() => clearCache());

describe("complianceValidator.parseValidatorResponse", () => {
  it("parses a strict-JSON PASS verdict", () => {
    const raw = '{"verdict":"PASS","missingPhrases":[],"rationale":"non-regulated"}';
    const r = parseValidatorResponse(raw);
    expect(r.verdict).toBe("PASS");
    expect(r.missingPhrases).toEqual([]);
    expect(r.rationale).toBe("non-regulated");
  });

  it("parses a strict-JSON AMEND verdict with missing phrases", () => {
    const raw = '{"verdict":"AMEND","missingPhrases":["Consult a CPA","Not tax advice"],"rationale":"tax topic"}';
    const r = parseValidatorResponse(raw);
    expect(r.verdict).toBe("AMEND");
    expect(r.missingPhrases).toEqual(["Consult a CPA", "Not tax advice"]);
  });

  it("falls back gracefully when the model emits prose around the JSON", () => {
    const raw = `Here is the verdict:\n{"verdict":"AMEND","missingPhrases":["x"],"rationale":"y"}\nDone.`;
    const r = parseValidatorResponse(raw);
    expect(r.verdict).toBe("AMEND");
    expect(r.missingPhrases).toEqual(["x"]);
  });

  it("uses heuristics on unparseable output containing PASS", () => {
    const r = parseValidatorResponse("PASS — looks fine");
    expect(r.verdict).toBe("PASS");
  });

  it("defaults to AMEND on unparseable output without PASS", () => {
    const r = parseValidatorResponse("¯\\_(ツ)_/¯");
    expect(r.verdict).toBe("AMEND");
  });

  it("clamps missingPhrases to 10 to prevent prompt-bomb extras", () => {
    const arr = Array.from({ length: 50 }, (_, i) => `phrase ${i}`);
    const raw = JSON.stringify({ verdict: "AMEND", missingPhrases: arr, rationale: "y" });
    const r = parseValidatorResponse(raw);
    expect(r.missingPhrases.length).toBe(10);
  });

  it("rejects non-string entries in missingPhrases", () => {
    const raw = JSON.stringify({
      verdict: "AMEND",
      missingPhrases: ["good", 42, null, "also good"],
      rationale: "y",
    });
    const r = parseValidatorResponse(raw);
    expect(r.missingPhrases).toEqual(["good", "also good"]);
  });
});

describe("complianceValidator.composeDisclosure", () => {
  it("returns the bare template when no extras provided", () => {
    const out = composeDisclosure("real_estate_offer", []);
    expect(out).toBe(DISCLOSURE_TEMPLATES.real_estate_offer);
  });

  it("appends extras when they aren't already covered by the template", () => {
    const out = composeDisclosure("tax_advice", ["Consult a notary public"]);
    expect(out).toContain("CPA"); // base template mentions CPA
    expect(out).toContain("Consult a notary public");
  });

  it("filters extras already implicit in the template", () => {
    const out = composeDisclosure("tax_advice", ["consult a CPA"]);
    // The base template already contains "Consult a CPA…"
    expect(out).toBe(DISCLOSURE_TEMPLATES.tax_advice);
  });

  it("falls back to general for unknown domains", () => {
    // @ts-expect-error — testing fallback path
    const out = composeDisclosure("nonsense_domain", []);
    expect(out).toBe(DISCLOSURE_TEMPLATES.general);
  });
});

describe("complianceValidator.cacheKey", () => {
  it("is deterministic for the same input", () => {
    const req = {
      candidate: "Hello",
      domain: "real_estate_offer" as const,
      surface: "pax.draft-reply",
    };
    expect(cacheKey(req)).toBe(cacheKey(req));
  });

  it("differs across surfaces", () => {
    const a = cacheKey({ candidate: "Hi", domain: "general", surface: "a" });
    const b = cacheKey({ candidate: "Hi", domain: "general", surface: "b" });
    expect(a).not.toBe(b);
  });
});
