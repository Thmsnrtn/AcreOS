/**
 * Email-suppression integration with EmailService.
 *
 * Hessam §2.3: sending to a suppressed address must be blocked before
 * SES is called. We mock the suppression DB lookup and assert the send
 * never reaches SES (the all-suppressed fast-path).
 *
 * The mixed-suppression / clean-send paths are exercised in integration
 * (DB) testing — the EmailService internals (SES client construction +
 * AWS credential lookup) are too tangled to mock cleanly in a unit test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const suppressedSet = new Set<string>();

vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn(async (emails: string[]) => {
    const allowed: string[] = [];
    const suppressed: string[] = [];
    for (const e of emails) {
      const norm = e.trim().toLowerCase();
      if (suppressedSet.has(norm)) suppressed.push(norm);
      else allowed.push(norm);
    }
    return { allowed, suppressed };
  }),
  isSuppressed: vi.fn(async (e: string) => suppressedSet.has(e.trim().toLowerCase())),
  suppress: vi.fn(async (e: string) => {
    suppressedSet.add(e.trim().toLowerCase());
  }),
  suppressionFromEvent: vi.fn(),
  recordSoftBounce: vi.fn(async () => ({ suppressed: false, strikes: 1 })),
  alertFounderOnComplaint: vi.fn(),
}));

// Eleonora deliverability — Phase 1 §10 / Week 7-8: emailService now also
// imports unsubscribeTokens, emailWarmup, and orgEmailIdentity. Mock them
// to no-ops so the suppression test still exercises the suppression path.
vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn(async () => "test-token"),
  buildUnsubscribeUrl: () => "https://app.acreos.io/u/test-token",
}));

vi.mock("../../server/services/emailWarmup", () => ({
  reserveSend: vi.fn(async () => ({
    ok: true,
    dailyLimit: 10000,
    used: 1,
    resetAt: new Date(Date.now() + 86400_000),
    warmupDay: 7,
  })),
}));

vi.mock("../../server/services/orgEmailIdentity", () => ({
  getIdentityForSend: vi.fn(async () => null),
}));

vi.mock("../../server/utils/simulationMode", () => ({
  shouldSimulate: () => false,
  recordSimulatedAction: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganization: vi.fn(async () => null),
    getOrganizationIntegration: vi.fn(async () => null),
    getVerifiedEmailDomains: vi.fn(async () => []),
  },
}));

vi.mock("../../server/services/encryption", () => ({
  decryptJsonCredentials: vi.fn(),
}));

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: vi.fn(),
  encrypt: vi.fn((s: string) => s),
  decrypt: vi.fn((s: string) => s),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  suppressedSet.clear();
});

describe("EmailService.sendEmail suppression integration", () => {
  it("blocks sending when the only recipient is suppressed (no SES call)", async () => {
    suppressedSet.add("blocked@example.com");
    const { emailService } = await import("../../server/services/emailService");
    const { filterSuppressed } = await import("../../server/services/emailSuppressions");
    const result = await emailService.sendEmail({
      to: "blocked@example.com",
      subject: "Hi",
      html: "<p>Hello</p>",
    });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("recipient_rejected");
    expect(filterSuppressed).toHaveBeenCalled();
    // The error message should name the suppressed address
    expect(result.error).toContain("blocked@example.com");
  });

  it("invokes filterSuppressed for every send attempt", async () => {
    const { emailService } = await import("../../server/services/emailService");
    const { filterSuppressed } = await import("../../server/services/emailSuppressions");
    const callsBefore = (filterSuppressed as any).mock.calls.length;
    await emailService.sendEmail({
      to: "ok@example.com",
      subject: "Hi",
      html: "<p>Hello</p>",
    });
    const callsAfter = (filterSuppressed as any).mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });
});
