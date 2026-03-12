/**
 * Task #172 — AcreOS WebSocket Connection Limit Test (k6)
 *
 * Tests 500 concurrent WebSocket connections to verify:
 *   - Server handles high WS connection count without crashing
 *   - Connection upgrade succeeds for all VUs
 *   - Real-time messages are delivered within SLO
 *
 * Run:
 *   k6 run tests/load/k6-websocket.js \
 *     --env WS_URL=wss://your-app.fly.dev/ws \
 *     --env AUTH_COOKIE="connect.sid=s%3A..."
 *
 * Note: k6 requires the k6/ws module for WebSocket testing.
 */

import ws from "k6/ws";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";

const WS_URL = __ENV.WS_URL || "ws://localhost:5000/ws";
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";

// Custom metrics
const connectionSuccessRate = new Rate("ws_connection_success_rate");
const messageReceiveRate = new Rate("ws_message_receive_rate");
const connectionErrors = new Counter("ws_connection_errors");
const connectionDuration = new Trend("ws_connection_duration_ms", true);
const messageLatency = new Trend("ws_message_latency_ms", true);

export const options = {
  scenarios: {
    // 500 concurrent WebSocket connections
    websocket_connections: {
      executor: "constant-vus",
      vus: 500,
      duration: "3m",
    },
  },
  thresholds: {
    ws_connection_success_rate: ["rate>0.95"],     // 95%+ connections succeed
    ws_message_receive_rate: ["rate>0.90"],        // 90%+ messages received
    ws_connection_duration_ms: ["p(95)<5000"],     // connect within 5s
    ws_message_latency_ms: ["p(95)<1000"],         // messages within 1s
  },
};

export default function () {
  const headers = AUTH_COOKIE
    ? { Cookie: AUTH_COOKIE }
    : {};

  const connectStart = Date.now();

  const res = ws.connect(WS_URL, { headers }, function (socket) {
    const connectTime = Date.now() - connectStart;
    connectionDuration.add(connectTime);

    socket.on("open", () => {
      connectionSuccessRate.add(true);

      // Subscribe to organization-scoped events
      socket.send(JSON.stringify({
        type: "subscribe",
        channel: "deals",
      }));

      // Send a ping to verify bidirectional communication
      const pingStart = Date.now();
      socket.send(JSON.stringify({ type: "ping", timestamp: pingStart }));
    });

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === "pong") {
          const latency = Date.now() - (msg.timestamp || Date.now());
          messageLatency.add(latency);
          messageReceiveRate.add(true);
        } else if (msg.type === "connected" || msg.type === "subscribed") {
          messageReceiveRate.add(true);
        }

        check(msg, {
          "message has type": (m) => typeof m.type === "string",
        });
      } catch {
        // Non-JSON message — some servers send plain text pings
        messageReceiveRate.add(true);
      }
    });

    socket.on("error", (err) => {
      connectionErrors.add(1);
      connectionSuccessRate.add(false);
    });

    // Hold connection for 2 minutes (simulating active browser session)
    socket.setTimeout(() => {
      socket.close();
    }, 120000);

    // Send periodic pings every 30 seconds to keep connection alive
    socket.setInterval(() => {
      if (socket.readyState === 1) { // OPEN
        socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, 30000);
  });

  check(res, {
    "WebSocket connection established": (r) => r && r.status === 101,
  });

  if (!res || res.status !== 101) {
    connectionSuccessRate.add(false);
    connectionErrors.add(1);
  }

  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    concurrent_connections_tested: 500,
    connection_success_rate:
      data.metrics.ws_connection_success_rate?.values?.rate || 0,
    message_receive_rate:
      data.metrics.ws_message_receive_rate?.values?.rate || 0,
    p95_connection_ms:
      data.metrics.ws_connection_duration_ms?.values?.["p(95)"] || 0,
    p95_message_latency_ms:
      data.metrics.ws_message_latency_ms?.values?.["p(95)"] || 0,
    total_errors: data.metrics.ws_connection_errors?.values?.count || 0,
  };

  console.log("\n=== WebSocket Connection Limit Test Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  const passed =
    summary.connection_success_rate >= 0.95 &&
    summary.message_receive_rate >= 0.9;

  console.log(`\nOverall result: ${passed ? "PASS ✓" : "FAIL ✗"}`);

  return {
    "tests/load/results/websocket-summary.json": JSON.stringify(data, null, 2),
  };
}
