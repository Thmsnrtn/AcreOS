# Theo Okuda — AcreOS AI Surface Audit

**Date:** 2026-05-01
**Lens:** Anthropic enterprise AI/ML lead. What do you ship before this scales? What's vapor? Where is the model burning cash and trust?

---

## TL;DR — three sentences before I lose you

1. **There is no eval infrastructure** — zero golden sets, zero regression tests, zero offline scoring runs. Every prompt change is a YOLO push to prod, and you would not know if quality regressed 20% tomorrow.
2. **Routing logic is sound on paper but rotten in practice** — `aiRouter.ts` is well designed, but ~101 service files call OpenAI **directly**, bypassing the router entirely (cache, telemetry, cost tracking, cascade — all skipped). The clean architecture is a paper tiger.
3. **One newly-shipped feature is right** — `routes-ai-draft.ts` (Pax inbox) is correct: clear refuse-aware prompt, edit-required UX, per-org gate, attribution. Use this as the pattern. Almost nothing else matches it.

---

## 1. AI Feature Inventory

| Feature | File | Model | Prompt Rigor (1–5) | Eval Status | Cost Estimate (per call) | Routes via aiRouter? |
|---|---|---|---|---|---|---|
| Pax inbox draft | `server/routes-ai-draft.ts:44` | DeepSeek (T1) | **4** — bounded, refuse-aware | None | ~$0.0003 | Yes (`routeSimpleTask`) |
| Pax executive chat | `server/ai/executive.ts:326` | GPT-4o + tool-use | 3 — long, identity-leaky | None | $0.02–0.10 | **Partial** — own client |
| Support classifier | `server/services/supportBrain.ts:49` | gpt-4o-mini hardcoded | 3 — tight schema | None | ~$0.0008 | **No** — direct OpenAI |
| Support contextual reply | `server/services/supportBrain.ts:427` | gpt-4o-mini | 2 — says "AcreOS" features incl. banned phrase | None | ~$0.002 | **No** |
| Self-assessment agent | `server/services/selfAssessmentAgent.ts:135` | Opus 4.6 | 3 — JSON-only, no schema val | None | ~$0.05–0.15 | **No** — direct OpenRouter client |
| Evolution pipeline | `server/services/evolutionPipeline.ts:288` | Opus 4.6 + GPT-4o + DeepSeek-R | 2 — no version pinning | None | ~$0.10–0.30 | **No** |
| AI tutor | `server/services/aiTutor.ts:78` | `gpt-4-turbo-preview` (deprecated) | 2 — vague, no tool-use | None | ~$0.04 | **No** |
| Quiz generation | `server/services/aiTutor.ts:208` | gpt-4-turbo-preview | 2 — JSON parsing fragile | None | ~$0.05 | **No** |
| Briefing writer (CEO) | `server/services/aiBriefingWriter.ts:74` | DeepSeek (T1) | 4 — tight, persona-driven | None | ~$0.001 | Yes |
| Headline insight | `server/services/aiBriefingWriter.ts:120` | DeepSeek | 4 — tight | None | ~$0.0003 | Yes |
| Board of Directors voting | `server/services/aiBoardOfDirectors.ts:250` | Haiku (Moderate) | 2 — generic vote prompt | None | ~$0.005 × 10 agents = **$0.05/proposal** | Yes |
| Founder Twin tiebreak | `server/services/aiBoardOfDirectors.ts:600` | Opus (CRITICAL) | 3 — JSON-only | None | ~$0.10 | Yes |
| Lead nurturer email | `server/services/leadNurturer.ts:150` | gpt-4o hardcoded | 3 — clear goals | None | ~$0.015 | **No** |
| Negotiation copilot | `server/services/negotiationCopilot.ts` | direct OpenAI | unknown | None | unknown | **No** |
| Compliance disclosures | `server/services/complianceAI.ts:303` | `gpt-4-turbo-preview` | 2 — generates legal text! | None | ~$0.03 | **No** |
| Vision/document parsing | `server/services/visionAI.ts` | direct OpenAI | unknown | None | unknown | **No** |
| Voice AI (calls) | `server/services/voiceAI.ts`, `voiceCallAI.ts` | direct OpenAI | unknown | None | unknown | **No** |
| Buyer matching AI | `server/services/buyerMatchingAI.ts` | direct OpenAI | unknown | None | unknown | **No** |
| AcreOS Valuation | `server/services/acreOSValuation.ts` | direct OpenAI | unknown | None | unknown | **No** |
| AI Offer | `server/services/aiOfferService.ts` | direct OpenAI | unknown | None | unknown | **No** (uses `tracedLlmCall`) |

