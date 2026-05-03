# Runbook 06 — Stripe webhook replay

**Severity:** P1 — Revenue + state drift
**Owner:** Founder / engineering
**Time to first response:** 1 hour

---

## Symptom
- Stripe dashboard shows webhook deliveries failing (red Xs in Developers → Webhooks → Recent deliveries)
- Subscription / invoice state in our DB is out of sync with Stripe
- Customers report "I paid but my account still says past_due"
- We deployed during a webhook burst window and dropped events

---

## Diagnose
1. Stripe dashboard → **Developers → Webhooks → [our endpoint]** → Recent deliveries.
2. Filter on **Failed** in the last 24h. Note the time range, count, and event types (`invoice.payment_succeeded`, `customer.subscription.updated`, etc).
3. Confirm endpoint is healthy now:
   ```bash
   curl -I https://acreos.fly.dev/api/stripe/webhook
   # Expected: 405 Method Not Allowed (POST-only — but server is up)
   ```
4. Pull our app logs for the same window:
   ```bash
   fly logs -a acreos | grep -i "stripe\|webhook" | tail -200
   ```
   Look for signature-verification errors (`Invalid signature`), 5xx responses, deploy boundaries.
5. Cross-reference: do we have rows in `webhook_events_log` for the failed event IDs? If the row exists with `processed=false`, the event reached us but processing failed — that's different from a delivery failure.

---

## Fix
### Option A — Stripe-driven replay (preferred)
1. In Stripe Dashboard, on each failed delivery, click **… → Resend**.
2. For bulk replay, use Stripe CLI:
   ```bash
   stripe events list --created.gte=$(date -d '24 hours ago' +%s) --limit 100
   stripe events resend evt_XXX
   ```
3. Watch our logs — each resent event should produce a `webhook.received` log line and a 200 response.

### Option B — DB-driven re-process (when delivery succeeded but processing failed)
1. Query the `webhook_events_log` for unprocessed rows in the window.
2. Run the re-processor: `npm run script -- reprocess-webhooks --since='2026-05-03 00:00'`. This re-runs handlers idempotently (each handler must be idempotent; see `server/webhookHandlers.ts`).
3. Confirm rows now have `processed=true` and `processing_error` is null.

### Option C — State reconciliation (last resort, large drift)
1. For affected orgs, run `npm run script -- stripe-reconcile --org=X`. This pulls the org's current Stripe state and forces our DB to match.
2. Audit the diff before running.

---

## Verify
- All previously-failed deliveries show ✓ in Stripe.
- `SELECT COUNT(*) FROM webhook_events_log WHERE processed=false AND created_at > NOW() - INTERVAL '48 hours'` returns 0.
- Affected orgs' subscription status matches Stripe Dashboard.
- No new webhook signature errors in the next 30 min.

---

## Escalate if
- Replay produces signature errors → our `STRIPE_WEBHOOK_SECRET` may have rotated; check fly secrets and redeploy.
- Reconciliation finds an org where we collected money but never provisioned access → this is a refund-or-grant decision; founder must approve, do not auto-resolve.
- Volume of unprocessed events > 1000 → pause new webhook ingestion (Stripe dashboard → Disable endpoint) before replay so the queue doesn't keep growing during repair.
