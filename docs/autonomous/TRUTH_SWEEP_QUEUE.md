# Truth-Sweep Queue — user-facing promises vs enforcing code

Workflow `wf_4da5ebc9-504` (2026-09-01): 5 modality finders, 2-lens
adversarial verification, completeness critic. 34 agents, 914 tool uses.

## Batch 1 — SHIPPED 2026-09-01 (all 13 double-confirmed findings)

Copy rewritten to enforced truth (never the invent-a-feature branch), except
finding 3 which got real enforcement: `executeSupportTool` is now the FIFTH
Pax-pause gate (allowlist, fail-closed; `paxPauseSupportGate.test.ts` forces
every case label to be classified). Referral copy now states the real
program ($1 credit on the referred org's first won deal, standard 14-day
trial); whether to enrich the offer to what the old copy promised is a
FOUNDER PRICING DECISION, queued in the picker. `growthAutomation.ts:387-391`
emails a THIRD inconsistent referral offer — queued below.

## Batch 2 — SHIPPED 2026-09-01 (29 of the 36 hypotheses confirmed by the 72-agent verification round; 7 refuted)

14 copy-edits, 9 register-truth updates (incl. five BUILT-NOT-WIRED disclosures:
late-fee non-pyramiding guard, fair-housing scanner, eviction-notice math,
lead-paint predicate duplicate, lease-notice UI), the Letter's needs-you union
now includes frozen sends (narrate.ts + pins), the calibration sentence credits
founder verdicts, escalate_to_human drops its phantom 24h SLA (+ status fixed
to in_progress), the unmounted "Never shared" data-network panel is DELETED
(dead route, zero importers), and leaseNoticeRules got the rollover-parser fix
+ its gate (`leaseNoticeWindows.test.ts`; register entry unit-test;
PROSE_ONLY_BASELINE 3 -> 2).

## Open items after batch 2

- **[HIGH, quality-program] Founder asks are unanswerable in the UI.** The
  Agent-asks page deletion orphaned answer-ask-dialog.tsx /
  supersede-ask-dialog.tsx (zero importers); OpenAsksSection on the Decisions
  door is read-only, and ?id= deep links land unopened. Asks can be answered
  only via /api/founder/asks. Remount the dialogs on the Decisions door
  (route-redirects.ts records the honest state, 2026-09-01).
- **[DONE 2026-09-01] Item 19 — redemptionClock work package**: both doors
  now share the clamped addMonthsIso (moved into redemptionClock.ts; TX
  2025-08-31+6mo = 2026-02-28, was 2026-03-03); parseCalendarDate refusal in
  deadline AND amount math; deed_recordation anchors refuse; first-Monday
  semantics pinned; cross-registry agreement gate with dated LEGAL-JUDGMENT
  conflict register (TN rate, TX period, IA units, DE + TX note/number
  incoherence — the TX '6-month' note conflict was FOUND BY THE GATE on its
  first run); register entry unit-test; PROSE_ONLY_BASELINE 2 -> 1 (the
  last prose-only statute is scra.tolling-and-rate-cap, ungateable without
  implementing SCRA — a founder decision). Nightly redemptionClockRefresh
  will recompute persisted deadlines onto the corrected math.
- **[quality-program] rent-roll deposit clock vs persisted statutoryDeadline**:
  the page computes from lease.endDate and ignores startDepositClock's
  persisted deadline (inspection-date basis) — reconcile the page onto the
  persisted clock (comment records the divergence, 2026-09-01).
- **[founder-attention] BUILT-NOT-WIRED cluster** now honestly recorded in the
  register: wiring any of them (late-fee assessment, fair-housing scan,
  eviction-notice/retaliation math, DB-driven redemption rules) changes
  consequential behavior and is a founder decision.

## Refuted (8)

- `client/src/components/founder-chat/artifacts/trigger_card.tsx` — Card reports "Deferred 7 days." (and "Approved.") after tapping Defer/Approve, posting `{ days: 7 }` to /api/founder/triggers/:id/defer and 

## Pending verification (31 capped + 5 critic) — next verification round

Each item below is a FINDER HYPOTHESIS that has NOT survived adversarial verification yet. Do not act on one without verifying it against the enforcing code first.

