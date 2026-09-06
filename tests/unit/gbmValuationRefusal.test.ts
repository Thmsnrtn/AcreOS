/**
 * The GBM valuation may not price a parcel off a national constant.
 *
 * ── THE DEFECT, AND WHY IT SURVIVED ITS OWN FIX ─────────────────────────────
 * `generateValuation`'s no-comparables branch carries this note, from an
 * earlier honesty pass:
 *
 *   // W3.1: no fabricated baseline. … The old `= 1000` seed meant every
 *   // parcel in America "was worth" $1,000/acre the moment both real paths
 *   // failed — branded as a proprietary model.
 *
 * That fix removed the visible `= 1000`. One level down, inside the model's
 * own feature vector, sat:
 *
 *   pricePerAcreComps: compsMedianPricePerAcre || 1000,
 *   // National median vacant land baseline when no comps available
 *
 * and the only caller passed `0` — so the `||` fired on EVERY call. Same
 * number, same effect, same billable surface (`/api/avm` debits the customer's
 * credit pool). The symbol was deleted; the behaviour was not. That is the
 * standing law about falsifying against the SEMANTIC defect rather than the
 * identifier, demonstrated on a fix that had already been made once.
 *
 * The feature is not incidental: it is price-per-acre, the model's target
 * variable in input form. Given a constant, the prediction is largely a
 * function of that constant, and the result is returned as `gbm_model`.
 *
 * ── WHAT THIS FILE GATES ────────────────────────────────────────────────────
 * 1. The consequence is real: the trained model's output tracks its comps
 *    input, so pinning that input pins the answer.
 * 2. With a model installed and no comparables, the SERVICE refuses —
 *    asserted through `generateValuation`, not through a re-implementation of
 *    the private estimator, which would agree with any implementation.
 * 3. No numeric fallback may return to that feature, under any value, and the
 *    caller must pass the absence rather than a falsy stand-in.
 * 4. Confidence depends on this parcel's inputs, and the methodology names the
 *    features that were assumed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../helpers/stripComments";
import {
  GradientBoostingRegressor,
  LAND_FEATURE_NAMES,
  extractLandFeatures,
} from "../../server/services/gradientBoosting";

const SERVICE = join(__dirname, "..", "..", "server/services/acreOSValuation.ts");

/** Source with comments stripped — a scanner that reads its own fix notes is
 *  matching prose, not code. */
function serviceCode(): string {
  return stripComments(readFileSync(SERVICE, "utf8"));
}

/**
 * A real trained model, fitted here so the tests exercise the actual
 * regressor rather than a stub. The training set makes price-per-acre the
 * dominant signal, which is what makes the constant-input defect
 * consequential in the first place.
 */
function trainedModel(): GradientBoostingRegressor {
  const rows: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < 120; i++) {
    const comps = 500 + (i % 20) * 250; // 500 … 5,250
    rows.push(
      extractLandFeatures({
        acres: 5 + (i % 7) * 10,
        pricePerAcreComps: comps,
        daysOnMarket: 0,
        distanceToHighwayMiles: 5,
        distanceToCityMiles: 20,
        hasWaterAccess: i % 3 === 0,
        hasRoadFrontage: i % 2 === 0,
        zoningScore: i % 4,
        soilQualityScore: 5,
        floodZoneRisk: i % 3,
        marketTrendScore: 0,
        countyMedianIncomeK: 55,
        populationGrowthPct: 0,
      }),
    );
    y.push(comps * 1.05 + (i % 3) * 40); // target tracks comps
  }
  const m = new GradientBoostingRegressor({ nEstimators: 40, maxDepth: 3 });
  m.fit(rows, y);
  return m;
}

let modelJson: string;

