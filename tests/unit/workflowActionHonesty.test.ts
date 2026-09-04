/**
 * Workflow action honesty ratchet
 * (Wave A "Nothing lies" → Wave B "Wire the engine", 2026-07-29).
 *
 * The P0 audit found the workflow engine fabricating success:
 *   - `send_email` was a log-only stub returning `{ emailSent: true }` — run
 *     logs said "completed" while no email existed anywhere.
 *   - `run_agent_skill` returned `{ skillExecuted: true }` with no skill
 *     dispatch of any kind (the template skillIds resolve in no registry).
 *   - 44 of 46 templates trigger on events with no runtime emitter, and the
 *     dead parallel /automation surface let customers author rules that
 *     could never run at all.
 *
 * Wave A made the two rail-less handlers say "unavailable" instead of lying.
 * Wave B wired the REAL rails behind them (emailService counterparty lane;
 * skillRegistry dispatch) and real emitters for the lead / property / deal /
 * payment trigger lanes. The INTENT of this ratchet is unchanged and still
 * load-bearing — only the shape of "honest" moved:
 *
 *   1. An action reports success ONLY when a real rail ran and said so.
 *      - `send_email` goes through emailService with purpose "counterparty";
 *        an org with no connected sending identity yields "unavailable" and
 *        NEVER a silent fallback to the platform sender (standing founder
 *        decision, 2026-07-17: BYO identity for counterparty mail).
 *      - `run_agent_skill` dispatches through skillRegistry (after alias
 *        reconciliation); an id that resolves nowhere yields "unavailable"
 *        WITH THE ID NAMED, so the log says which skill does not exist.
 *   2. `unavailable` results are never merged into workflow variables — no
 *      phantom outputs reach downstream steps.
 *   3. Source ratchet: nobody reintroduces a literal `emailSent: true` /
 *      `skillExecuted: true`; success is always read back off a rail result.
 *   4. LIVE_WORKFLOW_TRIGGER_EVENTS (shared/workflow-live-triggers.ts) is
 *      the single source of truth for which trigger events actually fire.
 *      This suite DERIVES that set by scanning server/ for real emit call
 *      sites and asserts the constant equals it exactly, in both directions.
 *      The set may only grow alongside a real emitter — that was the original
 *      intent, now expressed as a derivation instead of a hardcoded list, so
 *      it survives every future wave without being edited.
 *   5. The workflow builder and template gallery import that constant and
 *      badge non-live triggers ("Not yet live").
 *   6. The deleted /automation twin stays deleted: no page, no
 *      /api/automation-rules endpoints, no automation-rule repo methods,
 *      and the /automation route redirects to /workflows.
 *
 * idempotent: true — storage, emailService and the skill registry are all
 * mocked; no DATABASE_URL needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { WORKFLOW_TRIGGER_EVENTS } from "@shared/schema";
import type { PaxControlsState } from "../../server/services/paxControls";
import {
  LIVE_WORKFLOW_TRIGGER_EVENTS,
  isLiveWorkflowTriggerEvent,
} from "@shared/workflow-live-triggers";

// Mock the storage layer before importing the engine — the honesty tests
// exercise executeWorkflow end-to-end without a database.
const createWorkflowRun = vi.fn(async (data: any) => ({ id: 101, ...data }));
const updateWorkflowRun = vi.fn(async (id: number, updates: any) => ({
  id,
  ...updates,
}));
const createTask = vi.fn(async (t: any) => ({ id: 42, ...t }));
const createNotification = vi.fn(async (n: any) => ({ id: 7, ...n }));

vi.mock("../../server/storage", () => ({
  storage: {
    createWorkflowRun: (...args: any[]) => createWorkflowRun(...(args as [any])),
    updateWorkflowRun: (...args: any[]) =>
      updateWorkflowRun(...(args as [number, any])),
    createTask: (...args: any[]) => createTask(...(args as [any])),
    createNotification: (...args: any[]) =>
      createNotification(...(args as [any])),
    getActiveWorkflowsByTrigger: async () => [],
  },
}));

// ── The REAL rails Wave B wired, stood up as doubles ────────────────────────
// The engine imports both dynamically inside the handlers, so mocking the
// modules is enough — and it keeps this suite free of a database.
const sendEmail = vi.fn(async (_opts: any) => ({
  success: true,
  messageId: "ses-msg-1",
  attempts: 1,
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: (...args: any[]) => sendEmail(...(args as [any])) },
}));

// The engine consults the org's Pax controls once per action loop (the ONE
// reader, AUTONOMY_SPEC.md §4.4). getPaxControls fails CLOSED, so without
// this mock every run below would PARK instead of exercising the rails this
// suite is about. The park's own behaviour is pinned in
// tests/unit/paxPauseWorkflowEngine.test.ts; the "paused run never completes"
// case at the bottom of this file is the honesty half of it.
const getPaxControls = vi.fn(async (_orgId: number): Promise<PaxControlsState> => ({
  paused: false,
  pausedUntil: null as Date | null,
  pausedBy: null,
  checkFailed: false,
  stance: "ask_before_sending",
  leadScoring: true,
  borrowerReminders: true,
  inboxDrafts: true,
  timezone: "America/Chicago",
}));
vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls: (...args: any[]) => getPaxControls(...(args as [number])) };
});
// Receipts ("What Pax did") are a side rail of every acting step; stood up
// as a double so this suite stays database-free.
vi.mock("../../server/services/paxReceipts", () => ({
  recordPaxEffect: async () => ({ written: true }),
}));

const getSkillById = vi.fn((_id: string) => undefined as any);
const executeSkill = vi.fn(async (_id: string, _params: any, _ctx: any) => ({
  success: true,
  data: { score: 82 },
  message: "scored",
}));
vi.mock("../../server/services/agent-skills", () => ({
  skillRegistry: {
    getSkillById: (...args: any[]) => getSkillById(...(args as [string])),
    executeSkill: (...args: any[]) =>
      executeSkill(...(args as [string, any, any])),
  },
}));

import {
  workflowEngine,
  ACTION_STATUS_UNAVAILABLE,
  isActionUnavailableResult,
  WORKFLOW_SKILL_ID_ALIASES,
} from "../../server/services/workflow-engine";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

/**
 * Source ratchets below must assert on CODE, not prose. The honest handlers
 * carry comments that quote the very shape they forbid ("do NOT flip this
 * back to `{ emailSent: true }`"), and the deletion of the /automation twin
 * is recorded in a comment naming AutomationPage. Matching raw source makes
 * those ratchets fire on their own documentation — permanently red, and a
 * permanently-red gate is one everybody learns to ignore. Strip comments
 * first so the ratchet means what it says.
 */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const ENGINE_SOURCE = read("server/services/workflow-engine.ts");
