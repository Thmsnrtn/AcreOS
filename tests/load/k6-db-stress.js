/**
 * AcreOS Load Testing — Database Stress Test
 *
 * Exercises connection pool exhaustion and query performance at 10,000+ user scale.
 * Three scenarios run in sequence, targeting different DB failure modes:
 *   1. pool_saturation   — ramps to 1000 concurrent VUs hammering read endpoints
 *   2. write_contention  — constant 200 req/sec of mixed writes for 3 minutes
 *   3. thundering_herd   — 2000 VUs fire simultaneously at dashboard (cache stampede)
 *
 * Run (single instance):
 *   k6 run tests/load/k6-db-stress.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env AUTH_COOKIE=connect.sid=...
 *
 * Run (distributed, 4 instances):
 *   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=0 k6 run tests/load/k6-db-stress.js ...
 *   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=1 k6 run tests/load/k6-db-stress.js ...
 *   (repeat for index 2, 3)
 *
 * Optional env vars:
 *   TEST_LEAD_ID   — a known lead ID to use for PUT /status operations
 *
 * Thresholds:
 *   read_*  p95 < 500ms
 *   write_* p95 < 1000ms
 *   herd_error_rate < 5%
 *   http_req_failed < 2%
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";
import {
  getBaseUrl,
  getDefaultHeaders,
  checkRes,
  randomThinkTime,
  generateLead,
  generateDeal,
  getDistributedVUs,
} from "./lib/helpers.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = getBaseUrl();

// A known lead ID for status-update writes. Falls back to a synthetic value
// that will produce a 404 (counted as a write attempt, not a crash).
const TEST_LEAD_ID = __ENV.TEST_LEAD_ID || "load-test-placeholder";

// ─── Custom Metrics ──────────────────────────────────────────────────────────

const readDashboardMs  = new Trend("read_dashboard_ms",  true);
const readLeadsMs      = new Trend("read_leads_ms",      true);
const readPropertiesMs = new Trend("read_properties_ms", true);
const readDealsMs      = new Trend("read_deals_ms",      true);

const writeLeadMs = new Trend("write_lead_ms", true);
const writeDealMs = new Trend("write_deal_ms", true);

const herdDurationMs = new Trend("herd_duration_ms", true);
const herdErrorRate  = new Rate("herd_error_rate");

// ─── Scenario Options ─────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // ── 1. Pool Saturation ──────────────────────────────────────────────────
    // Ramp to 1000 VUs reading from four endpoints simultaneously.
    // Goals: surface connection pool exhaustion, identify slowest query paths.
    pool_saturation: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m",  target: 500  }, // ramp: 0 → 500
        { duration: "2m",  target: 1000 }, // ramp: 500 → 1000
        { duration: "2m",  target: 1000 }, // hold at 1000
        { duration: "1m",  target: 0    }, // ramp down
      ],
      exec: "poolSaturationScenario",
      tags: { scenario: "pool_saturation" },
    },

    // ── 2. Write Contention ─────────────────────────────────────────────────
    // Constant-arrival-rate: 200 requests/sec of mixed writes.
    // Goals: expose lock contention, serialization bottlenecks, queue depth.
    write_contention: {
      executor: "constant-arrival-rate",
      rate: 200,
      timeUnit: "1s",
      duration: "3m",
      startTime: "6m", // starts after pool_saturation peak
      preAllocatedVUs: 100,
      maxVUs: 500,
      exec: "writeContentionScenario",
      tags: { scenario: "write_contention" },
    },

    // ── 3. Thundering Herd ──────────────────────────────────────────────────
    // 2000 VUs each fire exactly one request simultaneously.
    // Goals: expose cache stampede, connection spike, missing cache warm-up.
    thundering_herd: {
      executor: "shared-iterations",
      vus: 2000,
      iterations: 2000,
      maxDuration: "2m",
      startTime: "10m", // well after write_contention finishes
      exec: "thunderingHerdScenario",
      tags: { scenario: "thundering_herd" },
    },
  },

  thresholds: {
    // Read endpoint p95s — DB should serve cached/indexed reads fast
    read_dashboard_ms:  ["p(95)<500"],
    read_leads_ms:      ["p(95)<500"],
    read_properties_ms: ["p(95)<500"],
    read_deals_ms:      ["p(95)<500"],

    // Write p95s — allow for transaction overhead
    write_lead_ms: ["p(95)<1000"],
    write_deal_ms: ["p(95)<1000"],

    // Thundering herd — tolerate up to 5% errors under simultaneous spike
    herd_error_rate: ["rate<0.05"],

    // Global failure gate — less than 2% of all requests may fail
    http_req_failed: ["rate<0.02"],
  },
};

// ─── Scenario: Pool Saturation ────────────────────────────────────────────────

/**
 * Each VU randomly picks one of four read endpoints on every iteration.
 * Think time is kept short (0.2–0.5s) to maximize concurrent DB connections.
 */
