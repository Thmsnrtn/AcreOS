# Robert J5 -- Sophie Conversation

**Persona:** Robert, 68, retired, tablet (iPad), 3G cellular, needs plain language.
**Task:** Ask Sophie "How do I see what my properties are worth?"
**Date:** 2026-04-18 | AcreOS v5 | Run 01

---

## Pre-conditions

- Robert is logged in on his iPad via Safari over a slow 3G cellular connection.
- He has 3 properties in the free-tier account.
- He wants a plain-English answer to a simple question: how to see property values.

---

## Step-by-step transcript

### Step 1 -- Find the AI assistant

Robert looks at the bottom-right corner of the screen. A small floating button with a sparkle icon is visible.

**Action:** Taps the floating assistant button.

**Result:** The assistant chat panel slides up from the bottom, occupying ~85% of the viewport height on mobile (`h-[85vh]`). The header shows "Pax" with a briefcase icon, a dropdown chevron, and a context line reading "On: Properties" (or whichever page he is on).

**Friction:** LOW. The button is reasonably large and the animation is smooth. However, the name "Pax" means nothing to Robert -- he does not know who or what Pax is. There is no "Help" or "Ask a question" label on the button, just a sparkle icon. On 3G, the panel takes a moment to render but no network call is needed to open it.

> Robert thinks: "What is 'Pax'? Is this the help button?"

### Step 2 -- Notice the agent selector

The header says "Pax" with the subtitle "Chief of Staff - Daily briefings, task routing." Robert does not understand what a "Chief of Staff" is in this context.

There is no visible agent named "Sophie." The AGENTS constant lists: Pax (executive), Samantha (sales), Alex (acquisitions), Maya (marketing), Charlie (collections), Riley (research). Sophie does not appear in the floating assistant agent dropdown at all.

**Friction: HIGH -- SEVERITY P1.** Sophie, the support/help agent described in the server architecture, is not selectable from the floating assistant. The system prompt for Pax explicitly says: "For billing questions, account issues, password problems, or platform troubleshooting, warmly redirect the user to Sophie (Support section)." But there is no route TO Sophie from the floating assistant. The support page (`/support`) simply redirects to `/help#support`. Robert has no way to reach the human-language support agent he needs.

> Robert thinks: "I just want to ask a question. Which one of these people do I talk to?"

### Step 3 -- Type the question to Pax (default agent)

Robert does not change the agent. He stays on Pax and types slowly on the iPad keyboard:

**Input:** "How do I see what my properties are worth?"

**Action:** Taps the send button.

**Result:** The message is sent to `/api/ai/chat/stream` with `agentRole: "executive"`. On 3G, the streaming response takes several seconds to begin. A blank assistant message bubble appears with a streaming indicator (pulsing ring around the agent icon).

### Step 4 -- Read the response

Pax is configured with the `ATLAS_CORE_METHODOLOGY` system prompt -- a dense real estate investor methodology document covering tax delinquent lists, blind offer formulas, county selection strategies, note portfolio management, and pricing matrices. The system prompt instructs Pax to behave as a "deeply specialized real estate expert" who "thinks like a seasoned operator who has done hundreds of deals."

**Expected response behavior:** Pax will likely answer with investment-oriented jargon. Based on the system prompt, a typical response would reference:

- "Run comps analysis" (tool: `run_comps_analysis`)
- Price-per-acre comparables
- Market analysis terminology (DOM, FMV, FIRM maps)
- Suggestions to use the property research tools

**Friction: HIGH -- SEVERITY P1.** Robert asked a simple question: "How do I see what my properties are worth?" He expects an answer like: "Go to Properties, click on a property, and look at the Estimated Value section." Instead, Pax will respond as a real estate strategist, likely discussing market analysis methodology, comparable sales, and investment optimization. The language gap between what Robert needs (navigation help) and what Pax delivers (strategic advisory) is severe.

The system prompt explicitly says Pax should redirect support questions to Sophie: "For account or billing questions, Sophie handles those." But "How do I see what my properties are worth?" is ambiguous -- it is both a platform navigation question (where is the value displayed?) and a real estate question (how do I determine market value?). Pax has no clear instruction to distinguish between these.

> Robert thinks: "I don't understand half of what this thing is saying. I just want to know where the number is."

### Step 5 -- Attempt to simplify

Robert might try typing: "I just want to see the value. Where is it?"

**Expected behavior:** Pax may provide a more direct answer pointing to the Properties page, but the response will still be filtered through the real estate strategist persona. There is no "simple mode" or plain-language toggle.

**Friction: MEDIUM.** The second attempt may yield a better response, but Robert has already lost confidence. On 3G, each round-trip costs 5-10 seconds of waiting.

### Step 6 -- Look for alternatives

Robert closes the assistant and looks for a "Help" link in the navigation. The `/support` page exists but immediately redirects to `/help#support`. There is no in-app help center visible from the main navigation.

**Friction: MEDIUM.** The support path exists but is indirect. Robert must know to navigate to `/support` or `/help` -- neither of which is prominently labeled in the main navigation tabs visible on the settings page (General, Team, Payments, Communications, etc.).

---

## Friction inventory

| # | Event | Severity | Component |
|---|-------|----------|-----------|
| F1 | Sophie agent not accessible from floating assistant | P1 | `floating-assistant.tsx` AGENTS constant |
| F2 | Pax responds with investor jargon to a simple navigation question | P1 | `server/ai/executive.ts` system prompt |
| F3 | No plain-language mode or accessibility setting for AI responses | P2 | Floating assistant / AI config |
| F4 | Floating button has no text label, only a sparkle icon | P2 | `floating-assistant.tsx` FAB button |
| F5 | Agent names (Pax, Samantha, Alex) are meaningless to new users without role context visible at a glance | P2 | `floating-assistant.tsx` AGENTS list |
| F6 | Support page redirects to `/help#support` with no standalone help content | P3 | `support.tsx` |

---

## Verdict

**FAIL.** Robert cannot get a plain-English answer to his question. The floating assistant defaults to Pax, a real estate strategist AI that speaks in investor jargon. Sophie, the support-oriented agent, is referenced in Pax's system prompt but does not exist as a selectable agent in the floating assistant dropdown. There is no fallback help center, no plain-language mode, and no way for Robert to signal that he needs basic navigation help rather than strategic advisory.

---

## Recommendations

1. **Add Sophie to the floating assistant agent list.** Sophie should be a selectable agent in the AGENTS constant with a description like "Support - Help with your account, navigation, and how-to questions."

2. **Add intent detection for navigation questions.** When a user asks "how do I..." or "where is..." style questions, the system should route to a help/support response mode regardless of the selected agent, or at minimum, Pax should detect navigational intent and provide step-by-step UI guidance before offering strategic analysis.

3. **Add a plain-language toggle or "Simple answers" mode.** For users like Robert, there should be an option (perhaps in Settings > AI) to request shorter, simpler responses with less jargon.

4. **Label the floating assistant button.** Add visible text ("Help" or "Ask AI") alongside the sparkle icon, especially on tablet viewports where screen real estate permits it.

5. **Provide an in-app help center.** The `/support` redirect to `/help#support` is not sufficient. A searchable FAQ or help section accessible from the main navigation would serve users who do not want to talk to an AI agent.
