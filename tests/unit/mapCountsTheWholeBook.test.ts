/**
 * DEFECT-0157 / DEFECT-0158 — the Map and Syndication say what they loaded.
 *
 * The Map fetched 100 properties and 100 deals under the SHARED
 * ["/api/properties"] / ["/api/deals"] keys (other pages cache 25 rows or the
 * raw envelope there), summed its header pills from that page, and its strips
 * counted "owner targets" from the default 25-row lead page. Syndication read
 * `.properties` from an envelope that has `data`, so everyone saw "No
 * properties found." and could syndicate nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const read = (p: string) => stripComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

describe("DEFECT-0158 — the Map", () => {
  const maps = read("client/src/pages/maps.tsx");

  it("does not share a list cache key with pages that cache other shapes", () => {
    expect(maps).not.toMatch(/queryKey:\s*\["\/api\/properties"\]/);
    expect(maps).not.toMatch(/queryKey:\s*\["\/api\/deals"\]/);
  });

  it("takes its deal pills from the server aggregates, and says when the pins are a page", () => {
    expect(maps).toMatch(/\/api\/deals\/aggregates/);
    expect(maps).toMatch(/totals\.closedValue/);
    expect(maps).toMatch(/newest \$\{properties\.length\} of \$\{propertiesTotal\}/);
  });

  it("the strips count leads from the server total, not a 25-row page", () => {
    const strip = read("client/src/components/maps/PersonaMapStrip.tsx");
    expect(strip).toMatch(/pageSize=1/);
    expect(strip).toMatch(/json\?\.total/);
    expect(strip).not.toMatch(/leads\.filter\(\(l\) => l\.type === "seller"/);
  });
});

describe("DEFECT-0157 — Syndication", () => {
  const syn = read("client/src/pages/syndication.tsx");

  it("reads the envelope's `data`, under its own key, and a failed read is an error", () => {
    expect(syn).not.toMatch(/propertiesData\?\.properties/);
    expect(syn).toMatch(/propertiesData\?\.data/);
    expect(syn).toMatch(/queryKey:\s*\["syndication", "properties"\]/);
    expect(syn).toMatch(/okOrThrow\(/);
  });
});
