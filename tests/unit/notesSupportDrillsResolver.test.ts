/**
 * Notes N9 drills 1 + 3 — the resolver leg (N9-DEF-1 cure).
 *
 * The #698 record left drills 1 and 3 UNPROVEN: the support resolver's tool
 * subset had no notes/ladder read, so a grounded answer was structurally
 * impossible. This file drives the REAL resolver gate (mocked model, mocked
 * db — the paxSupportResolver.test.ts pattern) through both tickets:
 *
 *   Drill 1 (money moment): "my borrower is late, what happens next?" — the
 *   model reads get_notes_book + get_note_delinquency_ladder, then drafts a
 *   reply stating the ladder stage and pointing at the Delinquency screen,
 *   promising NO borrower contact and NO send. High confidence → auto-resolve
 *   is CORRECT here because the reply is grounded in the reads.
 *
 *   Drill 3 ("Pax told me X"): the ticket quotes a prior answer that omitted
 *   the acquired note — the model reads get_notes_book and drafts a reply
 *   carrying the coverage statement with BOTH books' counts.
 *
 * executeSupportTool is stubbed at the module seam with payloads carrying
 * the verbatim coverage text and ladder stage the real helpers produce for
 * this fixture (buildNotesCoverageStatement(1, 1); ladderStageFor(32) =
 * stage_30, "30–59 days"); the tool implementations themselves — including
 * those helpers — are executed for real in notesSupportDrills.test.ts.
 * No live LLM, no staging — stated plainly in the drill record, same as
 * #698's local form.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const RESOLVER_NAMES = [
    "search_knowledge_base", "search_resolved_tickets", "get_similar_resolutions",
    "get_troubleshooting_steps", "diagnose_account", "check_data_integrity",
    "get_account_summary", "get_notes_book", "get_note_delinquency_ladder",
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
    coverage: "Coverage: this answer reads BOTH note books — the serviced book (notes this account originated and services: 1) and the acquired book (notes this account bought: 1). Figures are labelled by book; the two books are never merged into one unlabelled total.",
    serviced: [{ id: 42, book: "serviced", status: "active", nextPaymentDate: "2026-12-01" }],
    acquired: [{ id: "9b1c0000-0000-4000-8000-0000000000d1", book: "acquired", noteNumber: "N9-D1", delinquencyStatus: "delinquent", daysDelinquent: 32 }],
  };
  const ladderData = {
    noteId: "9b1c0000-0000-4000-8000-0000000000d1", onLadder: true, reason: null,
    current: { stage: "stage_30", label: "30–59 days", daysDelinquent: 32, nextPaymentDate: "2026-10-23", paidThroughDate: null },
    recorded: [], disagreement: null, defaultReview: null, escalates: true,
  };
  return { db, inserted, updated, toolCalls, RESOLVER_NAMES, bookData, ladderData, setTicket: (t: Record<string, unknown>) => { ticket = t; },
    reset: () => { inserted.length = 0; updated.length = 0; toolCalls.length = 0; ticket = null; } };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));
vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: { attemptResolution: vi.fn(async () => ({ autoResolved: false })) },
}));
vi.mock("../../server/services/andrei/supportResolverCalibration", () => ({
  recordSupportResolveDecision: vi.fn(async () => undefined),
}));

import { buildNotesCoverageStatement, shapeAcquiredNoteForPax, type AcquiredNotePaxRow } from "../../server/services/notes/acquiredBookRead";
import { ladderStageFor, LADDER_STAGE_LABEL } from "@shared/notes/delinquency";

const ACQUIRED_ROW: AcquiredNotePaxRow = {
  id: "9b1c0000-0000-4000-8000-0000000000d1",
  noteNumber: "N9-D1", borrowerId: 501, payerName: "SYNTHETIC Borrower D1",
  payerPhone: null, status: "performing", delinquencyStatus: "delinquent",
  daysDelinquent: 32, originalPrincipalCents: 5000000, currentBalanceCents: 4000000,
  paymentAmountCents: 65000, interestRateBps: 950, nextPaymentDate: "2026-10-23",
  acquisitionDate: "2026-09-15",
};

vi.mock("../../server/ai/supportAgent", () => ({
  PAX_SYSTEM_PROMPT: "You are Pax.",
  getOpenAIClient: () => { throw new Error("no live client in drills"); },
  supportToolDefinitions: Object.fromEntries(mocks.RESOLVER_NAMES.map((name) => [name, {
    name, description: name, parameters: { type: "object", properties: {} },
  }])),
  executeSupportTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
    mocks.toolCalls.push({ name, args });
    if (name === "get_notes_book") return { success: true, data: mocks.bookData };
    if (name === "get_note_delinquency_ladder") return { success: true, data: mocks.ladderData };
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

describe("N9 drill 1 — money moment: late borrower, grounded on the ladder read", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.setTicket({ id: 9001, userId: "user-1", subject: "My borrower is late", description: "My borrower is 32 days late, what happens next?", category: "general", aiResolutionAttempts: 0 });
  });

  it("auto-resolves ONLY after reading the book and the ladder, with a reply that promises no send", async () => {
    const reply =
      `Your acquired note N9-D1 is 32 days past due and is on the delinquency ladder at the "${LADDER_STAGE_LABEL[ladderStageFor(32)]}" stage. ` +
      "You can follow it on the note's Delinquency screen. Nothing has been sent to your borrower — any notice is yours to start from that screen.";
    const result = await resolveTicketWithPax(9001, ORG, {
      createCompletion: groundedModel([["get_notes_book", {}], ["get_note_delinquency_ladder", { note_id: ACQUIRED_ROW.id }]], reply),
      tryGeniusOnEscalate: false,
    });
    expect(mocks.toolCalls.map((c) => c.name)).toEqual(["get_notes_book", "get_note_delinquency_ladder"]);
    expect(result.autoResolved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.response).toContain("32 days past due");
    expect(result.response).not.toMatch(/I('ll| will) (send|contact|notify)/i);
    expect(mocks.inserted).toHaveLength(1);
  });
});

describe("N9 drill 3 — 'Pax told me X': the support reply states BOTH books with counts", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.setTicket({ id: 9003, userId: "user-1", subject: "Pax told me I have one note", description: "Pax told me I have one note, but I bought one too — which is right?", category: "general", aiResolutionAttempts: 0 });
  });

  it("auto-resolves with the coverage statement after reading get_notes_book", async () => {
    const reply =
      `You have notes in both books. ${buildNotesCoverageStatement(1, 1)} ` +
      "The earlier answer read only one book; the acquired note N9-D1 is in your account.";
    const result = await resolveTicketWithPax(9003, ORG, {
      createCompletion: groundedModel([["get_notes_book", {}]], reply),
      tryGeniusOnEscalate: false,
    });
    expect(mocks.toolCalls.map((c) => c.name)).toEqual(["get_notes_book"]);
    expect(result.autoResolved).toBe(true);
    expect(result.response).toContain("serviced book (notes this account originated and services: 1)");
    expect(result.response).toContain("acquired book (notes this account bought: 1)");
    expect(mocks.inserted).toHaveLength(1);
  });
});
