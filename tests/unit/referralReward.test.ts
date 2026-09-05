/**
 * Referral rewards — MARKET-MATCH terms (founder decision, picker 2026-09-01).
 *
 * The machine: pending → signed_up → paid (referee credited $49 at first
 * paid invoice; 30-day retention clock starts) → converted (referrer
 * credited $49, or $98 on annual, + milestone bonuses at 5 and 10) |
 * voided (subscription not active at maturity — nothing credited).
 *
 * HISTORY: the previous terms credited $1 to both sides on the referred
 * org's first WON DEAL. deal_won alone is gameable at real reward sizes
 * (a trial org can fabricate a closed-won deal for $0), so payment became
 * the gate and retention the hold. This suite pins:
 *   1. markReferralPaid claims signed_up/pending → paid exactly once and
 *      credits ONLY the referee ($49); redelivery and races are no-ops.
 *   2. matureReferralRewards converts retained referrals (referrer $49;
 *      $98 when the referee bills yearly) and VOIDS unretained ones with
 *      zero credit.
 *   3. The milestone bonus fires exactly at the crossing conversion.
 *   4. Stripe being down never loses the ledger credit.
 *
 * ── WHY THIS MOCK WAS REWRITTEN (2026-09-05) ────────────────────────────────
 * It used to answer three queries THE DATABASE REJECTS. The service resolved a
 * user's organization with `SELECT id FROM users WHERE organization_id = $1`,
 * `JOIN users u ON u.organization_id = o.id` and `SELECT organization_id FROM
 * users WHERE id = $1` — and `users` has no `organization_id` column. A user's
 * org lives in `team_members`.
 *
 * This suite dispatched on SQL TEXT, so `text.includes("SELECT id FROM users")`
 * happily returned a fixture row and every assertion below passed, while in
 * production each statement threw into a catch: no referee credit at first paid
 * invoice, no conversion or void at maturity, no referrer credit. GREEN SUITE,
 * DEAD PROGRAM — the mock agreed with an implementation that could not run.
 *
 * The assertions are UNCHANGED. Only the mock moved, to serve the shapes the
 * service now issues (typed Drizzle reads through `team_members`), so the
 * invariants this suite was written to pin survive intact and are now pinned
 * against something that works.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  orgUsers: [{ id: "user_ref_1" }] as Array<{ id: string }>,
  referralRow: null as any,
  claimSucceeds: true,
  dueRows: [] as Array<{ id: number; referrer_id: string; referee_id: string | null }>,
  refereeOrg: { id: 7, subscriptionStatus: "active", billingInterval: "monthly" } as any,
  convertedCount: 1,
  referrerOrgId: 42 as number | null,
  stripeCustomerId: "cus_x" as string | null,
  stripeThrows: false,
  executed: [] as Array<{ text: string; values: any[] }>,
  balanceTxs: [] as Array<{ customer: string; amount: number }>,
};

vi.mock("@shared/models/auth", () => ({
  referrals: { refereeId: "r.referee", __k: "referrals" },
}));
vi.mock("@shared/schema", () => ({
  organizations: {
    id: "o.id", stripeCustomerId: "o.stripe",
    subscriptionStatus: "o.subStatus", billingInterval: "o.billingInterval",
    __k: "orgs",
  },
  teamMembers: { organizationId: "tm.orgId", userId: "tm.userId", __k: "teamMembers" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ op: "eq", a, b }),
  inArray: (a: any, b: any) => ({ op: "in", a, b }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({
      op: "sql",
      text: strings.join("?"),
      values,
    }),
    { raw: (s: string) => ({ op: "sql.raw", s }) },
  ),
}));

/**
 * Rows for one builder chain, chosen by the TABLES it names — not by SQL text.
 * Text dispatch is what let this suite answer a query the database rejects.
 */
