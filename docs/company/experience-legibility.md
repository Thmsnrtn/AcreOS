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

- [x] **F1 — Pulse strip** (2026-07-08): `FounderPulseStrip` behind all
      four doors, fed by the `loop` block added to
      `/api/founder/autopilot/live` (latest successful
      `solene_continuous_tick` from job_runs + 30-min cadence). Three
      honest states, all verified live at 390px: green "Last cycle 10m
      ago · next ~20m · N actions (24h)", amber "Nothing has run since
      3h ago — cycles are usually every 30m" (2 missed cadences), muted
      "The brain hasn't run a cycle yet". Tap → Controls. Polls 60s.
- [ ] **F2 — Controls rewrite** (`/founder/autopilot/control`): PARTIAL
      (2026-07-08). SHIPPED: the three postures — Cautious / Standard /
      Hands-off — as one-tap stances with live current-posture detection,
      a plain-language "This will change:" diff before applying, and
      sequential application through the existing per-control endpoints
      (same audit trail; partial failures surface honestly). Hands-off
      deliberately caps at "Acts — safety-checked"; full independence
      stays per-domain earned trust. Verified end-to-end in-browser
      (Cautious detected → confirm diff listed switch + 5 domains →
      Standard applied + detected). Note: most dials were ALREADY in
      consequence language (this door was rewritten before the cluster).
      REMAINING: per-control "last fired" lines (needs receipts data —
      lands with F3).
- [ ] **F3 — Receipts**: PARTIAL (2026-07-08). SHIPPED (F3a): the
      Letter's wedge tiles are receipts — tapping Outreach/Replies/
      Offers (7d) opens the exact rows the count is made of
      (GET /api/founder/autopilot/receipts/wedge; same tables + cutoff
      as the narrate gatherer, formatted server-side: "2d ago · Letter
      to Emmy Replywell — sent" / the reply text itself / "Offer
      $32,500 to Emmy Replywell — draft"). Honest empty: "Nothing in
      the last 7 days — that number is a true zero." Verified
      end-to-end in-browser (tap → rows → toggle off).
      REMAINING (F3b): receipt chips on Solene chat replies;
      show-the-work drawer (chat + Story); per-control "last fired"
      lines on Controls.

Acceptance: no number without a tappable source; no control without a
consequence sentence; a stalled loop is visible on every surface within
one deadman window.

## Queued work — Customer cluster (C)

Same standard for customers: no user should ever be confused about how
to tailor their experience.

- [ ] **C1 — Settings legibility pass** (`/settings`): PARTIAL
      (2026-07-08). A full audit (agent sweep, predict-test on every
      control across 7 tabs + 12 modules) found the surface largely
      ALREADY passes — pax-controls, accessibility, billing-sections,
      account-sections, underwriting vocabulary are house-standard.
      FIXED the failures: integrations.tsx (raw enum checkbox labels →
      "A deal closes / A big lead comes in / An offer is waiting for
      your approval"; "Webhook URL" → "Paste the link from Slack or
      Teams" with a how-to line; jargon subtitle rewritten; connected-
      channels rows humanized), tax-identity 422-code leak → plain
      consequence, BYOK section header + channel help lines lead with
      what each channel does, validate switch explains its test call,
      lead-assignment rule types → "Take turns / By location / Random"
      with helper, api-keys scopes get plain permissions with the token
      as monospace hint + 401s confirm rewritten, underwriting Balloon
      switch gains an on/off consequence line.
      C1b DONE (2026-07-08 eve): audited the tab-embedded components.
      notification-preferences + provider-settings-cards PASS;
      FIXED: compliance-settings ("TCPA compliance" tab → "Texting &
      calling consent"; retention switches now SAY they permanently
      auto-delete records — the old "Enable retention policy" hid data
      loss; "Entity type" → "Record type") and ai-settings (all four
      controls rewritten to consequence language). NOTED for follow-up:
      notification EVENT copy comes from the server schema
      (/api/notifications/preferences/schema) — sweep it server-side;
      provider-settings.tsx is read-only but jargon-heavy (vendor/model
      names, $/M tokens) if it stays customer-facing. The intent-based
      tab REGROUP (4 buckets) still needs a deep-link migration plan —
      deliberate, not rushed.
- [x] **C2 — Campaign receipts** (2026-07-08 eve): the campaign
      analytics view gains an "Every send" card — each piece the
      campaign sent, newest first, from a new org-scoped
      GET /api/campaigns/:id/delivery-events reading the SAME table as
      the aggregate counts ("2d ago · Letter to Emmy Replywell — sent").
      Honest empty: "No sends yet. When this campaign sends its first
      piece, every one will be listed here." Runtime-verified against
      the fixture campaign + 404 on foreign/missing campaign.
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
