/**
 * T3-3D sub-item 6 — unit tests for the unified `resolveModel` resolver.
 *
 * Mock-only: every wrapped axis function is mocked so the test asserts
 * COMPOSITION + PRECEDENCE, not the wrapped functions' internals (those have
 * their own tests). No DB, no network.
 *
 * Asserts:
 *   1. Axes compose in the documented precedence
 *      (cost-ceiling → force-pin → complexity/base → tier ceiling →
 *       task-type floor → prompt-version stamp).
 *   2. A config force-pin OVERRIDES the base and skips tier/task axes
 *      (mirrors the live aiRouter hasHardPin behavior).
 *   3. The tier ceiling clamps the model down from the base.
 *   4. The task-type floor downgrades below the tier ceiling.
 *   5. The cost-ceiling kill records its trace entry first.
 *   6. The trace carries one entry per axis, each with a reason string.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock every wrapped module BEFORE importing the resolver ──────────────────
const selectProviderAndModelAsync = vi.fn();
const classifyTaskComplexity = vi.fn();
const pickPaxModelForOrg = vi.fn();
const pickPaxModelForTask = vi.fn();
const getEffectiveCeilings = vi.fn();

vi.mock("../../server/services/aiRouter", () => ({
  selectProviderAndModelAsync: (...a: unknown[]) => selectProviderAndModelAsync(...a),
  classifyTaskComplexity: (...a: unknown[]) => classifyTaskComplexity(...a),
  // Enum shape used by the resolver's default-complexity path.
  TaskComplexity: {
    SIMPLE: "simple",
    MODERATE: "moderate",
    COMPLEX: "complex",
    CRITICAL: "critical",
  },
}));

vi.mock("../../server/services/paxModelTier", () => ({
  pickPaxModelForOrg: (...a: unknown[]) => pickPaxModelForOrg(...a),
}));

vi.mock("../../server/ai/paxModelTier", () => ({
  pickPaxModelForTask: (...a: unknown[]) => pickPaxModelForTask(...a),
  DEFAULT_ROUTING_CONFIG: { enabled: true, policies: {} },
}));

vi.mock("../../server/ai/paxPromptVersions", () => ({
  DEFAULT_PAX_PROMPT_VERSION: "v3",
  parsePaxPromptVersion: (raw: unknown) => (raw === "v2" || raw === "v3" ? raw : "v3"),
}));

// vi.hoisted so the class is initialized BEFORE the hoisted vi.mock factory
// references it directly as a value (a plain `class` decl would be in the TDZ
// at hoist time → "Cannot access AiCostCeilingExceededError before initialization").
const { AiCostCeilingExceededError } = vi.hoisted(() => {
  class AiCostCeilingExceededError extends Error {
    readonly code = "AI_COST_CEILING_EXCEEDED" as const;
  }
  return { AiCostCeilingExceededError };
});
vi.mock("../../server/services/aiCostCeiling", () => ({
  getEffectiveCeilings: (...a: unknown[]) => getEffectiveCeilings(...a),
  AiCostCeilingExceededError,
}));

const HAIKU = "anthropic/claude-haiku-4-5-20251001";
const SONNET = "anthropic/claude-sonnet-4-6";
const OPUS = "anthropic/claude-opus-4-8";

import { resolveModel, type RouteAxis } from "../../server/services/modelRouter";

const fakeClient = {} as never;

function axes(trace: Array<{ axis: RouteAxis }>): RouteAxis[] {
  return trace.map((t) => t.axis);
}

beforeEach(() => {
  vi.clearAllMocks();
  classifyTaskComplexity.mockReturnValue("complex");
  // Base selection (force-pin + complexity/DB axes both resolve here).
  selectProviderAndModelAsync.mockResolvedValue({
    provider: "openrouter",
    model: OPUS,
    client: fakeClient,
    maxTokens: 4096,
  });
  // Org is within its cost ceiling.
  getEffectiveCeilings.mockResolvedValue({
    dailyCents: 5000,
    monthlyCents: 100000,
    source: "platform_default",
  });
  // Tier ceiling: Scale → Opus by default.
  pickPaxModelForOrg.mockResolvedValue({
    model: OPUS,
    tier: "scale",
    reason: "tier_default",
    isDowngraded: false,
    msgCountThisMonth: 3,
  });
  // Task-type floor: no downgrade by default.
  pickPaxModelForTask.mockReturnValue({
    model: OPUS,
    taskType: "general",
    tierCeilingModel: OPUS,
    downgraded: false,
    reason: "task_not_eval_supported",
  });
});

describe("resolveModel — axis composition + precedence", () => {
  it("emits exactly one trace entry per axis, in precedence order, each with a reason", async () => {
    const res = await resolveModel({
      organizationId: 42,
      taskType: "pax_chat",
      userText: "tell me about this parcel",
      surface: "processChat",
    });

    expect(axes(res.decisionTrace)).toEqual([
      "cost_ceiling_kill",
      "config_force_pin",
      "complexity_db_base",
      "tier_ceiling_clamp",
      "task_type_floor",
      "prompt_version_stamp",
    ]);
    for (const entry of res.decisionTrace) {
      expect(typeof entry.reason).toBe("string");
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it("cost-ceiling kill is the FIRST axis recorded", async () => {
    const res = await resolveModel({ organizationId: 7, taskType: "pax_chat" });
    expect(res.decisionTrace[0].axis).toBe("cost_ceiling_kill");
  });
});

describe("resolveModel — force-pin overrides base and skips tier/task axes", () => {
  it("useCritical force-pin wins; tier ceiling + task floor are NOT applied", async () => {
    selectProviderAndModelAsync.mockResolvedValue({
      provider: "openrouter",
      model: OPUS,
      client: fakeClient,
      maxTokens: 4096,
    });

    const res = await resolveModel({
      organizationId: 42,
      taskType: "pax_chat",
      userText: "what's the flood zone?", // would otherwise classify as a lookup
      config: { useCritical: true },
    });

    expect(res.model).toBe(OPUS);
    // Force-pin short-circuits: neither delegate is consulted.
    expect(pickPaxModelForOrg).not.toHaveBeenCalled();
    expect(pickPaxModelForTask).not.toHaveBeenCalled();

    const pin = res.decisionTrace.find((t) => t.axis === "config_force_pin")!;
    expect(pin.output).toBe(OPUS);
    expect(pin.reason).toContain("useCritical");
  });
});

describe("resolveModel — tier ceiling clamps the base down", () => {
  it("a Free org (Haiku ceiling) clamps the Opus base to Haiku", async () => {
    pickPaxModelForOrg.mockResolvedValue({
      model: HAIKU,
      tier: "free",
      reason: "tier_default",
      isDowngraded: false,
      msgCountThisMonth: 0,
    });
    pickPaxModelForTask.mockReturnValue({
      model: HAIKU,
      taskType: "general",
      tierCeilingModel: HAIKU,
      downgraded: false,
      reason: "ceiling_below_floor",
    });

    const res = await resolveModel({
      organizationId: 99,
      taskType: "pax_chat",
      userText: "hello",
    });

    expect(res.model).toBe(HAIKU);
    const clamp = res.decisionTrace.find((t) => t.axis === "tier_ceiling_clamp")!;
    expect(clamp.output).toBe(HAIKU);
    expect(clamp.reason).toContain("free");
  });
});

describe("resolveModel — task-type floor downgrades below the tier ceiling", () => {
  it("a lookup turn on a Scale org (Opus ceiling) downgrades to the eval floor", async () => {
    // Tier ceiling = Opus; the task-type floor routes a restatement turn down.
    pickPaxModelForTask.mockReturnValue({
      model: HAIKU,
      taskType: "data_lookup_restate",
      tierCeilingModel: OPUS,
      downgraded: true,
      reason: "downgraded_to_floor",
    });

    const res = await resolveModel({
      organizationId: 5,
      taskType: "pax_chat",
      userText: "what's the flood zone for this lot?",
    });

    expect(res.model).toBe(HAIKU);
    const floor = res.decisionTrace.find((t) => t.axis === "task_type_floor")!;
    expect(floor.output).toBe(HAIKU);
    expect(floor.reason).toContain("downgraded_to_floor");
    // The task-floor delegate received the tier ceiling, not the raw base.
    expect(pickPaxModelForTask).toHaveBeenCalledWith(OPUS, expect.any(String), expect.anything());
  });
});

describe("resolveModel — cost-ceiling kill wins over complexity", () => {
  it("records ceiling_exceeded when the ceiling lookup throws the ceiling error", async () => {
    getEffectiveCeilings.mockRejectedValue(new AiCostCeilingExceededError("over"));

    const res = await resolveModel({
      organizationId: 1,
      taskType: "pax_chat",
      userText: "hi",
    });

    const kill = res.decisionTrace.find((t) => t.axis === "cost_ceiling_kill")!;
    expect(kill.output).toBe("ceiling_exceeded");
    // Shadow mode: it does NOT throw — composition continues and still returns a model.
    expect(typeof res.model).toBe("string");
  });
});

describe("resolveModel — prompt-version stamp is observational", () => {
  it("stamps the requested version without changing the model", async () => {
    const res = await resolveModel({
      organizationId: 3,
      taskType: "pax_chat",
      userText: "hi",
      promptVersionIntent: "v2",
    });
    expect(res.promptVersion).toBe("v2");
    const stamp = res.decisionTrace.find((t) => t.axis === "prompt_version_stamp")!;
    expect(stamp.output).toBe("v2");
    // Model still comes from the routing axes, not the prompt version.
    expect(res.model).toBe(OPUS);
  });
});
