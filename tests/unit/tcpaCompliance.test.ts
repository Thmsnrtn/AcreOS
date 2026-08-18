/**
 * TCPA compliance primitives (server/services/tcpaCompliance.ts).
 *
 * REWRITTEN 2026-07-07: the previous version of this file (T261) tested an
 * INLINE REIMPLEMENTATION of consent logic defined inside the test itself —
 * it never imported the real module, which is why tcpaCompliance.ts sat at
 * 4% line coverage while a "TCPA test file" existed. These tests exercise
 * the actual exports on the SMS/call path: quiet-hours math (8 AM–9 PM
 * recipient-local, § 64.1200(c)(1)), area-code timezone inference,
 * STOP/START keyword detection, and the consent matrix. A silent regression
 * here is a lawsuit, not a bug ticket.
 *
 * Time-dependent checks use fake timers pinned to explicit UTC instants so
 * the DST assertions mean what they say regardless of the runner's clock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkTcpaConsentFromLead,
  canSendViaChannel,
  detectOptKeyword,
  resolveZoneForPhone,
  isWithinQuietHours,
  isWithinQuietHoursForLead,
  requiresTcpaConsent,
} from "../../server/services/tcpaCompliance";

afterEach(() => {
  vi.useRealTimers();
});

const at = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

/**
 * `getZoneForPhone` was DELETED 2026-08-18. It returned a bare zone string, so
 * its answer meant both "the recipient's zone" and "we defaulted" — the exact
 * collapse that let an unknown area code be cleared to send at 05:30 Pacific.
 * `resolveZoneForPhone` returns the same zone plus whether it was inferred, so
 * these assertions carry strictly more than they did; the wrapper had no
 * production caller and survived only for this suite.
 */
describe("resolveZoneForPhone — area-code inference", () => {
  it("maps area codes to IANA zones (formatted, bare, and 11-digit forms)", () => {
    expect(resolveZoneForPhone("+1 (503) 555-0100").zone).toBe("America/Los_Angeles");
    expect(resolveZoneForPhone("2125550100").zone).toBe("America/New_York");
    expect(resolveZoneForPhone("13125550100").zone).toBe("America/Chicago");
  });

  it("handles the no-DST corrections (Phoenix, Guam, Puerto Rico)", () => {
    expect(resolveZoneForPhone("4805550100").zone).toBe("America/Phoenix");
    expect(resolveZoneForPhone("6715550100").zone).toBe("Pacific/Guam");
    expect(resolveZoneForPhone("7875550100").zone).toBe("America/Puerto_Rico");
  });

  it("defaults unknown area codes to America/New_York (pessimistic for quiet hours)", () => {
    expect(resolveZoneForPhone("9995550100").zone).toBe("America/New_York");
    expect(resolveZoneForPhone("").zone).toBe("America/New_York");
  });
});

describe("isWithinQuietHours — 8 AM–9 PM recipient-local", () => {
  it("allows mid-morning and blocks pre-8AM across zones at one instant", () => {
    // 15:00 UTC in January: NY = 10:00 EST (allowed), LA = 07:00 PST (blocked).
    at("2026-01-15T15:00:00Z");
    expect(isWithinQuietHours("2125550100").blocked).toBe(false);
    const la = isWithinQuietHours("3105550100");
    expect(la.blocked).toBe(true);
    expect(la.zone).toBe("America/Los_Angeles");
    expect(la.reason).toMatch(/quiet hours/i);
  });

  it("blocks at and after 9 PM local (boundary is inclusive)", () => {
    // 02:00 UTC = 21:00 EST the previous evening in New York.
    at("2026-01-16T02:00:00Z");
    expect(isWithinQuietHours("2125550100").blocked).toBe(true);
    // 01:59 UTC = 20:59 EST — still allowed.
    at("2026-01-16T01:59:00Z");
    expect(isWithinQuietHours("2125550100").blocked).toBe(false);
  });

  it("is DST-correct: the same UTC clock time flips across the EST/EDT change", () => {
    // 12:30 UTC is 07:30 EST in winter (blocked) but 08:30 EDT in summer (allowed).
    at("2026-01-15T12:30:00Z");
    expect(isWithinQuietHours("2125550100").blocked).toBe(true);
    at("2026-07-15T12:30:00Z");
    expect(isWithinQuietHours("2125550100").blocked).toBe(false);
  });

  it("honors Phoenix's no-DST rule against a DST-observing neighbor", () => {
    // 14:30 UTC in July: Denver = 08:30 MDT (allowed); Phoenix = 07:30 MST (blocked).
    at("2026-07-15T14:30:00Z");
    expect(isWithinQuietHours("7195550100").blocked).toBe(false); // Denver
    expect(isWithinQuietHours("4805550100").blocked).toBe(true); // Phoenix
  });

  it("prefers an explicit recipient zone over area-code inference", () => {
    // 15:00 UTC January: the 480 area code says Phoenix 08:00 (allowed at
    // exactly 8), but the lead's real zone is Los Angeles, 07:00 (blocked).
    at("2026-01-15T15:00:00Z");
    expect(isWithinQuietHours("4805550100").blocked).toBe(false);
    const explicit = isWithinQuietHours("4805550100", "America/Los_Angeles");
    expect(explicit.blocked).toBe(true);
    expect(explicit.zone).toBe("America/Los_Angeles");
  });

  it("falls back to America/New_York for an invalid IANA zone", () => {
    at("2026-01-15T15:00:00Z"); // NY 10:00 — allowed
    expect(isWithinQuietHours("2125550100", "Not/AZone").blocked).toBe(false);
  });
});

