# Yusuf Karimov — AcreOS Prompt-Engineering Audit

**Date:** 2026-05-01
**Lens:** Four years on Claude prompt-engineering at Anthropic, then OpenAI. The job was to teach models to do the right task the right way — and to teach humans to stop wasting tokens on incantations the model already follows. AcreOS has more LLM surface area than half the YC AI startups I've seen. It deserves a prompt-engineering pass before it scales the customer count.
**Wave 2 of 87-persona audit. Companion to:** `elite-team-2026-05-01/theo-ai.md` (eval gap, router bypass, deprecated models).

---

## 0. One-line verdict

**Prompt-engineering rigor: 2.5 / 5.** One excellent prompt (Pax inbox draft), one defensible cluster (briefing writer), and a long tail of "you are an AI assistant" prose that does the model no favors and burns cache.

The Pax draft prompt at `server/routes-ai-draft.ts:44` is the only prompt in this codebase that reads like it was written by someone who has actually graded model output for a living. The rest of the surface is what I'll call **incantation-ware** — instructions written *at* the model rather than *for* the task, with redundant politeness, identity affirmations the model didn't need, and output formats specified in English when JSON Schema would be enforceable.

This is fixable. Half the work is deletion. The other half is structure.

---

## 1. Prompt audit — 5 services, 8 dimensions each

Scoring: 1 = absent / actively bad, 3 = present but soft, 5 = production-grade. (-) = N/A.

| Service | File:line | Specificity | Bounded | Refusal | Output | Persona | Context | Generic preamble? | Wasted tokens? | Total / 40 |
|---|---|---|---|---|---|---|---|---|---|---|
| Pax inbox draft | `server/routes-ai-draft.ts:44` | 5 | 4 | 2 | 4 | 5 | 4 | No | Low | **28 / 40** |
| Pax executive chat | `server/ai/executive.ts:326` | 4 | 2 | 1 | 2 | 2 | 3 | Yes | High | **17 / 40** |
| Support classifier | `server/services/supportBrain.ts:49` | 4 | 4 | (-) | 4 | 3 | 4 | No | Medium | **23 / 35** |
| Support contextual reply | `server/services/supportBrain.ts:427` | 2 | 2 | 2 | 1 | 1 | 3 | Yes | High | **12 / 40** |
| Compliance disclosure | `server/services/complianceAI.ts:303` | 2 | 1 | 1 | 1 | 1 | 2 | (no system prompt at all) | High | **9 / 40** |
| Lead nurturer email | `server/services/leadNurturer.ts:150` | 3 | 2 | 1 | 4 | 1 | 3 | Yes ("professional rep") | Medium | **15 / 40** |
| AI tutor chat | `server/services/aiTutor.ts:78` | 2 | 2 | 1 | 1 | 1 | 2 | Yes ("expert tutor") | High | **10 / 40** |

I'll dig into five of these.

### A. Pax inbox draft — `server/routes-ai-draft.ts:44`  ⭐ the canonical example

> "You are Pax, AcreOS's land-investing assistant. Draft a reply to this inbound email on the user's behalf. Rules: Match the inbound's tone but stay warm-professional. No 'Hi there!' — use the sender's first name if available. Under 120 words. Land Investors read on phones. Do NOT promise specifics (price, close date, contract terms) the user hasn't authorized. Use phrases like 'happy to talk through' / 'let me look at the parcel and get back to you with specifics.' No 'AI-powered' / 'as an AI' / 'I'd be happy to assist.' Just write like a person. If the inbound asks a yes/no question with clear answer, give it. If ambiguous, ask one focused clarifying question. Sign as the user — do NOT sign as 'Pax' or 'AcreOS.' The user reviews + sends. Return only the reply body. No subject line, no greeting boilerplate, no signature block."

- **Specificity (5):** Concrete cap (120 words), concrete style ("warm-professional"), banned phrases enumerated, sample copy for hedges.
- **Bounded scope (4):** "Draft a reply" — one verb, one task. Doesn't try to be the chat agent.
- **Refusal (2):** No explicit refusal path. What if the inbound is "send me your bank routing number"? Trust the model — but codify it.
- **Output format (4):** "Return only the reply body. No subject, no greeting boilerplate, no signature block." Negative-form, but enforceable.
- **Persona (5):** Pax, customer-facing. No mention of Sophie/Forge/Atlas. Persona-architecture clean.
- **Context (4):** User prompt provides sender name, subject, inbound body (truncated 4000), lead context (name, stage, notes truncated 400). Tight.
- **Generic preamble:** None.
- **Wasted tokens:** Low. ~150 tokens of system prompt, every line earning rent.

