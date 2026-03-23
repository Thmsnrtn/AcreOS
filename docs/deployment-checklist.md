# AcreOS Deployment Checklist

## Pre-Deployment

- [ ] All secrets set in Fly.io (see `fly-secrets.example` for the full list)
  - [ ] `DATABASE_URL` — Fly Postgres or external provider
  - [ ] `SESSION_SECRET` — minimum 32 chars, 64+ recommended
  - [ ] `REDIS_URL` — Fly Redis or Upstash
  - [ ] `FIELD_ENCRYPTION_KEY` — 64 hex chars (AES-256)
  - [ ] `APP_URL` — public URL, no trailing slash
  - [ ] `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
  - [ ] `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_SES_FROM_EMAIL`
  - [ ] `FOUNDER_EMAIL`
- [ ] Database migration tested locally: `npm run db:push` or `npx drizzle-kit push`
- [ ] Stripe webhooks configured in Stripe Dashboard pointing to `${APP_URL}/api/stripe/webhook`
- [ ] AWS SES sender address (`AWS_SES_FROM_EMAIL`) verified in the SES console
- [ ] SES is out of sandbox mode (or recipient addresses are verified for testing)
- [ ] DNS configured for custom domain (if not using `*.fly.dev`)
- [ ] CI pipeline is green (lint, type-check, unit tests, integration tests)

## Deploy to Fly.io

```bash
# First deploy (creates the app):
fly launch --no-deploy
fly secrets set $(cat .env.production | xargs)
fly deploy

# Subsequent deploys:
fly deploy

# Deploy a specific image:
fly deploy --image registry.fly.io/acreos:<tag>
```

## Post-Deploy Smoke Test

Run these checks immediately after deployment:

1. **Health check:** `curl https://<app-url>/api/health` — verify all services report healthy
2. **Auth flow:** Sign in with a test account, confirm session persists
3. **Dashboard load:** Navigate to `/dashboard` and confirm data renders
4. **Stripe webhook:** Trigger a test event from Stripe Dashboard, check server logs for successful processing
5. **Email delivery:** Trigger a test email (e.g., invite a team member) and confirm receipt
6. **WebSocket:** Open two browser tabs, confirm real-time updates propagate
7. **AI features:** Send a test prompt through Pax, verify response
8. **CSP headers:** Check response headers include `Content-Security-Policy` with nonce

```bash
# Quick health check from CLI
curl -s https://<app-url>/api/health | jq .

# Check deployment status
fly status
fly logs --no-tail
```

## Rollback Procedure

If issues are detected after deployment:

```bash
# Option 1: Roll back to the previous release
fly releases rollback

# Option 2: Deploy a known-good image
fly deploy --image registry.fly.io/acreos:<previous-tag>

# Option 3: Roll back to a specific release number
fly releases rollback <release-number>

# View release history to find a good version
fly releases
```

### Database Rollback

If a migration introduced a breaking schema change, revert it before rolling back the app:

```bash
# Connect to the production database
fly postgres connect -a <pg-app-name>

# Run the appropriate rollback SQL (keep rollback scripts in ./migrations/)
```

**Important:** Always verify the rollback was successful by running the post-deploy smoke tests again.

## Zero-Downtime Deploys

Fly.io with `min_machines_running = 2` performs rolling deploys by default — one machine updates while the other continues serving traffic.

### Deploy Command

```bash
# Standard rolling deploy (zero-downtime):
fly deploy --strategy rolling

# Verify both machines are healthy after deploy:
fly status
fly machines list
```

### How It Works

1. Fly.io starts a new machine with the updated image
2. The new machine passes health checks (`/api/health`)
3. Traffic shifts to the new machine
4. The old machine is drained and stopped
5. Repeat for the second machine

### Rollback Procedure

```bash
# View recent releases:
fly releases

# Roll back to the previous release:
fly releases rollback

# Deploy a specific known-good image:
fly deploy --image <previous-image-ref>
```

### Post-Deploy Verification Checklist

- [ ] `curl https://<app-url>/api/health` returns 200 with all services healthy
- [ ] Auth flow works (login/register)
- [ ] Lead creation works (POST /api/leads)
- [ ] Stripe webhook endpoint responds (POST /api/stripe/webhook returns 400 for unsigned, not 404)
- [ ] Both machines show "started" in `fly status`

### Configuration (fly.toml)

Ensure these settings in `fly.toml` for zero-downtime:

```toml
[deploy]
  strategy = "rolling"

[[services]]
  min_machines_running = 2
```

---

## Monitoring

- **Logs:** `fly logs` or configure a log drain (`fly logs export`)
- **Metrics:** `GET /api/metrics` (requires `METRICS_TOKEN` Bearer auth)
- **Sentry:** Check the Sentry dashboard for new errors after deploy
- **Uptime:** Fly.io built-in health checks hit `/api/health` automatically
