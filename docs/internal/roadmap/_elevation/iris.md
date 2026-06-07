# Iris — CTO Elevation Brief

**Date:** 2026-06-07
**Lens:** Architectural elevation — data backbone, latency, unify-the-spines done safely, code health, deploy/scaling, observability depth. Both customer and founder runtime quality.
**Posture:** Pre-first-customer. The reliability and honesty substrate that shipped is genuinely strong (provider registry with provenance + circuit breaking + per-category TTL + stale-while-revalidate; fetchGeo SSRF/timeout/retry; OTel tracing; correlationId middleware; read-replica; migrate-mirror CI guard; cached health endpoint). This brief is NOT a punch list of launch gaps — it is the work that takes a good system to a best-in-class one. Everything below is grounded in what's actually in the tree today.

---

## The single most important finding: we have FOUR parallel data front-doors

This is the headline. The "honest data layer" work shipped a clean spine — but it landed *beside* the old ones rather than *replacing* them. Today a parcel lookup resolves through one of four different code paths depending on which door the customer walked through:

| Front-door | File | Caller surface | Cache | Provenance contract |
|---|---|---|---|---|
| **Provider Registry** (the good one) | `server/services/providers/provider-registry.ts` | public widget probes, `dataSourceProbe.ts`, `healthCheck.ts` | `provider_cache` + per-category TTL + SWR | full `source/asOf/classification/confidence` |
| **Data Source Broker** | `server/services/data-source-broker.ts` (1,906 lines) | `routes-public-parcel-check.ts` (the public `/tools/parcel-check` widget!) | own logic | partial |
| **Data Source Lookup** | `server/services/data-source-lookup.ts` | `routes-deals.ts`, `checklistAnnotation.ts` | flat 30-day, `data: any` | none — own ad-hoc `LookupResult` |
| **Parcel Intelligence Fusion** | `server/services/parcelIntelligenceFusion.ts` | `routes-data-intelligence.ts`, `properties/index.ts` | `data-cache/land-intelligence-store.ts` | partial |
| (+ honest `landProfile.ts`) | `server/services/landProfile.ts` | `routes-properties.ts` | composes enrichment | full + gaps list |

**Why this is the #1 elevation item:** the same parcel, looked up from Deals vs. Properties vs. the public widget, can return *different freshness, different provenance chips, and a different cached value* — because each path has its own cache table and its own (or no) provenance model. The honesty contract we're proud of is only enforced on one of the four doors. A sharp first customer who cross-checks the same APN in two places and sees two answers is the exact credibility wound the honest-data work was built to prevent. This is also the "unify-the-spines completion path done safely" my lens is explicitly charged with.

---

## Top ideas (highest value first)

