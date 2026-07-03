# Autopilot Step-Away Doctrine

*2026-07-03 — full-depth audit of the founder autopilot (Solene) against the
owner's bar: "the platform maintains and operates itself; I can step away and
it brings in users, grows, and compounds ROI."*

The founder autopilot is the machine that runs **AcreOS itself** — support,
billing recovery, deliverability, incidents, growth budget, The Letter.
(Pax is the separate customer-side copilot; it sells subscriptions, Solene
lets the owner leave.) This doctrine grades the machine, records what the
audit proved, and fixes the order of work. It should be updated whenever a
grade changes.

## Grades (2026-07-03)

| Property | Grade | One-line verdict |
|---|---|---|
| Operates itself | B+ | Thinking spine live on a 30-min tick; support auto-resolve genuinely learns; outward touches now flow under bounded founder-issued WitnessGrants (zero grants = founder taps everything, unchanged) |
| Maintains itself | B− | Dispatch retry + DLQ landed; immune system now wired end-to-end (daily audit → gated plan → self-patch PR when earned/enabled → deduped founder ask → honesty ledger). Remaining: founder must set the git/PR envs + flip SELF_PATCH_ENABLED |
| Grows itself | B− | Growth reasoning + budget ramp are real; the paid-ads limb has its first REAL provider (Meta, witnessed, paused-by-default) behind the in-app account link; SEO/content senses exist |
| Evolves itself | C+ | Threshold/autonomy/efficacy loops close automatically; LLM judges + golden-suite regression now gate deltas when armed, and Stage-6 regression checks fire durably (PR mode included); 3-tier memory still unwired; code evolution stops at PRs (by design) |
| Reports to its owner | B+ | The Letter is structurally honest; paging was the weak seam (fixed below) |
| Economics discipline | A− | Fail-closed money gates at every layer; earn-to-ramp +50% steps; hard ceiling 10× base |

## What the audit established (load-bearing facts)

- **The loop is real and scheduled**: `solene_continuous_tick` every 30 min +
  daily Operator cadence, on the worker, job-locked. Dormant-by-default via
  three DB switches (`dispatchEnabled` / `publishEnabled` / `cognitionEnabled`,
  all OFF) under the un-overridable `SOLENE_PANIC_STOP` env floor.
- **Every gate fails closed** on the policy stack (compliance → grounding →
  cost ceiling → domain autonomy → witnessed-send), and the money gates
  (ensemble monthly cap at 90%, $15/day platform ceiling, $5/dispatch) fail
  closed on read errors. The discretionary reserve gate alone fails open —
  acceptable because the hard caps back it.
- **Autonomy is earned**: every domain seeds at `observe`; 10 clean
  resolved-vote cycles + calibration holds to promote; a real-world bounce
  demotes automatically. This is the right trust physics — keep it sacred.
- **The Letter never lies**: deterministic prose from real pulse/asks/trust/
  calibration/runway; "kept watch" while hands are dormant.

## The gap register (ordered for step-away value)

1. **Paging hardened (DONE 2026-07-03).** Production pages no longer fall
   back to the repo-visible public ntfy topic (telemetry leak + void
   delivery); unset env now refuses the push loudly and persists the event.
   Panic-stop page failures now log as errors instead of vanishing.
   *Second channel (DONE, same day):* every page that fails the push —
   transport error OR unconfigured topic — falls back to email via
   `FOUNDER_EMAIL`; the event row records the full delivery path honestly,
   and a both-channels-failed page logs as its own loud incident.
2. **Blind-sense honesty (DONE 2026-07-03).** `gatherContextPack` now tracks
   dark senses; the Operator briefing carries a PARTIAL TELEMETRY block
   ("UNKNOWN, not zero — don't ground plans on it") and the pack exposes
   `degradedSenses`. *Watchdog (DONE, same day):* every gather is recorded on
   the `autopilot_senses` ledger; a sense dark on 3 consecutive gathers pages
   the founder (24h per-sense cooldown) — a persistently blind instrument is
   an incident, not a footnote.
3. **Dispatch retry + DLQ (DONE 2026-07-03).** Bounded, SIDE-EFFECT-AWARE
   retry: `failDispatch(..., { transient: true })` requeues with exponential
   backoff (2/4/8 min via `not_before_at`), capped at `DISPATCH_MAX_ATTEMPTS`
   (3 total runs, counted at claim time), then dead-letters with the
   `[dead-letter]` marker the dispatches page surfaces. Only failures PROVEN
   to precede any side effect classify transient: an ensemble-cap READ
   failure, or a thrown run with `toolCallsExecuted === 0`. Timeouts, cost
   caps, cancellations, and any post-tool failure stay terminal — the
   original at-most-once stance for outward effects is preserved, and the
   orphan reaper still never requeues.
4. **Wire the immune system (DONE 2026-07-03).** The daily `npm_watch` job now
   runs the full chain: audit → `planSecurityResponse` (security rides the
   OPS trust ladder; auto-PR earned at execute_gated+) → `runGatedSelfPatch`
   behind `SELF_PATCH_ENABLED` + a capability preflight (git work tree +
   GitHub credentials — a deployed image without them reports honestly) →
   ONE deduped founder ask for the witnessed class → an
   `autopilot_immune_reports` honesty-ledger row every run, which the board
   report reads as its dependency-health line. The motor opens PULL REQUESTS
   only; CI + deploy gate + founder review still stand. *Still open:* env
   `GITHUB_TOKEN`/`GITHUB_REPOSITORY` must be set where the motor should run,
   and `SELF_PATCH_ENABLED` stays a founder decision.
