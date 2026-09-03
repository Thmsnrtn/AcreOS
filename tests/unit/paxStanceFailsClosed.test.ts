/**
 * An unknown stance is not permission.
 *
 * SUCCESSOR of autonomyLevelFailsClosed.test.ts (kept until wave 1 A deletes
 * getOrgAutonomyLevel), for the reader that replaces it:
 * server/services/paxControls.getPaxControls (AUTONOMY_SPEC.md §4.2).
 *
 * THE DEFECT IT GUARDS
 * ────────────────────
 * The old resolver CAST the stored column, so an empty string, a typo, or a
 * value written by some future code path came back unchanged and every
 * consumer — checking only for the ONE level that must not send — granted it
 * more permission than the default. A stance nobody offers must resolve to
 * the STRICTER offered stance, every "runs on its own" switch OFF, and
 * `checkFailed: true` so the refusal says "could not verify" instead of
 * inventing a state. A DB error on either read is the same case.
 *
 * WHAT IS ASSERTED
 * ────────────────
 *   - hostile stored values (non-empty set; none is a valid shape) → closed
 *   - the reader SAYS so (a corrupted column is a fact worth a log line)
 *   - a DB error, a missing org row, a failed pause read → closed
 *   - a NULL column → the defaults, which EQUAL today's live behaviour
 *   - both real stances survive, switches intact — closed, not shut
 *   - the pause holder comes from the pause PRIMITIVE (spec §4.2: paxPause
 *     "extended to return the holder") and is passed through by name; the
 *     refusal prints a local time, never an ISO string; a pause with no
 *     holder on file changes nothing else — and the reader makes ONE read
 *
 * The values go through the REAL resolver against stubbed rows. The probe
 * that must turn this red: replace the zod parse with a cast.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Rows = Array<Record<string, unknown>>;

const mocks = vi.hoisted(() => {
  let selectQueue: Array<Rows | Error> = [];
  type Holder = { userId: string; name: string } | null;
  let pause: { paused: boolean; pausedUntil: Date | null; checkFailed: boolean; pausedBy?: Holder } = {
    paused: false,
    pausedUntil: null,
    checkFailed: false,
  };

  function nextSelectResult(): Promise<Rows> {
    const next = selectQueue.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? []);
  }

  const select = vi.fn((_shape?: unknown) => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (onFulfilled: (rows: unknown) => unknown, onRejected?: (err: unknown) => unknown) =>
        nextSelectResult().then(onFulfilled, onRejected),
    };
    return chain;
  });

  return {
    db: { select },
    setSelectQueue(q: Array<Rows | Error>) {
      selectQueue = [...q];
    },
    setPause(p: { paused: boolean; pausedUntil: Date | null; checkFailed: boolean; pausedBy?: Holder }) {
      pause = p;
    },
    pause: () => pause,
  };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/paxPause", () => ({
  getPaxPauseState: vi.fn(async () => mocks.pause()),
}));

import { getPaxControls, paxControlsRefusalMessage } from "../../server/services/paxControls";
import { OFFERED_STANCES, PAX_CONTROLS_DEFAULTS } from "../../shared/pax-controls";
import { logger } from "../../server/utils/logger";

const STRICT = "ask_before_everything";
const FUTURE = new Date(Date.now() + 12 * 60 * 60 * 1000);

/** A stored row: `{ paxControls, timezone }`. */
const orgRow = (paxControls: unknown, timezone: string | null = "America/Chicago") => [
  { paxControls, timezone },
];

const valid = (stance: string, on = true) => ({
  stance,
  leadScoring: on,
  borrowerReminders: on,
  inboxDrafts: on,
});

/**
 * Values a jsonb column can actually hold. Each is either a stance nobody
 * offers, a switch that is not a boolean, a stray key, a missing key, or not
 * an object at all. `{}` and `{ pax: { level: 2 } }` are the shapes the
 * autonomy matrix used to write.
 */
const HOSTILE: unknown[] = [
  valid("on_its_own"),
  valid("assisted"),
  valid("autonomous"),
  valid(""),
  valid(" "),
  valid("ASK_BEFORE_SENDING"),
  valid("ask_before_sending "),
  valid("ask-before-sending"),
  { ...valid("ask_before_sending"), stance: null },
  { ...valid("ask_before_sending"), stance: 2 },
  { ...valid("ask_before_sending"), leadScoring: "yes" },
  { ...valid("ask_before_sending"), inboxDrafts: 1 },
  { ...valid("ask_before_sending"), level: 3 },
  { ...valid("ask_before_everything"), perAction: {} },
  { stance: "ask_before_everything", leadScoring: true, borrowerReminders: true },
  { pax: { level: 2 } },
  { level: 2 },
  {},
  [],
  "ask_before_sending",
  1,
  true,
];

