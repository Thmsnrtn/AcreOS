/**
 * AcreOS Load Testing — End-to-End Deal Pipeline Throughput (k6)
 *
 * Tests the full deal lifecycle under high concurrency at 10,000+ user scale.
 * Each VU drives one complete pipeline iteration: lead → deal → offer → close.
 *
 * Scenarios:
 *   pipeline_throughput   — 0→200→500 VUs, 5-min hold, measuring per-step and total latency
 *   pipeline_with_agents  — 100 VUs at 9min mark, same pipeline + agent proactive run
 *
 * Run (single instance):
 *   k6 run tests/load/k6-deal-pipeline.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env AUTH_COOKIE="connect.sid=s%3A..."
 *
 * Run (distributed — 4 instances across 2000 VUs total):
 *   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=0 k6 run tests/load/k6-deal-pipeline.js ...
 *   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=1 k6 run tests/load/k6-deal-pipeline.js ...
 *   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=2 k6 run tests/load/k6-deal-pipeline.js ...
 *   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=3 k6 run tests/load/k6-deal-pipeline.js ...
 *
 * Run (k6 Cloud at 10k+ scale):
 *   k6 cloud tests/load/k6-deal-pipeline.js
 *
 * Thresholds:
 *   pipeline_total_ms  p95 < 8000ms
 *   lead_create_ms     p95 < 1500ms
 *   deal_create_ms     p95 < 1500ms
 *   deal_close_ms      p95 < 1500ms
 *   http_req_failed    rate < 1%
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";
import {
  getBaseUrl,
  getHeaders,
  getOrgCount,
  getDistributedVUs,
  checkRes,
  generateLead,
  generateDeal,
} from "./lib/helpers.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = getBaseUrl();

// Distributed VU targets — scale each scenario down per instance automatically
const TOTAL_PEAK_VUS         = parseInt(__ENV.TOTAL_PEAK_VUS       || "500",  10);
const TOTAL_AGENT_VUS        = parseInt(__ENV.TOTAL_AGENT_VUS      || "100",  10);
const PEAK_VUS               = getDistributedVUs(TOTAL_PEAK_VUS);
const AGENT_VUS              = getDistributedVUs(TOTAL_AGENT_VUS);
const WARMUP_VUS             = getDistributedVUs(200); // first ramp target

// ─── Custom Metrics ───────────────────────────────────────────────────────────

// Full pipeline: lead create → deal close (wall-clock for entire VU iteration)
const pipelineTotalMs        = new Trend("pipeline_total_ms",          true);

// Per-step latency Trends (recorded per HTTP call, not per iteration)
const leadCreateMs           = new Trend("lead_create_ms",             true);
const dealCreateMs           = new Trend("deal_create_ms",             true);
const dealAdvanceMs          = new Trend("deal_advance_ms",            true);
const dealCloseMs            = new Trend("deal_close_ms",              true);

// Agent interference: how much longer the pipeline takes when agent runs concurrently
const agentInterferenceDelta = new Trend("agent_interference_delta_ms", true);

// Throughput counter — only incremented on full successful pipeline completion
const pipelinesCompleted     = new Counter("pipelines_completed");

// Error rate — tracks any failed step
const pipelineErrorRate      = new Rate("pipeline_error_rate");

// ─── Scenario Options ─────────────────────────────────────────────────────────

export const options = {
  // k6 Cloud: define load zones for geo-distributed 10k+ testing
  // ext: {
  //   loadimpact: {
  //     projectID: parseInt(__ENV.K6_PROJECT_ID || "0"),
  //     name: "AcreOS Deal Pipeline 10k",
  //     distribution: {
  //       "amazon:us:ashburn":  { loadZone: "amazon:us:ashburn",  percent: 60 },
  //       "amazon:us:portland": { loadZone: "amazon:us:portland", percent: 40 },
  //     },
  //   },
  // },

  scenarios: {
    // ── Scenario 1: Pipeline throughput ────────────────────────────────────
    // Full deal lifecycle under escalating concurrent user load.
    // Ramp: 0 → 200 (1min) → 500 (2min) → hold 500 (5min) → 0 (1min) = 9min total
    pipeline_throughput: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m",  target: WARMUP_VUS },   // warm up to 200 VUs
        { duration: "2m",  target: PEAK_VUS },     // ramp to 500 VUs
        { duration: "5m",  target: PEAK_VUS },     // hold peak load
        { duration: "1m",  target: 0 },            // ramp down gracefully
      ],
      gracefulRampDown: "30s",
      exec: "pipelineThroughputVU",
      tags: { scenario: "pipeline_throughput" },
    },

    // ── Scenario 2: Pipeline with agents ────────────────────────────────────
    // Same pipeline but fires a proactive agent run after deal creation.
    // Starts after pipeline_throughput peak so we isolate agent interference.
    // Baseline pipeline times from scenario 1 serve as the comparison reference.
    pipeline_with_agents: {
      executor: "constant-vus",
      vus: AGENT_VUS,
      duration: "3m",
      startTime: "9m",
      exec: "pipelineWithAgentsVU",
      tags: { scenario: "pipeline_with_agents" },
    },
  },

  thresholds: {
    pipeline_total_ms: ["p(95)<8000"],  // full lifecycle p95 under 8s
    lead_create_ms:    ["p(95)<1500"],  // lead creation p95 under 1.5s
    deal_create_ms:    ["p(95)<1500"],  // deal creation p95 under 1.5s
    deal_advance_ms:   ["p(95)<1500"],  // stage advance p95 under 1.5s
    deal_close_ms:     ["p(95)<1500"],  // deal close p95 under 1.5s
    http_req_failed:   ["rate<0.01"],   // < 1% HTTP errors
    pipeline_error_rate: ["rate<0.05"], // < 5% pipeline-level errors (partial failures)
  },
};

// ─── Shared Pipeline Logic ────────────────────────────────────────────────────

/**
 * Runs a complete deal lifecycle for one VU iteration.
 *
 * Steps:
 *   1. POST /api/leads                   — create lead
 *   2. GET  /api/leads/:id               — verify lead persisted
 *   3. POST /api/deals                   — create deal from lead
 *   4. PUT  /api/deals/:id               — advance to "offer_sent"
 *   5. PUT  /api/deals/:id               — close as "closed_won"
 *
 * @param {object} headers        - Auth headers for this VU's org
 * @param {Function|null} afterDeal  - Optional hook called with dealId after step 3
 * @returns {{ ok: boolean, totalMs: number }}
 */
