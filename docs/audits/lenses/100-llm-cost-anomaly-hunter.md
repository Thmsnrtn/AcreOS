# Lens 100 -- LLM Cost Anomaly Hunter

**Auditor persona:** LLM Cost Anomaly Hunter (Runaway Loops, Expensive Patterns)
**Tier:** 3
**Date:** 2026-04-18
**Distinct from lens 39:** Lens 39 covers the general cost/ops landscape (bypass counts, budget architecture, telemetry gaps). This lens traces **specific code paths that could cause $100+ bills from a single user action** -- unbounded loops, cascading multi-call chains, missing token caps on expensive models, and absent disconnect handling.

---

## Executive Summary

AcreOS has multiple code paths where a single user action or automated trigger can generate **unbounded or massively multiplied LLM spend** with no kill switch. The worst offenders are:

1. **Two unbounded tool-calling loops** (`vaService.ts`, `supportAgent.ts`) that will call the LLM indefinitely if the model keeps requesting tools -- no iteration cap whatsoever.
2. **A streaming tool loop** (`executive.ts` `processChatStream`) with no iteration limit that also **has no client-disconnect handling** -- if the user closes the browser tab, the server continues calling the LLM in a loop until the model stops requesting tools.
3. **The quality cascade in `aiRouter.ts`** that silently doubles every call: it fires a quality-check LLM call on every non-complex response, and if the quality score is low, fires a third call on a more expensive model -- meaning a single `routeAITask()` can trigger 3 LLM calls (original + quality check + escalation).
4. **The model intelligence benchmark system** that makes 6 LLM calls per new model (3 tiers x 2 calls each: generation + self-scoring), with no per-run cost cap.
5. **The evolution pipeline** that chains 3 expensive LLM calls (Opus + GPT-4o + DeepSeek Reasoner) per proposal with no aggregate cost tracking.
6. **Per-user cost controls exist but are completely unwired** -- `userAiCostControls.ts` is imported by zero files. `callWithCreditCheck` and `callWithCircuitBreaker` from `openaiClient.ts` are also imported by zero files.

A single determined user interacting with the Atlas chat agent could, through the unbounded streaming loop, generate 50+ LLM calls in one session with no cap. At Sonnet 4.6 pricing ($3/$15 per million tokens) with multi-turn tool use, a single conversation could cost $5-$20. A malicious user crafting adversarial prompts that trigger repeated tool calls could push this to $100+ in minutes.

---

## Findings

### RUNAWAY-001: Unbounded Tool-Calling Loops in vaService.ts and supportAgent.ts

**Severity: P0 -- Single user action can trigger unlimited LLM calls**
**Cost scenario: $50-$500+ from one request**

Two services have `while (assistantMessage.tool_calls)` loops with **no iteration limit**:

**`server/ai/vaService.ts` line 648:**
```typescript
while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
  // Execute tools, then call LLM again -- NO LIMIT
  response = await openai.chat.completions.create({
    model: "gpt-4o",  // $2.50/$10.00 per million tokens
    messages,
    tools: tools.length > 0 ? tools : undefined,
    max_tokens: 2048
  });
  assistantMessage = response.choices[0].message;
}
```

**`server/ai/supportAgent.ts` line 5243:**
```typescript
while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
  // Same unbounded pattern, also gpt-4o
  response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: chatMessages,
    tools,
    tool_choice: "auto"
    // NO max_tokens set here
  });
  assistantMessage = response.choices[0].message;
}
```

The `supportAgent.ts` version is worse because:
- It also lacks `max_tokens` on the inner loop calls, so each iteration can generate unlimited output tokens
- It uses `tool_choice: "auto"` which gives the model full discretion to keep calling tools

**Contrast:** `executive.ts` line 991 has `MAX_TOOL_ITERATIONS = 10` for its non-streaming path -- proving the team knows this is a risk, but the fix was not applied to the other two services.

**Recommendation:** Add `MAX_TOOL_ITERATIONS` (e.g., 10) to both loops. Abort with a graceful error message when the limit is hit.

---

