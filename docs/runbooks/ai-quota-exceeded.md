# Runbook: AI API Quota Exceeded

**Severity:** P2 — Feature Degraded
**Task Reference:** #322

---

## Symptoms
- AI endpoints returning 429 from OpenAI (not our own rate limiter)
- Sentry alerts: `OpenAI quota exceeded` or `RateLimitError`
- Users see "AI temporarily unavailable" messages
- `/api/health` shows `openai: degraded`

---

## Immediate Diagnosis

### 1. Confirm it's OpenAI quota (not our rate limiter)
```bash
fly logs -a acreos | grep -i "openai\|quota\|rate.limit" | tail -30
# OpenAI quota error looks like:
# "You exceeded your current quota, please check your plan and billing details"
# Our rate limiter looks like:
# "AI request limit reached. Please wait a moment."
```

### 2. Check OpenAI usage dashboard
1. Navigate to [platform.openai.com/usage](https://platform.openai.com/usage)
2. Check current month usage vs. limit
3. Check if any single model is hitting a per-minute TPM (tokens per minute) limit

---

## Fallback Behavior

The app is configured to degrade gracefully:
- AI chat endpoints return a user-friendly error message
- Non-AI features continue to work normally
- Health check reports `openai: degraded` (not `unhealthy`)

---

## Immediate Fix Options

### Option 1: Increase OpenAI rate limits (fastest)
1. Log in to platform.openai.com
2. Go to **Settings → Limits**
3. Request a rate limit increase

### Option 2: Switch to backup API key
```bash
# If you have a backup OpenAI key configured:
fly secrets set OPENAI_API_KEY=sk-backup-key-here -a acreos
# App will automatically use new key on next request
```

### Option 3: Enable model routing via OpenRouter (if configured)
```bash
# If AI_INTEGRATIONS_OPENROUTER_API_KEY is set, route through OpenRouter
fly secrets set AI_INTEGRATIONS_OPENAI_BASE_URL=https://openrouter.ai/api/v1 -a acreos
fly secrets set AI_INTEGRATIONS_OPENAI_API_KEY=$OPENROUTER_KEY -a acreos
```

### Option 4: Temporarily reduce AI rate limits
```bash
# In server/index.ts, the AI limiter is:
# max: 60 req/min → reduce to 20 to stay under quota
# Deploy this change as a hotfix
```

---

## Monitoring
After resolving:
1. Watch Grafana: `AI API spend` metric
2. Set up OpenAI usage alert at 80% of monthly budget
3. Review which features are most API-intensive

---

## Prevention
- Configure `SENTRY_TRACES_SAMPLE_RATE=0.01` in production (reduces AI telemetry calls)
- Implement response caching for common AI queries (1-hour TTL)
- Set daily spend alerts in OpenAI dashboard

---

## Escalation
- If AI is down for >2 hours: notify customers via status page
- If month budget exceeded: pause non-critical AI jobs (deal hunter, lead enrichment)
