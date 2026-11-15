/**
 * Stored daily limits and member overrides fail CLOSED (PX-3, register P-1) —
 * the sibling of paxStanceFailsClosed.test.ts for the two new stored keys.
 *
 * THE DEFECT IT GUARDS: a reader that CASTS `limits` / `members` would let a
 * negative cap (a number that is "less than anything", so nothing is ever
 * over it), a string cap, or a hand-edited override convey a state the
 * customer never chose. Every one of those must fail the WHOLE row closed
 * (stance ask_before_everything, switches off, checkFailed true, every cap 0,
 * no members) — the same as a stance nobody offers.
 *
 * ALSO PROVED: a row written before PX-3 (no `limits` / `members` keys) and a
 * NULL column read exactly as today (no caps, no overrides); a valid row's
 * caps and overrides survive the reader, with sends clamped to ask.
 *
 * Values go through the REAL resolver against stubbed rows. The probe that
 * must turn this red: replace the zod parse of `limits` with a cast.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Rows = Array<Record<string, unknown>>;

const mocks = vi.hoisted(() => {
  let selectQueue: Array<Rows | Error> = [];
  const select = vi.fn((_shape?: unknown) => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (onFulfilled: (rows: unknown) => unknown, onRejected?: (err: unknown) => unknown) => {
        const next = selectQueue.shift();
        const p = next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? []);
        return p.then(onFulfilled, onRejected);
      },
    };
    return chain;
  });
  return {
    db: { select },
    setSelectQueue(q: Array<Rows | Error>) {
      selectQueue = [...q];
    },
  };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/paxPause", () => ({
  getPaxPauseState: vi.fn(async () => ({ paused: false, pausedUntil: null, checkFailed: false })),
}));

import { getPaxControls } from "../../server/services/paxControls";
import { defaultPaxLimits, defaultPaxRails } from "../../shared/pax-controls";

const orgRow = (paxControls: unknown) => [{ paxControls, timezone: "America/Chicago" }];

const base = {
  stance: "ask_before_sending",
  leadScoring: true,
  borrowerReminders: true,
  inboxDrafts: true,
};

const FULL_LIMITS = { asksPerDay: 5, creditSpendPerDay: null, browseCallsPerDay: 20, batchRowsPerDay: 0 };

/** Each is a stored value no human could have set through the PATCH routes. */
const HOSTILE: Array<[string, unknown]> = [
  ["a negative cap", { ...base, limits: { ...FULL_LIMITS, asksPerDay: -1 } }],
  ["a fractional cap", { ...base, limits: { ...FULL_LIMITS, browseCallsPerDay: 2.5 } }],
  ["a string cap", { ...base, limits: { ...FULL_LIMITS, asksPerDay: "5" } }],
  ["an empty-string cap", { ...base, limits: { ...FULL_LIMITS, batchRowsPerDay: "" } }],
  ["NaN-like text", { ...base, limits: { ...FULL_LIMITS, asksPerDay: "NaN" } }],
  ["a boolean cap", { ...base, limits: { ...FULL_LIMITS, creditSpendPerDay: true } }],
  ["an object cap", { ...base, limits: { ...FULL_LIMITS, asksPerDay: { max: 3 } } }],
  ["an unknown limit key", { ...base, limits: { ...FULL_LIMITS, tokensPerDay: 5 } }],
  ["limits that are not an object", { ...base, limits: 5 }],
  ["limits as an array", { ...base, limits: [1, 2, 3, 4] }],
  ["limits as a string", { ...base, limits: "none" }],
  ["members that are not an object", { ...base, members: "u-1" }],
  ["members as an array", { ...base, members: [{ limits: { asksPerDay: 1 } }] }],
  ["members as a number", { ...base, members: 3 }],
  ["a member that is not an object", { ...base, members: { "u-1": "narrow" } }],
  ["a member with an unknown key", { ...base, members: { "u-1": { stance: "ask_before_everything" } } }],
  ["a member rail domain nobody has", { ...base, members: { "u-1": { rails: { records: { invoices: "watch" } } } } }],
  ["a member rail level nobody has", { ...base, members: { "u-1": { rails: { records: { leads: "yolo" } } } } }],
  ["a member rails with an unknown key", { ...base, members: { "u-1": { rails: { everything: "watch" } } } }],
  ["a member negative cap", { ...base, members: { "u-1": { limits: { asksPerDay: -3 } } } }],
  ["a member fractional cap", { ...base, members: { "u-1": { limits: { asksPerDay: 0.5 } } } }],
  ["a member string cap", { ...base, members: { "u-1": { limits: { browseCallsPerDay: "7" } } } }],
  ["a member unknown limit key", { ...base, members: { "u-1": { limits: { perHour: 1 } } } }],
  ["an empty-string userId key", { ...base, members: { "": { limits: { asksPerDay: 1 } } } }],
];

