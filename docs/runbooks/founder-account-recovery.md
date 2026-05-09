# Runbook: Founder Account Recovery (Unauthorized Access)

**Severity:** P0 — Data breach / company takeover risk
**Owner:** Founder / legal
**Time to first response:** 5 min

---

## Symptom
- Customer reports "someone else is accessing my account"
- Unexpected deal closures, contact deletions, or stranger activity in audit log
- Customer's email is changed to an unrecognized address (account hijacking)
- Large data export or API key generation appears in audit log with no authorization
- Login from unexpected geography or IP address (e.g., China, VPN, unknown device)

---

## Diagnose
1. Get the customer's account ID (organization_id or user_id):
   ```sql
   SELECT id, email, organization_id FROM users WHERE email='<customer_email>';
   ```
2. Check all active sessions:
   ```sql
   SELECT id, user_id, ip_address, user_agent, created_at, expires_at
   FROM sessions
   WHERE user_id='<user_id>' OR organization_id='<org_id>'
   ORDER BY created_at DESC;
   ```
3. Scan audit log for suspicious activity in last 24h:
   ```sql
   SELECT id, actor_id, action, resource_id, changes, created_at
   FROM audit_events
   WHERE organization_id='<org_id>'
   AND created_at > NOW() - INTERVAL '24 hours'
   ORDER BY created_at DESC;
   ```
   Look for: email changes, password resets, API key generation, bulk deletions, data exports.
4. Verify the customer's identity using an OLD email (e.g., email on file at signup, not the currently-claimed email):
   - Send verification link to the original email address
   - Ask them to confirm they initiated the account access

---

## Fix
1. **Revoke all sessions immediately**:
   ```bash
   # Via founder recovery console: /founder/recovery-console
   # Or via script:
   npm run script -- account:revoke-sessions --org-id '<org_id>'
   
   # Or manual SQL:
   UPDATE sessions SET invalidated_at=NOW() WHERE organization_id='<org_id>';
   ```
   This logs out all devices/sessions in the account.
2. **Reset email to the verified OLD email** (if it was changed):
   ```sql
   UPDATE users SET email='<old_verified_email>' WHERE id='<user_id>';
   ```
   Notify the customer that their email has been restored.
3. **Force 2FA reset** — customer should re-enable 2FA:
   ```bash
   npm run script -- account:reset-2fa --user-id '<user_id>'
   ```
   Send them a new 2FA setup link (not QR code via email — too risky).
4. **Reset password** — send a password reset link to the verified OLD email address. Do not set a new password on their behalf (they need to control it).
5. **Freeze autopay immediately** to prevent unauthorized charges:
   ```sql
   UPDATE organizations SET autopay_frozen_at=NOW(), frozen_reason='account_takeover_investigation'
   WHERE id='<org_id>';
   ```
6. **Audit the last 24-48h activity**:
   ```sql
   SELECT id, action, resource_id, changes, actor_id, created_at
   FROM audit_events
   WHERE organization_id='<org_id>' AND created_at > NOW() - INTERVAL '48 hours'
   ORDER BY created_at DESC;
   ```
   Document what was accessed/modified. If confidential data was exported or deleted, escalate to legal.

---

## Verify
- Customer regains access to their account using reset password link.
- All sessions show `invalidated_at` is not null (all logged out).
- Email shows their verified OLD address.
- 2FA re-enabled and working.
- Autopay is frozen; no charges incurred during the incident.
- No new suspicious audit events in the last 15 min.
- Customer confirms no unauthorized data exfiltration (or legal confirms if it occurred).

---

## Escalate if
- Unauthorized data export confirmed (e.g., API key was generated and used to fetch all contacts/deals) → escalate to legal immediately. May require customer notification, GDPR breach reporting, or law enforcement.
- Multiple customers report takeovers in the same window → suspect credential theft, phishing campaign, or a platform vulnerability. Escalate to engineering to audit login flows and auth logs.
- Customer's email was changed to a domain you don't recognize (e.g., attacker's own domain) — they may be using the account to send phishing emails or spam. Report to law enforcement if suspected criminal use.
- Founder's own account is compromised — use the recovery console on a different device/browser, verify you control the email, follow the same steps (revoke sessions, reset password, enable 2FA, freeze autopay).

---

## Rollback
If you revoked sessions but the customer lost legitimate access:
1. Don't reverse the session revocation (it's already done).
2. Have the customer request a fresh password reset link.
3. After they reset, verify they can access their account again.

If you froze autopay by mistake:
1. Unfreeze after confirming the account is secure:
   ```sql
   UPDATE organizations SET autopay_frozen_at=NULL WHERE id='<org_id>';
   ```

---

## Related
- Runbook: data-breach-response (if data exfiltration confirmed)
- Security: /docs/security/account-takeover-prevention.md
- 2FA setup guide: /docs/security/2fa-setup.md
- Recovery console: /founder/recovery-console
