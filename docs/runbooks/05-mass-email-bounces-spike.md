# Runbook 05 — Mass email bounces / deliverability spike

**Severity:** P1 — Sender reputation at risk
**Owner:** Founder / deliverability operator
**Time to first response:** 1 hour

---

## Symptom
- SendGrid Activity dashboard shows bounce rate > 5% (target: < 2%)
- Spike in `email_events` rows with `event_type IN ('bounce','dropped','spam_report')`
- Customers report their campaigns "aren't landing" or going to spam
- SendGrid emails warning of dedicated-IP reputation drop

---

## Diagnose
1. Open SendGrid → **Stats** → Last 24h. Note: bounce rate, spam-report rate, block rate.
2. Identify top offenders:
   ```sql
   SELECT organization_id, COUNT(*) AS bounces
   FROM email_events
   WHERE event_type='bounce' AND created_at > NOW() - INTERVAL '24 hours'
   GROUP BY organization_id ORDER BY bounces DESC LIMIT 10;
   ```
3. Differentiate by bounce class:
   - **Hard bounces** (invalid recipient) — list hygiene problem
   - **Soft bounces** (mailbox full, temp deferral) — usually self-resolves
   - **Block** (recipient ISP blocked our IP) — reputation problem
   - **Spam report** — content / consent problem, most damaging
4. Check sender domain DKIM/SPF/DMARC alignment in SendGrid → **Sender Authentication**. Any "fail" here turns soft issues into hard ones.
5. Look at the offending campaigns' content — high spam-trigger words, large image-to-text ratio, missing unsubscribe link?

---

## Fix
- **One org is the source** → Pause that org's campaigns (`UPDATE organizations SET email_sending_paused=true WHERE id=X`), email them, require list re-validation before resume.
- **Suppression list out of sync** → Rebuild from `email_events`:
  ```bash
  npm run script -- rebuild-suppressions
  ```
  This re-uploads bounce + spam-report addresses to SendGrid's suppression list so we don't re-send to known-bad addresses.
- **DKIM/SPF mis-aligned** → Re-verify in SendGrid, update Cloudflare DNS records (TXT `acreos.com`, CNAMEs for `s1._domainkey` etc).
- **Reputation drop on dedicated IP** → Throttle send volume to 50% of normal for 48h to let reputation recover. Pause non-essential campaigns.
- **Spam reports clustered on one campaign** → Pull the campaign immediately, refund any send credits used, post-mortem the content.

---

## Verify
- Bounce rate trending back below 2% in SendGrid Stats over the next 6 hours.
- No new spam reports for 24h.
- `email_events` rows of `event_type='delivered'` resume their normal rate.
- A test send from /founder lands in primary inbox (not promotions / spam) on Gmail and Outlook.

---

## Escalate if
- ISP-level block (Gmail, Yahoo, Outlook) — these can take days to lift; founder must approve a delivery freeze + remediation plan.
- SendGrid threatens to suspend the account → reply to their compliance email within 24h with a written remediation plan, or we lose sending entirely.
- Spam reports look like a list-purchase / pretexting attack on one customer → that customer is in violation of ToS, pause + notify per ToS escalation flow.
