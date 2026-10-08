# The simulation platform

A pre-launch test regime for AcreOS: the real app, on one virtual clock, in a
seeded market twin, watched by a continuous invariant monitor, attacked by a
red-team brain, judged by generated eval banks, and walked by personas in a
real browser. Every run writes `scorecard.json` and a one-page `scorecard.md`.

## What runs where

| Run | What | Cost |
|---|---|---|
| `npm test` (default CI) | `tests/simulation/{twin,invariants,redteam,evals,standin,platform}/*.test.ts`, `tests/unit/clockReadsRatchet`, `effectKeyFollowsTheClock`, `evidenceLadder`, `letterNumbersHaveFields`, `invariantWatchCoversRegistry`, `replyClaimsFounderOnlyAction` | seconds, in-process, no app |
| `montecarlo.sh <inst> <days≤30> <seeds…>` | the real app for up to a month per seed | minutes |
| `SIMPLAT_LONG=1 montecarlo.sh <inst> 365 <seeds…>` | **opt-in long run**: a year per seed | ~30–90 min per seed |
| `… -- --brain adversarial` | the red-team world | as above |
| `persona-walks.ts` | Playwright + axe on a running world | minutes |

## One-time setup

```
export SIMPLAT_ROOT=/tmp/simplat           # outputs
tests/simulation/platform/stack.sh sync     # prod-like copy + server bundles (pg external)
tests/simulation/platform/stack.sh build-client   # only for persona walks
tests/simulation/platform/stack.sh template # acreos_simplat_tpl: migrations + simclock + tenant tap + seed
```

## A year

```
SIMPLAT_LONG=1 tests/simulation/platform/montecarlo.sh A 365 1 2 3
SIMPLAT_LONG=1 tests/simulation/platform/montecarlo.sh B 365 4 5
SIMPLAT_LONG=1 tests/simulation/platform/montecarlo.sh B 90 6 -- --brain adversarial
npx tsx tests/simulation/evals/run.ts --out $SIMPLAT_ROOT/evals.json --app $SIMPLAT_ROOT/*/out/seed-*/pax-answers.jsonl
npx tsx tests/simulation/platform/scorecard.ts --out $SIMPLAT_ROOT/scorecard \
  --year $SIMPLAT_ROOT/A/out/seed-{1,2,3} $SIMPLAT_ROOT/B/out/seed-{4,5} \
  --redteam $SIMPLAT_ROOT/B/out/seed-6-adversarial --evals $SIMPLAT_ROOT/evals.json \
  --walks $SIMPLAT_ROOT/walks/walks.json --mutation $SIMPLAT_ROOT/invariant-mutation.json \
  --record tests/simulation/evidence/runs
```

Instances A, B, C use separate ports (5400/5410/5420, stand-ins 7900/7910/7920),
databases (`acreos_simplat_run_<inst>`) and Redis indexes (12/13/14). Ports are
checked with `lsof` before anything binds. Everything is stopped by PID.

## The pieces

- **One clock** — `server/utils/clock.ts`; SQL follows through `simclock.sql`;
  the `lint:clock-reads` ratchet counts wall-clock reads in `server/` (now 0).
- **Invariants** — `tests/simulation/invariants/`: nine business invariants,
  checked every simulated day; canaries + `mutate.mjs`; the production half
  is `server/services/invariantWatch.ts` (health check).
- **Market twin** — `tests/simulation/twin/`: counties, parcels, owners,
  replies, provider failure modes, personas, friction tickets, churn; every
  parameter has a source (`parameters.ts`).
- **Brains** — `tests/simulation/standin/brains/{capable,adversarial}.mjs`
  behind the versioned stand-in.
- **Red team** — `tests/simulation/redteam/`: generated attacks, held-out and
  blind rounds, in-process score, world score.
- **Eval banks** — `tests/simulation/evals/`: Pax (300+) and Solene (100+),
  three judges, a capped opt-in real-model judge that never runs by default.
- **Walks** — `tests/simulation/walks/persona-walks.ts`.
- **Evidence ladder** — `shared/governance/evidenceLadder.ts`; run records in
  `tests/simulation/evidence/runs/`.

## Fidelity limits

The job bodies run on the simulated calendar a few passes per simulated day
(not every 30 minutes). Redis TTLs, in-process timers and SQL `CURRENT_DATE` /
`CURRENT_TIMESTAMP` do not follow the clock. Stripe plans and credits are set
by SQL (the stand-in cannot run Checkout). Brains are scripted: E2 evidence.
