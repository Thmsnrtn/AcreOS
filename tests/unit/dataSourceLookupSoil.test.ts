/**
 * data-source-lookup.ts SDA soil-query fix (ruling #9 wave 3, task 2).
 *
 * Wave 2 live-verified that SDA rejects the legacy
 * `mupolygonGeometry.STContains(...)` T-SQL and that plain `format=json`
 * returns bare value arrays. The canonical fix (documented point-intersection
 * helper + `json+columnname` + safeWgs84 sanitizer) already lives in
 * data-source-broker.querySoilData; these tests pin the same pattern in
 * data-source-lookup.querySoilService — source shape AND behaviour via a
 * stubbed fetch, with the pre-existing output shape unchanged.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";

import { dataSourceLookupService } from "../../server/services/data-source-lookup";

const LOOKUP_SOURCE = readFileSync(
  join(__dirname, "../../server/services/data-source-lookup.ts"),
  "utf8",
);

// The rot must be gone from CODE; a comment documenting why the fix exists
// may still name the rejected form, so strip line comments before asserting.
const LOOKUP_CODE = LOOKUP_SOURCE.split("\n")
  .map((line) => line.replace(/^\s*\/\/.*$/, "").replace(/\/\/[^"'`]*$/, ""))
  .join("\n");

describe("data-source-lookup SDA source shape", () => {
  it("no longer contains the rotted STContains T-SQL", () => {
    expect(LOOKUP_CODE).not.toContain("STContains");
    expect(LOOKUP_CODE).not.toContain("mupolygonGeometry");
  });

  it("uses SDA's documented point-intersection helper", () => {
    expect(LOOKUP_SOURCE).toContain("SDA_Get_Mukey_from_intersection_with_WktWgs84");
  });

  it("requests json+columnname (plain json returns bare value arrays)", () => {
    expect(LOOKUP_SOURCE).toContain("json+columnname");
    expect(LOOKUP_SOURCE).not.toMatch(/format=json&|format=json`/);
  });

  it("sanitises coordinates through the broker's safeWgs84 before interpolation", () => {
    expect(LOOKUP_SOURCE).toMatch(
      /import \{ safeWgs84, parseSdaColumnRows \} from "\.\/data-source-broker"/,
    );
    expect(LOOKUP_SOURCE).toContain("safeWgs84(lat, lng)");
  });
});

describe("querySoilService behaviour (stubbed fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the WktWgs84 helper query with json+columnname and keeps the output shape", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url: String(url), body: String(init.body) });
        return new Response(
          // Live-verified `json+columnname` shape: first row = column names.
          JSON.stringify({
            Table: [
              ["musym", "muname", "hydgrpdcd", "drclassdcd"],
              ["Gt", "Glenbar clay loam, 0 to 1 percent slopes", "B", "Well drained"],
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const result = await (dataSourceLookupService as unknown as {
      querySoilService(lat: number, lng: number): Promise<Record<string, unknown>>;
    }).querySoilService(33.271459, -112.148559);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("SDMDataAccess.nrcs.usda.gov/Tabular/post.rest");
    const body = decodeURIComponent(requests[0].body);
    expect(body).toContain("SDA_Get_Mukey_from_intersection_with_WktWgs84");
    expect(body).toContain("point(-112.148559 33.271459)");
    expect(body).toContain("format=json+columnname");
    expect(body).not.toContain("STContains");

    // Pre-existing output shape, unchanged.
    expect(result).toEqual({
      soilType: "Glenbar clay loam, 0 to 1 percent slopes",
      soilSymbol: "Gt",
      hydrologicGroup: "B",
      drainageClass: "Well drained",
      source: "USDA NRCS SSURGO",
      lastUpdated: expect.any(String),
    });
  });

  it("returns honest Unknowns when SDA finds no map unit for the point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    const result = await (dataSourceLookupService as unknown as {
      querySoilService(lat: number, lng: number): Promise<Record<string, unknown>>;
    }).querySoilService(33.27, -112.15);
    expect(result).toMatchObject({
      soilType: "Unknown",
      soilSymbol: "Unknown",
      hydrologicGroup: "Unknown",
      drainageClass: "Unknown",
    });
  });

  it("rejects out-of-range coordinates via safeWgs84 before any request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      (dataSourceLookupService as unknown as {
        querySoilService(lat: number, lng: number): Promise<unknown>;
      }).querySoilService(999, -112.15),
    ).rejects.toThrow(/Invalid WGS84 latitude/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces SDA's XML error answers instead of a JSON parse crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<ServiceExceptionReport>bad sql</ServiceExceptionReport>", { status: 200 })),
    );
    await expect(
      (dataSourceLookupService as unknown as {
        querySoilService(lat: number, lng: number): Promise<unknown>;
      }).querySoilService(33.27, -112.15),
    ).rejects.toThrow(/non-JSON response/);
  });
});
