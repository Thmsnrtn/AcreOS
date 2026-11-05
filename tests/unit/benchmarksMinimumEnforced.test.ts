/**
 * Legal-run Leg 4 — the Data-API benchmarks endpoint enforces the minimum it
 * states. Before 2026-11-03 the handler aggregated with no count check and
 * always said "Min 10 transactions required to display", so a cohort of one
 * public-record sale was served as an "average" equal to that sale's own
 * price-per-acre.
 *
 * Drives the REAL router (server/routes-data-api.ts) with the aggregate row
 * the database would return, and asserts the response — not the helper — so
 * the handler cannot bypass shapeBenchmarks() and stay green.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({ row: undefined as any }));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (_q: any, _s: any, n: any) => n(),
  requireFounder: (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/services/dataApiKeys", () => ({
  verifyApiKey: async (k: string) => (k === "good" ? { id: 1, provider: "partner_test" } : null),
}));
vi.mock("../../server/db", () => {
  const c: any = {
    from: () => c,
    where: () => c,
    orderBy: () => c,
    groupBy: () => c,
    limit: () => Promise.resolve(h.row === undefined ? [] : [h.row]),
  };
  return { db: { select: () => c } };
});

import router from "../../server/routes-data-api";
import {
  BENCHMARK_MIN_SAMPLE,
  BENCHMARK_NOTE_INSUFFICIENT,
  BENCHMARK_NOTE_SERVED,
} from "../../server/services/benchmarkCohort";

const app = express();
app.use("/api/data", router);

const get = () => request(app).get("/api/data/benchmarks/tx/land").set("x-api-key", "good");

// Postgres returns AVG as numeric strings and COUNT(*) as a bigint string.
const cohort = (count: number) => ({ avgPricePerAcre: "4321.5", avgAcreage: "12.25", count: String(count) });

describe("GET /benchmarks — the stated minimum is enforced", () => {
  beforeEach(() => {
    h.row = undefined;
  });

  it("the minimum is 10, as the endpoint has always claimed", () => {
    expect(BENCHMARK_MIN_SAMPLE).toBe(10);
  });

  for (const n of [0, 1, 9]) {
    it(`count=${n}: no figures served, true sample size reported, insufficient-data note`, async () => {
      h.row = cohort(n);
      const res = await get();
      expect(res.status).toBe(200);
      const b = res.body.benchmarks;
      expect(b.avgPricePerAcre).toBeNull();
      expect(b.avgAcreage).toBeNull();
      expect(b.sampleSize).toBe(n);
      expect(b.insufficientData).toBe(true);
      expect(b.dataPrivacyNote).toBe(BENCHMARK_NOTE_INSUFFICIENT);
      // The one-sale "average" that started this finding must be unreachable.
      expect(JSON.stringify(res.body)).not.toContain("4321.5");
      expect(JSON.stringify(res.body)).not.toContain("12.25");
    });
  }

  it("no aggregate row at all: insufficient, sample size 0", async () => {
    h.row = undefined;
    const res = await get();
    expect(res.body.benchmarks).toMatchObject({ avgPricePerAcre: null, avgAcreage: null, sampleSize: 0, insufficientData: true });
  });

  for (const n of [10, 250]) {
    it(`count=${n}: figures served`, async () => {
      h.row = cohort(n);
      const res = await get();
      const b = res.body.benchmarks;
      expect(b.avgPricePerAcre).toBe(4321.5);
      expect(b.avgAcreage).toBe(12.25);
      expect(b.sampleSize).toBe(n);
      expect(b.insufficientData).toBe(false);
      expect(b.dataPrivacyNote).toBe(BENCHMARK_NOTE_SERVED);
    });
  }

  it("still requires an API key", async () => {
    const res = await request(app).get("/api/data/benchmarks/tx/land");
    expect(res.status).toBe(401);
  });
});

describe("the copy describes the behaviour", () => {
  it("both notes name the enforced minimum", () => {
    expect(BENCHMARK_NOTE_SERVED).toContain(String(BENCHMARK_MIN_SAMPLE));
    expect(BENCHMARK_NOTE_INSUFFICIENT).toContain(String(BENCHMARK_MIN_SAMPLE));
    expect(BENCHMARK_NOTE_INSUFFICIENT.toLowerCase()).toContain("no average");
  });

  it("the handler carries no inline privacy-note literal of its own (copy lives beside the rule)", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-data-api.ts"), "utf8"));
    expect(src).not.toMatch(/dataPrivacyNote\s*:/);
    expect(src).not.toMatch(/Min\s+\d+\s+transactions/i);
    expect(src).toMatch(/shapeBenchmarks\(/);
  });
});
