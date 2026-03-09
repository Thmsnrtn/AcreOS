/**
 * AcreOS — AVM Valuation Load Test (k6)
 *
 * Tests the AVM valuation API under realistic concurrent load to validate
 * that response times and error rates meet SLOs before each production deploy.
 *
 * SLOs:
 *   p95 response time < 2 000ms
 *   p99 response time < 5 000ms
 *   Error rate        < 1%
 *
 * Run:
 *   k6 run tests/load/k6-valuation.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env AUTH_COOKIE="connect.sid=s%3A..."
 *
 * Install k6: https://k6.io/docs/getting-started/installation/
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";

const HEADERS = {
  "Content-Type": "application/json",
  Cookie: AUTH_COOKIE,
};

// ─── Custom metrics ───────────────────────────────────────────────────────────

const errorRate          = new Rate("valuation_error_rate");
const valuationTrend     = new Trend("valuation_duration_ms", true);
const avmTrend           = new Trend("avm_request_duration_ms", true);
const propertyLookupTrend= new Trend("property_lookup_duration_ms", true);
const totalValuations    = new Counter("valuations_requested_total");
const cachedValuations   = new Counter("valuations_served_from_cache");

// ─── Test scenarios ───────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Ramp up to 50 VUs over 1 min, hold for 3 min, ramp down over 1 min
    valuation_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },  // ramp up
        { duration: "3m", target: 50 },  // hold
        { duration: "1m", target: 0 },   // ramp down
      ],
      tags: { scenario: "valuation_load" },
    },
  },

  thresholds: {
    // P95 must be under 2 seconds
    "http_req_duration{scenario:valuation_load}": [
      "p(95)<2000",
      "p(99)<5000",
    ],
    valuation_error_rate:           ["rate<0.01"],  // < 1% errors
    http_req_failed:                ["rate<0.01"],
    valuation_duration_ms:          ["p(95)<2000"],
    avm_request_duration_ms:        ["p(95)<3000"],  // AVM calls are heavier
  },
};

// ─── Sample property data ─────────────────────────────────────────────────────

const SAMPLE_PROPERTIES = [
  { apn: "123-456-789-000", county: "Travis", state: "TX", acres: 100 },
  { apn: "987-654-321-000", county: "Bexar",  state: "TX", acres: 250 },
  { apn: "456-123-000-001", county: "Harris", state: "TX", acres: 50 },
  { apn: "789-000-123-456", county: "Dallas", state: "TX", acres: 175 },
  { apn: "321-654-987-000", county: "Tarrant",state: "TX", acres: 320 },
  { apn: "000-111-222-333", county: "Collin", state: "TX", acres: 80 },
];

const SAMPLE_COORDS = [
  { lat: 30.2672, lng: -97.7431 },  // Austin, TX
  { lat: 29.4241, lng: -98.4936 },  // San Antonio, TX
  { lat: 29.7604, lng: -95.3698 },  // Houston, TX
  { lat: 32.7767, lng: -96.7970 },  // Dallas, TX
  { lat: 32.7254, lng: -97.3208 },  // Fort Worth, TX
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Default function (main VU loop) ─────────────────────────────────────────

export default function () {
  const property = randomItem(SAMPLE_PROPERTIES);
  const coords   = randomItem(SAMPLE_COORDS);

  // ── 1. AVM valuation request ────────────────────────────────────────────────
  group("AVM Valuation", () => {
    const payload = JSON.stringify({
      apn:     property.apn,
      county:  property.county,
      state:   property.state,
      acres:   property.acres,
      lat:     coords.lat,
      lng:     coords.lng,
    });

    const res = http.post(`${BASE_URL}/api/valuation/avm`, payload, {
      headers: HEADERS,
      timeout: "30s",
      tags: { endpoint: "avm" },
    });

    const ok = check(res, {
      "avm valuation 200": (r) => r.status === 200,
      "avm response has value": (r) => {
        try {
          const body = JSON.parse(r.body);
          return (
            body.estimatedValue !== undefined ||
            body.value !== undefined ||
            body.avm !== undefined
          );
        } catch {
          return false;
        }
      },
      "avm response < 5s": (r) => r.timings.duration < 5000,
    });

    errorRate.add(!ok);
    avmTrend.add(res.timings.duration);
    valuationTrend.add(res.timings.duration);
    totalValuations.add(1);

    // Check if result came from cache
    if (res.headers["X-Cache"] === "HIT") {
      cachedValuations.add(1);
    }

    sleep(0.5);
  });

  // ── 2. Property lookup (prerequisite for many valuation flows) ──────────────
  group("Property Lookup", () => {
    const res = http.get(
      `${BASE_URL}/api/properties?apn=${encodeURIComponent(property.apn)}&limit=1`,
      { headers: HEADERS, tags: { endpoint: "property_lookup" } }
    );

    check(res, {
      "property lookup 200 or 404": (r) => r.status === 200 || r.status === 404,
      "property lookup < 1s": (r) => r.timings.duration < 1000,
    });

    propertyLookupTrend.add(res.timings.duration);
    errorRate.add(res.status >= 500);
    sleep(0.3);
  });

  // ── 3. Comparable sales (used in AVM calculation) ───────────────────────────
  group("Comparable Sales", () => {
    const res = http.get(
      `${BASE_URL}/api/valuation/comparables?lat=${coords.lat}&lng=${coords.lng}&radius=25&limit=10`,
      { headers: HEADERS, tags: { endpoint: "comparables" } }
    );

    check(res, {
      "comparables 200": (r) => r.status === 200 || r.status === 404,
      "comparables < 2s": (r) => r.timings.duration < 2000,
    });

    errorRate.add(res.status >= 500);
    sleep(0.3);
  });

  // ── 4. Market data endpoint (feeds valuation context) ──────────────────────
  if (Math.random() < 0.3) {
    group("Market Data", () => {
      const res = http.get(
        `${BASE_URL}/api/market/trends?county=${encodeURIComponent(property.county)}&state=${property.state}`,
        { headers: HEADERS, tags: { endpoint: "market_data" } }
      );

      check(res, {
        "market data 200": (r) => r.status === 200 || r.status === 404,
        "market data < 2s": (r) => r.timings.duration < 2000,
      });

      errorRate.add(res.status >= 500);
      sleep(0.5);
    });
  }

  // ── 5. Portfolio optimizer (heavy — sampled at 10%) ────────────────────────
  if (Math.random() < 0.1) {
    group("Portfolio Optimizer", () => {
      const res = http.get(
        `${BASE_URL}/api/portfolio/optimize`,
        {
          headers: HEADERS,
          timeout: "30s",
          tags: { endpoint: "portfolio" },
        }
      );

      check(res, {
        "optimizer 200 or 401": (r) => r.status === 200 || r.status === 401,
      });

      errorRate.add(res.status >= 500);
      sleep(1);
    });
  }

  // Brief pause between VU iterations to simulate realistic user pacing
  sleep(Math.random() * 0.5 + 0.2);
}

// ─── Summary output ───────────────────────────────────────────────────────────

export function handleSummary(data) {
  const p95 = (data.metrics.valuation_duration_ms?.values?.["p(95)"] ?? 0).toFixed(0);
  const p99 = (data.metrics.valuation_duration_ms?.values?.["p(99)"] ?? 0).toFixed(0);
  const errRate = ((data.metrics.valuation_error_rate?.values?.rate ?? 0) * 100).toFixed(2);
  const totalReqs = data.metrics.http_reqs?.values?.count ?? 0;
  const totalVals = data.metrics.valuations_requested_total?.values?.count ?? 0;

  const summary = [
    "AcreOS — Valuation Load Test Summary",
    "=====================================",
    `Total HTTP requests:  ${totalReqs}`,
    `Valuations requested: ${totalVals}`,
    `Error rate:           ${errRate}%`,
    `p95 valuation:        ${p95}ms  (SLO: <2000ms)  ${p95 < 2000 ? "PASS" : "FAIL"}`,
    `p99 valuation:        ${p99}ms  (SLO: <5000ms)  ${p99 < 5000 ? "PASS" : "FAIL"}`,
    `Error rate SLO:       <1%                        ${parseFloat(errRate) < 1 ? "PASS" : "FAIL"}`,
  ].join("\n");

  return {
    "tests/load/results/valuation-summary.json": JSON.stringify(data, null, 2),
    stdout: summary + "\n",
  };
}
