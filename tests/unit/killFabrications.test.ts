/**
 * Quinn — kill-fabrications regression suite.
 *
 * Truth-immutable: each formerly Math.random()-fabricated customer-fact
 * surface must now return real-or-honest-empty. These tests pin the
 * no-fabrication invariants so they can't silently regress:
 *
 *  1. Skip-trace result mapping never mints verified:true and never invents
 *     contacts/relatives.
 *  2. Pipeline analytics (velocity / conversion) return honest-empty per-stage
 *     shapes with no random values.
 *
 * (A former section pinned satellite-imagery honesty in
 * server/jobs/satelliteImageUpdate.ts; that module was deleted 2026-08-01 —
 * see the note at the old section site below.)
 */

import { describe, it, expect } from "vitest";
import {
  mapSkipTraceResults,
} from "../../server/routes-leads";
import type { SkipTraceResult } from "../../server/services/skipTracingService";

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

// ── 2. Satellite imagery honesty — REMOVED 2026-08-01 ─────────────────────
//
// The describe block that lived here pinned isImageryProviderConfigured /
// fetchSatelliteImagery honesty (null imagery, no fabricated NDVI/cloud/date)
// in server/jobs/satelliteImageUpdate.ts. That job was a verified module
// orphan (zero importers, never scheduled) and a standing deletion-ledger
// KILL (Satellite / Vision AI); the file was deleted 2026-08-01. The block
// pinned fabrication-honesty over now-deleted code, so it is removed rather
// than rewritten — there is no surviving satellite-imagery code path for the
// invariant to guard. If satellite imagery is ever rebuilt, re-pin the
// no-fabrication invariant here first.

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
    // Wave 7 slice 16: the analytics methods moved from storage.ts into the
    // analyticsRepo mixin — the guard follows the code.
    const src = await fs.readFile(
      path.resolve(__dirname, "../../server/storage/analyticsRepo.ts"),
      "utf8",
    );
    const velocityIdx = src.indexOf("async getDealVelocity(");
    const conversionIdx = src.indexOf("async getConversionRates(");
    expect(velocityIdx).toBeGreaterThan(-1);
    expect(conversionIdx).toBeGreaterThan(-1);

    // velocity runs from its declaration to getPipelineValue; conversion runs
    // to the end of the file (it is the repo's final method).
    const velocityBlock = src.slice(velocityIdx, src.indexOf("async getPipelineValue("));
    const conversionBlock = src.slice(conversionIdx);
    expect(velocityBlock.includes("Math.random")).toBe(false);
    expect(conversionBlock.includes("Math.random")).toBe(false);
    // And they explicitly return honest-empty per-stage arrays.
    expect(velocityBlock.includes("avgDaysPerStage: []")).toBe(true);
    expect(conversionBlock.includes("stageConversions: []")).toBe(true);
    expect(conversionBlock.includes("lossReasons: []")).toBe(true);
  });
});
