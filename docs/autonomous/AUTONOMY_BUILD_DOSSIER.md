# Autonomy build dossier — enforcement insertion points

**Generated 2026-09-02 by a read-only engineering agent (153 tool uses) for the customer autonomy clarity program (founder directive 2026-09-02). Facts only; line numbers as of `0876d29c`. Re-verify lines before editing — this is a map, not a substitute for reading the code.**

# Engineering dossier — three enforcement hooks (customer-autonomy build)

All paths are under `/home/user/AcreOS`. Line numbers are from the working tree at HEAD as of this session. Facts only; no design recommendations.

---

## 0. The shared primitive: `getPaxPauseState`

`server/services/paxPause.ts`

```ts
// :39-54
export interface PaxPauseState {
  paused: boolean;            // true while any org user holds a future pax.pausedUntil (or the check failed)
  pausedUntil: Date | null;   // latest active expiry; null when not paused OR when checkFailed
  checkFailed: boolean;       // DB read failed → callers must treat as paused (fail closed)
}
// :76
export async function getPaxPauseState(orgId: number): Promise<PaxPauseState>
// :115
export function paxPauseRefusalMessage(state: PaxPauseState): string
```

- Org-wide semantics: two selects (`:81-97`) — owner via `organizations.ownerId → users.id`, plus `teamMembers.userId` where `teamMembers.organizationId = orgId AND teamMembers.isActive = true`; `latestFuturePause` (`:56-70`) takes the max future `prefs.pax.pausedUntil`. Expiry is implicit (timestamp compare, no cron). Read failure returns `{ paused: true, pausedUntil: null, checkFailed: true }` (`:101-108`).
- The header comment `:11-23` enumerates the current enforcement points ("the five enforcement points"); that prose list is not test-derived.
- Existing gate shapes to copy from (all already org-scoped):
  - `server/ai/tools.ts:1089-1102` — `if (!trustedApproval && !PAUSE_SAFE_TOOLS.has(toolName)) { const pause = await getPaxPauseState(org.id); if (pause.paused) { logger.info(...); return { success: false, error: paxPauseRefusalMessage(pause) }; } }`
  - `server/ai/supportAgent.ts:1316-1332` — identical shape over `PAUSE_SAFE_SUPPORT_TOOLS` (`:1222`).
  - `server/services/paxScheduler.ts:215-233` — skip + reschedule (quoted in §2b).
  - `server/services/autonomousDecisionExecutor.ts:905-932` — defers the inbox item: `status: "deferred", deferredUntil: resumeAt` with `resumeAt = pause.pausedUntil ?? new Date(Date.now() + 4h)`, `result.executedAction = "skipped_pax_paused"`.
  - `server/services/financeAgent.ts:498-502` — `finish(REMINDER_STATUS.queued, paxPauseRefusalMessage(pause))`.
- Tests that mock it (a new gate in a module these tests import will fail closed unless the mock is present): `tests/unit/paxPauseToolGate.test.ts:28-82`, `tests/unit/tenantBoundaryTaskTools.test.ts:23-62`, `tests/unit/paxToolScopeAndFcra.test.ts:41-64`, `tests/unit/leadEventEmission.test.ts:286-289` (`getPaxPauseState: async () => ({ paused: false, pausedUntil: null, checkFailed: false })` — this one already covers the workflow-engine emitter path). `tests/unit/paxPauseSupportGate.test.ts` is the population-first pattern (every switch case classified as PAUSE_SAFE or GATED, `:37-59`). `shared/governance/constitution.ts` has no entry referencing `paxPause`/`pausedUntil`/`pending_actions` (grep: none).

---

## 1. PAUSE COVERAGE — insertion points

### 1a. `server/services/workflow-engine.ts` — org context EXISTS

**Which function runs a step.** The shared loop is `runActionsFrom` (private), called by both fresh runs and post-delay resumes:

```ts
// :2122-2128
private async runActionsFrom(
  run: WorkflowRun,
  workflow: Workflow,
  context: WorkflowExecutionContext,
  executionLog: WorkflowExecutionLogEntry[],
  startIndex: number,
): Promise<WorkflowRun>
// :2130  for (let i = startIndex; i < workflow.actions.length; i++) { const action = workflow.actions[i]; ...
// :2142  if (action.type === "delay") { parkOrSleep ... continue; }
// :2150  const result = await this.executeAction(action, context);
```

Per-action dispatch:

```ts
// :2306-2309
async executeAction(
  action: WorkflowAction,
  context: WorkflowExecutionContext
): Promise<Record<string, any> | void> {
  switch (action.type as WorkflowActionType | "conditional") {   // :2312
    case "send_email":       return this.executeSendEmail(action, context);      // :2313
    case "create_task":      return this.executeCreateTask(action, context);
    case "update_record":    return this.executeUpdateRecord(action, context);
    case "run_agent_skill":  return this.executeRunAgentSkill(action, context);  // :2319
    case "send_notification":return this.executeSendNotification(action, context);
    case "delay":            return this.executeNestedDelay(action);
    case "conditional": { ... for (const branchAction of branchActions) await this.executeAction(branchAction, context); }  // :2328-2352 (recursive)
```

`WORKFLOW_ACTION_TYPES` = `["send_email","create_task","update_record","run_agent_skill","send_notification","delay"]` (`shared/schema.ts:9303-9310`). `WorkflowAction.config` fields at `shared/schema.ts:9325-9352`.

**Where org id is in scope.**