function isValidShape(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return (
    keys.join(",") === "borrowerReminders,inboxDrafts,leadScoring,stance" &&
    (OFFERED_STANCES as readonly string[]).includes(o.stance as string) &&
    typeof o.leadScoring === "boolean" &&
    typeof o.borrowerReminders === "boolean" &&
    typeof o.inboxDrafts === "boolean"
  );
}

function expectClosed(state: Awaited<ReturnType<typeof getPaxControls>>, label: string) {
  expect(state.stance, `${label}: stance`).toBe(STRICT);
  expect(state.leadScoring, `${label}: leadScoring`).toBe(false);
  expect(state.borrowerReminders, `${label}: borrowerReminders`).toBe(false);
  expect(state.inboxDrafts, `${label}: inboxDrafts`).toBe(false);
  expect(state.checkFailed, `${label}: checkFailed`).toBe(true);
  // An engine that only checks `paused` must stop too.
  expect(state.paused, `${label}: paused`).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setPause({ paused: false, pausedUntil: null, checkFailed: false });
  mocks.setSelectQueue([]);
});

describe("the hostile set is real (vacuity)", () => {
  it("is non-empty and contains no valid shape", () => {
    expect(HOSTILE.length).toBeGreaterThan(10);
    for (const v of HOSTILE) {
      expect(isValidShape(v), `${JSON.stringify(v)} is a valid stored shape`).toBe(false);
    }
  });

  it("the strict stance is one of the offered ones, and not the default", () => {
    expect(OFFERED_STANCES).toContain(STRICT);
    expect(PAX_CONTROLS_DEFAULTS.stance).not.toBe(STRICT);
  });
});

describe("the reader parses rather than casts", () => {
  it("resolves every unrecognised stored value to the closed state", async () => {
    const leaked: string[] = [];
    for (const stored of HOSTILE) {
      mocks.setSelectQueue([orgRow(stored)]);
      const state = await getPaxControls(1);
      const closed =
        state.stance === STRICT &&
        !state.leadScoring &&
        !state.borrowerReminders &&
        !state.inboxDrafts &&
        state.checkFailed &&
        state.paused;
      if (!closed) leaked.push(`${JSON.stringify(stored)} → ${JSON.stringify(state)}`);
    }
    expect(leaked, "these stored values conveyed permission").toEqual([]);
  });

  it("says so, naming the value and where it landed", async () => {
    mocks.setSelectQueue([orgRow(valid("autonomus"))]);
    await getPaxControls(42);
    expect(logger.warn).toHaveBeenCalled();
    const said = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .join(" ");
    expect(said).toMatch(/autonomus/);
    expect(said).toMatch(/ask_before_everything/);
  });

  it("a DB error on the controls read fails closed and is logged", async () => {
    mocks.setSelectQueue([new Error("connection reset")]);
    expectClosed(await getPaxControls(1), "db error");
    expect(logger.error).toHaveBeenCalled();
  });

  it("a missing organization row fails closed", async () => {
    mocks.setSelectQueue([[]]);
    expectClosed(await getPaxControls(999), "no row");
  });

  it("a failed pause read fails the whole state closed, and the refusal invents no time", async () => {
    mocks.setPause({ paused: true, pausedUntil: null, checkFailed: true });
    mocks.setSelectQueue([orgRow(valid("ask_before_sending"))]);
    const state = await getPaxControls(1);
    expectClosed(state, "pause read failed");
    const refusal = paxControlsRefusalMessage(state);
    expect(refusal).toMatch(/could not verify/i);
    expect(refusal).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(refusal).toMatch(/Settings → Pax\b/);
    expect(refusal).not.toMatch(/Settings → Pax controls/);
  });
});

