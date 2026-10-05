/**
 * scrubLeadList reads the whole book (DEFECT-0171) without widening its paid
 * lookups with it, and reports only what it did (W10.2b).
 *
 * The skill calls the data broker once per addressed lead. While it read the
 * capped newest-5,000 list that was bounded by accident; reading every lead
 * made it unbounded. It now validates at most 5,000 addresses per run and
 * counts the rest — and any lookup that errored — as `unvalidated`, never
 * valid. It also used to count every addressed lead as "enriched" and bill 2
 * per lead for an enrichment that never ran.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const H = vi.hoisted(() => ({
  leads: [] as Array<{ id: number; address: string | null; city: string | null; state: string | null; createdAt: Date }>,
  lookups: 0,
  looked: [] as string[],
  failAddress: "" as string,
  notFound: new Set<string>(),
  noSource: new Set<string>(),
  update: undefined as Record<string, unknown> | undefined,
  /** Members of list 4 (a county list); list 3 records none (a legacy list). */
  members: [] as Array<{ id: number; address: string | null; city: string | null; state: string | null; createdAt: Date }>,
  wholeBookReads: 0,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getMarketingListById: vi.fn(async (org: number, id: number) =>
      org === 5 && id === 3 ? { id: 3, source: "propstream" } : org === 5 && id === 4 ? { id: 4, source: "county_records" } : undefined,
    ),
    updateMarketingList: vi.fn(async (_o: number, _id: number, patch: Record<string, unknown>) => {
      H.update = patch;
      return patch;
    }),
  },
}));
vi.mock("../../server/storage/wholeBookReads", () => ({
  readAllLeads: vi.fn(async (org: number) => {
    H.wholeBookReads++;
    return org === 5 ? H.leads : [];
  }),
}));
vi.mock("../../server/storage/listBuilderRepo", () => ({
  readListMembership: vi.fn(async (org: number, list: { id: number; source: string | null }) =>
    org === 5 && list.id === 4 ? { memberList: true, leads: H.members } : { memberList: false, leads: [] },
  ),
}));
vi.mock("../../server/services/data-source-broker", () => ({
  dataSourceBroker: {
    lookup: vi.fn(async (_c: string, q: { address?: string }) => {
      H.lookups++;
      H.looked.push(q.address ?? "");
      if (q.address === H.failAddress) throw new Error("provider down");
      // The broker's shapes: a real source that found no parcel, and no source at all.
      if (H.notFound.has(q.address ?? "")) return { success: false, data: null, source: { id: 7, title: "Regrid" } };
      if (H.noSource.has(q.address ?? "")) return { success: false, data: null, source: { id: 0, title: "None" } };
      return { success: true, data: {}, source: { id: 7, title: "Regrid" } };
    }),
  },
}));

const { skillRegistry } = await import("../../server/services/agent-skills");

beforeEach(() => {
  H.leads = [];
  H.lookups = 0;
  H.looked = [];
  H.failAddress = "";
  H.notFound = new Set();
  H.noSource = new Set();
  H.update = undefined;
  H.members = [];
  H.wholeBookReads = 0;
});

// readAllLeads pages by id ascending; a higher id is a newer lead here.
const lead = (i: number) => ({ id: i, address: `${i} Main St`, city: "Waco", state: "TX", createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000) });

