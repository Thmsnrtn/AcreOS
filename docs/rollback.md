# AcreOS Deployment Rollback Procedure

**Task Reference:** #165

This document covers how to roll back a production deployment on Fly.io. Use this runbook when a deploy introduces regressions, errors, or instability.

---

## When to Roll Back

Roll back immediately if any of the following occur within 15 minutes of a deploy:

- Error rate rises above 1% (check Sentry or Fly.io metrics)
- `/api/health/cached` returns non-200 or `status: unhealthy`
- Database migration caused data corruption or query failures
- P95 response time exceeds 3 seconds (up from baseline ~300ms)
- Customer-facing features (auth, payments, valuations) are broken

---

## Rollback Option 1: Revert to Previous Image (Fastest — ~2 min)

This is the preferred method. It reverts the running container without touching the database.

```bash
# 1. List recent releases to find the last known-good image
fly releases -a acreos

# Output example:
# VERSION  STATUS   DESCRIPTION         USER                  DATE
# v42      complete Deployed            deploy@acreos.com     2025-01-15T10:30:00Z
# v41      complete Deployed            deploy@acreos.com     2025-01-15T09:00:00Z  ← target

# 2. Redeploy the previous image SHA
fly deploy --image registry.fly.io/acreos:<previous-image-sha> -a acreos

# Or using the release version number
fly deploy --image registry.fly.io/acreos:deployment-<version> -a acreos
```

### Get the exact image reference
```bash
# Show the image used in a specific release
fly releases --json -a acreos | jq '.[1]'
# Look for "ImageRef" field — that is the image to pass to fly deploy --image
```

---

## Rollback Option 2: Git Revert + Redeploy (~5–10 min)

Use when the image tag is not available or you need to apply a quick fix.

```bash
# 1. Revert the last commit
git revert HEAD --no-edit

# 2. Push — CI/CD will deploy automatically
git push origin main

# 3. Monitor the new deploy
fly logs -a acreos -f
```

---

## Rollback Option 3: Database Migration Rollback (Advanced)

Use only if the code rollback alone is insufficient due to a migration that altered schema.

> **Warning:** This requires a DBA-level understanding of the migration. Do not run blind.

```bash
# 1. SSH into production
fly ssh console -a acreos

# 2. Connect to the database
psql $DATABASE_URL

# 3. Identify what the migration did
-- Check the drizzle migrations table
SELECT * FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 5;

# 4. Manually undo the migration (example: drop a column added by mistake)
BEGIN;
ALTER TABLE properties DROP COLUMN IF EXISTS new_column;
-- undo any other DDL changes...
COMMIT;

# 5. Remove the migration record so drizzle doesn't skip it on next deploy
DELETE FROM __drizzle_migrations WHERE hash = '<migration-hash>';
```

After the database is restored:
```bash
# Redeploy the previous code image
fly deploy --image registry.fly.io/acreos:<previous-image-sha> -a acreos
```

---

## Post-Rollback Health Check Verification

Run these checks immediately after rollback:

```bash
# 1. Confirm all machines are running
fly status -a acreos
# Expect: 2 machines in "started" state

# 2. Check health endpoint
curl -s https://acreos.fly.dev/api/health/cached | jq .
# Expect: { "status": "healthy", "db": "ok", "redis": "ok" }

# 3. Verify error rate
fly logs -a acreos -f | grep -E "(ERROR|500|502|503)"
# Expect: no new errors after rollback

# 4. Smoke test critical paths
# - Login to app as test user — auth works
# - Create a test lead — DB writes work
# - Request an AVM valuation — AI routes work
# - Confirm Stripe webhook endpoint responds (405 on GET is correct)
curl -I https://acreos.fly.dev/api/stripe/webhook
```

---

## Rollback Decision Matrix

| Symptom | Option | Est. Time |
|---|---|---|
| Bad code, no DB changes | Option 1 (image rollback) | ~2 min |
| Bad code + reversible DB migration | Option 1 + Option 3 | ~15 min |
| Hot-fix available and tested | Option 2 (git revert) | ~10 min |
| DB data corruption | Option 3 + disaster recovery | 30–60 min |

For DB data corruption beyond a migration rollback, refer to `docs/disaster-recovery.md` for the full Fly.io Postgres restore procedure.

---

## Preventing the Need to Roll Back

- Run `npm run check` and `npm test` before every deploy
- Deploy to staging first and run the smoke test checklist
- Use `fly deploy --strategy=rolling` (default) — keeps 1 instance live during deploy
- Always test migrations with `drizzle-kit push --dry-run` before applying
- Monitor the 15-minute post-deploy window before declaring a deploy healthy

---

## Contacts

- On-call engineer: PagerDuty
- Fly.io status page: https://status.fly.io
- Internal #incidents Slack channel
