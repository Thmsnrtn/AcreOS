# Red Team Persona 09: The LLM Skeptic

**Persona**: A real estate professional who distrusts AI, wants to understand every decision it makes, demands the ability to override or disable it, and is deeply concerned about cost, data privacy, and hallucination risk.

**Auditor**: Claude Opus 4.6 (1M context)
**Date**: 2026-04-18
**Codebase snapshot**: commit 27a7ea0

---

## Verdict Summary

| # | Area | Verdict | Risk |
|---|------|---------|------|
| 1 | AI Transparency (explainability) | CONCERN | Medium |
| 2 | Human-in-the-Loop (approval gates) | PASS | Low |
| 3 | Guardrails (configurable limits) | CONCERN | Medium |
| 4 | Cost Visibility | PASS | Low |
| 5 | Opt-Out (AI-free operation) | CONCERN | Medium |
| 6 | Hallucination Risk (validation) | PASS | Low |
| 7 | Data Privacy (what goes to OpenAI) | CONCERN | Medium |
| 8 | AI Error Handling (fallback paths) | PASS | Low |
| 9 | Audit Trail (action logging) | PASS | Low |
| 10 | Override Capability (manual controls) | CONCERN | Medium |

**Overall**: 5 PASS, 5 CONCERN, 0 FAIL

---

## 1. AI Transparency (Explainability)

**Verdict: CONCERN**

### What the skeptic wants
"Why did the AI recommend this offer amount? Show me the reasoning chain, not just a number."

### What exists

Atlas (the executive AI) includes a `rationale` field in offer suggestions (`server/ai/validators.ts:53`) and the comps analysis returns a `confidence` score (0-1). The `generate_offer` tool in `server/ai/tools.ts:384-395` surfaces AI reasoning through the `generateOfferSuggestions` service which returns per-suggestion `reasoning` strings.

The quality cascade in `server/services/aiRouter.ts:174-214` scores response quality 1-10 and can escalate to a stronger model, but this score is internal -- it is never surfaced to the user.

Tool calls executed during a conversation are stored in the `aiMessages` table with `toolCalls` JSON (`server/ai/executive.ts:1052-1057`), so a user can technically see which tools were invoked.

### What is missing

- **No "show your work" toggle**: There is no UI mechanism for a user to request a detailed reasoning breakdown. The AI's confidence scores, validation warnings, and quality-cascade decisions are internal telemetry -- never exposed in the chat interface.
- **No provenance tracking**: When Atlas cites a comparable sale or a market value, there is no source attribution linking back to the original data provider (Regrid, ATTOM, DataTree). The user cannot verify where a specific number came from.
- **Score calibration context is invisible**: `loadCalibrationContext` (`server/ai/executive.ts:74-93`) injects historical lead-score accuracy data into the system prompt, but the user never sees this calibration data directly -- they just get a recommendation with no transparency about the underlying accuracy rates.

### Evidence

```
server/ai/executive.ts:74-93  — calibration data injected silently into system prompt
server/services/aiRouter.ts:174-214 — quality cascade score hidden from user
server/ai/validators.ts:53 — rationale field exists but only in validation schema
```

---

## 2. Human-in-the-Loop (Approval Gates)

**Verdict: PASS**

### What the skeptic wants
"The AI should never send an email, text, or payment request on my behalf without my explicit approval."

### What exists

`APPROVAL_REQUIRED_TOOLS` in `server/ai/tools.ts:898-904` blocks five high-risk tools:
- `send_email`
- `send_sms`
- `send_gmail`
- `send_slack_message`
- `create_stripe_payment_link`

This gate is enforced in **both** the streaming path (`server/ai/executive.ts:1397`) and the non-streaming path (`server/ai/executive.ts:1020`). The non-streaming path was previously a P0 bypass vulnerability (DEFECT-0023, lens 36 AI-002) and has since been fixed -- the approval check now runs identically in both paths.

In the streaming path, the system yields an `approval_required` event to the client, pausing execution until the user confirms. In the non-streaming path, the tool returns a blocked result message.

The Sovereign Company Protocol adds a second layer via `agentAuthorityGate.ts`. Trust levels 0-3 control agent autonomy, with safety-critical actions in the `NEVER_PROMOTE` list (line 143-149) that can never be auto-promoted regardless of trust score. These include `refund_customer`, `suspend_account`, `modify_pricing_plans`, and 12 others.