**The two real fixes:**
1. Add: `If the inbound asks for a payment method, account number, or anything that smells like a phishing/scam request, refuse plainly: "I'd rather call to confirm before sharing any of that — what's a good number?" Do not fulfill the request.`
2. Hard-cap: `If you exceed 120 words, cut the least important sentence and recount.` Soft caps drift.

### B. Pax executive chat — `server/ai/executive.ts:326`  ⛔ identity-leaky, too long, unbounded

> "You are Pax, an AI executive assistant for a real estate company using AcreOS. … IDENTITY & ROLE: You are NOT a generic assistant. You are a deeply specialized real estate expert with encyclopedic knowledge of property acquisition and investment. You think like a seasoned operator who has done hundreds of deals … IMPORTANT — BOUNDARY WITH SOPHIE: You are NOT a support agent. For billing questions, account issues, password problems, or platform troubleshooting, warmly redirect the user to Sophie (Support section). Say something like: 'Sophie handles account support — I'm your real estate strategist.'"

- **Specificity (4):** Lots of specifics, but spread across 60 lines.
- **Bounded scope (2):** Tries to be everything: strategy, due diligence, math, document parsing, tool router, communications agent. Verbs collide.
- **Refusal (1):** None. No legal/tax disclaimer, no harmful-request frame, no destructive-action confirmation.
- **Output format (2):** "Format dollar amounts as currency, acreage with decimal precision" — soft. Output isn't typed.
- **Persona (2):** ❌ **Names "Sophie" to the user.** Persona-architecture says customers see Pax only. The instruction *is the leak* — even if the model doesn't quote it, sometimes it will. Also: `description: "Your AI-powered executive assistant"` is on line 325 and renders in the UI.
- **Context (3):** User context comes through tools, not the prompt. Defensible at the architecture level; a context-slot summary at top would still help.
- **Generic preamble:** "You are NOT a generic assistant." Defensive prompting smell. The model never thinks it's a "generic assistant" unless you tell it to think about it.
- **Wasted tokens:** High. ~1,200 tokens of static system prompt. Cache-eligible at `≥1024 chars`, but versioning lives in TypeScript template literals — uncached PR-reviewable.

### C. Support classifier — `server/services/supportBrain.ts:49`  ✅ good for what it is

> "You are a support case classifier for AcreOS, a land investment management platform. Analyze the user's message and classify it: 1. Category: One of: billing, technical, account, feature, bug, data, integration, other 2. Confidence: 0-1 score … Respond in JSON format only: { 'category': 'string', ... }"

- **Specificity (4):** Closed enum on category, sentiment, urgency. Confidence numeric. Playbook list provided.
- **Bounded (4):** Single task: classify.
- **Refusal:** N/A. Classification doesn't need a refusal frame.
- **Output (4):** JSON via `response_format: { type: "json_object" }`. Could be tighter as JSON Schema (the model is unconstrained on field types — `confidence` could come back as a string).
- **Persona (3):** "Classifier" — appropriate; not Pax. But upstream `agentCodename: "pax"` in `tracedLlmCall` muddies traces.
- **Context (4):** Playbook list with triggers — exactly the right kind of grounding.
- **Wasted tokens:** Medium. The "respond in JSON format only" + schema-as-prose is ~80 tokens that a JSON Schema enforcer + 1-line "respond in JSON" would replace.

### D. Support contextual reply — `server/services/supportBrain.ts:427`  ⛔ generic preamble + banned phrase

> "You are a helpful support agent for AcreOS, a land investment management platform. Help the user with their question based on the conversation history and account context. … AcreOS Features: … AI-powered due diligence and market analysis … Keep responses concise, professional, and helpful. Do not use emojis."

