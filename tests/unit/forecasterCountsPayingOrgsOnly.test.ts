/**
 * DEFECT-0133 (audit follow-up) — the founder forecast counts paying orgs only.
 *
 * financialForecaster (projectMRR, the burn estimate and
 * calculateUnitEconomics, behind /api/founder/intelligence/forecast) called
 * an org "paying" when it had a priced tier, whatever its subscription status
 * — so trialing, past-due and cancelled orgs were revenue and customers.
 * This drives the real functions and renders every organizations WHERE.
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({ wheres: [] as Array<{ table: string; where: unknown }> }));

vi.mock("../../server/db", () => {
  const chain = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    const self = new Proxy(q, {
      get(target, prop) {
        if (prop === "then") return (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve([]).then(f, r);
        if (prop === "from") return (t: unknown) => { try { table = getTableName(t as never); } catch { table = "?"; } return self; };
        if (prop === "where") return (w: unknown) => { h.wheres.push({ table, where: w }); return self; };
        return () => self;
      },
    });
    return self;
  };
  return { db: { select: () => chain(), execute: async () => ({ rows: [] }) } };
});
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { calculateUnitEconomics } from "../../server/services/financialForecaster";

describe("DEFECT-0133 — forecaster paying-org rule", () => {
  it("every organizations query requires an active subscription", async () => {
    h.wheres.length = 0;
    await calculateUnitEconomics().catch(() => undefined);
    const orgQueries = h.wheres.filter((w) => w.table === "organizations");
    expect(orgQueries.length, "no organizations query was read (vacuity)").toBeGreaterThanOrEqual(2);
    const dialect = new PgDialect();
    let paying = 0;
    for (const q of orgQueries) {
      const rendered = dialect.sqlToQuery(q.where as SQL).sql;
      // The paying-org queries (the churn proxy is a separate, recorded defect).
      if (!/!= 'free'/.test(rendered)) continue;
      paying++;
      expect(rendered).toMatch(/"subscription_status" = 'active'/);
    }
    expect(paying, "the paying-org count query was not read (vacuity)").toBeGreaterThanOrEqual(1);
  });

  it("DEFECT-0144: churn is read from subscription endings, not from touched free orgs", async () => {
    h.wheres.length = 0;
    await calculateUnitEconomics().catch(() => undefined);
    const dialect = new PgDialect();
    const rendered = h.wheres.map((w) => {
      const q = dialect.sqlToQuery(w.where as SQL);
      return { table: w.table, sql: q.sql, params: q.params };
    });
    const churn = rendered.filter((r) => r.table === "subscription_events");
    expect(churn, "churn is not read from subscription_events").toHaveLength(1);
    expect(churn[0].params).toContain("cancel");
    // A trial that ended without paying is not churn (DEFECT-0149).
    expect(churn[0].params).not.toContain("trial_end");
    expect(rendered.some((r) => r.table === "organizations" && /updated_at/.test(r.sql))).toBe(false);
  });

  it("DEFECT-0144: no observed churn is not a 24-month lifetime", async () => {
    const u = await calculateUnitEconomics();
    expect(u.monthlyChurnRate).toBe(0);
    expect(u.customerLifetimeMonths).toBeNull();
    expect(u.estimatedLTV).toBeNull();
  });
});