function runDealPipeline(headers, afterDeal) {
  const pipelineStart = Date.now();
  let allOk = true;

  // ── Step 1: Create lead ─────────────────────────────────────────────────
  let leadId;
  group("create_lead", () => {
    const res = http.post(
      `${BASE_URL}/api/leads`,
      JSON.stringify(generateLead()),
      { headers, tags: { step: "lead_create" } }
    );
    const ok = checkRes(res, "lead create", leadCreateMs);
    if (ok) {
      try {
        const body = JSON.parse(res.body);
        leadId = body.id || body.leadId || body.data?.id;
      } catch {
        allOk = false;
      }
    } else {
      allOk = false;
    }
  });

  if (!leadId) {
    pipelineErrorRate.add(true);
    return { ok: false, totalMs: Date.now() - pipelineStart };
  }

  sleep(0.5);

  // ── Step 2: Verify lead persisted ───────────────────────────────────────
  group("verify_lead", () => {
    const res = http.get(
      `${BASE_URL}/api/leads/${leadId}`,
      { headers, tags: { step: "lead_read" } }
    );
    check(res, {
      "lead read 200": (r) => r.status === 200,
      "lead id matches": (r) => {
        try {
          const body = JSON.parse(r.body);
          return (body.id || body.leadId || body.data?.id) === leadId;
        } catch {
          return false;
        }
      },
    });
    if (res.status !== 200) allOk = false;
  });

  sleep(0.5);

  // ── Step 3: Create deal from lead ───────────────────────────────────────
  let dealId;
  group("create_deal", () => {
    const res = http.post(
      `${BASE_URL}/api/deals`,
      JSON.stringify(generateDeal(leadId)),
      { headers, tags: { step: "deal_create" } }
    );
    const ok = checkRes(res, "deal create", dealCreateMs);
    if (ok) {
      try {
        const body = JSON.parse(res.body);
        dealId = body.id || body.dealId || body.data?.id;
      } catch {
        allOk = false;
      }
    } else {
      allOk = false;
    }
  });

  if (!dealId) {
    pipelineErrorRate.add(true);
    return { ok: false, totalMs: Date.now() - pipelineStart };
  }

  // Optional hook (used by pipeline_with_agents scenario)
  if (afterDeal) {
    afterDeal(dealId, headers);
  }

  sleep(0.5);

  // ── Step 4: Advance deal to "offer_sent" ────────────────────────────────
  group("advance_deal", () => {
    const res = http.put(
      `${BASE_URL}/api/deals/${dealId}`,
      JSON.stringify({ stage: "offer_sent" }),
      { headers, tags: { step: "deal_advance" } }
    );
    const ok = checkRes(res, "deal advance", dealAdvanceMs);
    if (!ok) allOk = false;
  });

  sleep(0.5);

  // ── Step 5: Close deal as "closed_won" ──────────────────────────────────
  group("close_deal", () => {
    const res = http.put(
      `${BASE_URL}/api/deals/${dealId}`,
      JSON.stringify({ stage: "closed_won", closedAt: new Date().toISOString() }),
      { headers, tags: { step: "deal_close" } }
    );
    const ok = checkRes(res, "deal close", dealCloseMs);
    if (!ok) allOk = false;
  });

  const totalMs = Date.now() - pipelineStart;
  pipelineTotalMs.add(totalMs);

  if (allOk) {
    pipelinesCompleted.add(1);
    pipelineErrorRate.add(false);
  } else {
    pipelineErrorRate.add(true);
  }

  return { ok: allOk, totalMs };
}

