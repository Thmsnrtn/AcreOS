# Access Control Policy

**Policy owner:** Founder
**Last reviewed:** 2026-05-27
**Review cadence:** Quarterly + on every role change
**Audience:** SOC 2 Type II (CC6.1, CC6.2, CC6.3, CC6.6), all personnel.

---

## 1. Purpose

Defines how access to AcreOS systems and customer data is granted,
reviewed, and revoked.

## 2. Scope

Every system in `docs/vendor-inventory.md`, every privileged role in the
application (`team_members.role IN ('owner','admin')`), every secret
in `docs/secret-rotation.md`, and every code repository.

## 3. Principles

1. **Least privilege.** Default is no access. Access is granted on a
   documented need.
2. **Role-based.** Application access is granted via `team_members.role`,
   not ad-hoc per-route allowlists. Roles are: `owner`, `admin`,
   `member`, `viewer`, `va`.
3. **Time-bounded for elevated access.** Elevated access (DB shell,
   secret rotation, prod SSH) is granted per-task and revoked after.
4. **MFA required.** Every account with role `owner` or `admin` MUST
   have MFA enrolled. Enforced by `server/middleware/requireClerkMFA.ts`
   and `docs/policies/mfa-enforcement-policy.md`.

## 4. Granting access

- Customer accounts: self-service via Clerk + onboarding wizard.
- Team-member seats: an `owner` invites via `/api/organization/invitations`,
  which writes an `organization_invitations` row with a SHA-256-hashed
  invite token. Acceptance updates `team_members` and emits an
  `org.member_added` audit event.
- Founder accounts: gated by `FOUNDER_EMAIL` / `FOUNDER_EMAILS` env
  var. Adding a new founder is a deploy change (see change-management
  policy).
- Vendor consoles: founder creates per-vendor accounts; today no other
  personnel have console access.

## 5. Reviewing access

Quarterly access review per `server/jobs/accessReview.ts`:

- First Tuesday of January / April / July / October at 14:00 UTC.
- Enumerates every `team_members` row with role `owner` or `admin`,
  joins `users.lastActiveAt`, flags rows idle > 90 days.
- Emails the founder. Reply with "REVIEWED" + date acknowledges.
- Audit evidence: an `audit_events` row with `action="access_review.quarterly"`.

## 6. Revoking access

- Customer self-deletion: handled via DSAR per
  `docs/runbooks/gdpr-dsar-fulfilment.md`.
- Team-member removal: `owner` removes via UI, which sets
  `team_members.isActive = false` and emits `org.member_removed`.
- Vendor console removal: founder removes; secret rotation per
  `docs/secret-rotation.md` follows.
- Founder-account compromise: per `docs/runbooks/founder-account-recovery.md`.

## 7. Privileged accounts

Today the founder holds every privileged account. See
`docs/separation-of-duties.md` for the material-weakness disclosure
and break-glass procedure.

## 8. Audit trail

Every grant/revoke produces an `audit_events` row. The audit log itself
is tamper-evident: `audit_log` rows are SHA-256 chained (Kareem §1),
`audit_events` is append-only via Postgres trigger
(`migrations/0049_dsar_audit_subprocessors.sql`).

## 9. Related documents

- `docs/separation-of-duties.md`
- `docs/policies/mfa-enforcement-policy.md`
- `docs/runbooks/founder-account-recovery.md`
- `docs/runbooks/clerk-incident-response.md`
