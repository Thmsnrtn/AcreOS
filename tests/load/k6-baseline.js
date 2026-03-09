/**
 * T48 — AcreOS Load Testing Suite (k6)
 *
 * Run with:
 *   k6 run tests/load/k6-baseline.js --env BASE_URL=https://your-app.fly.dev --env AUTH_COOKIE=...
 *
 * Tests these endpoints against SLOs:
 *   p95 response time < 500ms for reads
 *   p95 response time < 2000ms for AI endpoints
 *   Error rate < 1%
 *
 * Install k6: https://k6.io/docs/getting-started/installation/
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";
const HEADERS = {
  "Content-Type": "application/json",
  Cookie: AUTH_COOKIE,
};

// ─── Custom metrics ───────────────────────────────────────────────────────────

const errorRate = new Rate("error_rate");
const leadListTrend = new Trend("lead_list_p95");
const dashboardTrend = new Trend("dashboard_stats_p95");
const searchTrend = new Trend("search_p95");
const aiChatTrend = new Trend("ai_chat_p95");

// ─── Test scenarios ───────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Smoke test: 5 VUs for 30s — basic sanity check
    smoke: {
      executor: "constant-vus",
      vus: 5,
      duration: "30s",
      tags: { scenario: "smoke" },
    },
    // Load test: ramp to 50 VUs over 2 min, hold 3 min, ramp down
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 },
        { duration: "3m", target: 50 },
        { duration: "1m", target: 0 },
      ],
      tags: { scenario: "load" },
    },
    // Spike test: sudden 100 VU spike for 30s
    spike: {
      executor: "constant-vus",
      vus: 100,
      duration: "30s",
      startTime: "7m", // after load test
      tags: { scenario: "spike" },
    },
  },

  thresholds: {
    http_req_duration: [
      "p(95)<500", // 95th percentile < 500ms for all requests
    ],
    "http_req_duration{endpoint:ai}": [
      "p(95)<2000", // AI endpoints get 2s budget
    ],
    error_rate: ["rate<0.01"], // < 1% error rate
    http_req_failed: ["rate<0.01"],
  },
};

// ─── Test scenarios ───────────────────────────────────────────────────────────

export default function () {
  group("Dashboard", () => {
    const res = http.get(`${BASE_URL}/api/dashboard/stats`, { headers: HEADERS });
    check(res, { "dashboard 200": r => r.status === 200 });
    errorRate.add(res.status !== 200);
    dashboardTrend.add(res.timings.duration);
    sleep(0.5);
  });

  group("Lead List", () => {
    const res = http.get(`${BASE_URL}/api/leads?limit=50`, { headers: HEADERS });
    check(res, {
      "leads 200": r => r.status === 200,
      "leads returns array": r => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body) || Array.isArray(body?.leads);
        } catch {
          return false;
        }
      },
    });
    errorRate.add(res.status !== 200);
    leadListTrend.add(res.timings.duration);
    sleep(0.3);
  });

  group("Property List", () => {
    const res = http.get(`${BASE_URL}/api/properties?limit=50`, { headers: HEADERS });
    check(res, { "properties 200": r => r.status === 200 });
    errorRate.add(res.status !== 200);
    sleep(0.3);
  });

  group("Full-Text Search", () => {
    const queries = ["smith", "texas", "APN 123", "agricultural"];
    const q = queries[Math.floor(Math.random() * queries.length)];
    const res = http.get(`${BASE_URL}/api/search?q=${encodeURIComponent(q)}&limit=20`, {
      headers: HEADERS,
    });
    check(res, { "search 200": r => r.status === 200 });
    errorRate.add(res.status !== 200);
    searchTrend.add(res.timings.duration);
    sleep(0.5);
  });

  group("Deal List", () => {
    const res = http.get(`${BASE_URL}/api/deals?limit=20`, { headers: HEADERS });
    check(res, { "deals 200": r => r.status === 200 });
    errorRate.add(res.status !== 200);
    sleep(0.3);
  });

  group("Health Check", () => {
    const res = http.get(`${BASE_URL}/api/health/cached`);
    check(res, { "health 200": r => r.status === 200 });
    sleep(1);
  });

  // AI endpoint (rate-limited — only some VUs hit it)
  if (Math.random() < 0.1) {
    group("AI Chat", () => {
      const payload = JSON.stringify({
        message: "What are the key metrics I should review today?",
        context: "quick",
      });
      const res = http.post(`${BASE_URL}/api/ai/chat`, payload, {
        headers: { ...HEADERS, endpoint: "ai" },
        tags: { endpoint: "ai" },
        timeout: "30s",
      });
      check(res, { "ai chat 200": r => r.status === 200 || r.status === 429 });
      if (res.status === 200) {
        aiChatTrend.add(res.timings.duration);
      }
    });
  }
}

export function handleSummary(data) {
  return {
    "tests/load/results/baseline-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

// k6 built-in text summary helper
function textSummary(data, opts) {
  const { indent = "", enableColors = false } = opts || {};
  const lines = ["AcreOS Load Test Summary", "========================"];
  lines.push(`Total requests: ${data.metrics.http_reqs?.values?.count ?? 0}`);
  lines.push(`Error rate: ${((data.metrics.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)}%`);
  lines.push(`p95 response: ${(data.metrics.http_req_duration?.values?.["p(95)"] ?? 0).toFixed(0)}ms`);
  return lines.join("\n");
}
