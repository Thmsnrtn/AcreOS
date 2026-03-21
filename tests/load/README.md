# AcreOS Load Testing

## Overview

Uses [k6](https://k6.io) for load testing. Tests are organized by scenario:
- **Smoke**: 5 VUs, 30s — basic sanity check
- **Load**: Ramp to 50 VUs over 2 min, hold 3 min — realistic peak load
- **Spike**: 100 VUs for 30s — sudden traffic burst

## SLOs (Service Level Objectives)

| Endpoint Category | p95 Target | Error Rate Target |
|-------------------|-----------|-------------------|
| Read endpoints (leads, properties, deals) | < 500ms | < 1% |
| Dashboard stats | < 500ms | < 1% |
| Full-text search | < 500ms | < 1% |
| AI chat endpoints | < 2,000ms | < 2% |

## Running the Tests

### Prerequisites
```bash
# Install k6 (macOS)
brew install k6

# Install k6 (Linux)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### Get an auth cookie
1. Log in to the app in your browser
2. Open DevTools → Application → Cookies
3. Copy the `connect.sid` cookie value

### Run the baseline suite
```bash
# Against staging
k6 run tests/load/k6-baseline.js \
  --env BASE_URL=https://staging.yourapp.fly.dev \
  --env AUTH_COOKIE="connect.sid=s%3A..."

# Against production (read-only scenarios only)
k6 run tests/load/k6-baseline.js \
  --env BASE_URL=https://yourapp.fly.dev \
  --env AUTH_COOKIE="connect.sid=s%3A..." \
  --scenario smoke  # smoke only in prod
```

### Results
Results are saved to `tests/load/results/baseline-summary.json`.

## Interpreting Results

- **p95 duration**: 95% of requests should complete within the threshold
- **error_rate**: Must stay below 1% across all scenarios
- If p95 > 500ms on read endpoints: check Redis cache hit rate, add indexes
- If p95 > 500ms on dashboard: cache the stats query with 60s TTL
- If AI endpoints > 2s: check OpenAI latency, consider streaming responses

### Run the valuation load test (Task #170)
```bash
k6 run tests/load/k6-valuation.js \
  --env BASE_URL=https://staging.yourapp.fly.dev \
  --env AUTH_COOKIE="connect.sid=s%3A..."
```

### Run the concurrent users test (Task #171)
```bash
# 200 simultaneous users, 500 req/sec target
k6 run tests/load/k6-concurrent-users.js \
  --env BASE_URL=https://staging.yourapp.fly.dev \
  --env AUTH_COOKIE="connect.sid=s%3A..."
```

### Run the WebSocket connection limit test (Task #172)
```bash
# 500 concurrent WebSocket connections
k6 run tests/load/k6-websocket.js \
  --env WS_URL=wss://staging.yourapp.fly.dev/ws \
  --env AUTH_COOKIE="connect.sid=s%3A..."
```

### Run the marketplace bid storm test (Task #174)
```bash
# 100 concurrent bids on a single listing
k6 run tests/load/k6-marketplace-bids.js \
  --env BASE_URL=https://staging.yourapp.fly.dev \
  --env AUTH_COOKIE="connect.sid=s%3A..." \
  --env LISTING_ID=1
```

## Adding New Test Scenarios

Add a new scenario to `k6-baseline.js` under `options.scenarios` and a corresponding
`group()` in the default function. Tag AI endpoints with `{ tags: { endpoint: "ai" } }`
so they get the 2s threshold applied.

---

## 10K+ Scale Test Suite

Tests designed for 10,000+ concurrent users across the entire AcreOS platform.
Supports distributed k6 (multiple instances) and k6 Cloud.

### Architecture

- **1 founder** (you) — agents run autonomously in the background
- **10,000+ tenant users** across many organizations hitting leads, deals, properties, dashboard, marketplace, support, WebSocket

### Test Matrix

| Test | What It Tests | VUs | Duration |
|------|--------------|-----|----------|
| `k6-agent-pipeline.js` | Agents function under 2K user load | 2000 users + 13 agent VUs | 8 min |
| `k6-multi-tenant.js` | Org isolation, noisy neighbor protection | 2000 steady + 1500 noisy/quiet | 12 min |
| `k6-db-stress.js` | DB pool exhaustion, write contention, thundering herd | 300→1000→2000 VUs | 12 min |
| `k6-websocket-fanout.js` | WS broadcast latency under agent events | 800 WS + 100 HTTP | 5 min |
| `k6-deal-pipeline.js` | Full deal lifecycle throughput | 1000 pipeline + 2000 background | 10 min |
| `k6-soak.js` | Memory leaks, degradation over 30 min | 200 VUs | 30 min |
| `k6-chaos.js` | Rate limits, thundering herd recovery, malformed input | 3000 VUs peak | 8 min |

### Run All Tests

```bash
./tests/load/run-all.sh \
  --env BASE_URL=https://staging.yourapp.fly.dev \
  --env AUTH_COOKIE="connect.sid=s%3A..."
```

Skip specific tests:
```bash
SKIP="soak,chaos" ./tests/load/run-all.sh --env BASE_URL=...
```

Run only specific tests:
```bash
ONLY="db-stress,agent-pipeline" ./tests/load/run-all.sh --env BASE_URL=...
```

### Distributed Run (4 k6 instances across machines)

```bash
# On each machine, set instance index:
K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=0 ./tests/load/run-all.sh --env BASE_URL=...
K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=1 ./tests/load/run-all.sh --env BASE_URL=...
K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=2 ./tests/load/run-all.sh --env BASE_URL=...
K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=3 ./tests/load/run-all.sh --env BASE_URL=...

# VU counts automatically divide by K6_INSTANCE_COUNT.
# 4 instances × 2500 VUs each = 10,000 total VUs.
```

### k6 Cloud Run (simplest for 10K+)

```bash
k6 cloud tests/load/k6-agent-pipeline.js \
  --env BASE_URL=https://staging.yourapp.fly.dev \
  --env AUTH_COOKIE="connect.sid=s%3A..."
```

### Multi-Tenant Testing

Pass multiple org session cookies pipe-separated:
```bash
k6 run tests/load/k6-multi-tenant.js \
  --env BASE_URL=https://staging.yourapp.fly.dev \
  --env ORG_COOKIES="cookie_org1|cookie_org2|cookie_org3|..."
```

### Results

All results saved to `tests/load/results/` as JSON files.
Each test also prints a human-readable summary to stdout.

### SLO Reference (10K Scale)

| Metric | SLO | Test |
|--------|-----|------|
| User dashboard p95 | < 500ms | agent-pipeline |
| User leads/deals p95 | < 500ms | agent-pipeline |
| Cascade under load p95 | < 5000ms | agent-pipeline |
| Quiet org p95 (noisy neighbor) | < 600ms | multi-tenant |
| Cross-tenant violations | 0 | multi-tenant |
| DB read query p95 | < 500ms | db-stress |
| DB write query p95 | < 1000ms | db-stress |
| Deal pipeline total p95 | < 10000ms | deal-pipeline |
| WS broadcast latency p95 | < 500ms | websocket-fanout |
| Memory growth over 30min | < 100MB | soak |
| Malformed request 5xx count | 0 | chaos |
| Recovery after herd p95 | < 600ms | chaos |
