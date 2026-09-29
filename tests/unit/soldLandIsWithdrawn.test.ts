/**
 * DEFECT-0181 — land that is no longer held comes off the market.
 *
 * A parcel that SOLD kept its listing "active" and live on every channel it
 * had reached: sync-all skipped it (DEFECT-0174) but no path asked for it
 * to come down, so buyers kept inquiring about land the org no longer had.
 * Every path that ends the holding — a status update, the lot-sale route,
 * soft-delete — now withdraws the listing with the same per-channel
 * transition unpublish uses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  listings: [] as Array<Record<string, unknown>>,
  propertyAfter: { id: 3, organizationId: 7, status: "sold" } as Record<string, unknown>,
  listingWrites: [] as Array<Record<string, unknown>>,
  ownedIds: [] as number[],
  writesByTable: [] as Array<{ table: string; set: Record<string, unknown> }>,
  deletes: [] as string[],
}));

vi.mock("../../server/db", () => {
  const select = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    q.from = (t: Parameters<typeof getTableName>[0]) => {
      table = getTableName(t);
      return q;
    };
    q.where = async () =>
      table === "property_listings" ? h.listings : table === "properties" ? h.ownedIds.map((id) => ({ id })) : [];
    return q;
  };
  const update = (t: Parameters<typeof getTableName>[0]) => ({
    set: (v: Record<string, unknown>) => {
      const table = getTableName(t);
      h.writesByTable.push({ table, set: v });
      if (table === "property_listings") h.listingWrites.push(v);
      const where = () =>
        Object.assign(Promise.resolve(undefined), {
          returning: async () =>
            table === "properties"
              ? h.ownedIds.length
                ? h.ownedIds.map((id) => ({ id, status: v.status }))
                : [{ ...h.propertyAfter, ...v }]
              : [],
        });
      return { where };
    },
  });
  const del = (t: Parameters<typeof getTableName>[0]) => ({
    where: async () => {
      h.deletes.push(getTableName(t));
    },
  });
  return { db: { select, update, delete: del } };
});
vi.mock("../../server/services/legalHold", () => ({ assertNotUnderLegalHold: vi.fn(async () => undefined) }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { stripComments } from "../helpers/stripComments";
import { withdrawnTargets } from "../../server/services/listingWithdrawal";
import { propertyRepo } from "../../server/storage/propertyRepo";

const live = () => ({
  id: 21,
  status: "active",
  syndicationTargets: [
    { platform: "land_com", status: "active", listingId: "ext-1" },
    { platform: "craigslist", status: "active" },
    { platform: "landwatch", status: "failed" },
  ],
});

beforeEach(() => {
  h.listings = [];
  h.listingWrites = [];
  h.ownedIds = [];
  h.writesByTable = [];
  h.deletes = [];
  h.propertyAfter = { id: 3, organizationId: 7, status: "sold" };
});

describe("the one withdrawal transition", () => {
  it("live targets need a take-down or a manual removal; nothing claims 'removed'", () => {
    const t = withdrawnTargets(live().syndicationTargets);
    expect(t.map((x) => x.status)).toEqual(["withdrawal_requested", "manual_action_required", "failed"]);
  });
});

describe("a property that stops being held withdraws its listings", () => {
  it("sold → the listing is marked sold and every live channel is asked to come down", async () => {
    h.listings = [live()];
    await propertyRepo.updateProperty.call({} as never, 3, { status: "sold" }, 7);
    expect(h.listingWrites).toHaveLength(1);
    expect(h.listingWrites[0].status).toBe("sold");
    const targets = h.listingWrites[0].syndicationTargets as Array<{ status: string }>;
    expect(targets.map((x) => x.status)).toEqual(["withdrawal_requested", "manual_action_required", "failed"]);
  });

  it("back to prospect → withdrawn", async () => {
    h.listings = [live()];
    h.propertyAfter = { id: 3, organizationId: 7, status: "prospect" };
    await propertyRepo.updateProperty.call({} as never, 3, { status: "prospect" }, 7);
    expect(h.listingWrites[0].status).toBe("withdrawn");
  });

  it("a held status, or an edit that doesn't touch status, leaves listings alone", async () => {
    h.listings = [live()];
    h.propertyAfter = { id: 3, organizationId: 7, status: "listed" };
    await propertyRepo.updateProperty.call({} as never, 3, { status: "listed" }, 7);
    await propertyRepo.updateProperty.call({} as never, 3, { county: "Luna" } as never, 7);
    expect(h.listingWrites).toHaveLength(0);
  });
});

describe("the bulk paths (DEFECT-0181 audit)", () => {
  it("a bulk status change to sold withdraws each owned property's listings", async () => {
    h.ownedIds = [3, 4];
    h.listings = [live()];
    const n = await propertyRepo.bulkUpdateProperties.call({} as never, 7, [3, 4, 99], { status: "sold" });
    expect(n).toBe(2); // the count is what was actually updated, not what was asked
    expect(h.listingWrites).toHaveLength(2);
    expect(h.listingWrites.every((w) => w.status === "sold")).toBe(true);
  });
});

describe("DEFECT-0183 — bulk delete touches only the org's own properties", () => {
  it("nothing is HARD-deleted, and another org's ids touch nothing at all", async () => {
    h.ownedIds = []; // none of the requested ids belong to org 7
    const n = await propertyRepo.bulkDeleteProperties.call({} as never, 7, [501, 502]);
    expect(n).toBe(0);
    expect(h.deletes).toEqual([]);
    expect(h.writesByTable).toEqual([]);
  });

  it("owned ids are soft-deleted, their deals soft-deleted, their listings withdrawn", async () => {
    h.ownedIds = [3];
    h.listings = [live()];
    const n = await propertyRepo.bulkDeleteProperties.call({} as never, 7, [3, 501]);
    expect(n).toBe(1);
    expect(h.deletes).toEqual([]);
    const tables = h.writesByTable.map((w) => `${w.table}:${w.set.status}`);
    expect(tables).toEqual(["properties:deleted", "deals:deleted", "property_listings:withdrawn"]);
  });
});

/**
 * The POPULATION: every server unit that can write a property's status. The
 * first version of this fix missed three (bulk update, the bulk route, the
 * lot PATCH) — found only by an audit. So: any file whose
 * `.update(properties).set(...)` names `status:` or passes a variable /
 * spread (which may carry status) must also call
 * withdrawListingsForUnheldProperty.
 */
