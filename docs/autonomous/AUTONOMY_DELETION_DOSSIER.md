# Autonomy build dossier II — deletion impact of placebo surfaces

**Generated 2026-09-02 by a read-only engineering agent (227 tool uses) at `222c8d26`. Facts only; every candidate redesign removes these surfaces, so their blast radius (importers, pins, ratchets, tables with other live users, things to PRESERVE) is mapped ahead of the design decision. Re-verify lines before editing.**

Research complete. All claims below were verified against the working tree at HEAD `222c8d26` (line numbers as of this session). Reachability gate currently PASSES at every baseline (`unreachedExports 373`, `internalOnlyExports 1172`, `tablesNoWriter 57`, `tablesNoReader 67`, `unregisteredRoutes 4`, `moduleOrphans 28`, `opaqueExports 20`; `scripts/ratchets/reachability.json:7-19`), so any deletion that removes a currently-counted symbol must lower the matching baseline in the same commit (`scripts/lint-reachability.mjs:89` stale-high FAILS).

---

# DELETION-IMPACT DOSSIER — placebo AI/autonomy surfaces

## Cross-cutting ratchets (what does and does not move)

| Ratchet | File | Effect of these deletions |
|---|---|---|
| `FOUNDER_ROUTE_BASELINE = 81` | `tests/unit/founderFourDoors.test.ts:20,102` | Unaffected — no `/founder/*` route is in any item. |
| `DOORS` list | `tests/unit/sidebarHiddenRoutes.test.ts:31` (`/today … /ai /inbox /settings`) | Unaffected — no door route is removed. |
| `MOBILE_DOORS` | `tests/unit/mobileNavFixedDoors.test.ts` | Unaffected. |
| routeManifest snapshot | `tests/unit/__snapshots__/routeManifest.test.ts.snap:10-279` (lists route FILES) | Moves only if a whole route file is deleted: `routes-autonomous-agent.ts` (:33) and `routes-autonomy.ts` (:34) are listed; `server/routeManifest.ts:70-71` mirror them. Deleting individual handlers inside `routes-ai.ts`/`routes-organization.ts`/`routes-today.ts` does not move it. |
| reachability allowlist staleness | `scripts/lint-reachability.mjs:376-378` (`staleAllowlistEntries`) | Two allowlist entries name `autonomousTaskProcessor.ts` exports (`reachability.json:58-67`) — deleting that file makes both stale → gate FAILS until removed. |
| reachability current findings in scope | `--report` run this session | `autonomousTaskProcessor.ts:484 stopAutonomousTaskProcessor` counted in `unreachedExports`; `autonomousAgentEngine.ts:124 class AutonomousAgentEngine` and `directorAgent.ts:109 class DirectorAgent` counted in `internalOnlyExports`; `server/services/agentOrchestration.ts` counted in `moduleOrphans` (nothing imports it). |
| `schemaMigrationDrift` / migrate-mirror | `tests/unit/schemaMigrationDrift.test.ts:25-53,80-97`; `scripts/check-schema-migrate-mirror.mjs:24-28`; allowlist `scripts/schema-migrate-mirror.allowlist.json` = `[]` | Both are ONE-directional (schema table must have a CREATE). Removing a `pgTable` does not fail them; `minima.pgTables: 600` (`reachability.json:23`) is a vacuity floor, not a count ratchet. |
| `jobRosterCoverage` | `tests/unit/jobRosterCoverage.test.ts:27-56,73-83` | `SCANNED_FILES` contains `autonomousTaskProcessor.ts` (:49) and is read with `readFileSync` (:62) — deleting the file throws ENOENT; `JOB_ROSTER` entry `autonomous_task_processor` (`server/jobs/jobRegistry.ts:177`, `critical: true`) becomes a "phantom row" (:78-83) unless removed together. |
| `lint-date-format` baseline | `scripts/lint-date-format.mjs:37-60` | Entries for `pax-tasks-settings-tab.tsx` (:47, count 1) and `command-center.tsx` (:54, count 1); bidirectional (:17-23) — a file whose hit-count drops or that disappears must have its entry edited/removed. |
| `featureFlagRetiredKeys` pattern | `tests/unit/featureFlagRetiredKeys.test.ts:95-126,224-235` | If `feature.autonomy-matrix` is retired: key must go into `RETIRED_FLAG_KEYS` (`server/services/featureFlags.ts:78-89`), appear in the `DELETE FROM "platform_feature_flags"` statement (`scripts/migrate.mjs:9427`), and have zero `"feature.autonomy-matrix"` string references in `server/` + `client/src/`. |

---

## (1) "AI settings" card

