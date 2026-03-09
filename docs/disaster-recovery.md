# AcreOS Disaster Recovery Plan

## RTO / RPO Targets

| Service Tier | RTO (Recovery Time Objective) | RPO (Recovery Point Objective) |
|---|---|---|
| All services (baseline) | **4 hours** | **1 hour** |
| Critical (auth, payments) | 4 hours | 1 hour |
| Standard (CRM, marketplace) | 4 hours | 1 hour |
| Non-critical (analytics) | 24 hours | 4 hours |

These targets mean:
- The platform must be fully operational within **4 hours** of any declared disaster
- No more than **1 hour** of transaction/lead data may be lost in any recovery scenario

## Backup Strategy
- **Database**: Daily automated snapshots via Fly.io Postgres (**7-day retention**)
- **Object Storage**: Continuous replication of S3 buckets
- **Application Config**: Stored in Fly.io vault (always available)
- **Code**: GitHub repository (permanent history)

## Database Restore Procedure
```bash
# 1. List available backups
flyctl postgres backups list --app acreos-db

# 2. Restore to specific point in time
flyctl postgres restore --app acreos-db --restore-time "2024-01-15T12:00:00Z"

# 3. Verify restore
psql $DATABASE_URL -c "SELECT COUNT(*) FROM organizations;"

# 4. Run any necessary migration patches
DATABASE_URL=$NEW_DB_URL npm run db:push
```

## Incident Response Runbook

### SEV1: Complete Outage
1. **Immediate** (0-15 min): Alert on-call engineer via PagerDuty
2. **Diagnosis** (15-30 min): Check Fly.io status, DB connectivity, Redis
3. **Mitigation** (30-60 min): Rollback to last known good deploy if needed
4. **Resolution** (1-4 hr): Restore from backup if data corruption
5. **Post-mortem** (24-48 hr): Root cause analysis, prevention measures

### SEV2: Degraded Performance
1. Check Prometheus metrics for bottleneck (P95 latency > 2s = alert)
2. Scale app instances: `flyctl scale count 3 --app acreos`
3. Clear Redis cache if memory pressure: `flyctl ssh console -C "redis-cli FLUSHDB"`
4. Identify slow queries via `pg_stat_statements`

### SEV3: Data Integrity Issue
1. Isolate affected records
2. Restore from most recent backup to staging
3. Extract and re-import clean data
4. Communicate to affected users

## Communication Plan
- **Internal**: Slack #incidents channel, PagerDuty escalation
- **External**: Status page update at status.acreos.com within 30 min of SEV1
- **Customer**: Email to affected orgs within 2 hours for data-impacting incidents

## Recovery Testing Schedule
- Monthly: Test database backup restore to staging
- Quarterly: Full disaster recovery drill (restore from scratch)
- Annually: External penetration test + recovery simulation
