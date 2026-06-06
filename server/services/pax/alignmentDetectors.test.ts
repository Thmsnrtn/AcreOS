/**
 * Tests for Quinn's alignment detectors (Tahoe wave E2).
 *
 * Coverage:
 *   1. Citation validator catches bad immutable references at boot
 *   2. founder-bypass detector emits findings only for undocumented bypasses
 *   3. refusal-rate-drift detector fires on >2σ over- AND under-refusal
 *   4. sim-vs-real divergence detector fires on >25% ratio shift
 *   5. All three detectors run cleanly against the buildAlignmentDetectorsForTest
 *      factory (i.e. the test substrate is honest)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── DB mock ─────────────────────────────────────────────────────────────
interface MockState {
  // For founder-bypass detector:
  preCallBypassRows: Array<{
    id: number;
    dispatch_id: number | null;
    agent_role: string;
    reasoning: string;
    decided_at: Date;
  }>;
  reviewedDispatchIds: Set<number>; // audit_events rows present

  // For refusal-rate-drift detector:
  refusalCountsByWindow: Map<string, number>; // key = "start..end"
  assistantMessageCountsByWindow: Map<string, number>;

  // For sim-vs-real divergence detector:
  simCountsByWindow: Map<string, number>;
  realCountsByWindow: Map<string, number>;
}

const STATE: MockState = {
  preCallBypassRows: [],
  reviewedDispatchIds: new Set(),
  refusalCountsByWindow: new Map(),
  assistantMessageCountsByWindow: new Map(),
  simCountsByWindow: new Map(),
  realCountsByWindow: new Map(),
};

function resetState() {
  STATE.preCallBypassRows = [];
  STATE.reviewedDispatchIds = new Set();
  STATE.refusalCountsByWindow = new Map();
  STATE.assistantMessageCountsByWindow = new Map();
  STATE.simCountsByWindow = new Map();
  STATE.realCountsByWindow = new Map();
}

function windowKey(start: string, end: string): string {
  return `${start.slice(0, 10)}..${end.slice(0, 10)}`;
}

// Mock the db: execute returns objects with `.rows`. We dispatch on the
// SQL string to decide which counter to read.
/**
 * Reassemble the SQL string + parameter list from drizzle's queryChunks.
 * queryChunks alternates between StringChunk objects (`{value: [str]}`) and
 * raw parameter values (strings, numbers, dates). We collect both.
 */
function reassembleSql(q: any): { text: string; params: unknown[] } {
  const chunks = q?.queryChunks;
  if (!Array.isArray(chunks)) {
    return { text: String(q ?? ""), params: [] };
  }
  let text = "";
  const params: unknown[] = [];
  for (const chunk of chunks) {
    if (chunk && typeof chunk === "object" && Array.isArray(chunk.value)) {
      text += chunk.value.join("");
    } else {
      params.push(chunk);
      text += "$" + params.length;
    }
  }
  return { text, params };
}

vi.mock("../../db", () => ({
  db: {
    execute: vi.fn(async (q: any) => {
      const { text, params } = reassembleSql(q);
      // First two params on every count query are ISO date strings (start, end).
      const start =
        typeof params[0] === "string" ? (params[0] as string) : "";
      const end = typeof params[1] === "string" ? (params[1] as string) : "";
      // Match the founder-bypass query (params: only cutoff)
      if (text.includes("FROM solene_pre_call_decisions")) {
        return { rows: STATE.preCallBypassRows };
      }
      // Match the refusal-rate query
      if (text.includes("FROM pax_refusal_payloads") && start && end) {
        const key = windowKey(start, end);
        return {
          rows: [{ c: STATE.refusalCountsByWindow.get(key) ?? 0 }],
        };
      }
      // Match the assistant-message count
      if (text.includes("FROM ai_messages") && start && end) {
        const key = windowKey(start, end);
        return {
          rows: [{ c: STATE.assistantMessageCountsByWindow.get(key) ?? 0 }],
        };
      }
      // Sim-vs-real
      if (text.includes("FROM simulated_actions") && start && end) {
        const key = windowKey(start, end);
        return { rows: [{ c: STATE.simCountsByWindow.get(key) ?? 0 }] };
      }
      if (text.includes("FROM audit_events") && start && end) {
        const key = windowKey(start, end);
        return { rows: [{ c: STATE.realCountsByWindow.get(key) ?? 0 }] };
      }
      return { rows: [] };
    }),

    // Drizzle query-builder shape for the auditEvents review-row check.
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            // We need to figure out the dispatch_id from the where clause.
            // Since drizzle's where is a black-box expression, instead we
            // expose a simple convention: the test re-keys the
            // reviewedDispatchIds Set with the dispatch id, and the mock
            // here checks the LAST queried row (set just before the call).
            const lastQueriedDispatchId = (
              global as any
            ).__lastQueriedDispatchId as number | undefined;
            if (
              lastQueriedDispatchId !== undefined &&
              STATE.reviewedDispatchIds.has(lastQueriedDispatchId)
            ) {
              return [{ id: 1 }];
            }
            return [];
          }),
        })),
      })),
    })),
  },
}));

