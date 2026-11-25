/**
 * Buy-and-Hold BH drill 3 — the resolver leg (BH-DEF-1 cure).
 *
 * The #757 record left drill 3 UNPROVEN: the support resolver's tool subset
 * had no buy-and-hold read, so a grounded answer about a rent roll or a
 * lease ledger was structurally impossible. This file drives the REAL
 * resolver gate (mocked model, mocked db — the paxSupportResolver.test.ts
 * pattern) through the drill's ticket:
 *
 *   Drill 3 ("Pax told me X"): the ticket quotes a prior Pax chat answer
 *   claiming the rent roll shows everything paid and 100% occupancy. The
 *   model reads get_rent_roll_view + get_lease_ledger_view, then drafts a
 *   correction: 1 of 2 units occupied (50%), and $1,050 still open on the
 *   3B lease after the $500 recorded on November 10. High confidence →
 *   auto-resolve is CORRECT here because the reply is grounded in the
 *   reads.
 *
 * executeSupportTool is stubbed at the module seam with payloads carrying
 * the verbatim coverage text the real #737 helpers produce for this
 * fixture (drills 1/3's own walk figures); the tool implementations
 * themselves — including those statements — are executed for real in
 * buyHoldSupportDrills.test.ts. No live LLM, no staging — stated plainly
 * in the drill record addendum, same as #757's local form.
 *
 * Scope note: the drill completes on the four non-PII reads. get_tenants
 * has NO support variant (the tenant_pii_read fence — pinned with its
 * reason in buyHoldSupportDrills.test.ts), so no tenant name or contact
 * detail is reachable in this scenario, and the reply below names none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const LEASE_ID = "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e";

const mocks = vi.hoisted(() => {
  const RESOLVER_NAMES = [
    "search_knowledge_base", "search_resolved_tickets", "get_similar_resolutions",
    "get_troubleshooting_steps", "diagnose_account", "check_data_integrity",
    "get_account_summary", "get_rent_roll_view", "get_rental_leases_view",
    "get_lease_ledger_view", "get_rental_underwriting_view",
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
  const rentRollData = {
    coverage: "Coverage: this answer reads THIS account's rent roll only — 2 units on record, 2 shown. An empty rent roll is reported as empty, never as fully paid or fully occupied. It covers only the units, leases and charges entered or imported into THIS account — it does not include properties or tenants managed in another system, or any other account's rentals.",
    asOf: "2026-11-23",
    occupancy: { rentableUnits: 2, occupiedUnits: 1, vacantUnits: 1, offlineUnits: 0, retiredUnits: 0, occupancyPct: 50 },
    totalOpenBalanceCents: 105_000,
    totalOverdueCents: 105_000,
    units: [
      { unitId: "unit-1", label: "3B", occupied: true, leaseId: "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e", monthlyRentCents: 150_000, openBalanceCents: 105_000, overdueCents: 105_000 },
      { unitId: "unit-2", label: "3C", occupied: false, leaseId: null, monthlyRentCents: null, openBalanceCents: 0, overdueCents: 0 },
    ],
  };
  const ledgerData = {
    coverage: "Coverage: this answer reads the ledger of ONE lease in THIS account — the charges, payments and allocations recorded here. It shows what is recorded, not money that may have moved outside AcreOS and was never recorded. It covers only the units, leases and charges entered or imported into THIS account — it does not include properties or tenants managed in another system, or any other account's rentals.",
    asOf: "2026-11-23",
    lease: { id: "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e", unitLabel: "3B", status: "active", monthlyRentCents: 150_000 },
    totals: { chargedCents: 155_000, paidCents: 50_000, openBalanceCents: 105_000, overdueCents: 105_000 },
  };
  return { db, inserted, updated, toolCalls, RESOLVER_NAMES, rentRollData, ledgerData, setTicket: (t: Record<string, unknown>) => { ticket = t; },
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
    if (name === "get_rent_roll_view") return { success: true, data: mocks.rentRollData };
    if (name === "get_lease_ledger_view") return { success: true, data: mocks.ledgerData };
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

describe("BH drill 3 — 'Pax told me X': the support reply corrects the chat answer from the rent roll and the ledger", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.setTicket({ id: 9003, userId: "user-1", subject: "Pax told me everything is paid and fully occupied", description: "Pax told me my rent roll shows every unit occupied and everything paid. But 3C looks empty to me and I thought 3B still owed something. Which is right?", category: "general", aiResolutionAttempts: 0 });
  });

  it("auto-resolves ONLY after reading the rent roll and the lease ledger, with a reply that corrects both figures", async () => {
    const reply =
      "I checked your rent roll and the 3B lease ledger, and the earlier answer was wrong on both counts. " +
      "Occupancy is 50%: 1 of your 2 units is occupied — 3C is vacant. " +
      "On 3B, $500 was recorded on November 10 against November's $1,500 rent plus a $50 late fee, so $1,050 is still open and overdue. " +
      "Those figures cover only the units, leases and charges entered or imported into this account. Nothing has been recorded or changed by this reply.";
    const result = await resolveTicketWithPax(9003, ORG, {
      createCompletion: groundedModel([
        ["get_rent_roll_view", {}],
        ["get_lease_ledger_view", { lease_id: LEASE_ID }],
      ], reply),
      tryGeniusOnEscalate: false,
    });
    expect(mocks.toolCalls.map((c) => c.name)).toEqual(["get_rent_roll_view", "get_lease_ledger_view"]);
    expect(result.autoResolved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.response).toContain("$1,050");
    expect(result.response).toContain("50%");
    expect(result.response).not.toMatch(/I('ll| will) (record|send|charge|collect)/i);
    expect(mocks.inserted).toHaveLength(1);
  });
});
