# Rafe — CCO lens — First-customer happiness, support readiness, retention

_Chief Customer Officer. Phase 0 active, pre-first-customer. My job here: make the first
handful of paying customers reach "aha" fast, feel personally cared for on a near-zero
budget, and want to stay + refer. I care about resolutions and saves, not deflection
metrics. Everything below is grounded in what already exists in the repo._

---

## The one thing I want Tom to internalize

We have a genuinely impressive **free data substrate already wired** — `open-data-provider.ts`
pulls FEMA flood, Census demographics, USGS, USDA soils, EPA, BLM; `county-gis-provider.ts`
hits county assessor/GIS; `property-enrichment-widget.tsx` already renders flood zone, wetlands
%, soil type/suitability/drainage, elevation, and a completeness score. **The product can already
show a land investor a soil map and a flood overlay on a real parcel for $0.**

But the **activation path does not route a new customer to that moment.** The
`getting-started-checklist.tsx` "3-step aha" for the land flipper is _Add a lead → Send a mailer →
Track a deal_ (lines 39-56). That's a CRM aha, not a **land-data aha.** The single most
differentiated, "I can't get this anywhere else for free" experience we own — open a parcel and
see soils + flood + wetlands + elevation light up — is **buried behind the funnel instead of
being the funnel.** A first customer who never sees enriched parcel data in week one churns
thinking we're "just another CRM." That is the retention risk that keeps me up at night.

So my top items are about **putting the data wow-moment first**, then making support feel
white-glove on zero budget, then making the leave-door honest so the saves we do get are real.

---

## Top work items (priority order)

### 1. Make the parcel-data "aha" the first activation step — not the CRM
- **Why it matters to first customers:** A land investor's "holy cow, this is for me" moment is
  seeing real soils/flood/wetlands/elevation on a parcel they care about. We already render it
  (`property-enrichment-widget.tsx`) and source it free (`open-data-provider.ts`). Today the
  checklist sends them to `/leads` first. The wow is hidden.
- **Goal:** happier-customers (primary), data (cross-cutting)
- **Effort:** S–M
- **Phase:** 0
- **Dependencies:** none — the rendering + free sourcing already exist
- **First step:** In `client/src/components/getting-started-checklist.tsx`, add a first step for
  the land/hybrid archetypes: **"Look up your first property"** → `/maps` (the page is
  `client/src/pages/maps.tsx`), wired to trigger an enrichment lookup. The completion signal can
  reuse the activation event plumbing in `server/services/activation.ts`
  (`recordActivationEvent`). Re-order so data-aha precedes lead/mailer for land + hybrid.

### 2. Ship a "Try it on a real parcel" demo so the first lookup never returns empty
- **Why it matters to first customers:** Free open data is uneven — some counties have great GIS,
  some return nothing. If a customer's _very first_ lookup hits a thin county, the aha becomes a
  shrug. We must guarantee a great first impression.
- **Goal:** happier-customers, flawless-ux, data
- **Effort:** M
- **Phase:** 0–1
- **Dependencies:** #1
- **First step:** Curate 3–5 known-rich sample parcels (counties where SSURGO soils + FEMA NFHL +
  county GIS all resolve cleanly) and offer a "See a sample" affordance on `/maps` and in the
  enrichment widget's empty state. Stash the curated coords in a small config the
  `open-data-provider` lookup path can serve so the demo is real data, not mocked. This is also
  the screenshot/demo set Soren needs for the landing page.

### 3. Make data completeness honest and reassuring (don't fake premium)
- **Why it matters to first customers:** `property-enrichment-widget.tsx` already shows a
  `completenessScore`. On free data that score will sometimes be 40%. If we present 40% as
  failure, the free tier feels broken. If we frame it as "here's what county open data gives you;
  upgrade unlocks deeper records," it feels premium and sets up an honest upgrade path.
- **Goal:** happier-customers, data, flawless-ux
- **Effort:** S
- **Phase:** 0
- **Dependencies:** #1
- **First step:** In the enrichment widget, add an empty/partial state that names the _source_
  ("FEMA NFHL · USDA SSURGO · county GIS") and a non-dark-pattern "what paid data adds" note. This
  respects immutable #1 (no lying) and #2 (no dark patterns) and turns a data gap into trust.
  Coordinate the upgrade copy with Lena's phased data plan.

### 4. First-customer white-glove onboarding playbook (human, near-zero cost)
- **Why it matters:** At 1–5 customers, a 20-minute personal welcome is the highest-ROI retention
  act we have and costs nothing but my time. My charter mandates personal outreach within 24h of
  first payment and onboarding-to-first-value < 7 days.
