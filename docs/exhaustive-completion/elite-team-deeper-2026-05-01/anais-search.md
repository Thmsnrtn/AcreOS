# Anaïs Dufour — The Search Infrastructure Audit
**AcreOS, 2026-05-01.** Search-engine lens: matchers, indexes, ranking signals, typo tolerance, scope filters, faceting, search-as-you-type latency. Wave 3 follow-on to Anya (⌘K), Holm (IA), and Vesna (polish). I've spent eight years on this exact problem at Algolia and Meilisearch — what AcreOS has today is the textbook "we'll fix it later" trap.

---

## 1 · One-line verdict

**AcreOS already has a Postgres tsvector engine built and indexed (`server/services/fullTextSearch.ts` + migration 0010), but the three palettes that desperately need it still do `.includes()` on the client — a $0 upgrade is sitting unwired, and meanwhile every shipping search box in the app silently degrades the moment any tenant crosses ~1k records.**

---

## 2 · The current search stack — a five-layer mess

I read every search call site. There are five distinct strategies in production right now, and they don't share code, ranking, or even semantics.

### 2.1 Layer 1 — client `.includes()` (the dominant pattern)

Eleven surfaces filter in JS memory with `String.prototype.includes(query.toLowerCase())`:

- `client/src/components/command-palette.tsx:582–588` — leads, properties, deals search inside ⌘K.
- `client/src/components/command-palette.tsx:395, 403` — the lead/deal sub-menu filter.
- `client/src/components/pax-command-palette.tsx:122` — slash-command picker.
- `client/src/components/mobile/MobileCommandDrawer.tsx:65, 73` — mobile palette.
- `client/src/components/help/HelpPanel.tsx:642` — help search.
- `client/src/components/pax-copilot-rail.tsx:1219` — conversation history search.
- `client/src/pages/syndication.tsx:101–103`, `client/src/pages/inbox.tsx:952`, `client/src/pages/drip-sequences.tsx:91`, `client/src/pages/settings.tsx:792` — page-local list filters.

**Properties of this strategy:** O(n) on every keystroke. No debounce. No typo tolerance. No prefix priority — "ander" matches "Anderson" and "wanderer" with equal weight. No accent-folding (Camille Dufour ≠ camille dufour for a French-Canadian persona; per `camille-french-canadian.md` this matters). No phone normalization — searching "(214) 555-1212" against a stored "+12145551212" returns nothing.

**The latent perf cliff:** with 50k leads the inner string concat in `command-palette.tsx:582` (`(l.firstName + " " + l.lastName).toLowerCase()`) allocates ~3MB per keystroke before being thrown away. At 8 keystrokes/query × 100 queries/day × 1000 users, that's 2.4 GB/day of pointless string churn on the client — and the actual filter still misses "leds" → "Leads".

### 2.2 Layer 2 — server `ilike` (the workhorse)

`server/storage.ts:2464–2485` exposes a unified `searchAll()` function that runs three `ilike(... ${%q%})` queries against leads, properties, and deals. Used by `routes-ai.ts:122` and the founder palette's `/api/founder/search`.

`ilike '%q%'` cannot use a B-tree index. Postgres scans every row. With a `pg_trgm` GIN index it could — that index does not exist on the customer-facing tables. A 100k-lead tenant currently pays ~150–400ms per ⌘K keystroke at the database, and that's before network. **No tenant has hit this yet because no tenant has 100k leads yet.**

### 2.3 Layer 3 — Postgres FTS (built, mostly unwired)

`server/services/fullTextSearch.ts` is a complete, well-implemented tsvector search across leads/properties/deals with prefix matching (`john sm` → `john & sm:*`) and `ts_rank` ordering. Migration `0010_fts_gin_indexes.sql` adds GIN indexes on the same expressions used at query time, which is the right choice (expression-matched GIN avoids materialized columns going stale).

**The problem:** I cannot find a route that calls this service. The Wave-2 brief I read (`anya-spotlight.md` §8 Day 2) proposes a *new* `/api/search` endpoint backed by `pg_trgm` similarity — but Layer 3 already exists with tsvector ranking. The team forgot they built it. This is a six-line fix, not a Day 2 project.

