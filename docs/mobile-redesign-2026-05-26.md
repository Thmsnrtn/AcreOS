# Mobile Redesign — Pinned 2026-05-26

Captured mid-decision so the team / a future session can pick up exactly
where we paused. **Status: ready to build Phase A; awaiting go-ahead.**

## The conviction we landed on

- AcreOS is responsive-shrinking the desktop. That's wrong.
- Heavy hitters (Linear, Superhuman, Stripe, Pipedrive) explicitly design
  mobile as a *reduced subset* — triage + respond + glance — not parity.
- Mobile = response surface, not capture surface. Real authoring stays
  on desktop. Phone is for what happens **after** work is in flight.
- AcreOS serves 7 investor personas (Land Flipper, Note Investor,
  Wholesaler, Fix & Flip, Tax-Delinquent, Buy-and-Hold Landlord,
  Subdivider). The mobile shell must be persona-aware; the content per
  tab adapts to who's logged in.
- Land investors do NOT primarily acquire via drive-by — they research,
  pull lists, score, mail. So drive-by capture is NOT the killer mobile
  flow. The killer flow is **inbox triage of responses to outreach.**

## Universal shell

4-tab bottom bar: **Today** · **Inbox** · **Pipeline** · **Portfolio**.
FAB = "Quick add lead" (a phone call just came in from your mailer) —
*not* parcel capture.

## Universal journeys (build first — wide reach)

1. Inbox triage — swipeable feed of inbound calls/texts/emails from
   outreach. Swipe-right contacted, swipe-left dismiss, swipe-up schedule.
2. Hot-lead glance → tap-to-act — today's top-scored leads, one-tap call
   / text / send-template.
3. Outreach monitor — single Home card: mailer sent / responses / hot.
4. Approval inbox — VA drafted X, you Send / Revise from your thumb.
5. Closing & deadline tracker — what's closing this week, what's at risk.

## Persona-specific bits

### FAB action by persona

| Persona | FAB |
|---|---|
| Land Flipper | Quick add lead |
| Note Investor | Log payment received |
| Wholesaler | Quick add buyer |
| Fix & Flip | Quick add lead |
| Tax-Delinquent | Quick add lead |
| Buy-and-Hold Landlord | Log maintenance issue |
| Subdivider | Quick add lead |

### Portfolio tab by persona

| Persona | Surfaces |
|---|---|
| Land Flipper | Active listings · pending sales · cash from closings |
| Note Investor | Payment status · delinquency clock · 1099 readiness |
| Wholesaler | EMD timer · assignment deadlines · in-flight contracts |
| Fix & Flip | Rehabs in progress · budget burn · draw schedule |
| Tax-Delinquent | Redemption clock · auction calendar · quiet-title queue |
| Buy-and-Hold | Rent roll · occupancy · maintenance backlog |
| Subdivider | Permit timeline · plat status · lot pricing |

## Build phases

- **Phase A** (~3 days): MobileShell with 4-tab IA + persona detection
  from `investorType` + persona-aware content slots + persona-aware FAB +
  "Best on desktop" silent handoff for surfaces that don't fit mobile.
- **Phase B** (~2 days each, parallelizable): Inbox triage · Hot-lead
  glance → tap-to-act · Approval inbox.
- **Phase C** (per-persona): persona-specific FAB action handlers +
  Portfolio tab content. Ship one persona at a time.

## What's already been audited / fixed leading up to this

See git log d8472090..HEAD on `main` for receipts. Highlights:
- Cookie banner safe-area-inset + dismiss-for-now (78528a83)
- Decisions inbox purge + 1,070 stale items cleared (78528a83)
- Bedrock theme migration nudge (78528a83)
- Hover-prefetch `<PrefetchLink>` wrapper wired into sidebar (85a00de2)
- Optimistic property delete (85a00de2)
- Cookie banner mobile fixes (78528a83)
- Polling → refetchOnFocus for dashboard widgets (85a00de2)
- TODO leaks removed from customer pages (85a00de2)
- Tax-identity surprise modal → deferred Settings nudge (85a00de2)
- /listings + command-palette + pipeline-velocity envelope crash (7c2e5f6c)
- Route audit doc: docs/route-audit-2026-05-26.md

## Outstanding (when mobile work resumes)

- WebSocket push (kill remaining polling on founder side)
- Performance budget + Sentry transactions (instrument what's slow)
- Real "what's frozen / what loads slowly" measurement pass
- Apply `shouldRunAIJob` wrapper to remaining 8 scheduled AI jobs (only
  did top 4 in the Frugal Autonomy work)
- Cmd-K integration: surface the team-inbox via Atlas

## Why we paused

User shifted to a meta question: instead of a synchronous 1:1
build session, design a continuous multi-agent team that can hold the
same cognitive context and iterate asynchronously while the user is
away from the desktop CLI.
