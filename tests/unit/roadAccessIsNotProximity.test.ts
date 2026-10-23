/**
 * Road access is never a verdict derived from proximity (P1-C item 5).
 *
 *  - landProfile.ts published `roadAccess: true` whenever the nearest highway
 *    was within 1 mile. A landlocked tract can sit beside an interstate.
 *  - dueDiligenceEngine.checkRoadAccess told the customer "Road access
 *    confirmed" / "adequate access" for any OSM way within 500 m, picked the
 *    road by hierarchy rather than distance, and reported a hardcoded
 *    1,640 ft (500 m × 3.281) as the distance for every parcel.
 *
 * Falsified against the semantic defect: proximity-only input (a highway
 * 0.1 mi away / a road 30 m away) must NOT yield access = true in the land
 * profile, and the DD note/distance must be a measurement, not a verdict.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { assembleLandProfile } from "../../server/services/landProfile";
import { runAutoDueDiligence } from "../../server/services/dueDiligenceEngine";

afterEach(() => vi.unstubAllGlobals());

const PROPERTY = { id: 1, latitude: "36.0", longitude: "-86.0", sizeAcres: "10", legalDescription: null } as any;

describe("land profile — proximity never becomes road access", () => {
  for (const miles of [0, 0.1, 0.4, 0.99, 1]) {
    it(`highway ${miles} mi away → access undetermined, not true`, () => {
      const profile = assembleLandProfile(
        PROPERTY,
        {
          transportation: { nearestHighwayMiles: miles },
          provenance: { transportation: { source: "Census TIGER", asOf: null } },
          errors: {},
        } as any,
        false,
      );
      expect(profile.roadAccess?.value).not.toBe(true);
      expect(profile.roadAccess).toBeUndefined();
      const gap = profile.gaps.find((g) => g.field === "roadAccess");
      expect(gap).toBeDefined();
    });
  }
});

describe("DD road check — a measurement, not a verdict (via runAutoDueDiligence)", () => {
  // A road running east-west ~30 m north of the point.
  const lat = 36.0;
  const lng = -86.0;
  const north30m = 30 / 111_320;
  const nearWay = {
    tags: { highway: "residential", name: "Near Rd" },
    geometry: [{ lat: lat + north30m, lon: lng - 0.001 }, { lat: lat + north30m, lon: lng + 0.001 }],
  };
  // A higher-hierarchy road ~400 m away — the old code chose THIS one.
  const far400m = 400 / 111_320;
  const farWay = {
    tags: { highway: "primary", name: "Far Hwy" },
    geometry: [{ lat: lat - far400m, lon: lng - 0.001 }, { lat: lat - far400m, lon: lng + 0.001 }],
  };

  /** Overpass answers with `elements`; every other source fails fast. */
  function stubOverpass(elements: unknown[]) {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      if (String(url).includes("overpass")) {
        seen.push(decodeURIComponent(String(init?.body ?? "")));
        return { ok: true, json: async () => ({ elements }) };
      }
      throw new Error("offline in test");
    }));
    return seen;
  }

  it("reports the NEAREST road's measured distance — never the hardcoded 1,640 ft — and never 'confirmed' access", async () => {
    const bodies = stubOverpass([farWay, nearWay]);
    const report = await runAutoDueDiligence(1, 1, lat, lng, 10, "TN");
    const r = report.checks.roadAccess;
    expect(bodies.length).toBe(1);
    // Geometry was requested, so a distance can be measured.
    expect(bodies[0]).toMatch(/out geom/);
    expect(r.status).toBe("done");
    expect(r.nearestRoadName).toBe("Near Rd");
    expect(r.nearestRoadDistanceFeet).not.toBe(1640);
    expect(r.nearestRoadDistanceFeet!).toBeGreaterThan(90);
    expect(r.nearestRoadDistanceFeet!).toBeLessThan(110); // 30 m ≈ 98 ft
    expect(r.note).not.toMatch(/confirmed|adequate access|good access/i);
    expect(r.note).toMatch(/not legal access/i);
    // The scored report no longer awards a "Road access confirmed" green flag.
    expect(report.greenFlags.join(" ")).not.toMatch(/road access confirmed/i);
  });

  it("no geometry → distance is null, not a constant", async () => {
    stubOverpass([{ tags: { highway: "motorway" } }]);
    const report = await runAutoDueDiligence(1, 1, lat, lng, 10, "TN");
    expect(report.checks.roadAccess.nearestRoadDistanceFeet).toBeNull();
    expect(report.checks.roadAccess.note).not.toMatch(/confirmed/i);
  });
});