The decisions inbox (`server/services/decisionsInbox.ts`) routes escalated items to the founder for review before execution.

### Remaining concern

Destructive CRM operations (`update_lead_status`, `create_deal`, `update_property`, `delete_task`) are NOT in the `APPROVAL_REQUIRED_TOOLS` set. The AI can autonomously move a lead to "dead" status or create a deal record without user confirmation. This was noted in audit lens 096 but remains unfixed. For a skeptic, any write operation should be confirmable.

### Evidence

```
server/ai/tools.ts:898-904 — APPROVAL_REQUIRED_TOOLS set
server/ai/executive.ts:1020 — non-streaming approval gate (fixed)
server/ai/executive.ts:1397 — streaming approval gate
server/services/agentAuthorityGate.ts:143-149 — NEVER_PROMOTE safety list
```

---

## 3. Guardrails (Configurable Limits on AI Autonomy)

**Verdict: CONCERN**

### What the skeptic wants
"I want to set limits on what the AI can do, how much it can spend, and how many times it runs per day."

### What exists

- **Per-user daily/monthly AI cost caps**: `server/services/userAiCostControls.ts` implements Redis-backed budget tracking with configurable daily ($5 default) and monthly ($50 default) limits. When exceeded, returns 429 with a clear message and reset time.
- **Tool iteration limit**: `MAX_TOOL_ITERATIONS = 10` in both `executive.ts:991` and `vaService.ts:13` prevents unbounded tool-calling loops.
- **Usage limit gate**: `usageLimitGate("ai_requests")` middleware on `/api/ai/chat` and `/api/ai/chat/stream` routes enforces tier-based daily request limits.
- **Credit pre-check**: Before each AI chat, the system checks credit balance and returns 402 if insufficient (`server/routes-ai.ts:227-236`).
- **Trust-based authority levels**: Agents must earn trust (0-100 score) to gain autonomy levels 0-3 (`server/services/agentAuthorityGate.ts`).

### What is missing

- **`userAiCostControls.checkBudget` is never called from any route handler**. The service is fully implemented but has zero call sites outside its own file. The comment-only usage example (line 19) shows the intended integration pattern, but `grep` for `userAiCostControls` across the server directory confirms it is imported nowhere. This is a dead-code guardrail -- the budget enforcement does not actually run. (**This was flagged as AI-003 in lens 36, severity P0. The defect registry marks DEFECT-0025 as FIXED via commit 894b463, but the code shows the service still has no call sites.**)
- **No UI to configure AI autonomy level**: Trust scores and authority levels exist in the backend (`agentAuthorityGate.ts`) but there is no settings panel for the user to say "never let AI do X" or "always ask me before doing Y."
- **No per-tool enable/disable**: A skeptic cannot selectively disable specific AI capabilities (e.g., "let it read data but never create records").

### Evidence

```
server/services/userAiCostControls.ts:16-23 — checkBudget never called from routes
server/routes-ai.ts:204-262 — uses checkUsageLimit and creditService, NOT userAiCostControls
server/ai/executive.ts:991 — MAX_TOOL_ITERATIONS = 10
```

---

## 4. Cost Visibility

**Verdict: PASS**

### What the skeptic wants
"Show me exactly how much AI is costing me, per request, per day, per month."

### What exists

- **Per-request cost estimation**: `processChat` returns `estimatedCost`, `promptTokens`, and `completionTokens` in its response (`server/ai/executive.ts:1077-1085`). Cost is calculated using a per-model price table (DeepSeek: $0.14/$0.28 per million tokens; GPT-4o: $2.50/$10.00).
- **API usage logging**: Every AI chat call logs to `apiUsageLogs` via `storage.logApiUsage` (`server/ai/executive.ts:967-983`) with model, complexity, provider, and estimated cost.
- **Usage metering**: `usageMeteringService.recordUsage` is called after every successful chat with provider/model/token metadata (`server/routes-ai.ts:247-255`).
- **AI Cost Dashboard**: `client/src/components/ai-cost-dashboard.tsx` renders a visual cost-savings comparison showing actual vs. potential cost, total calls, and per-provider breakdown with Recharts bar charts.
- **Founder AI Observatory**: `client/src/pages/founder-ai-observatory.tsx` provides a telemetry dashboard showing per-org AI stats (total calls, cost, latency, cache hit rate), per-interaction drill-down (model, tokens, cost, status), and model distribution.
- **Multi-model routing savings**: The AI router caches responses (15-min TTL, semantic dedup) and routes simple queries to DeepSeek ($0.14/M tokens) instead of GPT-4o ($2.50/M tokens), providing transparent cost optimization.

