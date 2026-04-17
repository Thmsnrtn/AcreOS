# Lens 36 -- AI Systems Architecture Audit

**Auditor persona:** AI Systems Architect
**Date:** 2026-04-15
**Codebase snapshot:** commit ff7b154 (main)

---

## Executive Summary

AcreOS has a sophisticated AI integration spanning 49+ services that call LLMs, a multi-model routing layer (OpenRouter), 10+ named SCP agents with trust-gated autonomy, and a rich tool-calling executive assistant (Atlas/Pax). The architecture includes genuine strengths: tiered model routing with cost-aware escalation, quality-gated cascading, dual-layer response caching, structured output validation (Zod schemas for financial outputs), prompt injection middleware, agent rate limiting with anomaly detection, TCPA compliance checks on AI-initiated communications, and a graduated financial authority gate with multi-agent consensus spending controls.

However, there are critical safety gaps. The **tool execution loop in `processChat` has no iteration bound** -- a model that continuously requests tool calls will loop indefinitely, generating unbounded API cost and server resource consumption. The **per-user AI cost control system (`userAiCostControls.ts`) is fully implemented but never wired into any route handler**, meaning per-user daily/monthly budgets are not enforced. The **prompt injection middleware covers only 4 URL prefixes** while AI-calling routes exist on at least 6 additional path patterns. The **non-streaming `processChat` function bypasses the APPROVAL_REQUIRED_TOOLS gate entirely**, meaning emails and SMS messages sent through the non-streaming path execute without user confirmation. And the **cost estimation tables are duplicated in 3 locations** with inconsistent model coverage, causing inaccurate cost tracking for Claude models in the executive chat paths.

---

## Findings

### AI-001: Unbounded Tool Execution Loop in processChat (Non-Streaming)
**Severity: P0**

`server/ai/executive.ts:991` -- the non-streaming `processChat` function contains a `while` loop that continues as long as the model returns tool calls:

```typescript
while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    // ... execute tools, call model again ...
    assistantMessage = response.choices[0].message;
}
```

