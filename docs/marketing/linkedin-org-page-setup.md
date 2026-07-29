# LinkedIn Org Page — Phase Zero-Two Setup

Author: Soren (CGO)
Status: prep only. No posting until Solene authorizes Phase 0 activation and Beatrice signs off on the guardrails below.

## 1. Org Page Bio (≤2,000 chars)

> AcreOS is the operating system for property investors — deepest in land. Land Investors, Note Investors, and land+note hybrid operators are core; Wholesalers, Fix-and-Flippers, Buy-and-Hold Landlords, Tax-Lien/Deed Buyers, Subdividers, and Creative-Finance Investors are in beta; short-term rentals, commercial, development, multifamily, mobile-home parks, and agent-investors are on the roadmap.
>
> The platform consolidates the workflow an investor used to run across six tabs and four subscriptions: pull lists from county parcel records, run real comparable-sales analysis (not Zestimates), send direct mail, draft seller replies, close deals, and service the note after.
>
> The AI assistant — Pax — runs overnight. Pax pulls comps, scores leads against the saved buy-box, drafts replies a seller will actually read, books follow-ups, and tracks every parcel from cold lead through closed note in one thread. Every action Pax takes is shown with the data it used. No black boxes.
>
> Pricing is on the page. Pro is $41/mo billed annually — full Pax assistant, unlimited counties, bring-your-own-key for the parcel and skip-trace data costs every operator already pays. No "contact us" wall.
>
> Public landing: acreos.io
> Status page: status.acreos.io
> Press / careers: acreos.io/press · acreos.io/careers

**Character count:** ~1,180 chars (well under the 2,000 LinkedIn limit, leaving room for one-line iteration).

**Voice check:**
- Third-person mechanics. No "we built" or "I built."
- Honest tier language matches landing `Positioning.tsx`.
- Pax is the only AI named. No Sophie/Forge/Atlas leak.
- Zero references to Land Geek, GeekPay, LG Pass, Mark Podolsky.
- Pricing claim ($41/mo annual) matches `landing/copy.ts:133` and `Pricing.tsx`.

---

## 2. The Three Seed Posts (full bodies, ready to publish)

These are the only three posts written in full at this stage. The other 8 hooks from `phase-zero-two-content-runway.md` get bodies once truth-engine clearance lands.

### Seed Post 1 — Mechanics intro

> A property investor's workflow used to look like this:
>
> Tab 1: county GIS portal. Tab 2: a comp tool that doesn't price vacant land. Tab 3: a mail-merge service. Tab 4: a CRM that doesn't know about parcels. Tab 5: a spreadsheet that tracks the note after the deal closes. Tab 6: an email inbox that's getting buried.
>
> AcreOS replaces all six. One thread per parcel, from cold lead through closed note.
>
> The platform serves property investors — deepest in land. Land Investors, Note Investors, and hybrid operators are core. Wholesalers, Fix-and-Flippers, Buy-and-Hold Landlords, Tax-Lien/Deed Buyers, Subdividers, and Creative-Finance Investors are in beta. The rest of the roadmap is on the landing page.
>
> acreos.io

### Seed Post 2 — Pax, named

> Pax is the AI assistant inside AcreOS. It runs overnight.
>
> By the time an investor opens the app in the morning, Pax has pulled new county lists against the saved buy-box, run real comparable-sales analysis on the parcels that passed the filter, drafted reply emails for any inbound seller messages, and queued the day's tasks.
>
> Every draft cites the comps it used. Every action shows the data trace behind it. Nothing happens behind the operator's back.
>
> The operator handles judgment calls. The system handles the busy work.
>
> See Pax run on a county at acreos.io

### Seed Post 3 — Honest beta

> Most platforms call everything "released." AcreOS calls beta what's beta.
>
> The landing page tiers every investor type the platform serves:
>
> Core (full workflow, complete vocabulary): Land Investors, Note Investors, land+note hybrids.
> Beta (real workflows, outer shell still maturing): Wholesalers, Fix-and-Flippers, Buy-and-Hold Landlords, Tax-Lien/Deed Buyers, Subdividers, Creative-Finance Investors.
> Roadmap (declared, not pitched): short-term rentals, commercial, development, multifamily, mobile-home parks, agent-investors.
>
> A first-time visitor sees what's live, what's maturing, and what's coming — before signing up. Honesty scales better than feature inflation.
>
> acreos.io

---

## 3. Posting Cadence Target