function rowsFor(st: { table: any; joined: any; limited: boolean }): any[] {
  const table = st.table?.__k;
  const joined = st.joined?.__k;

  if (table === "referrals") return state.referralRow ? [state.referralRow] : [];

  // The referee's org and billing state, reached THROUGH team_members.
  if (table === "orgs" && joined === "teamMembers") {
    return state.refereeOrg ? [state.refereeOrg] : [];
  }
  // redeemAsStripeBalance: the org's Stripe customer.
  if (table === "orgs") return [{ stripeCustomerId: state.stripeCustomerId }];

  if (table === "teamMembers") {
    // Two distinct reads, distinguished by shape rather than by text:
    //   referralForOrg   org  → every member's userId   (no limit)
    //   referrer lookup  user → that member's org       (limit 1)
    return st.limited
      ? state.referrerOrgId
        ? [{ organizationId: state.referrerOrgId }]
        : []
      : state.orgUsers.map((u) => ({ userId: u.id }));
  }
  return [];
}

vi.mock("../../server/db", () => ({
  db: {
    select: (_proj?: any) => ({
      from: (t: any) => {
        const st = { table: t, joined: null as any, limited: false };
        const api: any = {
          innerJoin: (j: any) => { st.joined = j; return api; },
          leftJoin: (j: any) => { st.joined = j; return api; },
          where: () => api,
          orderBy: () => api,
          limit: () => { st.limited = true; return api; },
          // Thenable: the chain resolves whether or not `.limit()` was called,
          // which is the difference between the two team_members reads.
          then: (res: any, rej: any) => Promise.resolve(rowsFor(st)).then(res, rej),
        };
        return api;
      },
    }),
    execute: (q: any) => {
      const text: string = q?.text ?? "";
      state.executed.push({ text, values: q?.values ?? [] });
      if (text.includes("FROM referrals") && text.includes("status = 'paid'"))
        return Promise.resolve({ rows: state.dueRows });
      if (text.includes("UPDATE referrals"))
        return Promise.resolve({ rows: state.claimSucceeds ? [{ id: 1 }] : [] });
      if (text.includes("count(*)"))
        return Promise.resolve({ rows: [{ n: String(state.convertedCount) }] });
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

const orgCreditCalls = () => state.executed.filter((e) => e.text.includes("UPDATE organizations"));
const referralClaims = () => state.executed.filter((e) => e.text.includes("UPDATE referrals"));

beforeEach(() => {
  vi.resetModules();
  state.orgUsers = [{ id: "user_ref_1" }];
  state.referralRow = { id: 1, referrerId: "user_referrer", refereeId: "user_ref_1", status: "signed_up" };
  state.claimSucceeds = true;
  state.dueRows = [{ id: 1, referrer_id: "user_referrer", referee_id: "user_ref_1" }];
  state.refereeOrg = { id: 7, subscriptionStatus: "active", billingInterval: "monthly" };
  state.convertedCount = 1;
  state.referrerOrgId = 42;
  state.stripeCustomerId = "cus_x";
  state.stripeThrows = false;
  state.executed = [];
  state.balanceTxs = [];
});

describe("markReferralPaid — the referee's moment", () => {
  it("claims signed_up → paid and credits ONLY the referee ($49)", async () => {
    const { markReferralPaid, REFERRAL_REWARD_CENTS } = await import("../../server/services/referralReward");
    const r = await markReferralPaid(7);
    expect(r.marked).toBe(true);
    expect(orgCreditCalls()).toHaveLength(1); // referee only — referrer waits for maturity
    expect(state.balanceTxs).toHaveLength(1);
    expect(state.balanceTxs[0].amount).toBe(-REFERRAL_REWARD_CENTS);
    expect(REFERRAL_REWARD_CENTS).toBe(4_900);
  });

  it("is a no-op for already-paid and converted referrals (webhook redelivery)", async () => {
    for (const status of ["paid", "converted", "voided"]) {
      state.executed = [];
      state.referralRow = { ...state.referralRow, status };
      const { markReferralPaid } = await import("../../server/services/referralReward");
      const r = await markReferralPaid(7);
      expect(r.marked, `status=${status} must not re-mark`).toBe(false);
      expect(orgCreditCalls()).toHaveLength(0);
      vi.resetModules();
    }
  });

  it("a raced claim credits nothing", async () => {
    state.claimSucceeds = false;
    const { markReferralPaid } = await import("../../server/services/referralReward");
    const r = await markReferralPaid(7);
    expect(r.marked).toBe(false);
    expect(orgCreditCalls()).toHaveLength(0);
  });

  it("an org with no referral is a silent no-op", async () => {
    state.referralRow = null;
    const { markReferralPaid } = await import("../../server/services/referralReward");
    const r = await markReferralPaid(7);
    expect(r.marked).toBe(false);
  });
});

describe("matureReferralRewards — the referrer's moment, after the hold", () => {
  it("converts a retained referral and credits the referrer $49 (monthly)", async () => {
    const { matureReferralRewards, REFERRAL_REWARD_CENTS } = await import("../../server/services/referralReward");
    const r = await matureReferralRewards();
    expect(r.converted).toBe(1);
    expect(r.voided).toBe(0);
    const claim = referralClaims()[0];
    expect(claim.values).toContain("converted");
    expect(claim.values).toContain(REFERRAL_REWARD_CENTS);
    expect(orgCreditCalls()).toHaveLength(1); // referrer only — referee was credited at payment
    expect(state.balanceTxs[0].amount).toBe(-REFERRAL_REWARD_CENTS);
  });

  it("pays the annual bonus when the referee bills yearly ($98 total)", async () => {
    state.refereeOrg = { ...state.refereeOrg, billingInterval: "yearly" };
    const { matureReferralRewards, REFERRAL_REWARD_CENTS, REFERRAL_ANNUAL_BONUS_CENTS } =
      await import("../../server/services/referralReward");
    await matureReferralRewards();
    expect(state.balanceTxs[0].amount).toBe(-(REFERRAL_REWARD_CENTS + REFERRAL_ANNUAL_BONUS_CENTS));
  });

  it("VOIDS an unretained referral — no credit to anyone", async () => {
    state.refereeOrg = { ...state.refereeOrg, subscriptionStatus: "canceled" };
    const { matureReferralRewards } = await import("../../server/services/referralReward");
    const r = await matureReferralRewards();
    expect(r.converted).toBe(0);
    expect(r.voided).toBe(1);
    const claim = referralClaims()[0];
    expect(claim.values).toContain("voided");
    expect(claim.values).toContain(0);
    expect(orgCreditCalls()).toHaveLength(0);
    expect(state.balanceTxs).toHaveLength(0);
  });

  it("grants the milestone bonus exactly at the crossing conversion", async () => {
    state.convertedCount = 5; // this conversion IS the 5th
    const { matureReferralRewards, REFERRAL_MILESTONES } = await import("../../server/services/referralReward");
    await matureReferralRewards();
    expect(orgCreditCalls()).toHaveLength(2); // base + milestone
    expect(state.balanceTxs.map((t) => t.amount)).toContain(-REFERRAL_MILESTONES[5]);
  });

  it("no milestone bonus off the crossing (4th or 6th conversion)", async () => {
    for (const n of [4, 6]) {
      state.executed = [];
      state.balanceTxs = [];
      state.convertedCount = n;
      const { matureReferralRewards } = await import("../../server/services/referralReward");
      await matureReferralRewards();
      expect(orgCreditCalls(), `count=${n}`).toHaveLength(1); // base only
      vi.resetModules();
    }
  });

  it("Stripe being down does NOT lose the ledger credit", async () => {
    state.stripeThrows = true;
    const { matureReferralRewards } = await import("../../server/services/referralReward");
    const r = await matureReferralRewards();
    expect(r.converted).toBe(1);
    expect(orgCreditCalls()).toHaveLength(1);
    expect(state.balanceTxs).toHaveLength(0);
  });
});
