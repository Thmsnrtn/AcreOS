# Pax customer autonomy — buildable spec (judged panel synthesis, 2026-09-02)

**Provenance:** three independent designs (radical-simplicity / competitive-parity / truth-first) judged by three lenses (customer clarity, engineering truth, founder strategy); backbone "Two Stances, One Pause, One Queue" (2 of 3 verdicts) with consensus grafts. Workflow `wf_994aaaaf-ed5`. Every file:line was re-verified against HEAD by the synthesizer; two panel assumptions were corrected (activity_log vs activity_events; pending_actions has no origin column yet). **Migration numbering note:** the spec says `0248_pax_controls`; the repo's `scripts/migrate.mjs` truth is that 0248 = referrals paid_at and 0249 = negotiation_sessions drop, so the pax_controls migration is **0250**. Founder-question dispositions are in `docs/company/founder-decision-2026-09-02-pax-controls.md`.

---

# Pax customer autonomy — buildable spec (synthesis of the judged panel)

**Backbone:** "Two Stances, One Pause, One Queue" (winner, 2 of 3 verdicts), with the judges' consensus grafts: server-refused stance values (OFFERED + 422), Edit→revise on the ask card, an "until when" pause with receipts, server-computed liveness lines, a real Off for lead scoring and borrower-reminder staging, borrower rungs as ordinary kernel rows, an enumerated `PARKED_STATES`/`UNATTENDED_PATHS` population shared by page and ratchets, `origin` on every tool call, support billing fixes inside the kernel, a dedicated attributed receipt writer, per-lead mute at the send chokepoint (wave 2), and the draft-and-wait conversation lane (wave 2).

**Verification note (this session, against HEAD):** every file:line below was re-read. Three paths the panel cited were wrong and are corrected here: the disclosure rail is `client/src/components/pax/pax-disclosure-rail.tsx` (:33), quick-find is `client/src/components/settings/SettingsQuickFind.tsx` (:49, :52), skills are `server/services/agent-skills.ts` (:303-314, :1626-1645). Two panel assumptions were false and the spec is written around the truth: (a) `activity_events` has **no** `agentType` column (`shared/schema.ts:5028-5063`) — `agentType` lives on `activity_log` (`:2276`), which is what `storage.logActivity` writes (`server/storage.ts:301`, used at `server/ai/tools.ts:1245` and `server/routes-pax-insights.ts:692`); "What Pax did" therefore reads `activity_log`, never a filter on `/api/activity`; (b) `pending_actions` has no `origin`/`reason`/`sourceRef` columns (`:2665-2683`) — they are added by migration. Also confirmed: `ExecuteToolOptions` is `{trustedApproval?, userId?}` (`tools.ts:1017-1026`); gate order kernel `:1064` → pause `:1089` → scope `:1128`; the approve route's `execute` is a callback (`routes-pax-insights.ts:654-658`); the pause clobber is the top-level spread at `routes-autonomy.ts:98-101`; `/settings/pax` is the nested route `paxStaysAmbient.test.ts:538-557` endorses; `pax-founder-gate.spec.ts:100` pins the Tasks tab as visible; `MobileBottomNav.tsx` has no badge today; 13 of 46 workflow templates carry a `send_email` step.

---

## 1. The mental model (three sentences the customer reads)

> **Pax looks things up and writes drafts on its own, and it keeps your records up to date — lead status, tasks, deals, calendar, scores — showing you every change.**
> **Pax never sends a message to anyone until you tap Approve; everything waiting for you is in one place, "Waiting for your tap".**
> **Rules you turned on — drips, workflows, scheduled prompts — run by themselves on your own connected accounts, each behind its own switch, and one red button pauses all of it.**

