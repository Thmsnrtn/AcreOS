/**
 * Pax pause — the POPULATION gate, DERIVED (AUTONOMY_SPEC.md §4.4, §7;
 * wave-0 handoff seam 7: "two enumerations of the same population now exist
 * — UNATTENDED_PATHS and PAUSE_ENFORCEMENT_POINTS — derive one from the
 * other so they cannot drift apart").
 *
 * The Pax page renders "what Pause stops" from UNATTENDED_PATHS
 * (shared/pax-controls.ts). This suite reads THE SAME registry and, for each
 * member, resolves the file and the gate the customer's sentence rests on.
 * A path the page promises to stop that no code stops is a red test; a
 * gate that appears in code without a registry row is a red test. Neither
 * side can be edited into agreement on its own.
 *
 * Population, cross-derived three ways (CLAUDE.md, third law):
 *   1. UNATTENDED_PATHS ids → EXPECTATIONS (this file) — one anchor per id,
 *      both directions, and a per-member vacuity assertion (the file is
 *      real, the function is found, the gate is found, the recorded reason
 *      code is in the code).
 *   2. Every `export async function execute*Tool(` under server/ai/ — the
 *      model-driven dispatch switches — must be a member file:function.
 *      Adding a third switch without a registry row fails.
 *   3. Every JOB_ROSTER entry whose module ACTS on an org's behalf
 *      (sends, LLM prompts, skill/workflow dispatch, ladder rungs) must be
 *      covered by a member — by the module itself or by the engine it calls
 *      — or be listed in JOB_MODULE_EXEMPTIONS with the reason it is not a
 *      Pax path. Adding a job that writes org rows without either fails.
 *   4. Every production file under server/ that consults the pause state
 *      (getPaxPauseState or getPaxControls) must be a member file, a
 *      documented read-only consumer, the primitive, or the aggregator.
 *
 * Behaviour per engine (mock paused → assert skip / defer / park and no
 * send) lives in paxPauseWorkflowEngine / paxPauseSequenceProcessor /
 * paxPauseUnattendedJobs / financeLadderAsksThroughKernel / paxPauseSkillGate;
 * the tool-layer gates keep paxPauseToolGate / paxPauseSupportGate /
 * paxStanceIsRead.
 *
 * Mutation probes this file must go red on (spec §7): remove one pause read
 * from a member; add a job module that sends without a roster/registry
 * entry; add a dispatch switch under server/ai/ with no registry row.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { WORKFLOW_ACTION_TYPES } from "@shared/schema";
import { UNATTENDED_PATHS, type UnattendedPathId } from "@shared/pax-controls";
import { JOB_ROSTER } from "../../server/jobs/jobRegistry";

// The skill-classification cases import the REAL registry (never a copy).
// The module pulls the DB at load; it does not query it.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ROOT = path.resolve(__dirname, "../..");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
/** Ratchets assert on CODE, not prose — a comment naming the gate is not a gate. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const codeOf = (rel: string) => stripComments(read(rel));

/** The call shapes that count as "consulted the org's pause state". */
const PRIMITIVE_CALL = "getPaxPauseState(";
const AGGREGATOR_CALL = "getPaxControls(";
const ASK_FREEZE_CALL = "proposePendingAction(";

// ── The expectation each registry member must meet ───────────────────────────

/** A pause read that must be awaited inside `fn`, before `before` (dispatch). */
interface PauseGate {
  file: string;
  /** The dispatching function the gate must live inside. */
  fn: string;
  /** The exact, org-scoped read — primitive form; the aggregator form is accepted too. */
  gate: string;
  /** Real dispatch code inside `fn` that the gate must come BEFORE. */
  before: string;
}

type Expectation =
  | {
      /** Pause stops it: an awaited pause read precedes dispatch. */
      kind: "pause_gate";
      fn: string;
      gate: string;
      before: string;
      /**
       * Further gates the same registry row rests on — an engine the entry
       * point calls into, or a sibling module the spec's row names. Each is
       * checked exactly like the primary gate.
       */
      also?: PauseGate[];
    }
  | {
      /** Pause does not stop it because it never runs unattended: it FREEZES as an ask. */
      kind: "ask_freeze";
      fn: string;
      /** Optional extra literal that must sit inside `fn` (e.g. the kernel's tool set). */
      alsoInFn?: string;
      /** Optional pause gate that still applies before the freeze (borrower dispatch: Gate 1). */
      pauseGate?: { gate: string; before: string };
    }
  | {
      /** Pause does not stop it by design (a draft is not an action); a SWITCH is read. */
      kind: "switch_read";
      reads: string[];
    };

/**
 * One anchor per UNATTENDED_PATHS id. `Record<UnattendedPathId, …>` makes a
 * new registry row a compile error here until it is anchored; the runtime
 * case below makes it a red test even if the types are cast around.
 */