```ts
// :2762-2772 (module-private)
type WorkflowExecutionContext = {
  organizationId: number;
  triggerData: { event: WorkflowTriggerEvent; entityId?: number; entityType?: string; data?: Record<string, any>; previousData?: Record<string, any> };
  variables: Record<string, any>;
};
```
Populated at `:2031-2035` (`organizationId: workflow.organizationId`, fresh run in `executeWorkflow(workflow, triggerData)` `:2007-2038`) and `:2098-2102` (`workflowRow.organizationId`, in `resumeWorkflowRun` `:2047-2115`). `workflows.organizationId` is `notNull` (`shared/schema.ts:9382`). Entry callers of `executeWorkflow`: `triggerWorkflows` `:1958` (event path via `emit`/`processQueue` `:1925-1948`), `server/services/task-runner.ts:175` (scheduled), `resumeDueWorkflowRuns` `:2272-2304` (delay-resume job).

**What a non-executing outcome looks like in the run log.** There is no "skipped-by-policy" status today; the two non-executing statuses are:

```ts
// :51-52
export const ACTION_STATUS_UNAVAILABLE = "unavailable" as const;
export const ACTION_STATUS_BLOCKED = "blocked" as const;
// :54-66
export type ActionUnavailableResult = { status: typeof ACTION_STATUS_UNAVAILABLE; reason: string; [key: string]: unknown };
export type ActionBlockedResult     = { status: typeof ACTION_STATUS_BLOCKED;     reason: string; [key: string]: unknown };
// :89-93
export function isNonExecutingActionResult(result: unknown): result is ActionUnavailableResult | ActionBlockedResult
```

The loop records them at `:2151-2162`: `(executionLog[i] as { status: string }).status = result.status; executionLog[i].completedAt = ...; executionLog[i].result = result;` and does NOT merge into `context.variables`. A thrown error → `status = "failed"`, all later entries `status = "skipped"` (`:2172-2188`), run `status: "failed"`. The frozen shared log-entry union is `"pending" | "running" | "completed" | "failed" | "skipped"` (`shared/schema.ts:9401-9409`) — `"unavailable"`/`"blocked"`/`"waiting"` are written via local cast (`TODO(tsc)` at `:2157-2160`, `:2239-2241`). Run-level statuses: `WORKFLOW_RUN_STATUSES = ["pending","running","waiting","completed","failed"]` (`shared/schema.ts:9360`). Blocked example returned by `executeSendEmail`: `:2410-2416` — `{ status: ACTION_STATUS_BLOCKED, emailSent: false, emailTo: to, reason: "No email sent: ... The workflow continued with its remaining steps." }`.

**Send handlers.** `executeSendEmail(action, context): Promise<{ emailSent: boolean; messageId?: string; emailTo: string } | ActionUnavailableResult | ActionBlockedResult>` `:2381-2464`; consent gate `:2405-2416`; `emailService.sendEmail({ ..., organizationId: context.organizationId, purpose: "counterparty" })` `:2419-2427`; `configuration_error → unavailable` `:2438-2449`; `recipient_rejected → blocked` `:2453-2461`; else throw. `executeRunAgentSkill(action, context)` `:2584-2647` → `skillRegistry.executeSkill(resolvedId, params, { organizationId: context.organizationId, relatedLeadId/PropertyId/DealId })` `:2625-2633`; `!result.success` throws `:2635-2638`.

**Test residue to check before adding another `status: ACTION_STATUS_UNAVAILABLE` literal:** `tests/unit/workflowActionHonesty.test.ts:398` counts occurrences of that literal in the engine source (`ENGINE_SOURCE.match(/status: ACTION_STATUS_UNAVAILABLE/g)`).

### 1b. `server/services/sequenceProcessor.ts` — org context EXISTS (from the joined row)

Dispatch loop: `processEnrollments()` `:92-139` → for each `enrollment` (`:113-125`) `await this.processEnrollment(enrollment)` → `sendStep(enrollment, step)` `:314`.

```ts
// :18
type EnrollmentWithDetails = SequenceEnrollment & { sequence: CampaignSequence; lead: Lead };
// :141
async processEnrollment(enrollment: EnrollmentWithDetails)
// :314
async sendStep(enrollment: EnrollmentWithDetails, step: SequenceStep): Promise<StepSendResult>
// :27-34
export type StepSendStatus = "sent" | "skipped" | "deferred" | "failed";
export interface StepSendResult { status: StepSendStatus; reason?: string; retryAt?: Date; }
```

- Org id before sending: `enrollment.sequence.organizationId` (`campaign_sequences.organization_id` notNull, `shared/schema.ts:5076`; already used at `:248`, `:257`) and `enrollment.lead.organizationId` (used at `:341`, `:555`, `:621`). `sequence_enrollments` has NO `organizationId` column (`shared/schema.ts:5108-5121`; `server/storage/sequencesRepo.ts:180-181`). The join is `getEnrollmentsDueForProcessing` `server/storage/sequencesRepo.ts:154-172`.
- Gate order (comment `:303-309`): 1 consent `:318-324`, 2 quiet hours `:330-338`, 3 frequency cap `:340-358`; the first pre-send line inside `sendStep` is `:315 const lead = enrollment.lead;`. In `processEnrollment`, the last pre-send decision is `:179 const shouldSend = await this.evaluateCondition(enrollment, nextStep);`.
- How a skip is logged: `recordStepSkip(enrollment, step, reason, status: Exclude<StepSendStatus,"sent"> = "deferred")` `:439-464` inserts a `campaignDeliveryEvents` row `{ campaignId, leadId, channel, status, sentAt: null, statusUpdatedAt, metadata: { enrollmentId, stepNumber, skipReason } }` — only when `lead.sourceCampaignId || lead.campaignId` exists (`:446-447`). Plus `logger.info("[sequence-processor] Step not sent", ...)` `:385-387`.
- Outcome semantics in the caller `:188-203`: `"deferred"` does NOT consume the step — `currentStep` unchanged, `nextStepScheduledAt = clampRetryAt(outcome.retryAt)` (floor `MIN_DEFER_MS = 15min`, `:44`, `:292-298`). `"skipped"`/`"failed"` advance `currentStep` without stamping `lastStepSentAt` (`:205-216`).
- Cadence: self-rescheduling every 60s under job lock (`:36-37`, `:58-81`); crash cursor reset `:133`.

