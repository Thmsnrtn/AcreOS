# AcreOS Load Test Specification

## Test Infrastructure

**Tool:** k6 (grafana/k6) or equivalent load testing framework
**Environment:** Staging instance matching production configuration (Fly.io, same machine size)
**Duration:** Each test runs for 2 minutes sustained load after 30-second ramp-up

---

## Test 1: Deal Feed Generation

**Scenario:** 50 concurrent organizations generating deal feeds simultaneously

**Configuration:**
```
Virtual Users: 50
Ramp-up: 10 seconds
Duration: 2 minutes sustained
Endpoint: GET /api/deal-feed
Auth: 50 distinct authenticated sessions (one per org)
```

**Pass Criteria:**
| Metric | Threshold |
|--------|-----------|
| All requests complete | < 60 seconds each |
| p95 response time | < 30 seconds |
| p99 response time | < 45 seconds |
| Error rate | < 1% |
| Timeout rate | 0% |

**What this validates:** Feed generation involves querying multiple data sources, scoring parcels, and ranking results. 50 concurrent feeds stress the provider registry, circuit breaker, and caching layers.

---

## Test 2: Due Diligence Report Generation

**Scenario:** 20 concurrent DD report requests for different properties

**Configuration:**
```
Virtual Users: 20
Ramp-up: 5 seconds
Duration: 2 minutes sustained
Endpoint: POST /api/properties/:id/dd-report
Auth: 20 distinct authenticated sessions
Data: 20 different property IDs (mix of cached and uncached)
```

**Pass Criteria:**
| Metric | Threshold |
|--------|-----------|
| All requests complete | < 10 seconds each |
| p95 response time | < 8 seconds |
| Error rate | < 2% (data source failures are acceptable) |
| Graceful degradation | Reports missing 1-2 sources still return (not error) |

**What this validates:** DD reports query up to 18 external data sources per request. This test verifies concurrent data source queries, circuit breaking under load, and response assembly.

---

## Test 3: Land Credit Score Calculation

**Scenario:** 100 concurrent LCS calculations

**Configuration:**
```
Virtual Users: 100
Ramp-up: 10 seconds
Duration: 2 minutes sustained
Endpoint: GET /api/land-credit/:propertyId
Auth: 100 distinct authenticated sessions
Data: 100 different property IDs (pre-enriched with data)
```

**Pass Criteria:**
| Metric | Threshold |
|--------|-----------|
| All requests complete | < 2 seconds each |
| p95 response time | < 1 second |
| p99 response time | < 1.5 seconds |
| Error rate | 0% |
| Score consistency | Same property always returns same score (deterministic) |

**What this validates:** LCS calculation is a compute-heavy operation (weighted scoring across 6 dimensions). This test verifies calculation performance and result determinism under concurrent load.

---

## Test 4: Global Search

**Scenario:** 50 concurrent search queries across leads, properties, and deals

**Configuration:**
```
Virtual Users: 50
Ramp-up: 10 seconds
Duration: 2 minutes sustained
Endpoint: GET /api/search?q={randomQuery}
Auth: 50 distinct authenticated sessions
Data: Mix of short queries ("hudspeth"), medium ("10 acre texas"), and long ("seller financed note delinquent")
```

**Pass Criteria:**
| Metric | Threshold |
|--------|-----------|
| All requests complete | < 500ms each |
| p95 response time | < 300ms |
| p99 response time | < 450ms |
| Error rate | 0% |
| Result relevance | Top 5 results contain at least 1 exact match for known queries |

**What this validates:** Search involves querying across multiple tables (leads, properties, deals) with full-text matching. This test verifies index performance and query optimization under concurrent access.

---

## Test 5: Webhook Delivery Burst

**Scenario:** 100 webhook events dispatched simultaneously

**Configuration:**
```
Trigger: 100 lead.created events generated in rapid succession
Endpoint: Internal webhook delivery system → 3 configured webhook endpoints
Auth: System-level (webhook delivery is server-side)
```

**Pass Criteria:**
| Metric | Threshold |
|--------|-----------|
| All events dispatched | Within 30 seconds |
| Delivery success rate | > 95% (assuming endpoints are healthy) |
| No events dropped | All 100 recorded in webhook_deliveries table |
| Retry on failure | Failed deliveries scheduled for retry (not lost) |

**What this validates:** Webhook delivery involves serializing payloads, making HTTP requests to external endpoints, and recording delivery status. This test verifies the delivery queue handles bursts without dropping events.

---

## Test 6: Concurrent API Operations (Mixed Workload)

**Scenario:** Realistic mixed workload simulating 100 concurrent users

**Configuration:**
```
Virtual Users: 100
Ramp-up: 30 seconds
Duration: 5 minutes sustained

Workload distribution:
- 30% GET /api/leads (list)
- 20% GET /api/deals (list)
- 15% GET /api/properties (list)
- 10% POST /api/leads (create)
- 10% PATCH /api/leads/:id (update)
- 5% GET /api/deal-feed
- 5% GET /api/land-credit/:id
- 5% POST /api/campaigns (create)
```

**Pass Criteria:**
| Metric | Threshold |
|--------|-----------|
| Overall p95 response time | < 1 second |
| Read operations p95 | < 500ms |
| Write operations p95 | < 2 seconds |
| Error rate | < 1% |
| Database connections | < 80% of max pool |
| Memory usage | < 80% of allocated |

**What this validates:** Real usage is a mix of reads and writes across different entity types. This test verifies the database connection pool, request middleware chain, and org-level data isolation under realistic conditions.

---

## Test 7: Database Connection Pool Saturation

**Scenario:** Push database connections to the limit

**Configuration:**
```
Virtual Users: 200
Ramp-up: 10 seconds
Duration: 1 minute sustained
Endpoint: GET /api/leads (requires DB query)
```

**Pass Criteria:**
| Metric | Threshold |
|--------|-----------|
| Requests succeed | > 95% |
| Connection wait time | < 5 seconds |
| No connection pool exhaustion error | True |
| Graceful degradation | Queued requests complete (not rejected) |

**What this validates:** At 200 concurrent requests, the connection pool will be stressed. This test verifies the pool queues requests gracefully rather than throwing errors.

---

## Running Load Tests

```bash
# Install k6
brew install k6  # macOS
# or: snap install k6  # Linux

# Run a specific test
k6 run tests/simulation/load/deal-feed.js

# Run with custom VUs and duration
k6 run --vus 50 --duration 2m tests/simulation/load/deal-feed.js

# Run with HTML report
k6 run --out json=results.json tests/simulation/load/deal-feed.js
```

## Pre-Test Checklist

- [ ] Staging environment deployed and healthy
- [ ] Test user accounts created (100+ orgs with sample data)
- [ ] External data source rate limits won't be hit (use cached data where possible)
- [ ] Monitoring dashboards open (Fly.io metrics, Sentry, database connections)
- [ ] Baseline metrics recorded (before load test)