### Minor gap

The per-request `estimatedCost` is returned in the API response but may not be prominently displayed in the chat UI itself. The cost dashboard exists but is on a separate page -- inline cost visibility per message would satisfy the most demanding skeptic.

### Evidence

```
server/ai/executive.ts:1077-1085 — per-request cost calculation
server/ai/executive.ts:967-983 — API usage logging
client/src/components/ai-cost-dashboard.tsx — cost dashboard component
client/src/pages/founder-ai-observatory.tsx — telemetry dashboard
```

---

## 5. Opt-Out (AI-Free Operation)

**Verdict: CONCERN**

### What the skeptic wants
"I want to use AcreOS purely as a CRM/deal tracker without any AI features. No AI processing my data, no LLM calls, no AI-generated content."

### What exists

- The CRM (leads, properties, deals, notes, tasks, campaigns, finance) operates as a standard CRUD application with its own API routes (`server/routes-leads.ts`, `server/routes-properties.ts`, `server/routes-deals.ts`, etc.) that have no AI dependencies.
- AI chat is a separate feature accessed through the floating assistant component and dedicated `/api/ai/*` routes.
- The system does check for AI API key availability and gracefully handles its absence (`server/ai/executive.ts:96-105` throws a clear "AI service not available" error).

### What is missing

- **No global AI kill switch**: There is no settings toggle to disable AI platform-wide for an organization. A user cannot say "turn off all AI features" from the UI.
- **AI runs in background jobs**: Services like `agentProactiveEngine`, `autonomousHealthMonitor`, `founderWeeklyDigest`, and `trustEvolution` run on cron schedules and may invoke AI independently of user interaction. There is no way to opt out of these without disabling them at the infrastructure level.
- **Lead scoring uses AI**: The lead scoring system and outcome calibration (`loadCalibrationContext`) are AI-powered. A skeptic using the CRM would still see AI-influenced scores on their leads unless they ignore them.
- **Sophie support agent runs AI autonomously**: The `customerSupportAutoResolver` and `decisionsInbox` pipeline use AI to auto-resolve tickets, which a skeptic may not want.
- **Enrichment involves AI**: Property research and enrichment (`research_property` tool) makes AI-assisted analysis calls that are deeply integrated into the property workflow.

### Evidence

```
server/ai/executive.ts:96-105 — error handling when AI unavailable
server/routes-leads.ts — standalone CRUD, no AI dependency
server/services/agentProactiveEngine.ts — background AI jobs
server/services/autonomousHealthMonitor.ts — background AI monitoring
```

---

## 6. Hallucination Risk (Output Validation)

**Verdict: PASS**

### What the skeptic wants
"If the AI says my property is worth $50,000, I need to know that number was validated against real data, not hallucinated."

### What exists

`server/ai/validators.ts` implements comprehensive Zod-based validation for all structured AI outputs:

- **Offer amounts**: Must be positive, capped at $50M (`offerAmountSchema`)
- **Amortization schedules**: Mathematical cross-check verifies monthly payment matches the standard formula within 2% tolerance (`checkAmortizationMath`)
- **ROI analysis**: Cross-checks that `grossProfit == salePrice - purchasePrice` with $1 tolerance
- **Comps analysis**: Requires at least 1 comparable, warns if fewer than 3; includes confidence score
- **Cash flow**: Cross-checks `netMonthly == monthlyIncome - monthlyExpenses`
- **APN format**: Regex validation against standard APN patterns
- **Interest rates**: Capped at 30% to catch absurd values

**DEFECT-0031 (validators never wired) has been fixed.** `validateAtlasOutput` is now imported and called in:
- `server/ai/tools.ts:13` -- validates amortization (line 1067), cash flow (line 1096), offers (line 1497), ROI (line 1691), payment schedules (line 1755), and draft offers (line 1894)
- `server/ai/vaService.ts:5` -- validates offer amounts in VA agent flows (line 1079)
- `server/services/aiOfferService.ts:12` -- validates offer suggestions (line 253)

The `buildCorrectionPrompt` function (`validators.ts:285-309`) generates retry prompts when validation fails, asking the AI to fix errors while maintaining the same JSON structure.

