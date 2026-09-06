/**
 * The execution engine acts on ids it was HANDED, so every one is a tenant boundary.
 *
 * `executionEngine.execute({ orgId, action, input })` is driven by autonomous
 * agents, by the v14 reactive orchestrator, and — until 2026-09-05 — by a
 * scheduled consensus executor that read every org's resolved dialogues and ran
 * each one under a hardcoded `orgId: 0`. The entity ids arrive inside `input`,
 * from a model's decision or a stored JSON payload. None of them is chosen by
 * this engine.
 *
 * Three handlers resolved those ids by bare primary key:
 *
 *     db.update(tasks).set({status:"completed"}).where(eq(tasks.id, taskId))
 *     db.update(leads).set({status:newStatus}).where(eq(leads.id, leadId))
 *     db.update(deals).set({status:newStage}).where(eq(deals.id, dealId))
 *
 * `tasks.organization_id`, `leads.organization_id` and `deals.organization_id`
 * are all `NOT NULL` tenant keys with a foreign key to `organizations`, and
 * `ctx.orgId` was sitting right there — `create_task` two lines above uses it.
 * So an id from one tenant mutated another tenant's row.
 *
 * And then it SAID SO: each returned `success({...}, ["Task N completed"])`
 * unconditionally, whether or not any row matched. That is the second half of
 * the same defect and the one this repo names explicitly — a tool may not
 * report an effect it did not have.
 *
 * This suite pins both halves against the real handlers:
 *   1. the predicate must name the tenant column (introspected from the drizzle
 *      SQL the handler actually built, not grepped from the source), and
 *   2. when nothing matched, the handler must FAIL rather than announce.
 *
 * The handlers are driven THROUGH THE REGISTRY, not through `execute()`.
 * `execute()` runs the safety gates first, and `advance_deal_stage` is
 * structurally founder-gated — it is refused there and its handler never runs.
 * A suite driven through `execute()` therefore reads the GATE's refusal as if
 * it were the handler's, which is a pass over a unit that was never executed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

// ── db mock: capture predicates, control what "matched" ──────────────────────
interface Captured { where: unknown }
const captured: Captured[] = [];
/** What the next `.returning()` resolves to — i.e. which rows actually matched. */
let returningRows: Array<Record<string, unknown>> = [];
/**
 * What a pre-read `.limit()` resolves to.
 *
 * ADDED 2026-09-06, when `update_lead_status` and `advance_deal_stage` started
 * reading the row's CURRENT status before writing, so they can validate the
 * change against LEAD_STATUS_TRANSITIONS / DEAL_STATUS_TRANSITIONS. That read
 * is a second tenant boundary in each handler and is asserted as one below —
 * it is not enough that the WRITE names the org if the read that authorises it
 * does not.
 */
let currentRows: Array<Record<string, unknown>> = [];
/** Only the predicates issued by a SELECT, so the pre-read can be checked alone. */
const preReads: Array<{ where: unknown }> = [];
const insertedRows: Array<Record<string, any>> = [];

vi.mock("../../server/db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [{ count: 1 }] }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: Record<string, any>) => {
        insertedRows.push(row);
        return Promise.resolve([]);
      }),
    })),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((where: unknown) => {
          captured.push({ where });
          preReads.push({ where });
          return { limit: vi.fn().mockResolvedValue(currentRows) };
        }),
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((where: unknown) => {
          captured.push({ where });
          // Both shapes: awaited directly (legacy) or `.returning()`.
          const p: any = Promise.resolve(returningRows);
          p.returning = () => Promise.resolve(returningRows);
          return p;
        }),
      }),
    })),
  },
}));

// Gates mocked open so the handlers themselves are what is under test.
vi.mock("../../server/services/trustAuthorityEscalation", () => ({
  trustAuthorityEscalation: {
    isActionAllowed: vi.fn().mockReturnValue(true),
    getTier: vi.fn().mockReturnValue({ label: "test", allowedActions: [] }),
  },
}));
vi.mock("../../server/services/companyAgents", () => ({
  companyAgentService: {
    getByCodename: vi.fn().mockResolvedValue(undefined),
    effectiveTrustScore: vi.fn().mockResolvedValue(100),
  },
}));
vi.mock("../../server/services/governanceBrainV13", () => ({
  governanceBrainService: {
    evaluateAction: vi.fn().mockResolvedValue({ overallResult: "allowed", explanation: "test" }),
  },
}));
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: { publish: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../server/websocket", () => ({
  wsServer: { broadcastFounderEvent: vi.fn(), broadcast: vi.fn() },
}));

import { executionEngine } from "../../server/services/executionEngine";

const ORG = 42;

/**
 * Every handler that resolves a CALLER-SUPPLIED entity id against a tenant
 * table. This list is the population claim, so it is checked against the source
 * below rather than trusted: a fourth handler of this shape must fail here.
 */
const ID_HANDLERS = [
  { action: "complete_task", input: { taskId: 7 }, table: "tasks", said: /Task 7 completed/, current: "open" },
  // WERE `newStatus: "warm"` and `newStage: "closing"`. NEITHER IS A REAL
  // STATUS — "warm" is not in LEAD_STATUSES and "closing" is not in
  // DEAL_STATUSES — and this suite asserted that both SUCCEEDED, which is
  // exactly the write the vocabulary exists to prevent. The stub is real now
  // (2026-09-06): both handlers validate against the canonical table, so the
  // fixtures move to values that exist and transitions that are legal, and the
  // refusal gets its own assertions below. The original invariants — the
  // predicate names the tenant column, and nothing is announced when no row
  // matched — are untouched.
  {
    action: "update_lead_status",
    input: { leadId: 7, newStatus: "contacted" },
    table: "leads",
    said: /Lead 7 status/,
    current: "new",
  },
  {
    action: "advance_deal_stage",
    input: { dealId: 7, newStage: "offer_sent" },
    table: "deals",
    said: /Deal 7 advanced/,
    current: "negotiating",
  },
] as const;

