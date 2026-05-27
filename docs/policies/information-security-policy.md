# Information Security Policy

**Policy owner:** Founder (Thomas Norton)
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + on any material change to security controls
**Audience:** SOC 2 Type II auditor (CC1, CC2, CC5), cyber + tech-E&O underwriting.

---

## 1. Purpose

This policy establishes how AcreOS protects customer data, source code,
production infrastructure, and operating systems against unauthorized
access, alteration, and loss. It is the parent document for the
acceptable-use, change-management, access-control, incident-response,
data-retention, and data-classification policies in this directory.

## 2. Scope

Applies to every system that processes AcreOS customer data, every person
with access to those systems (founder, employees, contractors), and every
third-party listed in `docs/vendor-inventory.md`.

## 3. Principles

1. **Least privilege.** Access to production systems is granted on the
   minimum scope and duration needed to perform a documented task. Default
   is no access.
2. **Defense in depth.** No single control is relied on. PII is protected
   by transport encryption, field-level AES-256-GCM at rest, role-based
   access checks in the app layer, organization-scoped row filters in the
   database, and an immutable audit log.
3. **Tamper-evident operations.** Every privileged action lands in
   `audit_events` (append-only) or `audit_log` (SHA-256 chained, per
   Kareem §1). Every production deploy lands in `deployments`. Every
   DR drill lands in `dr_drills`.
4. **Document then automate.** A control that exists only in someone's
   head is not a control. Every production-touching procedure must have a
   runbook in `docs/runbooks/`.
5. **Reviewed regularly.** Access, vendors, secrets, and policies are all
   reviewed on documented cadences (quarterly or annual).

## 4. Controls (high-level)

- **Identity:** Clerk + MFA enforced for all team members and customers
  with admin/owner role. See `docs/policies/mfa-enforcement-policy.md`.
- **Field-level encryption:** AES-256-GCM via `server/services/fieldEncryption.ts`
  on every column flagged sensitive in `shared/schema.ts`.
- **Network:** Cloudflare WAF + Fly private networking; production
  Postgres is not exposed publicly.
- **Application:** Express middleware in `server/middleware/` — CSRF
  protection, rate limiting (Redis-backed via `redisRateLimit.ts`),
  role guards, PII masking in logs and Sentry.
- **Audit:** see §3 principle 3. Verification endpoint at
  `/api/admin/audit-log/verify`.
- **Backup + DR:** daily DB backups (server/jobs/dbBackup.ts) to encrypted
  S3; quarterly DR drills recorded in `dr_drills`.

## 5. Roles and responsibilities

- **Founder:** owns the program; signs off on policy changes; reviews access
  and vendors quarterly; serves as security lead until that role is
  separately staffed.
- **Engineering (when staffed):** authors and reviews code changes;
  performs and reviews deploys; produces incident postmortems.
- **All personnel:** complete security training annually (see
  `docs/policies/security-awareness-training.md`); report suspected
  incidents per `docs/policies/incident-response-policy.md`.

## 6. Enforcement

Violations are investigated per the incident-response policy. Material
violations may result in role revocation, termination, or legal action.

## 7. Exceptions

Exceptions require written approval from the founder, are time-limited
(default 90 days), and are tracked in `docs/exception-register.md`
(create on first use). Exceptions are reviewed at every quarterly access
review.

## 8. Related documents

- `docs/policies/acceptable-use-policy.md`
- `docs/policies/access-control-policy.md`
- `docs/policies/change-management-policy.md`
- `docs/policies/data-classification-policy.md`
- `docs/policies/data-retention-policy.md`
- `docs/policies/incident-response-policy.md`
- `docs/separation-of-duties.md`
- `docs/secret-rotation.md`
- `docs/vendor-inventory.md`