const ENGINE_CODE = stripComments(ENGINE_SOURCE);

function makeWorkflow(actions: Array<{ id: string; type: string; config: any }>) {
  return {
    id: 1,
    organizationId: 1,
    name: "honesty-test",
    description: "",
    trigger: { event: "parcel.owner_changed" },
    actions,
    isActive: true,
  } as any;
}

/** The rail refusal an org with NO connected sending identity gets back. */
const NO_CONNECTED_IDENTITY = {
  success: false,
  error:
    "No connected email identity for this organization. Connect your email account or verify your sending domain (Settings → Connections) to email sellers and buyers — platform email is reserved for system notices.",
  errorType: "configuration_error",
  attempts: 0,
  retryable: false,
};

beforeEach(() => {
  getPaxControls.mockClear();
  getPaxControls.mockResolvedValue({
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    timezone: "America/Chicago",
  });
  createWorkflowRun.mockClear();
  updateWorkflowRun.mockClear();
  createTask.mockClear();
  createNotification.mockClear();
  sendEmail.mockClear();
  sendEmail.mockResolvedValue({
    success: true,
    messageId: "ses-msg-1",
    attempts: 1,
  });
  getSkillById.mockReset();
  getSkillById.mockReturnValue(undefined);
  executeSkill.mockClear();
  executeSkill.mockResolvedValue({
    success: true,
    data: { score: 82 },
    message: "scored",
  });
});