5. **Witness delegation (DONE 2026-07-03).** The pure `witnessGrant` policy
   engine is now wired per its own integration contract: grants persist in
   `witness_grants` (money + broadcast belts DEFAULT DENIED; ≤30-day expiry;
   revocable instantly from the Control door's Delegation card), and a
   5-minute auto-witness sweep taps frozen pending actions a live grant
   covers — through the SAME approvePendingHand path a founder tap uses
   (hash re-verify, atomic claim, panic-stop re-read, proof-receipt). The
   budget slot is consumed by conditional UPDATE *before* the tap, so a
   revoke wins any race; a money hand with no provable amount in its frozen
   args is never covered; attribution on every receipt reads
   "solene (delegated by <founder> via witness-grant #N)". Zero grants
   issued = exactly the old behavior.
6. **Evolution verifiers armed (DONE 2026-07-03).** Three fixes: (a) the
   LLM-judge gauntlet (constitution/safety triple-Sonnet veto + golden-suite
   regression judge, all fail-closed) now gates every evolution delta when
   the founder arms `SCP_LLM_JUDGES_ENABLED`; heuristic gates remain the
   floor either way. (b) Stage-6 regression checks run from a PERSISTED
   due-time via the 10-min `evolution_regression_scan` job (claim-by-nulling,
   exactly-once) — the old in-process `setTimeout` died on redeploy; the
   scanner also polls open evolution PRs (when GitHub creds exist) so a
   founder MERGE arms the check and a close-unmerged abandons the row —
   Stage 6 now fires in PR mode for the first time. (c) SECURITY: the whole
   `/api/scp/v2` surface (trust promote/demote, evolution pause/resume/
   rollback) had NO auth — now behind a prefix-level founder guard, plus a
   founder-triggered `POST /evolution/run` (honest batch: consolidation now,
   per-delta evolution when interaction capture lands). *Still open:*
   interaction-capture seam so batch runs can feed real sessions into
   `runEvolution`.
7. **Growth limb (DONE 2026-07-03).** The Meta adapter is the first real ad
   provider, registered into the adProvider seam and riding the meta_ads
   Platform Connection (OAuth login + ad account id, linked in-app). Every
   witnessed execution creates a REAL campaign — always `status=PAUSED`
   (the machine prepares spend end-to-end but can never start it; the
   founder activates in Ads Manager), always `special_ad_categories:
   ["HOUSING"]` (land/property is housing-class under Meta policy), daily
   budget bound attached. Unlinked = the same honest draft-only result as
   before. Google Ads is prewired at the connection layer for a second
   adapter.
8. **Retire or wire the SCP dead weight.** The 3-tier memory system and SCP
   auto-rollback are advertised but inert; either connect them to the live
   loop's memory recall / config versioning or delete them so the map stays
   honest. *Model pins centralized (DONE 2026-07-03):* `models.ts` now also
   exports bare-SDK `ANTHROPIC_MODELS` (derived, lockstep by construction);
   the stale pins in paxModelTier (Opus 4-7), selfAssessmentAgent +
   evolutionPipeline (Opus 4-6!), founder-chat model-selector, llmJudge
   (undated Haiku alias), complianceValidator, dispatchRunner, byok, and the
   pre-call checker all resolve through it — with the dispatch pricing table
   updated to real Opus 4-8 rates ($5/$25, was billing 4-7's $15/$75) and a
   legacy 4-7 row kept for old per-dispatch pins.
9. **Planner integration.** `planner.ts` (multi-step plans + commitment
   ledger) is pure, tested, and unimported — the loop still picks one move
   per tick. Integrate when items 3–5 land; multi-step commitment without
   retry/delegation would just queue more founder taps.

## Platform Connections (2026-07-03)

Connecting the accounts the platform runs on is now NATIVE: the Connections
card on the Control Center (`platformConnections.ts`, built on the BYOK
vault's storage discipline) stores founder-pasted credentials AES-256-GCM
encrypted, displays secrets as …last4 only, and resolves DB-FIRST with env
fallback — a pasted key is live immediately, no Fly secret, no redeploy, and
a broken connections layer degrades to env (never takes down a working
service). Live Verify hits each provider's real API. Wired consumers: the
self-patch motor + evolution PR polling (GitHub), the pager (topic + email
fallback), and the step-away readiness checks. The ad accounts (gap #7) are
PREWIRED as OAuth: save the Meta app / Google OAuth client credentials, tap
Connect, log in with the real account — tokens store encrypted server-side;
`run_ad_campaign` stays draft→witnessed regardless.

## The founder's operating surface (2026-07-03)

The "can I leave?" question now has ONE machine-verified answer:
`GET /api/founder/autopilot/step-away` (`stepAwayReadiness.ts`) audits the
same switches/gates/ledgers the runtime obeys — panic stop, two-channel
reachability, loop health, budget discipline (critical, gate the verdict) +
decision queue, delegation coverage, dead letters, immune motor (worth-doing).
An unreadable signal is NEVER shown green. It renders as the expandable
card at the top of the Control Center and as a one-line verdict on the
Letter, each item carrying its plain-language fix and a deep link. The
runway number is the Trust Ledger's earned-autonomy horizon — no marketing
figures.

## Operating invariants (do not regress)

- Panic stop stays env-level and unwritable by the machine.
- New outward hand ⇒ `requiresApproval: true` at registration (registry
  invariant) until its domain earns promotion.
- Learning that changes behavior must close through the experience log's
  outcome ladder — never through unlabelled estimates (`shadowRegret`'s
  SACRED LINE stands).
- The Letter reports what happened, never what was intended.