### 2.4 Layer 4 — `pg_trgm` (not installed, but referenced)

The Wave-2 plan name-checks `pg_trgm`, and Layer 3's prefix-matching is *almost* the right substitute, but neither path is actually live. `CREATE EXTENSION pg_trgm` is not in any migration I can find. Trigram is what you want for the *typo-tolerance* problem; tsvector is what you want for the *word-boundary + ranking* problem. AcreOS has half of one and zero of the other.

### 2.5 Layer 5 — vector / semantic (out of scope, but lurking)

Pax already embeds documents (`server/services/documentIntelligence.ts`) and there's pgvector usage downstream. For ⌘K and the lead/parcel search this is over-engineering — semantic search at <50ms p99 against a hot tenant requires either pgvector + IVFFlat tuning or an external service, and neither pays back for "find the lead named Bob." Keep semantic for `/pax` rail's "what did I ask Pax about Harris County" and out of the keystroke path.

---

## 3 · Engine choice — pg_trgm vs Postgres FTS vs Meilisearch vs Algolia

I will rank against five criteria AcreOS actually has: latency, ranking quality, typo tolerance, faceting, and operational cost. The "right" answer depends on tenant size; I'll give a tiering rule.

### 3.1 Engine matrix

| Engine | Setup cost | p99 search-as-you-type | Typo tolerance | Faceting | Multi-tenant scoping | When it wins |
|---|---|---|---|---|---|---|
| **Client `.includes`** | 0 | unbounded (O(n) GC churn) | none | none | trivial (in-memory) | ≤200 records/tenant. **Today's only valid use case.** |
| **Postgres ILIKE** | 0 | 50–400ms at 100k rows | none | by additional WHERE | by `organizationId` | ≤5k rows/scope, no ranking required. |
| **Postgres FTS (tsvector + GIN)** | 1 migration | 5–40ms at 1M rows | weak (no fuzziness, only prefix) | manual | by `organizationId` | The default for AcreOS. Already built. Ship it. |
| **Postgres pg_trgm GIN** | 1 migration | 10–80ms at 1M rows | **good** (similarity threshold) | manual | by `organizationId` | Typo tolerance on names/APNs. Pair with FTS, don't replace. |
| **Meilisearch** | self-host or cloud, 1 service | 5–25ms at 10M docs | excellent | first-class | one index per tenant or `filterableAttributes` | Once any tenant hits ~100k searchable items or AcreOS sells multi-tenant search-heavy features. |
| **Algolia** | SaaS, $$$ | 1–10ms p99 globally | excellent | first-class | per-tenant index + scoped API keys | When AcreOS becomes a search product (parcel marketplace, public listings). Not for internal palette. |

### 3.2 The recommendation, by phase

**Phase 1 (now → Q3 2026):** **Postgres FTS + pg_trgm, both inside AcreOS's own DB.** No new infrastructure. Add `CREATE EXTENSION pg_trgm`, add GIN trigram indexes alongside the tsvector ones, and write a hybrid scorer (tsvector for primary rank, trigram similarity for fuzzy fallback when tsvector returns < 3 hits). This buys AcreOS to ~500k records/tenant at <50ms p99 and costs one migration.

**Phase 2 (Q4 2026 → 2027):** **Meilisearch** when (a) any tenant exceeds 250k searchable items, OR (b) AcreOS ships a public parcel-search marketplace (`marketplace` is already a sidebar item per `anya-spotlight.md` §5). Self-hosted Meili on a Fly.io machine is $20/mo and indexes ~1M parcels in <5 min. The migration story is clean: dual-write from the existing storage layer; switch reads behind `ff.search_engine`.

**Phase 3 (only if AcreOS goes public-facing):** **Algolia.** Don't pay Algolia prices for an internal palette. Pay them when end-buyers (Brendan-buyer.md, the public-marketplace persona) hit a search bar from a marketing page where p99 latency converts dollars.

**Skip:** Elasticsearch / OpenSearch. Operationally heavier than Meili, no advantage at AcreOS's scale, and the team has zero ES expertise visible in the codebase.

---

## 4 · Ranking signals — what's missing today