**Component / route / storage**
- `client/src/components/ai-settings.tsx` (215 lines): local `AISettings` interface :18-23; reads `organization.settings.aiSettings` :48-56; `PATCH /api/organization/ai-settings` :60; testids `select-ai-response-style` :111, `select-ai-default-agent` :130, `switch-ai-auto-suggestions` :157, `switch-ai-remember-context` :172, `button-save-ai-settings` :183; card title "AI settings" :205.
- Route: `server/routes-organization.ts:727-760` — `api.patch("/api/organization/ai-settings", isAuthenticated, getOrCreateOrg, requirePermission("canAccessSettings"))`; zod :732-737 accepts only `responseStyle/defaultAgent/autoSuggestions/rememberContext`; calls `storage.updateOrganizationAISettings` :740; audit-log entity `organization_ai_settings` :744-754.
- Storage: `server/storage/orgRepo.ts:84-105` `updateOrganizationAISettings` (spread-merge into `settings.aiSettings` :93-100); interface `server/storage.ts:162-166`.
- Type: `shared/schema.ts:140-149` `aiSettings?: { responseStyle, defaultAgent, autoSuggestions, rememberContext, paxDraftEnabled }`.
- Second write path accepting the whole `aiSettings` record: `routes-organization.ts:74` (`aiSettings: z.record(z.string(), z.unknown()).optional()` inside `orgSettingsPatchSchema`, used at :91 as `settings:` of `updateOrganizationSchema` for `PATCH /api/organization`). The `PATCH /api/organization/settings` allowlist at :1623-1630 is `.strict()` and does NOT include `aiSettings`.

**Importers / mount points**
- `client/src/pages/settings.tsx:51` import; rendered :1460 inside `TabsContent value="integrations"` (`data-testid="tab-content-integrations-ai"` :1457).
- `client/src/pages/command-center.tsx:83` import; rendered `<AISettings compact />` :2019 inside the gear `Dialog` (:1984-2022; trigger `aria-label="AI settings" data-testid="button-ai-settings"` :1993; title "AI Settings" :2001).
- No other importer (grep `ai-settings|AISettings` → only those two).

**Server readers of the four keys**: none. `rememberContext/autoSuggestions/responseStyle/defaultAgent` appear server-side only in the writer (`orgRepo.ts:85-88`), the route zod (:733-736), and two supportAgent reset tools that overwrite `aiSettings` wholesale: `server/ai/supportAgent.ts:1568-1575` (`reset_ai_settings` → `jsonb_set(... '{aiSettings}', '{"responseStyle":"balanced","autoSuggestions":true}')`) and :4825-4832 (`reset_user_preferences` with `preference_type ai_settings`). Also :1416-1420 recommends "AI settings not configured" when `settings.aiSettings` is absent. Note: both `jsonb_set` writes REPLACE the whole `aiSettings` object, i.e. they also erase `paxDraftEnabled` if set.

**Tests pinning it**
- `tests/unit/destructivePermissionCoverage.test.ts:200-204` — `PRIVILEGED_ROUTES` entry `api.patch("/api/organization/ai-settings"` with `permission: "canAccessSettings"`; vacuity guard :208-215 fails if the registration string disappears (entry must be removed with the route).
- `tests/unit/paxPauseSupportGate.test.ts:47` — `reset_ai_settings` is in `GATED_SUPPORT_TOOLS` (every `case "…"` label in `executeSupportTool` must be classified, :16-19, :67-70); removing that case requires removing the list entry.
- No test references the component testids, "AI settings" copy, or `updateOrganizationAISettings` (grep of `tests/` → only the two above). No e2e reference (`tests/e2e*` grep → none).

**Residue**: `i18n-candidates.csv:2063-2068` (generated). Docs only: `docs/company/experience-legibility.md:141`, `docs/audits/lenses/50-edge-cases.md:39-49`, `docs/implementation/EXECUTION_LEDGER.md:2167`.

**PRESERVE inside the boundary**
- `organizations.settings.aiSettings.paxDraftEnabled` — enforced at `server/routes-ai-draft.ts:73-83` (`if (org.settings?.aiSettings?.paxDraftEnabled === false) return Errors.forbidden(...)`); type :148. There is NO writer of `paxDraftEnabled` anywhere (grep → only `routes-ai-draft.ts:74,81` and `schema.ts:148`); the comment at `schema.ts:145-147` ("set to false from Settings → Notifications") describes a control that does not exist. The only paths that could set it today are `PATCH /api/organization` `settings.aiSettings` (`routes-organization.ts:74,91`) and direct SQL.
- The `aiSettings` type slot in `shared/schema.ts:140-149` must keep `paxDraftEnabled`.

---

## (2) AutonomyPanel + `feature.autonomy-matrix` flag + SettingsQuickFind entries

**Component**
- `client/src/components/settings/autonomy-panel.tsx` (458 lines): endpoint `/api/me/autonomy` :31; agents `atlas/pax/sophie` :59-107; `DEFAULTS` :126-131 (`pax.thresholdsCents.mailerSend: 50000`, `timeGuards` 19→8, `dailyActionLimit 200`); GET :152-162 (`setConfig({ ...DEFAULTS, ...data })`); debounced PATCH of the WHOLE config object :164-181; `reset()` :213 PATCHes `DEFAULTS`; testids `button-reset-autonomy` :232, `autonomy-${agent}-level-${n}` :271, `autonomy-${agent}-expand` :296, `autonomy-action-*` :311, `autonomy-threshold-*` :359, `switch-time-pause` :405, `input-pause-start/end` :420/:433, `input-daily-limit` :450.
- Header comment :16-29 states the matrix "exists as a preference, not yet enforcement".

