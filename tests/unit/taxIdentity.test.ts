/**
 * Shared tax-identity validators — unit tests.
 *
 * These guard the regexes + Zod schema that gate org-side 1099 issuer
 * onboarding. The 1099 generator returns 422 unless the org row carries a
 * valid (non-placeholder) EIN/SSN/ITIN matching one of these formats —
 * any drift between this module and the generator means UI lets bad input
 * through.
 */
import { describe, it, expect } from "vitest";
import {
  EIN_REGEX,
  SSN_REGEX,
  ITIN_REGEX,
  isValidTaxId,
  taxIdLast4,
  maskTaxId,
  taxIdentitySchema,
  taxAddressSchema,
  formatTaxIdAsTyped,
  taxIdFormatHint,
} from "../../shared/taxIdentity";

describe("taxIdentity — regex contracts", () => {
  describe("EIN_REGEX", () => {
    it("accepts canonical IRS EIN format", () => {
      expect(EIN_REGEX.test("12-3456789")).toBe(true);
      expect(EIN_REGEX.test("99-0000001")).toBe(true);
    });

    it("rejects the all-zero placeholder used by buggy emitters", () => {
      // Specific regression: bookkeeping.ts previously emitted "00-0000000".
      expect(EIN_REGEX.test("00-0000000")).toBe(false);
    });

    it("rejects unformatted, mis-formatted, and SSN-shaped inputs", () => {
      expect(EIN_REGEX.test("123456789")).toBe(false);
      expect(EIN_REGEX.test("12-345-6789")).toBe(false);
      expect(EIN_REGEX.test("123-45-6789")).toBe(false);
      expect(EIN_REGEX.test("1-23456789")).toBe(false);
      expect(EIN_REGEX.test("")).toBe(false);
    });
  });

  describe("SSN_REGEX", () => {
    it("accepts canonical SSN format", () => {
      expect(SSN_REGEX.test("123-45-6789")).toBe(true);
      expect(SSN_REGEX.test("078-05-1120")).toBe(true);
    });

    it("rejects placeholder and ITIN-shaped inputs", () => {
      // Recipient placeholder previously emitted by bookkeeping.ts.
      expect(SSN_REGEX.test("000-00-0000")).toBe(false);
      // 9-prefixed numbers are ITIN territory and must not pass as SSN.
      expect(SSN_REGEX.test("912-34-5678")).toBe(false);
      // 666 area number is invalid per SSA.
      expect(SSN_REGEX.test("666-12-3456")).toBe(false);
    });

    it("rejects unformatted SSNs", () => {
      expect(SSN_REGEX.test("123456789")).toBe(false);
      expect(SSN_REGEX.test("12-3456-789")).toBe(false);
    });
  });

  describe("ITIN_REGEX", () => {
    it("accepts ITINs with valid IRS middle-group ranges", () => {
      expect(ITIN_REGEX.test("912-70-1234")).toBe(true);
      expect(ITIN_REGEX.test("999-88-9999")).toBe(true);
      expect(ITIN_REGEX.test("955-94-0001")).toBe(true);
    });

    it("rejects non-9-prefix and out-of-range middle group", () => {
      expect(ITIN_REGEX.test("812-70-1234")).toBe(false);
      expect(ITIN_REGEX.test("912-69-1234")).toBe(false);
      expect(ITIN_REGEX.test("912-93-1234")).toBe(false);
    });
  });
});

describe("taxIdentity — isValidTaxId routing", () => {
  it("routes to the correct regex per type", () => {
    expect(isValidTaxId("12-3456789", "EIN")).toBe(true);
    expect(isValidTaxId("12-3456789", "SSN")).toBe(false);
    expect(isValidTaxId("123-45-6789", "SSN")).toBe(true);
    expect(isValidTaxId("123-45-6789", "EIN")).toBe(false);
    expect(isValidTaxId("912-70-1234", "ITIN")).toBe(true);
    expect(isValidTaxId("912-70-1234", "SSN")).toBe(false);
  });

  it("returns false for non-string inputs without throwing", () => {
    expect(isValidTaxId(undefined as unknown as string, "EIN")).toBe(false);
    expect(isValidTaxId(null as unknown as string, "EIN")).toBe(false);
    expect(isValidTaxId(123456789 as unknown as string, "EIN")).toBe(false);
  });
});