export function poolSaturationScenario() {
  const headers = getDefaultHeaders();
  const endpoint = Math.floor(Math.random() * 4);

  switch (endpoint) {
    case 0:
      group("read_dashboard", () => {
        const res = http.get(`${BASE_URL}/api/dashboard/stats`, { headers });
        checkRes(res, "dashboard stats", readDashboardMs);
      });
      break;

    case 1:
      group("read_leads", () => {
        const res = http.get(`${BASE_URL}/api/leads?page=1&limit=50`, { headers });
        checkRes(res, "leads list", readLeadsMs);
      });
      break;

    case 2:
      group("read_properties", () => {
        const res = http.get(`${BASE_URL}/api/properties?search=texas+land`, { headers });
        checkRes(res, "properties search", readPropertiesMs);
      });
      break;

    case 3:
      group("read_deals", () => {
        const res = http.get(`${BASE_URL}/api/deals`, { headers });
        checkRes(res, "deals list", readDealsMs);
      });
      break;
  }

  sleep(randomThinkTime(0.2, 0.5));
}

// ─── Scenario: Write Contention ───────────────────────────────────────────────

/**
 * Constant-arrival-rate write mix. Four operation types are chosen at random:
 *   0 — POST   /api/leads              (create lead)
 *   1 — PUT    /api/leads/:id/status   (update lead status)
 *   2 — POST   /api/deals              (create deal)
 *   3 — POST   /api/agent-events       (log agent event)
 *
 * No think time — the executor controls arrival rate externally.
 */
export function writeContentionScenario() {
  const headers = getDefaultHeaders();
  const op = Math.floor(Math.random() * 4);

  switch (op) {
    case 0:
      group("write_lead_create", () => {
        const payload = JSON.stringify(generateLead());
        const res = http.post(`${BASE_URL}/api/leads`, payload, { headers });
        checkRes(res, "POST lead", writeLeadMs);
      });
      break;

    case 1:
      group("write_lead_status", () => {
        const statuses = ["new", "contacted", "qualified", "unqualified", "follow_up"];
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const payload = JSON.stringify({ status });
        const res = http.put(
          `${BASE_URL}/api/leads/${TEST_LEAD_ID}/status`,
          payload,
          { headers }
        );
        // A 404 here means the placeholder ID wasn't found — not a server error.
        // We record it as a write attempt regardless of outcome so the trend
        // captures the round-trip cost, but only flag 5xx as errors.
        writeLeadMs.add(res.timings.duration);
        check(res, { "PUT lead status not 5xx": (r) => r.status < 500 });
      });
      break;

    case 2:
      group("write_deal_create", () => {
        const payload = JSON.stringify(generateDeal(null));
        const res = http.post(`${BASE_URL}/api/deals`, payload, { headers });
        checkRes(res, "POST deal", writeDealMs);
      });
      break;

    case 3:
      group("write_agent_event", () => {
        const payload = JSON.stringify({
          type: "call",
          leadId: null,
          notes: `load test event at ${new Date().toISOString()}`,
          duration: Math.floor(Math.random() * 300) + 30,
        });
        const res = http.post(`${BASE_URL}/api/agent-events`, payload, { headers });
        // Reuse writeDealMs — both represent DB insert latency
        checkRes(res, "POST agent event", writeDealMs);
      });
      break;
  }
}

// ─── Scenario: Thundering Herd ────────────────────────────────────────────────

/**
 * All 2000 VUs each execute exactly one GET /api/dashboard/stats.
 * Since shared-iterations starts them as fast as possible, this simulates
 * a sudden stampede — e.g., a deploy completing and users refreshing simultaneously.
 */
export function thunderingHerdScenario() {
  const headers = getDefaultHeaders();

  const res = http.get(`${BASE_URL}/api/dashboard/stats`, { headers });

  const ok = check(res, {
    "herd dashboard 2xx":  (r) => r.status >= 200 && r.status < 300,
    "herd dashboard body": (r) => r.body && r.body.length > 0,
  });

  herdDurationMs.add(res.timings.duration);
  herdErrorRate.add(!ok);
}

// ─── Default export ───────────────────────────────────────────────────────────
// k6 requires a default export even when all logic lives in named exec funcs.
// This is a no-op; scenarios drive execution via the `exec` field above.

export default function () {}
