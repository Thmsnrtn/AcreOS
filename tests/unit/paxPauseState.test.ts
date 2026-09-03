/**
 * getPaxPauseState — the org-level read side of the Pax pause kill switch
 * (server/services/paxPause.ts).
 *
 * The SUT fires two awaited select chains per call:
 *   1. org owner's users.autonomyPreferences (users ⋈ organizations.ownerId)
 *   2. active team members' users.autonomyPreferences (users ⋈ teamMembers)
 * Each test enqueues the two rows-arrays those reads should return. Rows
 * carry `{ id, firstName, lastName, prefs }` — the same shape the read
 * selects, so the HOLDER (spec §4.2: "extended to return the holder") comes
 * from the rows the expiry came from, not from a second lookup.
 *
 * Invariants proven here:
 *   - a FUTURE pax.pausedUntil on the owner OR any active member → paused
 *   - a PAST pax.pausedUntil → NOT paused (expiry is implicit, no cron)
 *   - the latest future pause wins when several users hold one — and the
 *     holder is the person whose pause that is, by name
 *   - a nameless holder is "a teammate" (glossary), never a fabricated name;
 *     a row with no user id yields no holder at all
 *   - malformed / missing prefs → not paused
 *   - a failed DB read FAILS CLOSED (paused: true, checkFailed: true, no
 *     holder) and the refusal message for that case never invents an expiry
 *   - refusals are glossary copy: a local "Thu 8:00 am" time, "Settings →
 *     Pax", never an ISO string
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

function namedRow(id: string, firstName: string | null, lastName: string | null, pausedUntil?: string) {
  return { id, firstName, lastName, prefs: pausedUntil ? { pax: { pausedUntil } } : { pax: {} } };
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

  it("the LATEST future pause wins when several users hold one — and names its holder", async () => {
    mocks.setSelectQueue([
      [namedRow("u-owner", "Owen", "Owner", FUTURE)],
      [namedRow("u-1", "Sam", "Other", FUTURE), namedRow("u-2", "Maria", "Lopez", FURTHER_FUTURE)],
    ]);
    const state = await getPaxPauseState(7);
    expect(state.paused).toBe(true);
    expect(state.pausedUntil?.toISOString()).toBe(FURTHER_FUTURE);
    expect(state.pausedBy).toEqual({ userId: "u-2", name: "Maria Lopez" });
  });

  it("a nameless holder is 'a teammate' — never a fabricated name", async () => {
    mocks.setSelectQueue([[namedRow("u-owner", null, null, FUTURE)], []]);
    const state = await getPaxPauseState(7);
    expect(state.pausedBy).toEqual({ userId: "u-owner", name: "a teammate" });
  });

  it("a holding row with no user id yields no holder (pause still holds)", async () => {
    mocks.setSelectQueue([[ownerRow(FUTURE)], []]);
    const state = await getPaxPauseState(7);
    expect(state.paused).toBe(true);
    expect(state.pausedBy).toBeNull();
  });

  it("not paused → no holder", async () => {
    mocks.setSelectQueue([[namedRow("u-owner", "Owen", "Owner", PAST)], []]);
    const state = await getPaxPauseState(7);
    expect(state.paused).toBe(false);
    expect(state.pausedBy).toBeNull();
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
    expect(state.pausedBy).toBeNull();
  });
});

describe("paxPauseRefusalMessage — honest, user-visible refusals (glossary copy)", () => {
  it("names the resume time as a local time, the holder, and where to resume — never an ISO string", async () => {
    mocks.setSelectQueue([[namedRow("u-owner", "Maria", "Lopez", FUTURE)], []]);
    const state = await getPaxPauseState(7);
    const msg = paxPauseRefusalMessage(state);
    expect(msg).toContain("Pax is paused until");
    expect(msg).toMatch(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2} (am|pm)\b/);
    expect(msg).not.toContain(FUTURE);
    expect(msg).toContain("paused by Maria Lopez");
    expect(msg).toMatch(/Settings → Pax\b/);
    expect(msg).not.toContain("Pax controls");
  });

  it("never invents an expiry when the check failed — says so plainly", async () => {
    mocks.setThrow(new Error("boom"));
    const state = await getPaxPauseState(7);
    const msg = paxPauseRefusalMessage(state);
    expect(msg).toContain("could not verify");
    expect(msg).toContain("wasn't done");
    expect(msg).not.toContain("paused until");
  });
});
