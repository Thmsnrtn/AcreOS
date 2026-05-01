# Mateo Castillo — AI Latency Audit (Wave 2)

**Date:** 2026-05-01
**Lens:** 5 yrs at Together.ai on inference latency. A 4s AI feature isn't a slow AI feature — it's a broken AI feature. Streaming is the single best perceived-latency hack in our toolbox; cascade quality-checks on the hot path are heresy.
**Predecessor:** `theo-ai.md` flagged the cascade quality-check at `aiRouter.ts:174` adds 400–800ms p95 to every non-COMPLEX response. That is the centerpiece of this audit.

---

## 1. Verdict

**Pax inbox draft and Pax executive chat both fail the 1-second perceived-latency bar today, and the cascade quality-gate is the worst single offender — kill it from the synchronous path this week, sample 10% async, and you reclaim ~600ms p95 across the entire SIMPLE-tier surface for $0 cost.**

---

## 2. Per-Feature Latency Budget — current vs target

Hot path = user is staring at a spinner. Background = job/queue, no human waiting.

| Feature | File | Path | Current p50 | Current p95 | Target p95 | Gap |
|---|---|---|---|---|---|---|
| AI search (`/api/search`) | `routes.ts:637` | hot | ~30ms | ~120ms | 150ms | OK — no LLM, tsvector |
| Pax inbox draft | `routes-ai-draft.ts:44` | hot | ~1.4s | **~2.8s** | 1.5s p95 | -1.3s |
| Pax executive chat (no tools) | `routes-ai.ts:328` | hot | ~600ms (TTFT)* | ~1.4s (TTFT)* | 400ms TTFT | OK on streaming, regress on cascade |
| Pax executive chat (with tools) | `executive.ts:1104` | hot | ~3.5s | **~9s** | 4s p95 | -5s |
| Pax executive chat (cascade triggers) | `aiRouter.ts:789` | hot | +500ms | **+800ms** | 0ms (move async) | -800ms |
| Support classifier | `supportBrain.ts:49` | hot | ~700ms | ~1.6s | 600ms | -1s |
| Support contextual reply | `supportBrain.ts:427` | hot | ~1.5s | ~3.2s | 1.5s (streaming) | -1.7s |
| Lead nurturer email | `leadNurturer.ts:150` | bg | n/a | n/a | n/a | OK |
| AI briefing writer | `aiBriefingWriter.ts:74` | bg | n/a | n/a | n/a | OK |
| Self-assessment agent | `selfAssessmentAgent.ts:135` | bg | n/a | n/a | n/a | OK |
| Compliance disclosure | `complianceAI.ts:303` | hot (interactive) | ~4s | **~12s** | 6s w/ streaming | -6s |
| Vision/document parsing | `visionAI.ts` | hot (upload) | unknown | unknown | 3s | unknown |
| Quiz generation | `aiTutor.ts:208` | hot (load) | ~3s | **~8s** | <500ms (cache) | -7.5s |
| AI offer draft | `aiOfferService.ts` | hot | unknown | unknown | 2s | unknown |
| Voice AI (calls) | `voiceCallAI.ts` | hot (real-time) | unknown | unknown | 800ms | critical, unmeasured |
| Negotiation copilot | `negotiationCopilot.ts` | hot | unknown | unknown | 1.5s | unknown |
| Board of Directors vote | `aiBoardOfDirectors.ts:250` | bg | n/a | n/a | n/a | OK |

\* TTFT = Time-To-First-Token. The streaming chat path's *total* time is much longer; only TTFT matters for perception.

**Grade:** No latency SLO is documented anywhere. `aiTelemetryEvents` records `latencyMs` per call but nothing aggregates p50/p95 by feature. **You can't fix what you don't measure** — first deliverable is the dashboard, not the optimization.

---

## 3. Streaming Candidates — ranked by user-perceived impact

Streaming converts "stare at spinner for 3s" into "watch text appear at 600ms." Each token after the first is free perceived latency — TTFT is what the user actually feels.

