/**
 * Merging two leads deletes the duplicate. A legal hold on the duplicate
 * refuses the whole merge before anything is written, and the delete itself
 * runs with the organization so the hold check applies there too.
 */
import { describe, it, expect, vi } from "vitest";

const held = vi.hoisted(() => ({ ids: new Set<number>() }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/legalHold", () => ({
  assertNotUnderLegalHold: vi.fn(async (_org: number, _type: string, id: number) => {
    if (held.ids.has(id)) throw new Error("Record is under legal hold");
  }),
  filterOutHeldIds: vi.fn(async (_o: number, _t: string, ids: number[]) => ids),
}));

const lead = (id: number) => ({
  id, organizationId: 7, firstName: "Ann", lastName: "Owner", phone: "512-555-0100", email: "ann@example.com",
  apn: "A-1", county: "Travis", status: "new",
});

function harness() {
  const calls = { update: 0, deleted: [] as Array<[number, number | undefined]> };
  const self = {
    getLead: async (_org: number, id: number) => lead(id),
    updateLead: async (_id: number, patch: Record<string, unknown>) => {
      calls.update++;
      return { ...lead(1), ...patch };
    },
    deleteLead: async (id: number, org?: number) => {
      calls.deleted.push([id, org]);
    },
    logActivity: async () => undefined,
  };
  return { self, calls };
}

describe("lead merge and legal hold", () => {
  it("a held duplicate refuses the merge before the primary is rewritten or anything is deleted", async () => {
    held.ids = new Set([2]);
    const { leadRepo } = await import("../../server/storage/leadRepo");
    const { self, calls } = harness();
    await expect(leadRepo.mergeLeads.call(self as never, 7, 1, 2)).rejects.toThrow(/legal hold/);
    expect(calls.update).toBe(0);
    expect(calls.deleted).toEqual([]);
  });

  it("an unheld merge deletes the duplicate with the organization", async () => {
    held.ids = new Set();
    const { leadRepo } = await import("../../server/storage/leadRepo");
    const { self, calls } = harness();
    await leadRepo.mergeLeads.call(self as never, 7, 1, 2);
    expect(calls.deleted).toEqual([[2, 7]]);
  });
});
