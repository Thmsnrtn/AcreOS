# The AcreOS design north star — refined user & founder experience

_Founder-commissioned, 2026-07-15. An eagle-eye pass: benchmark best-in-class
B2B surfaces, then define what AcreOS's most refined user experience and
founder-via-Solene experience should be. Companion to `home-base-reshape.md`
(what each surface is) and `cohesive-os.md` (how the surfaces become one). The
nav discipline is law throughout: 5 customer doors / minimal founder doors —
every idea below lives BEHIND a door, never as a new one._

## The one feeling to design for

**User:** _"I connected my own tools in five minutes, and a calm assistant now
runs the busywork while I stay in control of every dollar and every rail."_

**Founder:** _"I read The Letter over coffee, make 0–3 decisions, and the
business ran itself. The doors I never open are the proof it's working."_

Both are the same principle from two sides — the reshape's _"the customer owns
the thing that carries the risk, and we make owning it delightful."_ The
design expression of that principle, running through every surface below, is a
four-part rule:

> **Show the work · preview the spend · ask before touching the user's own
> rails · report in outcomes.**

## What the best platforms do that AcreOS should steal

Distilled from Shopify, Linear, Notion, Superhuman, Front, Ramp, Mercury,
n8n, Zapier, Intercom Fin, Sierra, Stripe, Vercel. Each pattern is tagged to
the AcreOS surface it belongs behind.

- **Auto-completing setup, capped at 5 steps (Shopify).** Onboarding is a
  Today-door card whose steps complete from _real connection state_ — you
  don't tick a box, connecting your email marks it done. Collapses to a thin
  "3/5" strip once dismissed. Never a modal you can't leave. → **Today +
  Connectors.**
- **One command palette = navigation + Pax, shortcut on every row (Linear /
  Superhuman).** Cmd-K does "go to Finance" _and_ "send offer to 14 Oak" in
  the same box. This is how you keep exactly 5 doors while making every action
  one keystroke — and it's the most natural Pax entry point. → **All doors +
  Pax.**
- **Optimistic everything (Linear).** Assign a lead, mark a deal, log a call —
  reflect instantly, reconcile silently. Perceived speed is the biggest
  "Jobs-would-ship-it" lever there is. → **Every mutation.**
- **`@`-mention objects everywhere + auto "Mentioned in" rails (Notion).**
  `@14 Oak St`, `@John Seller`, `@Deal #204` are mentionable in inbox replies,
  team chat, and Pax prompts; every parcel/deal page grows a self-building
  activity timeline. Turns siloed doors into one connected brain. → **Inbox,
  Deals, Map, chat, Pax.**
- **Split inbox lanes + one-line auto-summaries + in-voice instant reply
  (Superhuman / Front).** Lanes keyed to AcreOS objects — _Seller replies ·
  Buyers · Signatures · Money · Everything else_ — not folders. A Pax-written
  one-liner above every thread so 40 threads triage without opening. For
  teams: assignment + collision detection + on-thread internal comments (no
  more "FYI" forwards to Slack). → **Inbox door + team chat.**
- **One hero truth + every number drills to its transactions + a single
  Approvals inbox (Ramp / Mercury).** Finance opens on cash + committed
  credits + "at this burn, credits last N days." No dead-end charts. One place
  for anything that spends the user's own rails/credits, each with a
  recommendation and one-key approve. → **Finance door + Founder backend.**
- **Dry-run is a first-class button; rules are plain-English chips; guardrails
  are visible objects (n8n / Zapier).** Before any automation goes live: _"Pax
  will send 12 offers, spend ~$X in Lob credits, and text 8 sellers from YOUR
  Twilio number"_ — recipients expandable. Rules read as sentences: _"When [a
  seller replies] and [interest is high], Pax will [draft a reply] and [wait
  for my approval]"_ — the chips are the config, the sentence is the doc.
  Guardrails (spend cap, quiet hours, approval thresholds) are toggles with a
  live count of how often each fired. → **Autopilot config + Pax.**
- **Sane default handoffs + report in outcomes + a supervisor above the LLM
  (Intercom Fin / Sierra).** Autonomy framed as _"what Pax handles alone" vs
  "what Pax brings to you"_ — two columns, not a scary slider. Pax reports
  outcomes: _"This week: 34 drafts, 28 sent as-is, 3 calls booked, 2 flagged
  for you."_ A deterministic guardrail layer sits _above_ the model for hard
  rules; anything ambiguous is surfaced, never silently executed. → **Pax +
  Solene.**
- **Connectors as a categorized catalog with live per-provider health; empty
  states that teach (Stripe / Vercel).** Each connected service is a card with
  live status (connected / degraded / credits remaining) — the circuit-breaker
  state becomes an honest health chip, not a silent backend event. Every empty
  door teaches its unblocking action: _"No deals yet — connect property data
  and Pax surfaces 12 matching parcels."_ → **Connectors + every empty state.**

## The refined USER experience (across the 5 doors)

