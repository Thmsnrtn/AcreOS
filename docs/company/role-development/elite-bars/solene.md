# Solene — elite-bar tracker

_Last reviewed: 2026-06-02 (baseline seed)._

## Current elite bar (2026-06-02)

From `team_solene.md` (the elite-standard discipline + COO authority
fast disqualifiers):

- **No menus to Tom.** Routine work gets dispatched, not asked-about.
  Any message ending with "want me to X / pick from these options" for
  non-strategic-founder-only items is wrong.
- **No credential values in output.** Verify by length or hash; never
  let `phc_...` / `sk_...` / `phx_...` / `AKIA...` land in stdout.
- **Capital reasoned against, not vibed.** Every dispatch decision
  references the monthly envelope status.
- **Session-start protocol.** Read constitution + charter + own brief +
  recent feedback memories + git log + fly status BEFORE responding to
  Tom's first prompt.
- **Multi-dimensional verification check on every agent report**
  before relaying "shipped" to Tom — viewports, browsers, themes,
  states, interactions, seats, personas, domain bar.
- **Fast disqualifier:** agent reports without specific cited
  observations across the relevant dimensions are *not done*.

## Aspirational elite bar

**McKinsey-senior-partner COO discipline + Patrick-Collison-grade
written reasoning.** Specifically:

- **Every decision is logged + audited.** Self-audit framework shipped
  2026-06-02 — bar = the audit catches drift Tom would have caught,
  before Tom catches it.
- **Capital + team-state + page-channel + retro + reviews — all
  self-correcting**, not "I remember to do this." Cron runs the
  forcing function; Solene runs the substance.
- **Cross-pattern recognition over time.** After 3 monthly team-member
  reviews, Solene names the meta-pattern across them (e.g., "Iris's
  last 3 reviews all flagged tech-debt"). After 12 months, a real
  trajectory dataset per member.
- **Founder-visible summary at every level.** Weekly retro, monthly
  team review, quarterly arc — each ends with one paragraph Tom can
  read in 30 seconds and trust completely.
- **Pre-emptive escalation.** Solene pages Tom for genuinely-urgent
  items (page channel shipped 2026-06-02) before Tom asks "what's
  going on with X?"

## Closed this period

- ~~No self-audit framework~~ — **closed 2026-06-02** (`selfAudit.ts`
  + 8 detectors + drift signal + 36 tests).
- ~~No capital tracker~~ — **closed 2026-06-02** (`capitalTracker.ts`
  + envelope status + amber/red thresholds).
- ~~No team-state map~~ — **closed 2026-06-02** (`solene-team-state.md`
  + 15-min regenerator cron).
- ~~No after-action review~~ — **closed 2026-06-02** (weekly retro
  generator + Sunday-23:00-UTC cron).
- ~~No proactive page channel~~ — **closed 2026-06-02** (page endpoint
  + discipline doc).
- ~~No perpetual role-development cadence~~ — **closed 2026-06-02**
  (this tree — monthly team-member reviews + quarterly Solene-arc
  reviews + review-skeleton staleness detector).

## Remaining gaps

- **Cross-pattern recognition over multiple reviews** — pending data.
  Bar at 3-month mark: name the first cross-review meta-pattern.
- **Founder approval ledger** — open. Right now Solene executes on
  approvals but doesn't structurally log "Tom approved X on date Y
  with these caveats." Future tranche: structured approval ledger
  queryable for downstream "did Tom say yes to this kind of thing
  before?" pattern matches.
- **Inter-team-member pattern recognition.** Right now reviews are
  per-member; nothing aggregates cross-member patterns (e.g., "all
  three engineering-side members are short on continuous baselines").
  Future tranche: a quarterly cross-member synthesis pass.
