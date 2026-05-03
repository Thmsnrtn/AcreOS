# Runbook 02 — Payment / card failed

**Severity:** P2 — Revenue at risk (P1 if customer is a high-MRR account)
**Owner:** Founder / billing operator
**Time to first response:** 1 business day

---

## Symptom
- Stripe webhook recorded `invoice.payment_failed`
- Dunning case opens in /founder/dunning
- Customer's org status flips to `past_due` or `frozen` (autopay frozen flag)
- Customer emails support: "my card was charged twice / declined / I changed cards but it still failed"

---

## Diagnose
1. Open **/founder/dunning**. Find the case for the org. Note: the dunning sequence is `attempt 1 → wait 3d → attempt 2 → wait 3d → attempt 3 → wait 4d → freeze`.
2. Click into the case. Read `last_failure_reason` — Stripe decline codes:
   - `insufficient_funds` — common, usually self-resolves on retry
   - `card_declined` / `generic_decline` — bank-side block, customer needs to contact issuer
   - `expired_card` — customer must update card
   - `authentication_required` — 3DS challenge missed, send fresh payment link
   - `lost_card` / `stolen_card` — do NOT retry, customer must add a new card
3. Cross-check in Stripe dashboard → **Customers → [customer]**. Confirm payment method on file, recent charge attempts, any disputes.
4. If customer claims a double charge: search Stripe charges by amount + date. Most "double charges" are an authorization hold + the actual charge — explain and link the Stripe charge IDs.

---

## Fix
- **Soft decline** (`insufficient_funds`, `processing_error`) → click **Manual retry** on the dunning case. The system uses the existing payment method.
- **Expired / wrong card** → click **Send update link** on the case. This emails a Stripe-hosted card-update page. Do not collect card numbers manually.
- **3DS required** → click **Resend invoice with 3DS link**. Walk customer through the authentication if needed.
- **Lost / stolen** → cancel the dunning case (`POST /api/dunning/:id/cancel`), tell customer to add a new card via /billing, then re-trigger billing run.
- **Genuine dispute** → open the dispute in Stripe, attach evidence (signed contract, usage logs), respond within Stripe's deadline.

---

## Verify
- Stripe charge `succeeded`.
- Org's `autopay_frozen` flag clears.
- Org status returns to `active` in /founder/customers.
- Dunning case status = `resolved` in /founder/dunning.

---

## Escalate if
- Failure rate > 5% across all charges in last hour → suspect Stripe issue (check vendor status tile) or our key/secret misconfig. See runbook 06 (stripe-webhook-replay).
- Customer disputes after we've already provided service for 60+ days → involve legal-ish review before refunding.
- Dunning sequence reaches freeze on a $5k+/yr customer without operator touch → page founder; do not let high-LTV accounts auto-freeze without a phone call.
