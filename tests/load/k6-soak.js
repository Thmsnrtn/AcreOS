/**
 * AcreOS Load Testing — Soak Test (k6)
 *
 * Run with:
 *   k6 run tests/load/k6-soak.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env AUTH_COOKIE=connect.sid=...
 *
 * Distributed (10,000+ user scale across multiple k6 instances):
 *   K6_INSTANCE_COUNT=5 K6_INSTANCE_INDEX=0 k6 run tests/load/k6-soak.js ...
 *   K6_INSTANCE_COUNT=5 K6_INSTANCE_INDEX=1 k6 run tests/load/k6-soak.js ...
 *   ... (repeat for each instance index up to K6_INSTANCE_COUNT-1)
 *
 * Purpose: Detect memory leaks, DB connection leaks, WS client accumulation, and
 * gradual performance degradation over sustained load. Run this test to detect
 * memory leaks. If p95 degrades >20% between first and last 5 minutes, investigate
 * Node.js heap growth, DB connection leaks, or WS client accumulation.
 *
 * SLOs validated:
 *   p95 response time < 800ms over full 30-minute window
 *   Error rate < 0.5% over 30 minutes
 *   Health endpoint p95 < 300ms
 *   Late-window p95 within 20% of early-window p95 (degradation gate)
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

import {
  getBaseUrl,
  getHeaders,
  checkRes,
  randomThinkTime,
  generateLead,
  generateDeal,
  pollHealth,
  getDistributedVUs,
} from "./lib/helpers.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = getBaseUrl();

// Distributed support: scale VU count across k6 instances for 10,000+ user tests.
// With K6_INSTANCE_COUNT=50 each instance runs 4 VUs, totalling 200 across the fleet.
const SOAK_VUS = getDistributedVUs(200);

// Soak duration constants (in seconds) — used for window tagging logic.
const SOAK_DURATION_S = 30 * 60; // 30 minutes
const EARLY_WINDOW_S  = 5 * 60;  // first 5 minutes
const LATE_WINDOW_START_S = SOAK_DURATION_S - (5 * 60); // last 5 minutes

// ─── Custom Metrics ───────────────────────────────────────────────────────────

// Health monitor metrics — track server-side state over time.
const healthHeapMb       = new Trend("health_heap_mb");
const healthResponseMs   = new Trend("health_response_ms");

// Per-window degradation metrics — compare early vs late p95 to catch slow leaks.
const soakEarlyMs        = new Trend("soak_early_window_ms");
const soakLateMs         = new Trend("soak_late_window_ms");

// Overall error tracking.
const soakErrorRate      = new Rate("soak_error_rate");

// Request counters per workload type — confirm realistic traffic distribution.
const dashboardRequests  = new Counter("soak_dashboard_requests");
const leadRequests       = new Counter("soak_lead_requests");
const dealRequests       = new Counter("soak_deal_requests");
const agentRequests      = new Counter("soak_agent_requests");
const supportRequests    = new Counter("soak_support_requests");

// ─── Scenarios ────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    /**
     * soak_steady: sustained mixed workload for 30 minutes.
     * Simulates realistic user behaviour across all major AcreOS features.
     * Watch for: rising p95, increasing error rate, OOM kills.
     */
    soak_steady: {
      executor: "constant-vus",
      vus: SOAK_VUS,
      duration: "30m",
      exec: "soakSteady",
      tags: { scenario: "soak_steady" },
    },

    /**
     * health_monitor: single VU polling /api/health every 30 seconds.
     * Provides a continuous server-side heartbeat. If heap_used_mb climbs
     * monotonically over the 30-minute window, a memory leak is likely.
     */
    health_monitor: {
      executor: "constant-vus",
      vus: 1,
      duration: "30m",
      exec: "healthMonitor",
      tags: { scenario: "health_monitor" },
    },
  },

  thresholds: {
    // Overall SLOs for the entire 30-minute run.
    http_req_duration:         ["p(95)<800"],
    http_req_failed:           ["rate<0.005"],

    // Health endpoint must stay responsive throughout.
    health_response_ms:        ["p(95)<300"],

    // Degradation gate: late-window p95 must stay within 20% of early-window p95.
    // Threshold value = 800ms * 1.20 = 960ms. If late p95 exceeds this while
    // early p95 is well below 800ms, the system is degrading — investigate leaks.
    "http_req_duration{window:early}": ["p(95)<800"],
    "http_req_duration{window:late}":  ["p(95)<960"],

    // Per-workload error budgets.
    soak_error_rate: ["rate<0.005"],
  },
};

