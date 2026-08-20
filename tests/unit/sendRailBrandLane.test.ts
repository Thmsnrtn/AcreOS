/**
 * BYO send rails — AcreOS's identity may not appear on a customer's
 * counterparty mail (founder decision, 2026-07-17).
 *
 * THE DEFECT THIS GATE EXISTS FOR. `resolveCanSpamAddress(orgId)` was
 * LANE-BLIND. Its first line was:
 *
 *     if (CAN_SPAM_MAILING_ADDRESS) return { address: …, brandName: 'AcreOS' };
 *
 * which short-circuited BEFORE the org was consulted. So on any deployment
 * where the platform secret is set — i.e. production — EVERY campaign footer,
 * INCLUDING a customer's counterparty campaign to a landowner, carried
 * AcreOS's postal address under the literal brand 'AcreOS'. The same blindness
 * ran through the From: display name, which defaulted to
 * `AWS_SES_FROM_NAME || 'AcreOS'` even when the message rode the customer's
 * own verified sending domain. Both are the re-fronting the ruling bans, and
 * the footer one is additionally a CAN-SPAM §5(a)(5) violation: the statute
 * requires the SENDER's physical address, and the sender here is the customer.
 *
 * WHY THIS GATE IS BEHAVIOURAL, NOT A SOURCE SCAN. A scan for the string
 * 'AcreOS' in emailService.ts is decoration: the platform brand can re-enter
 * through `AWS_SES_FROM_NAME`, through a renamed constant, through a different
 * default expression, or through the footer's fallback branch — none of which
 * a symbol scan sees. So every case below runs the REAL `sendEmail` and reads
 * the REAL MIME message handed to SES, asserting on what a recipient would
 * actually receive.
 *
 * VACUITY GUARD FIRST. The opening case proves the platform address and brand
 * DO reach the wire on the system lane. Without it, every "counterparty mail
 * contains no AcreOS identity" assertion below would also pass against a
 * footer that stopped rendering, a MIME builder that returned "", or a mocked
 * SES that was never called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const PLATFORM_ADDRESS = "9 Platform Way, Suite 100, Austin, TX 78701";

// Hoisted so the env is in place BEFORE emailService is imported —
// CAN_SPAM_MAILING_ADDRESS is read once at module load.
vi.hoisted(() => {
  process.env.CAN_SPAM_MAILING_ADDRESS = "9 Platform Way, Suite 100, Austin, TX 78701";
  // Neutralise the unsubscribe strings so an "@acreos.io" match in the MIME
  // can only have come from the sender identity under test, never from
  // unrelated plumbing.
  process.env.UNSUBSCRIBE_MAILTO = "unsubscribe@example.test";
});

const sentRaw: string[] = [];
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    async send(cmd: any) {
      if (cmd?.input?.RawMessage?.Data) {
        sentRaw.push(Buffer.from(cmd.input.RawMessage.Data).toString("utf8"));
      }
      return { MessageId: "m-1" };
    }
  },
  SendEmailCommand: class { constructor(public input: unknown) {} },
  SendRawEmailCommand: class { constructor(public input: unknown) {} },
  GetSendQuotaCommand: class { constructor(public input: unknown) {} },
}));

const org = {
  value: null as null | { id: number; name?: string; taxAddress?: Record<string, string> },
};
const getOrganizationIntegration = vi.fn();
const getVerifiedEmailDomains = vi.fn();
vi.mock("../../server/storage", () => ({
  storage: new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "getOrganization") return async () => org.value;
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

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: vi.fn().mockReturnValue({
    accessKeyId: "org-key",
    secretAccessKey: "org-secret",
    fromEmail: "deals@customer-domain.example",
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
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://example.test/u/tok"),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { emailService } from "../../server/services/emailService";

const BASE = { to: "seller@example.com", subject: "About your parcel", html: "<p>Hi</p>" };

/**
 * The MIME multipart boundary is generated as `=_acreos_<ts>_<rand>` — an
 * internal delimiter no recipient ever sees and no mail client renders. It is
 * NOT sender identity, so it is stripped before the "no AcreOS anywhere"
 * assertions; leaving it in would make those assertions permanently red for a
 * reason unrelated to the defect. Everything else — headers, both body parts —
 * is left untouched, so a real leak into the From: line, the footer brand, or
 * the sender domain is still caught.
 */
