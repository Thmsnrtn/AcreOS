# Runbook: SES Bounce / Complaint Rate Spike

**Severity:** P1 — Sender reputation at risk
**Owner:** Founder / deliverability operator
**Time to first response:** 30 min

---

## Symptom
- AWS SES bounce rate exceeds 5% (target: <2%)
- Complaint rate exceeds 0.1% (target: <0.05%)
- `email_events` table shows spike in rows with `event_type IN ('bounce', 'complaint')`
- AWS SES sends warning email about suppression list growth
- Customers report campaigns not reaching recipients or landing in spam

---

## Diagnose
1. Check **AWS SES Dashboard → Sending Statistics** (last 24h). Note bounce rate, complaint rate, delivery rate.
2. Identify which organization is the source:
   ```sql
   SELECT organization_id, COUNT(*) AS bounce_count, COUNT(DISTINCT recipient) AS unique_recipients
   FROM email_events
   WHERE event_type='bounce' AND created_at > NOW() - INTERVAL '24 hours'
   GROUP BY organization_id ORDER BY bounce_count DESC LIMIT 5;
   ```
3. Check complaint rate by org:
   ```sql
   SELECT organization_id, COUNT(*) AS complaint_count
   FROM email_events
   WHERE event_type='complaint' AND created_at > NOW() - INTERVAL '24 hours'
   GROUP BY organization_id ORDER BY complaint_count DESC LIMIT 5;
   ```
4. Inspect the `email_suppressions` table to see if recipients are being blocked:
   ```sql
   SELECT suppression_reason, COUNT(*) FROM email_suppressions GROUP BY suppression_reason;
   ```
5. Check SES suppression list in AWS console — verify it's not bloated with false positives.

---

## Fix
- **One org driving bounces** → Pause that org's SES identity immediately:
  ```bash
  # Via AWS CLI:
  aws ses set-account-sending-enabled --enabled=false --region us-east-1
  # Or via AWS Console: SES → Email Addresses → <org-domain> → Disable Sending
  ```
  Contact the organization: ask them to validate their recipient list before resuming. Set a resumption checklist (SPF/DKIM verified, list re-validated, <1% expected bounce rate).
- **Complaint rate spike** → Pause campaigns from the offending org immediately. Review their email template for spam-trigger words (lottery, free money, act now, limited time). Require content re-approval before resuming.
- **Suppression list bloated** → Rebuild from `email_events` to remove stale entries:
  ```bash
  npm run script -- rebuild-email-suppressions --dry-run
  npm run script -- rebuild-email-suppressions
  ```
- **Reputation recovery needed** → Throttle send volume to 50% for 48h. Pause non-critical campaigns. Monitor bounce rate hourly.

---

## Verify
- Bounce rate trending below 2% in SES Dashboard over next 6 hours.
- Complaint rate below 0.05%.
- No new suppression list entries in last 2h (check `email_suppressions.updated_at`).
- Test send to @gmail.com and @outlook.com addresses — verify they land in inbox, not spam.
- `email_events` rows with `event_type='delivered'` resume normal volume.

---

## Escalate if
- Bounce rate remains >5% after 2h of remediation — file AWS SES support ticket with diagnostic data (bounce patterns, org details).
- SES account at risk of sending pause — respond to AWS compliance email within 24h with a written remediation plan.
- Multiple orgs show spike simultaneously — suspect a platform-level issue (database corruption, misconfigured event listener). Escalate to engineering.
- Complaint rate suggests customer list-purchase or purchased-list spam — customer is in violation of ToS. Pause their account and notify per escalation flow.

---

## Rollback
If you disabled SES sending or paused an org:
1. Re-enable SES sending after reputation recovery (24-48h):
   ```bash
   aws ses set-account-sending-enabled --enabled=true --region us-east-1
   ```
2. Notify the org and require them to acknowledge the bounce-rate issue before resume.
3. Monitor their first 100 sends for bounce rate; if it spikes again, escalate to termination discussion.

---

## Related
- Runbook 05 (Mass email bounces spike) — similar but applies to SendGrid (legacy).
- AWS SES docs: https://docs.aws.amazon.com/ses/
- AWS Reputation Manager: https://docs.aws.amazon.com/ses/latest/dg/send-metrics.html