There is no iteration counter, no maximum loop count, and no timeout. If the model enters a degenerate loop (e.g., repeatedly calling the same tool), this will:
1. Generate unbounded OpenRouter API costs (each iteration is a full LLM call)
2. Consume server resources indefinitely (blocking the request thread on Fly.io's 2-machine fleet)
3. Accumulate tool side effects (data writes, activity log entries)

The streaming path (`processChatStream`) has the same issue at line 1289 (`while (continueLoop)`).

**Evidence:** grep for `max_iterations`, `max.*loop`, or `MAX_TOOL` in `executive.ts` returns zero matches.

**Remediation:** Add a `MAX_TOOL_ITERATIONS = 10` constant and break the loop when exceeded, returning a partial response explaining the limit was reached.

---

### AI-002: Non-Streaming processChat Bypasses Tool Approval Gate
**Severity: P0**

The streaming `processChatStream` function correctly checks `APPROVAL_REQUIRED_TOOLS` at line 1382 and yields an `approval_required` event for tools like `send_email`, `send_sms`, `send_gmail`, `send_slack_message`, and `create_stripe_payment_link`. However, the non-streaming `processChat` function (line 991-1033) executes all tool calls unconditionally -- it never checks `APPROVAL_REQUIRED_TOOLS`.

**Evidence:**
- `server/ai/executive.ts:991-1033` -- the non-streaming tool loop calls `executeTool` directly with no approval check
- `server/ai/executive.ts:1382` -- the streaming path correctly gates on `APPROVAL_REQUIRED_TOOLS`
- The non-streaming endpoint is `/api/ai/chat` (routes-ai.ts:203)

**Impact:** If a user sends a chat message via the non-streaming endpoint, Atlas can autonomously send emails, SMS messages, Gmail messages, and Slack messages without any user confirmation. This is the exact class of action that the APPROVAL_REQUIRED_TOOLS mechanism was designed to prevent.

**Remediation:** Add the same `APPROVAL_REQUIRED_TOOLS.has(toolCall.function.name)` check to the non-streaming tool loop, returning the approval requirement as part of the response JSON.

---

### AI-003: Per-User AI Cost Controls Implemented But Never Wired In
**Severity: P0**

`server/services/userAiCostControls.ts` implements a complete per-user AI budget system with daily/monthly limits, Redis-backed tracking, and budget-check/record-usage APIs. However, a search for `userAiCostControls` across the entire server codebase (excluding the definition file itself) returns **zero matches**. The module is never imported or called.

**Evidence:**
- `userAiCostControls.checkBudget()` and `userAiCostControls.recordUsage()` are never called from any route or service
- The default limits ($5/day, $50/month per user) exist only in the file itself
- The AI chat routes (`routes-ai.ts:203`, `routes-ai.ts:283`) use `checkUsageLimit` (a count-based limiter) and `creditService` (org-level), but not user-level cost controls

**Impact:** There is no per-user AI spending cap. A single user in an organization can consume the entire org's AI budget. The org-level credit system provides some protection, but the intended per-user granularity is absent.

**Remediation:** Import and call `userAiCostControls.checkBudget()` before AI calls in `routes-ai.ts`, and `userAiCostControls.recordUsage()` after successful responses.

---

### AI-004: Prompt Injection Middleware Covers Only 4 of 10+ AI Route Prefixes
**Severity: P0**

The prompt injection middleware is applied to exactly 4 URL prefixes in `server/routes.ts:583-586`:

```typescript
app.use("/api/ai", promptInjectionMiddleware);
app.use("/api/atlas", promptInjectionMiddleware);
app.use("/api/chat", promptInjectionMiddleware);
app.use("/api/executive", promptInjectionMiddleware);
```

Multiple AI-calling route files are registered under different prefixes that are **not covered**:

| Route file | Path prefix | Prompt injection guard |
|---|---|---|
| `routes-core-ai.ts` | `/api/agents/execute`, `/api/agents/skills/*/execute` | NONE |
| `routes-ai-operations.ts` | `/api/ai-ops/*` | NONE |
| `routes-founder-intelligence.ts` | `/api/founder/*` | NONE |
| Support agent (Sophie) | `/api/support/*` | NONE |

**Evidence:** grep for `promptInjection` in `routes-core-ai.ts` and `routes-ai-operations.ts` returns zero matches. The `routes-core-ai.ts:104` endpoint accepts arbitrary `action` and `parameters` from `req.body` and passes them to `executeAgentTask` without sanitization.

**Impact:** An attacker can inject adversarial instructions through the uncovered endpoints to manipulate AI agent behavior, extract system prompts, or influence autonomous agent decisions.

**Remediation:** Apply `promptInjectionMiddleware` globally to all `/api/` routes that accept user text, or at minimum add it to the uncovered AI route files.

---

### AI-005: PII Masking Middleware Defined But Never Applied to Requests
**Severity: P1**

`server/middleware/piiMasking.ts` exports `piiMaskingMiddleware` for Express request processing, but it is **never mounted** via `app.use()`. The only active component is `installConsoleInterceptor()` (called at startup in `server/index.ts:42`), which masks PII in console output.

This means:
- PII in request bodies (lead emails, phone numbers, SSNs from imports) flows directly into AI system prompts without masking
- The `get_leads` and `get_lead_details` tools return full PII (email, phone, name) which gets injected into the conversation context sent to OpenRouter
- OpenRouter processes requests through third-party model providers (DeepSeek, OpenAI, Anthropic) -- PII is transmitted to these external services

**Evidence:**
- grep for `app.use.*piiMask` returns zero matches (only the comment `app.use(piiMaskingMiddleware)` in the file's own docstring)
- `server/ai/tools.ts:926-937` -- the `get_leads` tool returns `email`, `phone`, `firstName`, `lastName` directly

**Impact:** Customer PII (lead contact information) is transmitted to external LLM providers in every Atlas/Pax conversation that involves lead data. This creates privacy and regulatory exposure.

**Remediation:** Either (a) mount `piiMaskingMiddleware` globally, or (b) sanitize PII fields in tool results before they enter the AI context, or (c) implement a PII-aware context builder that replaces identifiers with tokens (e.g., "Lead #42") and resolves them only in tool execution.

---

### AI-006: Model Override Accepts Arbitrary Model IDs Without Validation
**Severity: P1**

The streaming chat endpoint (`routes-ai.ts:280`) accepts a `modelOverride` parameter:

```typescript
modelOverride: z.string().optional(),
```

This string is passed directly to `executive.ts:944/1217` and used as the model ID for the OpenRouter API call:

```typescript
model = options.modelOverride || (imageFiles.length > 0 ? ... : result.model);
```

There is no allowlist validation. A user can specify any OpenRouter model ID, including extremely expensive models (e.g., `anthropic/claude-opus-4-6` at $75/M output tokens) regardless of their subscription tier or the task complexity.

**Evidence:** `server/routes-ai.ts:280` -- `modelOverride: z.string().optional()` with no enum constraint. `server/ai/executive.ts:944` -- used directly as the model parameter.

**Impact:** Users can bypass the cost-efficient routing system entirely, selecting Opus ($75/M) for trivial queries when the router would assign DeepSeek ($0.28/M). The org credit system provides some protection but at a flat per-request rate that does not vary by model.

**Remediation:** Validate `modelOverride` against `MODEL_PRESETS` or a tier-appropriate allowlist. Alternatively, apply model-specific credit costs so expensive models deduct proportionally.

---

### AI-007: Cost Estimation Tables Duplicated and Inconsistent Across 3 Locations
**Severity: P1**

Model cost estimation is defined in three separate locations with different model coverage:

| Location | Models covered | Claude Sonnet/Opus included? |
|---|---|---|
| `server/services/aiRouter.ts:672` | 6 models (DeepSeek, Haiku, Sonnet, Opus, GPT-4o, Reasoner) | Yes |
| `server/ai/executive.ts:1062` | 4 models (DeepSeek, Reasoner, GPT-4o, GPT-4o-mini) | **No** |
| `server/ai/executive.ts:1436` | 4 models (same as above) | **No** |
| `server/services/userAiCostControls.ts:222` | 6 models (old naming: claude-3-5-sonnet, gpt-4) | **Stale names** |

**Evidence:** The executive.ts cost tables (lines 1062 and 1436) do not include `anthropic/claude-sonnet-4-6` or `anthropic/claude-haiku-4-5-20251001`, which are the models the router actually selects for MODERATE and COMPLEX tasks. When these models are used, the fallback `{ input: 1, output: 3 }` applies, grossly overestimating cost.

Additionally, `userAiCostControls.ts:222` uses legacy model names (`claude-3-5-sonnet`, `claude-3-opus`) that no longer match the OpenRouter model IDs used by the router.

**Impact:** Cost estimates returned to the UI for Claude-model conversations are inaccurate. The telemetry in `aiRouter.ts` is correct, but the user-facing `estimatedCost` field in chat responses is wrong. This undermines cost visibility.

**Remediation:** Extract the cost table into a single shared module (e.g., `server/services/aiModelCosts.ts`) and import it from all three locations. Update model IDs to match the current OpenRouter catalog.

---

### AI-008: Score-and-Learn Loop Sends User Messages to Separate LLM Without Consent Visibility
**Severity: P1**

`server/ai/executive.ts:20-69` -- after every chat response, the `scoreAndLearnFromResponse` function fire-and-forgets a second LLM call to `deepseek/deepseek-chat`:

```typescript
const scoringPrompt = `Rate this AI assistant response...
User asked: "${userMessage.slice(0, 300)}"
Assistant responded: "${assistantResponse.slice(0, 500)}"
...`;
```

This sends a truncated copy of every user message and every AI response to DeepSeek's API for quality scoring. The user has no visibility into or control over this secondary data flow.

**Issues:**
1. User content is transmitted to a second external provider (DeepSeek) beyond the primary model
2. No opt-out mechanism exists
3. The scoring results are written to `agentMemory` with user query patterns, creating a searchable record of user interactions
4. Cost is unbounded -- every single chat message triggers a scoring call

**Remediation:** (a) Make the quality scoring opt-in or at least visible in settings, (b) add a cost cap or sampling rate (e.g., score 10% of messages), (c) strip any PII before sending to the scorer.

---

### AI-009: Conversation Search Vulnerable to SQL Wildcard Injection
**Severity: P1**

`server/routes-ai.ts:125`:

```typescript
.where(and(eq(convs.organizationId, org.id), ilike(convs.title, `%${q}%`)))
```

The query parameter `q` is interpolated directly into the `ilike` pattern. While Drizzle parameterizes the value (preventing SQL injection), the `%` and `_` wildcards in `q` are not escaped. A user can pass `q=%%%` to force a full table scan, or use `_` wildcards to probe conversation titles character by character.

**Impact:** Performance degradation via crafted wildcard queries; minor information disclosure risk if combined with timing analysis.

**Remediation:** Escape `%` and `_` characters in `q` before passing to `ilike`.

---

### AI-010: System Prompt Leaks Internal Architecture in Every Request
**Severity: P1**

The Atlas/Pax system prompt (`server/ai/executive.ts:132-262`, ~130 lines) contains detailed internal methodology, pricing formulas, and business strategy that is sent as the system message in every LLM API call to OpenRouter. While this is intentional for the AI's behavior, it creates exposure:

1. **The full system prompt is sent to external providers** (DeepSeek, Anthropic, OpenAI via OpenRouter) on every request, including proprietary business methodology
2. **The prompt includes explicit tool names and capabilities**, which could be extracted via prompt injection attacks on uncovered endpoints (see AI-004)
3. **Connector context, calibration data, knowledge base content, and episodic memories** are all appended to the system prompt at `executive.ts:906`, creating a very large context window that increases both cost and data exposure per request

The system prompt at line 906 concatenates: base prompt + property enrichment + user preferences + calibration data + knowledge base + project context + mentioned entities + connector context.

**Remediation:** (a) Use OpenRouter's prompt caching (already partially implemented) to minimize retransmission, (b) consider whether all context blocks are needed for every query, (c) strip connector/calibration context for simple queries classified as SIMPLE complexity.

---

### AI-011: Agent Rate Limiter Fails Open on Database Errors
**Severity: P1**

`server/services/agentRateLimiter.ts:106`:

```typescript
} catch {
    return { allowed: true }; // Fail open — don't block agents on DB errors
}
```

If the database is unavailable or slow (a realistic scenario given the shared-cpu-2x Postgres instance), all agent rate limits are bypassed. The anomaly detection also fails open. This means a runaway agent during a database outage faces zero rate limiting.

**Evidence:** Both `checkRateLimit` (line 106) and `checkVolumeAnomaly` (line 152) have `catch { return { ... } }` blocks that fail open.

**Impact:** During database degradation, agents can execute unlimited actions without any rate control or anomaly detection.

**Remediation:** Implement an in-memory fallback counter (similar to `userAiCostControls.ts`'s `memUsage` map) that provides basic rate limiting even when the database is unavailable. Fail closed for high-risk action categories (financial, communication, contract).

---

### AI-012: Sub-Agent Spawning Has Depth Limit But No Breadth Limit
**Severity: P1**

`server/ai/tools.ts:2131-2143` -- the `spawn_subagent` tool enforces a depth limit of 2:

```typescript
if (currentDepth >= 2) {
    return { success: false, error: "Sub-agent depth limit reached (max 2)" };
}
```

However, there is no limit on how many sub-agents can be spawned at a single depth level. A single Atlas response could request 10 parallel `spawn_subagent` tool calls, each of which triggers a full `processChat` execution with its own unbounded tool loop (AI-001). This creates exponential fan-out: depth 0 spawns N agents, each spawns N more = N^2 concurrent LLM calls.

**Evidence:** The `spawn_subagent` tool definition at line 880 has no breadth or concurrency constraints. Tool calls are executed in parallel when all are read-only (line 997), but `spawn_subagent` is not in the read-only prefix list, so it runs sequentially -- however, the inner `processChat` calls each run their own tool loops independently.

**Remediation:** Add a `MAX_CONCURRENT_SUBAGENTS = 3` limit and track active sub-agent count per conversation.

---

### AI-013: OpenAI API Key Reported Invalid in Production (AI Features Broken)
**Severity: P1**

The orientation document (item #9) states: "OpenAI API key invalid -- AI features broken in production." The codebase shows the fallback chain: OpenRouter (primary) -> OpenAI direct (fallback). If the OpenRouter key is valid but the OpenAI key is not, the fallback path in `selectProviderAndModel` (`aiRouter.ts:598-604`) would fail.

**Evidence:**
- `server/ai/supportAgent.ts:19` -- Sophie's support agent initializes a direct OpenAI client using `AI_INTEGRATIONS_OPENAI_API_KEY`
- `server/ai/vaService.ts:8` -- VA agents use a module-level `new OpenAI()` with the same key
- Both of these bypass the OpenRouter routing entirely, using direct OpenAI calls

**Impact:** The support agent (Sophie) and VA service agents use direct OpenAI, not OpenRouter. If the OpenAI key is invalid, these agents fail completely even when OpenRouter is working. The error handling in both files throws generic errors without logging the specific provider failure.

**Remediation:** (a) Route Sophie and VA agents through the `aiRouter` to benefit from the OpenRouter fallback chain, or (b) validate the OpenAI key at startup and disable fallback paths with clear error messages.

---

### AI-014: No Token/Context Length Limits on User Input
**Severity: P1**

The AI chat schemas validate only that the message is a non-empty string:

```typescript
// routes-ai.ts:197
message: z.string().min(1, "Message is required"),
```

There is no maximum length constraint. A user can submit a message with millions of characters, which will be sent to the LLM API and billed at the per-token input rate. Combined with the system prompt (which can exceed 10,000 tokens with all context injections), this creates a cost amplification vector.

File attachments are processed up to 15,000 characters for DOCX (`executive.ts:577`) and 30 CSV rows (`executive.ts:542`), but plain text files have a 10,000-character limit and the base message has no limit at all.

**Remediation:** Add `z.string().max(50000)` to the chat message schema, and consider a total context budget that accounts for system prompt + history + user message.

---

### AI-015: Conversation History Auto-Compaction Uses Uncontrolled LLM Call
**Severity: P2**

`server/ai/executive.ts:750-790` -- when a conversation exceeds 20 messages or 80,000 characters, an auto-compaction LLM call is made using the SIMPLE tier model (DeepSeek). The compacted summary replaces old messages.

Issues:
- The compaction prompt includes up to 600 characters per message from the first half of the conversation, creating a secondary LLM call with user data
- Compaction failures are silently swallowed (`catch { return messages; }`)
- There is no limit on how often compaction runs -- every message in a long conversation triggers the check
- The compaction summary is stored in the database as `contextSummary` without any PII scrubbing

**Remediation:** Add a flag to prevent re-compaction until new messages accumulate, and apply PII masking to the compaction summary before storage.

---

### AI-016: Semantic Cache May Serve Stale Cross-Org Responses
**Severity: P2**

`server/services/aiRouter.ts:83-99` -- the semantic dedup cache uses Jaccard similarity (threshold 0.72) to match paraphrased queries. The cache key does not include an org ID. Two different organizations asking semantically similar questions could receive each other's cached responses.

**Evidence:** The `getCacheKey` function at line 31 hashes `messages`, `taskType`, `responseFormat`, and `temperature` -- but not the org ID. The semantic search at line 88 iterates all cache entries without org filtering.

**Impact:** Since the AI router is called from org-scoped routes, the system prompt (which includes org-specific data) differs between orgs. A semantic cache hit would return a response generated with a different org's context. In practice, the in-memory cache is small (500 entries, 15-min TTL) and the system prompt differences reduce similarity scores, making cross-org hits unlikely but not impossible.

**Remediation:** Include `config.orgId` in the cache key hash and in the semantic similarity comparison.

---

### AI-017: Quality Cascade Adds Unbounded Cost With No Per-Request Cap
**Severity: P2**

`server/services/aiRouter.ts:782-821` -- when CASCADE_ENABLED is true (it is by default), every non-complex response undergoes a quality check via an additional DeepSeek call, and if the score is below 6/10, the query is re-executed on a higher-tier model.

This means a SIMPLE task (routed to DeepSeek at $0.28/M) can cascade to Haiku ($4/M) and then the failed Haiku response could cascade to Sonnet ($15/M) -- though only one cascade step occurs per call. The quality check itself adds ~$0.002 per request.

For the target distribution of 60% SIMPLE tasks, this adds a quality check to 60% of all AI requests. If 20% of DeepSeek responses score below 6, that is 12% of all requests being re-executed on Haiku -- potentially doubling the cost of those requests.

**Evidence:** `CASCADE_ENABLED = true` at line 166. No per-request or per-org cost cap is applied before cascade escalation.

**Remediation:** (a) Track cascade frequency per org and disable cascading if it exceeds a threshold (e.g., >30% cascade rate suggests the SIMPLE model is poorly matched), (b) add cascade cost to the per-user cost controls (when wired in), (c) consider making cascade opt-in per org.

---

### AI-018: 49 Service Files Call LLMs Without Centralized Audit Trail
**Severity: P2**

Grep for `routeAITask|routeSimpleTask|routeComplexTask|routeCriticalTask|generateWithAutoRouting` returns 49 service files that directly invoke the AI router. Each of these can generate LLM calls independently, and many are triggered by background jobs or agent actions rather than direct user requests.

While the AI router's `recordAITelemetry` function logs every call to `aiTelemetryEvents`, there is no centralized view of:
- Which agent/service initiated the call
- Whether the call was user-triggered or autonomous
- The total cost per autonomous agent session
- Whether the call was within the initiating agent's rate limits

**Evidence:** Services like `agentSelfImprovement.ts`, `agentDebates.ts`, `founderWellbeing.ts`, `ceoCognitiveModelV11.ts`, and `attentionOptimizer.ts` all call `routeAITask` directly. The telemetry records `taskType` but not the calling service or agent codename.

**Remediation:** Add an `initiator` field to `AIRouterConfig` and propagate it through to telemetry. Require all agent-initiated calls to pass the agent codename for cost attribution.

---

### AI-019: Agent Authority Gate checkAuthority Has Undefined Variable Reference
**Severity: P2**

`server/services/agentAuthorityGate.ts:119`:

```typescript
return {
    allowed: true,
    effectiveLevel: delegation.toLevel as 0 | 1 | 2 | 3,
    requestedLevel,  // <-- referenced before declaration
    action,
    ...
};
```

The variable `requestedLevel` is used at line 119 inside the temporary delegation check, but it is not declared until line 130. This will cause a `ReferenceError` at runtime if any agent has a temporary delegation active.

**Evidence:** `requestedLevel` first appears at line 119, but its `let` declaration is at line 130.

**Impact:** The temporary delegation feature (used for CEO absence mode) will crash if invoked, falling back to static authority configuration.

**Remediation:** Move the `requestedLevel` declaration before the delegation check, or pass a default value.

---

### AI-020: SCP Agent Ecosystem Complexity Creates Maintenance Risk
**Severity: P3**

The AI barrel file (`server/services/ai/index.ts`) re-exports 50 modules, including versioned files (v8, v9, v10, v11, v12, v15). The SCP agent ecosystem includes:

- 12 named agents (Atlas, Sophie, Forge, Beacon, Sentinel, Shield, Oracle, Ledger, Compass, Crucible, Prism, Scribe)
- Autonomous decision execution, self-improvement, self-calibration, debates, negotiations
- Evolution engines, knowledge graphs, playbooks, synergy maps, initiative engines
- CEO cognitive model, founder twin, absence mode, wellbeing monitoring
- LLM judges, constitution checkers, resilience testing

Many of these services follow a pattern of calling `routeAITask` with complex prompts but lack:
- Unit tests (per orientation document: "No tests running")
- Documentation of which services are actually active in production vs. aspirational
- Clear cost accounting per service

This creates a risk where autonomous agent services may be consuming significant LLM tokens in background loops without visibility or control.

**Remediation:** (a) Audit which SCP services are actually invoked in production (check for active cron/job triggers), (b) add per-service cost dashboards, (c) establish a deprecation policy for versioned service files.

---

## Architecture Assessment

### Strengths

1. **Multi-tier model routing** (`aiRouter.ts`) is well-designed: 5 tiers from DeepSeek ($0.14/M) to Opus ($15/M) with intelligent classification and cost-aware defaults. The target distribution (60/30/7/1/2) is pragmatic.

2. **Quality-gated cascade** detects poor responses from cheap models and automatically retries with better models. This is a sophisticated pattern that balances cost and quality.

3. **Structured output validation** (`validators.ts`) with Zod schemas for financial outputs (offers, amortization, ROI, comps) prevents hallucinated financial data from reaching users.

4. **Agent authority gate** with trust-score-based action levels (0-3), dynamic promotion, never-promote safety list, and multi-agent financial consensus is a thorough autonomy control framework.

5. **Prompt injection middleware** covers the main AI chat endpoints with a reasonable deny-list of 15+ injection patterns.

6. **Agent rate limiting** with per-agent hourly/daily limits, anomaly detection (2x trailing average), dead man's switch (reduces autonomy after 7/14/21 days of founder absence), and data boundary enforcement.

7. **TCPA compliance** is checked within AI tool execution for `send_email` and `send_sms`, preventing AI from sending communications to leads who haven't consented.

8. **Prompt caching** integration with OpenRouter/Anthropic for large system prompts (90% cost reduction on cached portions).

9. **Dual-layer response cache** (exact SHA-256 + semantic Jaccard similarity) reduces redundant LLM calls for repeated/paraphrased queries.

10. **Extended thinking** support for Claude Sonnet on complex reasoning tasks (financial modeling, legal analysis).

### Key Risks

| Risk | Severity | Likelihood | Impact |
|---|---|---|---|
| Unbounded tool loop causes runaway costs | P0 | Medium | High -- single conversation could generate hundreds of LLM calls |
| Non-streaming path sends emails/SMS without approval | P0 | High | High -- AI sends external communications autonomously |
| User cost controls exist but are not enforced | P0 | Certain | Medium -- no per-user spending caps active |
| Prompt injection on uncovered routes | P0 | Medium | High -- agent manipulation, data exfiltration |
| PII transmitted to external LLM providers | P1 | Certain | Medium -- regulatory exposure |
| Model override bypasses routing economics | P1 | Medium | Medium -- cost amplification |

---

## Files Referenced

| Path | Role |
|---|---|
| `server/ai/executive.ts` | Atlas/Pax executive AI, processChat, processChatStream |
| `server/ai/tools.ts` | 40+ tool definitions, executeTool, APPROVAL_REQUIRED_TOOLS |
| `server/ai/supportAgent.ts` | Sophie support agent (direct OpenAI) |
| `server/ai/vaService.ts` | VA agent profiles (direct OpenAI) |
| `server/ai/validators.ts` | Structured output validation (Zod) |
| `server/services/aiRouter.ts` | Multi-model routing, caching, cascade, telemetry |
| `server/services/ai/index.ts` | Barrel file for 50 AI service modules |
| `server/services/agentRateLimiter.ts` | Per-agent rate limits, anomaly detection |
| `server/services/agentAuthorityGate.ts` | Trust-gated authority levels |
| `server/services/autonomousAgentEngine.ts` | Risk-scored autonomy decisions |
| `server/services/financialAuthorityGate.ts` | Graduated spending tiers |
| `server/services/companyAgents.ts` | SCP agent registry (12 agents) |
| `server/services/scpLLMJudges.ts` | LLM judge panel for evolution |
| `server/services/userAiCostControls.ts` | Per-user cost controls (unwired) |
| `server/services/sophiePrivacyGuard.ts` | Cross-org learning privacy |
| `server/middleware/promptInjection.ts` | Prompt injection sanitizer |
| `server/middleware/piiMasking.ts` | PII masking (console only) |
| `server/routes-ai.ts` | AI chat endpoints |
| `server/routes-core-ai.ts` | Core agent execution endpoints |
| `server/routes-ai-operations.ts` | AI operations endpoints |
