# AcreOS Deployment Runbook

## Overview
Zero-downtime deployment for AcreOS on Fly.io with PostgreSQL and Redis.

## Prerequisites
- Fly.io CLI installed and authenticated (`flyctl auth login`)
- Access to production secrets in Fly.io vault
- GitHub Actions or local deployment environment

## Pre-Deployment Checklist
- [ ] All tests passing (`npm test`)
- [ ] TypeScript check passes (`npm run check`)
- [ ] Database migrations reviewed and tested locally
- [ ] `.env` secrets verified in Fly.io vault
- [ ] No breaking API changes without versioning
- [ ] Changelog updated

## Deploy Steps

### 1. Build
```bash
npm run build
```

### 2. Run Database Migrations
```bash
# Verify migrations locally first
npm run db:generate
npm run db:push

# Or against staging DB
DATABASE_URL=$STAGING_DATABASE_URL npm run db:push
```

### 3. Deploy to Fly.io
```bash
flyctl deploy --strategy=rolling --wait-timeout=120
```
The rolling strategy ensures at least 1 instance stays up during deploy.

### 4. Health Check
```bash
flyctl status
curl https://your-app.fly.dev/api/health
```
Expect `{"status":"ok"}` with HTTP 200.

### 5. Monitor Post-Deploy (15 minutes)
- Watch error rate in Fly metrics: `flyctl logs`
- Check Prometheus metrics endpoint: `/metrics`
- Verify Redis connectivity in `/api/health`

## Rollback Procedure

### Option 1: Rollback to Previous Image (Fast)
```bash
flyctl releases list
flyctl deploy --image <previous-image-tag>
```

### Option 2: Code Rollback
```bash
git revert HEAD
git push origin main
# CI/CD will auto-deploy
```

### Option 3: Emergency (if DB migration caused issue)
```bash
# Revert migration manually — requires DBA access
psql $DATABASE_URL -c "BEGIN; -- undo migration SQL; COMMIT;"
```

## Post-Deployment Verification
1. Login to app as test user — confirm auth works
2. Create a test lead — confirm DB writes work
3. Run a test AVM valuation — confirm AI routes work
4. Check `/api/health` returns all services green
5. Monitor error rate stays < 0.5% for 15 minutes

## Environment Secrets
All secrets stored in Fly.io vault. To update:
```bash
flyctl secrets set KEY=VALUE
```

Key secrets required:
- `DATABASE_URL` — PostgreSQL connection
- `REDIS_URL` — Redis connection
- `SESSION_SECRET` — Express session secret (min 32 chars)
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — AI providers
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Payments
- `TWILIO_AUTH_TOKEN` / `TWILIO_ACCOUNT_SID` — Voice
