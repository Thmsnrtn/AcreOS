/**
 * The counterparty email lane refuses an owner who opted out platform-wide
 * (W5a) — before warm-up, identity resolution or SES. A transactional
 * counterparty notice (a periodic statement on an existing loan) is servicing,
 * not outreach, and is not stopped by the opt-out; system mail (AcreOS to its
 * own users) is not checked against it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const suppressedSet = new Set<string>();
const ownerRefusal = vi.fn(async (_c: string, ids: { email?: string }) =>
  (ids.email ?? "").toLowerCase() === "owner@example.com" ? "Not sent: this owner asked AcreOS to stop all contact (platform-wide opt-out)." : null,
);
vi.mock("../../server/services/trust/ownerSuppression", () => ({ ownerContactRefusal: ownerRefusal }));

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
  ownerRefusal.mockClear();
});

describe("emailService: the owner opt-out on the counterparty lane", () => {
  it("refuses a counterparty send to a suppressed owner, before anything else", async () => {
    const { emailService } = await import("../../server/services/emailService");
    const r = await emailService.sendEmail({ to: "owner@example.com", subject: "Offer", html: "<p>Hi</p>", purpose: "counterparty", organizationId: 7 });
    expect(r.success).toBe(false);
    expect(r.errorType).toBe("recipient_rejected");
    expect(r.error).toMatch(/stop all contact/);
    expect(ownerRefusal).toHaveBeenCalledWith("email", { email: "owner@example.com" });
  });

  it("does not stop a transactional counterparty notice (servicing an existing loan)", async () => {
    const { emailService } = await import("../../server/services/emailService");
    const r = await emailService.sendEmail({ to: "owner@example.com", subject: "Statement", html: "<p>Hi</p>", purpose: "counterparty", transactional: true, organizationId: 7 });
    expect(r.error ?? "").not.toMatch(/stop all contact/);
    expect(ownerRefusal).not.toHaveBeenCalled();
  });

  it("drops only the suppressed recipient from a mixed counterparty send", async () => {
    const { emailService } = await import("../../server/services/emailService");
    const r = await emailService.sendEmail({ to: ["owner@example.com", "other@example.com"], subject: "Offer", html: "<p>Hi</p>", purpose: "counterparty", organizationId: 7 });
    expect(ownerRefusal).toHaveBeenCalledTimes(2);
    // The send proceeds for the other recipient (and fails later only for want of the org's identity in this test).
    expect(r.error ?? "").not.toMatch(/stop all contact/);
  });
});
