/**
 * The Glass Engine — honesty invariants for the Story door's engine view.
 *
 * Pins three things:
 *  1. deriveLoopStats derives ONLY from recorded entries — an empty history
 *     derives the all-empty shape (no placeholder numbers), sparse traces
 *     never throw, and counts map exactly to outcomes/votes.
 *  2. The engine's level vocabulary tracks the server's DOMAIN_AUTONOMY_LEVELS
 *     and the Controls page's plain-words labels — one vocabulary everywhere.
 *  3. Source shape: the loop's pulse animation is gated on recorded moves
 *     (an animated pulse over an empty history would fabricate liveness), and
 *     the Story page actually mounts both tabs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deriveLoopStats,
  levelFill,
  ENGINE_LEVEL_LABEL,
  ENGINE_LEVEL_ORDER,
  type EngineEntry,
} from "../../client/src/lib/glass-engine";
import { DOMAIN_AUTONOMY_LEVELS } from "../../server/services/autopilot/domainAutonomy";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function entry(over: Partial<EngineEntry>): EngineEntry {
  return { id: 1, at: "2026-07-28T12:00:00.000Z", outcome: "acted", vote: "pending", reasoningTrace: null, ...over };
}

describe("deriveLoopStats — refuse-not-fabricate", () => {
  it("an empty history derives the all-empty shape, never placeholder numbers", () => {
    const s = deriveLoopStats([]);
    expect(s.recordedMoves).toBe(0);
    expect(s.lastMoveAt).toBeNull();
    expect(s.latestSenses).toBeNull();
    expect(s.latestOptionsWeighed).toBeNull();
    expect(s.gates).toEqual({ cleared: 0, askedYou: 0, held: 0 });
    expect(s.acted).toBe(0);
    expect(s.outcomes).toEqual({ wentWell: 0, didntLand: 0, pending: 0 });
    expect(s.lessonsRemembered).toBe(0);
    expect(s.forecastsMade).toBe(0);
  });

  it("sparse/governance entries (no rich trace) derive without throwing", () => {
    const s = deriveLoopStats([
      entry({ id: 1, reasoningTrace: null }),
      entry({ id: 2, reasoningTrace: {} }),
    ]);
    expect(s.recordedMoves).toBe(2);
    expect(s.latestSenses).toBeNull();
    expect(s.latestOptionsWeighed).toBeNull();
  });

  it("maps outcomes to gate verdicts exactly: acted→cleared, escalated→asked, suppressed→held", () => {
    const s = deriveLoopStats([
      entry({ id: 1, outcome: "acted" }),
      entry({ id: 2, outcome: "acted" }),
      entry({ id: 3, outcome: "escalated" }),
      entry({ id: 4, outcome: "suppressed" }),
    ]);
    expect(s.gates).toEqual({ cleared: 2, askedYou: 1, held: 1 });
    expect(s.acted).toBe(2);
  });

  it("scores outcomes from votes and keeps unscored moves honest as pending", () => {
    const s = deriveLoopStats([
      entry({ id: 1, vote: "success" }),
      entry({ id: 2, vote: "failure" }),
      entry({ id: 3, vote: "pending" }),
    ]);
    expect(s.outcomes).toEqual({ wentWell: 1, didntLand: 1, pending: 1 });
  });

  it("takes the newest world-reading and options count (entries arrive newest-first)", () => {
    const s = deriveLoopStats([
      entry({
        id: 2,
        at: "2026-07-28T12:00:00.000Z",
        reasoningTrace: {
          senses: { mrr: 100, trials: 1, supportBacklog: 0, envelopeStatus: "green" },
          consideredMoves: [{ kind: "a" }, { kind: "b" }, { kind: "c" }],
        },
      }),
      entry({
        id: 1,
        at: "2026-07-27T12:00:00.000Z",
        reasoningTrace: {
          senses: { mrr: 50, trials: 0, supportBacklog: 9, envelopeStatus: "amber" },
          consideredMoves: [{ kind: "z" }],
        },
      }),
    ]);
    expect(s.latestSenses?.summary).toContain("MRR $100");
    expect(s.latestSenses?.summary).toContain("1 trial ");
    expect(s.latestOptionsWeighed).toBe(3);
    expect(s.lastMoveAt).toBe("2026-07-28T12:00:00.000Z");
  });

  it("counts lessons and forecasts only where the trace actually carries them", () => {
    const s = deriveLoopStats([
      entry({ id: 1, reasoningTrace: { memory: "learned a thing", forecast: { successProb: 0.7, n: 3, confidence: "low" } } }),
      entry({ id: 2, reasoningTrace: { memory: null, forecast: null } }),
      entry({ id: 3, reasoningTrace: null }),
    ]);
    expect(s.lessonsRemembered).toBe(1);
    expect(s.forecastsMade).toBe(1);
  });
});

describe("level vocabulary — one language across server, Controls, and the Engine", () => {
  it("ENGINE_LEVEL_ORDER tracks the server's DOMAIN_AUTONOMY_LEVELS exactly", () => {
    expect([...ENGINE_LEVEL_ORDER]).toEqual([...DOMAIN_AUTONOMY_LEVELS]);
  });

  it("has a plain-words label for every level, and levelFill is monotone 0→1", () => {
    let prev = -1;
    for (const level of ENGINE_LEVEL_ORDER) {
      expect(ENGINE_LEVEL_LABEL[level]).toBeTruthy();
      const fill = levelFill(level);
      expect(fill).toBeGreaterThan(prev);
      prev = fill;
    }
    expect(levelFill(ENGINE_LEVEL_ORDER[0])).toBe(0);
    expect(levelFill(ENGINE_LEVEL_ORDER[ENGINE_LEVEL_ORDER.length - 1])).toBe(1);
  });

  it("unknown levels fill 0 — never overstate a level we don't recognize", () => {
    expect(levelFill("some_future_level")).toBe(0);
  });

  it("uses the same label text as the Controls page", () => {
    const controls = read("client/src/pages/founder/autopilot-control.tsx");
    for (const label of Object.values(ENGINE_LEVEL_LABEL)) {
      expect(controls, `Controls page should contain the label "${label}"`).toContain(label);
    }
  });
});

describe("source shape — no fabricated liveness, tabs actually mounted", () => {
  it("the pulse animation is gated on recorded moves AND reduced-motion", () => {
    const src = read("client/src/components/founder/GlassEngine.tsx");
    expect(src).toContain("stats.recordedMoves > 0 && !reduceMotion");
    expect(src).toContain("useReducedMotion");
  });

  it("every empty state says so in words — no stage renders a sample number", () => {
    const src = read("client/src/components/founder/GlassEngine.tsx");
    expect(src).toContain("Nothing recorded yet.");
    expect(src).toContain("hasn't made a recorded move yet");
  });

  it("the Story page mounts both tabs and feeds the Engine the same entries as the timeline", () => {
    const src = read("client/src/pages/founder/autopilot-story.tsx");
    expect(src).toContain('data-testid="story-tab-timeline"');
    expect(src).toContain('data-testid="story-tab-engine"');
    expect(src).toContain("<GlassEngine entries={entries} />");
  });
});