### 1c. `server/services/leadNurturer.ts` — org context EXISTS (parameter)

Per-org loop lives in the job, not the service: `server/jobs/leadCampaignJobs.ts:19-44`:
```ts
const activeOrgs = await db.select({ id: organizations.id }).from(organizations).where(sql`${organizations.subscriptionStatus} = 'active'`).limit(100);
for (const org of activeOrgs) { const result = await leadNurturerService.processLeadsForOrg(org.id, { scoringLimit: 20, generateFollowUps: false }); ... }
```
(every 15 min under `withJobLock('lead_nurturing', 14*60, ...)` `:56-70`; kill switch `LEAD_NURTURING_AI_DISABLED=1` `:51`.) This is the only production caller (grep).

```ts
// :257-267
async processLeadsForOrg(
  organizationId: number,
  options: { scoringLimit?: number; generateFollowUps?: boolean; checkAging?: boolean } = {}
): Promise<{ scored: number; followUpsScheduled: number; followUpsGenerated: number; creditsUsed: number; agingAlertsCreated: number; errors: string[] }>
// :268  const JOB_TYPE = `lead_nurturing_${organizationId}`;
// :280  await storage.setJobStatus(JOB_TYPE, 'running');
```
Side effects inside: `scoreLead` (DB writes to `leads.score/nurturingStage`) `:241-255`, `scheduleFollowUp` (`leads.nextFollowUpAt`) `:215-225`, `storage.createLeadActivity` `:298-309`; when `generateFollowUps` is true: `usageMeteringService.recordUsage(organizationId, "ai_chat", 1, ...)` `:323-328` then `generateFollowUp` (LLM; writes `lastAIMessageAt`, `ai_followup_generated` activity `:343-361`) — no outbound send anywhere in this file. `checkAging` → `alertingService.checkLeadAging(organizationId)` `:375-382`. The result shape has no `skipped` field; refusals today surface only via `errors[]` and `setJobStatus`.

### 1d. `server/jobs/autonomousTaskProcessor.ts` — org context EXISTS (`task.organizationId`)

```ts
// :271
async function processBatch(): Promise<{ processed: number; autoExecuted: number; escalated: number; failed: number }>
// :275-285  tasks = db.select().from(agentTasks).where(and(eq(agentTasks.status,"pending"), eq(agentTasks.requiresReview,false))).orderBy(agentTasks.priority, agentTasks.createdAt).limit(BATCH_SIZE /*10, :28*/)
// :287  for (const task of tasks) {
// :291-293  const input = task.input as Record<string, any>; const agentType = task.agentType as CoreAgentType; const riskProfile = _inferRiskProfile(agentType, input);
// :296-300  const decision = await autonomousAgentEngine.evaluate(task.organizationId, agentType, riskProfile);
// :302-313  deny   → update agentTasks { status: "cancelled", error: `Denied by autonomy engine: ${decision.reason}`, completedAt }
// :315-326  escalate → update { requiresReview: true, status: "pending" }
// :328-346  AUTO EXECUTE → update { status: "processing", startedAt }; executeAgentTask(agentType, { action: input.action, parameters, context: { organizationId: task.organizationId, userId: "autonomous_agent", relatedLeadId/PropertyId/DealId } })
// :350-361  update { status: result.success ? "completed" : "failed", output, error, completedAt, executionTimeMs, requiresReview: !!result.requiresApproval }
```
- Per-task execute point: `:336` (`executeAgentTask`, `server/services/core-agents.ts:1021-1044`; `execute_skill` → `agent.executeSkill` `:127-136` → `skillRegistry.executeSkill`).
- `agent_tasks.organization_id` is `notNull` (`shared/schema.ts:1942`); status vocabulary comment `:1947-1948`: `pending, queued, processing, completed, failed, cancelled` — no deferred/skipped status. `requiresReview/reviewedBy/reviewedAt/reviewNotes` at `:1967-1970`. A row left `pending` with `requiresReview=false` is re-selected every 30s (`RUN_INTERVAL_MS`, `:27`; scheduler `:470-481`) and counts against `BATCH_SIZE`.
- Vocabulary note: `autonomousAgentEngine.AutonomyLevel = "full_auto" | "supervised" | "manual"` (`server/services/autonomousAgentEngine.ts:21`), read per org+agent from `vaAgents.autonomyLevel` with default `"supervised"` (`:371-375`); this is a different scale from `autonomyGuardrails.AutonomyLevel = "assisted" | "supervised" | "autonomous"` (`server/services/autonomyGuardrails.ts:29`).

### 1e. `server/services/agent-skills.ts` — org context EXISTS (`context.organizationId`)

```ts
// :14-20
export interface AgentContext { organizationId: number; userId?: string; relatedLeadId?: number; relatedPropertyId?: number; relatedDealId?: number; }
// :22-28
export interface SkillResult { success: boolean; data?: any; message?: string; error?: string; costIncurred?: number; }
// :30-39  Skill { id; name; description; agentTypes; inputSchema: z.ZodSchema; execute(params, context); examples?; costEstimate?: "free"|"low"|"medium"|"high" }
// :2787-2823
async executeSkill(skillId: string, params: any, context: AgentContext): Promise<SkillResult> {
  const skill = this.skills.get(skillId);
  if (!skill) return { success: false, error: `Skill not found: ${skillId}` };        // :2792-2798
  try {
    const validatedParams = skill.inputSchema.parse(params);                          // :2801
    logger.info(`[SkillRegistry] Executing skill: ${skillId}`, { metadata: { detail: { context: { organizationId: context.organizationId } } } });
    const result = await skill.execute(validatedParams, context);                     // :2805
```
- Existing refusal shape at the skill level (precedent for a policy skip): `sendEmailSkill` `:303-314` returns `{ success: false, error: 'Autonomous email is not permitted at the "${autonomyLevel}" autonomy level — no send was made. ...' }` after `getOrgAutonomyLevel(context.organizationId)`.
- There is no side-effect classification inside `agent-skills.ts`; the only per-skill risk map is `SKILL_RISK` in `server/jobs/autonomousTaskProcessor.ts:53-103` (exported as `_SKILL_RISK` `:106`, drift-tested against `skillRegistry.getAllSkills()` per comment `:43-46`).
- Callers of `executeSkill`: `workflow-engine.ts:2625`, `task-runner.ts:195`, `core-agents.ts:135` (→ autonomousTaskProcessor and, per comment `:299-300`, companyAgents).