### 1. Collapse the four data front-doors onto one provider-registry spine — strangler-fig, behind a flag
**refine · both · L**
The provider registry is the correct nucleus: it already has tiering, credit metering, circuit breaking, license-aware caching, per-category TTL, SWR, and the provenance contract. The other three front-doors are pre-honesty-era code that should become thin adapters over it, then be deleted.
- **What "great" looks like:** exactly one path from "I have an APN/coords" to "here is a `LookupResult` with provenance." Deals, Properties, the public widget, and Fusion all consume the same cache and the same freshness. One place to reason about cost, one place to reason about staleness.
- **First step:** write a `resolveParcel(input, ctx)` facade in `server/services/providers/` that wraps `providerRegistry.enrichAll`, and migrate `routes-public-parcel-check.ts` off `data-source-broker` first (highest external visibility, the public widget). Gate behind `UNIFIED_PARCEL_SPINE=1`, shadow-compare outputs for a week (log diffs, don't switch), then flip. Repeat for `routes-deals.ts` → retire `data-source-lookup.ts`. Fusion stays as a *scoring layer on top of* the registry, not a parallel fetcher.
- **Safety:** the shadow-compare phase is the "done safely" — no customer sees a changed value until the diff log is clean.

### 2. Make `enrichAll` actually parallel with a shared credit budget
**improve · customer · M**
`provider-registry.ts:330` — `enrichAll` runs categories **sequentially** with a comment admitting "For simplicity, run sequentially to track balance correctly." On the customer daily loop (Land Snapshot pulls 6-8 categories), that serializes 6-8 network round-trips. At ~200-400ms each that's 1.5-3s of avoidable latency on the exact surface my charter budgets at p95 < 300ms.
- **What "great" looks like:** categories fan out in parallel; credit budget is reserved atomically up front and reconciled after, instead of decremented serially.
- **First step:** introduce a `CreditBudget` token that pre-authorizes `creditBalance` and is debited via `Promise.allSettled` results; free categories never touch it. Add a latency test asserting `enrichAll` of N categories ≈ slowest single lookup, not the sum.

### 3. Move the circuit breaker out of process memory
**improve · both · M**
`provider-registry.ts:101` — circuit state is an in-process `Map`. We run **two process groups** (`app` + `worker`, per `fly.toml`) and `auto_stop_machines = 'suspend'`. So: (a) the worker and app have independent, uncoordinated views of which providers are down; (b) every machine wake after idle starts with an empty breaker and re-hammers a known-dead federal endpoint; (c) a flapping county GIS endpoint trips on app-1 but app-2 keeps hitting it. We already persist `provider_health` (migration `0122`) — the breaker should read/write there.
- **What "great" looks like:** one shared, durable view of provider health; a wake doesn't reset hard-won circuit state; the breaker and the `/api/health` provider panel agree.
- **First step:** back `isCircuitOpen/recordFailure` with the `provider_health` table (short in-memory TTL cache over it to keep the hot path fast). Add a half-open probe so recovery is tested by one request, not the whole fleet.

### 4. Decompose `runScheduledJobs.ts` into a declarative job table
**develop · founder · L**
`server/jobs/runScheduledJobs.ts` is **4,745 lines** registering ~70 jobs, each a hand-rolled `setInterval` plus wall-clock gating like `if (now.getUTCHours() === 13)` / `if (minute < 5)`. This is a cron engine reimplemented by copy-paste, and it's the most fragile high-leverage file in the founder runtime. The file even documents a past bug where ~70 jobs ran dark in production for an unknown period, and another where a job called a non-existent export and threw hourly. Both are *symptoms of the lack of a registry*.
- **What "great" looks like:** jobs declared as data — `{ name, schedule: '0 13 * * *', ttl, kill_switch_env, run }` — in a typed registry; one runner iterates it; cadence is testable without booting Express; a missing `run` export is a compile error, not an hourly runtime throw.
- **First step:** define `interface ScheduledJob` and a `JOBS: ScheduledJob[]` array; port the 6-8 founder-critical jobs first (morning brief, briefing, reserve-floor, unit-economics, telemetry rollup). Add a unit test that asserts every job's cron string parses and every `kill_switch_env` is documented. The `withJobLock` cross-process discipline stays; only the registration boilerplate dies.

### 5. Split `shared/schema.ts` (16,878 lines / 462 tables) into domain modules
**refine · founder · M**
One file, 462 `pgTable` declarations, 635 indexes. This is the worst merge-conflict magnet in the repo, it bloats the TS server's memory and every IDE that opens it, and it makes the schema impossible to reason about by domain. The migrate-mirror guardrail makes this *safe* to do — runtime DDL lives in `migrate.mjs`, so re-organizing the Drizzle declarations is a pure source-layout change with zero migration risk.
- **What "great" looks like:** `shared/schema/parcels.ts`, `schema/billing.ts`, `schema/founder.ts`, `schema/pax.ts`, etc., re-exported from a barrel `schema/index.ts` so every `@shared/schema` import keeps working unchanged.
- **First step:** carve out the cleanest domain first (e.g. the provider/parcel data tables — `provider_cache`, `parcel_observations`, `parcel_alerts`, `provider_health`) into `schema/parcels.ts`, re-export, run `npm run check` + `migrate --dry-run` to prove zero diff. One domain per PR.

### 6. Stand up a latency/load harness — make the p95 budgets real
**develop · both · M**
My charter budgets p95 < 300ms on the customer daily loop and < 2s on heavy founder routes. Today there is **no rig that measures it** — the only "load test" file in the tree is a version-check unit test. Budgets you can't measure are aspirations.
- **What "great" looks like:** a k6 (or autocannon) script hitting the daily-loop routes (Today, Map tiles, Land Snapshot, Deals list) against staging with `E2E_TEST_AUTH`, asserting p95 thresholds, run in CI nightly so a regression is a red build, not a customer complaint.
- **First step:** add `tests/load/daily-loop.k6.js` covering the five customer doors; wire a non-blocking nightly GitHub Action (we already have `staging.yml` + the E2E mobile harness to model it on). Start by *recording* p95, then turn on thresholds once we know the baseline.

### 7. Pre-warm the daily-loop on machine wake (own the cold start)
**elevate · customer · S**
`fly.toml` runs `auto_stop_machines = 'suspend'` / `min_machines_running = 0` — the correct $0-runway call pre-launch, but it means the *first* customer request after idle eats a 1-2s cold start, on the daily loop, for the person whose first impression matters most.
- **What "great" looks like:** the wake path is invisible. The `/api/health/cached` check already wakes the machine; we can use that wake to warm the hot query plans and the provider perf-score cache before the human's first real request lands.
- **First step:** on boot, fire a tiny warm-up that touches the daily-loop queries (read-replica) and primes `getPerfScoresSync`/`getTrailingMrrSync`. Cheap, and turns a 2s first-paint into a sub-second one. Revisit `min_machines_running=1` only at the $200 MRR trigger — pre-warm gets 80% of the benefit for $0.

---

## Boldest elevation bet

**One parcel resolution spine with a per-field provenance ledger that the whole product reads from — and that becomes the moat.** (idea #1, taken all the way.)

Don't just collapse the four front-doors into one facade — make the unified spine write every resolved field to the append-only `parcel_observations` log we already built (migration `0121`) as a *first-class provenance ledger*, and have **every** customer surface (Deals, Properties, Map, the public widget, Pax's grounding context) read from that one ledger. Then:
- The delta detector (`parcelDeltaDetector.ts`) stops being a special case and becomes "the ledger changed."
- Pax's hallucination guard grounds on the same ledger the UI renders, so Pax and the screen can never disagree.
- "How do you know this?" becomes a real, per-field, time-stamped answer with source + as-of date for *anything in the product* — not just the one honest door.

That last property is the distinctive thing. Land investors have been burned by confident-but-wrong data their whole careers. A platform where every single number is click-through-traceable to its source and timestamp, *consistently everywhere*, is a credibility moat no scraped-data competitor can fast-follow — because it's an architectural property, not a feature. The four-spine fragmentation is the only thing standing between us and that being true. It's an L, but it's the L that makes the honesty story actually true instead of mostly true.

---

## Small high-ROI polish refinements

- **`enrichAll` balance comment lies** (`provider-registry.ts:334`) — "Run lookups in parallel" then runs them sequentially. Fix the behavior (idea #2) or at minimum fix the comment so it doesn't mislead the next reader.
- **`paidProviderAllowed` fails *open* on a stale MRR read path worth re-checking** — `getTrailingMrrSync` defaults to 0 (fails safe, good) but verify the catch-branch can't ever leave a stale unlocked value; add a test asserting "MRR fetch throws → paid data stays locked."
- **No half-open probe in the breaker** — recovery currently waits for the full 5-min window then lets *all* traffic back at once (`provider-registry.ts:505`). Let one request test the water first.
- **Health check fan-out on `enrichAll` health page** could be `Promise.allSettled` rather than serial (`healthCheckAll` at `:368` is already parallel-ish but worth confirming under load).
- **`data-source-lookup.ts` uses `data: any`** throughout — once it's retired (idea #1) this whole `any`-soup goes away; until then it's a CLAUDE.md `no-as-any` violation hiding in a non-route service.
- **Zero client component tests** (412 server `.test.ts`, **0** client). Not asking for full coverage — but the daily-loop's data-rendering components (provenance chips, Land Snapshot, confidence annotations) deserve a handful of render tests so a refactor can't silently blank a chip.
- **`migrate.mjs` is 6,662 lines** — it's load-bearing and works, but it's at the size where it wants the same domain-split treatment as the schema; lower priority, flag for the quarterly debt review.
- **OTel is wired but defaults to no-op** (`tracing.ts:57`, `OTEL_EXPORTER=none`). Pre-launch is the moment to point it at a free Honeycomb/Grafana tier so we have *traces of the first real customer's sessions* instead of starting cold the day something breaks.

---

## The one thing that would most embarrass us

**A sharp first customer pastes the same APN into the Deals door and the Properties door (or the public `/tools/parcel-check` widget) and gets two different answers — different flood determination, different owner-of-record, or one fresh and one months-stale — because each door runs a different data spine with a different cache.** We built an entire honest-data layer specifically so the product never shows a confident wrong number. But that contract is enforced on only one of four front-doors today (`provider-registry.ts`), while the public widget runs `data-source-broker`, Deals runs `data-source-lookup` (`data: any`, flat 30-day cache, no provenance), and Properties runs `parcelIntelligenceFusion`. The very first customer who cross-checks will find the seam, and it will read as "their data can't even agree with itself" — the worst possible first impression for a platform whose entire pitch is trustworthy data. Idea #1 closes it; it should be the top architectural priority before customers arrive.