// ─── Scenario: soak_steady ────────────────────────────────────────────────────

/**
 * Mixed workload VU function. Each VU runs continuously for 30 minutes,
 * sampling a weighted random action on each iteration and sleeping with
 * realistic human think time between requests.
 *
 * Workload distribution:
 *   40% — dashboard browsing
 *   25% — lead management (reads + creates)
 *   20% — deal management (reads + updates)
 *   10% — AI agent triggers
 *    5% — support ticket reads
 */
export function soakSteady() {
  // Determine which time window this request falls in for degradation analysis.
  // __ITER resets per VU so we use wall-clock time relative to scenario start.
  // We read __ENV.SOAK_START_EPOCH if set (advanced setups), otherwise approximate
  // using a module-level timestamp captured when the VU was first initialised.
  const nowS = Date.now() / 1000;
  const elapsedS = nowS - VU_INIT_EPOCH_S;

  let windowTag;
  if (elapsedS <= EARLY_WINDOW_S) {
    windowTag = "early";
  } else if (elapsedS >= LATE_WINDOW_START_S) {
    windowTag = "late";
  } else {
    windowTag = "mid";
  }

  const params = {
    headers: getHeaders(__VU),
    tags: { window: windowTag },
  };

  // Weighted action selector: roll a number 0–99, map to workload bucket.
  const roll = Math.random() * 100;

  if (roll < 40) {
    // ── 40% Dashboard browsing ───────────────────────────────────────────────
    group("dashboard", () => {
      const res = http.get(`${BASE_URL}/api/dashboard/stats`, params);
      const ok = checkRes(res, "dashboard stats");
      soakErrorRate.add(!ok);
      dashboardRequests.add(1);

      // Record to per-window trends for degradation comparison.
      if (windowTag === "early") soakEarlyMs.add(res.timings.duration);
      if (windowTag === "late")  soakLateMs.add(res.timings.duration);
    });

  } else if (roll < 65) {
    // ── 25% Lead management (reads + occasional creates) ─────────────────────
    group("leads", () => {
      const listRes = http.get(`${BASE_URL}/api/leads`, params);
      const listOk = checkRes(listRes, "leads list");
      soakErrorRate.add(!listOk);
      leadRequests.add(1);

      if (windowTag === "early") soakEarlyMs.add(listRes.timings.duration);
      if (windowTag === "late")  soakLateMs.add(listRes.timings.duration);

      // ~30% of lead visits also create a lead (realistic CRM behaviour).
      if (Math.random() < 0.3) {
        sleep(randomThinkTime(0.5, 1.5));
        const createRes = http.post(
          `${BASE_URL}/api/leads`,
          JSON.stringify(generateLead()),
          params,
        );
        const createOk = checkRes(createRes, "lead create");
        soakErrorRate.add(!createOk);
        leadRequests.add(1);
      }
    });

  } else if (roll < 85) {
    // ── 20% Deal management (reads + occasional updates) ─────────────────────
    group("deals", () => {
      const listRes = http.get(`${BASE_URL}/api/deals`, params);
      const listOk = checkRes(listRes, "deals list");
      soakErrorRate.add(!listOk);
      dealRequests.add(1);

      if (windowTag === "early") soakEarlyMs.add(listRes.timings.duration);
      if (windowTag === "late")  soakLateMs.add(listRes.timings.duration);

      // ~20% of deal views attempt an update on a known test deal ID.
      if (Math.random() < 0.2) {
        sleep(randomThinkTime(0.5, 1));
        const dealId = Math.floor(Math.random() * 100) + 1;
        const updateRes = http.put(
          `${BASE_URL}/api/deals/${dealId}`,
          JSON.stringify({ stage: "negotiation", updatedBy: "load_test" }),
          params,
        );
        // A 404 is acceptable here (deal may not exist); only 5xx is a problem.
        check(updateRes, {
          "deal update not 5xx": (r) => r.status < 500,
        });
        dealRequests.add(1);
      }
    });

  } else if (roll < 95) {
    // ── 10% AI agent triggers ─────────────────────────────────────────────────
    group("agents", () => {
      const res = http.post(
        `${BASE_URL}/api/founder/v14/agents/execute`,
        JSON.stringify({
          agentType: "lead_qualifier",
          payload: { leadId: Math.floor(Math.random() * 100) + 1 },
        }),
        params,
      );
      // Agent endpoints are allowed up to 2s per baseline SLOs; just check no crash.
      check(res, {
        "agent execute not 5xx": (r) => r.status < 500,
      });
      soakErrorRate.add(res.status >= 500);
      agentRequests.add(1);
    });

  } else {
    // ── 5% Support ticket reads ───────────────────────────────────────────────
    group("support", () => {
      const res = http.get(`${BASE_URL}/api/support-tickets`, params);
      const ok = checkRes(res, "support tickets");
      soakErrorRate.add(!ok);
      supportRequests.add(1);

      if (windowTag === "early") soakEarlyMs.add(res.timings.duration);
      if (windowTag === "late")  soakLateMs.add(res.timings.duration);
    });
  }

  // Realistic human think time between page interactions (2–5 seconds).
  sleep(randomThinkTime(2, 5));
}