// ─── Scenario: pipeline_throughput ───────────────────────────────────────────

/**
 * Pure pipeline load — no agent overhead.
 * This establishes the baseline pipeline_total_ms distribution.
 */
export function pipelineThroughputVU() {
  const orgIndex = __VU % getOrgCount();
  const headers  = getHeaders(orgIndex);

  runDealPipeline(headers, null);

  // Brief think time between iterations to model realistic user pace
  sleep(0.5 + Math.random() * 0.5);
}

// ─── Scenario: pipeline_with_agents ──────────────────────────────────────────

/**
 * Pipeline with concurrent agent proactive run after deal creation.
 * Measures agent_interference_delta_ms: the additional latency that the
 * agent run adds to the total pipeline time vs the baseline (scenario 1 p50).
 *
 * NOTE: agent_interference_delta_ms requires a baseline reference.
 * Set PIPELINE_BASELINE_MS env var to the p50 from pipeline_throughput results,
 * or leave at default 3000ms for initial runs.
 */
const PIPELINE_BASELINE_MS = parseInt(__ENV.PIPELINE_BASELINE_MS || "3000", 10);

export function pipelineWithAgentsVU() {
  const orgIndex = __VU % getOrgCount();
  const headers  = getHeaders(orgIndex);

  const afterDeal = (dealId, reqHeaders) => {
    group("agent_proactive_run", () => {
      const res = http.post(
        `${BASE_URL}/api/founder/v14/agents/proactive/run`,
        JSON.stringify({
          dealId,
          trigger: "post_deal_creation",
          context: { source: "load_test_pipeline_agents" },
        }),
        { headers: reqHeaders, tags: { step: "agent_proactive" } }
      );
      check(res, {
        "agent proactive run 2xx": (r) => r.status >= 200 && r.status < 300,
      });
    });
  };

  const { ok, totalMs } = runDealPipeline(headers, afterDeal);

  if (ok) {
    // Record how much this run exceeded the baseline pipeline time
    const delta = totalMs - PIPELINE_BASELINE_MS;
    if (delta > 0) {
      agentInterferenceDelta.add(delta);
    } else {
      // Faster than baseline (warm cache, etc.) — record as 0 interference
      agentInterferenceDelta.add(0);
    }
  }

  sleep(0.5 + Math.random() * 0.5);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const m = data.metrics;

  const summary = {
    test: "deal-pipeline",
    scale: {
      peak_vus:              TOTAL_PEAK_VUS,
      agent_scenario_vus:    TOTAL_AGENT_VUS,
      pipeline_baseline_ms:  PIPELINE_BASELINE_MS,
    },
    pipeline_throughput: {
      pipelines_completed:    m.pipelines_completed?.values?.count ?? 0,
      pipeline_total_p50_ms:  m.pipeline_total_ms?.values?.["p(50)"] ?? 0,
      pipeline_total_p95_ms:  m.pipeline_total_ms?.values?.["p(95)"] ?? 0,
      pipeline_total_p99_ms:  m.pipeline_total_ms?.values?.["p(99)"] ?? 0,
      lead_create_p95_ms:     m.lead_create_ms?.values?.["p(95)"] ?? 0,
      deal_create_p95_ms:     m.deal_create_ms?.values?.["p(95)"] ?? 0,
      deal_advance_p95_ms:    m.deal_advance_ms?.values?.["p(95)"] ?? 0,
      deal_close_p95_ms:      m.deal_close_ms?.values?.["p(95)"] ?? 0,
    },
    agent_interference: {
      delta_p50_ms: m.agent_interference_delta_ms?.values?.["p(50)"] ?? 0,
      delta_p95_ms: m.agent_interference_delta_ms?.values?.["p(95)"] ?? 0,
      delta_max_ms: m.agent_interference_delta_ms?.values?.max ?? 0,
    },
    errors: {
      http_req_failed_rate:   m.http_req_failed?.values?.rate ?? 0,
      pipeline_error_rate:    m.pipeline_error_rate?.values?.rate ?? 0,
    },
    thresholds_passed: {
      pipeline_total_p95:
        (m.pipeline_total_ms?.values?.["p(95)"] ?? Infinity) < 8000,
      lead_create_p95:
        (m.lead_create_ms?.values?.["p(95)"] ?? Infinity) < 1500,
      deal_create_p95:
        (m.deal_create_ms?.values?.["p(95)"] ?? Infinity) < 1500,
      deal_close_p95:
        (m.deal_close_ms?.values?.["p(95)"] ?? Infinity) < 1500,
      http_error_rate:
        (m.http_req_failed?.values?.rate ?? 1) < 0.01,
    },
  };

  const allPassed = Object.values(summary.thresholds_passed).every(Boolean);

  console.log("\n=== AcreOS Deal Pipeline — Load Test Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nOverall result: ${allPassed ? "PASS" : "FAIL"}`);

  return {
    "tests/load/results/deal-pipeline-summary.json": JSON.stringify(
      { summary, raw: data },
      null,
      2
    ),
  };
}
