/**
 * Tahoe Andrei (#7) — tests for cost-aware Pax model routing by turn type.
 *
 * Covers:
 *   1. The turn classifier maps obvious extraction/reasoning/formatting turns.
 *   2. The router downgrades eval-supported task types below the tier ceiling.
 *   3. The router NEVER downgrades reasoning ("general"/multi-parcel) turns.
 *   4. The router never exceeds the tier ceiling (Free→Haiku stays Haiku).
 *   5. The eval gate / master switch make routing fully reversible.
 */
import { describe, expect, it } from "vitest";
import {
  classifyPaxTaskType,
  pickPaxModelForTask,
  DEFAULT_ROUTING_CONFIG,
  DATA_GROUNDING_EVAL_GREEN,
  PAX_ROUTE_MODEL_HAIKU,
  PAX_ROUTE_MODEL_SONNET,
  PAX_ROUTE_MODEL_OPUS,
  type PaxRoutingConfig,
} from "./paxModelTier";

describe("classifyPaxTaskType", () => {
  it("classifies single-fact lookups as data_lookup_restate", () => {
    expect(classifyPaxTaskType("what's the flood zone for this lot?")).toBe("data_lookup_restate");
    expect(classifyPaxTaskType("does this parcel have wetlands?")).toBe("data_lookup_restate");
    expect(classifyPaxTaskType("who owns APN 123-45-678?")).toBe("data_lookup_restate");
    expect(classifyPaxTaskType("how many acres is it?")).toBe("data_lookup_restate");
  });

  it("classifies digests as data_summary", () => {
    expect(classifyPaxTaskType("give me a summary of this parcel")).toBe("data_summary");
    expect(classifyPaxTaskType("tell me about this property")).toBe("data_summary");
    expect(classifyPaxTaskType("what do we know about this lot?")).toBe("data_summary");
  });

  it("classifies formatting turns as formatting", () => {
    expect(classifyPaxTaskType("format this as a table")).toBe("formatting");
    expect(classifyPaxTaskType("rewrite that as bullet points")).toBe("formatting");
  });

  it("classifies comparisons/valuation as multi_parcel_reasoning", () => {
    expect(classifyPaxTaskType("compare these two parcels")).toBe("multi_parcel_reasoning");
    expect(classifyPaxTaskType("which one is the best deal?")).toBe("multi_parcel_reasoning");
    expect(classifyPaxTaskType("give me a valuation")).toBe("multi_parcel_reasoning");
  });

  it("reasoning precedence beats a data keyword", () => {
    // Mentions 'flood' but is a comparison → must NOT be a lookup downgrade.
    expect(classifyPaxTaskType("compare the flood zones of these two lots")).toBe(
      "multi_parcel_reasoning",
    );
  });

  it("falls back to general for unclassified / empty turns", () => {
    expect(classifyPaxTaskType("")).toBe("general");
    expect(classifyPaxTaskType("hey there")).toBe("general");
  });
});

describe("pickPaxModelForTask — downgrades on eval-supported types", () => {
  it("routes a lookup turn from Opus ceiling down to Haiku", () => {
    const r = pickPaxModelForTask(PAX_ROUTE_MODEL_OPUS, "what's the flood zone?");
    expect(r.taskType).toBe("data_lookup_restate");
    expect(r.model).toBe(PAX_ROUTE_MODEL_HAIKU);
    expect(r.downgraded).toBe(true);
    expect(r.reason).toBe("downgraded_to_floor");
  });

  it("routes a summary turn from Opus ceiling down to Sonnet (its floor)", () => {
    const r = pickPaxModelForTask(PAX_ROUTE_MODEL_OPUS, "summarize this parcel");
    expect(r.taskType).toBe("data_summary");
    expect(r.model).toBe(PAX_ROUTE_MODEL_SONNET);
    expect(r.downgraded).toBe(true);
  });

  it("routes a formatting turn down to Haiku", () => {
    const r = pickPaxModelForTask(PAX_ROUTE_MODEL_OPUS, "format this as a list");
    expect(r.model).toBe(PAX_ROUTE_MODEL_HAIKU);
    expect(r.downgraded).toBe(true);
  });
});

describe("pickPaxModelForTask — reasoning stays on the top model", () => {
  it("never downgrades a multi-parcel reasoning turn", () => {
    const r = pickPaxModelForTask(PAX_ROUTE_MODEL_OPUS, "compare these two parcels");
    expect(r.taskType).toBe("multi_parcel_reasoning");
    expect(r.model).toBe(PAX_ROUTE_MODEL_OPUS);
    expect(r.downgraded).toBe(false);
    expect(r.reason).toBe("task_not_eval_supported");
  });

  it("never downgrades a general turn", () => {
    const r = pickPaxModelForTask(PAX_ROUTE_MODEL_OPUS, "hey, can you help?");
    expect(r.taskType).toBe("general");
    expect(r.model).toBe(PAX_ROUTE_MODEL_OPUS);
    expect(r.downgraded).toBe(false);
  });
});

describe("pickPaxModelForTask — never exceeds the tier ceiling", () => {
  it("a Free (Haiku) ceiling stays Haiku even for a summary turn whose floor is Sonnet", () => {
    const r = pickPaxModelForTask(PAX_ROUTE_MODEL_HAIKU, "summarize this parcel");
    expect(r.model).toBe(PAX_ROUTE_MODEL_HAIKU);
    expect(r.downgraded).toBe(false);
    expect(r.reason).toBe("ceiling_below_floor");
  });

  it("a Sonnet ceiling on a summary turn (floor=Sonnet) is unchanged", () => {
    const r = pickPaxModelForTask(PAX_ROUTE_MODEL_SONNET, "give me the rundown on this lot");
    expect(r.model).toBe(PAX_ROUTE_MODEL_SONNET);
    expect(r.downgraded).toBe(false);
  });

  it("a Sonnet ceiling on a lookup turn downgrades to Haiku", () => {
    const r = pickPaxModelForTask(PAX_ROUTE_MODEL_SONNET, "what's the flood zone?");
    expect(r.model).toBe(PAX_ROUTE_MODEL_HAIKU);
    expect(r.downgraded).toBe(true);
  });
});

describe("pickPaxModelForTask — reversibility / gating", () => {
  it("master switch off never downgrades", () => {
    const off: PaxRoutingConfig = { ...DEFAULT_ROUTING_CONFIG, enabled: false };
    const r = pickPaxModelForTask(PAX_ROUTE_MODEL_OPUS, "what's the flood zone?", off);
    expect(r.model).toBe(PAX_ROUTE_MODEL_OPUS);
    expect(r.downgraded).toBe(false);
    expect(r.reason).toBe("routing_disabled");
  });

  it("the shipped eval gate is green (routing is active)", () => {
    // Guards against accidentally shipping with the gate flipped off. If the
    // eval is intentionally re-baselined, update this expectation deliberately.
    expect(DATA_GROUNDING_EVAL_GREEN).toBe(true);
  });

  it("an unknown ceiling model is treated as top capability (safe, no spurious downgrade above it)", () => {
    // gpt-4o vision fallback never reaches the cost router in executive.ts, but
    // the router must still behave safely if handed an unrecognised id.
    const r = pickPaxModelForTask("openai/gpt-4o", "what's the flood zone?");
    // Unknown ceiling (rank 99) > Haiku floor → downgrade to the recognised floor.
    expect(r.model).toBe(PAX_ROUTE_MODEL_HAIKU);
  });
});
