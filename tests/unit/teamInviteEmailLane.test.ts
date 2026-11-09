/**
 * A team invitation is emailed on the SYSTEM lane, and the result is honest.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Creating an invite sent nothing. Now it is emailed through the real
 * emailService (SES mocked at the transport), and every outcome is a status the
 * UI can word: sent / not_configured / suppressed / failed. Nothing is reported
 * "sent" unless the transport accepted it.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/services/trust/ownerSuppression", async () => (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);

const sesSend = vi.fn();
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class { send(...a: unknown[]) { return sesSend(...a); } },
  SendEmailCommand: class { constructor(public input: unknown) {} },
  SendRawEmailCommand: class { constructor(public input: unknown) {} },
  GetSendQuotaCommand: class { constructor(public input: unknown) {} },
}));
vi.mock("../../server/storage", () => ({
  storage: new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "getOrganizationIntegration") return vi.fn().mockResolvedValue(undefined);
      if (prop === "getVerifiedEmailDomains") return vi.fn().mockResolvedValue([]);
      return vi.fn().mockResolvedValue(undefined);
    },
  }),
  db: {},
}));
vi.mock("../../server/services/orgEmailIdentity", () => ({ getIdentityForSend: vi.fn().mockResolvedValue(null) }));
vi.mock("../../server/services/fieldEncryption", () => ({ decryptJsonCredentials: vi.fn() }));
const filterSuppressed = vi.fn();
vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: (a: string[]) => filterSuppressed(a),
  isSuppressed: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../server/services/emailWarmup", () => ({ reserveSend: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn().mockResolvedValue("tok"),
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://acreos.io/u/tok"),
}));
const specs = vi.hoisted(() => [] as Array<{ actionKind: string; idempotencyKey: string; organizationId: number }>);
vi.mock("../../server/services/actions/outwardAction", () => ({
  withOutwardAction: async (spec: any, run: () => Promise<any>) => {
    specs.push(spec);
    const out = await run();
    if (out.status !== "succeeded") throw out.error;
    return out.result;
  },
}));
const logged = vi.hoisted(() => [] as unknown[]);
vi.mock("../../server/utils/logger", () => {
  const rec = (...a: unknown[]) => void logged.push(a);
  return { logger: { warn: rec, error: rec, info: rec, debug: rec } };
});

import { sendTeamInviteEmails } from "../../server/services/teamInviteEmail";

const TOKEN = "SECRETtokenVALUE0123456789abcdefgh";
const ORG = { id: 42, name: "Acme Land", settings: {} };
const target = (over: Record<string, unknown> = {}) => ({
  invitationId: 11,
  email: "invitee@example.com",
  roleLabel: "Member",
  token: TOKEN,
  expiresAt: new Date("2030-01-15T00:00:00Z"),
  ...over,
});
const run = (invites = [target()], org: any = ORG) =>
  sendTeamInviteEmails({ organization: org, inviterName: "Pat Owner", invites });
const rawSent = () => Buffer.from((sesSend.mock.calls[0][0] as any).input.RawMessage.Data).toString("utf8");

const saved = { ...process.env };
beforeEach(() => {
  sesSend.mockReset().mockResolvedValue({ MessageId: "m-1" });
  filterSuppressed.mockReset().mockImplementation(async (a: string[]) => ({ allowed: a, suppressed: [] }));
  specs.length = 0;
  logged.length = 0;
  process.env.AWS_ACCESS_KEY_ID = "platform-key";
  process.env.AWS_SECRET_ACCESS_KEY = "platform-secret";
  process.env.AWS_SES_FROM_EMAIL = "no-reply@acreos.io";
  process.env.APP_URL = "https://app.example.test/";
  delete process.env.SIMULATION_MODE;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("lane and content", () => {
  it("sends on the system lane with a durable idempotency key, and reports sent", async () => {
    const out = await run();
    expect(out).toEqual([{ invitationId: 11, status: "sent" }]);
    expect(sesSend).toHaveBeenCalledTimes(1);
    expect(specs).toHaveLength(1);
    expect(specs[0].actionKind).toBe("email.system");
    expect(specs[0].organizationId).toBe(42);
    expect(specs[0].idempotencyKey).toMatch(/^team-invite:11:[0-9a-f]{16}$/);
    expect(specs[0].idempotencyKey).not.toContain(TOKEN);
  });

  it("carries the link from server config, no marketing footer, and the inviter and role", async () => {
    await run();
    const raw = rawSent();
    expect(raw).toContain(`https://app.example.test/auth?invite=${TOKEN}`);
    expect(raw).not.toMatch(/Unsubscribe<\/a> from marketing/);
    expect(raw).toContain("Pat Owner");
    expect(raw).toContain("expires on January 15, 2030");
  });

  it("a replacement link says it replaces the earlier one", async () => {
    await run([target({ reissued: true })]);
    expect(rawSent()).toMatch(/replaces any invitation link/);
  });

  it("escapes a hostile organization name in the HTML body", async () => {
    await run([target()], { ...ORG, name: `<a href="https://evil.test">x</a>` });
    const html = rawSent().split("Content-Type: text/html")[1] ?? "";
    expect(html, "vacuity: no HTML part found").toContain("Accept the invitation");
    expect(html).not.toContain(`<a href="https://evil.test">`);
    expect(html).toContain("&lt;a href=");
  });

  it("never logs the token", async () => {
    sesSend.mockRejectedValue(new Error("boom"));
    await run();
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
  });
});

describe("honest outcomes", () => {
  it("no sender configured: not_configured, nothing sent", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SES_FROM_EMAIL;
    expect(await run()).toEqual([{ invitationId: 11, status: "not_configured" }]);
    expect(sesSend).not.toHaveBeenCalled();
  });

  it("simulation mode: not_configured, nothing sent", async () => {
    process.env.SIMULATION_MODE = "true";
    expect(await run()).toEqual([{ invitationId: 11, status: "not_configured" }]);
    expect(sesSend).not.toHaveBeenCalled();
  });

  it("suppressed address: suppressed, nothing sent for it; others still go", async () => {
    filterSuppressed.mockImplementation(async (a: string[]) => ({
      allowed: a.filter((x) => x !== "bounced@example.com"),
      suppressed: a.filter((x) => x === "bounced@example.com"),
    }));
    const out = await run([target({ invitationId: 1, email: "bounced@example.com" }), target({ invitationId: 2 })]);
    expect(out).toEqual([
      { invitationId: 1, status: "suppressed" },
      { invitationId: 2, status: "sent" },
    ]);
    expect(sesSend).toHaveBeenCalledTimes(1);
  });

  it("transport rejection: failed", async () => {
    sesSend.mockRejectedValue(Object.assign(new Error("Email address is not verified"), { name: "MessageRejected" }));
    expect(await run()).toEqual([{ invitationId: 11, status: "failed" }]);
  });

  it("never throws, even when the suppression lookup throws", async () => {
    // First call is the invite pre-check; the transport's own lookup then answers.
    filterSuppressed.mockRejectedValueOnce(new Error("db down"));
    await expect(run()).resolves.toEqual([{ invitationId: 11, status: "sent" }]);
  });
});