function recipientVisibleWire(raw: string): string {
  const boundary = /boundary="([^"]+)"/.exec(raw)?.[1];
  expect(boundary, "no MIME boundary found — the message shape changed").toBeTruthy();
  return raw.split(boundary!).join("<boundary>");
}

/** The org has BOTH a verified sending domain and its own postal address. */
function orgFullyOnItsOwnRails() {
  org.value = {
    id: 42,
    name: "Brazos Land Partners",
    taxAddress: { line1: "77 Ranch Rd", city: "Llano", state: "TX", zip: "78643" },
  };
  getIdentityForSend.mockResolvedValue({ fromAddress: "mail@customer-domain.example" });
}

beforeEach(() => {
  sentRaw.length = 0;
  org.value = null;
  getOrganizationIntegration.mockReset().mockResolvedValue(undefined);
  getVerifiedEmailDomains.mockReset().mockResolvedValue([]);
  getIdentityForSend.mockReset().mockResolvedValue(null);
  process.env.AWS_ACCESS_KEY_ID = "platform-key";
  process.env.AWS_SECRET_ACCESS_KEY = "platform-secret";
  process.env.AWS_SES_FROM_EMAIL = "no-reply@acreos.io";
  process.env.AWS_SES_FROM_NAME = "AcreOS";
});

// ─── Vacuity: the platform identity really does reach the wire ───────────────

describe("VACUITY — the platform identity is observable on the system lane", () => {
  it("system mail renders the platform postal address AND the AcreOS brand", async () => {
    const result = await emailService.sendEmail({ ...BASE, organizationId: 42, purpose: "system" });

    expect(result.success).toBe(true);
    expect(sentRaw).toHaveLength(1);
    // If either of these ever stops holding, every counterparty assertion in
    // this file has become vacuous and must be re-derived — do not "fix" this
    // case by deleting it.
    expect(sentRaw[0]).toContain(PLATFORM_ADDRESS);
    expect(sentRaw[0]).toContain("AcreOS");
  });
});

// ─── The lane rule, end to end ───────────────────────────────────────────────

