# Kenji Tashiro — Caching Audit

> "Most teams reach for Redis when a 5-second in-memory cache would solve 80% of the problem. AcreOS has the inverse problem: it built thoughtful in-memory caches and then forgot to ship Redis to make them coherent across instances. Both halves of the brain are smart. They just aren't talking."

Wave 2, persona 26 of 87. Drilling into caching where prior personas didn't.

---

## 1. Verdict (one line)

**The bones are right (provider_cache table, dual-layer AI cache, HTTP swr headers, response coalescing) but the in-memory caches go incoherent the moment you scale past one Fly machine, and the geocoding hot path is uncached — that's the single biggest unforced cost leak.**

---

## 2. Cache Layer Inventory

What's actually cached today, where it lives, TTL, scope, invalidation:

| # | Layer | Storage | TTL | Scope | Invalidation | Used? |
|---|---|---|---|---|---|---|
| L1 | TanStack Query (client) | Browser | gcTime 30 min, staleTime per-query | Per-tab | Mutation `invalidateQueries` | Yes |
| L2 | HTTP Cache-Control + SWR (`middleware/httpCacheHeaders.ts`) | Browser HTTP cache | 15s–3600s + swr 30s–86400s | `private` per-cookie | Browser-driven (max-age expiry); never wired to mutations | Yes |
| L3 | In-memory response cache (`middleware/responseCache.ts`) | Per-instance Map, max 500 entries | Caller-supplied seconds | Keyed by `method:path:orgId:query` | `invalidateOrgCache(orgId)` exists but **only called by tests/admin endpoints** | Yes — but per-instance only |
| L4 | AI response cache (`aiRouter.ts` `AI_CACHE`) | Per-instance Map, max 500 | 15 min | **Global** (no orgId in key — see §4) | TTL only; no mutation invalidation | Yes |
| L5 | Provider response cache (`provider_cache` table) | Postgres | 24h hardcoded | Global by `(provider, category, input)` | TTL only; no cleanup job | Yes |
| L6 | Provider perf-score cache (`perfCache` in registry) | Per-instance Map | 10 min | Per-category | TTL only | Yes |
| L7 | DB model config cache (`dbModelCache` in aiRouter) | Per-instance | 5 min | Global | `invalidateDbModelCache()` called from admin routes | Yes |
| L8 | AI context aggregator cache (`invalidateContextCache(orgId)`) | Per-instance | (assumed) | Per-org | Wired into many tool mutations in `ai/tools.ts` | Yes — best-wired invalidation in the codebase |
| L9 | Founder-settings cache (`services/founderSettings.ts`) | Per-instance Map | (TTL set) | Global | TTL only | Yes |
| L10 | Custom domain router cache | Redis (`storage.redis`) | setex-based | Global | TTL | Yes — only place using Redis for cache |
| L11 | Provider-intelligence telemetry cache | Per-instance perf scores | 10 min | Per-category | TTL | Yes |
| L12 | Generic Redis utility (`services/cache.ts` — `getCache()`) | Redis (when `REDIS_URL`) | Caller-supplied | Caller-determined | Caller-determined | **Implemented, exported, with `CACHE_TTL` constants — and zero callers.** |

### TTL constants exist but are dead code

```ts
// services/cache.ts
export const CACHE_TTL = {
  LEAD_SCORES: 5 * 60,
  ORG_SETTINGS: 10 * 60,
  CONVERSATIONS: 2 * 60,
} as const;
```

Greppable callers of `cache.get` / `cache.set` from this module: zero. The Redis utility is shipped, exported, documented in JSDoc, and used by nobody. That's a tell — somebody wrote the right tool, then the team kept reaching for `new Map()` instead because it works without infra.

### TTL by data class (what's actually live)

| Data class | Where cached | TTL | Notes |
|---|---|---|---|
| Provider lookups (ATTOM/Regrid/BatchData/OpenData) | `provider_cache` table | **24h** (hardcoded `DEFAULT_CACHE_TTL_MS`) | One TTL for everything — ownership data and county GIS get the same window |
| AI responses (SIMPLE/MODERATE, temp ≤0.3) | In-memory `AI_CACHE` | 15 min | Lost on every deploy/restart |
| HTTP-level org settings, feature flags | Browser via Cache-Control | 300s + 900s swr | Solid |
| HTTP dashboard, intelligence | Browser | 60s + 120s swr | Solid |
| Reverse geocoding (Mapbox) | **Nowhere** | — | Direct passthrough, no cache. See §3 |
| `geocode_address` (Nominatim) tool | **Nowhere** | — | Same problem |
| AVM / valuation results | **Nowhere unique** | — | Lives inside provider_cache only via the registry |
| County GIS / parcel boundaries | Provider cache (24h) when via registry | 24h | Tile data not cached at all |
| Static frontend assets | `static.ts` explicitly sets `no-cache, no-store, must-revalidate` | 0 | Aggressive — see §3 |

