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

## Adding New Test Scenarios

Add a new scenario to `k6-baseline.js` under `options.scenarios` and a corresponding
`group()` in the default function. Tag AI endpoints with `{ tags: { endpoint: "ai" } }`
so they get the 2s threshold applied.
