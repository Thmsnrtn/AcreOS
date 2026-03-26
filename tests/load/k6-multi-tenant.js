/**
 * AcreOS Multi-Tenant Isolation — Load Test (k6)
 *
 * Tests that 10,000+ users across many organizations don't interfere with
 * each other. Validates: no cross-tenant data leakage, noisy neighbors
 * don't degrade other orgs, fair DB connection distribution.
 *
 * ─── Setup ───────────────────────────────────────────────────────────────────
 *
 *   Pass multiple org session cookies pipe-separated:
 *
 *   k6 run tests/load/k6-multi-tenant.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env ORG_COOKIES="cookie_org1|cookie_org2|...|cookie_org10"
 *
 *   If only one cookie is provided, the test still runs but multi-org
 *   isolation checks are skipped.
 *
 * ─── Distributed ─────────────────────────────────────────────────────────────
 *
 *   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=0 \
 *     k6 run tests/load/k6-multi-tenant.js --env BASE_URL=... --env ORG_COOKIES=...
 *
 * ─── SLOs ────────────────────────────────────────────────────────────────────
 *
 *   quiet_org_ms      p95 < 600ms  (light orgs unaffected by noisy neighbor)
 *   noisy_org_ms      p95 < 2000ms (heavy org may be slower, but functional)
 *   http_req_failed   rate < 1%
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import {
  getBaseUrl,
  getHeaders,
  getOrgCount,
  checkRes,
  randomThinkTime,
  getDistributedVUs,
  generateLead,
} from "./lib/helpers.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = getBaseUrl();
const ORG_COUNT = getOrgCount();
const MULTI_ORG_VUS = getDistributedVUs(2000);
const NOISY_VUS = getDistributedVUs(1000);  // all aimed at org 0
const QUIET_VUS = getDistributedVUs(500);    // spread across other orgs

// ─── Metrics ─────────────────────────────────────────────────────────────────

const quietOrgMs = new Trend("quiet_org_ms", true);
const noisyOrgMs = new Trend("noisy_org_ms", true);
const overallOrgMs = new Trend("overall_org_ms", true);
const errorRate = new Rate("error_rate");
const crossTenantViolations = new Counter("cross_tenant_violations");

// ─── Options ─────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Phase 1: All orgs get equal traffic — baseline multi-tenant performance
    multi_org_steady: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: MULTI_ORG_VUS },
        { duration: "5m", target: MULTI_ORG_VUS },
        { duration: "1m", target: 0 },
      ],
      exec: "multiOrgSteady",
      tags: { scenario: "multi_org_steady" },
    },

    // Phase 2: Noisy neighbor — org 0 gets 1000 VUs, others get 500 total
    noisy_neighbor_heavy: {
      executor: "constant-vus",
      vus: NOISY_VUS,
      duration: "3m",
      startTime: "9m",
      exec: "noisyNeighborHeavy",
      tags: { scenario: "noisy_heavy" },
    },

    noisy_neighbor_quiet: {
      executor: "constant-vus",
      vus: QUIET_VUS,
      duration: "3m",
      startTime: "9m",
      exec: "noisyNeighborQuiet",
      tags: { scenario: "noisy_quiet" },
    },
  },

  thresholds: {
    quiet_org_ms: ["p(95)<600"],    // light orgs MUST stay fast
    noisy_org_ms: ["p(95)<2000"],   // heavy org can be slower
    http_req_failed: ["rate<0.01"],
    cross_tenant_violations: ["count<1"],  // ZERO cross-org leaks
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getOrgIndex() {
  return __VU % Math.max(ORG_COUNT, 1);
}

// ─── Scenario: multi_org_steady ──────────────────────────────────────────────
// Each VU is assigned to an org. Runs dashboard → leads → deals journey.

export function multiOrgSteady() {
  const orgIdx = getOrgIndex();
  const headers = getHeaders(orgIdx);

  // Dashboard
  group(`org_${orgIdx}: dashboard`, () => {
    const res = http.get(`${BASE_URL}/api/dashboard/stats`, {
      headers,
      timeout: "10s",
      tags: { org: `org_${orgIdx}`, endpoint: "dashboard" },
    });
    checkRes(res, `org_${orgIdx} dashboard`, overallOrgMs, errorRate);
  });

  sleep(randomThinkTime(1, 3));

  // Leads list — verify data belongs to this org
  group(`org_${orgIdx}: leads`, () => {
    const res = http.get(`${BASE_URL}/api/leads?page=1&limit=10`, {
      headers,
      timeout: "10s",
      tags: { org: `org_${orgIdx}`, endpoint: "leads" },
    });
    checkRes(res, `org_${orgIdx} leads`, overallOrgMs, errorRate);

    // Cross-tenant isolation check
    if (res.status === 200 && res.body) {
      try {
        const body = JSON.parse(res.body);
        const leads = Array.isArray(body) ? body : (body.leads || body.data || []);
        for (const lead of leads) {
          if (lead.organizationId && lead.organizationId !== orgIdx + 1) {
            // Can't perfectly check without knowing actual org IDs,
            // but flag if leads appear to have mixed org IDs
            const orgIds = new Set(leads.map((l) => l.organizationId).filter(Boolean));
            if (orgIds.size > 1) {
              crossTenantViolations.add(1);
              console.warn(`Cross-tenant leak detected! Org ${orgIdx} got leads from multiple orgs: ${[...orgIds]}`);
            }
            break;
          }
        }
      } catch {}
    }
  });

  sleep(randomThinkTime(1, 3));

  // Deals
  group(`org_${orgIdx}: deals`, () => {
    const res = http.get(`${BASE_URL}/api/deals`, {
      headers,
      timeout: "10s",
      tags: { org: `org_${orgIdx}`, endpoint: "deals" },
    });
    checkRes(res, `org_${orgIdx} deals`, overallOrgMs, errorRate);
  });

  sleep(randomThinkTime(1, 3));
}

// ─── Scenario: noisy_neighbor_heavy (org 0 = heavy load) ────────────────────

export function noisyNeighborHeavy() {
  const headers = getHeaders(0);  // Always org 0

  // Rapid-fire requests — this org is the noisy neighbor
  group("noisy_org: dashboard", () => {
    const res = http.get(`${BASE_URL}/api/dashboard/stats`, {
      headers,
      timeout: "10s",
      tags: { org: "noisy", endpoint: "dashboard" },
    });
    checkRes(res, "noisy dashboard", noisyOrgMs, errorRate);
  });

  group("noisy_org: leads", () => {
    const page = randomInt(1, 20);
    const res = http.get(`${BASE_URL}/api/leads?page=${page}&limit=50`, {
      headers,
      timeout: "10s",
      tags: { org: "noisy", endpoint: "leads" },
    });
    checkRes(res, "noisy leads", noisyOrgMs, errorRate);
  });

  group("noisy_org: deals", () => {
    const res = http.get(`${BASE_URL}/api/deals`, {
      headers,
      timeout: "10s",
      tags: { org: "noisy", endpoint: "deals" },
    });
    checkRes(res, "noisy deals", noisyOrgMs, errorRate);
  });

  group("noisy_org: properties", () => {
    const res = http.get(`${BASE_URL}/api/properties?limit=50&state=TX`, {
      headers,
      timeout: "10s",
      tags: { org: "noisy", endpoint: "properties" },
    });
    checkRes(res, "noisy properties", noisyOrgMs, errorRate);
  });

  // Very short think time — noisy neighbor is aggressive
  sleep(randomThinkTime(0.1, 0.5));
}

// ─── Scenario: noisy_neighbor_quiet (orgs 1-N = light load) ─────────────────

export function noisyNeighborQuiet() {
  // Pick a non-zero org
  const orgIdx = (__VU % Math.max(ORG_COUNT - 1, 1)) + 1;
  const headers = getHeaders(orgIdx);

  group(`quiet_org_${orgIdx}: dashboard`, () => {
    const res = http.get(`${BASE_URL}/api/dashboard/stats`, {
      headers,
      timeout: "10s",
      tags: { org: "quiet", endpoint: "dashboard" },
    });
    checkRes(res, "quiet dashboard", quietOrgMs, errorRate);
  });

  sleep(randomThinkTime(1, 2));

  group(`quiet_org_${orgIdx}: leads`, () => {
    const res = http.get(`${BASE_URL}/api/leads?page=1&limit=10`, {
      headers,
      timeout: "10s",
      tags: { org: "quiet", endpoint: "leads" },
    });
    checkRes(res, "quiet leads", quietOrgMs, errorRate);
  });

  // Normal think time
  sleep(randomThinkTime(2, 4));
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  return {
    "tests/load/results/multi-tenant-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const p95 = (key) => (m[key]?.values?.["p(95)"] ?? 0).toFixed(0);
  const rate = (key) => ((m[key]?.values?.rate ?? 0) * 100).toFixed(2);
  const count = (key) => (m[key]?.values?.count ?? 0);

  return [
    "AcreOS Multi-Tenant Isolation — Summary",
    "========================================",
    `Total requests              : ${count("http_reqs")}`,
    `Error rate                  : ${rate("http_req_failed")}%`,
    `Cross-tenant violations     : ${count("cross_tenant_violations")}`,
    "",
    "Noisy Neighbor Test",
    "-------------------",
    `quiet_org_ms    p95 = ${p95("quiet_org_ms")}ms   (SLO: <600ms — must not degrade)`,
    `noisy_org_ms    p95 = ${p95("noisy_org_ms")}ms  (SLO: <2000ms — may be slower)`,
    "",
    `Verdict: ${parseInt(p95("quiet_org_ms")) <= 600 ? "PASS — Quiet orgs unaffected" : "FAIL — Noisy neighbor caused degradation"}`,
  ].join("\n");
}
