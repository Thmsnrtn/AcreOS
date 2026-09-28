/**
 * DEFECT-0174 audit — sync-all offers only held land, and never re-posts a
 * listing onto a channel it was withdrawn or taken down from.
 *
 * A listing published while the parcel was owned stays "active" after a
 * sale, so `syncChannels` pushed sold land to every enabled channel; and a
 * target marked `removed` / `withdrawal_requested` was treated as "not live
 * here", so the next sync undid a verified take-down.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  listings: [] as Array<Record<string, unknown>>,
  properties: [] as Array<Record<string, unknown>>,
  pushed: [] as Array<{ listingTitle: string; platforms: string[] }>,
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
      table === "syndication_channel_states"
        ? [{ channelId: "land_com", enabled: true }, { channelId: "landwatch", enabled: true }]
        : table === "property_listings"
          ? h.listings
          : table === "properties"
            ? h.properties
            : table === "organizations"
              ? [{ id: 7 }]
              : [];
    return q;
  };
  const update = () => ({ set: () => ({ where: async () => undefined }) });
  const insert = () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) });
  return { db: { select, update, insert } };
});
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/listingSyndication", () => ({
  PLATFORMS: {
    land_com: { apiAvailable: true, envKeys: [] },
    landwatch: { apiAvailable: true, envKeys: [] },
  },
  buildNormalizedListing: async (p: { id: number }) => ({ title: `parcel-${p.id}` }),
  syndicateListing: async (n: { title: string }, platforms: string[]) => {
    h.pushed.push({ listingTitle: n.title, platforms });
    return platforms.map((platform) => ({ platform, success: true, listingId: `x-${platform}` }));
  },
}));

import { syncChannels } from "../../server/services/syndicationChannels";

beforeEach(() => {
  h.pushed = [];
  h.listings = [];
  h.properties = [];
});

describe("syncChannels", () => {
  it("never pushes a listing whose parcel is no longer held", async () => {
    h.properties = [{ id: 1, status: "sold" }, { id: 2, status: "owned" }];
    h.listings = [
      { id: 10, propertyId: 1, status: "active", syndicationTargets: [] },
      { id: 11, propertyId: 2, status: "active", syndicationTargets: [] },
    ];
    await syncChannels(7);
    expect(h.pushed.map((p) => p.listingTitle)).toEqual(["parcel-2"]);
  });

  it.each(["removed", "withdrawal_requested", "withdrawal_failed", "manual_action_required", "active"])(
    "a %s target is not re-posted; a failed one is retried",
    async (status) => {
      h.properties = [{ id: 2, status: "owned" }];
      h.listings = [
        {
          id: 11,
          propertyId: 2,
          status: "active",
          syndicationTargets: [
            { platform: "land_com", status },
            { platform: "landwatch", status: "failed" },
          ],
        },
      ];
      await syncChannels(7);
      expect(h.pushed).toEqual([{ listingTitle: "parcel-2", platforms: ["landwatch"] }]);
    },
  );
});
