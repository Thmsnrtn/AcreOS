# Data Classification Policy

**Policy owner:** Founder
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + on any new data class introduced to production
**Audience:** SOC 2 Type II (CC6.1, CC6.5, C1.1, P-series), engineering.

---

## 1. Purpose

Defines the classification labels AcreOS uses for data and the protections
required at each label. Classification drives encryption choices, access
controls, retention, and breach-notification thresholds.

## 2. Classification labels

| Label | Examples | Protections required |
|---|---|---|
| **Public** | Marketing site content; public-facing API docs; sub-processor list | None beyond standard hosting |
| **Internal** | Internal runbooks, ADRs, design docs | Access limited to AcreOS personnel; not committed to public repos |
| **Confidential** | Customer business data: leads, properties, deals, communications, financial records | TLS in transit; row-level org isolation; access logged |
| **Restricted** | Customer PII (email, phone, address, SSN, tax IDs); credentials; secrets; field-encryption keys | All Confidential controls PLUS AES-256-GCM at rest (via `fieldEncryption.ts`); PII masking in logs/Sentry; tamper-evident audit |

## 3. Examples by storage location

**Postgres tables:**

- `users`, `team_members`, `organizations` — Confidential overall; the
  email and phone columns are Restricted (field-encrypted).
- `leads`, `properties`, `deals` — Confidential; owner names + contact
  info are Restricted.
- `payments`, `invoices` — Confidential; card last4 is Confidential;
  full card data is never stored.
- `tax_identities` — Restricted (SSN/EIN).
- `audit_log`, `audit_events` — Confidential.
- `sessions` — Restricted (session token).

**Vendor systems:**

- Clerk holds Restricted (auth credentials).
- Stripe holds Restricted (card tokens).
- Anthropic / OpenAI hold prompt content (Restricted unless pre-redacted
  via `sanitizePrompt.ts`).
- Sentry stores stack traces (Internal once `piiMasking.ts` runs).

## 4. Required protections by label

**Public:**
- No specific controls beyond standard hosting hygiene.

**Internal:**
- Stored in private GitHub repos (AcreOS org).
- Not shared with vendors except as needed for support cases (sanitize
  before sharing).

**Confidential:**
- TLS 1.2+ in transit, always.
- Row-level organization isolation enforced by app-layer guards in
  every query (`getOrganizationId(req)` from `server/types/request.ts`).
- Access events land in `audit_log` (per the change-management policy).
- Backed up encrypted (S3 SSE-S3, AES-256).

**Restricted:**
- All Confidential controls PLUS:
- AES-256-GCM at rest via `server/services/fieldEncryption.ts`.
- PII masking in logs (`server/middleware/piiMasking.ts`) and Sentry
  (`server/services/sentry.ts` beforeSend).
- Never logged in plaintext; never returned in API responses unless
  required for the specific authenticated user (and even then masked
  where partial display suffices).
- Encryption key rotation requires a re-encrypt sweep (see
  `docs/secret-rotation.md` §3).

## 5. Labeling schema

Schema columns containing Restricted data carry a comment in
`shared/schema.ts` noting "PII — field-encrypted" or "PII — masked in
logs." A future enhancement: add a runtime registry that fails CI if a
new sensitive-looking column is added without the corresponding
classification + encryption flag.

## 6. Handling in development / staging

Production data must never appear in development or staging environments.
The only exception is the DR drill flow, which restores a snapshot into
a scratch app (`acreos-db-scratch`) that is destroyed within 45 minutes
per `docs/runbooks/dr-drill-quarterly.md`.

## 7. Disposal

Per `docs/policies/data-retention-policy.md`. Disposal includes
overwriting the underlying ciphertext when the record is hard-deleted;
encryption-key destruction is the secondary control if ciphertext
remains in old backups.

## 8. Related documents

- `docs/policies/data-retention-policy.md`
- `docs/policies/access-control-policy.md`
- `docs/data-privacy.md`
- `docs/secret-rotation.md`
