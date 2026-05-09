# Runbook: Twilio Short-Code or 10DLC Carrier Block

**Severity:** P1 — SMS deliverability degraded
**Owner:** Founder / SMS ops
**Time to first response:** 30 min

---

## Symptom
- SMS delivery success rate drops from >95% to <70% or worse
- Twilio console shows messages in `queued` or `failed` state with status "blocked by carrier"
- Error codes in `sms_events`: `Carrier Filtering - Blocked`, `10DLC_UNREGISTERED`
- Customers report SMS codes/notifications not arriving
- No upstream Twilio outage reported on status page

---

## Diagnose
1. Check **Twilio Console → Phone Numbers → <our-shortcode>** — verify number status is `active`, not `suspended` or `flagged`.
2. Verify A2P 10DLC registration is current:
   ```
   Twilio → Phone Numbers → A2P 10DLC → Brand Registration
   Check: Brand status = "APPROVED", Campaign status = "APPROVED", no expiration warning
   ```
3. Check Twilio logs for error patterns:
   ```sql
   SELECT COUNT(*), error_code, error_message
   FROM sms_events
   WHERE created_at > NOW() - INTERVAL '1 hour' AND status='failed'
   GROUP BY error_code, error_message;
   ```
4. Identify affected carriers by looking at `sms_events.carrier_name`:
   ```sql
   SELECT carrier_name, COUNT(*) AS failed_count
   FROM sms_events
   WHERE status='failed' AND created_at > NOW() - INTERVAL '1 hour'
   GROUP BY carrier_name ORDER BY failed_count DESC;
   ```
5. Check if auto-dialer feature is enabled in our app — if so, it may be triggering carrier blocks (high volume of similar messages in short timeframe).

---

## Fix
- **10DLC registration expired or pending** → Log into Twilio Console, navigate to Brand Registration. If status is not "APPROVED", resubmit:
  - Brand: Company legal name, EIN, business address.
  - Campaign: Use case (Account Verification, 2FA, Reminders). Re-submit if pending.
  - Reapproval takes 24-48h. In the interim, disable SMS sending or use fallback (email OTP).
- **Carrier filtering block** → Carriers may block due to high velocity or content. Mitigations:
  1. Reduce send volume for this use case to <10 SMS per recipient per day.
  2. Add carrier-specific headers (if Twilio offers them) to avoid spam-trigger words.
  3. Submit a carrier exception request via Twilio support (attach use case, volume metrics, compliance proof).
- **Auto-dialer enabled** → Disable immediately:
  ```sql
  UPDATE organizations SET twilio_auto_retry_enabled=false WHERE id=<org_id>;
  ```
  Retry manually at 5-min intervals instead.
- **Short-code suspended** → Contact Twilio CSM immediately (see Escalate). Suspension is usually due to spam complaints or ToS violation. Requires CSM intervention to lift.

---

## Verify
- `sms_events` success rate trending back above 95% over next 2-4h.
- Test SMS to multiple carriers (AT&T, Verizon, T-Mobile numbers) — verify all arrive within 10s.
- Check Twilio Dashboard — no pending alerts or warnings.
- Spot-check 3 customers: confirm they received their OTP/verification SMS.

---

## Escalate if
- Carrier block persists >2h despite no auto-dialer or compliance issues — contact Twilio support (support@twilio.com) and request carrier exception. Include: org name, use case, expected volume, traffic patterns.
- Short-code status shows `suspended` in Twilio console — contact your Twilio CSM immediately. This requires escalation beyond the support ticketing system. Suspension can take days to lift.
- Multiple orgs affected simultaneously — suspect platform-level Twilio API issue or our SMS gateway misconfiguration. Escalate to engineering.
- Campaign registration stuck in `pending` >48h — file Twilio support ticket with screenshot of pending status.

---

## Rollback
If you disabled auto-dialer or SMS sending:
1. Re-enable auto-dialer only after Twilio confirms block is lifted:
   ```sql
   UPDATE organizations SET twilio_auto_retry_enabled=true WHERE id=<org_id>;
   ```
2. Monitor the next 100 SMS for success rate — if block reoccurs, escalate to permanent disable.
3. Resume SMS sending for affected org only after carrier block is confirmed resolved.

---

## Related
- Twilio A2P 10DLC docs: https://www.twilio.com/en-us/messaging/sms/10dlc
- Twilio carrier filtering: https://www.twilio.com/docs/sms/concepts/carrier-filtering
- Runbook: founder-account-recovery (SMS as 2FA backup)