const EXPECTATIONS: Record<UnattendedPathId, Expectation> = {
  chat_record_writes: {
    kind: "pause_gate",
    fn: "export async function executeTool(",
    gate: "getPaxPauseState(org.id)",
    before: "scopeForIntent(toolName)",
  },
  chat_sends: {
    // The freeze itself is the anchor; that every SEND freezes at every
    // stance is the superset ratchet paxWitnessedSend.test.ts pins.
    kind: "ask_freeze",
    fn: "export async function executeTool(",
  },
  support_fixes: {
    kind: "pause_gate",
    fn: "export async function executeSupportTool",
    gate: "getPaxPauseState(org.id)",
    before: "switch (toolName)",
  },
  scheduled_prompts: {
    kind: "pause_gate",
    fn: "export async function processPaxScheduledTasks",
    gate: "getPaxPauseState(org.id)",
    before: "await executeTask(task, org)",
  },
  lead_scoring: {
    kind: "pause_gate",
    fn: "async function processLeadNurturing(",
    gate: "getPaxPauseState(org.id)",
    before: "leadNurturerService.processLeadsForOrg(",
    also: [
      {
        // The engine the job calls gates on its own too (it has other callers).
        file: "server/services/leadNurturer.ts",
        fn: "async processLeadsForOrg(",
        gate: "getPaxPauseState(organizationId)",
        before: "storage.setJobStatus(JOB_TYPE, 'running')",
      },
    ],
  },
  campaign_optimizer: {
    kind: "pause_gate",
    fn: "async function processCampaignOptimizations(",
    gate: "getPaxPauseState(org.id)",
    before: "campaignOptimizerService.processOrganizationCampaigns(",
  },
  nudges: {
    kind: "pause_gate",
    fn: "export async function processPaxNudges(",
    gate: "getPaxPauseState(org.id)",
    before: "generateNudgesForOrg(",
    also: [
      {
        // Spec §4.4 groups lead-aging alerts with nudges: "cards only; skip org".
        file: "server/services/alerting.ts",
        fn: "async runDailyAlertCheck(",
        gate: "getPaxPauseState(org.id)",
        before: "this.checkAlerts(org.id)",
      },
    ],
  },
  workflows: {
    kind: "pause_gate",
    // The registry names the customer-facing entry point (triggerWorkflows);
    // every way into the action loop — that trigger, the delay-resume sweep,
    // a scheduled task — passes through runActionsFrom, so the ONE gate
    // lives there and is re-checked on resume. The entry-point case below
    // pins that triggerWorkflows really reaches it.
    fn: "private async runActionsFrom(",
    gate: "getPaxPauseState(context.organizationId)",
    before: "this.executeAction(action, context)",
  },
  sequences: {
    kind: "pause_gate",
    // Gate 0 sits in sendStep; processEnrollment (the registry fn) is what
    // turns its "deferred" into a reschedule that consumes nothing.
    fn: "async sendStep(",
    gate: "getPaxPauseState(enrollment.sequence.organizationId)",
    before: "canSendViaChannel(lead, step.channel",
  },
  task_runner_skills: {
    kind: "pause_gate",
    fn: "async runTask(",
    gate: "getPaxPauseState(task.organizationId)",
    before: "await this.executeTask(task)",
    also: [
      {
        // Every skill dispatch — from a task, a workflow step or a core agent
        // — ends in the registry, which gates on its own.
        file: "server/services/agent-skills.ts",
        fn: "async executeSkill(",
        gate: "getPaxPauseState(context.organizationId)",
        before: "skill.execute(validatedParams, context)",
      },
    ],
  },
  borrower_staging: {
    kind: "pause_gate",
    fn: "async ensureLadderRung(",
    gate: "getPaxPauseState(note.organizationId)",
    before: "storage.createPaymentReminder(reminder)",
  },
  borrower_dispatch: {
    kind: "ask_freeze",
    fn: "async dispatchReminder(",
    pauseGate: { gate: "getPaxPauseState(orgId)", before: "options.humanApproved" },
  },
  inbox_drafts: {
    kind: "switch_read",
    reads: [AGGREGATOR_CALL, ".inboxDrafts"],
  },
  founder_lane: {
    kind: "pause_gate",
    fn: "async function processInboxItem(",
    gate: "getPaxPauseState(item.organizationId)",
    before: "companyAgentService.getOwnerForDecisionType(",
  },
};

/**
 * Members whose registry `pausedReason` is a recorded CODE (a status column,
 * a log field, a resumeState reason) must carry that literal in their code.
 * The two kernel switches are exempt with a reason: executeTool /
 * executeSupportTool refuse with the glossary sentence and return
 * `{ success: false, error }` — there is no row or status to record a code
 * on, so the registry's "pax_paused" is the page's word, not a literal.
 */
