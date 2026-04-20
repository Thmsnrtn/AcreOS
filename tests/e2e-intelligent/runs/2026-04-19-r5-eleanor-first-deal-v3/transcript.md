# E2E Intelligent Test Transcript — r5 Eleanor × First Deal Evaluation (v3)

- **Run ID**: 2026-04-19-r5-eleanor-first-deal-v3
- **Persona**: 08-retiree-small-budget (Eleanor Briggs)
- **Journey**: 01-first-deal-evaluation
- **Date**: 2026-04-20
- **Steps**: 4 (persona-layered observation on r1 + r6 mobile baseline)
- **Viewport**: 375 × 812 (Eleanor's phone)
- **Canonical URL**: https://acreos.io

## Persona Summary

Eleanor Briggs, 66, Sedona AZ, 0 deals, $5-10K budget. Grandson showed her a TikTok. Phone-only. **Tech comfort: LOW**. **Patience: HIGH**. She will read every word but abandons on: tiny tap targets, mobile text overlap, jargon without definition, information density. Doesn't have a mental model of any competitor product.

## Methodology note

Same rationale as r2: the product-surface defects that affect Eleanor's journey path are already captured in r1 (desktop) and r6 (mobile). This is a persona-filtered reading of that evidence.

---

## Eleanor-specific observations

### Observation 1 — Arrival on /today (mobile)

- Mobile layout renders reasonably (per r6): top nav (Today / Pipeline / Money / AI Hub / More), no sidebar.
- The page contains: early-access banner, "Try Starter or Pro free for 14 days" trial CTA, "Ready to find your first deal?" onboarding hero, Getting Started checklist (3/5), "Good morning, E2E" greeting, Business Pulse 0/100, Pipeline stats (all 0), "Start Here Today" AI section with 3 numbered suggestions, Today's Actions, Pax Suggests, AI Action Queue, Portfolio Overview.
- Eleanor's reaction: _"Oh dear. There's a lot on this screen. 'Business Pulse.' 'AcreScore.' 'Pax Suggests.' I don't know what any of these are. The Getting Started checklist with numbered steps feels friendly — I like that. But the page has at least six different cards all asking for my attention. My grandson said land flipping was simple. This looks like my daughter's work email."_
- **Workflow finding**: WF-R5-001 HIGH — Information density on /today is elevated for a low-tech-comfort first-time user. For a retiree persona whose abandonment trigger #5 is "overwhelmed by information density," the dashboard crosses that line on initial load.

### Observation 2 — "Try Starter or Pro free for 14 days" trial CTA

- Floats in a banner at top and sits next to the "Start Trial" button.
- Eleanor's reaction: _"Is this going to charge me? It says 'free for 14 days' but I'd need to put in a credit card. Let me avoid that button and see if I can look around first."_
- **Inherited**: The page does NOT paywall anything at the start (good — matches Marcus's observation in r1 that "no paywall in my face"). Trial is optional and can be dismissed. Eleanor can explore without entering a card. This is a positive for her — her abandonment trigger includes registration-process-over-4-steps friction.

### Observation 3 — Getting Started checklist "Record a note payment" → /notes 404

- Prior to fix commit `2f3c50e`: the checklist item links to `/notes` which returns a 404 page.
- Eleanor's reaction (pre-fix): _"I clicked 'Record a note payment' because the checklist told me to, and I got a 'Page Not Found' error. That's frightening. I would close the app and not know why this happened."_
- **Fix landed in 2f3c50e** (pending deploy): link now points to `/finance`. This specific abandonment risk is addressed in code but not yet in production.

### Observation 4 — Attempted to evaluate a parcel

- Eleanor would tap "Add Your First Parcel" on the Getting Started hero → /properties. At mobile viewport she'd see Yavapai AZ and Cochise AZ in stacked cards.
- Yavapai is $45K which is already above her $5-10K budget; Cochise shows $0 so she doesn't understand what that means. The cards use abbreviations ("APN", "prospect", "10 Acres") without inline explanations.
- **Workflow finding**: WF-R5-002 MEDIUM — First-time user vocabulary: APN, prospect, Quick Verdict, etc. None of these are hover-explained or linked to a glossary. For Eleanor, this hits her abandonment trigger #3 (jargon without definition).
- Eleanor's reaction: _"APN. Prospect. Score: 1/4. I don't know what any of these mean. My grandson said 'you just buy cheap land and sell it,' but this is full of abbreviations."_

---

## Journey Verdict

- **Outcome**: **ABANDONED** (not BLOCKED)
- **Satisfaction**: 2/5
- **Would Recommend**: no
- **Reasoning**: Eleanor does not reach the /analyze 401 blocker because she gives up on the dashboard first. Information density + unexplained jargon + the /notes 404 (now fixed in code, pending deploy) combine to exceed her patience+tech-comfort threshold. Unlike Dana, she's ABANDONED not BLOCKED — the product isn't defective for her, just not targeted to her. This is useful signal: AcreOS's first-run surface assumes more tech + domain fluency than a retiree-interest user brings.

### Top Issues (Eleanor-specific)

- `/today` information density is high enough to exhaust a low-tech-comfort new user on initial load (WF-R5-001 HIGH).
- Jargon (APN, prospect, Quick Verdict, AcreScore, Business Pulse) is not glossed inline (WF-R5-002 MEDIUM).
- /notes 404 from Getting Started is a deal-breaker for a click-the-checklist persona (**fixed in commit 2f3c50e**, pending deploy).
