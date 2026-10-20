/**
 * Seller-finance payment accounts are Stripe STANDARD accounts (founder
 * decision 2026-10-20 #5, under the no-platform-money-custody hard stop).
 *
 * They were created as Express accounts with a platform-set daily payout
 * schedule and a requested `transfers` capability. With Express the platform
 * carries dispute and negative-balance liability and controls payouts — a
 * quieter way of standing in the customer's money path. This drives the real
 * createConnectedAccount with the Stripe SDK mocked and asserts the request
 * AcreOS actually sends.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../helpers/stripComments";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const created: any[] = [];
vi.mock("stripe", () => {
  class FakeStripe {
    accounts = { create: vi.fn(async (params: any) => { created.push(params); return { id: "acct_test_1" }; }) };
    accountLinks = { create: vi.fn(async () => ({ url: "https://connect.stripe.com/setup/s/test" })) };
  }
  return { default: FakeStripe };
});
vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationIntegration: vi.fn(async () => undefined),
    upsertOrganizationIntegration: vi.fn(async () => ({})),
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  created.length = 0;
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
});

describe("connected accounts for customer money", () => {
  it("are created as Standard accounts the customer controls", async () => {
    const { StripeConnectService } = await import("../../server/services/stripeConnect");
    await StripeConnectService.getInstance().createConnectedAccount(7, "owner@example.com", "Ridge Land LLC");
    expect(created).toHaveLength(1);
    const params = created[0];
    expect(params.type).toBe("standard");
    // The platform sets nothing that belongs to the account holder.
    expect(params.settings).toBeUndefined();
    expect(params.capabilities).toBeUndefined();
    expect(params.controller).toBeUndefined();
    expect(params.business_profile).toEqual({ name: "Ridge Land LLC" });
  });

  it("no server file creates an Express or Custom connected account", () => {
    // Population: every server source file, not just stripeConnect.ts — a
    // second accounts.create elsewhere is exactly how this would come back.
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
      }
    };
    walk("server");
    expect(files.length).toBeGreaterThan(500);
    const offenders = files.filter((f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      return /accounts\.create\(/.test(src) && /type:\s*["'](express|custom)["']/.test(src);
    });
    expect(offenders).toEqual([]);
    expect(stripComments(readFileSync("server/services/stripeConnect.ts", "utf8"))).toMatch(/type:\s*["']standard["']/);
  });
});
