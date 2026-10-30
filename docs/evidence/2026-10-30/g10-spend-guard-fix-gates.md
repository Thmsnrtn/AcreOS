# G10 spend-guard fix — gates log (2026-10-30)

Branch `claude/g10-spend-guard-fix`, based on main `58d1a9b`. Verdicts below were
read from files with the exit code captured (`cmd > out.txt 2>&1; echo $?`), never
through a pipe, after editing had finished.

## Gates

| Gate | Result | Notes |
|---|---|---|
| `npm run check` (full `&&` chain) | exit 0 | First two runs failed `lint-reachability` (see below); fixed, third run green |
| `npm run build` | exit 0 | |
| Focused: reachabilityGate, aiCostCeilingFailOpen, aiConcurrencyCap, aiRouter, aiSpendGuard, aiCostCeilingDefault, aiRouterAllowanceAndOrigin | exit 0 — 7 files, 66 tests | |
| `npm test` (full suite) | FULL_SUITE_RESULT | See "Full suite" |
| Staging demonstration | NOT RUN | See "Not done" |
| k6 / burst re-run of the four limiters | NOT RUN | See "Not done" |

## Acceptance tests (all exist and pass)

`tests/unit/aiCostCeilingFailOpen.test.ts` — real pg pool at `postgres://127.0.0.1:1/g10dead`, fresh module graph per test, logger captured:
- customer call with dead DB returns allow, not throw (warn names `ai_cost_ceiling_overrides unreadable`)
- customer call through the aiSpendGuard entry proceeds to the (stub) provider
- unreadable overrides fall back to tier defaults ($2/day, $20/mo)
- background call with dead DB still fails closed at the 70% bucket (1050 cents; log line `platform ceiling unreadable; failing CLOSED for autonomous caller`)
- quota gate under metering outage throws `AIQuotaUnavailable` (503, `AI_QUOTA_UNAVAILABLE`), message contains no SQL

`tests/unit/aiConcurrencyCap.test.ts` — provider stubbed with a held promise, no spend:
- concurrency cap trips at 5 per org (6th gets 429 `AI_CONCURRENCY_EXCEEDED` with `retryAfterSeconds`; other org unaffected; all slots free afterwards)
- concurrency slots free on throw
- routeAITask and the aiSpendGuard raw path share ONE counter (3 + 2 = 5, then 6th refused on either path)
- an org-less caller is not bounded
- the terminal handler emits 429 + `Retry-After: 2` + named code

## Falsification (the fix undone on purpose)

- Ceiling + quota changes reverted → 3 of 5 fail-open tests red (customer dead-DB, tier fallback, quota refusal). The aiSpendGuard-entry test stayed green: caller-side swallow still covers it (defence in depth, as the package allows). The background test stayed green: it is the regression test for unchanged behaviour.
- Slot release moved out of `finally` → "slots free on throw" red.

## Reachability ratchet

Newly unreachable exports from this change failed `lint-reachability` twice (+2, then +3). Fixed by allowlisting five symbols in `scripts/ratchets/reachability.json`, each with a reason and revocation condition. No baseline was raised; all 11 counts are at baseline.

## Not done (stated plainly)

- **Staging demonstration** (dead-DB gate call and concurrency trip observed on staging): not run. This container has no staging credentials/URL and no way to run the branch on the pinned app machine short of a manual deploy of an unreviewed branch to shared staging, which was not authorised. The same behaviours are proven in-process by the tests above using the G10 run's dead-DB method.
- **k6 burst re-run of the four limiters**: not run (no `k6` binary, no staging target). No rate limiter, limiter config or non-AI path was touched; the bound lives only inside the two AI entry points.
- Redis-backed cross-instance enforcement, last-known-good cache behaviour, authenticated-tier enforcement: out of scope per the package.
