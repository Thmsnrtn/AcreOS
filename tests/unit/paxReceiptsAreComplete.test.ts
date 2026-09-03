/**
 * Every effect Pax has on the customer's records leaves exactly one receipt
 * (AUTONOMY_SPEC.md §4.7, §7 — "What Pax did" is complete by construction).
 *
 * ── THE POPULATION ──────────────────────────────────────────────────────────
 * Derived from source, not typed: every top-level case label of
 * `executeTool` (server/ai/tools.ts) MINUS PAUSE_SAFE_TOOLS (looks and
 * drafts leave no receipt — never gated, never counted) MINUS
 * APPROVAL_REQUIRED_TOOLS (a send runs only on the trusted replay, where the
 * executor writes the witnessed receipt). What is left is every record
 * write the model can make on its own, and each of them must land in
 * `activity_log` with `agent_type = 'pax'` exactly once — through the
 * post-dispatch hook, or through the case's own richer receipt (before →
 * after), never both.
 *
 * ── PER-MEMBER VACUITY ──────────────────────────────────────────────────────
 * Every member needs a fixture in ARGS below, and every member's call must
 * SUCCEED against the stubbed storage — a member that refuses would yield
 * zero receipts for the honest reason that nothing happened, and the
 * "exactly one" assertion would read as green over a tool that never ran.
 * A new record-writing tool with no fixture fails here by name.
 *
 * ── WHAT ELSE IS PINNED ─────────────────────────────────────────────────────
 *   - the hook never throws into the tool path (a receipt that fails to
 *     write is logged; the effect stands; the model sees success);
 *   - the trusted replay writes NO generic receipt (one tap, one row — the
 *     executor's witnessed receipt is the row);
 *   - the receipt is attributed: origin, stance, the record it is about;
 *   - executeSupportTool has the same hook after its switch (source pin) and
 *     one sampled member proves it fires.
 *
 * Probes that must turn this red: remove the hook; make the hook throw.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const H = vi.hoisted(() => {
  const flags = { throwInHook: false };
  const logActivity = vi.fn(async (_row: Record<string, unknown>) => undefined);
  const row = (over: Record<string, unknown> = {}) => ({
    id: 11,
    organizationId: 7,
    status: "negotiating",
    propertyId: 3,
    county: "Travis",
    state: "TX",
    sizeAcres: "10",
    title: "t",
    ...over,
  });
  /**
   * A storage stand-in that answers every method: reads return a plausible
   * row (or a list), writes return the row they were asked to write. The
   * receipt hook counts `logActivity` calls — the one method that matters.
   */
  const storage = new Proxy(
    { logActivity },
    {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        if (prop === "then") return undefined;
        return vi.fn(async (...args: unknown[]) => {
          if (/^get[A-Z].*s$/.test(prop)) return [row()];
          if (/^get[A-Z]/.test(prop)) return row();
          const input = args.find((a) => a && typeof a === "object") as Record<string, unknown> | undefined;
          return row({ ...(input ?? {}) });
        });
      },
    },
  );
  return {
    flags,
    logActivity,
    storage,
    getPaxControls: vi.fn(async () => ({
      stance: "ask_before_sending" as const,
      leadScoring: true,
      borrowerReminders: true,
      inboxDrafts: true,
      paused: false,
      pausedUntil: null,
      pausedBy: null,
      checkFailed: false,
      timezone: "America/Chicago",
    })),
    connectors: {
      createCalendarEvent: vi.fn(async () => ({ success: true, data: { eventId: "evt_1" } })),
      triggerZapier: vi.fn(async () => ({ success: true, data: { triggered: true } })),
      triggerMake: vi.fn(async () => ({ success: true, data: { triggered: true } })),
    },
    autoResolveAlert: vi.fn(async () => true),
    dbSelectRows: [] as unknown[],
  };
});

