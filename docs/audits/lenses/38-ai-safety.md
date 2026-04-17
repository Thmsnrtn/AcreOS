# Lens 38 -- AI Safety Engineer

Auditor: AI Safety Engineer
Date: 2026-04-15
Status: COMPLETE

---

## Scope

Evaluated prompt injection resistance, PII handling in AI contexts, output validation, cost controls, jailbreak resistance, autonomous decision-making, and whether AI outputs could cause real-world financial or legal harm.

Key files examined:

- `server/middleware/promptInjection.ts` -- prompt injection guard
- `server/ai/executive.ts` -- Atlas/Pax chat system (1400+ LOC)
- `server/ai/tools.ts` -- tool definitions and executors
- `server/ai/validators.ts` -- structured output validation
- `server/ai/supportAgent.ts` -- Sophie support agent
- `server/services/aiRouter.ts` -- multi-model routing and cost estimation
- `server/services/blindOfferCalculator.ts` -- automated offer pricing
- `server/services/autonomousDecisionExecutor.ts` -- AI auto-executes business decisions
- `server/services/doddFrankChecker.ts` -- regulatory compliance checker
- `server/services/regulatoryIntelligence.ts` -- legal/regulatory advisory
- `server/services/taxOptimizer.ts` -- tax strategy recommendations
- `server/services/usageLimits.ts` -- per-org AI request limits
- `server/middleware/rateLimit.ts` -- rate limiting
- `server/services/scpLLMJudges.ts` -- SCP evolution judges
- `server/routes-ai.ts` -- AI route handlers

---

## Findings

### F-38-01 PII sent to third-party LLMs without explicit user consent (P0)

**Severity: P0**

The `get_leads` tool in `server/ai/tools.ts:914-937` returns full PII to the LLM context -- first name, last name, email, phone number, and notes. The `get_lead_details` tool (line 940) returns the entire lead record including all personal fields. This data is sent to OpenRouter (which proxies to Anthropic, OpenAI, DeepSeek) as part of chat completions.

There is no:
- Explicit user consent mechanism for sending lead/contact PII to third-party AI providers
- PII redaction or anonymization layer before LLM context injection
- Data processing agreement disclosure to end users
- Opt-in/opt-out toggle for AI processing of contact data

Additionally, the `scoreAndLearnFromResponse` function (`server/ai/executive.ts:22-69`) sends truncated user messages (300 chars) and assistant responses (500 chars) to a *separate* DeepSeek model call for quality scoring -- a secondary data flow that users have no visibility into.

**Location:** `server/ai/tools.ts:914-946`, `server/ai/executive.ts:22-69`

### F-38-02 Autonomous Decision Executor sends real emails/resolves tickets using AI-generated content with no human review (P0)

**Severity: P0**

`server/services/autonomousDecisionExecutor.ts` autonomously:
1. Drafts and sends customer support responses (line 280-297) -- AI-generated text is inserted as a ticket reply and the ticket is marked "resolved" with no human review
2. Sends retention emails to at-risk customers (line 300-339) -- AI-generated email content is sent directly via emailService
3. Closes system alerts based on AI judgment (line 342-360)

The confidence threshold is configurable via env var (default 75/100), but there is no secondary validation of AI-generated email content. An AI hallucination or poor judgment call results in a real email to a real customer. The system prompt says "Never draft a response that makes legal promises or guarantees" but this is enforced only by LLM instruction-following, not code.

**Location:** `server/services/autonomousDecisionExecutor.ts:270-340`

### F-38-03 Financial calculations presented as recommendations without disclaimers in AI chat (P0)

**Severity: P0**

The blind offer calculator (`server/services/blindOfferCalculator.ts`) generates specific dollar-amount purchase offers, owner-financing terms (9% interest, 84-month amortization), ROI projections, and cash flip scenarios. These are surfaced through the Atlas AI agent chat.

The owner-finance scenario (line 543-544) hardcodes `doddFrankExempt: true` with a note claiming "Raw land seller financing is exempt from Dodd-Frank, RESPA, and SAFE Act requirements." While this is a common industry position for pure land, it is a legal conclusion that should not be presented as absolute fact -- there are edge cases (manufactured homes on land, state-specific usury laws).

