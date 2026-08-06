# Dimension 10 — Performance

The customer-facing list pages (`/leads`, `/properties`, `/deals`) are genuinely
paginated with SQL `LIMIT/OFFSET` and are well-indexed — the W5.3 wave fixed the
worst "load the whole org, score in JS" antipattern on the primary list routes.
The surviving defect class is **unbounded in-memory aggregation on the hot
paths that were never converted**: the default landing door (`/api/today`), the
`storage.getLeads/getDeals/getProperties/getNotes` family (a hard `.limit(5000)`
cap or no cap at all, 34+ call sites), and a computed-score `ORDER BY` that no
index can serve. The bundle-size "gate" that should bound client weight is
orphaned — it runs in no CI workflow and self-skips when the build is absent, so
its baseline is unenforced.

---

### F-10-1 — The Today door (door #1) loads four whole tables into memory on every open
**Severity:** P1 serious
**Surfaced by:** slice 10 (performance)
**Survives which gates:** No pagination lint exists; the route returns a
consolidated payload (a legitimate shape) so `lint:reachability` and route-order
gates pass. No test asserts a row-count bound. `test:bundle-size` is client-only.
**Evidence:** `server/routes-today.ts:1075-1085` —
```
storage.getLeads(orgId), storage.getDeals(orgId),
storage.getProperties(orgId), storage.getNotes(orgId)
```
all awaited in one `Promise.all`, then filtered/scored in JS below (task filter
`:1088+`, alert map, lead scoring). `client/src/pages/today.tsx:197` fetches
`/api/today` as the landing query — this fires on every login/home visit.
**What's wrong:** Today is the canonical first customer door. Its server payload
pulls the entire leads, deals, properties, and notes tables (capped at 5000 each
except notes which is uncapped — see F-10-2) into Node memory and does the
ranking in JavaScript. On a 10,000-lead tenant this is ~4 large scans + tens of
thousands of JS iterations synchronously per home load.
**Impact:** Burns trust after sale — the first screen every customer sees is the
slowest to render as their data grows; TTFB on `/api/today` degrades linearly
with org size. Hurts the customer who actually succeeds and accumulates data.
**Fix:** Push the ranking into SQL: `getTasks` already filters by due date —
add `WHERE due <= now()` LIMIT; replace the four full loads with targeted
count/aggregate queries + a bounded "top N candidates per source" query. The
Today queue only renders a small ranked list; it never needs all rows.
**Gate it:** Add an integration test that seeds 10k leads and asserts
`/api/today` issues no query returning >N rows (assert via a query-count/row-cap
spy). Ratchet baseline: current unbounded loads = 4 in this handler.
**Effort:** M
**Blast radius:** `server/routes-today.ts` `gatherToday*` helpers.
**Confidence:** high — read the handler and the client query.

---

### F-10-2 — `getLeads/getDeals/getProperties` cap at 5000, `getNotes` is uncapped; 34+ callers load the whole set into memory
**Severity:** P1 serious
**Surfaced by:** slice 10
**Survives which gates:** The `.limit(5000)` reads as "bounded" to any reviewer
and to lint; nothing flags that the bound is above the tenant size the campaign
targets, or that the cap silently drops rows. No ratchet counts unbounded
`storage.get*` fan-out reads.
**Evidence:** `server/storage/leadRepo.ts:16-27` `getLeads … .limit(5000)`;
`server/storage/propertyRepo.ts:16-22 .limit(5000)`;
`server/storage/dealRepo.ts:15-21 .limit(5000)`;
`server/storage/noteRepo.ts:62-66` `getNotes` — **no `.limit` at all**.
Callers of unbounded `storage.getLeads(`: 34 (grep, excluding Paginated/Cursor/
ByIds), incl. `server/services/digest.ts:105`, `alerting.ts:113/316/412`,
`priorityAction.ts:25`, `aiContextAggregator.ts:62`, `routes-today.ts:1082`,
and `routes-leads.ts:261` (`/api/leads/focus` loads 5000, scores all in JS,
`.slice(0,10)`).
**What's wrong:** Two problems in one pattern. (1) Performance: every one of
these call sites materializes up to 5000 rows into Node and iterates them in JS
— digests, alerts, AI context, the Today feed. (2) Correctness: on a >5000-row
tenant the `ORDER BY createdAt DESC LIMIT 5000` silently drops the *oldest*
rows, so alerts/digests/focus/AI-context quietly operate on a truncated set with
no error — a fabrication-adjacent silent data loss.
**Impact:** Burns trust after sale; the truncation is invisible until a customer
notices their older leads never appear in a digest or the focus list.
**Fix:** Replace the fan-out reads with purpose-built bounded queries (SQL
aggregates for digests/alerts; `LIMIT n` "top candidates" for focus/context).
Where a full scan is truly needed (export), stream via cursor. Give `getNotes` a
cap or paginate it.
**Gate it:** Ratchet the count of `storage.get{Leads,Deals,Properties,Notes}(`
call sites outside repo/pagination modules — baseline 34 (leads) — direction
down; forbid new ones in ESLint. `getNotes` uncapped: add the `.limit`.
**Effort:** L (34 sites)
**Blast radius:** the four repos + ~34 service/route callers.
**Confidence:** high — read the repo defs and enumerated callers.