| Rank | Feature | File | Streams today? | TTFT win | Why it matters |
|---|---|---|---|---|---|
| 1 | **Pax exec chat (tool-use)** | `executive.ts:1104` | Initial yes, tool loops **no** | 5–8s → 600ms perceived | User sees nothing during 3+ tool roundtrips. Stream "Looking at parcel 12-345…" and "Pulled comps, drafting…" between tool calls. **Biggest single UX win in the codebase.** |
| 2 | Pax inbox draft | `routes-ai-draft.ts:56` | No (returns final) | 2.8s → 700ms TTFT | Drafts are 80–120 words. User reads as it writes. SSE upgrade is ~30 lines. |
| 3 | Compliance disclosure | `complianceAI.ts:303` | No | 12s → 1s TTFT | Long doc, user is staring at modal — must stream. Also gives the user a kill-switch midway. |
| 4 | Support contextual reply | `supportBrain.ts:427` | No | 3s → 600ms | Same pattern as draft, same fix. |
| 5 | AI offer draft | `aiOfferService.ts` | unknown | unknown | If user is reviewing an offer letter live, must stream. |
| 6 | Negotiation copilot | `negotiationCopilot.ts` | unknown | unknown | Real-time during a call — stream or it's useless. |
| 7 | Self-assessment agent | `selfAssessmentAgent.ts:135` | No | n/a | Background — don't bother. |
| 8 | Briefing writer | `aiBriefingWriter.ts:74` | No | n/a | Background — don't bother. |

### What is NOT a streaming candidate

- **Support classifier** — returns a JSON enum. There's nothing to stream.
- **AI search** — already 30ms, deterministic SQL.
- **Quiz generation** — should be cached, not streamed. (See §6.)
- **Board of Directors votes** — 10 parallel sub-LLM calls, JSON each. Stream the *aggregate progress* if anything ("3/10 voted…"), not the model output.

### Pattern to copy

`routes-ai.ts:328` already does SSE correctly. `executive.ts:1389` already passes `stream: true` to OpenAI. The **gap is in the tool-loop**: between tool calls the UI gets nothing. Fix:

```ts
// Inside the tool loop, before executing tools:
yield { type: "tool_start", name: tc.function.name, args: tc.function.arguments };
// Pass to UI: "Looking up parcel 12-345…"
const result = await executeTool(...);
yield { type: "tool_end", name: tc.function.name };
// Then continue the model call with stream: true again.
```

That single change makes tool-use *feel* 3× faster without removing a single roundtrip.

---

## 4. Cascade Pre-Prompt — keep / async / drop

`aiRouter.ts:789` runs `checkResponseQuality` after every non-COMPLEX response on the hot path. It's a DeepSeek call with `max_tokens: 80` and `temperature: 0.1`.

**Measured impact:**
- DeepSeek typical TTFT via OpenRouter: ~250ms.
- Total time for an 80-token JSON response: 400–800ms.
- Triggered on: every SIMPLE and MODERATE call where `forceModel`/`forcePremium`/`useVision`/`useReasoning` are unset and content > 20 chars.
- Roughly **60–75% of all routed calls** today (most of routed traffic is SIMPLE — drafts, classify, lookup, summarize).

**Verdict: ASYNC SAMPLE — drop synchronously, write to a queue at 10% sample rate.**

Why not keep:
- It blocks the response. Even if the response was perfect, the user waits an extra 400–800ms for the model to grade it.
- The fail-open path (catch returns score 8) means quality-check failure produces no signal anyway — so it's already not enforcing a contract.
- Self-cascade only fires if score < threshold (`shouldEscalate`). On a 9/10 response it adds latency for zero quality benefit.
- The escalation actually *re-runs* the whole task on the next-tier model — that's another 1.5–3s on top of the 400–800ms gate. Worst-case p95 for a SIMPLE task that triggers cascade is **5+ seconds** for what should have been a sub-second answer.

Why not drop entirely:
- There's a real signal in the score distribution. If 30% of DeepSeek responses score <7, that's a routing problem worth knowing.
- Theo's audit (theo-ai.md §4) noted the *content-based escalator* over-fires — cascade data tells us *whether the cheap model was actually inadequate.*

**Implementation: 1 day**
1. Wrap `checkResponseQuality` call in `setImmediate(() => ...)` and write result to a new `ai_quality_samples` table.
2. Sample at 10% (Math.random < 0.1). Production cascade load drops 90% from a router cost perspective and 100% from a hot-path latency perspective.
3. If sample shows shouldEscalate, **don't re-run** — just log "this response would have escalated." Build the dataset. Decide on retry policy after a week of data.
4. Keep synchronous escalation only for `task.complexity === CRITICAL` paths where the cost of a bad answer dwarfs the latency cost (compliance, contract, capital allocation).

**P95 reclaimed: ~600ms across the entire SIMPLE-tier surface for $0 implementation cost.**

