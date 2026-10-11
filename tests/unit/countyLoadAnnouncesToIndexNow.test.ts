/**
 * Built-but-unwired guard (W3): when a county's parcels land, its new public
 * pages are announced to IndexNow. Checked by CALLING the Comptroller loader
 * (persistLoadedCounty), the path Tennessee arrives by. The on-demand
 * pipeline's completion branch makes the same call (countyPipeline.ts); it is
 * not exercised here.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ announce: vi.fn(async () => undefined), recordReceipt: vi.fn(async () => undefined) }));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([]),
    values: () => chain,
    onConflictDoNothing: () => Promise.resolve(),
    set: () => chain,
    then: (res: any) => Promise.resolve([]).then(res),
  };
  return { db: { select: () => chain, insert: () => chain, update: () => chain } };
});
vi.mock("../../server/services/publicCountyGuide", () => ({ announceCountyLoaded: h.announce }));
vi.mock("../../server/services/landData/openDataBucket", () => ({ recordReceipt: h.recordReceipt }));

import { persistLoadedCounty } from "../../server/services/landData/ownedParcelStore";

describe("a loaded county is announced", () => {
  it("persistLoadedCounty announces the county's guide and parcel pages", async () => {
    await persistLoadedCounty({ state: "TN", county: "DeKalb County", sourceName: "TN Comptroller parcel download", sourceUrl: "https://example.test" }, [], []);
    expect(h.announce).toHaveBeenCalledWith("TN", "DeKalb County");
  });
});
