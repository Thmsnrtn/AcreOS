/**
 * Customers bring their own data and listing accounts (founder decision
 * 2026-10-20 #3, a corollary of "be the rail, not the provider").
 *
 * Listing syndication read AcreOS's own process.env for every channel, so one
 * AcreOS account would have posted every customer's listings — and the
 * Facebook path used META_ACCESS_TOKEN, the founder-only ads token, from a
 * customer route. Two checks, both falsified against the behaviour:
 *
 *   1. BEHAVIOUR — with AcreOS's env fully keyed, publishing to every API
 *      channel makes NO network call and refuses, naming the customer's own
 *      account. Re-introduce one env read and a fetch happens: red.
 *   2. POPULATION — every customer-acting integration file is enumerated and
 *      scanned for credential-shaped process.env reads; the founder ads token
 *      may be read only by the founder-only ads service.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../helpers/stripComments";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

vi.mock("../../server/db", () => ({ db: {} }));

const { syndicateListing, PLATFORMS, takeDownListing } = await import("../../server/services/listingSyndication");

const listing = {
  propertyId: 1, organizationId: 7, title: "5 Acres", description: "", askingPrice: 10_000, pricePerAcre: 2_000,
  acreage: 5, address: "", city: "", state: "TX", zip: "", county: "Bastrop", latitude: 0, longitude: 0,
  photos: [], sellerFinancingAvailable: false, contactName: "Ana", listingUrl: "https://example.com",
} as any;

const PLATFORM_ENV = {
  LANDCOM_API_KEY: "platform", LANDCOM_BROKER_ID: "platform", LANDFLIP_API_KEY: "platform", LANDFLIP_MEMBER_ID: "platform",
  META_ACCESS_TOKEN: "founder-ads-token", META_PAGE_ID: "platform", META_CATALOG_ID: "platform",
  LANDWATCH_API_KEY: "platform", LANDSEARCH_API_KEY: "platform",
};

afterEach(() => {
  for (const k of Object.keys(PLATFORM_ENV)) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("listing channels never post or delete through AcreOS's own credentials", () => {
  it("with every platform key set, no API channel makes a network call", async () => {
    Object.assign(process.env, PLATFORM_ENV);
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const apiChannels = Object.values(PLATFORMS).filter((p) => p.connection === "customer_account").map((p) => p.id);
    expect(apiChannels.length).toBeGreaterThanOrEqual(5); // vacuity floor
    const results = await syndicateListing(listing, apiChannels);
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const r of results) {
      expect(r.success, r.platform).toBe(false);
      expect(r.requiresManualAction, r.platform).toBe(true);
    }
    for (const p of ["land_com", "facebook_marketplace"] as const) {
      expect((await takeDownListing(p, "ext-1", 7)).success).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("population: customer-acting integration files read no platform credentials", () => {
  // Every file that acts in the outside world AS the customer (posts their
  // listing, deletes it). Adding such an integration means adding it here.
  const CUSTOMER_ACTING_FILES = [
    "server/services/listingSyndication.ts",
    "server/services/syndicationChannels.ts",
  ];
  const ALLOWED_ENV = new Set(["APP_URL", "NODE_ENV"]);

  for (const f of CUSTOMER_ACTING_FILES) {
    it(`${f} reads no credential from process.env`, () => {
      const src = stripComments(readFileSync(f, "utf8"));
      const reads = [...src.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[\s*["'`]?([A-Za-z0-9_]+))/g)]
        .map((m) => m[1] ?? m[2])
        .filter((n) => !ALLOWED_ENV.has(n));
      expect(reads).toEqual([]);
    });
  }

  it("the founder ads token is read only by the founder-only ads service", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
      }
    };
    walk("server");
    expect(files.length).toBeGreaterThan(500);
    const readers = files.filter((f) => /process\.env\.META_ACCESS_TOKEN/.test(stripComments(readFileSync(f, "utf8"))));
    expect(readers).toEqual(["server/services/metaAdsService.ts"]);
  });
});
