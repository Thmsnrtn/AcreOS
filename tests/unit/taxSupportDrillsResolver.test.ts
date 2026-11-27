/**
 * Tax T9 drill 4 — the resolver leg (T9-DEF-1 cure).
 *
 * The #740 record left drill 4 UNPROVEN: the support resolver's tool subset
 * had no tax read, so a grounded answer about a certificate was
 * structurally impossible. This file drives the REAL resolver gate (mocked
 * model, mocked db — the paxSupportResolver.test.ts pattern) through the
 * drill's ticket:
 *
 *   Drill 4 ("Pax told me X"): the ticket quotes a prior Pax chat answer
 *   claiming the redemption notice "was mailed" and giving the deadline
 *   without its basis. The model reads get_tax_certificates_book +
 *   get_tax_certificate_clock_view + get_tax_certificate_ledger_view,
 *   then drafts a correction: the deadline WITH its basis, and the notice
 *   stated as SIMULATED — recorded in test mode, NOT mailed. High
 *   confidence → auto-resolve is CORRECT here because the reply is
 *   grounded in the reads.
 *
 * executeSupportTool is stubbed at the module seam with payloads carrying
 * the verbatim coverage and simulation text the real T7 helpers produce
 * for this fixture (the GA certificate of drills 1–3; one test-mode rail
 * notice, provider id sim_T9DRILL); the tool implementations themselves —
 * including those statements — are executed for real in
 * taxSupportDrills.test.ts. No live LLM, no staging — stated plainly in
 * the drill record addendum, same as #740's local form.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CERT_ID = "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e";

const mocks = vi.hoisted(() => {
  const RESOLVER_NAMES = [
    "search_knowledge_base", "search_resolved_tickets", "get_similar_resolutions",
    "get_troubleshooting_steps", "diagnose_account", "check_data_integrity",
    "get_account_summary", "get_tax_certificates_book", "get_tax_certificate_record",
    "get_tax_certificate_clock_view", "get_tax_certificate_ledger_view",
    "query_user_data", "get_user_activity", "estimate_resolution_confidence",
    "recall_user_memory", "draft_customer_response", "escalate_to_human",
  ];
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  let ticket: Record<string, unknown> | null = null;
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    query: { supportTickets: { findFirst: vi.fn(async () => ticket) } },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ orderBy: vi.fn(async () => [] as unknown[]) })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => { inserted.push(v); return undefined; }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        updated.push(v);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  const bookData = {
    coverage: "Coverage: this answer reads THIS account's tax certificates only (1 matches — status active; 1 shown). It does not include tax-sale listings, lots you have not bought, or any other account's certificates. Sorted by redemption deadline, soonest first.",
    asOf: "2026-11-23",
    certificates: [{ id: "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e", state: "GA", county: "Fulton", status: "active", redemptionDeadline: "2026-11-23", currentRedemptionAmountCents: 720_000 }],
  };
  const clockData = {
    coverage: "Coverage: the redemption clock for ONE certificate in THIS account, computed by the same rule as the Redemption clock page. A redemption deadline is a legal fact: state it with the basis shown, and where the clock says no rule is encoded or the county procedure disagrees, say so — never improvise a date.",
    certificateId: "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e",
    clock: { deadline: "2026-11-23", basis: "computed by AcreOS from its encoded GA rule — preliminary" },
  };
  const ledgerData = {
    coverage: "Coverage: the ledger of ONE certificate in THIS account — payments, notices and the foreclosure-filing deadline recorded here. It shows what is recorded, not everything that may have happened outside AcreOS. It does not include tax-sale listings, lots you have not bought, or any other account's certificates.",
    certificateId: "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e",
    ledger: {},
    noticeSimulation: {
      statement: "1 notice was SIMULATED — recorded in test mode, NOT mailed. Never tell the customer a simulated notice went out.",
      notices: [{ sentOn: "2026-11-20", method: "certified mail via AcreOS", viaRail: true, providerId: "sim_T9DRILL", simulated: true }],
    },
  };
  return { db, inserted, updated, toolCalls, RESOLVER_NAMES, bookData, clockData, ledgerData, setTicket: (t: Record<string, unknown>) => { ticket = t; },
    reset: () => { inserted.length = 0; updated.length = 0; toolCalls.length = 0; ticket = null; } };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));
vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: { attemptResolution: vi.fn(async () => ({ autoResolved: false })) },
}));
vi.mock("../../server/services/andrei/supportResolverCalibration", () => ({
  recordSupportResolveDecision: vi.fn(async () => undefined),
}));

vi.mock("../../server/ai/supportAgent", () => ({
  PAX_SYSTEM_PROMPT: "You are Pax.",
  getOpenAIClient: () => { throw new Error("no live client in drills"); },
  supportToolDefinitions: Object.fromEntries(mocks.RESOLVER_NAMES.map((name) => [name, {
    name, description: name, parameters: { type: "object", properties: {} },
  }])),
  executeSupportTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
    mocks.toolCalls.push({ name, args });
    if (name === "get_tax_certificates_book") return { success: true, data: mocks.bookData };
    if (name === "get_tax_certificate_clock_view") return { success: true, data: mocks.clockData };
    if (name === "get_tax_certificate_ledger_view") return { success: true, data: mocks.ledgerData };
    return { success: true, data: {} };
  }),
}));

import { resolveTicketWithPax } from "../../server/ai/paxSupportResolver";
import type { ChatCompletionFn } from "../../server/ai/paxSupportResolver";
import type { Organization } from "@shared/schema";

const ORG = { id: 77, isFounder: false } as unknown as Organization;

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

/** A model that first calls the given read tools, then drafts `reply` at 95. */
function groundedModel(reads: Array<[string, Record<string, unknown>]>, reply: string): ChatCompletionFn {
  let step = 0;
  return vi.fn(async () => {
    step += 1;
    if (step === 1) {
      return { choices: [{ message: { role: "assistant", content: null,
        tool_calls: reads.map(([name, args], i) => toolCall(`call_${i}`, name, args)) } }] };
    }
    return { choices: [{ message: { role: "assistant", content: null,
      tool_calls: [toolCall("call_draft", "draft_customer_response", {
        response_text: reply, confidence_score: 95, resolution_type: "answer_question",
      })] } }] };
  }) as unknown as ChatCompletionFn;
}