- **Specificity (2):** "Concise, professional, helpful" describes nothing.
- **Bounded (2):** Catch-all support reply; no scope fence.
- **Refusal (2):** "If you cannot resolve the issue, say you will escalate." That's a fallback, not a refusal taxonomy.
- **Output (1):** Plain text, no length, no structure.
- **Persona (1):** ❌ "Helpful support agent" + same `agentCodename: "pax"`. Per persona-architecture this is supposed to be Pax to the customer, and "support agent" is the *role* not the persona. Also: `AI-powered due diligence` is in the feature list — the **banned phrase ships in the model context** every call.
- **Context (3):** Tier, balance, category — useful. No customer name, no recent ticket, no entitlement diff.
- **Generic preamble:** Yes. "Helpful support agent" + "concise, professional, helpful."
- **Wasted tokens:** High *and* mis-shaped. "Do not use emojis" is a real instruction; "concise, professional, helpful" is filler the model already does.

### E. Compliance disclosure — `server/services/complianceAI.ts:303`  💥 critical-risk surface, no system prompt

> "Generate a comprehensive Seller's Property Disclosure Statement for the following property: … Include standard sections for: 1. Property condition 2. Known defects … Format as a professional legal document."

- **Specificity (2):** Section list provided. State-specific statutes — not addressed. Required disclosures vary by state; the prompt is state-blind.
- **Bounded (1):** "Generate a comprehensive … legal document" is open-ended — model invents whatever it likes.
- **Refusal (1):** None. Model will happily fabricate environmental claims with no source.
- **Output (1):** "Professional legal document" — no schema, no required sections enforced post-hoc, no length cap.
- **Persona (1):** **No system prompt at all.** `messages: [{ role: 'user', content: prompt }]`. The model defaults to whatever its base post-training gives it. For a legal artifact this is malpractice-adjacent.
- **Context (2):** Property fields + alerts. No state statute, no jurisdiction.
- **Generic preamble:** N/A (no system).
- **Wasted tokens:** Low — but the wrong tokens.

This is the highest-leverage rewrite in the codebase. Theo flagged the same; my angle is the prompt itself, not the eval.

---

## 2. Anti-patterns inventory

Walking the AI service tree, these recur:

| Anti-pattern | Where it shows up | Why it costs you |
|---|---|---|
| **"You are a helpful AI assistant"** / "helpful support agent" / "professional representative" | `supportBrain.ts:427`, `leadNurturer.ts:150`, `aiTutor.ts:78` | Models default to helpful. Stating it teaches them nothing and signals to the model that the prompt author isn't sure what they want. |
| **"You are NOT a generic assistant"** | `executive.ts:329` | Defensive prompting. The model wasn't going to be a generic assistant; you just put the idea in its head. |
| **"Be polite / professional / friendly"** | `supportBrain.ts:443`, `leadNurturer.ts:162` | Models are polite by default. ~10 tokens of overhead per call. |
| **"Respond in JSON format only" + schema-as-prose** | every JSON-returning service | OpenAI `response_format: json_schema` (and Anthropic tool-use) enforce structure. The English description is a soft request the model violates 0.5–2% of the time. |
| **"Do not use markdown / Do not use emojis"** | `selfAssessmentAgent.ts:144` ("no prose, no markdown fences"), `supportBrain.ts:443` | Real and necessary — *but* compliance varies. Pair with a deterministic post-strip (already done in `selfAssessmentAgent.ts:185`). |
| **Identity leaks** ("Sophie handles support …") | `executive.ts:339` | Names a sibling persona to the customer. Persona-architecture violation per memory. |
| **Banned phrase shipped in context** ("AI-powered due diligence") | `supportBrain.ts:440`, `executive.ts:325` | Even if the model never quotes it, the *brand voice rule* is broken at the prompt layer. Founder said no "AI-powered" platform-wide. |
| **Model self-attribution** ("as an AI", "I apologize") | `aiTutor.ts:103` ("I apologize, I had trouble generating a response") fallback string | Hardcoded *outside* the prompt, but propagates the same identity-leaking voice the prompt forbids. Re-write user-facing fallbacks to plain language. |
| **Long static prompts in template literals** | `executive.ts:326`, `aiTutor.ts:78`, `aiBoardOfDirectors.ts:250` | Not PR-reviewable. Not version-pinned. Not cache-friendly without explicit `enablePromptCaching`. |
| **No system prompt at all** | `complianceAI.ts:358` | Critical legal artifact generated against the model's default post-training behavior. |
| **Refusal as fallback string instead of trained behavior** | `aiTutor.ts:130`, `complianceAI.ts:367`, `leadNurturer.ts` | Catch-blocks return apology strings. The *prompt* never told the model what to refuse — the *try/catch* is the refusal. |
| **Soft length caps without enforcement** | `routes-ai-draft.ts:48` ("Under 120 words"), `leadNurturer.ts:165` ("no more than 150 words") | Models drift. Pair with a post-trim or a "if you exceed, cut the least important sentence" instruction. |

