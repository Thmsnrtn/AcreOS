# AcreOS Incident Response Procedures

## Severity Classification

| Severity | Definition | Response Time | Examples |
|----------|-----------|---------------|----------|
| **Critical** | App is down or data loss occurring | Immediate | Server crash, database corruption, security breach with data exposure |
| **High** | Core feature broken for all users | Within 2 hours | Payment processing fails, login broken, Deal Feed errors for everyone |
| **Medium** | Feature degraded or broken for some users | Within 8 hours | Slow DD reports, intermittent email delivery, one data source down |
| **Low** | Cosmetic or minor issue | Within 48 hours | UI alignment bug, incorrect label, non-critical feature edge case |

---

## Incident Type: App is Down

### Diagnosis
```bash
# 1. Check Fly.io status
fly status

# 2. Check logs for errors
fly logs

# 3. Check if machines are running
fly machines list

# 4. Check database connectivity
fly postgres connect -a acreos-db
```

### Resolution
```bash
# If deployment issue — roll back to previous release
fly releases                          # find previous good release
fly deploy --image <previous-image>   # deploy known-good version

# If machine crashed — restart
fly machines restart <machine-id>

# If out of memory — scale up
fly scale memory 1024   # increase to 1GB

# If database issue
fly postgres connect -a acreos-db
# Check: SELECT count(*) FROM pg_stat_activity;
# If too many connections: SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '10 minutes';
```

### Communication
- If down > 5 min: post status update internally
- If down > 15 min: email active users — "We're experiencing issues and working on a fix. Your data is safe."
- When resolved: email update — "The issue has been resolved. [Brief explanation of what happened.]"

---

## Incident Type: Data Source Outage

### Diagnosis
1. Check data source health dashboard (operations agent daily report)
2. Identify which sources are affected: `GET /api/health` shows individual source status
3. Check circuit breaker status in server logs

### Resolution
1. **Verify graceful degradation:** DD reports should note missing sources with "Data unavailable from [source]" — not error out entirely
2. **If provider-wide outage (USGS, FEMA down):** No action needed. Circuit breaker handles it automatically. Sources will be retried when they come back.
3. **If persistent (> 24 hours):** Check if the data source URL or API format changed. Government APIs occasionally change without notice.
4. **If URL changed:** Update the provider configuration and deploy

### Communication
- Data source outages are normal and expected. Don't alarm users.
- If a source is down for > 24 hours and affects DD reports: add a banner in the app — "Some data sources are experiencing delays. Reports may be incomplete."

---

## Incident Type: Payment Processing Error

### Diagnosis
1. Check Stripe Dashboard for the specific failure
2. Common causes:
   - **Expired card** — dunning system handles retry automatically
   - **Insufficient funds** — dunning system handles retry
   - **3DS required** — Stripe redirects for authentication
   - **Stripe-wide outage** — check status.stripe.com

### Resolution
1. **Individual payment failure:** The dunning system retries automatically (day 3, day 7, day 14). No manual action needed unless the user contacts support.
2. **Stripe-wide outage:** Wait it out. Stripe's uptime is 99.99%. Check status.stripe.com for updates.
3. **Webhook not processing:**
   ```bash
   fly logs | grep "webhook"    # check for webhook errors
   ```
   Verify webhook secret matches: `fly secrets list | grep STRIPE_WEBHOOK_SECRET`
4. **Subscription not activating after payment:** Check Stripe Dashboard → Customer → Events for the webhook delivery status

### Communication
- Payment failures: don't email the user until the dunning system has tried 3 times
- Stripe outage: only communicate if it affects users for > 1 hour

---

## Incident Type: Security Incident

### Triage
1. **Acknowledge within 24 hours** of report/discovery
2. Assess severity:
   - **Data exposure:** What data? How many users? Still accessible?
   - **Access control bypass:** What was accessed? By whom?
   - **Information disclosure:** What information? Severity of exposure?

### Resolution Timeline
| Severity | Fix & Deploy |
|----------|-------------|
| Critical (data exposure) | Same day |
| High (access control bypass) | Within 48 hours |
| Medium (information disclosure) | Within 1 week |
| Low (theoretical vulnerability) | Next release cycle |

### Response Steps
1. **Contain:** If ongoing, disable the affected feature or endpoint immediately
2. **Fix:** Develop and test the fix
3. **Deploy:** Push the fix to production
4. **Verify:** Confirm the vulnerability is patched
5. **Communicate:** If user data was exposed, notify affected users within 72 hours with:
   - What happened
   - What data was affected
   - What we did to fix it
   - What they should do (change password, etc.)

### Post-Incident
- Write a brief incident report: timeline, root cause, fix, prevention measures
- Add regression test to prevent recurrence
- Review if similar patterns exist elsewhere in the codebase

---

## Incident Type: User Reports Data Loss

### Diagnosis
1. **Check activity log** for the entity:
   ```
   GET /api/activity/:entityType/:entityId
   ```
2. **Check soft-delete state:** Is the record soft-deleted (`deletedAt` is set)? If yes, it can be restored.
3. **Check audit log** for the time period — who did what and when
4. **Check if it's a UI issue** — sometimes data exists but isn't displaying due to a filter or permission issue

### Resolution
1. **Soft-deleted:** Restore the record by clearing `deletedAt`
2. **UI issue:** Fix the display bug, confirm data is intact
3. **Genuinely lost:** Restore from database backup
   ```bash
   # Fly.io automated daily backups
   fly postgres backups list -a acreos-db
   fly postgres backups restore <backup-id> -a acreos-db-restore
   # Then selectively copy the missing data from the restore to production
   ```

### Communication
- Acknowledge the report immediately: "I'm looking into this right now."
- Once resolved: "Your data has been restored. Here's what happened: [explanation]."
- If restoration isn't possible: be honest, explain what happened, and what we're doing to prevent it.

---

## Post-Incident Template

```markdown
## Incident Report: [Title]

**Date:** YYYY-MM-DD
**Severity:** Critical / High / Medium / Low
**Duration:** X hours/minutes
**Affected users:** N

### Timeline
- HH:MM — Issue detected
- HH:MM — Investigation started
- HH:MM — Root cause identified
- HH:MM — Fix deployed
- HH:MM — Confirmed resolved

### Root Cause
[What went wrong and why]

### Resolution
[What was done to fix it]

### Prevention
[What changes will prevent recurrence]
```
