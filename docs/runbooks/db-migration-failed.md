# Runbook: Database Migration Failed Mid-Deploy

**Severity:** P1 — Launch Blocker
**Task Reference:** #320

---

## Symptoms
- Deploy completed but app returns 500 errors on routes that query new columns
- `drizzle-kit push` or `migrate()` logs an error in startup output
- Sentry shows `column "xxx" does not exist` or `relation "xxx" does not exist`

---

## Immediate Actions (first 5 minutes)

### 1. Identify which migration failed
```bash
# Check migration journal
cat migrations/meta/_journal.json | jq '.entries[-3:]'

# SSH into production
fly ssh console -a acreos

# Check current DB schema version
psql $DATABASE_URL -c "SELECT * FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 5;"
```

### 2. Roll back the deployment
```bash
# Roll back to previous machine image
fly releases -a acreos           # list releases
fly deploy --image <previous-image-tag> -a acreos
```

### 3. Verify rollback health
```bash
curl https://acreos.fly.dev/api/health
# Expected: { "status": "healthy" }
```

---

## Root Cause Investigation

### Check which migration step failed
```bash
fly logs -a acreos | grep -E "(migration|db|error)" | tail -50
```

### Common failure modes:
| Symptom | Cause | Fix |
|---|---|---|
| `column "x" already exists` | Migration not idempotent | Add `IF NOT EXISTS` to ALTER TABLE |
| `relation "x" does not exist` | FK references table not yet created | Reorder migration steps |
| `invalid input syntax` | Bad default value in ALTER | Fix default value |
| `deadlock detected` | Long-running transaction + migration | Add `LOCK TABLE` timeout |

---

## Safe Re-Deploy Procedure

1. **Fix the migration file** — ensure it is idempotent (safe to run twice)
2. **Test locally first:**
   ```bash
   npm run db:migrate  # in dev with local DB
   npm run db:migrate  # run again — must succeed without error
   ```
3. **Deploy to staging first** and verify
4. **Deploy to production** with migration confidence

---

## Prevention
- All migrations should use `IF NOT EXISTS` / `IF EXISTS`
- Never drop columns in the same migration that stops using them
- Test migrations by running them twice before merging
- Run `drizzle-kit push --dry-run` before live deployment

---

## Escalation
- On-call engineer: PagerDuty P1 alert
- Database admin: notify for schema-level issues
- Post-mortem required if data loss occurred
