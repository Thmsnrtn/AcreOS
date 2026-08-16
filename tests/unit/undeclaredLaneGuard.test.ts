/**
 * The undeclared-lane guard — "invert the default to refuse"
 * (founder ruling, 2026-08-16; enforcing the 2026-07-17 send-rail decision).
 *
 * `EmailOptions.purpose` is optional and the send path reads it as
 * `options.purpose ?? 'system'`, so OMITTING the field silently selected the
 * PLATFORM @acreos.io sender — the exact thing the 2026-07-17 decision forbids.
 * The founder rejected making the field required (62 call sites answering the
 * compiler at once would stamp `system` everywhere and launder accidents into
 * decisions), and ruled the DEFAULT inverted instead: an UNDECLARED send whose
 * recipient resolves to a counterparty record REFUSES.
 *
 * This file pins the whole shape of that guard, including the parts that are
 * easy to get wrong in the "safe" direction:
 *   - it is SAME-ORG scoped, so a person who is an AcreOS user AND a lead in
 *     someone ELSE's org still gets their mail;
 *   - an EXPLICIT declaration is honoured as-is and skips the lookup entirely
 *     (which is also the cost gradient — labelling is the cheap path);
 *   - it FAILS OPEN on an infrastructure error, unlike the autopilot hand's
 *     guard on the same resolver, and only a POSITIVE MATCH fails closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── The resolver under control ──────────────────────────────────────────────
// The guard must reuse the ONE counterparty resolver (shared with the autopilot
// hand), so this test mocks that module rather than a second implementation.
// If the guard ever grows its own resolver, these mocks stop being consulted
// and the same-org / fail-open cases below go red.
const counterpartyMatch = vi.hoisted(() => vi.fn());
vi.mock("../../server/services/autopilot/hands/counterpartyMatch", () => ({
  counterpartyMatch,
}));

// An org's own people are the `system` lane by definition, so the guard checks
// membership before refusing. Mocked to "nobody is a member" by DEFAULT, which
// is the state in which a same-org counterparty hit genuinely refuses — the
// case most of this file is about. The membership exclusion gets its own
// describe block at the bottom, so this default cannot become the reason that
// branch stops being covered.
vi.mock("../../server/services/orgMemberAddresses", () => ({
  orgMemberAddresses: vi.fn(async () => new Set<string>()),
}));

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

// `allowed` is a COPY, and that matters. performSend does
// `toAddresses.length = 0; toAddresses.push(...allowed)`, so a mock that hands
// back the caller's own array empties the recipient list mid-send — the guard
// then iterates zero addresses and can never fire. The real filterSuppressed
// always builds a fresh array (Array.from(new Set(...)).filter(...)), so the
// copy here is the faithful stand-in, not a workaround. The vacuity control in
// (f) asserts the recipient actually reaches SES precisely so this class of
// silently-empty harness cannot come back.
vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn(async (addrs: string[]) => ({ allowed: [...addrs], suppressed: [] })),
  isSuppressed: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../server/services/emailWarmup", () => ({
  reserveSend: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn().mockResolvedValue("tok"),
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://acreos.io/u/tok"),
}));

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("../../server/utils/logger", () => ({ logger: loggerMock }));

import { emailService } from "../../server/services/emailService";

const SENDING_ORG = 42;
const OTHER_ORG = 99;

const BASE = {
  to: "person@example.com",
  subject: "About your parcel",
  html: "<p>Hi</p>",
};

/** A hit shaped exactly like `CounterpartyHit` from the shared resolver. */
const hit = (organizationId: number | null) => ({
  kind: "lead / seller / buyer / borrower (leads)",
  organizationId,
  recordId: 41,
});

beforeEach(() => {
  vi.clearAllMocks();
  sesSend.mockResolvedValue({ MessageId: "m-1" });
  getOrganizationIntegration.mockResolvedValue(undefined);
  getVerifiedEmailDomains.mockResolvedValue([]);
  getIdentityForSend.mockResolvedValue(null);
  // Default: the address is nobody's counterparty. Each test arms what it needs.
  counterpartyMatch.mockResolvedValue(null);
  process.env.AWS_ACCESS_KEY_ID = "platform-key";
  process.env.AWS_SECRET_ACCESS_KEY = "platform-secret";
  process.env.AWS_SES_FROM_EMAIL = "no-reply@acreos.io";
});

// ── (f) VACUITY GUARD — runs first, on purpose ──────────────────────────────
// Every "refused" assertion below is only meaningful if this harness can
// produce a SUCCESSFUL send at all. Without this control, a broken mock (bad
// credentials, an unmocked dependency throwing) would make the refusal tests
// pass for entirely the wrong reason and the guard could be a no-op.
describe("(f) vacuity guard — the harness can send", () => {
  it("a plain undeclared send with no counterparty match reaches SES and succeeds", async () => {
    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("m-1");
    expect(sesSend).toHaveBeenCalled();
  });

  it("...and SES is actually addressed to the recipient", async () => {
    // "success" alone is not enough. An earlier draft of this harness returned
    // the caller's own array from filterSuppressed, which performSend then
    // emptied — every send "succeeded" with ZERO destinations, so the guard had
    // no address to check and every refusal test failed for a reason that had
    // nothing to do with the guard. Asserting the destination is what makes the
    // rest of this file trustworthy.
    await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    const command = sesSend.mock.calls[0][0] as { input: { Destinations: string[] } };
    expect(command.input.Destinations).toEqual([BASE.to]);
  });

  it("...and the guard consulted the shared resolver for that recipient", async () => {
    await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(counterpartyMatch).toHaveBeenCalledWith(BASE.to);
  });
});

