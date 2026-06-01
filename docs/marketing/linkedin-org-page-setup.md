# LinkedIn Org Page — Phase Zero-Two Setup

Author: Soren (CGO)
Status: prep only. No posting until Solene authorizes Phase 0 activation and Beatrice signs off on the guardrails below.

## 1. Org Page Bio (≤2,000 chars)

> AcreOS is the operating system for property investors. Built for Land Investors first; Note Investors today; Fix-and-Flippers, Wholesalers, and Tax-Delinquent Buyers in beta; Subdividers and Buy-and-Hold Landlords on the roadmap.
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
> The platform serves Land Investors first. Note Investors today. Fix-and-Flippers, Wholesalers, and Tax-Delinquent Buyers in beta. Subdividers and Buy-and-Hold Landlords on the roadmap.
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
> Core (full workflow, complete vocabulary): Land Investors, Note Investors.
> Beta (real workflows, outer shell still maturing): Fix-and-Flippers, Wholesalers, Tax-Delinquent Buyers.
> Roadmap (declared, not pitched): Subdividers, Buy-and-Hold Landlords.
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
