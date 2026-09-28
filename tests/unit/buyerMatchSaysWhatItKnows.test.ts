/**
 * DEFECT-0177 — a buyer match says what it knows, offers only held land, and
 * never lets a stale score keep a buyer in the blast audience.
 *
 * From the 2026-09-28 practitioner supplement, verified at HEAD:
 *  - `matchPropertyToBuyers` had no status check. A SOLD or prospect parcel
 *    was matched, and each fresh match fired `buyer.match_created`, whose
 *    installed template emails the buyer "we found a property matching your
 *    criteria";
 *  - reasons stated conclusions the data cannot support: "Buyer qualifies for
 *    owner financing" from a 10%/60-month rule of thumb over self-reported
 *    capacity, "Buyer has cash to purchase" and "pre-approved" from the
 *    buyer's own form, "zoning supports RV use" from a substring of a label;
 *  - only matches scoring ≥ 40 were written, so an EXISTING match whose buyer
 *    no longer fit kept its old high score — and the buyer blast selects by
 *    stored score.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  property: null as null | Record<string, unknown>,
  buyers: [] as Array<Record<string, unknown>>,
  existing: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  emitted: vi.fn(),
}));

vi.mock("../../server/db", () => {
  const select = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    q.from = (t: Parameters<typeof getTableName>[0]) => {
      table = getTableName(t);
      return q;
    };
    const rows = () =>
      table === "properties" ? (h.property ? [h.property] : []) : table === "buyer_profiles" ? h.buyers : table === "buyer_property_matches" ? h.existing : [];
    q.where = () => Object.assign(Promise.resolve(rows()), { limit: async () => rows() });
    return q;
  };
  const update = () => ({
    set: (v: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          h.updates.push(v);
          return [{ id: 900, ...v }];
        },
      }),
    }),
  });
  const insert = () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        h.inserts.push(v);
        return [{ id: 901, ...v }];
      },
      onConflictDoUpdate: () => ({ catch: async () => undefined }),
    }),
  });
  return { db: { select, update, insert } };
});
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: vi.fn().mockReturnValue(null) }));
vi.mock("../../server/services/buyerEvents", () => ({ emitBuyerMatchCreated: h.emitted }));

import { BuyerMatchingAIService } from "../../server/services/buyerMatchingAI";

const svc = new BuyerMatchingAIService();

const property = (o: Record<string, unknown> = {}) => ({
  id: 3,
  organizationId: 7,
  status: "owned",
  state: "TX",
  county: "Travis",
  sizeAcres: "10",
  listPrice: "20000",
  zoning: "RV-1 recreational",
  ...o,
});
const buyer = (o: Record<string, unknown> = {}) => ({
  id: 11,
  organizationId: 7,
  isActive: true,
  leadId: null,
  preferences: { states: ["TX"], counties: ["Travis"], minAcreage: 5, maxAcreage: 20, useTypes: ["recreational"] },
  financialInfo: { budget: 25000, financingType: "owner_finance", downPaymentCapacity: 3000, monthlyPaymentCapacity: 400 },
  ...o,
});

beforeEach(() => {
  h.property = null;
  h.buyers = [];
  h.existing = [];
  h.updates = [];
  h.inserts = [];
  h.emitted.mockClear();
});

describe("reasons say what the data supports", () => {
  it("owner-finance fit is an illustration over stated capacity, never a qualification", () => {
    const { reasons } = svc.calculateMatchScore(buyer() as never, property() as never);
    const joined = reasons.join(" | ");
    expect(joined).not.toMatch(/qualifies/i);
    expect(joined).toMatch(/illustrative.*not a credit decision/i);
  });
  it("a zoning label is not a verified legal use", () => {
    const { reasons } = svc.calculateMatchScore(buyer() as never, property() as never);
    const zoning = reasons.find((r) => /zoning/i.test(r));
    expect(zoning).toMatch(/legal use not verified/);
    expect(zoning).not.toMatch(/supports/);
  });
  it("cash and pre-approval are self-reported", () => {
    const cash = svc.calculateMatchScore(
      buyer({ financialInfo: { budget: 25000, financingType: "cash" } }) as never,
      property() as never,
    ).reasons.join(" | ");
    expect(cash).not.toMatch(/Buyer has cash/);
    expect(cash).toMatch(/self-reported/);
    const pre = svc.calculateMatchScore(
      buyer({ financialInfo: { financingType: "bank", preApproved: true, preApprovalAmount: 30000 } }) as never,
      property() as never,
    ).reasons.join(" | ");
    expect(pre).toMatch(/pre-approval.*not verified/);
  });
  it("an estimated value is not called a price", () => {
    const r = svc.calculateMatchScore(buyer() as never, property({ listPrice: null, marketValue: "20000" }) as never).reasons;
    expect(r.join(" | ")).toMatch(/Estimated value \(no asking price set\)/);
  });
});

describe("only held land is matched", () => {
  it.each(["sold", "prospect", "offer_sent"])("a %s property is refused before any write or email", async (status) => {
    h.property = property({ status });
    h.buyers = [buyer()];
    await expect(svc.matchPropertyToBuyers(7, 3)).rejects.toMatchObject({ name: "BuyerMatchRefusal" });
    expect(h.inserts).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
    expect(h.emitted).not.toHaveBeenCalled();
  });
  it("buyer → properties never matches land the org does not hold", async () => {
    h.property = property({ status: "sold" });
    h.buyers = [buyer()];
    const out = await svc.matchBuyerToProperties(7, 11);
    expect(out).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
    expect(h.emitted).not.toHaveBeenCalled();
  });
  it("a held property still matches and emits once per new match", async () => {
    h.property = property();
    h.buyers = [buyer()];
    const out = await svc.matchPropertyToBuyers(7, 3);
    expect(out).toHaveLength(1);
    expect(h.inserts).toHaveLength(1);
    expect(h.emitted).toHaveBeenCalledTimes(1);
  });
});

describe("a stale score cannot keep a buyer in the audience", () => {
  it("buyer → properties re-scores an existing match too, and never emits for it", async () => {
    h.property = property();
    h.buyers = [buyer({ preferences: { states: ["ME"], minAcreage: 100, useTypes: ["industrial"] }, financialInfo: { budget: 2000 } })];
    h.existing = [{ id: 56, buyerProfileId: 11, propertyId: 3, matchScore: 88 }];
    const out = await svc.matchBuyerToProperties(7, 11);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].matchScore as number).toBeLessThan(40);
    expect(out).toHaveLength(0);
    expect(h.emitted).not.toHaveBeenCalled();
  });

  it("an existing match whose buyer no longer fits is re-scored below the threshold", async () => {
    h.property = property();
    // The buyer now wants 100+ acres in another state.
    h.buyers = [buyer({ preferences: { states: ["ME"], minAcreage: 100, useTypes: ["industrial"] }, financialInfo: { budget: 2000 } })];
    h.existing = [{ id: 55, buyerProfileId: 11, propertyId: 3, matchScore: 92 }];
    const out = await svc.matchPropertyToBuyers(7, 3);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].matchScore as number).toBeLessThan(40);
    expect(out).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
    expect(h.emitted).not.toHaveBeenCalled();
  });
});
