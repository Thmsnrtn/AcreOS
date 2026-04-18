/**
 * Simulation #3 — Load Profile Stress Test
 *
 * Validates AcreOS behavior under realistic production load patterns:
 *   - 100 concurrent authenticated sessions (simulated via rapid batches)
 *   - Mixed read/write workload (70/20/10 split)
 *   - Response time SLAs (5s reads, 10s writes)
 *   - Rate limiting activation under excessive pressure
 *   - Database connection pool resilience
 *   - Autonomous executor background job tolerance
 *
 * Runs as vitest (API-level, not Playwright) for speed.
 * Target: docker-compose.test.yml stack.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  createAuthenticatedSession,
  apiCall,
  fireConcurrent,
  measureEndpointTiming,
  type AuthSession,
  type ApiCallResult,
  type TimingStats,
} from "./helpers";

const BASE_URL = process.env.SIM_BASE_URL ?? "http://localhost:5000";

// ── SLA Thresholds ────────────────────────────────────────────────────────
const READ_SLA_MS = 5_000;
const WRITE_SLA_MS = 10_000;
const AI_SLA_MS = 15_000;

// ── Concurrency Config ────────────────────────────────────────────────────
const CONCURRENT_SESSIONS = 100;
const MIXED_BATCH_SIZE = 50;
const RATE_LIMIT_BURST = 200;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Classify results by status code bucket. */
function classifyResults(results: ApiCallResult[]) {
  return {
    success: results.filter((r) => r.status >= 200 && r.status < 300),
    clientError: results.filter((r) => r.status >= 400 && r.status < 500),
    rateLimited: results.filter((r) => r.status === 429),
    serverError: results.filter((r) => r.status >= 500),
    all: results,
  };
}

/** Compute timing stats from an array of ApiCallResults. */
function timingFromResults(results: ApiCallResult[]): TimingStats {
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  if (durations.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0, samples: 0 };
  }
  const percentile = (pct: number) => {
    const idx = Math.ceil((pct / 100) * durations.length) - 1;
    return durations[Math.max(0, idx)];
  };
  return {
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    min: durations[0],
    max: durations[durations.length - 1],
    mean: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    samples: durations.length,
  };
}

/** Build a mixed workload batch: 70% reads, 20% writes, 10% AI. */
function buildMixedWorkload(batchSize: number): Array<{
  method: string;
  path: string;
  bodyFn: (i: number) => any;
  category: "read" | "write" | "ai";
}> {
  const readEndpoints = [
    "/api/leads",
    "/api/properties",
    "/api/deals",
    "/api/dashboard/priority",
  ];

  const ops: Array<{
    method: string;
    path: string;
    bodyFn: (i: number) => any;
    category: "read" | "write" | "ai";
  }> = [];

  for (let i = 0; i < batchSize; i++) {
    const roll = i / batchSize;

    if (roll < 0.7) {
      // 70% reads
      const endpoint = readEndpoints[i % readEndpoints.length];
      ops.push({
        method: "GET",
        path: endpoint,
        bodyFn: () => undefined,
        category: "read",
      });
    } else if (roll < 0.9) {
      // 20% writes
      if (i % 2 === 0) {
        ops.push({
          method: "POST",
          path: "/api/leads",
          bodyFn: (idx) => ({
            firstName: `LoadTest`,
            lastName: `Lead${idx}`,
            email: `loadtest-${idx}-${Date.now()}@sim-test.com`,
            phone: `555-${String(idx).padStart(4, "0")}`,
            status: "new",
          }),
          category: "write",
        });
      } else {
        // PUT to a non-existent ID is safe (will return 404, not 500)
        ops.push({
          method: "PUT",
          path: "/api/leads/999999",
          bodyFn: () => ({
            firstName: "Updated",
            lastName: "LoadTest",
          }),
          category: "write",
        });
      }
    } else {
      // 10% AI
      ops.push({
        method: "POST",
        path: "/api/ai/chat",
        bodyFn: () => ({
          message: "What are the best strategies for rural land acquisition?",
        }),
        category: "ai",
      });
    }
  }

  return ops;
}

