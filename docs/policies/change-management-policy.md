# Change Management Policy

**Policy owner:** Founder
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + on material CI/CD changes
**Audience:** SOC 2 Type II (CC8.1), engineering.

---

## 1. Purpose

Defines how changes to production systems are proposed, reviewed,
approved, deployed, and recorded. The objective: every production change
has a documented PR, approver, deploy actor, and timestamp — and the
auditor can prove it.

## 2. Scope

Any change to:

- Application source code or static assets
- Database schema (migrations in `/migrations/`)
- Infrastructure (Fly config, Cloudflare rules, GitHub workflows)
- Production environment variables / secrets
- Third-party vendor integrations

## 3. Standard change path

1. **Branch + PR.** All changes land via PR against `main`. Direct commits
   to `main` are blocked by branch protection.
2. **Automated checks.** TypeScript check (`npm run check`) and tests run
   in `.github/workflows/test.yml`. PR cannot merge while checks fail.
3. **Human review.** PR requires at least one approving review. At
   headcount = 1, this is the founder reviewing their own work — a
   documented material weakness mitigated by the audit ledger (see
   `docs/separation-of-duties.md`).
4. **Merge.** Squash-merge into `main`.
5. **Deploy.** `.github/workflows/deploy.yml` runs automatically on push
   to `main`: TypeScript check, tests, build, Sentry source-map upload,
   `flyctl deploy --remote-only`, post-deploy health check, and a
   `POST /api/admin/deployments` to record the deploy in the ledger.
6. **Verify.** Founder verifies prod state matches expectation; rollback
   per §5 if not.

## 4. Emergency changes

For Sev-1/2 incidents, the standard path may be compressed:

- PR is still required; review may be a single-line self-review by the IC.
- Tests still run; if a test failure is unrelated to the fix, it may be
  documented in the PR and bypassed by the founder (this is a known
  workflow gap — `continue-on-error: true` is set on the test step in
  the deploy workflow today).
- The PR description must reference the active incident (URL or
  runbook).
- A postmortem is required within 5 business days.

## 5. Rollback

- **App rollback:** redeploy the previous `GIT_SHA` via `flyctl deploy
  --image <prev-image>` per `docs/runbooks/rollback.md`. The rollback
  itself is recorded in `deployments` with `status=rollback` and
  `rollback_of_deployment_id` pointing at the deploy being undone.
- **DB rollback:** schema-only rollbacks via a forward-fix migration.
  Data rollbacks via DR restore (`runbooks/07-database-restore-from-snapshot.md`).

## 6. Evidence

Every production deploy produces:

- A merged PR (GitHub)
- A GitHub Actions workflow run (GitHub)
- A `deployments` row with `git_sha`, `deployed_by`, `approved_by`,
  `workflow_run_url`, `deployed_at` (AcreOS DB)

These three sources are independently retrievable for 7 years.

## 7. Migrations

- Schema changes ship as numbered SQL files in `/migrations/` (currently
  through 0081).
- The deploy workflow applies pending migrations via the Fly release
  command before the new app version takes traffic.
- Destructive migrations (DROP TABLE / DROP COLUMN) require an explicit
  PR comment with the founder's approval, and a backout plan.

## 8. Vendor changes

Adding a third-party vendor requires updating `docs/vendor-inventory.md`
in the same PR. The CI is encouraged to fail on a mismatch (future work).

## 9. Related documents

- `docs/runbooks/rollback.md`
- `docs/runbooks/db-migration-failed.md`
- `docs/runbooks/pgbouncer-rollout.md`
- `docs/separation-of-duties.md`