describe("T9 drill 4 — 'Pax told me X': the support reply corrects the chat answer from the certificate reads", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.setTicket({ id: 9004, userId: "user-1", subject: "Pax told me my notice was mailed", description: "Pax told me the redemption notice for my Fulton certificate was mailed and the deadline is November 23, 2026. Is that right?", category: "general", aiResolutionAttempts: 0 });
  });

  it("auto-resolves ONLY after reading the book, the clock and the ledger, with a reply that corrects the simulation claim", async () => {
    const reply =
      "I checked your Fulton County certificate. Its redemption deadline is 2026-11-23, computed by AcreOS from its encoded Georgia rule — that figure is preliminary, not attorney-reviewed. " +
      "On the notice, the earlier answer was wrong: the notice recorded on November 20 was simulated in test mode and was NOT mailed. " +
      "Nothing has been sent — sending a notice stays on the certificate's notice screen, where you start it yourself.";
    const result = await resolveTicketWithPax(9004, ORG, {
      createCompletion: groundedModel([
        ["get_tax_certificates_book", {}],
        ["get_tax_certificate_clock_view", { certificate_id: CERT_ID }],
        ["get_tax_certificate_ledger_view", { certificate_id: CERT_ID }],
      ], reply),
      tryGeniusOnEscalate: false,
    });
    expect(mocks.toolCalls.map((c) => c.name)).toEqual(["get_tax_certificates_book", "get_tax_certificate_clock_view", "get_tax_certificate_ledger_view"]);
    expect(result.autoResolved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.response).toContain("NOT mailed");
    expect(result.response).toContain("preliminary");
    expect(result.response).not.toMatch(/I('ll| will) (send|mail|notify)/i);
    expect(mocks.inserted).toHaveLength(1);
  });
});