**Importers / mount**
- `client/src/pages/settings.tsx:71` import; `useFlag("feature.autonomy-matrix")` :166; rendered :1494-1498 inside the Integrations tab (`data-testid="tab-content-integrations-autonomy"`), only when the flag is true.
- `client/src/components/settings/SettingsQuickFind.tsx` (imported at `settings.tsx:57`, rendered :424): :49 is the BYOK row (`keywords: "byok openai anthropic claude gpt key llm ai credentials"`, tab `integrations`); :52 is `{ label: "Autonomy matrix", description: "Founder-only AI autonomy rules", tab: "integrations", keywords: "autonomy ai matrix founder rules permission autonomous agent" }`.
- `useFlag`: `client/src/contexts/feature-flags-context.tsx:79-83`.
- Prototype (not built code): `acreos/settings.jsx:53,219,317`.

**Flag row**
- Seeded in `migrations/0029_feature_flag_state_machine.sql:34-41` (row :40, `state 'founder-only'`, `controlled_routes '["/settings"]'`) and mirrored in `scripts/migrate.mjs:1483-1485`.
- `server/routes.ts:415-445`: `disabledRoutes` = `controlledRoutes` of flags with `state === "off"` (:425-430) and `controlledRoutes` (:437) includes every flag's routes — this row currently contributes `"/settings"` to `controlledRoutes`; if the row's state were ever set to `off`, `/settings` would enter `disabledRoutes`.
- Only code reference to the key: `settings.tsx:166`; `shared/schema.ts:14196` is a comment.
- Retirement machinery: `server/services/featureFlags.ts:78-89` (`RETIRED_FLAG_KEYS`), `:146` (`getAll` filter), `:158` (`getByKey` → null); `scripts/migrate.mjs:9427` (`DELETE FROM "platform_feature_flags" WHERE "key" IN (...)`); test `tests/unit/featureFlagRetiredKeys.test.ts:112-126` (no code references), `:224-235` (key must be in the DELETE), `:137-172` (`SUBSYSTEMS` evidence map — adding an entry there requires naming deleted files).

**Data path (PRESERVE)**
- `GET/PATCH /api/me/autonomy` — `server/routes-autonomy.ts:64-113`, mounted `server/routes.ts:1546` (`app.use('/api/me/autonomy', isAuthenticated, autonomyRouter)`, import :91). Schema :36-62 accepts `atlas/pax/sophie/{level, perAction, thresholdsCents, pausedUntil}` and `timeGuards`. Merge is SHALLOW (:98-101).
- Column `users.autonomy_preferences` (`migrations/0030_user_autonomy_preferences.sql:15-25`; interface `shared/models/auth.ts:118-127`).
- Live consumers that must survive: `server/services/paxPause.ts:82-89` (reads `pax.pausedUntil`); `client/src/pages/settings/pax-controls.tsx:109-111,131,164,187,225`; `client/src/pages/today.tsx:338-344`; `client/src/components/settings/autopilot-setup.tsx:84-101` (`pax.level`).
- Server readers of the keys ONLY the panel writes (`atlas.*`, `sophie.*`, `timeGuards.*`, `perAction`, non-`confidenceAutoPct` `thresholdsCents`): none (grep `server/` → only the zod lines `routes-autonomy.ts:38-39,57-60`).
- Interaction hazard (fact): `AutonomyPanel.reset()` (:213) PATCHes `DEFAULTS.pax = { level:1, perAction:{}, thresholdsCents:{ mailerSend:50000 } }`; with the shallow merge at `routes-autonomy.ts:98-101` this replaces the stored `pax` object, dropping `pax.pausedUntil` (the enforced kill switch) and `pax.thresholdsCents.confidenceAutoPct`.

**Tests / e2e**: none reference `autonomy-panel`, `AutonomyPanel`, `feature.autonomy-matrix`, any panel testid, or `SettingsQuickFind` (grep `tests/` → none). `tests/unit/paxPauseState.test.ts:6-7` covers `users.autonomyPreferences` reads in `paxPause.ts` (preserve).

**Lint residue**: `eslint-rules/no-founder-codenames-in-customer-jsx.cjs:21` (doc) and `:71` (`SKIP_PATTERNS` entry `/\/components\/settings\/autonomy-panel\.tsx?$/`) — a stale exemption after deletion; no test pins `SKIP_PATTERNS` (grep → none). `i18n-candidates.csv:1061,3189-3192`.

---

## (3) Customer "Tasks" tab + `POST /api/agents/tasks` + `/api/autonomous/tasks/:id/approve` + `autonomousTaskProcessor` + `agent_tasks`

**Client**
- `client/src/pages/command-center.tsx`: hooks import :9; `agentTypeDescriptions` :969-994 (six types: research, marketing, lead_nurturing, campaign, finance, support); `TasksTabContent` :996-1133 — sub-tab triggers `tab-task-*` :1030-1053, `textarea-quick-task` :1068, `button-deploy-task` "Deploy Agent" :1071-1074, `text-cost-agent-task` "$0.02 per task" :1075, list `task-item-${id}` :1097; submit sends `{ agentType: activeTab, input: <string>, status: "pending" }` :1006-1010. Tab trigger `data-testid="tab-tasks"` :1965-1968 (ungated); content mount :2432-2434. `FOUNDER_ONLY_TABS` :1567 excludes `tasks`.
- `client/src/hooks/use-agent-tasks.ts:4-18` (`GET /api/agents/tasks`, 15 s poll) and :20-38 (`POST`); contract `shared/routes.ts:114-131`; `createAgentTaskInputSchema` `shared/routes.ts:13` = `insertAgentTaskSchema.omit({organizationId})`; `insertAgentTaskSchema` `shared/schema.ts:3629-3631`.
- Page reachability: `command-center.tsx` is lazy-loaded only by `client/src/pages/pax.tsx:37` (rendered :958); `/command-center` is a Redirect (`client/src/App.tsx:1090`, `route-redirects.ts:109`).

