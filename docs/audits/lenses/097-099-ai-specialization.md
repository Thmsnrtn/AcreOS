# Lenses 097-099: AI Specialization Audit

Auditor: Tier 3 AI Specialization
Date: 2026-04-18
Files examined: server/ai/validators.ts, server/ai/executive.ts, server/ai/tools.ts, server/ai/vaService.ts, server/ai/supportAgent.ts, server/services/core-agents.ts, server/services/aiBoardOfDirectors.ts, server/services/collaborationProtocolV13.ts, server/services/autonomousDecisionExecutor.ts, server/services/aiOfferService.ts, server/services/aiRouter.ts, server/services/supportBrain.ts, server/services/campaignOptimizer.ts

---

## Lens 097 — LLM Output Validation

**Distinct-value declaration:** The validators.ts file is well-designed with Zod schemas and cross-checks, but it is never imported anywhere in the codebase outside its own comment block. The entire validation layer is dead code.

### Findings

#### 097-F1. Validator module exists but is entirely unused (CRITICAL)

`server/ai/validators.ts` exports `validateAtlasOutput` and `buildCorrectionPrompt` with thorough Zod-based validation for offers, amortization schedules, ROI analyses, APNs, comps, and cash flow. It includes cross-checks (e.g., verifying amortization math within 2% tolerance, checking gross profit equals salePrice minus purchasePrice).

However, a codebase-wide search for imports of `validateAtlasOutput` or `buildCorrectionPrompt` returns zero results outside the file's own doc comment. No route handler, no service, no agent calls these functions. The LLM generates financial outputs that flow directly to the client without any schema validation.

**Impact:** An LLM hallucinating a negative offer amount, a 500% interest rate, or internally inconsistent amortization math would be presented to the user as-is. The validator was purpose-built to prevent this but was never wired in.

#### 097-F2. Unguarded JSON.parse on LLM output across 12+ call sites (HIGH)

Every AI service that expects structured JSON from the LLM uses bare `JSON.parse` without try/catch or with inadequate fallback:

| File | Line | Guarded? |
|------|------|----------|
| `executive.ts` | 44 | No try/catch (inside broader catch that silently returns) |
| `executive.ts` | 1009, 1018, 1373, 1394 | No try/catch on tool argument parse |
| `vaService.ts` | 653 | No try/catch on tool argument parse |
| `supportAgent.ts` | 2986, 5248 | No try/catch on tool argument parse |
| `aiOfferService.ts` | 223, 356 | No try/catch (crash propagates to route handler) |
| `aiRouter.ts` | 207 | No try/catch (inside broader try but default is fragile) |
| `aiBoardOfDirectors.ts` | 260, 610 | No try/catch (inside broader try) |
| `supportBrain.ts` | 80 | No try/catch (inside broader try) |
| `autonomousDecisionExecutor.ts` | 633 | In try/catch, but regex-strips code fences first -- could still fail |
| `campaignOptimizer.ts` | 204 | In try/catch with fallback (good) |
| `core-agents.ts` | 224, 298 | In try/catch (good) |
| `aiTutor.ts` | 234 | In try/catch with empty-array fallback (good) |

Tool argument parsing (`JSON.parse(toolCall.function.arguments)`) appears 7 times across executive.ts, vaService.ts, and supportAgent.ts, always unguarded. While OpenAI's function-calling API typically produces valid JSON for arguments, this is not guaranteed, and a malformed argument string would crash the entire chat request.

#### 097-F3. No schema validation on LLM-generated structured responses (HIGH)

Even where JSON.parse succeeds, the parsed object is never validated against a schema. Examples:

