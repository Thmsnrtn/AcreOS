# AcreOS Log Retention

**Owner:** Founder / Security lead
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + on every log-pipeline change
**Audience:** Cyber + Tech-E&O underwriting, SOC 2 evidence, customer security reviews

This document is the canonical answer to the "How long do you keep logs?"
question on every cyber-insurance application and enterprise security
questionnaire. Each log surface is listed once, with its retention,
storage location, and how the retention is enforced (config vs. code vs.
provider default).

---

## 1. Summary table

| Log surface | Retention | Storage | Enforcement |
|---|---|---|---|
| Sentry error events | **90 days** | Sentry (managed) | Sentry plan default |
| Application logs (Fly.io stdout) | **~3 days** (Fly default) | Fly.io log shipper | Provider default — **extend via log drain in production** |
| `audit_events` table | **Indefinite** (append-only, never auto-purged) | PostgreSQL | DB constraint: append-only triggers (migration 0049) |
| `activity_log` table | **90 days** | PostgreSQL | `server/jobs/dataRetention.ts` (nightly 03:00 UTC) |
| `job_health_logs` table | **30 days** | PostgreSQL | `server/jobs/dataRetention.ts` |
| `agent_events` table | **60 days** | PostgreSQL | `server/jobs/dataRetention.ts` |
| `ai_telemetry_events` table | **30 days** | PostgreSQL | `server/jobs/dataRetention.ts` |
| `usage_events` table | **90 days** | PostgreSQL | `server/jobs/dataRetention.ts` |
| `notification_history` table | **60 days** | PostgreSQL | `server/jobs/dataRetention.ts` |
| `revenue_protection_interventions` | **180 days** | PostgreSQL | `server/jobs/dataRetention.ts` |
| Database backups (daily) | **7 days** | Fly.io Postgres managed snapshots | Fly provider default |
| Database backups (offsite) | **30 days** (target) | S3 cross-region | Manual / on roadmap — see §6 |
| Clerk auth logs | **30 days** (Clerk plan default) | Clerk (managed) | Provider |
| Stripe payment logs | **Indefinite** (Stripe retains) | Stripe | Provider |
| CDN / WAF logs (Cloudflare) | **30 days** | Cloudflare | Provider plan |

---

## 2. Security-relevant logs (forensics)

The **`audit_events` table** is the canonical forensic log. Every
security-sensitive action writes a row:

- MFA pass / block decisions (`mfa.pass`, `mfa.blocked_*`)
- Admin recovery actions (impersonation, password reset, 2FA reset, autopay freeze, ownership transfer)
- Permission grants and revocations
- Founder-console operations
- Cross-org data access events

The table has **append-only triggers** (migration 0049) — rows cannot be
`UPDATE`d or `DELETE`d, even by the database owner role. The `dataRetention`
nightly job explicitly skips `audit_events` (see code comment in
`server/jobs/dataRetention.ts`). Retention is **indefinite** — we will
revise upward to "10 years" if a regulated customer requires it; we will
not revise downward.

**Why indefinite:** breach-response forensics, SOC 2 audit trails, and
litigation hold typically demand at least 1 year and ideally 7 years.
Storing audit rows is cheap (a few MB / month at current scale);
losing them is not.

---

## 3. Sentry retention (90 days)

- **Plan:** Sentry Business (free-tier fallback acceptable for pre-revenue)
- **Retention:** 90 days of full event data, indefinite issue-level aggregates
- **PII scrubbing:** Server SDK (`server/utils/sentry.ts`) drops 4xx events and known client-disconnect noise *before* they hit Sentry. Sentry's data scrubber is also enabled at the project level for SSN / credit-card / API-key patterns.
- **Source maps:** Uploaded via `sentry-cli sourcemaps upload` at build time (`fly.toml` `[build.args]`), with release tagged to the git SHA (`VITE_GIT_SHA`)

---

## 4. Application logs (Fly.io)