**Server**
- `server/routes-ai.ts:48-52` `GET /api/agents/tasks` (`storage.getAgentTasks`, `server/storage.ts:1093-1097`); `:54-78` `POST /api/agents/tasks` — `checkUsageLimit(org.id, "ai_requests")` :58, `insertAgentTaskSchema.parse` :69, `storage.createAgentTask` :70 (`storage.ts:1105-1109`). No credit deduction or metering call exists in :54-78 (nothing corresponds to "$0.02").
- `server/routes-autonomous-agent.ts` (454 lines; register `:91`, `router.use(isAuthenticated, getOrCreateOrg)` :95, `app.use("/api/autonomous", router)` :453; wired `server/routes.ts:288,2654`; manifest `server/routeManifest.ts:70`): `/agents` :98-108, `/agents/:type` :111-125, `PUT /agents/:type/config` :128-156, `GET /tasks` :159-192, `GET /tasks/pending-approval` :200-221, `POST /tasks` :224-249 (`queueAgentTask`), `POST /tasks/:id/approve` :252-282 (`approveEscalatedTask` :273 then `runOnce()` :276), `/reject` :285-308, `/run` :312-374 (`executeAgentTask` :342), `/evaluate` :378-439, `/trigger-processor` :443-451.
- Client callers of ANY `/api/autonomous/*` path: none (grep `client/src` → none). Client callers of `/api/agents/tasks`: only `use-agent-tasks.ts`.

**Job**: `server/jobs/autonomousTaskProcessor.ts` (561 lines)
- `RUN_INTERVAL_MS 30_000` :27; `SKILL_RISK` :53-103 (export `_SKILL_RISK` :106); `_inferRiskProfile` :108-267 (unclassified residue :259-266); `processBatch` :271-386 selects `status="pending" AND requiresReview=false` :275-285 → `autonomousAgentEngine.evaluate` :296-300 → deny :302-313 / escalate (sets `requiresReview: true`) :315-326 / auto-execute via `executeAgentTask` :328-361, `recordAction` :363; `agentRuns` row `autonomous_task_processor` :390-428; `runOnce` :435-454; `startAutonomousTaskProcessor` :458-482 (`scheduleSelfRescheduling` + `withJobLock("autonomous_task_processor", 25, runOnce)` :472-479); `stopAutonomousTaskProcessor` :484-490 (zero references — counted today in `unreachedExports`); `queueAgentTask` :496-528; `approveEscalatedTask` :534-544; `rejectEscalatedTask` :549-560.
- Boot: `server/jobs/runScheduledJobs.ts:4012-4015` (`import('./autonomousTaskProcessor').then(({ startAutonomousTaskProcessor }) => …)`), no env gate. Roster: `server/jobs/jobRegistry.ts:177`.
- Observed behaviour of Tasks-tab rows (fact chain): `task.input` is a string (client :1008) → `input.action` undefined → `""` → unclassified profile :259-266 → `evaluate()` escalates (per `:256-258` and `tests/unit/autonomyRiskClassification.test.ts:35-43`) → `requiresReview=true` :315-326 → row leaves the processor's select and only `/api/autonomous/tasks/:id/approve` (no client caller) can clear it. The client's six `agentType` values also differ from `CORE_AGENT_TYPES = ["research","deals","communications","operations"]` (`routes-autonomous-agent.ts:37`, `queueTaskSchema` :65).

**Other producers of `agent_tasks` (the job is NOT single-producer)**
- `server/services/rosyRiver.ts:232-259` — `organizationId: SYSTEM_ORG_ID`, `status: "pending"`, `requiresReview = simulation || !eligibility.eligible` (:230; simulation defaults `true` :222), no `input.action`.
- `server/services/selfAssessmentAgent.ts:203-218` and `:284-300` — `SYSTEM_ORG_ID`, `agentType "self_assessment"`, `status "pending"`, `requiresReview` unset (column default `false`, `schema.ts:1967`), no `input.action`.
- `server/services/directorAgent.ts:335-355` `queueDirectorGoal` — `agentType "research"`, `input.action "director_goal"`; called from `server/services/companyAgents.ts:575-589` `queueGoal` ← `server/services/agentGoalManager.ts:62` (reached from `routes-founder-intelligence.ts:3407-3515`, `ceoCommandBridge.ts:22`, `jobs/v5MaintenanceJob.ts:12`).
- `server/services/agentOrchestration.ts:718-729` — module orphan (nothing imports it).
- `routes-autonomous-agent.ts:232` `queueAgentTask` (no client caller).
- All of these write `pending` rows the processor selects (:275-285) and — lacking a classified `input.action` — escalates to `requiresReview=true` rather than executing (the `director_goal` case is named as unrecognised at `autonomyRiskClassification.test.ts:90`).