- **Goal:** happier-customers, foundation
- **Effort:** S (doc + cadence, no code)
- **Phase:** 0
- **Dependencies:** none
- **First step:** Write `docs/customer/first-customer-playbook.md` — the 24h welcome,
  the "let's pull up YOUR parcel together" first call (anchored on the #1 aha), the day-3 and
  day-14 checkpoints, and the 5-question structure for what made them sign up / what would make
  them cancel. Verbatim quotes filed for Maren.

### 5. Wire the support inbox end-to-end for a real first ticket
- **Why it matters:** The substrate is strong — `routes-support-tickets.ts` (1,149 lines),
  `supportBrain.ts` with classification + escalation, the new `0109_kb_drafts_nps_queue.sql`
  KB-draft pipeline. But `help.tsx` is 96 lines and I need to confirm a customer can actually
  _file_ a ticket and get a meaningful first response. First-response < 15 min is my SLA; that's
  only deliverable if the inbound surface works and notifies me.
- **Goal:** rock-solid, happier-customers
- **Effort:** M
- **Phase:** 0
- **Dependencies:** none
- **First step:** Trace the customer path: `help.tsx` → `POST /api/support/tickets` →
  `supportAgent.createSupportTicket` → notification to me. Confirm there's a notification hook on
  ticket-created (and on Pax escalation in `supportBrain.escalateCase`) so I actually find out in
  real time. If missing, that's the gap to close before customer #1.

### 6. Pax-handoff playbook + visible human seam-hiding
- **Why it matters:** `supportBrain.ts` already escalates on low confidence / max attempts /
  playbook failure, and says "let me get a human" (lines 243, 483). But there's no
  `docs/internal/pax-handoff-rafe.md` (charter says it should exist). When Pax escalates, the
  customer must not feel dropped. Immutable #7 requires AI mediation be disclosed — so the handoff
  to a human must be clean and honest.
- **Goal:** happier-customers, rock-solid
- **Effort:** S–M
- **Phase:** 0–1
- **Dependencies:** #5
- **First step:** Author `docs/internal/pax-handoff-rafe.md`: when Pax escalates, what I see, how
  I take over, the handback. Verify the escalation in `supportBrain.escalateCase` produces a
  human-visible queue entry, not just a state flag.

### 7. Make the leave-door honest (cancellation flow audit)
- **Why it matters:** Immutable #4 — cancellation must be as easy as signup — and immutable #2 —
  no dark patterns in save-flows. `cancellation-dialog.tsx` already does reason → confirm with a
  genuine downgrade suggestion ("save $X/mo, your data stays," line 191). That's good and honest.
  I own this experience. Every cancel reason is exit-interview gold for Maren.
- **Goal:** happier-customers, rock-solid, foundation
- **Effort:** S
- **Phase:** 0
- **Dependencies:** none
- **First step:** Verify cancel reasons persist somewhere I can read them (exit-interview file),
  and that the downgrade offer is a genuine alternative, not friction. Confirm no extra
  confirmation steps beyond what signup has. Add a free-text "what would have made you stay?" that
  feeds verbatim quotes to roadmap.

### 8. NPS that drives action, not vanity
- **Why it matters:** The `nps_prompt_queue` (migration 0109) + `POST /api/nps/submit`
  (`routes-lifecycle.ts`) exist. At 1–5 customers NPS-as-a-number is meaningless, but NPS-as-a-
  conversation-trigger is everything: a detractor score = immediate personal call. My charter's
  detector #3 (NPS-driver shift) depends on this.
- **Goal:** happier-customers, data
- **Effort:** S
- **Phase:** 1
- **Dependencies:** #5
- **First step:** Confirm the NPS dialog hook consumes from `nps_prompt_queue` on login and that a
  low score notifies me to trigger a same-day touch. Don't tune the cadence aggressively pre-
  customer; just make sure a detractor reaches me.

---

## The open-data theme, from my lens

The free-vs-paid data decision is, for me, **fundamentally a trust and retention decision, not just
a cost decision.** Three principles:

1. **The free tier must feel premium, and the way you do that is honesty + curation, not faking
   depth.** Naming the source ("USDA SSURGO soils, FEMA NFHL flood") makes free data feel
   authoritative. Hiding gaps makes it feel broken. Item #3 is the whole game here.

2. **The data wow-moment IS the activation event.** We already pay $0 to render soils/flood/
   wetlands/elevation. If a first customer experiences that in their first session (items #1, #2),
   our 7-day-to-value target becomes trivial and word-of-mouth referral becomes natural — a land
   investor who sees a free soil map will tell their mastermind group.

3. **The paid-data upgrade (Regrid/Zamplo/PropGrid) should be customer-pull, not founder-push.**
   The provider registry (`provider-registry.ts`) already does tier filtering + credit deduction +
   circuit breaking, so the upgrade is a config flip when MRR justifies it. My retention signal
   tells us _when_: when customers repeatedly hit thin-county gaps on properties they care about,
   that frustration pattern (surfaced via support tickets + the completeness score) is the buy
   signal for paid data. We pay for Regrid when customers are already asking for what it provides —
   not before. That keeps overhead near-zero and makes the eventual paid tier feel earned.

---

## Quick wins (days, not weeks)

- **Re-order the activation checklist** so land/hybrid see "Look up your first property" first
  (`getting-started-checklist.tsx`). Highest leverage, smallest change.
- **Name the data sources** in the enrichment widget empty/partial state (`property-enrichment-
  widget.tsx`). Turns a gap into trust instantly.
- **Write the first-customer playbook** (`docs/customer/first-customer-playbook.md`) — no code,
  pure leverage, ready before customer #1.
- **Add a ticket-created + Pax-escalation notification** to me so first-response SLA is even
  possible (`routes-support-tickets.ts`, `supportBrain.escalateCase`).
- **Confirm cancel reasons are stored + readable** — exit-interview data from day one.
- **Curate 3 known-rich sample parcels** for the "see a sample" affordance — doubles as Soren's
  landing screenshots.

---

## Biggest risk if my area is ignored

**A first customer who never reaches the data aha-moment, hits a thin-county empty state framed as
failure, files a ticket that goes nowhere, and quietly cancels — and we never learn why.**

That single failure mode destroys everything else the team builds: the best architecture and the
best landing page are worthless if customer #1 churns silently in week two thinking we're a generic
CRM. We are uniquely positioned because **we already render premium-feeling land data for free** —
but it's hidden behind the funnel, the empty states aren't framed for trust, and I'm not yet wired
to hear from a struggling customer in real time. Fix the activation order + the empty-state honesty
+ the support notification loop, and our first five customers become our first five evangelists. Ignore
it, and we burn our scarcest, most irreplaceable asset: the first cohort's goodwill.
