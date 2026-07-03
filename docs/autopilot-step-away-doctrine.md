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
| Grows itself | C− | Growth reasoning + budget ramp are real; the paid-ads limb has **no provider** (drafts only); SEO/content senses exist |
| Evolves itself | C | Threshold/autonomy/efficacy loops close automatically; LLM judges + golden-suite regression + 3-tier memory are **unwired**; code evolution stops at PRs |
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
   *Still open:* a second notification channel (email/SMS via existing
   integrations) so one transport outage can't silence a critical page.
2. **Blind-sense honesty (DONE 2026-07-03).** `gatherContextPack` now tracks
   dark senses; the Operator briefing carries a PARTIAL TELEMETRY block
   ("UNKNOWN, not zero — don't ground plans on it") and the pack exposes
   `degradedSenses`. *Still open:* the loop-stall watchdog should also page
   when the same sense stays dark across N consecutive gathers.
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
6. **Arm the evolution verifiers.** The LLM-judge stack + golden-suite
   regression never execute (no caller). Minimum viable: a founder-triggered
   batch-evolution run from the Controls door; judges gate, founder merges.
   Also: replace the in-process `setTimeout` regression check (lost on
   redeploy, never armed in PR mode) with a persisted due-time scanned by the
   jobs catalogue.
7. **Give growth a real limb.** `run_ad_campaign` has zero providers —
   register the first real provider behind the existing draft→witnessed
   ladder. Until then "bring in users" rests entirely on content/SEO.
8. **Retire or wire the SCP dead weight.** The 3-tier memory system and SCP
   auto-rollback are advertised but inert; either connect them to the live
   loop's memory recall / config versioning or delete them so the map stays
   honest. Model-pin drift (opus-4-6/4-7/4-8 across files) should centralize
   into one models module.
9. **Planner integration.** `planner.ts` (multi-step plans + commitment
   ledger) is pure, tested, and unimported — the loop still picks one move
   per tick. Integrate when items 3–5 land; multi-step commitment without
   retry/delegation would just queue more founder taps.

## Operating invariants (do not regress)

- Panic stop stays env-level and unwritable by the machine.
- New outward hand ⇒ `requiresApproval: true` at registration (registry
  invariant) until its domain earns promotion.
- Learning that changes behavior must close through the experience log's
  outcome ladder — never through unlabelled estimates (`shadowRegret`'s
  SACRED LINE stands).
- The Letter reports what happened, never what was intended.
