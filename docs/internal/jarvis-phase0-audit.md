# Jarvis Phase 0 — Audit Findings

_Founder directive 2026-07-13 ("Jarvis-ify Solene"): audit before build. Three
parallel repo-wide audits (memory / perception+proactivity / effectors+
verifier+durability) + the governance/cognition evidence already verified in
docs/internal/solene-kernel-restructure-verification.md. Every claim carries
file:line evidence in those source memos; this report is the synthesis._

_Guiding thesis check: the audit confirms it. The models are not the gap.
The gaps are one unwired verifier, one dormant event stream, one missing
interruption arbiter, and memory the brain can't retrieve._

## Layer-by-layer: what exists vs. missing

### 1. Perception / context — RICH and mostly LIVE
**Exists:** the 30-min Solene tick (`solene/continuousLoop.ts`) fuses, per
cycle: tick metric, morning-pulse state (capital, dispatch activity,
onboarding funnel, compliance, uptime), open founder asks, dispatch backlog,
incident triage, support backlog, reflex/job health, runway forecast. An
outward perception bus (`autopilot/perception.ts` → `autopilot_senses`) is
fed by real webhooks: Stripe (dunning/recovery/churn/dispute/trial), email
deliverability (SendGrid/SES), SMS STOP, Meta lead ads. A dark-sense
watchdog (`senseWatchdog.ts`) pages when any sense goes dark 3 gathers
(~90 min), 24h cooldown.

**Missing:** perception is **money-and-health-shaped, not deal-shaped**. The
v12 event mesh is live infrastructure (publish/subscribe/DLQ/replay, drain
scheduled, 3 system subscribers) but its deal-lifecycle publishers —
`dealDiscovered`, `dealClosed`, `dealUpdated`, `approvalRequested`,
`revenueMilestone`, `marketAlert` — have **zero callers**. Deal-stage
transitions, note payment due-dates, calendar, inbound-email *content*, and
call outcomes never reach the brain.

### 2. Memory — a world model exists; the brain can't retrieve it
**Exists:** the relational CRM *is* the operator's world model (leads →
properties → deals → notes via FKs), with two genuinely accumulating,
admission-controlled logs: `activity_events` (polymorphic per-entity comms
timeline) and `parcel_observations` (immutable widened-fact log, live ETL
writers, consumed by `parcelDeltaDetector` → `parcel_alerts`). A pgvector
registry (`solene_embedded_records`, voyage-3 1024-dim, contentHash dedupe,
HNSW) exists with live retrieval — **but only the `feedback_memory`
namespace** reaches Solene's brain (`contextBuilder.ts:300`,
`dispatchRunner.ts:389`). `deal_patterns.embedding_vector` is the one vector
path over real deal data (idle-throttled by design pre-revenue).

**Missing:** (a) the brain never retrieves the operator's
deals/pipeline/contacts — cross-namespace retrieval
(`memoryRetrieval.ts:250`) is built but explicitly DEFERRED with only test
callers; (b) no operator-preferences store beyond notification/UI/voice
settings — Solene has no persistent model of the operator's stated
preferences or priorities; (c) the v13 cognitive-memory and SCP memory
systems are agent-self-experience keyed by codename, populated only when
founder routes are hit — no autonomous loop writes them, and every SCP
golden-suite/session-log file is 0 bytes.