const REASON_NOT_A_LITERAL: ReadonlySet<UnattendedPathId> = new Set(["chat_record_writes", "support_fixes"]);

/** The derived enumeration: the registry, joined to its anchors. */
const PAUSE_ENFORCEMENT_POINTS = UNATTENDED_PATHS.map((p) => ({
  id: p.id,
  file: p.file,
  registryFn: p.fn,
  pauseStops: p.pauseStops,
  pausedReason: p.pausedReason,
  expectation: EXPECTATIONS[p.id],
}));

const PAUSE_DEFINITION = "server/services/paxPause.ts";
/**
 * Read the state to DISPLAY or RECORD it; enforce nothing. Tolerant of
 * absence (a route not yet created, a route being deleted) — but a file
 * here that EXISTS must consult the state, and a file that consults it
 * without being here fails.
 *   - routes-pax-controls.ts: the Settings page reads ORG truth (wave 1 C).
 *   - routes-pax-insights.ts: approve / revise routes — a tap is the human
 *     acting; the state is read for attribution only.
 *   - paxAskExecutors.ts: stance attribution on the ask receipt (seam 5).
 *   - pendingActionExpiryJob.ts: stance attribution on the ask_expired receipt.
 *   - routes-autonomy.ts: the pre-program surface, deleted by wave 1 C —
 *     dead entry the moment the file is gone; remove it then.
 */
const PAUSE_READ_ONLY_CONSUMERS = [
  "server/routes-pax-controls.ts",
  "server/routes-pax-insights.ts",
  "server/services/paxAskExecutors.ts",
  "server/jobs/pendingActionExpiryJob.ts",
  "server/routes-autonomy.ts",
];
/**
 * Modules that WRAP the primitive for their own consumers (spec §4.2's "one
 * reader"). An aggregator is not an enforcement point — the engine that
 * consults it is.
 */
const PAUSE_STATE_AGGREGATORS = ["server/services/paxControls.ts"];

/** Both accepted forms of a point's gate: the primitive, or the aggregator. */
function gateForms(gate: string): string[] {
  return [gate, gate.replace(PRIMITIVE_CALL, AGGREGATOR_CALL)];
}

/** Index of the end of the function starting at `fnAt` (next top-level sibling, or EOF). */
function fnEnd(code: string, fnAt: number): number {
  const next = code.slice(fnAt + 1).search(/\n  (?:private |public )?(?:async )?[a-zA-Z_]+\(|\nexport (?:async )?function |\nasync function |\nfunction /);
  return next === -1 ? code.length : fnAt + 1 + next;
}

function assertPauseGate(rel: string, fn: string, gate: string, before: string, label: string): void {
  expect(exists(rel), `${label}: ${rel} does not exist`).toBe(true);
  const code = codeOf(rel);
  const fnAt = code.indexOf(fn);
  expect(fnAt, `${label}: dispatch function "${fn}" not found in ${rel} — repin`).toBeGreaterThan(-1);
  const gateAt = Math.max(...gateForms(gate).map((g) => code.indexOf(g, fnAt)));
  expect(gateAt, `${label}: pause gate "${gate}" (or its getPaxControls form) missing from ${fn} in ${rel}`).toBeGreaterThan(-1);
  const beforeAt = code.indexOf(before, fnAt);
  expect(beforeAt, `${label}: dispatch anchor "${before}" not found in ${rel} — repin`).toBeGreaterThan(-1);
  expect(gateAt, `${label}: the pause gate must run BEFORE dispatch in ${rel}`).toBeLessThan(beforeAt);
  expect(gateAt, `${label}: the gate must sit inside ${fn}`).toBeLessThan(fnEnd(code, fnAt));
  // The gate reads the state, it does not merely import the symbol.
  expect(code.slice(gateAt - 40, gateAt), `${label}: the gate must be awaited`).toMatch(/await\s+$/);
}

function* walkTs(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      yield* walkTs(full);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      yield full;
    }
  }
}

/** Every production file under server/ whose CODE consults the pause state. */
function derivedPauseCallers(): string[] {
  const callers: string[] = [];
  let scanned = 0;
  for (const full of walkTs(path.join(ROOT, "server"))) {
    scanned++;
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    if (PAUSE_STATE_AGGREGATORS.includes(rel)) continue;
    const code = stripComments(fs.readFileSync(full, "utf-8"));
    if (code.includes(PRIMITIVE_CALL) || code.includes(AGGREGATOR_CALL)) callers.push(rel);
  }
  expect(scanned, "server/ walk went blind").toBeGreaterThan(200);
  return callers.sort();
}

/** True when the file's CODE consults the pause state by either accepted form. */
function consultsPauseState(rel: string): boolean {
  const code = codeOf(rel);
  return code.includes(PRIMITIVE_CALL) || code.includes(AGGREGATOR_CALL);
}

