/**
 * W10.4 — the deal repository refuses at the write, and every NON-ROUTE
 * writer says so in its own channel.
 *
 * updateDeal now carries the status it decided on in its WHERE: a deal that
 * another writer moved after the caller's read matches zero rows, nothing is
 * written, and StaleDealWriteError is thrown. The state machine refuses with
 * DealTransitionRefusedError. Routes map both through sendDealWriteError
 * (dealWritersCensus pins that); the writers below have no response object,
 * and each used to report the effect it did not have:
 *
 *  - autopilot `advance_deal_stage` — an ExecutionResult failure naming the
 *    reason; never "Deal advanced", never a side effect listed;
 *  - voice-call CRM updates — the deal's updates come OFF the transcript's
 *    applied list (it recorded "deal.status applied" before the write ran),
 *    while the call's lead updates still stand.
 *
 * (Pax: paxDealRefusalsAreHonest. Workflows and the bulk endpoint:
 * dealStatusWritersHoldTheStateMachine.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updateDealImpl: (async () => ({})) as (...a: unknown[]) => Promise<unknown>,
  transcriptSets: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const thenable = (rows: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
    c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(rows()).then(f, r);
    return c;
  };
  return {
    db: {
      select: () => thenable(() => H.selects.shift() ?? []),
      insert: () => ({ values: async (v: Record<string, unknown>) => void H.inserts.push(v) }),
      update: () => ({
        set: (patch: Record<string, unknown>) => {
          H.transcriptSets.push(patch);
          const w: Record<string, unknown> = { returning: async () => [{ id: 1, ...patch }] };
          w.then = (f: (v: unknown) => unknown) => Promise.resolve([]).then(f);
          return { where: () => w };
        },
      }),
    },
  };
});
vi.mock("../../server/storage", () => ({
  storage: { updateDeal: (...a: unknown[]) => H.updateDealImpl(...a) },
}));
vi.mock("../../server/services/dealEvents", () => ({ emitDealStageChanged: vi.fn() }));
vi.mock("../../server/services/trustAuthorityEscalation", () => ({
  trustAuthorityEscalation: { isActionAllowed: vi.fn().mockReturnValue(true), getTier: vi.fn().mockReturnValue({ label: "t", allowedActions: [] }) },
}));
vi.mock("../../server/services/companyAgents", () => ({
  companyAgentService: { getByCodename: vi.fn().mockResolvedValue(undefined), effectiveTrustScore: vi.fn().mockResolvedValue(100) },
}));
vi.mock("../../server/services/governanceBrainV13", () => ({
  governanceBrainService: { evaluateAction: vi.fn().mockResolvedValue({ overallResult: "allowed", explanation: "t" }) },
}));
vi.mock("../../server/services/eventMeshPublisher", () => ({ eventMeshPublisher: { publish: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastFounderEvent: vi.fn(), broadcast: vi.fn() } }));
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: () => null }));

const { StaleDealWriteError, DealTransitionRefusedError } = await import("../../server/storage/dealRepo");

beforeEach(() => {
  H.selects = [];
  H.transcriptSets = [];
  H.inserts = [];
  H.updateDealImpl = async (_id, patch) => ({ id: 7, ...(patch as object) });
});

describe("autopilot advance_deal_stage", () => {
  const run = async (input: Record<string, unknown>) => {
    const { executionEngine } = await import("../../server/services/executionEngine");
    const executor = executionEngine.getActionExecutor("advance_deal_stage")!;
    return executor({ orgId: 42, agentCodename: "t", action: "advance_deal_stage", input } as never);
  };

  it("a deal moved under it is a named failure with no side effects — not 'advanced'", async () => {
    H.selects = [[{ status: "negotiating" }]];
    H.updateDealImpl = async () => {
      throw new StaleDealWriteError(7, "negotiating");
    };
    const r = await run({ dealId: 7, newStage: "offer_sent" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/changed while advancing/);
    expect(r.error).toMatch(/nothing was written/);
    expect(r.sideEffects).toEqual([]);
  });

  it("a move the repository refuses is a failure carrying the refusal", async () => {
    H.selects = [[{ status: "negotiating" }]];
    H.updateDealImpl = async () => {
      throw new DealTransitionRefusedError(7, "Cannot move a deal from negotiating to offer_sent");
    };
    const r = await run({ dealId: 7, newStage: "offer_sent" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^Cannot move a deal from negotiating to offer_sent\. Valid deal statuses/);
  });

  it("a real advance still reports success", async () => {
    H.selects = [[{ status: "negotiating" }]];
    const r = await run({ dealId: 7, newStage: "offer_sent" });
    expect(r.success).toBe(true);
    expect(r.sideEffects).toEqual(["Deal 7 advanced to offer_sent"]);
  });
});

describe("voice-call CRM updates", () => {
  const transcript = { id: 3, organizationId: 42, leadId: null, dealId: 7, crmUpdatesApplied: [] };
  const deal = { id: 7, organizationId: 42, status: "negotiating", notes: "" };

  async function apply() {
    const { voiceCallAIService } = await import("../../server/services/voiceCallAI");
    H.selects = [[transcript], [deal]];
    return voiceCallAIService.applyCRMUpdates(3, { dealUpdates: { status: "offer_sent", notes: "seller wants 30 days" } } as never);
  }
  const recorded = () => (H.transcriptSets.at(-1)?.crmUpdatesApplied ?? []) as Array<{ field: string }>;

  it("a stale deal write leaves NO deal update on the applied list — and the call still completes", async () => {
    H.updateDealImpl = async () => {
      throw new StaleDealWriteError(7, "negotiating");
    };
    await expect(apply()).resolves.toBeDefined();
    expect(recorded().map((u) => u.field)).toEqual([]);
    const event = H.inserts.find((i) => i.eventType === "crm_updates_applied") as { payload: { updatesApplied: number } };
    expect(event.payload.updatesApplied).toBe(0);
  });

  it("a refused deal write is dropped the same way", async () => {
    H.updateDealImpl = async () => {
      throw new DealTransitionRefusedError(7, "refused");
    };
    await apply();
    expect(recorded()).toEqual([]);
  });

  it("an applied deal write is recorded", async () => {
    await apply();
    expect(recorded().map((u) => u.field)).toEqual(["deal.status", "deal.notes"]);
  });

  it("any other failure is not swallowed", async () => {
    H.updateDealImpl = async () => {
      throw new Error("connection reset");
    };
    await expect(apply()).rejects.toThrow(/connection reset/);
  });
});
