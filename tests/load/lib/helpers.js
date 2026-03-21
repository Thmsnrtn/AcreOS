/**
 * AcreOS Load Testing — Shared Helpers
 *
 * Reusable utilities for all k6 test files.
 * Import: import { getHeaders, checkRes, randomThinkTime, generateLead, generateDeal } from "./lib/helpers.js";
 */

import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

// ─── Auth & Headers ──────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";

// Multi-org cookies: pipe-separated list of session cookies
const ORG_COOKIES = (__ENV.ORG_COOKIES || AUTH_COOKIE).split("|").filter(Boolean);

export function getBaseUrl() {
  return BASE_URL;
}

export function getHeaders(orgIndex) {
  const cookie = ORG_COOKIES[orgIndex % ORG_COOKIES.length] || AUTH_COOKIE;
  return {
    "Content-Type": "application/json",
    Cookie: cookie.startsWith("connect.sid=") ? cookie : `connect.sid=${cookie}`,
  };
}

export function getDefaultHeaders() {
  return getHeaders(0);
}

export function getOrgCount() {
  return ORG_COOKIES.length;
}

// ─── Response Validation ─────────────────────────────────────────────────────

/**
 * Standard response check + metric recording.
 * @param {object} res - k6 HTTP response
 * @param {string} name - Human-readable label
 * @param {Trend} [trend] - Optional k6 Trend to record duration
 * @param {Rate} [errorRate] - Optional k6 Rate for errors
 * @returns {boolean} Whether all checks passed
 */
export function checkRes(res, name, trend, errorRate) {
  const ok = check(res, {
    [`${name} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${name} not empty`]: (r) => r.body && r.body.length > 0,
  });

  if (trend) {
    trend.add(res.timings.duration);
  }
  if (errorRate) {
    errorRate.add(!ok);
  }

  return ok;
}

/**
 * Check that response is a valid error (4xx, not 5xx).
 */
export function checkClientError(res, name, errorRate) {
  const ok = check(res, {
    [`${name} is 4xx`]: (r) => r.status >= 400 && r.status < 500,
    [`${name} not 5xx`]: (r) => r.status < 500,
  });
  if (errorRate) errorRate.add(!ok);
  return ok;
}

// ─── Think Time ──────────────────────────────────────────────────────────────

/**
 * Realistic human think time. Defaults 1-3 seconds.
 */
export function randomThinkTime(minSec, maxSec) {
  const min = minSec || 1;
  const max = maxSec || 3;
  return min + Math.random() * (max - min);
}

// ─── Test Data Factories ─────────────────────────────────────────────────────

const FIRST_NAMES = ["James", "Maria", "John", "Sarah", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];
const STATES = ["TX", "FL", "GA", "NC", "TN", "AL", "SC", "MS", "AR", "OK"];
const COUNTIES = ["Harris", "Dallas", "Tarrant", "Travis", "Bexar", "Duval", "Palm Beach", "Fulton", "Wake", "Shelby"];
const STREETS = ["Oak", "Maple", "Pine", "Cedar", "Elm", "Birch", "Walnut", "Spruce", "Hickory", "Willow"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateLead() {
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  return {
    firstName: first,
    lastName: last,
    email: `loadtest_${first.toLowerCase()}_${last.toLowerCase()}_${Date.now()}@test.local`,
    phone: `555${randomInt(1000000, 9999999)}`,
    propertyAddress: `${randomInt(100, 9999)} ${pick(STREETS)} St`,
    city: `TestCity_${randomInt(1, 50)}`,
    state: pick(STATES),
    county: pick(COUNTIES),
    zipCode: `${randomInt(10000, 99999)}`,
    source: "load_test",
    estimatedValue: randomInt(10000, 500000),
    acreage: randomInt(1, 200),
  };
}

export function generateDeal(leadId) {
  return {
    leadId,
    dealName: `LT Deal ${Date.now()}_${randomInt(1, 9999)}`,
    stage: "qualification",
    offerAmount: randomInt(5000, 100000),
    estimatedValue: randomInt(10000, 200000),
    propertyType: "vacant_land",
    source: "load_test",
  };
}

export function generateSupportTicket() {
  return {
    subject: `Load Test Ticket ${Date.now()}`,
    message: `This is a load test ticket generated at ${new Date().toISOString()}`,
    priority: pick(["low", "medium", "high"]),
    category: pick(["billing", "technical", "feature_request", "general"]),
  };
}

// ─── Health Monitoring ───────────────────────────────────────────────────────

import http from "k6/http";

/**
 * Polls /api/health and returns parsed metrics.
 * Useful for soak tests to monitor server-side state.
 */
export function pollHealth() {
  const res = http.get(`${BASE_URL}/api/health`, { headers: getDefaultHeaders() });
  if (res.status === 200) {
    try {
      return JSON.parse(res.body);
    } catch {
      return null;
    }
  }
  return null;
}

// ─── Distributed k6 Helpers ──────────────────────────────────────────────────

/**
 * Returns VU allocation for distributed testing.
 * When running with k6 cloud or multiple k6 instances,
 * each instance gets a slice of the total VU count.
 */
export function getDistributedVUs(totalVUs) {
  const instanceCount = parseInt(__ENV.K6_INSTANCE_COUNT || "1", 10);
  const instanceIndex = parseInt(__ENV.K6_INSTANCE_INDEX || "0", 10);
  return Math.ceil(totalVUs / instanceCount);
}

/**
 * Returns the instance-specific org range for multi-tenant tests.
 */
export function getOrgRange(totalOrgs) {
  const instanceCount = parseInt(__ENV.K6_INSTANCE_COUNT || "1", 10);
  const instanceIndex = parseInt(__ENV.K6_INSTANCE_INDEX || "0", 10);
  const perInstance = Math.ceil(totalOrgs / instanceCount);
  const start = instanceIndex * perInstance;
  const end = Math.min(start + perInstance, totalOrgs);
  return { start, end };
}
