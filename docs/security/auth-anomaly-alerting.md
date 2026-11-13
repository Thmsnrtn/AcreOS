# Auth-anomaly alerting — detection proposal (PKG-6c)

Status: **proposal + pure checker. Nothing is wired.** Detection only.

## What exists

`shared/security/authAnomaly.ts` — `evaluateAuthEvents(events, now?)`, a pure
function (no I/O, no persistence, no clock read, no provider call). Given a
batch of `{ kind: sign_in_failure | sign_in_success, identifier, ip, occurredAt }`
it returns findings, deterministically sorted. Tests:
`tests/unit/authAnomaly.test.ts`.

Rules (all thresholds are exported constants, **PROPOSED — tune on first real data**):

| Rule | Fires when |
|---|---|
| `identifier_burst` | >= 5 failures for one identifier within 10 minutes |
| `ip_burst` | >= 20 failures from one /24 (IPv4) or /64 (IPv6) across >= 5 distinct identifiers within 10 minutes |
| `success_after_burst` | a success for the SAME identifier within 15 minutes after that identifier's burst reached threshold |

Windows are closed intervals (exactly 10:00 apart is inside). One identifier
hammered from one IP is `identifier_burst`, not `ip_burst`. IPv6 uses /64 so a
single host rotating addresses within its prefix stays one subnet. An event whose
IP cannot be parsed still counts toward the identifier rules and is skipped by
`ip_burst`.

## The signal problem, stated plainly

- There is **no in-repo sign-in failure signal today.** Clerk hosts the
  credential step; the server never sees a failed attempt.
- `auth_fail_attempts` is **dead schema**: no writers, no readers. It is not a
  source and this proposal does not revive it.
- The Clerk Backend API calls in `server/auth/clerkAuth.ts` expose success-side
  data only.
- The checker is therefore useless until something feeds it failures. Until then
  the honest status is: **no auth-anomaly detection is running.**

## Proposed source

Clerk webhooks (session / sign-in events), received and forwarded to this
checker **from the ops side**, not by a new AcreOS route, table or job.

**Caveat — must be confirmed before any wiring:** which failure events Clerk
actually emits (and whether failed sign-ins carry identifier and IP) has not been
verified against Clerk's documentation. If Clerk emits only success-side session
events, rules (a) and (b) cannot be fed from it and the source must be rethought;
rule (c) also depends on failures. Confirm first; do not assume.

## Response

A finding means: **brief Tom immediately** (security class). **No automatic
account actions** — locking, disabling or forcing resets are Tom's call. The
checker describes; people decide. Repeat runs over overlapping batches will
re-report the same burst; de-duplicate on (rule, identifier or ip, windowStart).

## Out of scope (named, not forgotten)

- WISP and LQ-05 items.
- Persistence of events or findings (would need a new table — fenced).
- Routes, webhook receivers, jobs, sends.
- Any automated response.
