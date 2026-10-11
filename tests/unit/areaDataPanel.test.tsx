// @vitest-environment jsdom
/**
 * /api/land-data/national/* had no caller (W2 audit, 2026-10-10). Its consumer
 * is the Area data section behind the Map door (the selected-property panel):
 *   - every dataset the route serves has a row (a dataset added to the route
 *     without a row here fails);
 *   - a value is rendered from what the source returned, never defaulted;
 *   - a refusal (missing key, no data at this point) shows its reason;
 *   - the Map page actually renders the section.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

vi.mock("../../server/db", () => ({ db: {} }));

import { AreaDataPanel, AREA_DATASETS } from "../../client/src/components/maps/AreaDataPanel";
import { NATIONAL_DATASET_CATEGORIES } from "../../server/services/providers/national-datasets-provider";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

const BODIES: Record<string, unknown> = {
  jobs_lehd: { available: true, source: "Census LEHD LODES", fetchedAt: "2026-10-11T00:00:00Z", data: { countyFips: "47041", county: "DeKalb", year: 2023, totalJobsAtWorkplaces: 6123 } },
  traffic_counts: { available: true, source: "TDOT Traffic Counts", fetchedAt: "2026-10-11T00:00:00Z", data: { road: "SR-56", aadt: 4310, year: 2024, distanceM: 820, stationsWithin3km: 3 } },
  manufactured_home_parks: { available: true, source: "FEMA Mobile Home Parks (RAPT)", fetchedAt: "2026-10-11T00:00:00Z", data: { radiusMiles: 5, count: 2, parks: [] } },
  protected_lands_padus: { available: true, source: "USGS PAD-US", fetchedAt: "2026-10-11T00:00:00Z", data: { radiusM: 1000, units: [{ name: "Edgar Evins State Park", manager: "TN", publicAccess: "OA" }] } },
  fair_market_rent: { available: false, reason: "Fair market rents need a free HUD USER token (HUD_USER_API_TOKEN) — not set." },
  acs_county_profile: { available: false, reason: "The Census API needs a free key (CENSUS_API_KEY) — not set." },
};

describe("Area data behind the Map door", () => {
  it("has a row for every dataset the route serves", () => {
    expect(AREA_DATASETS.map((d) => d.category).sort()).toEqual([...NATIONAL_DATASET_CATEGORIES].sort());
  });

  it("the Map page renders it in the selected-property panel", () => {
    const src = stripComments(readFileSync(path.resolve(__dirname, "../../client/src/pages/maps.tsx"), "utf8"));
    expect(src).toMatch(/import \{ AreaDataPanel \} from "@\/components\/maps\/AreaDataPanel"/);
    expect(src).toMatch(/<AreaDataPanel\b/);
  });

  it("loads on request and renders values and refusals from the responses", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      const cat = /national\/([a-z_]+)/.exec(String(url))![1];
      return new Response(JSON.stringify(BODIES[cat]), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<QueryClientProvider client={qc}><AreaDataPanel lat={35.96} lng={-85.81} state="TN" /></QueryClientProvider>);
    });
    expect(calls, "nothing is fetched until the person asks").toEqual([]);
    const button = host.querySelector("button")!;
    await act(async () => { button.click(); await new Promise((r) => setTimeout(r, 30)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(calls.length).toBe(NATIONAL_DATASET_CATEGORIES.length);
    expect(calls[0]).toMatch(/lat=35\.96&lng=-85\.81&state=TN/);
    const text = host.textContent ?? "";
    expect(text).toContain("6,123 jobs");
    expect(text).toContain("4,310 vehicles a day on SR-56");
    expect(text).toContain("Edgar Evins State Park");
    expect(text).toContain("HUD_USER_API_TOKEN");
    expect(text).toContain("CENSUS_API_KEY");
  });
});
