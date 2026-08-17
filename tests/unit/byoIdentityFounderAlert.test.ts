/**
 * The BYO refusal stops being silent (founder decision 2026-08-17, OD-2).
 *
 * Counterparty mail must carry the CUSTOMER's own identity — their AWS SES
 * credentials or their verified sending domain — never the platform sender
 * (founder decision 2026-07-17). An org with neither is refused. That rule is
 * correct and this change does NOT weaken it.
 *
 * What it fixes is that the refusal was INVISIBLE. It emitted a `logger.info`
 * and returned an error string to a caller that, on the job paths, has nobody
 * reading it. Two of the five lanes behind the guard are REGULATED
 * correspondence — Reg Z §1026.41 periodic statements and statutory disclosures
 * — so an org that never connects an identity silently stops sending mail it is
 * legally obliged to send, and nothing anywhere says so.
 *
 * Nobody had measured how many orgs are affected, because no session has had a
 * DATABASE_URL. The alert IS that measurement, arriving one org at a time as
 * each is actually hit.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const raiseAlert = vi.fn().mockResolvedValue({
  paged: false,
  findingRecorded: true,
  systemAlertWritten: true,
});
vi.mock("../../server/services/alertSpine", () => ({
  raiseAlert: (input: unknown) => raiseAlert(input),
}));

const getOrganizationIntegration = vi.fn();
const getVerifiedEmailDomains = vi.fn();
vi.mock("../../server/storage", () => ({
  storage: new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "getOrganizationIntegration") return getOrganizationIntegration;
        if (prop === "getVerifiedEmailDomains") return getVerifiedEmailDomains;
        return vi.fn().mockResolvedValue(undefined);
      },
    },
  ),
  db: {},
}));

const getIdentityForSend = vi.fn();
vi.mock("../../server/services/orgEmailIdentity", () => ({
  getIdentityForSend: (orgId: number) => getIdentityForSend(orgId),
}));

vi.mock("../../server/services/autopilot/hands/counterpartyMatch", () => ({
  counterpartyMatch: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../server/services/orgMemberAddresses", () => ({
  orgMemberAddresses: vi.fn().mockResolvedValue(new Set<string>()),
}));
vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn().mockResolvedValue({ allowed: ["seller@example.com"], suppressed: [] }),
}));
vi.mock("../../server/services/emailWarmup", () => ({
  reserveSend: vi.fn().mockResolvedValue({
    ok: true,
    warmupDay: 1,
    dailyLimit: 1000,
    resetAt: new Date("2026-08-18T00:00:00Z"),
  }),
}));
vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn().mockReturnValue("tok"),
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://x/u"),
}));
vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: vi.fn().mockReturnValue({}),
}));
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    async send() {
      return { MessageId: "m-1" };
    }
  },
  SendEmailCommand: class {},
}));
// Inlined into the factory: `vi.mock` is hoisted above top-level consts, so a
// `const loggerMock` declared here would be read before initialization.
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { emailService } from "../../server/services/emailService";

const ORG = 42;
const BASE = {
  to: "seller@example.com",
  subject: "About your parcel",
  html: "<p>Hi</p>",
  purpose: "counterparty" as const,
};

/** No SES credentials and no verified domain — the refusing condition. */
function orgHasNoIdentity() {
  getOrganizationIntegration.mockResolvedValue(undefined);
  getVerifiedEmailDomains.mockResolvedValue([]);
  getIdentityForSend.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  raiseAlert.mockResolvedValue({
    paged: false,
    findingRecorded: true,
    systemAlertWritten: true,
  });
  orgHasNoIdentity();
});

describe("the refusal still refuses (the rule is not weakened)", () => {
  it("returns a configuration_error and does not send", async () => {
    // Asserted FIRST and separately: the point of the alert is visibility, and
    // an alert that came at the cost of letting the send through would be a
    // catastrophic reading of "make it visible".
    const result = await emailService.sendEmail({ ...BASE, organizationId: ORG });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("configuration_error");
    expect(result.error).toMatch(/no connected email identity/i);
  });
});

describe("the refusal raises a founder alert", () => {
  it("raises exactly one alert, naming the org", async () => {
    await emailService.sendEmail({ ...BASE, organizationId: ORG });
    expect(raiseAlert).toHaveBeenCalledTimes(1);
    const input = raiseAlert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.source).toBe("email_byo_identity");
    expect(input.subjectRef).toBe(`organization:${ORG}`);
    expect(String(input.detail)).toContain(String(ORG));
  });

  it("names the REGULATED exposure, so the severity is not read as trivial", () => {
    // A warning that says only "org can't send email" gets triaged as
    // onboarding noise. Reg Z §1026.41 statements have statutory deadlines.
    return emailService.sendEmail({ ...BASE, organizationId: ORG }).then(() => {
      const input = raiseAlert.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(String(input.detail)).toMatch(/Reg Z/);
      expect(String(input.citedReason)).toMatch(/1026\.41|2026-07-17/);
      expect(input.domain).toBe("compliance");
    });
  });

  it("is a warning, not a page", async () => {
    // A customer who has not finished onboarding is a configuration gap, not an
    // outage of ours. Paging at 3am for it teaches the founder to ignore the
    // pager, which is how a real page gets missed later.
    await emailService.sendEmail({ ...BASE, organizationId: ORG });
    const input = raiseAlert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.severity).toBe("warning");
  });

  it("dedupes per ORG, not per send", async () => {
    // The condition is "this organization cannot send counterparty mail at
    // all", which is true once however many sends hit it. Keyed per send, this
    // would alert once per dunning email.
    await emailService.sendEmail({ ...BASE, organizationId: ORG });
    await emailService.sendEmail({ ...BASE, organizationId: ORG, to: "other@example.com" });
    const keys = raiseAlert.mock.calls.map((c) => (c[0] as Record<string, unknown>).dedupeKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(`byo-identity-missing:org:${ORG}`);
  });

  it("gives DIFFERENT orgs different keys", async () => {
    // Per-org is the whole point: one org's alert must not suppress another's,
    // or the first affected customer hides every one after it.
    await emailService.sendEmail({ ...BASE, organizationId: ORG });
    await emailService.sendEmail({ ...BASE, organizationId: 77 });
    const keys = raiseAlert.mock.calls.map((c) => (c[0] as Record<string, unknown>).dedupeKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("alerting can never change the send decision", () => {
  it("still refuses when raiseAlert throws", async () => {
    // Fire-and-forget by design: the refusal is already decided when the alert
    // is raised. If a failing alert could turn a refusal into a send, the
    // observability would have become the vulnerability.
    raiseAlert.mockRejectedValue(new Error("alert spine down"));
    const result = await emailService.sendEmail({ ...BASE, organizationId: ORG });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("configuration_error");
  });

  it("does not alert when the org HAS an identity (vacuity guard)", async () => {
    // Without this, an alert fired unconditionally would satisfy every
    // assertion above while telling the founder nothing.
    getIdentityForSend.mockResolvedValue({ fromAddress: "hi@customer.com" });
    await emailService.sendEmail({ ...BASE, organizationId: ORG });
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("does not alert on SYSTEM mail, which legitimately uses the platform sender", async () => {
    // The guard only governs counterparty mail. Alerting on system mail would
    // fire for every trial notice to an org with no identity — noise that
    // buries the real signal.
    await emailService.sendEmail({ ...BASE, organizationId: ORG, purpose: "system" });
    expect(raiseAlert).not.toHaveBeenCalled();
  });
});