const SERVER_FILES = execSync("git ls-files 'server/*.ts' 'server/**/*.ts'")
  .toString()
  .trim()
  .split("\n")
  .filter((f) => f && !/\.test\.ts$/.test(f));

function statusWriteCount(src: string): number {
  const code = stripComments(src);
  const re = /\.update\(\s*properties\s*\)\s*\.set\(\s*([^;]*?)(?:;|\n\s*\n)/g;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const body = m[1];
    if (/\bstatus\s*:/.test(body) || /^[A-Za-z_$][\w$]*\s*\)/.test(body) || /^\{\s*\.\.\./.test(body)) n++;
  }
  return n;
}

describe("every property-status writer withdraws unheld land", () => {
  it("the detector sees each writer shape (canaries)", () => {
    expect(statusWriteCount('await db.update(properties).set({ status: "sold" }).where(x);')).toBe(1);
    expect(statusWriteCount("await db.update(properties).set(updates).where(x);")).toBe(1);
    expect(statusWriteCount("await tx.update(properties).set({ ...patch, updatedAt: now }).where(x);")).toBe(1);
    expect(statusWriteCount("await db.update(properties).set({ county: c }).where(x);")).toBe(0);
  });

  it("the population is real (floor) and the known writers are in it", () => {
    expect(SERVER_FILES.length).toBeGreaterThan(1000);
    const writers = SERVER_FILES.filter((f) => statusWriteCount(readFileSync(f, "utf8")) > 0);
    expect(writers).toEqual(
      expect.arrayContaining([
        "server/storage/propertyRepo.ts",
        "server/routes-bulk.ts",
        "server/routes-lot-basis.ts",
        "server/routes-subdivisions.ts",
      ]),
    );
  });

  it("each writer calls withdrawListingsForUnheldProperty", () => {
    const missing = SERVER_FILES.filter((f) => {
      const src = readFileSync(f, "utf8");
      return statusWriteCount(src) > 0 && !stripComments(src).includes("withdrawListingsForUnheldProperty(");
    });
    expect(missing).toEqual([]);
  });
});
