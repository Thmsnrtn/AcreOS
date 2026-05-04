# Observability — Sampling & Cost Posture

**Last updated:** 2026-05-04
**Owner:** Thomas (founder) until otherwise delegated.

## Sentry — current sampling defaults

These defaults live in `client/src/lib/sentry.ts` and are env-overridable
without redeploy via Fly secrets prefixed `VITE_SENTRY_*`.

| Knob | Default (prod) | Default (dev) | Env override |
|---|---|---|---|
| Session replay sample rate | **0.01** (1%) | 0.0 | `VITE_SENTRY_REPLAY_SESSION_RATE` |
| On-error replay sample rate | **0.5** (50%) | 0.0 | `VITE_SENTRY_REPLAY_ON_ERROR_RATE` |
| Trace sample rate | **0.05** (5%) | 0.0 | `VITE_SENTRY_TRACES_RATE` |
| Profile sample rate | **0.0** | 0.0 | `VITE_SENTRY_PROFILES_RATE` |

## Free-tier headroom (Sentry)

| Quota | Free-tier cap | Projected at 100 customers |
|---|---|---|
| Errors | 5,000 / mo | ~900 / mo (well within) |
| Performance units | 10,000 / mo | ~2,250 / mo (well within) |
| Replays | 50 / mo | ~458 / mo (over) — see below |

The replay quota is the only category at risk. With on-error rate dropped
from 1.0 → 0.5 on 2026-05-04, projected falls from ~915 → ~458/mo. Still
exceeds free tier, but cuts the over-quota burn rate by half.

## Revisit triggers

- **MRR > $5K** — re-evaluate. Either pay for Replay SKU (≈$80/mo) or
  drop `VITE_SENTRY_REPLAY_ON_ERROR_RATE` further (0.5 → 0.2).
- **Customer reports a bug we cannot debug** without replay → temporarily
  bump on-error rate to 1.0 for 14 days, then drop back.
- **Sentry billing alert** → drop replay session rate to 0.0 (only
  capture replay around errors, never speculatively).

## Where to change it

- **Code default:** `client/src/lib/sentry.ts` (the `readRate(...)` calls)
- **Runtime override:** Fly secrets — `fly secrets set VITE_SENTRY_REPLAY_ON_ERROR_RATE=0.5`
- **Dashboard view:** `/founder/observability-cost` (added Wave 10)