### 3. Cognition / orchestration — one live loop + three forks (known)
Verified in the kernel-restructure memo: the live actor is the Solene tick
(`runContinuousTick`, 30-min) + the dispatch queue; `companyAgents.ts` is a
live parallel codename roster; SCP agent dirs are dormant stubs; oz is
external. A partial alias bridge exists (4/12 codenames). Consolidation is
work-order step 4 (task #36) — deliberately sequenced with this Jarvis work
because both end at "one actor, one loop, one audit trail."

### 4. Action / effectors — strong, structurally governed, just armed
**Exists:** the hands registry with boot-time invariants (money/
customer-facing/broadcast hands MUST be `requiresApproval:true`; hard-stop
classes can never register); witnessed-tap choke point re-reads panic stop;
hard ceilings ($50 refund cap, $50/day ads, PAUSED-only Meta campaigns,
$25/dispatch cost cap, PR-only self-patch); the outbox worker
(at-least-once compute, at-most-once outward, DLQ) and dispatch queue
(atomic claims, effect-key idempotency, side-effect-aware retry). Dispatch
was armed 2026-07-13 (Tier 1 batch); domains still earn execution through
the observe→…→autonomous ladder.

**Reversibility inventory:** compensations exist where they can (mail
refund-on-failure, pool refunds, PR revert, witness revoke-wins); genuinely
irreversible actions (sends, refunds, charges) are witnessed + capped.

### 5. Governance — the most mature layer
Autonomy tiers enforced OUTSIDE the model (domain seeds at `observe`,
promotion needs 10 clean cycles, demotion on bounce); `SOLENE_PANIC_STOP`
machine-unwritable floor; graduated financial authority ($0–$50K tiers,
Tier 5 always founder); full audit trails (hash-chained witnessed
proofReceipts, activity log, decision ledger); the constitution now carries
the machine-readable objective block (ranking function, founder-minutes
budget, kill criteria) as of amendment v1.1.0.

### 6. Verifier — the keystone, 90% built, dead at the last wire
**Exists:** a code-producing dispatch auto-enqueues a sibling `code_review`
dispatch that runs `npm run check`, reads the diff, and emits
`VERDICT: passed|flagged` (`codeReviewQueue.ts`); `self_debug` and
`adversarial_test` dispatch types exist; SCP LLM judges (armed 2026-07-13,
fails CLOSED) gauntlet evolution deltas; a pre-call constitutional screen
(fails OPEN by design) checks intent.

**Missing — the single most important Phase 0 finding:**
`recordReviewOutcome()` — the function that parses the VERDICT, flips
`review_status`, and fires the flagged→self_debug chain — **has no runtime
caller**. Verdicts are emitted and never consumed; `review_status` stays
`pending` forever; review is observability, "not a gate" by its own comment.
There is NO general "success criteria in → independent pass → block on fail"
seam for consequential dispatches, and no post-action outcome verification
for effectors.

### 7. Durability — strong
ETL watermarks resume; outbox/dispatch atomic claims with orphan reapers;
side-effect-aware retry (only proven-pre-effect failures requeue — correct
at-most-once for outward effects); idempotency keys everywhere that money
moves (mail debitEventKey, auto-top-up hour bucket + Stripe key, dispatch
effect keys). Mid-effect dispatch failure restarts rather than resumes —
acceptable given effect-key idempotency; noted, not a Phase-1 blocker.

## Gap analysis — the 4 things between today and an attainable Jarvis

| # | Gap | Why it's load-bearing | Cost to close |
|---|---|---|---|
| G1 | **Verifier unwired** — VERDICT parser dead code; no success-criteria gate on consequential dispatches | The directive's own keystone; act-and-confirm authority is only trustworthy verified; trust promotions need *verified* clean cycles | **Small** — the loop is 90% built |
| G2 | **Deal-shaped perception dormant** — event-mesh deal publishers have zero callers; deadlines not first-class | "Proactive surfacing of what needs attention" is impossible if deals are invisible to the brain | Small–medium — publishers exist; wire the mutation seams |
| G3 | **No governed interruption arbiter** — siloed channels, per-silo severity vocab, quiet hours unenforced on the founder path | Proactivity-behind-a-policy is a non-negotiable constraint; founder-minutes budget is a metric today, not a gate | Medium — one arbiter in front of existing channels |
| G4 | **Operator memory unretrievable** — brain reads only its own feedback corrections; no preference store; cross-namespace RAG deferred | "Persistent memory that makes it THEIRS" — retrieval quality is the constraint that matters | Medium — scaffold exists (`retrieveCrossNamespaceMemories`, activity_events, parcel_observations) |

(The persona-fork consolidation — step 4 / task #36 — is real but is
hygiene, not a Jarvis capability gap; it rides along with whichever slice
touches the tick loop.)

## Phase 1 — proposed slice (AWAITING FOUNDER GO; no feature code until then)

**The slice: "Verified Act-and-Confirm" — close G1 and make the verifier a
general gate for the three bounded workflows (imports, outreach, the
note-investor vertical).**

**Why this one first:**
1. It is the directive's own non-negotiable keystone ("do not skip it"), and
   it multiplies everything else: G2's proactive surfacing and G4's memory
   both end in *actions*, and actions are only trustworthy verified. Trust
   promotions (10 clean cycles) become meaningful only when "clean" means
   *independently verified*, not "nothing screamed."
2. It is the cheapest gap by far — the machinery is 90% built and dead at
   one wire. This is the definition of attainable.
3. It converts the just-armed dispatch engine from "acting" to "acting with
   a second pair of eyes" in the same week the founder armed it — the right
   safety sequencing.

**Reuses (all live today):** dispatch queue + `review_status` column +
auto-enqueued `code_review` dispatches; `recordReviewOutcome()` (built,
uncalled); `self_debug`/`adversarial_test` chains; the SCP judge pattern
(fails closed) as the template for non-code verification; witnessed-tap
confirm UX; autonomy tiers as the enforcement rail; hash-chained
proofReceipts for audit.

**Net-new required (small):**
1. Wire the VERDICT parser into dispatch completion (call
   `recordReviewOutcome` when a review dispatch completes) — flagged
   verdicts block dependent work + fire the existing self_debug chain.
2. A `successCriteria` field on dispatch enqueue (explicit, human-readable +
   machine-checkable checks) and a generic `verify` dispatch type that
   evaluates OUTCOMES against them — independent pass, fails closed,
   modeled on the judge gauntlet.
3. Tier binding: verification verdicts feed the domain trust ledger, so
   clean-verified cycles (not mere completions) drive observe→act
   promotions.
4. Scope binding: apply to the three bounded workflows first — import jobs
   (verify row counts/integrity post-import), outreach (verify audience,
   caps, compliance gates pre-send + delivery post-send), note-vertical
   actions (verify ledger consistency post-action).

**Deferred with revisit triggers:**
- G2 deal-event wiring → immediately after this slice ships (it feeds the
  verifier its most valuable subjects).
- G3 interruption arbiter → when founder interruptions/week first exceeds
  the constitutional budget of 5 (the tick metric now measures this).
- G4 operator-memory retrieval → after G2, when deal events exist to
  remember; unlock `retrieveCrossNamespaceMemories` then.
- Persona consolidation (task #36) → rides with the first slice that
  refactors the tick loop.

**Phased build (each checkpoint reviewable, working):**
- CP1: VERDICT parser wired; flagged reviews visibly block + self-debug
  (existing tests extended; zero new surface).
- CP2: `successCriteria` + generic verify dispatch; imports workflow gated.
- CP3: outreach + note-vertical criteria; verdicts feed the trust ledger.
- CP4: Letter/tick metric line gains "verified: N/M" so the founder sees
  verification coverage, not just activity.
