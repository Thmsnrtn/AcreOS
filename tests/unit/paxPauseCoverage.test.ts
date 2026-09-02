/**
 * Pax pause — the POPULATION gate (pause coverage program, 2026-09-02).
 *
 * /settings/pax promises "Stops every auto-execution path … enforced
 * server-side". Until this program the switch was read at five points while
 * six more unattended engines ran straight through it: the workflow engine
 * (sends, record writes, notifications, skill dispatch), the sequence
 * processor (drip email / SMS / direct mail), lead nurturing (score writes,
 * follow-up scheduling, LLM spend), the autonomous task processor
 * (auto-executes agent tasks), the skill registry (every engine's dispatch
 * point) and the scheduled task runner. Each was green on its own tests and
 * blind to the switch — CLAUDE.md's third law, again.
 *
 * This suite pins the population the way that law prescribes:
 *   1. An explicit enumeration of every enforcement point — file, the
 *      function that dispatches, the org-scoped gate call, and a code anchor
 *      the gate must PRECEDE — so "gated" means "gated before dispatch", not
 *      "the symbol appears somewhere in the file".
 *   2. Two-directional: the set of production files that call
 *      getPaxPauseState is DERIVED by walking server/ and must equal the
 *      enumeration (plus the definition and the one read-only consumer). A
 *      new engine that adopts the gate without being listed here fails; a
 *      listed engine that drops the call fails.
 *   3. Classification is total: every workflow action type is either control
 *      flow or pause-gated; every registered skill is either on
 *      PAUSE_SAFE_SKILLS (and classified read-only in SKILL_RISK) or on the
 *      gated list below. Nothing defaults into either set unseen.
 *   4. Vacuity guards on every extraction, and paxPause.ts's header must name
 *      every enforcement point — prose that drifts from code is the defect the
 *      dossier recorded ("the five enforcement points", while there were six).
 *
 * Behaviour per engine (mock paused → assert skip/defer and no send) lives in
 * paxPauseWorkflowEngine / paxPauseSequenceProcessor / paxPauseUnattendedJobs
 * / paxPauseSkillGate; the tool-layer gates keep paxPauseToolGate and
 * paxPauseSupportGate.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { WORKFLOW_ACTION_TYPES } from "@shared/schema";

// The skill-classification cases import the REAL registry and the REAL risk
// map (never copies). Both modules pull the DB at load; neither queries it.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
/** Ratchets assert on CODE, not prose — a comment naming the gate is not a gate. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

interface EnforcementPoint {
  file: string;
  /** The dispatching function the gate must live inside. */
  fn: string;
  /** The exact, org-scoped gate call. */
  gate: string;
  /** Real dispatch code inside `fn` that the gate must come BEFORE. */
  before: string;
}

/**
 * Every unattended-execution entry point. Adding an engine means adding a row
 * here AND a line to paxPause.ts's header — the two-directional case below
 * makes forgetting either one a red test, not a silent gap.
 */
const PAUSE_ENFORCEMENT_POINTS: readonly EnforcementPoint[] = [
  // Model-driven tool dispatch
  {
    file: "server/ai/tools.ts",
    fn: "export async function executeTool(",
    gate: "getPaxPauseState(org.id)",
    before: "scopeForIntent(toolName)",
  },
  {
    file: "server/ai/supportAgent.ts",
    fn: "export async function executeSupportTool",
    gate: "getPaxPauseState(org.id)",
    before: "switch (toolName)",
  },
  // Scheduled / autonomous Pax surfaces
  {
    file: "server/services/paxScheduler.ts",
    fn: "export async function processPaxScheduledTasks",
    gate: "getPaxPauseState(org.id)",
    before: "await executeTask(task, org)",
  },
  {
    file: "server/services/autonomousDecisionExecutor.ts",
    fn: "async function processInboxItem(",
    gate: "getPaxPauseState(item.organizationId)",
    before: "companyAgentService.getOwnerForDecisionType(",
  },
  {
    file: "server/services/financeAgent.ts",
    fn: "async dispatchReminder(",
    gate: "getPaxPauseState(orgId)",
    before: "getOrgAutonomyLevel(orgId)",
  },
  // Unattended execution engines (pause coverage, 2026-09-02)
  {
    file: "server/services/workflow-engine.ts",
    fn: "async executeAction(",
    gate: "getPaxPauseState(context.organizationId)",
    before: "switch (action.type",
  },
  {
    file: "server/services/sequenceProcessor.ts",
    fn: "async sendStep(",
    gate: "getPaxPauseState(enrollment.sequence.organizationId)",
    before: "canSendViaChannel(lead, step.channel",
  },
  {
    file: "server/services/leadNurturer.ts",
    fn: "async processLeadsForOrg(",
    gate: "getPaxPauseState(organizationId)",
    before: "storage.setJobStatus(JOB_TYPE, 'running')",
  },
  {
    file: "server/jobs/autonomousTaskProcessor.ts",
    fn: "async function processBatch(",
    gate: "getPaxPauseState(task.organizationId)",
    before: "autonomousAgentEngine.evaluate(",
  },
  {
    file: "server/services/agent-skills.ts",
    fn: "async executeSkill(",
    gate: "getPaxPauseState(context.organizationId)",
    before: "skill.execute(validatedParams, context)",
  },
  {
    file: "server/services/task-runner.ts",
    fn: "async runTask(",
    gate: "getPaxPauseState(task.organizationId)",
    before: "await this.executeTask(task)",
  },
];

