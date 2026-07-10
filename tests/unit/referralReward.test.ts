/**
 * S2 — referral reward revival. The audit found the loop dead: the activate
 * endpoint had zero callers and referral_credits was never redeemed against a
 * bill. applyReferralRewardForOrg is the server-side reward path fired from
 * the deal_won hook. These tests pin:
 *   1. a pending referral converts exactly once (idempotent claim) and
 *      credits BOTH orgs + redeems Stripe balance for orgs with a customer;
 *   2. an already-converted referral never rewards again;
 *   3. an org with no referral is a silent no-op;
 *   4. Stripe being down does NOT lose the ledger credit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  orgUsers: [{ id: "user_ref_1" }] as Array<{ id: string }>,
  referralRow: null as any,
  claimSucceeds: true,
  referrerOrgId: 42 as number | null,
  stripeCustomerId: "cus_x" as string | null,
  stripeThrows: false,
  executed: [] as string[],
  balanceTxs: [] as Array<{ customer: string; amount: number }>,
};

vi.mock("@shared/models/auth", () => ({
  referrals: { refereeId: "r.referee", __k: "referrals" },
}));
vi.mock("@shared/schema", () => ({
  organizations: { id: "o.id", stripeCustomerId: "o.stripe", __k: "orgs" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ op: "eq", a, b }),
  inArray: (a: any, b: any) => ({ op: "in", a, b }),
  sql: Object.assign((strings: TemplateStringsArray, ..._v: any[]) => ({ op: "sql", text: strings.join("?") }), {
    raw: (s: string) => ({ op: "sql.raw", s }),
  }),
}));

vi.mock("../../server/db", () => ({
  db: {
    select: (_proj?: any) => ({
      from: (t: any) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              t?.__k === "referrals"
                ? state.referralRow
                  ? [state.referralRow]
                  : []
                : [{ stripeCustomerId: state.stripeCustomerId }],
            ),
        }),
      }),
    }),
    execute: (q: any) => {
      const text: string = q?.text ?? "";
      state.executed.push(text);
      if (text.includes("SELECT id FROM users")) return Promise.resolve({ rows: state.orgUsers });
      if (text.includes("UPDATE referrals")) return Promise.resolve({ rows: state.claimSucceeds ? [{ id: 1 }] : [] });
      if (text.includes("SELECT organization_id FROM users"))
        return Promise.resolve({ rows: state.referrerOrgId ? [{ organization_id: state.referrerOrgId }] : [] });
      return Promise.resolve({ rows: [] });
    },
  },
}));

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    customers: {
      createBalanceTransaction: async (customer: string, opts: { amount: number }) => {
        if (state.stripeThrows) throw new Error("stripe down");
        state.balanceTxs.push({ customer, amount: opts.amount });
        return { id: "cbtxn_1" };
      },
    },
  }),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  state.orgUsers = [{ id: "user_ref_1" }];
  state.referralRow = { id: 1, referrerId: "user_referrer", refereeId: "user_ref_1", status: "signed_up" };
  state.claimSucceeds = true;
  state.referrerOrgId = 42;
  state.stripeCustomerId = "cus_x";
  state.stripeThrows = false;
  state.executed = [];
  state.balanceTxs = [];
});

describe("applyReferralRewardForOrg", () => {
  it("converts a signed_up referral: credits BOTH orgs and redeems both Stripe balances", async () => {
    const { applyReferralRewardForOrg, REFERRAL_REWARD_CENTS } = await import("../../server/services/referralReward");
    const r = await applyReferralRewardForOrg(7);
    expect(r.rewarded).toBe(true);
    const orgCredits = state.executed.filter((t) => t.includes("UPDATE organizations"));
    expect(orgCredits).toHaveLength(2); // referee org + referrer org
    expect(state.balanceTxs).toHaveLength(2); // both redeemed on Stripe
    for (const tx of state.balanceTxs) expect(tx.amount).toBe(-REFERRAL_REWARD_CENTS); // negative = credit
  });

  it("an already-converted referral never rewards again", async () => {
    state.referralRow = { ...state.referralRow, status: "converted" };
    const { applyReferralRewardForOrg } = await import("../../server/services/referralReward");
    const r = await applyReferralRewardForOrg(7);
    expect(r.rewarded).toBe(false);
    expect(state.executed.filter((t) => t.includes("UPDATE organizations"))).toHaveLength(0);
  });

  it("a raced claim (another caller converted first) does not double-credit", async () => {
    state.claimSucceeds = false; // UPDATE ... WHERE status != 'converted' returns no rows
    const { applyReferralRewardForOrg } = await import("../../server/services/referralReward");
    const r = await applyReferralRewardForOrg(7);
    expect(r.rewarded).toBe(false);
    expect(state.executed.filter((t) => t.includes("UPDATE organizations"))).toHaveLength(0);
  });

  it("an org with no referral is a silent no-op", async () => {
    state.referralRow = null;
    const { applyReferralRewardForOrg } = await import("../../server/services/referralReward");
    const r = await applyReferralRewardForOrg(7);
    expect(r.rewarded).toBe(false);
  });

  it("Stripe being down does NOT lose the ledger credit", async () => {
    state.stripeThrows = true;
    const { applyReferralRewardForOrg } = await import("../../server/services/referralReward");
    const r = await applyReferralRewardForOrg(7);
    expect(r.rewarded).toBe(true);
    // Ledger credits still written for both orgs even though redemption failed.
    expect(state.executed.filter((t) => t.includes("UPDATE organizations"))).toHaveLength(2);
    expect(state.balanceTxs).toHaveLength(0);
  });
});
