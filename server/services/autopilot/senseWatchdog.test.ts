/**
 * Tests for the blind-sense watchdog (step-away gap #2 residue).
 *
 * Coverage:
 *  - consecutivelyDark (pure): needs N gathers, requires the sense in ALL of
 *    them, cold start never qualifies
 *  - recordGatherAndCheck: records the gather row, pages only on N-consecutive
 *    darkness, honors the 24h per-sense cooldown, never throws on db failure
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Ledger mock: INSERTED collects writes; SELECT_QUEUE scripts reads in call
// order (first the recent-gathers read, then one cooldown probe per sense).
const INSERTED: Array<{ kind: string; value: number; detail: unknown }> = [];
const SELECT_QUEUE: any[][] = [];
vi.mock("../../db", () => ({
  db: {
    insert: (_t: unknown) => ({
      values: (row: any) => {
        INSERTED.push(row);
        return Promise.resolve();
      },
    }),
    select: (_p?: unknown) => ({
      from: (_t: unknown) => ({
        where: (_w: unknown) => {
          const result = Promise.resolve(SELECT_QUEUE.shift() ?? []);
          return Object.assign(result, {
            orderBy: () => ({ limit: () => result }),
            limit: () => result,
          });
        },
      }),
    }),
  },
}));

const PAGES: Array<{ subject: string }> = [];
vi.mock("../solene/pagerService", () => ({
  sendSolenePage: vi.fn(async (input: { subject: string }) => {
    PAGES.push({ subject: input.subject });
    return { eventId: 1, deliveryStatus: "delivered", deliveryDetail: null };
  }),
}));

import { consecutivelyDark, recordGatherAndCheck, GATHER_KIND, PAGE_MARKER_PREFIX } from "./senseWatchdog";

beforeEach(() => {
  INSERTED.length = 0;
  SELECT_QUEUE.length = 0;
  PAGES.length = 0;
  vi.clearAllMocks();
});

const gatherRow = (degraded: string[]) => ({ detail: { degraded } });

describe("consecutivelyDark (pure)", () => {
  it("requires the sense in ALL of the last n gathers", () => {
    expect(consecutivelyDark([["a", "b"], ["a"], ["a", "c"]], 3)).toEqual(["a"]);
  });

  it("a single clear gather resets the streak", () => {
    expect(consecutivelyDark([["a"], [], ["a"]], 3)).toEqual([]);
  });

  it("cold start (fewer than n gathers) never qualifies", () => {
    expect(consecutivelyDark([["a"], ["a"]], 3)).toEqual([]);
  });
});

describe("recordGatherAndCheck", () => {
  it("records every gather — including all-clear ones", async () => {
    SELECT_QUEUE.push([gatherRow([])]); // recent gathers read
    const r = await recordGatherAndCheck([]);
    expect(r.paged).toEqual([]);
    expect(INSERTED[0]).toMatchObject({ kind: GATHER_KIND, value: 0 });
  });

  it("pages when a sense is dark on 3 consecutive gathers", async () => {
    SELECT_QUEUE.push([
      gatherRow(["pulse-vitals"]),
      gatherRow(["pulse-vitals", "attribution"]),
      gatherRow(["pulse-vitals"]),
    ]);
    SELECT_QUEUE.push([]); // cooldown probe — no recent page
    const r = await recordGatherAndCheck(["pulse-vitals"]);
    expect(r.paged).toEqual(["pulse-vitals"]);
    expect(PAGES).toHaveLength(1);
    expect(PAGES[0].subject).toContain("pulse-vitals");
    // Page marker written for the cooldown.
    expect(INSERTED.some((i) => i.kind === `${PAGE_MARKER_PREFIX}pulse-vitals`)).toBe(true);
  });

  it("honors the 24h cooldown — no re-page while the marker is fresh", async () => {
    SELECT_QUEUE.push([
      gatherRow(["pulse-vitals"]),
      gatherRow(["pulse-vitals"]),
      gatherRow(["pulse-vitals"]),
    ]);
    SELECT_QUEUE.push([{ id: 99 }]); // fresh page marker
    const r = await recordGatherAndCheck(["pulse-vitals"]);
    expect(r.paged).toEqual([]);
    expect(PAGES).toHaveLength(0);
  });

  it("two gathers dark is not enough — blips don't page", async () => {
    SELECT_QUEUE.push([gatherRow(["attribution"]), gatherRow(["attribution"]), gatherRow([])]);
    const r = await recordGatherAndCheck(["attribution"]);
    expect(r.paged).toEqual([]);
    expect(PAGES).toHaveLength(0);
  });
});
