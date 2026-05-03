# Runbook 04 — Skip-trace credits at zero

**Severity:** P2 — Customer feature blocked
**Owner:** Founder / ops
**Time to first response:** 30 min during business hours

---

## Symptom
- Customer's skip-trace lookup returns `429 LIMIT_EXCEEDED` with `details.creditsRemaining = 0`
- Bulk skip-trace job halts mid-run
- /skip-tracing UI shows "0 credits remaining" banner
- Customer email: "skip trace stopped working"

---

## Diagnose
1. Check the org's credit balance in DB:
   ```sql
   SELECT skip_trace_credits, skip_trace_credits_purchased, skip_trace_credits_used
   FROM organizations WHERE id = X;
   ```
2. Check tier — Pro tier includes 100/mo, Premium 500/mo, Enterprise unlimited.
3. Check provider health: open /founder/integrations → skip-trace providers. Confirm at least one provider is `up` (not in circuit-breaker open state).
4. Provider failover order is registry-driven (`server/services/providers/`). Note which provider was used last and its current circuit-breaker state.

---

## Fix
- **Customer is on Pro/Premium and hit monthly cap** → Offer a credit pack purchase (`/billing/credits`) or upsell to next tier. Do NOT silently top them up — track the conversation.
- **Customer should have credits per tier but counter is wrong** → Run reconciliation:
  ```sql
  -- Reset to monthly entitlement minus actual used in current period
  UPDATE organizations SET skip_trace_credits = (tier_monthly_credits - actual_used)
  WHERE id = X;
  ```
  Verify `audit_events` shows the manual adjustment with operator ID.
- **Primary provider is down** → registry should auto-failover. If circuit breaker hasn't tripped (3 fails / 5 min), force it: `POST /api/admin/providers/:name/circuit-open` (founder-only). Lookups will route to the next priority provider.
- **All providers down** → set a banner on /skip-tracing ("temporary outage, retry later"), pause bulk jobs, page the on-call.

---

## Verify
- Customer can run a single lookup and gets a result (or `not found` — both are healthy).
- `skip_trace_credits` decremented by exactly 1 after a successful paid lookup.
- `provider_cache` shows the lookup if it was cacheable.
- No new errors in `fly logs -a acreos | grep skip-trace` for 5 min.

---

## Escalate if
- Two or more vendors down at once → see vendor status tile, may need to pause skip-trace platform-wide and notify customers via /status.
- Credit counter goes negative after fix → stop manual adjustments, escalate to engineering — there's a race we're masking.
- Customer claims they were charged for failed lookups → audit `provider_lookups` table for that org; refund any rows with `success=false` and `paid=true` (these should never coexist).
