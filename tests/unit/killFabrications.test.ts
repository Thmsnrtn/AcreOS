/**
 * Quinn — kill-fabrications regression suite.
 *
 * Truth-immutable: each formerly Math.random()-fabricated customer-fact
 * surface must now return real-or-honest-empty. These tests pin the
 * no-fabrication invariants so they can't silently regress:
 *
 *  1. Skip-trace result mapping never mints verified:true and never invents
 *     contacts/relatives.
 *  2. Satellite imagery is unavailable (null) with no provider configured,
 *     so the job writes no snapshot / change score.
 *  3. Pipeline analytics (velocity / conversion) return honest-empty per-stage
 *     shapes with no random values.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mapSkipTraceResults,
} from "../../server/routes-leads";
import type { SkipTraceResult } from "../../server/services/skipTracingService";
import {
  isImageryProviderConfigured,
  fetchSatelliteImagery,
} from "../../server/jobs/satelliteImageUpdate";

// ── 1. Skip-trace mapping ─────────────────────────────────────────────────

describe("mapSkipTraceResults (skip-trace PII honesty)", () => {
  it("never mints verified:true for any phone or email", () => {
    const trace: SkipTraceResult = {
      success: true,
      source: "batch_skip_tracing",
      contacts: [
        { type: "phone", value: "+15551234567", confidence: 0.99, isPrimary: true, lineType: "mobile" },
        { type: "phone", value: "+15557654321", confidence: 0.4, isPrimary: false, lineType: "landline" },
        { type: "email", value: "real@example.com", confidence: 0.95, isPrimary: true },
      ],
    };

    const { results } = mapSkipTraceResults(trace);

    expect(results.phones).toHaveLength(2);
    expect(results.emails).toHaveLength(1);
    // No verified:true is ever minted — provider gives confidence, not a
    // source-asserted verification.
    for (const p of results.phones) expect(p.verified).toBe(false);
    for (const e of results.emails) expect(e.verified).toBe(false);
  });

  it("does not invent phones, emails, relatives, or addresses when the provider returns none", () => {
    const trace: SkipTraceResult = {
      success: true,
      source: "batch_skip_tracing",
      contacts: [],
    };

    const { results, hasAny } = mapSkipTraceResults(trace);

    expect(results.phones).toEqual([]);
    expect(results.emails).toEqual([]);
    expect(results.relatives).toEqual([]);
    expect(results.addresses).toBeUndefined();
    expect(results.ageRange).toBeUndefined();
    expect(hasAny).toBe(false);
  });

  it("carries through real owner data without fabricating relatives", () => {
    const trace: SkipTraceResult = {
      success: true,
      source: "batch_skip_tracing",
      contacts: [
        { type: "phone", value: "+15551112222", confidence: 0.8, isPrimary: true },
      ],
      owner: { address: "123 Real St, Town, ST 00000", age: 51 },
    };

    const { results, hasAny } = mapSkipTraceResults(trace);

    expect(hasAny).toBe(true);
    expect(results.addresses).toEqual([
      { address: "123 Real St, Town, ST 00000", type: "current", current: true },
    ]);
    expect(results.ageRange).toBe("51");
    // Relatives are NEVER fabricated — only present if the provider returns them.
    expect(results.relatives).toEqual([]);
  });

  it("produces no fabricated email like first.last@email.com", () => {
    const trace: SkipTraceResult = {
      success: true,
      source: "batch_skip_tracing",
      contacts: [{ type: "email", value: "verified@provider.io", confidence: 0.9, isPrimary: true }],
    };
    const { results } = mapSkipTraceResults(trace);
    const emails = results.emails.map((e) => e.email);
    expect(emails).toEqual(["verified@provider.io"]);
    expect(emails.some((e) => /@email\.com$/.test(e))).toBe(false);
  });
});

// ── 2. Satellite imagery honesty ──────────────────────────────────────────

describe("satellite imagery (no fabricated NDVI / change score)", () => {
  const KEYS = [
    "SATELLITE_IMAGERY_API_KEY",
    "SENTINEL_HUB_API_KEY",
    "PLANET_API_KEY",
    "NEARMAP_API_KEY",
  ];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reports no provider configured when no imagery key is set", () => {
    expect(isImageryProviderConfigured()).toBe(false);
  });

  it("returns null imagery (unavailable) rather than fabricating NDVI/cloud/date", async () => {
    const imagery = await fetchSatelliteImagery(1, 39.5, -98.35);
    expect(imagery).toBeNull();
  });

  it("recognizes a configured provider key", () => {
    process.env.SENTINEL_HUB_API_KEY = "test-key";
    expect(isImageryProviderConfigured()).toBe(true);
  });
});

// ── 3. Pipeline analytics honest-empty (no random) ─────────────────────────
//
// getDealVelocity / getConversionRates are DB-bound storage methods. Rather
// than stand up a DB, we assert the structural honesty contract that the
// route consumers depend on: the per-stage breakdowns are empty arrays (not
// fabricated/random), so the client renders an honest "not enough history"
// state and only real aggregates (avgTotalDays, overallWinRate) appear.

describe("pipeline analytics honest-empty contract", () => {
  it("velocity/conversion source contains no Math.random in the analytics methods", async () => {
    // Guard against reintroduction: the storage module text for these two
    // methods must not contain Math.random().
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(__dirname, "../../server/storage.ts"),
      "utf8",
    );
    const velocityIdx = src.indexOf("async getDealVelocity(");
    const conversionIdx = src.indexOf("async getConversionRates(");
    expect(velocityIdx).toBeGreaterThan(-1);
    expect(conversionIdx).toBeGreaterThan(-1);

    // velocity runs from its declaration to getPipelineValue; conversion from
    // its declaration to the next method (getAutomationRules).
    const velocityBlock = src.slice(velocityIdx, src.indexOf("async getPipelineValue("));
    const conversionBlock = src.slice(conversionIdx, src.indexOf("async getAutomationRules("));
    expect(velocityBlock.includes("Math.random")).toBe(false);
    expect(conversionBlock.includes("Math.random")).toBe(false);
    // And they explicitly return honest-empty per-stage arrays.
    expect(velocityBlock.includes("avgDaysPerStage: []")).toBe(true);
    expect(conversionBlock.includes("stageConversions: []")).toBe(true);
    expect(conversionBlock.includes("lossReasons: []")).toBe(true);
  });
});