// Patch the detector's `eq` calls so we can read the dispatch_id off the
// SQL the detector builds. We monkey-patch dispatch_id setter via the test
// surfacing global.
import { buildAlignmentDetectorsForTest } from "./alignmentDetectors";
import { validateImmutableCitation, assertDetectorCitations } from "./alignmentDetectors";

describe("alignment detectors — citation validator", () => {
  it("accepts customer:N for known customer immutables", () => {
    expect(validateImmutableCitation("customer:1")).toBe(true);
    expect(validateImmutableCitation("customer:12")).toBe(true);
  });

  it("accepts sovereign:N for known sovereign principles", () => {
    expect(validateImmutableCitation("sovereign:1")).toBe(true);
    expect(validateImmutableCitation("sovereign:10")).toBe(true);
  });

  it("rejects unknown immutable scope or number", () => {
    expect(validateImmutableCitation("customer:99")).toBe(false);
    expect(validateImmutableCitation("sovereign:99")).toBe(false);
    expect(validateImmutableCitation("nonexistent:1")).toBe(false);
    expect(validateImmutableCitation("not-a-citation")).toBe(false);
  });

  it("assertDetectorCitations throws when any detector cites a bad immutable", () => {
    expect(() =>
      assertDetectorCitations([
        {
          id: "bad",
          scope: "alignment",
          severityFloor: "warn",
          citedImmutables: ["customer:99"],
          run: async () => [],
        },
      ]),
    ).toThrow(/customer:99/);
  });
});

describe("founder-bypass detector", () => {
  beforeEach(() => {
    resetState();
  });

  it("emits NO finding when there are no bypass rows", async () => {
    const detectors = buildAlignmentDetectorsForTest({});
    const founderBypass = detectors.find(
      (d) => d.id === "founder_bypass_undocumented",
    )!;
    const { db } = await import("../../db");
    const findings = await founderBypass.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings).toHaveLength(0);
  });

  it("emits a finding when a bypass row has no documented review", async () => {
    STATE.preCallBypassRows = [
      {
        id: 1,
        dispatch_id: 100,
        agent_role: "solene",
        reasoning: "founder bypass — strategic incident",
        decided_at: new Date(),
      },
    ];
    STATE.reviewedDispatchIds = new Set(); // no reviews
    (global as any).__lastQueriedDispatchId = 100;

    const detectors = buildAlignmentDetectorsForTest({});
    const founderBypass = detectors.find(
      (d) => d.id === "founder_bypass_undocumented",
    )!;
    const { db } = await import("../../db");
    const findings = await founderBypass.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].evidence.dispatchId).toBe(100);
    expect(findings[0].summary).toMatch(/no documented post-hoc review/i);
  });

  it("emits NO finding when the bypass HAS a documented review row", async () => {
    STATE.preCallBypassRows = [
      {
        id: 1,
        dispatch_id: 100,
        agent_role: "solene",
        reasoning: "founder bypass — strategic incident",
        decided_at: new Date(),
      },
    ];
    STATE.reviewedDispatchIds = new Set([100]);
    (global as any).__lastQueriedDispatchId = 100;

    const detectors = buildAlignmentDetectorsForTest({});
    const founderBypass = detectors.find(
      (d) => d.id === "founder_bypass_undocumented",
    )!;
    const { db } = await import("../../db");
    const findings = await founderBypass.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings).toHaveLength(0);
  });
});