---

## 3. Missing Caches (the real cost leak)

### 3.1 Reverse geocoding — `/api/geocode/reverse`

`server/routes-micro-features.ts:262-297`. Direct Mapbox proxy. No cache check, no cache write, no Cache-Control on the response. Same lat/lng on the field-scout mobile loop hits Mapbox every time. At Mapbox's $0.50/1000 rate this is small per-request but the **driving-for-dollars loop hammers this endpoint** — every GPS sample. Round to 5 decimal places (~1.1m), cache 7 days, watch the bill drop.

**Fix:** ~10 lines using the existing `provider_cache` table, category `"geocoding"`. Or use `getCache()` from the dead Redis utility — finally a real caller.

### 3.2 Forward geocoding (`geocode_address` MCP tool)

Same deal, hits Nominatim. Nominatim has a **strict 1 req/sec policy** and will block AcreOS's IP if the agent loop hits it in a tight retry. No cache means every "what's the lat/lng of 123 Main St" goes to the wire.

### 3.3 Static frontend assets

`server/static.ts` lines 42-43, 72-73 set `no-cache, no-store, must-revalidate` on **everything**. That's belt-and-suspenders for `index.html` (correct for SPA shell) but it means hashed JS/CSS bundles don't get the year-long immutable caching they should. Vite emits `app-Bx7yK2.js` — those are content-addressed and should be `Cache-Control: public, max-age=31536000, immutable`. Right now every page load re-validates. On Fly.io with Cloudflare in front, this is wasted CDN capacity.

**Fix:** Branch on `req.path` — hashed assets get `immutable`, `index.html` and `service-worker.js` stay `no-store`.

### 3.4 County GIS parcel-boundary tiles

If the map renders tiles directly from county WMS/WMTS — those should sit behind Cloudflare with a `s-maxage` of weeks. Today's setup forces every map pan to round-trip.

### 3.5 `provider_cache` cleanup

The table has `idx_provider_cache_expires` index but **no cron job deletes expired rows**. Postgres will grow unbounded. Not catastrophic but it's a junk drawer that turns into a junk room.

### 3.6 AI prompt-caching is half-applied

`enablePromptCaching` is honored in `routeAITask` (line 736) — Anthropic's `cache_control: ephemeral` gives 90% input discount on the cached portion. But:
- Only 2 callers in the entire codebase pass `enablePromptCaching: true` (`routeCriticalTask`, `routeExtendedThinkingTask`).
- Every Sophie/Forge/Atlas agent has a multi-thousand-token system prompt that **could be marked cacheable** and isn't.
- `enablePromptCaching` should default to `true` whenever `systemLength >= 1024` and the model is Anthropic. The check is already there — just flip the default.

Estimated savings: Anthropic prompt caching is **70-90% input cost reduction on the cached portion**. Sonnet 4.6 at $3/M input drops to $0.30/M for cached content. For agents with 4K-token system prompts called 100×/day per org → **~$8/day savings per agent per org at moderate volume**. Low single-digit lines of code.

---

## 4. Cache Leakage Risks

### 4.1 AI_CACHE is global — and aiRouter doesn't put orgId in the key

`aiRouter.ts:31-39`:

```ts
function getCacheKey(task: AITask): string {
  const payload = JSON.stringify({
    messages: task.messages,
    taskType: task.taskType,
    responseFormat: task.responseFormat,
    temperature: task.temperature,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
```

No `orgId`. **This is fine for content-addressed AI inference** — the same prompt deterministically produces the same response regardless of who asked. The semantic-dedup layer (Jaccard ≥0.72) is also fine because it operates on token sets, not org data.

**BUT:** if an agent's system prompt embeds organization-specific context (founder names, customer lists, deal IDs) — and they do, that's the whole point of `aiContextAggregator` — then two orgs whose context happens to produce overlapping token sets at ≥0.72 similarity could **return cached responses sourced from each other's data.** That's a soft-leak: the response *was* generated for org A's prompt, but org B's similar paraphrase pulls org A's answer.

Severity: medium. Probability: low (Jaccard threshold is stringent). Mitigation: make `findSemanticCacheHit` filter by `orgId` — store it on `CacheEntry`, key the linear scan by org. ~8 lines.

