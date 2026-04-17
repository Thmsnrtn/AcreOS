# Lens 39 -- LLM Cost & Operations Specialist Audit

**Auditor persona:** LLM Cost/Ops Specialist
**Date:** 2026-04-15
**Codebase snapshot:** commit ff7b154 (main)
**Related lenses:** 36-ai-systems (AI architecture), 05-performance-sre, 11-observability

---

## Executive Summary

AcreOS runs a substantial LLM workload: 49+ services make direct `chat.completions.create` calls, 47+ services use the centralized `aiRouter`, and 10+ named SCP agents operate with varying degrees of autonomy. The infrastructure includes a well-designed tiered model routing system (DeepSeek Chat at $0.14/M for simple tasks through Opus 4.6 at $15/M for critical decisions), a dual-layer response cache (exact-match SHA-256 + semantic Jaccard similarity), quality-gated cascade escalation, per-org usage count limits, telemetry recording to `ai_telemetry_events`, and a health monitor with configurable daily/weekly budget thresholds.

However, the system has **critical cost exposure**. The central finding is a split-brain architecture: **87 direct `chat.completions.create` calls across 45 service files bypass the router entirely**, meaning they are invisible to cost telemetry, exempt from caching, unaffected by model routing optimization, and not counted against any budget. These shadow calls use hardcoded models (often `gpt-4o` at $2.50/$10.00 per million tokens when a cheaper model would suffice) and construct their own OpenAI clients using `OPENAI_API_KEY` -- a key the orientation document notes is **invalid in production** (issue #9). The budget enforcement system is alert-only with no automatic throttling, the per-user cost control module (`userAiCostControls.ts`) is fully implemented but never wired into any route, and the cascade escalation mechanism can silently double costs on failed quality checks with no telemetry for the additional call.

**Estimated monthly cost exposure:** At the documented target distribution (60% T1, 30% T2, 7% T3, 1% T3r, 2% T4), a well-routed 100K calls/month workload costs roughly $50-$80. But the 87 unrouted direct calls -- if active -- could individually run at 10-50x the cost of properly routed equivalents, with no visibility into spend.

---

## Findings

### COST-001: 45 Services Bypass AI Router -- No Telemetry, No Caching, No Budget Tracking
**Severity: P0**

There are 87 direct `openai.chat.completions.create` calls across 45 service files that instantiate their own OpenAI clients and call the API directly, bypassing the `aiRouter.ts` infrastructure entirely. These calls:

1. **Are invisible to cost telemetry** -- the `recordAITelemetry()` function in `aiRouter.ts` is only called from `routeAITask()`. Direct calls write nothing to `ai_telemetry_events`.
2. **Are exempt from the response cache** -- the dual-layer cache (exact + semantic) only operates within `routeAITask()`.
3. **Are not counted against any budget** -- the health monitor's `checkAICosts()` queries `ai_telemetry_events`, which these calls never populate.
4. **Use hardcoded models** -- many use `gpt-4o` ($2.50/$10.00/M) for tasks that the router would classify as SIMPLE and route to DeepSeek Chat ($0.14/$0.28/M).

**Evidence (representative sample of direct-call services and their hardcoded models):**
- `server/services/negotiationOrchestrator.ts` -- `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`, no model routing
- `server/services/founderDigest.ts` -- `new OpenAI()`, uses `gpt-4o-mini`
- `server/services/complianceAI.ts` -- `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`
- `server/services/acreOSValuation.ts` -- `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`
- `server/services/documentIntelligence.ts` -- 6 direct calls, all hardcoded to `gpt-4o`
- `server/services/negotiationCopilot.ts` -- 4 direct calls, all hardcoded to `gpt-4o`
- `server/services/voiceCallAI.ts` -- 4 direct calls
- `server/services/visionAI.ts` -- 3 direct calls
- `server/services/leadNurturer.ts`, `aiOfferService.ts`, `buyerQualificationBot.ts`, `campaignOptimizer.ts`, `dueDiligence.ts`, `leadQualification.ts` -- all direct

Total: 87 untracked calls in 45 service files, plus 15 in `server/ai/*.ts` and 5 in route files.

**Impact:** The budget monitoring system operates on incomplete data. Actual LLM spend could be multiples of what the health monitor reports. The $100/day default budget (`AI_DAILY_BUDGET_CENTS=10000`) monitors only the routed portion of traffic.

---

### COST-002: Budget Enforcement Is Alert-Only -- No Automatic Throttling or Circuit Breaking
**Severity: P0**

The `autonomousHealthMonitor.ts` checks AI spend against configurable thresholds ($100/day, $500/week) but only creates alerts. The code explicitly states:

```
"The model router will continue operating normally. No automatic throttling
has been applied -- this is a notification only. To enable auto-throttling,
set AI_COST_AUTO_THROTTLE=true in environment variables."
```

However, there is no implementation of the `AI_COST_AUTO_THROTTLE` feature anywhere in the codebase. The environment variable is referenced only in the alert message text -- it is not read, parsed, or acted upon. There is no code path that reduces model tier, rejects requests, or applies any backpressure when budgets are exceeded.

**Evidence:**
- `server/jobs/autonomousHealthMonitor.ts:265` -- mentions `AI_COST_AUTO_THROTTLE=true` but it is aspirational documentation, not implemented logic
- Grep for `AI_COST_AUTO_THROTTLE` returns only the alert message string
- The `routeAITask()` function in `aiRouter.ts` has no budget-checking gate before making API calls

**Impact:** If AI costs spike (e.g., from the unbounded tool loop identified in Lens 36 AI-001, or from a burst of automated agent activity), there is no automatic mechanism to limit spend. Budget exceedance produces a log entry and an alert row in the database, but API calls continue at full rate.

---

### COST-003: Per-User AI Cost Controls Implemented But Never Connected
**Severity: P1**

`server/services/userAiCostControls.ts` implements a complete per-user AI budget system with:
- Daily ($5) and monthly ($50) per-user limits
- Redis-backed usage tracking with atomic increments
- `checkBudget()` and `recordUsage()` APIs
- Cost estimation by model

However, it is imported by exactly zero files. No route handler, middleware, or service calls `checkBudget()` or `recordUsage()`.

**Evidence:** `grep -r "userAiCostControls" server/` (excluding the definition file) returns zero results.

**Impact:** A single user within an organization can consume unlimited AI resources. The org-level `usageLimits.ts` system checks daily AI request *counts* (25 free, 500 starter, 1000 pro) but not cost. A pro user making 1000 requests that all cascade-escalate to Sonnet 4.6 would cost ~$45 vs ~$0.28 if all stayed at DeepSeek.

---

### COST-004: Cost Estimation Tables Duplicated in 3 Locations with Inconsistent Coverage
**Severity: P1**

The `COST_PER_MILLION_TOKENS` lookup table exists in three separate locations:

| Location | Models covered | Includes Claude? | Includes cached rates? |
|---|---|---|---|
| `server/services/aiRouter.ts:672` | 6 models (DeepSeek, Haiku, Sonnet, Opus, GPT-4o, Reasoner) | Yes | Yes |
| `server/ai/executive.ts:1062` (non-streaming) | 4 models (DeepSeek, Reasoner, GPT-4o, GPT-4o-mini) | No | No |
| `server/ai/executive.ts:1436` (streaming) | 4 models (same as above) | No | No |

The two `executive.ts` tables are missing Claude Haiku 4.5, Claude Sonnet 4.6, and Claude Opus 4.6. Since the executive chat paths (`processChat`, `processChatStream`) route to these Claude models via `selectProviderAndModel()`, cost estimation falls through to the default `{ input: 1, output: 3 }` -- which underestimates Opus 4.6 costs by **15x for input** and **25x for output**, and underestimates Sonnet 4.6 costs by **3x for input** and **5x for output**.

Additionally, `server/routes-ai.ts:1008-1013` (the `/api/ai/cost-savings` endpoint) has a fourth cost table with different model IDs (it uses `"gpt-4o"` without the `openai/` prefix) and blended rates.

A fifth cost table exists in `server/services/userAiCostControls.ts:221-231` with per-token pricing (different unit from per-million).

**Impact:** The AI cost dashboard, the health monitor, and the executive chat all calculate costs using different (and in some cases wildly incorrect) rates. The founder sees artificially low cost numbers for Claude model usage.

---

### COST-005: Cascade Escalation Doubles API Calls Without Separate Telemetry
**Severity: P1**

The quality-gated cascade in `aiRouter.ts:782-821` makes a second LLM call when the initial response scores below the quality threshold (score < 6/10). This escalation:

1. Makes a quality-check call to DeepSeek (~$0.002)
2. If quality is low, makes a full retry call to the next-tier model

The telemetry at line 849 records only the **final** model and its token usage. The initial (discarded) generation's tokens and cost are lost. The quality-check call's cost is also untracked.

**Evidence:**
- `server/services/aiRouter.ts:789-820` -- the escalation block calls `client.chat.completions.create()` directly, does not call `recordAITelemetry()`
- `server/services/aiRouter.ts:174-214` -- the `checkResponseQuality()` function makes its own API call with no telemetry
- The `usage` variable is overwritten at line 812 (`usage = escalatedResponse.usage`), discarding the original

**Impact:** Escalated requests appear in telemetry as single calls at the escalated model's cost, hiding the actual total (original generation + quality check + retry). Estimated 5-15% of requests escalate per the code comments; actual overhead is invisible.

---

### COST-006: In-Memory Cache Has No Persistence -- Full Cold Start on Deploy
**Severity: P1**

The AI response cache (`AI_CACHE` in `aiRouter.ts`) is an in-memory `Map` with a 500-entry limit and 15-minute TTL. On every deploy (rolling deploys to Fly.io's 2-machine fleet), both machines lose their cache entirely. With rolling deploys, the second machine sees a burst of cache misses while the first machine's cache was just warmed.

There is no Redis or database-backed cache layer for AI responses. The `provider_cache` table mentioned in `CLAUDE.md` is used by the data provider registry, not for AI responses.

**Evidence:**
- `server/services/aiRouter.ts:23-24` -- `const AI_CACHE = new Map<string, CacheEntry>()` and `const CACHE_TTL_MS = 15 * 60 * 1000`
- No Redis integration in `aiRouter.ts`
- Fly.io runs 2 machines -- each has its own independent cache (no sharing)

**Impact:** Cache hit rates are structurally limited by deploy frequency and machine isolation. The health monitor's 15% minimum cache hit rate threshold may be unreachable during frequent deploy cycles.

---

### COST-007: executive.ts Uses Naive Token Estimation for Usage Logging
**Severity: P1**

The non-streaming `processChat` function in `executive.ts:966-980` estimates token count and cost using a character-division heuristic:

```typescript
const estimatedTokens = JSON.stringify(chatMessages).length / 4;
const costMultiplier = model.includes('gpt-4o') ? 0.002 :
                      model.includes('gpt-4o-mini') ? 0.00015 :
                      model.includes('deepseek') ? 0.00014 : 0.001;
const estimatedCostCents = Math.ceil(estimatedTokens * costMultiplier / 10);
```

This has multiple problems:
1. Divides JSON-serialized message length by 4 -- ignoring that JSON serialization adds `{"role":"...","content":"..."}` overhead, and tokenization varies by model
2. Only estimates **input** tokens -- ignores output tokens entirely, which are 3-15x more expensive per token depending on model
3. The `costMultiplier` values are dimensionally inconsistent with the `COST_PER_MILLION_TOKENS` tables elsewhere
4. This heuristic runs on the first API call only -- tool-call loop iterations are not logged at all

Meanwhile, the actual API response includes `response.usage.prompt_tokens` and `response.usage.completion_tokens`, which are used for cost estimation 80 lines later (line 1060-1069) but written to a different destination (returned to the client, not written to `api_usage_logs`).

**Impact:** The `api_usage_logs` table (used by the `/api/ai/cost-savings` endpoint) contains systematically inaccurate cost data. Output-heavy responses (common for deal analysis, negotiation strategy, etc.) have their costs underestimated by 50-80%.

---

### COST-008: No OpenAI Batch API Usage for Asynchronous Workloads
**Severity: P2**

Multiple services run LLM tasks that are not latency-sensitive and could use OpenAI's Batch API (50% cost discount) or OpenRouter's equivalent:

- `server/services/founderDigest.ts` -- daily digest generation
- `server/services/founderBriefing.ts` -- scheduled briefings
- `server/services/campaignOptimizer.ts` -- campaign optimization analysis
- `server/services/leadQualification.ts` -- batch lead scoring
- `server/services/sellerIntentPredictor.ts` -- intent prediction
- `server/services/modelIntelligence.ts` -- weekly model benchmarking (6+ API calls per model)
- `server/services/evolutionPipeline.ts` -- code evolution proposals
- `server/services/agentPerformanceReviews.ts` -- periodic reviews

All of these make synchronous single-request calls despite not needing real-time responses.

**Evidence:** Grep for `openai.batches` or batch-related API patterns returns zero matches in server code.

**Impact:** Asynchronous workloads are paying full price when they could be processed at 50% cost through batch APIs.

---

### COST-009: Model Intelligence Auto-Promotion Uses Self-Scoring (Biased Benchmarks)
**Severity: P2**

`server/services/modelIntelligence.ts:275-305` benchmarks new models by having them generate responses and then **self-score their own output**:

```typescript
// Step 2: Self-score the response (same model grades its own output)
const scoringResponse = await client.chat.completions.create({
  model: modelId,
  messages: [{ role: "system", content: 'Score the following response...' }, ...]
});
```

Self-assessment introduces systematic bias: models tend to rate their own output higher than an independent evaluator would. The `AUTO_PROMOTE_SCORE_THRESHOLD` of 8.5 may be too easily reached with self-scoring.

Furthermore, auto-promotion into `aiModelConfigs` at weight 80 can change the production model routing without human review. If a new model benchmarks well on 3 canned prompts but performs poorly on real production workloads, it will handle all matching task types until manually corrected.

**Impact:** Risk of auto-promoting inferior or more expensive models into production routing based on biased benchmarks. The cost headroom check (`AUTO_PROMOTE_COST_HEADROOM = 1.2`) allows models up to 20% more expensive than the incumbent.

---

### COST-010: Dual OpenAI Key Configuration Creates Confusion and Shadow Spend
**Severity: P2**

The codebase references two different OpenAI API key environment variables:

1. `AI_INTEGRATIONS_OPENAI_API_KEY` -- used by `server/utils/openaiClient.ts` and the aiRouter fallback path
2. `OPENAI_API_KEY` -- used by 30+ services that create their own `new OpenAI()` clients

The orientation document notes (issue #9): "OpenAI API key invalid -- AI features broken in production." It is unclear which key this refers to. If `OPENAI_API_KEY` is invalid but `AI_INTEGRATIONS_OPENROUTER_API_KEY` is valid, then:
- All 47 router-based services work (via OpenRouter)
- All 45 direct-call services silently fail (they use the invalid key)
- Cost monitoring only covers the working half

If someone fixes the invalid key, all 45 dormant services suddenly become active, potentially creating a cost spike with no budget headroom.

**Evidence:**
- `server/utils/openaiClient.ts:9` -- reads `AI_INTEGRATIONS_OPENAI_API_KEY`
- `server/services/negotiationOrchestrator.ts:13`, `complianceAI.ts:11`, `visionAI.ts:12`, etc. -- read `OPENAI_API_KEY`
- `server/ai/executive.ts:28` -- creates OpenAI client with `process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY` (a third key)
- `server/services/intent-router.ts:8` -- creates client with default `OPENAI_API_KEY`

---

### COST-011: scoreAndLearnFromResponse Makes Untracked AI Calls on Every Chat Message
**Severity: P2**

`server/ai/executive.ts:20-68` fires a "quality scoring" LLM call via DeepSeek on every chat response, as a fire-and-forget background task:

```typescript
process.nextTick(() => {
  scoreAndLearnFromResponse(org.id, userMessage, assistantResponse).catch(() => {});
});
```

This creates its own OpenAI client (`new OpenAI({ apiKey: openrouterKey })`) and calls `chat.completions.create()` with no telemetry recording, no cache check, and no budget awareness. At DeepSeek Chat rates this is cheap (~$0.002/call), but it doubles the number of API calls for every chat interaction.

**Evidence:** `server/ai/executive.ts:28-44` -- constructs a new OpenAI client and calls the API with `max_tokens: 200`

**Impact:** 100% overhead on API call count for all chat interactions. Not reflected in telemetry, budget monitoring, or cost dashboards. On a 1000 chat messages/day workload, this adds ~$2/day in invisible spend.

---

### COST-012: 30-Day Telemetry Retention Prevents Monthly and Quarterly Cost Analysis
**Severity: P2**

`server/jobs/dataRetention.ts:20` purges `ai_telemetry_events` after 30 days:

```typescript
{ table: "ai_telemetry_events", column: "created_at", retainDays: 30, label: "AI telemetry" },
```

The cost-savings dashboard queries `usageRecords` for the current month, but the founder weekly digest (`founderWeeklyDigest.ts:230-257`) performs month-over-month and model-by-model cost analysis from `ai_telemetry_events`. After the 30th of any month, the prior month's data is partially or fully purged, making trend analysis impossible.

There is no aggregation step that rolls up daily costs into a summary table before purging the raw events.

**Impact:** No month-over-month cost trend visibility. Cannot answer "how much did we spend on AI last quarter?" without external logging.

---

### COST-013: Usage Count Limits Do Not Distinguish Cost Tiers
**Severity: P2**

The `usageLimits.ts` system enforces per-org AI request counts (25 free / 500 starter / 1000 pro per day), but treats all AI requests equally regardless of model or cost tier. A "simple_qa" routed to DeepSeek Chat ($0.14/M input) counts the same as a "contract_review" routed to Opus 4.6 ($15.00/M input) -- a 107x cost difference.

A pro-tier org that exhausts its 1000 daily AI requests entirely on CRITICAL tasks would generate ~$450 in API costs vs ~$4.20 if all were SIMPLE. The limit system provides no cost-weighted throttling.

**Evidence:** `server/services/usageLimits.ts:76` -- `ai_requests: 1000` for pro tier; `server/routes-ai.ts:53` -- `checkUsageLimit(org.id, "ai_requests")` is a simple count check.

---

### COST-014: Large System Prompts in executive.ts Not Flagged for Prompt Caching
**Severity: P2**

The `ATLAS_CORE_METHODOLOGY` system prompt in `server/ai/executive.ts:132` is approximately 8,000+ characters of domain knowledge that is prepended to every Atlas chat interaction. This prompt is sent verbatim on every API call but is not annotated with `cache_control: { type: "ephemeral" }` for Anthropic prompt caching.

The `routeAITask()` function supports `enablePromptCaching` and automatically adds cache control annotations for system prompts >= 1024 characters. However, `processChat()` in `executive.ts` calls `client.chat.completions.create()` directly (not via `routeAITask()`), so it never benefits from this feature.

**Evidence:**
- `server/ai/executive.ts:132-239` -- ~8,000 chars of static system prompt
- `server/ai/executive.ts:955` -- direct `client.chat.completions.create()` call with no `cache_control`
- `server/services/aiRouter.ts:737-744` -- cache control logic that `executive.ts` bypasses

**Impact:** At Sonnet 4.6 rates, the ~2,000 token system prompt costs ~$0.006/call without caching vs ~$0.0006/call with caching (90% savings on the cached portion). For the primary chat interface, this is the highest-volume cost savings opportunity.

---

## Architecture Assessment

### What Works Well

1. **Tiered model routing philosophy** -- The 5-tier model catalog (DeepSeek -> Haiku -> Sonnet -> Reasoner -> Opus) with documented target distribution (60/30/7/1/2%) is sound cost engineering.

2. **Dual-layer caching with semantic dedup** -- The Jaccard similarity cache catches paraphrased queries at a 0.72 threshold, which is a meaningful optimization for domain-specific workloads.

3. **Quality-gated cascade** -- Automatically retrying with a better model when quality is low prevents bad outputs without defaulting to expensive models for everything.

4. **Telemetry schema** -- `ai_telemetry_events` captures provider, model, complexity, token counts, cost, latency, cache hits, and success/failure -- good observability design.

5. **Health monitor budget thresholds** -- Configurable daily ($100), hourly ($20), and weekly ($500) budgets with projection-based early warning.

6. **DB-driven model configs** -- `aiModelConfigs` table with task-type routing and weight-based selection allows runtime model changes without deploys.

### Structural Risks

1. **Split-brain architecture** -- The 87 direct calls vs 128 routed calls represent a roughly 40/60 split. The "unmonitored" half is significant enough to invalidate budget calculations.

2. **Alert fatigue without enforcement** -- Budget alerts with no automatic response train operators to ignore them. When the $100/day budget is exceeded, the only consequence is a database row.

3. **Cascading cost surprises** -- If the invalid `OPENAI_API_KEY` is fixed, 45 dormant services activate simultaneously with no gradual rollout or cost monitoring.

---

## Summary Table

| ID | Title | Severity | Category |
|---|---|---|---|
| COST-001 | 45 services bypass AI router -- no telemetry, cache, or budget tracking | P0 | Unbounded cost risk |
| COST-002 | Budget enforcement is alert-only -- no automatic throttling | P0 | No budget enforcement |
| COST-003 | Per-user AI cost controls implemented but never connected | P1 | No budget enforcement |
| COST-004 | Cost estimation tables duplicated in 3+ locations with inconsistencies | P1 | Cost tracking accuracy |
| COST-005 | Cascade escalation doubles API calls without separate telemetry | P1 | Cost tracking accuracy |
| COST-006 | In-memory cache has no persistence -- cold start on every deploy | P1 | Caching strategy |
| COST-007 | executive.ts uses naive token estimation for usage logging | P1 | Cost tracking accuracy |
| COST-008 | No Batch API usage for asynchronous workloads | P2 | Optimization |
| COST-009 | Model intelligence auto-promotion uses biased self-scoring | P2 | Model selection |
| COST-010 | Dual OpenAI key configuration creates confusion and shadow spend | P2 | Operational risk |
| COST-011 | scoreAndLearnFromResponse makes untracked AI calls on every chat | P2 | Cost tracking accuracy |
| COST-012 | 30-day telemetry retention prevents quarterly cost analysis | P2 | Observability |
| COST-013 | Usage count limits do not distinguish cost tiers | P2 | Budget enforcement |
| COST-014 | Large system prompts not flagged for prompt caching | P2 | Optimization |
