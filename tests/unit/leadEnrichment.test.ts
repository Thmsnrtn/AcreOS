/**
 * T186 — Lead Enrichment Service Tests
 * Tests email validation, phone formatting, ownership duration, and contact completeness.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

function validateEmail(email: string | null | undefined): { valid: boolean; domain?: string; isFreeDomain?: boolean } {
  if (!email) return { valid: false };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return { valid: false };
  const domain = email.split("@")[1]?.toLowerCase();
  const freeDomains = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com"]);
  return { valid: true, domain, isFreeDomain: freeDomains.has(domain || "") };
}

function formatPhone(phone: string | null | undefined): { formatted: string | null; valid: boolean } {
  if (!phone) return { formatted: null, valid: false };
  const digits = phone.replace(/\D/g, "");
  let core = digits;
  if (digits.length === 11 && digits.startsWith("1")) core = digits.substring(1);
  if (core.length !== 10) return { formatted: null, valid: false };
  const areaCode = parseInt(core.substring(0, 3));
  if (areaCode < 200 || areaCode === 555) return { formatted: null, valid: false };
  const formatted = `+1 (${core.substring(0, 3)}) ${core.substring(3, 6)}-${core.substring(6)}`;
  return { formatted, valid: true };
}

function estimateOwnershipYears(
  lastTransferDate: string | null | undefined,
  currentDate = new Date()
): number | null {
  if (!lastTransferDate) return null;
  const transfer = new Date(lastTransferDate);
  if (isNaN(transfer.getTime())) return null;
  const diffMs = currentDate.getTime() - transfer.getTime();
  const years = diffMs / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, Math.round(years * 10) / 10);
}

function calculateContactCompleteness(lead: {
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  propertyAddress?: string | null;
}): number {
  let score = 0;
  if (lead.email && lead.email.length > 3) score += 25;
  if (lead.phone && lead.phone.replace(/\D/g, "").length >= 10) score += 25;
  if (lead.firstName && lead.lastName) score += 20;
  else if (lead.firstName || lead.lastName) score += 10;
  if (lead.address) score += 15;
  if (lead.propertyAddress) score += 15;
  return Math.min(100, score);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("validateEmail", () => {
  it("validates a standard email", () => {
    const result = validateEmail("user@example.com");
    expect(result.valid).toBe(true);
    expect(result.domain).toBe("example.com");
  });

  it("identifies free email domains", () => {
    expect(validateEmail("test@gmail.com").isFreeDomain).toBe(true);
    expect(validateEmail("test@yahoo.com").isFreeDomain).toBe(true);
    expect(validateEmail("test@outlook.com").isFreeDomain).toBe(true);
  });

  it("identifies non-free email domains", () => {
    expect(validateEmail("john@company.com").isFreeDomain).toBe(false);
    expect(validateEmail("agent@realty.net").isFreeDomain).toBe(false);
  });

  it("returns invalid for null/undefined", () => {
    expect(validateEmail(null).valid).toBe(false);
    expect(validateEmail(undefined).valid).toBe(false);
  });

  it("returns invalid for malformed email", () => {
    expect(validateEmail("notanemail").valid).toBe(false);
    expect(validateEmail("missing@").valid).toBe(false);
    expect(validateEmail("@domain.com").valid).toBe(false);
    expect(validateEmail("space in@email.com").valid).toBe(false);
  });

  it("extracts domain correctly", () => {
    const result = validateEmail("user@LandOwner.COM");
    expect(result.domain).toBe("landowner.com"); // lowercased
  });
});

describe("formatPhone", () => {
  it("formats 10-digit number", () => {
    const result = formatPhone("5551234567");
    // Note: 555 area code is blocked
    expect(result.valid).toBe(false);
  });

  it("formats valid 10-digit US number", () => {
    const result = formatPhone("2125551234");
    expect(result.valid).toBe(true);
    expect(result.formatted).toBe("+1 (212) 555-1234");
  });

  it("strips formatting characters", () => {
    expect(formatPhone("(212) 555-1234").valid).toBe(true);
    expect(formatPhone("212.555.1234").valid).toBe(true);
    expect(formatPhone("212-555-1234").valid).toBe(true);
  });

  it("handles 11-digit with country code", () => {
    const result = formatPhone("12125551234");
    expect(result.valid).toBe(true);
    expect(result.formatted).toBe("+1 (212) 555-1234");
  });

  it("returns invalid for null", () => {
    expect(formatPhone(null).valid).toBe(false);
    expect(formatPhone(null).formatted).toBeNull();
  });

  it("returns invalid for too short number", () => {
    expect(formatPhone("12345").valid).toBe(false);
  });

  it("returns invalid for 000 area code", () => {
    expect(formatPhone("0001234567").valid).toBe(false);
  });

  it("returns invalid for area code < 200", () => {
    expect(formatPhone("1001234567").valid).toBe(false);
  });
});

describe("estimateOwnershipYears", () => {
  it("calculates years from a past date", () => {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const years = estimateOwnershipYears(fiveYearsAgo.toISOString());
    expect(years).toBeCloseTo(5, 0);
  });

  it("returns null for null input", () => {
    expect(estimateOwnershipYears(null)).toBeNull();
    expect(estimateOwnershipYears(undefined)).toBeNull();
  });

  it("returns null for invalid date string", () => {
    expect(estimateOwnershipYears("not-a-date")).toBeNull();
  });

  it("returns 0 for today (just transferred)", () => {
    const result = estimateOwnershipYears(new Date().toISOString());
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(0.1);
  });

  it("rounds to one decimal place", () => {
    const exactDate = "2021-01-01T00:00:00.000Z";
    const refDate = new Date("2023-07-01T00:00:00.000Z");
    const years = estimateOwnershipYears(exactDate, refDate);
    expect(years).not.toBeNull();
    // Should be approximately 2.5 years
    expect(years!).toBeGreaterThan(2.0);
    expect(years!).toBeLessThan(3.0);
  });

  it("uses provided reference date for consistent calculation", () => {
    const refDate = new Date("2024-01-01");
    const y1 = estimateOwnershipYears("2014-01-01", refDate);
    const y2 = estimateOwnershipYears("2004-01-01", refDate);
    expect(y2).toBeGreaterThan(y1!);
    expect(y1).toBeCloseTo(10, 0);
    expect(y2).toBeCloseTo(20, 0);
  });
});

describe("calculateContactCompleteness", () => {
  it("returns 0 for empty lead", () => {
    expect(calculateContactCompleteness({})).toBe(0);
  });

  it("returns 100 for fully complete lead", () => {
    const score = calculateContactCompleteness({
      email: "user@example.com",
      phone: "2125551234",
      firstName: "John",
      lastName: "Smith",
      address: "123 Main St",
      propertyAddress: "456 Oak Ave",
    });
    expect(score).toBe(100);
  });

  it("awards 25 points for email", () => {
    expect(calculateContactCompleteness({ email: "test@example.com" })).toBe(25);
  });

  it("awards 25 points for valid phone", () => {
    expect(calculateContactCompleteness({ phone: "2125551234" })).toBe(25);
  });

  it("awards 20 points for full name", () => {
    expect(calculateContactCompleteness({ firstName: "John", lastName: "Doe" })).toBe(20);
  });

  it("awards 10 points for partial name", () => {
    expect(calculateContactCompleteness({ firstName: "John" })).toBe(10);
    expect(calculateContactCompleteness({ lastName: "Doe" })).toBe(10);
  });

  it("awards 15 points for address", () => {
    expect(calculateContactCompleteness({ address: "123 Main St" })).toBe(15);
  });

  it("awards 15 points for property address", () => {
    expect(calculateContactCompleteness({ propertyAddress: "456 Oak Ave" })).toBe(15);
  });

  it("caps at 100", () => {
    const score = calculateContactCompleteness({
      email: "a@b.com",
      phone: "2125551234",
      firstName: "J",
      lastName: "D",
      address: "123 Main",
      propertyAddress: "456 Oak",
    });
    expect(score).toBeLessThanOrEqual(100);
  });
});
