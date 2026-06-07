# Iyari — Chief of Future — Elevation Memo (2026-06-07)

> Lens: the long-arc moat + R&D. The observation-log compounding asset, data-moat
> depth, agentic-web positioning, distinctive bets that compound, what to
> prototype *small* now to win in 2-3 years.
>
> Framing discipline (per my charter): every item below is "if X is true at
> scale, our current architecture would need Y — here's the smallest experiment
> that tells us whether X is true." Built-to-learn, not built-to-ship. I am not
> proposing production commitments; I'm proposing prototypes and the substrate
> that keeps the *option* open.

---

## What I actually found (grounded survey)

The keystone of my domain is real and well-built:

- **The acorn is planted.** `migrations/0121_parcel_observations.sql` +
  `server/services/data-cache/observation-log.ts` — append-only, fire-and-forget,
  org-leading composite index, second index on `(apn, field, observed_at)`. The
  strategic note in the migration header ("the one asset you cannot buy
  retroactively") is exactly right. This is the single most important file in the
  company's long-game.

- **But the acorn is banked, not compounded.** Only **two** write paths feed it
  (`server/services/parcel.ts:479`, `server/services/etlHandlers.ts:173`) and
  exactly **one** reader mines it: `server/services/parcelDeltaDetector.ts`, which
  compares **the latest TWO observations per (apn, field)** and nothing more
  (line ~363: "window the latest two per (apn, state, county, field)"). We are
  storing a *time series* and computing a *first difference*. The whole point of
  owning history is the third, fourth, and tenth points.

- **Agentic-web foundation is laid but undiscoverable.** `server/mcp-server.ts`
  (auth'd tool surface) + `server/mcp/safeIntents.ts` (read-mostly filter derived
  from the App Intent registry) + `server/openapi-reflector.ts` (>1,000 live
  routes auto-documented). This is genuinely ahead of the curve. But
  `client/public/.well-known/` contains only `security.txt` — there is **no
  `llms.txt`, no agent manifest, no public MCP discovery card.** An AI agent
  shopping for land-data tools on the open web literally cannot find us.

- **Network effect is shallow but real.** `server/services/marketNetworkContributor.ts`
  — anonymized comps, MIN_COHORT=5, price-per-acre rounded to $500. Good privacy
  model. It contributes *closed-deal pricing* only; it ignores the far richer
  signal sitting in `parcel_observations` and `county_discovery_queue`.

- **Eval corpus is a quiet masterstroke.** `land_intelligence_reports` (0127)
  doubles as the labeled free-data corpus that `paidDataEvalHarness.ts` diffs
  against paid providers (0132). This is the right way to make the
  buy-paid-data decision data-driven. It is underused as a *research* asset.

- **My own watch loop is not built.** No `server/services/iyari/futureWatch.ts`,
  no `iyari_audit_findings`. Charter scopes this to Phase-3 activation, so this is
  expected — but flagged below because the cheapest version is worth seeding now.

The verdict: we have planted the highest-value seed in the company and built a
genuinely forward MCP surface, but we are not yet *mining* the longitudinal
asset, and the agentic web cannot discover us. Both are correctable cheaply, now,
while the data is small and the schema is malleable.

---

## Top ideas (highest value first)

### 1. Mine the time series, not the first difference — the "Parcel Biography" engine
**develop · both · effort M**

Today the only thing we compute from `parcel_observations` is "did the latest
value differ from the one before it" (`parcelDeltaDetector.ts`). That throws away
the entire reason to own history. With N observations per `(apn, field)` we can
compute things **no paid provider sells** because they don't own the longitudinal
log: assessed-value *velocity and acceleration*, owner-tenure distributions per
county, tax-delinquency *recurrence patterns* (a parcel that goes delinquent
every 3rd year is a different lead than one delinquent for the first time),
and "this parcel's owner has now held it 11 years — the county median sell-turn
is 6" as a derived seller-likelihood prior.

**What "great" looks like:** every parcel page has a "Biography" strip — a sparkline
of assessed value over time, owner-change markers, tax-status band — rendered
entirely from observations we already captured for free, with provenance chips
already in place. A first customer says "PropStream shows me *today*; AcreOS shows
me the *story*." That sentence is the moat in one line.

**First step:** add `server/services/parcel-biography.ts` — a read-only aggregator
over `parcelObservations` keyed by `(apn, field)` returning the full ordered
series + derived deltas/velocity. Reuse the existing `(apn, field, observed_at)`
index. Surface behind the Map/Deals door parcel card. No new table; this is pure
read elevation of an asset we already pay to capture.

---

### 2. Publish `llms.txt` + a public agent-discovery card — make the agentic web find us
**elevate · customer · effort S**

We built the hardest part (MCP JSON-RPC at `server/routes.ts:1353`, safe-intent
filtering, OpenAPI reflector) and skipped the easiest, highest-leverage part:
being *discoverable* by the agents we built it for. In 2-3 years a meaningful
slice of SaaS evaluation and even daily usage runs through AI agents, not humans
clicking. The site that an agent can read, understand, and call wins distribution
that competitors relying on human-only UX cannot.

**What "great" looks like:** `/.well-known/llms.txt` describes AcreOS in
agent-legible prose with links to the public `/tools/parcel-check` widget, the
OpenAPI spec, the data-provenance page, and the MCP endpoint with its
read-mostly tool list. An agent asked "find me a land-parcel data API" can
self-serve a parcel-check call and cite us. This is the cheapest distinctive bet
on the board.

**First step:** generate `client/public/.well-known/llms.txt` from the live
App-Intent registry + `openapi-reflector.ts` output (so it never drifts), and add
a `/.well-known/ai-plugin.json`-style manifest pointing at `/api/mcp`. Beatrice
reviews the public surface; Soren reviews the voice (truth-engine still applies —
describe only shipped capabilities).

---

### 3. Backfill the acorn from history we can still reach — one-time, irreversible-if-skipped
**develop · founder · effort M**

The migration header says backfilling is impossible. That's true for the
*future* — but for the **counties we already crawl**, many ArcGIS endpoints expose
*assessment-year* or *deed-date* fields, and some expose multi-year tax history.
Every day we don't capture those into `parcel_observations` with their real
`observed_at`, we lose the cheapest depth our time series will ever have. The
delta detector and the Biography engine (#1) are starved until the log has more
than 2 points per parcel — which, at one observation per lookup, takes *years* to
accumulate organically.

**What "great" looks like:** a one-time backfill job reads the historical fields
already returned by `county-gis-provider.ts` / `regrid-provider.ts` (assessment
year, prior assessed values, deed dates) and writes them as observations with
**backdated `observed_at`**. Day one of first-customer usage, a parcel shows a
5-point assessed-value trend instead of a single dot.

**First step:** audit which seeded counties (`county_gis_endpoints`) return any
historical field; write `scripts/backfill-observations.mjs` (built-to-learn,
ugly is fine) that records them. This is a now-or-never window — flag it loudly.

---

### 4. A "Coverage Compass" — turn `county_discovery_queue` demand into a public moat signal
**elevate · both · effort M**

`county_discovery_queue` (0125) is a brilliant demand-driven coverage engine
(misses enqueue, demand_count bumps, a worker auto-discovers + probes + activates
for $0). Right now it's plumbing. It is also a **proprietary demand map**: which
counties land investors are actually searching, ranked by real demand, that no
competitor has. That dataset compounds with every miss.

**What "great" looks like:** internally, a founder surface that shows "the 10
counties customers want next, by demand" drives the data-acquisition roadmap.
Externally (later, carefully), an anonymized "where land investors are looking"
heatmap on the `/learn` band is the kind of distinctive, link-worthy artifact
that earns inbound — the demand map *is* the marketing.

**First step:** read-only `server/services/coverage-compass.ts` aggregating
`county_discovery_queue` by demand + resolution status; render on a founder
surface first. The public heatmap is a later, Beatrice-gated graduation.

---

### 5. Make the eval corpus a research instrument, not just a buy-decision audit
**improve · founder · effort S**

`land_intelligence_reports` + `paidDataEvalHarness.ts` already give us a labeled
free-vs-paid divergence corpus per parcel. We use it for one question ("should we
buy Regrid?"). The same corpus answers a far more strategic one: **which fields
does free data get *wrong* often enough to matter, and which counties?** That tells
us where our free-data moat is genuinely competitive vs where we're exposed — the
difference between "we're as good as paid for 80% of fields in 30 counties" (a
moat) and "we're guessing on the deal-killer fields" (a liability we should know
before a customer finds out).

**What "great" looks like:** a standing "free-data confidence map" — per
(field × county) divergence rate from the corpus — that feeds both the confidence
chips customers see *and* the data-acquisition priority. Honest data layer becomes
*self-aware* data layer.

**First step:** extend `paidDataEvalHarness.ts` output (or a sibling reader over
`paid_data_eval_runs`) to roll divergence up by `(field, county)`; surface on the
existing `/founder/paid-data-eval` page. Reuses everything; adds an aggregation.

---

### 6. Probe frontier long-horizon reasoning against the corpus — the "would a model beat fusion?" experiment
**develop · founder · effort M**

We fuse ~8 sources with hand-tuned weights (`dataIntelligenceEngine.ts` — gradient-
boosting-*logic*, not an actual learned model). The honest question for the 2-3
year horizon: would a frontier model, given the full parcel biography (#1) + the
provenance-tagged corpus, produce a *better-calibrated* opportunity score than our
heuristic fusion? We have the calibration harness already (`calibration.ts`,
Brier score). This is a clean, falsifiable, sandbox-only experiment.

**What "great" looks like:** a 2-week sprint with a written learning report:
"given identical inputs, model-judged scoring is +/- N Brier points vs heuristic
fusion across M corpus parcels." Kill, incubate, or hand to Andrei to productionize.
This is exactly the prototype pattern my charter exists to run — and it costs only
inference against data we already hold.

**First step:** `server/services/iyari/scoring-probe.ts` (prototype-grade) reading
`land_intelligence_reports` corpus read-only, scoring via a model, diffing
calibration against the stored heuristic score. Pure research; no production path
until graduation. (Anthropic SDK / model-id details: I'll confirm current model
ids before running rather than assume.)

---

### 7. Seed the lightweight version of my own watch loop now
**improve · founder · effort S**

My charter scopes `futureWatch.ts` + `iyari_audit_findings` to Phase-3 activation,
and that's the right gate for the *full* 6-detector loop. But the cheapest,
highest-value detector — **"the acorn stopped growing"** (observation insert rate
dropped to ~0, meaning a write path silently broke) — is worth seeding now,
because a silently-empty observation log is the one failure that destroys the
entire long-game *and is invisible until years later*. Fire-and-forget logging is
exactly the pattern that hides its own failure.

**What "great" looks like:** a tiny daily check (or a metric in `/api/health`)
that asserts "N observations written in the last 24h > 0 once we have traffic,"
fed to the existing provider-health surface. Insurance on the most important asset
we own, for a few lines of code.

**First step:** add an observation-rate gauge to the existing health/provider-health
path (`server/services/providers/` health rollup). Defer the full
`iyari/futureWatch.ts` loop to Phase 3 as chartered.

---

## My single BOLDEST elevation bet

**Become the longitudinal source-of-record for U.S. land — the dataset nobody can
buy back.**

Every competitor sells a *snapshot*: what a parcel looks like today. The thing
that cannot be replicated, cannot be purchased retroactively, and compounds every
single day is the **biography** — the assessed-value trajectory, the owner-tenure
clock, the tax-delinquency recurrence pattern, the deed cadence — for every parcel
any customer ever touches, captured for the marginal cost of one async insert.

Items #1 (mine the series), #3 (backfill while we still can), and #4 (the demand
map) together flip `parcel_observations` from a *cache derivation* into the
company's *primary durable asset* — one that gets more valuable with time and
with every customer, that a paid-data competitor with infinite money still cannot
buy because the history wasn't recorded. In 2-3 years the pitch isn't "we have
land data" (commodity); it's "we have the only continuous record of how American
land actually changes hands, and we render it as a story per parcel." That is a
moat denominated in *years elapsed*, which is the only moat a bootstrapped company
can build faster than a funded one.

The bet is bold because it asks us to invest in depth *before* a single customer
has asked for it — but the asymmetry is total: the cost today is near-zero, and
the window to capture backdated history (#3) closes a little more every day.

---

## Small high-ROI polish refinements

- **`llms.txt` stub today** — even a hand-written 20-line `llms.txt` beats nothing
  while #2 builds the auto-generated version. Discoverability has a zero-effort
  floor. (`client/public/.well-known/`)
- **Add `observed_at` provenance to the parcel card freshness UX** — the
  Biography sparkline can wait, but showing "first seen / last confirmed" from the
  observation log on the parcel card is a one-query trust signal.
- **`marketNetworkContributor` should also contribute *observation* signals**, not
  just closed-deal comps — county-level owner-change *rate* and tax-delinquency
  *rate* are network goods derivable from observations with the same privacy model
  (cohort ≥5, no APN). One more aggregation, materially deeper network effect.
- **Document the acorn in CLAUDE.md "Known monoliths"-style note** — a one-line
  "the observation log is append-only, never UPDATE/DELETE, fire-and-forget" rule
  so no future contributor accidentally treats it as a mutable cache and severs
  the time series. The contract lives only in the file header today.
- **Tag corpus rows with the data-grounding prompt version** — so when
  `DATA_GROUNDING` evolves, the corpus stays diff-able across prompt generations.
  (`land_intelligence_reports` — add a `grounding_version` column on next migration.)
- **`paid_data_eval_runs` trend, not just latest** — the schema denormalizes
  `decision_flip_rate`; one sparkline of that over runs turns a point-in-time audit
  into a "is free data keeping up as counties change" signal.

---

## The one thing that would most embarrass us

**A sharp first customer — or worse, an AI agent acting for one — discovers that we
built a full MCP / agent-callable tool surface and the agentic web cannot find it,
while simultaneously discovering that the parcel page shows a single data point
where we have been silently sitting on the time series the whole time.**

The embarrassment is doubled because both gaps reveal the same thing: we built the
*hard* substrate (append-only longitudinal log, MCP JSON-RPC, safe-intent filter,
OpenAPI reflector) and skipped the *cheap last mile* that turns substrate into a
visible, distinctive capability. A technical first customer (which ours will be —
Land Investors who use PropStream are data-literate) will look at a flat parcel
card, look at the provenance chips that promise we're an honest data company, and
ask "you clearly capture history — where is it?" Having the answer be "in a table
nobody reads yet" is the gap I'd least want them to find. #1 and #2 close it.