---

## 3. Three rewrite examples (before → after)

### Rewrite 1 — Compliance disclosure (highest risk)

**Before** (`complianceAI.ts:305`):
```
Generate a comprehensive Seller's Property Disclosure Statement for the
following property:
{propertyContext}
…
Format as a professional legal document.
```
No system prompt. Direct user-message-only call. Deprecated `gpt-4-turbo-preview`.

**After:**
```
SYSTEM:
You are drafting a Seller's Property Disclosure for a real estate
transaction. Output is reviewed by a licensed attorney before any use.
You are NOT providing legal advice, and you must say so on the document.

Scope: produce a draft disclosure document containing only the sections
listed below. Do not invent property facts. If a field in the input is
"Unknown" or missing, write "Not disclosed by seller — verification
recommended." Never substitute a guess.

Jurisdiction: the disclosure must follow the state's statutory format
({state}). If you do not have reliable knowledge of {state}'s
requirements, return:
  {"status": "needs_state_template", "state": "{state}"}
and stop.

Output (strict JSON, no prose):
{
  "status": "drafted" | "needs_state_template" | "insufficient_data",
  "header": { "property_address": str, "state": str, "as_of_date": str },
  "sections": [
    { "title": str, "body": str, "fields_unknown": [str] }
  ],
  "disclaimer": str,           // must include "AI-generated draft —
                               //   attorney review required"
  "missing_required_fields": [str]
}

Refuse to fabricate environmental, structural, or title claims. If asked
to "soften" or omit a known defect listed in the property's compliance
alerts, refuse.

USER:
{property_context}
{compliance_alerts}
{state_required_sections_for_property.state}
```

