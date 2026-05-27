# Data Retention Policy

**Policy owner:** Founder
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + on any new data class
**Audience:** SOC 2 Type II (CC6.5, C1.1), GDPR/CCPA compliance, customer DPA reviews.

---

## 1. Purpose

Defines how long AcreOS retains each class of customer and operational
data and how that data is disposed of at end-of-retention.

## 2. Scope

Every class of data stored in the production database, S3 backups,
Sentry, vendor systems listed in `docs/vendor-inventory.md`, and source
control.

## 3. Retention by data class

| Data class | Retention | Disposal | Hold exceptions |
|---|---|---|---|
| Customer account (`users`, `organizations`, `team_members`) | Lifetime of account + 30 days after deletion request | Hard-delete via DSAR fulfillment (`runbooks/gdpr-dsar-fulfilment.md`) | Legal hold pauses (`legal_holds` table; see `routes-legal-holds.ts`) |
| Customer leads/properties/deals | Lifetime of account, then per DSAR | Hard-delete | Legal hold |
| Communications (email/SMS body text) | 365 days | `server/jobs/dataRetention.ts` daily purge | Legal hold |
| Financial records (invoices, payments, 1099s) | **7 years** | Manual archive then hard-delete | IRS retention rules supersede |
| Audit log (`audit_log`) | **7 years** | `server/storage.ts:purgeOldAuditLogs` after expiry, blocked by legal hold | Legal hold; chain integrity must be preserved if purged |
| Audit events (`audit_events`) | **7 years**; never deleted | Append-only; manual archive only after 7 years | Legal hold |
| Sub-processor disclosures | Lifetime + 7 years | Append-only ledger | n/a |
| DB backups (S3) | 30 days | S3 lifecycle rule on `acreos-db-backups` bucket | n/a |
| Sentry events | 90 days (Sentry default) | Auto-expire by Sentry | n/a |
| Stripe data (cards, customers) | Retained by Stripe per PCI requirements | We do not control Stripe retention | n/a |
| Source control history | Indefinite | Git history is permanent | n/a |
| CI/CD logs (GitHub Actions) | 90 days (GitHub default) | Auto-expire | n/a |
| Application logs (Datadog) | 30 days | Auto-expire | n/a |
| Field-encryption ciphertext | Lifetime of underlying record | Decrypted only on-demand; ciphertext purged with row | n/a |

## 4. Customer-controlled retention

Customers may request shorter retention via DSAR (right-to-erasure) per
`docs/runbooks/gdpr-dsar-fulfilment.md`. Fulfillment SLA is 30 days
unless a legal hold or regulatory minimum prevents (IRS, breach-
notification preservation, etc.) — in which case the customer is
notified of the hold and the data is queued for delete on hold release.

## 5. Backup retention

Daily DB backups via `server/jobs/dbBackup.ts` to AWS S3 with AES-256
server-side encryption. S3 lifecycle rule deletes objects older than
30 days. Older backups are not recoverable — this is a documented
trade-off: 30 days is enough for any plausible operational restore;
longer retention extends the blast radius of a backup compromise.

## 6. Legal holds

When a legal hold is in force for an organization (`legal_holds` table
with `is_active = true`), every retention sweep short-circuits for that
org. Implementation: `orgHasActiveHold()` in `server/storage.ts` is
called by every purge function.

## 7. Disposal

- Database: `DELETE` with `ON DELETE CASCADE` on owned rows.
- S3: server-side delete via S3 API; lifecycle policy as backup.
- Vendor systems: we instruct vendors to delete per their DPA (typical
  SLA: 30 days) and request written confirmation.

## 8. Evidence

Every retention sweep run records to `job_runs` (see
`server/jobs/scheduler.ts`). The auditor can show "data X was deleted
on day Y per the retention schedule" by joining `job_runs` to the
specific purge function.

## 9. Related documents

- `docs/runbooks/gdpr-dsar-fulfilment.md`
- `docs/policies/data-classification-policy.md`
- `docs/data-privacy.md`
