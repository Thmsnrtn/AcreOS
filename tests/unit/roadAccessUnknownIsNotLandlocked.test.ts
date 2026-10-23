/**
 * Road access: a map lookup can disprove access, never establish it — and a
 * lookup that did not answer is not a verdict.
 *
 * Best-in-class audit 2026-10-20 (land underwriting, road-access truth):
 * checkRoadAccess returned hasDirectRoadAccess: TRUE for any mapped road
 * within 500 m (proximity, not frontage or an easement) and FALSE when the
 * Overpass call failed; the fusion report then flagged `!hasDirectRoadAccess`
 * as a "landlocked — pass on this deal" dealbreaker. So an API outage told a
 * customer to walk away from a parcel nobody had looked at.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const H = vi.hoisted(() => ({ road: null as unknown }));
vi.mock("../../server/services/dueDiligenceEngine", async (orig) => ({
  ...(await orig<typeof import("../../server/services/dueDiligenceEngine")>()),
  runAutoDueDiligence: vi.fn(async () => ({
    overallRisk: "low",
    checks: {
      floodZone: { risk: "low", zone: "X", zoneDescription: "" },
      wetlands: { hasWetlands: false, wetlandAcres: 0, wetlandPercent: 0, risk: "low" },
      environmental: { superfundSitesWithin1Mile: 0, nearestHazardDistanceMiles: null, risk: "low" },
      roadAccess: H.road,
      soil: { dominantSoilName: null, farmlandClassification: null, risk: "low" },
      elevation: { elevationFeet: null, slope: null, risk: "low" },
    },
  })),
}));
vi.mock("../../server/services/data-cache/observation-log", () => ({ recordParcelObservations: vi.fn(async () => undefined) }));
vi.mock("../../server/services/usdaNassService", () => ({
  buildCountyAgSnapshot: vi.fn(async () => { throw new Error("offline"); }),
  getCachedLandTrend: vi.fn(async () => { throw new Error("offline"); }),
}));
vi.mock("../../server/services/censusDataService", () => ({
  buildCountyOpportunityProfile: vi.fn(async () => { throw new Error("offline"); }),
  getKnownMigrationHotspots: vi.fn(() => []),
}));

const { generateLandIntelligenceReport } = await import("../../server/services/parcelIntelligenceFusion");
const actual = await vi.importActual<typeof import("../../server/services/dueDiligenceEngine")>("../../server/services/dueDiligenceEngine");

const input = { latitude: 35.1, longitude: -86.2, acres: 10, state: "TN", county: "Franklin" };

function stubOverpass(answer: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("overpass")) return answer();
    throw new Error("offline in test");
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe("checkRoadAccess answers only what a map can answer", () => {
  it("a mapped road nearby leaves direct access undetermined (null), not true", async () => {
    const north30m = 30 / 111_320;
    stubOverpass(async () => ({ ok: true, json: async () => ({ elements: [{ tags: { highway: "residential", name: "Near Rd" }, geometry: [{ lat: 35.1 + north30m, lon: -86.201 }, { lat: 35.1 + north30m, lon: -86.199 }] }] }) }));
    const r = (await actual.runAutoDueDiligence(1, 1, 35.1, -86.2, 10, "TN")).checks.roadAccess;
    expect(r.status).toBe("done");
    expect(r.hasDirectRoadAccess).toBeNull();
  });

  it("no mapped road within 500 m is the one answer that disproves access (false)", async () => {
    stubOverpass(async () => ({ ok: true, json: async () => ({ elements: [] }) }));
    const r = (await actual.runAutoDueDiligence(1, 1, 35.1, -86.2, 10, "TN")).checks.roadAccess;
    expect(r.hasDirectRoadAccess).toBe(false);
    expect(r.risk).toBe("high");
  });

  it("a failed lookup is undetermined (null), never 'no access'", async () => {
    stubOverpass(async () => ({ ok: false, status: 504, json: async () => ({}) }));
    const r = (await actual.runAutoDueDiligence(1, 1, 35.1, -86.2, 10, "TN")).checks.roadAccess;
    expect(r.status).toBe("error");
    expect(r.hasDirectRoadAccess).toBeNull();
  });
});

describe("the land report calls a parcel landlocked only on a lookup that found no road", () => {
  const landlocked = (r: Awaited<ReturnType<typeof generateLandIntelligenceReport>>) => r.dealKillers.filter((d) => d.type === "landlocked");

  it("a failed road lookup raises no landlocked dealbreaker and reports access as unknown", async () => {
    H.road = { status: "error", hasDirectRoadAccess: null, nearestRoadName: null, nearestRoadDistanceFeet: null, roadType: null, risk: "unknown", note: "Road access check failed: 504" };
    const r = await generateLandIntelligenceReport(input);
    expect(landlocked(r)).toEqual([]);
    expect(r.dueDiligence?.roadAccess.hasAccess).toBeNull();
  });

  it("a nearby mapped road raises no landlocked dealbreaker and does not claim access", async () => {
    H.road = { status: "done", hasDirectRoadAccess: null, nearestRoadName: "Near Rd", nearestRoadDistanceFeet: 98, roadType: "residential", risk: "low", note: "" };
    const r = await generateLandIntelligenceReport(input);
    expect(landlocked(r)).toEqual([]);
    expect(r.dueDiligence?.roadAccess.hasAccess).not.toBe(true);
  });

  it("no mapped road within 500 m is still flagged", async () => {
    H.road = { status: "done", hasDirectRoadAccess: false, nearestRoadName: null, nearestRoadDistanceFeet: null, roadType: null, risk: "high", note: "" };
    const r = await generateLandIntelligenceReport(input);
    expect(landlocked(r)).toHaveLength(1);
  });
});
