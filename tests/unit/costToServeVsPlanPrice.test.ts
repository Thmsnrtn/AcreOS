/**
 * Cost to serve vs plan price — per-org, visible to the founder, read-only.
 *
 * Pins, behaviourally:
 *   - the canonical rule (costToServeOf): AI actually billed + pool-funded
 *     provider cost, as a share of the plan price; an org that pays nothing has
 *     no share (null), never a fabricated 0% or ∞;
 *   - which ledger rows count as pool provider cost: opex_spent rows the plan's
 *     pool paid — NOT the purchased-credit overflow lane (the customer paid),
 *     NOT the pool's ai_tokens estimate (actual AI is counted from ai_tokens
 *     rows, counting both would double it), refunds netted;
 *   - the nightly compute carries it on the snapshot, and the read API
 *     re-projects it through the SAME rule (a stale persisted share is not
 *     what the founder sees);
 *   - the alert is filed above the stated share, not below, deduped, and does
 *     nothing but file an alert.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const st = vi.hoisted(() => ({
  resolve: (_table: unknown): unknown[] => [],
  executeRows: [] as unknown[],
  alerts: [] as Record<string, unknown>[],
}));

vi.mock("../../server/db", () => {
  function builder() {
    const b: any = {
      _table: undefined as unknown,
      from(t: unknown) { b._table = t; return b; },
      where() { return b; },
      groupBy() { return b; },
      orderBy() { return b; },
      limit() { return b; },
      then(ok: (rows: unknown[]) => unknown, bad?: (e: unknown) => unknown) {
        try { return Promise.resolve(ok(st.resolve(b._table))); } catch (e) { return bad ? Promise.resolve(bad(e)) : Promise.reject(e); }
      },
    };
    return b;
  }
  return {
    db: {
      select: () => builder(),
      // First execute = latest snapshot per org; second = the 90-day trend.
      execute: async () => { const rows = st.executeRows; st.executeRows = []; return { rows }; },
      insert: () => { throw new Error("insert not expected"); },
    },
  };
});
vi.mock("../../server/storage", () => ({
  storage: { createSystemAlert: async (a: Record<string, unknown>) => { st.alerts.push(a); } },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { organizations, financialLedger, customerUnitEconomics, systemAlerts } from "@shared/schema";
import {
  costToServeOf,
  poolProviderCostFor,
  computeUnitEconomicsForOrg,
  maybeEmitCostToServeAlert,
  readUnitEconomicsRollup,
  COST_TO_SERVE_ALERT_SHARE,
} from "../../server/services/unitEconomics";
import { monthlyRevenueCentsFor } from "@shared/billing/tier-pricing";

const ORG = 7;
const PRO_PRICE = monthlyRevenueCentsFor("pro", "monthly") / 100;

function world(ledger: unknown[], openAlerts: unknown[] = []) {
  st.resolve = (t) => {
    if (t === financialLedger) return ledger;
    if (t === organizations) return [{ id: ORG, name: "Acme Land", subscriptionTier: "pro", subscriptionStatus: "active", billingInterval: "monthly" }];
    if (t === customerUnitEconomics) return [];
    if (t === systemAlerts) return openAlerts;
    return [];
  };
}

beforeEach(() => {
  st.alerts.length = 0;
  st.executeRows = [];
  world([]);
});

describe("costToServeOf — the canonical rule", () => {
  it("is AI + pool provider cost over the plan price", () => {
    const c = costToServeOf({ mrrUsd: 49, aiUsd: 10, poolProviderUsd: 4.7 });
    expect(c.usd).toBeCloseTo(14.7, 6);
    expect(c.shareOfPrice).toBeCloseTo(0.3, 4);
    expect(c.overAlertShare).toBe(false);
    expect(c.alertShare).toBe(COST_TO_SERVE_ALERT_SHARE);
  });
  it("flags above the stated share, not at or below it", () => {
    expect(costToServeOf({ mrrUsd: 100, aiUsd: 50, poolProviderUsd: 0 }).overAlertShare).toBe(false);
    expect(costToServeOf({ mrrUsd: 100, aiUsd: 50, poolProviderUsd: 0.01 }).overAlertShare).toBe(true);
  });
  it("an org that pays nothing has no share — not 0%, not infinity, never flagged", () => {
    const c = costToServeOf({ mrrUsd: 0, aiUsd: 3, poolProviderUsd: 1 });
    expect(c.shareOfPrice).toBeNull();
    expect(c.overAlertShare).toBe(false);
    expect(c.usd).toBe(4);
  });
});

describe("poolProviderCostFor — what the plan's pool paid", () => {
  it("counts pool-funded provider rows; excludes purchased overflow and the pool's AI estimate; nets refunds", async () => {
    world([
      { category: "opex_spent", feature: "sms", postedBy: "system:credit-pool:sms_outbound", totalCents: -300 },
      { category: "opex_spent", feature: "data_lookup", postedBy: "system:credit-pool:comps_lookup", totalCents: -200 },
      { category: "opex_spent", feature: "ai_tokens", postedBy: "system:credit-pool:ai_turn_avg", totalCents: -900 },
      { category: "opex_spent", feature: "postcard", postedBy: "system:credit-pool:postcard_lob:purchased-overflow", totalCents: -5000 },
      { category: "opex_spent", feature: "sms", postedBy: "system:credit-pool:refund", totalCents: 100 },
      { category: "ai_tokens", feature: "pax_chat", postedBy: "system", totalCents: -10000 },
    ]);
    const r = await poolProviderCostFor(ORG, new Date(0));
    expect(r.usd).toBeCloseTo(3 + 2 - 1, 6);
    expect(r.byFeature).toEqual({ sms: 3, data_lookup: 2 });
  });
});

describe("the nightly snapshot carries it, and the alert reads it", () => {
  const heavy = [
    { category: "ai_tokens", feature: "pax_chat", postedBy: "system", totalCents: -2000, rowCount: 40 },
    { category: "opex_spent", feature: "data_lookup", postedBy: "system:credit-pool:comps_lookup", totalCents: -600, rowCount: 3 },
  ];

  it("computeUnitEconomicsForOrg puts costToServe on the breakdown", async () => {
    world(heavy);
    const r = await computeUnitEconomicsForOrg(ORG, { activeCustomerCount: 1 });
    expect(r.mrrUsd).toBe(PRO_PRICE);
    expect(r.breakdown.costToServe).toMatchObject({ aiUsd: 20, poolProviderUsd: 6, usd: 26 });
    expect(r.breakdown.costToServe!.shareOfPrice).toBeCloseTo(26 / PRO_PRICE, 4);
  });

  it("files ONE read-only alert above the line", async () => {
    world(heavy);
    const r = await computeUnitEconomicsForOrg(ORG, { activeCustomerCount: 1 });
    expect(r.breakdown.costToServe!.overAlertShare).toBe(true); // $26 of $49 > 50%
    expect(await maybeEmitCostToServeAlert(r)).toBe(true);
    expect(st.alerts).toHaveLength(1);
    expect(st.alerts[0]).toMatchObject({ alertType: "customer_cost_to_serve_high", organizationId: ORG, autoResolvable: false });
    expect(String(st.alerts[0].message)).toContain("nothing was throttled");
  });

  it("does not alert below the line", async () => {
    world([{ category: "ai_tokens", feature: "pax_chat", postedBy: "system", totalCents: -500, rowCount: 5 }]);
    const r = await computeUnitEconomicsForOrg(ORG, { activeCustomerCount: 1 });
    expect(await maybeEmitCostToServeAlert(r)).toBe(false);
    expect(st.alerts).toHaveLength(0);
  });

  it("is deduped against an open alert", async () => {
    world(heavy, [{ id: 1 }]);
    const r = await computeUnitEconomicsForOrg(ORG, { activeCustomerCount: 1 });
    expect(await maybeEmitCostToServeAlert(r)).toBe(false);
    expect(st.alerts).toHaveLength(0);
  });
});

describe("the founder read API re-projects through the same rule", () => {
  it("serves costToServeOf(persisted components), not a stale persisted share", async () => {
    st.executeRows = [{
      organization_id: ORG, computed_at: new Date().toISOString(), mrr_usd: "49", ai_cost_usd: "20",
      direct_mail_cost_usd: "0", sms_cost_usd: "0", email_cost_usd: "0", skip_trace_cost_usd: "0",
      fixed_cost_share_usd: "0", total_cogs_usd: "20", profit_margin_usd: "29", profit_margin_pct: "59",
      consecutive_unprofitable_days: 0,
      // A share written by an older rule — must NOT be what the page shows.
      breakdown: { costToServe: { usd: 1, aiUsd: 20, poolProviderUsd: 6, shareOfPrice: 0.01, overAlertShare: false, alertShare: 0.9 } },
      organization_name: "Acme Land", subscription_tier: "pro", subscription_status: "active",
    }];
    const api = await readUnitEconomicsRollup();
    expect(api.rows[0].costToServe).toEqual(costToServeOf({ mrrUsd: 49, aiUsd: 20, poolProviderUsd: 6 }));
    expect(api.rows[0].costToServe!.overAlertShare).toBe(true);
  });
  it("a snapshot from before the field existed reads as null, not $0", async () => {
    st.executeRows = [{
      organization_id: ORG, computed_at: new Date().toISOString(), mrr_usd: "49", ai_cost_usd: "0",
      direct_mail_cost_usd: "0", sms_cost_usd: "0", email_cost_usd: "0", skip_trace_cost_usd: "0",
      fixed_cost_share_usd: "0", total_cogs_usd: "0", profit_margin_usd: "49", profit_margin_pct: "100",
      consecutive_unprofitable_days: 0, breakdown: { aiByFeature: {} },
      organization_name: "Acme Land", subscription_tier: "pro", subscription_status: "active",
    }];
    const api = await readUnitEconomicsRollup();
    expect(api.rows[0].costToServe).toBeNull();
  });
});
