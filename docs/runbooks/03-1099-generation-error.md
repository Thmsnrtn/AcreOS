# Runbook 03 — 1099 generation error

**Severity:** P2 — Compliance + customer trust
**Owner:** Founder / tax operator
**Time to first response:** Same day during tax season

---

## Symptom
- Customer's 1099 PDF fails to generate at year-end
- Bulk 1099 job emits 422 errors in `outbox_jobs`
- Customer email: "my 1099 doesn't show, I need it for taxes"
- API logs: `POST /api/tax/1099/generate` returns 422 with `tax_identity_*` codes

---

## Diagnose
1. Check `outbox_jobs` for the org's 1099 job:
   ```sql
   SELECT id, status, last_error, attempts FROM outbox_jobs
   WHERE kind='generate_1099' AND payload->>'organizationId' = 'X' ORDER BY id DESC LIMIT 5;
   ```
2. Common 422 codes (from `server/utils/errors.ts` validation flow):
   - `tax_identity_missing` — `tax_identities` row absent for the org
   - `tax_identity_unverified` — TIN exists but never matched IRS TIN-match
   - `tax_identity_legal_name_mismatch` — TIN matched a different legal name
   - `tax_identity_address_invalid` — missing or invalid US address
   - `payments_below_threshold` — total paid < $600 (no 1099 required, not actually an error)
   - `payments_zero` — no qualifying payments in tax year
3. Open /founder/tax — confirm the org's tax-identity status visually.

---

## Fix
- **`tax_identity_missing`** → Send the customer the W-9 collection link: `/onboarding/tax-identity?org=X`. They self-fill TIN + legal name + address.
- **`tax_identity_unverified`** → Click **Re-run TIN match** in /founder/tax. If it fails again, ask the customer to confirm the legal name exactly matches what's on their IRS letter (CP575 for EINs, SSA card for SSNs).
- **`tax_identity_legal_name_mismatch`** → Customer typed a DBA instead of the legal name. Have them edit and resubmit; do NOT edit on their behalf.
- **`tax_identity_address_invalid`** → US state required, no PO boxes for some forms, ZIP must be 5 or 9 digits. Walk them through the form.
- **`payments_below_threshold`** → Mark the case "no action — under $600 threshold" and explain to the customer.
- **Generation succeeded but PDF blank** → Re-run with `force_regenerate=true`; if still blank, check `tax_1099_documents.pdf_url` in DB.

---

## Verify
- `outbox_jobs` row flips to `succeeded`.
- PDF accessible at `/api/tax/1099/:id/pdf`.
- Customer can download from /tax-center.
- A copy is recorded in `tax_1099_documents` with `generated_at` set.

---

## Escalate if
- Many orgs hit `tax_identity_legal_name_mismatch` on the same day → IRS TIN-match service may be returning false negatives; check vendor status, retry tomorrow before re-prompting customers.
- 1099 already filed with IRS but customer says it's wrong → corrected 1099 (1099-CORR) flow, do not just regenerate. Founder + accountant must approve.
- Volume > 100 jobs failing → pause the bulk run, investigate before resuming, do not let the queue retry uncapped.
