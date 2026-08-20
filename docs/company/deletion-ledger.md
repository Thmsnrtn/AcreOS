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
| **Environmental intelligence card** | Was: `client/src/components/environmental-intelligence-card.tsx` (376) + `POST /api/environmental/highest-best-use` (`routes-platform-features.ts`) + `analyzeHighestBestUse()` / `LandUseOption` / `UseFactor` / `HighestBestUseAnalysis` / `buildRationale` in `services/environmentalIntelligence.ts` | **KILL — executed 2026-08-18 (founder ruling, picker)** | **Zero call sites.** `EnvironmentalIntelligenceCard` is exported and imported by nothing — grep across `client/src` returns only its own definition. **And it could never have worked if mounted:** three of its five queries pass an options OBJECT as the second `queryKey` element (`["/api/environmental/climate-risk", { state, county }]`), and the default `getQueryFn` in `client/src/lib/queryClient.ts:474` builds the URL as `queryKey.join("/")` — so those requests would go to `…/climate-risk/[object Object]`, never carrying `state` at all; the highest-best-use query is a GET against a POST-only route on top of that. Two independent proofs it was never wired to a live page. **Do not delete opportunistically — this was found while fixing an unrelated fabrication in `assessClimateRisk` (see below) and deleting it here would be exactly the opportunistic deletion the execution rules forbid.** **Salvage note, so a ruling is cheap:** three of the five endpoints are NOT dead and must survive any KILL — `getWaterRightsInfo`, `getMineralRightsInfo` and `estimateCarbonCredits` are all consumed by `services/dueDiligenceReportGenerator.ts` (lines 230/251/273), which backs the live customer DD PDF. `assessClimateRisk` is likewise live through that PDF (line 296) and stays regardless. Only `analyzeHighestBestUse` has no consumer other than this dead card. **Executed 2026-08-18:** deleted the component, the route, and the five HBU symbols the route solely owned (~190 LOC of service + 376 of component). `GET /api/environmental/climate-risk` was NOT deleted, correcting this row's original listing — `assessClimateRisk` is live through the due-diligence PDF (`dueDiligenceReportGenerator.ts:296`) and the endpoint is its HTTP face. The HBU code was not preserved for a rebuild because it carried the same defect class the wave was chasing: per-use scores started at a hardcoded base and were adjusted by string-matching free-text zoning/utilities/road fields, then returned as an `estimatedValueImpact`. A real highest-and-best-use analysis starts from parcel data and comparable sales, not from a base of 50 nudged by keywords. **Residue check:** the `RiskDetail` doc comment in `environmentalIntelligence.ts` cited the deleted component; repointed to the PDF in the same commit rather than left to rot. |
| **`scoreCountyForTargeting`** | `server/services/sellerMotivationEngine.ts:703` (+ its `CountyScorecardInput` interface) | **KILL-pending — founder ruling required (found 2026-08-18)** | **Zero call sites**, and it is a latent copy of the fabrication fixed in `countyOpportunityScore.ts` on the same day: `input.avgDaysOnMarket || 180`, `input.investorMailingCount || 10`, `input.growthRate5Year || 0`, `input.population || 0` — then it emits an `overallScore`, an `opportunityWindow` and a `recommendation` string from those defaults. It is listed here rather than fixed because fixing an unreachable function to be honest is work that buys nothing: the same nullable-signal treatment applied to the live model would have to be repeated here for a surface no one can reach. **If it is ever wired, it must be rewritten first** — nullable signals, an explicit refusal when the core signals are absent, and no `|| <constant>` on any metric — or it will reproduce the exact defect on a new surface. The live equivalent it should defer to is `computeCountyOpportunityScore`, which now refuses rather than defaulting. `sellerMotivationEngine.ts` as a whole is NOT proposed for deletion: `computeSellerMotivationScore` in the same file is live (`server/jobs/countyAssessorIngest.ts:555`). This row is the one dead export. |
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
- `vaManagement.ts` VA_TASKS_KEY / SOP_LIBRARY_KEY → **RESOLVED 2026-08-13 by
  building the layer** (founder ruling, BLOCKERS B9). These two constants were
  never module STATE — they were the NAMES of a settings-blob store that was
  never written, which is a subtler version of the same failure: no data was
  lost on deploy because no data was ever kept. `va_tasks` and `va_sops` are real
  tables now (migration 0235). The blob was the wrong destination anyway:
  `organizations.settings` is read on nearly every org-scoped request.
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

