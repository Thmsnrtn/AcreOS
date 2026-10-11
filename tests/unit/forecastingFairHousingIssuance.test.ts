/**
 * The fair-housing guard REFUSES ISSUANCE in production — not only in a test.
 *
 * forecastingFairHousing.test.ts proves the registered models are clean today.
 * This proves the production issuer (forecastLedger.issueForecasts, called by
 * the monthly job) consults the guard and fails closed: with a model that
 * reads a protected characteristic registered, it issues nothing for any
 * engine, names the violation, and never touches the database. Deleting the
 * guard call from issueForecasts turns this red.
 */
import { describe, expect, it, vi } from "vitest";

const touched: string[] = [];
vi.mock("../../server/db", () => {
  const trap = new Proxy({}, { get: (_t, k) => { touched.push(String(k)); throw new Error(`db.${String(k)} touched`); } });
  return { db: trap, pool: trap };
});

vi.mock("../../shared/forecasting/models", async (orig) => {
  const real = await orig<typeof import("../../shared/forecasting/models")>();
  return {
    ...real,
    FORECAST_MODELS: [
      ...real.FORECAST_MODELS,
      { id: "canary_model", label: "canary", geography: "county", features: [{ id: "ownerAge", description: "owner age", from: "outcome:x" }] },
    ],
  };
});

describe("issueForecasts fails closed on a fair-housing violation", () => {
  it("issues nothing, for every engine, and says why — before any database read", async () => {
    const { issueForecasts } = await import("../../server/services/forecasting/forecastLedger");
    const { FORECAST_ENGINES } = await import("../../shared/forecasting/frozenForecast");
    const r = await issueForecasts();
    expect(r.engines.map((e) => e.engineId).sort()).toEqual(FORECAST_ENGINES.map((e) => e.id).sort());
    for (const e of r.engines) {
      expect(e.issued).toBe(0);
      expect(e.refused).toMatch(/fair-housing guard: canary_model\.ownerAge#id uses "age"/);
    }
    expect(touched).toEqual([]);
  });
});
