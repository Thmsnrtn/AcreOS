/**
 * CAN-SPAM §5 safe-default — Beatrice / compliance-debt §1.
 *
 * The highest-volume marketing path (growthAutomation upgrade-nudge / win-back
 * / referral / re-engagement / churn) used to call sendEmail() with NEITHER
 * isCampaignEmail NOR unsubscribeUrl, so the visible postal-address + opt-out
 * footer never rendered — a CAN-SPAM violation the List-Unsubscribe header does
 * not cure. The fix inverts the default: the footer renders on every send
 * UNLESS the caller explicitly marks it `transactional: true`. This test pins
 * that fail-safe decision via the exported pure predicate.
 *
 * emailService pulls a heavy module graph (SES SDK, storage, warmup, identity);
 * we mock the siblings so the predicate imports cleanly — mirroring
 * tests/unit/canSpamFooterAddress.test.ts.
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

import { shouldRenderCanSpamFooter } from "../../server/services/emailService";

describe("CAN-SPAM footer — safe-default predicate", () => {
  it("renders the footer on a plain (growth/lifecycle) send with no flags", () => {
    // This is exactly the growthAutomation call shape that previously shipped
    // without a footer.
    expect(shouldRenderCanSpamFooter({})).toBe(true);
  });

  it("renders the footer when explicitly NOT transactional", () => {
    expect(shouldRenderCanSpamFooter({ transactional: false })).toBe(true);
  });

  it("SUPPRESSES the footer only when explicitly marked transactional", () => {
    expect(shouldRenderCanSpamFooter({ transactional: true })).toBe(false);
  });
});