beforeEach(() => {
  modelJson = JSON.stringify(trainedModel().toJSON());
  vi.resetModules();
  vi.stubEnv("GBM_MODEL_JSON", modelJson);
  // The AI rung must not be able to answer, so the GBM is the only thing that
  // could produce a number and the refusal is unambiguous.
  vi.stubEnv("AI_INTEGRATIONS_OPENROUTER_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * The estimator is module-private, so it is exercised through its ONE caller:
 * `generateValuation`'s no-comparables path. A helper that re-implemented the
 * refusal would agree with any implementation — the failure mode this repo has
 * already been bitten by ("a nudger mock resolving undefined, so the suite
 * agreed with any implementation of a status it never read").
 */
async function valuationWithNoComps(acres = 40) {
  vi.resetModules();
  const empty = { then: (r: (v: unknown) => void) => r([]) };
  vi.doMock("../../server/db", () => ({
    db: {
      select: () => ({ from: () => ({ where: () => empty, ...empty }) }),
      insert: () => ({
        values: () => ({ returning: () => ({ then: (r: (v: unknown) => void) => r([{ id: 1 }]) }), ...empty }),
      }),
    },
  }));
  // Land persona, so the residential fork is not taken.
  vi.doMock("../../server/services/residentialComps", () => ({
    getOrgBusinessType: async () => "land_investor",
  }));
  vi.doMock("../../server/services/mlSnapshots", () => ({ recordSnapshotAsync: () => {} }));
  const { acreOSValuation } = await import("../../server/services/acreOSValuation");
  return acreOSValuation.generateValuation("7", {
    propertyId: "0", // 0 skips the land-status parcel lookup
    acres,
    location: { state: "OH", county: "Franklin", zipCode: "43004", latitude: 40, longitude: -83 },
    characteristics: { zoning: "agricultural", roadAccess: "gravel" },
  } as never);
}

describe("the model's price input is load-bearing", () => {
  it("vacuity guard: the fixture model is trained and comps DOMINATE it", () => {
    const m = GradientBoostingRegressor.fromJSON(JSON.parse(modelJson));
    expect(LAND_FEATURE_NAMES).toHaveLength(13);
    const importances = m.getFeatureImportances();
    expect(importances).toHaveLength(13);
    const compsIdx = LAND_FEATURE_NAMES.indexOf("price_per_acre_comps");
    expect(compsIdx).toBe(1);
    // If comps did not dominate, the defect would have been harmless and
    // every assertion below vacuous.
    expect(
      importances[compsIdx],
      "the fixture model does not depend on price_per_acre_comps",
    ).toBe(Math.max(...importances));
  });

  it("the trained model's prediction tracks the comps input", () => {
    const m = GradientBoostingRegressor.fromJSON(JSON.parse(modelJson));
    const at = (comps: number) =>
      m.predict(
        extractLandFeatures({
          acres: 40, pricePerAcreComps: comps, daysOnMarket: 0,
          distanceToHighwayMiles: 5, distanceToCityMiles: 20,
          hasWaterAccess: false, hasRoadFrontage: true, zoningScore: 1,
          soilQualityScore: 5, floodZoneRisk: 0, marketTrendScore: 0,
          countyMedianIncomeK: 55, populationGrowthPct: 0,
        }),
      );
    // 1000 — the old constant — sits squarely between these.
    expect(at(4800)).toBeGreaterThan(at(800) * 2);
  });
});

describe("with a model installed and no comps, the valuation REFUSES", () => {
  it("returns insufficient_data rather than a trained_model estimate", async () => {
    const v = await valuationWithNoComps(40);
    expect(v.status).toBe("insufficient_data");
    expect(v.classification).toBe("insufficient_data");
    expect(v.estimatedValue).toBe(0);
    expect(v.pricePerAcre).toBe(0);
    expect(v.confidence).toBe(0);
    // And it says what is missing, so the refusal is actionable.
    expect(v.missing?.join(" ")).toMatch(/Comparable land sales in Franklin County, OH/);
  });

  it("refuses at every parcel size — the gap is the price signal, not the acreage", async () => {
    for (const acres of [1, 40, 640]) {
      const v = await valuationWithNoComps(acres);
      expect(v.status, `${acres} acres produced a value`).toBe("insufficient_data");
      // The old path returned ~1000/acre * acres. That number may never
      // come back, at any size.
      expect(v.estimatedValue).not.toBe(1000 * acres);
    }
  });
});

describe("no numeric fallback may return to the comps feature", () => {
  it("no `||`/`??` numeric default on pricePerAcreComps, and the caller passes null", () => {
    const src = serviceCode();
    expect(src.length, "the comment stripper ate the file").toBeGreaterThan(5000);
    // The defect is the FALLBACK, not the literal 1000 — any number fails.
    expect(src).not.toMatch(/pricePerAcreComps:\s*[^,\n]*(\|\||\?\?)\s*-?\d/);
    // And the caller must pass the ABSENCE. Passing `0` is exactly what made
    // the old `|| 1000` fire on every call, so a falsy stand-in fails too.
    expect(src).toMatch(/gbmEstimatePricePerAcre\(\s*\n\s*request\.acres,\s*\n\s*null,/);
  });

  it("the estimator declines on a non-positive or non-finite price signal", () => {
    const src = serviceCode();
    // The refusal covers the whole family the old `||` swallowed: null,
    // undefined, 0, negative, NaN.
    expect(src).toMatch(
      /compsMedianPricePerAcre === null \|\| !Number\.isFinite\(compsMedianPricePerAcre\) \|\| compsMedianPricePerAcre <= 0/,
    );
  });
});

describe("confidence reflects this parcel, not just the model", () => {
  it("the reported confidence is discounted by the unmeasured features", () => {
    const src = serviceCode();
    // `topImportance` is a property of the TRAINED MODEL, so a confidence
    // built only from it is identical for every parcel that model ever
    // scores — which is not a confidence.
    expect(src).toMatch(/modelConfidence \* measuredShare/);
    // The discount must be a function of the CALL, not a constant: the
    // assumed list widens when market conditions are absent.
    expect(src).toMatch(/marketConditions\.populationGrowth === undefined/);
  });

  it("a modeled value discloses the inputs it did not have", () => {
    const src = serviceCode();
    expect(src).toMatch(/model inputs were not measured for this parcel and used defaults/);
    expect(src).toMatch(/gbmAssumedFeatures\.join/);
  });
});
