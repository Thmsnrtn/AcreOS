import { describe, it, expect } from "vitest";
import { normalizeConsentCheckbox } from "../../server/services/consentEvents";

/**
 * INV-TRUTH-1 regression guard. The lead consent-event chain used to default an
 * absent checkbox value to `true` ("tcpaConsent=true implies the box was
 * checked"), fabricating an evidentiary fact in the very table a plaintiff's
 * expert reads first. The recorder must persist only what was observed.
 */
describe("consent checkbox honesty", () => {
  it("records a real boolean when the client sent one", () => {
    expect(normalizeConsentCheckbox(true)).toBe(true);
    expect(normalizeConsentCheckbox(false)).toBe(false);
  });

  it("records null (not true) when the value is absent or non-boolean", () => {
    expect(normalizeConsentCheckbox(undefined)).toBeNull();
    expect(normalizeConsentCheckbox(null)).toBeNull();
    expect(normalizeConsentCheckbox("true")).toBeNull(); // string, not a real checkbox
    expect(normalizeConsentCheckbox(1)).toBeNull();
    expect(normalizeConsentCheckbox({})).toBeNull();
  });

  it("never fabricates a checked box from a missing value", () => {
    // The exact bug: absent -> true. Must now be absent -> null.
    expect(normalizeConsentCheckbox(undefined)).not.toBe(true);
  });
});