- **First five minutes:** land on **Today** → a 5-step "Get running" card,
  step 1 = connect your email (Clerk → Gmail/Outlook, highest-trust, highest-
  payoff). The instant email connects, the **Inbox** back-fills and lanes
  populate — the product visibly _does something_ before onboarding finishes.
  Cmd-K introduces itself once. Turning on Pax ends onboarding with a
  **dry-run on your last 10 threads**, not a live cannon: _"Here's what Pax
  would have done. Approve any to make it real."_ Trust is earned on replayed
  history before a single real send.
- **Daily driver:** **Today** is the user's "Letter, lite" (what Pax did
  overnight, what needs you, money at a glance, all drill-in). **Map** parcels
  are mentionable objects with a "Mentioned in" rail. **Deals** is an
  optimistic keyboard board, each card showing Pax's recommended next action.
  **Finance** is one hero truth with every number drilling to transactions and
  one Approvals inbox. **Pax** is the verb layer — invoked from Cmd-K, drafting
  in-voice in the Inbox, previewing before acting, reporting in outcomes.
  **Inbox** is the daily home: split lanes, auto-summaries, instant in-voice
  replies, team assignment + collision detection.

The Jobs test is passed by **subtraction**: five doors, one command palette,
autopilot that shows its work and asks before spending. New capability always
arrives _behind_ a door.

## The refined FOUNDER experience (running the platform via Solene)

The north star: a founder whose entire daily interface is **one Letter and a
short stack of decision cards**, with total drill-down available but rarely
needed. The four founder doors already encode this; the design job is to make
each feel like the best-in-class analog:

- **The Letter (`/founder/autopilot`) = the Ramp/Mercury morning digest.**
  Hero truth first (revenue, cost, cash/runway, active customers), then _what
  Solene handled autonomously_ (outcomes, Intercom-style), then **decision
  cards** — the only thing that needs the founder. Each card is a Ramp
  approval: recommendation + full context + committed/at-risk numbers +
  one-key **Approve / Modify / Decline**, actionable from the Letter itself.
- **Decisions (`/founder/decisions`) = the Approvals inbox.** Everything
  Solene _won't_ do without a human, each with its reasoning and a dry-run of
  the consequence (_"this raises 40 customers' tier price; here's the projected
  churn"_). Nothing ambiguous ever executes silently.
- **Controls (`/founder/autopilot/control`) = the n8n/Zapier guardrail
  surface for the whole company.** Autonomy as plain-English sentences with
  editable chips; visible guardrails (spend caps, "always ask before price
  changes," "auto-approve refunds under $X") each showing how often they
  fired; a permanent "simulate this month" dry-run. Trust dashboards, not
  blind sliders.
- **Story (`/founder/autopilot/story`) = the Ramp drill-down.** Every number
  in the Letter drills to its exact transactions/events. Solene's narrative is
  always one click from its evidence.

Speed is Linear: the founder never _navigates_, they ask Solene or action a
card. **The fewer doors the founder opens, the more Solene is working** — the
minimal-door discipline is the product, not a constraint on it.

## The buildable roadmap (ranked by delight-per-effort)

Each item is behind an existing door; ordered highest delight-per-effort first.

1. **Autopilot as level + tools + plain-language "what this means"** — the
   crystal-clear autopilot config (handles-alone vs. brings-to-you, capability
   rows with connect-wizards, live summary). _(Settings/Pax — shipped in this
   wave.)_
2. **One-line auto-summary above every Inbox thread** (Superhuman). Pax-
   generated, auto-updating. Instant "whoa," tiny surface. _(Inbox.)_
3. **Cmd-K = navigation + Pax actions in one box, shortcut on every row**
   (Linear). Keeps 5 doors; cleanest Pax entry. _(All doors + Pax.)_
4. **Auto-completing 5-step "Get running" card on Today** (Shopify). Steps
   complete from real connection state. _(Today + Connectors.)_
5. **"What will this do" dry-run before any autopilot goes live** (n8n). Exact
   recipients + exact credit/$ spend from the user's own rails; replay on
   last-10 history. The single biggest trust unlock. _(Autopilot + Pax.)_
6. **Pax reports in outcomes, not activity logs** (Intercom). Compounds trust
   into more autonomy. _(Today/Pax.)_
7. **Finance one-hero-truth header + every chart drills to transactions**
   (Mercury/Ramp). _(Finance.)_
8. **Single Approvals inbox for anything that spends the user's rails**
   (Ramp) — mirrors Solene's decision cards for user/founder consistency.
   _(Finance.)_
9. **`@`-mention parcels/deals/contacts everywhere + auto "Mentioned in"
   rail** (Notion). Builds the activity graph for free. _(Inbox, Deals, Map,
   chat.)_
10. **Solene's Letter as founder home: hero → handled → decision cards,
    actionable inline** (Ramp/Mercury). The core founder-experience bet.
    _(`/founder/autopilot`.)_
11. **Connectors as a categorized catalog with live per-provider health/
    credits chip** (Stripe/Vercel/Shopify). Surfaces circuit-breaker + credit
    state honestly. _(Connectors.)_
12. **Teaching empty states with the exact unblocking CTA on every door**
    (Vercel/Stripe). Converts blank screens into onboarding. _(All doors.)_

The cross-cutting principle behind all twelve is the four-part rule at the top:
show the work, preview the spend, ask before touching the user's rails, report
in outcomes. That is what makes owning the risk _delightful_ — which is the
whole company in one sentence.