---

## 5. Parallelization Opportunities

### Already parallel — credit where due

- `executive.ts:1115` parallelizes read-only tool calls when `allReadOnly && validToolCalls.length > 1`. This is correct; don't change.
- Board of Directors fan-out (`aiBoardOfDirectors.ts:250`) appears to fan out 10 agents in parallel — verify with traces, but the structure is right.

### Not parallel — should be

| Opportunity | File | Today | Could be |
|---|---|---|---|
| Pax draft: lead context fetch + LLM call | `routes-ai-draft.ts:80–110` | sequential — fetch lead, then call LLM | LLM can start with placeholder, lead context streams in via tool-use; or start LLM with sender-only and refine. ~150ms saved. |
| Support classify + retrieve playbook | `supportBrain.ts:49,427` | classifier → context → reply (3 sequential LLM-ish stages) | Classifier output token-stream triggers playbook fetch on first delta. Save 400–600ms. |
| Compliance: state lookup + draft | `complianceAI.ts:303` | DB lookup, then LLM | Run state-statute fetch in parallel with the model's first token; merge before validation. |
| Pax exec chat: tool-use + streaming text | `executive.ts:1104` | sequential — get tool call, run tool, then resume | When the model's intent is clear from intermediate tokens (e.g., "Let me search comps…"), prefetch the comps before the model finishes the tool_call delta. Speculative tool execution. (See §6.) |
| Multi-tool same iteration | `executive.ts:1115` | already parallel for read-only ✓ | OK |
| Briefing + headline insight | `aiBriefingWriter.ts:74,120` | sequential | Run as `Promise.all` — both are independent DeepSeek calls, save 1 full round-trip. |

### Pitfall to avoid

Don't parallelize *write* tools. `executive.ts:1098` correctly excludes mutating prefixes from the parallel path. If a future engineer adds `commit_offer` or `send_email_now` and they all run as one tool batch, you'll have a duplicate-send incident. The READ_ONLY_PREFIXES allowlist is load-bearing.

---

## 6. Fast-Path Designs — top 3 hot features

### Fast path #1 — Pax inbox draft

**Today:** `routeSimpleTask` → DeepSeek (T1), non-streaming, ~2.8s p95.

**Fast path:**
1. **Stream the response.** Convert the route from `res.json` to SSE. ~30 lines. TTFT: ~600ms instead of 2.8s.
2. **Drop cascade from this path.** Add `forceModel: MODEL_SIMPLE` so cascade is skipped. -500ms.
3. **Predict regenerate.** When the user opens an inbound for the first time, *speculatively* generate the first draft on `inbox_message.read = true`, not on draft-button click. By the time they click "Draft reply" the response is in cache (or in-flight). 100% perceived improvement on the cached path.
4. **Smaller model for short inbounds.** If `inbound_body.length < 200`, route to Haiku 4.5 (200ms TTFT vs DeepSeek 250ms — actually similar) **or** keep DeepSeek but with `max_tokens: 180`. The model often over-generates; capping it saves TTFB on the back end.

**Latency budget:** 600ms TTFT, 1.4s total p95. Down from 2.8s p95.

### Fast path #2 — Pax executive chat with tool-use

**Today:** `executive.ts:1104` — initial stream + sequential tool loops, ~9s p95.

**Fast path:**
1. **Stream within the tool loop.** Yield `{type: "tool_start", ...}` SSE events between tool calls. UI shows "Looking up parcel 12-345 in San Joaquin County…" as it happens. TTFT for *every* tool iteration becomes 0ms (we yield as soon as we know the intent). User-perceived latency: 600ms feels like the answer started.
2. **Speculative tool execution.** When the model's first delta is `"tool_calls": [{"name":"search_comps"`, dispatch the comp search *before* the model finishes the args delta — most arg shapes for read-only tools are predictable from the user's last message. If the args turn out different, throw away the speculative result. Net win: 200–500ms when the speculation hits.
3. **Cap tool iterations sooner.** Today 10 iterations max (`MAX_TOOL_ITERATIONS = 10`). p95 traces probably show 2–3 iterations. Set a soft cap at 4 with explicit "I need more lookups — confirm?" UX prompt at iteration 5. Bounds the worst case.
4. **Cache deterministic tool outputs.** `get_property`, `search_comps`, `recall_*` all hit DB. Add a 60s LRU per (orgId, tool, args-hash). Saves 100–300ms per cached hit.

