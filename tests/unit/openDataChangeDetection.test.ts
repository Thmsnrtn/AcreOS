/**
 * Temporal Spine — change-detection core (ruling #9 wave 3,
 * docs/company/founder-decisions-2026-07-28.md).
 *
 * Pins the honesty contract of diffCategoryResult:
 *  - every materiality rule fires both ways (value A→B and B→A),
 *  - null→value (first sight) and value→null (lookup gap) are NEVER changes,
 *  - unknown categories produce NO events,
 *  - narratives are built only from the two real observed values,
 * plus the thin persistence wrapper (DB mocked — no real DB in this env).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Capture inserts; allow tests to force a DB failure.
const inserted: Array<{ table: unknown; rows: unknown }> = [];
let insertShouldFail = false;
vi.mock("../../server/db", () => ({
  db: {
    insert: (table: unknown) => ({
      values: async (rows: unknown) => {
        if (insertShouldFail) throw new Error("db down");
        inserted.push({ table, rows });
        return undefined;
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
  },
}));

import {
  diffCategoryResult,
  pointScopeRef,
  recordCategoryChanges,
  listRecentChangeEvents,
} from "../../server/services/openData/changeDetection";

beforeEach(() => {
  inserted.length = 0;
  insertShouldFail = false;
  vi.clearAllMocks();
});

describe("diffCategoryResult — flood_zone", () => {
  it("zone change is notable, both directions", () => {
    const a = { zone: "Zone X (Minimal Flood Hazard)", riskLevel: "low" };
    const b = { zone: "Zone AE", riskLevel: "low" };
    const fwd = diffCategoryResult("flood_zone", a, b);
    expect(fwd).toHaveLength(1);
    expect(fwd[0]).toMatchObject({
      category: "flood_zone",
      field: "zone",
      previousValue: "Zone X (Minimal Flood Hazard)",
      newValue: "Zone AE",
      severity: "notable",
    });
    const back = diffCategoryResult("flood_zone", b, a);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ field: "zone", severity: "notable" });
  });

  it("riskLevel change is notable", () => {
    const out = diffCategoryResult(
      "flood_zone",
      { zone: "Zone AE", riskLevel: "high" },
      { zone: "Zone AE", riskLevel: "medium" },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "riskLevel", severity: "notable" });
  });

  it("identical payloads produce no events", () => {
    const p = { zone: "Zone AE", riskLevel: "high" };
    expect(diffCategoryResult("flood_zone", p, { ...p })).toEqual([]);
  });

  it("narrative is built only from the two real values", () => {
    const [c] = diffCategoryResult(
      "flood_zone",
      { zone: "Zone X" },
      { zone: "Zone AE" },
    );
    expect(c.narrative).toBe("FEMA flood zone changed from Zone X to Zone AE at this point");
  });
});

describe("diffCategoryResult — wetlands", () => {
  it("hasWetlands flip is notable, both directions", () => {
    const fwd = diffCategoryResult("wetlands", { hasWetlands: false }, { hasWetlands: true });
    expect(fwd).toHaveLength(1);
    expect(fwd[0]).toMatchObject({
      field: "hasWetlands",
      previousValue: "false",
      newValue: "true",
      severity: "notable",
    });
    const back = diffCategoryResult("wetlands", { hasWetlands: true }, { hasWetlands: false });
    expect(back).toHaveLength(1);
    expect(back[0].severity).toBe("notable");
  });

  it("classification change is info", () => {
    const out = diffCategoryResult(
      "wetlands",
      { hasWetlands: true, classification: "Freshwater Emergent Wetland" },
      { hasWetlands: true, classification: "Freshwater Pond" },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "classification", severity: "info" });
  });
});

describe("diffCategoryResult — soil", () => {
  it.each([
    ["hydricRating", "No", "Yes"],
    ["floodingFrequency", "None", "Frequent"],
    ["septicRating", "Somewhat limited", "Very limited"],
  ])("%s change is notable, both directions", (field, a, b) => {
    const fwd = diffCategoryResult("soil", { [field]: a }, { [field]: b });
    expect(fwd).toHaveLength(1);
    expect(fwd[0]).toMatchObject({ field, previousValue: a, newValue: b, severity: "notable" });
    const back = diffCategoryResult("soil", { [field]: b }, { [field]: a });
    expect(back).toHaveLength(1);
    expect(back[0].severity).toBe("notable");
  });

  it("non-material soil fields (e.g. drainage, soilType) produce no events", () => {
    const out = diffCategoryResult(
      "soil",
      { drainage: "Well drained", soilType: "Gilman loam", hydricRating: "No" },
      { drainage: "Poorly drained", soilType: "Estrella loam", hydricRating: "No" },
    );
    expect(out).toEqual([]);
  });
});

describe("diffCategoryResult — wildfire_hazard", () => {
  it("whpClass change is notable, both directions", () => {
    const fwd = diffCategoryResult("wildfire_hazard", { whpClass: 2 }, { whpClass: 4 });
    expect(fwd).toHaveLength(1);
    expect(fwd[0]).toMatchObject({
      field: "whpClass",
      previousValue: "2",
      newValue: "4",
      severity: "notable",
    });
    const back = diffCategoryResult("wildfire_hazard", { whpClass: 4 }, { whpClass: 2 });
    expect(back).toHaveLength(1);
    expect(back[0].severity).toBe("notable");
  });
});

describe("diffCategoryResult — environmental", () => {
  it("a NEW superfund site within radius is notable (count increase)", () => {
    const out = diffCategoryResult(
      "environmental",
      { superfundSites: [], echoFacilitiesWithViolations: 2, ustSitesNearby: 1 },
      { superfundSites: [{ name: "Acme Plating" }], echoFacilitiesWithViolations: 2, ustSitesNearby: 1 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      field: "superfundCount",
      previousValue: "0",
      newValue: "1",
      severity: "notable",
    });
  });

  it("a superfund count decrease is info", () => {
    const out = diffCategoryResult(
      "environmental",
      { superfundSites: [{ name: "A" }, { name: "B" }] },
      { superfundSites: [{ name: "A" }] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "superfundCount", severity: "info" });
  });

  it("supports the EPA FRS numeric superfundCount shape", () => {
    const out = diffCategoryResult(
      "environmental",
      { superfundCount: 0 },
      { superfundCount: 2 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ previousValue: "0", newValue: "2", severity: "notable" });
  });

  it("echoFacilitiesWithViolations and ustSitesNearby changes are info", () => {
    const out = diffCategoryResult(
      "environmental",
      { superfundSites: [], echoFacilitiesWithViolations: 0, ustSitesNearby: 3 },
      { superfundSites: [], echoFacilitiesWithViolations: 1, ustSitesNearby: 2 },
    );
    expect(out).toHaveLength(2);
    expect(out.map((c) => [c.field, c.severity])).toEqual([
      ["echoFacilitiesWithViolations", "info"],
      ["ustSitesNearby", "info"],
    ]);
  });
});

describe("diffCategoryResult — broadband", () => {
  it("served flip is notable, both directions", () => {
    const fwd = diffCategoryResult("broadband", { served: true }, { served: false });
    expect(fwd).toHaveLength(1);
    expect(fwd[0]).toMatchObject({
      field: "served",
      previousValue: "true",
      newValue: "false",
      severity: "notable",
    });
    const back = diffCategoryResult("broadband", { served: false }, { served: true });
    expect(back).toHaveLength(1);
    expect(back[0].severity).toBe("notable");
  });

  it("speed changes alone produce no events (conservative)", () => {
    const out = diffCategoryResult(
      "broadband",
      { served: true, maxDownMbps: 100 },
      { served: true, maxDownMbps: 1000 },
    );
    expect(out).toEqual([]);
  });
});

describe("diffCategoryResult — null-transition non-events (pinned)", () => {
  it.each([
    ["flood_zone", "zone", "Zone AE"],
    ["wetlands", "hasWetlands", true],
    ["soil", "septicRating", "Very limited"],
    ["wildfire_hazard", "whpClass", 4],
    ["environmental", "ustSitesNearby", 3],
    ["broadband", "served", true],
  ])("%s.%s: null→value is first sight, not a change", (category, field, value) => {
    expect(diffCategoryResult(category, { [field]: null }, { [field]: value })).toEqual([]);
    expect(diffCategoryResult(category, {}, { [field]: value })).toEqual([]);
  });

  it.each([
    ["flood_zone", "riskLevel", "high"],
    ["wetlands", "classification", "Freshwater Pond"],
    ["soil", "hydricRating", "Yes"],
    ["wildfire_hazard", "whpClass", 2],
    ["environmental", "echoFacilitiesWithViolations", 1],
    ["broadband", "served", false],
  ])("%s.%s: value→null is a lookup gap, not a change", (category, field, value) => {
    expect(diffCategoryResult(category, { [field]: value }, { [field]: null })).toEqual([]);
    expect(diffCategoryResult(category, { [field]: value }, {})).toEqual([]);
  });

  it("environmental: missing superfund shape on either side is never a change", () => {
    expect(diffCategoryResult("environmental", {}, { superfundSites: [{ name: "A" }] })).toEqual([]);
    expect(diffCategoryResult("environmental", { superfundSites: [{ name: "A" }] }, {})).toEqual([]);
  });
});

describe("diffCategoryResult — never guess", () => {
  it("unknown categories produce no events", () => {
    expect(
      diffCategoryResult("zoning", { zone: "R-1" }, { zone: "C-2" }),
    ).toEqual([]);
    expect(diffCategoryResult("made_up_category", { a: 1 }, { a: 2 })).toEqual([]);
  });

  it("non-object payloads produce no events", () => {
    expect(diffCategoryResult("flood_zone", null, { zone: "Zone AE" })).toEqual([]);
    expect(diffCategoryResult("flood_zone", "Zone X", "Zone AE")).toEqual([]);
    expect(diffCategoryResult("flood_zone", [{ zone: "Zone X" }], { zone: "Zone AE" })).toEqual([]);
  });

  it("empty strings are not real values (no event either way)", () => {
    expect(diffCategoryResult("flood_zone", { zone: "" }, { zone: "Zone AE" })).toEqual([]);
    expect(diffCategoryResult("flood_zone", { zone: "Zone AE" }, { zone: "  " })).toEqual([]);
  });
});

describe("pointScopeRef", () => {
  it("rounds to exactly 4 decimal places", () => {
    expect(pointScopeRef(33.448376, -112.074036)).toBe("33.4484,-112.0740");
    expect(pointScopeRef(30.1, -97.7)).toBe("30.1000,-97.7000");
  });
});

describe("recordCategoryChanges (persistence wrapper, DB mocked)", () => {
  it("persists one row per detected change with the contract fields", async () => {
    const previousAsOf = new Date("2025-11-01T00:00:00.000Z");
    const changes = await recordCategoryChanges({
      category: "flood_zone",
      scopeType: "point",
      scopeRef: "33.4484,-112.0740",
      previous: { zone: "Zone X", riskLevel: "low" },
      next: { zone: "Zone AE", riskLevel: "high" },
      previousAsOf,
      source: "FEMA NFHL",
    });
    expect(changes).toHaveLength(2);
    expect(inserted).toHaveLength(1);
    const rows = inserted[0].rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      category: "flood_zone",
      scopeType: "point",
      scopeRef: "33.4484,-112.0740",
      field: "zone",
      previousValue: "Zone X",
      newValue: "Zone AE",
      previousAsOf,
      source: "FEMA NFHL",
      severity: "notable",
      narrative: "FEMA flood zone changed from Zone X to Zone AE at this point",
    });
    expect(rows[1]).toMatchObject({ field: "riskLevel", severity: "notable" });
  });

  it("writes nothing when there is no material change", async () => {
    const changes = await recordCategoryChanges({
      category: "flood_zone",
      scopeType: "point",
      scopeRef: "33.4484,-112.0740",
      previous: { zone: "Zone AE" },
      next: { zone: "Zone AE" },
      source: "FEMA NFHL",
    });
    expect(changes).toEqual([]);
    expect(inserted).toHaveLength(0);
  });

  it("never throws when the DB write fails (best-effort by contract)", async () => {
    insertShouldFail = true;
    await expect(
      recordCategoryChanges({
        category: "broadband",
        scopeType: "point",
        scopeRef: "30.1000,-97.7000",
        previous: { served: true },
        next: { served: false },
        source: "FCC Broadband Data Collection",
      }),
    ).resolves.toBeDefined();
    expect(inserted).toHaveLength(0);
  });
});

describe("listRecentChangeEvents (DB mocked)", () => {
  it("returns the query result without requiring a real DB", async () => {
    await expect(
      listRecentChangeEvents({ scopeType: "point", scopeRef: "30.1000,-97.7000", sinceDays: 30 }),
    ).resolves.toEqual([]);
  });
});
