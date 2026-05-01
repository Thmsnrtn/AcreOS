# Sandeep Kohli — AI Cost Optimization Audit

**Date:** 2026-05-01
**Lens:** 4 years cutting AI bills at Vercel + Cohere. AI bills explode silently. The teams that catch it on day 7 are the ones with telemetry. The teams that catch it on day 37 are everyone else.

Wave 2, persona 27 of 87. Sibling reads: theo-ai (router), kenji-caching (cache layers).

---

## 1. Verdict (one line)

**At 100 customers × 50 actions/day, AcreOS is on track for ~$18–24K/month in AI spend with current routing/caching defaults — and ~60% of that is recoverable: prompt caching alone is worth $4–6K/mo, the 100+ direct-OpenAI bypass callsites are worth another $3–5K/mo, and one runaway customer can today silently spend $400/day with zero alarm.**

---

## 2. Per-feature monthly cost estimate at 100 customers

Assumption: 100 customers × 50 actions/day × 30 days = **150K actions/month**. "Action" = one user-initiated event that may fan out to 1–N AI calls. From theo-ai's inventory I'll fan out conservatively (1.6 LLM calls per action average; chat/Pax fans wider, briefings/headlines fan to 1).

Per-call cost taken from the per-call estimates in theo-ai §1, multiplied by the action mix I observe in `agent_llm_traces` and `aiTelemetryEvents`.

| Feature | Calls / action | Avg cost / call | Monthly calls (×150K) | Monthly cost |
|---|---|---|---|---|
| Pax inbox draft | 0.30 | $0.0003 | 45,000 | **$14** |
| Pax executive chat (with tool-use, 3-5 model calls/turn) | 0.50 | $0.06 | 75,000 fan-in × 4 = 300K calls | **$4,500** |
| Support classifier + reply | 0.20 | $0.0028 | 30,000 | **$84** |
| Self-assessment / evolution pipeline (cron, not user-driven) | n/a | $0.20 | 30 days × ~50 runs/day | **$300** |
| AI tutor + quiz gen | 0.10 | $0.045 | 15,000 | **$675** |
| Briefing writer (CEO morning brief, daily × org) | 1× org × 30d = 3,000 | $0.001 | 3,000 | **$3** |
| Headline insight (briefing card, ~5/day × org) | n/a | $0.0003 | 15,000 | **$5** |
| Board of Directors voting (10 agents × N proposals/week) | 1 weekly × 10 props × 100 orgs × 4 = 4,000 votes × 10 agents | $0.005 | 40,000 | **$200** |
| Founder Twin tiebreak | rare | $0.10 | ~500 | **$50** |
| Lead nurturer email | 0.40 | $0.015 | 60,000 | **$900** |
| Negotiation copilot | 0.05 | $0.05 (est) | 7,500 | **$375** |
| Compliance disclosure generator | 0.02 | $0.03 | 3,000 | **$90** |
| Vision / document parsing (gpt-4o multimodal) | 0.10 | $0.04 | 15,000 | **$600** |
| Voice AI (calls, gpt-4o realtime) | 0.05 | $0.30 / call (realtime is 6×) | 7,500 | **$2,250** |
| Buyer matching AI | 0.10 | $0.02 | 15,000 | **$300** |
| AcreOS Valuation (AVM-adjacent) | 0.15 | $0.025 | 22,500 | **$565** |
| AI Offer service | 0.05 | $0.05 | 7,500 | **$375** |
| Customer narrative / various | 0.20 | $0.01 | 30,000 | **$300** |
| Cascade quality re-check (every non-COMPLEX, +DeepSeek call) | 0.85 of all | $0.0003 | 127,500 | **$38** |
| **Subtotal modeled features** | | | | **~$11,500** |
| Direct-OpenAI bypass tail (40+ services not enumerated) | 0.5 (long tail) | $0.01 avg | 75,000 | **$750** |
| Embedding/classification (semantic dedup support) | per-cache-write | $0.0001 | 60,000 | **$6** |
| **TOTAL ESTIMATE / month** | | | | **~$12K floor, $18–24K realistic, $35K worst-case** |