### RUNAWAY-002: Streaming Tool Loop Has No Iteration Limit AND No Disconnect Handling

**Severity: P0 -- Runs indefinitely on abandoned connections**
**Cost scenario: $20-$200+ per abandoned streaming session**

**`server/ai/executive.ts` `processChatStream` (line 1304):**
```typescript
while (continueLoop) {
  stream = await client.chat.completions.create({
    model,
    messages: chatMessages,
    tools: tools.length > 0 ? tools : undefined,
    max_tokens: 2048,
    stream: true,
  });
  // ... process stream ...
  if (currentToolCalls.length > 0) {
    // Execute tools, push results to chatMessages, loop again
  } else {
    continueLoop = false;  // Only exit when no more tool calls
  }
}
```

This loop has two compounding problems:

1. **No iteration limit.** Unlike the non-streaming `processChat` which has `MAX_TOOL_ITERATIONS = 10`, the streaming variant loops until the model stops requesting tools. A model that enters a tool-calling cycle will loop forever.

2. **No client disconnect detection.** The SSE handler in `routes-ai.ts` (line 344) does a simple `for await (const event of stream)` with no `req.on("close")` abort signal. When the user navigates away or closes the tab:
   - The HTTP connection drops
   - The `res.write()` calls will silently fail (Node buffers writes to closed connections)
   - But the `processChatStream` generator continues executing -- making LLM calls, executing tools, and accumulating cost
   - The loop only terminates when the model finally stops requesting tools

The only `req.on("close")` handler in the entire `routes-ai.ts` file is for the SSE observatory endpoint (line 1784), not for the chat stream.

**Recommendation:**
- Pass an `AbortController` signal to the generator
- Add `req.on("close", () => controller.abort())` in the route handler
- Check the signal at the top of each loop iteration
- Add `MAX_STREAM_TOOL_ITERATIONS` (suggest 15 for streaming)

---

### RUNAWAY-003: Quality Cascade Silently Triples Every Non-Complex Call

**Severity: P1 -- Every chat message may generate 3 LLM calls instead of 1**
**Cost scenario: Ongoing 2-3x cost multiplier on all non-complex traffic**

The `routeAITask()` function in `aiRouter.ts` (line 782-821) implements a "quality-gated cascade" that fires **on every non-complex, non-critical response**:

1. **Original call** -- e.g., DeepSeek Chat ($0.14/$0.28 per M tokens)
2. **Quality check call** (line 196-213) -- Always fires on DeepSeek (MODEL_SIMPLE) to score the response, with `max_tokens: 80`. Cost: ~$0.002 per check.
3. **Escalation call** (if quality score < 6) -- Fires on the next tier model (Haiku or Sonnet) with full `max_tokens`.

This means:
- Best case: 2 LLM calls per simple/moderate task (original + quality check)
- Worst case: 3 LLM calls per task (original + quality check + escalation to expensive model)
- The quality check is **not cached** -- even if the original response was from cache, any non-cached response gets quality-checked
- The escalation call's cost is tracked in telemetry, but the quality check call is **invisible** -- its cost is not recorded by `recordAITelemetry`

If 20% of simple tasks fail the quality check and escalate to Haiku ($0.80/$4.00 per M), the effective cost of the "cheap" tier is roughly 2-3x the DeepSeek sticker price.

The `CASCADE_ENABLED = true` flag exists but is hardcoded with no runtime toggle.

**Recommendation:**
- Add telemetry for quality-check calls (they are currently invisible)
- Add a runtime toggle (env var or DB config) for CASCADE_ENABLED
- Consider caching quality scores alongside responses
- Set a minimum response length threshold higher than 20 chars before triggering the cascade

---

### RUNAWAY-004: Model Intelligence Benchmarking -- 6 LLM Calls Per Model, Self-Scoring Loop

**Severity: P1 -- Automated system burns tokens benchmarking new models**
**Cost scenario: $5-$50 per weekly run, multiplied by newly discovered models**

