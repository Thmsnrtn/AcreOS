# AcreOS Operations Runbook

## Quick Reference

| Service | Health Check | Restart Command |
|---------|-------------|----------------|
| Web Server | `GET /api/health` | `npm run dev` (dev) / restart container (prod) |
| Database | `GET /api/admin/health` | Check `DATABASE_URL` env var |
| Stripe | `GET /api/admin/health` | Check `STRIPE_SECRET_KEY` |
| Email (SES) | `GET /api/admin/health` | Check AWS credentials in org integrations |
| Data Sources | `GET /api/admin/data-sources/health` | Automatic retry on next probe |

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session encryption key |

### Optional (feature-dependent)

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API key for billing |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `OPENAI_API_KEY` | OpenAI API key for AI features |
| `ANTHROPIC_API_KEY` | Claude API key for AI features |
| `AWS_ACCESS_KEY_ID` | Platform-level SES credentials |
| `AWS_SECRET_ACCESS_KEY` | Platform-level SES credentials |
| `AWS_REGION` | SES region (default: us-east-1) |
| `TWILIO_ACCOUNT_SID` | Twilio for SMS/voice |
| `TWILIO_AUTH_TOKEN` | Twilio authentication |
| `LOB_API_KEY` | Lob.com direct mail API |
| `FOUNDER_EMAILS` | Comma-separated founder email addresses |

---

## Common Operations

### 1. Database Migrations

```bash
npm run db:push          # Push schema changes (dev)
npm run db:generate      # Generate migration files
npm run db:migrate       # Run pending migrations (prod)
```

### 2. Seed Stripe Products

```bash
npx tsx server/seed-products.ts
```

Creates Starter ($20/mo) and Pro ($49/mo) subscription products in Stripe.

### 3. Trial Management

Trials are 14 days. Expired trials are automatically downgraded to Free by the Operations Agent (runs every 15 minutes). Manual expiry:

```
POST /api/trial/expire-check   (founder-only)
```

### 4. Agent Management

The system runs 5 autonomous agents:
- **customer_success** — onboarding followups, milestone detection
- **growth** — daily growth reports, upgrade journey tracking
- **revenue** — usage limit warnings, payment failure tracking
- **operations** — data source health, API monitoring, trial expiry
- **digest** — daily founder digest aggregating all agent activity

Toggle agents via the founder UI at `/founder/agents` or API:
```
POST /api/admin/agents/:name/toggle
```

### 5. Data Source Health

18 open data sources are probed automatically. View health:
```
GET /api/admin/data-sources/health
```

Run manual verification:
```bash
npx tsx scripts/verify-data-sources.ts
```

---

## Incident Response

### Payment Processing Failure

1. Check Stripe dashboard for webhook delivery status
2. Verify `STRIPE_WEBHOOK_SECRET` matches the Stripe dashboard
3. Check `/api/admin/health` for Stripe connectivity
4. Review webhook handler logs for error patterns
5. Webhook events are idempotent — Stripe will retry automatically

### Email Delivery Issues

1. Check SES sending quota: `GET /api/admin/health`
2. Verify sender email is SES-verified
3. Check organization integration credentials
4. Review email logs in the admin panel
5. Email service has built-in retry with exponential backoff (3 attempts)

### Data Source Outage

1. Check `GET /api/admin/data-sources/health` for failing sources
2. Most sources are federal APIs — outages are temporary
3. The enrichment pipeline gracefully degrades (skips unavailable sources)
4. No user action required — monitoring is automatic

### High CPU / Memory

1. Check CSV import size (limited to 10 MB / 50K rows)
2. Check sequence processor queue depth
3. Review agent run frequency (operations: 15m, others: 1h)
4. Kill runaway processes: agents auto-restart on next interval

---

## Monitoring

### Health Endpoints

- `GET /api/health` — basic liveness check
- `GET /api/admin/health` — comprehensive service health
- `GET /api/admin/agents/status` — all agent statuses
- `GET /api/admin/beta-analytics` — user activation metrics
- `GET /api/admin/feedback` — user feedback entries

### Logs

All services log in structured JSON format:
```json
{"level":"INFO","timestamp":"...","message":"..."}
```

Key log prefixes:
- `[sequence-processor]` — email sequence execution
- `[EmailService]` — email delivery
- `[operations]` — data source and service monitoring
- `[webhook]` — Stripe webhook processing
- `[feedbackProcessor]` — feedback categorization

---

## Backup & Recovery

### Database

- Use `pg_dump` for regular backups
- Point-in-time recovery via your hosting provider's snapshot feature
- Schema is defined in `shared/schema.ts` — can be recreated with `db:push`

### Stripe

- All payment state is authoritative in Stripe
- Local records are synced via webhooks
- Re-sync by replaying webhook events from Stripe dashboard
