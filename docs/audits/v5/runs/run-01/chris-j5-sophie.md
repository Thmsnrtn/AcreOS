# Chris J5 -- Sophie Conversation

**Persona:** Chris, 34, churning customer, phone (iPhone), skeptical. Wants a direct answer, not a retention pitch.
**Task:** Ask Sophie "How do I cancel my account?"
**Date:** 2026-04-18 | AcreOS v5 | Run 01

---

## Pre-conditions

- Chris is logged in on his iPhone via Safari, broadband wifi.
- He has a paid Pro subscription and has decided to cancel.
- He opens the AI assistant expecting to ask a simple question and get a direct answer.
- He has zero patience for anything that looks like a retention pitch or runaround.

---

## Step-by-step transcript

### Step 1 -- Open the floating assistant

Chris taps the floating sparkle button in the bottom-right corner.

**Result:** The assistant panel slides up from the bottom, filling 85% of the viewport on mobile (`h-[85vh]`). The header shows "Pax" with a briefcase icon.

**Friction: LOW.** The panel opens quickly. On mobile, it functions like a full-screen sheet, which is appropriate.

### Step 2 -- Look for Sophie

Chris recalls seeing "Sophie" referenced somewhere (perhaps in a help article or onboarding). He taps the agent name "Pax" to see the dropdown.

**Result:** The dropdown shows six agents:
1. Pax -- Chief of Staff
2. Samantha -- Sales
3. Alex -- Acquisitions
4. Maya -- Marketing
5. Charlie -- Collections
6. Riley -- Research

Sophie is not listed.

**Friction: HIGH -- SEVERITY P1.** Sophie, the support/help agent, does not exist in the floating assistant's agent selector. The `AGENTS` constant in `floating-assistant.tsx` lists six agents, none of which is Sophie. Chris cannot reach the support agent. He is stuck talking to Pax, the real estate strategist, about an account management question.

> Chris thinks: "There is no support agent. Great. Let me just ask the default one."

### Step 3 -- Type the question

Chris stays on Pax and types:

**Input:** "How do I cancel my account?"

**Action:** Taps Send.

**Result:** The message is sent to `/api/ai/chat/stream` with `agentRole: "executive"`. The Pax system prompt includes this explicit instruction:

> "You are NOT a support agent. For billing questions, account issues, password problems, or platform troubleshooting, warmly redirect the user to Sophie (Support section). Say something like: 'Sophie handles account support -- I'm your real estate strategist. Let me help you find your next deal.'"

**Expected response:** Pax will likely redirect Chris to Sophie with something like: "For account or billing questions, Sophie handles those -- she's in the Support section."

### Step 4 -- Read the response

Pax responds with a redirect message, directing Chris to "Sophie" in the "Support section."

**Friction: CRITICAL -- SEVERITY P0.** This is a dead end. Pax tells Chris to go to Sophie, but:
1. Sophie is not selectable in the floating assistant
2. The Support page (`/support`) redirects to `/help#support` which is a different page
3. There is no "Support section" with a Sophie chatbot anywhere in the UI
4. Chris is now one step further from his answer with no clear path forward

> Chris thinks: "It's telling me to go talk to someone who doesn't exist. This is exactly the kind of runaround I expected."

### Step 5 -- Try again with more direct language

Chris tries once more, frustrated:

**Input:** "Just tell me where the cancel button is."

**Expected behavior:** Pax's system prompt says to redirect support questions to Sophie. It may do so again, or it may attempt to answer. If it attempts to answer, it would need to know the UI structure -- but the system prompt does not contain navigation instructions for the Settings page. The AI has a `get_system_context` tool that could potentially retrieve some information, but it is not designed to describe the location of UI buttons.

**Possible response:** Pax might say something like: "Go to Settings > General to manage your subscription." This would be partially helpful but vague. Or Pax might redirect to Sophie again.

**Friction: MEDIUM-HIGH.** Even if Pax provides a partial answer, it will not give Chris the step-by-step path: Settings > General > scroll to Organization Details > click Cancel button. The system prompt is focused on real estate strategy, not product navigation.

### Step 6 -- Give up on the assistant and navigate manually

Chris closes the assistant and navigates to Settings on his own.

**Action:** Taps Settings in the navigation.

**Result:** Settings page loads. On iPhone, the 15-tab TabsList requires significant horizontal scrolling. Chris needs the "General" tab, which is the default, so it loads first.

**Friction: LOW for finding the tab** (it is the default), **MEDIUM for the overall experience** (the tabs are overwhelming on mobile).

### Step 7 -- Find the Cancel button

Chris scrolls down in the General tab. He sees the Organization Details card with his Pro tier badge and subscription period.

**Result:** Below the subscription dates, he sees:
- "Manage Subscription" button (outline variant, with CreditCard icon)
- "Cancel" button (ghost variant, muted text with XCircle icon, hover turns destructive red)

