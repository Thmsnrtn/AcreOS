# Runbook: Runaway Background Job Consuming Resources

**Severity:** P2 — Performance Degraded
**Task Reference:** #327

---

## Symptoms
- CPU > 90% sustained on one or more Fly.io instances
- Memory usage growing unbounded (heap OOM approaching)
- API response times degrading (p95 > 2s)
- Grafana: queue depth growing instead of shrinking
- Specific job name appearing repeatedly in `job_health_logs` with long durations

---

## Immediate Diagnosis

### 1. Identify the runaway job
```bash
# Check job health logs
fly ssh console -a acreos

# From psql:
# SELECT job_name, COUNT(*) as runs, AVG(duration_ms) as avg_ms, MAX(duration_ms) as max_ms
# FROM job_health_logs
# WHERE run_started_at > NOW() - INTERVAL '1 hour'
# GROUP BY job_name
# ORDER BY avg_ms DESC;

# Check currently stuck "active" jobs:
# SELECT job_name, run_started_at, EXTRACT(EPOCH FROM (NOW() - run_started_at)) as stuck_seconds
# FROM job_health_logs
# WHERE run_completed_at IS NULL
# ORDER BY stuck_seconds DESC;
```

### 2. Check process-level resource usage
```bash
fly ssh console -a acreos

# Check Node.js heap
node -e "
const v8 = require('v8');
const stats = v8.getHeapStatistics();
console.log('Heap used:', Math.round(stats.used_heap_size / 1024 / 1024) + 'MB');
console.log('Heap total:', Math.round(stats.total_heap_size / 1024 / 1024) + 'MB');
"
```

### 3. Check BullMQ queue depth
```bash
# Via app logs
fly logs -a acreos | grep -i "queue\|bullmq\|job" | tail -40

# Or from admin panel: Admin → Jobs → Queue Depth
```

---

## Pause or Kill the Runaway Job

### Option 1: Release the distributed lock (for single stuck job)
```bash
# The job lock is stored in the job_locks table
# Find and delete the lock for the stuck job:
fly ssh console -a acreos
psql $DATABASE_URL -c "
DELETE FROM job_locks
WHERE job_name = 'deal_hunter_scraping'
  AND locked_until < NOW() + INTERVAL '1 hour';
"
```

### Option 2: Pause a BullMQ queue type
```bash
# From app server console — pause the queue to stop new jobs picking up
fly ssh console -a acreos
node -e "
const { Queue } = require('bullmq');
const q = new Queue('deal-hunter', { connection: { url: process.env.REDIS_URL } });
q.pause().then(() => { console.log('Queue paused'); process.exit(0); });
"
```

### Option 3: Graceful restart of one instance
```bash
# This drains connections and restarts cleanly
fly machine list -a acreos
fly machine restart <machine-id> -a acreos
```

### Option 4: Emergency stop (if Options 1-3 are insufficient)
```bash
# Kill specific machine (Fly.io will start a replacement automatically)
fly machine stop <machine-id> -a acreos

# Verify replacement comes up
fly machine list -a acreos
curl https://acreos.fly.dev/api/health/cached
```

---

## Investigation Steps After Stabilizing

1. Review job duration history to find when the runaway started:
   ```sql
   SELECT job_name, run_started_at, duration_ms
   FROM job_health_logs
   WHERE job_name = '<job-name>'
     AND run_started_at > NOW() - INTERVAL '24 hours'
   ORDER BY run_started_at;
   ```

2. Correlate with recent deploys:
   ```bash
   fly releases -a acreos | head -10
   ```

3. Check for external dependency hangs (scraper targets, AI APIs, county assessor endpoints).

---

## Common Runaway Scenarios

### Deal Hunter Scraping
- **Cause:** Hanging HTTP request to external site (no timeout)
- **Fix:** Ensure all scraper fetch calls have AbortController timeout:
  ```typescript
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const resp = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  ```

### County Assessor Ingest
- **Cause:** Processing too many counties in one run (memory)
- **Fix:** Limit batch size per run — process 50 counties max, continue next cycle

### AI Feature Engineering
- **Cause:** LLM call with very large prompt (>100K tokens)
- **Fix:** Implement prompt size limits before sending to OpenAI

### Valuation Model Retrain
- **Cause:** Training on unexpectedly large dataset
- **Fix:** Add dataset size check before training; limit to last 90 days

---

## Prevention
- Every job must use `withJobLock()` (already implemented)
- Every external HTTP call must have a timeout (AbortController or axios timeout)
- Every job should have `statement_timeout` on DB queries
- Set Node.js `--max-old-space-size=1536` to trigger OOM kill before system crash
- Monitor job duration; alert if any job exceeds 10x its normal runtime

---

## Post-Incident
1. Review job logs for root cause
2. Add duration timeout to the specific job
3. Add monitoring alert: `job_duration > 3x p95 baseline`
4. Document in CHANGELOG with mitigation
