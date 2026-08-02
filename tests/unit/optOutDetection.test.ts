import { describe, it, expect } from "vitest";
import { detectOptSignal, STOP_KEYWORDS } from "../../server/services/compliance/optOut";
import { detectOptKeyword } from "../../server/services/tcpaCompliance";

/**
 * TCPA revocation modernization (Phase 0 audit — General Counsel). The two
 * divergent STOP keyword sets are unified here and now include "revoke" plus
 * natural-language refusals, per the April-2025 FCC any-reasonable-means rule.
 * Bias is to suppression: a false positive just means we don't text someone.
 */
describe("opt-out detection", () => {
  it("honors every exact STOP keyword (incl. revoke)", () => {
    for (const kw of STOP_KEYWORDS) {
      expect(detectOptSignal(kw)).toBe("opt_out");
      expect(detectOptSignal(kw.toUpperCase())).toBe("opt_out");
    }
    // The specific gap the audit flagged:
    expect(detectOptSignal("REVOKE")).toBe("opt_out");
    expect(detectOptSignal("Stop.")).toBe("opt_out"); // punctuation tolerated
  });

  it("honors natural-language revocations", () => {
    for (const msg of [
      "please stop texting me",
      "Stop messaging me!",
      "do not contact me again",
      "take me off your list",
      "remove me",
      "I want to opt out",
      "quit texting me",
      "no more texts please",
      "leave me alone",
    ]) {
      expect(detectOptSignal(msg), msg).toBe("opt_out");
    }
  });

  it("detects opt-in keywords", () => {
    expect(detectOptSignal("START")).toBe("opt_in");
    expect(detectOptSignal("yes")).toBe("opt_in");
  });

  it("does NOT over-match benign messages", () => {
    for (const msg of [
      "Can you stop by my office tomorrow?",
      "Yes I'm interested, what's the price?",
      "I'll take it — where do I sign?",
      "The deal ended well, thanks!",
      "Let's cancel the 3pm and do 4pm", // 'cancel' mid-sentence, not the whole message
    ]) {
      expect(detectOptSignal(msg), msg).toBeNull();
    }
  });

  it("tcpaCompliance.detectOptKeyword delegates to the same logic", () => {
    expect(detectOptKeyword("please stop texting me")).toBe("opt_out");
    expect(detectOptKeyword("revoke")).toBe("opt_out");
    expect(detectOptKeyword("start")).toBe("opt_in");
    expect(detectOptKeyword("what's the price?")).toBeNull();
  });
});
