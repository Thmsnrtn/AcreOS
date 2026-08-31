# Stage 4 — the adopted consolidation design (competing-brains)

**Provenance.** Produced 2026-08-28 by a judged design workflow: three plane
maps (memory, trust/authority, execution — every claim cited file:line),
three independent designs from different priors, four judging lenses
(live-behavior preservation, proof obligations, loop economics,
institutional fit). Tally: **B (strangler-fig) 34 · A (incumbent-absorbs)
26.5 · C (capability-seams) 26.** B adopted; one graft; one refusal:

- **GRAFTED from A** (the panel's institutional-fit strongest): the
  approve-tap-IS-the-witness unification — for send-class decision cards,
  `decisionsInbox.approve` composes `proposePendingHand` +
  `approvePendingHand` + `executeHandWitnessed` in one founder tap (one tap,
  hash-bound receipt, panic-stop re-read, `autopilot_sends` audit; no
  double-tap UX). Execute it inside Phase 1 in B's one-caller-per-turn
  style, after turn 9's must-be-zero flip.
- **REFUSED from C**: the `shared/contracts/` triple-interface layer.
  Interfaces with exactly one implementation each, erected in a campaign
  whose purpose is deleting the second implementations —
  `docs/esign/PROVIDER_BOUNDARY.md`'s recorded ruling ("an interface with
  one implementation is not an abstraction") forbids exactly this.
- **GENERALIZED from the judges' criticism of A**: ANY retirement of a live
  scheduled job gets a shadow/observation window first — B grants this to
  the trust flip (turn 11's week of dual-verdict divergence telemetry); it
  is hereby the rule for every engine retirement in this program, not a
  per-stage courtesy.

The full runner-up designs and the three plane maps live in the session
workflow record (wf_2ce110bb-73d); this document is the executable program.

---

# Stage 4 — Competing-brains consolidation onto the autopilot+solene plane

Method: strangler fig (PRIOR B). Every stage is one loop turn, never breaks a live path, puts a seam in front of a duplicate before touching callers, moves callers one at a time, deletes husks last. Table drops never happen in these turns — they accumulate on a founder OD-8 list (section 3). Hard-stops (`server/services/autopilot/hardStops.ts` single source) and the four founder doors are invariant throughout; `FOUNDER_ROUTE_BASELINE` in `tests/unit/founderFourDoors.test.ts` is lowered in the same commit as every founder-route deletion.

Explicitly OUT of stage 4: `supportAgent.ts`'s 76-case switch (named follow-up, per CLAUDE.md); the tenant-scoped `agent_memory` store (different axis — one safety pre-req is folded into Decision A below); `solene_memory_files`; `companyMind.ts` (dissolves by itself once the inbox lane fully converges — nothing to migrate now).

---

## 1. End-state per plane

### 1a. Outward customer email — ONE lane
**Canonical:** hands registry (`server/services/autopilot/hands/index.ts`) → `pendingHands.proposePendingHand` freeze into `autopilot_pending_actions` → founder tap (`routes-autopilot.ts:848-907`) or `autoWitness` sweep under a founder witness grant → `executeHandWitnessed` → `autopilot_sends` append-only audit.

**Duplicates and their fate:**
- `agentActionExecutors.ts`'s five email actions (send_retention_email :132, send_churn_rescue :198, send_upgrade_nudge :488, schedule_call :506, send_guided_walkthrough :544) — become proposals through a new seam, `server/services/autopilot/outboundSeam.ts`. The `organizationId`-as-sender-identity selection is dropped in the move: mail from AcreOS to an org's own operator is SYSTEM mail (2026-07-17 purpose-lanes ruling), platform identity — using the org's BYO identity to email the org's own owner was the anti-pattern, not a feature to preserve.
- `autonomousDecisionExecutor.ts`'s churn_risk_intervention / dunning_recovery direct emails (:496-503) — same seam.
- `executionEngine.ts`'s phantom sends (send_follow_up :49-65, send_churn_intervention :203-220) — become explicit refusals (refuse-not-fabricate); the `lastContactedAt` update goes too (it fabricates a contact event).
- Cadence is preserved by founder-issued standing witness grants (per-class budget, TTL, $500 clamp untouched); with no grant, honest inbox cards — never a silent send, and never a silent drop (expiry telemetry, section 2 turn 5).

The seam (`outboundSeam.ts`) is a thin facade: `proposeGovernedEmail({orgId, recipientUserId, subject, body, purpose, source})` — runs the same fail-closed counterparty predicate as `hands/send-email.ts:74-119` and the suppression pre-check, then freezes via `proposePendingHand("send_email", …)` with source attribution (`"agentActionExecutors:send_retention_email"` etc.) carried into the payload and the proof-receipt chain.

### 1b. Support replies — one writer
Two customer-visible writers today (`autonomousDecisionExecutor.ts:460-471`, `agentActionExecutors.ts:165-172`) converge on one canonical module `server/services/customerComms/supportReply.ts`, preserving the confidence-cascade gate. Hand-ification (a witnessed `support_reply` hand — the registry invariant would correctly force `requiresApproval:true` on it) is Decision B, recommended but not forced in stage 4.

### 1c. Agent-action execution — executionEngine survives narrow; the orchestrators retire
- **`executionEngine.ts` stays** as the single executor for the decisions-inbox/initiative lane (initiative 30-min job, finalMile 30-min + 5-min jobs), with honest receipts and its trust gate repointed per 1d. Its fail-closed `validateSafetyGates` posture is preserved verbatim.
- **`sagaOrchestratorV12.ts` — deleted.** Only callers are founder HTTP routes (`routes-founder-real-runtime.ts:183-214`); no job or event source creates sagas. The `orgId: 0` platform-sentinel violation dies by deletion, which is cheaper and safer than fixing it. `saga_instances` → drop list.
- **`reactiveOrchestrationV14.ts` — deleted.** Boot seeding removed from `autonomyBootstrap.ts` (:28-160, :302); `POST /api/founder/v14/events` (`routes-founder-self-running-company.ts:64`) removed. The chain intents that matter already live on the incumbent plane (payment.failed → `webhookHandlers.ts:281`; bounce → `routes-ses-events.ts:206` with autonomy demotion; gateWatcher). `reaction_chains` → drop list.
- **`selfHealingExecutor.ts` — deleted** (zero callers; only reference is `tests/unit/executionEngineHonesty.test.ts:7`, which is rewritten, not deleted).
- **`actionLadder.ts` + `domainLadders.ts` — deleted** (zero production callers); `DEFAULT_AUTO_RESOLVE_THRESHOLD` moves into `learnedGates.ts` (its only production import).

### 1d. Trust/authority — one ledger, one primary delegation rail
- **`autopilot/domainAutonomy` is the only trust ledger.** New adapter `server/services/autopilot/trustSeam.ts` maps agent actions → autopilot policy domains (reusing the honest domain mapping in `act.ts:390-395` / `moveToPolicyAction`) and answers allow/escalate/block from domain levels. Fail-closed: unmapped action ⇒ escalate, never pass; hard-stop classes structurally unmappable (the `NEVER_PROMOTE_ACTIONS` derivation from `hardStops.ts` already pinned by `agentAuthorityCeiling.test.ts` + `hardStopLaneCoverage.test.ts` stays).
- **Lane 3 migrates, not deletes:** `executionEngine.validateSafetyGates`'s tier check (:415-430) and `agentAuthorityGate`'s stored-score read (:114-116, :271-279) both flip to the seam — after a shadow-comparison period (section 2 turn 11). Then the mutation machinery retires: `trustEvolution` weekly job (`runScheduledJobs.ts:2301-2321`), `trustAuthorityEscalation.ts`, `/api/scp/v2/trust` promote/demote (`routes-scp-v2.ts:208-269`), `companyAgents.updateTrustScore`. `ceoAbsenceMode` trust boosts lose their only consumer at the flip — the absence concept re-expresses as founder-issued witness grants (Decision C) or simply retires.
- **Lane 2 (`trustEnforcementV12.ts` + `tenantFabricV12.ts`) — deleted outright.** Ledger-only: one HTTP call site, zero engine callers, zero jobs, `trustFloor`/`trustCeiling` read nowhere live. `trust_enforcement_log` + `tenant_agent_config` → drop list; `governance.tsx` Trust-log tab (:203/:244/:323-380) + `use-sovereign-dashboard.ts:178-183` slice retire (Decision D).
- **Lane 4 (`delegationTokensV11.ts`) — retired; its one live check preserved as structure.** `executionEngine.ts:433-443` becomes an explicit structural escalate for advance_deal_stage / flag_deal_risk (today's behavior IS a constant deny — no tokens are ever granted outside a founder curl — so behavior is preserved exactly, now honestly). Service + `/api/founder/v11/delegations*` (`routes-founder-anticipatory-enterprise.ts:141-186`) deleted; `delegation_tokens` → drop list.
- **Delegation rails end-state: two, deliberately.** `witnessGrant` (money/send delegation — the incumbent, with the $500 clamp above any ceiling) and `temporaryDelegation.ts` (agent-authority delegation — live inside `agentAuthorityGate.ts:179-180` and the only rail with a real client surface, `DelegationManager.tsx`). They collapse to one only if/when `agentAuthorityGate` itself dissolves in a later campaign; forcing it now would break a live founder UI for symmetry's sake.

### 1e. Memory — two substrates; the V13 tower drained
- **Canonical:** `autopilot_experiences` (tick episodic/procedural/causal — untouched) + `solene_embedded_records` RAG (dispatch prompts, founder chat, precedents — untouched).
- `confidenceCascadeV14.ts:298`'s memory-lookup layer (the ONLY genuinely consulted V13 capability) repoints to solene retrieval via `memoryRetrieval` cross-namespace search — it already reads the solene corpus for precedents at :582, so this completes an existing wire. Honest-empty on zero results: the cascade proceeds to its next layer, never fabricates recall.
- Remaining V13 writers convert or die with their surfaces: `executionEngine` store_learning (:254-273) → `embedDocumentTextFailOpen` (feedback_memory namespace); `agentDebates.ts:369` recordEpisode → embed; `trustAuthorityEscalation` extractFact dies with lane 3; `feedbackLoopV14` / `reactiveOrchestrationV14` writers die with their routes/services; `autonomyBootstrap` DEFAULT_MEMORIES seeding removed.
- `routes-founder-sentient-enterprise` (`/api/founder/v13`) and `scpMemorySystem`'s episodic writes (via `routes-scp-v2`) retire (Decision F). Then `cognitiveMemoryV13.ts` deletes after in-commit zero-caller grep. Tables `agent_episodic_memory`, `agent_semantic_memory`, `agent_working_memory_v13`, `memory_access_log` (write-only, zero readers anywhere) → drop list.
- `agent_memory` untouched — but one safety edge is handled inside Decision A: sends migrating into the hands lane must remain visible to a daily cap. `autopilot_sends` + witness-grant budget (consumed by conditional UPDATE before the tap) become the counter of record for hands-lane sends; `autonomyGuardrails.countTodaysSends` (:47-54) keeps covering whatever still sends outside the hands lane.

---

## 2. Ordered stages — one loop turn each, with verification and rollback

**Phase 0 — gates before movement (the three laws demand the ratchet exists BEFORE the migration it certifies)**

- **Turn 1 — DONE 2026-08-28.** Both gates landed and were falsified by
  mutation (growth red, unrecorded-migration red). The census corrected the
  design twice, exactly as R3 predicted: the agent-autonomous EMAIL class is
  **7**, not 6 — `agent-skills.ts`'s sendEmail skill sends a model-composed
  recipient with NO autonomy gate, NO TCPA, NO rate envelope, the least
  governed send lane in the repo (now frozen shrink-only with the other six);
  and `supportTicketMessages` has **7 writer files / 11 sites**, not 2 — the
  design's two are the agent-autonomous subset, and the register now
  classifies all seven lanes (human, founder, pax-governed, cascade-gated,
  agent-autonomous). `ai/tools.ts` is classed pax-governed, NOT
  agent-autonomous: it runs its own draft-for-approval ladder + rate + TCPA
  (tools.ts:1950-1985) — a parallel approval lane whose convergence with
  pendingHands is later-stage material. Original spec follows.
- **Turn 1 — population ratchets.** New `tests/unit/outboundEmailChokepoint.test.ts`: enumerate EVERY `emailService.sendEmail` call site in `server/` (80 occurrences / 45 files today — the population is far wider than the five planes, which is exactly why the register lives in the test). Classify each in an in-test register: `system-mail` (digests, billing, alerts, sequenceProcessor, growthAutomation, …), `witnessed-hand` (`hands/send-email.ts`), `agent-autonomous` (`agentActionExecutors.ts` ×5, `autonomousDecisionExecutor.ts` ×1). Assertions: any unregistered call site fails; per-member vacuity (a registered file whose parser finds zero calls fails — a silently-unmatched member reads exactly like a clean one); `agent-autonomous` baseline = 6, shrink-only. Second test `tests/unit/supportReplyChokepoint.test.ts` enumerating customer-visible support-message insert sites (baseline 2). Falsify by mutation before merging: add a scratch `sendEmail` call, watch red. Verify: `npm run check && npm test`. Rollback: pure test addition, revert.
- **Turn 2 — zero-caller deletions (stage-2 pattern).** Delete `selfHealingExecutor.ts`; `actionLadder.ts` + `domainLadders.ts` (constant → `learnedGates.ts`); `crisisLeadershipEngine.adjustTrustScores`; `ceoAbsenceMode.transitionToMissionMode`. In-commit grep proof of zero callers for each. Rewrite (never delete) pinning tests: `executionEngineHonesty.test.ts`, `autopilotActionLadder.test.ts`, `autopilotLearnedGates.test.ts` — the invariant survives, the assertion changes. Rollback: revert; no data touched.
- **Turn 3 — honest receipts.** `executionEngine` send_follow_up / send_churn_intervention become refusals naming the missing capability; the `lastContactedAt` write goes (fabricated contact). `executionEngineHonesty.test.ts` gains a mutation-hardened assertion: an executor returning a "sent" receipt without a hands proposal fails. Rollback: revert.

**Phase 1 — the outbound seam**

- **Turn 4 — build `outboundSeam.ts`, move nobody.** Facade + unit tests (fail-closed counterparty predicate identical to `send-email.ts:74-119`; suppression; attribution payload; panic-stop respected downstream by `executeHandWitnessed` re-read). Ratchet unchanged. Rollback: dead code, trivial revert.
- **Turn 5 — DONE 2026-08-29.** Decision A RULED via the founder picker:
  GRANTS FOR ALL (OD-9 DECIDED). Seeded by migration 0240 (+ migrate.mjs
  mirror): one support-domain grant to solene — covers the send_email/
  send_sms/send_push hands, 300 actions / 30-day TTL, deny_money +
  deny_broadcast ON, idempotent by ruling tag, revocable from Controls.
  Visibility: pendingHandCounters() feeds a frozenSends strip on the Story
  route and a Letter line that stays silent on null/quiet and calls out
  EXPIRED-unseen loudly (driven tests, silent/traffic/expiry). Original
  spec follows.
- **Turn 5 — DECISION A (no caller flips before this) + expiry telemetry.** Present the witness-grant plan (section 3). Build, in the same turn, the pending-hand visibility counters: proposed / tapped / auto-witnessed / expired-unseen, surfaced on Story (`getRecentStory` lane) and the Letter — so a frozen send can never silently die at the 24h TTL without the founder seeing the count.
- **Turn 6 — DONE 2026-08-29.** send_retention_email flipped onto the seam:
  the send freezes with source attribution, the OD-9 grant (live from
  deploy #22) releases it within ~5 min, and the executor reports the
  frozen truth ("frozen as pending action #N"), never "sent". Chokepoint
  baseline 7 -> 6 in the same commit. Rollback = revert one commit;
  every other caller untouched (the strangler property).
- **Turn 7 — DONE 2026-08-29.** send_churn_rescue + send_upgrade_nudge
  flipped onto the seam (same shape as turn 6): frozen with attribution,
  honest frozen-truth receipts, sender-identity arg dropped. Chokepoint
  baseline 6 -> 4; outward-coverage 59 -> 57; both in this commit.
- **Turn 8 — DONE 2026-08-29.** schedule_call + send_guided_walkthrough
  flipped; agentActionExecutors is FULLY off the direct email rail
  (per-file count 0). Chokepoint 4 -> 2; outward-coverage 57 -> 55.
- **Turns 6–8 — move plane-5 email actions, one or two per turn** (6: send_retention_email; 7: send_churn_rescue + send_upgrade_nudge; 8: schedule_call + send_guided_walkthrough). Each turn: caller flips to the seam; direct `emailService.sendEmail` call removed; ratchet baseline lowered IN THE SAME COMMIT (wave rule 5); behavioral test asserting the action yields an `autopilot_pending_actions` row and zero direct email; the 2-min (`agentReactionEngine`) and 5-min (`agentProactiveEngine`, incl. send_churn_rescue's 3-orgs-per-run) cadences keep running as proposal producers. Rollback: revert the single-caller commit — hand path and every other caller unaffected (the strangler property).
- **Turn 9 — DONE 2026-08-29; the class is CLOSED at MUST-BE-ZERO.** The
  executor's churn branch flipped onto the seam (intervention log now
  records "proposed", never "sent", for a frozen action). Reading
  agent-skills for its flip RECLASSIFIED it instead: its send carries
  purpose:"counterparty", which emailService refuses without the org's own
  BYO identity — a counterparty lane on the org's own rail, wrong chokepoint
  for the system-mail seam. Its residual gap (no autonomy/TCPA gate on a
  model-composed recipient) was SKILL-LANE FOLLOW-UP — EXECUTED 2026-08-30:
  the skill now wears the pax lane's exact belts (autonomy level, daily
  envelope, TCPA-on-lead, recordAutonomousSend into the audit envelope),
  with one deliberate difference — at assisted it REFUSES naming the
  route, because every skill caller is an autonomous engine and a draft
  would queue where nobody looks. `skillLaneSendGovernance.test.ts` pins
  all four belts and was mutation-falsified (disabling the level gate
  kills exactly its case). The supportAgent 76-case switch is separately
  covered by paxToolsReportRealEffects' TOOL_SWITCHES enumeration
  (verified 2026-08-30).
  Chokepoint: agent-autonomous = 0, forever. Outward-coverage 55 -> 54.
- **Turn 9 — move plane-3's two email branches** (`autonomousDecisionExecutor.ts:496-503`) to the seam (low live risk: `AUTONOMOUS_EXECUTOR_ENABLED` defaults off). Ratchet hits zero → flip its assertion from shrink-only to MUST-BE-ZERO. This gate now enforces "agent-initiated customer email goes through the witnessed hand" — if that covers a prose-only hard-stop in `shared/governance/constitution.ts`, reclassify it and lower the unenforced-hard-stop baseline in `constitution.test.ts` in the same commit.
- **Turn 10 — DONE 2026-08-29 (out of order; independent of Decision A).**
  `customerComms/supportReply.ts` is the one agent writer; both callers
  flipped; the chokepoint is MUST-BE-ZERO. The convergence found the lane
  had NEVER WORKED: both inline writers inserted senderId/senderName/
  messageType/isInternal behind `as any` — columns support_ticket_messages
  does not have — so NOT NULL `role` went unfilled and every insert threw.
  The `as any` was the whole defect; the canonical writer uses the real
  schema shape uncast, so drift is a compile error. Decision B stands
  recorded (hand-ification optional). Original spec follows.
- **Turn 10 — support-reply consolidation.** Create `customerComms/supportReply.ts`; both writers call it; `supportReplyChokepoint.test.ts` pins the single writer. Record Decision B.

**Phase 2 — trust convergence**

- **Turn 11 — SHIPPED 2026-08-29; the shadow CLOCK starts at this deploy.**
  trustSeam.ts computes the domain-ledger verdict beside BOTH live gates
  (executionEngine.validateSafetyGates and agentAuthorityGate.checkAuthority
  via a wrapper), fire-and-forget, zero behavior change. Fail-closed at
  every edge (hard-stop ids structurally blocked; unmapped escalates; ledger
  failure escalates), 6 driven tests including the direction accounting.
  Counters at GET /api/admin/trust-seam-shadow (founder-gated).
  EVIDENCE-PERSISTENCE CORRECTION (2026-08-31): the original design called
  the divergence logger.warn "the durable record" — false. Fly log
  retention is minutes-scale and the counters were process memory zeroed on
  every deploy; at several deploys/day the ≥1-week window was structurally
  unreadable (the same positional log-loss the OD-8 evidence mechanism had
  already proven on deploys #42-#46). shadowCompare now persists every
  divergence and periodic boot-keyed counter flushes into jobHealthLogs,
  and the admin endpoint aggregates them across boot sessions
  (`durable.{comparisons,seamLooser,seamStricter,bootSessions}` over
  ?sinceDays). CONSEQUENCE: durable evidence accrues only from this
  change's deploy — the flip window restarts, maturing ~2026-09-07.
  THE FLIP RULE: turns 12-13 are licensed by ≥1 week of DURABLE cadence
  evidence with seamLooser = 0 and a non-vacuous comparison count; any
  seam-LOOSER divergence blocks the flip and reopens the
  ACTION_DOMAIN_MAP. Original spec follows.
- **Turn 11 — `trustSeam.ts` in SHADOW mode.** On every gate evaluation in `executionEngine.validateSafetyGates` and `agentAuthorityGate.checkAuthority`, compute BOTH verdicts (companyAgents tier vs. domain-ledger mapping) and log divergence via structured `logger` with a counter readable in the `/founder/admin/*` namespace. Zero behavior change. Run ≥1 week against the real 2-min/5-min/30-min cadences. Verify: divergence telemetry populating; gates green.
- **Turn 12 — flip `executionEngine.validateSafetyGates` (:415-430) to the seam.** Fail-closed preserved: unknown agent, unmapped action, seam error ⇒ block/escalate — a check that cannot run is not a check that passed. Mutation-test per law 1: set the mapped domain to observe → refusal appears; to execute_gated → pass; delete a mapping entry → escalate. Rollback: revert (shadow logs retained as evidence either way).
- **Turn 13 — flip `agentAuthorityGate`; retire lane-3 mutation machinery; fix the UI in the same turn.** The flip is behavior-preserving by construction (every live proactive/reaction action is unclassified → level-2 escalate today; assert exactly that survives). Then: unregister `trustEvolution` weekly job (`runScheduledJobs.ts:2301-2321`); retire `trustAuthorityEscalation.ts`; remove `/api/scp/v2/trust` promote/demote (Decision C); repoint or remove client `trustScore` renderings (`agent-performance.tsx`, `agent-detail.tsx`, `founder/inspector.tsx`, `founder-trends.tsx`, `command-palette.tsx`) — SAME turn as the job retirement, so no surface ever renders a frozen score as live (fabrication-adjacent). ceoAbsence boosts retire or re-express per Decision C.
- **Turn 14 — DONE 2026-08-30.** `delegationTokensV11` retired: the
  delegation check in `executionEngine.validateSafetyGates` became an
  explicit structural escalate for advance_deal_stage / flag_deal_risk
  (`safetyGateFailClosed.test.ts` pins that both still cannot execute
  autonomously with every dependency healthy, and that the gate cannot be
  unevaluable — it names no service). Service deleted, seven v11
  delegation routes replaced by a tombstone, `delegation_tokens` model
  removed, migration 0245 (OD-8 batch 5) drops the table conditionally.
  `temporaryDelegation` + `witnessGrant` remain the two delegation rails.
  Original spec: `executionEngine:433-443` → structural escalate; delete
  service + v11 delegation routes; `delegation_tokens` → drop list.
- **Turn 15 — DONE 2026-08-30.** Lane 2 deleted whole under Decision D
  (founder picker: "Remove tab + lane"): trustEnforcementV12.ts,
  tenantFabricV12.ts, the 7 trust + 7 tenant v12 routes (tombstoned; the
  shared v12 auth gate survives for the six remaining sections), the
  governance Trust-log tab and its useTrustEnforcement slice, both schema
  models. In-commit grep clean (only tombstone prose remains). Migration
  0246 (OD-8 batch 6) drops trust_enforcement_log + tenant_agent_config
  conditionally. An adversarial re-proof workflow ran BEFORE deletion and
  enumerated every tripwire (inline-provenance signal lines, ratchet
  deltas −14 colon-any / −2 tables, route-manifest and smoke-test
  survivability) — and its client-lens hunt exposed a TURN-14 MISS, fixed
  in this same commit: useDelegationTokens still fetched
  /api/founder/v11/delegations/active (deleted with turn 14), so the
  governance Delegation tab had been error-carding in production for one
  deploy cycle. Symbol greps miss URL-string consumers; every route
  retirement must grep the PATH too — recorded as method. DISCOVERED,
  deferred with a pointer: the governance Overrides and Confidence tabs
  fetch /api/founder/v14/feedback/overrides and
  /api/founder/v14/confidence/recent, neither of which exists server-side
  (fail-soft empty renders, per their hooks' own comments) — the
  governance page's remaining fix is its own turn.
  Original spec: delete lane 2; `trust_enforcement_log`,
  `tenant_agent_config` → drop list (doc's cited line ranges were stale;
  the audit's ranges were used).

**Phase 3 — orchestrator and memory retirement**

- **Turn 16 — DONE 2026-08-29.** sagaOrchestratorV12 +
  reactiveOrchestrationV14 deleted; boot seeding removed from
  autonomyBootstrap; the v14 REACTIVE section and the v12 SAGA section
  replaced by tombstones naming the incumbent event intents
  (webhookHandlers payment.failed, ses-events bounce demotion,
  gateWatcher). The orgId:0 saga sentinel died by deletion. Zero live
  references verified by grep. Third OD-8 tranche recorded —
  reaction_chain_runs keeps a reader (autonomyScore) and is flagged for
  contract adjustment before any drop.
- **Turn 16 — sagas + reactive chains.** Remove chain seeding from `autonomyBootstrap`; remove `POST /api/founder/v14/events`; delete `reactiveOrchestrationV14.ts`. Delete `sagaOrchestratorV12.ts` + `routes-founder-real-runtime.ts:183-214` (Decision E covers both route removals; the orgId-0 sentinel dies here). Lower `FOUNDER_ROUTE_BASELINE` in the same commits. Verify: grep `processEvent|startSaga` zero; boot log clean; `executionEngine` caller set is now exactly initiative + finalMile + the decisions lane. `saga_instances`, `reaction_chains` → drop list.
- **Turn 17 — DONE 2026-08-29.** The cascade's memory layer reads the
  canonical solene corpus (cross-namespace RAG); the outcome-based boost-25
  is GONE rather than faked — the corpus carries similarity, not outcome
  labels, so matches grant a smaller boost labeled "corpus-similarity (not
  outcome-verified)". All four V13 memory writers in turn-17 scope
  repointed through the new agentMemoryIngest (store_learning, debate
  precedents — one record per resolution, real similarity replacing the
  hardcoded 0.85 — and cascade founder resolutions); bootstrap
  DEFAULT_MEMORIES seeding deleted. Remaining V13 memory importers:
  feedbackLoopV14, trustAuthorityEscalation (die with lane 3, turn 13),
  and the v13 router (turn 18).
- **Turn 17 — cascade memory repoint.** `confidenceCascadeV14.ts:298` recallEpisodes → `memoryRetrieval` over the solene corpus; honest-empty fallback tested both ways (seeded fixture returns precedent; empty corpus advances the cascade without fabricating). Convert `executionEngine` store_learning and `agentDebates.ts:369` to `embedDocumentTextFailOpen`. Rollback: revert — V13 store is still intact and quasi-static (no decay cron ever ran), so reverting restores exact prior behavior.
- **Turn 18 — DONE 2026-08-29 (Decision F ruled via the picker; E ratified
  retroactively — OD-10).** routes-founder-sentient-enterprise deleted
  (~68 routes); scpMemorySystem deleted (its routes-scp-v2 helper had ZERO
  call sites — the SCP memory lane was already dead); all six v13 client
  hooks removed with the agent-performance Strategies tab (it fetched a
  route that never existed and always rendered empty). Zero client v13
  fetches remain. cognitiveMemoryV13.ts deletes at turn 13 with its last
  two importers. Fourth OD-8 tranche recorded (~26 V13 tables).
- **Turn 18 — V13 surface retirement.** Remove `/api/founder/v13` (`routes-founder-sentient-enterprise`) and `scpMemorySystem` episodic writes via `routes-scp-v2` (Decision F); delete `cognitiveMemoryV13.ts` after in-commit zero-caller grep; four V13 tables + `memory_access_log` → drop list; lower `FOUNDER_ROUTE_BASELINE` again.
- **Turn 19 — independent completeness audit (wave discipline #2).** A fresh agent that built none of this, claims-as-hypotheses: hunt built-but-unwired residue (unmounted routes, orphan exports, schema-without-migration, seams with zero adopters), re-run every ratchet (`constitution.test.ts`, `founderFourDoors`, `sidebarHiddenRoutes`, `moneyCustodyHardStop`, `hardStopLaneCoverage`, `agentAuthorityCeiling`, both new chokepoint tests), verify every baseline was lowered-not-raised, run `npm run check`, `npm test`, `npm run build` directly. Only then PR.

---

## 3. Founder decision points

- **A (turn 5, blocks turns 6–9):** standing witness grants for the migrated email classes — scope, per-class daily budget, TTL — versus accepting inbox-card latency per send. Includes the cap-accounting ruling: `autopilot_sends` + grant budgets become the counter of record for hands-lane sends; confirm `autonomyGuardrails`' population still covers everything outside that lane.
- **B (turn 10):** whether support replies become a witnessed `support_reply` hand (registry invariant would force approval-required) or stay a cascade-gated single writer.
- **C (turn 13):** retire the `/api/scp/v2/trust` surface and client trustScore displays; whether CEO-absence mode re-expresses as witness-grant issuance or retires.
- **D (turn 15):** governance.tsx "Trust log" tab removal (a founder-facing UI, even though its own empty state admits nothing feeds it).
- **E (turn 16):** removal of `/api/founder/v14/events` and the saga routes (founder-only surfaces).
- **F (turn 18):** removal of the `/api/founder/v13` sentient-enterprise panels and the SCP memory surface.
- **G (after a quiet period, OD-8 pattern — the only irreversible step, founder-executed):** the accumulated drop list, one approved migration per batch, each table accompanied by last-write evidence (`max(created_at)` predates write-path removal) and row counts: `trust_enforcement_log`, `tenant_agent_config`, `delegation_tokens`, `saga_instances`, `reaction_chains`, `agent_episodic_memory`, `agent_semantic_memory`, `agent_working_memory_v13`, `memory_access_log`. Nothing drops inside stage 4's code turns; the evidenced list is stage 4's deliverable to the founder.

---

## 4. Top 3 risks and how the design defuses them

**R1 — Silent stoppage of customer-touch interventions.** Moving cadenced sends into frozen hands means retention/churn/dunning emails stop leaving unless tapped or granted; unseen, proposals expire at the 24h TTL and outcomes quietly degrade. Defused: Decision A strictly precedes any caller flip; proposed/tapped/auto-witnessed/expired counters built in turn 5 and surfaced on Story and the Letter (an expired proposal is a visible event, not a silent one); the 5-min autoWitness sweep keeps grant-covered latency ≤5 min; one-caller-per-turn flips with observation windows and instant per-caller revert.

**R2 — Authority widening through the action→domain mapping (false-allow in a safety gate).** An action the companyAgents tier would refuse could map to a domain sitting at execute_gated — the one failure class this migration must never produce. Defused: shadow-divergence period (turn 11) on real cadences before any flip, with the divergence log as the flip's evidence; fail-closed default (unmapped ⇒ escalate, seam error ⇒ block); hard-stop classes structurally unmappable via the existing `hardStops.ts` derivation, pinned by `agentAuthorityCeiling.test.ts` + `hardStopLaneCoverage.test.ts`; the gate itself mutation-tested per the three laws (flip a domain level, watch the verdict change — a gate that stays green is decoration); domain promotion still terminates only in a founder tap (`promotionRequest` untouched).

**R3 — Population blind spots.** The single most common defect class here: a seventh email path, a third support-reply writer, or a duplicate added mid-campaign that the maps never opened — `supportAgent.ts`'s 76-case switch sits adjacent as the proven precedent. Defused: the turn-1 ratchets put the full enumerated population (all 45 files) IN the tests with per-member vacuity assertions, so an unregistered call site is red and a silently-unparsed member is red; the turn-9 must-be-zero flip makes reintroduction a CI failure rather than an audit finding; the turn-19 independent audit treats every agent claim as a hypothesis; and every baseline moves only downward, only in the commit that earns it.

Secondary risks folded into stages: stale-UI fabrication after trust-job retirement (same-turn UI repoint, turn 13); daily-send-cap undercounting during the lane move (Decision A); cascade recall degradation on the memory repoint (honest-empty fallback, plus the corpus already feeds the cascade's precedent layer at `confidenceCascadeV14.ts:582`, so turn 17 completes an existing wire rather than opening a new one).