**Phase Zero-Two ramp:** 2 posts/week for the first 4 weeks, then 3/week through the rest of the phase.

| Week | Posts | Notes |
|------|-------|-------|
| 1 | Seed 1, Seed 2 | Two-day spacing (Mon, Wed) |
| 2 | Seed 3 + Hook 1 | Mon, Thu |
| 3 | Hooks 2, 3 | Tue, Fri |
| 4 | Hooks 4, 5 | Mon, Thu |
| 5+ | 3/week from hooks 6–8 + reactive | Mon, Wed, Fri |

**Best-post-time hypothesis:** US-Central 8:00–9:30 AM CT weekdays (per LinkedIn's published organic-distribution research; verify once we have 4+ weeks of own-data and let Lena re-derive).

**Hard frequency cap:** no more than one post per calendar day from the org page, no matter the trigger.

---

## 4. Engagement / Response Guardrails (Beatrice's review)

Pax does NOT respond to LinkedIn DMs or comments on Phase Zero-Two. The org page is publish-only at this stage. Human-mediated responses, flagged-to-Beatrice protocol for sensitive replies. The full rules:

- **No automated DMs.** Period. Until Beatrice clears the AI-disclosure language for direct customer outreach, every DM gets a human reply or no reply at all.
- **Comments:** respond within 12 business hours OR not at all. Late responses look worse than no response.
- **Investment-return questions:** never engage with specifics. Standard reply: "AcreOS doesn't make investment-return claims. The platform tracks deals the operator closes; the operator's results are the operator's." Beatrice provides the canonical text.
- **Competitor questions ("How is this different from X?"):** factual feature comparisons only. Never names Land Geek, GeekPay, LG Pass, or Mark Podolsky — that's a constitution rule. PropStream / DealMachine may be referenced factually if asked directly.
- **Hostile / bait comments:** do not engage. Flag to Beatrice via the founder feedback dashboard.
- **Operator-success stories:** wait for explicit written customer permission before any quoting. Until then, no testimonials. This matches `feedback_landing_voice.md`.
- **DM spam ("Can you give me free access?"):** standard polite-decline template; never improvise pricing on DMs.
- **AI disclosure on any auto-generated content:** every post that Pax authored gets a "Drafted by Pax" tag, per AcreOS constitution and AI-safety memo.

---

## 5. What Lena Measures (handoff)

Once Phase Zero-Two activates, Lena instruments the LinkedIn → AcreOS funnel via the PostHog UTM capture wired in Pillar 3:

- Every LinkedIn post link gets `?utm_source=linkedin&utm_medium=organic&utm_campaign=<slug>&utm_content=<post_id>`.
- PostHog event `signup_started` lets us trace each LinkedIn post to first signup.
- PostHog event `signup_completed` lets us trace each LinkedIn post to trial activation.
- Weekly content review (Mondays): per-post → signup conversion %; cut hooks that under-deliver after 4 attempts.

---

## 6. What This Doc Is Not

- Not the X / Twitter playbook (Phase 1, with paid API).
- Not the YouTube playbook (Phase 2+).
- Not the cold-email playbook (covered in the runway doc, separate Beatrice review).
- Not the launch announcement (Solene drafts that the day Phase 0 activates).

---

## Publish-ready bodies

The three seed posts above were the scaffold. The three bodies below are publish-ready: each ≤1300 characters (LinkedIn's organic-reach sweet spot), each with a hook that survives the ~210-character "…see more" truncation, each with exactly one specific truth-engine-verified claim, each ending with a "see how" CTA (never "DM me," never "sign up now"), each AI-disclosed per AcreOS Constitution §7 and Colorado SB 24-205.

### Publish-ready Body 1 — Mechanics intro

**Persona:** land_investor
**Character count:** 1,082
**Truth-engine sources:** `shared/business-types.ts` (tier registry); `client/src/pages/landing/Positioning.tsx` (public tier statement).
**Beatrice check:** No investment-return claim. No competitor named. Beta language matches landing. PASSED.
**CTA:** "See how it works at acreos.io"

> A property investor's workflow used to live in six tabs.
>
> Tab 1: a county GIS portal. Tab 2: a comp tool that doesn't price vacant land. Tab 3: a mail-merge service. Tab 4: a CRM that doesn't know what a parcel is. Tab 5: a spreadsheet for the note after the deal closes. Tab 6: an inbox burying every reply.
>
> AcreOS consolidates those six into one thread per parcel, from cold lead through closed note.
>
> The platform serves property investors — deepest in land. Land Investors, Note Investors, and hybrid operators are core. Wholesalers, Fix-and-Flippers, Buy-and-Hold Landlords, Tax-Lien/Deed Buyers, Subdividers, and Creative-Finance Investors are in beta.
>
> The maturity tier is on the landing page — visible before anyone signs up. Honesty scales better than feature inflation.
>
> See how it works at acreos.io
>
> ---
> Drafted by Pax, AcreOS's AI assistant. (Constitution §7.)

---

### Publish-ready Body 2 — Pax, named

**Persona:** land_investor (with note_investor secondary)
**Character count:** 1,165
**Truth-engine sources:** `client/src/pages/landing/copy.ts:112` (Pax mechanics: comps, leads, replies, follow-ups, notes; "every action is shown with the data it used"); `client/src/pages/landing/Agents.tsx`.
**Beatrice check:** AI disclosure present. No autonomy overclaim ("operator handles judgment calls"). No fiduciary advice. PASSED.
**CTA:** "See Pax run on a county at acreos.io"

> Pax is the AI assistant inside AcreOS. It runs overnight.
>
> By the time the operator opens the app in the morning, Pax has pulled new county lists against the saved buy-box, run comparable-sales analysis on the parcels that passed the filter, drafted reply emails for inbound seller messages, and queued the day's tasks in order of payoff.
>
> Every draft cites the comps it used. Every action shows the data trace behind it. Nothing happens behind the operator's back.
>
> The operator handles judgment calls. The system handles the busy work.
>
> Pax does not give investment advice. Pax surfaces data and offers suggestions; the operator makes every decision about their money. That line is in the AcreOS Constitution and code-enforced inside the assistant.
>
> See Pax run on a county at acreos.io
>
> ---
> Drafted by Pax. (AcreOS Constitution §7 disclosure.)

---

### Publish-ready Body 3 — Honest beta

**Persona:** fix_and_flip, residential_wholesaler, tax_lien_deed (beta tier callout)
**Character count:** 1,143
**Truth-engine sources:** `client/src/pages/landing/Positioning.tsx` (tier chips: core / beta / roadmap with the verticals named).
**Beatrice check:** No overclaim on beta features. No "coming soon" promise without source. Matches landing language verbatim. PASSED.
**CTA:** "See the tier list at acreos.io"

> Most platforms call everything "released." AcreOS calls beta what's beta — on the public landing page, before anyone signs up.
>
> The tiers, exactly as they ship:
>
> Core (full workflow, complete vocabulary): Land Investors, Note Investors, land+note hybrids.
>
> Beta (real workflows, outer shell still maturing): Wholesalers, Fix-and-Flippers, Buy-and-Hold Landlords, Tax-Lien/Deed Buyers, Subdividers, Creative-Finance Investors.
>
> Roadmap (declared, not pitched): short-term rentals, commercial, development, multifamily, mobile-home parks, agent-investors.
>
> A first-time visitor sees what's live, what's maturing, and what's coming — before signing up. That ordering is deliberate. A beta tag below the hero costs short-term conversion. It saves the trust the platform actually runs on.
>
> Honesty scales better than feature inflation.
>
> See the tier list at acreos.io
>
> ---
> Drafted by Pax under Soren's direction. (AcreOS Constitution §7.)

---

### Publish gates (every body above)

1. **Truth-engine status.** Every numeric and capability claim maps to a named source in code or on the public landing. Sources cited per body.
2. **Beatrice check.** No FTC investment-return claim; no CFPB / FCRA / ECOA / Fair Housing exposure (verticals only, no protected-class targeting); CAN-SPAM not applicable (organic social, no email).
3. **AI-disclosure check.** "Drafted by Pax" tag on every body. Satisfies Constitution §7 and Colorado SB 24-205 (effective 2026-02-01) consumer-AI-disclosure requirement.
4. **Constitution check.** No return promises. No urgency manipulation. No codenames (Pax only — Sophie/Forge/Atlas absent). No competitor named.
5. **Voice check.** Mechanics-first third-person; no founder voice; "leverage," "vertical," "synergy" all absent from every post body. ZERO Land Geek / GeekPay / LG Pass / Mark Podolsky mentions.

**Publish-ready when LinkedIn Company Page exists. Posting cadence: Body 1 → Body 2 (two-day spacing) → Body 3 + hook #1 from the runway, per the cadence table in §3.**