describe("counterparty mail carries the ORG's identity and nothing of AcreOS's", () => {
  it("footer shows the org's own address under the org's own name", async () => {
    orgFullyOnItsOwnRails();

    const result = await emailService.sendEmail({
      ...BASE, organizationId: 42, purpose: "counterparty",
    });

    expect(result.success).toBe(true);
    expect(sentRaw).toHaveLength(1);
    expect(sentRaw[0]).toContain("77 Ranch Rd, Llano, TX 78643");
    expect(sentRaw[0]).toContain("Brazos Land Partners");
  });

  it("the platform postal address CANNOT appear on counterparty mail", async () => {
    orgFullyOnItsOwnRails();

    await emailService.sendEmail({ ...BASE, organizationId: 42, purpose: "counterparty" });

    expect(sentRaw[0]).not.toContain(PLATFORM_ADDRESS);
    // Not just the whole string — no fragment of our street either, so a
    // reformatted or partially-rendered platform address is caught too.
    expect(sentRaw[0]).not.toContain("9 Platform Way");
  });

  it("the AcreOS name CANNOT appear anywhere on counterparty mail — brand, From: name, or sender domain", async () => {
    orgFullyOnItsOwnRails();

    await emailService.sendEmail({ ...BASE, organizationId: 42, purpose: "counterparty" });

    // Case-insensitive and unanchored ON PURPOSE. The defect is "our identity
    // on their mail", and it does not care whether it arrives as the footer
    // brand, the From: display name, or an @acreos.io sender address.
    expect(recipientVisibleWire(sentRaw[0])).not.toMatch(/acreos/i);
    expect(sentRaw[0]).toMatch(/^From: Brazos Land Partners <mail@customer-domain\.example>/m);
  });

  it("the platform display name cannot ride in through AWS_SES_FROM_NAME either", async () => {
    // Same defect, different representation: a deployment that renames the
    // platform brand via env must not be able to stamp it on customer mail.
    process.env.AWS_SES_FROM_NAME = "AcreOS Land Services";
    orgFullyOnItsOwnRails();

    await emailService.sendEmail({ ...BASE, organizationId: 42, purpose: "counterparty" });

    expect(sentRaw[0]).not.toContain("AcreOS Land Services");
    expect(sentRaw[0]).toMatch(/^From: Brazos Land Partners </m);
  });

  it("org with NO address on file: the line is OMITTED, never substituted", async () => {
    org.value = { id: 42, name: "Brazos Land Partners" };
    getIdentityForSend.mockResolvedValue({ fromAddress: "mail@customer-domain.example" });

    const result = await emailService.sendEmail({
      ...BASE, organizationId: 42, purpose: "counterparty",
    });

    expect(result.success).toBe(true);
    expect(recipientVisibleWire(sentRaw[0])).not.toMatch(/acreos/i);
    expect(sentRaw[0]).not.toContain(PLATFORM_ADDRESS);
    expect(sentRaw[0]).not.toMatch(/PLACEHOLDER/i);
    // The unsubscribe half of the footer is still there — we omitted one line,
    // we did not silently drop CAN-SPAM's opt-out requirement.
    expect(sentRaw[0]).toContain("Unsubscribe");
  });

  it("org with an address but NO name: address renders alone, never 'AcreOS · {their address}'", async () => {
    org.value = {
      id: 42,
      name: "   ",
      taxAddress: { line1: "77 Ranch Rd", city: "Llano", state: "TX", zip: "78643" },
    };
    getIdentityForSend.mockResolvedValue({ fromAddress: "mail@customer-domain.example" });

    await emailService.sendEmail({ ...BASE, organizationId: 42, purpose: "counterparty" });

    expect(sentRaw[0]).toContain("77 Ranch Rd, Llano, TX 78643");
    expect(recipientVisibleWire(sentRaw[0])).not.toMatch(/acreos/i);
    // No display name is honest; "AcreOS <their@domain>" is not.
    expect(sentRaw[0]).toMatch(/^From: <mail@customer-domain\.example>/m);
  });

  it("BYO SES credentials with no verified sender may NOT borrow the platform from-address (a)", async () => {
    // Previously: org creds exist ⇒ the counterparty guard passed, then the
    // missing sender silently fell back to AWS_SES_FROM_EMAIL, so the
    // customer's own AWS keys paid to send from no-reply@acreos.io.
    org.value = { id: 42, name: "Brazos Land Partners" };
    getOrganizationIntegration.mockResolvedValue({ isEnabled: true, credentials: { encrypted: "blob" } });
    getVerifiedEmailDomains.mockResolvedValue([]);
    const { decryptJsonCredentials } = await import("../../server/services/fieldEncryption");
    (decryptJsonCredentials as any).mockReturnValue({
      accessKeyId: "org-key",
      secretAccessKey: "org-secret",
    });

    const result = await emailService.sendEmail({
      ...BASE, organizationId: 42, purpose: "counterparty",
    });

    expect(result.success).toBe(false);
    expect(sentRaw).toHaveLength(0);
  });
});

