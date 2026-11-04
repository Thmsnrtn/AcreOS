# Data Retention Policy

**Policy owner:** Founder
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + on any new data class
**Audience:** SOC 2 Type II (CC6.5, C1.1), GDPR/CCPA compliance, customer DPA reviews.

> **Corrected 2026-11-03 (legal-run Leg 7 / LQ-07 §6 item 6).** Four claims in
> this policy contradicted the code and are corrected in place below: the
> 365-day communications purge (no such rule exists), Datadog (not a vendor
> AcreOS uses), §6's claim that every sweep short-circuits on a hold, and §5's
> backup lifecycle stated as fact. Nothing else in the policy was re-verified
> by this correction, and the policy as a whole remains DRAFT pending counsel
> (LQ-03/LQ-04/LQ-07). The 30-day post-account-deletion promise in §3/§4 is
> **not** corrected here: whether to build a closure timer or rewrite the
> promise is an open founder/counsel decision (LQ-07 Q1).

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
| Communications (email/SMS body text) | ~~365 days~~ **No automatic time-based purge exists** (corrected 2026-11-03). Communications are deleted with the account, or on demand when the org runs the "communications" purge in its data-retention settings (`purgeOldCommunications`, `routes-import-export.ts`). | ~~`server/jobs/dataRetention.ts` daily purge~~ On-demand purge / account erasure | Legal hold — the on-demand purge deletes nothing while the org has an active hold |
| Financial records (invoices, payments, 1099s) | **7 years** | Manual archive then hard-delete | IRS retention rules supersede |
| Audit log (`audit_log`) | **7 years** | `server/storage.ts:purgeOldAuditLogs` after expiry, blocked by legal hold | Legal hold; chain integrity must be preserved if purged |
| Audit events (`audit_events`) | **7 years**; never deleted | Append-only; manual archive only after 7 years | Legal hold |
| Sub-processor disclosures | Lifetime + 7 years | Append-only ledger | n/a |
| DB backups (S3) | 30 days **(intended; UNVERIFIED — see §5)** | S3 lifecycle rule on the backup bucket **(existence not verified)** | n/a |
| Sentry events | 90 days (Sentry default) | Auto-expire by Sentry | n/a |
| Stripe data (cards, customers) | Retained by Stripe per PCI requirements | We do not control Stripe retention | n/a |
| Source control history | Indefinite | Git history is permanent | n/a |
| CI/CD logs (GitHub Actions) | 90 days (GitHub default) | Auto-expire | n/a |
| Application logs ~~(Datadog)~~ (corrected 2026-11-03: AcreOS does not use Datadog; application logs go to the hosting platform's log stream, Fly.io) | ~~30 days~~ **Not verified** | Platform log retention | n/a |
| Field-encryption ciphertext | Lifetime of underlying record | Decrypted only on-demand; ciphertext purged with row | n/a |

## 4. Customer-controlled retention

Customers may request shorter retention via DSAR (right-to-erasure) per
`docs/runbooks/gdpr-dsar-fulfilment.md`. Fulfillment SLA is 30 days
unless a legal hold or regulatory minimum prevents (IRS, breach-
notification preservation, etc.) — in which case the customer is
notified of the hold and the data is queued for delete on hold release.

## 5. Backup retention

**Corrected 2026-11-03 — this section describes the intended design, not a
verified fact.** `server/jobs/dbBackup.ts` is written to upload daily DB
backups to AWS S3 with AES-256 server-side encryption when
`DB_BACKUP_S3_BUCKET` is configured. Whether that bucket exists in
production, and whether a lifecycle rule deleting objects after 30 days is
set on it, has **not been verified** (a console / in-machine fact the founder
owns). Until it is, this policy makes no statement that backups are deleted
after 30 days or that older backups are unrecoverable. ~~S3 lifecycle rule
deletes objects older than 30 days. Older backups are not recoverable.~~

## 6. Legal holds

**Corrected 2026-11-03 to describe behaviour as shipped.** The earlier text
said every retention sweep short-circuits on a hold; two deletion paths did
not check holds at all, and two more paths (below) still do not. A hold is active when its `legal_holds` row has
`status = 'active'` and `released_at` is null (there is no `is_active`
column). The check is `orgHasActiveHold()` / `getActiveHoldSummary()` in
`server/services/legalHold.ts`. Per path:

| Deletion path | Hold behaviour |
|---|---|
| Per-user GDPR erasure — `gdprService.anonymizeUser()` | Refuses (`LegalHoldViolationError`) if any of the user's orgs has an active hold. |
| On-demand org purges — `purgeOldLeads`, `purgeOldDeals`, `purgeOldAuditLogs`, `purgeOldCommunications` | Delete nothing (return 0) while the org has an active hold. |
| Bulk deletes — `routes-bulk.ts` | Held ids are filtered out (`filterOutHeldIds`). |
| Nightly retention job — `server/jobs/dataRetention.ts` | Org-scoped tables: rows of an org with an active hold are excluded from the purge, and the kept count is logged at error level. If the hold lookup fails, org-scoped rules do not run that night. Tables with no org column (`job_health_logs`, `realtime_event_log`, `notification_history`) cannot be filtered by org; each has a written disposition in the job (`NON_ORG_SCOPED_RULE_DISPOSITIONS`). *Hold-blind before 2026-11-03.* |
| Org erasure — `server/services/orgDeletion.ts` | Refuses before deleting anything if the org has an active hold (HTTP 423 at the founder route), logged and written to `audit_events`. *Hold-blind before 2026-11-03.* |
| DSAR "Pipeline A" erasure (`routes-dsar.ts`) | Not implemented (returns 501); its future erasure path is part of the open DSAR reconciliation (LQ-11). |
| Workspace "clear data" — `POST /api/clear-demo-data` → `clearOrganizationRecords()` (`server/services/orgDataClear.ts`) | **Does NOT check legal holds.** An org owner can delete the org's leads, properties, deals, notes, payments and `activity_log` while a hold is active. Known gap (found 2026-11-03), not yet fixed. |
| Cold-storage archival — `server/jobs/archival.ts` | **Does NOT check legal holds.** It moves org rows to object storage and deletes them from the database. Off by default (`archival.enabled`). Known gap (found 2026-11-03), not yet fixed. |

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