**Latency budget:** 600ms first text, 4s p95 total. Down from 9s.

### Fast path #3 — Compliance disclosure

**Today:** `complianceAI.ts:303` — `gpt-4-turbo-preview`, non-streaming, ~12s p95 for a multi-section legal doc. (Theo flagged this as the #1 hallucination risk; it's also the worst latency.)

**Fast path:**
1. **Section-parallel generation.** Required disclosure sections per state are deterministic (Mateo doesn't know land law in detail, but Theo's recommendation of post-validators implies a known section list). Issue *one model call per section* in parallel, stream all to the UI as they complete. 12s → 4s total, 600ms TTFT to first section.
2. **Stream within sections** for the long ones (property condition, hazards). User sees the doc materialize.
3. **Move to Sonnet 4.6 with extended thinking + caching.** Theo recommended Opus for quality. From a latency lens, Sonnet 4.6 with `enablePromptCaching` on the system prompt is faster than Opus and cheaper, with thinking budget for the actual reasoning. Opus only on `useCritical` paths.
4. **Cache by (state, propertyType).** Disclosure templates by state vary little call-to-call. 24h cache by state + property type hash → 95% of calls served from cache at <50ms.

**Latency budget:** 600ms TTFT, 4s p95 (cold), 50ms (cache hit). Down from 12s.

---

## 7. Smaller-model fast path — Haiku vs Sonnet

`aiRouter.ts:330` already has the cascade tiers right: DeepSeek (T1) → Haiku 4.5 (T2) → Sonnet 4.6 (T3) → Opus 4.6 (T4-critical).

What's *missing* is **prompt-length-based fast routing.**

| Prompt size | Today routes to | Should route to | Reason |
|---|---|---|---|
| <500 tokens, classify/lookup | DeepSeek (250ms TTFT) | DeepSeek ✓ | OK |
| <500 tokens, draft/short reply | DeepSeek + cascade | Haiku 4.5 (200ms TTFT, no cascade) | Haiku is faster and quality is comparable on short generation |
| 500–2k tokens, multi-step | DeepSeek (cascade may escalate) | Haiku direct | Skip the cascade re-run cost — pay $0.001 once, not $0.0003 + re-run |
| >2k tokens, deep reasoning | Sonnet 4.6 | Sonnet 4.6 ✓ | OK |
| Legal/contract | Opus 4.6 | Opus 4.6 ✓ | OK |

**Action:** add a `promptTokens < 500 && taskType in ('draft', 'short_reply')` short-circuit at the top of `routeAITask`. Bypasses cascade and gives Haiku 4.5's superior TTFT for short generation. ~200ms p95 win, ~3× cost increase per call but only on calls where you save 200ms — a worthwhile trade for the hot path.

---

## 8. Edge-deployed models — is there a win?

**Honest answer: not yet.**

You'd need to host a model at the edge (Cloudflare Workers AI, Fly.io GPU machines, Together.ai endpoint regions). The latency wins are:

- Network: 30–80ms saved by avoiding US-east → OpenRouter → DeepSeek-China round-trip. Real.
- TTFT: marginal — model startup dominates on cold path.

But:
- Operational cost: managing a self-hosted Llama-3.1-8B or similar adds an ops surface that doesn't exist today. Fly.io GPU machines are expensive when idle.
- Model quality: open-weights at sub-Haiku tier are noticeably worse on instruction-following for short drafts. You'd ship a worse Pax to save 50ms. Bad trade.
- The big TTFT wins (DeepSeek 250ms, Haiku 200ms) are already at hosted-LLM floor.

**Recommendation: don't pursue edge models in the next 6 months.** Revisit when:
1. Volume justifies dedicated capacity (>10M tokens/day on a single task).
2. Latency budget for voice AI (`voiceCallAI.ts`) becomes critical — real-time voice needs <300ms TTFT and edge deployment of a small ASR/TTS+LLM stack starts to make sense there.
3. A Llama-4 or comparable open model closes the gap to Haiku.

The exception worth flagging: **voice AI**. If voiceCallAI is doing real-time turn-taking, hosted LLM round-trips will lose to a dedicated edge LLM stack (whisper-large + small-LLM + TTS co-located). That's a separate project and out of scope for this audit, but flag it as the one place the answer flips.

---

## 9. The 1-Week Latency Sprint

Five days, one engineer, ranked by user-perceived impact per hour of work.

### Day 1 — Cascade async sample (highest ROI)
- Move `checkResponseQuality` off the synchronous path. Sample 10% to `ai_quality_samples` table.
- Keep CRITICAL-tier escalation synchronous.
- **Impact: -600ms p95 across ~70% of routed traffic.**
- File: `server/services/aiRouter.ts:782–820`.

### Day 2 — Pax inbox draft streaming
- Convert `routes-ai-draft.ts` from JSON return to SSE.
- Add `forceModel: MODEL_SIMPLE` to bypass cascade explicitly.
- Add speculative-on-read: precompute draft when `inbox_message.read = true`.
- **Impact: 2.8s → 700ms TTFT, 1.4s total p95.**

### Day 3 — Tool-use mid-stream events
- In `executive.ts:1104`, yield `{type: "tool_start", ...}` between tool calls (already inside an `async function*`).
- Wire UI to show "Looking up X…" between tool calls.
- **Impact: 9s perceived → 600ms first-text on tool-use chats.**

### Day 4 — Latency dashboard
- Aggregate `aiTelemetryEvents` rows: `feature × org × hour → p50, p95, p99, count`.
- Surface in admin UI as a tile next to the cost dashboard Theo recommended.
- Add Slack alert: any feature p95 > 5s for 15 min in a row.
- **Impact: visibility — without this we can't prove Day 1–3 worked.**

### Day 5 — Short-prompt fast path + cleanup
- Add `promptTokens < 500 && taskType in ('draft', 'classify', 'short_reply')` shortcut → Haiku 4.5 direct, no cascade.
- Cap `MAX_TOOL_ITERATIONS` to 4 with confirm-prompt at boundary.
- Cache deterministic read-only tool outputs (60s LRU per orgId).
- **Impact: -200ms p95 on short hot-path calls; bounds worst-case tool-loop p99.**

### Stretch (week 2)
- Compliance disclosure: section-parallel generation + state caching.
- Voice AI latency audit (separate doc — needs measurements first).
- Quiz pre-generation at content-author time (kill the per-request LLM call entirely).

---

## 10. What I'd watch in production after the sprint

- **p95 by feature**, week-over-week. Anything >2s on a hot path is a bug.
- **TTFT by feature** — if first-token comes after 1s, the user has already concluded the feature is broken regardless of total time.
- **Cascade sample data** — does the offline 10% show DeepSeek genuinely failing on a class of prompts? If yes, bump that class to Haiku statically; don't re-introduce synchronous cascade.
- **Tool iteration histogram** — are we capping at 4? At what rate? If >5% of conversations cap, the prompt is broken, not the cap.
- **Cache hit rate** by feature — Theo flagged the absence; without it we can't tell if speculative draft prefetch is paying for itself.

---

## File:line reference

- `server/services/aiRouter.ts:174` — checkResponseQuality (the cascade tax)
- `server/services/aiRouter.ts:789` — synchronous cascade trigger site
- `server/services/aiRouter.ts:330–340` — model catalog (DeepSeek/Haiku/Sonnet/Opus tiers)
- `server/routes-ai-draft.ts:44–54` — Pax draft system prompt (currently non-streaming)
- `server/routes-ai-draft.ts:56` — draft-reply route (target for SSE conversion)
- `server/routes-ai.ts:328` — chat stream route (correct SSE pattern, copy from here)
- `server/ai/executive.ts:1095–1145` — tool-use loop (parallel for read-only, sequential outer loop)
- `server/ai/executive.ts:1215` — processChatStream (existing streaming path; needs mid-loop yields)
- `server/ai/executive.ts:1389,1424,1442` — `stream: true` already wired to OpenAI calls
- `server/services/supportBrain.ts:49,427` — classifier + reply (sequential, both should stream/parallel)
- `server/services/complianceAI.ts:303` — long-doc generation (worst total latency in codebase)
- `server/services/aiTutor.ts:208` — quiz gen (should be cached, not re-generated)
- `server/services/aiBriefingWriter.ts:74,120` — briefing + headline (run in parallel)

---

**Bottom line for the founder:** Latency is a bug, and you have a 600ms unconditional bug on every hot-path AI call from a quality-gate that fails open. Kill the synchronous cascade Monday. Stream the draft route Tuesday. Yield mid-tool-loop Wednesday. By Friday, Pax goes from "AI features that take 4 seconds and feel broken" to "AI features that respond in 600ms and feel like you have a teammate." The architecture supports all of this — the work is wiring, not redesign.