`server/services/modelIntelligence.ts` runs a weekly benchmark job:
- For each new model (up to `MAX_NEW_MODELS_PER_RUN = 3`), it runs 3 benchmark prompts (simple, moderate, complex)
- Each benchmark prompt triggers **2 LLM calls** (line 252-306): one for generation (`max_tokens: 1024`) and one for self-scoring (`max_tokens: 64`)
- Total: 6 LLM calls per new model, 18 calls per weekly run

The self-scoring pattern (line 276-305) is inherently unreliable -- the model grades its own output -- and adds cost with questionable value. If the benchmarked model is expensive (e.g., an Opus variant), the 1024-token generation call alone could cost $0.50-$2.00 per benchmark tier.

There is no per-run cost cap. If the catalog sync discovers 100 new models, `MAX_NEW_MODELS_PER_RUN = 3` limits to 3 per run, but consecutive runs will work through the backlog.

**Recommendation:**
- Cap benchmark cost per run (e.g., skip models with input cost > $5/M tokens)
- Use a fixed cheap model (DeepSeek) for scoring instead of self-scoring
- Add a cost estimate before each benchmark and abort if projected cost exceeds threshold

---

### RUNAWAY-005: Evolution Pipeline -- 3 Expensive Model Calls per Proposal (Opus + GPT-4o + DeepSeek R1)

**Severity: P1 -- $0.50-$5.00 per pipeline run, triggered automatically**
**Cost scenario: $50+ if many proposals queue up**

`server/services/evolutionPipeline.ts` chains three LLM calls for each approved self-assessment proposal:

1. **Stage 1 -- Code Generation:** `anthropic/claude-opus-4-6` ($15/$75 per M tokens), `max_tokens: 4000`
2. **Stage 2 -- Adversarial Review:** `openai/gpt-4o` ($2.50/$10.00 per M tokens), `max_tokens: 2000`
3. **Stage 3 -- Intent Verification:** `deepseek/deepseek-reasoner` ($0.55/$2.19 per M tokens), `max_tokens: 1500`

A single pipeline run with a large code change could cost $2-$5 in tokens. The pipeline is triggered by approved `agentTasks` from the self-assessment agent, which itself uses Opus ($15/$75 per M tokens) for analysis.

The full chain from self-assessment to evolution: Opus (assessment) + Opus (codegen) + GPT-4o (review) + DeepSeek R1 (verification) = potentially $5-$10 per autonomous code change.

The circuit breaker (`evolutionCircuitBreaker`) protects against repeated deployments but does NOT limit LLM cost -- it only trips on consecutive reverts.

**Recommendation:** Add a per-proposal cost estimate before starting Stage 1. Add a daily cost cap for the evolution pipeline independent of the circuit breaker.

---

### RUNAWAY-006: Per-User Cost Controls Exist But Are Completely Unwired

**Severity: P0 -- The guardrails are theater**
**Cost scenario: Unlimited spend per user with no enforcement**

Three separate cost-control mechanisms are defined but never used:

| Mechanism | Defined in | Imported by |
|-----------|-----------|-------------|
| `userAiCostControls.checkBudget()` | `server/services/userAiCostControls.ts` | **0 files** |
| `callWithCreditCheck()` | `server/utils/openaiClient.ts` | **0 files** |
| `callWithCircuitBreaker()` | `server/utils/openaiClient.ts` | **0 files** |

`userAiCostControls` has a well-implemented daily limit ($5 default) and monthly limit ($50 default) with Redis-backed tracking. But no route handler or service ever calls `checkBudget()` before making an LLM call, and no service calls `recordUsage()` after one.

`callWithCreditCheck` wraps LLM calls with org-level credit verification and deduction. It is exported and documented but called by zero services.

**Impact:** There is literally no mechanism preventing a single user from generating unlimited LLM costs. The `usageLimitGate` middleware in routes-ai.ts counts raw request counts (not cost), and the credit system checks are never applied to LLM calls.

**Recommendation:** Wire `userAiCostControls.checkBudget()` into the `routeAITask()` function in `aiRouter.ts` as a pre-check. Wire `recordUsage()` after each call. This single change would protect all traffic that goes through the router.

---