### 1f. `server/services/task-runner.ts` — EXISTS; org context EXISTS (`task.organizationId`)

```ts
// :248  async processScheduledTasks(): Promise<{ processed: number; succeeded: number; failed: number }>   // storage.getDueScheduledTasks(now) :250; runTask per task :258
// :87   async runTask(taskId: number): Promise<{ success: boolean; error?: string }>
// :93-95   if (task.status === "paused") { return { success: false, error: "Task is paused" }; }   // early return: nextRunAt NOT advanced
// :99-112  try { await this.executeTask(task); ... updateScheduledTask({ lastRunAt, nextRunAt: parseSchedule(task.schedule), retryCount: 0, lastError: null, status: "active" }) }
// :113-142 catch → retry bookkeeping (retryCount, lastError, nextRunAt = now + retryDelayMinutes; "failed" after maxRetries)
// :145  private async executeTask(task: ScheduledTask): Promise<void>  // switch task.type: "workflow" → executeWorkflowTask :161; "agent_skill" → executeAgentSkillTask :181; "custom" → executeCustomTask :214 (handlers only log)
// :195-205  skillRegistry.executeSkill(skillId, skillParams, { organizationId: task.organizationId, userId: skillParams.userId, ... })
```
`scheduled_tasks.organization_id` notNull (`shared/schema.ts:9459`); statuses via `ScheduledTaskStatus` (`:9472`). Cadence: every 60s under `withJobLock('scheduled_tasks', 55, ...)` (`server/jobs/runScheduledJobs.ts:298-329`). Note: a `{ success: false }` return from `runTask` is tallied as `failed` in `processScheduledTasks` (`:259-263`), and a return before the `try` leaves `nextRunAt` unchanged so the task is due again on the next tick.

---

## 2. STANCE READ POINTS

### 2a. Current storage shapes

**User-level — `users.autonomyPreferences`** (`shared/models/auth.ts:151`, `jsonb("autonomy_preferences").$type<AutonomyPreferences>()`):
```ts
// :45
export type AutonomyLevel = 0 | 1 | 2 | 3;
// :47-63
export interface AgentAutonomy { level?: AutonomyLevel; perAction?: Record<string, AutonomyLevel>; thresholdsCents?: Record<string, number>; pausedUntil?: string; }
// :118-127
export interface AutonomyPreferences { atlas?: AgentAutonomy; pax?: AgentAutonomy; sophie?: AgentAutonomy; timeGuards?: { pauseStartHour?: number; pauseEndHour?: number; dailyActionLimit?: number }; }
```
`perAction` and `thresholdsCents` are stored but have no server reader (grep for `autonomyPreferences` hits only `auth.ts`, `paxPause.ts`, `routes-autonomy.ts`, `pax-controls.tsx`, `paxPauseState.test.ts`).

**Route — `server/routes-autonomy.ts`**, mounted `app.use('/api/me/autonomy', isAuthenticated, autonomyRouter)` (`server/routes.ts:1546`) — no `getOrCreateOrg`, so `req.organization` is not populated here.
```ts
// :36-51  agentAutonomySchema = z.object({ level: 0|1|2|3, perAction: z.record(z.string().max(64), level), thresholdsCents: z.record(z.string().max(64), z.number().int().min(0).max(1_000_000_000)), pausedUntil: z.string().datetime() }).strict()
// :53-62  autonomySchema = z.object({ atlas?, pax?, sophie?, timeGuards?: {...}.strict() }).strict()
// :79-113 PATCH: validationFailed on parse error (:83-86); badRequest "Empty autonomy update" (:88-90);
//         const merged: AutonomyPreferences = { ...(current?.autonomyPreferences ?? {}), ...update };   // :98-101  SHALLOW, top-level keys only
//         db.update(users).set({ autonomyPreferences: merged, updatedAt }).where(eq(users.id, userId));  // :103-106
//         res.json(merged);
```
Consequence of the shallow merge: `PATCH { pax: { pausedUntil } }` replaces the whole `pax` object; the client preserves siblings itself — `client/src/pages/settings/pax-controls.tsx:131-136`: `apiRequest("PATCH", "/api/me/autonomy", { pax: { ...(autonomy?.pax ?? {}), pausedUntil: until } })`. Because both zod objects are `.strict()`, any new key (e.g., a per-capability map) is a 422 until added to the schema.

**Org-level — `organizations.paxAutonomyLevel`** (`shared/schema.ts:239`: `varchar("pax_autonomy_level", { length: 20 }).default("assisted") // assisted, supervised, autonomous`; DDL `scripts/migrate.mjs:2852`).
```ts
// server/services/autonomyGuardrails.ts:348-363
export async function getOrgAutonomyLevel(orgId: number): Promise<AutonomyLevel>   // db.query.organizations.findFirst({ columns: { paxAutonomyLevel: true } }); null → "assisted"; unknown value → warn + "assisted"
// :374-376
export function unattendedSendPermitted(level: AutonomyLevel): boolean { return level === "supervised" || level === "autonomous"; }
```
Readers: `server/ai/tools.ts:1950`, `server/services/agent-skills.ts:306`, `server/services/financeAgent.ts:510`, `server/services/autonomyGuardrails.ts:410`, `server/routes-pax-insights.ts:12` (import). Only writer in the repo: the circuit-breaker downgrade `autonomyGuardrails.ts:640-642` (`.set({ paxAutonomyLevel: "assisted", updatedAt })`). No route writes it; `client/src/pages/settings/pax-controls.tsx` reads only `/api/me/autonomy` (grep: no `paxAutonomyLevel`/`autonomyLevel` there).