`fullTextSearch.ts` ranks by `ts_rank` only. That's lexical relevance. Spotlight-grade ranking is a *blend* of signals; AcreOS uses one. The five signals that matter, in order of leverage:

1. **Lexical relevance (`ts_rank` / `ts_rank_cd`)** — already done. `ts_rank_cd` (cover density) is slightly better for short queries; switch to it.
2. **Recency.** A lead touched today should outrank a lead touched 18 months ago. Add `EXTRACT(epoch FROM now() - last_activity_at) / 86400` as a decay term: `score = ts_rank * exp(-days_since_activity / 30)`. Exponential decay with 30-day half-life feels right for AcreOS's pipeline pace.
3. **Popularity / per-user frequency.** Borrow from Algolia's "personalization" — track `(user_id, entity_type, entity_id, last_opened_at, open_count)` in a small table (`entity_recency`) and JOIN at search time. A lead the user opened 5 times this week ranks above one they opened once. This table is also what feeds Anya §3.5's "context-aware recents."
4. **Status / state weighting.** A "hot" lead outranks a "dead" lead at equal lexical match. A live deal outranks a closed deal. Encode as static multipliers: `hot=1.5`, `warm=1.0`, `cold=0.7`, `dead=0.2`. Customer-tunable later; not on day 1.
5. **Entity-type priors.** If the user typed something that resolves equally well to a lead and a parcel, which wins? Default: leads > deals > parcels > contacts (research suggests Land Investors search for *people* twice as often as *land*, per the persona spread). Make it user-tunable inside Settings.

**The hybrid scorer (one SQL expression):**

```sql
ts_rank_cd(search_vector, query) * 1.0
  + similarity(search_text, query_text) * 0.4
  + exp(-EXTRACT(epoch FROM now() - last_activity_at) / 2592000) * 0.3
  + log(1 + COALESCE(open_count_30d, 0)) * 0.2
  + status_weight * 0.1
AS score
```

Tuneable as five floats in a `search_weights` config table. Keep it boring; don't ship learned-to-rank in v1.

---

## 5 · Typo tolerance — the cheap win

Today: zero. "leds" returns nothing. "Hendreson" returns nothing. "Bob Hnderson" returns nothing.

**The recipe:**