- 2026-08-18 — **`GET /api/enhancements/campaign-roi/:id` + `calculateCampaignROI`
  deleted** (founder picker ruling, this date). Found during the URL-id tenancy
  sweep, and it failed on three counts at once:
  - **No consumer.** No client caller anywhere in `client/`; the only reference
    was its own route.
  - **Cross-tenant.** It read `campaigns` by primary key with no organization
    predicate, and counted `leads` with `source LIKE '%campaign_<id>%'` and no
    organization predicate — so the lead count spanned every tenant even for
    your own campaign.
  - **Fabricated.** `revenue = leadCount × 500` ("rough avg revenue per
    converted lead") and `dealsCreated = floor(leadCount × 0.1)`. Invented
    numbers returned as `revenue`, `roi` and `dealsCreated` — the DO-NOT-DO
    list's fabrication hard-stop, and the same shape as the
    `routes-call-routing.ts` KILL above ("every handler returned a hardcoded
    stub config presented as real").

  **The canonical replacement already exists and is wired:**
  `attributionService.getAttributionReport(orgId, from, to)` computes real
  per-campaign `totalRevenue` from `leadConversions` and `deals`, scoped by
  organization, exposed at `GET /api/analytics/attribution`. Deleting the
  duplicate is what stops the two disagreeing.

  **NOT deleted, recorded for a decision of its own:** the remaining five
  exports in `server/services/campaignEnhancements.ts` — `cloneCampaign`
  (unscoped read + insert), `categorizeResponse`, `getCampaignBenchmarks`
  (returns hardcoded 31% / 4.2% / 1.8% as `avgOpenRate`/`avgResponseRate`/
  `avgConversionRate` — a second fabrication), `isHoliday` (a hardcoded list
  whose "Thanksgiving (approximate)" is wrong in most years), and
  `getOptimalSendTime`. All five have ZERO consumers and were already unreached
  before this deletion. They are adjacent dead code, not part of the ruling I
  asked for, so they wait for their own adjudication rather than riding along.

- 2026-08-18 — **The shadowed second `/api/config/features` handler in
  `routes-admin.ts` deleted** (founder picker ruling, this date). `routes.ts:405`
  registers first and wins, so the admin declaration was unreachable — but it
  returned only `enabledKeys`/`enabledRoutes`, with no deny-lists and none of
  the `controlledKeys`/`controlledRoutes` the client now needs to distinguish
  "no flag governs this route" from "a flag governs it and it is off". Had
  registration order ever shifted, every uncontrolled route would have vanished
  from the nav and 404'd. `featureFlagControlScope.test.ts` now pins the COUNT
  of declarations at one, and that it lives in `routes.ts`, so a third cannot
  appear quietly.

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
- 2026-08-14 — `server/services/taxOptimizationEngine.ts` (423 LOC) deleted.
  **Founder ruling (picker, this date): "Delete the engine."** Zero production
  importers; the only occurrence of its name outside the file was the STRING
  `"taxOptimizationEngine"` in `companyAgents.ts`'s `ownedServices` array, which
  is what made `lint-reachability.mjs` treat it as alive (that linter counts
  string literals as uses, by design — "prose and registries resurrect corpses").
  Removed from that array in the same commit.

  It was deleted because it FABRICATED, on a surface where a fabricated number
  reads as advice. `stateCapGainsRates` listed twenty states under the comment
  "representative sample, 2024" and ended `?? 0.05`, so the other thirty received
  an invented 5%. The note beneath it read
  `rates[s] === 0 ? "no state capital gains tax" : "taxes capital gains as
  ordinary income"` — and `undefined === 0` is `false`, so an unlisted state took
  the ELSE branch: asked about Tennessee, which has no state income tax on
  capital gains, it answered that TN taxes them as ordinary income AND applied
  5%. Both false, in a sentence a reader takes as legal fact.
  `calculate1031Benefits` did `replacementValue * 0.3 // assume 30% appreciation`
  and returned `deferralBenefit` as a rounded dollar figure; the federal
  constants assumed the top bracket for every taxpayer.

  On this program's test — *does removing it remove a capability or a lie?* — it
  removed a lie. Recorded as BLOCKERS B17, found by unit 104's numeric-default
  sweep, executed in unit 107.

  **DELETION-REVEALED, and queued for a separate founder decision:** the engine
  was the only writer of `tax_strategies` and `tax_forecast_scenarios`. Both are
  now writer-less AND reader-less, so `tablesNoWriter` 47→49 and `tablesNoReader`
  59→61. **The tables are NOT dropped** — a production `DROP TABLE` is a
  founder-only hard stop — and they join the queue alongside the others already
  awaiting that ruling. This is the exception the reachability ratchet's own note
  carves out for raising those counts: name the deleted writer, queue the exposed
  tables in the same commit.
- 2026-08-14 — **sixteen module orphans deleted, 5,002 LOC.** Founder ruling
  (picker, this date): *"Delete classes 2 and 3 now."* BLOCKERS B19.

  **Class 2, superseded duplicate (1 file):** `authLockout.ts` (102).
  `server/middleware/authPathLimits.ts` exports a live, mounted `loginLimiter`,
  so this removed a DUPLICATE of a control, not a control. The name invites the
  opposite reading, which is why it is written down.

  **Class 3, experiments (15 files)** — the family the 2026-08-01 deletion wave
  already ruled on once: `delegationDepthV9` (335), `spendAutonomyV9` (324),
  `causalReasoningV9` (305), `playbookEvolutionV9` (302), `externalIntelligenceV9`
  (266), `compassAutoRecommendV9` (236), `scpCustomerLifecycle` (616),
  `scpExperimentEngine` (439), `scpSelfProvisioning` (359), `aiAdvisorTeamV15`
  (706), `agentTriggerMonitor` (661), `securityEnhancements` (107),
  `mobileEnhancements` (102), `marketplaceEnhancements` (72),
  `integrationEnhancements` (70).

  Every one verified to have ZERO imports and ZERO mentions before deletion.
  **The `scp*` trap was checked first**, because the reachability ratchet's own
  history records that five scp modules were once misjudged as orphans:
  `routes-scp-v2.ts` is production-mounted and lazily imports `scpGoldenSuite`,
  `scpConfigVersioning`, `scpEvolutionEngine`, `scpMemorySystem` and
  `scpLLMJudges`. The three deleted here are none of those.

  **CLASS 1 UNTOUCHED.** `breachNotificationTrigger` (GLBA/GDPR/state breach
  deadlines), `paymentApplication/` (Reg-Z), `landlordCompliance`,
  `usuryCeiling`, `rental/leaseSigningPacket` remain — deleting a regulated
  obligation removes capability the product may be legally required to have.
  B19 keeps them open as WIRING work.

  **Tests:** three whose entire subject was deleted are gone
  (`scpExperimentEngine`, `scpSelfProvisioning`, `scpCustomerLifecycle`). One was
  NOT deleted — `tests/unit/enhancements.test.ts` covers ELEVEN `*Enhancements`
  modules, nine of which have real production importers and are untouched. Only
  the `marketplaceEnhancements` and `securityEnhancements` sections were removed,
  each replaced by a note recording why. **Assuming that family was uniformly
  dead would have deleted nine live modules.**

  **DELETION-REVEALED, queued:** nine tables lost their only writer —
  `auth_fail_attempts` (authLockout); `agent_playbooks` + `playbook_evolutions`
  (playbookEvolutionV9, which the ratchet note had explicitly predicted);
  `compass_recommendations`; `spend_watchers` + `spend_optimizations`;
  `causal_investigations`; `delegated_goals`; `external_intelligence`.
  `tablesNoWriter` 49→58, `tablesNoReader` 61→70. **NOT dropped** — a production
  `DROP TABLE` is a founder-only hard stop — and all nine join the drop-decision
  queue alongside `tax_strategies` and `tax_forecast_scenarios` from B17.

  Counts locked in the same commit: `unreachedExports` 651→580, `moduleOrphans`
  61→45, `opaqueExports` 986→984, `as-any` 1390→1383, `colon-any` 2988→2975.

- **2026-08-15 — `server/services/promptInjectionSanitizer.ts` (111 lines).**
  Founder ruling (picker, 2026-08-14): *"Consolidate to one owner."*

  A module orphan — four exports, zero callers — and the WEAKEST of **three**
  independent prompt-injection deny-lists the repo carried, each from a different
  named initiative. Measured against a 30-attack corpus: this one missed 18,
  `server/middleware/promptInjection.ts` missed 14, `server/utils/sanitizePrompt.ts`
  missed 10.

  **DELETION ALONE WOULD HAVE LOST COVERAGE, which is why this is a
  consolidation and not a removal.** The three lists were *complementary, not
  nested*: four attack classes were caught ONLY by the module nothing imported —
  a generic persona override ("You are now a pirate…"), "act as though you have
  no restrictions", "### END OF DOCUMENT", and a forged line-start `system:` role
  line. Those four were merged into `utils/sanitizePrompt.ts` FIRST. Two of them
  were **narrowed** on the way in, because the orphan had never felt its own
  false positives: its bare `act as (if|though)` redacted "Buyer to act as if the
  contract were assignable", and its `forget everything` redacted "Seller will
  forget everything about the prior offer" — ordinary contract language on a
  real-estate product.

  **What the deletion exposed** was worse than the dead module. Two exported
  functions were both named `sanitizePrompt` with different semantics, and
  `server/ai/executive.ts` — Pax's chat engine, on both chat paths — had imported
  the weaker one. It sanitized org knowledge files and Pax project files with it
  and concatenated the result into the **SYSTEM role message**, with no
  `<<USER_DATA>>` envelope, although Pax's system prompt only instructs the model
  about that envelope. Uploaded document text carrying `<|im_start|>`,
  `</system>`, `[INST]`, "disregard the above rules" or "override your system
  instructions" reached the system prompt intact. `mentionedEntities[].name` — a
  bare `z.string()` off the request body — reached it with no sanitization at all.

  **A FOURTH copy** turned up while the guard test was being written:
  `server/utils/injectionRateLimiter.ts` held a hand-copied subset (9 markers
  where there were 15, 10 phrases where there were 20) beneath a header claiming
  it used *"the same INJECTION_PHRASES/MARKERS regex set used by
  sanitizePrompt"*. So probes the sanitizer redacted never incremented
  `ai_injection_attempts` — a founder-visible count that was a systematic
  undercount. It now calls `detectInjectionPatterns()` from the one owner.

  **Nothing was caught less.** The pre-existing `promptInjection.test.ts` — 24
  attacks and 14 legitimate inputs, written against the middleware's own list —
  passes unchanged through the delegating middleware.

  Counts locked in the same commit: `unreachedExports` 1439→1436,
  `moduleOrphans` 45→44. No tables were revealed: the module had no writer.

- **2026-08-15 — the three `/developer/*` endpoints in `routes-epic-services.ts` (75 lines).**
  Founder ruling (picker, 2026-08-15): *"Remove the three /developer/* endpoints."*

  | endpoint | what it did |
  |---|---|
  | `GET /developer/openapi` | served a document titled **"AcreOS Public API"** |
  | `POST /developer/api-keys` | minted an `acr_…` secret for **any authenticated customer** |
  | `GET /developer/widget-embed/:type` | handed out `pub_<orgId>_<base64(orgId)>` as a "publicApiKey" — the org id encoded, not a secret |

  **Two reasons, and the second is what made it urgent.**

  **1. A standing decision enforced in one place and defeated in another.**
  CLAUDE.md's expansion ladder says *"no public API before ~50 customers"*, and
  `routes-api-keys.ts` is kept **deliberately dormant** because of it — the
  reachability ratchet's own note records that as the reason `unregisteredRoutes`
  sits at 1. This router mounts at `/api` behind plain `isAuthenticated`, so any
  customer could mint a key and fetch the spec.

  **2. The keys were inert, and the response said otherwise.** `POST` returned
  the plaintext with `warning: "Store this key securely. It will not be shown
  again."` — and **nothing verified it**. The only consumer of
  `organizationIntegrations` keys is `mcp-server.ts`, which matches
  `provider = 'mcp_api_key'`; this wrote `provider = 'api_key'`. The rate limiter
  written for it (`createApiKeyRateLimit`, "public developer API") has zero
  importers. A customer who integrated got nothing, forever, after being told to
  store the key securely. **Placeholder data presented as real**, which the
  DO-NOT-DO list forbids outright.

  **`services/developerApiService.ts` is KEPT, not deleted.** What was wrong was
  mounting the surface early, not writing the spec and the minting helper; when
  the ladder trigger fires, that module is the starting point and wiring it means
  building the verifier that never existed. It is allowlisted in the reachability
  ratchet as a deliberately-staged seam — the first entry of a new
  `module-orphan` kind, added because that family was the only one with no escape
  valve.

  Counts locked in the same commit: `as-any` 1383→1381, `colon-any` 2975→2972.
  Reachability held at baseline via the allowlist rather than a raise.

- **2026-08-15 — B19 orphan triage executed: 15 modules, ~4,100 lines** (founder
  ruling, picker: *"Delete all 15"*). A 27-agent triage classified all 44 module
  orphans — every DELETE recommendation adversarially refuted by a second agent,
  importers re-verified centrally per wave discipline. Result: 15 delete / 6 wire
  (class 1 regulated, untouched) / 12 keep / 11 refuted-or-unclear (stay in B19).

  **Superseded duplicates** (the live rival named in each case):
  `addressValidation.ts` (→ `directMailService.verifyAddress`; its one unique
  capability, the pre-flight cheap-reject, PORTED as
  `directMailService.isAddressMinimallyValid` with Lob's rate limits recorded),
  `atlasToolRegistry.ts` (→ the App Intent registry; its `atlas_tool_usage`
  table exists in no migration — nothing to drop), `compoundSagas.ts`
  (→ `sagaOrchestratorV12`), `data-cache/free-source-router.ts` (→ the live
  broker, which already does free-source-first and carries the FEMA host fix this
  copy would have regressed).

  **Fabricators** — the refuse-not-fabricate rule converts "wire it" into
  "delete it": `freedomCalculator.ts` (summed payments with NO status filter;
  the founder/Quinn 503 at `routes-data-intelligence.ts:429` is the honest
  answer and stays), `opportunityZoneAnalyzer.ts` (invented OZ tax rates stated
  as fact — the deleted-tax-engine pattern exactly), `portfolioIntelligence.ts`
  (hardcoded 0.15 capital-gains rate, three times), `productEvolutionEngine.ts`
  (build estimates derived from `gap.length` — a string length),
  `quizGrading.ts` (keyword-overlap presented as a student grade),
  `tenantMetering.ts` (invented price list existing in no billing system),
  `soren/seoSeed.ts` (rows stamped `source: "serp_scrape"` for scrapes that
  never happened), `autonomousSalesPipeline.ts` (invented ARPU/LTV; the ledger's
  2026-08-01 "KILL with their parents" ruling already covered it),
  `negotiationPipeline.ts` (invented high-motivation statistic; live rivals:
  `negotiationOrchestrator` + `aiOfferService` + `sellerPsychologyStrategy`).

  **Structurally unsound:** `learningAnalytics.ts` — its org parameter was a
  lie: `courses`/`course_enrollments`/`tutor_sessions` carry NO tenant key, so
  wiring it would have shipped one org's dashboard filled with every org's data.
  **Experiment:** `reactionChainSeeder.ts`.

  **Companions:** `client/src/components/freedom-progress-card.tsx` (zero
  importers, queried a nonexistent endpoint) and three test files whose imports
  were `vitest` only — they tested INLINE COPIES of their dead subject and
  pinned nothing (`freedomCalculator`, `negotiationPipeline`,
  `portfolioIntelligence`). `addressValidation.test.ts` was REPOINTED at the
  ported function instead, per the wave rule. Two `ownedServices` strings
  removed from `companyAgents.ts` — the B17 trap, third occurrence.

  **DELETION-REVEALED, queued:** `product_specifications`,
  `build_buy_decisions`, `feature_impact_scores` (only writer:
  productEvolutionEngine), `opportunity_zone_holdings` (only writer:
  opportunityZoneAnalyzer), `tutor_sessions` (last reader: learningAnalytics).
  `tablesNoWriter` 58→62, `tablesNoReader` 70→75. **NOT dropped** — all five
  join the founder drop queue (now sixteen tables).

  Counts locked in the same commit: `unreachedExports` 1436→1405,
  `moduleOrphans` 44→29, `opaqueExports` 125→120.

- **2026-08-16 — 48-table dead-storage triage; thirteen dropped (migration 0236).**
  Founder ruling (picker, this date): *"Triage 3 ways, drop only experiment
  residue."*

  **The population, measured not assumed.** `node scripts/lint-reachability.mjs
  --measure` reports `tables-no-writer: 62` and `tables-no-reader: 75`. The
  INTERSECTION — no `.insert/.update/.delete` **and** no `.from(`/`db.query.`
  anywhere in code — is **48 tables**. Every one of the 48 is classified below;
  none is left unstated.

  **The raw-SQL check, because the linter only sees Drizzle.** A table reached
  through `` sql`SELECT … FROM foo` `` is alive and this linter cannot see it.
  Each of the 48 snake_case names was searched across `server/`, `client/` and
  `shared/` (minus the schema files) for SQL-shaped access — `FROM x`, `INTO x`,
  `UPDATE x`, `JOIN x`, `DELETE FROM x`, `TABLE x`. **Result: zero.** Not one of
  the 48 has a raw-SQL access site. Two mentions inside `server/` turned out to
  be prose in comments (`entityPortfolio.ts:279` names `opportunity_zone_holdings`;
  `server/ai/paxModelTier.ts:115` describes a `ai_eval_gate_runs` pipeline as a
  *"remaining unblock"*, i.e. something not built).

  **The alias check, which the raw-SQL check would have missed.** The linter
  keys on the `pgTable` identifier, so a table re-exported under a second name is
  invisible to it. `rg "^export const \w+ = \w+;"` over `shared/schema*.ts` finds
  exactly one such alias in the entire schema — and it is load-bearing:

  > `shared/schema.ts:12463` — `export const marketIndicators = marketIndicatorsDuplicate;`

  `server/services/marketPrediction.ts` **reads it (`.from(marketIndicators)`,
  `orderBy`) and writes it (`.insert(marketIndicators).values(…)`)**. So
  `market_indicators_temp` is **NOT DEAD** — it is a linter false positive, and
  the only reason it looks dead is the alias. It is class C below and must not be
  dropped. One table found this way; had the sweep skipped the alias check, a
  live market-data table would have been deleted out from under a live service.

  **CLASS A — experiment / agent residue. 15 tables. THIRTEEN DROPPED.**
  The bar was deliberately conjunctive: (a) provably left behind by a module a
  ledger row ALREADY records as killed, and (b) holds no customer content.

  | table | evidence | disposition |
  |---|---|---|
  | `playbook_evolutions` | writer `playbookEvolutionV9` deleted 2026-08-14 (B19 class 3); named in that entry's own DELETION-REVEALED list. Champion/challenger mutation records. No org key. | **DROPPED** |
  | `agent_improvement_plans` | owning service `agentSelfImprovement` + `AgentGrowth.tsx` deleted 2026-08-06 (V6–V14 row). Per-agent goals / skill requests. No org key. | **DROPPED** |
  | `agent_synergy_map` | owning service `agentSynergyMap` + `SynergyMap.tsx` deleted 2026-08-06 (V6–V14 row). Agent-pair collaboration counters. No org key. | **DROPPED** |
  | `compass_recommendations` | writer `compassAutoRecommendV9` deleted 2026-08-14; in that entry's DELETION-REVEALED list. Agent mode suggestions to the founder. No org key. | **DROPPED** |
  | `spend_watchers` | writer `spendAutonomyV9` deleted 2026-08-14; in that list. AcreOS's OWN vendor spend figures. No org key. | **DROPPED** |
  | `spend_optimizations` | writer `spendAutonomyV9` deleted 2026-08-14; in that list. AcreOS's own savings proposals. No org key. | **DROPPED** |
  | `causal_investigations` | writer `causalReasoningV9` deleted 2026-08-14; in that list. Internal anomaly root-cause analyses. No org key. | **DROPPED** |
  | `delegated_goals` | writer `delegationDepthV9` deleted 2026-08-14; in that list. Agent-to-agent goal cascade. No org key. | **DROPPED** |
  | `external_intelligence` | writer `externalIntelligenceV9` deleted 2026-08-14; in that list. Competitor / market notes. No org key. | **DROPPED** |
  | `product_specifications` | only writer `productEvolutionEngine` deleted 2026-08-15 as a FABRICATOR; in that entry's DELETION-REVEALED list. AcreOS's own roadmap specs. No org key. | **DROPPED** |
  | `build_buy_decisions` | same writer, same wave, same list. AcreOS's own build-vs-buy analyses. No org key. | **DROPPED** |
  | `feature_impact_scores` | same writer, same wave, same list. AcreOS's own feature adoption scores. No org key. | **DROPPED** |
  | `automation_executions` | the 2026-07-29 "/automation rules twin" row deleted the surface because `createAutomationExecution` had **ZERO call sites** — the log can never have held a row — and that row says the tables "remain in `shared/schema.ts` pending a drop migration". Derived execution log, not authored by anyone. | **DROPPED** |
  | `agent_playbooks` | class A **by content** (agent SOPs, no org key, writer deleted 2026-08-14) but **structurally blocked**: `institutional_patterns.linked_playbook_id` and `signal_correlations.auto_trigger_playbook_id` hold FKs into it, and neither of those tables is writer-less or reader-less. Dropping it means altering two LIVE tables. | **NOT dropped — stays queued** |
  | `scp_evolution_metrics` | class A by content (per-agent SCPv2 evolution counters, no customer row), but `server/services/scpGoldenSuite.ts` still names the identifier in its import list. It is an **unused import** — the symbol appears nowhere else in that file — yet removing the schema export without deleting that one token breaks the build, and that file was outside this unit's file set. | **NOT dropped — one-token unblock recorded** |

  **CLASS B — customer or regulated records. 22 tables. NONE DROPPED.**
  Customer-data deletion is a founder-only hard stop and this ruling did not
  authorise it. The obligation named is the one that would bind the rows:

  | table | obligation that applies |
  |---|---|
  | `investor_verification_documents` | BSA/AML CIP recordkeeping (31 CFR 1023.410 — 5 years past account closure); the rows point at uploaded passports / driver's licences / proof-of-funds. GLBA safeguarding. |
  | `investor_verification_history` | the KYC decision AUDIT TRAIL (who changed status, when, why). Destroying it destroys the evidence that the KYC in the sibling table was performed. |
  | `background_check_results` | FCRA / FACTA Disposal Rule (16 CFR 682) governs how consumer-report data is destroyed, not whether it may be; `report_data` is a third-party investigative report on a named person. |
  | `contractor_w9_documents` | IRS — W-9 backup-withholding records retained 4 years after the year of the 1099 (Treas. Reg. §31.6001-1). Rows carry TIN/SSN document pointers. |
  | `borrower_payment_profiles` | Reg-E / NACHA authorization records for a borrower's stored payment method (last4, brand, autopay day) plus borrower email + phone. Money rail. |
  | `property_photos` | customer-uploaded property imagery; `storage_key` is the ONLY pointer to the object-storage blob, so dropping the table orphans the customer's files rather than deleting them. |
  | `lien_search_records` | title/lien diligence on a customer's property — part of the transaction file a closing is defended with; `raw_data` holds courthouse source records. |
  | `cma_reports` | valuation work product, org-scoped, with a domain-expert reviewer and sign-off timestamp; the schema comment says outright "the data row is the legal artifact". Separately, `scripts/check-residential-comps-hold.mjs` names this table as part of the standing residential-comps hold. |
  | `auction_readiness_checklists` | per-property pre-auction diligence with an expert sign-off timestamp and signer — the record that diligence occurred. |
  | `compliance_checklist_items` | per-DEAL disclosure compliance evidence (`completed_by`, `completed_at`, `notes`) under state real-estate disclosure statutes. |
  | `regulatory_requirements` | the legal-citation database those checklist items reference by FK. Not customer rows itself, but dropping it orphans a class-B customer record and destroys the citation basis for disclosures already made. |
  | `depreciation_schedules` | IRS basis records — must survive until 3 years after the property is disposed of (Pub 946), routinely decades. Per-property, org-scoped. |
  | `opportunity_zone_holdings` | **contradicts this unit's brief, deliberately.** The brief listed it as class A; its COLUMNS are `investment_date`, `initial_investment`, `deferred_gain_rollover`, `step_up_basis`, `exit_value`, org- and property-scoped. That is a customer's OZ investment record feeding IRC §1400Z-2 elections and annual Form 8997 — a 10-year hold whose basis records must outlive it. Class B. |
  | `tax_strategies` | **contradicts the brief.** Org-scoped, references the customer's own `applicable_properties`, and carries a lifecycle the customer moves (`recommended → implementing → completed → dismissed`). A tax position a customer acted on is a tax record. Class B. |
  | `tax_forecast_scenarios` | **contradicts the brief.** Org-scoped multi-year projections keyed to the customer's `property_ids`, with projected capital gain and tax liability. Same reasoning as above. |
  | `deferred_revenue` | ASC 606 revenue recognition tied to real Stripe subscription/invoice ids. Accounting records — 7-year retention, audit-relevant. |
  | `esign_webhook_events` | the ESIGN/UETA processing-dedup ledger for Dropbox Sign (`event_id` unique, `signature_request_id`). It is the record that a signature event was seen exactly once. E-sign is a **KEEP** module ("Elite features"), so this is more likely a *built-but-unwired* writer than residue — see the note below. |
  | `automation_rules` | **the ledger already prescribes a drop for this one** (2026-07-29, "/automation rules twin": tables "remain … pending a drop migration"). It is still class B: the rows are CUSTOMER-AUTHORED (`name`, `description`, `conditions`, `actions`, `created_by`, `organization_id`). Customers authored rules that could never run; the rules are still their words. Only the derived execution log was dropped. |
  | `tax_sale_alerts` | customer-authored saved searches and notification preferences, org-scoped. Customer configuration, not derived state. |
  | `webhook_deliveries` | org-scoped delivery log whose `payload` and `response_body` hold customer record contents verbatim. Also: **BLOCKERS B8** is an open adjudication of exactly which of the two webhook rails survives — dropping one side pre-empts that decision. |
  | `tutor_sessions` | Academy residue (last reader `learningAnalytics`, deleted 2026-08-15) — but the rows are `user_id` + a `messages` jsonb of `{role, content, timestamp}`. That is a **user's conversation transcript**. The Academy KILL row names three tables to drop (`courses`, `course_modules`, `course_enrollments`) and this is not among them. Class B. |
  | `auth_fail_attempts` | **contradicts the brief.** Left behind by `authLockout.ts` (deleted 2026-08-14 as a superseded duplicate), so the provenance is class A — but the columns are `ip`, `email`, `user_agent`, `failure_reason`. Failed-login telemetry naming a person is personal data under GDPR/CCPA and is also security-incident forensic material. Whatever the right answer is, it is not "experiment residue". |

  **CLASS C — everything else / unclear. 11 tables. NONE DROPPED.**
  What is unclear is stated per table, so the next session starts from a
  question rather than a re-derivation:

  | table | what is unclear |
  |---|---|
  | `market_indicators_temp` | **NOT DEAD — linter false positive.** Live read AND write through the `marketIndicators` alias in `server/services/marketPrediction.ts`. What is unclear is only whether the table should keep the `_temp` name and the `marketIndicatorsDuplicate` identifier; the alias is what hid it from the gate and it deserves an allowlist entry rather than a drop. |
  | `tenant_metrics` | **contradicts the brief**, which listed it class A. No ledger row ever killed it, and white-label is **FREEZE**, not KILL, with a recorded reactivation criterion ("first enterprise/white-label contract"). Its `revenue_generated` column is billing-adjacent. Dropping a frozen subsystem's metering table pre-empts its reactivation. (Its likely former writer, `tenantMetering.ts`, was deleted 2026-08-15 as a fabricator — but that wave's own DELETION-REVEALED list does not name this table, so the provenance is not proven.) |
  | `photo_analysis` | derived Vision-API output, but `photo_id` is a NOT-NULL FK into `property_photos`, which is class B and retained. Dropping the analysis while keeping the photos is incoherent; the two should be adjudicated together. |
  | `ai_models` | platform model registry (model keys, per-1M token costs). No customer content and no ledger KILL — it reads as built-but-unwired: `scripts/migrate.mjs` creates it and nothing has ever read it. Whether AI cost accounting is *supposed* to consult it is a live question, not residue. |
  | `ai_eval_gate_runs` | CI eval verdicts, no customer content, no ledger KILL. `server/ai/paxModelTier.ts:115` describes writing and reading this table as a **"REMAINING UNBLOCK … left as a founder-owned follow-on"** — so it is a deliberately staged seam, not a corpse. Dropping it would delete the destination of a decision the founder still owns. |
  | `org_credits` | money-adjacent. Its own header says it is a best-effort CACHE whose source of truth is `financial_ledger`. Unclear whether the cache was retired on purpose (in which case dropping it is right) or whether a rate gate lost its fast path. |
  | `retention_events` | activation/retention funnel telemetry behind `/founder/activation` (migration 0055). No ledger KILL; carries `user_id`. Reads as a founder surface whose writer was never wired, which is a wiring question, not a deletion one. |
  | `cohort_assignments` | same wave, same funnel, same question; carries `user_id` and a `variant` that would decide what an org SEES if the funnel is ever wired. |
  | `county_redemption_rates` | county/year statistical reference data for redemption-risk prediction. No org key, no customer content, but also no ledger KILL — it is reference data that would have to be re-acquired, not residue of a killed module. |
  | `deal_sources` | the county-scraper source registry (`base_url`, `scraping_config`, including an `api_key` field). No ledger KILL. `scraped_deals` alongside it is also writer-less, so the whole scraping lane is dormant — that lane needs one verdict, not a table-by-table one. |
  | `personal_bests` | genuinely unused, but NOT deletion residue: `server/services/personalBests.ts` is alive (dynamically imported by `server/routes-platform-features.ts:303`) and computes personal bests **from `deals` on the fly**, never touching this table. So it is built-but-unwired storage next to a live in-memory computation — the question is whether milestones should persist, not whether this is a corpse. |

  **WHAT THE DROP ACTUALLY DELETES IN PRODUCTION, stated because it is less
  than it looks.** Twelve of the thirteen have no `CREATE TABLE` anywhere in
  `migrations/*.sql` or `scripts/migrate.mjs` — measured, that is why they sat in
  `scripts/schema-migrate-mirror.allowlist.json`, whose gate note records that
  `db:push` is NOT run in prod. For those twelve the `DROP TABLE IF EXISTS` is
  expected to be a no-op against a table prod never had, and the real deletion is
  the removal of the `pgTable` definitions. `automation_executions` is the single
  exception: created by `migrations/0001_brief_giant_man.sql`, it exists.

  **No `CASCADE` anywhere**, deliberately: cascade would silently take dependent
  objects this ruling never named. Verified before writing: zero
  `REFERENCES <table>` matches across `migrations/` and `scripts/migrate.mjs`,
  and zero inbound `.references(() => …)` across `shared/` and `server/`, for all
  thirteen. The two outbound FKs point at tables that SURVIVE
  (`playbook_evolutions` → `agent_playbooks`, `automation_executions` →
  `automation_rules`).

  **Executed:** `migrations/0236_drop_experiment_residue_tables.sql`, mirrored
  statement-for-statement in `scripts/migrate.mjs` (a migration file nothing runs
  is this repo's most common defect), and the thirteen `pgTable` definitions
  removed from `shared/schema.ts`. **Not applied** — this session has no
  `DATABASE_URL` and did not seek one.

  **Counts MEASURED after the change** (`table-count` and `lint-reachability`
  baselines are locked centrally and were not edited here):
  `table-count` 763 → **750**; `tablesNoWriter` 62 → **49**; `tablesNoReader`
  75 → **62**.

  **What happened to the sixteen-table founder queue, counted exactly.** Ten of
  the sixteen were dropped (`playbook_evolutions`, `compass_recommendations`,
  `spend_watchers`, `spend_optimizations`, `causal_investigations`,
  `delegated_goals`, `external_intelligence`, `product_specifications`,
  `build_buy_decisions`, `feature_impact_scores`). Five were **answered "no"** —
  they are class B, and "drop only experiment residue" is a decision about them,
  not a deferral: `tax_strategies`, `tax_forecast_scenarios`,
  `opportunity_zone_holdings`, `auth_fail_attempts`, `tutor_sessions`. One
  remains genuinely open: `agent_playbooks`. Two items JOIN the open list that
  were not on the original queue — `scp_evolution_metrics` (class A, blocked on a
  one-token import edit outside this unit's file set) and `automation_rules`
  (class B, but the 2026-07-29 ledger row already asks for its drop, so the
  conflict needs the founder's explicit customer-data nod). **Open: three.**

  **Registers this deletion invalidates** — every one measured by running the
  gate, not guessed. All three are outside this unit's file set and must be
  updated in the same commit or CI fails:
  - `scripts/schema-migrate-mirror.allowlist.json` — 12 stale entries
    (`agent_improvement_plans`, `agent_synergy_map`, `build_buy_decisions`,
    `causal_investigations`, `compass_recommendations`, `delegated_goals`,
    `external_intelligence`, `feature_impact_scores`, `playbook_evolutions`,
    `product_specifications`, `spend_optimizations`, `spend_watchers`);
    allowlist 95 → 83.
  - `tests/unit/schemaMigrationDrift.test.ts` — `BASELINE_ORPHANS`, the same 12
    names, 95 → 83. Its second test fails on stale entries by design.
  - `scripts/check-org-leading-index.mjs` — `BASELINE_OFFENDERS` contains
    `"automation_executions"` (the only one of the thirteen carrying an
    `organization_id`); it must go — set size 150 → 149. The gate already FAILS
    on it: *"stale allowlist entries: 1"*.

- **2026-08-16 — `scripts/check-route-cost-class.mjs` (681 lines, 29,146 bytes)
  deleted.** Founder ruling (picker, this date): resolve **BLOCKERS B22**, and
  the option selected was **DELETE** — B22's branch (b), "an abandoned
  experiment … the deletion ledger's usual verdict for a thing built and never
  wired". Recorded as a KILL of a GATE, which is a first for this log: every
  prior row killed product code, and a dead gate is the same defect class
  pointed at governance instead of features.

  **What it was meant to enforce.** "L5b — Route cost-class lint": that every
  *new* route handler added to `server/routes*.ts` declares a cost class, by
  carrying `costClass(...)` or `withCostClass(...)` in its argument list. The
  middleware it was written to protect — `server/utils/costClass.ts` — is LIVE
  and is NOT deleted: `costClass(` appears ten times in `server/` outside its
  declaring file, nine of them real middleware applications across four
  `server/routes-*.ts` files (`routes-support-tickets` ×3, `routes-founder-letters`
  ×2, `routes-admin-finance` ×2, `routes-transparency` ×2) and one a comment
  (`server/middleware/apiTelemetry.ts:190`). What died is the enforcement, not
  the capability.

  **NOTHING EVER RAN IT — the whole reason this is a deletion and not a fix.**
  Re-established from scratch this date rather than taken from B22: `grep -rn
  "check-route-cost-class"` across the whole tree (excluding `node_modules/`
  and `.git/`) returns the script's own log strings, two prose comments, and
  B22 itself — no invocation anywhere. It is in none of `package.json`'s 25
  `lint:*`/`check:*` entries, none of the 20 files in `.github/workflows/`, and
  not in `.githooks/pre-commit`; the repo has no Makefile; and there is no
  wildcard runner (`scripts/check-*.mjs`) that would have swept it up. A gate
  nobody runs is a file.

  **And it would have failed on contact, measured both ways.** In audit mode
  (`--all`) it reports **1,862 unclassified route call sites of 1,868** across
  **270** route files — 6 classified — and exits 0, because audit mode never
  fails. In its real (CI) mode against `origin/main...HEAD` it exits **1** on
  **29 added route lines** in a **1,111,071-byte** diff. Its own header records
  why 6 and not 9: `ROUTE_METHOD_RE` matches only receivers named `app` or
  `router`, so the three `costClass`'d routes registered on the `api` router in
  `server/routes-support-tickets.ts` were invisible to it in both directions.
  Wiring it as-is would have failed the build on day one.

  **THE DEBT IS NOT A REGRESSION UNIT 130 INTRODUCED — verified, with one
  correction to B22's wording.** B22 says the gate "was red before and after"
  unit 130 touched it. What is actually true is sharper and worth writing down:
  the pre-130 version (`git show 51b2efa:…`, 220 lines) run on THIS tree exits
  **0** — falsely. Its `gitDiff()` was `catch { return ""; }`, and the diff it
  asks git for is 1,111,071 bytes against Node's 1,048,576-byte default
  `maxBuffer`; `execSync` on that exact command at the default throws
  **ENOBUFS** (reproduced directly), the old `catch` swallowed it, and the gate
  printed *"no new routes in diff vs origin/main"*. So the pre-130 run was not
  a pass, it was an unanswered question wearing a pass's clothes. The
  measurement that IS comparable — `--all` on the same tree — returns the
  **identical 1,862 / 270** under both versions. Unit 130 did not create the
  redness; it replaced a false clean with a true failure. **Deleting this hides
  nothing that unit 130 broke.**

  **Salvage check, because losing a good idea to a cleanup is a real cost.**
  The route EXTRACTOR is NOT worth preserving: `scripts/check-route-order.mjs`
  (208 lines, wired as `lint:route-order`) already has a strictly broader one —
  it walks `server/` recursively (floors `serverFiles` 1000 / live 1,370,
  `routes` 2100 / live 2,860) where this gate did a non-recursive `readdirSync`
  filtered to `routes*.ts` (270 files, 1,868 calls), and its `pat` matches
  `api|app|router` where `ROUTE_METHOD_RE` matched only `app|router`. The
  paren-balancing block walker (`readRouteBlock`) is not unique either;
  `depth === 0` balancing walkers already exist in `check-org-scoped-fetch.mjs`,
  `check-org-leading-index.mjs`, `lint-prompt-envelope.mjs` and
  `audit-schema-drift.mjs`. **Two things here have no equivalent elsewhere and
  are recorded so a rebuild starts from them, not from zero:** (1) it was the
  repo's ONLY diff-delta gate — the sole user of `--unified=0 …...HEAD` and
  `LINT_BASE_REF` in `scripts/` — and its `gitDiff()` null-vs-`""` discipline
  plus 256 MB `maxBuffer` is the fix for the measured ENOBUFS above, which will
  bite the next delta gate anyone writes; (2) `check-route-order.mjs` has
  vacuity FLOORS but no predicate SELF-TESTS and no in-repo CANARIES, and this
  gate had both (positive *and* negative predicate cases, synthetic
  single-/multi-line end-to-end, a diff-parser test that also proves it does
  not invent routes from unrelated hunks, and three named live files that must
  keep reading as classified). That pattern is the better idea in this file and
  belongs in the gates that survive.

  **What would have to be true to rebuild it** — all three, or it comes back
  dead: (a) a **frozen baseline of the 1,862**, the way
  `scripts/check-org-scoped-fetch.mjs` freezes its tenancy debt in
  `BASELINE_OFFENDERS` / `BASELINE_UNUSED_ORG` with stale entries failing the
  gate, so pre-existing debt is pinned and only NEW routes fail; (b) **wiring**
  — a `lint:*` entry in `package.json` reachable from `npm run check`, since an
  unwired gate is what this row is deleting; and (c) the receiver set widened
  to `api|app|router` FIRST, because freezing 1,862 while blind to a whole
  receiver freezes a number that is wrong by construction.

  **Registers checked after the deletion, by running them** (no ratchet file
  edited; both are outside this unit's file set and neither needed a change):
  `node scripts/lint-reachability.mjs` → **exit 0**, all six counts unmoved at
  baseline (`unreached-exports` 1401, `tables-no-writer` 48, `tables-no-reader`
  60, `unregistered-routes` 4, `module-orphans` 28, `opaque-exports` 120) —
  notable because `scripts/` IS a scanned consumer directory for that gate, so
  a deletion there can strand an export; it did not. `node
  scripts/check-ledger-refs.mjs` → **exit 0**, populations unchanged
  (`ledgerVerdictRows` 11, `ledgerRefs` 20, `registryOpenBlocks` 25,
  `registryRefs` 16). This row cites the deleted path deliberately and safely:
  the "Executed deletions (log)" section is the one that gate does not scan,
  precisely so an executed deletion may name what it deleted.

  **Residue, flagged not fixed — outside this unit's file set.** Two prose
  comments now point at a file that no longer exists, and both were already
  false before the deletion (they describe enforcement that never ran):
  `server/utils/costClass.ts:37` (*"The `scripts/check-route-cost-class.mjs`
  script enforces that any…"*) and `server/utils/outboundFetch.ts:22`
  (*"…will eventually be extended to…"*). Neither is reached by
  `check-ledger-refs` (it scans the verdict table and the defect registry, not
  source comments), so nothing fails on them — which is exactly why they need
  to be named here rather than left to rot.

---

### `governedExecute` — deleted 2026-08-19

**What it was.** A wrapper in `server/services/agentActionExecutors.ts` around
`executeAction`, adding a `governanceBrainV13` policy check before dispatch and a
chronicle log after it.

**Why it went.** Zero call sites — every live path called the bare
`executeAction` — and what it added was not governance:

- its policy check ended in `catch { /* Governance check failure is
  non-blocking — proceed with caution */ }`, the same fail-open closed in the
  same file's confidence-cascade gate the same week. Wiring it would have ADDED
  a permissive path to a system while looking like a safety layer;
- it passed `ctx.input.orgId || 0`, inventing the org sentinel this repository
  forbids by name;
- its "log to chronicle for institutional memory" step was an empty `try` block
  containing a comment and no code.

**Why retire rather than wire.** The bootstrap audit had just demonstrated the
cost of a file that reads as enforcement and is not: a steward looked at
`agentAuthorityGate.ts`, saw a founder-only hard-stop list, and concluded agent
autonomy was bounded by it — when no live action can match any of those 15 names.
`governedExecute` was the same shape one module over. A broken safety wrapper is
worse than no wrapper, because the next reader budgets their attention against it.

**What replaces it.** The confidence cascade inside `executeAction`, which now
refuses when it cannot be evaluated (rather than proceeding), and which is
exempt-by-name rather than gated-by-name, so a new executor is gated by default.

**Reactivation criteria.** If `governanceBrain` should gate agent actions, that
is a fresh design against a working gate — a policy check that fails CLOSED, a
real tenant, and a call site — not a resurrection of this. The intent was sound;
only the implementation was a stub.

---

## `atlasContextInjector` / `communicationDeduplication` / `userAiCostControls` — executed 2026-08-19

**What went.** Three service modules, 710 LOC, that nothing in the repository
loaded: `server/services/atlasContextInjector.ts` (344), `.../userAiCostControls.ts`
(234), `.../communicationDeduplication.ts` (132), plus `tests/unit/atlasContext.test.ts`.

**Why they were invisible.** Each opened with a docblock showing callers how to
use it —

```
 * Usage:
 *   import { commDedup } from "./communicationDeduplication";
```

— and `lint-reachability` scanned raw source, so it read the usage example as
the module importing ITSELF and reported all three as imported. The gate that
exists to find built-and-unwired code was certifying it wired. The scanner now
strips comments before both import scans; see cross-pollination ledger entry 35
and `reachabilityGate.test.ts` → "a comment is not code".

**Why deleted rather than wired.** Each duplicated a live canonical owner with a
weaker mechanism, and two had already been reviewed and handed onward by the
2026-08 audit without action (`09-correctness.md:68`; `16-cost.md` F-16-3):

- `commDedup` — Redis-or-in-memory-`Map`, check-then-act (`isDuplicate` →
  `fn()` → `markSent` is not atomic) with `catch { return false; // fail open }`,
  beside the DB-backed outward-action ledger + `idempotencyKey` that
  `emailService` and `directMailService` already run on.
- `userAiCostControls` — a spend cap that fails OPEN: the usage read catches
  everything and falls back to a per-process `Map`, so with Redis down it reads
  0 and never fires, and with no `REDIS_URL` it is per-instance and resets on
  restart. `DEFECT-0017` in the defect registry claimed this class FIXED; that
  entry has been corrected in the same commit. The DB-backed owners
  (`intelligence/budget`, `founderInboxBudget`, `credits`, `outreachStopLoss`)
  are unaffected.
- `atlasContextInjector` — eagerly assembled portfolio state into every Pax
  turn (~9 sequential DB reads) that Pax already fetches on demand via
  `get_deals` / `get_stale_leads` / `get_tasks` / `get_pipeline_summary` /
  `get_notes`. Eager injection would have been strictly worse than the live tool
  surface it duplicates.

**Cascade, followed rather than baselined.** Deleting the injector revealed
`buildPaxSystemPromptAddition` in `paxRelationshipArc.ts` — one production
consumer, and it was the dead injector. Deleted too, with a tombstone in place,
because of what it rendered into Pax's system prompt: *"You MAY take autonomous
actions (create tasks, flag deals) without explicit permission"*, granted on a
stage that advances on an interaction COUNTER. It had never reached a prompt.
Wiring it would put a permission grant in a channel with no authority to issue
one — autonomy is decided by `autonomyGuardrails`/`autonomousAgentEngine.evaluate`
and enforced in `executeTool`'s approval kernel — so it could only make Pax
attempt refused actions and make the next reader believe usage buys authority.
`getRelationshipState`, `getStageBehavior` and `recordPaxInteraction` are live
behind `/api/pax/relationship` and were not touched.

**Not opportunistic.** These were adjudicated because a gate change surfaced
them, on the execution rule that a revealed orphan is resolved in the commit
that reveals it rather than baselined. No tables were involved (none of the
three owned one), no webhooks, no feature flags, no client surface.
`unreachedExports` 1398 → 1395 and `moduleOrphans` held at 28 in the same
commit.

**Reactivation criteria.** Per-user AI spend caps, if wanted, are a fresh design
against a DB-backed counter that fails CLOSED — see the corrected `DEFECT-0017`
and `docs/audit-2026-08/16-cost.md` F-16-1, which records the still-open
`/api/va` gap. Outbound-send deduplication is already owned by the
outward-action ledger; extend that, do not re-add a parallel cache. Live
portfolio state in Pax's prompt is a product question, not a restore: Pax reads
it on demand today, and the trade is per-turn tokens and latency against fewer
tool round-trips.

---

## `schedule_background_job` (Pax tool) — executed 2026-08-19

**What went.** The tool definition, its dispatch case, and its App Intent
registry entry (`{ door: "today", scope: "deal_write" }`).

**Why.** It advertised four job types — `bulk_property_import`,
`bulk_lead_import`, `campaign_send`, `report_generation` — and its entire
implementation was:

```ts
logger.info(`[AI Tools] Background job scheduled: ${args.job_type} - ${args.description}`);
return { success: true, data: { message: …, jobType: args.job_type, status: "queued" } };
```

A user who asked Pax to run the overnight campaign send was told it was queued.
None of those four job types exists in `server/jobs` or the outbox. Not a stub
that returns nothing — a stub that returns a **status field**, using the word a
real queue would use, in the place a real queue would put it.

**Deleted rather than wired** because wiring it means building four job types,
and the defect is the claim to already have them. A tool that reports
`status: "queued"` and queues nothing is worse than one that does not exist:
with no tool, Pax says it cannot do the thing.

**Residue check.** The App Intent entry went in the same commit — a deleted tool
leaving a door and a scope declared behind it is this repository's most common
deletion residue. `paxPauseToolGate.test.ts` named it in a "must NOT be
pause-safe" list whose assertion a non-existent name satisfies trivially; the
entry was removed and a mirror hygiene case added so the next deletion cannot
leave a ghost there either.

**Reactivation criteria.** If Pax should schedule bulk work, the job types have
to exist first — the outbox is the mechanism (`fly.toml` documents its consumer
set) and `server/jobs/scheduler.ts` the lease. A tool comes after the job, not
before it.

---

## `batchLeadsSkipTrace` (connector executor) — executed 2026-08-20

**What went.** `batchLeadsSkipTrace` in `server/services/connectors/executor.ts`
and its dispatch branch in `server/ai/tools.ts`. The TOOL
`batch_leads_skip_trace` stays and still refuses (cross-pollination ledger 38):
a refusal that names what it needs and where to do it is better than a tool that
vanishes and leaves Pax improvising.

**Deletion-revealed.** The FCRA permissible-purpose gate added on 2026-08-19
returns before the dispatch switch, so the branch was unreachable the moment it
landed, and Pax was the executor's only caller — `grep` across `server/` and
`client/src` returned exactly two references, the dynamic import and the call,
both in `ai/tools.ts`.

**What it was, which is the part worth recording.** A consumer-report lookup run
with a bare `fetch` to `api.batchleads.io`: no provider registry, so no
`provider_cache`, no circuit breaker, no telemetry, no cost accounting, and no
license check. AcreOS already had a governed skip-trace path —
`services/providers/batchdata-provider.ts` registers the `skip_trace` category
with a cost of 15, a circuit breaker, and `license: "proprietary"` marking the
feed as non-redistributable. Two skip-trace implementations, one governed and
one not, and the ungoverned one was the one a customer could reach by typing a
sentence.

Its credentials came from a different store as well (`storage.getPaxConnector`
rather than `byok/dataByok`), so the two paths did not even share the customer's
key.

**Reactivation criteria.** If a BatchLeads skip trace is wanted, it belongs in
the provider registry as a provider — the registry already handles BYO keys
("runs on their account, platform COGS $0, pool never debited") and would give
it caching, breaking and a license flag. Not a second raw fetch.

**Residue check.** The dispatch branch went in the same commit. The App Intent
entry stays, because the tool stays. `paxToolScopeAndFcra.test.ts` had a
throwing mock asserting the executor was never called; with nothing left to
call, that assertion would have been true no matter what the gate did, so it was
replaced by a source case asserting the branch and the export are actually gone.


---

## Four support tools with fictional effects — executed 2026-08-20

**What went.** From `server/ai/supportAgent.ts`: the tool definitions, dispatch
cases and prompt/playbook references for `invalidate_user_sessions`,
`refresh_auth_tokens`, `trigger_data_resync` and `clear_org_cache`; the
`recalculate_credit_balance` branch of `fix_common_issue`; and five
`fix_common_issue` enum values with no case at all. `create_followup_task` was
NOT deleted — it was wired, see below.

**What they were.** Each returned a sentence describing a system effect it had
not had, to a model that was talking to a paying customer:

| tool | returned | actually did |
|---|---|---|
| `invalidate_user_sessions` | `sessionsInvalidated: true`, "The user will need to log in again" | wrote an `activity_log` row |
| `refresh_auth_tokens` | `tokenRefreshQueued: true` | wrote an `activity_log` row |
| `trigger_data_resync` | "Successfully triggered resync" | pushed invented cache names into a local array, wrote an `activity_log` row |
| `clear_org_cache` | "Successfully cleared 3 cache(s). Fresh data will be loaded on next request." | pushed three string literals into a local array |
| `recalculate_credit_balance` | "Credit balance has been recalculated from transaction history." | executed no statement at all |

**Why deleted rather than wired.** Same reasoning as `schedule_background_job`
(ledger, 2026-08-19): wiring these means BUILDING the capability, and the defect
is that they claimed to already have it. `clear_org_cache` is the sharpest case
— there is no coherent org-scoped operation behind any of its three advertised
cache names. `dashboard_metrics` names no cache in this repo. `ai_context` maps
only to a process-wide `clearCache()` that takes no org parameter. And
`property_boundaries` maps to `provider_cache` / `cached_lookups`, which are
**cross-tenant shared caches by design** — a per-org eviction there would
discard other tenants' entries, so the honest version of this tool is not a
smaller version of it. Six troubleshooting playbook steps that prescribed it
went with it.

**What was wired instead.** `create_followup_task` returned `taskCreated: true`
and created nothing — but `storage.createTask` already existed, so this was a
wiring gap, not a missing capability. It now inserts a real row and returns the
real `taskId`. Its `assignee` argument names a routing lane
(support_team / customer / engineering) and `tasks.assignedTo` references
`teamMembers.id` with no lane-to-member mapping, so the lane is recorded in the
task body and the task is left genuinely unassigned — `assigned: false` in the
return value — rather than pointed at an invented member id.

**The enum was lying too.** `fix_common_issue` advertised eight repair types to
the model and implemented three. The other five fell through to a `default:`
that refuses, so nothing broke at runtime — but the model offered a customer
five repairs that could only fail. An enum is a promise to the model the same
way a return value is a promise to the user, and
`paxToolsReportRealEffects.test.ts` now checks the two lists against each other.

**Residue check — and the gate that was green over all of this.**
`paxToolsReportRealEffects.test.ts` exists to catch exactly this shape and
missed every instance, for two independent reasons, both now fixed:

1. **It read one file.** `server/ai/tools.ts` only. `executeSupportTool` is a
   second dispatch switch with 76 cases and was never scanned. It now scans
   both, and the vacuity case asserts each parses >50 cases.
2. **Its predicate was `\bawait\b`.** Four of these tools await an
   `activity_log` insert, so they read as effectful. The predicate now discounts
   audit *writes* — an audit row records the intent, not the outcome — while
   still counting audit *reads*, because `db.select().from(activityLog)` returns
   rows that genuinely are a support tool's answer. Falsified by mutating
   `invalidate_user_sessions` back in as it shipped: green under the old
   predicate, fires under the new one, and the wired `create_followup_task` is
   not a false positive.

This is the second law in the CLAUDE.md pair, arriving from the other direction:
not a canonical function with no callers, but a canonical gate whose population
was smaller than the defect it named.
