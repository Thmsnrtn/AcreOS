import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the router wrapper (NO live API calls) ─────────────────────────────
vi.mock("../../server/services/aiRouter", () => ({
  routeAITask: vi.fn(),
  TaskComplexity: {
    SIMPLE: "simple",
    MODERATE: "moderate",
    COMPLEX: "complex",
    CRITICAL: "critical",
  },
  AIProvider: { OPENROUTER: "openrouter", OPENAI: "openai" },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { judge, JUDGE_SCREEN_MODEL, JUDGE_ADJUDICATE_MODEL } from "../../server/services/llmJudge";
import { routeAITask } from "../../server/services/aiRouter";

const mockRoute = vi.mocked(routeAITask);

/** Build a fake router response whose content is the judge JSON. */
function asResponse(obj: Record<string, unknown>) {
  return { content: JSON.stringify(obj), provider: "openrouter", model: "x" } as any;
}

/** Pull the forced model id out of a routeAITask call. */
function forcedModelOfCall(i: number): string | undefined {
  return mockRoute.mock.calls[i]?.[1]?.forceModel;
}

beforeEach(() => {
  mockRoute.mockReset();
});

describe("llmJudge.judge", () => {
  it("PASS: a confident clean screen returns pass without escalating", async () => {
    mockRoute.mockResolvedValueOnce(
      asResponse({ verdict: "pass", confidence: 0.95, borderline: false, reason: "Grounded in context." })
    );

    const result = await judge({
      rubric: "Is this grounded in the source context?",
      subject: "The parcel is 5 acres [Source: county GIS 2025].",
      context: "County GIS 2025: parcel = 5 acres.",
      mode: "adjudicate",
    });

    expect(result.verdict).toBe("pass");
    expect(result.confidence).toBeCloseTo(0.95);
    expect(result.trace.escalated).toBe(false);
    // Only the cheap screener ran.
    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(forcedModelOfCall(0)).toBe(JUDGE_SCREEN_MODEL);
  });

  it("FAIL: a confident fail screen short-circuits when there is nothing to escalate past — adjudicator confirms", async () => {
    // Screen says fail (confident) → escalate; adjudicator confirms fail.
    mockRoute
      .mockResolvedValueOnce(
        asResponse({ verdict: "fail", confidence: 0.9, borderline: false, reason: "Claim not in context." })
      )
      .mockResolvedValueOnce(
        asResponse({ verdict: "fail", confidence: 0.88, borderline: false, reason: "Asserts an uncited fact." })
      );

    const result = await judge({
      rubric: "Does this assert a fact not in the source context?",
      subject: "The parcel has a paved road.",
      context: "County GIS 2025: parcel = 5 acres.",
      mode: "adjudicate",
    });

    expect(result.verdict).toBe("fail");
    expect(result.trace.escalated).toBe(true);
    expect(result.trace.models).toEqual([JUDGE_SCREEN_MODEL, JUDGE_ADJUDICATE_MODEL]);
  });

  it("ESCALATION: a borderline screen escalates to the Sonnet adjudicator, whose verdict wins", async () => {
    mockRoute
      // Haiku screen: borderline → must escalate
      .mockResolvedValueOnce(
        asResponse({ verdict: "pass", confidence: 0.55, borderline: true, reason: "Unclear." })
      )
      // Sonnet adjudicator: decisive pass
      .mockResolvedValueOnce(
        asResponse({ verdict: "pass", confidence: 0.92, borderline: false, reason: "Actually well grounded." })
      );

    const result = await judge({
      rubric: "Is this grounded?",
      subject: "Subject text.",
      mode: "adjudicate",
    });

    expect(result.verdict).toBe("pass");
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.trace.escalated).toBe(true);
    expect(mockRoute).toHaveBeenCalledTimes(2);
    expect(forcedModelOfCall(0)).toBe(JUDGE_SCREEN_MODEL);
    expect(forcedModelOfCall(1)).toBe(JUDGE_ADJUDICATE_MODEL);
  });

  it("ESCALATION: a low-confidence screen also escalates", async () => {
    mockRoute
      .mockResolvedValueOnce(
        asResponse({ verdict: "pass", confidence: 0.6, borderline: false, reason: "Probably ok." })
      )
      .mockResolvedValueOnce(
        asResponse({ verdict: "fail", confidence: 0.85, borderline: false, reason: "On review, uncited." })
      );

    const result = await judge({ rubric: "r", subject: "s", mode: "adjudicate" });

    expect(result.verdict).toBe("fail");
    expect(result.trace.escalated).toBe(true);
  });

  it("FAIL-CLOSED: a model error on a safety-critical rubric resolves to fail", async () => {
    mockRoute.mockRejectedValueOnce(new Error("provider timeout"));

    const result = await judge({
      rubric: "Does this action show permission escalation?",
      subject: "Agent grants itself admin.",
      mode: "adjudicate",
      failClosed: true,
    });

    expect(result.verdict).toBe("fail");
    expect(result.confidence).toBe(1);
    expect(result.trace.failedClosed).toBe(true);
  });

  it("FAIL-OPEN: a model error on an advisory rubric resolves to pass when failClosed=false", async () => {
    mockRoute.mockRejectedValueOnce(new Error("provider timeout"));

    const result = await judge({
      rubric: "Is the tone friendly?",
      subject: "Hello.",
      mode: "adjudicate",
      failClosed: false,
    });

    expect(result.verdict).toBe("pass");
    expect(result.trace.failedClosed).toBe(false);
  });

  it("SCREEN-only mode never escalates even on a fail", async () => {
    mockRoute.mockResolvedValueOnce(
      asResponse({ verdict: "fail", confidence: 0.9, borderline: false, reason: "Bad." })
    );

    const result = await judge({ rubric: "r", subject: "s", mode: "screen" });

    expect(result.verdict).toBe("fail");
    expect(result.trace.mode).toBe("screen");
    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(forcedModelOfCall(0)).toBe(JUDGE_SCREEN_MODEL);
  });

  it("PANEL: minority veto — one fail among passes fails the panel", async () => {
    mockRoute
      .mockResolvedValueOnce(asResponse({ verdict: "pass", confidence: 0.9, borderline: false, reason: "ok" }))
      .mockResolvedValueOnce(asResponse({ verdict: "fail", confidence: 0.8, borderline: false, reason: "scope creep" }))
      .mockResolvedValueOnce(asResponse({ verdict: "pass", confidence: 0.9, borderline: false, reason: "ok" }));

    const result = await judge({
      rubric: "Constitutional drift?",
      subject: "proposed action",
      mode: "panel",
      panelSize: 3,
    });

    expect(result.verdict).toBe("fail");
    expect(result.reason).toContain("scope creep");
    expect(result.trace.votes).toEqual(["pass", "fail", "pass"]);
    // All three judges ran on the Sonnet adjudicator.
    expect(mockRoute).toHaveBeenCalledTimes(3);
    expect(forcedModelOfCall(0)).toBe(JUDGE_ADJUDICATE_MODEL);
    expect(forcedModelOfCall(2)).toBe(JUDGE_ADJUDICATE_MODEL);
  });

  it("PANEL: unanimous pass returns pass with the least-sure member's confidence", async () => {
    mockRoute
      .mockResolvedValueOnce(asResponse({ verdict: "pass", confidence: 0.95, borderline: false, reason: "ok" }))
      .mockResolvedValueOnce(asResponse({ verdict: "pass", confidence: 0.7, borderline: false, reason: "ok" }))
      .mockResolvedValueOnce(asResponse({ verdict: "pass", confidence: 0.85, borderline: false, reason: "ok" }));

    const result = await judge({ rubric: "r", subject: "s", mode: "panel" });

    expect(result.verdict).toBe("pass");
    expect(result.confidence).toBeCloseTo(0.7);
  });

  it("PANEL: any judge error fails the whole panel closed", async () => {
    mockRoute
      .mockResolvedValueOnce(asResponse({ verdict: "pass", confidence: 0.9, borderline: false, reason: "ok" }))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(asResponse({ verdict: "pass", confidence: 0.9, borderline: false, reason: "ok" }));

    const result = await judge({ rubric: "r", subject: "s", mode: "panel", failClosed: true });

    expect(result.verdict).toBe("fail");
    expect(result.trace.failedClosed).toBe(true);
  });

  it("tolerates fenced-JSON model output", async () => {
    mockRoute.mockResolvedValueOnce({
      content: '```json\n{"verdict":"pass","confidence":0.9,"borderline":false,"reason":"ok"}\n```',
      provider: "openrouter",
      model: "x",
    } as any);

    const result = await judge({ rubric: "r", subject: "s", mode: "screen" });
    expect(result.verdict).toBe("pass");
  });

  it("defaults to adjudicate mode and passes orgId + taskType through to the router", async () => {
    mockRoute.mockResolvedValueOnce(
      asResponse({ verdict: "pass", confidence: 0.95, borderline: false, reason: "ok" })
    );

    await judge({ rubric: "r", subject: "s", orgId: 42, taskType: "pax_grounding" });

    const [task, config] = mockRoute.mock.calls[0];
    expect(task.taskType).toBe("pax_grounding");
    expect(config?.orgId).toBe(42);
    expect(config?.skipBudget).toBe(true);
    expect(config?.forceModel).toBe(JUDGE_SCREEN_MODEL);
  });
});