/** Every file a registry member rests on: its own file plus its `also` gates. */
function memberFiles(): string[] {
  const files = new Set<string>();
  for (const p of PAUSE_ENFORCEMENT_POINTS) {
    files.add(p.file);
    if (p.expectation.kind === "pause_gate") for (const a of p.expectation.also ?? []) files.add(a.file);
  }
  return [...files].sort();
}

// ── 1. The registry IS the enumeration ───────────────────────────────────────

describe("PAUSE_ENFORCEMENT_POINTS is derived from UNATTENDED_PATHS — one population, two readers", () => {
  it("vacuity: the registry is its real size and every member is anchored, both directions", () => {
    expect(UNATTENDED_PATHS.length).toBeGreaterThanOrEqual(14);
    const ids = UNATTENDED_PATHS.map((p) => p.id).sort();
    expect(new Set(ids).size, "duplicate ids in UNATTENDED_PATHS").toBe(ids.length);
    expect(Object.keys(EXPECTATIONS).sort(), "every registry id needs exactly one anchor here, and no anchor may name an id the registry lacks").toEqual(ids);
    for (const p of PAUSE_ENFORCEMENT_POINTS) expect(p.expectation, `${p.id} has no expectation`).toBeTruthy();
  });

  it.each(PAUSE_ENFORCEMENT_POINTS.map((p) => [p.id, p] as const))(
    "%s — the registry's file and function are real",
    (_id, point) => {
      expect(exists(point.file), `${point.id}: ${point.file} does not exist`).toBe(true);
      // The registry names a customer-facing entry point; it must be a real
      // identifier in that file (a renamed function must be renamed here).
      // routes-ai-draft.ts names the SWITCH it reads rather than a function
      // (registry fn "paxDraftEnabled"); its anchor is the switch_read below.
      if (point.expectation.kind !== "switch_read") {
        expect(codeOf(point.file), `${point.id}: "${point.registryFn}" not found in ${point.file}`).toContain(point.registryFn);
      }
    },
  );

  it.each(PAUSE_ENFORCEMENT_POINTS.map((p) => [p.id, p] as const))(
    "%s — the gate the page's sentence rests on is real, awaited, and precedes dispatch",
    (_id, point) => {
      const e = point.expectation;
      if (e.kind === "pause_gate") {
        expect(point.pauseStops, `${point.id}: a pause-gated path must be marked pauseStops in the registry`).toBe(true);
        assertPauseGate(point.file, e.fn, e.gate, e.before, point.id);
        for (const a of e.also ?? []) assertPauseGate(a.file, a.fn, a.gate, a.before, `${point.id} (also ${a.file})`);
      } else if (e.kind === "ask_freeze") {
        // Never runs unattended: the row freezes as an ask instead — so the
        // pause does not stop it (the tap is the human acting) and the
        // registry must say so.
        expect(point.pauseStops, `${point.id}: an ask never runs unattended — pauseStops must be false`).toBe(false);
        const code = codeOf(point.file);
        const fnAt = code.indexOf(e.fn);
        expect(fnAt, `${point.id}: "${e.fn}" not found in ${point.file}`).toBeGreaterThan(-1);
        const end = fnEnd(code, fnAt);
        const freezeAt = code.indexOf(ASK_FREEZE_CALL, fnAt);
        expect(freezeAt, `${point.id}: ${ASK_FREEZE_CALL} missing from ${e.fn} in ${point.file}`).toBeGreaterThan(-1);
        expect(freezeAt, `${point.id}: the freeze must sit inside ${e.fn}`).toBeLessThan(end);
        if (e.alsoInFn) {
          const at = code.indexOf(e.alsoInFn, fnAt);
          expect(at, `${point.id}: "${e.alsoInFn}" missing from ${e.fn}`).toBeGreaterThan(-1);
          expect(at).toBeLessThan(end);
        }
        if (e.pauseGate) assertPauseGate(point.file, e.fn, e.pauseGate.gate, e.pauseGate.before, `${point.id} (pause gate)`);
      } else {
        expect(point.pauseStops, `${point.id}: a switch-only path is not stopped by the pause`).toBe(false);
        const code = codeOf(point.file);
        for (const r of e.reads) {
          expect(code, `${point.id}: ${point.file} must read "${r}"`).toContain(r);
        }
      }
    },
  );

  it.each(PAUSE_ENFORCEMENT_POINTS.filter((p) => p.pausedReason !== null).map((p) => [p.id, p] as const))(
    "%s — the reason code the registry promises is the one the engine records",
    (_id, point) => {
      if (REASON_NOT_A_LITERAL.has(point.id)) return;
      expect(codeOf(point.file), `${point.id}: ${point.file} must record "${point.pausedReason}"`).toContain(`"${point.pausedReason}"`);
    },
  );

  it("workflows: the registry's entry point (triggerWorkflows) reaches the gated loop, and resume re-checks", () => {
    const code = codeOf("server/services/workflow-engine.ts");
    const trigger = code.indexOf("async triggerWorkflows(");
    expect(trigger).toBeGreaterThan(-1);
    const triggerBody = code.slice(trigger, fnEnd(code, trigger));
    expect(triggerBody).toContain("this.executeWorkflow(");
    const exec = code.indexOf("async executeWorkflow(");
    expect(code.slice(exec, fnEnd(code, exec))).toContain("this.runActionsFrom(");
    const resume = code.indexOf("async resumeWorkflowRun(");
    expect(code.slice(resume, fnEnd(code, resume))).toContain("this.runActionsFrom(");
    const sweep = code.indexOf("async resumeDueWorkflowRuns(");
    expect(code.slice(sweep, fnEnd(code, sweep))).toContain("this.resumeWorkflowRun(");
  });

  it("sequences: processEnrollment (the registry fn) turns a deferred step into a reschedule that consumes nothing", () => {
    const code = codeOf("server/services/sequenceProcessor.ts");
    const fnAt = code.indexOf("async processEnrollment(");
    const body = code.slice(fnAt, fnEnd(code, fnAt));
    expect(body).toContain("this.sendStep(enrollment, nextStep)");
    expect(body).toMatch(/outcome\.status === "deferred"/);
    // The deferred branch reschedules without touching currentStep.
    const deferredAt = body.indexOf('outcome.status === "deferred"');
    const branch = body.slice(deferredAt, body.indexOf("return;", deferredAt));
    expect(branch).toContain("nextStepScheduledAt");
    expect(branch).not.toContain("currentStep");
  });
});

