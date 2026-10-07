/**
 * The campaign pre-flight and the transport agree about counterparty identity.
 *
 * `send-email` refuses a whole campaign up front when
 * `counterpartyEmailIdentityStatus(org).canSend` is false, instead of charging,
 * looping and reporting a send the transport then refuses message by message.
 * That is only honest if the pre-flight answers EXACTLY what the transport's
 * counterparty guard answers. Both now read one resolver; this file pins the
 * equivalence behaviourally, per identity state, against the real
 * `emailService.sendEmail` — so a second copy of the rule that drifts goes red.
 *
 * It also pins `ownSesCredentials`, which decides that AcreOS charges nothing
 * for a send carried on the customer's own AWS account.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sentRaw: string[] = [];
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    async send(cmd: any) {
      if (cmd?.input?.RawMessage?.Data) sentRaw.push(Buffer.from(cmd.input.RawMessage.Data).toString("utf8"));
      return { MessageId: "m-1" };
    }
  },
  SendEmailCommand: class { constructor(public input: unknown) {} },
  SendRawEmailCommand: class { constructor(public input: unknown) {} },
  GetSendQuotaCommand: class { constructor(public input: unknown) {} },
}));

const getOrganizationIntegration = vi.fn();
const getVerifiedEmailDomains = vi.fn();
vi.mock("../../server/storage", () => ({
  storage: new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "getOrganization") return async () => ({ id: 42, name: "Brazos Land Partners" });
      if (prop === "getOrganizationIntegration") return getOrganizationIntegration;
      if (prop === "getVerifiedEmailDomains") return getVerifiedEmailDomains;
      return vi.fn().mockResolvedValue(undefined);
    },
  }),
  db: {},
}));
const getIdentityForSend = vi.fn();
vi.mock("../../server/services/orgEmailIdentity", () => ({
  getIdentityForSend: (orgId: number) => getIdentityForSend(orgId),
}));
const decrypted = { value: {} as Record<string, string> };
vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: () => decrypted.value,
}));
vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn(async (addrs: string[]) => ({ allowed: addrs, suppressed: [] })),
  isSuppressed: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../server/services/emailWarmup", () => ({ reserveSend: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn().mockResolvedValue("tok"),
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://example.test/u/tok"),
}));
vi.mock("../../server/services/alertSpine", () => ({ raiseAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { emailService, counterpartyEmailIdentityStatus } from "../../server/services/emailService";

type State = { name: string; setup: () => void; canSend: boolean; ownSes: boolean };
const STATES: State[] = [
  { name: "no identity at all", setup: () => {}, canSend: false, ownSes: false },
  {
    name: "verified sending domain only",
    setup: () => getIdentityForSend.mockResolvedValue({ fromAddress: "mail@customer-domain.example" }),
    canSend: true,
    ownSes: false,
  },
  {
    name: "own SES keys with a verified sender",
    setup: () => {
      getOrganizationIntegration.mockResolvedValue({ isEnabled: true, credentials: { encrypted: "blob" } });
      decrypted.value = { accessKeyId: "k", secretAccessKey: "s", fromEmail: "deals@customer-domain.example" };
    },
    canSend: true,
    ownSes: true,
  },
  {
    name: "own SES keys with NO verified sender",
    setup: () => {
      getOrganizationIntegration.mockResolvedValue({ isEnabled: true, credentials: { encrypted: "blob" } });
      decrypted.value = { accessKeyId: "k", secretAccessKey: "s" };
    },
    canSend: false,
    ownSes: false,
  },
];

beforeEach(() => {
  sentRaw.length = 0;
  getOrganizationIntegration.mockReset().mockResolvedValue(undefined);
  getVerifiedEmailDomains.mockReset().mockResolvedValue([]);
  getIdentityForSend.mockReset().mockResolvedValue(null);
  decrypted.value = {};
  process.env.AWS_ACCESS_KEY_ID = "platform-key";
  process.env.AWS_SECRET_ACCESS_KEY = "platform-secret";
  process.env.AWS_SES_FROM_EMAIL = "no-reply@acreos.io";
});

describe("pre-flight == transport, per identity state", () => {
  it.each(STATES)("$name", async (st) => {
    st.setup();
    const pre = await counterpartyEmailIdentityStatus(42);
    const sent = await emailService.sendEmail({
      to: "seller@example.com",
      subject: "About your parcel",
      html: "<p>Hi</p>",
      organizationId: 42,
      purpose: "counterparty",
    });
    expect(pre.canSend).toBe(st.canSend);
    // The load-bearing equivalence: the route refuses up front exactly when
    // the transport would refuse every message.
    expect(sent.success).toBe(pre.canSend);
    expect(sentRaw.length > 0).toBe(pre.canSend);
    expect(pre.ownSesCredentials).toBe(st.ownSes);
  });
});
