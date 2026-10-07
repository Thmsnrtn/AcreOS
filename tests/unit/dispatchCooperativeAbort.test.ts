/**
 * Panic stop must stop an IN-FLIGHT dispatch, not just new ones.
 *
 * panicStop flipped the switches and quarantined domains, but a dispatch the
 * worker had already claimed kept running every remaining turn and tool — and
 * cancelDispatch's "cooperative cancellation" was a comment: the runner never
 * looked. Now panicStop cancels in-flight rows (cancelInFlightDispatches) and
 * the runner checks isDispatchCancelled before every turn and every tool call.
 *
 * Drives the REAL runDispatch loop with a scripted model that asks for a tool
 * on every turn; cancels the dispatch after the first tool runs; and proves no
 * further tool runs and the run terminates "aborted" → persisted "cancelled".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SOLENE_DISPATCH_TRANSCRIPT_DIR = `/tmp/solene-dispatch-abort-test-${process.pid}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
});

const st = vi.hoisted(() => ({ cancelled: false, toolCalls: 0, modelCalls: 0 }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        st.modelCalls++;
        return {
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 10 },
          content: [
            { type: "tool_use", id: `t${st.modelCalls}a`, name: "read_file", input: {} },
            { type: "tool_use", id: `t${st.modelCalls}b`, name: "read_file", input: {} },
          ],
        };
      },
    };
  },
}));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/solene/capitalTracker", () => ({
  assertWithinEnsembleCap: vi.fn(async () => undefined),
  recordCapitalEvent: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/aiCostCeiling", () => ({ assertWithinAiCostCeiling: vi.fn(async () => undefined) }));
vi.mock("../../server/services/solene/agentClaims", () => ({ listActiveClaims: vi.fn(async () => []) }));
vi.mock("../../server/services/solene/agentIdentity", () => ({ loadAgentIdentityBlock: vi.fn(async () => "") }));
vi.mock("../../server/services/solene/failureModeLibrary", () => ({ loadFailureModePreambleFor: vi.fn(async () => "") }));
vi.mock("../../server/services/solene/memoryRetrieval", () => ({
  retrieveCrossNamespaceMemories: vi.fn(async () => []),
  buildMultiNamespacePromptBlock: vi.fn(() => ""),
}));
vi.mock("../../server/services/solene/preCallConstitutionalChecker", () => ({
  checkPromptAgainstConstitution: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("../../server/services/solene/dispatchToolExecutor", () => ({
  DISPATCH_TOOL_SCHEMAS: [],
  getDispatchToolSchemas: () => [],
  executeDispatchTool: vi.fn(async () => {
    st.toolCalls++;
    // The founder hits the panic stop while the first tool is running.
    if (st.toolCalls === 1) st.cancelled = true;
    return { success: true, output: "ok", durationMs: 1 };
  }),
}));
const completeDispatch = vi.fn(async () => undefined);
const failDispatch = vi.fn(async () => ({ requeued: false, attempts: 1 }));
vi.mock("../../server/services/solene/dispatchQueue", () => ({
  completeDispatch: (...a: unknown[]) => completeDispatch(...(a as [])),
  failDispatch: (...a: unknown[]) => failDispatch(...(a as [])),
  isDispatchCancelled: vi.fn(async () => st.cancelled),
  // panicStop's abort path: flips the in-flight row the runner then observes.
  cancelInFlightDispatches: vi.fn(async () => {
    st.cancelled = true;
    return [4242];
  }),
}));
vi.mock("../../server/services/autopilot/settings", () => ({ setAutopilotSetting: vi.fn(async () => undefined) }));
vi.mock("../../server/services/autopilot/domainAutonomy", () => ({
  AUTOPILOT_DOMAINS: ["ops"],
  setDomainLevel: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/autopilot/proofReceiptStore", () => ({ recordReceipt: vi.fn(async () => null) }));
vi.mock("../../server/services/solene/pagerService", () => ({ sendSolenePage: vi.fn(async () => undefined) }));

import { runDispatch } from "../../server/services/solene/dispatchRunner";
import { panicStop } from "../../server/services/autopilot/panicStop";

const row = {
  id: 4242,
  status: "in_progress",
  priority: "0.5",
  sourceType: "auto_dispatch",
  sourceId: "autopilot:optimize",
  agentRole: "general-purpose",
  promptText: "Tighten a playbook.",
  maxCostUsd: "5.00",
  timeoutMs: 60_000,
} as unknown as Parameters<typeof runDispatch>[0];

beforeEach(() => {
  st.cancelled = false;
  st.toolCalls = 0;
  st.modelCalls = 0;
  completeDispatch.mockClear();
  failDispatch.mockClear();
});

describe("cooperative abort — a cancelled in-flight dispatch stops at the next boundary", () => {
  it("no tool runs after the cancel, and the run persists as cancelled", async () => {
    const res = await runDispatch(row);
    expect(st.toolCalls, "the second tool in the same turn must not start").toBe(1);
    expect(st.modelCalls, "no further model turn after the cancel").toBe(1);
    expect(res.terminationReason).toBe("aborted");
    expect(completeDispatch).not.toHaveBeenCalled();
    expect(failDispatch).toHaveBeenCalledTimes(1);
    expect((failDispatch.mock.calls[0] as unknown[])[2]).toMatchObject({ status: "cancelled" });
  });

  it("a dispatch cancelled before its first turn never calls the model", async () => {
    st.cancelled = true;
    const res = await runDispatch(row);
    expect(st.modelCalls).toBe(0);
    expect(st.toolCalls).toBe(0);
    expect(res.terminationReason).toBe("aborted");
  });
});

describe("panic stop aborts the in-flight dispatch", () => {
  it("panicStop cancels in-flight rows, and a running dispatch stops at its next boundary", async () => {
    // A dispatch is mid-run; the founder trips the panic stop between turns.
    const { executeDispatchTool } = await import("../../server/services/solene/dispatchToolExecutor");
    vi.mocked(executeDispatchTool).mockImplementationOnce(async () => {
      st.toolCalls++;
      const r = await panicStop({ reason: "test", by: "founder" });
      expect(r.dispatchesAborted).toEqual([4242]);
      return { success: true, output: "ok", durationMs: 1 };
    });
    const res = await runDispatch(row);
    expect(res.terminationReason).toBe("aborted");
    expect(st.toolCalls).toBe(1);
  });
});