describe("actions report success only when a real rail ran (behavioral)", () => {
  it("send_email invokes the REAL emailService counterparty rail on the happy path", async () => {
    const run = await workflowEngine.executeWorkflow(
      makeWorkflow([
        {
          id: "a_email",
          type: "send_email",
          config: { to: "x@example.com", subject: "s", body: "b" },
        },
        {
          id: "a_notify",
          type: "send_notification",
          config: { message: "hello" },
        },
      ]),
      { event: "parcel.owner_changed" as any, entityId: 1, entityType: "parcel", data: {} },
    );

    // The rail really ran, with the BYO-only purpose lane and the org id.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const opts = sendEmail.mock.calls[0][0];
    expect(opts.purpose).toBe("counterparty");
    expect(opts.to).toBe("x@example.com");
    expect(opts.organizationId).toBe(1);

    const log = run.executionLog as any[];
    expect(log[0].actionId).toBe("a_email");
    expect(log[0].status).toBe("completed");
    // Success is READ BACK off the rail, never asserted by the engine.
    expect(log[0].result.emailSent).toBe(true);
    expect(log[0].result.messageId).toBe("ses-msg-1");
    expect(log[1].actionId).toBe("a_notify");
    expect(log[1].status).toBe("completed");
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(run.status).toBe("completed");
  });

  it("an org with NO connected sending identity gets 'unavailable' — never a platform-sender fallback", async () => {
    sendEmail.mockResolvedValue(NO_CONNECTED_IDENTITY as any);

    const run = await workflowEngine.executeWorkflow(
      makeWorkflow([
        {
          id: "a_email",
          type: "send_email",
          config: { to: "x@example.com", subject: "s", body: "b" },
        },
        {
          id: "a_notify",
          type: "send_notification",
          config: { message: "hello" },
        },
      ]),
      { event: "parcel.owner_changed" as any, entityId: 1, entityType: "parcel", data: {} },
    );

    // Exactly ONE attempt. A retry under the platform identity would be the
    // silent re-fronting the 2026-07-17 founder decision forbids.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls.every((c) => c[0].purpose === "counterparty")).toBe(true);
    expect(
      sendEmail.mock.calls.some((c) => c[0].purpose === "system"),
    ).toBe(false);

    const log = run.executionLog as any[];
    expect(log[0].actionId).toBe("a_email");
    expect(log[0].status).toBe(ACTION_STATUS_UNAVAILABLE);
    expect(log[0].status).not.toBe("completed");
    // The recorded result is honest: nothing was sent, and it says why.
    expect(log[0].result.emailSent).toBe(false);
    expect(log[0].result.reason).toMatch(/no email was sent/i);
    expect(log[0].result.reason).toMatch(/connect your email/i);
    // Distinct from a failure: the run continues and later real actions run.
    expect(log[1].actionId).toBe("a_notify");
    expect(log[1].status).toBe("completed");
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(run.status).toBe("completed");
  });

  it("run_agent_skill executes a RESOLVABLE skill through the registry", async () => {
    // The shipped templates use the legacy id `score_lead`; Wave B reconciles
    // it to the registered id via WORKFLOW_SKILL_ID_ALIASES.
    const resolved = WORKFLOW_SKILL_ID_ALIASES["score_lead"];
    expect(resolved).toBeTruthy();
    getSkillById.mockImplementation((id: string) =>
      id === resolved ? ({ id: resolved, name: "Score Lead" } as any) : undefined,
    );

    const run = await workflowEngine.executeWorkflow(
      makeWorkflow([
        {
          id: "a_skill",
          type: "run_agent_skill",
          config: { skillId: "score_lead", skillParams: {} },
        },
      ]),
      { event: "parcel.owner_changed" as any, entityId: 1, entityType: "parcel", data: {} },
    );

    expect(executeSkill).toHaveBeenCalledTimes(1);
    expect(executeSkill.mock.calls[0][0]).toBe(resolved);

    const log = run.executionLog as any[];
    expect(log[0].status).toBe("completed");
    // Again: success is the registry's own answer, echoed back.
    expect(log[0].result.skillExecuted).toBe(true);
    expect(log[0].result.skillId).toBe(resolved);
    expect(log[0].result.skillData).toEqual({ score: 82 });
    expect(run.status).toBe("completed");
  });

  it("run_agent_skill with an UNRESOLVABLE id is 'unavailable' with the id named — nothing ran", async () => {
    getSkillById.mockReturnValue(undefined);

    const run = await workflowEngine.executeWorkflow(
      makeWorkflow([
        {
          id: "a_skill",
          type: "run_agent_skill",
          config: { skillId: "no_such_skill", skillParams: {} },
        },
      ]),
      { event: "parcel.owner_changed" as any, entityId: 1, entityType: "parcel", data: {} },
    );

    // The rail was never invoked — the engine refuses rather than pretends.
    expect(executeSkill).not.toHaveBeenCalled();

    const log = run.executionLog as any[];
    expect(log[0].status).toBe(ACTION_STATUS_UNAVAILABLE);
    expect(log[0].status).not.toBe("completed");
    expect(log[0].result.skillExecuted).toBe(false);
    // The unresolved id is NAMED, so the log says which skill doesn't exist.
    expect(log[0].result.skillId).toBe("no_such_skill");
    expect(log[0].result.reason).toContain("no_such_skill");
    expect(log[0].result.reason).toMatch(/no skill ran/i);
  });

  it("unavailable results are not merged into workflow variables (no phantom outputs downstream)", async () => {
    // A create_task action after an unavailable send_email must not see
    // emailSent/reason interpolated as if they were real workflow data.
    sendEmail.mockResolvedValue(NO_CONNECTED_IDENTITY as any);

    await workflowEngine.executeWorkflow(
      makeWorkflow([
        {
          id: "a_email",
          type: "send_email",
          config: { to: "x@example.com", subject: "s", body: "b" },
        },
        {
          id: "a_task",
          type: "create_task",
          config: { title: "t {{emailSent}}", description: "d" },
        },
      ]),
      { event: "parcel.owner_changed" as any, entityId: 1, entityType: "parcel", data: {} },
    );
    // {{emailSent}} stays an unresolved placeholder — the variable was never set.
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0].title).toBe("t {{emailSent}}");
  });

  it("renders a deliberately-null variable as blank — never the literal 'null' — while an unset variable stays literal", async () => {
    // Emitters send a genuinely-unknown field as null (refuse-not-fabricate).
    // Interpolation must turn that null into blank, NOT the string "null", which
    // would leak into customer-facing task/email/notification copy (a deed-state
    // cert's absent statutory rate, a subdivision gate with no next stage, etc).
    // An UNRESOLVED variable still keeps its literal {{placeholder}}.
    await workflowEngine.executeWorkflow(
      makeWorkflow([
        {
          id: "a_task",
          type: "create_task",
          config: { title: "rate [{{rateVar}}] next [{{missingVar}}] id [{{realVar}}]", description: "d" },
        },
      ]),
      {
        event: "parcel.owner_changed" as any,
        entityId: 1,
        entityType: "parcel",
        data: { rateVar: null, realVar: "cert_1" },
      },
    );
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0].title).toBe("rate [] next [{{missingVar}}] id [cert_1]");
  });

  it("isActionUnavailableResult discriminates correctly", () => {
    expect(
      isActionUnavailableResult({ status: ACTION_STATUS_UNAVAILABLE, reason: "x" }),
    ).toBe(true);
    expect(isActionUnavailableResult({ status: "completed" })).toBe(false);
    expect(isActionUnavailableResult(undefined)).toBe(false);
    expect(isActionUnavailableResult(null)).toBe(false);
  });
});

