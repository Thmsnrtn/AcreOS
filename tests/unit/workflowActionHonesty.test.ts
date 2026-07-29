/**
 * Workflow action honesty ratchet (Wave A "Nothing lies", 2026-07-29).
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
 * This suite pins the honest state:
 *   1. The two rail-less action handlers return an `unavailable` result
 *      (never fabricated success), and executeWorkflow records that step in
 *      the run log with status "unavailable" — distinct from "completed"
 *      and "failed".
 *   2. Source ratchet: nobody flips the stubs back to `emailSent: true` /
 *      `skillExecuted: true` without wiring a real rail (and consciously
 *      updating this test).
 *   3. LIVE_WORKFLOW_TRIGGER_EVENTS (shared/workflow-live-triggers.ts) is
 *      the single source of truth for which trigger events actually fire:
 *      every listed event has a real emit call site, and no OTHER emit
 *      helper has a call site outside the engine (add one → update the
 *      list in the same change, this test forces it).
 *   4. The workflow builder and template gallery import that constant and
 *      badge non-live triggers ("Not yet live").
 *   5. The deleted /automation twin stays deleted: no page, no
 *      /api/automation-rules endpoints, no automation-rule repo methods,
 *      and the /automation route redirects to /workflows.
 *
 * idempotent: true — storage is fully mocked; no DATABASE_URL needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { WORKFLOW_TRIGGER_EVENTS } from "@shared/schema";
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

import {
  workflowEngine,
  ACTION_STATUS_UNAVAILABLE,
  isActionUnavailableResult,
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

beforeEach(() => {
  createWorkflowRun.mockClear();
  updateWorkflowRun.mockClear();
  createTask.mockClear();
  createNotification.mockClear();
});

describe("rail-less actions never fabricate success (behavioral)", () => {
  it("send_email is recorded as 'unavailable' in the run log, not 'completed'", async () => {
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

    const log = run.executionLog as any[];
    expect(log[0].actionId).toBe("a_email");
    expect(log[0].status).toBe(ACTION_STATUS_UNAVAILABLE);
    expect(log[0].status).not.toBe("completed");
    // The recorded result is honest: nothing was sent, and it says why.
    expect(log[0].result.emailSent).toBe(false);
    expect(log[0].result.reason).toMatch(/not yet available/i);
    expect(log[0].result.reason).toMatch(/no email was sent/i);
    // Distinct from a failure: the run continues and later real actions run.
    expect(log[1].actionId).toBe("a_notify");
    expect(log[1].status).toBe("completed");
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(run.status).toBe("completed");
  });

  it("run_agent_skill is recorded as 'unavailable' with the unresolved skillId named", async () => {
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

    const log = run.executionLog as any[];
    expect(log[0].status).toBe(ACTION_STATUS_UNAVAILABLE);
    expect(log[0].result.skillExecuted).toBe(false);
    expect(log[0].result.skillId).toBe("score_lead");
    expect(log[0].result.reason).toMatch(/not yet available/i);
    expect(log[0].result.reason).toMatch(/nothing ran/i);
  });

  it("unavailable results are not merged into workflow variables (no phantom outputs downstream)", async () => {
    // A create_task action after send_email must not see emailSent/reason
    // interpolated as if they were real workflow data.
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

  it("isActionUnavailableResult discriminates correctly", () => {
    expect(
      isActionUnavailableResult({ status: ACTION_STATUS_UNAVAILABLE, reason: "x" }),
    ).toBe(true);
    expect(isActionUnavailableResult({ status: "completed" })).toBe(false);
    expect(isActionUnavailableResult(undefined)).toBe(false);
    expect(isActionUnavailableResult(null)).toBe(false);
  });
});

describe("source ratchet: the stubs stay honest until a real rail is wired", () => {
  it("engine source never returns a fabricated `emailSent: true`", () => {
    // Flipping this back requires invoking a REAL delivery rail — and
    // consciously updating this test alongside that wiring.
    expect(ENGINE_CODE).not.toMatch(/emailSent:\s*true/);
    expect(ENGINE_CODE).toMatch(/emailSent:\s*false/);
  });

  it("engine source never returns a fabricated `skillExecuted: true`", () => {
    expect(ENGINE_CODE).not.toMatch(/skillExecuted:\s*true/);
    expect(ENGINE_CODE).toMatch(/skillExecuted:\s*false/);
  });

  it("both rail-less handlers return ACTION_STATUS_UNAVAILABLE", () => {
    const occurrences =
      ENGINE_SOURCE.match(/status: ACTION_STATUS_UNAVAILABLE/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("executeWorkflow records unavailable steps distinctly (not as completed)", () => {
    expect(ENGINE_SOURCE).toContain("isActionUnavailableResult(result)");
    expect(ENGINE_SOURCE).toContain("ACTION_STATUS_UNAVAILABLE;");
  });
});

describe("LIVE_WORKFLOW_TRIGGER_EVENTS is the truth about what fires", () => {
  it("is exactly the two parcel events (grow it ONLY alongside a new emitter)", () => {
    expect([...LIVE_WORKFLOW_TRIGGER_EVENTS]).toEqual([
      "parcel.owner_changed",
      "parcel.tax_status_changed",
    ]);
  });

  it("every live event is a declared member of the shared trigger union", () => {
    const shared = new Set<string>(WORKFLOW_TRIGGER_EVENTS);
    for (const event of LIVE_WORKFLOW_TRIGGER_EVENTS) {
      expect(shared.has(event), `${event} must be in WORKFLOW_TRIGGER_EVENTS`).toBe(true);
    }
  });

  it("the live events really have an emit call site (parcelDeltaDetector)", () => {
    const detector = read("server/services/parcelDeltaDetector.ts");
    expect(detector).toContain("emitParcelEvent(");
  });

  it("no OTHER emit helper has a call site outside the engine — if this fails, an event went live: add it to LIVE_WORKFLOW_TRIGGER_EVENTS", () => {
    const helpers = [
      "emitLeadEvent(",
      "emitPropertyEvent(",
      "emitDealEvent(",
      "emitPaymentEvent(",
      "workflowEngine.emit(",
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(full);
        } else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts") &&
          !full.endsWith(path.join("services", "workflow-engine.ts"))
        ) {
          const src = fs.readFileSync(full, "utf-8");
          for (const helper of helpers) {
            if (src.includes(helper)) {
              offenders.push(`${path.relative(ROOT, full)} calls ${helper})`);
            }
          }
        }
      }
    };
    walk(path.join(ROOT, "server"));
    // parcelDeltaDetector's emitParcelEvent call is the ONLY expected one,
    // and it is deliberately not in the helpers list above.
    expect(
      offenders,
      `New workflow-event emit call site(s) found. That means an event went ` +
        `live — add it to shared/workflow-live-triggers.ts in the same ` +
        `change so the UI stops badging it "Not yet live":\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("isLiveWorkflowTriggerEvent agrees with the list", () => {
    expect(isLiveWorkflowTriggerEvent("parcel.owner_changed")).toBe(true);
    expect(isLiveWorkflowTriggerEvent("lead.created")).toBe(false);
    expect(isLiveWorkflowTriggerEvent("payment.missed")).toBe(false);
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
