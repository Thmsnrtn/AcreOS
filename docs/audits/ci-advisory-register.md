# CI advisory register — every `continue-on-error` in `.github/workflows/`

*Roadmap W10.1. Pinned by `tests/unit/ciAdvisoryRegister.test.ts`, which
parses every workflow and every composite action under `.github/actions/`, and
requires the set of steps whose `continue-on-error` is anything but `false`
(an expression counts) to equal this table, row for row.*

A step that may fail without failing its job either hands its verdict on or
says plainly that it has none:

- **re-emitted** — the step is allowed to fail only so the steps after it can
  upload artifacts, page and open an issue. A later step in the same job runs
  `if: steps.<id>.outcome == 'failure'` and exits 1, so the job still goes red.
  The test checks that step exists.
- **advisory** — bookkeeping on a path that is already decided (the deploy
  already shipped, or the job is already failing). The reason says why a
  failure here must not change the outcome.

Adding a `continue-on-error` means adding a row here, or the test fails.

| Workflow | Job | Step | Class | Reason |
|---|---|---|---|---|
| borrower-cookie-e2e.yml | borrower-cookie-e2e | Borrower cookie-session E2E | re-emitted | Report and issue steps run first; "Re-emit E2E exit code" re-raises. |
| customer-journey-audit.yml | customer-journey-audit | Run customer-journey audit | re-emitted | Artifacts, page and issue first; "Re-emit audit exit code" re-raises. |
| desktop-feel-audit.yml | desktop-feel-audit | Run desktop-feel audit | re-emitted | Artifacts, page and issue first; "Re-emit audit exit code" re-raises. |
| deploy.yml | deploy | Upload source maps to Sentry | advisory | Runs after the release; a failed symbol upload must not fail a deploy that already shipped. Sentry itself is owner action K4. |
| deploy.yml | deploy | Record deployment in audit ledger | advisory | Out-of-band ledger POST after a successful deploy; the deploy's truth is Fly's release, not this row. |
| deploy.yml | deploy | Record FAILED deployment in audit ledger | advisory | Runs on a deploy that has already failed; the job is red regardless, and the founder page is a separate step. |
| staging.yml | rollback | Rollback staging deployment | advisory | Runs only after the staging health check failed, so the run is already red; a failed rollback is reported in the log. |
| actions/audit-unconfigured/action.yml | (composite) | File one standing issue | advisory | Runs only when an audit is unconfigured; the summary and warning annotation already said so, and a 403 on issue creation must not turn "unconfigured" into a red that reads like a broken flow. |