**Other readers of `agent_tasks`**
- `server/routes-rosy-river.ts:78-95,165,186-195` → client `client/src/pages/founder/feed.tsx:114`, `client/src/pages/founder/agent-queue.tsx:181,205` (`/api/founder/proposed-changes`).
- `server/routes-admin.ts:4248-4260` (`GET /api/admin/evolution-proposals`, `agentType "self_assessment"`).
- `server/storage/agentWorkflowsRepo.ts:81-89` (join with `agent_feedback`), `server/storage/supportOpsRepo.ts:375-376`, `server/services/decisionLogRag.ts:99-111`, `server/services/agentPromotionGate.ts` (`canPromoteToLive`, org-scope register `scripts/check-org-scoped-fetch.mjs:1289`), `server/services/selfAssessmentAgent.ts` (`analyzeToolFailures`, register :1345), `server/routes-core-ai.ts:215` (`storage.getAgentTask`).
- FK dependents in schema: `agent_feedback.agent_task_id` NOT NULL (`shared/schema.ts:2019`), `messages.agent_task_id` (:2238), `browser_automation_jobs.triggered_by_agent_task_id` (:9893; written by `server/services/browserAutomation.ts:247`).
- DDL: `migrations/0000_sleepy_betty_ross.sql:85` (CREATE), FKs :1200-1203; `migrations/0001_brief_giant_man.sql:1696,1712` (FKs), :1856-1858 (indexes); `scripts/migrate.mjs` has no `agent_tasks` DDL (only comment :3915). Meta snapshots `migrations/meta/000{0,1,2,3}_snapshot.json` reference it.
- Conclusion (fact): `agent_tasks` has live writers and readers outside the Tasks tab; the Tasks tab + `POST /api/agents/tasks` + the processor are removable without a table drop. A table drop would additionally require removing the three FK columns above, a DROP migration registered in `scripts/migrate.mjs` (precedent `reachability.json:124` lastBumpNote: "migrations/0236 written and REGISTERED … NOT APPLIED — a production DROP TABLE is founder-only"), and would not move `tablesNoWriter/NoReader` (table has both today).

**`agent_runs`**: also written/read by `server/storage/platformOpsRepo.ts:144-157` (→ `GET /api/agents/status`, `routes-ai.ts:81-88`) and `selfAssessmentAgent.ts:268-271,482-491,553-562` — stays regardless.

**Tests pinning this lane**
- `tests/unit/autonomyRiskClassification.test.ts` — imports `_inferRiskProfile`, `_SKILL_RISK` from the job :62-64, `AutonomousAgentEngine` :59-61, `skillRegistry` :65; `SKILL_RISK` ↔ `skillRegistry.getAllSkills()` in both directions :225-247; `/evaluate` handler must not reach `executeAgentTask|executeSkill|queueAgentTask|runOnce` :343-363 (reads `routes-autonomous-agent.ts`). Header :22-28 documents the `POST /api/agents/tasks` → processor chain.
- `tests/unit/jobRosterCoverage.test.ts:49` + `jobRegistry.ts:177` (see table above).
- `tests/unit/phase-zero-one-remediation.test.ts:91-113` — requires `data-testid="tab-tasks"` to exist and NOT be founder-gated (regex on the 200 chars before it).
- `tests/e2e-mobile/pax-founder-gate.spec.ts:100` — `expect(page.locator('[data-testid="tab-tasks"]')).toBeVisible()`.
- `tests/unit/critical-path-render.test.ts:275-277` — `pax.tsx` must contain `lazy(() => import("@/pages/command-center")`.
- `tests/unit/skillLaneSendGovernance.test.ts:16` — prose mention only.
- `tests/production-smoke.spec.ts:120-121` — lists `/command-center` and `/agent-command-center` (redirect routes).
- `scripts/ratchets/reachability.json:58-67` — allowlist entries `autonomousTaskProcessor.ts::_SKILL_RISK` / `::_inferRiskProfile` (stale on deletion).
- `shared/governance/constitution.ts` has no entry naming `agentTasks` (grep → none).

**If job + router are both deleted**: `autonomousAgentEngine.ts` loses all production callers except `routes-autonomous-agent.ts:102,120,142,151,424` → becomes a module orphan (+1 `moduleOrphans`, raise requires sign-off per `reachability.json:6`), `core-agents.executeAgentTask` remains reached via `routes-ai.ts:1408` (`POST /api/assistant/execute` :1397). `routes-autonomous-agent.ts` removal moves the routeManifest snapshot (:33) and `server/routeManifest.ts:70`.

---

## (4) VA stub actions + founder Team-tab enum mismatch

