# Runbook: E-Signature Request Stalled (Signer Never Signed)

**Severity:** P2 — Customer workflow blocked
**Owner:** Founder / engineering
**Time to first response:** 1 hour

---

## Symptom
- Signature request in AcreOS shows `status='pending_signature'` or `status='sent'` for >7 days
- Signer reports they never received the signing link or it expired
- No recent webhook events from Dropbox Sign for this signature request
- Customer escalates: "Our deal is stuck, contract hasn't been signed"

---

## Diagnose
1. Query the stalled signature request:
   ```sql
   SELECT id, dropbox_sign_request_id, status, created_at, updated_at, signer_email
   FROM signature_requests
   WHERE id='<signature_id>' OR dropbox_sign_request_id='<dropbox_id>';
   ```
   Note the `created_at` and `updated_at` timestamps. If `updated_at` is >7 days old, it's stalled.
2. Check webhook events to see if Dropbox Sign sent any callbacks:
   ```sql
   SELECT id, event_type, payload, created_at
   FROM dropbox_sign_webhook_events
   WHERE signature_request_id='<signature_id>'
   ORDER BY created_at DESC LIMIT 10;
   ```
3. Manually poll Dropbox Sign API to verify current status:
   ```bash
   curl -H "Authorization: Bearer <DROPBOX_SIGN_API_KEY>" \
     https://api.hellosign.com/v3/signature_request/<dropbox_sign_request_id>
   ```
   Check the `status` field in response. Expected values: `sent`, `signed`, `declined`, `expired`, etc.
4. If response shows `status='signed'` but our DB shows `pending_signature`, the webhook was lost. If response shows `status='expired'`, the signing window closed.

---

## Fix
- **Webhook was lost (Dropbox shows signed, we show pending)** → Manually update our DB:
  ```sql
  UPDATE signature_requests
  SET status='signed', signed_at=NOW(), updated_at=NOW()
  WHERE id='<signature_id>';
  ```
  Then trigger downstream workflows (e.g., document storage, notification email).
- **Signing window expired (Dropbox shows expired)** → Void and re-send:
  ```bash
  # Via Dropbox Sign API:
  curl -X POST -H "Authorization: Bearer <DROPBOX_SIGN_API_KEY>" \
    https://api.hellosign.com/v3/signature_request/<old_dropbox_id>/cancel
  ```
  Then re-create the signature request with a fresh 30-day window:
  ```bash
  npm run script -- esign:resend --signature-id <signature_id>
  ```
  Notify the signer with a new link.
- **Signer never received link** → Check if email provider blocked it:
  - Look at `email_events` for the signer's email and the Dropbox Sign domain
  - If bounced or blocked, ask signer to whitelist @hellosign.com and resend the link
  - Resend via AcreOS:
    ```bash
    npm run script -- esign:resend --signature-id <signature_id>
    ```
- **Dropbox Sign API unresponsive** → Check status page (https://status.hellosign.com). If no outage, file a support ticket.

---

## Verify
- Run the manual poll again and confirm status matches our DB:
  ```bash
  curl -H "Authorization: Bearer <DROPBOX_SIGN_API_KEY>" \
    https://api.hellosign.com/v3/signature_request/<dropbox_sign_request_id>
  ```
- If re-sent: signer receives new link within 5 min, can sign.
- If voided + re-sent: old link returns 404, new link works.
- Customer confirms in AcreOS that contract shows as signed.

---

## Escalate if
- Dropbox Sign API returns 5xx or times out — check status page. If green, file Dropbox support ticket (support@hellosign.com) with request ID and logs.
- Multiple signature requests stalled from the same org — suspect a webhook delivery issue on our end. Check `/api/dropbox-sign/webhook` handler logs and re-enable if disabled.
- Signer disputes they ever received the link and the contract is business-critical — escalate to legal for guidance on acceptance of signature evidence.

---

## Rollback
If you manually updated the DB to mark as signed:
1. Verify with the signer that they actually did sign the document before committing the change.
2. Store a record of this manual override (date, who approved, reason) for audit compliance.
3. Do not reverse the DB change; instead, create a note in the signature request row or a separate `manual_overrides` audit log.

---

## Related
- Dropbox Sign webhook docs: https://www.hellosign.com/api/documentation
- Runbook: data-breach-response (if signer reports link shared with unintended parties)
- Runbook: GDPR-dsar-fulfilment (if signer requests to delete their signature data)
