# Findings Report

- **Run ID**: 2026-04-19-r3-gabriel-pax-v3
- **Persona**: 11-skeptical-of-ai (Gabriel Ross)
- **Journey**: 07-pax-conversation-strategy
- **Total Findings**: 3

## CRITICAL

### STR-R3-002: Pax conversational endpoint rate-limits first prompt, no recovery path

- **Severity**: CRITICAL
- **Category**: structural
- **Step**: 4
- **URL**: https://acreos.io/ai
- **Description**: A fresh, ticket-authenticated session submitted a single strategic-question prompt to the right-panel Pax chat. Response rendered only "Rate limit reached. Please try again shortly." with no retry button, no timeline, no alternate path, no streamed tool-call progress.
- **Evidence**: Panel DOM text ends with exact string "Rate limit reached. Please try again shortly." immediately after the user prompt. Cross-referenced with r1 where Pax second-message produced "Something went wrong. Please try again." — same underlying pattern, different error surface.
- **Persona Impact**: Gabriel's journey cannot advance. His abandonment triggers explicitly include AI that resists being useful; a rate-limit message with zero recovery affordance meets that bar in the first second of interaction.
- **Recommended Action**: Two fixes. (1) Surface the actual rate-limit provenance (OpenRouter? AcreOS tier cap? token-bucket exhaustion?) and a retry-after timestamp. Add a "Retry" button inline. (2) Investigate why a fresh session gets rate-limited on the first message — most likely the user/session token bucket is shared across test runs within the org and not reset per session, OR the upstream LLM provider is throttling at the app-key level after prior heavy use. If the latter, the product needs a secondary provider fallback.

## MEDIUM

### UX-R3-001: /ai page presents two competing AI chat UIs without differentiation

- **Severity**: MEDIUM
- **Category**: ux-coherence
- **Step**: 2
- **URL**: https://acreos.io/ai
- **Description**: The AI Hub page renders an "AcreOS Assistant" chat card in the main panel AND an open "Pax" right-side-panel simultaneously. Both are chat UIs. No label or docs explain which is which, what they share (history? context?), or which to use for which question.
- **Evidence**: DOM inspection shows distinct components; main panel offers example prompts ("Analyze a property / Check environmental risks / Get market analysis"), side panel offers "Quick actions" ("What can you do? / Quick briefing").
- **Persona Impact**: Onboarding friction. A skeptical user sees this and concludes the product hasn't decided what its own AI is. Gabriel explicitly dislikes products that feel unserious.
- **Recommended Action**: Consolidate to a single Pax interface on /ai, or clearly delineate — e.g., main panel is an "agents/automation" launcher while the side panel is interactive chat. The right-side panel is already available on every page, so the main-area chat on /ai may be vestigial.

### STR-R3-001: Stale "Rate Limited" toast on fresh session load

- **Severity**: MEDIUM
- **Category**: structural
- **Step**: 2
- **URL**: https://acreos.io/ai
- **Description**: On initial navigation to /ai, a toast in the upper-right region reads "Rate Limited — Too many requests. Please wait a moment and try again." The toast is present before the persona has submitted any input.
- **Evidence**: Toast observed in first accessibility-tree snapshot of /ai after fresh sign-in.
- **Persona Impact**: Negative first-impression. A warning about rate-limiting before any action suggests the product is over capacity, or that warning state is leaking across sessions/tabs.
- **Recommended Action**: Clear toast state on navigation/login. Investigate whether the rate-limit toast is firing from a background request (e.g., insights preload) or whether a prior tab's toast is persisting via local storage.
