/**
 * Today queue ranking spine (Tier 3C, elevation blueprint).
 *
 * The /api/today queue is sorted by ONE explainable, deterministic
 * comparator (server/routes-today.ts → compareQueueItems):
 *
 *   1. urgency class — overdue → money → time → routine
 *   2. priority      — high → medium → low (within a class)
 *   3. rank          — the legacy per-source ordinal (stable tiebreak)
 *   4. id            — lexicographic, so the full order is total
 *
 * These tests lock that contract in: the order is documented, total, and
 * honest — an item with no urgency claim classifies as "routine", never
 * upgraded.
 */

import { describe, it, expect } from "vitest";
import {
  compareQueueItems,
  classifyUrgency,
  URGENCY_ORDER,
  type QueueUrgency,
} from "../../server/routes-today";

type Item = Parameters<typeof compareQueueItems>[0] & { urgency?: QueueUrgency };

function item(partial: Partial<Item> & { id: string }): Item {
  return { priority: "medium", rank: 0, ...partial };
}

describe("URGENCY_ORDER — the documented class order", () => {
  it("orders overdue → money → time → routine", () => {
    expect(URGENCY_ORDER.overdue).toBeLessThan(URGENCY_ORDER.money);
    expect(URGENCY_ORDER.money).toBeLessThan(URGENCY_ORDER.time);
    expect(URGENCY_ORDER.time).toBeLessThan(URGENCY_ORDER.routine);
  });
});

describe("classifyUrgency — honest default", () => {
  it("defaults to routine when the builder claimed nothing", () => {
    expect(classifyUrgency({})).toBe("routine");
    expect(classifyUrgency({ urgency: undefined })).toBe("routine");
  });

  it("passes through an explicit claim", () => {
    expect(classifyUrgency({ urgency: "overdue" })).toBe("overdue");
    expect(classifyUrgency({ urgency: "money" })).toBe("money");
  });
});

describe("compareQueueItems — explainable order", () => {
  it("urgency class dominates priority, rank, and id", () => {
    const overdueLow = item({ id: "z", urgency: "overdue", priority: "low", rank: 999 });
    const routineHigh = item({ id: "a", urgency: "routine", priority: "high", rank: 0 });
    expect(compareQueueItems(overdueLow, routineHigh)).toBeLessThan(0);
    expect(compareQueueItems(routineHigh, overdueLow)).toBeGreaterThan(0);
  });

  it("an unclaimed urgency sorts as routine — never upgraded", () => {
    const unclaimed = item({ id: "a", priority: "high", rank: 0 });
    const time = item({ id: "b", urgency: "time", priority: "low", rank: 999 });
    expect(compareQueueItems(time, unclaimed)).toBeLessThan(0);
  });

  it("priority breaks ties within an urgency class", () => {
    const high = item({ id: "b", urgency: "money", priority: "high", rank: 5 });
    const low = item({ id: "a", urgency: "money", priority: "low", rank: 1 });
    expect(compareQueueItems(high, low)).toBeLessThan(0);
  });

  it("unknown priority strings sort as medium", () => {
    // A priority outside the union can only arrive from bad upstream data —
    // the comparator's `?? 1` clause treats it as medium, never crashes.
    const weird = item({ id: "a", urgency: "time", priority: "urgent-ish" as Item["priority"], rank: 0 });
    const high = item({ id: "b", urgency: "time", priority: "high", rank: 0 });
    const low = item({ id: "c", urgency: "time", priority: "low", rank: 0 });
    expect(compareQueueItems(high, weird)).toBeLessThan(0);
    expect(compareQueueItems(weird, low)).toBeLessThan(0);
  });

  it("legacy rank breaks ties within class + priority", () => {
    const early = item({ id: "b", urgency: "routine", rank: 100 });
    const late = item({ id: "a", urgency: "routine", rank: 200 });
    expect(compareQueueItems(early, late)).toBeLessThan(0);
  });

  it("id is the final lexicographic tiebreak — the order is total", () => {
    const a = item({ id: "alert-1", urgency: "time", rank: 7 });
    const b = item({ id: "alert-2", urgency: "time", rank: 7 });
    expect(compareQueueItems(a, b)).toBeLessThan(0);
    expect(compareQueueItems(b, a)).toBeGreaterThan(0);
    expect(compareQueueItems(a, { ...a })).toBe(0);
  });

  it("is deterministic regardless of input order", () => {
    const items: Item[] = [
      item({ id: "r1", urgency: "routine", priority: "high", rank: 3 }),
      item({ id: "o1", urgency: "overdue", priority: "low", rank: 50 }),
      item({ id: "t2", urgency: "time", priority: "medium", rank: 10 }),
      item({ id: "m1", urgency: "money", priority: "medium", rank: 20 }),
      item({ id: "t1", urgency: "time", priority: "medium", rank: 10 }),
      item({ id: "u1" }), // unclaimed → routine/medium
    ];
    const sortedForward = [...items].sort(compareQueueItems);
    const sortedReverse = [...items].reverse().sort(compareQueueItems);
    const ids = sortedForward.map((i) => i.id);
    expect(ids).toEqual(["o1", "m1", "t1", "t2", "r1", "u1"]);
    expect(sortedReverse.map((i) => i.id)).toEqual(ids);
  });
});
