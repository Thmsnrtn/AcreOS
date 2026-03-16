# AcreOS SLO Monitoring Configuration

**Task #168 — Define SLOs and monitoring thresholds**

---

## Service Level Objectives (SLOs)

| SLO | Target | Alert Threshold | Measurement Window |
|-----|--------|-----------------|-------------------|
| API Availability | 99.9% uptime | < 99.5% | 30-day rolling |
| API P95 Latency | < 200ms | > 500ms | 5-minute window |
| API P99 Latency | < 1,000ms | > 2,000ms | 5-minute window |
| Error Rate | < 0.1% | > 1% | 5-minute window |
| Job Queue Backlog | Processed within 5 min | > 100 items pending | Rolling |
| AI P95 Response | < 3,000ms | > 10,000ms | 5-minute window |
| DB Connection Pool | < 80% utilized | > 90% utilized | 1-minute window |
| Redis Memory | < 70% utilized | > 80% utilized | 5-minute window |

---

## Prometheus Alerts (prometheus.yml)

```yaml
groups:
  - name: acreos-slos
    rules:

      # API availability
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High API error rate: {{ $value | humanizePercentage }}"

      # P95 latency
      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P95 latency exceeds 500ms: {{ $value | humanizeDuration }}"

      # Database connection pool
      - alert: DBPoolExhausted
        expr: pg_connections_active / pg_connections_max > 0.9
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "DB connection pool > 90% utilized"

      # Redis memory
      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis memory > 80% utilized"

      # Queue depth
      - alert: QueueDepthHigh
        expr: bullmq_queue_size > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Job queue depth > 100 items"

      # AI spend
      - alert: AISpendHigh
        expr: acreos_openai_daily_cost_usd > 50
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Daily AI spend: ${{ $value }}"

      # Stripe webhook failures
      - alert: StripeWebhookFailing
        expr: rate(acreos_stripe_webhook_failed_total[10m]) > 0
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "Stripe webhooks failing — subscription updates may be missed"
```

---

## Grafana Dashboard Panels (Task #146)

### Panel 1: Request Rate
- Metric: `rate(http_requests_total[1m])`
- Visualization: Time series
- Alert: None (informational)

### Panel 2: P95 Latency
- Metric: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))`
- Visualization: Gauge
- Alert threshold: 500ms

### Panel 3: Error Rate
- Metric: `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])`
- Visualization: Gauge (percent)
- Alert threshold: 1%

### Panel 4: DB Connection Pool
- Metric: `pg_connections_active`
- Visualization: Bar gauge
- Alert threshold: 18/20 connections

### Panel 5: Queue Depth
- Metric: `bullmq_queue_size`
- Visualization: Time series
- Alert threshold: 100 items

### Panel 6: AI API Spend
- Metric: `acreos_openai_daily_cost_usd`
- Visualization: Stat
- Alert threshold: $50/day

---

## Uptime Monitoring (UptimeRobot / Fly.io)

Endpoints to monitor (every 60 seconds):
- `GET https://acreos.fly.dev/api/health/cached` — overall health
- `GET https://acreos.fly.dev/api/health` — detailed component health
- `GET https://acreos.fly.dev/` — frontend loads

Alert channels:
- Primary: PagerDuty (P1/P2 incidents)
- Secondary: Slack `#alerts-production`
- Status page: Update automatically on downtime

---

## On-Call Rotation (Task #161)

### Escalation Policy
| Priority | Response Time | Escalation |
|----------|--------------|------------|
| P1 — Critical | Immediate (< 5 min) | On-call engineer → Founder |
| P2 — High | 15 minutes | On-call engineer |
| P3 — Medium | Next business day | Team Slack |
| P4 — Low | This sprint | JIRA ticket |

### P1 Criteria
- API unavailable (>1 min downtime)
- Error rate > 5% sustained
- Data breach suspected
- Payment processing broken
- Database unavailable

### P2 Criteria
- P95 > 2s for 5+ minutes
- AI API down
- Email delivery broken
- Background jobs backed up >1 hour
