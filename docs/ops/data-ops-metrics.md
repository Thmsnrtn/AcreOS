# Data ops metrics — `GET /api/ops/data`

Read-only, behind the ops service token (`Authorization: Bearer <OPS_SERVICE_TOKEN>`,
`opsServiceAuth` in `server/routes-ops.ts`): 503 when the token is unset, 401 for
any header that is not exactly the token, writes never reach a handler.
`?days=N` sets the window, clamped to 1..365 (default 30). Source:
`server/services/ops/dataOpsMetrics.ts`. Every number is a platform-wide
aggregate; no tenant row, org id, actor, or per-county name leaves the read
(pinned by `tests/unit/dataOpsMetrics.endpoint.test.ts`).

This page says what each number counts and **what it is divided by**. If a
number has no denominator, this page says so.

## `coverage`

Source: `county_discovery_queue`, grouped by `(state, owned_status)`.

| Field | Means | Denominator |
|---|---|---|
| `counties[]` | Raw `(state, status, counties, parcelsStored)` groups; a null status is shown as `never_requested`. | — (counts) |
| `byState[].countiesOwned` | Counties with `owned_status = 'complete'` — parcels pulled and kept by the owned pipeline. | `countiesKnown` |
| `byState[].countiesKnown` | Counties that **have a row in `county_discovery_queue`** for this state: someone searched there, or it was seeded. **This is not "every county in the state."** AcreOS records no authoritative county count per state, so the dashboard does not invent one. To show "% of the state," a reader has to join an external county list. | — |
| `byState[].inProgress` / `refused` / `failed` / `neverRequested` | The rest of the ownership lifecycle (`pending`+`processing` / `refused` / `failed` / null). | `countiesKnown` |
| `byState[].otherStatus` | Rows whose `owned_status` is outside that lifecycle. These are counted, not dropped. If it is non-zero, the pipeline has started writing a status this fold does not know. | `countiesKnown` |
| `byState[].parcelsStored` | `SUM(owned_parcels_stored)` across the state's known counties. | — (count) |

Invariant: `owned + inProgress + refused + failed + neverRequested + otherStatus = countiesKnown`.

`statewideBuilds[]` gives the latest `etl_runs` row for each `*_statewide_cadastral_v1` job (up to 2,000 most recent runs). A failed latest run reads `failed`, never the job's last good outcome.

## `fallThrough`

Source: `provider_lookup_log` rows in the window, grouped by
`(answering_layer, success, cached, provider_name LIKE 'probe:%')`. One row is
one **provider attempt**. A customer request that fails over across providers
writes one row per attempt, and the registry stops at the first success, so
each successful row is one answer served.

| Field | Means |
|---|---|
| `totalRows` | Every row in the window, probes included. |
| `probes` | `dataSourceProbe` canary rows (`provider_name 'probe:*'`). These are telemetry, not demand, so they are excluded from every rate. |
| `byLayer.<layer>.answered` / `.failed` | Successful and failed attempts for each known layer. |
| `byBucket` | Successful answers by bucket: `warehouse` (open_data + cache), `paid_platform` (vendor on AcreOS's key), `paid_byok` (vendor on the org's own key, which is the customer's spend, not AcreOS's). |
| `answersServed` | **The denominator.** Successful answers with a known layer, probes excluded. |
| `paidPer1k` | `paid_platform / answersServed × 1000`, to one decimal place. `null` when `answersServed` is 0, never 0. |
| `failedAttempts` | Attempts with a known layer that served nothing. A failed vendor attempt is **not** a paid answer. It is kept out of the rate and out of the denominator. |
| `unattributed` | Rows with no `answering_layer`, split by the `cached` flag the writer recorded. These come from rows written before migration 0287 **and**, today, from the `parcel_snapshots` (`server/services/parcel.ts`) and `cached_lookups` (`server/services/data-cache/lookup-cache.ts`) cache lanes, which do not set a layer. They are kept out of the rate and never guessed into a bucket. |
| `unknownLayers` | Layer values the fold has no bucket for. It should be `{}`. If it is not, a writer is producing a value outside `AnsweringLayer`. |
| `layerBuckets` | The bucket map itself, so a reader can see what counts as paid. |

Invariant: `answersServed + failedAttempts + unattributed.rows + Σ unknownLayers + probes = totalRows`.

The layer vocabulary is **derived from the writers**, not restated:
`tests/unit/dataOpsMetrics.layerVocabulary.test.ts` reads every `server/` and
`shared/` TypeScript file plus every migration, classifies each
`answeringLayer:` site, and holds each written value to the fold's bucket map.

## `warehouseCost`

| Field | Means |
|---|---|
| `warehouseServedLookups` | `byBucket.warehouse`: successful open_data + cache answers. |
| `cacheFlaggedWithoutLayer` | `unattributed.cachedFlag`: cache-served answers whose writer set no layer. These are **not** added to the figure above. |
| `targetUsd` | 0.001, the cost target per warehouse-served lookup. |
| `costPerLookupUsd` | Always `null` for now, with `why`. No metered infrastructure or bucket cost is recorded. The cost optimizer's Fly figure is a fixed estimate, not a bill, and dividing an estimate by a count would be a fabricated number. |

## `adapterRemaps`

For each statewide job, over the same ≤2,000 runs: `runs`, D2d remap `attempts`
(the runs whose observation carries `remap.outcome`), the attempts broken down by
outcome, and `promotionRate = promoted / runs`. `promotionRate` is `null` when
the job has no runs.

## `releaseInventory`

D2b warehouse releases. No release store exists yet, so the field reads
`{ status: "not_built", why: "no release store exists yet (D2b)" }`. That is
**never** an empty list, because an empty list would read as "zero releases".
Once a reader is wired (`loadDataOpsMetrics(now, days, reader)`), the field
becomes `status: "reported"` with:

- `releaseCount`
- `releases` (newest first)
- `current`: the release flagged current, or `null` if none or several are flagged
- `currentConflict`: `true` when more than one release is flagged current. The conflict is reported, never resolved by picking one.
- `malformedNames`: names that are not `vYYYY.MM.N`

`releaseCount: 0` then means a store that genuinely has no releases.

## `purposeLedger`

D2e person-adjacent lookups in the window, as counts by `(surface, purposeCode)`.
No actor, org, lead or parcel leaves this read.