describe("refusal-rate-drift detector", () => {
  beforeEach(() => {
    resetState();
  });

  function seedBaseline(opts: {
    refusalsPerWindow: number[];
    msgsPerWindow: number[];
    currentRefusals: number;
    currentMsgs: number;
  }) {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const currentStart = new Date(now - 7 * dayMs);
    const currentEnd = new Date(now);
    const currKey = windowKey(currentStart.toISOString(), currentEnd.toISOString());
    STATE.refusalCountsByWindow.set(currKey, opts.currentRefusals);
    STATE.assistantMessageCountsByWindow.set(currKey, opts.currentMsgs);
    // Baseline weeks
    const baselineStart = new Date(currentStart.getTime() - 4 * 7 * dayMs);
    for (let w = 0; w < 4; w++) {
      const wStart = new Date(baselineStart.getTime() + w * 7 * dayMs);
      const wEnd = new Date(wStart.getTime() + 7 * dayMs);
      const k = windowKey(wStart.toISOString(), wEnd.toISOString());
      STATE.refusalCountsByWindow.set(k, opts.refusalsPerWindow[w] ?? 0);
      STATE.assistantMessageCountsByWindow.set(k, opts.msgsPerWindow[w] ?? 0);
    }
  }

  it("emits NO finding when current rate is within baseline", async () => {
    seedBaseline({
      refusalsPerWindow: [5, 6, 5, 5],
      msgsPerWindow: [100, 100, 100, 100],
      currentRefusals: 6,
      currentMsgs: 100,
    });
    const detectors = buildAlignmentDetectorsForTest({});
    const drift = detectors.find((d) => d.id === "refusal_rate_drift")!;
    const { db } = await import("../../db");
    const findings = await drift.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings).toHaveLength(0);
  });

  it("emits a finding on over-refusal (>2σ above baseline)", async () => {
    seedBaseline({
      refusalsPerWindow: [5, 5, 5, 5],
      msgsPerWindow: [100, 100, 100, 100],
      currentRefusals: 50, // 50% vs 5% baseline
      currentMsgs: 100,
    });
    const detectors = buildAlignmentDetectorsForTest({});
    const drift = detectors.find((d) => d.id === "refusal_rate_drift")!;
    const { db } = await import("../../db");
    const findings = await drift.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].evidence.direction).toBe("over-refusal");
  });

  it("emits a finding on under-refusal (>2σ below baseline)", async () => {
    seedBaseline({
      refusalsPerWindow: [20, 22, 19, 21],
      msgsPerWindow: [100, 100, 100, 100],
      currentRefusals: 0,
      currentMsgs: 100,
    });
    const detectors = buildAlignmentDetectorsForTest({});
    const drift = detectors.find((d) => d.id === "refusal_rate_drift")!;
    const { db } = await import("../../db");
    const findings = await drift.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].evidence.direction).toBe("under-refusal");
  });

  it("emits NO finding when current window has < 20 assistant messages (weak signal)", async () => {
    seedBaseline({
      refusalsPerWindow: [5, 5, 5, 5],
      msgsPerWindow: [100, 100, 100, 100],
      currentRefusals: 50,
      currentMsgs: 10, // too few
    });
    const detectors = buildAlignmentDetectorsForTest({});
    const drift = detectors.find((d) => d.id === "refusal_rate_drift")!;
    const { db } = await import("../../db");
    const findings = await drift.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings).toHaveLength(0);
  });
});

describe("sim-vs-real divergence detector", () => {
  beforeEach(() => {
    resetState();
  });

  function seedSimReal(opts: {
    thisSim: number;
    thisReal: number;
    lastSim: number;
    lastReal: number;
  }) {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const thisStart = new Date(now - 7 * dayMs);
    const thisEnd = new Date(now);
    const lastStart = new Date(now - 14 * dayMs);
    const lastEnd = thisStart;
    const thisKey = windowKey(thisStart.toISOString(), thisEnd.toISOString());
    const lastKey = windowKey(lastStart.toISOString(), lastEnd.toISOString());
    STATE.simCountsByWindow.set(thisKey, opts.thisSim);
    STATE.simCountsByWindow.set(lastKey, opts.lastSim);
    STATE.realCountsByWindow.set(thisKey, opts.thisReal);
    STATE.realCountsByWindow.set(lastKey, opts.lastReal);
  }

  it("emits NO finding when ratio is stable", async () => {
    seedSimReal({ thisSim: 30, thisReal: 70, lastSim: 32, lastReal: 68 });
    const detectors = buildAlignmentDetectorsForTest({});
    const div = detectors.find((d) => d.id === "sim_vs_real_action_divergence")!;
    const { db } = await import("../../db");
    const findings = await div.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings).toHaveLength(0);
  });

  it("emits a finding on a 25%+ ratio shift", async () => {
    // last week: 10% sim, 90% real. this week: 50% sim, 50% real. Shift =
    // 40 percentage points → above the 0.25 threshold.
    seedSimReal({ thisSim: 50, thisReal: 50, lastSim: 10, lastReal: 90 });
    const detectors = buildAlignmentDetectorsForTest({});
    const div = detectors.find((d) => d.id === "sim_vs_real_action_divergence")!;
    const { db } = await import("../../db");
    const findings = await div.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings.length).toBeGreaterThan(0);
    expect((findings[0].evidence as any).ratioShift).toBeGreaterThanOrEqual(0.25);
  });

  it("emits NO finding when either window has < 10 total actions (weak signal)", async () => {
    seedSimReal({ thisSim: 50, thisReal: 50, lastSim: 1, lastReal: 1 });
    const detectors = buildAlignmentDetectorsForTest({});
    const div = detectors.find((d) => d.id === "sim_vs_real_action_divergence")!;
    const { db } = await import("../../db");
    const findings = await div.run(db as any, {
      start: new Date(),
      end: new Date(),
    });
    expect(findings).toHaveLength(0);
  });
});
