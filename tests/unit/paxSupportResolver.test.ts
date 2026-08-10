/**
 * Tahoe E4 — Pax-Support resolution variant confidence gate.
 *
 * Proves the gate routes a ticket to AUTO-RESOLVE vs ESCALATE based on the
 * confidence the model returns, using a mocked model (no network) and a mocked
 * db. The model is injected via `createCompletion`; we assert which db writes
 * fire (resolved vs escalated) and what the result reports.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock db ──────────────────────────────────────────────────────────────────
// The resolver does:
//   db.query.supportTickets.findFirst(...)        → the ticket
//   db.select().from().where().orderBy()          → prior messages (empty)
//   db.insert().values()                          → persisted reply (auto-resolve)
//   db.update().set().where()                     → ticket status write
// We record insert/update calls so the test can assert the chosen path.

const mocks = vi.hoisted(() => {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  let ticket: Record<string, unknown> | null = null;

  const db = {
    query: {
      supportTickets: {
        findFirst: vi.fn(async () => ticket),
      },
    },
    // select chain → resolves to [] (no prior messages)
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => [] as unknown[]),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => {
        inserted.push(v);
        return undefined;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        updated.push(v);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };

  return {
    db,
    inserted,
    updated,
    setTicket: (t: Record<string, unknown>) => {
      ticket = t;
    },
    reset: () => {
      inserted.length = 0;
      updated.length = 0;
      ticket = null;
    },
  };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));

// Keep the genius/Opus second-opinion path out of the gate test — we are testing
// the variant's own confidence gate, not the escalation substrate.
vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: {
    attemptResolution: vi.fn(async () => ({ autoResolved: false })),
  },
}));

// Wave 0.3 wired the resolver under the aiSpendGuard pair (it was the one
// customer-triggered tool loop with no cost enforcement). Stub the guard here —
// the ceiling's real db reads are out of scope for the confidence-gate test —
// but keep spies so the wiring itself stays pinned (see the guard test below).
const spendGuardMocks = vi.hoisted(() => ({
  assertAiSpendAllowed: vi.fn(async () => undefined),
  recordExternalAiSpend: vi.fn(() => undefined),
}));
vi.mock("../../server/services/aiSpendGuard", () => spendGuardMocks);

import {
  resolveTicketWithPax,
  getResolveConfidenceThreshold,
  GROUNDED_SOURCES_CONSTRAINT,
} from "../../server/ai/paxSupportResolver";
import type { ChatCompletionFn } from "../../server/ai/paxSupportResolver";
import type { Organization } from "@shared/schema";

const ORG = { id: 1, isFounder: false } as unknown as Organization;

// Build a one-shot model fn that immediately emits a draft_customer_response
// tool call with the given confidence — the terminal decision the gate reads.
function modelDraftingConfidence(confidence: number, text = "Here is your answer."): ChatCompletionFn {
  return vi.fn(async () => ({
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "draft_customer_response",
                arguments: JSON.stringify({
                  response_text: text,
                  confidence_score: confidence,
                  resolution_type: "answer_question",
                }),
              },
            },
          ],
        },
      },
    ],
  })) as unknown as ChatCompletionFn;
}

describe("Pax-Support resolution variant — confidence gate", () => {
  beforeEach(() => {
    mocks.reset();
    process.env.SOPHIE_CONFIDENCE_MODE = "balanced"; // threshold = 70 for general
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.SOPHIE_CONFIDENCE_MODE;
  });

  it("AUTO-RESOLVES when confidence >= threshold", async () => {
    mocks.setTicket({
      id: 10,
      organizationId: 1,
      category: "general",
      subject: "How do I add a lead?",
      description: "Need help adding a lead.",
      aiResolutionAttempts: 0,
    });

    const result = await resolveTicketWithPax(10, ORG, {
      createCompletion: modelDraftingConfidence(85),
      tryGeniusOnEscalate: false,
    });

    expect(result.autoResolved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.confidence).toBe(85);

    // A customer-facing reply was persisted as "Pax" (never an internal codename).
    const reply = mocks.inserted.find((m) => m.role === "agent");
    expect(reply).toBeTruthy();
    expect(reply?.agentName).toBe("Pax");

    // The ticket was marked resolved by the auto path.
    const statusWrite = mocks.updated.find((u) => u.status === "resolved");
    expect(statusWrite).toBeTruthy();
    expect(statusWrite?.resolutionType).toBe("auto_fixed");
    expect(statusWrite?.resolvedBy).toBe("pax");
  });

  it("ESCALATES when confidence < threshold", async () => {
    mocks.setTicket({
      id: 11,
      organizationId: 1,
      category: "general",
      subject: "Weird bug",
      description: "Something is broken and I don't know what.",
      aiResolutionAttempts: 0,
    });

    const result = await resolveTicketWithPax(11, ORG, {
      createCompletion: modelDraftingConfidence(40),
      tryGeniusOnEscalate: false,
    });

    expect(result.autoResolved).toBe(false);
    expect(result.escalated).toBe(true);
    expect(result.confidence).toBe(40);

    // No customer-facing auto-reply was sent on escalate.
    const reply = mocks.inserted.find((m) => m.role === "agent");
    expect(reply).toBeFalsy();

    // The ticket was flagged escalated, not resolved.
    const statusWrite = mocks.updated.find((u) => u.resolutionType === "escalated");
    expect(statusWrite).toBeTruthy();
    expect(mocks.updated.find((u) => u.status === "resolved")).toBeFalsy();
  });

  it("holds billing tickets to the stricter 90% bar", async () => {
    expect(getResolveConfidenceThreshold("billing")).toBe(90);
    expect(getResolveConfidenceThreshold("general")).toBe(70);

    mocks.setTicket({
      id: 12,
      organizationId: 1,
      category: "billing",
      subject: "Charge question",
      description: "Why was I charged?",
      aiResolutionAttempts: 0,
    });

    // 85% clears the general bar but NOT the billing bar → escalate.
    const result = await resolveTicketWithPax(12, ORG, {
      createCompletion: modelDraftingConfidence(85),
      tryGeniusOnEscalate: false,
    });

    expect(result.autoResolved).toBe(false);
    expect(result.escalated).toBe(true);
  });

  it("enforces the AI spend guard: ceiling consulted before the model, spend recorded per completion (Wave 0.3)", async () => {
    mocks.setTicket({
      id: 13,
      organizationId: 1,
      category: "general",
      subject: "Guard wiring",
      description: "Spend-guard pin.",
      aiResolutionAttempts: 0,
    });
    await resolveTicketWithPax(13, ORG, {
      createCompletion: modelDraftingConfidence(85),
      tryGeniusOnEscalate: false,
    });
    // The ceiling is consulted once, for the ticket's org, before any model call.
    expect(spendGuardMocks.assertAiSpendAllowed).toHaveBeenCalledTimes(1);
    expect(spendGuardMocks.assertAiSpendAllowed).toHaveBeenCalledWith(ORG.id);
    // Spend is recorded for every completion the loop made (≥1 — the drafting
    // model here answers in one turn) with the resolver's task type.
    expect(spendGuardMocks.recordExternalAiSpend).toHaveBeenCalled();
    for (const call of spendGuardMocks.recordExternalAiSpend.mock.calls) {
      expect(call[0]).toMatchObject({ orgId: ORG.id, taskType: "pax_support_resolve" });
    }
  });

  it("grounded deflection (O5): the system prompt the model ACTUALLY receives carries the structural grounded-sources constraint", async () => {
    mocks.setTicket({
      id: 20,
      organizationId: 1,
      category: "general",
      subject: "Prompt pin",
      description: "Grounding constraint must reach the model.",
      aiResolutionAttempts: 0,
    });
    const completion = modelDraftingConfidence(85);
    await resolveTicketWithPax(20, ORG, {
      createCompletion: completion,
      tryGeniusOnEscalate: false,
    });
    // Derived pin: capture the params passed to the real completion call —
    // asserting on the live message, not a copy, so the pin cannot go stale.
    const params = (completion as any).mock.calls[0][0];
    const system = params.messages[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain(GROUNDED_SOURCES_CONSTRAINT);
    // The constraint is structural, not vibes: named grounded sources, an
    // explicit no-guess rule, and the mandated no-source ⇒ escalate fallback.
    expect(GROUNDED_SOURCES_CONSTRAINT).toContain("GROUNDED SOURCES ONLY");
    expect(GROUNDED_SOURCES_CONSTRAINT).toContain("search_knowledge_base");
    expect(GROUNDED_SOURCES_CONSTRAINT).toContain("search_resolved_tickets");
    expect(GROUNDED_SOURCES_CONSTRAINT).toContain("diagnose_account");
    expect(GROUNDED_SOURCES_CONSTRAINT).toMatch(/do not guess/i);
    expect(GROUNDED_SOURCES_CONSTRAINT).toMatch(/LOW confidence_score/);
    expect(GROUNDED_SOURCES_CONSTRAINT).toMatch(/escalates to a\s+human/);
  });

  it("grounded deflection (O5): the no-source fallback stays wired — a low-confidence holding draft escalates, never auto-sends", async () => {
    mocks.setTicket({
      id: 21,
      organizationId: 1,
      category: "general",
      subject: "Undocumented feature question",
      description: "No KB article covers this.",
      aiResolutionAttempts: 0,
    });
    // The constraint's mandated behavior when no source grounds an answer:
    // a LOW-confidence holding reply. The gate must route it to a human.
    const result = await resolveTicketWithPax(21, ORG, {
      createCompletion: modelDraftingConfidence(5, "I don't have a grounded answer yet — a specialist will follow up."),
      tryGeniusOnEscalate: false,
    });
    expect(result.autoResolved).toBe(false);
    expect(result.escalated).toBe(true);
    // No customer-facing auto-reply was persisted.
    expect(mocks.inserted.find((m) => m.role === "agent")).toBeFalsy();
    // The ticket went back to a human, not to "resolved".
    expect(mocks.updated.find((u) => u.resolutionType === "escalated")).toBeTruthy();
    expect(mocks.updated.find((u) => u.status === "resolved")).toBeFalsy();
  });

  it("a ceiling refusal stops the resolver BEFORE any model call (never a free completion)", async () => {
    mocks.setTicket({
      id: 14,
      organizationId: 1,
      category: "general",
      subject: "Ceiling refusal",
      description: "Refusal-order pin.",
      aiResolutionAttempts: 0,
    });
    spendGuardMocks.assertAiSpendAllowed.mockRejectedValueOnce(new Error("AI cost ceiling reached"));
    const completion = vi.fn(modelDraftingConfidence(85));
    await expect(
      resolveTicketWithPax(14, ORG, { createCompletion: completion, tryGeniusOnEscalate: false }),
    ).rejects.toThrow(/ceiling/);
    expect(completion).not.toHaveBeenCalled();
    expect(spendGuardMocks.recordExternalAiSpend).not.toHaveBeenCalled();
  });
});