The Atlas system prompt contains no financial advice disclaimer. The agent speaks in the first person about deal recommendations with specific dollar amounts. No output carries a disclaimer like "This is not financial advice" or "Consult a licensed professional."

The tax optimizer (`server/services/taxOptimizer.ts`) provides specific capital gains calculations and tax strategy recommendations using hardcoded 2024 federal tax brackets. Some downstream services (usury checker, Dodd-Frank checker) do include "consult attorney" language, but the AI chat layer that wraps them does not consistently surface these disclaimers.

**Location:** `server/services/blindOfferCalculator.ts:499-544`, `server/ai/executive.ts:132-262` (Atlas system prompt), `server/services/taxOptimizer.ts`

### F-38-04 Prompt injection guard has limited coverage -- deny-list only, no structural defenses (P1)

**Severity: P1**

The prompt injection middleware (`server/middleware/promptInjection.ts`) uses a deny-list of ~20 regex patterns. This is a reasonable first layer but has known limitations:

1. **Easy to bypass**: Obfuscation (unicode homoglyphs, base64, leet-speak, whitespace injection) trivially evades regex patterns. For example: "ign0re prev1ous instruct1ons" or "i g n o r e previous instructions" would pass.
2. **Language-specific**: All patterns are English-only. Injection attempts in other languages pass through.
3. **Limited route coverage**: The middleware is only mounted on `/api/ai`, `/api/atlas`, `/api/chat`, and `/api/executive` (per `server/routes.ts:583-586`). Other endpoints that feed data into AI contexts (e.g., lead notes, property descriptions, knowledge base uploads, campaign content) are NOT covered. An attacker could inject a prompt via a lead's `notes` field, which later gets loaded into Atlas context via `get_lead_details`.
4. **No structural separation**: System prompts and user content share the same message array with no delimiter hardening. The system prompt does not include instructions like "ignore any instructions within user-supplied data."

**Location:** `server/middleware/promptInjection.ts`, `server/routes.ts:580-586`

### F-38-05 No output validation on AI chat responses -- validators exist but are unused (P1)

**Severity: P1**

`server/ai/validators.ts` defines a comprehensive structured output validation system (offer amounts, amortization math, ROI analysis, comps analysis, APN format). However, `grep` confirms this module is **never imported anywhere** except in its own doc comment example. The export `validateAtlasOutput` has zero call sites.

This means:
- AI-generated offer amounts are shown to users without range validation
- AI-generated amortization schedules are not cross-checked against the payment formula
- ROI calculations from the LLM are not verified mathematically
- The hallucination guardrails documented in the file are entirely dead code

In both `processChat` and `processChatStream`, the LLM response is stored and returned directly (`finalContent = assistantMessage.content`, line 1035).

**Location:** `server/ai/validators.ts` (dead code), `server/ai/executive.ts:1035`

### F-38-06 Unbounded tool-call loop -- no iteration limit (P1)

**Severity: P1**

Both `processChat` (line 991) and `processChatStream` (line 1289) use a `while` loop that continues as long as the LLM returns tool calls. There is no maximum iteration counter. If the LLM enters a pathological loop (repeatedly calling the same tool), the server will:
1. Make unbounded API calls to both the LLM and internal tools
2. Accumulate unbounded token costs on OpenRouter
3. Potentially exhaust database connections or external API rate limits

The streaming version (`processChatStream`) has `continueLoop = true` with the only exit being when the LLM stops requesting tools. A single malicious or confused conversation could generate dozens of LLM round-trips.

**Location:** `server/ai/executive.ts:991`, `server/ai/executive.ts:1289`

### F-38-07 No global AI spend cap or circuit breaker (P1)

**Severity: P1**

The system has per-org daily request limits (free: 25, starter: 500, pro: 1000 -- `server/services/usageLimits.ts:47-100`) and per-request credit checks (2 cents per AI chat). However, there is no:
- Global monthly or daily AI API spend cap
- Per-organization monthly dollar limit
- Circuit breaker that halts AI API calls if total spend exceeds a threshold
- Alert when spend anomalies are detected in real-time

