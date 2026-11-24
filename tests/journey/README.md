# Journey-proof harness

The prerequisite every vertical sheet assumes (Step 0 `_platform.md` §1.1):
a declarative walk spec, a CI rehearsal runner, a staging runner, and a
record writer that puts the evidence **into the repo**.

## Layout

| File | What it is |
|---|---|
| `walk-spec.ts` | The spec format + validation. Imports nothing; erasable TS only, so the staging CLI can load specs without pulling in server code. |
| `runner.ts` | `runWalk` (executes a spec against a driver, stops at the first failure), `renderWalkRecord`, `writeWalkRecord`. |
| `drivers/realdb.ts` | CI rehearsal: real API sequence on a real database built from this repo. Route modules are imported dynamically, after the test file's mocks. |
| `drivers/staging.ts` | Staging: HTTPS + `X-E2E-Auth-Token` + persona cookie; fresh org per run; version read from staging's own `/api/version`. |
| `specs/<vertical>.ts` | One declarative spec per vertical. `specs/index.ts` is the registry. |
| `../scripts/run-journey-walk.ts` | The staging CLI. |

## The spec format

A spec is data + leg closures. Legs use **only** the `WalkContext`
(`api`, `sql`, `check`, `store`/`get`, `note`, `sentCount`, `driver`).
A leg that imports server code directly breaks staging portability.

- **Steps** carry `id`, `title`, `kind` (`api` | `sql` | `observe` |
  `pax` | `manual`), `how`, and `mustObserve` (what PASS means, in plain
  words). `sql` steps need a `stagingRun` or `staging.mode: "manual"`.
- **Fences** are structural: `noSend`, `noRealMoney`, `stagingOnly` must
  all be true; validation rejects anything else.
- **Pax leg**: every spec has at least one `pax` step. It may be
  `blocked` (with the reason — which tools are missing) but a blocked leg
  keeps the walk PARTIAL, never a pass.
- **Simulations**: a step with `simulated: true` must carry
  `simulationNote`; the record renders it in the step AND in a
  Simulation footnotes section.
- **Manual steps**: operator acts (UI-only seeding, the e-sign rail).
  The runner records them as NOT RUN and the walk stays PARTIAL. A manual
  step may `collect` values later steps need (e.g. ids of records the
  operator created); a missing value fails the walk loudly.

## Running

```bash
# CI rehearsal (the test workflow's shards already do this — realdb tests
# run wherever ACREOS_REAL_DATABASE_URL is set):
npx vitest run tests/journey/wholesale.harness.test.ts

# Pure unit tests (no database):
npx vitest run tests/journey/walk-spec.test.ts

# Staging (needs ACREOS_STAGING_E2E_TOKEN in the environment; the token is
# never printed or written to the record):
npx tsx scripts/run-journey-walk.ts --spec wholesale --check   # validate + probe /api/version
npx tsx scripts/run-journey-walk.ts --spec wholesale           # walk + write the record
npx tsx scripts/run-journey-walk.ts --spec wholesale --input txAssignment=12 --input ilAssignment=13
```

Exit codes: 0 = PASS, 2 = PARTIAL (manual step or blocked Pax leg
remains), 1 = FAIL or refused to start.

## The record

`docs/evidence/<ET date>/<spec>-journey-walk.md`, with run id, ET
timestamp, deployed image SHA, and per-step observed results. The SHA is
staging's own `/api/version` answer, verbatim: today that endpoint
returns `{"sha":"unknown"}` (the build does not set `VITE_GIT_SHA`), and
the record says so rather than carrying a SHA from anywhere else.

## Adding a vertical

1. Copy `specs/wholesale.ts` as the shape; write the spec's steps from
   the vertical's walk script, keeping each step's `mustObserve` honest
   about what the leg actually checks.
2. Register it in `specs/index.ts`.
3. Add a rehearsal test next to `wholesale.harness.test.ts` (same mocks
   pattern; `describe.runIf(realDbAvailable)`).
4. Run the rehearsal in CI; run the staging CLI for the in-repo record.
5. If the vertical needs a Pax leg exercised, the tools must exist first
   — declare the leg `blocked` with the reason until they do.
