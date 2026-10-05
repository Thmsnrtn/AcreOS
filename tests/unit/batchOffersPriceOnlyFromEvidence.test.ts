/**
 * DEFECT-0172 — the generateBatchOffers agent skill prices only from evidence
 * and only for the source list's members.
 *
 * It started every lead at a $10,000 "market value" and kept it whenever the
 * lead had no property, no coordinates or no comps, storing a priced offer
 * (cash $2,500) on an invented number; and when the batch had a source list
 * it took EVERY lead in the org, ignoring the list's filters.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  leads: [] as Array<Record<string, unknown>>,
  props: [] as Array<Record<string, unknown>>,
  estimate: null as number | null,
  filters: null as Record<string, unknown> | null,
  /** What readListMembership answers for the source list (W10.3 member lists). */
  membership: { memberList: false, leads: [] as Array<Record<string, unknown>> },
  membershipReads: [] as Array<{ org: number; list: unknown }>,
  wholeBookReads: 0,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOfferBatchById: async () => ({ id: 1, sourceListId: 9 }),
    getOffersByBatch: async () => [],
    getMarketingListById: async () => ({ id: 9, filters: h.filters }),
    createOffer: async (o: Record<string, unknown>) => {
      h.created.push(o);
      return o;
    },
    updateOfferBatch: async () => undefined,
    // The pre-fix path read these; served so a red-first run exercises it.
    getLeads: async () => h.leads,
    getProperties: async () => h.props,
  },
}));
vi.mock("../../server/storage/wholeBookReads", () => ({
  readAllLeads: async () => {
    h.wholeBookReads++;
    return h.leads;
  },
  readPropertiesBySellerIds: async () => h.props,
}));
vi.mock("../../server/storage/listBuilderRepo", () => ({
  readListMembership: async (org: number, list: unknown) => {
    h.membershipReads.push({ org, list });
    return h.membership;
  },
}));
vi.mock("../../server/services/comps", () => ({
  getPropertyComps: async () => ({ marketAnalysis: { estimatedValue: h.estimate } }),
  calculateMarketValue: vi.fn(),
  calculateOfferPrices: vi.fn(),
  calculateDesirabilityScore: vi.fn(),
}));
vi.mock("../../server/services/paxPause", () => ({
  getPaxPauseState: async () => ({ paused: false }),
  paxPauseRefusalMessage: () => "",
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { skillRegistry } from "../../server/services/agent-skills";

const run = () =>
  skillRegistry.getSkillById("generateBatchOffers")!.execute({ batchId: 1 }, { organizationId: 7 } as never);

const lead = (id: number, state = "TX") => ({ id, state, county: "Travis", taxDelinquent: null });
const prop = (sellerId: number, over: Record<string, unknown> = {}) => ({
  id: 100 + sellerId,
  sellerId,
  state: "TX",
  county: "Travis",
  sizeAcres: "5",
  zoning: null,
  marketValue: null,
  latitude: "30.1",
  longitude: "-97.7",
  ...over,
});

beforeEach(() => {
  h.created.length = 0;
  h.leads = [];
  h.props = [];
  h.estimate = null;
  h.filters = null;
  h.membership = { memberList: false, leads: [] };
  h.membershipReads = [];
  h.wholeBookReads = 0;
});

describe("DEFECT-0172 — no invented price", () => {
  it("a lead with no linked property is skipped, not priced at $10,000", async () => {
    h.leads = [lead(1)];
    const r = await run();
    expect(h.created).toHaveLength(0);
    expect(JSON.stringify(r)).toMatch(/not priced — no linked property/);
  });

  it("a property whose comps give no estimate is skipped", async () => {
    h.leads = [lead(1)];
    h.props = [prop(1)];
    h.estimate = null;
    await run();
    expect(h.created).toHaveLength(0);
  });

  it("a real comps estimate prices the offer from it", async () => {
    h.leads = [lead(1)];
    h.props = [prop(1)];
    h.estimate = 40_000;
    await run();
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({ estimatedMarketValue: "40000", cashOffer: "10000" });
  });
});

describe("DEFECT-0172 — only the list's members", () => {
  it("a lead outside the list's states is not offered", async () => {
    h.filters = { states: ["AZ"] };
    h.leads = [lead(1, "TX")];
    h.props = [prop(1)];
    h.estimate = 40_000;
    await run();
    expect(h.created).toHaveLength(0);
  });

  it("a filter no record can answer (owner type) excludes rather than passes", async () => {
    h.filters = { ownerType: ["trust"] };
    h.leads = [lead(1)];
    h.props = [prop(1)];
    h.estimate = 40_000;
    await run();
    expect(h.created).toHaveLength(0);
  });

  it("a member matching every filter is offered", async () => {
    h.filters = { states: ["TX"], counties: ["Travis County"], acreageMin: 1 };
    h.leads = [lead(1)];
    h.props = [prop(1)];
    h.estimate = 40_000;
    await run();
    expect(h.created).toHaveLength(1);
  });
});

describe("W10.3 — a list that records its members offers exactly those members", () => {
  it("offers the list's members — not the book — and does not re-filter them by the list's stored filters", async () => {
    // A county list stores owner-type / years-owned filters no lead record can
    // answer; filtering its members by them would offer nobody. Its members
    // ARE the list.
    h.filters = { states: ["TX"], ownerType: ["trust"], yearsOwned: 10 };
    h.membership = { memberList: true, leads: [lead(2)] };
    h.leads = [lead(1), lead(2)]; // lead 1 is in the book but NOT on the list
    h.props = [prop(1), prop(2)];
    h.estimate = 40_000;
    await run();
    expect(h.created.map((o) => o.leadId)).toEqual([2]);
    expect(h.wholeBookReads).toBe(0);
    expect(h.membershipReads).toEqual([{ org: 7, list: expect.objectContaining({ id: 9 }) }]);
  });

  it("a member list whose members are all gone offers nobody — never the whole book", async () => {
    h.membership = { memberList: true, leads: [] };
    h.leads = [lead(1)];
    h.props = [prop(1)];
    h.estimate = 40_000;
    await run();
    expect(h.created).toHaveLength(0);
    expect(h.wholeBookReads).toBe(0);
  });
});

