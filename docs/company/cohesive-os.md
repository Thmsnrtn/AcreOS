# The Cohesive OS — connective tissue, collaboration, one design language

_Founder doctrine + program plan, 2026-07-15. Codifies the "pull the whole
platform into an interconnected, delightful OS" directive. Companion to
`home-base-reshape.md`: the reshape decides WHAT each surface is (customer
owns the risk, we own the intelligence); this doc decides how the surfaces
become ONE thing. Constraint honored throughout: the 5-customer-door /
4-founder-door nav discipline (CLAUDE.md) is absolute — cohesion lives
BEHIND and ACROSS the doors, never as a new top-level entry._

## The finding that reframes the whole program

AcreOS is not missing a collaboration spine — it has one, disconnected.
An audit of the codebase found first versions of nearly every
connective-tissue primitive already built:

- A full authenticated **WebSocket server** (`server/websocket.ts`) with
  org/user/deal/listing channels and reconnect-capable client hooks.
- A **⌘K command palette** (`command-palette.tsx`, ~1,572 lines) with
  scopes, a 30-verb registry, recency scoring, and an Ask-Pax
  fallthrough, backed by a real `/api/search`.
- **Team chat between users** — fully built: `teamConversations` +
  `teamMessages` + `teamMemberPresence`, an @mention parser, presence,
  read receipts, a `/team-inbox` UI. It is only reachable by direct URL.
- A **notification center**, an **activity log**, **members/roles/invites**
  with seat tiering, and **deal rooms**.
- **One ratchet-enforced design language** (motion tokens, CSS-prop chart
  colors, shadcn/ui, hex/hover/translucency/z-index lint ratchets).

So the program is **connect-and-finish, not greenfield**. The delight is
mostly a wiring cost, not a build cost.

## The one architectural decision that comes first

The audit's load-bearing warning: there are already **three messaging
systems** (Pax AI chat, team messaging, deal rooms) and **two activity
systems** (notifications, activity_log). Before adding any new
collaboration surface, the platform must **choose one message primitive
and one activity/notification primitive** and route everything new through
them. Otherwise the cohesion work itself adds incoherence. This
consolidation decision is the first workstream — a founder-visible
architecture call, made before the feature work.

## The design thesis (unchanged, restated for cohesion)

The safest version of a risk is one where the customer owns the thing that
carries it, and we make owning it delightful. Cohesion is how "delightful"
becomes literal: the customer's connected tools, their team, their deals,
their inbox — all in one home base that feels like a single, fast,
alive operating system, with an intelligent assistant woven through it.

## The workstreams (ranked by delight-per-unit-effort)

Every item lands behind an existing door.

**Wave 1 — connect the nervous system (quick wins):**
1. **Realtime everywhere it still polls.** Subscribe the notification
   center, the inbox unread badge, and presence to the existing WS
   channels instead of 30–60s polling. Biggest delight-per-line in the
   codebase — the app starts to feel alive.
2. **Surface the built team chat inside the Inbox door.** `/team-inbox`
   exists but is hidden; bring it in as a Comms section (external threads
   + internal team channels) with unread counts on the Inbox badge. A
   Slack-level feature made discoverable without a new door.
3. **EntityChip / EntityLink + unfurls.** One reusable component that
   renders `deal:123` / `parcel:x` / `contact:y` as a rich chip; auto-
   unfurl pasted AcreOS URLs in chat and notes. The "everything is
   connected" feel; foundation for backlinks.
4. **Widen ⌘K.** Add contacts, tasks, notes, team conversations, and
   teammates to the index and palette; per-item chord shortcuts. One
   search bar that finds anything.

**Wave 2 — the strategic anchor:**
5. **Front/Missive shared inbox layer.** Assignment + internal comments +
   @mentions on the external email/SMS threads the inbox already unifies.
   The single most valuable collaboration pattern for a team-run land
   operation (VAs on outreach). Built on the existing team-messaging
   @mention + notification + members primitives — after the message-
   primitive consolidation decision.