function expectClosed(state: Awaited<ReturnType<typeof getPaxControls>>, label: string) {
  expect(state.stance, `${label}: stance`).toBe("ask_before_everything");
  expect(state.leadScoring, `${label}: leadScoring`).toBe(false);
  expect(state.checkFailed, `${label}: checkFailed`).toBe(true);
  expect(state.paused, `${label}: paused`).toBe(true);
  // Belt and braces: the closed state allows nothing and carries no overrides.
  expect(state.limits, `${label}: limits`).toEqual({ asksPerDay: 0, creditSpendPerDay: 0, browseCallsPerDay: 0, batchRowsPerDay: 0 });
  expect(state.members, `${label}: members`).toEqual({});
  expect(Object.values(state.rails.records).every((l) => l === "watch"), `${label}: rails`).toBe(true);
  expect(state.rails.sends).toBe("watch");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setSelectQueue([]);
});

describe("hostile stored limits and members fail the whole row closed", () => {
  it("the hostile set is real (vacuity): non-empty, and each entry names a distinct shape", () => {
    expect(HOSTILE.length).toBeGreaterThanOrEqual(20);
    expect(new Set(HOSTILE.map(([label]) => label)).size).toBe(HOSTILE.length);
  });

  it.each(HOSTILE)("%s", async (label, stored) => {
    mocks.setSelectQueue([orgRow(stored)]);
    expectClosed(await getPaxControls(1), label);
  });

  it("the control: the same rows with VALID limits and members are not closed (the hostile part is what trips it)", async () => {
    for (const stored of [
      { ...base, limits: FULL_LIMITS },
      { ...base, members: { "u-1": { limits: { asksPerDay: 1 }, rails: { records: { leads: "watch" }, sends: "draft" } } } },
    ]) {
      mocks.setSelectQueue([orgRow(stored)]);
      expect((await getPaxControls(1)).checkFailed).toBe(false);
    }
  });
});

describe("a row written before PX-3, and a NULL column, read exactly as today", () => {
  it("no `limits` / `members` keys → no caps, no overrides, defaults for everything else", async () => {
    for (const stored of [base, { ...base, rails: { sends: "ask" } }, null]) {
      mocks.setSelectQueue([orgRow(stored)]);
      const state = await getPaxControls(1);
      expect(state.checkFailed).toBe(false);
      expect(state.limits).toEqual(defaultPaxLimits());
      expect(state.members).toEqual({});
      expect(state.rails).toEqual(defaultPaxRails());
      expect(state.stance).toBe("ask_before_sending");
    }
  });

  it("DB error and a missing org row close the limits and members too", async () => {
    mocks.setSelectQueue([new Error("connection reset")]);
    expectClosed(await getPaxControls(1), "db error");
    mocks.setSelectQueue([[]]);
    expectClosed(await getPaxControls(1), "no row");
  });
});

describe("valid stored limits and members survive the reader", () => {
  it("caps read back exactly (0 is a real cap; null and a missing key are no cap)", async () => {
    mocks.setSelectQueue([orgRow({ ...base, limits: FULL_LIMITS })]);
    expect((await getPaxControls(1)).limits).toEqual(FULL_LIMITS);

    mocks.setSelectQueue([orgRow({ ...base, limits: { asksPerDay: 3 } })]);
    expect((await getPaxControls(1)).limits).toEqual({ ...defaultPaxLimits(), asksPerDay: 3 });
  });

  it("member overrides read back partial, and a hand-edited sends level is clamped to ask", async () => {
    mocks.setSelectQueue([
      orgRow({
        ...base,
        members: {
          "u-1": { rails: { records: { leads: "watch" }, sends: "act_and_report" }, limits: { asksPerDay: 2 } },
          "u-2": { limits: { browseCallsPerDay: null } },
        },
      }),
    ]);
    const state = await getPaxControls(1);
    expect(state.checkFailed).toBe(false);
    expect(state.members["u-1"]).toEqual({ rails: { records: { leads: "watch" }, sends: "ask" }, limits: { asksPerDay: 2 } });
    expect(state.members["u-2"]).toEqual({ limits: { browseCallsPerDay: null } });
    // The org's own values are untouched by a member's override.
    expect(state.limits).toEqual(defaultPaxLimits());
    expect(state.rails).toEqual(defaultPaxRails());
  });
});