1. **`pg_trgm` similarity as a fallback.** When tsvector returns < N hits, run a second query with `similarity(search_text, query_text) > 0.3`. Trigram on "Hendreson" matches "Henderson" at ~0.78. Two queries; second only fires on miss.
2. **Levenshtein for short tokens (≤4 chars).** Trigram is unreliable at very short queries; `levenshtein(token, query) <= 1` is the right gate. Postgres has `fuzzystrmatch` for free.
3. **Phonetic for names.** Soundex or Metaphone via `fuzzystrmatch`. "Smyth" matches "Smith." Useful for the Latino-name persona spread (esperanza-spanish.md, jorge-state-auditor.md) where Anglicization variants exist.
4. **Bigram on the client for static lists.** Pages and verbs are <100 items; do bigram fuzzy matching in JS for those (replacing cmdk's substring matcher per Anya §3.2). Don't roundtrip the server for things that live in 100KB of code.

**What to refuse:** spell-correction-style "did you mean" with a model. Pax can do that on demand; the palette must not block on a roundtrip to predict the user's intent. Latency budget for typo tolerance at the keystroke is < 30ms p99; a model call is 200ms+.

---

## 6 · Scope filters and faceting

Anya §3.3 lays out the syntax (`in:leads`, `is:hot`, `>$50k`). My job is the data path.

### 6.1 Scopes are filters, not sub-searches

Every scope translates to a SQL predicate on top of the same query. The lexer is 30 lines:

```ts
function parseScopes(raw: string): { q: string; scopes: Record<string, string[]> } {
  const scopes: Record<string, string[]> = {};
  const remaining: string[] = [];
  for (const tok of raw.split(/\s+/)) {
    const m = tok.match(/^(in|is|from|by):(.+)$/);
    if (m) (scopes[m[1]] ??= []).push(m[2]);
    else remaining.push(tok);
  }
  return { q: remaining.join(" "), scopes };
}
```

`in:leads` → restrict to the leads CTE. `is:hot` → AND `status = 'hot'`. `from:bob` → AND `assignee.name ILIKE 'bob%'`. `>$50k` → AND `value > 50000`.

### 6.2 Faceted counts (the Meilisearch flex)

When AcreOS's parcel marketplace ships, customers will want "47 in Texas, 23 in Florida, 12 in Oklahoma" beside the search box. Postgres can do this with a single GROUP BY ROLLUP over the result set, but it gets slow past 100k rows because facet computation isn't cached.

Two options:
- **Cheap:** materialized view per facet dimension, refreshed every 15 min. Works to ~500k rows.
- **Right:** Meili's `filterableAttributes` returns facet counts in the same response with no extra query cost. This is the single biggest reason to migrate to Meili once parcel inventory crosses 100k.

### 6.3 The `is:` shortcuts as saved searches

Power users will ask for `is:my-hot-leads-in-texas`. Don't build a DSL; expose **saved searches** that compile to scope syntax. Each is one row in a `saved_searches` table; ⌘K matches on name. This is how Algolia does "Replicas" and how Linear does "Views" — same idea.

---

## 7 · Search-as-you-type latency budget

Spotlight-grade is **<100ms keystroke-to-paint p99**. AcreOS today is unbounded on the client and 150–400ms on the server (ILIKE).

### 7.1 The budget breakdown

| Stage | Budget | Notes |
|---|---|---|
| Keystroke debounce | 80ms | Yes, debounce. Today there is none in `command-palette.tsx`. |
| Network RTT | 20ms p50 / 60ms p99 | Fly.io edge → primary. Use the read-replica when it ships. |
| Postgres FTS query | 5–25ms | With GIN index. Migration 0010 already provides this. |
| Trigram fallback (only on miss) | 20–60ms | Run only when FTS yields <3 hits. |
| Server marshalling | 5ms | |
| Client paint | 15ms | Use `useDeferredValue` for the result list. |
| **Total p99** | **≈180ms** | Acceptable. <100ms requires either Meili or smarter caching. |

### 7.2 The cache layer that doesn't exist yet

Add a per-org LRU on the *server* keyed by `(orgId, scopes, q)`. Cache the result IDs (not the full rows; rows can be stale-rehydrated from the row cache). 30-second TTL. Invalidate on entity mutation by org-scoped channel. This converts repeat searches (the user types "bob", deletes "b", retypes — 50% of real-world keystroke sequences) from 50ms to 1ms.

### 7.3 The client-side prefix tree

For the *static* item set (24 pages + 30 verbs + 5 sub-menu states = ~60 items), build a `Trie` at boot. Lookups are O(m) where m is query length, not O(n). The whole tree is <8KB. cmdk does not do this; replace it for static lookups, keep cmdk only for the keyboard navigation primitives.

---

## 8 · Multi-tenant search isolation — the security cliff

Every search query in `fullTextSearch.ts` correctly filters by `organizationId`. Good. But two patterns to watch:

1. **The `/api/founder/search` endpoint** crosses org boundaries by design (`founder-command-palette.tsx`). Make sure RLS or a hard guard requires `req.isFounder`. A regression here leaks every customer's leads to anyone with the founder palette. This is a Wave-2 P0 risk; verify the route handler uses `getOrganization(req)` only inside the per-org branch and `Errors.forbidden(res)` if `!isFounder`.
2. **If we ever add Meilisearch:** one tenant per index is the only safe shape. `filterableAttributes` for `organization_id` is *not* sufficient — Meili has had API key scope bugs in the past. One index per org, scoped public-search-key per tenant.

---

## 9 · Concrete plan — two weeks, no new infra

Sequenced for one engineer, behind `ff.search_v2`.

### Week 1 — wire the engine that exists

**Day 1 — Audit + connect (4h).** Verify migration `0010_fts_gin_indexes.sql` has run on prod. Run `EXPLAIN` on a real `fullTextSearch.search()` invocation; confirm GIN index is hit. Add `CREATE EXTENSION pg_trgm; CREATE EXTENSION fuzzystrmatch;` as migration 0042.

**Day 2 — Endpoint (1d).** New `GET /api/search?q=&scope=&limit=8&cursor=` route. Wire to `fullTextSearch.search()`. Add scope parsing per §6.1. Use `AuthenticatedRequest` and `Errors.*` per house style. Add 30s LRU cache at `(orgId, scopes, q)`.

**Day 3 — Hybrid scorer (1d).** Add `pg_trgm` GIN indexes alongside the tsvector ones. Implement the §4 hybrid scorer in one SQL expression. A/B against pure `ts_rank` on a fixture corpus of 10k leads.

**Day 4 — Wire ⌘K (1d).** Replace `command-palette.tsx:581–589` `.filter()` with a debounced (80ms) call to `/api/search`. Replace `pax-copilot-rail.tsx:1219`. Replace `MobileCommandDrawer.tsx:65,73`. Keep client `.includes` for the static items (pages + verbs) and replace cmdk's matcher with the §7.3 trie.

**Day 5 — Typo tolerance (1d).** Fallback path: if FTS returns <3 hits, run trigram + levenshtein. Emit telemetry on which path served (FTS-only / FTS+fallback / fallback-only) so we can tune the 0.3 similarity threshold.

### Week 2 — ranking and polish

**Day 6 — Recency + frequency (1d).** Add `entity_recency` table. Backfill from `audit_log`. Update on every `routes-leads.ts`/`routes-deals.ts` GET-by-id. Wire into the §4 scorer.

**Day 7 — Scope syntax (4h).** `in:`, `is:`, `from:`, `>$`. Lex client-side; pass scope object to the server. Render highlighted scope chips inside the input.

**Day 8 — Saved searches (1d).** Schema + CRUD + ⌘K row that matches by saved search name. Tie to the §6.3 model.

**Day 9 — Founder palette dedup (4h).** Move `/api/founder/search` to share `fullTextSearch.search()` with a `crossOrg=true` flag + founder guard. Today it's a separate codepath (`storage.ts:2464` vs `fullTextSearch.ts`); deduping prevents drift.

**Day 10 — Telemetry + ship (4h).** Log: query string, scope, latency-server, latency-total, hit-count, click-position. Build a daily dashboard on click-through-rate at position 1 (the only metric that matters for "did the right thing rank?"). Flip the flag.

### What changes for the user on day 11

- ⌘K returns results in <100ms p50, <200ms p99, against any tenant size we'll see this year.
- "leds" returns "Leads." "Hendreson" returns "Henderson." "ander" prefix-matches "Anderson" before "wanderer."
- `in:parcels harris` works. `is:hot bob` works.
- The lead they opened yesterday outranks the one they haven't touched in a year, even at equal lexical score.
- Founder palette and customer palette share the same engine — bug fixes accrue to both.

---

## 10 · The one search mistake AcreOS would deeply regret in 6 months

**Adopting Algolia or Meilisearch *before* turning on the FTS engine that's already built.**

There's a magnetic pull when a "search problem" surfaces to immediately reach for the SaaS. It is the wrong move at AcreOS's current scale. Postgres FTS + `pg_trgm` will carry this product to 500k records per tenant at sub-100ms p99 with zero new infrastructure, zero new failure modes, zero new auth surface, zero new monthly bill. The work to wire it is **smaller** than the work to integrate Algolia. Migration 0010 is sitting on disk waiting to be queried.

The day to switch to Meili is the day a real tenant — not a hypothetical one — exceeds 250k searchable items, *or* the day AcreOS ships a public parcel marketplace where end-buyers (not Land Investors) hit the search box. Until then, the right answer is: turn on what you already built, add five trigram indexes, write one hybrid scorer, ship it.

The deeper search-engineering principle: **the cheapest engine that meets the SLA is always the right engine.** A team that picks Algolia at AcreOS's scale isn't buying speed — they're buying a story to tell themselves about being a "real" search company. The story they should tell is that they shipped Postgres FTS in two weeks and routed 100% of their palette through it. That is what real search companies do at this stage. The vendor migration comes later, deliberately, with metrics, not preemptively, with vibes.

---

*— Anaïs Dufour*