**Wave 3 — the graph and the hub:**
6. **Cross-entity backlinks + an @-mention picker across surfaces.** A
   references table written on every link/mention; "Referenced by" on
   parcel/contact/deal pages; a Notion-style `@` picker in notes and chat.
   Turns siloed lists into a navigable graph.
7. **Unified notification/activity hub.** Consolidate notifications +
   activity into one entity-linked, WS-live feed that every collaboration
   event routes through.

**Wave 4 — platform bets (after the spine is connected):**
8. **Connectors hub** (R1) — the Shopify "connect your vendors" surface
   behind Settings; the reshape's BYO-rails infrastructure.
9. **Multiplayer presence** — per-entity "who's viewing this deal," typing
   indicators, optional huddles. Highest effort, most speculative ROI —
   last.
10. **Design-language finishing pass** — extend the ratchets to the least-
    audited founder surfaces; reconcile the stale 7-entry nav comment in
    `nav-items.ts` with the 5-door reality. Ratchet-driven, runs
    continuously.

## How this composes with the reshape

The reshape and the cohesion program are the same OS from two angles. The
**connectors hub** (R1), the **native inbox** (R1c), and **team chat** are
the collaboration spine of the home base. BYO-rails gives the liability
posture; the cohesion layer gives the "never want to leave" experience.
The landing page (R2) sells both at once: _connect your services, find your
home base, work your entire business with an intelligent, autonomous
assistant._

## Onboarding is part of the OS, not a preamble to it

A true OS is judged in the first five minutes. Onboarding (R5) must make
the platform crystal-clear and easy for every persona, and it is the
fulfillment of the promise the landing page (R2) makes:

- **Persona-first.** Identify the investor type (wholesaler, notes,
  tax-delinquent, rentals, flip, subdivision) and tailor the workspace,
  vocabulary, and which door-content shows — the `businessTypeOnly`
  model already supports this.
- **Value before friction.** Data and analysis work instantly; the
  connect-your-services wizards (R1) unlock comms as the customer
  connects them, SMS on A2P registration. A first-time user feels value
  before being asked to set anything up.
- **No empty dead-ends.** Every surface has a purposeful empty state with
  a clear next action (the `EmptyState` component + `staggerContainer`
  discipline in CLAUDE.md). A user is never left staring at a blank pane
  wondering what to do — the activation dead-end fixed in S1 is the
  anti-pattern to never reintroduce.
- **Teach the shape.** The five doors, Pax, and opt-in autonomy (with its
  disclaimers) are introduced in the flow, not left to be discovered.

## The quality bar: what Steve Jobs would ship

This is the governing standard for the entire reshape + cohesion program,
not a slogan:

- **Opinionated simplicity.** The nav discipline (5 doors / 4 doors) is
  this principle already made law. Extend it everywhere: fewer, better
  surfaces; one obvious way to do each thing; delete before adding.
- **No half-features.** A surface ships finished or it does not ship. A
  connector without a working wizard, a chat without presence, an empty
  state without a next action — none are done. Half-built is the one
  thing that reads as cheap.
- **Ruthless coherence.** One design language, one message primitive, one
  activity feed, one search. The duplication the audit found (three
  messaging systems, two activity systems) is the opposite of this and is
  resolved first.
- **Delight in the details.** The realtime aliveness, the ⌘K speed, the
  entity unfurls, the animation tokens — the small things that make the
  whole feel considered. These are not polish-at-the-end; they are the
  product.
- **The first five minutes decide everything.** Onboarding and the empty
  states carry the same weight as the deepest feature.

## Guardrails

- Nav discipline is absolute — cohesion behind the doors, never a new
  top-level entry.
- Consolidate the duplicated message/activity primitives BEFORE adding
  new surfaces on top of them.
- Every reshape keeps the intelligence and moves only custody and claims.
- Money and pricing decisions stay founder cards.
- Nothing ships half-built; the Jobs bar above is the definition of done.
