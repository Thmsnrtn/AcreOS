/**
 * T278 — Address Validation Tests
 * Tests minimal address validation, standardization helpers, and batch logic.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface AddressInput {
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

function isAddressMinimallyValid(address: AddressInput): boolean {
  const { line1, city, state, zip } = address;
  if (!line1 || line1.trim().length < 5) return false;
  // Need at least city+state OR zip
  if (!zip && (!city || !state)) return false;
  return true;
}

function normalizeState(state: string): string {
  return state.trim().toUpperCase();
}

function normalizeZip(zip: string): string {
  return zip.replace(/\D/g, "").slice(0, 5);
}

function formatAddress(address: AddressInput): string {
  const parts = [address.line1];
  if (address.line2) parts.push(address.line2);
  if (address.city && address.state) {
    parts.push(`${address.city}, ${address.state}${address.zip ? ` ${address.zip}` : ""}`);
  } else if (address.zip) {
    parts.push(address.zip);
  }
  return parts.join(", ");
}

function parseZipPlus4(zipPlus4: string): { zip: string; plus4: string | null } {
  const match = zipPlus4.match(/^(\d{5})(?:-(\d{4}))?$/);
  if (!match) return { zip: zipPlus4, plus4: null };
  return { zip: match[1], plus4: match[2] ?? null };
}

function isMilitaryAddress(line1: string): boolean {
  const upper = line1.toUpperCase();
  return upper.includes("APO") || upper.includes("FPO") || upper.includes("DPO");
}

function extractStreetNumber(line1: string): string | null {
  const match = line1.match(/^(\d+)/);
  return match ? match[1] : null;
}

function areAddressesEqual(a: AddressInput, b: AddressInput): boolean {
  const normalize = (s: string | undefined) => (s ?? "").trim().toUpperCase();
  return (
    normalize(a.line1) === normalize(b.line1) &&
    normalize(a.city) === normalize(b.city) &&
    normalize(a.state) === normalize(b.state) &&
    normalizeZip(a.zip ?? "") === normalizeZip(b.zip ?? "")
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("isAddressMinimallyValid", () => {
  it("returns true for complete address with city/state", () => {
    expect(isAddressMinimallyValid({ line1: "123 Main St", city: "Austin", state: "TX" })).toBe(true);
  });

  it("returns true for address with zip (no city/state required)", () => {
    expect(isAddressMinimallyValid({ line1: "456 Oak Ave", zip: "78701" })).toBe(true);
  });

  it("returns false when line1 is too short", () => {
    expect(isAddressMinimallyValid({ line1: "123", city: "Austin", state: "TX" })).toBe(false);
    expect(isAddressMinimallyValid({ line1: "", city: "Austin", state: "TX" })).toBe(false);
  });

  it("returns false when no zip and missing city or state", () => {
    expect(isAddressMinimallyValid({ line1: "123 Main St", city: "Austin" })).toBe(false);
    expect(isAddressMinimallyValid({ line1: "123 Main St", state: "TX" })).toBe(false);
  });

  it("returns false for missing line1", () => {
    expect(isAddressMinimallyValid({ line1: "   ", zip: "78701" })).toBe(false);
  });
});

describe("normalizeState", () => {
  it("uppercases and trims state codes", () => {
    expect(normalizeState("  tx  ")).toBe("TX");
    expect(normalizeState("ca")).toBe("CA");
  });
});

describe("normalizeZip", () => {
  it("strips non-numeric characters", () => {
    expect(normalizeZip("78701-1234")).toBe("78701");
    expect(normalizeZip("(78701)")).toBe("78701");
  });

  it("truncates to 5 digits", () => {
    expect(normalizeZip("787011234")).toBe("78701");
  });
});

describe("formatAddress", () => {
  it("formats complete address", () => {
    const addr = { line1: "123 Main St", city: "Austin", state: "TX", zip: "78701" };
    expect(formatAddress(addr)).toBe("123 Main St, Austin, TX 78701");
  });

  it("includes line2 when present", () => {
    const addr = { line1: "123 Main St", line2: "Apt 4", city: "Austin", state: "TX" };
    expect(formatAddress(addr)).toBe("123 Main St, Apt 4, Austin, TX");
  });

  it("falls back to just zip if no city/state", () => {
    const addr = { line1: "123 Main St", zip: "78701" };
    expect(formatAddress(addr)).toBe("123 Main St, 78701");
  });
});

describe("parseZipPlus4", () => {
  it("parses 5-digit zip", () => {
    const result = parseZipPlus4("78701");
    expect(result.zip).toBe("78701");
    expect(result.plus4).toBeNull();
  });

  it("parses zip+4 format", () => {
    const result = parseZipPlus4("78701-1234");
    expect(result.zip).toBe("78701");
    expect(result.plus4).toBe("1234");
  });

  it("returns original string when not recognized", () => {
    const result = parseZipPlus4("INVALID");
    expect(result.zip).toBe("INVALID");
    expect(result.plus4).toBeNull();
  });
});

describe("isMilitaryAddress", () => {
  it("detects APO addresses", () => {
    expect(isMilitaryAddress("Unit 1234 APO AE 09001")).toBe(true);
  });

  it("detects FPO addresses", () => {
    expect(isMilitaryAddress("Unit 456 FPO AP 96602")).toBe(true);
  });

  it("returns false for civilian addresses", () => {
    expect(isMilitaryAddress("123 Main St")).toBe(false);
  });
});

describe("extractStreetNumber", () => {
  it("extracts leading number", () => {
    expect(extractStreetNumber("123 Main St")).toBe("123");
    expect(extractStreetNumber("4500 Oak Blvd")).toBe("4500");
  });

  it("returns null for PO Box or no leading number", () => {
    expect(extractStreetNumber("PO Box 123")).toBeNull();
  });
});

describe("areAddressesEqual", () => {
  it("returns true for identical addresses", () => {
    const a = { line1: "123 Main St", city: "Austin", state: "TX", zip: "78701" };
    expect(areAddressesEqual(a, { ...a })).toBe(true);
  });

  it("is case-insensitive", () => {
    const a = { line1: "123 main st", city: "austin", state: "tx", zip: "78701" };
    const b = { line1: "123 MAIN ST", city: "AUSTIN", state: "TX", zip: "78701" };
    expect(areAddressesEqual(a, b)).toBe(true);
  });

  it("returns false for different addresses", () => {
    const a = { line1: "123 Main St", city: "Austin", state: "TX", zip: "78701" };
    const b = { line1: "456 Oak Ave", city: "Austin", state: "TX", zip: "78701" };
    expect(areAddressesEqual(a, b)).toBe(false);
  });
});