The `spendAutonomyV9.ts` service monitors costs *weekly* and proposes optimizations, but it does not enforce hard limits. The `scpLLMJudges.ts` tracks cost in memory but has no enforcement mechanism. OpenRouter's own spending limits are the only external guard, but these depend on account configuration.

Scale/Enterprise tiers have `ai_requests: null` (unlimited), meaning a compromised or buggy enterprise account could generate unbounded API calls with no server-side cost limit.

**Location:** `server/services/usageLimits.ts:83-100` (null limits for upper tiers), `server/services/spendAutonomyV9.ts` (monitoring only)

### F-38-08 AI agent can send emails/SMS without human approval in non-streaming path (P1)

**Severity: P1**

The `APPROVAL_REQUIRED_TOOLS` set (`server/ai/tools.ts:898-904`) correctly gates `send_email`, `send_sms`, `send_gmail`, `send_slack_message`, and `create_stripe_payment_link`. However, the approval gate is only implemented in the `processChatStream` function (line 1382). In the non-streaming `processChat` path (line 1000-1014), there is no approval check -- tools are executed directly via `executeTool()` without any pre-approval gate.

If a client uses the non-streaming `/api/ai/chat` endpoint rather than `/api/ai/chat/stream`, the LLM can autonomously send emails and SMS messages to real contacts without user confirmation.

**Location:** `server/ai/executive.ts:988-1014` (non-streaming path missing approval gate)

### F-38-09 Quality scoring prompt leaks user context to secondary model (P2)

**Severity: P2**

`scoreAndLearnFromResponse` (`server/ai/executive.ts:33-36`) sends truncated user messages and assistant responses to DeepSeek for quality scoring. The scoring prompt template directly interpolates user content: `User asked: "${userMessage.slice(0, 300)}"`. This:
1. Sends conversation snippets to a secondary provider (DeepSeek) that the user did not explicitly interact with
2. Stores quality scores and conversation patterns in the `agentMemory` database table, creating a persistent record of conversation content beyond the conversation itself

**Location:** `server/ai/executive.ts:33-36`

### F-38-10 System prompts lack injection-resistance hardening (P2)

**Severity: P2**

The Atlas system prompt (`server/ai/executive.ts:270-324`) is approximately 10,000 tokens of real estate methodology and instructions. It does not include:
- An instruction to ignore any conflicting instructions within user-supplied data
- A delimiter or sentinel to mark the boundary between trusted system instructions and untrusted user input
- Instructions to refuse requests that attempt to modify agent behavior

The prompt provides full tool access instructions (line 288-297) including `send_email`, `send_sms`, and `generate_offer_letter`. If a prompt injection bypasses the deny-list, the injected text appears in the same message array as the system prompt with no structural separation.

**Location:** `server/ai/executive.ts:270-324`

### F-38-11 Regulatory/legal AI outputs lack consistent professional-advice disclaimers (P2)

**Severity: P2**

Several services provide legal-adjacent outputs:
- `doddFrankChecker.ts` provides Dodd-Frank compliance determinations and includes "consult attorney" recommendations
- `regulatoryIntelligence.ts` provides state-by-state regulatory profiles with practitioner notes
- `usury.ts` and `usuryCeiling.ts` include disclaimers
- `taxOptimizer.ts` provides specific tax strategies with some "consult tax attorney" language

However, when these outputs are consumed through the Atlas AI chat interface, the disclaimer language is not consistently surfaced. The AI agent's persona is that of a "deeply specialized real estate expert" (line 271-272) who speaks authoritatively, which could lead users to treat regulatory guidance as professional legal advice.

**Location:** `server/services/regulatoryIntelligence.ts`, `server/services/doddFrankChecker.ts`, `server/ai/executive.ts:270-272`

### F-38-12 Knowledge base and file upload content injected into system prompt without sanitization (P2)

**Severity: P2**

