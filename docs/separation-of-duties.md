# Separation of Duties (SoD) Matrix

**Policy owner:** Founder (Thomas Norton)
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + on every team headcount change
**Audience:** SOC 2 Type II auditor (CC6.1, CC6.2, CC6.3), cyber underwriting.

---

## Current state — single-operator (Material Weakness)

AcreOS today is a one-person team. The founder holds every privileged role
listed below. **This is a documented material weakness** that a SOC 2 Type II
auditor will call out. The mitigations are:

1. **Documented break-glass procedure** — see §3. Every break-glass action is
   recorded in `audit_events` and shows up on the next access review.
2. **Automation of high-risk operations** — destructive operations
   (production deploys, secret rotations, DB restores) all run through
   scripts/CI that produce immutable evidence (the new `deployments` table,
   `audit_log` hash chain, and `secret-rotation-history.md`).
3. **External engagement at headcount=1** — engaging a quarterly external
   reviewer to "shadow-audit" privileged operations until the team grows
   past one person.

The auditor's opinion is likely to be **qualified** until headcount > 1 in
the relevant roles. This is acknowledged and accepted; the company is
pre-Series-A and the cost/benefit of premature hiring outweighs the audit
benefit.

---

## 1. Roles and who can perform them today

| Role | Today (single-operator) | Target at headcount=4+ |
|---|---|---|
| Deploy to production (push to main → Fly) | Founder | Engineer; founder reviews PRs but does not push directly |
| Access production database (SSH / psql) | Founder | DBA / SRE; engineers use ephemeral break-glass |
| Rotate secrets | Founder | Security lead; founder approves rotation but does not execute |
| View customer PII at rest | Founder | Customer Success (read-only) + engineering on-call (read-only via masked views) |
| Approve refunds > $1,000 | Founder | Finance + founder dual-approval |
| Approve a privileged role assignment | Founder | Security lead + founder dual-approval |
| Disable a customer account | Founder | Customer Success; founder is notified |
| Restore from backup | Founder | SRE + founder co-sign |
| Update billing rates / plans | Founder | Finance |
| Manage GitHub branch protection / required reviews | Founder | Engineering manager |

---

## 2. Conflicts to enforce as headcount grows

Once team headcount > 1 in any row, these conflicts MUST be enforced:

| Conflict | Why |
|---|---|
| The person who writes a deploy MUST NOT be the only approver of the PR | Prevents single-person production push |
| The person who rotates a secret MUST NOT be the only person who logs its rotation | Prevents falsified evidence |
| The person who can approve a refund > $X MUST NOT be the same person who issued the refund | Anti-fraud (segregation classic) |
| The person who can grant a privileged role MUST NOT be the role recipient | Anti-self-promotion |
| The person who can disable audit logging MUST NOT exist (no such role) | Audit log is append-only by trigger |

---

## 3. Break-glass procedure (single-operator era)

Until headcount > 1, the founder must self-impose break-glass rigor for
high-risk operations:

1. **Pre-action note** — before performing a high-risk operation (DB write
   that bypasses the app layer, secret rotation, deploy outside CI),
   write a one-line entry in `docs/runbooks/break-glass-log.md` describing:
   what's about to happen, why, expected duration, what could go wrong.
2. **Perform the action** through the documented runbook (always — never
   ad-hoc).
3. **Post-action note** — in the same log, record: what actually happened,
   what was changed, evidence link (audit_events row, deployments row,
   commit SHA), and any unexpected effects.
4. **Audit event** — every break-glass action MUST produce at least one
   `audit_events` row (via `auditLog()` from `server/utils/auditLog.ts`)
   tagged with `action="break_glass.*"`.

The quarterly access review surfaces every `break_glass.*` event from the
prior quarter; the founder reviews them as if they were performed by
another person and signs off (or flags) in the review email reply.

---

## 4. Two-person rule (target state)

The Series A bar is two-person enforcement for these specific actions:

- Production database write outside the app layer
- Restore from backup
- Secret rotation marked `reason=compromise`
- Granting a new `owner` or `admin` role on the platform
- Disabling MFA enforcement for any account

Today none of these have a two-person rule. The mitigations in §1 (automation
+ audit trails) substitute until headcount supports it.

---

## 5. Quarterly review evidence

Each quarterly access review (see `server/jobs/accessReview.ts`) lists every
`owner`/`admin` role-holder. The founder must, in the same review,
acknowledge every conflict above that is or is not currently enforced.
Auditor evidence is the reply-email signed off + the audit_events row
emitted by the access review run.

---

## 6. Change history

| Date | Change |
|---|---|
| 2026-05-27 | Initial SoD matrix authored. Material Weakness declared for single-operator state. Break-glass procedure formalized. |
