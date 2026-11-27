/**
 * Wholesale W8 drill 3 — the resolver leg (WS-DEF-1 cure).
 *
 * The #767 record left drill 3 UNPROVEN: the support resolver's tool subset
 * had no wholesale read, so a grounded answer about a buyer match or an
 * assignment fee was structurally impossible. This file drives the REAL
 * resolver gate (mocked model, mocked db — the paxSupportResolver.test.ts
 * pattern) through the drill's ticket:
 *
 *   Drill 3 ("Pax told me X"): the ticket quotes a prior Pax chat answer
 *   claiming the assignment fee on the deal is $21,000. The model reads
 *   get_wholesale_assignments_view, then drafts a correction: the signed
 *   fee is $12,000 — the $9,000 assignment is still a draft and does not
 *   count — and a fee is a record, not money AcreOS holds. High confidence
 *   → auto-resolve is CORRECT here because the reply is grounded in the
 *   read.
 *
 * executeSupportTool is stubbed at the module seam with a payload carrying
 * the verbatim coverage text the real #753 helper produces for this
 * fixture (drill 1's own walk figures); the tool implementations
 * themselves — including that statement — are executed for real in
 * wholesaleSupportDrillsStuck.test.ts. No live LLM, no staging — stated
 * plainly in the drill record addendum, same as #767's local form.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const RESOLVER_NAMES = [
    "search_knowledge_base", "search_resolved_tickets", "get_similar_resolutions",
    "get_troubleshooting_steps", "diagnose_account", "check_data_integrity",
    "get_account_summary", "get_wholesale_buy_box_view", "get_wholesale_triage_view",
    "get_wholesale_buyers_view", "get_wholesale_buyer_matches_view",
    "get_wholesale_assignments_view", "get_wholesale_decision_view",
    "get_wholesale_disposition_packet_view", "get_wholesale_blasts_view",
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
  const assignmentsData = {
    coverage: "Coverage: this answer reads the contract assignments recorded on ONE deal in THIS account. An assignment fee is a RECORD of the fee in the contract — AcreOS holds and moves no money. Only a signed assignment counts toward the fee total. It does not include any other account's deals, buyers or records.",
    dealId: 11,
    assignments: [
      { assignmentId: 1, status: "signed", assignmentFeeCents: 1_200_000, assignmentFee: "$12,000", endBuyer: "SYNTHETIC Ada Cash", originalContractDate: "2026-10-01", notes: null },
      { assignmentId: 2, status: "draft", assignmentFeeCents: 900_000, assignmentFee: "$9,000", endBuyer: "SYNTHETIC Bo", originalContractDate: null, notes: null },
    ],
    signedCount: 1,
    signedFeeCents: 1_200_000,
    signedFee: "$12,000",
  };
  return { db, inserted, updated, toolCalls, RESOLVER_NAMES, assignmentsData, setTicket: (t: Record<string, unknown>) => { ticket = t; },
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
    if (name === "get_wholesale_assignments_view") return { success: true, data: mocks.assignmentsData };
    return { success: true, data: {} };
  }),
}));

import { resolveTicketWithPax } from "../../server/ai/paxSupportResolver";
import type { ChatCompletionFn } from "../../server/ai/paxSupportResolver";
import type { Organization } from "@shared/schema";

const ORG = { id: 7, isFounder: false } as unknown as Organization;

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

describe("W8 drill 3 — 'Pax told me X': the support reply corrects the chat answer from the assignments read", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.setTicket({ id: 9003, userId: "user-1", subject: "Pax told me my assignment fee is $21,000 — where is it?", description: "Pax told me the assignment fee on my deal is $21,000 and I want to know where that money is. My signed assignment says $12,000. Which is right?", category: "general", aiResolutionAttempts: 0 });
  });

  it("auto-resolves ONLY after reading the deal's assignments, with a reply that corrects the figure and states the no-custody truth", async () => {
    const reply =
      "I checked the assignments recorded on your deal, and the earlier answer was wrong. " +
      "The signed assignment fee is $12,000. The other assignment, for $9,000, is still a draft, and only a signed assignment counts toward the fee total — the two were added together to reach $21,000. " +
      "An assignment fee is a record of the fee in the contract: AcreOS holds and moves no money, so there is no payment from AcreOS to wait for. " +
      "Nothing has been recorded or changed by this reply.";
    const result = await resolveTicketWithPax(9003, ORG, {
      createCompletion: groundedModel([
        ["get_wholesale_assignments_view", { deal_id: 11 }],
      ], reply),
      tryGeniusOnEscalate: false,
    });
    expect(mocks.toolCalls.map((c) => c.name)).toEqual(["get_wholesale_assignments_view"]);
    expect(result.autoResolved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.response).toContain("$12,000");
    expect(result.response).toContain("holds and moves no money");
    expect(result.response).not.toMatch(/I('ll| will) (record|send|pay|blast)/i);
    expect(mocks.inserted).toHaveLength(1);
  });
});