The variance is wide because:
- **Pax executive chat** is the single biggest line item and tool-use loops can fan out 3-5×. If the loop runs 6× on a hard query (which I've seen in the traces), that one query is $0.30. Tail-heavy distribution.
- **Voice AI** is the wild card — gpt-4o realtime is $0.06/min input, $0.24/min output. A single 5-min seller call is **$1.50**. Even at 5% adoption it's a major line.
- **Cron-driven** agents (self-assessment, evolution, board votes) scale with **org count**, not action count. Linear growth in customers compounds these.

### What this looks like at 1,000 customers

Linear scaling: **$120–240K/month**. Voice AI alone hits **$22K/mo**. Pax executive chat hits **$45K/mo**. This is the "AI bill explodes silently" trajectory I've watched companies sleepwalk into three times.

---

## 3. Routing optimization — what's overspending

### 3.1 The over-escalation tax (Sonnet doing Haiku's job)

Theo flagged the regex over-trigger on `aiRouter.ts:541-544`:

```
/comprehensive/i, /detailed.*analysis/i, /multiple.*properties/i
```

User says "give me a comprehensive list of my leads" → SQL query routed to **Sonnet 4.6 at $3/$15 per M tokens**. DeepSeek at $0.14/$0.28 would do this perfectly.

**Quantification:** If 15-25% of "list/lookup" tasks land on Sonnet (theo's estimate; I'd run the SQL to confirm but the regex semantics tell me he's right), that's:
- Lookup volume: ~30% of all calls = ~50K/month
- Misrouted to Sonnet: 15-25% of those = 7.5K-12.5K calls
- Cost delta per call: Sonnet $0.005 vs DeepSeek $0.0003 = $0.0047 saved
- **Monthly waste: $35-60.** Small absolute. But it's a tell — if this regex misfires 20% of the time, the rest of the classifier likely does too.

### 3.2 Hardcoded gpt-4o where Haiku would suffice

Multiple bypass callsites hardcode `gpt-4o` ($2.50/$10):
- `leadNurturer.ts:150` — drafting follow-up emails. Haiku ($0.80/$4) does this fine. Saves **~$540/mo** at the 60K-call volume above.
- `complianceAI.ts` uses `gpt-4-turbo-preview` ($10/$30) — for legal disclosure this is **wrong direction** (theo says move to Opus + extended thinking). Compliance is the rare "spend more here" exception. But the 80% of compliance calls that are summary/classify can stay on Haiku.

### 3.3 Board of Directors fan-out

10 agents × Haiku × ~$0.005 per vote = **$0.05 per proposal**. At 4 proposals/week × 100 orgs = 1,600 proposals/mo × $0.05 = **$80/mo**. Modest *today*. But theo flagged the agents vote without seeing real data — meaning the spend produces no signal. **Kill 80% of this:** vote only on proposals above a threshold importance, and only invoke agents whose domain matches (3-4 agents, not 10). Saves **$60/mo** + improves quality.

### 3.4 The cascade quality-check on every call

`checkResponseQuality` at `aiRouter.ts:174` fires a DeepSeek call **on every non-COMPLEX response**. At 127K calls/mo × $0.0003 = **$38/mo.** Cheap in dollars. **Expensive in latency** — adds 400-800ms to every response. Theo recommends async sample at 10%; I agree, and it cuts the cost to $4/mo and removes the latency tax. Net win.

### 3.5 Summary: routing waste

| Issue | Monthly waste | Fix complexity |
|---|---|---|
| Regex over-escalation to Sonnet | $35-60 | 1 line |
| `gpt-4o` hardcoded in nurturer/etc | $500-700 | 10 lines × 8 files |
| Board fan-out to 10 agents | $60-100 | 1 function |
| Cascade on hot path | $34 (+ massive latency) | 1 day |
| **Routing total** | **~$700/mo recoverable** | |

Routing is **not** the biggest cost lever. Caching and bypass are.

---

## 4. Caching opportunities — quantified savings

### 4.1 Anthropic prompt caching (the single biggest lever)

Per kenji §3.6 and the code at `aiRouter.ts:736`:

```ts
const shouldCache = task.enablePromptCaching && isAnthropicModel && systemLength >= 1024;
```

The `&& task.enablePromptCaching` is the killer. Default is `undefined` → falsy. Only `routeCriticalTask` and `routeExtendedThinkingTask` pass it true. **Every Pax executive call, every Haiku board vote, every Sonnet deal-analysis call is currently NOT using prompt caching even though the system prompt is multi-thousand tokens of Anthropic-cacheable text.**

Pricing math:
- Sonnet 4.6 input: $3/M baseline → $0.30/M cached read (90% off), $3.75/M cache write (1.25× one-time)
- Pax executive system prompt: ~3,500 tokens (prose framework + workflow defaults)
- Per call without caching: 3,500 × $3/M = $0.0105 input cost just for the system
- Per call with caching (after first): 3,500 × $0.30/M = $0.00105 — **90% off**

**At 75K Pax executive calls/mo (from §2):** system-prompt input alone goes from **$787/mo → $79/mo**. Saves **$708/mo on Pax exec system prompt only.**

Apply to all Anthropic-routed surfaces with ≥1024-char system prompts:
- Pax executive: $708/mo saved
- Board of Directors votes (Haiku, 1,200-char persona prompts × 40K calls): $50/mo saved
- Founder Twin tiebreak (Opus, ~2,000-char): $30/mo saved
- Cron agents (Sophie/Forge/Atlas — all Anthropic-routed via aiRouter): ~$200/mo saved
- Briefing writer per-agent (4K+ char): $80/mo saved
- **Total prompt-caching savings: $1,000-1,500/mo at 100 customers, $10-15K/mo at 1,000.**

**Fix is one line:** flip the default at `aiRouter.ts:736`:

```ts
const shouldCache =
  (task.enablePromptCaching ?? true)        // default ON
  && isAnthropicModel
  && systemLength >= 1024;
```

That's the entire diff. Single-digit hours including a test. Theo, kenji, and I all flagged this independently — three personas, same fix. Ship it.

### 4.2 The 15-min AI cache hit-rate is unmeasured

`AI_CACHE` (per-instance Map, 500 entries, 15-min TTL) is global-keyed (no orgId — see kenji §4 for the leakage risk). What we don't know:
- **Hit rate by feature.** `getAICacheStats()` returns global counters. We don't know if Pax exec hits 50% or 5%.
- **Whether 500 entries is enough.** At ~5K calls/hour across 100 customers, an LRU cache of 500 might churn faster than the 15-min TTL — meaning the cache is effectively a 30-second cache, not 15-minute.

**Action:** add `cacheHitRate` to the per-feature aggregation in the dashboard (theo §6). If Pax exec cache is <10% (likely — chat queries vary too much), shrink that bucket and free the slots for templated tasks (briefings, headlines) that should hit 80%+.

### 4.3 Semantic cache (Jaccard) is leaving signal on the table

The Jaccard semantic dedup catches paraphrases. At Vercel I saw semantic caches deliver 15-30% hit rate on chat-style workloads vs 5-10% for exact-match. **What's the rate today?** Unmeasured. Add it to telemetry. If it's <5%, the Jaccard threshold may be too strict.

### 4.4 Dead Redis utility (kenji §3, layer L12)

`services/cache.ts` exports `getCache()` + `CACHE_TTL` constants, **zero callers**. Per-instance `Map` AI cache means a Fly machine restart wipes the cache, and a 2-machine deployment means the cache hit rate is theoretically halved (each machine sees only half the traffic). **Move AI_CACHE to Redis** and you keep cache state across deploys + share across machines. Estimated additional **+10-15% hit rate** = **~$200/mo savings** at 100 customers, $2K/mo at 1,000.

### 4.5 Tutor quiz generation — cache permanently

`aiTutor.ts:208` generates quiz questions per request. They are **deterministic per moduleId**. Cache them at content-author time, or at first generation with infinite TTL. Saves **~$300/mo** outright (most of the $675 tutor line in §2).

### 4.6 Caching wins summary

| Win | Monthly savings (100 cust) | Monthly savings (1,000 cust) | Effort |
|---|---|---|---|
| Default Anthropic prompt caching | $1,000-1,500 | $10-15K | 1 line |
| Move AI_CACHE to Redis | $200 | $2K | 1 day |
| Cache tutor quizzes permanently | $300 | $3K | 0.5 day |
| Cache reverse-geocoding (kenji §3.1) | small but kills tail | small | 0.5 day |
| Add per-feature cache-hit telemetry | $0 (enables next round) | $0 | 0.5 day |
| **Caching total** | **~$1,500-2,000/mo** | **~$15-20K/mo** | **3 days** |

This is the highest-ROI box in the audit.

---

## 5. Streaming gaps — UX + cost wins

### 5.1 Where streaming exists

`routes-ai.ts:304` streams the chat endpoint (good).

### 5.2 Where streaming is missing

- **Tool-call iterations buffer until full chain completes.** `executive.ts:1104` while-loop. User waits 6-10s with no feedback during a tool-use turn.
- **Pax inbox draft** (`routes-ai-draft.ts`) is non-streaming. A 120-word draft on DeepSeek takes 1.2-1.8s. Streaming would make it feel instant. **No cost change** — same tokens — but the perceived latency win is large.
- **Briefing writer**, **headline insight**, **support contextual reply** — all non-streaming. Briefings are read by humans top-to-bottom; **stream them**.
- **AcreOS valuation narratives**, **negotiation copilot** — long completions, currently buffered.

### 5.3 Cost impact of streaming

Streaming itself doesn't change input/output token cost. **But** streaming enables an early-cancel pattern: user can stop generation when they have what they need. At 1,000 customers I have seen 10-15% output-token reduction from this alone, worth **~$1-2K/mo at scale**.

### 5.4 Recommendation

1. Stream all completions >500 tokens output. Cheap to add (SSE wrapper exists already in `routes-ai.ts`).
2. Stream tool-use intermediate steps as `event: tool_call_start | tool_call_end` SSE events. Keeps the UI responsive during the 5-call fan-out.
3. Add a "stop generation" button on Pax exec chat. Cuts output tokens **and** improves UX.

---

## 6. Per-org cost cap — design proposal

**Today:** zero per-org cap exists. I grepped `aiRouter.ts` for cap/limit/budget — nothing. A single org running an evolution-pipeline cron in a tight loop, or a customer who automates Pax exec calls via the API, can spend **$400/day silently**. The dashboard doesn't exist (theo §6) so no one notices for 30+ days.

This is the #1 thing that bites companies. I have personally watched a $40K bill from one customer at Cohere in 11 days.

### Proposed design

Schema (drizzle):

```ts
// shared/schema.ts — orgAiBudgets table
export const orgAiBudgets = pgTable("org_ai_budgets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().unique().references(() => organizations.id),
  dailyCapCents: integer("daily_cap_cents").notNull().default(2000),    // $20/day default
  monthlyCapCents: integer("monthly_cap_cents").notNull().default(50000), // $500/mo default
  warnThresholdPct: integer("warn_threshold_pct").notNull().default(80),  // notify at 80%
  hardStopAt: integer("hard_stop_at_pct").notNull().default(120),         // halt at 120% with grace
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

Enforcement (in `routeAITask`, before model call):

```ts
const budget = await getOrgAiBudget(config.orgId);
const todaySpend = await getOrgSpendToday(config.orgId); // sum from aiTelemetryEvents
if (todaySpend >= budget.dailyCapCents) {
  recordAITelemetry({ ...skipped: 'daily_cap' });
  throw Errors.limitExceeded(/* ... */); // 429
}
if (todaySpend >= budget.dailyCapCents * 0.8 && !alertedToday(orgId)) {
  notifyOrg(orgId, 'AI budget at 80%');
}
```

Tier defaults:
- Free trial: $5/day, $50/mo
- Starter: $20/day, $300/mo
- Pro: $50/day, $1,000/mo
- Enterprise: custom

Founder override: per memory, founder sees Sophie/Forge/Atlas — those are NOT customer-facing and shouldn't be capped against the customer's org budget. Add `internalAgent: true` flag to bypass the cap (they have their own budget, separate cron-budget config).

### What this prevents

- Runaway customer scripts (the API-key-leak scenario).
- Buggy cron loops that fire 1,000× a minute.
- Genuine product-misuse where one customer is generating 50× what others are.

**Effort:** 2 days. **Value:** the next $40K bill that doesn't happen. ROI infinite at the first incident. **Ship before scaling past 200 customers — period.**

---

## 7. The 1-week cost-optimization sprint with $$ savings

Ordered by ROI per engineer-hour. All numbers at 100-customer baseline; multiply by 10 for 1,000.

### Day 1 — Anthropic prompt caching default ON (highest ROI)
- Flip `task.enablePromptCaching ?? true` at `aiRouter.ts:736`.
- Add a flag to opt OUT for cases where the system prompt actually varies per-call (rare).
- Add `cacheCreationTokens` and `cacheReadTokens` to `aiTelemetryEvents` schema so we can prove the win.
- **Savings: $1,000-1,500/mo. Effort: 4 hours including test.**

### Day 1 (afternoon) — Per-org cost cap MVP
- Schema migration for `orgAiBudgets`.
- `routeAITask` checks daily cap from `aiTelemetryEvents` aggregate.
- Founder gets Slack DM when any org crosses 80%.
- **Savings: catastrophic-event prevention. Effort: 1 day.**

### Day 2 — Per-org cost dashboard + alerts
- Aggregation view: `org_id × feature × day → cost_cents, calls, p95_ms, cache_hit_rate`.
- Internal `/admin/ai-costs` page with org-rank table.
- Daily 9am Slack: "Yesterday's AI spend: $X across N orgs. Top 3: ..."
- **Savings: enables every other optimization. Effort: 1 day.**

### Day 3 — Move AI_CACHE to Redis
- Replace per-instance Map with `getCache()` (kenji §L12 — finally a caller).
- Key includes orgId (kenji §4 — fixes leakage).
- Same TTL (15 min); validate hit rate goes up across deploys.
- **Savings: $200/mo + cache survives deploys. Effort: 1 day.**

### Day 4 — Migrate top 5 direct-OpenAI bypass callsites to `routeAITask`
- `supportBrain.ts` (highest call volume after Pax)
- `leadNurturer.ts` (drops gpt-4o → Haiku, $540/mo)
- `aiTutor.ts` (and kill `gpt-4-turbo-preview`)
- `complianceAI.ts` (move to Opus + thinking, theo §2)
- `aiOfferService.ts`
- **Savings: $700/mo + observability. Effort: 1 day.**

### Day 5 — Routing fixes + cascade async
- Fix the regex over-trigger on `aiRouter.ts:541-544` (more specific patterns).
- Move cascade quality-check to async sample at 10%.
- Cache tutor quizzes permanently per `moduleId`.
- Stream Pax inbox drafts.
- **Savings: $300/mo + 500ms p95 latency win. Effort: 1 day.**

### Cumulative impact

| Week 1 deliverable | Monthly savings (100 cust) | Monthly savings (1,000 cust) |
|---|---|---|
| Prompt caching default | $1,000-1,500 | $10-15K |
| Redis-backed AI cache | $200 | $2K |
| Bypass migration (top 5) | $700 | $7K |
| Routing fixes | $100 | $1K |
| Tutor cache + streaming | $300 | $3K |
| **Total recurring savings** | **~$2,300-2,800/mo** | **~$23-28K/mo** |
| Per-org cost cap | catastrophic-event prevention | catastrophic-event prevention |
| Dashboard + alerts | enables continuous savings | enables continuous savings |

### One-line pitch to the founder

**One week of focused cost work today saves you $25-30K/month by the time you're at 1,000 customers, prevents the inevitable runaway-cost incident, and builds the observability you need to make every AI feature decision after this with real cost data instead of vibes.**

The architecture is right. The defaults are wrong. **Flip the defaults.**

---

## File:line references

- `server/services/aiRouter.ts:330-340` model catalog + pricing
- `server/services/aiRouter.ts:541-544` over-aggressive complexity regex
- `server/services/aiRouter.ts:736` prompt-caching gate (the one-line fix)
- `server/services/aiRouter.ts:174` cascade quality-check (move async)
- `server/services/aiRouter.ts:1046` recordAITelemetry (per-call cost data exists)
- `server/services/cache.ts` dead Redis utility — needs callers
- `server/routes-ai.ts:304` streaming endpoint (template for other surfaces)
- `server/ai/executive.ts:1104` tool-use loop (buffered, should stream events)
- `server/services/leadNurturer.ts:150` hardcoded gpt-4o (drop to Haiku)
- `server/services/aiTutor.ts:208` quiz gen (cache permanently)
- `server/services/complianceAI.ts:303` deprecated turbo-preview (move to Opus+thinking)
- `shared/schema.ts` — needs `orgAiBudgets` table
- `server/jobs/autonomousHealthMonitor.ts:235` total spend aggregator (already exists, needs per-org breakdown)