**Stub cases**
- `server/ai/vaService.ts:546-620` `performAction` (private): `send_reminder` :568-578, `propose_campaign` :580-590, `schedule_callback` :592-601, `record_note` :603-612 — each returns `{ success: true, message, data: <echo of input> }` with no storage/tool call.
- Caller chain: `performAction` ← `executeAction(actionId)` :490-544 (:508). `executeAction` has ZERO callers (grep `server/` for `\.executeAction(` → only `workflow-engine.ts` and `supportBrain.ts` calling their own methods; `vaAgentService.executeAction` is never invoked). Both methods are dead code.
- The LIVE dispatch is `executeAgentAction` :960-1019 (switch :973-999), called from `server/routes-ai.ts:1642` (`POST /api/va/actions/:id/approve` :1624-1650), `:1741` (`POST /api/va/actions/:id/execute` :1724-1747), and `vaService.ts:1253` (`processAutonomousActions` :1226, reachable only via `POST /api/va/actions/process-autonomous` `routes-ai.ts:1750-1760`, no client caller). In that switch: `schedule_callback` → `executeCreateFollowUp` :1045-1067 (writes `createVaCalendarEvent`); `propose_campaign` → `executeProposeCampaign` :1145-1163 (builds an object, no storage call); `send_email/send_sms` → `executeCommunication` :1165-1184 (returns `status: "queued"`, no send call); everything else incl. `send_reminder`, `record_note`, `agent_proposed` → default :997-998 `{ message: "Action type '…' logged for manual processing" }`; all paths then mark the action `completed` :1003-1008 and return `{ success: true }` :1010.
- Producer of proposed actions: `processAgentTask` :742-749 always uses `actionType: "agent_proposed"`; no code path produces `send_reminder` or `record_note` (grep → only :568/:603).

**Enum mismatch**
- Client `client/src/pages/command-center.tsx:129` `autonomyLevel: "full_auto" | "supervised" | "manual"`; Select :607-629 (`data-testid="select-va-autonomy-level"` :616; items `full_auto/supervised/manual` :620-622) → `updateAgentMutation` :227-232 `PATCH /api/va/agents/${id}`; Team tab component `TeamTabContent` :199 (founder-gated trigger :1959-1964, content :2428-2430).
- Server `server/routes-ai.ts:1568-1572` `updateVaAgentSchema.autonomyLevel: z.enum(["suggest","auto_execute","manual"])`; parse failure → `Errors.validationFailed` :1584-1587 (422) for `full_auto` and `supervised`; `manual` passes → `storage.updateVaAgent` (`server/storage/vaRepo.ts:54-62`, no further validation).
- Column: `shared/schema.ts:2908-2911` `vaAgents.autonomyLevel` default `"supervised"`, comment enumerates `full_auto/supervised/manual`; seeds `vaRepo.ts:78,92` (`"supervised"`). Only server reader of the column value: `vaService.ts:1232` (`agent.autonomyLevel !== "full_auto"`); `server/services/autonomousAgentEngine.ts:21` `AutonomyLevel = "full_auto" | "supervised" | "manual"`. No server code compares against `"suggest"` or `"auto_execute"` (grep → the zod line only).
- GET path: `routes-ai.ts:1539-1548` (`storage.initializeVaAgents`).

**Tests**
- `tests/unit/phase-zero-one-remediation.test.ts:73-89` (Team trigger/content founder-gated), `:194-216` (TeamTabContent `w-72 | flex-1 | w-80` layout regexes), `:156-165` (agent-detail back button). `tests/e2e-mobile/pax-founder-gate.spec.ts:104-107,137` (Team tab absent for non-founders).
- `tests/unit/aiPromptLeakage.test.ts:64-67` — allow-entry for path `server/ai/vaService.ts` (`validateAtlasOutput`, `AtlasOutputType`).
- No test references `performAction`, the stub strings, `select-va-autonomy-level`, `updateVaAgentSchema`, or `va_agents` (grep → none; `tests/integration/aiAgentConversation.test.ts:15-50` mirrors VA types inline without importing).

---

## (5) DecisionQueue "Pax would handle" / Override / hardcoded 0.82

**Client** — `client/src/components/today/DecisionQueue.tsx` (700 lines)
- Imports `ConfidenceBar` :22, `ConfidenceSparkline` :23; `confidence`/`confidenceHistory` props :111-119; `autoThreshold` prop :131-141 (doc: "visual treatment only … does NOT itself execute anything"; default `1.01` :210); `isAutoHandled` :224-227; `auto` :423; swipe label `"Override"` :440; auto rows excluded from inline-resolve :445-446; `data-auto-handled` :491; ring dot :496-508; "Pax would handle" :530-535; auto description "Preview — Pax will still ask you…" :541-543; `ConfidenceBar`/`ConfidenceSparkline` render :545-559; CTA `{auto ? "Override" : item.actionLabel}` :625-632.
- `ConfidenceBar.tsx` / `ConfidenceSparkline.tsx` (`client/src/components/today/`) have no importer other than DecisionQueue (grep → :22-23 only). `DataProvenanceChip` (:524-528) is shared — preserve.
- Consumer: `client/src/pages/today.tsx:36` import; `<DecisionQueue … autoThreshold={autoThreshold} …>` :776-786 (:779). `client/src/pages/decision-queue.tsx` does not import it.

**Server** — `server/routes-today.ts`
- `gatherPaxSuggests` :610-719: observation-based rows use `paxObservations.confidenceScore/100` (:619,:627 `> 70`, :639); stale-lead filler rows hardcode `confidence: 0.82` :701 (block :664-704); mapping `source: "pax-suggests"`, priority bands :709, rank :714, `confidence` :715.
- Persona brief sentences attributing actions to Pax: :933 (`"Pax posted the rest"`), :936 (`"Pax surfaced N parcels"`), :945 (`"new split candidates from Pax"`), :954 (`"N Pax signals"`); inputs derived at :1424-1435 — `paxReplies = queue.filter(q => q.source.startsWith("pax-")).length` :1424 (the header comment :836 calls it a "proxy"), `curbSaves = alertItems.length` :1425.

