# Founder-side autonomy simulation ("Can Solene run the business?")

Simulates the FOUNDER side of AcreOS against a production-like build, with
the outside world (customers, Stripe, SES, Twilio, ntfy, the model providers)
played by local stand-ins. Nothing here talks to a real provider.

## Pieces

| File | What it is |
|---|---|
| `world-shim.mjs` | `node --import` preload for the web, worker and harness processes: Clerk stand-in (offline MFA lookup) + egress ledger/firewall. Every outbound HTTP(S) call is logged to `$WORLD_EGRESS_LOG`; per host, `$WORLD_EGRESS_RULES` decides `refuse` (default) / `fail:<n>` / `hang` / `mock`. |
| `simdb.sql` | `simsnap.*` functions installed into the sim DB only: `take()` / `restore()` (clean world between scenarios) and `age_world(interval)` (time passes: every timestamp column shifted back, so JS and SQL clocks stay real and agree). |
| `seed.ts` | Founder + customer identities the E2E test-auth bypass resolves to. Refuses the shared sim DBs. |
| `simkit.ts` | Shared kit: world reset/aging, stand-in + egress rules, the founder's surfaces (`founderView`), the registered job bodies on a simulated clock (`defaultJobs` + `advance`, each through the real `withJobLock`), egress classification, ask pricing, `recordEvent` → `autonomy-ledger.jsonl`, and throwing `vacuity()` guards. |
| `s01-zero-customers.ts` | S1 (+S13): zero customers, 30 days, founder absent. Variants `dispatch` / `all-on` / `fixed-digest`. |
| `s02-05-customer-events.ts` | S2 activation stall, S3 support tickets, S4 dunning, S5 churn. |
| `s06-14-founder-events.ts` | S6 trusting founder, S7 absent founder, S8 outages, S9 adversarial model, S10 panic stop, S11 dispatch execution, S12 AI spend, S14 legal/compliance intake. |
| `s01-team.ts` | Stage 2 gate (S1+S3+S11): 30 days, zero paying customers, the founder's one-time setup (`simkit.founderOneTimeSetup`: switches, trust levels, two bounded witness grants) then absent; role workers on realistic scripted answers; a trial signup's five tickets on day 2; an empty Writer answer injected on day 20. Records: content published through the publish gate, ticket handling with the $50 ceiling, no hard-stop crossed, the empty result counted as a failure. |
| `roleScripts.ts` | Stage 2: deterministic, realistic scripted model answers for the role workers (articles that clear the publish gate — checked before they are served — and correct support handling), served by the stand-in's `canned:` mode extended with `sequence` (by assistant turn) and `cases` (by a substring of the first user message). |
| `founder-walk.ts` | Part B: the four founder doors on iPhone + desktop viewports — visible text, screenshot, word count, jargon hits, controls < 44px. |
| `b-chat.ts` | Part B: three plain-English requests through Solene chat and the steer box (stand-in in `script` mode — plumbing only). |
| `ledger-table.ts` | Part C: `autonomy-ledger.jsonl` → `autonomy-ledger.md` (event × outcome × minutes, smallest fix, weekly mix vs the 24-minute target). |
| `_explore.ts` | One simulated day with every job, printing the raw job/ask/dispatch picture (debug aid). |

## Running

Prerequisites: Postgres with a database `acreos_founder` built by
`scripts/ci/build-schema-from-repo.sh`, `simdb.sql` loaded into it and
`select simsnap.take()` run once after the first worker boot + `seed.ts`;
Redis; a production build in a copy of the repo WITHOUT `.git`/`docs/`
(e.g. `/tmp/acreos-prodlike`, `node_modules` symlinked, `HOME` an empty dir);
the model stand-in on its own port with `canned:<file>` support.

Environment (one file, loaded inside `env -i` so no container credential
reaches the app): the sim env template, then `DATABASE_URL=…/acreos_founder`,
`PORT=5187`, every model base URL pointed at the stand-in (including
`ANTHROPIC_BASE_URL`), fake provider keys, `WORLD_*` shim variables and
`SOLENE_DISPATCH_TRANSCRIPT_DIR`.

1. Web: `cd /tmp/acreos-prodlike && env -i … node --import <this dir>/world-shim.mjs dist/index.cjs` (`WORLD_ROLE=web`, `FLY_PROCESS_GROUP=app`).
2. Worker: same, `dist/worker.cjs`, `PORT=5188`, `FLY_PROCESS_GROUP=worker`, `E2E_TEST_AUTH` unset, `WORKER_DISABLE_SCHEDULED_JOBS=1` and `DISABLE_BACKGROUND_JOBS=1` (the harness runs the scheduled job bodies on the sim clock; the worker's Solene dispatch consumer still runs for real, wall clock).
3. Harness (each scenario): `cd /tmp/acreos-prodlike && env -i … DISABLE_BACKGROUND_JOBS=1 SERVER_ROOT=/tmp/acreos-prodlike SIM_BASE_URL=http://localhost:5187 FOUNDER_SIM_OUT=<results dir> node --import <this dir>/world-shim.mjs --import tsx <this dir>/<scenario>.ts <variant>`
   - `s01-zero-customers.ts dispatch 30`
   - `s02-05-customer-events.ts s2|s3|s4|s5`
   - `s06-14-founder-events.ts s6|s7|s8|s9|s10|s11|s12|s14`
   - `b-chat.ts`
4. Walk (after S1, S6, S7, against the state that scenario left): `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers SIM_BASE_URL=http://localhost:5187 FOUNDER_SIM_OUT=<dir> npx tsx founder-walk.ts after-s1`
5. Ledger: `FOUNDER_SIM_OUT=<dir> npx tsx ledger-table.ts`

Stage 2 notes: any database named `acreos_founder`, `acreos_founder_<x>` or
`acreos_b2` is accepted (one per concurrent sim). The baseline world now has
Stripe UP (`PROVIDERS_UP` mocks `stripe.com`; world-shim answers refunds and
the balance probe in Stripe's shape), so an outage is something a scenario
does. The role workers are recognised by the first line of their system
prompt, `AcreOS role worker — <Role>`.

Scenarios share one database and must run one at a time. Two AcreOS servers
must never share a port (the app binds with `reusePort: true`, so a second
server silently load-balances across two databases).

## Fidelity notes

- The scheduled jobs run through the same `withJobLock` the worker uses, but
  driven by the harness on a simulated clock, not by the worker's timers. A
  consequence: `job_runs` (written only by `scheduleSelfRescheduling`) gets no
  tick rows — which is also true in production for `solene_continuous_tick`
  (registered with `trackInterval` + `withJobLock`).
- `age_world` ages Postgres only. Redis TTLs and in-process caches do not age.
- `script` mode answers are content-free: they test plumbing, never judgement.
  Anything that needs real model judgement is listed as "needs oracle" in the
  report, never graded here.
