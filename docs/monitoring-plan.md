# AcreOS Monitoring & Alerting Plan

## Server Health

**Where:** Fly.io dashboard + `fly status`

**Metrics:**
- CPU utilization
- Memory usage
- Request count / throughput
- Response latency (p50, p95, p99)
- 5xx error rate

**Alert thresholds:**
| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| CPU | > 70% sustained 5m | > 80% sustained 5m | Scale up machines or optimize hot paths |
| Memory | > 80% | > 90% | Check for memory leaks, restart, increase machine size |
| 5xx rate | > 2% of requests | > 5% of requests | Check Sentry, roll back if regression |
| Request latency p95 | > 1s | > 3s | Profile slow endpoints, check DB queries |

**Monitoring commands:**
```bash
fly status              # Machine health
fly logs                # Real-time log stream
fly machines list       # All machines and their states
```

---

## Error Monitoring

**Where:** Sentry (https://sentry.io)

**Metrics:**
- New error types (fingerprint-based deduplication)
- Error frequency per type
- Error rate trend (increasing = problem)
- Affected users count

**Alert thresholds:**
| Condition | Action |
|-----------|--------|
| New error type appears | Investigate within 4 hours |
| Any error > 10 occurrences in 1 hour | Investigate immediately |
| Error rate increases 50%+ day-over-day | Check recent deployments, roll back if correlated |
| Error affects > 5% of active users | Priority fix, communicate to affected users |

---

## Database

**Where:** Fly.io Postgres metrics + application health endpoint

**Metrics:**
- Active connections / max connections
- Query latency (p95)
- Database size
- Replication lag (if replica configured)
- Lock wait time

**Alert thresholds:**
| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Connections | > 60% of max | > 80% of max | Check for connection leaks, increase pool size |
| Query p95 | > 1s | > 2s | Identify slow queries, add indexes, optimize |
| Database size | > 80% of disk | > 90% of disk | Archive old data, increase disk |
| Lock wait time | > 500ms avg | > 2s avg | Investigate transaction contention |

**Monitoring commands:**
```bash
fly postgres connect -a acreos-db
# Then run:
SELECT count(*) FROM pg_stat_activity;   -- active connections
SELECT * FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;  -- largest tables
```

---

## Payments

**Where:** Stripe Dashboard

**Metrics:**
- Successful payments per day
- Failed payments per day
- Dispute count
- MRR (Monthly Recurring Revenue)
- Churn rate

**Alert thresholds:**
| Condition | Action |
|-----------|--------|
| Payment failure rate > 10% | Check Stripe status, verify webhook processing |
| Any dispute received | Respond within 24 hours (Stripe gives 7 days) |
| MRR drops > 10% week-over-week | Investigate: cancellations, failed renewals, pricing issues |
| Webhook processing failures | Check `fly logs` for webhook errors, verify webhook secret |

---

## Data Sources

**Where:** Internal health probes (operations agent daily report) + `/api/health`

**Metrics:**
- Source availability (up/down)
- Response latency per source
- Circuit breaker status (open/closed)
- Cache hit rate

**Alert thresholds:**
| Condition | Action |
|-----------|--------|
| Any source down > 4 hours | Verify graceful degradation (DD reports should note missing source). Check if source URL changed. |
| Circuit breaker open for 3+ sources | Check for network issues. DD reports will have reduced coverage. |
| Cache hit rate < 30% | Cache may be expiring too aggressively. Check TTL settings. |
| Source latency > 10s consistently | May be rate-limited. Reduce request frequency or add caching. |

---

## User Activity (Beta Analytics)

**Where:** Application analytics dashboard + database queries

**Metrics:**
- Daily active users (DAU)
- Weekly active users (WAU)
- Activation rate (completed onboarding / signups)
- Feature adoption (% users who tried each feature)
- Session duration
- Retention (returning after 7/14/30 days)

**Concern thresholds:**
| Condition | Investigation |
|-----------|---------------|
| DAU drops > 50% week-over-week | Check for bugs, broken flows, or external events |
| Activation rate < 30% | Onboarding needs improvement — too complex or unclear |
| Feature adoption < 10% for a core feature | Feature may be hard to find, confusing, or not valuable |
| 7-day retention < 40% | Product isn't sticky enough — prioritize user interviews |

---

## Daily Monitoring Routine (5 minutes)

1. `fly status` — machines healthy?
2. Check Sentry — any new errors?
3. Check Stripe Dashboard — payments processing?
4. Glance at operations agent daily digest (arrives via email)
5. Check DAU count — still growing?

If everything's green, move on. If anything's yellow, investigate before it turns red.
