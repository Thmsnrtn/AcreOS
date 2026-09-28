/**
 * DEFECT-0161 — one owner with several parcels is not a duplicate.
 *
 * Once imports kept every parcel as its own lead (DEFECT-0140), the dedupe
 * scanner clustered exactly that shape — same owner phone / email / name —
 * as duplicates, and mergeLeads deleted the "duplicate" without carrying its
 * APN or county. The dedupe page invited an operator to undo the fix and lose
 * a parcel. The scanner now skips all-distinct-parcel clusters, and a merge
 * of two different parcels is refused.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../../server/db", () => ({
  db: {
    select: () => {
      const q: Record<string, unknown> = {};
      q.from = () => q;
      q.where = () => q;
      q.limit = async () => h.rows;
      return q;
    },
  },
}));

import { findDuplicateClusters } from "../../server/services/leadDedupeScanner";
import { areDistinctParcels } from "../../server/services/leads/parcelDedupe";

const lead = (id: number, apn: string | null, county = "Travis") => ({
  id, organizationId: 7, firstName: "Ann", lastName: "Owner", phone: "512-555-0100", email: "ann@example.com",
  address: "1 Main", city: "Austin", state: "TX", county, apn, status: "new",
});

describe("DEFECT-0161", () => {
  it("an owner's three different parcels are not a duplicate cluster", async () => {
    h.rows = [lead(1, "A-1"), lead(2, "A-2"), lead(3, "A-1", "Harris")];
    expect(await findDuplicateClusters(7)).toEqual([]);
  });

  it("the same parcel twice still clusters (anchor)", async () => {
    h.rows = [lead(1, "A-1"), lead(2, "a-1")];
    const clusters = await findDuplicateClusters(7);
    expect(clusters.length).toBeGreaterThan(0);
  });

  it("a lead without an APN still clusters with a same-phone lead (anchor)", async () => {
    h.rows = [lead(1, "A-1"), lead(2, null)];
    expect((await findDuplicateClusters(7)).length).toBeGreaterThan(0);
  });

  it("the merge refuses two different parcels and keeps a parcel it merges", () => {
    expect(areDistinctParcels(lead(1, "A-1"), lead(2, "A-2"))).toBe(true);
    expect(areDistinctParcels(lead(1, "A-1"), lead(2, "a-1"))).toBe(false);
    const repo = stripComments(readFileSync(resolve(__dirname, "../../server/storage/leadRepo.ts"), "utf8"));
    const body = repo.slice(repo.indexOf("async mergeLeads("), repo.indexOf("async getLeadsNeedingScoring("));
    expect(body).toMatch(/if \(areDistinctParcels\(primary, duplicate\)\)\s*\{\s*throw/);
  });

  // Audit follow-up: a bucket mixing one parcel's duplicates with a different
  // parcel was offered whole, and the page's merge-all then failed on it.
  it("a mixed bucket offers the same-parcel pair, never the other parcel", async () => {
    h.rows = [lead(1, "A-1"), lead(2, "a-1"), lead(3, "B-9")];
    const clusters = await findDuplicateClusters(7);
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      const ids = c.leads.map((l) => l.id).sort();
      expect(ids).toEqual([1, 2]);
    }
  });
});

describe("DEFECT-0161 — mergeLeads moves the parcel as one unit", () => {
  const harness = (primary: Record<string, unknown>, duplicate: Record<string, unknown>) => {
    const calls = { update: [] as Array<Record<string, unknown>>, deleted: [] as number[] };
    const self = {
      getLead: async (_org: number, id: number) => (id === 1 ? primary : duplicate),
      updateLead: async (_id: number, patch: Record<string, unknown>) => {
        calls.update.push(patch);
        return { ...primary, ...patch };
      },
      deleteLead: async (id: number) => {
        calls.deleted.push(id);
      },
      logActivity: async () => undefined,
    };
    return { self, calls };
  };

  it("a primary with a county but no APN takes the duplicate's WHOLE parcel", async () => {
    const { leadRepo } = await import("../../server/storage/leadRepo");
    const { self, calls } = harness(
      { ...lead(1, null, "Harris") },
      { ...lead(2, "A-1", "Travis"), acreage: "10.5", propertyAddress: "RR 12", taxDelinquent: true },
    );
    await leadRepo.mergeLeads.call(self as never, 7, 1, 2);
    expect(calls.update[0]).toMatchObject({ apn: "A-1", county: "Travis", acreage: "10.5", propertyAddress: "RR 12", taxDelinquent: true });
  });

  it("a duplicate with no APN cannot lend parcel attributes to a primary that has one", async () => {
    const { leadRepo } = await import("../../server/storage/leadRepo");
    const { self, calls } = harness({ ...lead(1, "A-1") }, { ...lead(2, null), acreage: "400" });
    await leadRepo.mergeLeads.call(self as never, 7, 1, 2);
    expect(calls.update[0]).not.toHaveProperty("acreage");
  });

  it("two distinct parcels are refused before anything is deleted", async () => {
    const { leadRepo } = await import("../../server/storage/leadRepo");
    const { self, calls } = harness({ ...lead(1, "A-1") }, { ...lead(2, "A-2") });
    await expect(leadRepo.mergeLeads.call(self as never, 7, 1, 2)).rejects.toThrow(/different parcels/);
    expect(calls.deleted).toEqual([]);
  });
});