- `aiOfferService.ts:223` -- Parses LLM JSON, then accesses `parsed.suggestions` with a hardcoded fallback array. If the LLM returns `{ "suggestions": "here are some ideas" }` (string instead of array), the fallback is skipped and a string propagates as the suggestions field.
- `aiBoardOfDirectors.ts:260` -- Trusts `parsed.vote` to be "for", "against", or "abstain". An LLM returning `{"vote": "maybe"}` would inject an invalid vote into governance decisions.
- `autonomousDecisionExecutor.ts:634` -- Parses AI decision but uses `parseInt(parsed.confidence)`, which returns NaN for non-numeric strings, then `Math.max(0, ...)` maps NaN to NaN, not 0. This could bypass the confidence threshold check since `NaN < 75` is false, allowing a low-confidence decision to auto-execute.
- `supportBrain.ts:80-85` -- Uses `result.category || "other"` but never validates that category is one of the expected enum values.

#### 097-F4. Self-critique JSON parsing uses unvalidated LLM response (MEDIUM)

`core-agents.ts:224` parses the self-critique response and trusts `parsed.score` and `parsed.refined`. If the LLM returns a score of 100 (no cap in the parse) or embeds injection content in `parsed.refined`, it passes through. The code does clamp score to 1-10 with `Math.max(1, Math.min(10, ...))`, but `parsed.confidence` is only clamped to 0-1 without a type check -- a string value would pass `Math.max(0, ...)` and produce NaN.

### Recommendations

1. Wire `validateAtlasOutput` into every code path that generates financial data (offers, amortization, ROI) before returning to the client.
2. Wrap every `JSON.parse(toolCall.function.arguments)` in try/catch to prevent a malformed LLM tool-call argument from crashing the request.
3. Define Zod schemas for every structured LLM response format (board votes, decision executor, support brain classification) and validate before use.
4. Fix the NaN-as-confidence bug in `autonomousDecisionExecutor.ts` by using `Number(parsed.confidence) || 0` instead of `parseInt`.

---

## Lens 098 — Multi-step Agent Failure Modes

**Distinct-value declaration:** The tool loops in executive.ts have an iteration cap, but the loops in vaService.ts and supportAgent.ts have no iteration limit at all, and none of the three tool loops have rollback, partial-state cleanup, or user visibility into partial progress when a mid-sequence failure occurs.

### Findings

#### 098-F1. Unbounded tool loops in vaService.ts and supportAgent.ts (CRITICAL)

The `executive.ts` processChat function enforces `MAX_TOOL_ITERATIONS = 10` to prevent runaway cost. However, two other tool loops have no such limit:

- `vaService.ts` line 648: `while (assistantMessage.tool_calls && ...)` -- no iteration counter, no break condition. A model that endlessly generates tool calls will loop until a timeout or OOM.
- `supportAgent.ts` line 5243: Identical pattern -- `while (assistantMessage.tool_calls && ...)` with no iteration guard.

Both use `model: "gpt-4o"`, which at ~$10/million output tokens can accumulate significant cost in a runaway loop.

#### 098-F2. No rollback or compensation on partial tool execution (HIGH)

Consider the executive.ts tool loop (line 994-1048): if the model calls 5 tools, tools 1-3 succeed (e.g., `create_lead`, `update_lead_status`, `create_property`), and tool 4 fails (API error in `executeTool`), the following happens:

1. The error propagates as a throw from `client.chat.completions.create` at line 1036.
2. The `catch` at line 1042 throws a new generic error: "AI request failed during processing."
3. The route handler returns a 500 to the client.
4. Tools 1-3's side effects (created lead, updated status, created property) persist in the database.
5. The user sees only "AI request failed" with no indication of what was partially completed.

There is no transaction wrapping, no compensation log, and no mechanism to show the user partial results.

#### 098-F3. Autonomous decision executor processes items independently but has no batch-level error boundary (MEDIUM)

`autonomousDecisionExecutor.ts` processes up to 20 inbox items per run. Each item is processed in a sequential `for` loop (line 799+). If `processInboxItem` throws an unhandled exception (e.g., database connection drop), the entire run halts and remaining items are never processed. The function does have a per-item try/catch (the AI call failure path at line 642), but the outer loop at line 799+ does not wrap each item in its own try/catch.

