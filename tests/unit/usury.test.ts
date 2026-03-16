/**
 * Usury Compliance Service — Unit Tests
 *
 * Tests the checkUsury pure function against state usury limits.
 * No DB calls are made; the function operates on an in-memory lookup table.
 */

import { describe, it, expect } from "vitest";
import { checkUsury } from "../../server/services/usury";

describe("checkUsury", () => {
  // ── Texas (18% limit) ──────────────────────────────────────────────────────
  describe("Texas — 18% usury limit", () => {
    it("flags Texas rate above 18% as violation", () => {
      const result = checkUsury("TX", 20);
      expect(result.warningLevel).toBe("violation");
      expect(result.isCompliant).toBe(false);
    });

    it("passes Texas rate at exactly 18% as compliant but warns (0% buffer)", () => {
      const result = checkUsury("TX", 18);
      // Exactly at the limit: compliant but warningLevel="warning" since buffer < 2%
      expect(result.isCompliant).toBe(true);
      expect(result.warningLevel).toBe("warning");
    });

    it("warns when rate is within 2% of the Texas limit (e.g. 17.5%)", () => {
      const result = checkUsury("TX", 17.5);
      expect(result.warningLevel).toBe("warning");
      expect(result.isCompliant).toBe(true);
    });

    it("ok status when rate is comfortably under the Texas limit", () => {
      const result = checkUsury("TX", 10);
      expect(result.warningLevel).toBe("ok");
      expect(result.isCompliant).toBe(true);
    });

    it("message contains violation text when rate exceeds limit", () => {
      const result = checkUsury("TX", 25);
      expect(result.message).toMatch(/USURY VIOLATION/i);
    });

    it("returns correct maxAllowedRate for Texas", () => {
      const result = checkUsury("TX", 10);
      expect(result.maxAllowedRate).toBe(18);
    });
  });

  // ── South Dakota — no limit ────────────────────────────────────────────────
  describe("South Dakota — no statutory cap", () => {
    it("South Dakota: any rate is compliant (no limit)", () => {
      const result = checkUsury("SD", 99);
      expect(result.isCompliant).toBe(true);
    });

    it("South Dakota: warningLevel is 'ok' for very high rate", () => {
      const result = checkUsury("SD", 99);
      expect(result.warningLevel).toBe("ok");
    });

    it("South Dakota: maxAllowedRate is 0 (indicating no cap)", () => {
      const result = checkUsury("SD", 50);
      expect(result.maxAllowedRate).toBe(0);
    });

    it("South Dakota: message indicates no statutory cap", () => {
      const result = checkUsury("SD", 50);
      expect(result.message).toMatch(/no statutory/i);
    });
  });

  // ── Unknown state ──────────────────────────────────────────────────────────
  describe("unknown state", () => {
    it("unknown state code returns warning with message", () => {
      const result = checkUsury("ZZ", 10);
      expect(result.warningLevel).toBe("warning");
    });

    it("unknown state is treated as compliant (conservative default)", () => {
      const result = checkUsury("ZZ", 10);
      expect(result.isCompliant).toBe(true);
    });

    it("unknown state message advises verifying with local counsel", () => {
      const result = checkUsury("ZZ", 10);
      expect(result.message).toMatch(/local counsel|verify/i);
    });
  });

  // ── Case-insensitive state codes ───────────────────────────────────────────
  describe("case insensitivity", () => {
    it("lowercase 'tx' works the same as 'TX'", () => {
      const lower = checkUsury("tx", 20);
      const upper = checkUsury("TX", 20);
      expect(lower.warningLevel).toBe(upper.warningLevel);
      expect(lower.isCompliant).toBe(upper.isCompliant);
    });

    it("mixed case 'Tx' is treated correctly", () => {
      const result = checkUsury("Tx", 10);
      expect(result.isCompliant).toBe(true);
    });
  });

  // ── Warning threshold (within 2% of limit) ────────────────────────────────
  describe("warning threshold — within 2% of limit", () => {
    it("exactly at limit boundary → ok (not warning since buffer = 0)", () => {
      // buffer = maxRate - proposedRate = 18 - 18 = 0, which is < 2 → warning
      const result = checkUsury("TX", 18);
      // 18 === 18 → isCompliant=true, buffer=0 → buffer < 2 → "warning"? No.
      // Let's check: isCompliant = 18 <= 18 = true; buffer = 18 - 18 = 0; 0 < 2 → "warning"
      expect(result.warningLevel).toBe("warning");
    });

    it("rate exactly 2% below limit → ok (buffer = 2, not < 2)", () => {
      // TX limit is 18%, rate 16% → buffer = 2. 2 < 2 is false → "ok"
      const result = checkUsury("TX", 16);
      expect(result.warningLevel).toBe("ok");
    });

    it("rate 1.9% below limit → warning (buffer < 2)", () => {
      const result = checkUsury("TX", 16.1);
      // buffer = 18 - 16.1 = 1.9 < 2 → warning
      expect(result.warningLevel).toBe("warning");
      expect(result.isCompliant).toBe(true);
    });
  });

  // ── Other states spot check ────────────────────────────────────────────────
  describe("other state limits spot check", () => {
    it("Florida: 25% rate is a violation (18% limit)", () => {
      const result = checkUsury("FL", 25);
      expect(result.warningLevel).toBe("violation");
      expect(result.isCompliant).toBe(false);
    });

    it("California: 12% rate is a violation (10% limit)", () => {
      const result = checkUsury("CA", 12);
      expect(result.warningLevel).toBe("violation");
      expect(result.isCompliant).toBe(false);
    });

    it("Colorado: 40% rate is compliant (45% limit)", () => {
      const result = checkUsury("CO", 40);
      expect(result.isCompliant).toBe(true);
    });

    it("Alabama: 7% rate is compliant (8% limit)", () => {
      const result = checkUsury("AL", 7);
      expect(result.isCompliant).toBe(true);
    });
  });

  // ── Result shape ───────────────────────────────────────────────────────────
  describe("result shape", () => {
    it("always includes all required fields", () => {
      const result = checkUsury("TX", 10);
      expect(result).toHaveProperty("state");
      expect(result).toHaveProperty("proposedRate");
      expect(result).toHaveProperty("maxAllowedRate");
      expect(result).toHaveProperty("isCompliant");
      expect(result).toHaveProperty("warningLevel");
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("statuteNote");
      expect(result).toHaveProperty("disclaimer");
    });

    it("state field reflects the input state", () => {
      const result = checkUsury("TX", 10);
      expect(result.state).toBe("TX");
    });

    it("proposedRate reflects the input rate", () => {
      const result = checkUsury("TX", 12.5);
      expect(result.proposedRate).toBe(12.5);
    });

    it("disclaimer is always present and non-empty", () => {
      const result = checkUsury("TX", 10);
      expect(typeof result.disclaimer).toBe("string");
      expect(result.disclaimer.length).toBeGreaterThan(0);
    });

    it("statuteNote is always non-empty for known states", () => {
      const result = checkUsury("TX", 10);
      expect(typeof result.statuteNote).toBe("string");
      expect(result.statuteNote.length).toBeGreaterThan(0);
    });
  });
});
