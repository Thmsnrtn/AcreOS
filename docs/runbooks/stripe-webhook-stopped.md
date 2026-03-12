# Runbook: Stripe Webhook Stopped Delivering

**Severity:** P1 — Revenue Impact
**Task Reference:** #321

---

## Symptoms
- Subscriptions not updating after payment
- `dunningEvents` table not recording new failures
- Grafana: Stripe webhook delivery failures alert fires
- Customers reporting their subscription shows wrong status

---

## Immediate Diagnosis (first 10 minutes)

### 1. Check Stripe Dashboard
1. Log in to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Navigate to **Developers → Webhooks**
3. Select the production endpoint: `https://acreos.fly.dev/api/stripe/webhook`
4. Check **Recent Deliveries** — look for failed events (red X)

### 2. Verify the endpoint is responding
```bash
curl -I https://acreos.fly.dev/api/stripe/webhook
# Expected: 405 Method Not Allowed (GET not allowed, but means server is up)
```

### 3. Check app logs for webhook errors
```bash
fly logs -a acreos | grep -i "stripe\|webhook" | tail -50
```

---

## Replay Missed Events

### Using Stripe CLI (requires Stripe CLI installed)
```bash
# Install: https://stripe.com/docs/stripe-cli

# List failed events in the last 24 hours
stripe events list --limit 20

# Replay a specific event
stripe events resend evt_XXXXXXXXXXXX

# Replay all failed events in a time window
stripe events list --created[gte]=$(date -d '24 hours ago' +%s) | \
  jq -r '.data[].id' | \
  while read id; do stripe events resend $id; sleep 0.5; done
```

### Using Stripe Dashboard
1. Webhooks → Select endpoint → Recent deliveries
2. Click each failed event → **Resend**

---

## Common Causes and Fixes

| Cause | Fix |
|---|---|
| `STRIPE_WEBHOOK_SECRET` changed | Update secret in Fly.io secrets: `fly secrets set STRIPE_WEBHOOK_SECRET=whsec_...` |
| New Stripe webhook endpoint created | Update `APP_URL` and re-register endpoint in Stripe Dashboard |
| App restarted and request body was corrupted | Ensure `express.raw()` is used before `express.json()` for `/api/stripe/webhook` |
| Fly.io health check failing → no traffic routed | Fix app health issue first |
| Rate limit hit on `/api/stripe/webhook` | Ensure `/api/stripe/webhook` is excluded from rate limiting |

---

## Verify Webhook Signature Validation
```bash
# In app logs, look for:
# "Webhook signature verification failed" → wrong secret
# "Webhook error: No signatures found" → stripe-signature header missing
```

---

## Reconciliation After Outage

After webhooks are flowing again, reconcile subscription states:
```bash
# From Stripe CLI — sync active subscriptions
stripe subscriptions list --status=active | jq '.data[].id'

# Or trigger manual sync in admin panel:
# Admin → Organizations → Sync Stripe Status
```

---

## Escalation
- If payment data is out of sync for >1 hour: P1 incident
- Notify finance team
- Consider manual subscription status updates for affected customers
