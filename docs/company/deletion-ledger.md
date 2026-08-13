# Deletion Ledger

*Opened 2026-07-07 per `mature-machine.md` §6.10. Verdict per speculative
module: **KILL** (delete in the H2 deletion campaign), **FREEZE** (keep
gated, with written reactivation criteria), or **KEEP** (not speculative —
load-bearing for the wedge or the autopilot). Verdicts were established by
code inventory: mounted-ness, UI reachability, imports from core, and
whether the backing data is real or synthetic. Execute KILLs in H2; record
each execution in place with a date and commit SHA. Codebase targets:
≤600K LOC / ≤450 tables by end of H2.*

## Verdict table

| Module | Key surface | Verdict | Rationale / reactivation criteria |
|---|---|---|---|
| **Founder narrative routers V6–V14** (sovereign-company, learning-company, living-organization, conscious-organization, anticipatory-enterprise, real-runtime, sentient-enterprise, self-running-company) — vN decoder: V6=`routes-founder-sovereign-company.ts`, V7=`-learning-company`, V8=`-living-organization`, V10=`-conscious-organization`, V11=`-anticipatory-enterprise`, V12=`-real-runtime`, V13=`-sentient-enterprise`, V14=`-self-running-company` (no V9). | Was: 8 routers (~2,763 LOC) mounted `routes.ts:1865-1879`, **+ 36 `*V[8-14].ts` service suites (~15,239 LOC)**. Now: **5 routers (V10–V14) + their 36 V-services remain**, plus the plain-named v6/v7/v8 backing services (agentInitiatives, warRoomService, ceoAbsenceMode, attentionOptimizer, decisionAutopilot, founderTwin, institutionalMemory, scenarioEngine, agentDebates, companyChronicle, companySeasons, founderWellbeing, strategicCompassV8, agentWorkflowEngine, agentPerformanceReviews). | **KILL — DEAD-FACADE PORTION EXECUTED 2026-08-06; BULK IS LIVE (KEEP), premise corrected** | **⚠⚠ THE "~20K LOC / delete all 8 routers + 43 services" PREMISE WAS FALSE — verified against code 2026-08-06.** The old row claimed "no client pages consume these APIs"; the code says the opposite. (a) **v10–v14 routers back LIVE refit founder pages:** `/founder/scenarios`→v10, `/founder/governance`→v11, `/founder/memory`→v13, and the `use-sovereign-dashboard` hook (imported by 5 mounted pages)→v11/v12/v13/v14. KEEP. (b) **The v6/v7/v8 *backing services* are LIVE** — transitively reachable via `ceoCommandBridge.ts` (imported by the **mounted** `routes-founder-intelligence.ts`) and via the worker jobs `agentProactiveEngine`/`agentReactionEngine` (`runScheduledJobs.ts`). `founderTodo`→`confidenceCascadeV14`→`companyChronicle` is another live path. KEEP. **What was genuinely dead & DELETED 2026-08-06 (~4,788 LOC):** the 3 v6/v7/v8 *routers* (dead HTTP facade — their only client callers were 17 retired founder components with zero live importers) + those 17 components (`client/src/components/founder/{WarRoom,InitiativeBoard,PerformanceReviews,AbsenceMode,WorkflowMonitor,PlaybookManager,DecisionAutopilot,FocusCard,InstitutionalMemory,AgentGrowth,ScenarioEngine,FounderTwin,CompanyChronicle,SynergyMap,FounderWellbeingCard,StrategicCompass,AgentDebatePanel}.tsx`) + the 3 services those routers *solely* owned (`agentPlaybooks`, `agentSelfImprovement`, `agentSynergyMap`) + their mount block (`routes.ts`) and `routeManifest.ts` entries. The "several synthetic (`Math.random`)" claim was dropped (none found). **KILL-pending (needs a keyed/QA session):** the `use-sovereign-dashboard` hook + `pages/founder/memory.tsx` call several v12/v13/v14 paths that don't exist in the routers (`/v13/memory/recent`, `/v13/strategy/active`, `/v13/memory/search`, `/v13/intelligence/briefing`, `/v14/feedback/overrides`, `/v14/confidence/recent`) — likely already-404 dead reads to prune; and the import-orphaned V9/V15 leaves (`aiAdvisorTeamV15`, `agentInitiativeV9`, `spendAutonomyV9`, `compassAutoRecommendV9`, `playbookEvolutionV9`) are a separate dead cluster to adjudicate. |
| **Voice / AI voice** | `routes-voice.ts` (544), `routes-voice-learning.ts`, `routes-call-routing.ts`, `services/voiceAI.ts` (548), `services/callRouting.ts`, `jobs/realtimeTranscription.ts`; tables `voiceCalls`, `voiceCallRecordings` | **KILL** — *executed 2026-08-01 with two corrections* | ~2,150 LOC, flag off, client page already deprecated, no nav. **Executed 2026-08-01 (founder picker ruling + this row):** deleted `routes-voice.ts`, `routes-call-routing.ts` (every handler returned a hardcoded stub config presented as real), `services/voiceAI.ts`, `services/callRouting.ts`, `services/realtimeTranscription.ts`, orphaned `client/src/components/call-log.tsx`; dropped `voice_calls` + `voice_call_recordings`; stubbed the two ungated Twilio webhooks to 410 as this row prescribes; removed the voice branches from the two live read sites (`routes-pax-insights.ts`, `routes-founder-inspector-finance.ts`) so no surface queries a table nothing can write. **Correction 1:** `routes-voice-learning.ts` was NOT deleted — this row's listing was stale; it is live-wired (client `use-context-profile` hook calls `/api/intelligence`, and `voiceLearning`/`contextProfile` have nine live importers). **Correction 2:** this row never adjudicated the SECOND voice pipeline — `services/voiceCallAI.ts` + transcription handlers in `routes-misc.ts` + `routes-ai-operations.ts`, reading/writing `call_transcripts` — so that pipeline and its table survive pending a founder decision of their own. |
| **Satellite / Vision AI** | `routes-vision-ai.ts`, `routes-vision-scan.ts`, `services/visionAI.ts` (588), `jobs/satelliteImageUpdate.ts`, `pages/vision-ai.tsx`; tables `satelliteSnapshots`, `satelliteAnalysis` | **KILL** — *executed 2026-08-01 in full* | ~1,850 LOC, flagged off, no sidebar entry, costs money (satellite API + scheduled job) with no wedge dependency. **Executed 2026-08-01 (founder picker ruling + this row):** `jobs/satelliteImageUpdate.ts` went in the prior wave; this wave deleted both routers, `services/visionAI.ts`, `pages/vision-ai.tsx` (+ App route, command-palette entry, OpenAPI entries), plus `services/computerVision.ts` (unlisted here but satellite-analysis-only, zero importers) and dropped both tables. |
| **Academy / certification residuals** | `routes-certification.ts`, `services/certification.ts` (gated `feature_academy`); orphaned tables `courses`, `courseModules`, `courseEnrollments` (`shared/schema/marketplace.ts:849-926`) | **KILL** | Module was 90% retired 2026-06-08; this is the dead stump. Constitution adjacency-risk trap (`mature-machine.md` §7.7) says education revenue stays dead. Drop the three tables. |
| **Negotiation copilot (standalone)** | `routes-negotiation.ts`, `negotiationCopilotService`, `pages/negotiation-copilot.tsx` (607) | **KILL** — *executed 2026-08-13, with one premise correction and one deliberate omission* | Duplicate of the orchestrator, flagged off, no nav. (The old offer-wizard dead-pipeline-call cleanup is moot — that page was already removed; the surviving wizard is `blind-offer-wizard.tsx`, verified in the audit note below, and it makes no `/api/negotiation/pipeline/*` calls.) **Executed 2026-08-13 (founder picker ruling + this row):** deleted `server/routes-negotiation.ts` and its `/api/negotiation` mount + `routeManifest` entry, `server/services/negotiationCopilot.ts`, `client/src/pages/negotiation-copilot.tsx` and its seven `components/negotiation/*` satellites (BATNA calculator, pressure gauge, session history/replay, strategy panels + analytics, `meta.ts`), the App.tsx lazy import and `<Route path="/negotiation">`, and the command-center catalog row advertising the endpoint. **Premise correction:** this row assumed `/api/negotiation` was the service's only rail. It was not — `routes-ai-operations.ts` carried three more copilot endpoints (`POST /negotiation/session`, `POST /negotiation/objection`, `GET /negotiation/:id`) on the same service, with no client caller; they went in the same commit, or the KILL would have deleted a door and left a window. The live negotiation capability is `POST /api/ai/negotiation/script` in `routes-core-ai.ts`, which runs on **negotiationOrchestrator** (FREEZE-wired, row below) and is called by the deal detail view behind the Deals door — that is what the founder's ruling kept. **Deliberate omission:** the `negotiation_sessions` table was NOT dropped. Dropping it deletes customer rows, which is a founder-only hard stop; the code no longer reads or writes it and it is allowlisted in `lint-reachability` with that reason, so a DROP migration is a decision someone makes on purpose rather than a side effect of a deletion wave. `whiteLabelService`'s default feature set flipped `negotiationCopilot` to `false` — a reseller feature set must not advertise a subsystem that no longer exists. `/negotiation` KEEPS its `FROZEN_ROUTES` entry: removing it would read as "unfrozen", and the list is served to clients still running an older bundle. |
| **Sovereign Protocol / SCPv2 extras** | `sovereign-protocol/` dir, `routes-sovereign-integration.ts`, `routes-scp-v2.ts` | **KILL (partial)** — *executed 2026-08-01 (five modules)* | Agent-constitution self-evolution machinery beyond what the autopilot actually consumes. **Executed 2026-08-01 by explicit founder ruling (picker):** deleted `scpFinancialAutonomy`, `scpOutboundExecution`, `scpIntegrationFabric`, `scpStrategicIntelligence`, `scpDynamicTools` + their unit tests — verified zero production import sites (each referenced only by its own test; `scpOutboundExecution`→`scpIntegrationFabric` was the sole inter-module edge, both killed together). Held pending explicit founder ruling: `scpCustomerLifecycle`, `scpSelfProvisioning`, `scpExperimentEngine` (ambiguous under this row's wording). **Rationale correction:** the KEEP note for `scpConfigVersioning` previously said "live-wired into Pax prompt versioning"; the code shows `paxPromptVersions.ts` imports `@sovereign/immutables`, and `scpConfigVersioning`'s only real consumer is `routes-scp-v2.ts` (plus a type import that died with `scpDynamicTools`). It stays KEEP because routes-scp-v2 is mounted — but the reason is routes-scp-v2, not Pax. |
| **Negotiation orchestrator** | `services/negotiationOrchestrator.ts` (926), wired via `routes-core-ai.ts:430-496` into Pax deal coaching | **FREEZE (wired)** | Touches the offers/replies wedge through Pax; cheap to keep. Revisit if deal-coaching usage is zero at G1. |
| **Marketplace** | `routes-marketplace.ts`, `services/marketplace.ts`, `matchmaking.ts`, buyer-network / transaction-fees / investor-verification / deal-rooms satellites, `pages/marketplace.tsx` (1,252); 5 tables | **FREEZE** | The Phase-2 network-effects bet — built, gated off. Do NOT polish. Remove the sidebar entry advertising an off feature. Reactivate at G2's liquidity proof: the first organic cross-customer deal, seeded concierge-style in H2. |
| **White-label** | `routes-white-label.ts`, `whiteLabelService.ts`, `white-label-domain.ts` middleware (mounted globally, no-ops without a config), `whiteLabelConfigs` table | **FREEZE** | The domain middleware sits in the global request path — removal is surgery, not deletion. Flag stays off. Reactivate on the first enterprise/white-label contract. |
| **Capital markets** | `routes-capital-markets.ts`, `services/capitalMarkets.ts` (partly synthetic), `pages/capital-markets.tsx`; tables `noteSecurities`, `lenderNetwork`, `capitalRaises` | **FREEZE (un-wire first)** | The one speculative surface bleeding into a core door: `money.tsx` renders the Capital tab unconditionally while the API 404s for non-founders. Remove the tab from the Finance door now; keep code gated. Reactivate when note securitization is a real revenue line (H4). |
| **Beta verticals** — fix_and_flip Rehabs, wholesaler Buyer Blasts, tax_lien_deed Redemption Clock, subdivider | `routes-rehabs.ts`, `routes-buyer-blasts.ts`, `routes-wholesaler-*.ts`, `routes-subdivisions.ts`, `redemptionClockRefresh` job, matching pages | **FREEZE** — *rescinded 2026-07-29, see note* | Persona-gated go-to-market bets on the same wedge (they reuse leads/deals/notes). The vertical conveyor (`mature-machine.md` §1.2) reactivates them one at a time; criterion per vertical: first paying customer in that persona, and never more than one activation in flight. **2026-07-29 — FREEZE verdict rescinded by founder ruling #11** (`founder-decisions-2026-07-28.md` §11: build ALL registered verticals fully, activate each as it passes the land-wedge honesty bar; the one-at-a-time conveyor gate and the frozen vertical-pack checkout are explicitly rescinded). Executed wave by wave: V1 (PR #250) promoted buy_and_hold roadmap → beta and made the landlord family reachable; V2 (PR #251) completed the beta four (certificates + lot-economics Finance heroes, SubdividerStrip, wholesaling Pax to production) and promoted creative_finance roadmap → beta. wholesaler / tax_lien_deed / subdivider remain open beta. Exception: **fix_and_flip stays roadmap-gated** per the 2026-07-11 residential-comps decision (gap stated, not activated on hope) — that gate is a data-plane hard-stop, not this freeze. Original verdict text kept above for history. |
| **Rosy River** | `routes-rosy-river.ts` | **KEEP** | Despite the codename: it is the founder agent-queue over the real autopilot tables (`agentTasks`, `decisionsInboxItems`, `agentLlmTraces`). |
| **Elite features** | `routes-elite-features.ts` | **KEEP** | Wedge-relevant grab-bag: tax escrow, e-sign, due diligence, listing syndication, bookkeeping. |
| **EPIC services** | `routes-epic-services.ts` | **KEEP** | Seller-motivation scoring, county opportunity, title chain, closing checklist — wedge-relevant. |
| **Solene founder surfaces** | `routes-solene-*.ts` | **KEEP** | The founder autopilot chat/audit surface itself. |

## Execution rules (H2)

1. KILLs are executed as **deletion PRs by the self-patch motor** once it
   is armed (H2), each with green CI and a clean revert path — deletion is
   the class autonomous engineering learns on.
2. Before deleting a module: stub any ungated webhooks to 410, drop its
   tables in a migration, remove its feature-flag rows, and grep for
   stragglers (imports, command-palette entries, sitemap routes, tests).
3. FREEZEs get: flag off, no nav/sidebar advertisement, and their
   reactivation criterion recorded here. A freeze with no recorded
   criterion is a KILL that hasn't admitted it yet.
4. Update this ledger in place with date + commit SHA per execution;
   report LOC/table deltas against the §1.6 targets at each gate crossing.

## Module-state residue (audit 2026-07-07)

The module-level mutable-state audit (mature-machine H0 §6.3) found ~11
correctness risks across 2+ machines. Disposition:

**Fixed (DB-backed, migration 0196):**
- `temporaryDelegation.ts` → `authority_delegations` — a founder authority grant
  was invisible to the authority gate on the worker and vanished on deploy.
- `executionEngine.ts` rate throttle → `agent_execution_counts` — per-process
  counters made the autonomous-action cap N× on N machines; now a race-free
  upsert, fail-closed when unverifiable.

**Resolved by deletion (no fix needed — module is a KILL above):**
- `betaProgram.ts` waitlist / cohort / feedback arrays — **deleted 2026-08-13 per
  founder ruling** with `server/routes-beta.ts`, the `/api/beta` mount and the
  `routeManifest` entry. This one was previously in "Pinned" below, and the pin
  was doing real work: it said *"do NOT point real signup traffic at this until
  it persists"*, which is a note that survives exactly as long as someone reads
  it. `POST /api/beta/waitlist` was **public and unauthenticated**, appended to a
  module-level array, and answered with a queue position and a referral code —
  both lost at the next deploy and split across machines before that. The six
  founder-gated admin endpoints read only what that POST wrote, so they went with
  it rather than becoming a console over a permanently empty set.
  `compass_pm`'s `ownedServices` / `ownedRoutes` entries removed, per the
  `transactionFeeService` precedent above. **If beta signups return, a
  `beta_waitlist` table and a migration are the precondition** — and
  `GET /waitlist/status` must not return as written: it answered whether an
  arbitrary email address was on the list (an enumeration oracle) and paged at 50,
  so anyone past position 50 was told `found: false` even in one process.
- `reactiveOrchestrationV14.ts` cooldown tracker (V14 narrative suite)
- `callRouting.ts` agent/queue/call state (voice)
- `scpLLMJudges.ts` cost accumulator (SCPv2)
- `investorVerification.ts` KYC store (marketplace satellite — FROZEN; must be
  DB-backed before any marketplace reactivation)
- The unwired SCP engines holding in-memory financial ledgers / outbound
  queues — `scpFinancialAutonomy`, `scpOutboundExecution`,
  `scpIntegrationFabric`, `scpStrategicIntelligence`, `scpDynamicTools`
  **deleted 2026-08-01 per founder ruling** (see SCPv2 row above);
  `autonomousSalesPipeline`, `externalCommunicationsManager`,
  `predictiveAutoscaler` remain dead code today — if any is ever wired,
  DB-backing is a precondition, but the standing verdict is KILL with
  their parents.

**Pinned (header comment at the state declaration; fix before load-bearing use):**
- `notificationDispatcher.ts` → persist to the existing `notifications` table
- `marketWatchlist.ts` → DB tables + sequences
- `abTestEngine.ts` → persist outcomes, aggregate in SQL
- `ceoReminders.ts` → systemMeta-backed cache, single-founder tolerable
- `agentEvolutionEngine.ts` `sharedInsights` → display-only divergence today

## Immediate un-wire items (H0, ahead of the campaign)

- [x] Remove the unconditional "Capital" tab from `client/src/pages/money.tsx`
      — DONE 2026-07-07 (comment at `money.tsx:31` records the removal). Box
      ticked by the 2026-08 audit (was stale-unchecked; F-17 doc-drift).
- [x] Remove the marketplace sidebar entry (`layout-sidebar.tsx`) —
      DONE 2026-07-07 (comment at `layout-sidebar.tsx:450`). Box ticked by
      the 2026-08 audit.

## Executed deletions (log)

- 2026-08-01 — **Six dead `server/jobs/*` files deleted** (dead-job wave; code
  deletions only, no git operations in-session). An adversarial verification
  confirmed all six are module orphans: zero importers static or dynamic,
  their queue literals appear nowhere else, and none is referenced by
  `runScheduledJobs.ts`, `worker.ts`, `scheduler.ts`, `jobRegistry.ts`, or
  `.github` workflows — so none ever ran. Deleted:
  - `satelliteImageUpdate.ts` — standing Satellite/Vision-AI KILL (verdict
    table above). The satellite describe block in
    `tests/unit/killFabrications.test.ts` (which pinned imagery honesty over
    this now-deleted code) was removed with a dated note at the site; the
    rest of that suite is untouched.
  - `valuationModelRetrain.ts` — never invoked; the drift runbook even called
    a `retrain()` export that never existed (runbook corrected: retraining is
    manual via `server/ml/valuation_model.py`, which is LIVE via
    `server/ml/api.py` and untouched beyond stale header comments).
  - `regulatoryComplianceCheck.ts` — orphan; the LIVE regulatory watcher
    (`runScheduledJobs.ts` beatrice-regwatch) is separate and untouched.
    Stale `ownedJobs` display string removed from `companyAgents.ts`.
  - `dataIngestJob.ts` — the open-data inventory's claim that it ran "via
    `scheduler.ts` self-rescheduling" was REFUTED and the doc corrected;
    `countyAssessorIngest` remains the live `transaction_training` writer.
  - `realtimeTranscription.ts` (the jobs file) — voice-family KILL (verdict
    table above). `server/services/realtimeTranscription.ts` is a separate
    ledger line item and was NOT touched. Stale "consumes OPENAI_API_KEY"
    comments trimmed in `secretsValidation.ts`, `performanceEnhancements.ts`,
    `openaiClient.ts`.
  - `dailyBriefing.ts` — trap defused: the LIVE founder briefing is
    `services/founderBriefing.ts` `sendDailyBriefing` (singular), dynamically
    imported by `runScheduledJobs.ts` — a different module, untouched.
  Collateral across the six: 15 stale `server/jobs/*` entries dropped from
  `scripts/schema-column-baseline.json` (201→186); stale doc/comment
  references corrected or annotated in `modelTraining.ts`, `server/ml/README.md`
  / `valuation_model.py` headers, `sellerMotivationEngine.ts`,
  `docs/runbooks/valuation-model-drift.md`,
  `docs/company/open-data-platform-inventory.md`, roadmap lenses
  (`wire-for-real-census.md`, `team-meta-lens-findings.md`, `tess.md`), audit
  lenses 062/064-065, and archived audits (`wenzeslaus-etl.md`,
  `_MASTER-FINDINGS.md` P2-51). Reachability/ratchet baselines
  (`scripts/ratchets/*.json`) are locked centrally — not edited by this
  wave; the central lock-in (unreachedExports 754→728 etc., see
  reachability.json's lastBumpNote) was applied to the tree by the central
  session during the wave. NO tables dropped and no
  migrations created in this wave: the associated table drop was separately
  escalated for explicit founder approval; this entry covers strictly the
  reversible file deletions.

- 2026-08-01 — **`server/routes-sso.ts` (108 LOC) deleted** (unmounted-router
  resolution wave). A Clerk SAML-connection management router
  (default-exported `ssoRouter`) that was never imported and had no mount path
  anywhere — unreachable since creation. No backing tables: it proxied
  `clerkClient.samlConnections` (Clerk Admin API) directly, so no table
  readers stranded and no drop migration needed; Clerk's own dashboard remains
  the real SAML configuration path. No client callers (zero SSO/SAML fetches
  in `client/src`; the `auth-page.tsx` Clerk-SSO-callback comment is
  unrelated). Even if mounted it would 422 without a Clerk Enterprise plan.
  Style-dead too (`req: any` tier-gate helper predating the
  `AuthenticatedRequest` rule). Collateral: `KNOWN_NON_MOUNTED` entry removed
  from `server/routeManifest.ts`, allowlist snapshot regenerated
  (`tests/unit/__snapshots__/routeManifest.test.ts.snap`); reachability
  ratchet `unregisteredRoutes` baseline lock-in (2→1) **pending central
  commit** — the ratchet baselines (`scripts/ratchets/*.json`) are locked
  centrally and the change has not landed yet. The same deletion also earned
  `unreachedExports` and `res-status-raw` drops, likewise pending that
  central lock-in. Remaining doc mentions are archived audits/history only. **Flag for founder**: the
  enterprise tier in `shared/schema.ts` (~:4259 `"sso"` feature key, ~:4264
  "SSO & enterprise authentication" unlock string) still advertises SSO — an
  unbacked pricing promise the router never delivered; pricing copy is a
  founder-only hard-stop, so it is flagged here, not edited. NOT touched in
  the same wave: `routes-api-keys.ts` stays deliberately dormant — the
  `apiKeys` table it manages has live readers (`server/mcp/auth.ts`
  per-org bearer path, `server/middleware/requireApiKey.ts`) and it holds the
  repo's only `.insert(apiKeys)` mint path, while the constitution
  (`expansion.marketplace-25-api-50`, "no public API before ~50 customers")
  forbids mounting the self-service surface before its trigger.

- 2026-07-29 — **Platform money-custody purge** ("be the rail, not the
  provider", founder ruling 2026-07-29). The ruling: AcreOS's payment
  architecture applies ONLY to direct subscription payments TO the platform;
  when a customer manages their own notes/rents/payments they are ROUTED to a
  payment service so the liability stays out of AcreOS's hands. A custody audit
  found four surfaces that were already DEAD or DORMANT, so removing them cost
  nothing. All four are gone:
  - `server/services/transactionFeeService.ts` (359 LOC) — a full
    escrow-and-take-a-cut engine (`calculateFee` → `createSettlement` →
    `holdInEscrow` → `releaseFromEscrow` → `processPayout`) with **ZERO call
    sites**. Its `processPayout()` also stamped a fabricated
    `tr_simulated_${Date.now()}` string into `stripe_transfer_ids` — a money
    column — and returned it as `stripeTransferId`, which independently
    violates the no-fabrication hard stop. Deleted with its
    `server/services/billing/index.ts` re-export and its `companyAgents`
    `ownedServices` entry.
  - `server/routes-transaction-fees.ts` (195 LOC) + its `/api/transaction-fees`
    mount and `routeManifest.ts` entry. Every handler was a stub: analytics
    returned hardcoded zeros, list endpoints returned `[]`, and
    `POST /fees/settlements` minted `id: Date.now()`. Includes the
    **`POST /fees/payouts/trigger` placebo** — 202 `{ status: "processing",
    message: "Payout triggered and processing" }` for an operation that did
    nothing at all. It survived the earlier honesty wave.
  - `client/src/pages/fee-dashboard.tsx` (695 LOC) — the founder console over
    those stubs (settlements table, escrow-release action, trigger-payout
    dialog, payout-schedule form, ledger tab), with its `App.tsx` lazy import
    and `FounderProtectedRoute`, its `/fee-dashboard` entry in
    `production-smoke.spec.ts`, and step 8 of `sim-founder-journey.spec.ts`
    (retargeted at `/admin/ops`, the real founder cost surface). It was the UI
    caller of `/fees/payouts/trigger`, so the placebo is removed rather than
    stubbed honestly.
  - **Actum platform-merchant routes** — `POST /api/actum/create-profile`,
    `POST /api/actum/batch-payment-run`, `GET /api/actum/ach-return-codes` in
    `routes-elite-features.ts`. A single platform `ACTUM_MERCHANT_ID` for all
    orgs makes AcreOS the merchant of record for every customer's borrower
    debits, and `create-profile` accepted **raw bank routing + account numbers**
    in the request body — data AcreOS must never receive. Dormant (no
    credentials, no merchant account, every path already refusing after Wave C)
    and zero client callers.
  - `server/services/actumProcessing.ts` **KEPT, trimmed to 178 LOC**: it still
    supplies the NACHA R01–R29 return-code taxonomy that Wave C imports —
    `achAutopay.ts` uses `classifyAchReturn`, `mapProcessorFailureToReturnCode`
    and `returnRevokesAuthorization` to classify real Stripe `us_bank_account`
    returns (verified import). The platform-merchant processing paths
    (`isActumConfigured`, `getActumHeaders`, `createActumPaymentProfile`,
    `chargeActumACH`, `runMonthlyActumPaymentBatch`, the endpoint constant and
    the refusal strings) are deleted; the file now has no env vars and makes no
    network calls. `tests/unit/actumProcessing.test.ts` was rewired to import
    the REAL taxonomy — it previously re-declared its own 9-code copy and so
    could not have caught drift — and gained completeness/consistency
    assertions.
  - **Tables dropped** (migration `0214_drop_platform_custody.sql`):
    `transaction_fee_settlements`, `fee_payout_schedules`, `fee_audit_log` —
    written only by `transactionFeeService`, read by nothing. Plus columns
    `marketplace_transactions.seller_payout_status` / `seller_payout_amount` /
    `seller_stripe_transfer_id`: status/amount were written by
    `marketplace.completeTransaction()` and read **nowhere**;
    `seller_stripe_transfer_id` was never written either. They encoded AcreOS
    receiving the sale proceeds and paying the seller from its own balance.
    Table-count ratchet 756 → 753.
  - **KEPT deliberately**: `marketplace_transactions.platform_fee_percent` /
    `platform_fee_cents`. That fee is a payment TO AcreOS, which the ruling
    permits, and it is charged to the buyer org as AcreOS's own customer — it
    never carries the sale proceeds. Also fixed in the same function: a
    `.set({ stripePaymentIntentId: … } as any)` write against a column that
    does not exist on `marketplace_transactions`, inside a swallowing
    `catch` — so the id was never persisted while the code read as if it were.
    Replaced with an honest structured log line (`as any` ratchet 1429 → 1428).
  - **Governance (the gap that let this persist)**: the constitution registry
    had **zero** money-custody entries — the ban on re-fronting platform SEND
    rails had no payments analogue. Added
    `hard-stop.no-platform-money-custody` (`shared/governance/constitution.ts`),
    tagged **code-invariant**, backed by the `customerMoneyRouting.ts` runtime
    chokepoint and the new `tests/unit/moneyCustodyHardStop.test.ts` ratchet
    (platform-take Stripe params exist nowhere but the guard that forbids them;
    no route names raw bank numbers; no simulated processor ids; the deleted
    surfaces stay deleted). `constitution.test.ts` hard-stop count 4 → 5;
    unenforced-hard-stop baseline unchanged at 0. Matching bullet added to
    CLAUDE.md's DO-NOT-DO list.

- 2026-07-29 — **Nothing-lies wave A (agent A7)** — four honesty deletions/blocks:
  - `server/routes-tax-optimization.ts` (105 LOC) deleted, with its
    `routes.ts` registration and `routeManifest.ts` entry. 10 of its 11
    endpoints returned 501; the one working endpoint
    (`POST /api/tax-optimization/analyze`) had zero client callers. The real
    tax-optimizer API is `/api/tax-optimizer/*` in `routes-misc.ts`.
    (`services/taxOptimizationEngine.ts` is now consumer-less apart from a
    `companyAgents.ts` ownership listing — candidate for a follow-up wave.)
  - `client/src/pages/field-scout.tsx` (~1,600 LOC) +
    `client/src/components/field-scout/*` (5 files) deleted, plus the
    dangling `FieldScoutPage` lazy import in `App.tsx` and the dead
    `/field-scout` FAB-suppression prefix in `MobileBottomNav.tsx`. The
    `/field-scout` route had already been removed, leaving the page
    unreachable from any surface. Server `routes-field-scout.ts` (mounted,
    tested) kept — DriveMode's `/api/field-scout/quick-add` lives in
    `routes-drive-mode.ts`; the visits/photos API is now consumer-less and is
    a candidate for a follow-up wave.
  - EDDM demo-geometry queue **hard-blocked**: `POST /api/outreach/mail/eddm/queue`
    now returns an honest 400 (nothing queued, no credits charged) instead of
    inserting a real `mail_shipments` row against synthetic carrier routes
    that the mailFlusher would have handed to a real provider with placeholder
    addresses. Client Queue button disabled while routes are demo, with the
    reason shown. Pinned by `tests/unit/routes-eddm.test.ts`.
  - `/deals/discover` pretend-surface retired: route now redirects to `/deals`
    (it rendered the identical DealsPage), and the sidebar "Discover" child
    entry advertising a non-existent "scored opportunities + hunter + feed +
    patterns" surface was deleted.
  - Verified (item a of the audit): `offer-wizard.tsx` no longer exists in the
    repo and no code references to the killed `/api/negotiation/pipeline/*`
    endpoints remain (docs/ledger mentions only).

- 2026-07-29 — **/automation rules twin** (Wave A "Nothing lies", agent A2).
  Deleted the dead parallel automation surface: `client/src/pages/automation.tsx`
  (778 LOC, full rules CRUD UI), the `/api/automation-rules` +
  `/api/automation-executions` endpoint block in `server/routes-analytics.ts`,
  and the automation-rule/execution methods in
  `server/storage/automationRepo.ts` (+ their IStorage declarations). Rationale:
  the surface had NO execution engine — `createAutomationExecution` had zero
  call sites — so customers could author rules that could never run
  (fabricated capability). `/automation` now redirects to `/workflows`, the
  real engine-backed surface. The `automation_rules` / `automation_executions`
  tables remain in `shared/schema.ts` pending a drop migration (execution
  rule 2). The repo module itself survives (its tasks / notifications /
  activity-feed / job-cursor methods are live). — **BLOCKED,
  needs founder's own credentials**. Seven stale branches were vetted for
  deletion and their tip SHAs recorded below for recovery, but the actual
  remote deletion is impossible from the agent environment: the session's
  git proxy returns HTTP 403 on any delete refspec (`--delete` and
  `:refs/heads/...` both), and the GitHub MCP toolset has no
  branch-deletion capability. To execute, run locally with normal
  credentials: `git push origin --delete <branch>` for each name below
  (or delete via the GitHub branches UI). All are pre-history-rewrite
  forks whose headline work verifiably exists in main by other routes
  (craftStandard.ts, domainAutonomy.ts trust ledger, migrations
  0164/0166, the shipped 4-tab mobile nav):
  - `claude/production-polish-OveLf` @ be02be1e (2026-04-16)
  - `mobile-shell-spike` @ 92a2427d (2026-05-26)
  - `claude/app-elevation-optimization-y4pykr` @ f8a780cd (2026-06-14)
  - `founder-autopilot` @ a19a59c9 (2026-06-15)
  - `survey/platform-depth-2026-06-14` @ 54f2204f (2026-06-15)
  - `calibration-status-2026-06-01` @ its "no data yet" log commit
  - `calibration-status-2026-07-01` @ its "no data yet" log commit
  KEPT: `claude/codebase-quality-audit-ko1u69` (5 unmerged commits of
  real work — Inbox/Documents one-round-trip aggregates, LOB_API_KEY
  health-check fix) — being rescued into main via the PR train, deleted
  after it lands.
- 2026-07-07 — `client/src/pages/founder/chat.tsx` (365 LOC) deleted. Orphan:
  lazy-imported in App.tsx but no route ever mounted it; superseded by
  `pages/founder/solene-chat.tsx` (the live founder chat face). Shared
  `components/founder-chat/*` retained (used by solene-chat). Found by the
  WS2 cockpit inventory.