Reading further (line 800+), the main loop does appear to have a try/catch per item based on the structure, but the AI call and execution steps share the same error path. If a database write in the execution step fails (e.g., `executeSupportEscalationApproval`), the error is caught at line 693 and `execResult` is set to `{ success: false }`, but the item status is only updated to "approved" on success. A failed execution leaves the item in "pending" status, meaning it will be retried on the next run -- this could cause duplicate actions (e.g., sending the same retention email twice if the first send succeeded but the DB status update failed).

#### 098-F4. Tool argument parse failure crashes the entire conversation (HIGH)

In the tool loop at `executive.ts:1009`, `JSON.parse(toolCall.function.arguments)` is not wrapped in try/catch. If the LLM produces malformed JSON in the arguments field, the `Promise.all` rejects, the catch at line 1042 fires, and the user gets "AI request failed during processing" -- losing all context of what happened. The same is true for the sequential path at line 1018, and for both vaService.ts and supportAgent.ts.

#### 098-F5. Sub-agent spawn has depth limit but no timeout or cost guard (MEDIUM)

`spawn_subagent` in tools.ts (line 2131) enforces a max depth of 2, which prevents infinite recursion. However, each sub-agent invocation creates a new full `processChat` call, including its own tool loop with up to 10 iterations. A parent agent spawning 3 sub-agents, each running 10 tool iterations, creates up to 33 LLM calls for a single user message. There is no aggregate cost cap or timeout for the overall request chain.

### Recommendations

1. Add `MAX_TOOL_ITERATIONS` guards to vaService.ts and supportAgent.ts tool loops, matching executive.ts.
2. Wrap tool execution in the loop with individual try/catch blocks so one tool failure does not terminate the entire sequence. Return the error as a tool result to the LLM so it can adapt.
3. When multiple write tools have been called, log a "partial execution" record that the user can review, rather than hiding all progress behind a generic error.
4. Add a per-item try/catch in the autonomous executor's main run loop to prevent one item's failure from blocking the rest.
5. Add an aggregate cost or call-count budget for sub-agent chains.

---

## Lens 099 — Agent-to-Agent Handoff

**Distinct-value declaration:** The system has three separate, disconnected agent-handoff mechanisms (spawn_subagent, collaboration protocol, delegation tokens) that share no common context format, and the primary handoff path (spawn_subagent) passes only a bare text prompt with no structured context from the parent agent's conversation.

### Findings

#### 099-F1. spawn_subagent passes a bare prompt string with no parent context (CRITICAL)

The `spawn_subagent` tool (tools.ts line 2131-2143) creates a sub-agent by calling `processChat(args.prompt, subOrg, "pax_subagent", ...)`. The only context passed is:

- `args.prompt`: A text string composed by the parent LLM.
- `subOrg`: A shallow copy of the org object with a `__subAgentDepth` property bolted on via `as any`.
- `agentRole`: A role string like "research" or "underwriting".

What is NOT passed:

- The parent conversation history (the sub-agent starts a brand new conversation).
- Any tool results the parent has already gathered.
- The parent's system prompt context (property enrichment data, user preferences, calibration data, knowledge base, mentioned entities).
- The parent's conversation ID (the sub-agent creates its own isolated conversation record).

This means the parent agent must embed all relevant context into the prompt string. If the parent LLM forgets to include a property ID, an APN, or a critical detail from a previous tool call, the sub-agent operates without it. The sub-agent also cannot update the parent's conversation record -- its results are returned as a bare `{ response, conversationId }` object.

#### 099-F2. Collaboration protocol dialogues have no automatic context enrichment (HIGH)

`collaborationProtocolV13.ts` implements a formal multi-agent dialogue system with voting and consensus. However, when a dialogue is opened via `openDialogue`, the only context provided is:

- `topic`: A string.
- `participants`: An array of agent codenames.
- `relatedEntityType` / `relatedEntityId`: Optional string references.

There is no mechanism to automatically load the entity data (e.g., fetching the actual property, lead, or deal referenced by the entity ID) and inject it into the dialogue. Each participating agent would need to independently look up the entity, leading to:

- Redundant database queries.
- Risk of agents seeing different snapshots of the entity if it changes between lookups.
- No guarantee all agents see the same context.

#### 099-F3. Delegation tokens have no context payload (MEDIUM)