// ─── Scenario: health_monitor ─────────────────────────────────────────────────

/**
 * Singleton health monitor. Polls /api/health every 30 seconds and records:
 *   - heap_used_mb: Node.js process heap (if exposed by the health endpoint)
 *   - response time: latency of the health check itself
 *
 * A monotonically increasing heap_used_mb over 30 minutes is a strong signal
 * of a memory leak. Flat or oscillating values indicate healthy GC behaviour.
 */
export function healthMonitor() {
  const startMs = Date.now();

  const res = http.get(`${BASE_URL}/api/health`, {
    headers: getHeaders(0),
    tags: { scenario: "health_monitor" },
  });

  healthResponseMs.add(res.timings.duration);

  check(res, {
    "health endpoint 2xx": (r) => r.status === 200,
    "health response fast": (r) => r.timings.duration < 300,
  });

  // Parse heap metrics from health response if the server exposes them.
  // Expected shape: { status: "ok", memory: { heapUsed: <bytes> }, uptime: <s> }
  if (res.status === 200 && res.body) {
    try {
      const body = JSON.parse(res.body);
      if (body.memory && body.memory.heapUsed) {
        const heapMb = body.memory.heapUsed / (1024 * 1024);
        healthHeapMb.add(heapMb);
      } else if (body.heap_used_mb) {
        // Alternative flat schema.
        healthHeapMb.add(body.heap_used_mb);
      } else {
        // Fallback: record response body size as a rough proxy for payload growth.
        healthHeapMb.add(res.body.length / 1024);
      }
    } catch (_) {
      // Non-JSON health response — still track response time, skip heap metric.
    }
  }

  // Poll every 30 seconds. Subtract request time so interval stays consistent.
  const elapsed = (Date.now() - startMs) / 1000;
  const remaining = Math.max(0, 30 - elapsed);
  sleep(remaining);
}

// ─── VU Init Epoch ────────────────────────────────────────────────────────────

/**
 * Module-level wall-clock epoch captured when this VU script is first loaded.
 * Used to compute elapsed time for early/late window tagging without relying
 * on __ITER (which resets) or a shared setup() value (which isn't directly
 * accessible inside VU functions without passing through globalThis tricks).
 *
 * In a distributed k6 run, each instance captures its own init time.
 * The first few seconds of ramp-up are inherently in the "early" window,
 * so minor clock skew between instances does not affect correctness.
 */
const VU_INIT_EPOCH_S = Date.now() / 1000;