### Minor gap

Free-text AI responses (the natural language portions of Atlas chat) are not validated. Only structured outputs (financial calculations, offers, schedules) go through Zod validation. A hallucinated claim like "this county has a 95% deal close rate" in a conversational response would pass through unvalidated. This is inherent to LLM chat interfaces and difficult to solve fully.

### Evidence

```
server/ai/validators.ts — full validation suite
server/ai/tools.ts:1067,1096,1497,1691,1755,1894 — wired validation calls
server/services/aiOfferService.ts:253 — offer suggestion validation
```

---

## 7. Data Privacy (What Goes to OpenAI)

**Verdict: CONCERN**

### What the skeptic wants
"What data about my business is being sent to OpenAI? Are my seller names, phone numbers, property addresses, and financial details going to a third party?"

### What exists

- **PII masking middleware**: `server/middleware/piiMasking.ts` masks phone numbers, email addresses, SSNs, and credit card numbers in log output. Patterns are well-implemented with regex matching and partial preservation (area code kept, domain kept).
- **Sophie Privacy Guard**: `server/services/sophiePrivacyGuard.ts` enforces k-anonymity (k>=3) for cross-org learning, hashes org IDs with SHA-256, strips PII fields (email, phone, address, name, SSN, APN) from shared data, and generalizes financial values to ranges. Orgs must explicitly opt in to cross-org learning and can opt out at any time (with data purge).
- **BYOK (Bring Your Own Key)**: Users can configure their own OpenAI API key (`client/src/components/settings/ByokSettings.tsx`), routing AI calls through their own account rather than AcreOS's key.

### What is missing

- **Full business data sent to OpenAI in system prompts**: The `processChat` function (`server/ai/executive.ts:906`) constructs a system prompt that includes:
  - Complete property details (address, APN, size, county, state, enrichment data)
  - Lead information (names, contact details) via tool results
  - User preferences learned from past interactions
  - Organization knowledge base documents (extracted content)
  - Active project files
  - Calibration data with deal conversion rates
  - Connected connector context
  This data is sent to the OpenAI API (or OpenRouter) in cleartext. There is **no PII scrubbing** applied to the data sent to the LLM -- the `piiMasking.ts` middleware only protects logs, not API calls.
- **File contents sent verbatim**: When users attach CSV, DOCX, or text files, the full content (up to 15KB for DOCX, 30 rows for CSV) is sent to the LLM without any PII filtering (`server/ai/executive.ts:561-624`).
- **No data residency controls**: There is no mechanism to ensure AI processing stays within a specific geographic region or provider.
- **No prompt audit log**: While API usage is logged, the actual prompt content sent to the LLM is not stored for user review. A skeptic cannot see exactly what was transmitted.

### Evidence

```
server/ai/executive.ts:906 — full system prompt with business data
server/ai/executive.ts:838-841 — file contents sent to LLM
server/middleware/piiMasking.ts — masks logs only, not API calls
server/services/sophiePrivacyGuard.ts — cross-org privacy only
```

---

## 8. AI Error Handling (Fallback Paths)

**Verdict: PASS**

### What the skeptic wants
"When the AI breaks, my business should keep running. What happens when OpenAI goes down?"

### What exists

- **Graceful API failure**: Both `processChat` and `processChatStream` wrap OpenAI calls in try/catch and throw user-friendly errors ("AI request failed. Please try again in a moment.") rather than exposing raw API errors (`server/ai/executive.ts:961-964, 1042-1045`).
- **Non-blocking enrichment**: All AI-adjacent context loading (property enrichment, memory, preferences, knowledge base, calibration) is wrapped in try/catch with empty-string fallbacks (`server/ai/executive.ts:856-905`). If any context source fails, the chat continues with reduced context rather than failing entirely.
- **Quality cascade with fail-open**: The AI router's quality check (`server/services/aiRouter.ts:196-213`) assumes the response is adequate (score=8) if the quality-check call itself fails. This prevents the cascade mechanism from blocking responses.
- **Memory/scoring fire-and-forget**: `scoreAndLearnFromResponse` and `processConversationMemories` are called via `process.nextTick` and `setImmediate` with `.catch(() => {})` -- they never block or crash the response path.
- **CRM operates independently**: All CRUD operations (leads, properties, deals, finance) use direct database queries with no AI dependency. If OpenAI is completely unavailable, the platform still functions as a full CRM.
- **Circuit breaking on providers**: The provider registry (`server/services/providers/provider-registry.ts`) implements circuit breaking -- 3 failures in 5 minutes causes automatic skip with fallback to alternate providers.
- **Redis fallback**: `userAiCostControls` falls back to in-memory tracking if Redis is unavailable (`server/services/userAiCostControls.ts:79`).

