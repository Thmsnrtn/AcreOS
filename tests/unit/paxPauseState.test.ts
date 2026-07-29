/**
 * getPaxPauseState — the org-level read side of the Pax pause kill switch
 * (server/services/paxPause.ts).
 *
 * The SUT fires two awaited select chains per call:
 *   1. org owner's users.autonomyPreferences (users ⋈ organizations.ownerId)
 *   2. active team members' users.autonomyPreferences (users ⋈ teamMembers)
 * Each test enqueues the two rows-arrays those reads should return.
 *
 * Invariants proven here:
 *   - a FUTURE pax.pausedUntil on the owner OR any active member → paused
 *   - a PAST pax.pausedUntil → NOT paused (expiry is implicit, no cron)
 *   - the latest future pause wins when several users hold one
 *   - malformed / missing prefs → not paused
 *   - a failed DB read FAILS CLOSED (paused: true, checkFailed: true) and the
 *     refusal message for that case never invents an expiry time
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let selectQueue: Array<Array<Record<string, unknown>>> = [];
  let shouldThrow: Error | null = null;

  function nextSelectResult(): Promise<Array<Record<string, unknown>>> {
    if (shouldThrow) return Promise.reject(shouldThrow);
    return Promise.resolve(selectQueue.shift() ?? []);
  }

  function buildDbMock() {
    const select = vi.fn((_shape?: unknown) => {
      const chain: Record<string, unknown> = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        then: (
          onFulfilled: (rows: unknown) => unknown,
          onRejected?: (err: unknown) => unknown,
        ) => nextSelectResult().then(onFulfilled, onRejected),
      };
      return chain;
    });
    return { select };
  }

  return {
    db: buildDbMock(),
    setSelectQueue(q: Array<Array<Record<string, unknown>>>) {
      selectQueue = [...q];
    },
    setThrow(err: Error | null) {
      shouldThrow = err;
    },
  };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getPaxPauseState,
  paxPauseRefusalMessage,
} from "../../server/services/paxPause";

const FUTURE = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
const FURTHER_FUTURE = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function ownerRow(pausedUntil?: string) {
  return { prefs: pausedUntil ? { pax: { pausedUntil } } : { pax: {} } };
}

beforeEach(() => {
  mocks.setThrow(null);
  mocks.setSelectQueue([[], []]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getPaxPauseState — org-level pause semantics", () => {
  it("owner's future pausedUntil pauses the org", async () => {
    mocks.setSelectQueue([[ownerRow(FUTURE)], []]);
    const state = await getPaxPauseState(7);
    expect(state.paused).toBe(true);
    expect(state.checkFailed).toBe(false);
    expect(state.pausedUntil?.toISOString()).toBe(FUTURE);
  });

  it("an active team member's future pausedUntil pauses the org too", async () => {
    mocks.setSelectQueue([[ownerRow()], [ownerRow(FUTURE)]]);
    const state = await getPaxPauseState(7);
    expect(state.paused).toBe(true);
    expect(state.pausedUntil?.toISOString()).toBe(FUTURE);
  });

  it("the LATEST future pause wins when several users hold one", async () => {
    mocks.setSelectQueue([[ownerRow(FUTURE)], [ownerRow(FURTHER_FUTURE)]]);
    const state = await getPaxPauseState(7);
    expect(state.paused).toBe(true);
    expect(state.pausedUntil?.toISOString()).toBe(FURTHER_FUTURE);
  });

  it("a PAST pausedUntil does NOT pause — expiry is implicit, no cron needed", async () => {
    mocks.setSelectQueue([[ownerRow(PAST)], [ownerRow(PAST)]]);
    const state = await getPaxPauseState(7);
    expect(state.paused).toBe(false);
    expect(state.pausedUntil).toBeNull();
    expect(state.checkFailed).toBe(false);
  });

  it("missing / malformed prefs mean not paused", async () => {
    mocks.setSelectQueue([
      [{ prefs: null }, { prefs: { pax: { pausedUntil: "not-a-date" } } }],
      [{ prefs: {} }],
    ]);
    const state = await getPaxPauseState(7);
    expect(state.paused).toBe(false);
  });

  it("FAILS CLOSED when the DB read fails: paused with checkFailed", async () => {
    mocks.setThrow(new Error("connection refused"));
    const state = await getPaxPauseState(7);
    expect(state.paused).toBe(true);
    expect(state.checkFailed).toBe(true);
    expect(state.pausedUntil).toBeNull();
  });
});

describe("paxPauseRefusalMessage — honest, user-visible refusals", () => {
  it("names the resume time and where to resume", async () => {
    mocks.setSelectQueue([[ownerRow(FUTURE)], []]);
    const state = await getPaxPauseState(7);
    const msg = paxPauseRefusalMessage(state);
    expect(msg).toContain("Pax is paused until");
    expect(msg).toContain(FUTURE);
    expect(msg).toContain("Settings");
  });

  it("never invents an expiry when the check failed — says so plainly", async () => {
    mocks.setThrow(new Error("boom"));
    const state = await getPaxPauseState(7);
    const msg = paxPauseRefusalMessage(state);
    expect(msg).toContain("could not verify");
    expect(msg).toContain("not executed");
    expect(msg).not.toContain("paused until");
  });
});
