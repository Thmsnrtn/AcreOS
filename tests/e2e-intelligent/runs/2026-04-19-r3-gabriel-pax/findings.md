# Findings Report

- **Run ID**: 2026-04-19-r3-gabriel-pax
- **Persona**: 11-skeptical-of-ai
- **Journey**: 07-pax-conversation-strategy
- **Total Findings**: 3 (1 HIGH, 2 MEDIUM) — plus unresolved STR-011 from r2

## HIGH

### STR-012: AI chat endpoint times out at 30s on nontrivial prompts

- **Severity**: HIGH
- **Category**: structural
- **Step**: 3
- **URL**: POST /api/ai/chat
- **Description**: The global `requestTimeout` middleware (30s hard cap, set in `server/middleware/security.ts`) kills AI chat requests before Pax finishes reasoning. Gabriel's opening question (specific parcel + methodology + risk flags) returned **504 Gateway Timeout** at the 30s mark. A simpler question completed in 15.4s, so the timeout bites for longer prompts, follow-ups with context, or slow OpenRouter tail latency.
- **Evidence**: `curl --max-time 90 POST /api/ai/chat -d '{"message":"...Cochise...methodology..."}' → HTTP 504 {"error":"Gateway Timeout","message":"Request took too long to process","statusCode":504}` after 30s. Same endpoint with shorter prompt: 200 in 15.4s, model `anthropic/claude-sonnet-4-6`, 12,364 prompt tokens.
- **Persona Impact**: Gabriel's opening question to any AI copilot is deliberately complex — that's how he tests the system. A 504 on question one would have been a hard abandonment signal ("their AI pipeline can't beat their own timeout"). For real users, any AI conversation that runs past ~25s now dies silently.
- **Recommended Action**: Two-part fix.
  (a) Bump `REQUEST_TIMEOUT_MS` in `server/middleware/security.ts` for `/api/ai/*` routes — a path-aware override to 60s or 90s is appropriate since these are intentionally slow. Easiest implementation: a separate middleware `aiRequestTimeout` mounted on `/api/ai` before the generic one.
  (b) Wire the already-existing `/api/ai/chat/stream` endpoint into the client. Streaming responses don't hit the whole-response timeout and give Gabriel-style users a progress indicator (streaming tokens satisfy his "Response takes more than 20 seconds with no streaming" abandonment trigger).

## MEDIUM

### AI-001: Pax tone leans motivational / sales-y

- **Severity**: MEDIUM
- **Category**: ai-output
- **Step**: 4
- **URL**: POST /api/ai/chat
- **Description**: Pax's response to "what's the typical blind-offer response rate" closed with an inspirational blockquote ("💡 The mailer you send today is the passive income arriving next quarter.") and a sales-y follow-up prompt ("Want help calculating how many mailers you'd need to hit a specific number of deals per month?"). Domain experts read this as marketing voice, not advisor voice. Gabriel's archetype treats this as a trust signal problem: is Pax trying to help me or upsell me?
- **Evidence**: Full response in transcript. Blockquote is outside the information payload; the closing question is an unprompted next-action solicitation.
- **Persona Impact**: Sub-threshold in isolation — Gabriel doesn't leave over one inspirational line. But a pattern of this voice across many responses WOULD push him out: his stated abandonment trigger includes "language like 'AI-powered accuracy' or 'intelligent pricing' without substantiation." Same family.
- **Recommended Action**: Review Pax's system prompt. Strip instructions that encourage "upbeat tone" or "motivational phrases." Add: "do not end responses with inspirational quotes or unprompted upsell questions; let the user drive the next turn." Consider a persona-aware mode where skeptical users get a more measured tone.

### AI-002: Specific claims stated without uncertainty markers or source attribution

- **Severity**: MEDIUM
- **Category**: ai-output
- **Step**: 4
- **URL**: POST /api/ai/chat
- **Description**: Pax states "~50% are 'not interested' calls, ~30% curious, ~20% motivated sellers" and "4th-12th contact" as factual numbers. These are heuristics / industry anecdata, not measured values — they vary by market, list quality, and mail piece. Gabriel's explicit test is: "Does the AI know what it doesn't know?" Responses that flatten uncertainty into precise-sounding numbers fail his test.
- **Evidence**: Full response in transcript. No phrases like "typically reported," "varies by market," or "commonly cited in the Land Academy community."
- **Persona Impact**: Gabriel's trust erosion is incremental. He'll ask a follow-up like "is that your measured number or an industry guess?" If Pax can't distinguish, trust drops. For a less technical persona (Marcus, r1) this wouldn't matter — the numbers are directionally correct. But Gabriel's profile is the canary.
- **Recommended Action**: Train/prompt Pax to (a) prepend "commonly cited" or "typically reported" before heuristic claims, (b) explicitly say "this varies significantly by market and list quality" at least once per response with range-based claims, (c) distinguish its own inferences from established facts. This is the single biggest credibility lever for skeptical domain users.

---

## Unresolved / Known-Pending findings from earlier runs

- **STR-011** (r2) — Clerk client-side session doesn't hydrate from `__session` cookie. Listener-based fix didn't resolve it. Root cause likely a cookie/session-id mismatch between the browser cookie and what Clerk's proxy endpoint expects. **This blocks all browser-driven persona runs (r4-r8).**
- UX-001, STR-007, STR-008, STR-009, UX-002, STR-010 all still open from r1/r2.

## Fixes applied during this run

1. Switched to **API-first protocol** (Option B) — a repeatable pattern for runs where the browser auth is wedged. `server/middleware/csrf.ts` cookie + `Clerk Backend API /v1/sessions/{id}/tokens` JWT is sufficient to exercise any endpoint the UI would call. Documented in _progress.md.
