/**
 * Counterparty email enforcement (founder decision, 2026-07-17).
 *
 * Pins the two-lane contract in emailService.sendEmail:
 *   - purpose "counterparty" (deal mail to a customer's sellers/buyers/
 *     borrowers) REQUIRES the org's own identity — BYO SES creds or a
 *     verified sending domain. No identity → honest refusal, and the SES
 *     client is NEVER constructed. There is no silent @acreos.io fallback.
 *   - default/system sends keep the existing platform-fallback behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sesSend = vi.fn();
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send(...args: unknown[]) {
      return sesSend(...args);
    }
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
  SendRawEmailCommand: class {
    constructor(public input: unknown) {}
  },
  GetSendQuotaCommand: class {
    constructor(public input: unknown) {}
  },
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
        // Every other storage call the service makes along the send path
        // (logs, suppression bookkeeping) is a benign no-op here.
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

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: vi.fn().mockReturnValue({
    accessKeyId: "org-key",
    secretAccessKey: "org-secret",
    fromEmail: "deals@customer-domain.com",
  }),
}));

vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn(async (addrs: string[]) => ({ allowed: addrs, suppressed: [] })),
  isSuppressed: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../server/services/emailWarmup", () => ({
  reserveSend: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn().mockResolvedValue("tok"),
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://acreos.io/u/tok"),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { emailService } from "../../server/services/emailService";

const BASE = {
  to: "seller@example.com",
  subject: "About your parcel",
  html: "<p>Hi</p>",
};

beforeEach(() => {
  sesSend.mockReset().mockResolvedValue({ MessageId: "m-1" });
  getOrganizationIntegration.mockReset().mockResolvedValue(undefined);
  getVerifiedEmailDomains.mockReset().mockResolvedValue([]);
  getIdentityForSend.mockReset().mockResolvedValue(null);
  process.env.AWS_ACCESS_KEY_ID = "platform-key";
  process.env.AWS_SECRET_ACCESS_KEY = "platform-secret";
  process.env.AWS_SES_FROM_EMAIL = "no-reply@acreos.io";
});

describe("counterparty email enforcement", () => {
  it("refuses counterparty mail when the org has no connected identity — SES never called", async () => {
    const result = await emailService.sendEmail({
      ...BASE,
      organizationId: 42,
      purpose: "counterparty",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/connect your email|No connected email identity/i);
    expect(result.retryable).toBe(false);
    expect(sesSend).not.toHaveBeenCalled();
  });

  it("refuses counterparty mail with no organizationId at all", async () => {
    const result = await emailService.sendEmail({ ...BASE, purpose: "counterparty" });
    expect(result.success).toBe(false);
    expect(sesSend).not.toHaveBeenCalled();
  });

  it("allows counterparty mail when the org has BYO SES credentials", async () => {
    getOrganizationIntegration.mockResolvedValue({
      isEnabled: true,
      credentials: { encrypted: "blob" },
    });
    const result = await emailService.sendEmail({
      ...BASE,
      organizationId: 42,
      purpose: "counterparty",
    });
    expect(result.success).toBe(true);
    expect(sesSend).toHaveBeenCalled();
  });

  it("allows counterparty mail when the org has a verified sending identity (platform creds, their domain)", async () => {
    getIdentityForSend.mockResolvedValue({ fromAddress: "mail@customer-domain.com" });
    const result = await emailService.sendEmail({
      ...BASE,
      organizationId: 42,
      purpose: "counterparty",
    });
    expect(result.success).toBe(true);
    expect(sesSend).toHaveBeenCalled();
  });

  it("system mail (default purpose) keeps the platform fallback", async () => {
    const result = await emailService.sendEmail({ ...BASE, organizationId: 42 });
    expect(result.success).toBe(true);
    expect(sesSend).toHaveBeenCalled();
  });
});
