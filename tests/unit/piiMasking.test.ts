/**
 * Tasks #43–#44 — PII Masking Unit Tests
 *
 * Verifies that SSN, phone, email, and credit card numbers are masked
 * in log output and never appear in plaintext.
 */

import { describe, it, expect } from "vitest";
import { maskString, maskValue, maskRecord, installConsoleInterceptor } from "../../server/middleware/piiMasking";

describe("maskString — phone numbers", () => {
  const phones = [
    "(555) 123-4567",
    "555-123-4567",
    "5551234567",
    "+15551234567",
    "555.123.4567",
  ];

  phones.forEach((phone) => {
    it(`masks phone: ${phone}`, () => {
      const masked = maskString(phone);
      // Original full number should not appear
      expect(masked).not.toContain("1234567");
      expect(masked).toContain("555");
    });
  });
});

describe("maskString — email addresses", () => {
  it("masks email preserving domain", () => {
    const masked = maskString("john.doe@example.com");
    expect(masked).not.toContain("john.doe");
    expect(masked).toContain("@example.com");
    expect(masked).toContain("***");
  });

  it("masks multiple emails in a string", () => {
    const input = "Contact alice@foo.com and bob@bar.org for help";
    const masked = maskString(input);
    expect(masked).not.toContain("alice");
    expect(masked).not.toContain("bob");
    expect(masked).toContain("@foo.com");
    expect(masked).toContain("@bar.org");
  });
});

describe("maskString — SSNs", () => {
  it("masks SSN in standard format (123-45-6789)", () => {
    const masked = maskString("My SSN is 123-45-6789");
    expect(masked).not.toContain("123-45");
    expect(masked).toContain("***-**-");
    expect(masked).toContain("6789"); // last 4 preserved
  });

  it("masks SSN without dashes (123456789)", () => {
    const masked = maskString("SSN: 123456789");
    expect(masked).not.toContain("123456");
  });
});

describe("maskString — credit card numbers", () => {
  it("masks 16-digit credit card", () => {
    const masked = maskString("Card: 4111111111111111");
    expect(masked).not.toContain("4111111111");
    expect(masked).toContain("****");
    expect(masked).toContain("1111"); // last 4 preserved
  });

  it("masks credit card with spaces", () => {
    const masked = maskString("4111 1111 1111 1111");
    expect(masked).not.toContain("4111 1111");
  });
});

describe("maskString — edge cases", () => {
  it("returns non-string input unchanged", () => {
    expect(maskString(42 as any)).toBe(42);
  });

  it("handles empty string", () => {
    expect(maskString("")).toBe("");
  });

  it("leaves normal text unchanged", () => {
    const text = "This is a normal sentence about land investing.";
    expect(maskString(text)).toBe(text);
  });
});

describe("maskValue — deep masking", () => {
  it("masks strings in objects recursively", () => {
    const obj = {
      name: "John",
      contact: { ssn: "123-45-6789", email: "john@example.com" },
    };
    const masked = maskValue(obj) as any;
    expect(masked.name).toBe("John");
    expect(masked.contact.ssn).not.toContain("123-45");
    expect(masked.contact.email).not.toContain("john");
  });

  it("masks strings in arrays", () => {
    const arr = ["5551234567", "normal"];
    const masked = maskValue(arr) as string[];
    expect(masked[0]).not.toContain("1234567");
    expect(masked[1]).toBe("normal");
  });
});

describe("maskRecord — field-level redaction", () => {
  it("redacts known sensitive key names", () => {
    const record = {
      name: "John",
      ssn: "123-45-6789",
      passwordHash: "$2b$12$...",
      apiKey: "sk-abc123",
    };
    const masked = maskRecord(record);
    expect(masked.name).not.toBe("[REDACTED]");
    expect(masked.ssn).toBe("[REDACTED]");
    expect(masked.passwordHash).toBe("[REDACTED]");
    expect(masked.apiKey).toBe("[REDACTED]");
  });
});

describe("installConsoleInterceptor", () => {
  it("installs without error", () => {
    expect(() => installConsoleInterceptor()).not.toThrow();
  });

  it("is idempotent (safe to call multiple times)", () => {
    expect(() => {
      installConsoleInterceptor();
      installConsoleInterceptor();
      installConsoleInterceptor();
    }).not.toThrow();
  });
});
