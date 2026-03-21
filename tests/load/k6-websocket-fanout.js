/**
 * AcreOS Load Testing — WebSocket Broadcast Fanout (k6)
 *
 * Tests WebSocket broadcast performance under real agent event load at 10,000+ user scale.
 * Validates fanout latency, reconnection resilience, and subscription throughput.
 *
 * Scenarios:
 *   fanout_ws_listeners   — 800 WS clients subscribe and measure broadcast latency
 *   fanout_http_triggers  — 100 req/sec HTTP agent actions generating WS broadcasts
 *   reconnection_storm    — 500 VUs repeatedly connect/disconnect/reconnect
 *   subscription_flood    — 500 VUs each subscribe to 5 channels sequentially
 *
 * Run (single instance):
 *   k6 run tests/load/k6-websocket-fanout.js \
 *     --env BASE_URL=https://your-app.fly.dev \
 *     --env WS_URL=wss://your-app.fly.dev/ws \
 *     --env AUTH_COOKIE="connect.sid=s%3A..."
 *
 * Run (distributed — 3 instances):
 *   K6_INSTANCE_COUNT=3 K6_INSTANCE_INDEX=0 k6 run tests/load/k6-websocket-fanout.js ...
 *   K6_INSTANCE_COUNT=3 K6_INSTANCE_INDEX=1 k6 run tests/load/k6-websocket-fanout.js ...
 *   K6_INSTANCE_COUNT=3 K6_INSTANCE_INDEX=2 k6 run tests/load/k6-websocket-fanout.js ...
 *
 * Thresholds:
 *   ws_message_latency_ms  p95 < 500ms
 *   ws_reconnect_success_rate > 98%
 *   ws_subscribe_ms        p95 < 200ms
 *   http_req_failed        rate < 2%
 */

import ws from "k6/ws";
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";
import {
  getBaseUrl,
  getHeaders,
  getOrgCount,
  getDistributedVUs,
} from "./lib/helpers.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = getBaseUrl();
const WS_URL = __ENV.WS_URL || BASE_URL.replace(/^http/, "ws") + "/ws";

// Distributed scale: total 800 WS listeners + 500 reconnect + 500 subscribe VUs
// With K6_INSTANCE_COUNT, each instance handles its slice.
const TOTAL_WS_LISTENERS    = parseInt(__ENV.TOTAL_WS_LISTENERS    || "800",  10);
const TOTAL_RECONNECT_VUS   = parseInt(__ENV.TOTAL_RECONNECT_VUS   || "500",  10);
const TOTAL_SUBSCRIBE_VUS   = parseInt(__ENV.TOTAL_SUBSCRIBE_VUS   || "500",  10);
const HTTP_TRIGGER_RATE     = parseInt(__ENV.HTTP_TRIGGER_RATE     || "100",  10); // req/sec
const HTTP_TRIGGER_PREALLOC = parseInt(__ENV.HTTP_TRIGGER_PREALLOC || "120",  10); // max VUs

const WS_LISTENER_VUS   = getDistributedVUs(TOTAL_WS_LISTENERS);
const RECONNECT_VUS     = getDistributedVUs(TOTAL_RECONNECT_VUS);
const SUBSCRIBE_VUS     = getDistributedVUs(TOTAL_SUBSCRIBE_VUS);

// ─── Custom Metrics ───────────────────────────────────────────────────────────

// Time from HTTP trigger response to WS message receipt (approximate broadcast latency)
const wsBroadcastLatency      = new Trend("ws_message_latency_ms", true);
// How long each channel subscription handshake takes
const wsSubscribeMs           = new Trend("ws_subscribe_ms", true);
// How long a full reconnect cycle (disconnect → connect → subscribed) takes
const wsReconnectMs           = new Trend("ws_reconnect_ms", true);
// Whether each reconnect attempt ultimately succeeded
const wsReconnectSuccessRate  = new Rate("ws_reconnect_success_rate");
// Whether each WS connection opened successfully
const wsConnectionSuccessRate = new Rate("ws_connection_success_rate");
// Raw error counter for debugging
const wsConnectionErrors      = new Counter("ws_connection_errors");
// Messages actually received (confirms delivery, not just delivery attempt)
const wsMessagesReceived      = new Counter("ws_messages_received");

