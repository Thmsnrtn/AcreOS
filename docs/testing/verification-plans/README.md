# Verification plans — what the pre-launch campaign could not cover

**Written:** 2026-10-06 · **Status of every plan in this directory:** Not yet run

The pre-launch simulation campaign (5–6 October 2026) drove AcreOS locally: a
production build, local Postgres and Redis, Chromium only, the E2E cookie
bypass (`E2E_TEST_AUTH`, `server/auth/testAuth.ts`) in place of Clerk, and no
live third-party providers. Its report lives on the branch
`claude/simulation-campaign-2026-10` at
`docs/audits/simulation-campaign-2026-10-05.md` (not on `main` at the time of
writing). That report ends with a list of things it did **not** exercise. This
directory turns each of those gaps into a plan: how it will be checked, by
whom, in what environment, what pass and fail look like, and what is still
owed.

These are **plans, not results.** Nothing in this directory says anything
passed. A plan becomes evidence only when someone runs it and appends a dated
entry to its _Run log_ with a link to the raw output.

## The plans

| #   | Area                                 | File                                                     | Owner                     | Status      |
| --- | ------------------------------------ | -------------------------------------------------------- | ------------------------- | ----------- |
| 1   | WebKit / Safari (desktop and iOS)    | [01-webkit-safari.md](01-webkit-safari.md)               | [OWNER] founder to assign | Not yet run |
| 2   | Clerk auth on staging                | [02-clerk-auth-staging.md](02-clerk-auth-staging.md)     | [OWNER] founder to assign | Not yet run |
| 3   | Stripe test mode, end to end         | [03-stripe-test-mode.md](03-stripe-test-mode.md)         | [OWNER] founder to assign | Not yet run |
| 4   | Twilio / SES / Lob sandboxes         | [04-messaging-sandboxes.md](04-messaging-sandboxes.md)   | [OWNER] founder to assign | Not yet run |
| 5   | Scale and load                       | [05-scale-load.md](05-scale-load.md)                     | [OWNER] founder to assign | Not yet run |
| 6   | Backup / restore drill               | [06-backup-restore-drill.md](06-backup-restore-drill.md) | [OWNER] founder to assign | Not yet run |
| 7   | Email deliverability                 | [07-email-deliverability.md](07-email-deliverability.md) | [OWNER] founder to assign | Not yet run |
| 8   | Screen readers on the customer doors | [08-screen-readers.md](08-screen-readers.md)             | [OWNER] founder to assign | Not yet run |
| 9   | POST-route IDOR and SSRF             | [09-post-idor-ssrf.md](09-post-idor-ssrf.md)             | [OWNER] founder to assign | Not yet run |
| 10  | Time zones and DST                   | [10-timezones-dst.md](10-timezones-dst.md)               | [OWNER] founder to assign | Not yet run |

## Rules every plan follows

1. **No fabricated results.** Every result field reads "Not yet run" until a
   run produces output. No pass rates, timings, counts or verdicts are written
   ahead of the run that produced them. This is the repo's standing rule
   ("Fabrication is never acceptable", CLAUDE.md; `lint:no-fabrication`).
2. **Thresholds are targets, not findings.** Where a plan states a number
   (latency, RTO, inbox placement), it is a **target for the founder to
   confirm**, and is labelled as one. Where an existing repo document already
   states a target, the plan cites it rather than inventing a new one.
3. **Credentials are named, never shown.** Plans name environment variables
   only. No key, token, password or webhook secret is ever written into this
   directory or its run logs.
4. **Never against production unless the plan says so.** Every plan names its
   environment. Most run on staging or a throwaway environment; the ones that
   touch production (deliverability DNS checks, read-only backup listing) say
   so explicitly.
5. **This repository is public.** Plans describe test _methods_. They do not
   describe how to exploit anything, and a failure found while running a
   security plan (#9) is reported privately to the owner first, not written
   into the run log until it is fixed.
6. **Read every verdict directly.** Capture a gate's exit status with
   `; echo EXIT=$?` against a log file, never through a pipe (CLAUDE.md,
   "a verdict you read through a pipe is the pipe's verdict").

## Run-log format

Each plan ends with a _Run log_ section. Append, never rewrite:

```
YYYY-MM-DD  ran-by=<github-login>  env=<staging|local|…>  sha=<commit>
            scope=<which procedure steps were run>
            outcome=<pass|fail|partial — with the criterion that decided it>
            evidence=<path or URL to raw output; never a summary alone>
            follow-ups=<defect ids or "none">
```

When a plan's status changes, update the row in the table above in the same
commit as the run-log entry.

## Related documents

- `docs/testing/END-TO-END-TEST-PLAN.md` — the layered Playwright plan this
  work extends.
- `docs/disaster-recovery.md`, `docs/runbooks/dr-drill-quarterly.md`,
  `docs/runbooks/dr-drill-history.md` — backup and restore (plan 6).
- `tests/load/README.md`, `tests/simulation/LOAD-TEST-SPEC.md` — existing load
  tooling and targets (plan 5).
- `tests/README-launch-audit.md` — device-cloud notes for real iOS Safari
  (plan 1).
