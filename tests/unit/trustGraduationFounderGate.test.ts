/**
 * Founder gate on trust graduation (Sovereign Principle 10 — no agent may
 * unilaterally expand its own authority).
 *
 * THE LAW under test: auto-promotion stops at notify-only; silent execution
 * requires the founder's explicit override (force_silent); demotion is
 * always automatic. Plus: an ambiguous approve of a shadow-promotion card
 * resolves conservative ("hold"), never as a grant.
 *
 * DB-free — the drizzle db module is mocked (house pattern, see
 * founderInterruptArbiter.test.ts / letterReply.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// ── mocked db (house pattern) ───────────────────────────────────────────
const state: {
  selectRows: any[];
  updates: Array<Record<string, any>>;
  inserts: Array<Record<string, any>>;
} = { selectRows: [], updates: [], inserts: [] };

vi.mock("../../server/db", () => ({
  db: {
    select: (_proj?: any) => ({
      from: (_t: any) => ({
        where: (_cond: any) => {
          const p: any = Promise.resolve([...state.selectRows]);
          p.limit = async (n: number) => [...state.selectRows].slice(0, n);
          return p;
        },
      }),
    }),
    update: (_t: any) => ({
      set: (vals: Record<string, any>) => ({
        where: async (_cond: any) => {
          state.updates.push(vals);
        },
      }),
    }),
    insert: (_t: any) => ({
      values: (vals: Record<string, any>) => {
        state.inserts.push(vals);
        return { returning: async () => [{ id: 999, ...vals }] };
      },
    }),
  },
}));

const loggerInfo = vi.fn();
vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  PROMOTE_THRESHOLDS,
  recordAcceptance,
  reconcileSilentTiers,
  overrideTier,
} from "../../server/services/trustGraduation";

function gradRow(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    agentCodename: "sophie",
    actionCategory: "copy_change",
    graduationTier: "notify_only",
    consecutiveAccepted: 0,
    consecutiveRetracted: 0,
    totalAccepted: 0,
    totalRetracted: 0,
    founderOverride: null,
    tierChangedAt: new Date("2026-07-01T00:00:00Z"),
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  state.selectRows = [];
  state.updates = [];
  state.inserts = [];
  loggerInfo.mockClear();
});

describe("promotion ladder is clamped at notify_only", () => {
  it("notify_only's next tier is null — auto-promotion can never reach silent", () => {
    expect(PROMOTE_THRESHOLDS.notify_only).toBeNull();
    expect(PROMOTE_THRESHOLDS.silent).toBeNull();
    // the only auto-promotion left is manual → notify_only
    expect(PROMOTE_THRESHOLDS.manual).toBe("notify_only");
    // and "silent" is nobody's auto-promotion target
    expect(Object.values(PROMOTE_THRESHOLDS)).not.toContain("silent");
  });

  it("recordAcceptance at notify_only with a 50-streak stays notify_only and logs silent-eligibility", async () => {
    state.selectRows = [gradRow({ graduationTier: "notify_only", consecutiveAccepted: 49 })];
    const result = await recordAcceptance("sophie", "copy_change");
    expect(result.tierChanged).toBe(false);
    expect(result.newTier).toBe("notify_only");
    // the persisted row keeps counting the streak, tier untouched
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].graduationTier).toBe("notify_only");
    expect(state.updates[0].consecutiveAccepted).toBe(50);
    // eligibility is annunciated, not silently granted
    const logged = loggerInfo.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/silent-ELIGIBLE/);
    expect(logged).toMatch(/force_silent/);
  });

  it("manual → notify_only auto-promotion still works (supervised loosening only)", async () => {
    state.selectRows = [gradRow({ graduationTier: "manual", consecutiveAccepted: 9 })];
    const result = await recordAcceptance("sophie", "copy_change");
    expect(result.tierChanged).toBe(true);
    expect(result.newTier).toBe("notify_only");
  });

  it("overrideTier remains the founder's path to silent (force_silent)", async () => {
    state.selectRows = [gradRow({ graduationTier: "notify_only" })];
    await overrideTier("sophie", "copy_change", "silent", "force_silent");
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].graduationTier).toBe("silent");
    expect(state.updates[0].founderOverride).toBe("force_silent");
  });
});

describe("reconcileSilentTiers — one-shot re-collar of auto-graduated silent pairs", () => {
  it("demotes silent rows WITHOUT force_silent to notify_only and leaves force_silent rows untouched", async () => {
    state.selectRows = [
      gradRow({ id: 11, agentCodename: "sophie", actionCategory: "copy_change", graduationTier: "silent", founderOverride: null }),
      gradRow({ id: 12, agentCodename: "sophie", actionCategory: "dependency_bump", graduationTier: "silent", founderOverride: "force_silent" }),
      gradRow({ id: 13, agentCodename: "marcus", actionCategory: "schema_column_fix", graduationTier: "silent", founderOverride: null }),
    ];
    const result = await reconcileSilentTiers();
    expect(result).toEqual({ demoted: 2 });
    // exactly the two non-founder-granted rows were written, both to notify_only
    expect(state.updates).toHaveLength(2);
    for (const update of state.updates) {
      expect(update.graduationTier).toBe("notify_only");
    }
    // each demotion is logged
    const logged = loggerInfo.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/sophie:copy_change/);
    expect(logged).toMatch(/marcus:schema_column_fix/);
    expect(logged).not.toMatch(/sophie:dependency_bump/);
  });

  it("returns {demoted: 0} and writes nothing when every silent row is founder-granted", async () => {
    state.selectRows = [
      gradRow({ id: 21, graduationTier: "silent", founderOverride: "force_silent" }),
    ];
    const result = await reconcileSilentTiers();
    expect(result).toEqual({ demoted: 0 });
    expect(state.updates).toHaveLength(0);
  });
});

describe("shadow-promotion approve route defaults conservative (source-shape)", () => {
  it('routes-founder-intelligence.ts resolves an ambiguous approve as "hold", never "grant"', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes-founder-intelligence.ts"),
      "utf8",
    );
    const blockStart = src.indexOf('itemType === "shadow_promotion_request"');
    expect(blockStart).toBeGreaterThan(-1);
    const block = src.slice(blockStart, blockStart + 600);
    expect(block).toMatch(/optionKey:\s*chosen\?\.key\s*\?\?\s*"hold"/);
    expect(block).not.toMatch(/\?\?\s*"grant"/);
    // nowhere in the file may an absent option default to a grant
    expect(src).not.toMatch(/\?\?\s*"grant"/);
  });
});