- **Default retention:** Fly.io retains ~3 days of stdout/stderr per machine; older data is rotated.
- **Production requirement:** For a $5M cyber policy, **3 days is not enough**. The recommended path (documented in `docs/security.md`) is to configure a persistent log drain to a SIEM-grade endpoint (Logtail, Datadog, Axiom, or Papertrail). Minimum retention at the drain target: **90 days**. SIEM tier (for SOC 2): **1 year**.
- **Current state:** Drain is set up via `LOG_DRAIN_URL` secret (see `docs/security.md`). Production target endpoint: Logtail (free tier supports 30-day retention; upgrade to paid for 90+ day retention).
- **Format:** Structured JSON via `server/utils/logger.ts`. Each line includes correlation ID, severity, organization ID where applicable, and PII-scrubbed payload.

---

## 5. Database retention enforcement

The nightly job `server/jobs/dataRetention.ts` (scheduled at 03:00 UTC
in `server/worker.ts`) enforces the per-table retention rules in §1.
Each rule:

```ts
{ table: "<table>", column: "created_at", retainDays: N, label: "..." }
```

The job:

1. Computes the cutoff timestamp (`now - retainDays`).
2. `DELETE FROM <table> WHERE created_at < <cutoff>`.
3. Logs the row count purged.
4. Skips tables that don't exist (idempotent across environments).
5. **Never** touches `audit_events` (append-only triggers would reject the DELETE; the job omits the table entirely).

To change a retention period, edit the `retentionRules` array in
`server/jobs/dataRetention.ts` and ship a PR. The change is auditable
via git history.

---

## 6. Database backups

| Tier | Cadence | Retention | Storage |
|---|---|---|---|
| Tier 1 (managed) | Daily | 7 days | Fly.io Postgres managed snapshots |
| Tier 2 (offsite) | Daily | 30 days (target) | S3 cross-region (in setup) |
| Tier 3 (cold archive) | Monthly | 1 year (target) | S3 Glacier (roadmap) |

**Restore mechanics:** `docs/runbooks/07-database-restore-from-snapshot.md`.
**Verified RTO:** ≤45 minutes (quarterly DR drill, see `docs/runbooks/dr-drill-quarterly.md`).
**Verified RPO:** ≤24 hours (daily snapshot cadence).

Offsite/cold-archive tiers are partially configured — the underwriting
application should disclose "Tier 1 production-verified, Tier 2 in
rollout, Tier 3 on roadmap" rather than overclaim.

---

## 7. PII in logs

- Server logger (`server/utils/logger.ts`) applies PII masking to known
  fields (SSN, EIN, email-in-payload, phone, card numbers) via the
  `server/middleware/piiMasking.ts` redactor before serialization.
- Sentry server SDK additionally drops 4xx noise and applies its own
  scrubber rules.
- **Quarterly audit:** Run a regex sweep over the most recent 7 days of
  log-drain output for SSN / TIN / card patterns. Any match is treated
  as a P1 incident under `docs/runbooks/data-breach-response.md`. Last
  audit: **due 2026-06-30** (first scheduled audit).

---

## 8. Carrier-application answer (canonical)

> **Q: What is your log retention policy?**
> **A:** 90 days for Sentry error events, 90 days minimum for application
> logs at the SIEM drain target, indefinite for the `audit_events`
> forensic table (append-only DB triggers prevent shortening), 7 days
> for managed Postgres backups (extending to 30 days offsite). Per-table
> retention for high-volume telemetry (30–180 days) is enforced by a
> nightly job; rules are committed to source control at
> `server/jobs/dataRetention.ts`. Audit-event retention is indefinite
> by policy and by DB constraint.

---

## 9. Change history

| Date | Change |
|---|---|
| 2026-03-10 | F-A09-3: initial retention table documented in `docs/security.md` |
| 2026-05-27 | Carved out as a standalone canonical doc for underwriting / SOC 2 |