// ── (a) undeclared + same-org counterparty → REFUSE ─────────────────────────
describe("(a) undeclared send to THIS org's counterparty is refused", () => {
  it("refuses, and SES is never reached", async () => {
    counterpartyMatch.mockResolvedValue(hit(SENDING_ORG));
    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(result.success).toBe(false);
    expect(sesSend).not.toHaveBeenCalled();
  });

  it("returns the same refusal SHAPE as the explicit-counterparty guard", async () => {
    counterpartyMatch.mockResolvedValue(hit(SENDING_ORG));
    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(result).toMatchObject({
      success: false,
      errorType: "configuration_error",
      attempts: 0,
      retryable: false,
    });
  });

  it("the message names the reason and is actionable for a DEVELOPER", async () => {
    counterpartyMatch.mockResolvedValue(hit(SENDING_ORG));
    const { error } = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    const msg = String(error);
    // which record, specifically enough to go look at it
    expect(msg).toMatch(/lead/i);
    expect(msg).toContain("#41");
    expect(msg).toContain(`org ${SENDING_ORG}`);
    expect(msg).toContain(BASE.to);
    // both remedies, named as call-site edits
    expect(msg).toContain("purpose: 'counterparty'");
    expect(msg).toContain("purpose: 'system'");
    expect(msg).toMatch(/connect the org's own email identity/i);
    // the rule being enforced, by date
    expect(msg).toContain("2026-07-17");
    expect(msg).toContain("2026-08-16");
    // and an unambiguous statement of the outcome
    expect(msg).toMatch(/nothing was sent/i);
  });

  it("logs the refusal at warn with the matched record — not silently dropped", async () => {
    counterpartyMatch.mockResolvedValue(hit(SENDING_ORG));
    await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    const call = loggerMock.warn.mock.calls.find(([m]) =>
      String(m).includes("undeclared send refused"),
    );
    expect(call, "expected a warn-level log naming the refusal").toBeTruthy();
    expect((call![1] as any).metadata).toMatchObject({
      marker: "undeclared_lane_guard_refusal",
      matchedRecordId: 41,
      counterpartyOrganizationId: SENDING_ORG,
    });
  });
});

// ── (b) undeclared + DIFFERENT-org match → SEND ─────────────────────────────
// The false-positive case that would break real customer mail. One person can
// be an AcreOS user AND appear in some other org's leads table; that match is
// not this send's counterparty.
describe("(b) a match in a DIFFERENT org does not block the send", () => {
  it("sends when the matched record belongs to another org", async () => {
    counterpartyMatch.mockResolvedValue(hit(OTHER_ORG));
    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(result.success).toBe(true);
    expect(sesSend).toHaveBeenCalled();
  });

  it("sends when the matched record carries no org at all", async () => {
    counterpartyMatch.mockResolvedValue(hit(null));
    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(result.success).toBe(true);
    expect(sesSend).toHaveBeenCalled();
  });
});

// ── (c) undeclared + no match → unchanged ───────────────────────────────────
describe("(c) undeclared send to nobody's counterparty is unchanged", () => {
  it("sends as system on the platform lane", async () => {
    counterpartyMatch.mockResolvedValue(null);
    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(result.success).toBe(true);
    expect(counterpartyMatch).toHaveBeenCalledWith(BASE.to);
    expect(sesSend).toHaveBeenCalled();
  });

  it("a send with no organizationId is treated as NO MATCH and never pays for the lookup", async () => {
    counterpartyMatch.mockResolvedValue(hit(SENDING_ORG));
    const result = await emailService.sendEmail({ ...BASE });
    expect(result.success).toBe(true);
    // A hit could not be attributed to this send's tenant, so it could never
    // refuse — the guard skips the round-trip instead of discarding the answer.
    expect(counterpartyMatch).not.toHaveBeenCalled();
  });
});

// ── (d) an EXPLICIT declaration is a decision of record ─────────────────────
describe("(d) an explicit purpose is never overridden by this guard", () => {
  it("purpose: 'system' + a same-org match still SENDS", async () => {
    counterpartyMatch.mockResolvedValue(hit(SENDING_ORG));
    const result = await emailService.sendEmail({
      ...BASE,
      organizationId: SENDING_ORG,
      purpose: "system",
    });
    expect(result.success).toBe(true);
    expect(sesSend).toHaveBeenCalled();
  });

  it("purpose: 'system' skips the lookup entirely — declaring the lane is the CHEAP path", async () => {
    counterpartyMatch.mockResolvedValue(hit(SENDING_ORG));
    await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG, purpose: "system" });
    expect(counterpartyMatch).not.toHaveBeenCalled();
  });

  it("purpose: 'counterparty' skips the lookup too — the existing guard already owns that lane", async () => {
    getIdentityForSend.mockResolvedValue({ fromAddress: "mail@customer-domain.com" });
    counterpartyMatch.mockResolvedValue(hit(SENDING_ORG));
    const result = await emailService.sendEmail({
      ...BASE,
      organizationId: SENDING_ORG,
      purpose: "counterparty",
    });
    expect(result.success).toBe(true);
    expect(counterpartyMatch).not.toHaveBeenCalled();
  });
});