// ─── Scenario Options ─────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // 800 WebSocket listeners: ramp up over 2min, hold 3min, measuring broadcast latency
    fanout_ws_listeners: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: WS_LISTENER_VUS },
        { duration: "3m", target: WS_LISTENER_VUS },
      ],
      gracefulRampDown: "30s",
      exec: "wsListenerVU",
      tags: { scenario: "fanout_ws_listeners" },
    },

    // 100 HTTP req/sec agent triggers starting at the 2-minute mark
    // (listeners are established by then — generates the actual broadcast load)
    fanout_http_triggers: {
      executor: "constant-arrival-rate",
      rate: HTTP_TRIGGER_RATE,
      timeUnit: "1s",
      duration: "3m",
      preAllocatedVUs: HTTP_TRIGGER_PREALLOC,
      maxVUs: HTTP_TRIGGER_PREALLOC * 2,
      startTime: "2m",
      exec: "httpTriggerVU",
      tags: { scenario: "fanout_http_triggers" },
    },

    // 500 VUs repeatedly cycling connect → wait 10s → disconnect → reconnect for 3min
    reconnection_storm: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: RECONNECT_VUS },
        { duration: "2m30s", target: RECONNECT_VUS },
      ],
      gracefulRampDown: "30s",
      startTime: "5m30s",
      exec: "reconnectionStormVU",
      tags: { scenario: "reconnection_storm" },
    },

    // 500 VUs each subscribe to 5 channels in sequence, measuring subscribe handshake time
    subscription_flood: {
      executor: "constant-vus",
      vus: SUBSCRIBE_VUS,
      duration: "3m",
      startTime: "5m30s",
      exec: "subscriptionFloodVU",
      tags: { scenario: "subscription_flood" },
    },
  },

  thresholds: {
    ws_message_latency_ms:      ["p(95)<500"],   // broadcast must reach listeners within 500ms
    ws_reconnect_success_rate:  ["rate>0.98"],   // 98%+ reconnects must succeed
    ws_subscribe_ms:            ["p(95)<200"],   // channel subscribe < 200ms
    ws_connection_success_rate: ["rate>0.95"],   // 95%+ initial connections succeed
    http_req_failed:            ["rate<0.02"],   // < 2% HTTP errors
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds WS connection headers from the org-rotated cookie pool.
 * orgIndex spreads VUs across orgs for realistic multi-tenant load.
 */
function wsHeaders(orgIndex) {
  const h = getHeaders(orgIndex);
  return { Cookie: h.Cookie };
}

/**
 * Connects to the WebSocket server and returns a promise-style wrapper.
 * Subscribes to the given channels on open.
 * Returns { connected: bool, subscribeMs: number[] }
 */
function connectAndSubscribe(orgIndex, channels, onMessage, holdMs) {
  const headers = wsHeaders(orgIndex);
  const connectStart = Date.now();
  let connected = false;
  const subscribeTimes = {};

  const res = ws.connect(WS_URL, { headers }, function (socket) {
    socket.on("open", () => {
      connected = true;
      wsConnectionSuccessRate.add(true);

      // Subscribe to each channel and timestamp the request
      channels.forEach((channel) => {
        subscribeTimes[channel] = Date.now();
        socket.send(JSON.stringify({ type: "subscribe", channel }));
      });
    });

    socket.on("message", (data) => {
      const recvTime = Date.now();
      wsMessagesReceived.add(1);

      try {
        const msg = JSON.parse(data);

        // Subscription acknowledgement: measure subscribe handshake time
        if (msg.type === "subscribed" && msg.channel && subscribeTimes[msg.channel]) {
          wsSubscribeMs.add(recvTime - subscribeTimes[msg.channel]);
          delete subscribeTimes[msg.channel];
        }

        // Broadcast event: measure end-to-end latency.
        // HTTP trigger VUs embed a triggerTs in the agent execute payload; the server
        // echoes it back through the broadcast so listeners can compute true
        // HTTP-response → WS-receipt latency across processes.
        if (msg.type === "event" || msg.type === "broadcast" || msg.type === "agent_event") {
          // Prefer triggerTs (set by HTTP trigger VU) for cross-process latency measurement;
          // fall back to serverTimestamp for server-side broadcast latency.
          const originTs = msg.triggerTs || msg.data?.triggerTs || msg.serverTimestamp;
          if (originTs && typeof originTs === "number") {
            const latency = recvTime - originTs;
            // Guard against clock skew between distributed load generator nodes
            if (latency >= 0 && latency < 60000) {
              wsBroadcastLatency.add(latency);
            }
          }
        }

        // Delegate to caller-provided handler for additional checks
        if (onMessage) {
          onMessage(msg, recvTime);
        }

        check(msg, {
          "ws message has type": (m) => typeof m.type === "string",
        });
      } catch {
        // Non-JSON frames (plain-text pings, etc.) — not an error
      }
    });

    socket.on("error", () => {
      wsConnectionErrors.add(1);
      wsConnectionSuccessRate.add(false);
    });

    socket.on("close", () => {
      // Normal close — no action needed
    });

    // Hold the connection for the specified duration then close
    socket.setTimeout(() => {
      socket.close();
    }, holdMs || 300000); // default 5 minutes

    // Keepalive ping every 25s to prevent idle timeout
    socket.setInterval(() => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, 25000);
  });

  check(res, {
    "WebSocket upgrade 101": (r) => r && r.status === 101,
  });

  if (!res || res.status !== 101) {
    wsConnectionSuccessRate.add(false);
    wsConnectionErrors.add(1);
    connected = false;
  }

  return connected;
}

// ─── Scenario: fanout_ws_listeners ────────────────────────────────────────────

/**
 * Each VU represents a browser tab subscribed to founder + org event channels.
 * Holds the connection for the full 5-minute scenario duration.
 * Broadcast latency is measured whenever an agent_event or broadcast arrives.
 */
export function wsListenerVU() {
  const orgIndex = __VU % getOrgCount();

  connectAndSubscribe(
    orgIndex,
    ["founder:activity", "org:1"],
    null,   // message handler: metrics recorded inside connectAndSubscribe
    300000  // 5 minutes
  );

  // k6 will call this function again if the scenario duration hasn't elapsed;
  // sleep briefly to avoid hammering the server with rapid reconnect loops.
  sleep(5);
}

// ─── Scenario: fanout_http_triggers ──────────────────────────────────────────

/**
 * HTTP VUs fire agent execute requests at 100 req/sec.
 * This produces the server-side work that generates WS broadcast events
 * which the wsListenerVUs will receive and measure.
 */
export function httpTriggerVU() {
  const orgIndex = __VU % getOrgCount();
  const headers = getHeaders(orgIndex);

  // triggerTs is echoed back by the server inside each WS broadcast payload so
  // the listener VUs can compute HTTP-trigger → WS-receipt latency end-to-end.
  const triggerTs = Date.now();
  const payload = JSON.stringify({
    action: "analyze_lead_pipeline",
    triggerTs,
    context: {
      trigger: "load_test_fanout",
      timestamp: triggerTs,
    },
  });

  const res = http.post(
    `${BASE_URL}/api/founder/v14/agents/execute`,
    payload,
    {
      headers,
      tags: { endpoint: "agent_execute" },
    }
  );

  check(res, {
    "agent execute 2xx": (r) => r.status >= 200 && r.status < 300,
  });
}

// ─── Scenario: reconnection_storm ────────────────────────────────────────────

/**
 * Each VU simulates a client with an unstable connection.
 * Connect → hold 10s → disconnect → measure reconnect time → repeat.
 * Models mobile users / flaky network conditions at scale.
 */
export function reconnectionStormVU() {
  const orgIndex = __VU % getOrgCount();
  const headers = wsHeaders(orgIndex);

  // Outer loop: each iteration is one connect/hold/disconnect cycle
  for (let cycle = 0; cycle < 10; cycle++) {
    const cycleStart = Date.now();
    let reconnectSucceeded = false;

    const res = ws.connect(WS_URL, { headers }, function (socket) {
      socket.on("open", () => {
        reconnectSucceeded = true;
        socket.send(JSON.stringify({ type: "subscribe", channel: "org:1" }));
      });

      socket.on("error", () => {
        wsConnectionErrors.add(1);
      });

      // Hold connection for 10 seconds then close (simulating page navigation / tab close)
      socket.setTimeout(() => {
        socket.close();
      }, 10000);
    });

    const cycleMs = Date.now() - cycleStart;

    wsReconnectSuccessRate.add(reconnectSucceeded);
    if (reconnectSucceeded) {
      wsReconnectMs.add(cycleMs);
    }

    check(res, {
      "reconnect upgrade 101": (r) => r && r.status === 101,
    });

    // Brief pause between reconnect cycles (simulate real reconnect backoff)
    sleep(1);
  }
}

// ─── Scenario: subscription_flood ────────────────────────────────────────────

/**
 * Each VU connects once then subscribes to 5 channels in sequence.
 * Measures per-subscription handshake time under concurrent subscription load.
 * Models users opening dashboards that subscribe to multiple data streams.
 */
export function subscriptionFloodVU() {
  const orgIndex = __VU % getOrgCount();
  const headers = wsHeaders(orgIndex);

  const channels = [
    "founder:activity",
    `org:${(orgIndex % 10) + 1}`,
    "deals:updates",
    "leads:updates",
    "agents:status",
  ];

  const res = ws.connect(WS_URL, { headers }, function (socket) {
    const subscribeStart = {};

    socket.on("open", () => {
      wsConnectionSuccessRate.add(true);

      // Subscribe to channels one at a time with a small stagger
      // to avoid thundering-herd on the subscribe handler
      channels.forEach((channel, i) => {
        socket.setTimeout(() => {
          subscribeStart[channel] = Date.now();
          socket.send(JSON.stringify({ type: "subscribe", channel }));
        }, i * 50); // 50ms stagger between subscriptions
      });
    });

    socket.on("message", (data) => {
      const recvTime = Date.now();
      try {
        const msg = JSON.parse(data);
        if (msg.type === "subscribed" && msg.channel && subscribeStart[msg.channel]) {
          wsSubscribeMs.add(recvTime - subscribeStart[msg.channel]);
          delete subscribeStart[msg.channel];
        }
        check(msg, {
          "subscribe ack has channel": (m) =>
            m.type !== "subscribed" || typeof m.channel === "string",
        });
      } catch {
        // Ignore non-JSON frames
      }
    });

    socket.on("error", () => {
      wsConnectionErrors.add(1);
      wsConnectionSuccessRate.add(false);
    });

    // Hold long enough to receive all subscription acks (channels * stagger + buffer)
    socket.setTimeout(() => {
      socket.close();
    }, channels.length * 50 + 5000);
  });

  check(res, {
    "subscription flood upgrade 101": (r) => r && r.status === 101,
  });

  if (!res || res.status !== 101) {
    wsConnectionErrors.add(1);
    wsConnectionSuccessRate.add(false);
  }

  // Minimal sleep before next iteration
  sleep(0.5);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const m = data.metrics;

  const summary = {
    test: "websocket-fanout",
    scale: {
      ws_listeners: TOTAL_WS_LISTENERS,
      reconnect_vus: TOTAL_RECONNECT_VUS,
      subscribe_vus: TOTAL_SUBSCRIBE_VUS,
      http_trigger_rate_per_sec: HTTP_TRIGGER_RATE,
    },
    results: {
      ws_broadcast_latency_p95_ms:
        m.ws_message_latency_ms?.values?.["p(95)"] || 0,
      ws_broadcast_latency_p99_ms:
        m.ws_message_latency_ms?.values?.["p(99)"] || 0,
      ws_subscribe_p95_ms:
        m.ws_subscribe_ms?.values?.["p(95)"] || 0,
      ws_reconnect_p95_ms:
        m.ws_reconnect_ms?.values?.["p(95)"] || 0,
      ws_reconnect_success_rate:
        m.ws_reconnect_success_rate?.values?.rate || 0,
      ws_connection_success_rate:
        m.ws_connection_success_rate?.values?.rate || 0,
      ws_total_messages_received:
        m.ws_messages_received?.values?.count || 0,
      ws_connection_errors:
        m.ws_connection_errors?.values?.count || 0,
      http_req_failed_rate:
        m.http_req_failed?.values?.rate || 0,
    },
    thresholds_passed: {
      broadcast_latency_p95:
        (m.ws_message_latency_ms?.values?.["p(95)"] || 0) < 500,
      reconnect_success_rate:
        (m.ws_reconnect_success_rate?.values?.rate || 0) > 0.98,
      subscribe_p95:
        (m.ws_subscribe_ms?.values?.["p(95)"] || 0) < 200,
      http_error_rate:
        (m.http_req_failed?.values?.rate || 0) < 0.02,
    },
  };

  const allPassed = Object.values(summary.thresholds_passed).every(Boolean);

  console.log("\n=== WebSocket Fanout Test Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nOverall result: ${allPassed ? "PASS" : "FAIL"}`);

  return {
    "tests/load/results/websocket-fanout-summary.json": JSON.stringify(data, null, 2),
  };
}