describe("a paused org's run is parked, never reported as done (honesty of the run outcome)", () => {
  // AUTONOMY_SPEC.md §7: "a paused-org run parks as `waiting` with
  // `resumeState.reason: 'paused'`, never `completed`". Probe that must go
  // red: mark the paused run completed.
  const PAUSED_UNTIL = new Date(Date.now() + 6 * 60 * 60 * 1000);

  it("executeWorkflow on a paused org returns status waiting with reason paused — no rail ran, no step is 'completed'", async () => {
    getPaxControls.mockResolvedValue({
      paused: true,
      pausedUntil: PAUSED_UNTIL,
      pausedBy: { userId: "u-1", name: "Dana" },
      checkFailed: false,
      stance: "ask_before_sending",
      leadScoring: true,
      borrowerReminders: true,
      inboxDrafts: true,
      timezone: "America/Chicago",
    });

    const run = await workflowEngine.executeWorkflow(
      makeWorkflow([
        { id: "a_email", type: "send_email", config: { to: "x@example.com", subject: "s", body: "b" } },
        { id: "a_notify", type: "send_notification", config: { message: "hello" } },
      ]),
      { event: "parcel.owner_changed" as any, entityId: 1, entityType: "parcel", data: {} },
    );

    expect(run.status).toBe("waiting");
    expect(run.status).not.toBe("completed");
    expect(run.resumeAt).toEqual(PAUSED_UNTIL);
    expect((run.resumeState as any).reason).toBe("paused");
    expect((run.resumeState as any).nextActionIndex).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    const log = run.executionLog as any[];
    expect(log.every((e) => e.status !== "completed")).toBe(true);
    // No write ever claimed the run was done.
    expect(updateWorkflowRun.mock.calls.some(([, u]) => u.status === "completed")).toBe(false);
  });

  it("source: the park writes status waiting and never a terminal status", () => {
    const park = ENGINE_CODE.indexOf("private async parkRunPaused(");
    expect(park).toBeGreaterThan(-1);
    const body = ENGINE_CODE.slice(park, ENGINE_CODE.indexOf("\n  private async parkOrSleep(", park));
    expect(body).toMatch(/status:\s*"waiting"/);
    expect(body).not.toMatch(/status:\s*"(completed|failed)"/);
    expect(body).toContain("RESUME_REASON_PAUSED");
  });
});