// ── The receipts writer is REAL; only the table it writes to is a spy ───────
vi.mock("../../server/services/paxReceipts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxReceipts")>();
  return {
    ...actual,
    recordPaxEffect: (effect: Parameters<typeof actual.recordPaxEffect>[0]) => {
      // The probe: a hook that throws must not reach the tool path.
      if (H.flags.throwInHook) throw new Error("receipt writer exploded");
      return actual.recordPaxEffect(effect);
    },
  };
});
vi.mock("../../server/storage", () => ({ storage: H.storage, db: {} }));
vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls: H.getPaxControls };
});
vi.mock("../../server/db", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => H.dbSelectRows,
    insert: () => chain,
    values: async () => undefined,
    update: () => chain,
    set: () => chain,
  };
  return { db: chain };
});
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/services/approvalKernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/approvalKernel")>();
  return { ...actual, proposePendingAction: vi.fn(async (i: any) => ({ id: 1, ...i })) };
});
vi.mock("../../server/services/autonomyGuardrails", () => ({
  checkSendRateLimit: vi.fn(async () => ({ allowed: true })),
  checkTcpaBeforeSend: vi.fn(async () => ({ allowed: true })),
  recordAutonomousSend: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: vi.fn(), isConfigured: vi.fn(async () => true) },
}));
vi.mock("../../server/services/smsService", () => ({ smsService: {}, sendOrgSMS: vi.fn() }));
vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: vi.fn(() => ({ canEmail: true, canSms: true })),
  isWithinQuietHours: vi.fn(() => ({ blocked: false })),
  isWithinQuietHoursForLead: vi.fn(() => ({ blocked: false })),
}));
vi.mock("../../server/services/aiContextAggregator", () => ({
  getSystemContext: vi.fn(),
  formatContextForAI: vi.fn(),
  invalidateContextCache: vi.fn(),
}));
vi.mock("../../server/services/parcel", () => ({
  lookupParcelByAPN: vi.fn(async () => ({ found: false })),
}));
vi.mock("../../server/services/aiOfferService", () => ({
  generateOfferSuggestions: vi.fn(),
  generateOfferLetter: vi.fn(async () => ({ success: true, letter: "Dear seller", subject: "Offer" })),
}));
vi.mock("../../server/services/aiRouter", () => ({
  TaskComplexity: { MODERATE: "moderate" },
  selectProviderAndModel: () => ({
    model: "test-model",
    client: { chat: { completions: { create: async () => ({ choices: [{ message: { content: "Offer text" } }] }) } } },
  }),
}));
vi.mock("../../server/services/connectors/executor", () => H.connectors);
vi.mock("../../server/services/comps", () => ({ getComparableProperties: vi.fn() }));
vi.mock("../../server/services/data-source-broker", () => ({ DataSourceBroker: class {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/leadEvents", () => ({ emitLeadCreated: vi.fn(), emitLeadUpdated: vi.fn() }));
vi.mock("../../server/services/dealEvents", () => ({ emitDealCreated: vi.fn(), emitDealStageChanged: vi.fn() }));
vi.mock("../../server/services/propertyEvents", () => ({ emitPropertyCreated: vi.fn(), emitPropertyStatusChanged: vi.fn() }));
// The permission ladder: an IDENTIFIED caller is held to the intent's scope
// (paxToolScopeAndFcra.test.ts proves that gate); here the human holds it.
vi.mock("../../server/middleware/roleScope", () => ({ userHasScope: vi.fn(async () => true) }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/ai/validators", () => ({
  validateAtlasOutput: vi.fn(() => ({ valid: true, errors: [] })),
  AtlasOutputType: { OFFER_AMOUNT: "offer_amount" },
}));

import { executeTool, PAUSE_SAFE_TOOLS, APPROVAL_REQUIRED_TOOLS } from "../../server/ai/tools";

const ROOT = path.resolve(__dirname, "../..");
const source = (rel: string) =>
  stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** Top-level `case "name": {` labels of one exported async function. */
function caseLabels(rel: string, fn: string): string[] {
  const src = source(rel);
  const start = src.indexOf(`export async function ${fn}(`);
  expect(start, `${fn} not found in ${rel}`).toBeGreaterThan(-1);
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end);
  return [...body.matchAll(/^ {6}case "([a-z_0-9]+)": \{/gm)].map((m) => m[1]);
}

/** Minimal args that make each member SUCCEED against the stubbed storage. */
const ARGS: Record<string, Record<string, unknown>> = {
  update_lead_status: { lead_id: 42, status: "qualified" },
  create_lead: { first_name: "Gil", last_name: "Praeger" },
  create_property: { apn: "123-45", county: "Travis", state: "TX", sizeAcres: 10 },
  update_property: { property_id: 3, status: "active" },
  create_properties_batch: { properties: [{ apn: "123-45", county: "Travis", state: "TX" }] },
  create_deal: { type: "acquisition", propertyId: 3 },
  update_deal: { deal_id: 11, status: "negotiating" },
  create_task: { title: "Call Bill" },
  update_task: { task_id: 5, status: "in_progress" },
  complete_task: { task_id: 5 },
  generate_offer_letter: { property_id: 3, offer_amount: 25000, buyer_name: "Acme" },
  draft_offer: { dealId: 11, offerAmount: 25000 },
  schedule_followup: { title: "Follow up", entity_type: "lead", entity_id: 42, due_date: "2026-09-10" },
  schedule_follow_up: { entityType: "lead", entityId: 42, note: "Call back", followUpDate: "2026-09-10" },
  create_calendar_event: { title: "Site visit", start: "2026-09-10T10:00:00Z", end: "2026-09-10T11:00:00Z" },
  trigger_zapier: { hook_url: "https://hooks.zapier.com/x", payload: {} },
  trigger_make: { hook_url: "https://hook.make.com/x", payload: {} },
};

const org = { id: 7, name: "Test Org", ownerId: "u-owner" } as any;

/** The receipts (activity_log rows with agent_type 'pax') written so far. */
const paxRows = () => H.logActivity.mock.calls.map((c) => c[0]).filter((r) => r.agentType === "pax");

/** The population, derived from source. */
const population = caseLabels("server/ai/tools.ts", "executeTool").filter(
  (name) => !PAUSE_SAFE_TOOLS.has(name) && !APPROVAL_REQUIRED_TOOLS.has(name),
);

beforeEach(() => {
  vi.clearAllMocks();
  H.flags.throwInHook = false;
  H.dbSelectRows = [];
  H.logActivity.mockImplementation(async () => undefined);
});

describe("the population is derived, non-empty, and fully fixtured", () => {
  it("vacuity: the switch parses to its real size and the subtraction leaves the record writers", () => {
    const all = caseLabels("server/ai/tools.ts", "executeTool");
    expect(all.length).toBeGreaterThan(50);
    expect(PAUSE_SAFE_TOOLS.size).toBeGreaterThan(20);
    expect(APPROVAL_REQUIRED_TOOLS.size).toBeGreaterThanOrEqual(5);
    expect(population.length).toBeGreaterThanOrEqual(15);
    for (const known of ["update_lead_status", "create_lead", "create_task", "draft_offer", "trigger_zapier"]) {
      expect(population, `${known} should be in the receipt population`).toContain(known);
    }
    // Neither excluded set leaks into the population.
    for (const name of population) {
      expect(PAUSE_SAFE_TOOLS.has(name)).toBe(false);
      expect(APPROVAL_REQUIRED_TOOLS.has(name)).toBe(false);
    }
  });

  it("every member has a fixture, and no fixture names a tool outside the population", () => {
    const missing = population.filter((name) => !(name in ARGS));
    expect(
      missing,
      "a record-writing tool joined executeTool with no receipt fixture — add its args to ARGS so its receipt is proven",
    ).toEqual([]);
    const stale = Object.keys(ARGS).filter((name) => !population.includes(name));
    expect(stale, "a fixture names a tool that is no longer a record writer").toEqual([]);
  });
});

describe("each executed member yields exactly one activity_log row with agentType 'pax'", () => {
  it.each(population)("%s", async (name) => {
    const result = await executeTool(name, { ...ARGS[name] }, org, { userId: "u-1", origin: "chat" });
    // Per-member vacuity: the member must have RUN, or "one receipt" is a
    // claim about a tool that did nothing.
    expect(result.success, `${name} did not execute against the stubs: ${result.error}`).toBe(true);
    expect((result.data as any)?.pendingApproval, `${name} froze as an ask instead of running`).toBeUndefined();

    const rows = paxRows();
    expect(rows, `${name} wrote ${rows.length} receipts, expected exactly one`).toHaveLength(1);
    const receipt = rows[0];
    expect(receipt.organizationId).toBe(7);
    expect(receipt.agentType).toBe("pax");
    expect(typeof receipt.entityType).toBe("string");
    expect(Number.isInteger(receipt.entityId)).toBe(true);
    const meta = receipt.metadata as Record<string, unknown>;
    expect(meta.receipt).toBe("pax_effect");
    expect(meta.origin).toBe("chat");
    expect(meta.stance).toBe("ask_before_sending");
    expect(meta.tool).toBe(name);
    expect(meta.witnessed).toBe(false);
    expect(meta.how).toBe("onItsOwn");
  });
});

describe("attribution and the one-tap-one-row rule", () => {
  it("update_lead_status writes its OWN receipt with the real before → after, and the hook does not add a second", async () => {
    await executeTool("update_lead_status", { lead_id: 42, status: "qualified" }, org, { userId: "u-1" });
    const rows = paxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("status_changed");
    expect(rows[0].entityType).toBe("lead");
    expect(rows[0].entityId).toBe(42);
    expect(rows[0].changes).toEqual({ before: { status: "negotiating" }, after: { status: "qualified" } });
  });

  it("the generic receipt names the record the tool wrote, read from the result", async () => {
    await executeTool("create_task", { title: "Call Bill" }, org, { userId: "u-1", origin: "scheduled" });
    const [receipt] = paxRows();
    expect(receipt.entityType).toBe("task");
    expect(receipt.entityId).toBe(11);
    expect((receipt.metadata as any).origin).toBe("scheduled");
    expect(receipt.userId).toBe("u-1");
  });

  it("the trusted replay writes NO generic receipt — the executor's witnessed receipt is the row", async () => {
    for (const name of ["create_task", "update_lead_status"]) {
      H.logActivity.mockClear();
      const result = await executeTool(name, { ...ARGS[name] }, org, { trustedApproval: true, origin: "approval_replay" });
      expect(result.success).toBe(true);
      expect(paxRows(), `${name} wrote a receipt on the replay path (one tap, one row)`).toHaveLength(0);
    }
  });

  it("a refused call leaves no receipt (nothing happened)", async () => {
    H.getPaxControls.mockResolvedValueOnce({
      stance: "ask_before_sending",
      leadScoring: true,
      borrowerReminders: true,
      inboxDrafts: true,
      paused: true,
      pausedUntil: new Date(Date.now() + 3600_000),
      pausedBy: null,
      checkFailed: false,
      timezone: "America/Chicago",
    });
    const result = await executeTool("create_task", { title: "x" }, org);
    expect(result.success).toBe(false);
    expect(paxRows()).toHaveLength(0);
  });

  it("a pause-safe tool leaves no receipt (looks and drafts are never counted)", async () => {
    const result = await executeTool("get_lead_details", { lead_id: 42 }, org);
    expect(result.success).toBe(true);
    expect(paxRows()).toHaveLength(0);
  });
});

describe("the hook never throws into the tool path", () => {
  it("a receipt writer that throws does not change the tool's result", async () => {
    H.flags.throwInHook = true;
    const result = await executeTool("create_task", { title: "Call Bill" }, org, { userId: "u-1" });
    expect(result.success).toBe(true);
    expect((result.data as any)?.task?.title).toBe("Call Bill");
  });

  it("an activity_log write that rejects does not change the tool's result", async () => {
    H.logActivity.mockRejectedValue(new Error("activity_log is down"));
    const result = await executeTool("create_deal", { type: "acquisition", propertyId: 3 }, org);
    expect(result.success).toBe(true);
  });
});

describe("the support switch carries the same hook", () => {
  it("executeSupportTool writes the generic receipt after its switch (source pin)", () => {
    const src = source("server/ai/supportAgent.ts");
    const fnAt = src.indexOf("export async function executeSupportTool(");
    expect(fnAt).toBeGreaterThan(-1);
    const switchAt = src.indexOf("switch (toolName)", fnAt);
    const hookAt = src.indexOf("recordPaxEffect({", switchAt);
    expect(hookAt, "no receipt hook after the support switch").toBeGreaterThan(switchAt);
    const hook = src.slice(hookAt - 400, hookAt + 600);
    expect(hook).toContain("!pauseSafe && !trustedApproval && outcome.success && !receiptWritten");
    expect(hook).toMatch(/try \{[\s\S]*recordPaxEffect\(\{[\s\S]*\} catch/);
  });
});
