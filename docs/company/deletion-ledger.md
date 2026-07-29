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
| **Founder narrative routers V6–V14** (sovereign-company, learning-company, living-organization, conscious-organization, anticipatory-enterprise, real-runtime, sentient-enterprise, self-running-company) | ~2,378 LOC of `server/routes-founder-*.ts` mounted in `routes.ts:1792-1807` + dozens of dedicated `*V1[0-4].ts` service suites, several synthetic (`Math.random` data) | **KILL** | Dead-mounted narrative theater: the founder UI doors for these were already retired (`nav-items.ts:293-298`); no client pages remain. Keep only the two refit pages that survived (`/founder/scenarios`, `/founder/governance`) and their real backing services; delete the rest. Zero customer/founder-UI impact — the biggest pure win. |
| **Voice / AI voice** | `routes-voice.ts` (544), `routes-voice-learning.ts`, `routes-call-routing.ts`, `services/voiceAI.ts` (548), `services/callRouting.ts`, `jobs/realtimeTranscription.ts`; tables `voiceCalls`, `voiceCallRecordings` | **KILL** | ~2,150 LOC, flag off, client page already deprecated, no nav. Stub the two ungated Twilio webhooks (`routes.ts:1328-1330`) to 410 before deleting the rest. |
| **Satellite / Vision AI** | `routes-vision-ai.ts`, `routes-vision-scan.ts`, `services/visionAI.ts` (588), `jobs/satelliteImageUpdate.ts`, `pages/vision-ai.tsx`; tables `satelliteSnapshots`, `satelliteAnalysis` | **KILL** | ~1,850 LOC, flagged off, no sidebar entry, costs money (satellite API + scheduled job) with no wedge dependency. |
| **Academy / certification residuals** | `routes-certification.ts`, `services/certification.ts` (gated `feature_academy`); orphaned tables `courses`, `courseModules`, `courseEnrollments` (`shared/schema/marketplace.ts:849-926`) | **KILL** | Module was 90% retired 2026-06-08; this is the dead stump. Constitution adjacency-risk trap (`mature-machine.md` §7.7) says education revenue stays dead. Drop the three tables. |
| **Negotiation copilot (standalone)** | `routes-negotiation.ts`, `negotiationCopilotService`, `pages/negotiation-copilot.tsx` (607); dead `/api/negotiation/pipeline/*` calls in `offer-wizard.tsx` | **KILL** | Duplicate of the orchestrator, flagged off, no nav. Also remove the dead pipeline calls from `offer-wizard.tsx`. |
| **Sovereign Protocol / SCPv2 extras** | `sovereign-protocol/` dir, `routes-sovereign-integration.ts`, `routes-scp-v2.ts` | **KILL (partial)** | Agent-constitution self-evolution machinery beyond what the autopilot actually consumes. Exception per roadmap-2026-07: `scpConfigVersioning` is live-wired into Pax prompt versioning — KEEP that seam, delete the unconsumed remainder. |
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
- `reactiveOrchestrationV14.ts` cooldown tracker (V14 narrative suite)
- `callRouting.ts` agent/queue/call state (voice)
- `scpLLMJudges.ts` cost accumulator (SCPv2)
- `investorVerification.ts` KYC store (marketplace satellite — FROZEN; must be
  DB-backed before any marketplace reactivation)
- The unwired SCP engines holding in-memory financial ledgers / outbound
  queues (`scpFinancialAutonomy`, `scpOutboundExecution`,
  `scpIntegrationFabric`, `scpStrategicIntelligence`, `scpDynamicTools`,
  `autonomousSalesPipeline`, `externalCommunicationsManager`,
  `predictiveAutoscaler`) — dead code today; if any is ever wired, DB-backing
  is a precondition, but the standing verdict is KILL with their parents.

**Pinned (header comment at the state declaration; fix before load-bearing use):**
- `notificationDispatcher.ts` → persist to the existing `notifications` table
- `marketWatchlist.ts` → DB tables + sequences
- `abTestEngine.ts` → persist outcomes, aggregate in SQL
- `betaProgram.ts` → DB-back before pointing ANY real signup traffic at
  `POST /api/beta/waitlist` (currently uncalled by the client)
- `ceoReminders.ts` → systemMeta-backed cache, single-founder tolerable
- `agentEvolutionEngine.ts` `sharedInsights` → display-only divergence today

## Immediate un-wire items (H0, ahead of the campaign)

- [ ] Remove the unconditional "Capital" tab from `client/src/pages/money.tsx`
      (renders an erroring panel for non-founder customers today).
- [ ] Remove the marketplace sidebar entry (`layout-sidebar.tsx:446`) —
      it advertises a flag that is off.

## Executed deletions (log)

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
