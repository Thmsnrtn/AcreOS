/**
 * AcreOS Agent Pipeline Under User Load — Load Test (k6)
 *
 * Tests that the autonomous agent pipeline (cascades, decisions, execution)
 * continues to function correctly while 10,000+ real users are hitting the
 * platform. There is ONE founder — the agents run autonomously in the background.
 *
 * Architecture:
 *   - user_traffic:           2000 VUs simulating real platform users (leads, deals, dashboard)
 *   - agent_cascades:         5 VUs simulating 6 agents triggering cascades concurrently
 *   - agent_decisions:        3 VUs processing autonomous decisions under DB contention
 *   - agent_execution:        5 VUs executing agent actions while pool is stressed
 *
 * The key question: do agents still work when 10K users are hammering the DB pool?
 *
 * ─── Run ─────────────────────────────────────────────────────────────────────
 *
 *   k6 run tests/load/k6-agent-pipeline.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env AUTH_COOKIE=connect.sid=...
 *
 * ─── Distributed (4 k6 instances) ───────────────────────────────────────────
 *
 *   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=0 \
 *     k6 run tests/load/k6-agent-pipeline.js --env BASE_URL=... --env AUTH_COOKIE=...
 *
 * ─── k6 Cloud ────────────────────────────────────────────────────────────────
 *
 *   k6 cloud tests/load/k6-agent-pipeline.js \
 *     --env BASE_URL=https://your-app.fly.dev --env AUTH_COOKIE=...
 *
 * ─── SLOs ────────────────────────────────────────────────────────────────────
 *
 *   user_dashboard_ms       p95 < 500ms   (users unaffected by agents)
 *   user_leads_ms           p95 < 500ms
 *   cascade_under_load_ms   p95 < 5000ms  (relaxed — DB pool is stressed)
 *   decision_under_load_ms  p95 < 8000ms
 *   execution_under_load_ms p95 < 3000ms
 *   http_req_failed         rate < 2%
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
  generateLead,
} from "./lib/helpers.js";

// ─── Distributed scaling ─────────────────────────────────────────────────────

const INSTANCE_COUNT = parseInt(__ENV.K6_INSTANCE_COUNT || "1", 10);
const USER_VUS = getDistributedVUs(2000);
const AGENT_CASCADE_VUS = Math.max(1, getDistributedVUs(5));
const AGENT_DECISION_VUS = Math.max(1, getDistributedVUs(3));
const AGENT_EXEC_VUS = Math.max(1, getDistributedVUs(5));

// ─── Custom metrics ──────────────────────────────────────────────────────────

// User-facing metrics (should NOT degrade because of agents)
const userDashboardMs = new Trend("user_dashboard_ms", true);
const userLeadsMs = new Trend("user_leads_ms", true);
const userDealsMs = new Trend("user_deals_ms", true);
const userPropertiesMs = new Trend("user_properties_ms", true);

// Agent metrics (relaxed SLOs — DB pool is stressed by user traffic)
const cascadeUnderLoadMs = new Trend("cascade_under_load_ms", true);
const decisionUnderLoadMs = new Trend("decision_under_load_ms", true);
const executionUnderLoadMs = new Trend("execution_under_load_ms", true);

const errorRate = new Rate("error_rate");
const poolTimeoutErrors = new Counter("pool_timeout_errors");
const agentErrors = new Counter("agent_errors");

// ─── Scenario options ────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // The main event: 2000 real users hammering the platform
    user_traffic: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: USER_VUS },       // ramp to 2000
        { duration: "5m", target: USER_VUS },       // sustained peak
        { duration: "1m", target: 0 },               // ramp down
      ],
      exec: "userTraffic",
      tags: { scenario: "user_traffic" },
    },

    // 5 VUs simulating the 6 AI agents running cascade resolutions
    agent_cascades: {
      executor: "constant-vus",
      vus: AGENT_CASCADE_VUS,
      duration: "6m",
      startTime: "1m",  // start after users begin ramping
      exec: "agentCascades",
      tags: { scenario: "agent_cascades" },
    },

    // 3 VUs processing autonomous decision inbox items
    agent_decisions: {
      executor: "constant-vus",
      vus: AGENT_DECISION_VUS,
      duration: "5m",
      startTime: "2m",  // start when user load is at peak
      exec: "agentDecisions",
      tags: { scenario: "agent_decisions" },
    },

    // 5 VUs executing agent actions (proactive behaviors)
    agent_execution: {
      executor: "constant-vus",
      vus: AGENT_EXEC_VUS,
      duration: "5m",
      startTime: "2m",
      exec: "agentExecution",
      tags: { scenario: "agent_execution" },
    },
  },

  thresholds: {
    // User-facing SLOs — agents must NOT degrade user experience
    user_dashboard_ms: ["p(95)<500"],
    user_leads_ms: ["p(95)<500"],
    user_deals_ms: ["p(95)<500"],
    user_properties_ms: ["p(95)<500"],

    // Agent SLOs — relaxed because DB pool is stressed
    cascade_under_load_ms: ["p(95)<5000"],
    decision_under_load_ms: ["p(95)<8000"],
    execution_under_load_ms: ["p(95)<3000"],

    // Global error budget
    http_req_failed: ["rate<0.02"],
    error_rate: ["rate<0.02"],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_URL = getBaseUrl();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const AGENT_CODENAMES = [
  "sentinel_devops", "sophie_csm", "forge_revenue",
  "oracle_analytics", "atlas_research", "ledger_finance",
];

// ─── Scenario: user_traffic (2000 VUs) ──────────────────────────────────────
// Simulates real platform users browsing leads, deals, dashboard, properties.
// This creates the DB pool contention that agents must cope with.

export function userTraffic() {
  const headers = getHeaders(0);
  const journey = pick(["dashboard", "leads", "deals", "properties", "mixed"]);

  if (journey === "dashboard" || journey === "mixed") {
    group("user: dashboard", () => {
      const res = http.get(`${BASE_URL}/api/dashboard/stats`, {
        headers, timeout: "10s", tags: { endpoint: "dashboard" },
      });
      checkRes(res, "dashboard", userDashboardMs, errorRate);
      if (res.status === 503 || res.status === 504) poolTimeoutErrors.add(1);
    });
  }

  sleep(randomThinkTime(0.5, 2));

  if (journey === "leads" || journey === "mixed") {
    group("user: leads list", () => {
      const page = randomInt(1, 10);
      const res = http.get(`${BASE_URL}/api/leads?page=${page}&limit=25`, {
        headers, timeout: "10s", tags: { endpoint: "leads" },
      });
      checkRes(res, "leads", userLeadsMs, errorRate);
      if (res.status === 503 || res.status === 504) poolTimeoutErrors.add(1);
    });
  }

  sleep(randomThinkTime(0.5, 2));

  if (journey === "deals" || journey === "mixed") {
    group("user: deals list", () => {
      const res = http.get(`${BASE_URL}/api/deals`, {
        headers, timeout: "10s", tags: { endpoint: "deals" },
      });
      checkRes(res, "deals", userDealsMs, errorRate);
      if (res.status === 503 || res.status === 504) poolTimeoutErrors.add(1);
    });
  }

  sleep(randomThinkTime(0.5, 2));

  if (journey === "properties") {
    group("user: property search", () => {
      const state = pick(["TX", "FL", "GA", "NC", "TN"]);
      const res = http.get(`${BASE_URL}/api/properties?state=${state}&limit=25`, {
        headers, timeout: "10s", tags: { endpoint: "properties" },
      });
      checkRes(res, "properties", userPropertiesMs, errorRate);
      if (res.status === 503 || res.status === 504) poolTimeoutErrors.add(1);
    });
  }

  sleep(randomThinkTime(1, 3));
}

// ─── Scenario: agent_cascades (5 VUs) ───────────────────────────────────────
// Simulates agents running confidence cascades while users are active.

export function agentCascades() {
  const headers = getHeaders(0);

  group("agent: cascade resolve", () => {
    const agent = pick(AGENT_CODENAMES);
    const payload = JSON.stringify({
      agentCodename: agent,
      triggerContext: {
        type: pick(["deal_evaluation", "lead_scoring", "churn_detection", "anomaly_check"]),
        entityId: randomInt(1000, 999999),
      },
      confidenceThreshold: 70,
      orgId: 1,
    });

    const res = http.post(
      `${BASE_URL}/api/founder/v14/cascade/resolve`,
      payload,
      { headers, timeout: "15s", tags: { endpoint: "cascade_resolve" } },
    );

    const ok = checkRes(res, "cascade under load", cascadeUnderLoadMs, errorRate);
    if (!ok) agentErrors.add(1);
    if (res.status === 503 || res.status === 504) poolTimeoutErrors.add(1);
  });

  // Agents run on intervals, not as fast as possible
  sleep(randomThinkTime(5, 15));
}

// ─── Scenario: agent_decisions (3 VUs) ──────────────────────────────────────
// Simulates the autonomous decision executor processing inbox items.

export function agentDecisions() {
  const headers = getHeaders(0);

  group("agent: submit decision item", () => {
    const payload = JSON.stringify({
      itemType: pick(["support_escalation", "churn_risk", "critical_alert", "feature_request"]),
      title: `Load test item ${Date.now()}`,
      summary: "Auto-generated during load testing",
      priority: pick(["low", "medium", "high"]),
      urgency: "routine",
      ownerAgentCodename: pick(AGENT_CODENAMES),
      actionPayload: {
        action: "resolve",
        entityId: randomInt(10000, 9999999),
      },
    });

    const res = http.post(
      `${BASE_URL}/api/founder/v14/decisions-inbox`,
      payload,
      { headers, timeout: "15s", tags: { endpoint: "decisions_inbox_post" } },
    );

    const ok = checkRes(res, "decision submit under load", decisionUnderLoadMs, errorRate);
    if (!ok) agentErrors.add(1);
    if (res.status === 503 || res.status === 504) poolTimeoutErrors.add(1);
  });

  // Decision processing happens on 30-min intervals, not continuously
  sleep(randomThinkTime(10, 30));
}

// ─── Scenario: agent_execution (5 VUs) ──────────────────────────────────────
// Simulates proactive agent behaviors executing real actions.

export function agentExecution() {
  const headers = getHeaders(0);

  group("agent: execute action", () => {
    const agent = pick(AGENT_CODENAMES);
    const action = pick([
      "send_follow_up", "update_lead_status", "flag_deal_risk",
      "create_task", "store_learning",
    ]);

    const payload = JSON.stringify({
      agentCodename: agent,
      action: action,
      input: {
        leadId: randomInt(1000, 999999),
        reason: "Proactive behavior during load test",
      },
    });

    const res = http.post(
      `${BASE_URL}/api/founder/v14/agents/execute`,
      payload,
      { headers, timeout: "10s", tags: { endpoint: "agents_execute" } },
    );

    const ok = checkRes(res, "execution under load", executionUnderLoadMs, errorRate);
    if (!ok) agentErrors.add(1);
    if (res.status === 503 || res.status === 504) poolTimeoutErrors.add(1);
  });

  // Agent actions are rate-limited to 30/hr per agent
  sleep(randomThinkTime(5, 20));
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  return {
    "tests/load/results/agent-pipeline-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const p95 = (key) => (m[key]?.values?.["p(95)"] ?? 0).toFixed(0);
  const rate = (key) => ((m[key]?.values?.rate ?? 0) * 100).toFixed(2);
  const count = (key) => (m[key]?.values?.count ?? 0);

  return [
    "AcreOS Agent Pipeline Under User Load — Summary",
    "=================================================",
    `Total requests         : ${count("http_reqs")}`,
    `Error rate             : ${rate("http_req_failed")}%`,
    `Pool timeout errors    : ${count("pool_timeout_errors")}`,
    `Agent errors           : ${count("agent_errors")}`,
    "",
    "User-Facing SLOs (should NOT degrade from agents)",
    "--------------------------------------------------",
    `user_dashboard_ms      p95 = ${p95("user_dashboard_ms")}ms  (SLO: <500ms)`,
    `user_leads_ms          p95 = ${p95("user_leads_ms")}ms  (SLO: <500ms)`,
    `user_deals_ms          p95 = ${p95("user_deals_ms")}ms  (SLO: <500ms)`,
    `user_properties_ms     p95 = ${p95("user_properties_ms")}ms  (SLO: <500ms)`,
    "",
    "Agent SLOs (relaxed — running under DB contention)",
    "---------------------------------------------------",
    `cascade_under_load_ms  p95 = ${p95("cascade_under_load_ms")}ms  (SLO: <5000ms)`,
    `decision_under_load_ms p95 = ${p95("decision_under_load_ms")}ms  (SLO: <8000ms)`,
    `execution_under_load_ms p95 = ${p95("execution_under_load_ms")}ms  (SLO: <3000ms)`,
  ].join("\n");
}