Other org-level stores that already exist: `organizations.settings` jsonb with a typed `$type<{...}>` (`shared/schema.ts:~196-228`), written by merge at `server/routes-organization.ts:1636-1638` (`const merged = { ...(current?.settings ?? {}), ...parsed.data }` behind a `.strict()` allowlist `:1625-1630`; `tests/unit/orgSettingsMerge.test.ts` derives every writer from source and requires the spread). Per-org-per-agent config: `vaAgents.autonomyLevel` via `autonomousAgentEngine.setAutonomyLevel` (`:377-389`) and `PUT /api/autonomous/agents/:type/config` (`server/routes-autonomous-agent.ts:128`, router mounted at `/api/autonomous` `:453`).

### 2b. Where a stance would be READ

**Approval-kernel decision — the exact branch** (`server/ai/tools.ts`):
```ts
// :1017-1026
export interface ExecuteToolOptions { trustedApproval?: boolean; userId?: string; }
// :1029-1034
export async function executeTool(toolName: string, args: Record<string, any>, org: Organization, options?: ExecuteToolOptions): Promise<{ success: boolean; data?: any; error?: string }>
// :1045-1051  strip model-supplied `_approved`
// :1052       const trustedApproval = options?.trustedApproval === true;
// :1064-1072
if (kernelApprovalRequiredTools.has(toolName) && !trustedApproval) {
  const pending = await proposePendingAction({ organizationId: org.id, toolName, args, createdByUserId: options?.userId ?? null });
  return { success: true, data: pendingActionArtifact(pending) };
}
// :1089-1102  pause gate (after the kernel; bypassed by trustedApproval)
// :1128-1154  permission-ladder scope gate (NOT bypassed by trustedApproval)
// :1156+      FCRA gate
```
In scope at `:1064`: `toolName`, `args`, `org` (full `Organization` row incl. `org.paxAutonomyLevel`, `org.ownerId`), `options?.userId`, `trustedApproval`. `kernelApprovalRequiredTools` = `APPROVAL_REQUIRED_TOOLS` (`server/services/approvalKernel.ts:40-46`: `send_email, send_sms, send_gmail, send_slack_message, create_stripe_payment_link`; re-exported `tools.ts:941`). Per-tool second read: the `send_email` handler `:1950-1968` calls `getOrgAutonomyLevel(org.id)` and returns a draft artifact `{ draft: true, requiresApproval: true, ... }` when `!unattendedSendPermitted(level) && !trustedApproval` — observed control flow: for `send_email` this branch is only reached with `trustedApproval === true` (otherwise `:1064` already returned), so `:1952`'s `!trustedApproval` arm does not fire on that path. `PAUSE_SAFE_TOOLS` at `:960-1013`.

**Pax scheduler run entry** (`server/services/paxScheduler.ts`):
```ts
// :194  export async function processPaxScheduledTasks(): Promise<void>   // storage.getPaxScheduledTasksDue(now) :196
// :204  const org = await storage.getOrganization(task.organizationId);
// :215-233
const pause = await getPaxPauseState(org.id);
if (pause.paused) {
  const resumeAt = pause.pausedUntil ?? new Date(Date.now() + 15 * 60 * 1000);
  logger.info(`[pax-scheduler] Skipping task ${task.id} "${task.name}" — Pax is paused for org ${org.id}` + ...);
  await storage.updatePaxScheduledTask(task.id, { nextRunAt: resumeAt, lastRunStatus: "skipped_paused", lastRunSummary: pause.checkFailed ? "Skipped: could not verify ..." : `Skipped: Pax is paused until ...` });
  continue;
}
await executeTask(task, org);   // :235
// :124  export async function executeTask(task: PaxScheduledTask, org: Organization): Promise<void>  → processChat(task.prompt, org, task.userId, { agentRole: "executive", conversationId: undefined }) :135-140
```
`pax_scheduled_tasks`: `organizationId` notNull, `userId` text notNull, `lastRunStatus` free text (`shared/schema.ts:2562-2584`). Run history rows in `paxScheduledTaskRuns` (`:160-168`). Tool calls made during `processChat` flow through `executeTool` (and thus the kernel branch) with `userId = task.userId`.

**Workflow-engine send steps**: `executeSendEmail` `:2381` and `executeRunAgentSkill` `:2584` read no autonomy level today; the only stance read on that path is inside the `sendEmail` skill (`agent-skills.ts:306-314`). Org id: `context.organizationId`.