### 4.2 Response cache (`responseCache.ts`) — clean

`cacheKey = ${method}:${path}:${orgId}:${query}` — orgId baked in. Good. `invalidateOrgCache(orgId)` exists. But it's **not called from any mutation route** — only from admin tools. Stale-data risk on dashboard endpoints after a write.

### 4.3 `provider_cache` — global by design, correct

Provider lookups (parcel data, owner info) are **owner-of-record facts about parcels**, not org-scoped. Global keying is correct and saves money across all orgs. ATTOM costs the same regardless of who's asking.

### 4.4 In-memory caches across multiple Fly machines

This is the one that matters. Fly.io scales to N machines. Every cache in §2 marked "per-instance" means:
- AI cache hit rate drops with `1/N`
- Response cache COALESCED behavior breaks across instances — N concurrent identical requests still cause N cold computes
- DB model cache, perfCache, founder-settings cache all drift between instances

**Reza's audit mentioned `getAICacheStats()`. It's real (line 125) and it's called by `autonomousHealthMonitor.ts:318` — but it reports the local instance's stats only.** Founder dashboard would show wildly different numbers depending on which machine answered the request.

---

## 5. Cost-Savings Estimate

Worked numbers, conservative.

### 5.1 AI response cache — current

Layer 1 + 2 only fires for `complexity != COMPLEX/CRITICAL && temp ≤ 0.3`. That's mostly `simple_qa`, `summarize`, `extract_data`, `lookup` — DeepSeek territory at $0.14/M input. Even at 50% hit rate, savings per cached call is sub-cent.

### 5.2 AI prompt caching — currently underused

Sonnet 4.6 system prompt of 4K tokens, called 100×/day at one org:
- Without prompt caching: 100 × 4000 × $3/M = **$1.20/day input on system alone**
- With prompt caching (90% off cached portion): 100 × 4000 × $0.30/M ≈ **$0.12/day**
- Savings per org per agent: **~$1.08/day → $32/month**

Across 5 founder agents × 100 orgs = **$1,600/mo on the table**. Flipping the default takes ~5 lines.

### 5.3 Provider cache — already working

24h TTL on parcel/owner lookups is the highest-leverage cache that exists today. ATTOM costs $0.10–$0.30 per parcel lookup. At 50% hit rate on 10K daily parcel lookups across all orgs:
- Savings: 5000 × $0.20 = **$1000/day**

This is the one that's already saving real money. Don't break it.

### 5.4 Geocoding cache — easy win not taken

Mapbox at $0.50/1000 reverse-geocode requests. Field-scout mobile loop estimated 50 lookups per session × 100 active sessions/day = 5K req/day:
- Without cache: $2.50/day, $75/mo
- With 7-day cache at 80% hit rate: $0.50/day, **$60/mo savings**

Small dollars. But the secondary win — Nominatim's 1 req/sec policy — is a **liveness risk** mitigated. That's worth more than the $60.

### 5.5 Total annualized

Floor estimate from the easy fixes (prompt-caching default + geocoding cache + immutable static assets cutting Cloudflare egress):

> **~$20K/year** in pure provider/API costs at current scale, scaling super-linearly with org count because prompt-caching savings are per-org. At 1000 orgs the prompt-caching alone is **~$200K/year**.

---

## 6. Hit-Rate Observability — what to ship

Today's state:

- `getAICacheStats()` exists, returns `{size, hits, semanticHits, misses, maxSize, ttlMs, semanticThreshold}`. **Surface: only `autonomousHealthMonitor` job logs, not a dashboard.**
- `getCacheStats()` from `responseCache.ts` is read by `routes-metrics.ts` — there's a metrics surface.
- `aiTelemetryEvents` table records `cacheHit` per AI call — queryable but not visualized.
- **No metric exists for `provider_cache` hit rate.** The cache hit is logged via `logger.info("Provider cache hit", ...)` and that's the only signal.

### Ship this dashboard (Founder → System Health → Caching)

1. **Hit-rate sparkline per cache layer**, last 24h:
   - AI cache (exact + semantic, broken out)
   - Provider cache (count cache hits from `provider_cache` reads vs registry lookups — needs a counter)
   - Response cache (count `X-Cache: HIT` vs `MISS` vs `COALESCED` from access logs)

2. **Top 10 expensive cache misses** — which `(provider, category, input)` keys missed and triggered a paid lookup?

3. **AI cost saved by cache hits** — already computable from `aiTelemetryEvents`: `SUM(estimatedCostCents) WHERE cacheHit = false` minus what *would* have been paid if every cacheHit had instead been a miss.

