/**
 * PKG-5a/5b D6 — founder customers read: paid conversions by utm_source +
 * utm_campaign (runbook §5: cost per PAYING customer per campaign).
 *
 * "Paying" mirrors liveMrrDetail (server/services/finance/runwayModel.ts):
 * status exactly "active" + positive monthly-equivalent price. Trials, free
 * tier, past_due and cancelled are not paid.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/auth/clerkAuth", () => ({
  isAuthenticated: vi.fn(),
  requireFounder: vi.fn(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: vi.fn() }));

import { readFileSync } from "node:fs";
import {
  groupPaidBySource,
  isPayingOrg,
  type PaidConversionRow,
} from "../../server/routes-founder-customers";

let nextOrg = 1;
function row(over: Partial<PaidConversionRow> = {}): PaidConversionRow {
  return {
    organizationId: nextOrg++,
    tier: "pro",
    status: "active",
    interval: "monthly",
    utm: { utm_source: "meta", utm_campaign: "spring" },
    ...over,
  };
}

describe("isPayingOrg", () => {
  it("counts active paid-tier orgs, monthly and yearly", () => {
    expect(isPayingOrg({ tier: "pro", status: "active", interval: "monthly" })).toBe(true);
    expect(isPayingOrg({ tier: "starter", status: "active", interval: "yearly" })).toBe(true);
  });
  it("does NOT count trialing (falsification: counting trials must go red)", () => {
    expect(isPayingOrg({ tier: "pro", status: "trialing", interval: "monthly" })).toBe(false);
  });
  it("does NOT count free tier, past_due, cancelled or null status", () => {
    expect(isPayingOrg({ tier: "free", status: "active", interval: "monthly" })).toBe(false);
    expect(isPayingOrg({ tier: "pro", status: "past_due", interval: "monthly" })).toBe(false);
    expect(isPayingOrg({ tier: "pro", status: "canceled", interval: "monthly" })).toBe(false);
    expect(isPayingOrg({ tier: "pro", status: null, interval: null })).toBe(false);
  });
});

describe("groupPaidBySource", () => {
  it("excludes trial orgs from every bucket", () => {
    const out = groupPaidBySource([row({ status: "trialing" }), row({ status: "trialing" })]);
    expect(out).toEqual([]);
  });

  it("excludes free-tier signups", () => {
    expect(groupPaidBySource([row({ tier: "free" })])).toEqual([]);
  });

  it("counts an org once even with several user rows", () => {
    const r = row();
    const out = groupPaidBySource([r, { ...r }, { ...r }]);
    expect(out).toEqual([{ source: "meta", campaign: "spring", paidOrgs: 1 }]);
  });

  it("separates two campaigns under one source", () => {
    const out = groupPaidBySource([
      row({ utm: { utm_source: "meta", utm_campaign: "spring" } }),
      row({ utm: { utm_source: "meta", utm_campaign: "spring" } }),
      row({ utm: { utm_source: "meta", utm_campaign: "summer" } }),
    ]);
    expect(out).toEqual([
      { source: "meta", campaign: "spring", paidOrgs: 2 },
      { source: "meta", campaign: "summer", paidOrgs: 1 },
    ]);
  });

  it("puts a paid conversion with no UTM in the direct/null bucket, not dropped", () => {
    const out = groupPaidBySource([row({ utm: null }), row({ utm: {} }), row({ utm: { utm_source: "  ", utm_campaign: "" } })]);
    expect(out).toEqual([{ source: "direct", campaign: null, paidOrgs: 3 }]);
  });

  it("keeps a source with no campaign distinct from one with a campaign", () => {
    const out = groupPaidBySource([
      row({ utm: { utm_source: "google" } }),
      row({ utm: { utm_source: "google", utm_campaign: "brand" } }),
    ]);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ source: "google", campaign: null, paidOrgs: 1 });
    expect(out).toContainEqual({ source: "google", campaign: "brand", paidOrgs: 1 });
  });
});

describe("route wiring", () => {
  it("adds paidBySource additively and keeps the founder gate + existing fields", () => {
    const src = readFileSync("server/routes-founder-customers.ts", "utf8");
    expect(src).toMatch(/isAuthenticated,\s*getOrCreateOrg,\s*requireFounder,/);
    expect(src).toMatch(/res\.json\(\{[\s\S]*topUtmSources,\s*paidBySource,\s*recentSignups,[\s\S]*\}\)/);
    expect(src).toContain("paidOrgCount,");
    // Binding assertion: replacing the grouping call with [] must go red.
    expect(src).toContain("const paidBySource = groupPaidBySource(");
  });
});