**Observability count:** 7 services use `tracedLlmCall` / `logAgentTrace`; ~40+ AI services do not. The `agent_llm_traces` table is sparsely populated relative to what flows through `aiTelemetryEvents` (which is router-only). **Two parallel observability systems, one nearly empty.**

---

## 2. Top 5 Features That Need Eval Before Scaling

Rank ordered by *blast radius if quality silently regresses*.

1. **Pax inbox draft** (`routes-ai-draft.ts`). It speaks **as the customer**, to the customer's customer. A bad draft sent without sufficient review is reputational damage to a Land Investor, not just AcreOS. Need: 50-prompt golden set of inbound emails with rubric ("warm-professional, ≤120w, no over-promise, ends with signature placeholder"). Score with a Sonnet-as-judge eval. Run on every prompt change.
2. **Compliance / legal disclosure generator** (`complianceAI.ts:303`). Generating a *Seller's Property Disclosure Statement* with `gpt-4-turbo-preview` and zero validation is a lawsuit waiting to fire. This must (a) move to Opus 4.6 with extended thinking, (b) have a deterministic post-validator that asserts required sections exist, (c) be flagged "AI-generated draft — attorney review required" in the UI.
3. **Self-assessment / evolution pipeline** (`selfAssessmentAgent.ts`, `evolutionPipeline.ts`). This *changes the system itself*. If the model proposes a bad code fix and the loop applies it, you have an autonomous regression engine. Need: human-in-the-loop diff approval (probably already exists but not visible from this audit), plus eval that proposals are well-formed JSON with a real `targetFile` that resolves.
4. **Support classifier** (`supportBrain.ts:43`). Misclassification cascades — wrong category routes to wrong playbook, which can issue a courtesy credit or fail to escalate a critical case. Need: confusion matrix on a labeled set of 200 historical tickets per category.
5. **Pax executive chat with tool use** (`server/ai/executive.ts`). Tool-use means the model can `create_property`, `send_email`, `send_sms`, `update_deal`. A hallucinated argument (wrong APN, wrong amount) writes to your DB. Need: tool-call eval set — given message X, did it pick the right tool with the right args? Plus dollar-amount + APN format validators in the tool layer (some exist; not all).

---

## 3. Prompt Audit — three picked, one rewritten

### A. Pax inbox draft (`routes-ai-draft.ts:44`) — **GOOD**

> "You are Pax, AcreOS's land-investing assistant. Draft a reply to this inbound email on the user's behalf. Rules: Match the inbound's tone but stay warm-professional. No 'Hi there!' — use the sender's first name if available. Under 120 words. Land Investors read on phones. Do NOT promise specifics (price, close date, contract terms) the user hasn't authorized. Use phrases like 'happy to talk through' / 'let me look at the parcel and get back to you with specifics.' No 'AI-powered' / 'as an AI' / 'I'd be happy to assist.' Just write like a person. If the inbound asks a yes/no question with clear answer, give it. If ambiguous, ask one focused clarifying question. Sign as the user — do NOT sign as 'Pax' or 'AcreOS.' The user reviews + sends. Return only the reply body. No subject line, no greeting boilerplate, no signature block."

**Issues:**
- (minor) "Under 120 words" is soft — model often goes over. Add: "If you exceed 120 words, cut the least important sentence."
- (minor) `tone` enum (`warm-professional|concise|empathetic`) is defined in the schema (`routes-ai-draft.ts:41`) but not surfaced in the system prompt — the user prompt appends it, but no rule for what each means. Risk of "concise" producing curt rudeness.
- No explicit refusal path. What if the inbound says "send me your bank routing number"? The model will probably handle it correctly, but the prompt does not codify the safe response.

