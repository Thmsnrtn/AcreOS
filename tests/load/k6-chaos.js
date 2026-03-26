/**
 * AcreOS Chaos & Resilience — Load Test (k6)
 *
 * Tests system behavior under failure conditions at 10K+ user scale:
 *   - Rate limiter correctness (429s not 500s)
 *   - Thundering herd recovery time
 *   - Malformed request handling (4xx not 5xx)
 *   - Healthy traffic isolation from error traffic
 *
 * ─── Run ─────────────────────────────────────────────────────────────────────
 *
 *   k6 run tests/load/k6-chaos.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env AUTH_COOKIE=connect.sid=...
 *
 * ─── Distributed ─────────────────────────────────────────────────────────────
 *
 *   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=0 \
 *     k6 run tests/load/k6-chaos.js --env BASE_URL=... --env AUTH_COOKIE=...
 *
 * ─── SLOs ────────────────────────────────────────────────────────────────────
 *
 *   malformed_5xx_count    count < 1    (zero 5xx from bad input)
 *   recovery_phase_ms      p95 < 600ms  (system recovers after herd)
 *   healthy_traffic_ms     p95 < 600ms  (healthy traffic unaffected)
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import {
  getBaseUrl,
  getHeaders,
  checkRes,
  randomThinkTime,
  getDistributedVUs,
} from "./lib/helpers.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = getBaseUrl();
const HERD_VUS = getDistributedVUs(3000);
const MALFORMED_VUS = getDistributedVUs(200);
const HEALTHY_VUS = getDistributedVUs(500);
const ERROR_VUS = getDistributedVUs(100);

// ─── Metrics ─────────────────────────────────────────────────────────────────

// Rate limiter
const rateLimitCorrect = new Counter("rate_limit_429_count");
const rateLimitWrong5xx = new Counter("rate_limit_5xx_count");

// Thundering herd
const herdPhaseMs = new Trend("herd_phase_ms", true);
const recoveryPhaseMs = new Trend("recovery_phase_ms", true);

// Malformed requests
const malformed4xxCount = new Counter("malformed_4xx_count");
const malformed5xxCount = new Counter("malformed_5xx_count");

// Healthy traffic isolation
const healthyTrafficMs = new Trend("healthy_traffic_ms", true);

const errorRate = new Rate("error_rate");

// ─── Options ─────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Phase 1: Rate limit hammer — all VUs hit auth from same IP
    rate_limit_hammer: {
      executor: "shared-iterations",
      vus: 500,
      iterations: 500,
      maxDuration: "30s",
      exec: "rateLimitHammer",
      tags: { scenario: "rate_limit" },
    },

    // Phase 2: Thundering herd — 3000 VUs slam dashboard simultaneously, then drop
    thundering_herd: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: HERD_VUS },  // instant ramp
        { duration: "20s", target: HERD_VUS },  // hold the herd
        { duration: "5s", target: 10 },          // crash down
        { duration: "60s", target: 10 },         // measure recovery
      ],
      startTime: "1m",
      exec: "thunderingHerd",
      tags: { scenario: "thundering_herd" },
    },

    // Phase 3: Malformed requests — intentionally bad input
    malformed_requests: {
      executor: "constant-vus",
      vus: MALFORMED_VUS,
      duration: "2m",
      startTime: "3m",
      exec: "malformedRequests",
      tags: { scenario: "malformed" },
    },

    // Phase 4: Healthy traffic alongside error traffic
    healthy_traffic: {
      executor: "constant-vus",
      vus: HEALTHY_VUS,
      duration: "3m",
      startTime: "5m",
      exec: "healthyTraffic",
      tags: { scenario: "healthy" },
    },

    error_traffic: {
      executor: "constant-vus",
      vus: ERROR_VUS,
      duration: "3m",
      startTime: "5m",
      exec: "errorTraffic",
      tags: { scenario: "error_traffic" },
    },
  },

  thresholds: {
    // Zero 5xx from bad input — malformed requests MUST return 4xx
    malformed_5xx_count: ["count<1"],

    // System recovers after thundering herd
    recovery_phase_ms: ["p(95)<600"],

    // Healthy traffic unaffected by concurrent error traffic
    healthy_traffic_ms: ["p(95)<600"],

    // Rate limiter returns 429, not 5xx
    rate_limit_5xx_count: ["count<1"],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Scenario 1: Rate Limit Hammer ──────────────────────────────────────────
// All 500 VUs simultaneously POST to auth endpoint from same IP.
// Rate limiter should trigger at 20 req/15min and return 429.

export function rateLimitHammer() {
  const headers = { "Content-Type": "application/json" };

  group("rate_limit: auth hammer", () => {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: `loadtest_${randomInt(1, 100)}@test.local`,
        password: "wrong_password_12345",
      }),
      { headers, timeout: "10s", tags: { endpoint: "auth_login" } },
    );

    if (res.status === 429) {
      rateLimitCorrect.add(1);
    } else if (res.status >= 500) {
      rateLimitWrong5xx.add(1);
    }

    check(res, {
      "rate limit: not 5xx": (r) => r.status < 500,
      "rate limit: 401 or 429": (r) => r.status === 401 || r.status === 429,
    });
  });
}

// ─── Scenario 2: Thundering Herd + Recovery ─────────────────────────────────
// 3000 VUs slam dashboard simultaneously. After the herd drops to 10 VUs,
// measure how quickly response times return to normal.

export function thunderingHerd() {
  const headers = getHeaders(0);
  const isRecoveryPhase = __ITER > 0 && __VU <= 10;  // After initial slam

  group("herd: dashboard", () => {
    const res = http.get(`${BASE_URL}/api/dashboard/stats`, {
      headers,
      timeout: "30s",  // extended timeout for herd
      tags: { endpoint: "dashboard", phase: isRecoveryPhase ? "recovery" : "herd" },
    });

    if (isRecoveryPhase) {
      checkRes(res, "recovery dashboard", recoveryPhaseMs, errorRate);
    } else {
      checkRes(res, "herd dashboard", herdPhaseMs, errorRate);
    }

    check(res, {
      "herd: not crashed (no 503)": (r) => r.status !== 503,
    });
  });

  // During herd: minimal sleep. During recovery: normal pace.
  sleep(isRecoveryPhase ? randomThinkTime(1, 3) : 0.1);
}

// ─── Scenario 3: Malformed Requests ─────────────────────────────────────────
// Intentionally bad requests that MUST return 4xx, never 5xx.

export function malformedRequests() {
  const headers = getHeaders(0);
  const badHeaders = { "Content-Type": "application/json", Cookie: "" };  // No auth
  const test = pick(["empty_body", "invalid_json", "missing_resource", "no_auth", "wrong_method"]);

  group(`malformed: ${test}`, () => {
    let res;

    switch (test) {
      case "empty_body":
        res = http.post(`${BASE_URL}/api/leads`, "", {
          headers,
          timeout: "10s",
          tags: { endpoint: "malformed_empty" },
        });
        break;

      case "invalid_json":
        res = http.post(`${BASE_URL}/api/deals`, "{invalid json!!", {
          headers: { ...headers, "Content-Type": "application/json" },
          timeout: "10s",
          tags: { endpoint: "malformed_json" },
        });
        break;

      case "missing_resource":
        res = http.get(`${BASE_URL}/api/leads/${randomInt(99000000, 99999999)}`, {
          headers,
          timeout: "10s",
          tags: { endpoint: "malformed_missing" },
        });
        break;

      case "no_auth":
        res = http.get(`${BASE_URL}/api/dashboard/stats`, {
          headers: badHeaders,
          timeout: "10s",
          tags: { endpoint: "malformed_noauth" },
        });
        break;

      case "wrong_method":
        res = http.del(`${BASE_URL}/api/dashboard/stats`, null, {
          headers,
          timeout: "10s",
          tags: { endpoint: "malformed_method" },
        });
        break;
    }

    if (res) {
      if (res.status >= 400 && res.status < 500) {
        malformed4xxCount.add(1);
      } else if (res.status >= 500) {
        malformed5xxCount.add(1);
        console.warn(`5xx from malformed request (${test}): ${res.status} — ${res.body?.substring(0, 200)}`);
      }

      check(res, {
        [`${test}: returns 4xx not 5xx`]: (r) => r.status >= 400 && r.status < 500,
        [`${test}: never crashes server`]: (r) => r.status < 500,
      });
    }
  });

  sleep(randomThinkTime(0.2, 0.5));
}

// ─── Scenario 4: Healthy Traffic (runs alongside error traffic) ─────────────
// Normal user operations that should NOT be degraded by concurrent errors.

export function healthyTraffic() {
  const headers = getHeaders(0);

  const endpoint = pick([
    "/api/dashboard/stats",
    "/api/leads?page=1&limit=25",
    "/api/deals",
    "/api/properties?state=TX&limit=25",
  ]);

  group("healthy: normal request", () => {
    const res = http.get(`${BASE_URL}${endpoint}`, {
      headers,
      timeout: "10s",
      tags: { endpoint: "healthy", traffic_type: "healthy" },
    });
    checkRes(res, "healthy traffic", healthyTrafficMs, errorRate);
  });

  sleep(randomThinkTime(1, 3));
}

// ─── Scenario 5: Error Traffic (concurrent with healthy traffic) ────────────
// Intentional error requests that should not affect healthy traffic.

export function errorTraffic() {
  const headers = getHeaders(0);

  const errorType = pick(["not_found", "invalid_update", "bad_search"]);

  group(`error_traffic: ${errorType}`, () => {
    let res;

    switch (errorType) {
      case "not_found":
        res = http.get(`${BASE_URL}/api/deals/${randomInt(99000000, 99999999)}`, {
          headers, timeout: "10s", tags: { traffic_type: "error" },
        });
        break;

      case "invalid_update":
        res = http.put(
          `${BASE_URL}/api/deals/${randomInt(99000000, 99999999)}`,
          JSON.stringify({ stage: "invalid_stage_12345" }),
          { headers, timeout: "10s", tags: { traffic_type: "error" } },
        );
        break;

      case "bad_search":
        res = http.get(`${BASE_URL}/api/leads?page=-1&limit=999999`, {
          headers, timeout: "10s", tags: { traffic_type: "error" },
        });
        break;
    }
  });

  sleep(randomThinkTime(0.3, 1));
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  return {
    "tests/load/results/chaos-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const p95 = (key) => (m[key]?.values?.["p(95)"] ?? 0).toFixed(0);
  const count = (key) => (m[key]?.values?.count ?? 0);

  return [
    "AcreOS Chaos & Resilience — Summary",
    "=====================================",
    `Total requests            : ${count("http_reqs")}`,
    "",
    "Rate Limiter",
    "------------",
    `429 responses (correct)   : ${count("rate_limit_429_count")}`,
    `5xx responses (BUG!)      : ${count("rate_limit_5xx_count")}`,
    "",
    "Thundering Herd",
    "---------------",
    `herd_phase_ms    p95 = ${p95("herd_phase_ms")}ms   (expected: high)`,
    `recovery_phase_ms p95 = ${p95("recovery_phase_ms")}ms  (SLO: <600ms)`,
    "",
    "Malformed Requests",
    "------------------",
    `4xx responses (correct)   : ${count("malformed_4xx_count")}`,
    `5xx responses (BUG!)      : ${count("malformed_5xx_count")}  (SLO: 0)`,
    "",
    "Traffic Isolation",
    "-----------------",
    `healthy_traffic_ms p95 = ${p95("healthy_traffic_ms")}ms  (SLO: <600ms)`,
    "",
    `Verdict: ${
      count("malformed_5xx_count") === 0 &&
      count("rate_limit_5xx_count") === 0 &&
      parseInt(p95("recovery_phase_ms")) <= 600
        ? "PASS — System is resilient"
        : "FAIL — See details above"
    }`,
  ].join("\n");
}
