/**
 * L1.5 — tests for the dormant-service wire-in tools in the dispatch tool
 * executor. The 9 new tools each forward to an underlying service; for each
 * we cover:
 *   - Happy path: tool called with valid input → underlying service called
 *     with right args (with agent_role / dispatch_id auto-populated from ctx
 *     where applicable) → success result returned.
 *   - Service throws → tool returns is_error content (success=false).
 *   - Constitutional pre-screen still fires before the tool body executes.
 *
 * The constitutional-guard refusal path for the original tools (bash /
 * file_write) is covered in constitutionalGuard.test.ts; here we just verify
 * the same pre-screen still gates the new tool surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Mocks — every underlying service the wire-ins call, plus the guard.
// ────────────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sendAgentMessageMock = vi.fn();
const readInboxMock = vi.fn();
vi.mock("./agentMessages", () => ({
  sendAgentMessage: (...a: unknown[]) => sendAgentMessageMock(...a),
  readInbox: (...a: unknown[]) => readInboxMock(...a),
}));

const recordAgentDecisionMock = vi.fn();
vi.mock("./agentIdentity", () => ({
  recordAgentDecision: (...a: unknown[]) => recordAgentDecisionMock(...a),
}));

const addTraceStepMock = vi.fn();
vi.mock("./decisionTraces", () => ({
  addTraceStep: (...a: unknown[]) => addTraceStepMock(...a),
}));

const recordCounterfactualMock = vi.fn();
vi.mock("./counterfactuals", () => ({
  recordCounterfactual: (...a: unknown[]) => recordCounterfactualMock(...a),
}));

const createSpeculationMock = vi.fn();
const findMatchingSpeculationsMock = vi.fn();
vi.mock("./speculations", () => ({
  createSpeculation: (...a: unknown[]) => createSpeculationMock(...a),
  findMatchingSpeculations: (...a: unknown[]) =>
    findMatchingSpeculationsMock(...a),
}));

const assessEvidenceMock = vi.fn();
vi.mock("./evidenceWeights", () => ({
  assessEvidence: (...a: unknown[]) => assessEvidenceMock(...a),
}));

const proposeCapabilityMock = vi.fn();
vi.mock("./capabilityDiscovery", () => ({
  proposeCapability: (...a: unknown[]) => proposeCapabilityMock(...a),
}));

// Constitutional guard — by default ALLOW; individual tests can flip to BLOCK.
const screenToolCallMock = vi.fn();
vi.mock("./constitutionalGuard", () => ({
  screenToolCall: (...a: unknown[]) => screenToolCallMock(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every screen allows.
  screenToolCallMock.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

import { executeDispatchTool, DISPATCH_TOOL_SCHEMAS } from "./dispatchToolExecutor";

// ────────────────────────────────────────────────────────────────────────────
// Registry smoke — all 9 wire-ins are exposed in the tool schema list.
// ────────────────────────────────────────────────────────────────────────────

describe("DISPATCH_TOOL_SCHEMAS — L1.5 wire-ins are exposed", () => {
  const expected = [
    "send_message_to_agent",
    "read_agent_inbox",
    "record_decision",
    "record_decision_trace",
    "record_counterfactual",
    "record_speculation",
    "find_matching_speculations",
    "assess_evidence",
    "propose_capability",
  ];
  for (const name of expected) {
    it(`exposes ${name} in DISPATCH_TOOL_SCHEMAS`, () => {
      const entry = DISPATCH_TOOL_SCHEMAS.find((s) => s.name === name);
      expect(entry).toBeDefined();
      expect(entry?.input_schema).toBeDefined();
      expect(entry?.description?.length ?? 0).toBeGreaterThan(20);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// send_message_to_agent
// ────────────────────────────────────────────────────────────────────────────

describe("send_message_to_agent tool", () => {
  it("forwards input + auto-populates fromAgentRole + dispatchIdContext", async () => {
    sendAgentMessageMock.mockResolvedValue({ messageId: 42 });
    const r = await executeDispatchTool(
      "send_message_to_agent",
      {
        to_agent_role: "beatrice",
        subject: "compliance review please",
        body: "Got a question on the new ledger fields.",
        priority: "urgent",
      },
      { dispatchId: 7, agentRole: "iris" },
    );
    expect(r.success).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ message_id: 42 });
    expect(sendAgentMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAgentRole: "iris",
        toAgentRole: "beatrice",
        subject: "compliance review please",
        body: "Got a question on the new ledger fields.",
        priority: "urgent",
        dispatchIdContext: 7,
      }),
    );
  });

  it("returns is_error when the service throws", async () => {
    sendAgentMessageMock.mockRejectedValue(new Error("DB down"));
    const r = await executeDispatchTool(
      "send_message_to_agent",
      { to_agent_role: "soren", subject: "hey", body: "ping" },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("Error:");
    expect(r.output).toContain("DB down");
  });

  it("rejects when ctx is missing agentRole (cannot send anonymously)", async () => {
    const r = await executeDispatchTool(
      "send_message_to_agent",
      { to_agent_role: "iris", subject: "x", body: "y" },
      {},
    );
    expect(r.success).toBe(false);
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// read_agent_inbox
// ────────────────────────────────────────────────────────────────────────────

describe("read_agent_inbox tool", () => {
  it("reads the current dispatch's role inbox", async () => {
    readInboxMock.mockResolvedValue([
      { id: 1, subject: "hi", fromAgentRole: "soren" },
    ]);
    const r = await executeDispatchTool(
      "read_agent_inbox",
      { unread_only: true, limit: 5 },
      { dispatchId: 3, agentRole: "iris" },
    );
    expect(r.success).toBe(true);
    expect(JSON.parse(r.output)).toEqual({
      messages: [{ id: 1, subject: "hi", fromAgentRole: "soren" }],
    });
    expect(readInboxMock).toHaveBeenCalledWith("iris", {
      unreadOnly: true,
      limit: 5,
      priority: undefined,
    });
  });

  it("returns is_error on service failure", async () => {
    readInboxMock.mockRejectedValue(new Error("boom"));
    const r = await executeDispatchTool(
      "read_agent_inbox",
      {},
      { dispatchId: 1, agentRole: "beatrice" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("boom");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// record_decision
// ────────────────────────────────────────────────────────────────────────────

describe("record_decision tool", () => {
  it("auto-populates agent_role + dispatch_id + session_token from ctx", async () => {
    recordAgentDecisionMock.mockResolvedValue(99);
    const r = await executeDispatchTool(
      "record_decision",
      {
        decision_kind: "architecture",
        summary: "Switched to Drizzle migrations",
        rationale: "Atomic + reviewable.",
        referenced_files: ["server/db.ts"],
      },
      { dispatchId: 12, agentRole: "iris" },
    );
    expect(r.success).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ decision_id: 99 });
    const call = recordAgentDecisionMock.mock.calls[0][0];
    expect(call.agentRole).toBe("iris");
    expect(call.dispatchId).toBe(12);
    expect(call.decisionKind).toBe("architecture");
    expect(call.summary).toBe("Switched to Drizzle migrations");
    expect(call.referencedFiles).toEqual(["server/db.ts"]);
    expect(typeof call.sessionToken).toBe("string");
    expect(call.sessionToken.length).toBeGreaterThan(10);
  });

  it("returns is_error when the service throws", async () => {
    recordAgentDecisionMock.mockRejectedValue(new Error("insert blew up"));
    const r = await executeDispatchTool(
      "record_decision",
      { decision_kind: "policy", summary: "x", rationale: "y" },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("insert blew up");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// record_decision_trace
// ────────────────────────────────────────────────────────────────────────────

describe("record_decision_trace tool", () => {
  it("forwards step input + returns trace_id + step_number", async () => {
    addTraceStepMock.mockResolvedValue({ traceId: 5, stepNumber: 3 });
    const r = await executeDispatchTool(
      "record_decision_trace",
      {
        decision_id: 99,
        step_kind: "observation",
        step_text: "Saw 3 retries in a row on the Stripe webhook.",
        confidence_at_step: 0.8,
      },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ trace_id: 5, step_number: 3 });
    expect(addTraceStepMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: 99,
        stepKind: "observation",
        stepText: "Saw 3 retries in a row on the Stripe webhook.",
        confidenceAtStep: 0.8,
      }),
    );
  });

  it("rejects when decision_id is not a positive integer", async () => {
    const r = await executeDispatchTool(
      "record_decision_trace",
      { decision_id: 0, step_kind: "evidence", step_text: "x" },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(addTraceStepMock).not.toHaveBeenCalled();
  });

  it("returns is_error when the service throws", async () => {
    addTraceStepMock.mockRejectedValue(new Error("trace insert failed"));
    const r = await executeDispatchTool(
      "record_decision_trace",
      { decision_id: 1, step_kind: "evidence", step_text: "x" },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("trace insert failed");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// record_counterfactual
// ────────────────────────────────────────────────────────────────────────────

describe("record_counterfactual tool", () => {
  it("auto-tags analyzing_agent_role from ctx", async () => {
    recordCounterfactualMock.mockResolvedValue({ counterfactualId: 7 });
    const r = await executeDispatchTool(
      "record_counterfactual",
      {
        source_decision_id: 12,
        alternative_path: "Could have used Drizzle",
        alternative_rationale: "Native pg types.",
        predicted_outcome: "Smaller diff.",
        comparison_to_actual: "Actual diff was 3x larger.",
        confidence: 0.7,
        lesson_learned: "Prefer native typings on schema-heavy paths.",
      },
      { dispatchId: 4, agentRole: "iris" },
    );
    expect(r.success).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ counterfactual_id: 7 });
    expect(recordCounterfactualMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDecisionId: 12,
        analyzingAgentRole: "iris",
        alternativePath: "Could have used Drizzle",
        confidence: 0.7,
      }),
    );
  });

  it("rejects when source_decision_id missing", async () => {
    const r = await executeDispatchTool(
      "record_counterfactual",
      {
        alternative_path: "a",
        alternative_rationale: "b",
        predicted_outcome: "c",
        comparison_to_actual: "d",
        confidence: 0.5,
      },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(recordCounterfactualMock).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// record_speculation
// ────────────────────────────────────────────────────────────────────────────

describe("record_speculation tool", () => {
  it("auto-tags creator agent + forwards fields", async () => {
    createSpeculationMock.mockResolvedValue({ speculationId: 11 });
    const r = await executeDispatchTool(
      "record_speculation",
      {
        triggered_by_signal: "founder asked twice about retention",
        predicted_need: "Need a retention dashboard surface",
        speculative_output: "<draft markdown>",
        output_kind: "document_draft",
        confidence: 0.6,
        expires_in_days: 14,
      },
      { dispatchId: 9, agentRole: "soren" },
    );
    expect(r.success).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ speculation_id: 11 });
    expect(createSpeculationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRole: "soren",
        triggeredBySignal: "founder asked twice about retention",
        outputKind: "document_draft",
        confidence: 0.6,
        expiresInDays: 14,
      }),
    );
  });

  it("returns is_error when the service throws (e.g. invalid outputKind)", async () => {
    createSpeculationMock.mockRejectedValue(
      new Error("createSpeculation: invalid outputKind"),
    );
    const r = await executeDispatchTool(
      "record_speculation",
      {
        triggered_by_signal: "x",
        predicted_need: "y",
        speculative_output: "z",
        output_kind: "garbage",
      },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("invalid outputKind");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// find_matching_speculations
// ────────────────────────────────────────────────────────────────────────────

describe("find_matching_speculations tool", () => {
  it("maps service shape → snake_case output", async () => {
    findMatchingSpeculationsMock.mockResolvedValue([
      {
        speculationId: 42,
        predictedNeed: "Retention dashboard",
        outputKind: "document_draft",
        confidence: 0.7,
        matchScore: 0.55,
        ageMinutes: 12,
      },
    ]);
    const r = await executeDispatchTool(
      "find_matching_speculations",
      {
        predicted_need_query: "retention surface",
        output_kind: "document_draft",
        min_confidence: 0.5,
      },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(true);
    const parsed = JSON.parse(r.output);
    expect(parsed.matches).toHaveLength(1);
    expect(parsed.matches[0]).toEqual({
      speculation_id: 42,
      predicted_need: "Retention dashboard",
      output_kind: "document_draft",
      confidence: 0.7,
      match_score: 0.55,
      age_minutes: 12,
    });
  });

  it("returns is_error when service throws", async () => {
    findMatchingSpeculationsMock.mockRejectedValue(
      new Error("predictedNeedQuery must be non-empty"),
    );
    const r = await executeDispatchTool(
      "find_matching_speculations",
      { predicted_need_query: "" },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("non-empty");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// assess_evidence
// ────────────────────────────────────────────────────────────────────────────

describe("assess_evidence tool", () => {
  it("normalizes evidence items + auto-tags agent_role + returns full result", async () => {
    assessEvidenceMock.mockResolvedValue({
      assessmentId: 81,
      weightAssignments: { "ev-1": 0.7, "ev-2": 0.3 },
      chosenSourceId: "ev-1",
      aggregateConclusion: "Section 1031 allows the exchange.",
      rationale: "Authority tier 1 regulation vs secondary commentary.",
      confidence: 0.84,
    });
    const r = await executeDispatchTool(
      "assess_evidence",
      {
        topic: "1031 exchange eligibility",
        evidence_items: [
          {
            id: "ev-1",
            source_kind: "regulation",
            source_ref: "26 USC § 1031",
            claim: "Like-kind exchanges allowed.",
            recency: "2024-01-01",
            authority_tier: 1,
          },
          {
            id: "ev-2",
            source_kind: "secondary",
            source_ref: "blog post",
            claim: "Conflicting interpretation.",
            recency: "unknown",
            authority_tier: 4,
          },
        ],
      },
      { dispatchId: 5, agentRole: "beatrice" },
    );
    expect(r.success).toBe(true);
    const parsed = JSON.parse(r.output);
    expect(parsed.assessment_id).toBe(81);
    expect(parsed.chosen_source_id).toBe("ev-1");
    expect(parsed.confidence).toBe(0.84);
    expect(assessEvidenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRole: "beatrice",
        topic: "1031 exchange eligibility",
        evidenceItems: [
          expect.objectContaining({
            id: "ev-1",
            sourceKind: "regulation",
            authorityTier: 1,
          }),
          expect.objectContaining({
            id: "ev-2",
            sourceKind: "secondary",
            authorityTier: 4,
          }),
        ],
      }),
    );
  });

  it("returns is_error on service failure", async () => {
    assessEvidenceMock.mockRejectedValue(new Error("evidence query failed"));
    const r = await executeDispatchTool(
      "assess_evidence",
      { topic: "x", evidence_items: [] },
      { dispatchId: 1, agentRole: "beatrice" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("evidence query failed");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// propose_capability
// ────────────────────────────────────────────────────────────────────────────

describe("propose_capability tool", () => {
  it("auto-tags proposing_agent_role + forwards ROI fields", async () => {
    proposeCapabilityMock.mockResolvedValue({ proposalId: 17 });
    const r = await executeDispatchTool(
      "propose_capability",
      {
        proposed_capability_name: "diff_against_branch",
        problem_statement: "Repeated 4-turn dance to compare with main.",
        proposed_tool_signature:
          "diff_against_branch(branch: string) → string",
        expected_value_usd: 0.5,
        expected_invocations_per_week: 30,
        estimated_build_cost_usd: 80,
      },
      { dispatchId: 8, agentRole: "iris" },
    );
    expect(r.success).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ proposal_id: 17 });
    expect(proposeCapabilityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        proposingAgentRole: "iris",
        proposedCapabilityName: "diff_against_branch",
        expectedValueUsd: 0.5,
        expectedInvocationsPerWeek: 30,
        estimatedBuildCostUsd: 80,
      }),
    );
  });

  it("returns is_error when the service throws (e.g. invalid name)", async () => {
    proposeCapabilityMock.mockRejectedValue(
      new Error("proposedCapabilityName must be snake_case"),
    );
    const r = await executeDispatchTool(
      "propose_capability",
      {
        proposed_capability_name: "BadName",
        problem_statement: "x",
        proposed_tool_signature: "y",
      },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("snake_case");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Constitutional pre-screen still fires before the new tool bodies execute.
// ────────────────────────────────────────────────────────────────────────────

describe("constitutional pre-screen on L1.5 tools", () => {
  it("blocks send_message_to_agent if the guard says so + does NOT call the service", async () => {
    screenToolCallMock.mockResolvedValueOnce({
      allowed: false,
      immutableNumber: 1,
      immutableText: "Test refusal.",
    });
    const r = await executeDispatchTool(
      "send_message_to_agent",
      { to_agent_role: "iris", subject: "x", body: "y" },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("[CONSTITUTIONAL REFUSAL]");
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
  });

  it("blocks record_decision when guard refuses + does NOT call the service", async () => {
    screenToolCallMock.mockResolvedValueOnce({
      allowed: false,
      immutableNumber: 3,
      immutableText: "Pretend refusal.",
    });
    const r = await executeDispatchTool(
      "record_decision",
      { decision_kind: "policy", summary: "x", rationale: "y" },
      { dispatchId: 1, agentRole: "iris" },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("[CONSTITUTIONAL REFUSAL]");
    expect(recordAgentDecisionMock).not.toHaveBeenCalled();
  });

  it("allows assess_evidence through when guard says allowed=true", async () => {
    assessEvidenceMock.mockResolvedValue({
      assessmentId: 1,
      weightAssignments: {},
      chosenSourceId: null,
      aggregateConclusion: "",
      rationale: "",
      confidence: 0,
    });
    const r = await executeDispatchTool(
      "assess_evidence",
      { topic: "x", evidence_items: [] },
      { dispatchId: 1, agentRole: "beatrice" },
    );
    expect(r.success).toBe(true);
    expect(assessEvidenceMock).toHaveBeenCalledOnce();
  });
});
