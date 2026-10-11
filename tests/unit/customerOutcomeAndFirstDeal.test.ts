/**
 * W5b: the customer outcome metric and the first-deal program are computed
 * from REAL records only.
 *
 * Outcome (shared/outcomes/customerOutcome.ts):
 *   - a missing cost basis REFUSES the profit figure (it is never read as $0,
 *     and a partial total is never shown as the whole);
 *   - owner-financed sales and sales with no price are left out and counted;
 *   - closing costs recorded on either side are subtracted;
 *   - the founder aggregate carries no organization identifier.
 * The service reads closed, non-deleted, non-sample deals of ONE org
 * (WHERE rendered with the Postgres dialect).
 *
 * First deal (shared/growth/firstDeal.ts): the next step follows the records
 * — no list → import; list → send; sent → follow up; replies → work them;
 * accepted → closing checklist from the deal's own fields; closed → done.
 * Today renders it, and Pax gets the same projection on BOTH chat paths.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import {
  aggregateCustomerOutcomes,
  computeCustomerOutcome,
} from "../../shared/outcomes/customerOutcome";
import { firstDealMentorBrief, nextFirstDealStep, type FirstDealState } from "../../shared/growth/firstDeal";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const deal = (o: Partial<{ id: number; type: string; propertyId: number; acceptedAmount: string | null; closingCosts: string | null }>) => ({
  id: 1,
  type: "disposition",
  propertyId: 1,
  acceptedAmount: null,
  closingCosts: null,
  closingDate: null,
  ...o,
});

describe("customer outcome — real records, refuse not fabricate", () => {
  it("profit = sale − basis − recorded closing costs, per sold parcel", () => {
    const o = computeCustomerOutcome({
      closedDeals: [
        deal({ id: 1, type: "acquisition", propertyId: 10, acceptedAmount: "5000", closingCosts: "300" }),
        deal({ id: 2, type: "disposition", propertyId: 10, acceptedAmount: "12000.50", closingCosts: "450" }),
        deal({ id: 3, type: "disposition", propertyId: 11, acceptedAmount: null }),
      ],
      properties: [
        { id: 10, purchasePrice: "9999", soldPrice: "1" }, // deal amounts win over the property's
        { id: 11, purchasePrice: "2000", soldPrice: "6000" }, // falls back to the property's sold price
      ],
      ownerFinancedPropertyIds: [],
    });
    expect(o.dealsClosed).toEqual({ total: 3, acquisitions: 1, dispositions: 2, other: 0 });
    expect(o.realisedProfit).toEqual({ status: "shown", cents: 1200050 - 500000 - 30000 - 45000 + (600000 - 200000), salesCounted: 2 });
    expect(o.closingCostsRecordedOn).toBe(2);
    expect(o.included).toMatch(/closed deals only/);
  });

  it("a sale with NO cost basis refuses the whole figure — never $0, never a partial total", () => {
    const o = computeCustomerOutcome({
      closedDeals: [deal({ id: 1, propertyId: 10, acceptedAmount: "9000" }), deal({ id: 2, propertyId: 11, acceptedAmount: "9000" })],
      properties: [
        { id: 10, purchasePrice: "1000", soldPrice: null },
        { id: 11, purchasePrice: null, soldPrice: null },
      ],
      ownerFinancedPropertyIds: [],
    });
    expect(o.realisedProfit.status).toBe("refused");
    if (o.realisedProfit.status === "refused") {
      expect(o.realisedProfit.salesMissingCostBasis).toBe(1);
      expect(o.realisedProfit.propertyIds).toEqual([11]);
      expect(o.realisedProfit.reason).toMatch(/no purchase price/);
    }
    expect(JSON.stringify(o)).not.toMatch(/"cents"/);
  });

  it("an empty purchase price is missing, not zero; a recorded $0 basis is a basis", () => {
    const sale = [deal({ propertyId: 1, acceptedAmount: "500" })];
    expect(computeCustomerOutcome({ closedDeals: sale, properties: [{ id: 1, purchasePrice: "", soldPrice: null }], ownerFinancedPropertyIds: [] }).realisedProfit.status).toBe("refused");
    expect(computeCustomerOutcome({ closedDeals: sale, properties: [{ id: 1, purchasePrice: "0", soldPrice: null }], ownerFinancedPropertyIds: [] }).realisedProfit).toEqual({ status: "shown", cents: 50000, salesCounted: 1 });
  });

  it("owner-financed sales and price-less sales are left out and counted", () => {
    const o = computeCustomerOutcome({
      closedDeals: [deal({ id: 1, propertyId: 10, acceptedAmount: "9000" }), deal({ id: 2, propertyId: 12 })],
      properties: [{ id: 10, purchasePrice: null, soldPrice: null }, { id: 12, purchasePrice: "100", soldPrice: null }],
      ownerFinancedPropertyIds: new Set([10]),
    });
    expect(o.excluded).toEqual({ ownerFinancedSales: 1, salesMissingSalePrice: 1 });
    expect(o.realisedProfit.status).toBe("no_sales");
  });

  it("the founder aggregate sums shown orgs, counts refused ones, and names no organization", () => {
    const shown = computeCustomerOutcome({
      closedDeals: [deal({ propertyId: 1, acceptedAmount: "300" })],
      properties: [{ id: 1, purchasePrice: "100", soldPrice: null }],
      ownerFinancedPropertyIds: [],
    });
    const refused = computeCustomerOutcome({
      closedDeals: [deal({ propertyId: 2, acceptedAmount: "300" })],
      properties: [{ id: 2, purchasePrice: null, soldPrice: null }],
      ownerFinancedPropertyIds: [],
    });
    const none = computeCustomerOutcome({ closedDeals: [], properties: [], ownerFinancedPropertyIds: [] });
    const agg = aggregateCustomerOutcomes([shown, refused, none]);
    expect(agg).toMatchObject({ orgsWithAClosedDeal: 2, dealsClosed: 2, realisedProfitCents: 20000, orgsProfitShown: 1, orgsProfitRefused: 1, salesCounted: 1 });
    expect(Object.keys(agg).some((k) => /org(anization)?Id|propertyIds/i.test(k))).toBe(false);
    expect(JSON.stringify(agg)).not.toMatch(/propertyIds/);
  });
});

// ── the service reads one org's real, closed, non-deleted, non-sample deals ─

const W = vi.hoisted(() => ({ wheres: [] as Array<{ table: string; where: unknown }> }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const select = () => {
    let table = "";
    const q: any = {
      from: (t: unknown) => {
        table = getTableName(t as never);
        return q;
      },
      where: (w: unknown) => {
        W.wheres.push({ table, where: w });
        return Object.assign(Promise.resolve([]), { limit: () => Promise.resolve([]), orderBy: () => ({ limit: () => Promise.resolve([]) }) });
      },
      innerJoin: () => q,
    };
    return q;
  };
  return { db: { select, selectDistinct: select } };
});

describe("the outcome service's queries", () => {
  it("are org-scoped and exclude deleted, unclosed and sample-book deals", async () => {
    W.wheres.length = 0;
    const { customerOutcomeForOrg } = await import("../../server/services/growth/customerOutcome");
    const out = await customerOutcomeForOrg(4242);
    expect(out.dealsClosed.total).toBe(0);
    const d = new PgDialect();
    const dealWhere = W.wheres.find((w) => w.table === "deals");
    expect(dealWhere, "the service read deals").toBeTruthy();
    const q = d.sqlToQuery(dealWhere!.where as SQL);
    expect(q.sql).toMatch(/"deals"\."organization_id" = \$\d/);
    expect(q.params).toContain(4242);
    expect(q.sql).toMatch(/"deals"\."status" in/);
    expect(q.params).toEqual(expect.arrayContaining(["closed"]));
    expect(q.sql).toMatch(/"deals"\."deleted_at" is null/);
    expect(q.sql).toMatch(/NOT EXISTS/);
    expect(q.params).toContain("SAMPLE-%");
  });
});

// ── first deal ──────────────────────────────────────────────────────────────

const base: FirstDealState = {
  orgCreatedAt: new Date("2026-09-01T00:00:00Z"),
  now: new Date("2026-09-23T12:00:00Z"),
  leadCount: 0,
  outreachSentCount: 0,
  repliedLeadCount: 0,
  acceptedDeal: null,
  closedDealCount: 0,
};

describe("first-deal program — the next step follows the records", () => {
  it.each([
    [{}, "import"],
    [{ leadCount: 40 }, "send"],
    [{ leadCount: 40, outreachSentCount: 40 }, "follow_up_unanswered"],
    [{ leadCount: 40, outreachSentCount: 40, repliedLeadCount: 3 }, "work_replies"],
    [{ leadCount: 40, outreachSentCount: 40, repliedLeadCount: 3, acceptedDeal: { id: 7, titleCompany: "First Title", escrowNumber: null, closingDate: null, documentCount: 0, dueDiligenceDone: null } }, "close"],
    [{ leadCount: 40, closedDealCount: 1 }, "done"],
  ] as Array<[Partial<FirstDealState>, string]>)("%o → %s", (patch, step) => {
    expect(nextFirstDealStep({ ...base, ...patch }).step).toBe(step);
  });

  it("the closing checklist shows only what the deal's record shows", () => {
    const s = nextFirstDealStep({ ...base, leadCount: 1, acceptedDeal: { id: 7, titleCompany: "First Title", escrowNumber: "", closingDate: new Date(), documentCount: 0, dueDiligenceDone: true } });
    expect(s.checklist!.filter((c) => c.done).map((c) => c.id)).toEqual(["title_company", "due_diligence", "closing_date"]);
    expect(s.cta!.href).toBe("/deals/7");
  });

  it("counts days honestly and admits the window passed", () => {
    expect(nextFirstDealStep(base).day).toBe(23);
    const late = nextFirstDealStep({ ...base, now: new Date("2026-12-15T00:00:00Z") });
    expect(late.withinProgram).toBe(false);
    expect(firstDealMentorBrief(late)).toMatch(/past the 90-day program window/);
  });

  it("the mentor brief carries the record counts and forbids invented numbers", () => {
    const b = firstDealMentorBrief(nextFirstDealStep({ ...base, leadCount: 12, outreachSentCount: 12 }));
    expect(b).toMatch(/12 leads, 12 outreach pieces sent, 0 owners replied/);
    expect(b).toMatch(/do not invent numbers/);
  });

  it("Today renders the card; Pax gets the mentor + language context on BOTH chat paths", () => {
    const today = stripComments(fs.readFileSync(path.join(ROOT, "client/src/pages/today.tsx"), "utf8"));
    expect(today).toMatch(/<FirstDealCard \/>/);
    const exec = stripComments(fs.readFileSync(path.join(ROOT, "server/ai/executive.ts"), "utf8"));
    expect(exec.match(/\+ _mentorCtx \+ _languageCtx;/g)?.length).toBe(2);
    expect(exec.match(/export async function\*? processChat(Stream)?\(/g)?.length).toBe(2);
  });
});
