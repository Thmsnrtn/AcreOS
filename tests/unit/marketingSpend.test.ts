/**
 * marketingSpend (server/services/marketingSpend.ts) — the CAC numerator
 * from the 2026-07-07 cost audit. Pins the no-fabrication contract:
 * an empty ledger yields null CAC (unknown, not free); spend with no
 * attributed paying signups also yields null (not Infinity); real totals
 * divide cleanly. Also guards the actuals-only write validation.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  cacFromTotals,
  MARKETING_CHANNELS,
  recordMarketingSpend,
} from "../../server/services/marketingSpend";

describe("cacFromTotals — no-fabrication contract", () => {
  it("returns null when there is no recorded spend (unknown ≠ free acquisition)", () => {
    expect(cacFromTotals(0, 10)).toBeNull();
    expect(cacFromTotals(-500, 10)).toBeNull();
  });

  it("returns null when spend exists but no paying customers landed (not Infinity)", () => {
    expect(cacFromTotals(50_000, 0)).toBeNull();
  });

  it("divides real totals: $500 over 10 new paying customers → $50 CAC", () => {
    expect(cacFromTotals(50_000, 10)).toBe(50);
  });

  it("rounds to cents: $100 over 3 customers → $33.33", () => {
    expect(cacFromTotals(10_000, 3)).toBe(33.33);
  });
});

describe("recordMarketingSpend — actuals-only validation", () => {
  it("rejects zero, negative, and fractional-cent amounts before touching the DB", async () => {
    for (const amountCents of [0, -100, 12.5]) {
      await expect(
        recordMarketingSpend({ channel: "meta", amountCents }),
      ).rejects.toThrow(/positive integer/);
    }
  });
});

describe("channel registry", () => {
  it("covers the acquisition channels the roadmap names", () => {
    expect(MARKETING_CHANNELS).toContain("meta");
    expect(MARKETING_CHANNELS).toContain("google");
    expect(MARKETING_CHANNELS).toContain("content");
    expect(MARKETING_CHANNELS).toContain("referral");
  });
});