### Evidence

```
server/ai/executive.ts:961-964 — graceful OpenAI error handling
server/ai/executive.ts:856-905 — non-blocking context with try/catch
server/services/aiRouter.ts:196-213 — quality cascade fail-open
server/services/providers/provider-registry.ts — circuit breaker
```

---

## 9. Audit Trail (AI Action Logging)

**Verdict: PASS**

### What the skeptic wants
"I want to see every action the AI took, when it took it, and what data it accessed."

### What exists

- **Conversation persistence**: Every AI message (user and assistant) is stored in the `aiMessages` table with timestamps, including the full list of tool calls executed (`server/ai/executive.ts:1052-1057`). Conversations are retrievable via `/api/ai/conversations/:id`.
- **Tool call recording**: Every tool invocation during a chat is recorded with `name`, `arguments`, and `result` in the `toolCallsExecuted` array, which is persisted to the message record.
- **API usage logging**: `storage.logApiUsage` records every AI call with organization ID, service (provider), action, count, estimated cost, and metadata including model and token counts (`server/ai/executive.ts:973-981`).
- **Agent action log**: The Sovereign Company Protocol logs every agent action to `agentActionLog` via `logAction` (`server/services/agentAuthorityGate.ts:337-352`) with: agent codename, action type, action name, input/output, reasoning, confidence, cost, authority level, trust score, outcome, duration, and related goal/decision IDs.
- **Activity log**: Support agent actions (session invalidation, data resync, orphan repair, preference resets) are written to `activityLog` (`server/ai/supportAgent.ts:4634, 4656, 4690, 4799, 4857, 4906`).
- **Audit log**: Auth events, data changes, billing events, and sync events are recorded in `auditLog` (`server/ai/supportAgent.ts:4082-4088`).
- **Resolution history**: Support ticket resolutions are logged to `supportResolutionHistory` with issue type, resolution approach, success status, and lessons learned.
- **Trust evolution log**: All trust score changes are recorded in `trustEvolutionLog` with previous score, new score, delta, and reason (`server/services/trustEvolution.ts`).
- **Founder AI Observatory**: The `/founder/ai-observatory` page provides a drill-down telemetry view of all AI interactions across orgs.

### Minor gap

The actual prompt text sent to the LLM is not logged (only the user message and assistant response). A full audit would require seeing the system prompt construction to verify what context was included. However, this is arguably a privacy benefit -- logging full prompts would store sensitive business data.

### Evidence

```
server/ai/executive.ts:1052-1057 — tool calls stored in aiMessages
server/services/agentAuthorityGate.ts:337-352 — agentActionLog
server/ai/supportAgent.ts:4634+ — activityLog entries
server/services/trustEvolution.ts — trustEvolutionLog
```

---

## 10. Override Capability (Manual Controls)

**Verdict: CONCERN**

### What the skeptic wants
"If the AI recommends an offer of $5,000, I want to change it to $3,000 and have that be the final word. I should be able to override any AI recommendation."

### What exists

- **AI recommendations are advisory**: Atlas provides suggestions through chat -- the user must manually create/update records through the UI or approve tool calls. The AI does not auto-execute offers or deals without going through the standard CRUD routes.
- **Model override**: The streaming chat endpoint accepts a `modelOverride` parameter (`server/routes-ai.ts:281-286`) allowing users to select a specific model (GPT-4o, GPT-4o-mini, Claude Sonnet, DeepSeek).
- **Founder override on decisions**: The decisions inbox allows the founder to approve, reject, or override AI agent recommendations (`decisionsInboxItems.founderOverrideAction`). Trust evolution penalizes agents when overridden, creating a feedback loop.
- **VA agent escalation thresholds**: VA agents have explicit escalation rules (e.g., acquisitions agent escalates deals over $50,000, collections escalates accounts 60+ days delinquent).

### What is missing