**Verdict:** Best prompt in the codebase. Use as the template.

### B. Pax executive chat (`server/ai/executive.ts:326`) — **TOO LONG, IDENTITY LEAKY**

> "You are Pax, an AI executive assistant for a real estate company using AcreOS. … description: 'Your AI-powered executive assistant for real estate operations'"

**Issues:**
1. **`description` field at line 325 says "AI-powered" — directly violates Brief §1.2** (memory: "banned 'AI-powered' language platform-wide"). This string is shown in the UI agent picker.
2. **Sophie is referenced as a customer-facing surface** ("warmly redirect the user to Sophie (Support section)" — line 339). Per memory: "Customers see Pax only; founder sees Sophie/Forge/Atlas/etc. Never mix them." Pax should **redirect to "support"** as a feature/section, not name a sibling persona that the customer is not supposed to know exists.
3. The phrase "You are NOT a generic assistant" is a tell — defensive prompting is a smell. The model already knows what it is from the rest. Removing it does nothing for quality and shortens the cache hash.
4. The whole "REAL ESTATE ANALYSIS FRAMEWORK" + "WORKFLOW DEFAULTS" sections are 30+ lines of prose the user can't see and can't iterate on. Move to a versioned `prompts/pax_executive.v3.md` file with a header comment so prompt changes are reviewable in PRs.
5. No latency budget. With tool-use loops (file `server/ai/executive.ts:1104` while-loop) the same chat can fire 3–5 model calls + tool roundtrips. P95 is almost certainly >8s. There is no streaming partial-text on tool-call paths.

### C. Board of Directors vote (`aiBoardOfDirectors.ts:250–256`) — **BAD**

> "BOARD VOTE REQUIRED\n\nProposal: ${voteRecord.proposal}\nCategory: ${category}\nYour domain weight: ${weight}\n\nVote 'for', 'against', or 'abstain'. Provide brief reasoning.\n\nRespond in JSON: {\"vote\": \"for|against|abstain\", \"reasoning\": \"...\"}"

**Issues:**
- 10 agents × Haiku × ~$0.005 = **$0.05 per proposal**. Fine alone, but on a "weekly meeting" with 10 proposals that's $0.50/week × N orgs. If this fan-outs across orgs there's a budget cliff.
- Each agent is given the **same proposal text** with their **personality prompt** as system. No actual data — they vote on vibes. If ledger_finance is voting on a financial proposal and isn't given the financial state, the vote is theater.
- "Your domain weight: ${weight}" is leaking the mechanism into the prompt — the model may be biased to vote yes more strongly on its own domain because it knows it has weight there. Domain weighting belongs in the tally function only.
- No JSON schema enforcement (the catch defaults to `abstain` — silent failure becomes governance failure).

### Rewrite (B): Pax executive — tightened

```
You are Pax — AcreOS's land-investing copilot.

Your scope: help the user find, analyze, and close deals; build and operate
their land portfolio; take action via the available tools.

Out of scope: account billing, password resets, platform troubleshooting.
For those, redirect to "Support" (do NOT name other agents to the user).

Style:
- Match the user's vocabulary. If they use "comps" and "APN", you can. If
  they don't, plain language only.
- Decisive over exhaustive. Give the recommendation, then a sentence why.
- Currency formatted "$1,234". Acreage formatted "12.34 acres".

Tool-use:
- Prefer tools over guessing. If you don't have data, fetch it.
- Never invent APNs, addresses, dollar amounts, or dates.
- For destructive actions (send_email, send_sms, generate_offer_letter)
  show a one-line confirmation before calling: "I'm about to send X to Y —
  ok?" Wait for the user to confirm.

Refusal:
- If asked for legal/tax advice, draft language only and tell the user an
  attorney/CPA must review before use.
- If asked to do something harmful, illegal, or that violates platform
  policy, decline plainly and offer the closest legitimate alternative.

Your output is read on a phone. Default to ≤120 words unless the user
asks for depth.
```