**Why this is better:**
- Explicit refusal (won't fabricate, won't soften known defects)
- Structured output enforceable as JSON Schema
- State-aware fail-soft (`needs_state_template`) instead of bullshitting
- Mandatory disclaimer section (founder requirement)
- "Not disclosed" placeholder beats hallucinated fact
- System role exists — model doesn't drift to base behavior
- Pairs with a deterministic post-validator (Theo's §8.7) that asserts required sections are present per state

### Rewrite 2 — Support contextual reply

**Before** (`supportBrain.ts:427`): "You are a helpful support agent for AcreOS … Keep responses concise, professional, and helpful." Plus `AI-powered due diligence` in the feature list.

**After (sketch):**
```
SYSTEM: You are Pax, AcreOS's assistant, replying to a support case.
User: {tier} plan, ${balance} credits. Case category: {category}.
Job: resolve or escalate.

Escalate (resolution="escalate") when: billing dispute > $5; account
access (lost 2FA, locked out); reproducible bug; user asks for human.
Otherwise resolve from documented features: CRM, inventory,
note/loan, mail/email/SMS, due diligence, deal pipeline.

Style: plain, no jargon, no emojis, no "happy to assist." Never say
"AI" or "AI-powered." Don't sign — UI shows attribution.

Output JSON: { resolution: "answered"|"needs_info"|"escalate",
reply: str (≤80w), escalation_reason: str? }
```

**Why better:** banned phrase removed from feature list; persona is Pax (matches `agentCodename: "pax"`); hard escalation criteria so the model can refuse instead of spraying apology; typed output lets UI render an Escalate CTA; 80-word cap is enforceable.

### Rewrite 3 — Lead nurturer email

**Before** (`leadNurturer.ts:150`): "You are a professional land investment company representative. Generate a personalized follow-up email … warm but professional, ≤150 words."

**After (sketch):**
```
SYSTEM: You write follow-up emails on behalf of a Land Investor.
Recipient is a {seller|buyer} previously contacted.

Voice: the investor's, not yours. Plain, direct. 7th-grade level.
Never say "AI" / "AI-powered" / "as an AI."

Structure:
  Subject ≤8 words, no clickbait, no caps, no emoji
  Body ≤120 words, three paragraphs:
    1) acknowledge time since last contact
    2) purpose (one sentence)
    3) single specific CTA (call/reply/schedule)
  No signature — system appends.

Refuse: quoting price/terms not in context; promising outcomes
("we can close fast"); urgency manipulation.

If context too thin (no name, no source, no prior contact):
  { status: "skip", reason: "insufficient_context" }

Output: { status, subject?, body?, reason? }
```

**Why better:** explicit voice ownership (no ghost-writer slip); refusal list catches the three nurture failure modes (fabricated terms, false promises, dark patterns); skip path beats forcing a thin email; subject + body capped separately.

---

## 4. The Pax draft pattern — what makes it good, how to spread it

The Pax inbox draft prompt is the codebase's prompt-engineering benchmark. Six properties separate it from the rest:

1. **One verb, one task.** "Draft a reply." Not "draft, refine, send, log." The narrower the scope, the easier the eval.
2. **Concrete style anchors with examples.** Not "warm-professional" alone — *also* "happy to talk through" and "let me look at the parcel and get back to you with specifics." The model has copy to imitate.
3. **Banned phrases enumerated, not implied.** "No 'AI-powered' / 'as an AI' / 'I'd be happy to assist.'" If you have brand voice rules, ship them as banned-phrase lists, not adjectives.
4. **Persona-clean.** Pax. No Sophie. No Atlas. No "AI assistant" identity affirmation.
5. **Output negatively specified.** "Return only the reply body. No subject line, no greeting boilerplate, no signature block." This is enforceable — easier to detect a stray "Subject:" prefix than to verify "warm tone."
6. **Hedge phrases are codified.** When the model doesn't have authority, it doesn't refuse — it deflects gracefully. "Let me look at the parcel and get back to you" is a brilliant escape hatch the prompt provides.

**How to spread:**
- Make `routes-ai-draft.ts:44` the literal template. Every new prompt PR cites it in the description.
- Codify a `prompts/` directory with versioned `.md` files: `pax_draft.v1.md`, `support_reply.v1.md`, `compliance_disclosure.v1.md`. TypeScript imports the markdown at build time. PRs review the prompt as text, not as escaped strings.
- Each prompt file gets a YAML header: `model`, `task_type`, `complexity`, `cache: true`, `refuse_when: [...]`. Eval harness reads the header.

---

## 5. Prompt-engineering doc for the team — 10 rules

Pin this to the repo. Cite by number in PR review.

1. **One verb, one task.** If your prompt has "and" in the role description, split it.
2. **Don't tell the model it's an AI.** Don't tell it not to be a "generic assistant." Don't tell it it's "helpful." Tell it the task and the boundary.
3. **Banned phrases are lists, not adjectives.** "Don't say 'AI-powered'" beats "use natural language."
4. **Output is typed, not described.** Use `response_format: json_schema` (OpenAI) or tool-use (Anthropic) for structured output. JSON-as-prose is a soft request models violate ~1% of the time.
5. **Persona discipline.** Customer-facing: Pax only. Founder-facing: Sophie/Forge/Atlas/etc. The prompt **never names the other side** — even to redirect. Redirect to features ("Support") not personas ("Sophie").
6. **Refusal is taught, not caught.** If the prompt doesn't enumerate what to refuse, the catch-block becomes the refusal — and the model doesn't refuse, it errors. Bad UX, bad audit trail.
7. **Length caps are enforced.** Pair every "≤N words" with either a post-trim or a self-correction instruction ("if over, cut the least important sentence"). Soft caps drift 15–30%.
8. **Context at the depth the task needs.** Classifier needs the playbook list, not the user's MRR. Inbox draft needs the inbound + lead notes, not the org's pipeline. Over-context makes the model confabulate connections.
9. **Prompts live in `prompts/*.md`, not template literals.** Versioned, PR-reviewable, cache-eligible (`>=1024 chars` for OpenAI prompt caching), eval-targetable.
10. **Every prompt has an eval.** Even ten golden examples beats none. PR that changes a prompt without re-running its eval doesn't merge.

(Bonus rule: **don't apologize in fallback strings.** "I apologize, I had trouble generating a response" is the model's voice leaking through your error path. Use plain language: "Couldn't generate a response — try again or contact support.")

---

## 6. Sprint — top 5 prompts to rewrite first

Ordered by *blast radius × ease of fix*.

1. **Compliance disclosure** (`server/services/complianceAI.ts:303`) — 1.5 days. Highest legal risk, no system prompt today. Apply Rewrite 1 above. Move to Opus 4.6 with extended thinking. Pair with deterministic post-validator that asserts required sections per state. **Stop shipping `gpt-4-turbo-preview` for legal artifacts immediately.**

2. **Pax executive chat** (`server/ai/executive.ts:326`) — 1 day. Highest customer touch. (a) Delete "AI-powered" from `description` line 325. (b) Replace "Sophie (Support section)" with just "Support" — no persona leak. (c) Cut the prompt to ~25% length per Theo's §3.B rewrite. (d) Move to `prompts/pax_executive.v3.md`. (e) Enable prompt caching. (f) Add explicit refusal block (legal/tax → attorney/CPA review; destructive tool calls → confirm first).

3. **Support contextual reply** (`server/services/supportBrain.ts:427`) — 0.5 day. Apply Rewrite 2 above. Removes the banned phrase ("AI-powered due diligence") from the model's feature list. Adds typed escalation. Single highest-velocity fix.

4. **Lead nurturer email** (`server/services/leadNurturer.ts:150`) — 0.5 day. Apply Rewrite 3 above. The prompt currently lets the model invent terms; the rewrite forbids it explicitly and adds a `skip` path. Critical because this email auto-sends in some flows — hallucinated specifics broadcast to real sellers.

5. **Board of Directors vote** (`server/services/aiBoardOfDirectors.ts:250`) — 0.5 day. (a) Stop telling agents their domain weight (it leaks the mechanism — domain weighting belongs in the tally function, not the prompt). (b) Feed each agent the actual data their domain owns (KPIs, recent decisions) — voting on vibes is theater. (c) Enforce JSON Schema with one retry on parse failure rather than silent abstain. Cheap; turns governance theater into governance signal.

**Total sprint:** ~4 engineer-days. Pairs with Theo's eval-harness sprint (3 days) — eval lands first, prompt rewrites land against it, regressions caught immediately.

---

## File:line index

- `server/routes-ai-draft.ts:44` — Pax inbox draft (gold standard)
- `server/ai/executive.ts:325` — "AI-powered" string in agent description (UI-visible)
- `server/ai/executive.ts:326` — Pax executive chat system prompt (too long, identity-leaky)
- `server/ai/executive.ts:339` — "Sophie" referenced to customer (persona violation)
- `server/services/supportBrain.ts:49` — support classifier (good shape, JSON Schema would tighten)
- `server/services/supportBrain.ts:427` — support contextual reply (generic + banned phrase)
- `server/services/supportBrain.ts:440` — banned phrase "AI-powered due diligence" in feature list
- `server/services/leadNurturer.ts:150` — generic preamble, no refusal frame
- `server/services/aiTutor.ts:78` — "expert tutor" generic preamble; deprecated model
- `server/services/aiTutor.ts:130` — "I apologize" fallback string (voice leak)
- `server/services/aiBriefingWriter.ts:74` — agent briefing (defensible — terse, scoped)
- `server/services/aiBriefingWriter.ts:126` — headline insight (template-fit candidate)
- `server/services/aiBoardOfDirectors.ts:250` — vote prompt (mechanism leak, no data)
- `server/services/complianceAI.ts:303` — disclosure generation (no system prompt, highest risk)
- `server/services/selfAssessmentAgent.ts:135` — JSON-only with fence-strip post-process (correct pattern)

---

**Bottom line for the founder:** You wrote one excellent prompt and 40 mediocre ones. The good news: the excellent one is on the customer-facing surface, so the worst public-facing damage is contained. The bad news: the worst prompt in the codebase generates legal documents. Spend four days replacing the top five system prompts and you'll have a codebase whose model output you can stand behind — instead of one whose output you have to apologize for in catch blocks.
