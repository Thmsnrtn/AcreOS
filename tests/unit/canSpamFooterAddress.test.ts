/**
 * CAN-SPAM footer address rendering.
 *
 * The campaign-email footer must NEVER ship a literal "[PLACEHOLDER]" to a
 * recipient. When CAN_SPAM_MAILING_ADDRESS is unset the footer falls back to
 * the sending org's mailing address, and renders only the brand name when no
 * address is on file. This test exercises the address formatter that backs
 * that decision.
 *
 * emailService pulls in a heavy module graph (SES SDK, storage, warmup,
 * identity); we mock the siblings so the pure formatter is testable in
 * isolation — mirroring tests/unit/emailSuppression.test.ts.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn(async (emails: string[]) => ({ allowed: emails, suppressed: [] })),
  isSuppressed: vi.fn(async () => false),
}));
vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn(async () => "test-token"),
  buildUnsubscribeUrl: () => "https://app.acreos.io/u/test-token",
}));
vi.mock("../../server/services/emailWarmup", () => ({
  reserveSend: vi.fn(async () => ({ ok: true, dailyLimit: 10000, used: 1, resetAt: new Date(), warmupDay: 7 })),
}));
vi.mock("../../server/services/orgEmailIdentity", () => ({
  getIdentityForSend: vi.fn(async () => null),
}));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { formatOrgMailingAddress } from "../../server/services/emailService";

describe("CAN-SPAM footer — formatOrgMailingAddress", () => {
  it("formats a full address into a single compliant line", () => {
    expect(
      formatOrgMailingAddress({
        line1: "123 Main St",
        line2: "Suite 4",
        city: "Austin",
        state: "TX",
        zip: "78701",
        country: "USA",
      }),
    ).toBe("123 Main St, Suite 4, Austin, TX 78701, USA");
  });

  it("omits empty components without dangling separators", () => {
    expect(formatOrgMailingAddress({ line1: "500 Oak Ave", city: "Reno", state: "NV", zip: "89501" }))
      .toBe("500 Oak Ave, Reno, NV 89501");
  });

  it("returns null when there is nothing to render (so the line is OMITTED, never a placeholder)", () => {
    expect(formatOrgMailingAddress(null)).toBeNull();
    expect(formatOrgMailingAddress(undefined)).toBeNull();
    expect(formatOrgMailingAddress({})).toBeNull();
    expect(formatOrgMailingAddress({ line1: "   " })).toBeNull();
  });

  it("never returns the literal placeholder string", () => {
    const out = formatOrgMailingAddress({ line1: "1 Elm" });
    expect(out).not.toContain("PLACEHOLDER");
  });
});
