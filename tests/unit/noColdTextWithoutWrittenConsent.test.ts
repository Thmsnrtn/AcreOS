/**
 * Standing founder decision 2026-10-20 #1: no cold texting without WRITTEN
 * consent.
 *
 * The prospecting gate used to accept any recorded TCPA consent — a verbal
 * yes or an operator's unevidenced "manual" tick licensed a cold text. These
 * drive the real gate (storage mocked) and the real predicate, so loosening
 * either back to "any consent" goes red.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const leadRow: Record<string, unknown> = {};
vi.mock("../../server/storage", () => ({
  storage: { getLead: vi.fn(async () => ({ ...leadRow })) },
}));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { tcpaGateForSms, hasWrittenSmsConsent, WRITTEN_SMS_CONSENT_SOURCES } = await import(
  "../../server/services/tcpaCompliance"
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T17:00:00Z")); // midday in UTC
  for (const k of Object.keys(leadRow)) delete leadRow[k];
  Object.assign(leadRow, { id: 1, organizationId: 7, tcpaConsent: true, doNotContact: false, optOutDate: null, timezone: "UTC" });
});
afterEach(() => vi.useRealTimers());

describe("cold texts need written consent", () => {
  for (const source of ["verbal", "manual", "admin_manual", "manual_restoration", "imported", null]) {
    it(`consent source ${String(source)} does NOT license a cold text`, async () => {
      leadRow.consentSource = source;
      const v = await tcpaGateForSms(1, 7, "+15125550111");
      expect(v.allowed).toBe(false);
      expect(v.reason).toMatch(/written consent/);
    });
  }

  for (const source of ["website", "written", "sms_double_optin", "phone_ivr"]) {
    it(`consent source ${source} (written / E-SIGN) does`, async () => {
      leadRow.consentSource = source;
      expect((await tcpaGateForSms(1, 7, "+15125550111")).allowed).toBe(true);
    });
  }

  it("written-source consent that was revoked does not", async () => {
    Object.assign(leadRow, { consentSource: "website", doNotContact: true });
    expect((await tcpaGateForSms(1, 7, "+15125550111")).allowed).toBe(false);
  });

  it("the predicate requires both the grant and a written source", () => {
    expect(hasWrittenSmsConsent({ tcpaConsent: false, consentSource: "website" })).toBe(false);
    expect(hasWrittenSmsConsent({ tcpaConsent: true, consentSource: "verbal" })).toBe(false);
    expect(hasWrittenSmsConsent({ tcpaConsent: true, consentSource: "written" })).toBe(true);
    expect([...WRITTEN_SMS_CONSENT_SOURCES].sort()).toEqual(["phone_ivr", "sms_double_optin", "website", "written"]);
  });
});
