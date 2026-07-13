/**
 * D7 syndication channel model — pure derivation logic.
 *
 * Pins the honesty rules: unkeyed channels report the exact missing env
 * keys instead of faking "synced"; manual-only channels say so; real sync
 * errors surface; counts come from syndicationTargets records.
 */
import { describe, it, expect } from "vitest";

// The service imports ../db (needs DATABASE_URL at module load in some
// environments) — mock it so the pure functions are testable in isolation.
import { vi } from "vitest";
vi.mock("../../server/db", () => ({ db: {} }));

import {
  deriveChannelView,
  countTargets,
  missingEnvKeys,
  isKnownChannel,
} from "../../server/services/syndicationChannels";
import { PLATFORMS } from "../../server/services/listingSyndication";

const landflip = PLATFORMS.landflip;
const craigslist = PLATFORMS.craigslist;

describe("isKnownChannel", () => {
  it("accepts catalog channels and rejects unknown ids", () => {
    expect(isKnownChannel("landflip")).toBe(true);
    expect(isKnownChannel("zillow")).toBe(false);
    expect(isKnownChannel("")).toBe(false);
  });
});

describe("missingEnvKeys", () => {
  it("lists exactly the absent keys", () => {
    expect(missingEnvKeys(landflip, {} as NodeJS.ProcessEnv)).toEqual([
      "LANDFLIP_API_KEY",
      "LANDFLIP_MEMBER_ID",
    ]);
    expect(
      missingEnvKeys(landflip, { LANDFLIP_API_KEY: "x", LANDFLIP_MEMBER_ID: "y" } as unknown as NodeJS.ProcessEnv),
    ).toEqual([]);
  });

  it("keyless channels never report missing keys", () => {
    expect(missingEnvKeys(craigslist, {} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("deriveChannelView", () => {
  const counts = { published: 3, pending: 2 };

  it("no state row → disabled", () => {
    const v = deriveChannelView(landflip, undefined, counts, []);
    expect(v.syncStatus).toBe("disabled");
    expect(v.enabled).toBe(false);
    expect(v.pendingCount).toBe(0); // disabled channels don't count pending
    expect(v.listingsPublished).toBe(3);
  });

  it("enabled but unkeyed → error naming the missing keys, never synced", () => {
    const v = deriveChannelView(
      landflip,
      { enabled: true, lastSyncAt: null, lastSyncError: null },
      counts,
      ["LANDFLIP_API_KEY"],
    );
    expect(v.syncStatus).toBe("error");
    expect(v.errorMessage).toContain("LANDFLIP_API_KEY");
  });

  it("enabled manual-only channel → pending with honest manual message", () => {
    const v = deriveChannelView(
      craigslist,
      { enabled: true, lastSyncAt: null, lastSyncError: null },
      counts,
      [],
    );
    expect(v.syncStatus).toBe("pending");
    expect(v.errorMessage).toMatch(/manual/i);
  });

  it("enabled + keyed + real sync error → error with the stored message", () => {
    const v = deriveChannelView(
      landflip,
      { enabled: true, lastSyncAt: new Date("2026-07-13T00:00:00Z"), lastSyncError: "HTTP 503 from LandFlip" },
      counts,
      [],
    );
    expect(v.syncStatus).toBe("error");
    expect(v.errorMessage).toBe("HTTP 503 from LandFlip");
  });

  it("enabled + keyed + pending listings → pending", () => {
    const v = deriveChannelView(
      landflip,
      { enabled: true, lastSyncAt: new Date("2026-07-13T00:00:00Z"), lastSyncError: null },
      { published: 3, pending: 2 },
      [],
    );
    expect(v.syncStatus).toBe("pending");
    expect(v.pendingCount).toBe(2);
  });

  it("enabled + keyed + everything live → synced", () => {
    const v = deriveChannelView(
      landflip,
      { enabled: true, lastSyncAt: new Date("2026-07-13T00:00:00Z"), lastSyncError: null },
      { published: 3, pending: 0 },
      [],
    );
    expect(v.syncStatus).toBe("synced");
    expect(v.lastSyncAt).toBe("2026-07-13T00:00:00.000Z");
  });

  it("enabled + keyed but never synced → pending, not synced", () => {
    const v = deriveChannelView(
      landflip,
      { enabled: true, lastSyncAt: null, lastSyncError: null },
      { published: 0, pending: 0 },
      [],
    );
    expect(v.syncStatus).toBe("pending");
  });
});

describe("countTargets", () => {
  it("published counts active targets on any listing; pending counts active listings not live", () => {
    const listings = [
      {
        status: "active",
        syndicationTargets: [{ platform: "landflip", status: "active" }],
      },
      {
        status: "active",
        syndicationTargets: [{ platform: "landflip", status: "failed" }],
      },
      {
        status: "active",
        syndicationTargets: null,
      },
      {
        // Sold listing: its target still counts as published history, but it
        // is no longer pending anywhere.
        status: "sold",
        syndicationTargets: [{ platform: "landflip", status: "active" }],
      },
    ] as any;

    const counts = countTargets(listings);
    expect(counts.get("landflip")).toEqual({ published: 2, pending: 2 });
    // A channel with no targets at all: nothing published, all active pending.
    expect(counts.get("land_com")).toEqual({ published: 0, pending: 3 });
  });
});