**Tests**
- `tests/unit/critical-path-render.test.ts:53-55` — `today.tsx` source must contain `"DecisionQueue"`.
- `tests/unit/todayQueueRanking.test.ts:23`, `todayQueueResolve.test.ts:23`, `todayReceipts.test.ts:23` import from `routes-today` — none reference `0.82`, `pax-suggests`, `gatherPaxSuggests`, `composeBrief`, or `confidence` (grep → none).
- `tests/unit/serverEmittedLinksResolve.test.ts:250-261` scans `routes-today.ts` for emitted links (checks resolvability, not presence).
- No test references `autoThreshold`, `data-auto-handled`, `"Pax would handle"`, `ConfidenceBar`, `ConfidenceSparkline`, `decision-item-`, or `section-decision-queue` (grep `tests/` → none; `supportResolverCalibration.test.ts:90` `0.82` is unrelated `modelConfidence`). No e2e reference.

**PRESERVE**: the rest of DecisionQueue (resolve/snooze/clear, `ClearedEmpty`, keyboard layer), `DataProvenanceChip`, `MorningBrief.tsx:65-71` link to `/settings/pax`.

---

## (6) Confidence-threshold slider (`confidenceAutoPct`)

- `client/src/pages/settings/pax-controls.tsx` (566 lines): constants :41-46 (`NEVER_AUTO_PCT 101`, `AUTONOMY_THRESHOLD_KEY "confidenceAutoPct"`, `AUTONOMY_DEFAULT_PCT 90`); shapes :48-57; query `/api/me/autonomy` :109-111; **reset mutation :155-181** writes `thresholdsCents.confidenceAutoPct = 101` AND deletes `pausedUntil` (:157-163) — the reset button's semantics depend on this key; slider state/mutation :205-252 (:222-244 PATCH `pax.thresholdsCents[confidenceAutoPct]`); status copy :308-313 ("Your autonomy threshold is saved and will apply as Pax earns more independence"); slider card :320-363 (`data-testid="card-pax-autonomy"` :321, copy :327-331,:336, badge "Auto above N%" :343, `data-testid="slider-pax-autonomy"` :355, range 50–100 step 5 :349-351). `AutopilotSetup` :272-277 is a separate control (`pax.level`).
- Reader: `client/src/pages/today.tsx:73-89` (key :79, default 90 :80), `:333-348` (`autoThreshold = savedThresholdPct/100`), passed :779.
- Server: key rides `routes-autonomy.ts:39` (`thresholdsCents: z.record(z.string().max(64), int ≥0 ≤1e9)`); no server reader of `thresholdsCents` (grep `server/` → the zod line only).
- Route: `client/src/App.tsx:279,1736` (`/settings/pax` → `PaxControlsPage`); link from `MorningBrief.tsx:66`.
- Tests: `tests/unit/paxStaysAmbient.test.ts:28,538-549` pins that `/settings/pax` exists and is nested under `/settings`; `paxPauseToolGate.test.ts:4` and `paxPauseSupportGate.test.ts:4-11` cite `/settings/pax`'s PAUSE promise (server gates, not the slider). No test or e2e references `confidenceAutoPct`, `slider-pax-autonomy`, `card-pax-autonomy`, `NEVER_AUTO`, or "Pax would handle" (grep → none).
- PRESERVE: pause/unpause mutations :128-153,:183-201, replay list :395+, `AutopilotSetup`, `paxPause.ts` enforcement.

---

## (7) Landing overclaims + `scripts/audit-public-claims.ts`

**Sentences**
- `client/src/pages/landing/FAQ.tsx:21-24` — "Can the AI assistant be turned off?" / "Pax has an autonomy slider per surface — Off, Suggest, Review-then-send, or Auto-send. Default is Suggest…".
- `client/src/pages/landing/Agents.tsx:56-65` — Communication sample "Pax has 4 drafts ready for review" rows (`Reviewed`/`Awaiting`); `:78-87` — Servicing sample "Payments collected $14,820", "Notes serviced 37 of 37", "Receipts sent 37", "Late notices 2 (auto-sent Mon)" (:84); also :39 "Confidence High · 87%".
- `client/src/pages/landing/DayInLife.tsx:29-38` — AFTER timeline ("11 drafted by Pax, queued for review" :30, "9 sent, 2 edited, 3 escalated — all logged" :31, "2 meetings booked into calendar automatically" :33, "37 servicing receipts sent overnight" :34, "2 offers signed from Pax-drafted templates" :36, "Background queue continues…" :37).
- `client/src/pages/landing/ProductShots.tsx:118-138` — `PaxShot` frame label "Pax — drafts wait for your tap, nothing sends itself" :120.
- Adjacent header copy in `client/src/pages/landing/copy.ts:177-182` (`agents.sub`: "Pax monitors the pipeline overnight: pulls comps, scores leads, drafts replies, books follow-ups, services notes…"), `:183-188` (`day`), `:230-233` (`faq`), `:125-129` (`productShots`).