describe("scrubLeadList", () => {
  it("validates at most 5,000 addresses per run; the rest are counted unvalidated, not valid", async () => {
    H.leads = Array.from({ length: 6200 }, (_, i) => lead(i + 1));
    const skill = skillRegistry.getSkillById("scrubLeadList")!;
    expect(skill, "vacuity: the skill is registered").toBeDefined();
    const r = await skill.execute({ listId: 3 }, { organizationId: 5 });
    expect(r.success).toBe(true);
    expect(H.lookups).toBe(5000);
    // The NEWEST 5,000 are validated — not the same oldest 5,000 every run.
    expect(H.looked[0]).toBe("6200 Main St");
    expect(H.looked).not.toContain("1 Main St");
    expect(H.looked).toContain("1201 Main St");
    expect(r.data).toMatchObject({ total: 6200, valid: 5000, unvalidated: 1200, invalid: 0 });
    expect(H.update).toMatchObject({ totalRecords: 6200, validRecords: 5000 });
    // It must not suggest that running again reaches the rest: a re-run
    // validates the same newest 5,000.
    expect(r.message).toMatch(/1200 not validated \(the lookup failed, or the lead is older than the newest 5000 addresses a scrub validates\)/);
    expect(r.message).not.toMatch(/per run|run again/i);
  });

  it("a lookup that errors leaves the address unvalidated, not valid", async () => {
    H.leads = [lead(1), lead(2)];
    H.failAddress = "2 Main St";
    const r = await skillRegistry.getSkillById("scrubLeadList")!.execute({ listId: 3 }, { organizationId: 5 });
    expect(r.data).toMatchObject({ total: 2, valid: 1, unvalidated: 1 });
  });

  it("no source answering is not a verdict: unvalidated, never stored as an invalid address", async () => {
    H.leads = [lead(1), lead(2), lead(3)];
    H.notFound = new Set(["2 Main St"]);
    H.noSource = new Set(["3 Main St"]);
    const r = await skillRegistry.getSkillById("scrubLeadList")!.execute({ listId: 3 }, { organizationId: 5 });
    expect(r.data).toMatchObject({ total: 3, valid: 1, invalid: 1, unvalidated: 1 });
    expect(H.update).toMatchObject({ validRecords: 1, invalidAddresses: 1 });
  });

  it("a duplicate address is counted once and looked up once", async () => {
    H.leads = [lead(1), { ...lead(2), address: "1 Main St" }];
    const r = await skillRegistry.getSkillById("scrubLeadList")!.execute({ listId: 3 }, { organizationId: 5 });
    expect(r.data).toMatchObject({ total: 2, valid: 1, duplicates: 1 });
    expect(H.looked).toEqual(["1 Main St"]);
    expect(H.update).toMatchObject({ validRecords: 1 });
  });

  it("enrichment that does not exist is neither counted nor billed", async () => {
    H.leads = [lead(1), lead(2)];
    const r = await skillRegistry
      .getSkillById("scrubLeadList")!
      .execute({ listId: 3, options: { enrichParcelData: true } }, { organizationId: 5 });
    expect(r.data.enriched).toBe(0);
    expect(r.costIncurred).toBe(0);
    expect(r.message).toMatch(/enrichment is not available/);
  });

  it("W10.3: a list that records its members scrubs exactly those members — not the book", async () => {
    H.leads = Array.from({ length: 50 }, (_, i) => lead(i + 1));
    H.members = [lead(7), lead(9), { ...lead(11), address: "7 Main St" }];
    const r = await skillRegistry.getSkillById("scrubLeadList")!.execute({ listId: 4 }, { organizationId: 5 });
    expect(r.success).toBe(true);
    expect(H.wholeBookReads).toBe(0);
    expect(r.data).toMatchObject({ total: 3, valid: 2, duplicates: 1 });
    expect(H.looked.sort()).toEqual(["7 Main St", "9 Main St"]);
    expect(H.update).toMatchObject({ totalRecords: 3, validRecords: 2, duplicatesRemoved: 1 });
  });

  it("W10.3: the validation cap still holds for a member list (newest first)", async () => {
    H.members = Array.from({ length: 5003 }, (_, i) => lead(i + 1));
    const r = await skillRegistry.getSkillById("scrubLeadList")!.execute({ listId: 4 }, { organizationId: 5 });
    expect(H.lookups).toBe(5000);
    expect(H.looked[0]).toBe("5003 Main St");
    expect(r.data).toMatchObject({ total: 5003, valid: 5000, unvalidated: 3 });
  });
});