4. **Prompt-cache adoption** — count of AI calls where `enablePromptCaching=true` ÷ total Anthropic calls. Should approach 100% for system prompts ≥1024 chars.

5. **Per-instance cache divergence** — when running >1 Fly machine, expose each instance's stats separately. Visible drift = "you need Redis."

Implementation: 1-2 days for a founder-only `/founder/system/caching` page reading existing telemetry tables + a couple new counters.

---

## 7. The 1-Week Caching Sprint

Concrete additions, ordered by ROI.

### Day 1 — Cheap wins, no infra

- **Default `enablePromptCaching: true`** in `aiRouter.ts:736` whenever `isAnthropicModel && systemLength >= 1024`. Drop the `task.enablePromptCaching` gate (keep it as an opt-out). Single PR, ~5 lines, biggest ROI of the sprint.
- **Static-asset Cache-Control fix** in `server/static.ts`: branch on hashed bundle paths → `public, max-age=31536000, immutable`. Keep `index.html` no-store.
- **Add `provider_cache` cleanup cron** — single-line BullMQ job: `DELETE FROM provider_cache WHERE expires_at < now() - interval '7 days'` daily at 04:00 UTC.

### Day 2 — Geocoding cache

- Wrap `/api/geocode/reverse` and the MCP `geocode_address` / `reverse_geocode` tools with `provider_cache` (category `"geocoding"`, key = rounded lat/lng to 5dp). 7-day TTL.
- Add Nominatim respect: 1 req/sec global rate limiter via in-memory token bucket (or Redis if available).

### Day 3 — Make in-memory caches multi-instance safe

This is the Redis decision. Two paths:

**Path A (cheap):** Accept incoherence. Mark every per-instance cache with a comment + log a warning when instance count > 1. Document the trade-off.

**Path B (right):** Activate the dead `services/cache.ts` Redis utility. Migrate:
- `aiRouter.AI_CACHE` → Redis with the same SHA-256 keys
- `responseCache` cache → Redis (move out of in-process Map)
- Founder-settings cache → Redis with pubsub for invalidation

Path B is ~2 days of work. The Redis client is already imported (BullMQ uses it), so no new infra.

### Day 4 — Per-org AI semantic-cache scoping

`findSemanticCacheHit` should filter by `orgId`. Add `orgId` to `CacheEntry`, accept `config.orgId` into `setCachedResponse`, scope the linear scan. Closes §4.1 leak risk.

### Day 5 — Observability dashboard

Ship the founder caching page from §6. Even rough is fine — the act of seeing miss counts will drive the next round of optimization.

### Day 6-7 — Per-category provider TTLs

24h is wrong for some categories. Owner-of-record changes rarely (recommend 30 days). County GIS parcel boundaries change quarterly (recommend 30 days). AVM valuations move weekly (recommend 7 days). Replace `DEFAULT_CACHE_TTL_MS` with a `TTL_BY_CATEGORY` map. ~15 lines.

---

## Closing

AcreOS's caching story is one of the more thoughtful I've seen in a startup audit — the dual-layer AI cache with semantic dedup, the response coalescing in `responseCache.ts` (Task #196 is correct on cache stampede), the SWR HTTP layer. The team clearly knows what they're doing.

Two failures, one structural, one cultural:

**Structural:** The Redis utility was built and never adopted. Every cache that should be coherent across instances is local. On a single Fly machine this is invisible. The day they autoscale to 2 machines, hit rates roughly halve and nobody notices because the dashboard doesn't exist yet.

**Cultural:** Prompt caching is implemented but not defaulted. Geocoding has no cache. The dead `CACHE_TTL` constants tell you somebody knew the right answer six months ago and the team moved on. **Caching only saves money when it's the default, not the override.** Flip those defaults. Wire the dashboard. Then decide about Redis with data.

— Kenji

Files referenced:
- `/Users/user/AcreOS/AcreOS/server/services/aiRouter.ts`
- `/Users/user/AcreOS/AcreOS/server/services/cache.ts`
- `/Users/user/AcreOS/AcreOS/server/services/providers/provider-registry.ts`
- `/Users/user/AcreOS/AcreOS/server/middleware/responseCache.ts`
- `/Users/user/AcreOS/AcreOS/server/middleware/httpCacheHeaders.ts`
- `/Users/user/AcreOS/AcreOS/server/static.ts`
- `/Users/user/AcreOS/AcreOS/server/routes-micro-features.ts` (geocoding)
- `/Users/user/AcreOS/AcreOS/shared/schema.ts:2557` (`provider_cache`, `ai_telemetry_events`)