The delegation system in `routes-founder-v11.ts` (delegation tokens) and `routes-sovereign-integration.ts` (agent messages with type "delegation") are two separate delegation mechanisms:

1. `delegationTokenService.grant(...)` creates a time-limited authority token with `scope` and `authorityLevel`, but no task-specific context payload. The receiving agent must separately discover what it has been authorized to do.
2. `agentMessages` with `messageType: "delegation"` does include `content: JSON.stringify({ task, context })`, but the `context` field is whatever the caller passes -- there is no schema or validation.

These two systems do not interoperate. A delegation via the token system does not create an agent message, and a delegation via agent messages does not create an authority token. An agent could receive a delegation message but lack the authority token to execute it, or have an authority token with no corresponding task instruction.

#### 099-F4. Board of Directors voting uses per-agent LLM calls with no shared state (MEDIUM)

`aiBoardOfDirectors.ts` conducts votes by making independent LLM calls for each agent (line 255). Each agent receives the same proposal text but:

- Cannot see other agents' votes or reasoning (votes are collected sequentially).
- Has no access to the dialogue history from the collaboration protocol.
- Gets a system prompt based on its codename but no memory or preference context.

This is architecturally sound for independent voting, but the "Founder Twin tiebreaker" (line 605) receives all votes as context, creating an asymmetry where the tiebreaker has more information than the original voters. This could be intentional but is not documented.

#### 099-F5. Context corruption risk in subOrg spread (LOW)

At tools.ts line 2137, the sub-agent org is created via `{ ...org, __subAgentDepth: currentDepth + 1 }`. This shallow copy means any nested objects in `org` (e.g., `org.settings`, `org.metadata`) share references with the parent. If the sub-agent's `processChat` modifies any nested property on the org object (unlikely but not prevented by types since `as any` is used), it would mutate the parent's org object.

### Recommendations

1. For spawn_subagent, pass a structured context object that includes: the parent conversation ID, relevant tool results, property/lead/deal context already loaded, and the parent's system prompt supplements. The sub-agent should be able to read (but not write to) the parent conversation.
2. Unify the delegation token and delegation message systems into a single mechanism where an authority grant always includes a task context payload.
3. Add automatic entity resolution to the collaboration protocol -- when `relatedEntityId` is provided, load the entity data and include it in every agent's prompt.
4. For the Board of Directors, consider a two-round voting protocol where agents can see anonymized first-round results before casting final votes, ensuring equal information parity with the tiebreaker.
5. Replace the shallow spread of org with `structuredClone(org)` or a dedicated factory function to prevent shared-reference mutation risk.

---

## Summary

| ID | Severity | Lens | Finding |
|----|----------|------|---------|
| 097-F1 | CRITICAL | Validation | validators.ts is dead code -- never imported |
| 097-F2 | HIGH | Validation | 12+ unguarded JSON.parse on LLM output |
| 097-F3 | HIGH | Validation | No schema validation on parsed LLM responses |
| 097-F4 | MEDIUM | Validation | Self-critique NaN/type-confusion risk |
| 098-F1 | CRITICAL | Multi-step | Unbounded tool loops in vaService and supportAgent |
| 098-F2 | HIGH | Multi-step | No rollback or user visibility on partial tool failure |
| 098-F3 | MEDIUM | Multi-step | Autonomous executor retry-on-failure can cause duplicates |
| 098-F4 | HIGH | Multi-step | Tool argument parse crash kills entire conversation |
| 098-F5 | MEDIUM | Multi-step | No aggregate cost cap for sub-agent chains |
| 099-F1 | CRITICAL | Handoff | spawn_subagent passes bare prompt, no parent context |
| 099-F2 | HIGH | Handoff | Collaboration protocol has no automatic context enrichment |
| 099-F3 | MEDIUM | Handoff | Delegation tokens and messages are disconnected systems |
| 099-F4 | MEDIUM | Handoff | Board voting information asymmetry undocumented |
| 099-F5 | LOW | Handoff | Shallow org copy creates shared-reference mutation risk |