### RUNAWAY-007: 16 Services Use Deprecated/Expensive `gpt-4-turbo-preview` Model

**Severity: P2 -- Cost inefficiency, potential API errors**
**Cost scenario: 2-4x overspend on affected calls**

16 call sites across 8 services hardcode `gpt-4-turbo-preview`, a deprecated model alias that:
- May resolve to an older, more expensive model version
- Bypasses the router's cost-optimized model selection
- Does not benefit from the OpenRouter routing (these all use direct OpenAI clients)

Affected services: `negotiationOrchestrator.ts` (4 calls), `voiceAI.ts` (4 calls), `aiTutor.ts` (3 calls), `acreOSValuation.ts` (1 call), `portfolioOptimizer.ts` (1 call), `complianceAI.ts` (1 call), `visionAI.ts` (1 call), `routes-academy.ts` (1 call).

**Recommendation:** Replace all `gpt-4-turbo-preview` references with the appropriate router call (`routeAITask`, `routeComplexTask`, etc.) or at minimum update to `gpt-4o`.

---

### RUNAWAY-008: Missing `max_tokens` on Multiple LLM Calls Including Expensive Models

**Severity: P1 -- Unbounded output token generation**
**Cost scenario: $10-$50 per call if model generates maximum output**

Several LLM calls omit `max_tokens`, allowing the model to generate up to its maximum output length:

| File | Line | Model | Missing max_tokens |
|------|------|-------|--------------------|
| `negotiationOrchestrator.ts` | 81 | gpt-4-turbo-preview | Yes |
| `negotiationOrchestrator.ts` | 195 | gpt-4-turbo-preview | Yes |
| `negotiationOrchestrator.ts` | 540 | gpt-4-turbo-preview | Yes |
| `negotiationOrchestrator.ts` | 857 | gpt-4-turbo-preview | Yes (tool loop) |
| `portfolioOptimizer.ts` | 515 | gpt-4-turbo-preview | Yes |
| `decisionsInbox.ts` | 165 | gpt-4o-mini | Yes |
| `revenueProtection.ts` | 105 | gpt-4o-mini | Yes |
| `supportAgent.ts` | 5270 | gpt-4o | Yes (inside unbounded loop) |

The `supportAgent.ts` case is the worst: inside an unbounded `while` loop, each iteration can generate unlimited output tokens on `gpt-4o` ($10/M output tokens). If the model generates 4K output tokens per iteration and loops 20 times, that is 80K output tokens = $0.80 per conversation just in output tokens, with no limit on iterations.

**Recommendation:** Set `max_tokens` on every `chat.completions.create` call. For tool-calling loops, use a conservative limit (500-1000) for the inner iterations.

---

### RUNAWAY-009: Due Diligence Pod Triggers 7 Parallel Research Agents + 2 Summary LLM Calls

**Severity: P2 -- Single button click triggers 9 LLM calls**
**Cost scenario: $1-$5 per dossier, acceptable if rate-limited**

`server/services/dueDiligencePods.ts` `runDossierPod()` (line 148) runs 7 parallel research tasks via `Promise.allSettled`, then calls `generateRecommendation()` (1 LLM call) and `aggregateToExecutiveSummary()` (1 LLM call). All 9 calls use GPT-4o directly (bypassing the router).

While each call has `max_tokens` set (200-300), the parallel execution means all 7 research tasks fire simultaneously, consuming 7x the tokens in a burst. There is no per-org rate limit on dossier creation, so a user could trigger multiple dossiers concurrently.

**Recommendation:** Add a per-org concurrent dossier limit. Route these calls through the AI router for telemetry and caching.

---

### RUNAWAY-010: Score-and-Learn Pattern Adds Hidden LLM Call to Every Chat Response

**Severity: P2 -- Silent cost multiplier on chat traffic**
**Cost scenario: 1 extra LLM call per chat message, $0.001-$0.005 each**

`server/ai/executive.ts` line 20-69 implements `scoreAndLearnFromResponse()`, a fire-and-forget function that:
- Makes an LLM call to DeepSeek Chat (`max_tokens: 200`) after **every** assistant response
- Scores the response quality (1-10)
- Writes success/failure patterns to `agentMemory`