// ── 2. Every model-driven dispatch switch is a member ────────────────────────

describe("every execute*Tool dispatch switch under server/ai/ is a registry member", () => {
  it("derives the switches from source and finds each in the registry (vacuity: at least two)", () => {
    const switches: Array<{ file: string; fn: string }> = [];
    for (const full of walkTs(path.join(ROOT, "server", "ai"))) {
      const rel = path.relative(ROOT, full).split(path.sep).join("/");
      const code = stripComments(fs.readFileSync(full, "utf-8"));
      for (const m of code.matchAll(/export async function (execute\w*Tool)\s*\(/g)) {
        switches.push({ file: rel, fn: m[1] });
      }
    }
    expect(switches.length, "the dispatch-switch derivation went blind").toBeGreaterThanOrEqual(2);
    const members = new Set(UNATTENDED_PATHS.map((p) => `${p.file}::${p.fn}`));
    const unlisted = switches.filter((s) => !members.has(`${s.file}::${s.fn}`));
    expect(
      unlisted,
      "a model-driven dispatch switch exists that UNATTENDED_PATHS does not name — " +
        "add a registry row (shared/pax-controls.ts) and an anchor here before it ships",
    ).toEqual([]);
  });
});

// ── 3. Every acting job module is covered ────────────────────────────────────

/**
 * Call shapes that ACT on an org's behalf. A job module containing one of
 * these either IS a member file, calls INTO a member engine (listed under
 * `via`), or is exempted below with the reason it is not a Pax path.
 */
const ACTING_SHAPES = [
  "sendToLead(",
  "sendOrgSMS(",
  'purpose: "counterparty"',
  "executeTool(",
  "processChat(",
  "executeSkill(",
  "executeWorkflow(",
  "dispatchReminder(",
  "ensureLadderRung(",
  "dispatchDueReminders(",
  "processOrganizationNotes(",
  "processLeadsForOrg(",
  "processPaxScheduledTasks(",
  "processPaxNudges(",
  "runDailyAlertCheck(",
  "resumeDueWorkflowRuns(",
  "processScheduledTasks(",
  "processEnrollments(",
];

/** Job modules that call into a member ENGINE rather than gating themselves. */
const JOB_MODULES_COVERED_VIA: Readonly<Record<string, UnattendedPathId>> = {
  "server/jobs/runScheduledJobs.ts": "scheduled_prompts", // orchestrator only: every acting call it makes lands in a member engine
  "server/jobs/borrowerDunningLadder.ts": "borrower_staging",
  "server/jobs/workflowDelayResume.ts": "workflows",
};

/** Job modules that match a shape but are NOT a Pax path — with the reason. */
const JOB_MODULE_EXEMPTIONS: Readonly<Record<string, string>> = {};

describe("every job module that acts on an org's behalf is covered by a registry member", () => {
  it("derives the acting job modules from server/jobs and JOB_ROSTER and finds each covered (vacuity: at least three)", () => {
    expect(JOB_ROSTER.length, "the roster went blind").toBeGreaterThan(50);
    const members = new Set(memberFiles());
    const acting: string[] = [];
    let scanned = 0;
    for (const full of walkTs(path.join(ROOT, "server", "jobs"))) {
      scanned++;
      const rel = path.relative(ROOT, full).split(path.sep).join("/");
      const code = stripComments(fs.readFileSync(full, "utf-8"));
      if (ACTING_SHAPES.some((shape) => code.includes(shape))) acting.push(rel);
    }
    expect(scanned, "server/jobs walk went blind").toBeGreaterThan(10);
    expect(acting.length, "no acting job module found — the shape list went blind").toBeGreaterThanOrEqual(3);

    const uncovered = acting.filter(
      (rel) => !members.has(rel) && !(rel in JOB_MODULES_COVERED_VIA) && !(rel in JOB_MODULE_EXEMPTIONS),
    );
    expect(
      uncovered,
      "a job module acts on an org's behalf but no UNATTENDED_PATHS member covers it: add a registry " +
        "row + anchor, list it under JOB_MODULES_COVERED_VIA (naming the member engine it calls), or " +
        "exempt it here WITH the reason it is not a Pax path",
    ).toEqual([]);

    // The `via` and exemption lists may not go stale either.
    for (const rel of [...Object.keys(JOB_MODULES_COVERED_VIA), ...Object.keys(JOB_MODULE_EXEMPTIONS)]) {
      expect(exists(rel), `${rel} is listed but does not exist`).toBe(true);
      expect(acting, `${rel} is listed as covered/exempt but no longer acts — remove it`).toContain(rel);
    }
    for (const [rel, id] of Object.entries(JOB_MODULES_COVERED_VIA)) {
      expect(UNATTENDED_PATHS.some((p) => p.id === id), `${rel} names a member id the registry lacks: ${id}`).toBe(true);
    }
  });

  it("the deleted task processor stays deleted (founder decision 2026-09-02 #7)", () => {
    expect(exists("server/jobs/autonomousTaskProcessor.ts")).toBe(false);
    expect(JOB_ROSTER.some((e) => e.name === "autonomous_task_processor")).toBe(false);
    expect(codeOf("server/jobs/runScheduledJobs.ts")).not.toContain("autonomousTaskProcessor");
  });
});

// ── 4. No anonymous consumer of the pause state ──────────────────────────────

describe("the set of production callers is exactly the enumeration (derived from server/, both directions)", () => {
  it("every file that consults the pause state is a member, a read-only consumer, or the primitive", () => {
    const expected = [...memberFiles(), PAUSE_DEFINITION, ...PAUSE_READ_ONLY_CONSUMERS].sort();
    const derived = derivedPauseCallers();
    // Vacuity: the derivation must see a real population, not an empty walk.
    expect(derived.length).toBeGreaterThanOrEqual(memberFiles().length);
    const unlisted = derived.filter((f) => !expected.includes(f));
    expect(
      unlisted,
      "a production file consults the pause state but is not enumerated: add it as an UNATTENDED_PATHS " +
        "row + anchor (with its dispatch anchor); if it only displays or records the state, to " +
        "PAUSE_READ_ONLY_CONSUMERS; if it only wraps the primitive, to PAUSE_STATE_AGGREGATORS — " +
        "and to paxPause.ts's header",
    ).toEqual([]);
    // Every member file that is a gate must consult the state; read-only
    // consumers must consult it IF they exist (absence is tolerated: a route
    // not yet created, or one being deleted).
    const missing = memberFiles().filter((f) => !consultsPauseState(f));
    expect(missing, "an enumerated engine no longer consults the pause state").toEqual([]);
    const silent = PAUSE_READ_ONLY_CONSUMERS.filter((f) => exists(f) && !consultsPauseState(f));
    expect(silent, "a listed read-only consumer exists but no longer reads the state — remove it from the list").toEqual([]);
  });

  it("paxPause.ts's header names every enforcement point and read-only consumer, and restates no count", () => {
    const header = read(PAUSE_DEFINITION);
    for (const f of memberFiles()) {
      expect(header, `paxPause.ts header must name ${f}`).toContain(f);
    }
    for (const f of PAUSE_READ_ONLY_CONSUMERS) {
      expect(header, `paxPause.ts header must name ${f}`).toContain(f);
    }
    expect(header).not.toMatch(/\bthe (five|six|seven|eight|nine|ten|eleven|twelve)\s+enforcement points\b/i);
    // The deleted processor is not a point any more.
    expect(header).not.toContain("autonomousTaskProcessor");
  });
});

// ── 5. A pause never cancels or fails work — source pins ────────────────────

describe("a pause never cancels or fails work — the engines skip, defer or park (source pins)", () => {
  it("task-runner: the paused branch advances nothing and marks nothing", () => {
    const runner = codeOf("server/services/task-runner.ts");
    const gate = runner.indexOf("if (controls.paused) {");
    expect(gate).toBeGreaterThan(-1);
    const branch = runner.slice(gate, runner.indexOf("}", runner.indexOf("return {", gate)));
    expect(branch).not.toContain("updateScheduledTask(");
    expect(branch).not.toContain("nextRunAt");
    expect(branch).toContain("skippedPaused: true");
  });

  it("sequenceProcessor: the paused branch defers as deferred_paused, never skipped/failed", () => {
    const seq = codeOf("server/services/sequenceProcessor.ts");
    const gate = seq.indexOf("if (controls.paused) {");
    expect(gate).toBeGreaterThan(-1);
    const branch = seq.slice(gate, seq.indexOf("return {", gate) + 60);
    expect(branch).toMatch(/status:\s*"deferred"/);
    expect(branch).toContain("STEP_SKIP_DEFERRED_PAUSED");
    expect(branch).not.toMatch(/status:\s*"(skipped|failed)"/);
  });

  it("workflow-engine: the paused branch parks as waiting with reason paused — never completed, never failed, never a per-step block", () => {
    const engine = codeOf("server/services/workflow-engine.ts");
    const park = engine.indexOf("private async parkRunPaused(");
    expect(park).toBeGreaterThan(-1);
    const body = engine.slice(park, fnEnd(engine, park));
    expect(body).toMatch(/status:\s*"waiting"/);
    expect(body).toContain("RESUME_REASON_PAUSED");
    expect(body).not.toMatch(/status:\s*"(completed|failed)"/);
    expect(engine).toMatch(/RESUME_REASON_PAUSED = "paused"/);
    // Park replaces the per-action block: the pause is read once per loop, not per step.
    const exec = engine.indexOf("async executeAction(");
    expect(engine.slice(exec, fnEnd(engine, exec))).not.toContain(AGGREGATOR_CALL);
    expect(engine.slice(exec, fnEnd(engine, exec))).not.toContain(PRIMITIVE_CALL);
    expect(engine).not.toContain("PAUSE_GATED_WORKFLOW_ACTIONS");
  });

  it("paxScheduler: the paused branch re-aims at the lift with skipped_paused and the glossary line", () => {
    const sched = codeOf("server/services/paxScheduler.ts");
    const gate = sched.indexOf("if (controls.paused) {");
    expect(gate).toBeGreaterThan(-1);
    const branch = sched.slice(gate, sched.indexOf("continue;", gate));
    expect(branch).toContain('"skipped_paused"');
    expect(branch).toContain("PAX_PAUSE_COPY.skippedLine(");
    expect(branch).toContain("PAX_PAUSE_COPY.checkFailedRefusal");
    expect(branch).not.toContain("toISOString()}. Resume");
    expect(branch).not.toMatch(/lastRunStatus:\s*"error"/);
  });

  it("financeAgent: nothing is prepared while paused or off; a rung nobody tapped parks, never sends", () => {
    const fin = codeOf("server/services/financeAgent.ts");
    expect(fin).toContain('reason: "pax_paused"');
    expect(fin).toContain('reason: "pax_off"');
    const dispatch = fin.indexOf("async dispatchReminder(");
    const body = fin.slice(dispatch, fnEnd(fin, dispatch));
    expect(body).toContain("if (controls.paused)");
    expect(body).toContain("REMINDER_STATUS.queued, paxControlsRefusalMessage(controls)");
  });
});

// ── 6. Workflow action classification ───────────────────────────────────────

describe("workflow actions are classified — control flow or acting (receipted), nothing unlisted", () => {
  function actingWorkflowActions(): Set<string> {
    const src = read("server/services/workflow-engine.ts");
    const m = src.match(/const ACTING_WORKFLOW_ACTIONS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/);
    expect(m, "ACTING_WORKFLOW_ACTIONS literal not found").toBeTruthy();
    return new Set([...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
  }

  it("every WORKFLOW_ACTION_TYPES member except `delay` is an acting step, and nothing else is", () => {
    expect(WORKFLOW_ACTION_TYPES.length).toBeGreaterThanOrEqual(6);
    expect(WORKFLOW_ACTION_TYPES).toContain("delay");
    const expected = new Set(WORKFLOW_ACTION_TYPES.filter((t) => t !== "delay"));
    expect([...actingWorkflowActions()].sort()).toEqual([...expected].sort());
  });
});

// ── 7. Skill classification ──────────────────────────────────────────────────
// Imported (not copied): the REAL registry decides what exists. The
// allowlist is read out of the source literal — it is deliberately not
// exported (reachability lint). The per-skill risk map that used to
// double-check this went with the deleted task processor; the semantic pin
// below replaces it by reading each pause-safe skill's own body.

const { skillRegistry } = await import("../../server/services/agent-skills");

/**
 * The gated complement of PAUSE_SAFE_SKILLS: anything that sends, writes a
 * record, quotes money, produces an offer or contract instrument, or drives a
 * browser on the org's behalf. Kept here so moving a skill OFF this list and
 * ONTO the allowlist shows up as a diff in both files.
 */
const GATED_SKILLS = new Set([
  // Reaches a counterparty
  "sendEmail",
  "startCollectionSequence",
  "escalateDelinquency",
  // Money / contract instruments
  "processPayoff",
  "prepareContract",
  "generateClosingPacket",
  // Offers (a step toward a binding communication; batch writes offer rows)
  "generateOffer",
  "draftOfferLetter",
  "generateBatchOffers",
  // Record writes
  "enrichLead",
  "scrubLeadList",
  "researchCounty",
  "generateSwotReport",
  // External automation on the org's behalf
  "browserResearch",
]);

function pauseSafeSkills(): Set<string> {
  const src = read("server/services/agent-skills.ts");
  const m = src.match(/const PAUSE_SAFE_SKILLS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/);
  expect(m, "PAUSE_SAFE_SKILLS literal not found in agent-skills.ts").toBeTruthy();
  return new Set([...m![1].matchAll(/"([A-Za-z_]+)"/g)].map((x) => x[1]));
}

/** Each skill definition's source chunk, keyed by its id. */
function skillBodies(): Map<string, string> {
  const code = codeOf("server/services/agent-skills.ts");
  const bodies = new Map<string, string>();
  const decls = [...code.matchAll(/\nconst \w+Skill: Skill = \{/g)];
  for (let i = 0; i < decls.length; i++) {
    const start = decls[i].index!;
    const end = i + 1 < decls.length ? decls[i + 1].index! : code.length;
    const chunk = code.slice(start, end);
    const id = chunk.match(/\bid:\s*"([A-Za-z_]+)"/);
    if (id) bodies.set(id[1], chunk);
  }
  return bodies;
}

/** Shapes that mutate the org's records or reach outside it. */
const SKILL_MUTATION_SHAPES = [
  /\bstorage\.(create|update|delete|record|log|set)\w*\(/,
  /\bdb\.(insert|update|delete)\(/,
  /\bsendEmail\(/,
  /\bsendToLead\(/,
  /\bsendOrgSMS\(/,
  /\bemailService\./,
  /\bcommunicationsService\./,
];

describe("every registered skill is classified for the pause — safe or gated, never unlisted", () => {
  const registered = skillRegistry.getAllSkills().map((s) => s.id);

  it("vacuity: the registry and the allowlist are their real size", () => {
    expect(registered.length).toBeGreaterThan(20);
    expect(pauseSafeSkills().size).toBeGreaterThanOrEqual(10);
    expect(skillBodies().size).toBeGreaterThan(20);
  });

  it("each registered skill is on exactly one list", () => {
    const safe = pauseSafeSkills();
    const unclassified = registered.filter((id) => !safe.has(id) && !GATED_SKILLS.has(id));
    expect(
      unclassified,
      "new skills must be classified deliberately: add each to PAUSE_SAFE_SKILLS " +
        "(pure calc / read-only lookup) or to GATED_SKILLS in this test. Unlisted " +
        "skills ARE gated at runtime — the classification must still be explicit.",
    ).toEqual([]);
    const both = [...safe].filter((id) => GATED_SKILLS.has(id));
    expect(both, "a skill cannot be both pause-safe and gated").toEqual([]);
  });

  it("no ghosts: every name on either list is a real registered skill", () => {
    const known = new Set(registered);
    for (const id of pauseSafeSkills()) {
      expect(known.has(id), `PAUSE_SAFE_SKILLS entry "${id}" is not a registered skill`).toBe(true);
    }
    for (const id of GATED_SKILLS) {
      expect(known.has(id), `GATED_SKILLS entry "${id}" is not a registered skill`).toBe(true);
    }
  });

  it("every pause-safe skill's own body performs no storage mutation and reaches no rail (semantic, not membership)", () => {
    const bodies = skillBodies();
    for (const id of pauseSafeSkills()) {
      const body = bodies.get(id);
      expect(body, `"${id}" is pause-safe but its definition could not be found — the scan went blind for it`).toBeTruthy();
      for (const shape of SKILL_MUTATION_SHAPES) {
        expect(body, `"${id}" is pause-safe but its body matches ${shape}`).not.toMatch(shape);
      }
    }
  });

  it("the side-effecting archetypes can never migrate onto the allowlist", () => {
    const safe = pauseSafeSkills();
    for (const id of [
      "sendEmail",
      "startCollectionSequence",
      "escalateDelinquency",
      "processPayoff",
      "prepareContract",
      "generateClosingPacket",
      "browserResearch",
    ]) {
      expect(safe.has(id), `${id} must never be pause-safe`).toBe(false);
      expect(GATED_SKILLS.has(id), `${id} missing from the gated list`).toBe(true);
    }
  });
});
