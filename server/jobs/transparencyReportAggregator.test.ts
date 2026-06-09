/**
 * Tests for the transparency-report aggregator — founder-bypass accountability.
 *
 * Locks the honesty loop closed (Quinn, 0147): the public /transparency
 * `founderBypassCount` is now driven by a REAL `is_founder_bypass = true`
 * marker written by founderBypass.founderDispatch, not the dead reasoning-regex
 * that nothing ever wrote (which kept the published count permanently 0).
 *
 * Coverage:
 *   1. founderBypassCount > 0 when N real is_founder_bypass rows exist in window
 *   2. founderBypassCount === 0 when no bypass rows exist (no false inflation)
 *   3. The bypass query keys on `is_founder_bypass = true`, never the old regex
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── DB mock ─────────────────────────────────────────────────────────────────
// `db.execute` returns objects with `.rows`. We dispatch on the reassembled SQL
// string to decide which table is being counted. The founder-bypass count is
// the only one this suite drives non-zero.
interface MockState {
  /** Number of real is_founder_bypass=true rows in the window. */
  founderBypassRows: number;
  /** Last SQL text the bypass-count branch saw (assertion hook). */
  lastBypassSql: string | null;
}

const STATE: MockState = {
  founderBypassRows: 0,
  lastBypassSql: null,
};

function resetState() {
  STATE.founderBypassRows = 0;
  STATE.lastBypassSql = null;
}

/**
 * Reassemble the SQL string from drizzle's queryChunks. queryChunks alternates
 * between StringChunk objects (`{value: [str]}`) and raw parameter values.
 */
function reassembleSql(q: any): string {
  const chunks = q?.queryChunks;
  if (!Array.isArray(chunks)) return String(q ?? "");
  let text = "";
  let p = 0;
  for (const chunk of chunks) {
    if (chunk && typeof chunk === "object" && Array.isArray(chunk.value)) {
      text += chunk.value.join("");
    } else {
      p += 1;
      text += "$" + p;
    }
  }
  return text;
}

vi.mock("../db", () => ({
  db: {
    execute: vi.fn(async (q: any) => {
      const text = reassembleSql(q);
      // Founder-bypass count query — the one this suite exercises.
      if (
        text.includes("FROM solene_pre_call_decisions") &&
        text.includes("is_founder_bypass")
      ) {
        STATE.lastBypassSql = text;
        return { rows: [{ c: STATE.founderBypassRows }] };
      }
      // Refusal + appeal queries: return empty so totals are 0.
      return { rows: [] };
    }),
  },
}));

// Stub the alignment detectors so collectAlignmentDriftFindings (not under
// test here) doesn't reach for the real registry.
vi.mock("../services/pax/alignmentDetectors", () => ({
  alignmentDetectors: [],
}));

let aggregateCounts: (
  start: Date,
  end: Date,
) => Promise<{ founderBypassCount: number }>;

beforeEach(async () => {
  resetState();
  vi.clearAllMocks();
  ({ aggregateCounts } = await import("./transparencyReportAggregator"));
});

describe("transparencyReportAggregator — founder-bypass accountability", () => {
  const start = new Date("2026-03-01T00:00:00.000Z");
  const end = new Date("2026-06-01T00:00:00.000Z");

  it("counts N real is_founder_bypass rows → founderBypassCount > 0", async () => {
    STATE.founderBypassRows = 3;
    const counts = await aggregateCounts(start, end);
    expect(counts.founderBypassCount).toBe(3);
    expect(counts.founderBypassCount).toBeGreaterThan(0);
  });

  it("counts a single bypass row → founderBypassCount === 1", async () => {
    STATE.founderBypassRows = 1;
    const counts = await aggregateCounts(start, end);
    expect(counts.founderBypassCount).toBe(1);
  });

  it("never inflates — no bypass rows → founderBypassCount === 0", async () => {
    STATE.founderBypassRows = 0;
    const counts = await aggregateCounts(start, end);
    expect(counts.founderBypassCount).toBe(0);
  });

  it("keys the count on the real is_founder_bypass marker, not the dead regex", async () => {
    STATE.founderBypassRows = 2;
    await aggregateCounts(start, end);
    expect(STATE.lastBypassSql).toContain("is_founder_bypass = true");
    // The fragile reasoning-regex must be gone — it was never written, so it
    // would always have produced 0.
    expect(STATE.lastBypassSql).not.toContain("founder.bypass");
    expect(STATE.lastBypassSql).not.toContain("sovereign.veto");
  });
});