const PAUSE_DEFINITION = "server/services/paxPause.ts";
/**
 * Read the state to DISPLAY or RECORD it; enforce nothing.
 *   - routes-autonomy.ts: the settings surface's org-wide banner.
 *   - paxAskExecutors.ts: reads getPaxControls for stance attribution on the
 *     ask receipt only (wave 0) — the executor's own gates are the kernel's.
 */
const PAUSE_READ_ONLY_CONSUMERS = [
  "server/routes-autonomy.ts",
  "server/services/paxAskExecutors.ts",
];
/**
 * Modules that WRAP the primitive for their own consumers (AUTONOMY_SPEC
 * §4.2's "one reader", `getPaxControls(orgId)`, folds the pause into the
 * org's stance). An aggregator is not an enforcement point — the engine that
 * consults it is — so it may call the primitive without being enumerated
 * above, and an enumerated engine may gate through the aggregator instead of
 * the primitive (see GATE_FORMS). Tolerant of absence: nothing here is
 * required to exist.
 */
const PAUSE_STATE_AGGREGATORS = ["server/services/paxControls.ts"];
/** The call shapes that count as "consulted the org's pause state". */
const PRIMITIVE_CALL = "getPaxPauseState(";
const AGGREGATOR_CALL = "getPaxControls(";
/** Both accepted forms of a point's gate: the primitive, or the aggregator. */
function gateForms(gate: string): string[] {
  return [gate, gate.replace(PRIMITIVE_CALL, AGGREGATOR_CALL)];
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

/**
 * Every production file under server/ whose CODE consults the pause state —
 * through the primitive or the aggregator. Aggregators themselves are
 * excluded: they are the wrapper, not a consumer. Every file found here must
 * be enumerated as an enforcement point, a read-only consumer, or the
 * definition; nothing may consult the switch anonymously.
 */
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
  const code = stripComments(read(rel));
  return code.includes(PRIMITIVE_CALL) || code.includes(AGGREGATOR_CALL);
}