---

### F-10-3 — Stage-filtered `/leads` sorts by a volatile, non-indexable score expression → two full org scans per page view
**Severity:** P2 real
**Surfaced by:** slice 10
**Survives which gates:** The query IS paginated (`LIMIT/OFFSET`), so it passes
the "no pagination" bar. No gate inspects whether the `WHERE`/`ORDER BY` can use
an index.
**Evidence:** `server/storage/leadRepo.ts:95-127` `computedScoreSql()` — a
15-branch `CASE` built on `now()` and per-row date math; `stageConditionSql`
wraps it as `score >= 80` etc. `getLeadsByComputedStage` (`:132-176`) filters
`WHERE <formula-band>` then `ORDER BY desc(computedScoreSql()), desc(id)`, and
runs a separate `count()` with the same formula `WHERE` first.
**What's wrong:** The stage band and the sort key are the same time-dependent
expression. Postgres cannot index a `now()`-based expression, so each
stage-filtered page does a **full org seq-scan computing the CASE for every
lead** — once for `COUNT(*)`, once for the sorted `SELECT` — even though only 25
rows are returned. `leads_score_idx` (the stored `score` column) is unused here
because the query recomputes score at read time.
**Impact:** Burns trust after sale; `/leads` filtered by Hot/Warm/Cold (a common
default) gets slower linearly with org size. At 10k leads it's ~20k CASE
evaluations per page click.
**Fix:** Materialize the score into the stored `leads.score` column via the
existing scoring job (there is a `lastScoreAt`), then filter/sort/index on the
real column; or make the score a `GENERATED` column excluding `now()` and index
it, computing recency decay in a cheap outer band.
**Gate it:** none possible cheaply (a query-plan assertion test is the honest
gate: `EXPLAIN` must not show `Seq Scan` on leads for a stage page). Effort to
gate ≈ effort to fix.
**Effort:** M
**Blast radius:** `leadRepo.ts` scoring path + the scoring job.
**Confidence:** high — read the formula and the query.

---

### F-10-4 — The bundle-size gate runs in no CI workflow and self-skips when the build is missing → the baseline is unenforced
**Severity:** P2 real
**Surfaced by:** slice 10
**Survives which gates:** It IS the gate — and it gates nothing. The brief asks
whether the `test:bundle-size` baseline is honest; it is not enforced.
**Evidence:** `package.json:53` defines `test:bundle-size`. It appears in **no**
`.github/workflows/*` (grep for `bundle-size`/`check-bundle` across workflows =
0 hits); it is not in `check` (`package.json:15`) nor `test` (`vitest run`). Its
only reference is `scripts/verify-launch-ready.sh:61`
`run_check_optional "Bundle size check"` — an optional, non-blocking local
script. And `scripts/check-bundle-size.js:31-34`: when `dist/public/assets/` is
absent it prints `SKIP` and `process.exit(0)`.
**What's wrong:** The 600 KB/chunk and 3 MB total limits are never checked in CI.
The one place it's invoked is (a) local-only and (b) non-blocking, and even a
blocking invocation exits 0 if the build hasn't run. So the "baseline" is
aspirational — a regression that ships a 2 MB chunk passes every gate.
**Impact:** Burns trust after sale — heavy pages (property-map.tsx is 3,824 LOC;
properties.tsx 3,450) can bloat their lazy chunks unnoticed, hurting TTFB for
customers on slow connections. Not a blocker (pages ARE lazy-loaded via 226
`React.lazy` splits in App.tsx, so the risk is per-chunk not whole-app).
**Fix:** Add a CI step after `npm run build` (ci.yml already builds at :92) that
runs `node scripts/check-bundle-size.js`, and make the script `exit 1` (not 0)
when `dist/public/assets/` is missing so a broken build can't green it.
**Gate it:** the fix IS the gate. Record measured limits: 600 KB single chunk /
3000 KB total JS (`scripts/check-bundle-size.js:11-12`).
**Effort:** S
**Blast radius:** `ci.yml`, `check-bundle-size.js`.
**Confidence:** high — grepped all workflows and read the script + `check`.

---