describe("source ratchet: success is only ever read back off a real rail", () => {
  it("engine source never returns a fabricated `emailSent: true`", () => {
    // The rails are wired now, so the literal is even less excusable than it
    // was: `emailSent` must be `result.success` from emailService, never a
    // constant. The `false` form stays — that's the honest refusal path.
    expect(ENGINE_CODE).not.toMatch(/emailSent:\s*true/);
    expect(ENGINE_CODE).toMatch(/emailSent:\s*false/);
    expect(ENGINE_CODE).toMatch(/emailSent:\s*result\.success/);
  });

  it("engine source never returns a fabricated `skillExecuted: true`", () => {
    expect(ENGINE_CODE).not.toMatch(/skillExecuted:\s*true/);
    expect(ENGINE_CODE).toMatch(/skillExecuted:\s*false/);
    expect(ENGINE_CODE).toMatch(/skillExecuted:\s*result\.success/);
  });

  it("workflow mail goes out on the counterparty (BYO identity) lane only", () => {
    // Founder decision 2026-07-17: no re-fronting the platform sender for
    // counterparty mail. The engine must never ask for the system lane.
    expect(ENGINE_CODE).toMatch(/purpose:\s*"counterparty"/);
    expect(ENGINE_CODE).not.toMatch(/purpose:\s*"system"/);
  });

  it("both non-executing outcomes return ACTION_STATUS_UNAVAILABLE", () => {
    const occurrences =
      ENGINE_SOURCE.match(/status: ACTION_STATUS_UNAVAILABLE/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("executeWorkflow records unavailable steps distinctly (not as completed)", () => {
    expect(ENGINE_SOURCE).toContain("isActionUnavailableResult(result)");
    expect(ENGINE_SOURCE).toContain("ACTION_STATUS_UNAVAILABLE;");
  });
});

// ---------------------------------------------------------------------------
// DERIVED live-trigger set.
//
// Wave A pinned LIVE_WORKFLOW_TRIGGER_EVENTS as a hardcoded two-element list
// ("exactly the two parcel events"). The intent behind that assertion was
// never the literal pair — it was: THE LIST MAY ONLY GROW ALONGSIDE A REAL
// EMITTER. Wave B wired four more lanes, and a hardcoded list would have to be
// hand-edited every wave, which is exactly how a ratchet rots into a rubber
// stamp.
//
// So the expectation is DERIVED from the source instead:
//
//   1. Read each `emit*Event` helper's signature out of the engine — the
//      literal union on its `event` parameter is the set of events it can
//      possibly emit.
//   2. Walk server/, skipping tests and the engine itself, for files that
//      actually CALL one of those helpers (comments stripped, so a helper
//      named in prose is not mistaken for a call site).
//   3. An event is LIVE iff some calling file also contains that event's
//      literal — that pairs the call site with the event it really passes,
//      including the ternary in routes-notes.ts.
//
// The assertion is then two-directional and self-maintaining: an event listed
// with no emitter FAILS, and an emitter shipped without listing its event
// FAILS. Neither can be satisfied by editing an expected array.
// ---------------------------------------------------------------------------

/** `emit*Event` helper name → the event literals its signature declares. */
function emitHelperEventUnions(engineSource: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const decl = /export function (emit\w*Event)\s*\(\s*event:\s*([^,\n]+),/g;
  for (const m of engineSource.matchAll(decl)) {
    const literals = [...m[2].matchAll(/"([^"]+)"/g)].map((l) => l[1]);
    if (literals.length) out.set(m[1], literals);
  }
  return out;
}

function walkTsFiles(dir: string, onFile: (full: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walkTsFiles(full, onFile);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    if (full.endsWith(path.join("services", "workflow-engine.ts"))) continue;
    onFile(full);
  }
}

/** Events with at least one real emit call site outside the engine. */
function deriveLiveEvents(): { events: string[]; sites: Map<string, string[]> } {
  const helpers = emitHelperEventUnions(ENGINE_SOURCE);
  const sites = new Map<string, string[]>();
  walkTsFiles(path.join(ROOT, "server"), (full) => {
    const code = stripComments(fs.readFileSync(full, "utf-8"));
    for (const [helper, events] of helpers) {
      if (!code.includes(`${helper}(`)) continue;
      for (const event of events) {
        if (!code.includes(`"${event}"`)) continue;
        const rel = path.relative(ROOT, full);
        const list = sites.get(event) ?? [];
        if (!list.includes(rel)) list.push(rel);
        sites.set(event, list);
      }
    }
  });
  return { events: [...sites.keys()].sort(), sites };
}

describe("LIVE_WORKFLOW_TRIGGER_EVENTS is the truth about what fires", () => {
  const { events: derived, sites } = deriveLiveEvents();
  const listed = [...LIVE_WORKFLOW_TRIGGER_EVENTS].sort();

  it("the emit helpers are discoverable at all (guards the derivation itself)", () => {
    // A derived ratchet that derives nothing is a green light for anything.
    const helpers = emitHelperEventUnions(ENGINE_SOURCE);
    expect(helpers.size).toBeGreaterThanOrEqual(5);
    expect(helpers.get("emitParcelEvent")).toContain("parcel.owner_changed");
    expect(derived.length).toBeGreaterThan(0);
  });

  it("every listed event has a real emit call site in server/", () => {
    const phantom = listed.filter((e) => !sites.has(e));
    expect(
      phantom,
      `Listed in shared/workflow-live-triggers.ts but NOTHING emits them, so ` +
        `the UI would stop badging a trigger that still never fires: ` +
        `${phantom.join(", ")}`,
    ).toEqual([]);
  });

  it("no event with a real emitter is missing from the list", () => {
    const unlisted = derived.filter((e) => !listed.includes(e));
    expect(
      unlisted,
      `These events have a real emit call site but are NOT in ` +
        `shared/workflow-live-triggers.ts, so the UI still badges them "Not ` +
        `yet live" while they fire:\n` +
        unlisted.map((e) => `  ${e} ← ${(sites.get(e) ?? []).join(", ")}`).join("\n"),
    ).toEqual([]);
  });

  it("the list is EXACTLY the derived set (grows only alongside a real emitter)", () => {
    expect(listed).toEqual(derived);
  });

  it("every live event is a declared member of the shared trigger union", () => {
    const shared = new Set<string>(WORKFLOW_TRIGGER_EVENTS);
    for (const event of LIVE_WORKFLOW_TRIGGER_EVENTS) {
      expect(shared.has(event), `${event} must be in WORKFLOW_TRIGGER_EVENTS`).toBe(true);
    }
  });

  it("the parcel lane's emitter is still the parcelDeltaDetector", () => {
    const detector = read("server/services/parcelDeltaDetector.ts");
    expect(detector).toContain("emitParcelEvent(");
    expect(sites.get("parcel.owner_changed")).toContain(
      path.join("server", "services", "parcelDeltaDetector.ts"),
    );
  });

  it("nothing bypasses the typed helpers with a raw workflowEngine.emit()", () => {
    // The derivation reads `emit*Event` signatures. A direct
    // `workflowEngine.emit({ event })` call would emit an event the
    // derivation cannot see — i.e. a live trigger the list would miss.
    const offenders: string[] = [];
    walkTsFiles(path.join(ROOT, "server"), (full) => {
      const code = stripComments(fs.readFileSync(full, "utf-8"));
      if (code.includes("workflowEngine.emit(")) {
        offenders.push(path.relative(ROOT, full));
      }
    });
    expect(
      offenders,
      `Raw workflowEngine.emit() outside the engine — route it through a ` +
        `typed emit*Event helper so the live-trigger list stays derivable:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("isLiveWorkflowTriggerEvent agrees with the derived set", () => {
    for (const event of derived) {
      expect(isLiveWorkflowTriggerEvent(event), `${event} should be live`).toBe(true);
    }
    // A declared trigger with no emitter must still report false — pick one
    // from the shared union rather than naming an event that may go live.
    const notLive = (WORKFLOW_TRIGGER_EVENTS as readonly string[]).filter(
      (e) => !derived.includes(e),
    );
    expect(notLive.length).toBeGreaterThan(0);
    for (const event of notLive) {
      expect(isLiveWorkflowTriggerEvent(event), `${event} should NOT be live`).toBe(false);
    }
  });
});

describe("UI badges non-live triggers honestly", () => {
  const BUILDER = read("client/src/components/workflow-builder.tsx");
  const WORKFLOWS_PAGE = read("client/src/pages/workflows.tsx");

  it("workflow builder imports the shared live-trigger constant and badges non-live options", () => {
    expect(BUILDER).toContain('from "@shared/workflow-live-triggers"');
    expect(BUILDER).toContain("isLiveWorkflowTriggerEvent");
    expect(BUILDER).toContain("Not yet live");
    expect(BUILDER).toContain("TRIGGER_NOT_LIVE_MESSAGE");
  });

  it("template gallery + installed list badge non-live triggers (badge persists after install)", () => {
    expect(WORKFLOWS_PAGE).toContain('from "@shared/workflow-live-triggers"');
    expect(WORKFLOWS_PAGE).toContain("isLiveWorkflowTriggerEvent");
    // Installed workflows keep the badge:
    expect(WORKFLOWS_PAGE).toContain("badge-trigger-not-live");
    // Templates in the gallery carry it too:
    expect(WORKFLOWS_PAGE).toContain("badge-template-not-live");
  });
});

describe("the /automation twin stays deleted", () => {
  it("the automation page is gone", () => {
    expect(fs.existsSync(path.join(ROOT, "client/src/pages/automation.tsx"))).toBe(
      false,
    );
  });

  it("no /api/automation-rules or /api/automation-executions endpoints are registered", () => {
    const routes = read("server/routes-analytics.ts");
    expect(routes).not.toMatch(
      /api\.(get|post|put|delete)\(\s*["']\/api\/automation-(rules|executions)/,
    );
  });

  it("automationRepo has no automation-rule/execution methods", () => {
    const repo = read("server/storage/automationRepo.ts");
    expect(repo).not.toMatch(
      /async\s+(get|create|update|delete|toggle)Automation(Rules?|Executions?)\s*\(/,
    );
  });

  it("/automation redirects to /workflows (no orphaned links 404)", () => {
    const app = read("client/src/App.tsx");
    const idx = app.indexOf('path="/automation"');
    expect(idx).toBeGreaterThan(-1);
    const routeBlock = app.slice(idx, idx + 300);
    expect(routeBlock).toContain('Redirect to="/workflows"');
    // Code only — the deletion is deliberately recorded in a comment that
    // names AutomationPage, and that record should not trip its own ratchet.
    expect(stripComments(app)).not.toContain("AutomationPage");
  });
});