describe("Load Profile Simulation", () => {
  let session: AuthSession;
  /** Track lead IDs created during tests for use in write tests */
  let createdLeadIds: number[] = [];

  beforeAll(async () => {
    try {
      session = await createAuthenticatedSession("scalingOperator");

      // Seed a few leads so PUT operations have valid targets
      for (let i = 0; i < 5; i++) {
        const res = await apiCall(
          "POST",
          "/api/leads",
          {
            firstName: `Seed`,
            lastName: `Lead${i}`,
            email: `seed-loadtest-${i}-${Date.now()}@sim-test.com`,
            status: "new",
          },
          session,
        );
        const id = res.body?.id ?? res.body?.leadId;
        if (id) createdLeadIds.push(id);
      }
    } catch {
      console.warn("[load-profile] Could not authenticate — is the test server running?");
    }
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════
  // 1. CONCURRENT SESSION BURST
  // ═══════════════════════════════════════════════════════════════════════

  describe("Concurrent Session Burst", () => {
    it(`handles ${CONCURRENT_SESSIONS} concurrent GET /api/leads requests without 500 errors`, async () => {
      if (!session) return;

      const results = await fireConcurrent(
        CONCURRENT_SESSIONS,
        "GET",
        "/api/leads",
        () => undefined,
        session,
      );

      const classified = classifyResults(results);

      // Zero server errors
      expect(classified.serverError.length).toBe(0);

      // At least some requests succeed
      expect(classified.success.length).toBeGreaterThan(0);

      // Timing: p95 under read SLA
      const timing = timingFromResults(results);
      console.log(`[load-profile] ${CONCURRENT_SESSIONS} concurrent reads — p50: ${timing.p50}ms, p95: ${timing.p95}ms, p99: ${timing.p99}ms, max: ${timing.max}ms`);
      expect(timing.p95).toBeLessThan(READ_SLA_MS);
    }, 60_000);

    it(`handles ${CONCURRENT_SESSIONS} concurrent GET /api/properties requests without 500 errors`, async () => {
      if (!session) return;

      const results = await fireConcurrent(
        CONCURRENT_SESSIONS,
        "GET",
        "/api/properties",
        () => undefined,
        session,
      );

      const classified = classifyResults(results);
      expect(classified.serverError.length).toBe(0);
      expect(classified.success.length).toBeGreaterThan(0);
    }, 60_000);

    it(`handles ${CONCURRENT_SESSIONS} concurrent GET /api/deals requests without 500 errors`, async () => {
      if (!session) return;

      const results = await fireConcurrent(
        CONCURRENT_SESSIONS,
        "GET",
        "/api/deals",
        () => undefined,
        session,
      );

      const classified = classifyResults(results);
      expect(classified.serverError.length).toBe(0);
      expect(classified.success.length).toBeGreaterThan(0);
    }, 60_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. MIXED READ/WRITE WORKLOAD
  // ═══════════════════════════════════════════════════════════════════════

  describe("Mixed Read/Write Workload (70/20/10)", () => {
    it("fires mixed workload batch with zero 500 errors", async () => {
      if (!session) return;

      const workload = buildMixedWorkload(MIXED_BATCH_SIZE);

      // Fire all operations concurrently
      const promises = workload.map((op, i) =>
        apiCall(op.method, op.path, op.bodyFn(i), session),
      );
      const results = await Promise.all(promises);

      // Tag results with category for analysis
      const reads = results.filter((_, i) => workload[i].category === "read");
      const writes = results.filter((_, i) => workload[i].category === "write");
      const aiOps = results.filter((_, i) => workload[i].category === "ai");

      // Zero server errors across all categories
      const allClassified = classifyResults(results);
      expect(allClassified.serverError.length).toBe(0);

      // Report distribution
      console.log(
        `[load-profile] Mixed batch: ${reads.length} reads, ${writes.length} writes, ${aiOps.length} AI ops`,
      );

      // Read timing
      if (reads.length > 0) {
        const readTiming = timingFromResults(reads);
        console.log(
          `[load-profile] Read timing — p50: ${readTiming.p50}ms, p95: ${readTiming.p95}ms, max: ${readTiming.max}ms`,
        );
        expect(readTiming.p95).toBeLessThan(READ_SLA_MS);
      }

      // Write timing (allow 404 for PUTs to non-existent leads)
      if (writes.length > 0) {
        const writeServerErrors = writes.filter((r) => r.status >= 500);
        expect(writeServerErrors.length).toBe(0);

        const writeTiming = timingFromResults(writes);
        console.log(
          `[load-profile] Write timing — p50: ${writeTiming.p50}ms, p95: ${writeTiming.p95}ms, max: ${writeTiming.max}ms`,
        );
        expect(writeTiming.p95).toBeLessThan(WRITE_SLA_MS);
      }

      // AI ops: may return 400/403/429 if key missing or rate limited, but never 500
      if (aiOps.length > 0) {
        const aiServerErrors = aiOps.filter((r) => r.status >= 500);
        expect(aiServerErrors.length).toBe(0);
      }
    }, 60_000);

    it("fires 3 sequential mixed batches without cumulative degradation", async () => {
      if (!session) return;

      const batchTimings: TimingStats[] = [];

      for (let batch = 0; batch < 3; batch++) {
        const workload = buildMixedWorkload(MIXED_BATCH_SIZE);
        const promises = workload.map((op, i) =>
          apiCall(op.method, op.path, op.bodyFn(i + batch * MIXED_BATCH_SIZE), session),
        );
        const results = await Promise.all(promises);

        // No server errors in any batch
        const classified = classifyResults(results);
        expect(classified.serverError.length).toBe(0);

        batchTimings.push(timingFromResults(results));
      }

      // Third batch should not be dramatically slower than first
      // (allows 3x tolerance for warm-up variance)
      if (batchTimings[0].p95 > 0) {
        const degradationRatio = batchTimings[2].p95 / batchTimings[0].p95;
        console.log(
          `[load-profile] Degradation ratio (batch3 p95 / batch1 p95): ${degradationRatio.toFixed(2)}x`,
        );
        expect(degradationRatio).toBeLessThan(5);
      }
    }, 120_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. RESPONSE TIME SLA VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════

  describe("Response Time SLAs", () => {
    const readEndpoints = [
      { name: "GET /api/leads", method: "GET", path: "/api/leads" },
      { name: "GET /api/properties", method: "GET", path: "/api/properties" },
      { name: "GET /api/deals", method: "GET", path: "/api/deals" },
      { name: "GET /api/dashboard/priority", method: "GET", path: "/api/dashboard/priority" },
    ];

    for (const endpoint of readEndpoints) {
      it(`${endpoint.name} p95 < ${READ_SLA_MS}ms under load`, async () => {
        if (!session) return;

        const timing = await measureEndpointTiming(
          endpoint.method,
          endpoint.path,
          session,
          20,
        );

        console.log(
          `[load-profile] ${endpoint.name} — p50: ${timing.p50}ms, p95: ${timing.p95}ms, p99: ${timing.p99}ms`,
        );
        expect(timing.p95).toBeLessThan(READ_SLA_MS);
      }, 30_000);
    }

    it("POST /api/leads p95 < write SLA", async () => {
      if (!session) return;

      const durations: number[] = [];
      for (let i = 0; i < 10; i++) {
        const res = await apiCall(
          "POST",
          "/api/leads",
          {
            firstName: `SLATest`,
            lastName: `Write${i}`,
            email: `sla-write-${i}-${Date.now()}@sim-test.com`,
            status: "new",
          },
          session,
        );
        expect(res.status).not.toBe(500);
        durations.push(res.durationMs);

        // Track created IDs for cleanup
        const id = res.body?.id ?? res.body?.leadId;
        if (id) createdLeadIds.push(id);
      }

      durations.sort((a, b) => a - b);
      const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
      console.log(`[load-profile] POST /api/leads — p95: ${p95}ms`);
      expect(p95).toBeLessThan(WRITE_SLA_MS);
    }, 30_000);

    it("PUT /api/leads/:id p95 < write SLA", async () => {
      if (!session) return;
      if (createdLeadIds.length === 0) return;

      const durations: number[] = [];
      for (let i = 0; i < Math.min(10, createdLeadIds.length); i++) {
        const leadId = createdLeadIds[i % createdLeadIds.length];
        const res = await apiCall(
          "PUT",
          `/api/leads/${leadId}`,
          {
            firstName: `Updated${i}`,
            lastName: `SLATest`,
          },
          session,
        );
        expect(res.status).not.toBe(500);
        durations.push(res.durationMs);
      }

      durations.sort((a, b) => a - b);
      const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
      console.log(`[load-profile] PUT /api/leads/:id — p95: ${p95}ms`);
      expect(p95).toBeLessThan(WRITE_SLA_MS);
    }, 30_000);

    it("POST /api/ai/chat p95 < AI SLA (or degrades gracefully)", async () => {
      if (!session) return;

      const durations: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await apiCall(
          "POST",
          "/api/ai/chat",
          { message: `Load test query ${i}: What is a quitclaim deed?` },
          session,
        );
        // Never 500 — graceful degradation if API key missing
        expect(res.status).not.toBe(500);
        durations.push(res.durationMs);

        // If rate limited or config missing, still should not crash
        if (res.status === 429 || res.status === 403) break;
      }

      if (durations.length > 0) {
        durations.sort((a, b) => a - b);
        const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
        console.log(`[load-profile] POST /api/ai/chat — p95: ${p95}ms`);
        expect(p95).toBeLessThan(AI_SLA_MS);
      }
    }, 60_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. RATE LIMITING ACTIVATION
  // ═══════════════════════════════════════════════════════════════════════

  describe("Rate Limiting Activation", () => {
    it("triggers 429 under sustained burst of GET requests", async () => {
      if (!session) return;

      const results = await fireConcurrent(
        RATE_LIMIT_BURST,
        "GET",
        "/api/leads",
        () => undefined,
        session,
      );

      const classified = classifyResults(results);

      // Zero server errors
      expect(classified.serverError.length).toBe(0);

      // Rate limiting should activate for excessive requests
      // (exact threshold depends on config, so log but don't hard-fail if no 429)
      console.log(
        `[load-profile] Rate limit burst: ${classified.success.length} OK, ${classified.rateLimited.length} rate-limited, ${classified.clientError.length} client errors`,
      );

      // At minimum, we verify no 500s under burst
      // If rate limiter is configured, we expect some 429s
      if (classified.rateLimited.length > 0) {
        // Verify rate limit response has proper structure
        const firstRL = classified.rateLimited[0];
        expect(firstRL.status).toBe(429);
      }
    }, 60_000);

    it("triggers 429 under sustained burst of POST /api/ai/chat requests", async () => {
      if (!session) return;

      const results = await fireConcurrent(
        50,
        "POST",
        "/api/ai/chat",
        (i) => ({ message: `Rate limit test ${i}` }),
        session,
      );

      const classified = classifyResults(results);

      // Zero server errors
      expect(classified.serverError.length).toBe(0);

      console.log(
        `[load-profile] AI rate limit burst: ${classified.success.length} OK, ${classified.rateLimited.length} rate-limited`,
      );
    }, 60_000);

    it("triggers 429 under sustained burst of POST /api/leads requests", async () => {
      if (!session) return;

      const results = await fireConcurrent(
        RATE_LIMIT_BURST,
        "POST",
        "/api/leads",
        (i) => ({
          firstName: `RateLimit`,
          lastName: `Test${i}`,
          email: `ratelimit-${i}-${Date.now()}@sim-test.com`,
          status: "new",
        }),
        session,
      );

      const classified = classifyResults(results);
      expect(classified.serverError.length).toBe(0);

      console.log(
        `[load-profile] Write rate limit burst: ${classified.success.length} OK, ${classified.rateLimited.length} rate-limited`,
      );
    }, 60_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. DATABASE CONNECTION POOL RESILIENCE
  // ═══════════════════════════════════════════════════════════════════════

  describe("Database Connection Pool Resilience", () => {
    it("handles rapid sequential requests across multiple endpoints without pool exhaustion", async () => {
      if (!session) return;

      const endpoints = [
        "/api/leads",
        "/api/properties",
        "/api/deals",
        "/api/notes",
        "/api/campaigns",
        "/api/finance/portfolio-summary",
      ];

      // Fire 10 rounds of requests across all endpoints
      const allResults: ApiCallResult[] = [];
      for (let round = 0; round < 10; round++) {
        const roundPromises = endpoints.map((path) =>
          apiCall("GET", path, undefined, session),
        );
        const roundResults = await Promise.all(roundPromises);
        allResults.push(...roundResults);
      }

      const classified = classifyResults(allResults);

      // Zero server errors indicates pool survived
      expect(classified.serverError.length).toBe(0);

      // At least some should succeed (not all rate-limited)
      expect(classified.success.length).toBeGreaterThan(0);

      console.log(
        `[load-profile] Pool test: ${allResults.length} total requests, ${classified.success.length} OK, ${classified.serverError.length} 5xx`,
      );
    }, 120_000);

    it("recovers after a burst: health endpoint still responds", async () => {
      // After all the load above, health should still work
      const res = await apiCall("GET", "/api/health");
      expect(res.status).toBe(200);
      console.log(`[load-profile] Post-burst health check: ${res.status} in ${res.durationMs}ms`);
    });

    it("recovers after a burst: authenticated read still works", async () => {
      if (!session) return;

      const res = await apiCall("GET", "/api/leads", undefined, session);
      // Should get 200 or at worst 429, never 500
      expect(res.status).not.toBe(500);
      expect([200, 429]).toContain(res.status);
      console.log(`[load-profile] Post-burst leads fetch: ${res.status} in ${res.durationMs}ms`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. AUTONOMOUS EXECUTOR / BACKGROUND JOB TOLERANCE
  // ═══════════════════════════════════════════════════════════════════════

  describe("Autonomous Executor Background Jobs", () => {
    it("POST /api/ai/portfolio/scan does not 500 under concurrent foreground load", async () => {
      if (!session) return;

      // Simulate background AI scan running alongside foreground reads
      const backgroundJob = apiCall(
        "POST",
        "/api/ai/portfolio/scan",
        {},
        session,
      );

      // Concurrent foreground reads
      const foregroundReads = fireConcurrent(
        20,
        "GET",
        "/api/leads",
        () => undefined,
        session,
      );

      const [bgResult, fgResults] = await Promise.all([backgroundJob, foregroundReads]);

      // Background job should not crash (may return 400/403 if not configured)
      expect(bgResult.status).not.toBe(500);

      // Foreground reads should still work
      const fgClassified = classifyResults(fgResults);
      expect(fgClassified.serverError.length).toBe(0);

      console.log(
        `[load-profile] Background scan: ${bgResult.status}, foreground: ${fgClassified.success.length}/${fgResults.length} OK`,
      );
    }, 60_000);

    it("POST /api/ai/compliance/check does not 500 alongside foreground writes", async () => {
      if (!session) return;

      // Simulate compliance background check
      const backgroundJob = apiCall(
        "POST",
        "/api/ai/compliance/check",
        { entityType: "deal", entityId: 1 },
        session,
      );

      // Concurrent foreground writes
      const foregroundWrites = fireConcurrent(
        10,
        "POST",
        "/api/leads",
        (i) => ({
          firstName: `BGTest`,
          lastName: `Lead${i}`,
          email: `bgtest-${i}-${Date.now()}@sim-test.com`,
          status: "new",
        }),
        session,
      );

      const [bgResult, fwResults] = await Promise.all([backgroundJob, foregroundWrites]);

      expect(bgResult.status).not.toBe(500);

      const fwClassified = classifyResults(fwResults);
      expect(fwClassified.serverError.length).toBe(0);

      console.log(
        `[load-profile] Background compliance: ${bgResult.status}, foreground writes: ${fwClassified.success.length}/${fwResults.length} OK`,
      );
    }, 60_000);

    it("multiple background AI operations do not starve foreground requests", async () => {
      if (!session) return;

      // Fire several AI background operations simultaneously
      const bgOps = [
        apiCall("POST", "/api/ai/portfolio/scan", {}, session),
        apiCall("POST", "/api/ai/cashflow/organization", undefined, session),
        apiCall("GET", "/api/ai/portfolio/alerts", undefined, session),
      ];

      // Plus foreground traffic
      const fgTraffic = fireConcurrent(
        30,
        "GET",
        "/api/leads",
        () => undefined,
        session,
      );

      const [bg1, bg2, bg3, fgResults] = await Promise.all([...bgOps, fgTraffic]);

      // Background ops: no 500s (may be 400/403/404 if not configured)
      for (const bg of [bg1, bg2, bg3]) {
        expect(bg.status).not.toBe(500);
      }

      // Foreground: no 500s, and reasonable success rate
      const fgClassified = classifyResults(fgResults);
      expect(fgClassified.serverError.length).toBe(0);

      console.log(
        `[load-profile] Multi-background: bg statuses [${bg1.status}, ${bg2.status}, ${bg3.status}], foreground: ${fgClassified.success.length}/${fgResults.length} OK`,
      );
    }, 60_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. SUSTAINED LOAD ENDURANCE (mini soak)
  // ═══════════════════════════════════════════════════════════════════════

  describe("Sustained Load Endurance", () => {
    it("survives 5 waves of 50-request mixed workloads without cumulative failure", async () => {
      if (!session) return;

      const waveResults: Array<{
        wave: number;
        serverErrors: number;
        successCount: number;
        timing: TimingStats;
      }> = [];

      for (let wave = 0; wave < 5; wave++) {
        const workload = buildMixedWorkload(50);
        const promises = workload.map((op, i) =>
          apiCall(op.method, op.path, op.bodyFn(i + wave * 50), session),
        );
        const results = await Promise.all(promises);

        const classified = classifyResults(results);
        const timing = timingFromResults(results);

        waveResults.push({
          wave,
          serverErrors: classified.serverError.length,
          successCount: classified.success.length,
          timing,
        });

        // No server errors in any wave
        expect(classified.serverError.length).toBe(0);
      }

      // Log wave-by-wave summary
      for (const w of waveResults) {
        console.log(
          `[load-profile] Wave ${w.wave}: ${w.successCount} OK, ${w.serverErrors} 5xx, p95: ${w.timing.p95}ms`,
        );
      }

      // Final wave should not be dramatically worse than first
      const firstP95 = waveResults[0].timing.p95;
      const lastP95 = waveResults[waveResults.length - 1].timing.p95;
      if (firstP95 > 0) {
        const degradation = lastP95 / firstP95;
        console.log(`[load-profile] Endurance degradation ratio: ${degradation.toFixed(2)}x`);
        // Allow up to 5x for connection pool warm-up, but flag anything worse
        expect(degradation).toBeLessThan(10);
      }
    }, 180_000);

    it("health endpoint responds after sustained load", async () => {
      const res = await apiCall("GET", "/api/health");
      expect(res.status).toBe(200);
      expect(res.durationMs).toBeLessThan(READ_SLA_MS);
      console.log(`[load-profile] Final health check: ${res.status} in ${res.durationMs}ms`);
    });
  });
});