// ─── The counterparty From: chokepoint ───────────────────────────────────────
//
// WHY THIS BLOCK EXISTS (2026-08-20 audit). The counterparty guard at the top
// of `performSend` asks the org for credentials or an identity and decides
// WHETHER the send may proceed. The From: line is assembled LATER, after a
// SECOND credential lookup and a SECOND identity lookup — and
// `getOrgCredentials` swallows a storage failure and returns null, at which
// point `getCredentials` falls back to the PLATFORM keys. So a passing guard
// did not imply an org-owned sender: one transient DB failure in between put
// no-reply@acreos.io in the From: line of a customer's letter to their seller,
// wearing the customer's own display name.
//
// This is also the replacement for a mechanism that was NOT enforcement. A
// `lane` argument used to be threaded through `getCredentials`/`getSESClient`;
// deleting it left every gate in this area green, because nothing observable
// depended on it. The rule now lives where the wire can see it, and these
// cases fail if the chokepoint is removed.
describe("the counterparty From: line can never be the platform sender", () => {
  /**
   * The guard sees the org's BYO credentials; the send loop's second lookup
   * comes back empty (a storage blip), so the credential resolver degrades to
   * the platform keys. Nothing about the ORG changed — only the timing.
   */
  function credentialLookupDegradesAfterTheGuard() {
    org.value = { id: 42, name: "Brazos Land Partners" };
    // The guard's lookup succeeds; every later one comes back empty.
    getOrganizationIntegration
      .mockReset()
      .mockResolvedValueOnce({ isEnabled: true, credentials: { encrypted: "blob" } })
      .mockResolvedValue(undefined);
    getVerifiedEmailDomains.mockResolvedValue([]);
    // No verified sending domain — the From: address has nothing org-owned to
    // fall back to, which is exactly the condition under test.
    getIdentityForSend.mockResolvedValue(null);
  }

  beforeEach(async () => {
    // An earlier case in this file mutates this module mock; restore the
    // credential shape these cases need rather than depending on file order.
    const { decryptJsonCredentials } = await import("../../server/services/fieldEncryption");
    (decryptJsonCredentials as any).mockReturnValue({
      accessKeyId: "org-key",
      secretAccessKey: "org-secret",
      fromEmail: "deals@customer-domain.example",
    });
  });

  it("VACUITY — that exact credential state DOES put the platform address on the wire", async () => {
    // The state the chokepoint refuses is "platform credentials, no org
    // identity". Here it is on the SYSTEM lane, where it is legitimate: the
    // send succeeds and the From: line really is no-reply@acreos.io. Without
    // this control, the refusal below could be produced by a broken harness
    // that never sends anything at all.
    org.value = { id: 42, name: "Brazos Land Partners" };
    getOrganizationIntegration.mockReset().mockResolvedValue(undefined);
    getIdentityForSend.mockResolvedValue(null);

    const result = await emailService.sendEmail({
      ...BASE, organizationId: 42, purpose: "system",
    });

    expect(result.success).toBe(true);
    expect(sentRaw[0]).toMatch(/^From: .*<no-reply@acreos\.io>/m);
  });

  it("refuses when the sender degrades to the platform address mid-send — SES is never called", async () => {
    credentialLookupDegradesAfterTheGuard();

    const result = await emailService.sendEmail({
      ...BASE, organizationId: 42, purpose: "counterparty",
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe("configuration_error");
    expect(result.retryable).toBe(false);
    // The whole point: nothing reached the wire wearing our address.
    expect(sentRaw).toHaveLength(0);
  });

  it.each([
    ["upper case", "NO-REPLY@ACREOS.IO"],
    ["mixed case", "No-Reply@AcreOS.io"],
    ["surrounding whitespace", "  no-reply@acreos.io "],
  ])("blocks the platform address supplied with %s", async (_label, mangled) => {
    // The chokepoint's refusal rests entirely on `isSameEmailAddress`, which
    // trims and lower-cases both sides. An audit found that normalization
    // UNPINNED: replacing its body with `a === b` left every case in this file
    // green, because no case ever supplied an address differing only by case or
    // padding. A comparison whose normalization nothing exercises can be
    // simplified away in a refactor with no test noticing — and what it guards
    // is whether AcreOS's own address rides on a customer's counterparty mail.
    credentialLookupDegradesAfterTheGuard();

    const result = await emailService.sendEmail({
      ...BASE, organizationId: 42, purpose: "counterparty", from: mangled,
    });

    expect(
      result.success,
      `a counterparty send carrying the platform address as "${mangled}" was allowed — ` +
        "the From: comparison is not normalized, so the chokepoint can be walked " +
        "around with a capital letter",
    ).toBe(false);
    expect(sentRaw).toHaveLength(0);
  });

  it("the refusal names the platform-identity cause, so it is not read as a generic outage", async () => {
    credentialLookupDegradesAfterTheGuard();

    const result = await emailService.sendEmail({
      ...BASE, organizationId: 42, purpose: "counterparty",
    });

    expect(result.error).toMatch(/platform identity/i);
  });

  it("does NOT refuse the legitimate BYO-domain shape: platform AWS keys, the org's own From:", async () => {
    // The documented path — platform credentials sending FROM the customer's
    // verified domain — must stay open, or this chokepoint would have taken
    // out the majority of real counterparty mail. Without this case, a
    // chokepoint that refused every `source === 'platform'` send would still
    // pass every assertion above.
    org.value = { id: 42, name: "Brazos Land Partners" };
    getOrganizationIntegration.mockReset().mockResolvedValue(undefined);
    getIdentityForSend.mockResolvedValue({ fromAddress: "mail@customer-domain.example" });

    const result = await emailService.sendEmail({
      ...BASE, organizationId: 42, purpose: "counterparty",
    });

    expect(result.success).toBe(true);
    expect(sentRaw[0]).toMatch(/^From: Brazos Land Partners <mail@customer-domain\.example>/m);
  });
});
