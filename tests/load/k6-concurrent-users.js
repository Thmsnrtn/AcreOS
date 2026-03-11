/**
 * Task #171 — AcreOS Concurrent User Load Test (k6)
 *
 * Tests the system with 200 simultaneous users navigating the app
 * to validate there's no degradation under realistic peak load.
 *
 * SLOs:
 *   p95 response time < 500ms for read endpoints
 *   p95 response time < 2,000ms for write endpoints
 *   Error rate < 1%
 *
 * Run:
 *   k6 run tests/load/k6-concurrent-users.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env AUTH_COOKIE="connect.sid=s%3A..."
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";

const HEADERS = {
  "Content-Type": "application/json",
  Cookie: AUTH_COOKIE,
};

// Custom metrics
const errorRate = new Rate("concurrent_error_rate");
const dashboardTrend = new Trend("dashboard_duration_ms", true);
const dealsTrend = new Trend("deals_duration_ms", true);
const leadsTrend = new Trend("leads_duration_ms", true);
const propertiesTrend = new Trend("properties_duration_ms", true);
const healthTrend = new Trend("health_duration_ms", true);
const requestCount = new Counter("total_requests");

export const options = {
  scenarios: {
    // Ramp to 200 VUs over 2 min, hold for 5 min, ramp down
    concurrent_users: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },   // warm up
        { duration: "1m", target: 200 },  // ramp to 200
        { duration: "5m", target: 200 },  // sustain 200 users
        { duration: "1m", target: 0 },    // ramp down
      ],
      gracefulRampDown: "30s",
    },
    // Constant arrivals to measure throughput
    throughput_test: {
      executor: "constant-arrival-rate",
      rate: 500,         // 500 req/sec target
      timeUnit: "1s",
      duration: "3m",
      preAllocatedVUs: 50,
      maxVUs: 250,
      startTime: "3m",   // Start after ramp test
    },
  },
  thresholds: {
    concurrent_error_rate: ["rate<0.01"],       // < 1% error rate
    dashboard_duration_ms: ["p(95)<500"],        // p95 < 500ms
    deals_duration_ms: ["p(95)<500"],
    leads_duration_ms: ["p(95)<500"],
    properties_duration_ms: ["p(95)<500"],
    health_duration_ms: ["p(95)<200"],           // health check very fast
    http_req_failed: ["rate<0.01"],
  },
};

// Realistic user journey patterns
const USER_JOURNEYS = [
  "dashboard_browse",
  "deal_management",
  "lead_management",
  "property_search",
  "api_only",
];

export default function () {
  // Pick a random user journey
  const journey = USER_JOURNEYS[Math.floor(Math.random() * USER_JOURNEYS.length)];

  switch (journey) {
    case "dashboard_browse":
      dashboardJourney();
      break;
    case "deal_management":
      dealManagementJourney();
      break;
    case "lead_management":
      leadManagementJourney();
      break;
    case "property_search":
      propertySearchJourney();
      break;
    case "api_only":
      apiHealthJourney();
      break;
  }
}

function dashboardJourney() {
  group("Dashboard Browse", () => {
    // Load dashboard stats
    const r1 = http.get(`${BASE_URL}/api/dashboard/stats`, { headers: HEADERS });
    dashboardTrend.add(r1.timings.duration);
    requestCount.add(1);
    errorRate.add(!check(r1, { "dashboard stats ok": (r) => r.status < 500 }));
    sleep(1);

    // Load recent activity
    const r2 = http.get(`${BASE_URL}/api/activity?limit=10`, { headers: HEADERS });
    requestCount.add(1);
    errorRate.add(!check(r2, { "activity ok": (r) => r.status < 500 }));
    sleep(0.5);

    // Load portfolio summary
    const r3 = http.get(`${BASE_URL}/api/portfolio/summary`, { headers: HEADERS });
    requestCount.add(1);
    errorRate.add(!check(r3, { "portfolio ok": (r) => r.status < 500 }));
    sleep(2);
  });
}

function dealManagementJourney() {
  group("Deal Management", () => {
    // List deals
    const r1 = http.get(`${BASE_URL}/api/deals?limit=25&offset=0`, { headers: HEADERS });
    dealsTrend.add(r1.timings.duration);
    requestCount.add(1);
    errorRate.add(!check(r1, { "deals list ok": (r) => r.status < 500 }));
    sleep(1);

    // Get pipeline stats
    const r2 = http.get(`${BASE_URL}/api/deals/pipeline/stats`, { headers: HEADERS });
    requestCount.add(1);
    errorRate.add(!check(r2, { "pipeline stats ok": (r) => r.status < 500 }));
    sleep(0.5);

    // Get single deal (use placeholder ID — 404 is fine)
    const r3 = http.get(`${BASE_URL}/api/deals/1`, { headers: HEADERS });
    requestCount.add(1);
    errorRate.add(!check(r3, { "deal detail ok": (r) => r.status < 500 }));
    sleep(2);
  });
}

function leadManagementJourney() {
  group("Lead Management", () => {
    // List leads
    const r1 = http.get(`${BASE_URL}/api/leads?limit=25&offset=0`, { headers: HEADERS });
    leadsTrend.add(r1.timings.duration);
    requestCount.add(1);
    errorRate.add(!check(r1, { "leads list ok": (r) => r.status < 500 }));
    sleep(1);

    // Get lead score distribution
    const r2 = http.get(`${BASE_URL}/api/leads/stats`, { headers: HEADERS });
    requestCount.add(1);
    errorRate.add(!check(r2, { "lead stats ok": (r) => r.status < 500 }));
    sleep(2);
  });
}

function propertySearchJourney() {
  group("Property Search", () => {
    const states = ["TX", "FL", "AZ", "CO", "GA"];
    const state = states[Math.floor(Math.random() * states.length)];

    // Search properties
    const r1 = http.get(
      `${BASE_URL}/api/properties?state=${state}&limit=25`,
      { headers: HEADERS }
    );
    propertiesTrend.add(r1.timings.duration);
    requestCount.add(1);
    errorRate.add(!check(r1, { "properties search ok": (r) => r.status < 500 }));
    sleep(1);

    // Get marketplace listings
    const r2 = http.get(`${BASE_URL}/api/marketplace?limit=12`, { headers: HEADERS });
    requestCount.add(1);
    errorRate.add(!check(r2, { "marketplace ok": (r) => r.status < 500 }));
    sleep(2);
  });
}

function apiHealthJourney() {
  group("API Health", () => {
    // Health check (lightweight)
    const r1 = http.get(`${BASE_URL}/api/health/cached`);
    healthTrend.add(r1.timings.duration);
    requestCount.add(1);
    errorRate.add(!check(r1, {
      "health ok": (r) => r.status === 200,
      "health fast": (r) => r.timings.duration < 200,
    }));
    sleep(5);
  });
}