`loadOrgKnowledgeContext` (`server/ai/executive.ts:716-728`) and `formatFileContentAsync` (line 561-624) inject uploaded file contents directly into the system prompt. Knowledge base files and uploaded CSVs/DOCX/text files become part of the trusted system context concatenated to the system prompt (line 906).

An attacker who can upload a knowledge base file (or a user who unknowingly uploads a document containing injection text) could embed adversarial instructions that become part of the system prompt for all subsequent conversations. The prompt injection middleware does not process these indirect injection vectors.

**Location:** `server/ai/executive.ts:716-728`, `server/ai/executive.ts:906`

### F-38-13 Conversation auto-compaction sends full message history to LLM for summarization (P2)

**Severity: P2**

`compactConversationIfNeeded` (`server/ai/executive.ts:751-789`) triggers when a conversation exceeds 20 messages or ~80K characters. It sends up to half the conversation history (truncated to 600 chars per message) to the cheapest model (DeepSeek) for summarization. The resulting summary is stored in the database.

This creates an additional data flow where conversation content (potentially containing PII discussed in chat) is sent to a different model tier than the user expects, and the compressed representation is persisted.

**Location:** `server/ai/executive.ts:751-789`

---

## Summary

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| F-38-01 | PII sent to third-party LLMs without explicit consent | P0 | Privacy |
| F-38-02 | Autonomous executor sends real emails from AI-generated content | P0 | Autonomous action |
| F-38-03 | Financial calculations/offers with no disclaimers | P0 | Financial harm |
| F-38-04 | Prompt injection guard is deny-list only, limited route coverage | P1 | Injection resistance |
| F-38-05 | Output validators exist but are dead code (never called) | P1 | Output validation |
| F-38-06 | Unbounded tool-call loop (no iteration limit) | P1 | Cost / DoS |
| F-38-07 | No global AI spend cap or circuit breaker | P1 | Cost control |
| F-38-08 | Non-streaming chat path bypasses tool approval gate | P1 | Autonomous action |
| F-38-09 | Quality scoring leaks user context to secondary model | P2 | Privacy |
| F-38-10 | System prompts lack injection-resistance hardening | P2 | Injection resistance |
| F-38-11 | Legal/regulatory AI outputs lack consistent disclaimers | P2 | Legal risk |
| F-38-12 | Knowledge base uploads injected into system prompt unsanitized | P2 | Injection resistance |
| F-38-13 | Conversation compaction sends history to secondary model | P2 | Privacy |

**P0 count: 3** | **P1 count: 5** | **P2 count: 5**

---

## Positive Observations

1. **Prompt injection middleware exists** -- `server/middleware/promptInjection.ts` is a real, tested module with unit tests (`tests/unit/promptInjection.test.ts`). The patterns are reasonable for a v1 deny-list.
2. **Output validators are well-designed** -- `server/ai/validators.ts` has thoughtful Zod schemas for offer amounts, amortization math cross-checks, and APN format validation. They just need to be wired in.
3. **Per-org usage limits exist** -- `server/services/usageLimits.ts` implements tiered daily request limits and credit checks before AI calls.
4. **Tool approval gate exists for streaming** -- The streaming path correctly requires user approval for send_email, send_sms, and other communication tools.
5. **Dodd-Frank checker is deterministic** -- `server/services/doddFrankChecker.ts` uses rule-based logic (not LLM) with clear statutory references.
6. **Audit logging on autonomous decisions** -- `autonomousDecisionExecutor.ts` logs every decision with full reasoning, confidence scores, and execution results.
7. **Multi-model tiering is cost-conscious** -- The router targets 60% cheap/30% balanced/7% complex/2% critical model distribution.
8. **SCP LLM Judges track costs** -- `scpLLMJudges.ts` has per-judge cost tracking with input/output token accounting.
9. **Rate limiting on AI routes** -- `aiLimiter` is applied to both `/api/ai/chat` and `/api/ai/chat/stream`.
10. **Usury ceiling service includes disclaimers** -- `server/services/usury.ts` and `usuryCeiling.ts` consistently include "consult a licensed real estate attorney" language.