describe("every unattended-execution entry point is inside the Pax pause population", () => {
  it.each(PAUSE_ENFORCEMENT_POINTS.map((p) => [p.file, p] as const))(
    "%s gates inside its dispatch function, before dispatch",
    (_file, point) => {
      const code = stripComments(read(point.file));
      const fnAt = code.indexOf(point.fn);
      expect(fnAt, `${point.file}: dispatch function "${point.fn}" not found — repin`).toBeGreaterThan(-1);
      const gateAt = Math.max(...gateForms(point.gate).map((g) => code.indexOf(g, fnAt)));
      expect(gateAt, `${point.file}: pause gate "${point.gate}" missing from ${point.fn}`).toBeGreaterThan(-1);
      const beforeAt = code.indexOf(point.before, fnAt);
      expect(beforeAt, `${point.file}: dispatch anchor "${point.before}" not found — repin`).toBeGreaterThan(-1);
      expect(gateAt, `${point.file}: the pause gate must run BEFORE dispatch`).toBeLessThan(beforeAt);
      // The gate reads the state, it does not merely import the symbol.
      expect(code.slice(gateAt - 40, gateAt)).toMatch(/await\s+$/);
    },
  );

  it("the set of production callers is exactly the enumeration (derived from server/, both directions)", () => {
    const expected = [
      ...PAUSE_ENFORCEMENT_POINTS.map((p) => p.file),
      PAUSE_DEFINITION,
      ...PAUSE_READ_ONLY_CONSUMERS,
    ].sort();
    const derived = derivedPauseCallers();
    // Vacuity: the derivation must see a real population, not an empty walk.
    expect(derived.length).toBeGreaterThanOrEqual(PAUSE_ENFORCEMENT_POINTS.length);
    const unlisted = derived.filter((f) => !expected.includes(f));
    // "Missing" is judged per enumerated file by EITHER accepted form, so an
    // engine that moves from the primitive to the aggregator stays present.
    const missing = expected.filter((f) => !consultsPauseState(f));
    expect(
      unlisted,
      "a production file consults the pause state but is not enumerated: add it to " +
        "PAUSE_ENFORCEMENT_POINTS (with its dispatch anchor); if it only displays " +
        "the state, to PAUSE_READ_ONLY_CONSUMERS; if it only wraps the primitive " +
        "for other consumers, to PAUSE_STATE_AGGREGATORS — and to paxPause.ts's header",
    ).toEqual([]);
    expect(missing, "an enumerated file no longer consults the pause state").toEqual([]);
  });

  it("paxPause.ts's header names every enforcement point and the read-only consumer", () => {
    const header = read(PAUSE_DEFINITION);
    for (const p of PAUSE_ENFORCEMENT_POINTS) {
      expect(header, `paxPause.ts header must name ${p.file}`).toContain(p.file);
    }
    for (const f of PAUSE_READ_ONLY_CONSUMERS) {
      expect(header).toContain(f);
    }
    // The header must not restate a count that can go stale ("the five …").
    expect(header).not.toMatch(/\bthe (five|six|seven|eight|nine|ten|eleven|twelve)\s+enforcement points\b/i);
  });

  it("a pause never cancels or fails work — the engines skip or defer (source pins)", () => {
    // Each engine's paused branch must not write a terminal state. These are
    // the literals each engine uses for "gave up"; none may sit inside the
    // pause branch. Cheap belt-and-braces over the behavioural suites.
    const processor = stripComments(read("server/jobs/autonomousTaskProcessor.ts"));
    const gateAt = processor.indexOf("if (pause.paused) {");
    const tryAt = processor.indexOf("try {", gateAt);
    const pauseBranch = processor.slice(gateAt, tryAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(pauseBranch).toContain("continue;");
    expect(pauseBranch).not.toMatch(/status:\s*"(failed|cancelled|completed|processing)"/);

    const runner = stripComments(read("server/services/task-runner.ts"));
    const runnerGate = runner.indexOf("if (pause.paused) {");
    const runnerBranch = runner.slice(runnerGate, runner.indexOf("}", runner.indexOf("return {", runnerGate)));
    expect(runnerGate).toBeGreaterThan(-1);
    expect(runnerBranch).not.toContain("updateScheduledTask(");
    expect(runnerBranch).not.toContain("nextRunAt");

    const seq = stripComments(read("server/services/sequenceProcessor.ts"));
    const seqGate = seq.indexOf("if (pause.paused) {");
    const seqBranch = seq.slice(seqGate, seq.indexOf("return {", seqGate) + 60);
    expect(seqGate).toBeGreaterThan(-1);
    expect(seqBranch).toMatch(/status:\s*"deferred"/);
    expect(seqBranch).not.toMatch(/status:\s*"(skipped|failed)"/);
  });
});

describe("workflow actions are classified — control flow or pause-gated, nothing unlisted", () => {
  function gatedWorkflowActions(): Set<string> {
    const src = read("server/services/workflow-engine.ts");
    const m = src.match(
      /const PAUSE_GATED_WORKFLOW_ACTIONS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/,
    );
    expect(m, "PAUSE_GATED_WORKFLOW_ACTIONS literal not found").toBeTruthy();
    return new Set([...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
  }

  it("every WORKFLOW_ACTION_TYPES member except `delay` is pause-gated, and nothing else is", () => {
    // Vacuity: the schema must look like this repo's schema.
    expect(WORKFLOW_ACTION_TYPES.length).toBeGreaterThanOrEqual(6);
    expect(WORKFLOW_ACTION_TYPES).toContain("delay");
    const expected = new Set(WORKFLOW_ACTION_TYPES.filter((t) => t !== "delay"));
    const gated = gatedWorkflowActions();
    expect([...gated].sort()).toEqual([...expected].sort());
  });
});

// ── Skill classification ─────────────────────────────────────────────────────
// Imported (not copied): the REAL registry decides what exists, the REAL risk
// map decides what each skill does. The allowlist is read out of the source
// literal — it is deliberately not exported (reachability lint).

const { _SKILL_RISK } = await import("../../server/jobs/autonomousTaskProcessor");
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

describe("every registered skill is classified for the pause — safe or gated, never unlisted", () => {
  const registered = skillRegistry.getAllSkills().map((s) => s.id);

  it("vacuity: the registry and the allowlist are their real size", () => {
    expect(registered.length).toBeGreaterThan(20);
    expect(pauseSafeSkills().size).toBeGreaterThanOrEqual(10);
    expect(Object.keys(_SKILL_RISK).length).toBeGreaterThan(20);
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

  it("every pause-safe skill is classified read-only in SKILL_RISK (research/draft, not external, reversible)", () => {
    for (const id of pauseSafeSkills()) {
      const risk = _SKILL_RISK[id];
      expect(risk, `"${id}" is pause-safe but has no SKILL_RISK classification`).toBeTruthy();
      expect(["research", "draft"], `"${id}" is pause-safe but classified "${risk.category}"`).toContain(risk.category);
      expect(risk.external, `"${id}" is pause-safe but reaches outside the org`).not.toBe(true);
      expect(risk.irreversible, `"${id}" is pause-safe but irreversible`).not.toBe(true);
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
      // And SKILL_RISK agrees these are not read-only.
      const risk = _SKILL_RISK[id];
      expect(risk && (risk.external === true || !["research", "draft"].includes(risk.category))).toBe(true);
    }
  });
});