This is ~25% the length of the current prompt, removes "AI-powered" / "AI assistant" identity language, removes the Sophie leak, codifies tool-use safety, and adds a refusal frame. Cache it (≥1024 chars system → enable `enablePromptCaching`).

---

## 4. Model-Routing Review

Catalog at `aiRouter.ts:330–340`. Classifier at `aiRouter.ts:468–557`.

### Classifier is mostly right…

- `summarize`, `extract_data`, `categorize`, `lookup`, `count` → SIMPLE → DeepSeek. Correct.
- `deal_analysis`, `negotiation_strategy`, `due_diligence` → COMPLEX → Sonnet. Correct.
- `contract_review`, `legal_document`, `capital_allocation` → CRITICAL → Opus 4.6. Correct.

### …but the *content-based* override is too aggressive

`classifyFromMessages` (`aiRouter.ts:496`) escalates to COMPLEX whenever it sees:
- `/comprehensive/i`, `/detailed.*analysis/i`, `/multiple.*properties/i`

A user asking *"give me a comprehensive list of my leads"* gets routed to **Sonnet 4.6** at $3/$15 per M tokens. That's a SQL query. The regex is over-triggering — likely 15–25% of "list/lookup" tasks land on Sonnet today. **Audit the last 1k aiTelemetryEvents rows** and look at task→model bands; bet money you'll find SIMPLE-intent on COMPLEX models.

### Cascade quality-gate is clever but adds latency

`checkResponseQuality` (`aiRouter.ts:174`) runs a DeepSeek scoring call on every non-COMPLEX response (`aiRouter.ts:782`). That's **+1 model call on the hot path** — adds 400–800ms to p95 of every "simple" query. The PR comment says "5-15% cost increase" but the **latency tax is the bigger issue**. Recommend: cascade only async (write to a quality-issue queue, don't block the response), or sample at 10% rather than always.

### Direct-OpenAI bypass leak

The 101 services that call OpenAI directly (`grep -l "openai.chat.completions" server/services` → 40+ files) **do not get**:
- the L1 + L2 cache
- the cascade
- prompt caching annotations
- aiTelemetryEvents writes (no per-org cost visibility)
- model routing (most hardcode `gpt-4o-mini` or `gpt-4-turbo-preview`)

Every service that doesn't go through `routeAITask` is a cost-observability hole. Migrate them.

### `gpt-4-turbo-preview` is on the model catalog

`aiTutor.ts:93`, `aiTutor.ts:223`, `aiTutor.ts:278`, `complianceAI.ts:359` use `gpt-4-turbo-preview` — a **deprecated model alias** that will redirect/fallback at OpenAI's discretion. On the day OpenAI sunsets it you have an outage. Pin to specific dated versions.

---

## 5. Hallucination Risk Surfaces

Ranked by *what would cost you the customer* if it hallucinates:

1. **`complianceAI.ts:303` — Seller's Property Disclosure** — generating disclosure language that omits a required state-specific section (each state has its own statute) is malpractice exposure for the Land Investor and a class-of-error AcreOS will be sued for. **No deterministic post-validator.** Highest risk surface in the codebase.
2. **Pax inbox draft (`routes-ai-draft.ts`)** when sending offers — though the prompt explicitly forbids offering specific price/close/terms (line 49), nothing **enforces** it. A user could click Send without reading. The "edit required before send" gate is at the route layer (the draft endpoint doesn't send) — good — but UX must keep the friction loud.
3. **`aiOfferService.ts` blind offer generation** — wrong dollar amount on an offer letter that gets mailed is a binding number. Need: post-validator that the letter's offer amount equals the deterministically-computed (FMV × discount), not whatever the model wrote.
4. **`server/ai/tools.ts` tool-use args from Pax executive** — `create_property`, `update_deal`, `generate_offer` all take user-influenced args. Hallucinated APN format → DB row that won't reconcile with county data. Some validators exist (`server/ai/validators.ts`); coverage unknown — audit needed.
5. **`leadNurturer.ts:150` follow-up emails sent autonomously** — if these auto-send (vs draft), any factual claim about the property (acreage, price) that's wrong is broadcast to a real seller. Check whether this path is gated.
6. **Board of Directors votes acting as governance** — model votes "for" on a bad proposal because the prompt was thin → `boardDecisions` row says "passed" → some downstream automation acts on it. Governance theater becomes governance harm.

---

## 6. Cost + Latency Observability Gap

### What exists

- `aiTelemetryEvents` table populated by `aiRouter.ts:1046` — `recordAITelemetry` writes per-call cost, latency, cache hit, success on every routed call.
- `agent_llm_traces` table populated by `agentLlmTraces.ts:84` — full prompt+response audit, but only ~7 services write to it.
- `routes-admin.ts:4209` exposes a list endpoint for telemetry.
- `autonomousHealthMonitor.ts:235` sums total cost from telemetry.

### What's missing

- **No per-org rolling-window cost dashboard.** A runaway feature would add 100k events before anyone noticed.
- **No latency P50/P95/P99 by feature.** Latency is recorded; no aggregation or alerting.
- **No "alert when feature X cost grows >30% WoW".** Trivial to add given the telemetry table exists.
- **No cache hit rate by feature.** `getAICacheStats()` returns global counters; can't see which features benefit from caching and which never hit.
- **No streaming on tool-use paths.** `routes-ai.ts:328` streams the chat endpoint, but tool-call iterations buffer until the full chain completes — visible UI lag.
- **The 101 direct-OpenAI calls write nothing.** Whatever they cost is invisible in the dashboard.

### Ship before scaling

1. Migrate top 10 direct-OpenAI services to `routeAITask` (see §8 sprint).
2. Add `aiTelemetryEvents` aggregation view: org × feature × day → tokens, cost cents, count, p95 latency.
3. Add a Slack/email alert: per-org daily AI spend > $X → ping founder.
4. Add cache hit rate by `taskType` to the existing `getAICacheStats` shape.

---

## 7. "Deterministic, not LLM" Candidates

Things currently using a model that are deterministic functions in disguise:

1. **`aiContextAggregator.ts:229` `formatContextForAI`** — already deterministic. Good. Reference for the rest.
2. **`aiTutor.ts:294` `analyzeLearningPattern`** — returns hardcoded strings (`'Evening (6-9 PM)'`, `'Property Valuation'`). It's **already not using the LLM** but pretends to (file is named aiTutor). Either compute these from data or rip out the placeholders. Right now it's worse than AI — it's fake AI.
3. **`aiBriefingWriter.ts:120` `generateHeadlineInsight`** — "Quiet night, 12 actions, MRR $4.5k" can be a string template. The LLM adds 0% value at $0.0003/call × N orgs/day.
4. **Board of Directors "domain reports"** (`aiBoardOfDirectors.ts:148`) — each agent generates a "report" by LLM, but the underlying data is in `agentDataResolvers`. The "summary" wrapper is a template fit.
5. **Briefing per-agent updates** (`aiBriefingWriter.ts:74`) — the model is asked to summarize 1-2 rows of metrics. A `${metric.successRate < 0.8 ? "X is below target" : "X on track"}` template hits 80% of value at 0% cost.
6. **Self-assessment "system_health_check"** (`selfAssessmentAgent.ts:289`) — if the underlying signal is "X tasks failed in 30 days", that's SQL + thresholding, not Opus.
7. **Tutor quiz generation** (`aiTutor.ts:208`) — generating quiz questions every time is wasteful; cache by `moduleId` permanently (or generate at content-author time, not at request time).

Combined: probably 30–50% of LLM calls today serve no quality benefit a template wouldn't match. That's spend with no return.

---

## 8. Recommended AI Engineering Sprint — 2–3 weeks

In rough order. Each is 1–3 days for one engineer who already knows the codebase.

1. **Eval harness v0** (3d) — `tests/evals/` with: golden set fixtures (JSON), Sonnet-as-judge runner, score thresholds in CI. Start with 30 inbox-draft prompts. Block PRs that drop quality > 5%.
2. **Migrate direct-OpenAI callsites to `routeAITask`** (3d) — top 10 by call volume. Quantifies cost-observability win. Targets: `supportBrain.ts`, `aiTutor.ts`, `complianceAI.ts`, `leadNurturer.ts`, `aiOfferService.ts`, `negotiationCopilot.ts`, `customerNarrative.ts`, `visionAI.ts`, `voiceAI.ts`, `acreOSValuation.ts`.
3. **Kill `gpt-4-turbo-preview`** (0.5d) — pin every callsite to a dated model. Adds 1 line to a pin-check unit test.
4. **Pax prompt v2** (1d) — apply rewrite from §3.B. Remove "AI-powered" + Sophie leak. Move to versioned file. Enable prompt caching.
5. **Cascade → async sample** (1d) — quality-check 10% of responses, write quality-issue rows for review, don't block the hot path. Saves p95 ~500ms.
6. **Per-org AI cost dashboard** (2d) — aggregate view + UI tile. "Yesterday's AI spend by org / feature." Daily Slack at 9am.
7. **Compliance disclosure post-validator** (2d) — assert required sections by state present in generated text. Block delivery if missing. Move model to Opus + extended thinking.
8. **Board-vote prompt v2** (1d) — feed each agent the actual data their domain owns (KPIs, recent decisions). Stop telling them their weight. Enforce JSON schema with retry.
9. **Tool-call telemetry** (1d) — log every tool invocation from `executive.ts:1104` with args + outcome. Builds the dataset for tool-use eval.
10. **Hallucination guardrail unit tests** (2d) — Pax draft must not contain `$\d`/`\d{4}-\d{2}-\d{2}` patterns when rules forbid; offer letter dollar amount must equal deterministic computation; APN args must match state regex. Cheap, deterministic, catch real bugs.

**Stretch (week 3):**
- Sample-based hallucination eval: 1% of customer-facing responses re-graded by Sonnet for "made up specifics?" → flagged for review.
- Prompt-versioning + A/B harness so prompt changes ship as `pax_v3` shadow → production after eval pass.

---

## File:line reference

- `server/services/aiRouter.ts:174` checkResponseQuality (cascade)
- `server/services/aiRouter.ts:330` model catalog
- `server/services/aiRouter.ts:468` classifyTaskComplexity
- `server/services/aiRouter.ts:1046` recordAITelemetry
- `server/routes-ai-draft.ts:44` Pax draft system prompt
- `server/services/supportBrain.ts:49` classifier prompt
- `server/services/supportBrain.ts:440` "AI-powered due diligence" — banned phrase shipped in support context
- `server/ai/executive.ts:325` "AI-powered executive assistant" — banned phrase in agent description
- `server/ai/executive.ts:339` Sophie referenced to customer (persona-leak)
- `server/services/aiBoardOfDirectors.ts:250` Board vote prompt
- `server/services/aiBoardOfDirectors.ts:600` Founder Twin tiebreak
- `server/services/aiBriefingWriter.ts:74` per-agent briefing
- `server/services/selfAssessmentAgent.ts:135` self-assessment prompt
- `server/services/evolutionPipeline.ts:288` evolution pipeline
- `server/services/aiTutor.ts:78,93,208,278` aiTutor with deprecated `gpt-4-turbo-preview`
- `server/services/agentLlmTraces.ts:84` trace writer (sparsely used)
- `server/routes-admin.ts:4209` telemetry list endpoint
- `server/jobs/autonomousHealthMonitor.ts:235` total spend aggregator

---

**Bottom line for the founder:** The architecture is good. The discipline is not. You have 2 parallel observability systems and ~100 services that use neither. Before you scale customer count, ship eval + migrate the bypassers. Three weeks of focused work pays for itself in cost savings the first month, and it's the difference between "we can demo a Pax draft" and "we can stand behind every word Pax has ever said."