**Finance ladder dispatch** (`server/services/financeAgent.ts`):
```ts
// :445-460
async dispatchReminder(reminder: { id: number; organizationId: number; noteId: number; borrowerId: number | null; type: string; channel: string; content: string | null },
                       options: { humanApproved?: boolean } = {}): Promise<{ status: string; reason?: string }> {
  const orgId = reminder.organizationId;                                              // :461
  const finish = async (status: string, reason?: string, acceptedBy?: string) => { await storage.recordReminderOutcome(reminder.id, { status: status as ..., reason, acceptedBy }, orgId); ...log if !sent...; return { status, reason }; };  // :463-488
  ...note checks :490-496
  // Gate 1 :498-502  pause → finish(REMINDER_STATUS.queued, paxPauseRefusalMessage(pause))
  // Gate 2 :504-516
  const autonomy = await getOrgAutonomyLevel(orgId);
  if (!unattendedSendPermitted(autonomy) && !options.humanApproved) {
    return finish(REMINDER_STATUS.awaitingApproval, "Ready to send — your autonomy level is 'assisted', so Pax waits for your tap (Settings → Pax controls).");
  }
  // :519 letter → documentReady; :530 no sending identity → queued; :538 checkSendRateLimit → queued; :553-560 communicationsService.sendToLead(...)
```
`REMINDER_STATUS` `:96-106` (`awaitingApproval: "awaiting_approval"`). `storage.recordReminderOutcome`'s declared status union is `"sent"|"queued"|"unavailable"|"blocked"|"failed"|"cancelled"` (`server/storage/paymentRemindersRepo.ts:193-203`) — `awaiting_approval`/`document_ready` pass through the `as` cast at `:467`. Sweep: `dispatchDueReminders(limit = 50)` `:610-675` over `storage.getDispatchableReminders(limit, REMINDER_RETRY_WINDOW_DAYS)` `:629`, tally includes `awaitingApproval` `:647-649`. Human path: `sendManualReminder` → `dispatchReminder(..., { humanApproved: true })` `:870-878`, called from `server/routes-finance.ts:617` and `:789`. `payment_reminders` schema `shared/schema.ts:1736-1756` (`status` text, comment lists `scheduled, sent, failed, cancelled`).

### 2c. Org-level vs user-level — what the pause does

- Storage is per-user (`users.autonomyPreferences.pax.pausedUntil`); enforcement is org-wide by union over org owner + active team members (`paxPause.ts:80-100`; "any active pause pauses the org", latest expiry wins). There is no org column for the pause. `/api/me/autonomy` runs without org middleware; `req.organization` is available on routers mounted with `getOrCreateOrg` (`/api/pax` `routes.ts:1433`, `/api/autonomous` router, `routes-organization`).
- `organizations.paxAutonomyLevel` is the existing org-scoped stance column: single value, three-level string, read through `getOrgAutonomyLevel` with fail-safe parsing; no per-capability granularity; no customer writer.
- `AuthenticatedRequest` (`server/types/request.ts:10-16`): `{ user: User; organization: Organization; organizationId: number; permissionContext?; isFounder? }`; helpers `getOrganization`, `getUserId` (`:51-57`, returns `req.user.id` string), `getOrganizationId`.

---

## 3. REVIEW QUEUE

### 3a. `pending_actions` table

`shared/schema.ts:2665-2684` (DDL mirror `scripts/migrate.mjs:7103-7120`, `migrations/0151_approval_kernel.sql` per comment `:7094`):

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | integer notNull | index `(organization_id, status)` `:2681`; dedupe index `(organization_id, tool_name, content_hash, status)` `:2682` |
| `toolName` | text notNull | |
| `args` | jsonb notNull `$type<Record<string, unknown>>` | frozen at proposal |
| `contentHash` | text notNull | `sha256(toolName + "\n" + canonicalized args)` (`approvalKernel.ts:76-80`) |
| `status` | text notNull default `"pending"` | comment: `"pending" \| "approved" \| "executed" \| "expired" \| "rejected"` |
| `expiresAt` | timestamp notNull | `PENDING_ACTION_TTL_MS = 24h` (`approvalKernel.ts:49`) |
| `createdByUserId` | text nullable | from `options.userId` |
| `approvedByUserId` | text nullable | set on claim `:258` |
| `executedAt` | timestamp | |
| `resultSummary` | jsonb | `{ success: true, data }` `:300` |
| `createdAt` | timestamp default now | |

`export type PendingAction = typeof pendingActions.$inferSelect` (`:2684`).

Expiry is lazy: `"expired"` is written only when an approve hits a stale pending row (`approvalKernel.ts:228-241`); `proposePendingAction` reuses a live duplicate (`:125-138`, `row.expiresAt.getTime() > now`). No job references `pendingActions` (grep: only `approvalKernel.ts`). Therefore a list/count must apply `status = 'pending' AND expires_at > now()` itself — founder precedent: `listPendingHands` (`server/services/autopilot/pendingHands.ts:165-177`, `sql\`${...expiresAt} > now()\``, `orderBy(desc(createdAt))`, `limit`) and `pendingHandCounters` (`:187-217`, buckets `pendingNow` vs `expiredUnseen` by comparing `expiresAt` to now). Append-only send audit: `paxSends` `shared/schema.ts:2689-2702` (`organizationId, pendingActionId, toolName, channel, recipientRef, contentHash, sentAt`).

Sibling review queues already in the codebase: `agent_tasks` with `requiresReview=true` (`GET /api/autonomous/tasks/pending-approval` `server/routes-autonomous-agent.ts:200-221` filters `organizationId, requiresReview=true, status="pending"`, `limit(100)`; approve/reject `:273`, `:303`); `payment_reminders` in `awaiting_approval` (§2b); `paxDrafts` (`shared/schema.ts:~2640-2654`) for the first-follow-up path; founder-side `autopilot_pending_actions` (`:13365-13385`).

### 3b. Existing approve/reject routes (`server/routes-pax-insights.ts:637-745`)

Mount: `app.use('/api/pax', aiLimiter, isAuthenticated, getOrCreateOrg, paxChatGuard, paxInsightsRouter)` (`server/routes.ts:1433`; manifest `server/routeManifest.ts:238`). `paxChatGuard = expensiveEndpointGuard({ label: "pax-chat", perMinute: 30 })` (`server/middleware/expensiveEndpointGuard.ts:272`) applies to every route on this router, including any new GET; two `aiLimiter` definitions exist (`server/index.ts:418`, 240/min; `server/middleware/rateLimit.ts:441`, 120/min) — confirm which `routes.ts` imports. Auth is `isAuthenticated + getOrCreateOrg` only; there is no role/scope check on approve or reject.