describe("isWithinQuietHoursForLead", () => {
  it("uses the lead's stored timezone when present, area code otherwise", () => {
    at("2026-01-15T15:00:00Z");
    // NY number, but the lead actually lives in LA (07:00 — blocked).
    const withZone = isWithinQuietHoursForLead({
      phone: "2125550100",
      timezone: "America/Los_Angeles",
    });
    expect(withZone.blocked).toBe(true);
    // No stored zone → NY inference (10:00 — allowed).
    expect(isWithinQuietHoursForLead({ phone: "2125550100", timezone: null }).blocked).toBe(false);
  });
});

describe("detectOptKeyword — CTIA STOP/START detection", () => {
  it("detects every STOP-class keyword case-insensitively with punctuation noise", () => {
    for (const raw of ["STOP", "stop", " Stop. ", "STOPALL", "Unsubscribe", "CANCEL", "end", "QUIT!", "optout", "Opt-Out"]) {
      expect(detectOptKeyword(raw), raw).toBe("opt_out");
    }
    // Normalization strips spaces, so "stop all" reads as STOPALL — an
    // opt-out. Better to over-honor a revocation than miss one.
    expect(detectOptKeyword("stop all")).toBe("opt_out");
  });

  it("detects START-class keywords", () => {
    for (const raw of ["START", "yes", "UNSTOP", "optin", "Opt-In"]) {
      expect(detectOptKeyword(raw), raw).toBe("opt_in");
    }
  });

  it("returns null for ordinary replies — including ones containing keywords", () => {
    expect(detectOptKeyword("Yes I want to sell the land, call me")).toBeNull();
    expect(detectOptKeyword("Please stop by tomorrow")).toBeNull();
    expect(detectOptKeyword("What's your offer?")).toBeNull();
    expect(detectOptKeyword("")).toBeNull();
  });
});

describe("checkTcpaConsentFromLead — the consent matrix", () => {
  it("blocks every channel when doNotContact is set (even with recorded consent)", () => {
    const result = checkTcpaConsentFromLead({ doNotContact: true, tcpaConsent: true });
    expect(result.blocked).toBe(true);
    expect(result.canEmail).toBe(false);
    expect(result.canSms).toBe(false);
    expect(result.canCall).toBe(false);
    expect(result.canDirectMail).toBe(false);
  });

  it("without consent: only direct mail is allowed (TCPA covers calls/SMS, CAN-SPAM email)", () => {
    const result = checkTcpaConsentFromLead({ doNotContact: false, tcpaConsent: false });
    expect(result.blocked).toBe(false);
    expect(result.canDirectMail).toBe(true);
    expect(result.canSms).toBe(false);
    expect(result.canCall).toBe(false);
    expect(result.canEmail).toBe(false);
  });

  it("with consent and no DNC flag: all channels open", () => {
    expect(checkTcpaConsentFromLead({ doNotContact: false, tcpaConsent: true })).toMatchObject({
      canEmail: true,
      canSms: true,
      canCall: true,
      canDirectMail: true,
      blocked: false,
    });
  });
});

describe("canSendViaChannel / requiresTcpaConsent", () => {
  const noConsent = { doNotContact: false, tcpaConsent: false };

  it("mirrors the consent matrix per channel with a reason on refusal", () => {
    expect(canSendViaChannel(noConsent, "direct_mail").allowed).toBe(true);
    for (const channel of ["sms", "phone", "email"] as const) {
      const result = canSendViaChannel(noConsent, channel);
      expect(result.allowed, channel).toBe(false);
      expect(result.reason, channel).toBeTruthy();
    }
  });

  it("flags exactly the regulated channels as consent-requiring", () => {
    expect(requiresTcpaConsent("sms")).toBe(true);
    expect(requiresTcpaConsent("phone")).toBe(true);
    expect(requiresTcpaConsent("email")).toBe(false);
    expect(requiresTcpaConsent("direct_mail")).toBe(false);
  });
});
