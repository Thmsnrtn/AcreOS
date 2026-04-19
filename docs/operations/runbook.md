# AcreOS Operations Runbook

Last updated: 2026-04-19
Author: v7 launch hardening

---

## 1. Site Is Down

**Detection:** UptimeRobot/BetterStack alert, or user reports.

**Diagnosis:**
```bash
fly status -a acreos
fly logs -a acreos --no-tail | tail -50
curl -s https://acreos.fly.dev/api/health
```

**Mitigation:**
```bash
# Restart machines
fly machines restart -a acreos

# If restart doesn't help, rollback to last known good deploy
fly releases -a acreos
fly deploy --image registry.fly.io/acreos:deployment-<PREV_VERSION> -a acreos
```

**Communication:** Post to status page or email users: "We're experiencing downtime and working on a fix. Your data is safe."

---

## 2. AI Provider Outage (OpenRouter Down)

**Detection:** Health check shows `openai: unavailable`. Users report AI features not working.

**Diagnosis:**
```bash
curl -s https://acreos.fly.dev/api/health | jq '.services[] | select(.name=="openai")'
```

**Mitigation:**
- The product degrades gracefully — AI features show error toasts, don't crash
- If extended outage: check OpenRouter status page
- Fallback: set `AI_INTEGRATIONS_OPENAI_API_KEY` with a direct OpenAI key as temporary backup
```bash
fly secrets set AI_INTEGRATIONS_OPENAI_API_KEY=sk-... -a acreos
```

**Recovery:** OpenRouter restores → AI features auto-recover (no deploy needed).

---

## 3. Database Connectivity Lost

**Detection:** Health check shows `database: unhealthy`. 500 errors on all API calls.

**Diagnosis:**
```bash
fly logs -a acreos --no-tail | grep -i "database\|connection\|pool"
# Check if Fly Postgres is up
fly status -a acreos-db  # if using Fly Postgres
```

**Mitigation:**
- Check Fly Postgres status
- If pool exhaustion: restart app machines (`fly machines restart`)
- If Postgres is down: wait for Fly recovery or restore from backup

**Recovery:** DB reconnects automatically via pool retry.

---

## 4. Stripe Webhook Failures

**Detection:** Subscriptions not activating, Stripe dashboard shows webhook delivery failures.

**Diagnosis:**
```bash
# Check Stripe dashboard → Developers → Webhooks → Recent deliveries
fly logs -a acreos --no-tail | grep -i "stripe\|webhook"
```

**Mitigation:**
- Verify webhook endpoint URL in Stripe dashboard: `https://acreos.fly.dev/api/stripe/webhook`
- Verify `STRIPE_WEBHOOK_SECRET` matches the Stripe dashboard's signing secret
- Replay failed webhooks from Stripe dashboard

**Prevention:** The `stripe_processed_events` table prevents duplicate processing on replay.

---

## 5. Feedback Backlog

**Detection:** Periodic check of feedback_submissions table.

**Review:**
```sql
SELECT id, user_email, category, message, created_at
FROM feedback_submissions
WHERE status = 'new'
ORDER BY created_at DESC;
```

**Response cadence:** Review daily for first month, weekly after.

---

## 6. Runaway AI Costs

**Detection:** OpenRouter dashboard shows unexpected spend.

**Mitigation:**
```bash
# Set a daily budget ceiling
fly secrets set AI_DAILY_BUDGET_CENTS=5000 -a acreos

# Kill AI access for a specific user (disable their org's AI)
# → Use founder dashboard or direct DB update
```

**Prevention:** The autonomous executor has a 10-iteration tool loop cap and $500 financial commitment hard stop.

---

## 7. Security Incident

**Detection:** Suspicious activity in logs, credential leak notification.

**Immediate actions:**
```bash
# Rotate all secrets
fly secrets set AI_INTEGRATIONS_OPENROUTER_API_KEY=<new> -a acreos
fly secrets set STRIPE_SECRET_KEY=<new> -a acreos
fly secrets set STRIPE_WEBHOOK_SECRET=<new> -a acreos

# Invalidate all user sessions (via Clerk dashboard)
# → clerk.com → Sessions → Revoke all
```

**Post-incident:** Document in `/docs/incidents/<date>.md`. Update this runbook.

---

## Key URLs

| Service | URL |
|---------|-----|
| Production | https://acreos.fly.dev |
| Health check | https://acreos.fly.dev/api/health |
| Fly dashboard | https://fly.io/apps/acreos |
| Clerk dashboard | https://dashboard.clerk.com |
| Stripe dashboard | https://dashboard.stripe.com |
| OpenRouter dashboard | https://openrouter.ai/keys |

## Key Fly Commands

```bash
fly status -a acreos          # Machine status
fly logs -a acreos             # Live logs
fly logs -a acreos --no-tail   # Recent logs
fly secrets list -a acreos     # List secrets (names only)
fly machines restart -a acreos # Restart all machines
fly releases -a acreos         # Deployment history
fly deploy -a acreos           # Deploy from current directory
```
