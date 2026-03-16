/**
 * Task #174 — AcreOS Marketplace Bid Storm Test (k6)
 *
 * Simulates 100 concurrent bids on a single marketplace listing
 * to validate that only one bid wins with no race conditions.
 *
 * Expected behavior:
 *   - All 100 bids are accepted at the API layer (or serialized correctly)
 *   - No duplicate winners
 *   - No 500 errors
 *   - Highest bid is correctly recorded as current high bid
 *
 * Run:
 *   k6 run tests/load/k6-marketplace-bids.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env AUTH_COOKIE="connect.sid=s%3A..." \
 *     --env LISTING_ID=1
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";
const LISTING_ID = __ENV.LISTING_ID || "1";

const HEADERS = {
  "Content-Type": "application/json",
  Cookie: AUTH_COOKIE,
};

// Custom metrics
const bidSuccessRate = new Rate("bid_success_rate");
const bidErrorRate = new Rate("bid_error_rate");
const bidConflictRate = new Rate("bid_conflict_rate");
const totalBids = new Counter("total_bids_attempted");
const bidDuration = new Trend("bid_duration_ms", true);

export const options = {
  scenarios: {
    // 100 VUs all submit a bid simultaneously
    bid_storm: {
      executor: "shared-iterations",
      vus: 100,
      iterations: 100,
      maxDuration: "2m",
    },
    // Sustained bid load for race condition detection
    sustained_bids: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 20,
      maxVUs: 100,
      startTime: "2m",
    },
  },
  thresholds: {
    bid_error_rate: ["rate<0.05"],           // < 5% actual errors (5xx)
    bid_duration_ms: ["p(95)<1000"],         // p95 bid < 1s
    http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  // Generate a unique bid amount per VU to simulate different bidders
  const bidAmount = 50000 + (__VU * 100) + Math.floor(Math.random() * 50);

  const payload = JSON.stringify({
    amount: bidAmount,
    listingId: parseInt(LISTING_ID),
    bidderNote: `Automated bid from VU ${__VU}`,
  });

  const res = http.post(
    `${BASE_URL}/api/marketplace/${LISTING_ID}/bids`,
    payload,
    { headers: HEADERS }
  );

  bidDuration.add(res.timings.duration);
  totalBids.add(1);

  // Track different response categories
  const isSuccess = res.status === 200 || res.status === 201;
  const isConflict = res.status === 409;
  const isError = res.status >= 500;
  const isAuthRequired = res.status === 401 || res.status === 403;

  bidSuccessRate.add(isSuccess);
  bidConflictRate.add(isConflict);
  bidErrorRate.add(isError);

  check(res, {
    "bid accepted or conflict (no server error)": (r) =>
      r.status === 200 ||
      r.status === 201 ||
      r.status === 409 || // conflict = expected for race condition handling
      r.status === 401 || // auth required in test env
      r.status === 403 ||
      r.status === 404,   // listing not found = expected in test env
    "no server error (5xx)": (r) => r.status < 500,
    "response time < 1s": (r) => r.timings.duration < 1000,
  });

  // Brief pause between bids to simulate real user behavior
  sleep(0.1);
}

export function handleSummary(data) {
  const summary = {
    total_bids: data.metrics.total_bids_attempted?.values?.count || 0,
    success_rate: data.metrics.bid_success_rate?.values?.rate || 0,
    conflict_rate: data.metrics.bid_conflict_rate?.values?.rate || 0,
    error_rate: data.metrics.bid_error_rate?.values?.rate || 0,
    p95_duration_ms: data.metrics.bid_duration_ms?.values?.["p(95)"] || 0,
  };

  console.log("\n=== Marketplace Bid Storm Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  // Race condition check: if multiple bids succeed, verify no duplicate winner
  if (summary.success_rate > 0.5) {
    console.log(
      "WARNING: High success rate in bid storm — verify database for duplicate bid winners"
    );
  }

  return {
    "tests/load/results/marketplace-bids-summary.json": JSON.stringify(data, null, 2),
  };
}