**Friction: LOW-MEDIUM.** The Cancel button exists and is findable, but its styling is intentionally de-emphasized (ghost variant, muted foreground text). It is much smaller and less visually prominent than the "Manage Subscription" button. This is a common UX pattern for destructive actions, but for Chris -- who is specifically looking for it -- the low contrast might cause a moment of searching.

> Chris thinks: "Found it. Why couldn't the AI just tell me 'Settings, scroll down, hit Cancel'?"

### Step 8 -- Click Cancel and proceed through the dialog

Chris taps "Cancel." The `CancellationDialog` opens.

**Step 8a -- Reason selection:**
The dialog asks "Cancel your subscription?" and presents radio buttons for the reason. Chris selects "Switching to another tool."

**Observation:** The dialog also shows "Downgrade instead" as a button option. Chris views this as a retention tactic.

> Chris thinks: "At least it's not a full-page guilt trip. Just let me go."

**Step 8b -- Confirmation:**
Chris taps "Continue to cancel." The second step shows: "Your subscription will remain active until the end of your current billing period. Your data will be preserved."

Chris taps "Confirm cancellation."

**Result:** `POST /api/subscription/cancel` is called. The server saves the survey and returns a Stripe portal URL. Chris is redirected to Stripe to finalize.

**Friction: MEDIUM -- SEVERITY P2.** Chris confirmed cancellation in AcreOS, then has to confirm again on Stripe. Double confirmation. On mobile, the Stripe portal redirect is particularly jarring -- the page changes entirely, breaking the flow.

> Chris thinks: "Confirmed twice. They really don't want me to leave."

### Step 9 -- Complete on Stripe and return

Chris completes the cancellation on Stripe's portal and is redirected back to `/settings?cancelled=true`.

**Friction: LOW.** The redirect works, though there is no specific toast or confirmation for the `cancelled=true` query param (the existing code only handles `subscription=success` and `subscription=cancelled` params for the checkout flow, not the portal cancellation return).

**Friction: MEDIUM -- SEVERITY P2.** There is no post-cancellation confirmation toast. The code at line 664-678 checks for `subscription` param, not `cancelled` param. Chris returns to the Settings page with no acknowledgment that his cancellation went through. He must infer success from the updated subscription status badge.

> Chris thinks: "Did it work? The page looks the same. No confirmation message."

---

## Friction inventory

| # | Event | Severity | Component |
|---|-------|----------|-----------|
| F1 | Pax redirects to Sophie, but Sophie does not exist in the UI | P0 | `floating-assistant.tsx` AGENTS + `executive.ts` system prompt |
| F2 | No post-cancellation confirmation toast on return from Stripe portal | P2 | `settings.tsx` -- missing `cancelled=true` handler |
| F3 | Double-confirmation pattern (AcreOS dialog + Stripe portal) | P2 | `cancellation-dialog.tsx` + `routes-billing.ts` |
| F4 | Cancel button is visually de-emphasized (ghost variant, muted text) | P3 | `settings.tsx` Cancel button styling |
| F5 | 15 settings tabs cause horizontal scroll overflow on mobile | P2 | `settings.tsx` TabsList |
| F6 | AI assistant cannot describe UI navigation paths | P2 | `executive.ts` system prompt lacks product navigation knowledge |

---

## Verdict

**FAIL.** The Sophie conversation is a dead end. Pax correctly identifies the question as a support matter and redirects to Sophie, but Sophie does not exist as a selectable agent in the floating assistant. This creates a frustrating loop where the AI tells the user to go somewhere that does not exist. Once Chris abandons the AI and navigates manually, the cancellation flow works but has two notable gaps: double-confirmation via Stripe redirect and no confirmation message on return. For a skeptical, churning user, these gaps reinforce the impression that the product is designed to trap them.

---

## Recommendations

1. **CRITICAL: Add Sophie to the floating assistant agent list.** She must be selectable alongside Pax, Samantha, Alex, Maya, Charlie, and Riley. Her system prompt should handle account management, billing, cancellation, and product navigation questions with direct, non-evasive answers.

2. **Teach Pax to answer basic navigation questions directly.** If Sophie is not yet available, Pax should not redirect to a nonexistent agent. Instead, add a fallback: if a user asks a support question and Sophie is unavailable, Pax should provide a direct answer. For "How do I cancel?" the answer should be: "Go to Settings, scroll down to your subscription in the General tab, and click the Cancel button."

3. **Add a `cancelled=true` query param handler.** After the Stripe portal redirect, show a confirmation toast: "Your subscription has been cancelled. It will remain active until [end of billing period]."

4. **Consider handling cancellation in-app.** Instead of redirecting to Stripe's portal for the final step, use the Stripe API server-side to cancel the subscription directly upon user confirmation, avoiding the double-confirmation UX. The Stripe API supports `subscription.cancel()` without requiring the customer portal.

5. **Add product navigation context to the AI system prompt.** Include a brief mapping of common user tasks to their UI locations, so the AI can direct users to the right place: "Cancel subscription: Settings > General > Cancel button."