// ── (e) the guard FAILS OPEN on an infrastructure error ─────────────────────
// Deliberately the opposite of the autopilot hand's guard on the same resolver.
// That one sits on a single founder-tapped action; this one sits on every send
// including password resets and dunning, so failing closed would turn a
// database blip into a total system-mail outage.
describe("(e) an errored lookup fails OPEN, loudly", () => {
  it("still sends when the counterparty lookup throws", async () => {
    counterpartyMatch.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(result.success).toBe(true);
    expect(sesSend).toHaveBeenCalled();
  });

  it("logs the failure at ERROR with a distinctive marker — fail-open is never silent", async () => {
    const boom = new Error("connection terminated unexpectedly");
    counterpartyMatch.mockRejectedValue(boom);
    await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    const call = loggerMock.error.mock.calls.find(
      ([, , ctx]) => (ctx as any)?.metadata?.marker === "undeclared_lane_guard_fail_open",
    );
    expect(call, "expected an error-level log carrying the fail-open marker").toBeTruthy();
    expect(String(call![0])).toMatch(/FAILING OPEN/);
    expect(call![1]).toBe(boom);
  });

  it("only an INFRASTRUCTURE error fails open — a positive match still fails closed", async () => {
    // The two branches share one guard; this pins that the catch cannot swallow
    // the refusal path with it.
    counterpartyMatch.mockRejectedValueOnce(new Error("db down"));
    const openResult = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(openResult.success).toBe(true);

    counterpartyMatch.mockResolvedValue(hit(SENDING_ORG));
    const closedResult = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(closedResult.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) THE FALSE POSITIVE THE FIRST CUT SHIPPED WITH.
//
// The guard originally refused on any same-org counterparty hit, with no
// membership check at all — treating "is a lead" and "is an AcreOS user" as
// mutually exclusive when they are not. That is not theoretical:
//   * growthAutomation's six sends all target getOwnerEmail(org.id), which
//     reads teamMembers.email WHERE role='owner';
//   * routes-campaigns' TEST-SEND mails the logged-in user, and adding
//     yourself as a lead is the ORDINARY way to test campaign rendering — so
//     the guard broke the one feature whose entire job is "email this to me".
//
// Caught by an adversarial verifier, not by the build. These pin the fix.
// ─────────────────────────────────────────────────────────────────────────────
describe("(g) an org's own people are the `system` lane, even when also a lead", () => {
  it("SENDS to a same-org counterparty who is also a member of that org", async () => {
    const { orgMemberAddresses } = await import("../../server/services/orgMemberAddresses");
    counterpartyMatch.mockResolvedValue({
      kind: "lead / seller / buyer / borrower (leads)",
      organizationId: SENDING_ORG,
      recordId: 1,
    });
    vi.mocked(orgMemberAddresses).mockResolvedValueOnce(new Set([BASE.to.toLowerCase()]));

    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(
      result.success,
      "refused a customer's own owner/user because they are also a lead in their own org",
    ).toBe(true);
    expect(sesSend).toHaveBeenCalled();
  });

  it("and still refuses the same hit when the recipient is NOT a member", async () => {
    // The other half: without this, mocking membership to "everyone" would make
    // the test above pass while disarming the guard entirely.
    const { orgMemberAddresses } = await import("../../server/services/orgMemberAddresses");
    counterpartyMatch.mockResolvedValue({
      kind: "lead / seller / buyer / borrower (leads)",
      organizationId: SENDING_ORG,
      recordId: 1,
    });
    vi.mocked(orgMemberAddresses).mockResolvedValueOnce(new Set<string>());

    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(result.success, "the guard stopped refusing a genuine counterparty").toBe(false);
    expect(sesSend).not.toHaveBeenCalled();
  });

  it("a failing membership lookup fails OPEN, like every other guard error", async () => {
    // "Membership unknown" must not refuse: unknown is exactly the state that
    // produces the false positive this block exists to prevent.
    const { orgMemberAddresses } = await import("../../server/services/orgMemberAddresses");
    counterpartyMatch.mockResolvedValue({
      kind: "lead / seller / buyer / borrower (leads)",
      organizationId: SENDING_ORG,
      recordId: 1,
    });
    vi.mocked(orgMemberAddresses).mockRejectedValueOnce(new Error("members table unreachable"));

    const result = await emailService.sendEmail({ ...BASE, organizationId: SENDING_ORG });
    expect(result.success, "a membership lookup failure must not block mail").toBe(true);
  });
});
