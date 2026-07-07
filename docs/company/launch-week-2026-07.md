# Launch Week — 2026-07-07 → 2026-07-11

*Founder-approved 2026-07-07. The mission: by Friday, AcreOS is
launch-grade — every customer surface works end to end, the founder
cockpit shows live truthful metrics, a CEO-grade brain sits on the founder
side, every cost has a ceiling and every failure an alarm, and every
condition-gated roadmap item detects its own moment and births itself.
Then the founder presses "go" on ads.*

*This document is the coordination artifact: any working session (human,
Fable, or Routine-spawned) reads it, picks the next unchecked item in the
active workstream, works it through full CI, checks it off IN PLACE with a
date + commit SHA, and pushes. Sequencing: WS1 exit criteria gate the
go/no-go, but workstreams may interleave. All merges to main follow the
established PR flow.*

## WS1 — The Great Surface Sweep ("nothing breaks")

Exit test: a stranger signs up, imports a lead, sends mail, gets a reply,
makes an offer, and pays — zero errors, mobile and desktop.

- [x] Fan-out audit: route inventory (155 customer routes), static
      dead-end audit, and a 140-route Playwright render sweep against a
      production build (2026-07-07). Found: 2 PRODUCTION bugs (SEO-headed
      pages served without runtime env → ad-landing/SEO pages blank;
      /transparency JSON shadowing the page), the feature-flag fail-open,
      2 dead command-palette entries, 21 orphan routes (ledgered), dead
      buttons/copy. Interactive-flow + persona-variant passes still to do.
- [ ] Same sweep for signup → onboarding-v2 → first value.
- [ ] Billing surfaces: upgrade, seats, credits purchase, cancel, dunning
      banners.
- [x] Triage ledger written into this section + fix wave 1 (2026-07-07):
      FIX-NOW shipped — seo-head env injection, transparency route split,
      FROZEN_ROUTES code-enforced deny-list, white-label config 200,
      reactivation-survey endpoint (migration 0198), Capital Markets
      sidebar entry, dead palette entries, dead disabled buttons, pax
      autonomy copy, orphan offer-wizard deleted. DEFER (ledgered): unify
      the two sitemap/robots generators (cosmetic — prod robots.txt has
      Allow:/); ui-state 404-by-design noise in telemetry.
- [x] Fix wave 1 shipped through full CI (2026-07-07). Further waves as
      the interactive-flow pass finds more.
- [ ] Wedge E2E extended: email reply leg + billing upgrade journey.
- [ ] Credentialed desktop signup E2E in CI (needs founder: Clerk test
      creds as GitHub Actions secrets).

## WS2 — Founder Cockpit (one truthful pane)

Rule: every number is real or explicitly "no data yet." Mobile-first.

- [ ] Inventory existing founder metric surfaces; identify the canonical
      Pulse view and what it's missing.
- [ ] Wire: MRR + WoW (mrr_snapshots), signups + activation funnel, wedge
      events (mail out / replies / offers), AI spend vs every ceiling
      (fuel gauges), CAC (marketing_spend), error rate, deploy status +
      watchdog state, autonomy switch states.
- [ ] No-fabrication sweep of founder surfaces (kill or label any
      decorative metric).
- [ ] Mobile pass on the cockpit.

## WS3 — The Brain (Solene as chief of staff)

Exit test: five hard CEO questions, every answer sourced.

- [ ] Verify current Anthropic model catalog + pricing (claude-api skill)
      before touching models.ts; select best founder-chat tier within
      cost ceilings.
- [ ] Give founder chat retrieval/read access to the strategy layer
      (CONSTITUTION, mature-machine, roadmap, deletion ledger, cost
      audit, this doc) + live state (metrics, gates, trust ledger,
      capital tracker).
- [ ] Verify plain-language steer path end to end (pause/resume, spend
      queries, status).
- [ ] CEO Q&A eval: 5 hard questions, sourced answers, committed as an
      eval so regressions get caught.

## WS4 — Gate-Watcher (self-birthing roadmap)

- [ ] Machine-encode the autonomy switch schedule (mature-machine §4) +
      phase triggers (Phase-1 runbook at $200 MRR held 30d; Telnyx at
      $3k; Sentry rung at $500; switch eligibility at first cohort).
- [ ] Watcher job: evaluates gate conditions on a sane cadence; ripened
      gate → one-tap founder Decision with full context, or auto-execute
      where the studio dial already says autoApprove.
- [ ] Every gate evaluation logged (glass-box); no silent flips, ever;
      hard-stops (pricing/legal/>$500/data deletion) remain permanent.

## WS5 — Launch drills + go/no-go

- [ ] Drill: kill worker mid-job → outbox/lease recovery verified.
- [ ] Drill: Stripe webhook replay → idempotency verified.
- [ ] Drill: dunning ladder end-to-end against a test org.
- [ ] Drill: panic stop flips + is honored by all loops.
- [ ] Alert-spine check: every alarm class reaches the founder's phone.
- [ ] Go/No-Go pack: one page — green/amber/red with reasons + the first
      campaign recipe ($5/day, witnessed, mail-first wedge).

## Founder inputs (non-blocking; slot in when provided)

- [ ] Clerk test credentials → GitHub Actions secrets (unlocks WS1 last item)
- [ ] DEPLOY_BOT_TOKEN + SENTRY_AUTH_TOKEN → GitHub Actions secrets
- [ ] DNC scrub vendor pick (seam ready; mail-first launch not blocked)
- [ ] Meta ad account for the $5/day witnessed live test

*Maintenance: check items off in place with date + SHA. When all
workstreams are green (or amber with founder-accepted reasons), record the
go/no-go verdict here and close the week.*