/** Column names inside a drizzle SQL predicate, at any nesting depth. */
function columnsIn(node: any, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (typeof node.name === "string" && node.table) out.push(node.name);
  if (Array.isArray(node.queryChunks)) node.queryChunks.forEach((c: any) => columnsIn(c, out));
  return out;
}

beforeEach(() => {
  captured.length = 0;
  preReads.length = 0;
  insertedRows.length = 0;
  returningRows = [];
  currentRows = [{ status: "new" }];
});

describe("executionEngine: caller-supplied ids are scoped to the executing org", () => {
  /** The handler itself, refusing to let the safety gate answer for it. */
  function handlerFor(action: string) {
    const executor = executionEngine.getActionExecutor(action);
    expect(executor, `no executor registered for ${action}`).toBeTypeOf("function");
    return executor!;
  }

  it.each(ID_HANDLERS)("$action names the tenant column in its predicate", async (h) => {
    returningRows = [{ id: 7 }];
    currentRows = [{ status: h.current }];
    await handlerFor(h.action)({
      orgId: ORG, agentCodename: "test-agent", action: h.action, input: { ...h.input },
    } as any);

    expect(captured.length, `${h.action} issued no query at all`).toBeGreaterThan(0);
    const cols = captured.flatMap((c) => columnsIn(c.where));
    // Vacuity: the walker must actually see the id it filtered by, otherwise
    // "organization_id is absent" would be indistinguishable from "the walker
    // stopped reading predicates".
    expect(cols, `no columns readable in ${h.action}'s predicate`).toContain("id");
    expect(cols).toContain("organization_id");
  });

  it.each(ID_HANDLERS.filter((h) => h.action !== "complete_task"))(
    "$action's authorising PRE-READ is org-scoped too",
    async (h) => {
      // The status validation added on 2026-09-06 reads the row's current
      // status to decide whether the transition is legal. That read decides
      // whether a write is allowed, so it is a tenant boundary in its own
      // right: a pre-read by bare primary key would let one org's row
      // authorise a transition applied to... nothing, but it would also leak
      // that row's status through the refusal message. It names the org.
      returningRows = [{ id: 7 }];
      currentRows = [{ status: h.current }];
      await handlerFor(h.action)({
        orgId: ORG, agentCodename: "test-agent", action: h.action, input: { ...h.input },
      } as any);

      expect(preReads.length, `${h.action} issued no SELECT — the pre-read is gone`)
        .toBeGreaterThan(0);
      const cols = columnsIn(preReads[0].where);
      expect(cols, `no columns readable in ${h.action}'s pre-read predicate`).toContain("id");
      expect(cols).toContain("organization_id");
    },
  );

  it.each(ID_HANDLERS)("$action reports nothing when no row matched", async (h) => {
    returningRows = []; // the id belonged to another tenant, or to nobody
    // The pre-read still finds the row, so this isolates the WRITE matching
    // nothing — the original defect — rather than the new pre-read refusing.
    currentRows = [{ status: h.current }];
    const result = await handlerFor(h.action)({
      orgId: ORG, agentCodename: "test-agent", action: h.action, input: { ...h.input },
    } as any);

    expect(result.success).toBe(false);
    // The specific announcement is the defect: it named a real-sounding effect.
    for (const effect of result.sideEffects ?? []) {
      expect(effect).not.toMatch(h.said);
    }
    expect(insertedRows.some((r) => r.eventType === "action_succeeded")).toBe(false);
  });

  it.each(ID_HANDLERS)("$action still succeeds when a row did match", async (h) => {
    returningRows = [{ id: 7 }];
    currentRows = [{ status: h.current }];
    const result = await handlerFor(h.action)({
      orgId: ORG, agentCodename: "test-agent", action: h.action, input: { ...h.input },
    } as any);
    expect(result.success).toBe(true);
    expect((result.sideEffects ?? []).join(" ")).toMatch(h.said);
  });

  it("covers every handler in the file that resolves an id from ctx.input", () => {
    // The population claim, checked. Handlers are `"name": async (ctx) => {`
    // entries in the action registry; the ones that matter here destructure an
    // entity id out of `ctx.input` AND touch the database.
    const src = stripComments(
      fs.readFileSync(
        path.resolve(__dirname, "../../server/services/executionEngine.ts"),
        "utf8",
      ),
    );
    const registry = [...src.matchAll(/"([a-z_]+)":\s*async\s*\(ctx\)\s*=>\s*\{/g)];
    expect(registry.length, "action registry unreadable").toBeGreaterThan(10);

    const idTaking: string[] = [];
    for (let i = 0; i < registry.length; i++) {
      const start = registry[i].index!;
      const end = i + 1 < registry.length ? registry[i + 1].index! : src.length;
      const body = src.slice(start, end);
      const destructuresId = /const\s*\{[^}]*\b(taskId|leadId|dealId)\b[^}]*\}\s*=\s*ctx\.input/.test(body);
      const touchesDb = /\bdb\.(update|select|delete)\s*\(/.test(body);
      if (destructuresId && touchesDb) idTaking.push(registry[i][1]);
    }

    expect(idTaking.sort()).toEqual(ID_HANDLERS.map((h) => h.action).sort());
  });
});
