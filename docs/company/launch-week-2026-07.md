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
- [x] Signup → onboarding-v2 → first value (2026-07-07, interactive
      pass): full 3-step walk with real clicks — persona intro →
      workspace → sample-data choice → "workspace ready" → lands on
      /maps; every /api/onboarding/* call 200. PASS. (The CREDENTIALED
      Clerk signup leg stays below, gated on founder test creds.)
- [ ] Billing surfaces: PARTIAL (2026-07-08). Done: upgrade surface
      verified honest without Stripe keys (error card + retry, no crash),
      plans grid moved into the Billing tab (fix wave 2), dunning ladder
      + banners exercised end-to-end at service level (WS5 drill), a
      self-activating billing-upgrade E2E ships with the wedge extensions.
      Remaining: credits purchase + cancel flows driven for real — needs
      Stripe TEST keys in CI (founder input, arriving).
- [x] Triage ledger written into this section + fix wave 1 (2026-07-07):
      FIX-NOW shipped — seo-head env injection, transparency route split,
      FROZEN_ROUTES code-enforced deny-list, white-label config 200,
      reactivation-survey endpoint (migration 0198), Capital Markets
      sidebar entry, dead palette entries, dead disabled buttons, pax
      autonomy copy, orphan offer-wizard deleted. DEFER (ledgered): unify
      the two sitemap/robots generators (cosmetic — prod robots.txt has
      Allow:/); ui-state 404-by-design noise in telemetry.
- [x] Fix wave 1 shipped through full CI (2026-07-07); merged as `5433a1d0`
      and VERIFIED LIVE on acreos.io (env injection present on
      /tools/parcel-check, /transparency renders).
- [x] Interactive-flow pass driven with real browser clicks — 7 core flows
      (2026-07-07): onboarding-v2 PASS; billing DEGRADED-HONEST (no local
      Stripe keys, honest error card + retry); 5 real bugs found.
- [x] Fix wave 2 (2026-07-08): (1) CRUD lists served stale from the
      browser HTTP cache after create (success toast, invisible row) —
      mutable collections stripped from httpCacheHeaders rules;
      (2) campaign create 500 on blank budget (""→null coercion) + the
      campaigns usage gate added incl. the missing counter in
      checkUsageLimit; (3) org settings PATCH could never save (strict
      schema lacked `settings`) — whitelist-and-merge, privileged keys
      (simulationMode) never client-writable, failures now toast;
      (4) lead create with untouched email field 422'd (""→null);
      (5) Pax send 422'd on legacy agentRole "assistant" (client sends
      "executive", server normalizes the alias) + failed drafts actually
      restored to the composer; (6) plans/upgrade grid moved into the
      Billing tab where every server upgradeUrl deep-links.
- [x] Wedge E2E extended (2026-07-08): email-reply leg proves the REAL
      inbound webhook end to end (HMAC verified for real; unsigned +
      mis-signed asserted 401) → lead_emails + inbox_messages rows,
      lead→responded, activity, thread API, Inbox door API + unread
      counts, /leads/:id surface. Billing-upgrade journey always asserts
      the billing tab + pricing grid + available-plans error recovery,
      and self-activates the real Stripe flow when STRIPE_SECRET_KEY
      lands. Both green locally on pixel-5; run in CI e2e-mobile.
      BONUS FIX the leg exposed: inbound lead emails were INVISIBLE in
      the Inbox door (processInboundEmail wrote lead_emails only; the
      Inbox email tab reads inbox_messages — zero writers). Now writes
      the inbox_messages projection too; go/no-go recipe's "replies land
      in Inbox" promise is true for email as well as SMS.
      Noted, not fixed: (a) /settings#billing auto-opens the
      Compare-plans dialog over the grid (product-look choice);
      (b) processInboundEmail doesn't check `from` matches the lead's
      email — acceptable: routing is per-lead-HMAC-gated, and real
      sellers reply from unpredictable addresses.
- [ ] Credentialed desktop signup E2E in CI (needs founder: Clerk test
      creds as GitHub Actions secrets).

## WS2 — Founder Cockpit (one truthful pane)

Rule: every number is real or explicitly "no data yet." Mobile-first.

- [x] Inventory (2026-07-07): canonical Pulse = `/founder` (home.tsx, The
      Letter door). Also found: money.tsx linked the routeless
      `/founder/cost` (fixed → /founder/admin/costs, where cost.tsx lives
      on as a tab); orphan founder/chat.tsx deleted (ledgered);
      bridge.tsx's competing "canonical home" claim noted.
- [x] No-fabrication fix (2026-07-08): the one fabrication on the
      canonical Pulse — uptime hardcoded 99.9% / budget "green" with zero
      telemetry — is gone. uptimePct nullable end-to-end (pulse, narrate,
      one-line renders "uptime n/a"), envelopeStatus gains honest
      "unknown", tiles render "no data yet". Tests pin it.
- [x] Wired to the Pulse (2026-07-08): wedge tile row (outreach sent /
      replies in / offers made, 7d — campaign_delivery_events, inbound
      messages, offers), 5xx error rate over the durable 24h telemetry
      window, deployed version under the Uptime tile. MRR+WoW, trials,
      spend, envelope+runway were already real. CAC stays on
      /founder/money unit-economics (its correct deep-panel home);
      switch states live behind the Controls door.
- [x] Mobile pass on the cockpit (2026-07-08): all four founder doors
      screenshotted on a Pixel-5 viewport against the production build
      with seeded data and delivered to the founder. Pulse renders the
      honest tiles (Uptime/Errors "no data yet", REAL wedge counts from
      seed data), Controls shows the full switch/trust/connections stack
      cleanly, Decisions + Story render non-blank. No layout defects.

## WS3 — The Brain (Solene as chief of staff)

Exit test: five hard CEO questions, every answer sourced.

- [x] Model catalog + pricing verified via claude-api skill (2026-07-08).
      models.ts already correct (Opus 4.8 $5/$25, Haiku 4.5 $1/$5). Found +
      fixed drift in solene-chat-config: STRATEGIC pointed at stale
      claude-opus-4-7 (→ 4.8, same price, more capable) and carried the OLD
      $15/$75 Opus price (3× cost over-attribution, tripping the $1/turn
      cap early); fast tier carried Haiku-3.5 pricing (4× undercount).
      Founder chat = Opus 4.8 within existing envelopes. DEFERRED
      (post-launch, deliberate): Sonnet 5 exists at the same sticker
      ($3/$15, intro $2/$10) with near-Opus agentic quality — but it
      rejects non-default sampling params, changed tokenizer (~30% more
      tokens/same text), and adaptive-thinking-by-default; a mid-launch
      swap risks 400s at temperature call sites. Fable-tier ($10/$50,
      30-day-retention requirement, refusal handling) also deferred —
      Opus 4.8 is the right brain for the money this week.
- [x] Strategy layer + live state wired into founder chat (2026-07-08):
      contextBuilder gains `strategy_doc` blocks (company docs selected by
      relevance, each labelled [SOURCE: docs/company/…] so answers cite)
      and a `live_state` block (pulse, envelope, trust ledger, open asks,
      runway — absent data rendered as explicit "unknown", never
      invented). server/services/solene/chat/{strategyDocs,liveState}.ts.
- [x] Steer path (2026-07-08): plain-language spend queries answer from
      the REAL capital ledger (7-day + month-to-date vs envelope) with an
      honest can't-read fallback; domain listing wired; pause/resume and
      status verified through the existing steer verbs. Tests extended.
- [x] CEO Q&A eval committed (2026-07-08): 5 hard questions mapped to the
      sources that must ground each answer, asserted against the actual
      context assembly (ceoQuestions.ts + founderChatContext.test.ts).

## WS4 — Gate-Watcher (self-birthing roadmap)

- [x] Machine-encoded (2026-07-08): 14 gates in
      server/services/autopilot/gateWatcher.ts — Phase-1 runbook ($200 MRR
      held 30d, from real mrr_snapshots history; insufficient history =
      gate stays closed, reason logged), Sentry rung ($500), Telnyx eval
      ($3k), the full §4 switch ladder (support auto-resolve →
      dunning/billing → deliverability → content/SEO → ads gated → ads
      execute → self-patch PR → self-patch auto-merge → incident-response
      GA), and the permanent hard-stop gate. MRR reads the SAME source as
      runway (liveMrrDetail).
- [x] Watcher job (2026-07-08): gate_watcher_daily in the job roster
      (09:00 UTC, job-lock guarded, DISABLE_BACKGROUND_JOBS honored);
      ripened gate → founderCollab one-tap Decision, auto-execute only
      where the studio revenue-trigger dial says autoApprove; dedup state
      in founder_settings (no new table/migration).
- [x] Glass-box (2026-07-08): every evaluation logged + persisted for the
      Story surface; hard-stops can NEVER auto-execute regardless of any
      dial — pinned by test (gateWatcher.test.ts, 372 lines).

## WS5 — Launch drills + go/no-go

- [x] Drill: worker-kill (2026-07-08, prod build, kill -9 mid-200-row
      batch). Lease expiry + mutual exclusion PASS; completed rows never
      double-processed. FOUND + FIXED two real recovery bugs: (1) lease-
      contention threw instead of skipping (drizzle wraps the pg 23505 code
      in err.cause — the graceful "lease held by another machine" path was
      dead code; every contended tick became a job failure + DLQ row);
      (2) rows orphaned in status='running' were lost FOREVER (196/200 in
      the drill) — no reaper existed. Added claimed_at (migration 0199 +
      mirror) and an orphan reaper in the worker (boot + every 10 min):
      outward event types (lifecycle_email, cmo.broadcast) fail honestly
      (at-most-once, no double-send), compute types requeue bounded by
      MAX_ATTEMPTS.
- [x] Drill: Stripe webhook replay (2026-07-08). PASS — signed synthetic
      invoice.payment_failed delivered twice: second delivery a proven
      no-op (claimEvent ON CONFLICT guard; counts unchanged, "Skipping
      duplicate event" logged).
- [x] Drill: dunning ladder end-to-end (2026-07-08). PASS — real
      webhook-created event driven through every rung with day-rewinds:
      grace_period → reminder(d2) → warning(d6) → restricted(d8) →
      final_notice(d13) → suspended+auto-downgrade(d15) → cancelled(d22)
      → recovery/auto_recovered. W1.1 scheduled_retry contract held live.
- [x] Drill: panic stop (2026-07-08). PASS — POST flipped all switches +
      quarantined all 5 domains in one call; critical ntfy page fired
      (prio 5, siren); queued dispatch sat untouched for 2.5+ min while
      flipped; resume within 11s of unflip. Flag-binding inventory:
      worker dispatch consumer, brain ACT + cognition branches, operator,
      rootCause, publishArtifact, marketingChannels + SOLENE_PANIC_STOP
      env hard-floor (hands registry, autoWitness, stepAwayReadiness).
      FIXED: the route's log mangled the reason ("[object Object]").
- [x] Alert-spine check (2026-07-08): 24 real pages captured on a local
      ntfy listener. VERIFIED: panic stop, job deadman, error-rate spike
      (+1h dedupe), AI budget breach, SLO fast-burn (SEV-1 auto-opened),
      dunning revenue-at-risk rows, Stripe webhook failure P0, vendor
      credential death. FIXED the one gap: the dispatch kill-cap tripped
      silently — now raises a once-per-month warning through the alert
      spine ("a brake, not a mute"). BLOCKED-BY-ENV (not gaps): email leg
      (no AWS creds locally), VAPID push (no keys), deploy watchdog
      (external CI-side, already proven live 2026-07-07). Known tradeoff
      documented: domain_audit's 23h lease is the once-daily dedupe; a
      mid-run crash costs at most one day's audit.
- [x] Go/No-Go pack written (2026-07-08):
      `docs/company/go-no-go-2026-07.md` — verdict **AMBER-GO** (go for
      the witnessed mail-first $5/day test the moment PR #112 merges; the
      ambers are founder-input-gated or post-launch hardening, nothing
      red). Includes the first-campaign recipe with drilled abort handles.
      Re-verdict on merge + founder inputs.

## Founder inputs (non-blocking; slot in when provided)

- [ ] Clerk test credentials → GitHub Actions secrets (unlocks WS1 last item)
- [ ] DEPLOY_BOT_TOKEN + SENTRY_AUTH_TOKEN → GitHub Actions secrets
- [ ] DNC scrub vendor pick (seam ready; mail-first launch not blocked)
- [ ] Meta ad account for the $5/day witnessed live test

## Status log

- 2026-07-08 ~12:45Z — **Security workflow GREEN on the PR #113 branch**
  (head `375cbdf`) — first green since 2026-07-07. The findings-table
  step named the real culprit on its first run: CVE-2026-48702
  (sigstore/rekor v1.5.0, HIGH) vendored in the gh binary — a gh module
  dep, NOT the Go stdlib, which is why the 1.26.5 toolchain bump alone
  didn't clear it. Fixed by GH_VERSION → v2.96.0 (`b6fa9ff`). Same run
  surfaced the separate CodeQL PR check flagging 1 new HIGH in the new
  billing spec (URL substring/unanchored-regex match on the Stripe
  checkout redirect) — fixed with hostname-exact assertions. PR #113
  merges automatically once deploy-gating checks are green (standing
  authorization below).
- 2026-07-08 ~12:10Z — **Founder granted STANDING merge authorization**
  ("I would like you to automatically be merging"): PRs from launch-week
  work merge automatically once deploy-gating checks are green (CI, Test,
  E2E Mobile, Customer Surface Monitor, Migrate Mirror, Schema
  validation). The Security Gate is not deploy-gating — if red for the
  same cause as main it doesn't block, but its findings-table output must
  be read and the named CVEs fixed. Hard-stops (pricing/legal/>$500/
  customer-data deletion) remain never-automated. The daily routine was
  recreated with this policy (trig_01LEsuNEJdtUhYTjQfkST7vv). GitHub
  native auto-merge is OFF at the repo level; founder can enable it in
  Settings → General → Pull Requests if preferred.
- 2026-07-08 ~02:15Z — **PR #112 merged (founder-authorized) and DEPLOYED
  as `603522f6`**, verified live on acreos.io (`/api/version`). All five
  workstreams' code is in production. Go/no-go verdict recorded in
  `docs/company/go-no-go-2026-07.md`: **AMBER-GO, conditions met** — the
  witnessed mail-first $5/day campaign is cleared. Post-deploy
  verification found one regression (public transparency JSON auth-gated
  by the /api catch-all) — fixed, prod-build-verified, shipping in PR
  #113.

*Maintenance: check items off in place with date + SHA. When all
workstreams are green (or amber with founder-accepted reasons), record the
go/no-go verdict here and close the week.*