**Mount**: `client/src/pages/landing.tsx:41,44,45,51` imports; rendered :88 (`ProductShots`), :91 (`Agents`), :92 (`DayInLife`), :98 (`FAQ`).

**`scripts/audit-public-claims.ts`**
- `LANDING_FILES` :43-51 = `copy.ts, Features.tsx, Quotes.tsx, Pricing.tsx, Positioning.tsx, FinalCTA.tsx, Hero.tsx` — FAQ/Agents/DayInLife/ProductShots are NOT in the scanned surface.
- `CLAIMS` anchors :76-143 — none match any sentence above (anchors: hero wedge, "first county list inside 10 minutes", "300–850", "deepest in land", "five federal data sources", "checked against them the moment it's stored", "Generate a written offer in one tap", "14 days, no card", "Billed $", "17%", "labeled by what's true today", "Connect your own Twilio, SendGrid, Lob").
- `EXEMPT` :150-166 — `"87%"` :163 is justified as a Hero.tsx fixture; `Agents.tsx:39` also carries "87%" but is outside the scan. `NUMBER_CLAIM` :169 would match `$14`, `37` etc. only if those files were scanned. Liveness :288-298, completeness :301-317, verification :319-334 all operate on `LANDING_FILES` only.
- `copy.ts` IS scanned (:44); `agents.sub` (:180-181) carries no number-bearing token, so it is neither anchored nor flagged.

**Other gates over landing**
- `tests/unit/voiceLinter.test.ts:98-103` runs `scripts/voice-lint.mjs` over `client/src/pages/landing` (ERRORS block); `voice-lint.mjs` has no rule mentioning autonomy/auto-send (grep → none).
- `scripts/check-no-fabrication.mjs:137-143,193-199` forbids `Math.random`-class tokens across `client/src/**`; not copy-aware.
- `tests/unit/verticalReadiness.test.ts:295-320` walks `pages/landing` for `.maturity` reads only. `tests/unit/landingReposition.test.ts` pins `LANDING_COPY` but references no `faq/agents/day/productShots` key (grep → none). No test or e2e references `FAQ.tsx`, `Agents.tsx`, `DayInLife`, `ProductShots`, or any of the sentences (grep → none).

---

## (8) `WorkflowBuilderPanel` dead export + `pax-tasks-settings-tab.tsx` `toggleMut`

**WorkflowBuilderPanel** — `client/src/components/workflow-builder.tsx` (1314 lines)
- Panel block :788-1314: `PANEL_TRIGGERS` :793-802; `PANEL_ACTIONS` :804-857 — includes `type: "send_sms"` :832 and `type: "update_entity"` :838, neither in `WORKFLOW_ACTION_TYPES` (`shared/schema.ts:9303-9310`: `send_email, create_task, update_record, run_agent_skill, send_notification, delay`); `run_agent_skill` options `["scoreLeadSkill","generateOfferSkill","marketAnalysisSkill"]` :853 vs registry ids `scoreLead` (`server/services/agent-skills.ts:2260`), `generateOffer` (:181), `marketAnalysis` (:2622). Helpers :859-869, `PanelStep` :872, `PanelStepIndicator` :874, `PanelActionForm` :913, `PanelWorkflowPreview` :1003, `WorkflowBuilderPanelProps` :1058-1062, `export function WorkflowBuilderPanel` :1064.
- Importers: none (grep repo → definition only). `workflows.tsx:6` and `workflows-settings-tab.tsx:9` import `WorkflowBuilder` only.
- `export interface WorkflowConfig` :47 is referenced only by panel code (:1003,:1059-1073) and no other client file (grep) — orphaned with the panel.
- Test: `tests/unit/workflowActionHonesty.test.ts:568-577` requires the file to contain `from "@shared/workflow-live-triggers"`, `isLiveWorkflowTriggerEvent`, `Not yet live`, `TRIGGER_NOT_LIVE_MESSAGE` — all present in the dialog builder (:41-43, :581-600) independent of the panel copies (:1176-1178, :1196-1203). No other test references `workflow-builder`, `PANEL_TRIGGERS`, or `WorkflowBuilderPanel` (grep → none). Client files are outside the reachability scan population.

**`toggleMut`** — `client/src/components/pax-tasks-settings-tab.tsx` (`export function PaxTasksSettingsTab` :42)
- `toggleMut` :70-75 POSTs `/api/ai/scheduled-tasks/${id}/toggle`; it is defined once and never invoked (grep → :70 only; the row buttons :145-163 are history + delete).
- No `/toggle` route exists: `server/routes-ai.ts` has `/api/ai/scheduled-tasks` GET :908, POST :924, PATCH :950, DELETE :972, `/run-now` :983, `/pending-results` :897, `/:id/runs` :1898; `routes-communications.ts:1369,1387` `/pause` and `/resume` belong to the different `/api/scheduled-tasks` resource.
- Mount: `client/src/pages/settings.tsx:53` import, rendered :1565 (`data-testid="tab-content-integrations-ai-tasks"` :1564).
- Baseline: `scripts/lint-date-format.mjs:47` (`pax-tasks-settings-tab.tsx`, 1 hit — `toLocaleDateString` at :136). No test references the component (grep → none). `i18n-candidates.csv:345,926,3008-3011`.