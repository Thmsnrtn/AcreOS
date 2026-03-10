# Runbook: Redis Connection Lost

**Severity:** P2 — Degraded Performance
**Task Reference:** #323

---

## Symptoms
- BullMQ jobs stop processing
- Redis-based rate limiting falls back to in-memory (logs: `[RedisRateLimit] Redis error`)
- Session cache misses increase
- Idempotency middleware falls back to in-memory store
- `/api/health` shows `redis: degraded` or `redis: down`

---

## Immediate Diagnosis

### 1. Check Redis health
```bash
# From a Fly.io console
fly ssh console -a acreos

# Test Redis connectivity
redis-cli -u $REDIS_URL ping
# Expected: PONG

# Check Redis info
redis-cli -u $REDIS_URL info server | head -20
```

### 2. Check app logs
```bash
fly logs -a acreos | grep -i "redis\|bullmq\|queue" | tail -40
```

### 3. Check if Redis is on Fly.io
```bash
fly redis status -a acreos  # if using Fly.io Redis
```

---

## Graceful Degradation Behavior

When Redis is unavailable, AcreOS degrades gracefully:
- **Rate limiting**: Falls back to in-memory per-instance limits (still enforced, but not distributed)
- **Idempotency**: Falls back to in-memory store (loses cross-instance deduplication)
- **Job queue**: BullMQ jobs will queue up and be processed when Redis reconnects
- **Sessions**: Sessions continue to work via PostgreSQL store (not Redis)
- **AI cache**: Responses are computed fresh (no cache hit savings)

**Critical impact**: Idempotency is weakened — avoid processing duplicate financial mutations manually during outage.

---

## Recovery Steps

### If Redis is restarting (temporary):
```bash
# Wait for Redis to come back (usually <2 minutes on managed service)
watch redis-cli -u $REDIS_URL ping

# Jobs will auto-resume — BullMQ is persistent
```

### If Redis needs a restart:
```bash
# Fly.io Redis
fly redis restart <redis-app-name>

# Or self-managed Redis
sudo systemctl restart redis
```

### If REDIS_URL has changed:
```bash
fly secrets set REDIS_URL=redis://new-url:6379 -a acreos
fly deploy -a acreos  # redeploy to pick up new secret
```

---

## Job Recovery After Outage

After Redis is back:
1. BullMQ automatically resumes pending jobs from the last checkpoint
2. Check for duplicate processing (if jobs ran before crash AND after resume):
   ```bash
   # Check duplicate detection in app logs
   fly logs -a acreos | grep "duplicate\|already processed" | tail -20
   ```
3. If duplicates found, check idempotency keys in the DB
4. Manually replay any jobs that were in `active` state when Redis crashed:
   - In BullMQ dashboard (if configured)
   - Or via admin panel: `Admin → Jobs → Retry Failed`

---

## Prevention
- Use Fly.io Redis with high-availability mode (replicated)
- Set Redis `maxmemory-policy: allkeys-lru` (evict old cache, not job data)
- Monitor Redis memory: alert at 80% capacity
- Separate Redis instances for job queue (persistent) vs. cache (ephemeral)

---

## Escalation
- If Redis is down for >30 minutes with active financial jobs: P1
- Financial mutations (payments, bids) must not be retried without idempotency verification
