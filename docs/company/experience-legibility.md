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
- [x] **F2 — Controls rewrite** (`/founder/autopilot/control`): PARTIAL
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
      DONE (2026-07-08 eve): per-control "last fired" lines — every
      Trust dial now shows when it last actually moved: "Trust granted
      4h ago" or "Pulled back 20m ago — two sends bounced in a row"
      (ledger lastPromotedAt/lastDemotedAt + demotion reason; latest
      event wins). Verified in-browser both variants. F2 COMPLETE.
- [x] **F3 — Receipts**: COMPLETE (2026-07-09). SHIPPED (F3a): the
      Letter's wedge tiles are receipts — tapping Outreach/Replies/
      Offers (7d) opens the exact rows the count is made of
      (GET /api/founder/autopilot/receipts/wedge; same tables + cutoff
      as the narrate gatherer, formatted server-side: "2d ago · Letter
      to Emmy Replywell — sent" / the reply text itself / "Offer
      $32,500 to Emmy Replywell — draft"). Honest empty: "Nothing in
      the last 7 days — that number is a true zero." Verified
      end-to-end in-browser (tap → rows → toggle off).
      DONE (F3b chat, 2026-07-09): receipt chips on Solene chat replies
      + show-the-work disclosure. No server pipeline change needed —
      chips derive client-side from the persisted tool_use/tool_result
      pairs (`chatWork.ts`, pure + unit-tested): successful
      record_decision → "Decision #214" → /founder/decisions;
      dispatch → "Dispatch queued" → /founder/dispatches; frozen
      witnessed-send → "Waiting for your approval" → /founder/decisions.
      Failures/refusals never chip. Tool activity collapses behind
      "Show the work (N steps)" (aria-wired); the raw tool-output
      carrier rows no longer render as fake user bubbles. Verified
      end-to-end in-browser (fixture conversation → chip → Decisions).
      Story-door check (2026-07-09): Story ALREADY has the drawer —
      every action row expands into the full reasoning chain ("What I
      saw / Options I weighed / What I remembered / My forecast / The
      gate"), built before this cluster (same story as F2's dials). No
      further work; F3 closed.

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
      controls rewritten to consequence language).
      DONE (2026-07-09): the two noted follow-ups shipped — the server
      notification schema now describes every event as what happens in
      the customer's world ("A seller looks ready to sell", "Your card
      is declined — one text"; IDs/channels untouched), and the
      Service Providers card was rewritten to answer the customer's two
      real questions (is this channel ready / what does one send cost)
      with the hardcoded model-name routing table deleted — it was
      client copy that could drift from the real router. Sub-nickel
      costs render in cents (a $0.008 text no longer rounds to $0.01).
      The AI cost dashboard comparison column and the Pax model tooltip
      also drop internal model names. Verified in-browser 8/8 at 390px.
      REMAINING (C1c, deliberate): the 7→4 intent regroup. Plan: reuse
      the proven LEGACY_TO_CANONICAL hash-rewrite mechanism from the
      17→7 consolidation (settings.tsx). Proposed buckets: **You**
      (account+security), **Your business** (organization+tax-
      compliance), **Money** (billing), **How AcreOS works for you**
      (notifications+integrations). Steps: (1) grep all `/settings#`
      deep links in server emails/dunning/client CTAs and inventory
      them; (2) extend LEGACY_TO_CANONICAL so every current + legacy
      hash lands in the right new bucket (deep links must use the hash
      form — query params are ignored, see the dunning-link postmortem
      note in settings.tsx); (3) move tab contents without changing any
      component; (4) e2e-pin one legacy hash per bucket. Do NOT ship
      during launch week — it changes muscle memory for the first
      cohort mid-onboarding; queue for the week after.
- [x] **C2 — Campaign receipts** (2026-07-08 eve): the campaign
      analytics view gains an "Every send" card — each piece the
      campaign sent, newest first, from a new org-scoped
      GET /api/campaigns/:id/delivery-events reading the SAME table as
      the aggregate counts ("2d ago · Letter to Emmy Replywell — sent").
      Honest empty: "No sends yet. When this campaign sends its first
      piece, every one will be listed here." Runtime-verified against
      the fixture campaign + 404 on foreign/missing campaign.
- [x] **C3 — Discipline check**: VERIFIED (2026-07-09). The whole
      cluster (F1–F3, C1–C2) added zero new routes and touched zero nav
      files (`nav-items.ts`, `layout-sidebar.tsx`, `founder-doors.ts`,
      `App.tsx` all unchanged across the cluster's commits); the
      `founderFourDoors` ratchet passes. Every new surface is a strip,
      card, chip, or drawer inside an existing door — no new rooms.

Acceptance: a first-week customer can state, for any toggle, what will
happen if they flip it — verified by the settings copy alone (usability
heuristic: read the label + subtitle, cover the control, predict).

## Sequencing

After launch-week remainders clear: F1 → F2 → F3, with C1 parallel to
F2 (different files). Each lands as its own PR under the standing
auto-merge policy. E2E: extend existing settings/founder specs to pin
the pulse strip's honest-empty state and one receipt round-trip.

---

## Epistemic-UX frontier — corrected scope (2026-08-28)

The master directive (`master-directive-2026-08.md`) asks for one product-wide
language for truth-states — *verified / observed / customer-reported /
provider-reported / inferred / estimated / stale / conflicting / unknown /
unavailable* — rendered consistently everywhere. A HEAD reconstruction proposed
this as a quick "connect a dark primitive and delete the copies." **That framing
was wrong, and the correction matters so the work is scoped rather than
blundered into.**

Measured at HEAD (importer counts are `grep -rl` across `client/src`, minus each
component's own file):

| primitive | importers | what it actually models |
|---|---|---|
| `data-confidence-badge.tsx` (`DataConfidenceBadge`) | **0** | numeric confidence 0–100 + a `sources` list, as 5 bars. NOT truth-states. |
| `source-attribution-panel.tsx` (`SourceAttributionPanel`) | **0** | a full sources panel. Dark. |
| `data-provenance-chip.tsx` (`DataProvenanceChip`) | **6** | the de-facto adopted provenance primitive. |
| `data-provenance-tag.tsx` (`DataProvenanceTag`) | **DELETED 2026-08-28** | was the second, competing provenance tag. comps-analysis.tsx (9 sites) and properties.tsx (8 sites) both migrated to the chip with honest classifications; the "User entered" sites carry the label with NO classification — the customer's own record of their own transaction needs no epistemic badge, and the tag's "high confidence" on it was decoration. One primitive remains. |

Plus ~20 components under `client/src/components` and `.../pages` that render
their own inline confidence/provenance UI (`avm.tsx`, `today/ConfidenceBar.tsx`,
`confidence-interval.tsx`, `CmaPanel.tsx`, and more).

So this is **not** a one-file wire-up. It is a genuine design consolidation, and
it cannot start by adopting `DataConfidenceBadge` as the truth-state token —
that badge models a *number*, not the directive's epistemic *states*, and doing
so would enshrine the conflation. Two dark primitives, one adopted chip, one
competing tag, and ~20 ad-hoc copies is a landscape, not a loose wire.

**The real sequence, when this frontier is taken up:**
1. Decide the canonical truth-state vocabulary (a product-identity call — pick
   the subset of the directive's list that AcreOS actually distinguishes, and
   define each state's meaning). This governs everything downstream.
2. Choose or build ONE primitive expressing it. `DataProvenanceChip` (6 callers)
   is the incumbent to extend, not to bypass; `DataConfidenceBadge` stays the
   numeric-confidence primitive, a different thing that should compose WITH the
   truth-state token, not replace it.
3. Migrate the ad-hoc surfaces to it, one at a time, each with a before/after.
4. Delete the copies and the losing primitive; ratchet the count down-only so
   inline confidence UI cannot regrow.

Recorded here rather than acted on because step 1 is a deliberate call that
should be made once, cleanly, not improvised mid-migration — and because a
"connect+delete" commit built on the mischaracterized premise would have been
activity, not the outcome the directive wants.

### Step 1 DECIDED (2026-08-28) — the vocabulary is the four states, single-sourced

The canonical truth-state vocabulary is the four-state `DataClassification`
the product already speaks — **authoritative / estimate / modeled / unknown** —
with staleness and source-freshness carried as ORTHOGONAL fields (`stale`,
`sourceAsOf`), never as extra states. The directive's ten words map on:
verified/observed/provider-reported → `authoritative` (+ the `source` label
saying who); estimated → `estimate`; inferred → `modeled`;
unknown/unavailable → `unknown`. **`customer-reported` and `conflicting` are
deliberately NOT admitted**: no surface at HEAD carries either distinction,
and the no-interface-before-a-second-consumer precedent applies — a state
nothing renders is speculation, and adding one later is a product-identity
change made at `shared/dataClassification.ts`, not a convenience.

Landed with the decision: the four values were declared FOUR times (provider
`types.ts`, the chip, `EvidenceAuthority` in `shared/evidence/claim.ts`,
`LandFieldClassification` in `shared/landProfile.ts`), each aligned by a
comment. All four now derive from `shared/dataClassification.ts` — drift is a
compile error. Step 4's ratchet is INSTALLED (2026-08-28), and the census behind it
corrected the landscape's size: a 4-modality workflow sweep (95 candidate
sites, 59 files, adversarial refute pass) found **87 verified ad-hoc sites in
54 files** — 30 truth-state, 57 numeric-confidence — four times the "~20"
reconstruction above. The worklist and the per-file mechanical growth-stop
live in `scripts/inline-provenance-census.json`, enforced by
`lint:inline-provenance` (falsified three ways on install). Step 3 proceeds
file-by-file against that census; step 2 (chip extension) as surfaces demand.