describe("a NULL column is today's behaviour, not an error", () => {
  it("reads as the defaults with checkFailed false", async () => {
    for (const stored of [null, undefined]) {
      mocks.setSelectQueue([orgRow(stored)]);
      const state = await getPaxControls(1);
      expect(state.checkFailed).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.stance).toBe(PAX_CONTROLS_DEFAULTS.stance);
      expect(state.leadScoring).toBe(PAX_CONTROLS_DEFAULTS.leadScoring);
      expect(state.borrowerReminders).toBe(PAX_CONTROLS_DEFAULTS.borrowerReminders);
      expect(state.inboxDrafts).toBe(PAX_CONTROLS_DEFAULTS.inboxDrafts);
    }
  });

  it("the defaults EQUAL today's live behaviour (founder question 5: nothing changes silently)", () => {
    expect(PAX_CONTROLS_DEFAULTS).toEqual({
      stance: "ask_before_sending",
      leadScoring: true,
      borrowerReminders: true,
      inboxDrafts: true,
    });
  });
});

describe("the real stances survive — closed, not shut", () => {
  it("returns each offered stance with its switches intact", async () => {
    for (const stance of OFFERED_STANCES) {
      for (const on of [true, false]) {
        mocks.setSelectQueue([orgRow(valid(stance, on))]);
        const state = await getPaxControls(1);
        expect(state.stance).toBe(stance);
        expect(state.leadScoring).toBe(on);
        expect(state.borrowerReminders).toBe(on);
        expect(state.inboxDrafts).toBe(on);
        expect(state.checkFailed).toBe(false);
        expect(state.paused).toBe(false);
        expect(state.pausedBy).toBeNull();
      }
    }
  });

  it("carries the org's timezone for printing times, with a fallback", async () => {
    mocks.setSelectQueue([orgRow(valid("ask_before_sending"), "Europe/Lisbon")]);
    expect((await getPaxControls(1)).timezone).toBe("Europe/Lisbon");
    mocks.setSelectQueue([orgRow(valid("ask_before_sending"), null)]);
    expect((await getPaxControls(1)).timezone).toBe("America/New_York");
  });
});

describe("the pause is folded in, holder included (from the primitive)", () => {
  const MARIA = { userId: "u-2", name: "Maria Lopez" };

  it("passes the primitive's holder through by name and prints a local time, never an ISO string", async () => {
    mocks.setPause({ paused: true, pausedUntil: FUTURE, checkFailed: false, pausedBy: MARIA });
    mocks.setSelectQueue([orgRow(valid("ask_before_sending"))]);
    const state = await getPaxControls(1);
    expect(state.paused).toBe(true);
    expect(state.checkFailed).toBe(false);
    expect(state.stance).toBe("ask_before_sending");
    expect(state.pausedUntil).toEqual(FUTURE);
    expect(state.pausedBy).toEqual(MARIA);

    const refusal = paxControlsRefusalMessage(state);
    expect(refusal).toContain("Maria Lopez");
    expect(refusal).toMatch(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2} (am|pm)\b/);
    expect(refusal).not.toContain(FUTURE.toISOString());
    expect(refusal).toMatch(/Settings → Pax\b/);
  });

  it("a pause with no holder on file reports no holder and changes nothing else", async () => {
    mocks.setPause({ paused: true, pausedUntil: FUTURE, checkFailed: false, pausedBy: null });
    mocks.setSelectQueue([orgRow(valid("ask_before_sending"))]);
    const state = await getPaxControls(1);
    expect(state.pausedBy).toBeNull();
    expect(state.paused).toBe(true);
    expect(state.checkFailed).toBe(false);
    expect(state.stance).toBe("ask_before_sending");
    expect(state.leadScoring).toBe(true);
    expect(paxControlsRefusalMessage(state)).not.toContain("paused by");
  });

  it("a failed pause read carries no holder even if the primitive reported one", async () => {
    mocks.setPause({ paused: true, pausedUntil: null, checkFailed: true, pausedBy: MARIA });
    mocks.setSelectQueue([orgRow(valid("ask_before_sending"))]);
    const state = await getPaxControls(1);
    expect(state.pausedBy).toBeNull();
    expect(state.checkFailed).toBe(true);
    expect(paxControlsRefusalMessage(state)).toContain("could not verify");
  });

  it("makes ONE read of its own — the holder never costs a second or third select", async () => {
    mocks.setPause({ paused: true, pausedUntil: FUTURE, checkFailed: false, pausedBy: MARIA });
    mocks.setSelectQueue([orgRow(valid("ask_before_sending"))]);
    await getPaxControls(1);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
    mocks.db.select.mockClear();
    mocks.setPause({ paused: false, pausedUntil: null, checkFailed: false });
    mocks.setSelectQueue([orgRow(valid("ask_before_sending"))]);
    await getPaxControls(1);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });
});