```ts
// :632-635  function parsePendingActionId(raw: string): number | null   (positive int)
// :638  router.post("/pending-actions/:id/approve", async (req: AuthenticatedRequest, res) => {
//   const org = req.organization!;  const userId = getUserId(req);
//   const outcome = await approvePendingAction({ organizationId: org.id, pendingActionId, approvedByUserId: userId,
//     execute: (toolName, args) => executeTool(toolName, args as Record<string, any>, org, { trustedApproval: true, userId }) });   // :647-659
//   switch (outcome.outcome) {
//     "not_found"        → Errors.notFound(res, "Pending action")                 (404)
//     "expired"          → Errors.badRequest(res, "This action has expired. ...")  (400)
//     "rejected"         → Errors.badRequest(res, "This action was rejected ...")  (400)
//     "hash_mismatch"    → Errors.badRequest(res, "... failed integrity verification ...") (400)
//     "in_flight"        → res.json({ success: true, executed: false, inFlight: true })
//     "execution_failed" → Errors.badRequest(res, outcome.error)
//     "already_executed" → res.json({ success: true, executed: true, alreadyExecuted: true, result: outcome.result })
//     "executed"         → storage.logActivity({ organizationId: org.id, agentType: "pax", action: "pax_value_event", entityType: "pending_action", entityId, metadata: { valueEvent: "approved_action_executed", toolName, channel: toolChannel(toolName), witnessed: true, approvedByHuman: true, pendingActionId } });  res.json({ success: true, executed: true, result: outcome.result })
// :721  router.post("/pending-actions/:id/reject", ...)  → rejectPendingAction({ organizationId: org.id, pendingActionId })
//   "not_found" → 404;  "already_executed" → badRequest("This action already executed and cannot be rejected.");  else res.json({ success: true, rejected: true })
```
Kernel signatures: `approvePendingAction(params: { organizationId; pendingActionId; approvedByUserId?; execute(toolName, args): Promise<{ success; data?; error? }> }): Promise<ApprovalOutcome>` (`approvalKernel.ts:209-214`, outcome union `:187-195`); `rejectPendingAction({ organizationId, pendingActionId }): Promise<RejectionOutcome>` (`:373-376`, `:367-370`); `toolChannel(toolName)` `:92-94` (`email|sms|slack|stripe|other`); `toolRecipientRef(toolName, args)` `:97-106`. Error envelope is `{ error, message, details?, statusCode }` (`server/utils/errors.ts` per CLAUDE.md); the rail reads `body.message` on failure (`pax-copilot-rail.tsx:1102`).

Fields a GET list would need to filter on: `organizationId = org.id`, `status = 'pending'`, `expiresAt > now()`; sort `createdAt desc`; the card renders `id, toolName, args` and can derive `channel` via `toolChannel`; `expiresAt`, `createdAt`, `createdByUserId` are available. A count endpoint is the same predicate with `count(*)`; both indexes at `:2681-2682` lead with `organization_id`.

### 3c. Desktop rail approval card (`client/src/components/pax-copilot-rail.tsx`)

- Local message type: `:188-194` — `pendingAction?: { pendingActionId: number; toolName: string; args: any; status: "pending" | "deciding" | "executed" | "rejected" | "failed"; resultNote?: string }`.
- Ingestion: SSE event `type: "pending_action"` `:875-889` sets `{ pendingActionId, toolName, args, status: "pending" }`. Server emits it in `server/ai/executive.ts:2242-2243` (`if (result?.data?.pendingApproval) yield { type: "pending_action", pendingAction: result.data }`) with `pendingActionArtifact(row)` shape `approvalKernel.ts:169-181`: `{ pendingApproval: true, requiresApproval: true, pendingActionId, toolName, channel, args, contentHash, expiresAt, note }`.
- Formatter (module-private): `function formatApprovalArgs(toolName: string, args: any): string` `:231-245`.
- Handler: `handlePendingActionDecision(msgId: string, pendingActionId: number, decision: "approve" | "reject")` `:1077-1107` — sets `"deciding"`, `fetch(\`/api/pax/pending-actions/${pendingActionId}/${decision}\`, { method: "POST", credentials: "include" })`, then `"executed"` (note from `body.alreadyExecuted`), `"rejected"`, or `"failed"` with `body?.message`.
- Card JSX `:1658-1707`: container `rounded-card border border-acr-warn-soft bg-acr-warn-soft ... p-3 text-xs space-y-2 mt-1`; icon `CheckCircle2` (executed) / `AlertCircle`; header strings by status `:1667-1671`; body `<span className="font-mono ...">{toolName}</span> {formatApprovalArgs(...)}` `:1675-1676`; optional `resultNote` `:1678-1680`; buttons `:1681-1704` (`Button size="sm" className="h-7 text-xs"`, `aria-label={\`Approve and send ${toolName.replace(/_/g," ")}\`}` / `Reject ...`, `data-testid={\`pending-action-approve-${id}\`}` / `pending-action-reject-${id}`, disabled while `"deciding"`, label `"Working…"`). The card's only inputs are `msg.pendingAction` and `(msg.id, pendingActionId, decision)`. The rail returns `null` on mobile (`:1126`).

### 3d. How doors/bottom nav are badged today

