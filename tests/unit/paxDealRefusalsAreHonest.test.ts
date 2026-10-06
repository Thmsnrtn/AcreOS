/**
 * W10.4 — Pax reports a deal write the repository refused as NOT DONE.
 *
 * The deal repository is the last line every deal write passes: it refuses a
 * creation at a stage a deal is not born at (DealCreationRefusedError), a move
 * the state machine forbids (DealTransitionRefusedError), and — new — a write
 * that lost a race: updateDeal carries the status it decided on in its WHERE,
 * so a deal another writer moved after Pax's read matches nothing, nothing is
 * written, and StaleDealWriteError is thrown.
 *
 * Pax talks to a paying customer, so each of these must come back as
 * `success: false` with a reason a person can act on — and NO receipt, because
 * the receipt hook writes only for a success (paxReceiptsAreComplete). Where
 * the deal write is a side step of a tool whose main effect DID happen (the
 * offer letter, the drafted offer), the result says plainly that the side step
 * did not: `pipelineDealError` / `stageAdvance.applied === false`.
 *
 * Mocks: the same stand-ins paxReceiptsAreComplete uses, with the deal
 * methods overridden per test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  const over: Record<string, (...a: unknown[]) => Promise<unknown>> = {};
  const storage = new Proxy(
    { logActivity },
    {
      get(target, prop: string) {
        if (prop in over) return over[prop];
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
    over,
    flags,
    logActivity,
    storage,
    getPaxControls: vi.fn(async (): Promise<PaxControlsState> => ({
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
vi.mock("../../server/services/dealEvents", () => ({ emitDealCreated: vi.fn(), emitDealStageChanged: vi.fn(), recordDealTransitionEvidence: vi.fn() }));
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

import { executeTool } from "../../server/ai/tools";
import type { PaxControlsState } from "../../server/services/paxControls";
import { DealCreationRefusedError, DealTransitionRefusedError, StaleDealWriteError } from "../../server/storage/dealRepo";
import { OPENING_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";

const org = { id: 7, name: "Test Org", ownerId: "u-owner" } as any;
const paxRows = () => H.logActivity.mock.calls.map((c) => c[0]).filter((r) => r.agentType === "pax");
const run = (name: string, args: Record<string, unknown>) => executeTool(name, args, org, { userId: "u-1", origin: "chat" });

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(H.over)) delete H.over[k];
  H.dbSelectRows = [];
  H.logActivity.mockImplementation(async () => undefined);
});

describe("update_deal", () => {
  it("a deal moved by someone else between Pax's read and the write: not done, said so, no receipt", async () => {
    H.over.updateDeal = async () => {
      throw new StaleDealWriteError(11, "negotiating");
    };
    const r = await run("update_deal", { deal_id: 11, status: "offer_sent" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/changed while this was being saved/);
    expect(r.error).toMatch(/nothing was written/);
    expect(paxRows()).toHaveLength(0);
  });

  it("a move the repository refuses: not done, the refusal named, no receipt", async () => {
    H.over.updateDeal = async () => {
      throw new DealTransitionRefusedError(11, "A deleted deal cannot change stage");
    };
    const r = await run("update_deal", { deal_id: 11, status: "offer_sent" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^A deleted deal cannot change stage\. Nothing was written/);
    expect(paxRows()).toHaveLength(0);
  });

  it("any other failure is not dressed up as a refusal", async () => {
    H.over.updateDeal = async () => {
      throw new Error("connection reset");
    };
    const r = await run("update_deal", { deal_id: 11, status: "offer_sent" });
    expect(r).toEqual({ success: false, error: "connection reset" });
  });
});

describe("create_deal", () => {
  it("creates as an OPENING deal — the repository's strictest rule", async () => {
    const calls: unknown[][] = [];
    H.over.createDeal = async (...a: unknown[]) => (calls.push(a), { id: 12, ...(a[0] as object) });
    const r = await run("create_deal", { type: "acquisition", propertyId: 3 });
    expect(r.success).toBe(true);
    expect(calls[0][2]).toEqual({ creation: "opening" });
  });

  it("a creation the repository refuses: not done, the allowed stages named, no receipt", async () => {
    H.over.createDeal = async () => {
      throw new DealCreationRefusedError("in_escrow", OPENING_DEAL_STATUSES, "opening");
    };
    const r = await run("create_deal", { type: "acquisition", propertyId: 3 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/can't be created at "in_escrow"/);
    expect(r.error).toMatch(/Nothing was created/);
    expect(paxRows()).toHaveLength(0);
  });
});

describe("the side steps of offer tools say when they did not happen", () => {
  it("generate_offer_letter: the letter stands; a refused pipeline deal is reported, never a deal id", async () => {
    H.over.createDeal = async () => {
      throw new DealCreationRefusedError("offer_sent", ["negotiating"], "opening");
    };
    const r = await run("generate_offer_letter", { property_id: 3, offer_amount: 25000, buyer_name: "Acme" });
    expect(r.success).toBe(true);
    expect((r.data as any).dealId).toBeNull();
    expect((r.data as any).pipelineDealError).toMatch(/can't be created at "offer_sent"/);
  });

  it("generate_offer_letter: a created pipeline deal carries no error", async () => {
    const r = await run("generate_offer_letter", { property_id: 3, offer_amount: 25000, buyer_name: "Acme" });
    expect(r.success).toBe(true);
    expect((r.data as any).dealId).toEqual(expect.any(Number));
    expect((r.data as any).pipelineDealError).toBeNull();
  });

  it("draft_offer: the draft stands; an advance that lost a race is reported as not applied, with why", async () => {
    H.over.updateDeal = async () => {
      throw new StaleDealWriteError(11, "negotiating");
    };
    const r = await run("draft_offer", { dealId: 11, offerAmount: 25000 });
    expect(r.success).toBe(true);
    expect((r.data as any).stageAdvance).toEqual({ to: "offer_sent", applied: false, reason: expect.stringMatching(/nothing was written/) });
  });

  it("draft_offer: an applied advance says applied", async () => {
    const r = await run("draft_offer", { dealId: 11, offerAmount: 25000 });
    expect((r.data as any).stageAdvance).toEqual({ to: "offer_sent", applied: true });
  });
});

describe("Pax's deal writes carry the acting user (W10.4 audit finding 9)", () => {
  // The repository hook hands this to recordDealClose (first_deal_closed's
  // user) and the contract-signed emit; a write without it records null for
  // a write a person asked for.
  it("update_deal passes context.userId to the repository", async () => {
    const calls: unknown[][] = [];
    H.over.updateDeal = async (...a: unknown[]) => (calls.push(a), { id: 11, organizationId: 7, status: "offer_sent" });
    const r = await run("update_deal", { deal_id: 11, status: "offer_sent" });
    expect(r.success).toBe(true);
    expect(calls[0][4]).toEqual({ context: { userId: "u-1" } });
  });

  it("draft_offer's advance passes context.userId to the repository", async () => {
    const calls: unknown[][] = [];
    H.over.updateDeal = async (...a: unknown[]) => (calls.push(a), { id: 11, organizationId: 7, status: "offer_sent" });
    await run("draft_offer", { dealId: 11, offerAmount: 25000 });
    expect(calls[0][4]).toEqual({ context: { userId: "u-1" } });
  });

  it("no acting user → null, never a guessed one", async () => {
    const calls: unknown[][] = [];
    H.over.updateDeal = async (...a: unknown[]) => (calls.push(a), { id: 11, organizationId: 7, status: "offer_sent" });
    await executeTool("update_deal", { deal_id: 11, status: "offer_sent" }, org, { origin: "chat" } as never);
    expect(calls[0][4]).toEqual({ context: { userId: null } });
  });
});