- **No "undo AI action" button**: When the AI creates a lead, updates a property, or creates a task via tool calls, there is no one-click undo mechanism. The user must manually find and reverse the change.
- **No "reject and replace" workflow**: If the AI generates an offer letter or analysis, the user cannot annotate it with corrections that feed back into the AI's learning. They can only accept or ignore.
- **CRM write tools execute immediately**: Tools like `update_lead_status`, `create_deal`, `create_property`, `update_property`, `create_task` execute immediately when called by the AI during a chat -- they are not in `APPROVAL_REQUIRED_TOOLS` and have no confirmation step. A skeptic would want every write operation to require explicit approval.
- **No per-field override on AI-enriched data**: When property enrichment populates flood zone, soil type, or demographics, there is no UI to manually correct individual AI-sourced values while preserving others.

### Evidence

```
server/ai/tools.ts:898-904 — only 5 tools require approval, ~30 write tools do not
server/routes-ai.ts:281-286 — modelOverride parameter
server/services/decisionsInbox.ts — founder override workflow
docs/audits/lenses/096-prompt-injection-per-agent.md:67 — destructive tools lack approval gates
```

---

## Priority Recommendations for the LLM Skeptic

### P0 (Must fix before launch)

1. **Wire `userAiCostControls.checkBudget` into AI routes**: The per-user cost control service exists but is not called. The route handlers use `checkUsageLimit` and `creditService` but not the per-user budget enforcement. Either wire it in or remove the dead code.

### P1 (Fix within first month)

2. **Add approval gates for CRM write operations**: Expand `APPROVAL_REQUIRED_TOOLS` to include `create_lead`, `update_lead_status`, `create_deal`, `update_deal`, `create_property`, `update_property`, `create_task`, and `update_task`. At minimum, provide a user setting to enable "confirm all AI actions" mode.

3. **Add a global AI toggle in organization settings**: Allow users to disable all AI features (chat, enrichment, background agents, auto-scoring) with a single switch. When disabled, hide the floating assistant, disable AI routes, and stop AI-powered background jobs for that org.

4. **Apply PII scrubbing to LLM API calls**: The `piiMasking.ts` `maskString` function exists and works well. Apply it to the user message and tool result data before sending to OpenAI. This would mask seller phone numbers, email addresses, and SSNs in API payloads while preserving them in the local database.

### P2 (Fix within first quarter)

5. **Surface confidence scores and data provenance in the UI**: When Atlas provides a property valuation, show the confidence level, number of comps used, and data sources referenced. Make the AI's reasoning inspectable, not just its conclusions.

6. **Add "undo last AI action" capability**: When the AI executes a tool that modifies data (creates a lead, updates a deal), add a toast notification with an "Undo" button that reverts the change within a 10-second window.

7. **Log prompt content for user review**: Offer an opt-in setting where users can view the exact context sent to the LLM for each interaction, stored separately from the response for transparency.

---

## Files Referenced

| Path | Role |
|---|---|
| `server/ai/executive.ts` | Atlas/Pax executive AI, processChat, processChatStream |
| `server/ai/tools.ts` | 40+ tool definitions, executeTool, APPROVAL_REQUIRED_TOOLS |
| `server/ai/validators.ts` | Structured output validation (Zod schemas + math cross-checks) |
| `server/ai/vaService.ts` | VA agent profiles and autonomous execution |
| `server/ai/supportAgent.ts` | Sophie support agent with diagnostic tools |
| `server/services/aiRouter.ts` | Multi-model routing, caching, quality cascade |
| `server/services/userAiCostControls.ts` | Per-user AI cost budgets (implemented but not wired) |
| `server/services/agentAuthorityGate.ts` | Trust-gated authority levels for agent actions |
| `server/services/trustEvolution.ts` | Daily trust recalculation based on outcomes |
| `server/services/decisionsInbox.ts` | Founder approval queue for escalated decisions |
| `server/services/sophiePrivacyGuard.ts` | Cross-org learning privacy with k-anonymity |
| `server/middleware/piiMasking.ts` | PII masking for logs (phone, email, SSN, CC) |
| `server/routes-ai.ts` | AI HTTP routes with rate limiting and credit checks |
| `client/src/components/ai-cost-dashboard.tsx` | AI cost visualization component |
| `client/src/pages/founder-ai-observatory.tsx` | Founder telemetry dashboard for AI operations |
| `client/src/components/settings/ByokSettings.tsx` | Bring Your Own Key settings UI |
