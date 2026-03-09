/**
 * T261 — TCPA Compliance Tests
 * Tests consent validation, do-not-call checking, and time-of-day restrictions.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface TcpaConsent {
  phoneNumber: string;
  consentGivenAt?: Date;
  consentType: "express_written" | "express_oral" | "implied" | "none";
  optedOutAt?: Date;
  channel: "sms" | "call" | "fax";
}

function hasValidConsent(consent: TcpaConsent, messageType: "marketing" | "transactional"): boolean {
  if (consent.optedOutAt) return false;
  if (messageType === "transactional") {
    return consent.consentType !== "none";
  }
  // Marketing requires express written consent
  return consent.consentType === "express_written";
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+1${digits.substring(1)}`;
  if (digits.length === 10) return `+1${digits}`;
  return phone;
}

function isAllowedCallHour(localHour: number, stateCode: string): boolean {
  // TCPA: 8am-9pm local time; some states more restrictive
  const strictStates = new Set(["CA", "FL", "MI", "TX"]);
  const start = strictStates.has(stateCode.toUpperCase()) ? 9 : 8;
  const end = 21; // 9pm
  return localHour >= start && localHour < end;
}

function isOnDoNotCallList(phone: string, dncList: Set<string>): boolean {
  return dncList.has(normalizePhone(phone));
}

function canContactLead(
  phone: string,
  consent: TcpaConsent,
  localHour: number,
  stateCode: string,
  dncList: Set<string>,
  messageType: "marketing" | "transactional"
): { allowed: boolean; reason?: string } {
  const normalized = normalizePhone(phone);

  if (isOnDoNotCallList(normalized, dncList)) {
    return { allowed: false, reason: "Number on Do Not Call list" };
  }

  if (!hasValidConsent(consent, messageType)) {
    return { allowed: false, reason: `No valid ${messageType} consent` };
  }

  if (!isAllowedCallHour(localHour, stateCode)) {
    return { allowed: false, reason: `Outside allowed hours for ${stateCode}` };
  }

  return { allowed: true };
}

function validateConsentRecord(consent: Partial<TcpaConsent>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!consent.phoneNumber) errors.push("Phone number required");
  if (!consent.consentType) errors.push("Consent type required");
  if (!consent.channel) errors.push("Channel required");
  if (consent.consentType === "express_written" && !consent.consentGivenAt) {
    errors.push("Consent date required for express written consent");
  }
  return { valid: errors.length === 0, errors };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("hasValidConsent", () => {
  it("allows transactional with any non-none consent", () => {
    expect(hasValidConsent({ phoneNumber: "555-0100", consentType: "implied", channel: "sms" }, "transactional")).toBe(true);
    expect(hasValidConsent({ phoneNumber: "555-0100", consentType: "express_oral", channel: "sms" }, "transactional")).toBe(true);
  });

  it("blocks transactional with no consent", () => {
    expect(hasValidConsent({ phoneNumber: "555-0100", consentType: "none", channel: "sms" }, "transactional")).toBe(false);
  });

  it("blocks marketing without express written consent", () => {
    expect(hasValidConsent({ phoneNumber: "555-0100", consentType: "implied", channel: "sms" }, "marketing")).toBe(false);
    expect(hasValidConsent({ phoneNumber: "555-0100", consentType: "express_oral", channel: "sms" }, "marketing")).toBe(false);
  });

  it("allows marketing with express written consent", () => {
    expect(hasValidConsent({ phoneNumber: "555-0100", consentType: "express_written", channel: "sms" }, "marketing")).toBe(true);
  });

  it("blocks all contact after opt-out", () => {
    const consent: TcpaConsent = {
      phoneNumber: "555-0100",
      consentType: "express_written",
      channel: "sms",
      optedOutAt: new Date(),
    };
    expect(hasValidConsent(consent, "marketing")).toBe(false);
    expect(hasValidConsent(consent, "transactional")).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("normalizes 10-digit to E.164", () => {
    expect(normalizePhone("2125551234")).toBe("+12125551234");
  });

  it("normalizes 11-digit starting with 1", () => {
    expect(normalizePhone("12125551234")).toBe("+12125551234");
  });

  it("strips formatting characters", () => {
    expect(normalizePhone("(212) 555-1234")).toBe("+12125551234");
  });
});

describe("isAllowedCallHour", () => {
  it("allows calls between 8am and 9pm for standard states", () => {
    expect(isAllowedCallHour(8, "NY")).toBe(true);
    expect(isAllowedCallHour(20, "NY")).toBe(true);
    expect(isAllowedCallHour(21, "NY")).toBe(false);
  });

  it("requires 9am start for strict states (CA, TX, etc)", () => {
    expect(isAllowedCallHour(8, "CA")).toBe(false);
    expect(isAllowedCallHour(9, "CA")).toBe(true);
    expect(isAllowedCallHour(8, "TX")).toBe(false);
    expect(isAllowedCallHour(9, "TX")).toBe(true);
  });

  it("blocks calls before 8am for standard states", () => {
    expect(isAllowedCallHour(7, "NY")).toBe(false);
  });
});

describe("isOnDoNotCallList", () => {
  const dncList = new Set(["+12125551234", "+15551234567"]);

  it("returns true for number on DNC list", () => {
    expect(isOnDoNotCallList("2125551234", dncList)).toBe(true);
  });

  it("returns false for number not on DNC list", () => {
    expect(isOnDoNotCallList("3125551234", dncList)).toBe(false);
  });

  it("normalizes before checking", () => {
    expect(isOnDoNotCallList("(212) 555-1234", dncList)).toBe(true);
  });
});

describe("canContactLead", () => {
  const goodConsent: TcpaConsent = {
    phoneNumber: "+12125551234",
    consentType: "express_written",
    channel: "sms",
    consentGivenAt: new Date(),
  };
  const emptyDnc = new Set<string>();

  it("allows contact when all conditions met", () => {
    const result = canContactLead("2125551234", goodConsent, 10, "NY", emptyDnc, "marketing");
    expect(result.allowed).toBe(true);
  });

  it("blocks when on DNC list", () => {
    const dnc = new Set(["+12125551234"]);
    const result = canContactLead("2125551234", goodConsent, 10, "NY", dnc, "marketing");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Do Not Call");
  });

  it("blocks outside allowed hours", () => {
    const result = canContactLead("2125551234", goodConsent, 7, "NY", emptyDnc, "marketing");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("hours");
  });

  it("blocks without valid consent", () => {
    const noConsent: TcpaConsent = { phoneNumber: "+12125551234", consentType: "none", channel: "sms" };
    const result = canContactLead("2125551234", noConsent, 10, "NY", emptyDnc, "marketing");
    expect(result.allowed).toBe(false);
  });
});

describe("validateConsentRecord", () => {
  it("validates complete consent record", () => {
    const consent = {
      phoneNumber: "+12125551234",
      consentType: "express_written" as const,
      channel: "sms" as const,
      consentGivenAt: new Date(),
    };
    expect(validateConsentRecord(consent).valid).toBe(true);
  });

  it("requires consent date for express written", () => {
    const consent = {
      phoneNumber: "+12125551234",
      consentType: "express_written" as const,
      channel: "sms" as const,
    };
    const result = validateConsentRecord(consent);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Consent date required for express written consent");
  });

  it("returns errors for missing required fields", () => {
    const result = validateConsentRecord({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
