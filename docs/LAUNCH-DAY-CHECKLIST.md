# AcreOS Launch Day Pre-Flight Checklist

**Reference:** Launch Day Execution — 25 tasks
**Owner:** Engineering Lead + Founder
**Estimated Duration:** 3–4 hours day-of

---

## 24 Hours Before Launch

### Secrets Rotation (Task #1)
```bash
# Rotate all API keys before launch — fresh credentials only
fly secrets set \
  SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")" \
  FIELD_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  -a acreos
```
- [ ] OpenAI API key rotated
- [ ] Stripe secret key rotated (use live key, not test)
- [ ] Twilio credentials confirmed (production account)
- [ ] SESSION_SECRET rotated (≥64 chars)
- [ ] FIELD_ENCRYPTION_KEY rotated (64 hex chars)

---

## Day-of: Pre-Launch Verification

### Security & Dependencies (Tasks #2–#3)
```bash
npm audit --audit-level=high   # Task #2: zero critical/high vulns
```
- [ ] `npm audit` — zero critical or high vulnerabilities
- [ ] Docker image Trivy scan — zero critical CVEs
  ```bash
  trivy image acreos:latest --severity CRITICAL
  ```

### E2E Suite on Production (Task #4)
- [ ] Run E2E test suite against **production** (not staging)
  ```bash
  BASE_URL=https://acreos.fly.dev npm run test:e2e
  ```

### Route Registration (Task #5)
- [ ] Verify all 97 route files are registered in `server/routes.ts`
  ```bash
  ls server/routes-*.ts | wc -l
  grep "import.*router\|registerRoutes\|Router" server/routes.ts | wc -l
  ```

### Stripe Configuration (Task #6)
- [ ] `STRIPE_SECRET_KEY` starts with `sk_live_` (not `sk_test_`)
  ```bash
  fly secrets list -a acreos | grep STRIPE_SECRET_KEY
  # Verify it does NOT start with sk_test_
  ```
- [ ] `STRIPE_WEBHOOK_SECRET` is set and matches Stripe Dashboard
- [ ] Test payment on production with a real card

### Twilio (Task #7)
- [ ] Twilio account has sufficient credits (> $50)
- [ ] Production phone numbers purchased and active
- [ ] Test SMS send to verify delivery
  ```bash
  curl -X POST https://acreos.fly.dev/api/communications/test-sms \
    -H "Content-Type: application/json" \
    -d '{"to": "+1XXXXXXXXXX", "message": "Launch day test"}'
  ```

### Email (Task #8)
- [ ] SendGrid/SES sending domain is **verified** (not sandbox)
- [ ] SPF, DKIM, DMARC records configured
- [ ] Send test welcome email:
  ```bash
  curl -X POST https://acreos.fly.dev/api/auth/test-email \
    -H "Content-Type: application/json" \
    -d '{"to": "test@yourdomain.com"}'
  ```

### Monitoring (Tasks #9–#10)
- [ ] Sentry receiving events from production:
  ```bash
  # Trigger a test error and verify it appears in Sentry within 60 seconds
  curl https://acreos.fly.dev/api/debug/test-sentry
  ```
- [ ] Grafana dashboards green on production metrics
- [ ] All Grafana alert rules enabled

### TLS / Domain (Task #11)
- [ ] Custom domain SSL certificate is valid
  ```bash
  echo | openssl s_client -connect acreos.fly.dev:443 2>/dev/null | openssl x509 -noout -dates
  # Not expiring within 30 days
  ```
- [ ] HTTP → HTTPS redirect working
  ```bash
  curl -I http://acreos.fly.dev/
  # Expected: 301 Location: https://acreos.fly.dev/
  ```

### Core User Journey (Task #12)
Manually verify on production:
- [ ] User can log in
- [ ] User can create a deal
- [ ] Property valuation returns a result
- [ ] Marketplace listing can be created

### Real Payment (Task #13)
- [ ] Process a $1.00 test charge on Stripe live mode
- [ ] Verify charge appears in Stripe Dashboard
- [ ] Verify subscription record created in DB
- [ ] Refund the test charge

### Infrastructure (Tasks #15–#21)
- [ ] Backup ran successfully this morning:
  ```bash
  # Check Fly.io postgres backups
  fly postgres backups list -a acreos-db
  ```
- [ ] All team members have access to monitoring dashboards
- [ ] On-call rotation is active in PagerDuty
- [ ] War room Slack channel created: `#launch-YYYY-MM-DD`
- [ ] Rollback command ready (copy this to Slack):
  ```bash
  # ROLLBACK: run this to revert to previous release
  fly releases -a acreos && fly deploy --image <previous-image> -a acreos
  ```

### Rate Limiting & NODE_ENV (Tasks #20–#21)
- [ ] Rate limits set to **production levels** (not relaxed dev settings)
- [ ] `NODE_ENV=production` on all running instances:
  ```bash
  fly ssh console -a acreos -- printenv NODE_ENV
  # Expected: production
  ```

---

## Launch Sequence

1. **T-30 min:** Final health check — all green
2. **T-15 min:** Enable new user signups (if feature-flagged)
3. **T-0:** Announce launch
4. **T+0:** Monitor first 100 signups in real-time
5. **T+60 min:** 1-hour post-launch review:
   - Error rate (target: <0.1%)
   - Conversion rate (signups completing onboarding)
   - P95 latency (target: <200ms)
   - Queue depth (target: trending to 0)
   - AI API spend (on track with budget?)

---

## Rollback Decision Tree

```
Error rate > 5% for 5+ minutes?
  YES → Immediate rollback
  NO  → Continue monitoring

P95 latency > 3s for 5+ minutes?
  YES → Investigate DB/Redis, consider rollback
  NO  → Continue monitoring

Database connection errors?
  YES → Check connection pool, consider rollback
  NO  → Continue monitoring
```

---

## Post-Launch Tasks (first 72 hours)

- [ ] Set up Sentry alert rules (error rate >1%, new error types)
- [ ] Configure Grafana alerts for P95, error rate, queue depth
- [ ] Run EXPLAIN ANALYZE on top 20 queries
- [ ] Verify log aggregation is working
- [ ] Schedule 30-day retrospective