This is called unconditionally (no sampling, no opt-out, no cost tracking). At high chat volume, this doubles the number of LLM calls for the chat feature. The calls use DeepSeek Chat ($0.14/$0.28 per M tokens), so individual cost is low, but it is completely invisible to telemetry.

**Recommendation:** Add a sampling rate (e.g., score 10% of responses). Track the cost in telemetry. Consider making this opt-in per org.

---

## Risk Matrix

| ID | Finding | Severity | Single-Action Cost Risk | Fix Complexity |
|----|---------|----------|------------------------|----------------|
| RUNAWAY-001 | Unbounded tool loops (vaService, supportAgent) | P0 | $50-$500+ | Low (add counter) |
| RUNAWAY-002 | Streaming loop + no disconnect handling | P0 | $20-$200+ | Medium (AbortController) |
| RUNAWAY-006 | Cost controls completely unwired | P0 | Unlimited | Medium (wire into router) |
| RUNAWAY-003 | Quality cascade triples calls | P1 | 2-3x ongoing multiplier | Low (add toggle + telemetry) |
| RUNAWAY-008 | Missing max_tokens on expensive models | P1 | $10-$50 per call | Low (add parameter) |
| RUNAWAY-005 | Evolution pipeline 3-model chain | P1 | $2-$10 per proposal | Medium (add cost cap) |
| RUNAWAY-004 | Benchmark self-scoring loop | P1 | $5-$50 per run | Low (use fixed scorer) |
| RUNAWAY-007 | Deprecated gpt-4-turbo-preview model | P2 | 2-4x overspend | Low (update model strings) |
| RUNAWAY-009 | DD pod 9 parallel calls | P2 | $1-$5 per dossier | Low (add rate limit) |
| RUNAWAY-010 | Score-and-learn hidden calls | P2 | $0.001-$0.005 per chat | Low (add sampling) |

## Worst-Case Scenario Trace

**Path to a $100+ bill from a single user session:**

1. User opens Atlas chat and sends a complex query with file attachments
2. `processChatStream` (executive.ts) routes to Sonnet 4.6 ($3/$15 per M tokens)
3. Model requests tool calls -- streaming loop iterates (no limit)
4. Each iteration: tool execution + LLM call with 2048 max_tokens
5. Quality cascade fires on each response (quality check + possible escalation)
6. Score-and-learn fires after each response (hidden DeepSeek call)
7. User navigates away -- no abort signal, loop continues
8. After 20 tool iterations: ~40K+ input tokens, ~40K+ output tokens per iteration accumulating context
9. Estimated cost: 20 iterations x ($3 * 40K/1M + $15 * 2K/1M) = ~$3 per iteration = **$60+**
10. With escalation cascades: could reach **$100-$200+**

This scenario requires no malicious intent -- just a complex query that triggers many tool calls, followed by the user closing the tab.

---

## Recommended Priority Actions

### Immediate (P0 -- do this week)
1. Add `MAX_TOOL_ITERATIONS = 10` to `vaService.ts` line 648 and `supportAgent.ts` line 5243
2. Add `MAX_STREAM_TOOL_ITERATIONS = 15` to `executive.ts` `processChatStream` (line 1304)
3. Add `req.on("close")` with AbortController to the SSE streaming route in `routes-ai.ts` (line 328-354)
4. Wire `userAiCostControls.checkBudget()` into `routeAITask()` as a pre-check gate

### Short-term (P1 -- do this sprint)
5. Add `max_tokens` to all LLM calls that lack it (8 call sites identified)
6. Add telemetry recording for quality-cascade calls
7. Add runtime toggle for `CASCADE_ENABLED` (env var or DB config)
8. Add per-proposal cost cap to evolution pipeline

### Medium-term (P2 -- do this month)
9. Replace all `gpt-4-turbo-preview` with router calls or `gpt-4o`
10. Add sampling rate to score-and-learn pattern
11. Add per-org concurrent dossier limit
12. Add cost-per-benchmark cap to model intelligence service