- Desktop sidebar (`client/src/components/layout-sidebar.tsx`): count source `:1013-1020` — `useQuery<{ count: number }>({ queryKey: ["/api/inbox/unread-count"], refetchInterval: 300000 })`; live bump `:1025-1031` — `useWebSocketChannel(\`org:${organization.id}\`, (event) => { if (event.type !== "inbox.unread") return; queryClient.invalidateQueries(...) })` (hook: `client/src/hooks/use-websocket-channel.ts:28`). Server side: `wsServer.broadcastToOrg(organizationId: number, type: string, payload)` (`server/websocket.ts:364-366`, singleton `:437`), published from `server/services/inboundEmailService.ts:131` and `server/services/smsService.ts:676`. Render: `NavModule.showUnreadBadge?: boolean` (`:373`; `NavChild` `:354`), set only on the Inbox module `:686-693`; `const showBadge = module.showUnreadBadge && inboxUnreadCount > 0` `:1221-1222`; `<Badge variant="secondary" className="text-xs shrink-0" data-testid="badge-inbox-unread">{inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}</Badge>` `:1280-1288` (children `:1332-1365`; collapsed variant is a dot `:1825-1827` via `CollapsedModuleItem({ module, isActive, inboxUnreadCount, isRouteActive, onPrefetch })` `:1789-1799`). Separate top-bar `PaxNotificationBadge` `:190-243` polls `/api/pax/observations?unread=true` every 2 min and renders a red bubble `unreadCount > 9 ? "9+"` `:257-261`.
- Mobile bottom nav (`client/src/components/mobile/MobileBottomNav.tsx`): renders `MOBILE_DOORS` (`client/src/lib/nav-items.ts:153` = `["today","map","deals","money","ai-hub"]`) `:24-26`; item markup `:90-120` has no count/badge code; `MobileCommandDrawer.tsx` has none either (grep). Ratchet: `tests/unit/mobileNavFixedDoors.test.ts` asserts `MOBILE_DOORS` order/hrefs and source-shape (renders from `MOBILE_DOORS`, no persona/preferences layer; also parses `NAV_MODULES` out of `layout-sidebar.tsx`).
- Founder precedent for a "needs you" count on a door: `client/src/components/mobile/FounderMobileBottomNav.tsx:102-118` — `useQuery<number>({ queryKey: ["founder-nav-needs-you"], queryFn: Promise.all([fetch("/api/founder/asks?status=open&limit=1"), fetch("/api/founder/autopilot/pending-actions")]) → asks.count + actions.length, staleTime: 60_000, refetchInterval: 90_000, retry: false })`; rendered `:196-204` (`data-testid="founder-nav-decisions-badge"`, `> 9 ? "9+"`), aria-label `:159-163`. The founder Letter's union is `needsYouCount = asksCount + queueCount + sendsCount` (`server/services/autopilot/narrate.ts:369`, pinned by `tests/unit/letterNeedsYouUnion.test.ts`). Founder list consumer: `WitnessedSendQueue` in `client/src/pages/founder-decisions.tsx:576-612` (`useQuery<{ actions: PendingAction[] }>`, `refetchInterval: 30_000`, mutation POST `.../${id}/${decision}`, invalidates the list). Customer `/api/today` payload (`server/routes-today.ts`) carries no pending-approval field (grep: only a comment at `:1256`).

### 3e. Digest mechanisms a review digest could ride

- **Send lanes** (`server/services/emailService.ts`): `EmailOptions.purpose?: 'system' | 'counterparty'` `:421-430` — `"system"` = AcreOS to its own users (digests named explicitly, `:426-427`) and may use the platform identity; `"counterparty"` requires the org's own identity. Default `'system'` (`:624`), but an omitted `purpose` runs the undeclared-lane guard `:833-1013` which refuses when a recipient resolves to a counterparty record. `sendEmail(options: EmailOptions): Promise<EmailResult>` `:566`; `EmailResult { success; messageId?; error?; errorType?; attempts?; retryable? }` `:451-458`; `isConfigured(orgId?)` `:537`.
- **Customer weekly digest (org-scoped, per-subscriber):** `server/services/digest.ts` — table `digest_subscriptions` (`shared/schema.ts:4979-4987`: `userId, organizationId, frequency 'daily'|'weekly'|'monthly' default weekly, emailEnabled, lastSentAt`); `getSubscriptionsNeedingDigest(frequency)` `:68-96` (daily cutoff = 1 day, `lastSentAt IS NULL OR < cutoff`); `processWeeklyDigests()` `:279-345` builds `generateWeeklyDigest(orgId)` `:98-183`, resolves recipient from `teamMembers.email` `:299-308`, sends with no `purpose` `:311-315`, stamps `markDigestSent` only on `result.success` `:317-320`. Job: `server/jobs/runScheduledJobs.ts:163-189` every 6h under `withJobLock('digest', 5h, ...)`; only `'weekly'` is ever processed (no daily caller).
- **Per-user digest prefs (stored, unconsumed):** `users.notificationPrefs` `shared/models/auth.ts:161` / `UserNotificationPrefsShape { weeklyDigest?, digestDay?, digestHour? }` `:74-80`; defaults `server/services/notificationPreferences.ts:218-220`; no job reads `digestDay`/`digestHour` (grep hits only that file and a string at `server/routes-admin.ts:4871`).
- **Founder weekly digest pattern:** `server/jobs/founderWeeklyDigest.ts` — `sendFounderWeeklyDigest(): Promise<{ sent; failed }>` `:891-935` (recipients from `FOUNDER_EMAIL` env, HTML from `generateDigestEmail(data, appUrl)` `:653`, `emailService.sendEmail({ to, subject, html, text })` with no `purpose` `:916-921`). Live scheduler is an hourly `trackInterval` that fires when `getUTCDay() === 1 && getUTCHours() === 14` under `withJobLock('founder_weekly_digest', 30*60, ...)` (`server/jobs/runScheduledJobs.ts:906-923`); `registerFounderWeeklyDigestJob(queue)` `:941-955` (BullMQ repeat) has no caller (grep: definition only).
- **In-app:** `notifications` table `shared/schema.ts:7717-7733` (`organizationId, userId, type, title, message, entityType, entityId, isRead, readAt, metadata`); `NotificationDispatcher` class `server/services/notificationDispatcher.ts:104` (singleton `:520`, `EVENT_CHANNEL_MAP` `:63` incl. `"agent:escalation"` → `in_app`/`sms` urgent, `"agent:decision"` → `in_app`).