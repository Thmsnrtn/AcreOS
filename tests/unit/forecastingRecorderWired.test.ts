/**
 * The vintage recorder is built AND wired: the provider is registered for its
 * category, the job is started by the orchestrator and has a deadman roster
 * row, the route is mounted, and each source parser reads the real shape —
 * refusing, never defaulting, on a missing key or a suppressed value.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";
import { parseBpsStateFile, parseFredObservations, parseNassLandValues, publicSeriesReadiness, publicSeriesProvider } from "../../server/services/forecasting/publicSeriesProvider";
import { JOB_ROSTER } from "../../server/jobs/jobRegistry";
import { isForecastingHour } from "../../server/jobs/forecastingJobs";
import { PUBLIC_SERIES } from "../../shared/forecasting/publicSeries";
import { licenseFor, mayCacheAndRedistribute } from "../../server/services/providers/data-licenses";
import { CATEGORY_CACHE_TTL_MS } from "../../server/services/providers/cache-ttl";

describe("wiring", () => {
  it("the orchestrator starts the monthly job (in code, not in a comment)", () => {
    const src = stripComments(readFileSync("server/jobs/runScheduledJobs.ts", "utf8"));
    expect(src).toMatch(/import \{ startForecastingMonthlyJob \} from "\.\/forecastingJobs"/);
    expect(src).toMatch(/\n\s*startForecastingMonthlyJob\(\);/);
  });
  it("the job takes the lock its roster row names, and the deadman watches it", () => {
    const src = stripComments(readFileSync("server/jobs/forecastingJobs.ts", "utf8"));
    expect(src).toMatch(/withJobLock\("forecasting_monthly"/);
    const row = JOB_ROSTER.find((r) => r.name === "forecasting_monthly");
    expect(row?.cron).toBe("0 6 25 * *");
  });
  it("fires in exactly one hour a month", () => {
    expect(isForecastingHour(new Date("2026-10-25T06:30:00Z"))).toBe(true);
    expect(isForecastingHour(new Date("2026-10-25T07:00:00Z"))).toBe(false);
    expect(isForecastingHour(new Date("2026-10-24T06:00:00Z"))).toBe(false);
  });
  it("the provider is registered for macro_series in providers-init", () => {
    const src = stripComments(readFileSync("server/providers-init.ts", "utf8"));
    expect(src).toMatch(/providerRegistry\.register\(category, publicSeriesProvider, \d+\)/);
    expect(publicSeriesProvider.categories).toEqual(["macro_series"]);
    expect(publicSeriesProvider.costPerLookupCents("macro_series")).toBe(0);
    expect(CATEGORY_CACHE_TTL_MS.macro_series).toBeGreaterThan(0);
  });
  it("the founder route is mounted", () => {
    const src = stripComments(readFileSync("server/routes.ts", "utf8"));
    expect(src).toMatch(/\n\s*registerFounderForecastingRoutes\(app\);/);
  });
});

describe("licences — every family is in the register, cacheable, with its terms", () => {
  for (const f of PUBLIC_SERIES) {
    it(f.id, () => {
      const l = licenseFor(f.licenseSource);
      expect(l.source).toBe(f.licenseSource);
      expect(l.lastReviewed).not.toBe("1970-01-01");
      expect(l.termsUrl).toBeTruthy();
      expect(mayCacheAndRedistribute(f.licenseSource)).toBe(true);
    });
  }
  it("the non-commercial Philadelphia Fed indexes are recorded as not usable", () => {
    expect(mayCacheAndRedistribute("FRED (Philadelphia Fed state coincident indexes)")).toBe(false);
    expect(PUBLIC_SERIES.some((f) => /Philadelphia/i.test(f.publisher))).toBe(false);
  });
});

describe("refusals, not defaults", () => {
  it("a family that needs a key refuses without it, naming the key", () => {
    expect(publicSeriesReadiness("state_payrolls", {})).toMatch(/FRED_API_KEY not set/);
    expect(publicSeriesReadiness("state_ag_land_value", {})).toMatch(/NASS_API_KEY not set/);
    expect(publicSeriesReadiness("state_payrolls", { FRED_API_KEY: "k" })).toBeNull();
    expect(publicSeriesReadiness("state_permits_nsa", {})).toBeNull();
  });
  it("the provider throws the refusal instead of answering", async () => {
    const saved = process.env.FRED_API_KEY;
    delete process.env.FRED_API_KEY;
    try {
      await expect(publicSeriesProvider.lookup("macro_series", { type: "series", seriesId: "TNNA", family: "state_payrolls", state: "TN" })).rejects.toThrow(/FRED_API_KEY/);
      await expect(publicSeriesProvider.lookup("macro_series", { type: "series", seriesId: "TXNA", family: "state_payrolls", state: "TN" })).rejects.toThrow(/not state_payrolls for TN/);
    } finally {
      if (saved !== undefined) process.env.FRED_API_KEY = saved;
    }
  });
});

describe("source parsers read the real shapes", () => {
  it("Census BPS: total units = 1 + 2 + 3–4 + 5+ unit estimates (TN, Aug 2026 = 3,217, as FRED's TNBPPRIV shows)", () => {
    const text = [
      "Survey,FIPS,Region,Division,State,,1-unit,,,2-units,,,3-4 units,,,5+ units,,,1-unit rep,,,2-units rep,,,3-4 units rep       ,,,5+ units rep",
      "Date,State,Code,Code,Name,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,      Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,      Bldgs,Units,Value,Bldgs,Units,Value",
      " ",
      "202608,47,3,6,Tennessee,2722,2722,887908,10,20,2467,12,46,6605,20,429,66515,1909,1909,676118,3,6,661,10,40,5701,14,299,45041",
    ].join("\n");
    const p = parseBpsStateFile(text)!;
    expect(p.month).toBe("2026-08-01");
    expect(p.byFips.get("47")).toBe(3217);
    expect(parseBpsStateFile("not a bps file")).toBeNull();
  });
  it("FRED: '.' is missing and skipped, never zero; an error reply throws", () => {
    expect(parseFredObservations({ observations: [{ date: "2026-07-01", value: "3250.1" }, { date: "2026-08-01", value: "." }] })).toEqual([{ observationDate: "2026-07-01", value: 3250.1 }]);
    expect(() => parseFredObservations({ error_code: 400, error_message: "Bad Request. api_key is not registered" })).toThrow(/api_key/);
  });
  it("NASS: thousands separators are read, suppressed (D) values skipped", () => {
    expect(parseNassLandValues({ data: [{ year: 2026, Value: "6,500", reference_period_desc: "YEAR" }, { year: 2025, Value: " (D)", reference_period_desc: "YEAR" }] })).toEqual([{ observationDate: "2026-01-01", value: 6500 }]);
    expect(() => parseNassLandValues({ error: ["unauthorized"] })).toThrow(/unauthorized/);
  });
});