describe("taxIdentity — last4 / mask", () => {
  it("extracts last4 digits regardless of formatting", () => {
    expect(taxIdLast4("12-3456789")).toBe("6789");
    expect(taxIdLast4("123-45-6789")).toBe("6789");
    expect(taxIdLast4("123456789")).toBe("6789");
  });

  it("returns a stable placeholder when no digits are present", () => {
    expect(taxIdLast4("")).toBe("----");
    expect(taxIdLast4("abc")).toBe("----");
  });

  it("masks down to last4 with bullet placeholders", () => {
    expect(maskTaxId("12-3456789")).toBe("•••-••-6789");
    expect(maskTaxId(null)).toBe("");
    expect(maskTaxId(undefined)).toBe("");
  });
});

describe("taxIdentity — Zod schema", () => {
  const validInput = {
    legalEntityName: "Apex Land Group, LLC",
    taxIdType: "EIN" as const,
    taxId: "12-3456789",
    taxAddress: {
      line1: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
  };

  it("accepts a fully-valid payload", () => {
    const result = taxIdentitySchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects an EIN with placeholder shape", () => {
    const result = taxIdentitySchema.safeParse({
      ...validInput,
      taxId: "00-0000000",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("taxId");
    }
  });

  it("rejects an SSN value when type=EIN and vice-versa", () => {
    const ssnAsEin = taxIdentitySchema.safeParse({
      ...validInput,
      taxId: "123-45-6789",
    });
    expect(ssnAsEin.success).toBe(false);

    const einAsSsn = taxIdentitySchema.safeParse({
      ...validInput,
      taxIdType: "SSN",
      taxId: "12-3456789",
    });
    expect(einAsSsn.success).toBe(false);
  });

  it("requires a non-empty legal entity name", () => {
    const result = taxIdentitySchema.safeParse({
      ...validInput,
      legalEntityName: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.join(".") === "legalEntityName"),
      ).toBe(true);
    }
  });

  it("rejects malformed addresses (lowercase state, short zip)", () => {
    const lowerState = taxIdentitySchema.safeParse({
      ...validInput,
      taxAddress: { ...validInput.taxAddress, state: "tx" },
    });
    expect(lowerState.success).toBe(false);

    const shortZip = taxIdentitySchema.safeParse({
      ...validInput,
      taxAddress: { ...validInput.taxAddress, zip: "1234" },
    });
    expect(shortZip.success).toBe(false);
  });

  it("accepts ZIP+4 format", () => {
    const result = taxIdentitySchema.safeParse({
      ...validInput,
      taxAddress: { ...validInput.taxAddress, zip: "78701-1234" },
    });
    expect(result.success).toBe(true);
  });

  it("normalizes optional country to US default when omitted", () => {
    const result = taxAddressSchema.safeParse({
      line1: "1 Wall St",
      city: "New York",
      state: "NY",
      zip: "10005",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.country).toBe("US");
  });

  it("accepts ITIN payloads when typed correctly", () => {
    const result = taxIdentitySchema.safeParse({
      ...validInput,
      taxIdType: "ITIN",
      taxId: "912-70-1234",
    });
    expect(result.success).toBe(true);
  });
});

describe("taxIdentity — formatTaxIdAsTyped", () => {
  it("formats EIN as XX-XXXXXXX while typing", () => {
    expect(formatTaxIdAsTyped("12", "EIN")).toBe("12");
    expect(formatTaxIdAsTyped("123", "EIN")).toBe("12-3");
    expect(formatTaxIdAsTyped("123456789", "EIN")).toBe("12-3456789");
    // Already-formatted input round-trips.
    expect(formatTaxIdAsTyped("12-3456789", "EIN")).toBe("12-3456789");
  });

  it("formats SSN/ITIN as XXX-XX-XXXX while typing", () => {
    expect(formatTaxIdAsTyped("123", "SSN")).toBe("123");
    expect(formatTaxIdAsTyped("12345", "SSN")).toBe("123-45");
    expect(formatTaxIdAsTyped("123456789", "SSN")).toBe("123-45-6789");
    expect(formatTaxIdAsTyped("912701234", "ITIN")).toBe("912-70-1234");
  });

  it("strips non-digit characters and caps at 9 digits", () => {
    expect(formatTaxIdAsTyped("abc1d2e3-4f5g6h7i8j9k", "EIN")).toBe("12-3456789");
    expect(formatTaxIdAsTyped("9999999999999", "EIN")).toBe("99-9999999");
  });
});

describe("taxIdentity — taxIdFormatHint", () => {
  it("returns a non-empty hint for each type", () => {
    expect(taxIdFormatHint("EIN")).toMatch(/EIN/);
    expect(taxIdFormatHint("SSN")).toMatch(/SSN/);
    expect(taxIdFormatHint("ITIN")).toMatch(/ITIN/);
  });
});