Two positions ("Ask before sending" — the default and today's real behaviour; "Ask before everything"), one state above them (Paused), one queue, one receipts feed. No level, no slider, no percentage, no persona.

---

## 2. Vocabulary

All customer-visible strings live in ONE file, `shared/pax-glossary.ts` (new), imported by the client, the server refusal messages (`paxPause.ts:115-129`, `paxScheduler.ts:230`, `financeAgent.ts:514`), the digest, and the landing FAQ. It exports `PAX_CONTROLS_PATH = "/settings/pax"`, `PAX_CONTROLS_LABEL = "Settings → Pax"`, `PAX_STANDING_LINE`, the stance labels/descriptions, the pause copy, and `NEVER_LIST`.

### Stances (stored in `organizations.pax_controls.stance`)

| Stored | Label | Customer sentence | Consequence toast on change |
|---|---|---|---|
| `ask_before_sending` (default) | **Ask before sending** | "Pax keeps your records up to date on its own and shows you every change. Any message to another person waits for your tap." | "Ask before sending — Pax will update records on its own again. Messages still wait for your tap." |
| `ask_before_everything` | **Ask before everything** | "Pax only looks and drafts. Every change to your records and every message waits for your tap." | "Ask before everything — every record change and every message now waits for your tap." |
| (state, not a stance) `paused` | **Paused** | "Everything Pax and your rules do on their own is stopped until {local time} (paused by {name}). Pax still looks, drafts and asks; anything you approve still goes out." | receipt written (see §4) |

`OFFERED_STANCES = ["ask_before_sending", "ask_before_everything"] as const` in `shared/pax-controls.ts`; the server rejects anything else with 422. Widening it requires a dated founder ruling registered in `STANCE_RULINGS` (see §7).

### Capability groups (rendered on the page in this order, each with its "If you never touch this" line)

| Group | What it covers (enforced population) | If you never touch this |
|---|---|---|
| **Looks & drafts** | `PAUSE_SAFE_TOOLS` (`tools.ts:960-1013`) minus `draft_offer`; Inbox reply drafts (`routes-ai-draft.ts:63`); support-agent reads (`PAUSE_SAFE_SUPPORT_TOOLS`, `supportAgent.ts:1222-1298`) | "Pax answers, researches and drafts whenever you ask. This is never gated, never counted, and keeps working while paused." |
| **Changes your records** | every non-pause-safe, non-send tool in `executeTool` (`update_lead_status`, `create_lead`, `create/update_property`, `create_properties_batch`, `create/update_deal`, `create/update/complete_task`, `generate_offer_letter`, `draft_offer`, `schedule_followup`, `schedule_follow_up`, `create_calendar_event`, `trigger_zapier`, `trigger_make`); scheduled prompts (`paxScheduler.ts`); support account fixes (`executeSupportTool`) | "When you ask Pax to change something, it does it and leaves a receipt. Scheduled prompts you set up do the same. Switch to 'Ask before everything' and every change waits for your tap instead." |
| **Sends to people** | `APPROVAL_REQUIRED_TOOLS` (`approvalKernel.ts:40-46`); borrower reminder dispatch (`financeAgent.ts:445`); support billing fixes (`apply_billing_fix` retry/update-method, `resync_stripe`, `reset_user_preferences`) | "Pax never sends what it wrote without your tap. Always. There is no setting that changes this." |
| **Runs your rules** | workflows (`workflows.isActive`, live badge from `LIVE_WORKFLOW_TRIGGER_EVENTS`), campaign sequences (`sequenceProcessor.ts`), scheduled prompts (`pax_scheduled_tasks.isActive`), lead scoring (`leadCampaignJobs.ts:19`), borrower reminders prepared (`financeAgent.ts:304`), Inbox drafts on open (`routes-ai-draft.ts:81`) | "Things you turned on run by themselves from your own connected accounts — texts only 8am–9pm recipient time, never to anyone who opted out, never more than 50 emails / 20 texts a day. Each has its own switch. Pause stops all of them." |
| **Never** (fixed list, facts with a named gate) | delete your data (`paxToolsPerformNoDeletion.test.ts`); move money or take a payment on AcreOS's account (`moneyCustodyHardStop.test.ts`); skip-trace from chat (`paxToolScopeAndFcra.test.ts`, `tools.ts:958,1176-1190`); send to a seller or buyer from an AcreOS address (`workflowActionHonesty.test.ts:389`, `connectorCatalogIsHonest.test.ts`); change what you pay AcreOS (only rendered once `apply_credit` is model-unreachable — §4 row 3c — and `paxSupportNoPricing.test.ts` exists) | "Not even if you ask." |

### Banned words (customer surfaces; `/founder/**` allowlisted)

autopilot · autonomy / autonomous / autonomously / unattended · autonomy level / slider / threshold / matrix · assisted / supervised (as labels) · Observe / Draft / Execute / Autonomous · Suggest only / Ask first / Act & tell / Full autopilot · Off / Suggest / Review-then-send / Auto-send · confidence % / Auto above N% / Pax would handle / Override · agent / agents / Deploy Agent / Background agents / AI executive team / coworker / co-pilot / VA · Atlas / Sophie / Solene / Forge / Samantha / Alex / Maya / Charlie / Riley · AI Hub / Command center / AI Tasks / Scheduled AI Tasks · witnessed / kernel / executor / envelope / trace / circuit breaker · manual-only / Reset Pax · cost-saving mode / full-power mode · dunning · "Settings → Pax controls" / "Pax > Controls" · "$0.02 per task" · "Insights" as a menu label · "Pax always asks before taking an action" · "it never decides for you" · "Pax can take real actions" · any "overnight"/"auto-sent" number not read from a row. "Not yet live" badges are kept (honest exception).

---

## 3. The surface

### 3a. Settings → Pax (`/settings/pax`, existing nested route, `client/src/pages/settings/pax-controls.tsx` rebuilt as `PaxControls`)

No Settings tab is added (`VALID_TABS` stays at 7). The `integrations` bucket's label becomes **"Pax & connections"**; its first card is a one-line **"Pax — when it asks, what runs on its own → Open"** linking to `/settings/pax`, replacing the `AICostDashboard` + `AISettings` + inline `ByokSettings` + flagged `AutonomyPanel` + `WorkflowsSettingsTab` + `PaxTasksSettingsTab` stack (`settings.tsx:1459-1460, 1490, 1493-1498, 1558-1566`). BYOK and provider status remain in the bucket below the card; `AICostDashboard` moves last.

Every line on the page is read from **`GET /api/pax/controls`** (org truth, never the caller's own prefs). Layout, top to bottom, one iPad screen, 44px targets:

1. **Status strip.** "Pax is active · Ask before sending" or "Paused until Thu 8:00 am by Maria". One button: **Pause Pax** (any active member) / **Resume** (owner/admin, or the person who paused). Tapping Pause asks only "until when": *tomorrow 8 am* (default) / *3 days* / *until I resume* (30 days; the strip says "Pax resumes by itself on {date} if you forget"). Beneath: what Pause stops, **rendered from `UNATTENDED_PATHS`** (the same registry the ratchet reads), and what it does not: "Pax still answers and drafts, still asks, and anything you approve still goes out."
2. **When Pax asks.** Two-option segmented control (owner/admin may change; members read-only with "Ask an owner to change this"), each option with its glossary sentence. A live "Right now" line: "Waiting for your tap: 3 · Changed on its own today: 12 · Rules running: 4 workflows, 2 sequences, 1 scheduled prompt" — true zeros render as zeros. Then the **fixed rule** printed once: "Anything Pax writes to another person — email, text, letter, payment link — waits for your tap. Always."
3. **What runs on its own.** One list; each row = real switch + server-computed liveness line + link to its editor:
   - Workflows — `workflows.isActive` per row, live/not-yet-live badge from `LIVE_WORKFLOW_TRIGGER_EVENTS`, "last ran {relative}" from `workflow_runs`; Edit → `/workflows`.
   - Campaign sequences — active enrollment count, last send from `outboundEmailLog`/SMS rows; → `/campaigns`.
   - Scheduled prompts — the `pax_scheduled_tasks` list inline: Pause / Resume / Delete / Run history, wired to `PATCH /api/ai/scheduled-tasks/:id {isActive}` (`routes-ai.ts:950`); `skipped_paused` and `skipped_off` render as neutral "Skipped — paused", never the Error badge; the dead `toggleMut` (`pax-tasks-settings-tab.tsx:70-75`) is gone.
   - Lead scoring — org switch (`pax_controls.leadScoring`), "every 15 min · scores and stages leads · last ran {relative} · {n} rescored today".
   - Borrower reminders — org switch (`pax_controls.borrowerReminders`) labelled "Prepare borrower payment reminders"; line "prepared every 30 min · each one waits for your tap · {n} waiting". No "on its own" option (see §5, §9).
   - Inbox reply drafts — org switch (`pax_controls.inboxDrafts`, migrated from `aiSettings.paxDraftEnabled`): "Draft a reply when I open a message".
   - Fixed rules, read-only, with usage from real rows only: "Texts only 8am–9pm recipient time · {a} of 50 emails and {b} of 20 texts used today (from the send log) · never to anyone who opted out · from your own connected accounts". No number is printed without a source.
4. **What Pax can use.** The four connection-status rows from `autopilot-setup.tsx:67-78, 174-222` (text / email / mail / property data, from `GET /api/byok` + `GET /api/mailbox`), each linking to the one catalog at `/settings/byok`.
5. **Waiting for your tap (N)** → `/ai` queue. **What Pax did** → the receipts feed (§4.7). **Who on your team can ask Pax to do what** → Settings → Team (the permission ladder, `tools.ts:1128-1154`, named as the per-person Pax control).
6. **Never** — the fixed list from §2.

Entry points (all existing, re-aimed): the bucket card; `SettingsQuickFind.tsx` rows "Pax — pause, when it asks" / "Pause Pax" / "Waiting for your tap" (replacing the "Autonomy matrix" row at `:52`; the BYOK row at `:49` repoints to `/settings/byok`); Pax overflow menu item "Controls" (replacing the founder "Agents" sheet for customers, `pax-overflow-menu.tsx:76-80`); a Today status chip "Pax: Ask before sending · 3 waiting"; the Morning-brief link (`MorningBrief.tsx:66`, kept); command palette "Pause Pax" / "Pax settings"; every refusal message (glossary constant). This closes the no-data unreachability (confusion #5).

### 3b. The Pax door (`/ai`) — cleaner by subtraction

Customer tabs collapse to the conversation alone (Tasks tab deleted). A pinned strip **"Waiting for your tap (N)"** sits above the composer on desktop AND mobile and expands to `PaxAskCard`s. Footer: three text links "Controls · What Pax did · Appeals". Overflow menu: Controls · What Pax did (receipts) · Appeals; founder-only entries stay gated. The gear icon's `AISettings` dialog (`command-center.tsx:~1990-2021`) is deleted; the gear opens `/settings/pax`. Document title becomes "Pax" (`:1557`).

### 3c. Everywhere else

Pax-door badge = pending-ask count in the desktop sidebar (`layout-sidebar.tsx`, same `useWebSocketChannel` pattern as `inbox.unread` at `:1022-1031`) and in `MobileBottomNav.tsx` (new badge on the `ai-hub` door). Today's Decision queue gains source `pax-ask` (`DecisionQueue.tsx:46`) rendering the same card with inline Approve/Reject. Inbox shows one pinned pointer chip "N drafts waiting for your tap → Pax". Activity page gains a "Pax" filter that reads the receipts route.

### 3d. Deletions (file paths verified)

| File / route | What goes | Why |
|---|---|---|
| `client/src/components/settings/autopilot-setup.tsx` | whole file; the four connection rows move into `PaxControls` | `pax.level` has no server reader; "Full autopilot" is fabricated capability (confusion #1) |
| `client/src/components/settings/autonomy-panel.tsx`; `settings.tsx:166, 1493-1498`; `SettingsQuickFind.tsx:52`; feature-flag row `migrations/0029_feature_flag_state_machine.sql:40` (removed by a new migration `DELETE FROM feature_flags WHERE key='feature.autonomy-matrix'`) | whole panel + flag | third vocabulary, inert fields, silently clears pauses (confusion #12) |
| `client/src/components/ai-settings.tsx`; mounts `settings.tsx:1460` and `command-center.tsx:~2019`; `PATCH /api/organization/ai-settings` (`routes-organization.ts:727-757`); `storage.updateOrganizationAISettings` (`storage.ts:162`, `storage/orgRepo.ts:84`) | all four fields and the route | zero readers (confusion #9); `paxDraftEnabled` migrates to `pax_controls.inboxDrafts` |
| `pax-controls.tsx` | slider `:222-252, :321-363`; Reset `:155-181, :490-566`; Replay `:395-486`; founder link `:405`; copy `:262-269, :308-313, :373-379` | client-only threshold; reset deletes `pausedUntil`; observations mislabelled as actions; false pause claims (confusions #3, #4) |
| `client/src/pages/today.tsx:333-348`; `DecisionQueue.tsx:111-141, 210-227, 425-556, 631`; `server/routes-today.ts:701` (`confidence: 0.82`) | threshold read, "Pax would handle", Override, hardcoded confidence | fabricated confidence (confusion #7) |
| `client/src/pages/command-center.tsx:969-1133, 1965-1968` (Tasks tab, Deploy Agent, "$0.02 per task" `:1075`); `routes-ai.ts:48-76` customer `/api/agents/tasks`; `server/jobs/autonomousTaskProcessor.ts` + `jobRegistry.ts:177` entry (and `jobRosterCoverage.test.ts` updated) | customer surface deleted; processor deleted; founder readers `founder/agent-queue.tsx`, `founder/feed.tsx` handed to the founder lane in the same program | dead-letter queue, invented price (confusion #8) |
| `routes-autonomous-agent.ts` (`PUT /agents/:type/config`, `POST /tasks`, `/:id/approve|reject`); `routes-ai.ts:1539` (auto-create VA rows), `:1574` (`PATCH /api/va/agents/:id`), `:1750` (`process-autonomous`); `routes-communications.ts:1258` (`POST /api/scheduled-tasks` agent_skill) | `requireFounder` on all; `process-autonomous` deleted | the undocumented place a customer could set `full_auto` |
| `server/ai/vaService.ts:568-612` | `send_reminder`, `propose_campaign`, `schedule_callback`, `record_note` return `success:false` with the reason | they wrote nothing |
| `routes-pax-insights.ts` first-follow-up GET (`~:495-520`) + `POST /first-follow-up/approve-and-send` (`:542-622`); `server/services/paxDraftService.ts`; `pax_drafts` table (`schema.ts:2637`, dropped by migration after the route is gone) | second approval mechanism | zero client callers; one kernel only |
| `server/ai/tools.ts:1950-1968, 2059-2077`; `server/services/agent-skills.ts:303-314`; `autonomyGuardrails.ts` `getOrgAutonomyLevel` (:348) / `unattendedSendPermitted` (:374) / `getAutonomyEligibility` (:406) / `checkCircuitBreaker` (:592) / `AutonomyLevel` type; `routes-pax-insights.ts:12,501`; `financeAgent.ts:43,504-516`; `organizations.paxAutonomyLevel` (`schema.ts:239`, dropped by a SECOND migration once the zero-reader ratchet is green) | dead level machinery | unreachable; leaks "assisted" |
| `agent-skills.ts:1626-1645` | `notificationSent: true` with no rail → `false` + reason | fabricated effect |
| `tools.ts:989` | `draft_offer` leaves `PAUSE_SAFE_TOOLS` (it mutates the deal at `:2473-2484`) | pause-safe must mean no storage mutation |
| `client/src/components/workflow-builder.tsx` `WorkflowBuilderPanel` | delete | zero call sites; lists actions the engine lacks |
| `client/src/components/workflows-settings-tab.tsx` mount (`settings.tsx:1558-1561`); `client/src/components/pax-tasks-settings-tab.tsx` (rows move into `PaxControls`); `MobileCommandDrawer.tsx:53-54` | one "Workflows" entry; `/workflows` is the one editor | duplicate entry points (confusion #19) |
| inline `ByokSettings` mount (`settings.tsx:1490`); `SettingsQuickFind.tsx:49` | link to `/settings/byok` | two catalogs (confusion #14) |
| `client/src/components/provider-settings.tsx:97-125`; `routes-organization.ts:779-783` | "cost-saving / full-power mode" text → factual BYOK status chip on `/settings/byok` only | reads as a setting (confusion #18) |
| `pax-overflow-menu.tsx:64-93` | customer "Agents" entry; "What Pax did" → receipts route; "Insights" dollar badges | fabricated dollars, founder placeholder (confusion #10) |
| `client/src/lib/nav-items.ts:105` ("AI Hub"); `command-center.tsx:1183` and the AI-Ops voice "Ready" badge | delete | no voice rail exists |
| Landing + copy | see §6 | public claims must match the product on day one |

---

## 4. Enforcement wiring

### 4.1 Storage (one migration, shipped in the same commit as the schema)

`migrations/0248_pax_controls.sql`:
- `organizations.pax_controls jsonb` typed `PaxControls = { stance: Stance; leadScoring: boolean; borrowerReminders: boolean; inboxDrafts: boolean }`. Backfill `inboxDrafts=false` where `settings->'aiSettings'->>'paxDraftEnabled' = 'false'`. Null column ⇒ defaults that EQUAL today's live behaviour: `{ ask_before_sending, true, true, true }` — deploy changes nothing silently.
- `pending_actions` gains nullable `origin text`, `source_ref jsonb`, `reason text`.
- `DELETE FROM feature_flags WHERE key = 'feature.autonomy-matrix'`.
- `pax_drafts` drop and `pax_autonomy_level` drop are two LATER migrations, each after its zero-reader ratchet is green.

Pause storage is unchanged (`users.autonomyPreferences.pax.pausedUntil`, org-wide by construction in `paxPause.ts:76-109`, pinned by `paxPauseState.test.ts`). `AutonomyPreferences` (`shared/models/auth.ts:45-63`) shrinks to `{ pax?: { pausedUntil?: string } }`; a data migration nulls `level/perAction/thresholdsCents/timeGuards/atlas/sophie`.

### 4.2 One reader

`server/services/paxControls.ts` exports `getPaxControls(orgId) → { paused, pausedUntil, pausedBy: {userId, name} | null, checkFailed, stance, leadScoring, borrowerReminders, inboxDrafts }`. It calls `getPaxPauseState` first (extended to return the holder), then parses the column with a zod-strict schema. **Fails closed:** any parse or DB error ⇒ `stance: "ask_before_everything"`, all three switches `false`, `checkFailed: true` — never a permissive value. `paxPause.ts` stays as the pause primitive; every engine below calls `getPaxControls` (one call, pause folded in).

`shared/pax-controls.ts` exports `OFFERED_STANCES`, `STANCE_RULINGS` (one dated founder-ruling doc path per offered stance), `UNATTENDED_PATHS` (the enumerated population, §4.4), `PARKED_STATES` (§4.5), `ALWAYS_ASK_SUPPORT_TOOLS`, and `PAX_TOOL_GROUPS` (tool→group mapping the page renders from).

### 4.3 Kernel

`ExecuteToolOptions` (`tools.ts:1017`) gains `origin: "chat" | "scheduled" | "inbound_signal" | "support" | "approval_replay"` — every caller passes it (`ai/executive.ts` four call sites, `paxScheduler.executeTask` → `processChat` → `executeTool`, `vaService`, App Intents, `spawn_subagent` recursion, the approve route). The predicate at `tools.ts:1064` becomes:

```
requiresAsk = APPROVAL_REQUIRED_TOOLS.has(tool)
           || (controls.stance === "ask_before_everything" && !PAUSE_SAFE_TOOLS.has(tool))
if (requiresAsk && !trustedApproval) → proposePendingAction({..., origin, sourceRef: derivedFromArgs(lead_id|deal_id|property_id), reason: args.reason ?? null})
```

Gate order unchanged (kernel → pause → scope → FCRA). At `ask_before_everything` the customer's own chat commands ALSO freeze (an inline card, one tap) — uniform semantics, no asterisk (founder question 4 records the alternative). `executeSupportTool` (`supportAgent.ts:1300`) gains `options?: ExecuteToolOptions` and the identical predicate over its non-`PAUSE_SAFE_SUPPORT_TOOLS` cases, PLUS `ALWAYS_ASK_SUPPORT_TOOLS = { apply_billing_fix (retry_payment | update_payment_method), resync_stripe, reset_user_preferences, apply_bulk_fix, fix_common_issue }` which freeze at EVERY stance — so "Requires customer confirmation" (`:665`) is finally true. `apply_credit` (`:3861`) becomes model-unreachable (refuses: "a person will review this") because a concession on what the customer pays AcreOS is the founder's pricing hard-stop, not a customer approval. `send_direct_mail` and `enroll_lead_in_sequence` (wave 2) are added to `APPROVAL_REQUIRED_TOOLS`.

The approve route's `execute` callback (`routes-pax-insights.ts:654`) switches on toolName via `server/services/paxAskExecutors.ts`: kernel/record tools → `executeTool(..., {trustedApproval:true, origin:"approval_replay"})`; support tool names → `executeSupportTool(..., {trustedApproval:true})`; `send_borrower_reminder` → `financeAgentService.sendManualReminder(reminderId, {humanApproved:true})`. `paxAsksAreExecutable.test.ts` derives every toolName `proposePendingAction` is called with (call-site scan) and asserts each resolves to exactly one executor.

Dead branches `tools.ts:1950-1968, 2059-2077` and `agent-skills.ts:303-314` are deleted (`agent-skills` `sendEmail` refuses plainly: "Email from a skill has no one to approve it — send via Pax"). The post-tap error string at `autonomyGuardrails.ts:74` becomes "Daily send limit reached ({n}/{limit} {channel}s today)".

### 4.4 Stance × group × path — who reads what

| Path (member of `UNATTENDED_PATHS`) | file:function | Ask before sending | Ask before everything | Paused | Switch |
|---|---|---|---|---|---|
| Chat / rail / App Intents record writes | `server/ai/tools.ts:executeTool` | execute + receipt | freeze as ask | refuse (glossary message); sends still freeze | — |
| Chat sends | `tools.ts:executeTool` (kernel) | freeze | freeze | freeze | never offered |
| Support account fixes | `server/ai/supportAgent.ts:executeSupportTool` | `ALWAYS_ASK_SUPPORT_TOOLS` freeze; other non-safe execute + receipt | all non-safe freeze | refuse | — |
| Scheduled prompts | `server/services/paxScheduler.ts:processPaxScheduledTasks` (:215) + `executeTask` (:124) passing `origin:"scheduled"` | run; writes execute | run; every write freezes; run summary "N things waiting for your tap" | `skipped_paused` (exists), `nextRunAt` = lift | per-task `isActive` (`routes-ai.ts:950`) |
| Lead scoring / staging | `server/jobs/leadCampaignJobs.ts:processLeadNurturing` (:19) before `processLeadsForOrg` (`leadNurturer.ts:257`) | run + receipt per stage transition | run (internal write, not a send — stated on the row) | skip org, logged | `pax_controls.leadScoring` → `skipped_off` |
| Campaign optimizer suggestions | `leadCampaignJobs.ts:processCampaignOptimizations` (:77) | run | run | skip org | follows `leadScoring` |
| Pax nudges / lead-aging alerts | `server/services/paxNudges.ts:processPaxNudges` (:271); `alerting.ts:AlertingService` | cards only | cards only | skip org | — (cards are not actions) |
| Workflows | `server/services/workflow-engine.ts:triggerWorkflows` (:1950) after `getActiveWorkflowsByTrigger` (:1953); `resumeDueWorkflowRuns` (:2272) re-checks | run (rules are outside the stance; stated on the page) | run | park run `status:"waiting"`, `resumeAt = pausedUntil ?? now+15m`, `resumeState.reason = "paused"` (reuse the delay parking `:2218-2262`); `WORKFLOW_RUN_STATUSES` unchanged | per-workflow `isActive` |
| Campaign sequences | `server/services/sequenceProcessor.ts:processEnrollment` (:141) Gate 0; `sendStep` (:314) gates 1-3 unchanged | run | run | `nextStepScheduledAt = pausedUntil`, `recordStepSkip(..., "deferred_paused")` (:439) — deferred, never dropped; frequency cap + quiet hours still meter on resume | per-enrollment pause (`/campaigns`) |
| Task-runner skills | `server/services/task-runner.ts` `agent_skill` case (:150) | founder-only creator (§3d) | — | skip paused org | — |
| Borrower ladder STAGING | `financeAgent.ts:ensureLadderRung` (:304) | stage rung | stage rung | do not stage (`{created:false, reason:"pax_paused"}`); the 31+-day default-candidate alert (`:690-709`) stays — it is an alert about the customer's own money | `pax_controls.borrowerReminders` → `reason:"pax_off"` |
| Borrower ladder DISPATCH | `financeAgent.ts:dispatchReminder` (:445) Gate 2 (:504-516) | Gate 2 becomes: `if (!options.humanApproved) { proposePendingAction({toolName:"send_borrower_reminder", args:{reminderId}, origin:"finance_ladder", sourceRef:{noteId,borrowerId}}); return finish(awaitingApproval, glossary) }` | same | Gate 1 unchanged (`queued`) | same switch |
| Inbox reply draft on open | `server/routes-ai-draft.ts:81` reads `pax_controls.inboxDrafts` | draft | draft | draft (drafts are not actions — stated) | `inboxDrafts` |
| Founder executor org items | `autonomousDecisionExecutor.ts:906` | unchanged | unchanged | defer (exists) | founder-only |

Dispatch of a rung the human approved runs the existing `sendManualReminder` path (`:794-895`) — the letter rung stays `document_ready`, never claimed as mailed.

### 4.5 Review queue ("Waiting for your tap")

- **Store:** `pending_actions` only. `PARKED_STATES = ["pending_actions:pending"]`; `financeLadderAsksThroughKernel.test.ts` asserts every `REMINDER_STATUS.awaitingApproval` write in `financeAgent.ts` is paired with a `proposePendingAction` call (remove the pairing → fails).
- **`GET /api/pax/needs-you`** (mounted on the existing `/api/pax` router, `routes.ts:1433`): org-scoped, `status="pending" AND expiresAt > now`, ordered by `expiresAt asc`, plus rows expired within 7 days flagged `expired`. Each item carries a SERVER-formatted summary from `server/services/paxAskSummary.ts` (`formatApprovalArgs` moved out of `pax-copilot-rail.tsx:231`): verb line ("Text Bill Thompson"), `to`, `from` (the org's connected identity for that channel — "your Twilio number", "your Gmail"; or "no sending identity connected → Settings → BYOK"), the full frozen text / before→after for a record write, `why` = `reason` verbatim labelled "Pax's explanation" (absent when null; never a number), `origin` in words ("from your scheduled prompt 'Monday lead pull'", "from your chat", "borrower reminder ladder"), `sourceRef` link, `expiresAt`. **`GET /api/pax/needs-you/count`** → `{count}`.
- **Actions:** Approve → existing `POST /pending-actions/:id/approve` (callback per §4.3). Reject → existing route. **Edit → `POST /pending-actions/:id/revise {args}`**: validates `args` against the tool's own zod definition, then in one transaction claims the old row `pending→rejected` (guarded `WHERE status='pending'`, `resultSummary:{revisedTo:newId}`) and inserts a new row (`createdByUserId` = the human, `origin:"revised"`, new `contentHash`); approval of the new row replays through the kernel like any other. A race test asserts a double tap cannot send both.
- **Expiry:** job `pax_ask_expiry` (every minute; `withJobLock` in `runScheduledJobs.ts`, roster entry in `jobRegistry.ts`) flips `pending→expired` past `expiresAt`, writes an `ask_expired` receipt, broadcasts. Expired items stay listed 7 days under "Expired — ask Pax to draft it again" with a one-tap link that opens `/ai` with the original request prefilled from the frozen args. The 24h `PENDING_ACTION_TTL_MS` stays (a stale draft is a wrong draft).
- **Live:** `proposePendingAction`, approve, reject, revise and the sweep all call `wsServer.broadcastToOrg(orgId, "pax.needs_you", {count})` (`server/websocket.ts:364`; same mechanism as `inboundEmailService.ts:131`).
- **Surfaces (exactly four hosts of `PaxAskCard`, enumerated in the ratchet):** (1) the chat message where it was proposed — the rail (`pax-copilot-rail.tsx:875`) and the `/ai` stream handler (`command-center.tsx:1837-1848`), which gains the `pending_action` branch it drops today (the server already yields it, `ai/executive.ts:2243`); (2) the pinned strip on `/ai`, desktop and mobile (the rail returns null on mobile, `:1126` — the strip is how a phone answers); (3) Today's Decision queue as source `pax-ask` with inline Approve/Reject; (4) the support chat, for support-origin asks.
- **Badge:** the Pax door in `layout-sidebar.tsx` and `MobileBottomNav.tsx`, fed by the count, invalidated on `pax.needs_you`, 5-minute poll fallback. The observations popover keeps its own list but no second number competes on the door.
- **Notifications:** new events in `NOTIFICATION_SCHEMA` (`notificationPreferences.ts:60`): `pax.needs_you` (in-app + email; push OFF until the org-scoped push lane is proven by an e2e — the matrix row says "in-app + email"), `pax.ask_expiring` (T-2h), `pax.ask_expired`. Dispatched through `notificationDispatcher.ts`, never through the founder `approval:requested` stub (`:68`).
- **Digest:** the 6-hourly `digest` job (`digestService`, `DigestData` `digest.ts:8-37`) gains `paxWaiting: {count, oldestExpiresAt}` and `paxDid: {recordChanges, rulesRan, approvedSends}` from real rows, rendered as "Waiting for your tap (N, oldest expires 9:14 am)" with deep links to `/today`. System-mail lane (AcreOS talking to its own user) — correct under the BYO rule.
- **While paused:** asks keep accumulating ("Paused — 3 drafts are waiting"); approving is the human acting (`trustedApproval` bypass, unchanged, stated on the card).

### 4.6 Pause semantics

Any active member pauses (`POST /api/pax/pause {until: "tomorrow_8am" | "3d" | "30d"}` → writes the caller's `pax.pausedUntil`; tomorrow-8am computed in the user's timezone). `POST /api/pax/resume`: owner/admin clears EVERY org user's `pausedUntil`; a member clears only their own row (the banner always reads org truth, so "Pax is active" cannot show while the org is paused). `PATCH /api/pax/controls` is zod-`.strict()` and cannot touch `pausedUntil`; `routes-autonomy.ts` is deleted (its GET/PATCH replaced by these routes), removing the shallow-merge clobber. Pause and Resume each write a receipt: "Paused by Dana until Thu 8 am — 2 sequences, 1 workflow, 1 scheduled prompt deferred; 3 waiting for your tap" (counts from the deferred rows). Refusal copy (glossary): "Pax is paused until Thu 8:00 am (paused by Maria), so this wasn't done. Resume under Settings → Pax. Looking, drafting and anything you approve still work." Fail-closed read ⇒ "Pax could not verify its pause setting, so this wasn't done. Try again or check Settings → Pax."

### 4.7 Receipts ("What Pax did")

`server/services/paxReceipts.ts` exports `recordPaxEffect({orgId, actor:"pax"|"rule", origin, group, stance, tool|engine, entityType, entityId, before?, after?, pendingActionId?, workflowRunId?, enrollmentId?, witnessed})` → `storage.logActivity({agentType:"pax", action, entityType, entityId, changes:{before,after}, metadata:{...}})` into **`activity_log`**. Never throws into the caller (try/catch + `logger.error`). Writers: a post-dispatch hook in `executeTool` for every non-`PAUSE_SAFE` tool (existing per-case `logActivity({agentType:"pax"})` calls such as `tools.ts:1245` are migrated to `recordPaxEffect`, and the hook writes the generic receipt only when the case did not — a per-call `receiptWritten` flag); the approve route (`:692` migrated); `leadNurturer.scoreLead` on stage transitions; `financeAgent` staging/dispatch; `sequenceProcessor.sendStep`; `workflow-engine.executeAction` side-effecting kinds; pause/resume; the expiry sweep. Reader: **`GET /api/pax/receipts`** (`activity_log WHERE agent_type='pax'` joined to `pax_sends` by `pendingActionId`), rendered by the page's "What Pax did" section, the overflow menu, and `/activity?actor=pax`. Each row: when · what · which record · "asked / ran on its own / rule". `before/after` is captured now; the word "Undo" is not printed until a revert route exists (wave 3).

---

## 5. Competitor-gap decision table

| Capability (who has it) | Decision | Why / what ships |
|---|---|---|
| Review queue with reasoning, count, digest, mobile approval where proposed (HubSpot Agent Inbox, Relevance, Zapier) | **BUILD (wave 1)** | §4.5 entirely; the rows already exist. |
| Edit-before-approve / refine (HubSpot, Relevance) | **BUILD (wave 1)** | `revise` route + card Edit. Chat-driven refinement later. |
| Per-action stance (Lindy, Relevance, Anthropic, Zendesk) | **BUILD, coarse** | Two stances flip the "changes your records" block in the kernel; per-tool overrides rebuild the inert matrix. Sends can never be "always allow" under the posture. |
| Action receipts / audit trail (Zapier, Agentforce, Ramp) | **BUILD (wave 1)** | §4.7, complete by construction at the chokepoint plus engine writers. |
| Customer-visible lead scoring with cadence and switch (REsimpli, Carrot, BatchRank) | **BUILD (wave 1)** | Row in "What runs on its own" with `leadScoring` switch; editable weights NOT claimed. |
| Pause that hands off (HubSpot) | **BUILD (wave 1)** | Asks accumulate while paused; deferred counts on the banner; receipt on pause/resume. |
| Preview before go-live (HubSpot, Intercom, Zapier) | **BUILD, honest form** | First-run "Try it" on the real kernel with sample data (reject the ask, nothing sends) + the real-state "This week Pax will…" line. "Test as a contact" simulation NOT claimed. |
| Two-way SMS/email conversation with sellers (REsimpli, Carrot, REI Reply, Lofty) | **BUILD draft-and-wait (wave 2); unattended = FOUNDER-DECIDES** | Inbound SMS (`routes-misc.ts:330` webhook, STOP handling exists) / inbound email (`inboundEmailService.ts`) → Pax drafts a reply → `proposePendingAction(send_sms|send_email, origin:"inbound_signal")` → queue/badge → one tap from the customer's own number. This is Carrot's shipped default. No latency number printed until measured. Founder question 2 asks about unattended replies. |
| Speed-to-lead (REsimpli, Lofty) | **BUILD honest halves (wave 2)** | Customer-authored first touch on the live `lead.created` trigger already runs unattended (say so); Pax-written first touch drafted into the queue. Voice NOT claimed. |
| CRM moves from conversation signals (REsimpli, Lofty) | **BUILD (wave 2)** | Inbound reply → classify → `update_lead_status` via `executeTool` with `origin:"inbound_signal"` — inherits the stance (ask at strict, receipt at default). |
| AI-initiated direct mail from chat (DealMachine) | **BUILD (wave 2)** | `send_direct_mail` in `APPROVAL_REQUIRED_TOOLS`, Lob BYO rail (`sequenceProcessor.ts:603`). |
| Pax starts a sequence for a lead (DealMachine, InvestorLift) | **BUILD (wave 2)** | `enroll_lead_in_sequence` as an approval-required tool; the sequence then runs under its own switch. |
| Per-lead mute (Lofty, Carrot intervention) | **BUILD (wave 2)** | `leads.paxMuted` (distinct from legal `doNotContact`, `schema.ts:994`) checked inside `canSendViaChannel` (`tcpaCompliance.ts:474`) and `leadNurturer.processLeadsForOrg`; toggle on the lead card. |
| Graduation to unattended Pax-written sends (HubSpot, Carrot, REsimpli) | **FOUNDER-DECIDES** | Crosses the standing posture (`founder-autopilot-2026-06-16.md` §5 "Witnessed-send (customer-facing only)… unchanged"). `OFFERED_STANCES` + `STANCE_RULINGS` is the one lever; nothing renders until widened. Question 1. |
| Unattended borrower collection notices | **FOUNDER-DECIDES** | Row says "each one waits for your tap"; `borrowerReminders` switch is Off/Prepare only. Question 3. |
| AI inbound call answering / voice follow-up (REsimpli, REI Reply, Lofty) | **NOT-CLAIM** | No rail; the AI-Ops "Ready" badge is deleted; no voice word on any customer or landing surface. |
| Buyer-side disposition autopilot (InvestorLift) | **NOT-CLAIM** | Marketplace hard-stop (<~25 customers); a customer-authored buyer drip already exists — say that plainly. |
| Customer-editable guardrail fields (HubSpot, Intercom, Salesforce) | **NOT-CLAIM (now)** | Real rules shown read-only with usage; editable versions were inert. Tighten-only fields are a later wave with their own reader. |
| Budget circuit breaker (Relevance, Lindy) | **NOT-CLAIM** | Fixed 50/20 envelope shown honestly; "Daily action limit 200" was inert and is deleted. |
| Rollback / undo (Copilot checkpoints, Zapier) | **NOT-CLAIM (now)** | `before/after` captured; revert route is wave 3; "Undo" is not printed until then. |
| Per-source auto-enrollment (Lofty) | **NOT-CLAIM** | No `enroll_in_sequence` workflow action exists (`workflow-engine.ts:2313-2328`); claim nothing until it and its live trigger exist. |
| Autonomous offer negotiation | **NOT-CLAIM** | Offers stay drafts; sending one is a witnessed send. |

---

## 6. Copy fixes

| Surface | file:line | Today | Replacement |
|---|---|---|---|
| Landing FAQ | `client/src/pages/landing/FAQ.tsx:22-23` | "autonomy slider per surface — Off, Suggest, Review-then-send, or Auto-send. Default is Suggest." | "Yes. Pause everything with one tap, or set Pax to ask before it changes anything. Pax never sends a message to anyone until you tap Approve." |
| Landing day-in-life | `DayInLife.tsx:34` | "37 servicing receipts sent overnight." | "Tomorrow's mail batch reviewed and approved." (number removed) |
| Landing day-in-life | `DayInLife.tsx:32` | "2 meetings booked into calendar automatically." | "2 meetings booked into calendar from the lead queue." |
| Landing day-in-life | `DayInLife.tsx:37` | "Background queue continues: comps, drafts, receipts, follow-ups." | "Overnight: comps run, replies drafted, drips you turned on go out." |
| Landing agents card | `Agents.tsx:84` | "Late notices · 2 (auto-sent Mon)" | "Late notices · 2 (waiting for your tap)" |
| Landing product shot | `ProductShots.tsx:111` | "2 items finished overnight — logged with receipts" | "Drips you turned on ran overnight — logged with receipts" |
| Landing copy | `copy.ts:168` | "Lists pulled, mail sent, replies drafted overnight." | "Lists pulled, replies drafted, your drips sent — overnight, from your own accounts." |
| Landing copy | `copy.ts:181` | "…drafts replies, books follow-ups, services notes." | "…drafts replies, prepares borrower reminders for your tap." |
| Today brief | `server/routes-today.ts:933` | "Pax posted the rest" | "{n} posted" (from real payment rows) |
| Today brief | `routes-today.ts:936` | "the 21-day silence" | drop the hardcoded benchmark; "still warm" |
| Today queue | `routes-today.ts:701`; `DecisionQueue.tsx:533, 631` | `confidence: 0.82`; "Pax would handle"; "Override" | field removed; pill removed; CTA = `actionLabel` |
| Inbox empty state | `client/src/pages/inbox.tsx:847` | "…raises an aging alert after 3 quiet days on a hot lead." | "Pax threads every reply against this lead." (aging alert is env-gated; say it only where the row exists) |
| Tasks empty state | `client/src/pages/tasks.tsx:587, 594-596` | "Pax flags hot leads after 3 quiet days…"; "Pax drafts follow-up messages as leads age" | "Pax surfaces the task on Today the morning it's due"; "Ask Pax to draft a follow-up any time — it waits for your tap" |
| Pax starter prompt | `client/src/pages/pax.tsx:781` | "Skip-trace my newest leads" | "Which of my leads went quiet this week?" |
| Pax rail footer | `pax-copilot-rail.tsx:1908` | "Pax can take real actions · Always review…" | `PAX_STANDING_LINE`: "Pax looks, drafts and updates your records. Every message waits for your tap." |
| Disclosure rail | `client/src/components/pax/pax-disclosure-rail.tsx:33` | "…it never decides for you. Verify before you act." | same `PAX_STANDING_LINE` + "Verify before you act." |
| Disclosure dialog (v2) | `AiDisclosureDialog.tsx:79-89`; `AI_DISCLOSURE_VERSION` `:36` → `"v2"` | "operated by an AI executive team on behalf of the founder…" | the three sentences of §1 + "You start on Ask before sending. Change it, or pause everything, any time under Settings → Pax." Buttons: "Got it" / "See what Pax may do" (→ `/settings/pax`). Every existing user sees it exactly once; acknowledgement stays the consent record. |
| Onboarding | `onboarding-v2.tsx:1066, 1247` | "Pax loads 50 realistic leads…"; "Pax is ready —" | keep; append "You'll approve before anything goes out." |
| Privacy | `client/src/pages/privacy.tsx:241-242` | "autonomy controls in Settings (Pax > Controls)" | "the Pax settings under Settings → Pax" |
| Refusals | `paxPause.ts:119, 127`; `paxScheduler.ts:230`; `financeAgent.ts:514` | "Settings → Pax controls"; raw ISO; "'assisted'" | glossary message (§4.6); humanized time; `PAX_CONTROLS_LABEL` |
| Scheduled-task summary | `paxScheduler.ts:229` | "Skipped: Pax is paused until {ISO}…" | "Skipped — Pax is paused until Thu 8:00 am. Resume under Settings → Pax." |
| Pax page header | `pax-controls.tsx:262-269, 308-313, 373-379` | "Stops every auto-execution path… the autonomous executor"; "Pax always asks before taking an action" | rendered from `UNATTENDED_PATHS` and the glossary |
| Overflow / activity | `pax-overflow-menu.tsx:69-72`; `activity.tsx:114` | "What Pax did → /activity (All actions across your organization)" | "What Pax did" → receipts route; Activity page gains the Pax filter |
| Settings bucket | `settings.tsx` integrations label; `SettingsQuickFind.tsx:49, 52` | "Integrations"; "BYOK — OpenAI / Anthropic" → inline list; "Autonomy matrix" | "Pax & connections"; BYOK → `/settings/byok`; "Pax — pause, when it asks" |
| Nav | `nav-items.ts:105`; `command-center.tsx:1557` | "AI Hub"; "Command center" | "Pax"; "Pax" |
| Post-tap error | `autonomyGuardrails.ts:74` | "Daily autonomous send limit reached" | "Daily send limit reached ({n}/{limit} {channel}s today)" |
| Workflow toast | `client/src/pages/workflows.tsx` "Your workflow is now active" | unconditional | "Saved — will run when {event} goes live" when the trigger is not in `LIVE_WORKFLOW_TRIGGER_EVENTS` |

---

## 7. Gates (each mutation-probed before merge; population enumerated; per-member vacuity assertion)

| Test | Population | Property | Probe that must fail |
|---|---|---|---|
| `paxStanceIsRead.test.ts` | `TOOL_SWITCHES = [executeTool, executeSupportTool]` | with stance stubbed `ask_before_everything`, `update_lead_status` returns a pending artifact and the update mock is never called; with `ask_before_sending` it executes; `send_email` freezes at BOTH stances; `apply_billing_fix` freezes at both; `apply_credit` refuses at both | delete the stance read in either switch; move `apply_billing_fix` out of `ALWAYS_ASK_SUPPORT_TOOLS` |
| `paxStanceFailsClosed.test.ts` (REWRITE of `autonomyLevelFailsClosed.test.ts`, not deleted) | hostile stored values (non-empty, none valid) | every unrecognised `pax_controls` value ⇒ strict + switches off + `checkFailed`; DB error ⇒ same; the two real stances survive | make the parser cast instead of parse |
| `paxControlsOffered.test.ts` | `OFFERED_STANCES`, `STANCE_RULINGS` | `PATCH /api/pax/controls {stance:"on_its_own"}` → 422; `{pax:{level:2}}` anywhere → 422; every offered stance has a ruling doc that exists in `docs/company/` | append a stance to `OFFERED_STANCES` without a ruling |
| `paxPauseCoversEveryUnattendedPath.test.ts` | `UNATTENDED_PATHS` (§4.4), cross-derived: every `jobRegistry.ts` entry whose module writes org rows AND every `executeTool`/`executeSupportTool` switch must be a member | for each member, paused ⇒ side-effect mock uncalled and a reason recorded; `sequenceProcessor` defers (never `failed`/`skipped`), `triggerWorkflows` parks with `resumeAt = pausedUntil`, `resumeDueWorkflowRuns` re-checks; resume of 30 deferred steps still meters through the frequency cap | remove one pause read; add a job that writes org rows without registering |
| `paxControlsSurfaceIsHonest.test.ts` | `client/src/pages/**`, `client/src/components/**`, `client/src/pages/landing/**` (founder dirs allowlisted; per-directory vacuity) | the page's "what Pause stops" list is imported from `UNATTENDED_PATHS`; every stance string comes from `shared/pax-glossary.ts`; banned-word scan (§2) finds nothing; "Settings → Pax controls" appears nowhere; `PAX_CONTROLS_PATH` resolves to a real route in `App.tsx` | type a stance label inline; add "autopilot" to a customer file |
| `paxAsksAreReachable.test.ts` + `tests/e2e-mobile/pax-ask-mobile.spec.ts` (project `iphone-14`, `playwright.config.ts:66`) | the four `PaxAskCard` hosts, enumerated | `GET /api/pax/needs-you` is org-scoped (cross-org id → 404), server-formatted, ordered by `expiresAt`; the `/ai` handler has a `pending_action` branch; the sweep flips pending→expired and emits; the e2e seeds one pending `send_sms` and approves/rejects it from `/ai` at 390px without leaving the page | delete the SSE branch; remove one host |
| `needsYouCountIsComplete.test.ts` + `financeLadderAsksThroughKernel.test.ts` | `PARKED_STATES`; every `awaitingApproval` write in `financeAgent.ts` | the list/count query reads each parked state; each ladder parking is paired with `proposePendingAction`; a repo-wide zero-hit assertion on `paxAutonomyLevel` / `unattendedSendPermitted` / `getOrgAutonomyLevel` | remove the `proposePendingAction` beside the parking |
| `paxAsksAreExecutable.test.ts` | every toolName passed to `proposePendingAction` (call-site scan) | each resolves to exactly one executor in `paxAskExecutors.ts` | propose a name with no executor |
| `paxReviseRace.test.ts` (REWRITE of `paxDraftApproval.test.ts`) | revise route | old row rejected and new row inserted atomically; double tap sends once; hash-bound; other org's id → 404 | drop the guarded `WHERE status='pending'` |
| `paxReceiptsAreComplete.test.ts` | `executeTool` case labels minus `PAUSE_SAFE_TOOLS` (derived), plus the engine writers | each executed member yields exactly one `activity_log` row with `agentType:"pax"`; the hook never throws into the tool path | remove the hook; make the hook throw |
| `pauseSafeToolsAreSafe` (extends `paxPauseToolGate.test.ts`; `draft_offer` moves into its `NOT_PAUSE_SAFE` list at `:310-331`) | `PAUSE_SAFE_TOOLS`, `PAUSE_SAFE_SUPPORT_TOOLS` | no allowlisted case body performs a storage/db mutation (semantic, not membership) | put `draft_offer` back on the allowlist |
| `paxWitnessedSend.test.ts` (kept; superset ratchet) | `APPROVAL_REQUIRED_TOOLS` | may only grow; a send never executes without `trustedApproval` at either stance | remove `send_sms` |
| `workflowActionHonesty.test.ts` (extended) | run outcomes | a paused-org run parks as `waiting` with `resumeState.reason:"paused"`, never `completed` | mark it completed |
| `paxSupportNoPricing.test.ts` | `executeSupportTool` | `apply_credit` is unreachable for the model at every stance and every pause state | re-enable the case |
| `constitution.test.ts` | new entries `ai.customer-sends-are-witnessed`, `ai.pause-covers-every-unattended-path`, `ai.one-pax-control-surface`, each `kind:"ratchet-test"` pointing at the tests above | pointers resolve; unenforced-hard-stop baseline unchanged or lower | point one at a missing file |
| `pax-founder-gate.spec.ts:100` (REWRITE) | `/ai` tabs | assertion 2 becomes "Tasks tab ABSENT"; codename check kept | render the tab |
| `jobRosterCoverage.test.ts` | roster | `pax_ask_expiry` added; `autonomous_task_processor` removed | — |
| `founderFourDoors`, `sidebarHiddenRoutes`, `paxStaysAmbient` | unchanged | `/settings/pax` stays nested; no new destination | — |

---

## 8. Wave plan

**Wave 0 — foundation (one agent, merges first; everything else imports it).**
Files: `shared/pax-glossary.ts`, `shared/pax-controls.ts` (types, `OFFERED_STANCES`, `STANCE_RULINGS`, `UNATTENDED_PATHS`, `PARKED_STATES`, `ALWAYS_ASK_SUPPORT_TOOLS`, `PAX_TOOL_GROUPS`), `shared/schema.ts` (`pax_controls`, `pending_actions` columns), `shared/models/auth.ts` (narrowed `AutonomyPreferences`), `migrations/0248_pax_controls.sql`, `server/services/paxControls.ts`, `server/services/paxReceipts.ts`, `server/services/paxAskSummary.ts`, `server/services/paxAskExecutors.ts` (stub map), `server/services/paxPause.ts` (holder + glossary refusal), tests `paxStanceFailsClosed`, `paxControlsOffered`. Gate: `npm run check`, `lint:schema-migrate-mirror`, both tests green and mutation-probed.

**Wave 1 — six agents, exclusive file sets, parallel.**

| Agent | Exclusive files | Delivers |
|---|---|---|
| A kernel | `server/ai/tools.ts`, `server/ai/supportAgent.ts`, `server/ai/executive.ts` (origin on 4 call sites), `server/ai/vaService.ts`, `server/services/approvalKernel.ts`, `server/services/autonomyGuardrails.ts`, `server/services/agent-skills.ts`, tests `paxStanceIsRead`, `paxReceiptsAreComplete`, `paxPauseToolGate` (extended), `paxWitnessedSend`, `paxSupportNoPricing`, `paxAsksAreExecutable` | §4.3, receipts hook, dead-branch deletion, `draft_offer` off the allowlist, VA stubs refuse |
| B engines | `sequenceProcessor.ts`, `workflow-engine.ts`, `leadCampaignJobs.ts`, `leadNurturer.ts`, `financeAgent.ts`, `paxScheduler.ts`, `task-runner.ts`, `paxNudges.ts`, `alerting.ts`, `jobs/runScheduledJobs.ts` (expiry sweep registration), `jobs/jobRegistry.ts`, delete `jobs/autonomousTaskProcessor.ts`, tests `paxPauseCoversEveryUnattendedPath`, `financeLadderAsksThroughKernel`, `workflowActionHonesty` (extended), `jobRosterCoverage` | §4.4 rows, ladder as kernel rows, expiry sweep |
| C routes | new `server/routes-pax-controls.ts` (`GET /api/pax/controls`, `POST pause`, `POST resume`, `PATCH controls`, `GET receipts`), `routes-pax-insights.ts` (needs-you, count, revise, approve switch, delete first-follow-up), delete `routes-autonomy.ts` + `services/paxDraftService.ts`, `routes-organization.ts`, `routes-ai.ts`, `routes-autonomous-agent.ts`, `routes-communications.ts`, `routes-today.ts`, `routes-ai-draft.ts`, `routes.ts` mounts, `storage.ts`/`storage/orgRepo.ts`, `services/notificationPreferences.ts`, `services/notificationDispatcher.ts`, `services/digest.ts`, `server/websocket.ts` (if needed), tests `paxAsksAreReachable` (server half), `needsYouCountIsComplete`, `paxReviseRace` | §4.5 API, §4.6 API, founder gates, digest |
| D Pax page | `client/src/pages/settings/pax-controls.tsx`, delete `settings/autopilot-setup.tsx`, `settings/autonomy-panel.tsx`, `ai-settings.tsx`, `pax-tasks-settings-tab.tsx`, `workflows-settings-tab.tsx` mount, `pages/settings.tsx`, `settings/SettingsQuickFind.tsx`, `settings/ByokSettings.tsx` mount, `provider-settings.tsx`, `mobile/MobileCommandDrawer.tsx`, `workflow-builder.tsx` (panel removal), `pages/workflows.tsx` toast | §3a, §3d client half |
| E queue UI | new `components/pax/PaxAskCard.tsx`, `pax-copilot-rail.tsx`, `pages/command-center.tsx`, `pax/pax-overflow-menu.tsx`, `layout-sidebar.tsx`, `mobile/MobileBottomNav.tsx`, `pages/today.tsx`, `today/DecisionQueue.tsx`, `lib/nav-items.ts`, `pages/activity.tsx`, `pages/pax.tsx`, `pax/pax-disclosure-rail.tsx`, `tests/e2e-mobile/pax-founder-gate.spec.ts`, new `tests/e2e-mobile/pax-ask-mobile.spec.ts` | §3b, §3c, §4.5 surfaces |
| F copy, first-run, governance | `pages/landing/{FAQ,DayInLife,Agents,ProductShots}.tsx`, `landing/copy.ts`, `onboarding/AiDisclosureDialog.tsx` (v2), `pages/onboarding-v2.tsx`, `pages/privacy.tsx`, `pages/inbox.tsx`, `pages/tasks.tsx`, `shared/governance/constitution.ts` + `constitution.test.ts`, new `paxControlsSurfaceIsHonest.test.ts`, `docs/company/deletion-ledger.md`, `docs/company/founder-decision-2026-09-xx-pax-controls.md` (records the stance rulings), `scripts/no-fabrication.allowlist.json` if needed | §6, §1 first-run, constitution entries |

Interfaces frozen by wave 0 so A–F never touch each other's files: `getPaxControls`, `recordPaxEffect`, `summarizeAsk`, the executor map, the glossary exports, and the route contracts (`/api/pax/controls|pause|resume|needs-you|needs-you/count|pending-actions/:id/revise|receipts`).

**Central verification (one person, after all six report):**
1. `npm run check`, `npm test`, `npm run build` — a green agent report is a hypothesis.
2. Mutation probes from §7, each run by hand: delete the stance read in `executeSupportTool`; remove the pause read in `sequenceProcessor`; append `"on_its_own"` to `OFFERED_STANCES`; delete the `/ai` `pending_action` branch; remove `proposePendingAction` beside the ladder parking; put `draft_offer` back on `PAUSE_SAFE_TOOLS`; type "autopilot" into a customer component. Each must go red.
3. Built-but-unwired hunt: grep every new export (`getPaxControls`, `recordPaxEffect`, `summarizeAsk`, `EXECUTORS`, `pax.needs_you`) for call sites; confirm `routes-pax-controls.ts` is mounted; confirm the sweep has a `withJobLock` AND a roster entry; confirm the migration file exists in the same commit as the schema change.
4. End-to-end pause: pause an org → enroll a sequence, fire a live workflow event, run the nurturer, run a scheduled prompt, run the ladder — zero sends, every deferral logged; resume → deferred steps meter.
5. End-to-end stance: set strict → chat "mark Bill hot" → card appears inline → Approve → receipt row in `activity_log`; scheduled prompt run summary reports "N waiting".
6. Wired-but-deleted check: founder pages reading `agent_tasks`/`vaAgents` still render (or are handed to the founder lane with an issue opened in the same PR).
7. Independent completeness audit by a fresh agent that built nothing, treating every wave claim as a hypothesis, before the single PR merges.

**Wave 2 (after wave 1 merges):** inbound-reply draft lane (SMS + email) and `lead.created` intro draft (`smsService.ts`, `inboundEmailService.ts`, `routes-misc.ts:330`); `leads.paxMuted` + `canSendViaChannel` + nurturer; `send_direct_mail` and `enroll_lead_in_sequence` tools; conversation-signal CRM moves; template-install honesty (show each `send_email` step's text, record "I've read what this sends"); `pax_drafts` and `pax_autonomy_level` drop migrations. **Wave 3:** revert route for reversible kinds (status/stage revert, task reopen, archive-never-delete) and only then the word "Undo".

---

## 9. Founder questions (picker; recommended option first)

1. **Pax-written messages — ever unattended?** (a) **No — every message Pax writes waits for a tap, at every stance, until you rescind this in a dated ruling [recommended; matches the standing posture; the `OFFERED_STANCES` lever exists so a future yes is one ruling + one row]**; (b) Yes, for enumerated low-risk categories (acknowledgements, scheduling confirmations) after N consecutive approvals with zero edits; (c) Yes, per campaign like REsimpli.
2. **Two-way seller conversations by text/email.** (a) **Ship draft-and-wait: Pax drafts every reply within the queue, the customer taps, from their own number — Carrot's shipped default [recommended; inside the posture]**; (b) Let Pax reply unattended within rules you set (rescinds the posture for conversations); (c) Claim nothing about conversations.
3. **Borrower payment reminders.** (a) **Prepare only; each rung waits for a tap; the customer can switch preparation off [recommended]**; (b) Allow unattended "upcoming"/"due" rungs only, "late"/"final" always ask; (c) Allow all rungs unattended.
4. **"Ask before everything" and the customer's own chat commands.** (a) **Everything waits, including what they type — one uniform sentence, the card is inline and one tap [recommended]**; (b) Chat commands are exempt (adds "on its own" vs "when you ask" to the customer's vocabulary; the `origin` field makes it a one-line predicate change).
5. **Default stance for new orgs.** (a) **Ask before sending — today's behaviour, nothing changes silently on deploy [recommended]**; (b) Ask before everything for new orgs (existing orgs keep default).
6. **Pause durations offered.** (a) **Tomorrow 8 am / 3 days / until I resume (30-day safety lift) [recommended; a Friday pause survives the weekend]**; (b) Keep fixed 24 h; (c) Fixed 7 days.
7. **Customer "Tasks / Deploy Agent" tab and the no-UI autonomy APIs.** (a) **Delete the customer tab and processor; founder-gate `PUT /api/autonomous/agents/:type/config`, VA PATCH, `POST /api/scheduled-tasks`; delete `process-autonomous`; hand the founder readers to the founder lane [recommended]**; (b) Keep the tab and make it real (a new engine with no revenue trigger).
8. **Support billing fixes in the customer's picture.** (a) **Retry payment / update method / resync / reset preferences become kernel asks at every stance; `apply_credit` is model-unreachable and routes to you (pricing hard-stop) [recommended]**; (b) Keep them model-decided and delete the "Requires customer confirmation" sentence.
9. **Where the page lives.** (a) **Keep `/settings/pax` nested, first card in the bucket renamed "Pax & connections", 7 tabs unchanged, absorbed as-is by the queued 7→4 regroup [recommended]**; (b) An 8th Settings tab "Pax" (collides with the regroup and Robert's tab-count evidence).
10. **Voice.** (a) **Remove the AI-Ops "Voice — Ready" badge and every voice mention; claim nothing [recommended]**; (b) Keep a "coming soon" tease (fails no-fabrication).
---

## Wave 0 handoff (2026-09-02) — seams named for wave 1

Wave 0 shipped `shared/pax-glossary.ts`, `shared/pax-controls.ts` (OFFERED_STANCES, STANCE_RULINGS, PAX_TOOL_GROUPS over all 57 executeTool + 74 executeSupportTool labels, UNATTENDED_PATHS ×14, PARKED_STATES, ALWAYS_ASK_SUPPORT_TOOLS), `organizations.pax_controls` jsonb + `pending_actions.origin/sourceRef/reason` (migrate.mjs **0250**, mirror `migrations/0250_pax_controls.sql`), `server/services/paxControls.ts` (fail-closed to `ask_before_everything` + paused on any unreadable state), `paxReceipts.ts` (attributed `activity_log` writer), `paxAskSummary.ts`, `paxAskExecutors.ts` (one rail per tool name), four tests (53 cases, 10 mutation probes red). Head-start work already in tree: review-queue list/count/sweep + `pending_action.created` broadcast + daily expiry job (verified: 15/15, own probe 10-red), and the pause-coverage extension (agent pending).

Seams wave 1 MUST close (each is a named residue until then):

1. **A (kernel):** `executeSupportTool` has no `options` param — add `options?: ExecuteToolOptions` + the ALWAYS_ASK predicate, and pass `{ trustedApproval: true, origin: "approval_replay" }` from `paxAskExecutors`, or approved support asks re-freeze. Add `origin` to `ExecuteToolOptions` (already passed via a wider-typed variable). Retire `getOrgAutonomyLevel`/`autonomyLevelFailsClosed.test.ts` with the dead branches. Ship `paxSupportNoPricing.test.ts` and append the Never-list pricing line.
2. **B (engines):** borrower ladder replay reads `noteId` from `args`/`sourceRef` (`sendManualReminder(noteId, orgId, type)` is the real signature) — freeze `noteId` on the row when parking. Extend the pause primitive with the holder and delete `resolvePauseHolder` from `paxControls.ts`.
3. **C (routes):** import `executeApprovedAsk` in `routes-pax-insights.ts` (approve route) — the reachability allowlist entries for `executeApprovedAsk` and `paxControlsRefusalMessage` are STAGED SEAMS that go stale (gate fails) the moment they are consumed; remove them in the same commit. Migrate the approve route's `pax_value_event` logActivity onto the executor's receipt.
4. **D (Pax page):** delete `settings.tsx:166` `useFlag("feature.autonomy-matrix")` then add the key to `RETIRED_FLAG_KEYS` (the migrate.mjs DELETE already exists).
5. **Cross-agent test fix:** `tests/unit/paxPauseCoverage.test.ts` (pause agent) must list `server/services/paxAskExecutors.ts` in `PAUSE_READ_ONLY_CONSUMERS` (it reads `getPaxControls` for receipt attribution only).
6. **Central verification note:** migrate.mjs 0250 rewrites `users.autonomy_preferences` (strips inert level/perAction/thresholdsCents/atlas/sophie/timeGuards, preserves `pax.pausedUntil`) — inert fields with no reader; within decision 9's scope; confirm again at commit.
7. **Pause-coverage divergences from §4.4 (adjudicate in wave 1 B):** the head-start implementation gates workflows PER ACTION (`ACTION_STATUS_BLOCKED`, run continues past the blocked step) rather than parking the run with `resumeAt = pausedUntil`; it keeps `autonomousTaskProcessor.ts` (per-batch skip, tasks stay pending and occupy BATCH_SIZE slots) rather than deleting it; and it adds `GET /api/me/autonomy/org-pause` (org state via per-route `getOrCreateOrg`) which overlaps the planned `GET /api/pax/controls`. Wave 1 B decides park-vs-block (park is the spec's intent so a paused rule resumes whole), deletes the processor per decision 7, and C folds `/org-pause` into `/api/pax/controls`. Two enumerations of the same population now exist — `UNATTENDED_PATHS` (shared/pax-controls.ts) and `PAUSE_ENFORCEMENT_POINTS` (tests/unit/paxPauseCoverage.test.ts) — derive one from the other in wave 1 so they cannot drift apart.
8. **Enforced today after wave 0 + head starts:** pause covers 11 points (tools, supportAgent, paxScheduler, autonomousDecisionExecutor, financeAgent, workflow-engine, sequenceProcessor, leadNurturer, autonomousTaskProcessor, agent-skills, task-runner); the ask queue has list/count/sweep + org broadcast; the stance is STORED and readable (`getPaxControls`) but NOT YET READ by the kernel or engines — that is wave 1 A/B's first job, and until then the customer-facing stance control must not ship (D waits for A/B in the same PR).

## Wave 1 status (2026-09-02) — copy, first-run, governance (agent F)

What F verified against the tree, with the gate that keeps it true. Every
claim below was checked by running the named test or script, not by reading
a report.

**§6 copy (F's rows) — every replacement landed verbatim.** `FAQ.tsx`
"Can the AI assistant be turned off?" → the Pause / ask / never-sends
sentence (the same answer also lost "a VA can't see financials" → "a
teammate", and the unsourced "in 4 minutes" — a number with no backing row
is a fabrication, and the FAQ is now in the public-claim audit). `DayInLife.tsx`
:32/:34/:37 (the "37 servicing receipts" number is gone; "3 calls placed from
the lead queue" lost its duplicate tail so the spec sentence reads once).
`Agents.tsx:84` "2 (waiting for your tap)"; `:51` "voicemail replies" →
"voicemail scripts" (the real `draft_message` messageType, `tools.ts:634` —
decision 10's voice rule, applied as a tightening not a deletion).
`ProductShots.tsx:111`; `copy.ts:168/:181`; `inbox.tsx` empty state;
`tasks.tsx` empty state + tip; `privacy.tsx` renders `PAX_CONTROLS_LABEL`;
`onboarding-v2.tsx:1066/:1247` append "You'll approve before anything goes
out." Pinned by `scripts/audit-public-claims.ts` liveness anchors for the two
FAQ sentences (14 verified / 0 unverified / 0 structural failures) and by
`paxControlsSurfaceIsHonest.test.ts` for the vocabulary.

**§1 first-run disclosure v2.** `AiDisclosureDialog.tsx`: `AI_DISCLOSURE_VERSION`
`"v1"` → `"v2"`; body = `PAX_LABELS.mentalModel` (three sentences) +
`PAX_LABELS.youStartOn`, nothing typed inline; buttons "Got it" / "See what
Pax may do" (→ `PAX_CONTROLS_PATH` after consent is recorded). Every existing
user sees it exactly once: a new `AiDisclosureGate` (same file) is mounted in
`App.tsx`'s authenticated shell and renders the dialog when the stored
version ≠ current; the onboarding page keeps its own instance for new
signups and the gate stands down on `/onboarding-v2`. The founder is skipped
by design (the consumer's consent record; the founder plane is out of
scope). Consent stays `users.ai_disclosed_at + ai_disclosure_version`
(`routes-ai-disclosure.ts` accept route, unchanged). `critical-path-render.test.ts`
now pins `"v2"`.

**§3c Inbox chip.** `inbox.tsx` renders one pinned pointer from
`usePaxNeedsYouCount()` → `/ai`; it renders nothing until the count is a
number above zero, and it says "N waiting for your tap → Pax" (the queue
label) rather than "N drafts" because under *Ask before everything* a record
change waits there too — the chip must not call a thing a draft it did not
read.

**§7 constitution.** `ai.customer-sends-are-witnessed` →
`paxWitnessedSend.test.ts` (+ `paxControlsOffered.test.ts`),
`ai.pause-covers-every-unattended-path` → `paxPauseCoverage.test.ts`,
`ai.one-pax-control-surface` → `paxControlsSurfaceIsHonest.test.ts`, each
`kind: "ratchet-test"`; `constitution.test.ts` 36/36 green, unenforced
hard-stop baseline unchanged at 0 (no prose-only hard-stop became enforced
this wave, so it is not lowered), and a new block pins the three ids to
their gates. Probe: repointing one entry at a missing file → red.

**§7 `paxControlsSurfaceIsHonest.test.ts` (new).** Population =
`client/src/pages/**` + `client/src/components/**` (+ `pages/landing/**`
counted on its own), 556 files parsed with the TypeScript compiler, ~5,000+
customer strings (JSX text, literals, template text; identifiers, comments,
imports, types, class/testid/route attributes and class lists excluded).
Founder context is derived (founder dirs, `Founder*` files, pages App.tsx
routes only through `FounderProtectedRoute`, `isFounder &&` branches,
`founderOnly: true` objects, `founder:` keys, founder-named components, the
reviewed eslint founder marker). Checks: §2 banned list in its AUTONOMY
sense (44 entries, each with a planted sample that must match); "what Pause
stops" imported from `UNATTENDED_PATHS` and filtered on `pauseStops`; no
stance/pause/standing/mental-model string typed inline outside the glossary;
"Settings → Pax controls" / "Pax > Controls" in no string literal under
client/server/shared; `PAX_CONTROLS_PATH` is nested and routed in `App.tsx`
to the lazy pax-controls page through `ProtectedRoute`; per-directory
vacuity against an independent recursive listing. Probes run and reverted:
`"PROBE: Ask before sending"` literal in `tasks.tsx` → red (stance check);
`<span>PROBE Full autopilot mode</span>` → red (banned-word check). Domain
senses deliberately outside the ban (each a full phrase, none a bare word):
real-estate/listing/licensed agent, "broker or agent", agent-investor,
agents' commissions, legal "contractors, agents", probate executor, ACH
trace; the skip-trace feature's own verb inside `skip-trac*` files; the
commissions surface's "agent". Narrowed to the defect: threshold/matrix
(autonomy sense), assisted/supervised (whole-string labels), Override (over
a Pax decision), envelope (kernel sense), VA (Pax-as-VA), confidence %
(not the AVM's own column), Insights (whole-string label).

**Current state of the banned-word scan: RED on 81 hits in 19 files, none
in F's files, none allowlisted.** The gate is not weakened to pass; the
central verifier routes each:

- `client/src/pages/command-center.tsx` (E) — 31 hits: the VA-agent roster
  view (`/ai#agents`): "Agent Roster", "No VA agents yet", "Autonomy Level",
  "Supervised", "Agent acts without approval", "Background agents" (:240–:880,
  :1929). Decision 7 founder-gated the APIs; the customer UI still renders.
- `client/src/components/pax-copilot-rail.tsx` (E) — 7: "Pax copilot" /
  "Pax Co-Pilot" / "Pax is your AI co-pilot" (:1119, :1172, :1184, :1193, :1548).
- `client/src/components/pax/pax-overflow-menu.tsx` (E) — 3: `SHEET_META.agents`
  "Agents" / "The agent roster working behind Pax." / "Open Agent Queue"
  (:79–:82) — the entry is founder-only in use but the map is not
  founder-marked; move it under an `isFounder` branch or mark the lines.
- `client/src/components/workflow-builder.tsx` (D) — 1: "Agent skill" (:364).
- `client/src/pages/finance.tsx` (9), `pages/dunning-manager.tsx` (7),
  `pages/notes.tsx:552` (1) — unowned: the pre-existing "Dunning" feature
  vocabulary on the Finance door. Needs a product decision (rename to
  "Late-payment follow-up" or a founder ruling narrowing "dunning" to Pax
  surfaces); not a wave-1 file.
- `client/src/components/help-content.tsx` (5) — unowned help-centre copy:
  "AI Agents", "How do AI Agents work?", "AI agents & smart workflows"
  (:88, :118, :119, :171).
- `client/src/pages/decision-queue.tsx` (3) — unowned (`/admin/decisions`,
  ProtectedRoute): "open the full AI hub" (:239, :550, :552).
- `client/src/pages/landing.tsx:62, :75` — unowned public meta description:
  "…with AI agents that act on your behalf." A public claim in banned words.
- `client/src/pages/compare/ComparisonPage.tsx:133, :193` — unowned public
  compare pages: "An autopilot, not just a database."
- `client/src/pages/landing/Features.tsx:31` "Every agent action…";
  `landing/Quotes.tsx:43` "…attributed to operator or agent." — landing
  files outside F's set.
- `client/src/components/pax-memory-panel.tsx:57, :61` — "Insights" as a
  tab label on a Pax surface (unowned).
- `client/src/pages/analytics.tsx:53` — page title "Insights" (unowned;
  its nav label is Analytics).
- `client/src/components/monthly-checkin.tsx:200, :215` — "Dunning",
  "Autonomous Actions"; the component has ZERO importers (dead) — delete.
- `client/src/pages/security.tsx:75` "(Pax / agent runtime)";
  `client/src/pages/terms.tsx:134` "AI executive team" (legal copy —
  counsel/founder); `client/src/components/error-boundary.tsx:174` "Trace"
  (stack-trace toggle label).

**§3d deletions** are ledgered in `docs/company/deletion-ledger.md` ("Pax
controls program — wave 1 deletions"), one row per prescribed deletion with
the executing agent and what the working tree showed.

**Public-claim audit population.** `scripts/audit-public-claims.ts` now
reads FAQ, Agents, DayInLife and ProductShots (11 landing files; vacuity
floor raised 5 → 9), carries the two FAQ sentences as claims backed by a
source that names the kernel, the pause route and their ratchets, and
exempts — with dated reasons — the labelled example-frame figures ($31, $15,
$16, $11) and the BEFORE-column "90 minutes". `audit-learn-pages.ts` scans
`content/learn/**` JSON, not landing sections — no change needed.