### F-10-5 — Nearby-properties query casts text lat/lng to FLOAT per row → full table scan, no geo index
**Severity:** P2 real
**Surfaced by:** slice 10
**Survives which gates:** No index-coverage gate; the query returns `.limit(5)`
so it looks cheap in code review.
**Evidence:** `server/services/propertyIntelligenceEnhancements.ts:21-33`
`findNearbyProperties` — `WHERE ABS(CAST(${properties.latitude} AS FLOAT) - lat)
< range AND ABS(CAST(${properties.longitude} AS FLOAT) - lng) < range`. Schema
`shared/schema.ts:1270-1277`: properties indexes cover org/status/apn/createdAt
— **no index on latitude/longitude**, and both are stored as text (hence the
CAST). Reached by `/api/properties/by-location` (`routes-properties.ts:176`) and
`/api/properties/:id/nearby`, used by property-map.tsx (`:1454`).
**What's wrong:** `CAST(text AS FLOAT)` in the predicate is non-sargable — even
if a btree existed on the text column it couldn't be used. Every nearby lookup
seq-scans the org's properties casting two columns per row. `LIMIT 5` doesn't
help because the filter must scan to find the 5.
**Impact:** Burns trust after sale on the map surface for property-heavy tenants;
each pin's nearby/comps panel pays a full scan.
**Fix:** Store lat/lng as `double precision` (or add generated numeric columns),
add a composite/GiST index, and drop the CAST; or adopt PostGIS `geography` +
GiST for true radius queries. Short term, a btree on the numeric columns + range
predicate without CAST is sargable.
**Gate it:** `EXPLAIN` assertion in a test that `/by-location` does not `Seq
Scan` properties; or a schema lint that lat/lng-filtered columns be numeric+indexed.
**Effort:** M (type migration touches ingestion writers)
**Blast radius:** `propertyIntelligenceEnhancements.ts`, properties schema,
enrichment writers.
**Confidence:** high — read the query and the schema index block.

---

### F-10-6 — Map surface silently shows only the first 100 properties of a large tenant
**Severity:** P3 minor (perf-framed; correctness overlap → slice 09)
**Surfaced by:** slice 10
**Survives which gates:** none; `pageSize` is clamped to 100 server-side
(`routes-properties.ts:84 max(100)`) and the client requests exactly that.
**Evidence:** `client/src/pages/maps.tsx:1058-1060`
`fetch("/api/properties?page=1&pageSize=100")` with no subsequent pages fetched
for the map markers. Deals map query same shape (`:1072`).
**What's wrong:** The map is capped at 100 markers. This is a *deliberate* perf
guard (loading 10k markers would kill the browser), but there is no
viewport/bounds query behind it — the other 9,900 properties are simply absent
from the map with no UI indication.
**Impact:** Neither blocks nor burns immediately, but a property-heavy customer
sees a map that quietly omits most of their portfolio. Flagged for slice 09's
correctness lens as the honest owner.
**Fix:** Replace the flat `pageSize=100` with a viewport-bounded query
(`/by-location` or a bbox endpoint) + clustering, so the map shows what's in view
rather than an arbitrary first-100.
**Gate it:** none possible (product decision). Note for slice 09.
**Effort:** M
**Blast radius:** maps.tsx, a new bbox endpoint.
**Confidence:** medium — confirmed the fetch; did not trace every map render path.

---

## Coverage ledger

**Examined exhaustively:** the leads/properties/deals list + pagination paths
(`routes-leads.ts`, `routes-properties.ts`, `routes-deals.ts`, `leadRepo.ts`,
`propertyRepo.ts`, `dealRepo.ts`, `noteRepo.ts`); the Today aggregation
(`routes-today.ts` load block); the bundle-size gate (`check-bundle-size.js`,
`package.json`, all `.github/workflows/*`, `verify-launch-ready.sh`);
`findNearbyProperties` and the properties/leads index blocks in
`shared/schema.ts`; the map/property client fetches
(`maps.tsx`, `properties.tsx`, `property-map.tsx` query sites); code-splitting in
`App.tsx` (226 `React.lazy`) and `vite.config.ts` manualChunks presence.

**Examined by sampling:** the 34 unbounded `storage.getLeads(` callers (read the
list + spot-checked digest/alerting/focus, not all 34); AI-in-request-path (grep
only — matches were inherently-AI routes, not verified line-by-line).

**Did NOT examine:** founder surfaces' server query cost beyond the file-size
list (autopilot-control.tsx 1,799 LOC not traced to its endpoints); the finance
/ rent-roll / borrower-portal server aggregations; `runScheduledJobs.ts` job
query cost; actual measured TTFB / cold-start numbers (no running DB in this
read-only slice — all findings are static query-shape analysis, not profiled
timings); WebSocket/realtime fan-out cost; `provider_cache` hit-rate under load.

## Constitution Collisions

None. All findings are performance defects in existing surfaces; none propose a
new nav entry, a new AI destination, marketplace/public-API expansion, or any
money-custody change. F-10-1's fix stays behind the existing Today door; F-10-6's
bbox endpoint is a child of the existing `/api/properties` surface, not a new door.