- **[user-facing-false]** `client/src/pages/landing/Features.tsx` — "Buy-box agent — Define your criteria once. AcreOS scans listings, parcels, notes, distressed liens, and off-market leads against it within 90 seconds of ingest — forever."
- **[user-facing-false]** `client/src/pages/landing/Features.tsx` — "Pulled lists — Skip-traced, deduped, sorted by likelihood. Pax ships the week's list on Monday at 6am."
- **[built-unwired]** `client/src/components/empty-state.tsx` — "Paste a county list or upload a CSV — Pax scores every new record within 90 seconds and surfaces the top three on Today by 6am." (duplicated in client/src/lib/i18n/locales/en.json:55)
- **[user-facing-false]** `client/src/lib/glossary.ts` — Glossary entry rendered on the public glossary page: "Churn risk — The probability a customer cancels in the next 30 days."
- **[user-facing-false]** `server/services/autopilot/narrate.ts` — The Letter's headline renders "Nothing needs you today." (and founder/home.tsx:220 renders "Nothing needs you right now — the company is running itself.", and quietDay collapses the page to three line
- **[user-facing-false]** `server/services/autopilot/narrate.ts` — The Letter's calibration sentence (rendered on /founder via LetterTrackRecord.tsx:120-123) tells the founder every grade is "based on automatic outcome checks, not your judgment".
- **[user-facing-false]** `server/routes-gdpr.ts` — "You will receive an email within 24 hours when it is ready" (export) and routes-gdpr.ts:131 "You will receive an email within 24 hours confirming completion" (deletion) — echoed to the customer by pr
- **[user-facing-false]** `client/src/pages/goals.tsx` — Goals empty state: "Pax recalculates your weekly pace overnight and flags the morning you fall off track." (headline "Set a target — Pax tracks the pace").
- **[user-facing-false]** `client/src/pages/tasks.tsx` — Tasks empty state: "Pax slides follow-ups in automatically as deals age past 5 days."
- **[user-facing-false]** `client/src/pages/capital-markets.tsx` — Lender-network empty state: "Run a lender match on one of your deals — matched lenders join your network automatically." (and line 752: "matches are pulled from the full lender network").
- **[stale-record]** `server/services/solene/founderCollab.ts` — Module header: "Default timeout: 24h. expireOverdueAsks() runs daily to flip open->timed_out."
- **[built-unwired]** `client/src/components/settings/data-network-settings.tsx` — A customer settings panel promising a "Never shared" data contract (name/email, addresses/APNs, contacts, financial details) plus an opt-out toggle whose off-state reads "Contribution is paused" and w
- **[built-unwired]** `shared/governance/statuteRegister.ts` — regz.late-fee-non-pyramiding presents shouldAssessLateFee() plus the UNIQUE (loan_id, period_start, loan_type) index as the working enforcement of 12 C.F.R. §1026.36(c)(2) ("makes at most one fee per 
- **[built-unwired]** `shared/governance/statuteRegister.ts` — fairhousing.advertising-language: "scanFairHousingText() is a red-flag scanner over listing/ad copy. It flags; it does not block." The failureMode adds "an over-eager scanner trains operators to ignor
- **[built-unwired]** `shared/governance/statuteRegister.ts` — state.eviction-notice-and-retaliation cites server/services/landlordCompliance.ts as the platform's per-state eviction-notice/retaliation implementation; the note says the suite pins the math "so sche
- **[unenforced-gate]** `shared/governance/statuteRegister.ts` — leadpaint.pre-1978-disclosure: "The gate itself has no dedicated test; only the requiresLeadPaintDisclosure(yearBuilt) predicate is covered" — citing tests/unit/landlordCompliance.test.ts as the cover
- **[stale-record]** `shared/governance/statuteRegister.ts` — fcra.permissible-purpose: "Remaining KNOWN GAP pinned in-test: POST /api/tenants CREATE accepts screening fields ungated."
- **[stale-record]** `shared/governance/statuteRegister.ts` — state.usury-ceilings failureMode: "FOUR independent usury tables exist (usury.ts — the only one production actually calls; usuryCeiling.ts — the best-tested and entirely UNWIRED; ...)".
- **[stale-record]** `shared/governance/constitution.ts` — expansion.no-new-persona-verticals note: the toHaveLength(15) assertion sits "inside a test about MAPPING COMPLETENESS ... where the count reads as a fixture detail rather than a founder decision. Som
- **[unenforced-gate]** `shared/governance/statuteRegister.ts` — Entry state.tax-lien-redemption (statuteRegister.ts:724-743) is kind: "prose-only" — "NO TEST covers redemptionClock.ts's deadline arithmetic (including the first-Monday-after-sale anchor) or the per-
- **[unenforced-gate]** `shared/governance/statuteRegister.ts` — Entry scra.tolling-and-rate-cap is kind: "prose-only": "redemptionClock.ts accepts an scraTolling input and discards it... No code applies any SCRA protection." The repo's own audit already prescribes
- **[unenforced-gate]** `shared/governance/statuteRegister.ts` — Entry state.lease-nonrenewal-notice is kind: "prose-only": "NO TEST... the encoded windows themselves are unchecked." Accurate — and the module is pure data + two pure functions, the deposit registry'
- **[unenforced-gate]** `shared/governance/statuteRegister.ts` — Entry leadpaint.pre-1978-disclosure claims "A HARD GATE: a pre-1978 lease cannot be created or moved to an executing status without leadPaintDisclosureConfirmed=true and the lead_paint addendum", kind
- **[built-unwired]** `server/services/redemptionClock.ts` — "The DB version takes priority via loadRulesFromDb() in routes-tax-certificates / routes-tax-rules; this map is the safety net so the math never fails open" (redemptionClock.ts:61-64) — reinforced by 
- **[stale-record]** `shared/governance/statuteRegister.ts` — The state.lease-nonrenewal-notice enforcement note asserts a live honest-default surface: "Unknown states return null and the UI surfaces 'rule for $STATE not in registry' rather than guessing — the h
- **[built-unwired]** `client/src/components/founder/asks/answer-ask-dialog.tsx` — The Decisions door implies the founder can answer or supersede an agent ask: founder-decisions.tsx:710 renders an 'Answer' button linking to /founder/asks?id=N, and the founder_ask card sentence below
- **[user-facing-false]** `client/src/pages/rent-roll.tsx` — Rendered to the customer on every deposit-clock row: "Disposition letter: prepare and send it yourself for now — AcreOS does not generate this letter yet, and will not imply one was sent."
- **[user-facing-false]** `server/services/autopilot/immuneResponse.ts` — The daily immune-system ask (fired in production via startNpmWatchJob, runScheduledJobs.ts:3543-3546/4292) tells the founder: "Reply 'yes' to have fixes prepared as witnessed drafts, or answer with in
- **[built-unwired]** `server/services/solene/founderCollab.ts` — Module header (founderCollab.ts:5-8): the service 'persists the ask, fires the existing pager ... and exposes pollForAnswer() for the asking agent to wait on' — the design story every ask surface lean
- **[stale-record]** `client/src/lib/route-redirects.ts` — The deletion record for the Agent-asks page asserts: 'The Decisions door embeds OpenAsksSection with the same /api/founder/asks answer/supersede flows, so the standalone Agent-asks page was deleted. T
- **[stale-record]** `client/src/pages/rent-roll.tsx` — The deposit-clock section's design rests on: '`security_deposits.statutoryDeadline` has never been populated by any route, so the deadline is computed here ... with the lease's own end date as the mov

### Critic findings (unverified)

- **[user-facing-false]** `server/routes-privacy-dsar.ts` — Public DSAR intake (POST /api/privacy/dsar) responds: next: "Identity verification email sent. Response within 24h of verification." — a past-tense assertion that an email was just sent and that the S
- **[user-facing-false]** `server/routes-gdpr.ts` — POST /api/privacy/export responds "Your data export request is queued. You will receive an email within 24 hours when it is ready." and POST /api/privacy/delete (line 131) responds "You will receive a
- **[user-facing-false]** `server/ai/supportAgent.ts` — escalate_to_human tool result — fed verbatim to the model talking to a paying customer: "This ticket has been escalated to our human support team with full diagnostic context. They will respond within
- **[built-unwired]** `server/routes-dsar.ts` — Public intake generates and stores a cryptographic verificationToken on every DSAR (routes-dsar.ts:131,141; column dsarRequests.verificationToken, shared/schema.ts:7839) — code shape that asserts an e
- **[stale-record]** `server/services/founderActionQueue.ts` — TYPE_TO_ROUTE emits founder todo-feed actionUrls into the retired dashboard's tab model: support_escalation → "/founder-dashboard?tab=support&ticket=N" (line 224), feature_request → "/founder-dashboar

### Also queued from batch-1 verifier corroboration
- `server/services/growthAutomation.ts:387-391` — power-user invite email offers a third inconsistent referral deal ('1 month free per paying referral', '20% off first 3 months'); align with the real program (or the founder's chosen offer).


## Founder decisions (picker, 2026-09-01)

- **Referral program**: research competitor incentives and bring AcreOS's to
  parity — research workflow running; exact terms return to the founder for
  confirmation before implementation (pricing hard-stop).
- **SCRA**: caveat NOW (shipped on redemption-clock.tsx, pinned in
  redemptionDeadlines.test.ts), tolling implementation later with attorney
  input. Register entry stays prose-only.
- **negotiation_sessions**: DROP authorized — EXECUTED as OD-8 tranche 0249
  (2026-09-02): schema model + insert schema + types removed (zero refs
  verified), guarded DROP with row-count evidence in migrate.mjs, table
  added to the od8-ledger array (verdict becomes absent=24/24 once
  dropped), table-count 729→728, internalOnlyExportsShared 429→427, two
  stale reachability allowlist entries removed. The founder ruling covers
  surviving rows; the drop prints rows_at_drop as evidence.

## Learn-pages truth program (2026-09-01, this commit)

- audit-learn-pages.ts was a gate that could not fail (self-source
  circularity; planted fake statute passed 536/536) AND its loader missed
  the 3 county pages entirely. Reworked: citation-declaration pass +
  product-claim-vs-register pass over all 13 pages, probe-verified.
- Nine valueProps advertised statute-specific product features with NO
  implementation (Tex §5.077 generator, Cal §2923.55 workflow, etc. — full
  list in the capability inventory). All nine rewritten to
  inventory-verified plain-language capabilities. FL per-county fee-schedule
  FAQ overclaim corrected (state defaults + Miami-Dade override is the truth).

## Register findings for the turn-19 audit / quality program

- **Register growth tension**: statuteRegister's UNREVIEWED ratchet is
  down-only, so an honestly-implemented statute (TX §5.069/§5.072
  contract-for-deed disclosure blocking — REAL code: disclosureRegistry.ts,
  routes-doc-system.ts:1210, contractAssembly.ts:771) cannot be ADDED to the
  register without breaching the baseline. The register under-reports real
  enforcement; needs a deliberate mechanism (e.g. baseline bump allowed only
  with a dated decision note) — do not resolve unilaterally.
