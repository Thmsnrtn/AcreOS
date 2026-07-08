# Experience Legibility — Trust, Receipts, Plain-Language Controls

*Founder-requested 2026-07-08 ("how can I trust I'm not speaking into a
void?"). Design layer + queued work clusters. Sits below
`mature-machine.md` (strategy), beside `roadmap-2026-07.md` (execution);
implementation queued behind launch-week remainders.*

## The principle

A system that works while you're away must do two things every surface,
all the time: **prove it's alive** and **show its work**. The model is
the founder's terminal sessions with the dev agent: you watch the tool
calls happen, every claim is checkable, and silence is visible. The
product must earn trust the same way — not with more dashboards, but by
never making a claim it can't back inline, and never letting a void
masquerade as calm.

Three patterns, applied to BOTH the founder side and the customer side:

### 1. Pulse (liveness)

An ambient strip on every operating surface: *"Last cycle 4 min ago ·
next in 26 · 3 actions today."* Not a page you visit — proof on the page
you're on. **Honesty rule:** when nothing has run, it says so, in amber
("nothing has run in 3 hours") — wired to the same deadman that already
alarms. Silence rendered visibly.

### 2. Receipts (causality)

Every claim links to the rows that back it. The Letter's "sent 12,
got 2 replies" expands to the actual sends and replies. Solene's "I've
queued that" carries a chip linking to the decision/dispatch it created.
Optional **"show the work" drawer** on Solene chat + the Story door that
streams steps terminal-style ("reading spend ledger → drafting → saved
decision #214"). The data already exists (dispatches, event log,
activity rows, pax traces — today buried in `/founder/admin/*`); the
move is surfacing it inline, attached to the claim, on demand.

### 3. Consequence language (controls)

Every toggle and threshold is worded as what happens in the world, never
what happens in the architecture:

| Today (system language) | Target (consequence language) |
|---|---|
| Dispatch kill-cap: $50/mo envelope | "AI spending limit — if Solene's costs pass $50 this month, she stops and asks you." |
| simulationMode | "Practice mode — drafts everything, sends nothing." |
| Witnessed mode | "Ask before sending — every letter waits for your tap." |

Each control shows its **current effect** and **the last time it fired**
("Currently $31 used. Last hit this limit: never.") — which doubles as
liveness proof. Presets up top — **Cautious / Standard / Hands-off** —
mapping the autonomy ladder, individual dials underneath.

**Vocabulary rule:** one glossary; every internal term has exactly one
plain phrase, used everywhere (letter, chat, controls, emails). New copy
that leaks a system term is a review defect.

## Queued work — Founder cluster (F)

- [ ] **F1 — Pulse strip** in the founder layout, visible behind all
      four doors. Sources: continuous-loop state (already persisted),
      deadman staleness, today's action count. Cheapest, biggest trust
      yield; build first.
- [ ] **F2 — Controls rewrite** (`/founder/autopilot/control`):
      consequence-language relabel of every dial, dollar/time units,
      current-effect + last-fired line per control, three presets, and a
      "what changed" confirmation on save.
- [ ] **F3 — Receipts**: expandable evidence on The Letter's claims and
      vital signs; receipt chips on Solene chat replies that created
      decisions/dispatches; optional show-the-work drawer (chat + Story)
      reading the existing event/dispatch/trace tables. No new routes —
      inline affordances inside the four doors; `/founder/admin/*`
      remains the deep instrument panel.

Acceptance: no number without a tappable source; no control without a
consequence sentence; a stalled loop is visible on every surface within
one deadman window.

## Queued work — Customer cluster (C)

Same standard for customers: no user should ever be confused about how
to tailor their experience.

- [ ] **C1 — Settings legibility pass** (`/settings`): every setting
      gets a plain-language label + one-line consequence subtitle;
      regroup by intent ("How you're contacted", "What runs
      automatically", "Your plan & billing", "Your data"), not by
      subsystem; kill jargon (e.g. TCPA consent handling reads "Only
      contact people who said yes — required by law for texts/calls").
      Persona vocabulary continues to apply behind the doors.
- [ ] **C2 — Pulse + receipts where automation acts for customers**:
      campaign surfaces show "12 letters queued — see each one" with
      per-send rows (much exists in campaign detail; make it the claim's
      inline receipt, not a separate page); the same honest "nothing has
      run yet" states everywhere.
- [ ] **C3 — Discipline check**: everything stays behind the five doors
      + Settings; no new top-level surfaces. The legibility pass removes
      confusion by rewording and regrouping, never by adding rooms.

Acceptance: a first-week customer can state, for any toggle, what will
happen if they flip it — verified by the settings copy alone (usability
heuristic: read the label + subtitle, cover the control, predict).

## Sequencing

After launch-week remainders clear: F1 → F2 → F3, with C1 parallel to
F2 (different files). Each lands as its own PR under the standing
auto-merge policy. E2E: extend existing settings/founder specs to pin
the pulse strip's honest-empty state and one receipt round-trip.
