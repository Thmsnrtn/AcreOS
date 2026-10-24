/**
 * The listing the customer wrote is the listing every channel receives.
 *
 * Best-in-class audit 2026-10-20 (marketing, listing path steps 1–2): every
 * publish path built its NormalizedListing from the PROPERTY row and passed
 * only the price and the seller-financing flag from the listing, so the
 * title, description and photos the seller entered never reached a channel;
 * the form took one photo URL; and buildNormalizedListing hard-coded
 * `sellerFinancingAvailable: true` with a fallback description promising
 * "Seller financing available with low down payment", while the schema and
 * the form both defaulted the flag on.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildNormalizedListing,
  listingContentForChannels,
  syndicateListing,
} from "../../server/services/listingSyndication";
import { propertyListings, type PropertyListing } from "../../shared/schema";
import { photoUrlsFromText } from "../../client/src/lib/listingPhotos";
import { stripComments } from "../helpers/stripComments";
import { stripSqlComments } from "../helpers/stripSqlComments";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const property = {
  id: 7,
  organizationId: 3,
  name: "Property record name",
  description: "Property record description",
  sizeAcres: "10",
  county: "Pima",
  state: "AZ",
  photos: [{ url: "https://cdn.example/property-record.jpg" }],
};
const org = { name: "Seller Co" };

function listingRow(over: Partial<PropertyListing>): PropertyListing {
  return {
    id: 1,
    organizationId: 3,
    propertyId: 7,
    title: "Ten quiet acres with power at the road",
    description: "The seller's own words about the land.",
    askingPrice: "25000",
    minimumPrice: null,
    sellerFinancingAvailable: false,
    downPaymentMin: null,
    monthlyPaymentMin: null,
    interestRate: null,
    termMonths: null,
    photos: null,
    status: "active",
    syndicationTargets: null,
    ...over,
  } as PropertyListing;
}

describe("the customer's listing content reaches the channel", () => {
  it("title, description and every photo come from the listing, cover first", async () => {
    const listing = listingRow({
      photos: [
        { url: "https://cdn.example/b.jpg", order: 1 },
        { url: "https://cdn.example/a.jpg", order: 0 },
        { url: "https://cdn.example/cover.jpg", isPrimary: true, order: 2 },
      ],
    });
    const n = await buildNormalizedListing(property, org, listingContentForChannels(listing));
    expect(n.title).toBe("Ten quiet acres with power at the road");
    expect(n.description).toBe("The seller's own words about the land.");
    expect(n.photos).toEqual([
      "https://cdn.example/cover.jpg",
      "https://cdn.example/a.jpg",
      "https://cdn.example/b.jpg",
    ]);
    expect(n.askingPrice).toBe(25000);
  });

  it("the property record fills only what the listing left blank", async () => {
    const n = await buildNormalizedListing(
      property,
      org,
      listingContentForChannels(listingRow({ description: "  ", photos: [] })),
    );
    expect(n.title).toBe("Ten quiet acres with power at the road");
    expect(n.description).toBe("Property record description");
    expect(n.photos).toEqual(["https://cdn.example/property-record.jpg"]);
  });

  it("the posted text carries the listing's own title and description", async () => {
    const n = await buildNormalizedListing(property, org, listingContentForChannels(listingRow({})));
    const [r] = await syndicateListing(n, ["craigslist"]);
    expect(r.preformattedText).toContain("Ten quiet acres with power at the road");
    expect(r.preformattedText).toContain("The seller's own words about the land.");
    expect(r.preformattedText).not.toContain("Property record");
  });
});

describe("seller financing is claimed only when the seller offers it", () => {
  it("a listing without the flag set publishes no financing claim", async () => {
    for (const flag of [false, null, undefined] as const) {
      const n = await buildNormalizedListing(
        { ...property, description: undefined },
        org,
        listingContentForChannels(listingRow({ sellerFinancingAvailable: flag as boolean | null, description: null })),
      );
      expect(n.sellerFinancingAvailable).toBe(false);
      expect(n.description).not.toMatch(/financ/i);
      const [r] = await syndicateListing(n, ["craigslist"]);
      expect(r.preformattedText).not.toMatch(/financ/i);
      // Not offering terms is not the seller saying "cash only".
      expect(r.preformattedText).not.toMatch(/cash only/i);
    }
  });

  it("with no listing at all, the builder does not assume financing", async () => {
    const n = await buildNormalizedListing({ ...property, description: undefined }, org);
    expect(n.sellerFinancingAvailable).toBe(false);
    expect(n.description).not.toMatch(/financ/i);
  });

  it("when the seller offers terms, the terms they entered are what publish", async () => {
    const content = listingContentForChannels(
      listingRow({ sellerFinancingAvailable: true, downPaymentMin: "1500", monthlyPaymentMin: "350", interestRate: "8.5", termMonths: 84 }),
    );
    expect(content).toMatchObject({ sellerFinancingAvailable: true, downPaymentMin: 1500, monthlyPaymentMin: 350, interestRate: 8.5, termYears: 7 });
  });

  it("the column defaults to false, and a migration sets it on existing databases", () => {
    expect(propertyListings.sellerFinancingAvailable.default).toBe(false);
    const ddl = stripSqlComments(readFileSync("migrations/0285_listing_seller_financing_default_off.sql", "utf8"));
    expect(ddl).toMatch(/ALTER TABLE "property_listings" ALTER COLUMN "seller_financing_available" SET DEFAULT false/);
    expect(readFileSync("scripts/migrate.mjs", "utf8")).toContain(
      '`ALTER TABLE "property_listings" ALTER COLUMN "seller_financing_available" SET DEFAULT false`',
    );
  });

  it("the listing form starts with seller financing off and never reads a missing flag as on", () => {
    const page = stripComments(readFileSync("client/src/pages/listings.tsx", "utf8"));
    expect(page).toContain("sellerFinancingAvailable: z.boolean().default(false)");
    expect(page).not.toMatch(/sellerFinancingAvailable:\s*true/);
    expect(page).not.toMatch(/sellerFinancingAvailable\s*\?\?\s*true/);
    const calc = stripComments(readFileSync("client/src/components/payment-calculator.tsx", "utf8"));
    expect(calc).not.toMatch(/sellerFinancingAvailable\s*=\s*true/);
  });
});

describe("the form takes more than one photo", () => {
  it("one URL per line, in order, the first is the cover", () => {
    expect(photoUrlsFromText("https://a.example/1.jpg\n\n  https://a.example/2.jpg \r\nhttps://a.example/3.jpg")).toEqual([
      { url: "https://a.example/1.jpg", isPrimary: true, order: 0 },
      { url: "https://a.example/2.jpg", isPrimary: false, order: 1 },
      { url: "https://a.example/3.jpg", isPrimary: false, order: 2 },
    ]);
    expect(photoUrlsFromText("")).toEqual([]);
  });
});

describe("population: every publish path builds through the listing's content", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
    }
    return out;
  }

  it("each buildNormalizedListing call passes listingContentForChannels(...) as its overrides", () => {
    const calls: Array<{ file: string; args: string }> = [];
    for (const file of walk("server")) {
      const src = stripComments(readFileSync(file, "utf8"));
      const re = /buildNormalizedListing\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        // Skip the declaration itself.
        if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < src.length && depth > 0; i++) {
          if (src[i] === "(") depth++;
          else if (src[i] === ")") depth--;
        }
        calls.push({ file, args: src.slice(m.index + m[0].length, i - 1) });
      }
    }
    // Vacuity floor: the three publish paths (publish route, legacy
    // syndicate route, sync-all) must all be read.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const bad = calls.filter((c) => !/,\s*(?:listingSyndication\.)?listingContentForChannels\(\s*listing\s*\)\s*,?\s*$/.test(c.args));
    expect(bad).toEqual([]);
  });
});
