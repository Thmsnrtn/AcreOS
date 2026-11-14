/**
 * Founder Decisions Inbox generator throttle — the pure suite.
 *
 * The REAL module runs here (never mocked); only its storage seam (an
 * in-memory ThrottleBackend) and its clock are injected. db/logger are mocked
 * solely so importing the module does not open a connection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  CRITICAL_COOLDOWN_MS,
  STANDARD_COOLDOWN_MS,
  STANDARD_DAILY_CAP,
  canonicalJson,
  canonicalSetJson,
  createThrottle,
  hash16,
  type ThrottleInput,
} from "../../server/services/decisionsInboxThrottle";
import { createMemoryBackend, type MemoryBackend } from "../helpers/inMemoryThrottleBackend";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-09T12:00:00.000Z");

let mem: MemoryBackend;
let now: Date;
let th: ReturnType<typeof createThrottle>;
let cards: Array<{ subject: string; status: string }>;

const inp = (over: Partial<ThrottleInput> = {}): ThrottleInput => ({
  producer: "p_test",
  subjectKey: "s1",
  conditionKey: "c1",
  class: "standard",
  ...over,
});
const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};
/** One producer run: raise through the combined API, recording each card written. */
const run = (i: ThrottleInput) =>
  th.raiseIfAllowed(i, async () => {
    cards.push({ subject: i.subjectKey, status: "pending" });
  });

beforeEach(() => {
  mem = createMemoryBackend();
  now = new Date(T0);
  cards = [];
  th = createThrottle({ backend: mem.backend, now: () => now });
});

describe("decisions inbox throttle (pure)", () => {
  it("residue: the same (producer, subject, condition) 50× inside the cooldown writes exactly one card", async () => {
    for (let n = 0; n < 50; n += 1) {
      await run(inp());
      advance(60 * 60 * 1000); // hourly generator, 50h < 30d
    }
    expect(cards).toHaveLength(1);
  });

  it("genuine new subjects each land once; repeats of each land zero", async () => {
    // 10 subjects on 10 consecutive UTC days (a standard producer is capped at
    // 3/day, so spread them; this isolates "new subject lands" from the cap).
    for (let d = 0; d < 10; d += 1) {
      const out = await run(inp({ subjectKey: `subj-${d}` }));
      expect(out.verdict).toEqual({ allow: true, reason: "new_subject" });
      advance(DAY);
    }
    expect(cards).toHaveLength(10);
    for (let d = 0; d < 10; d += 1) await run(inp({ subjectKey: `subj-${d}` }));
    expect(cards).toHaveLength(10);
  });

  it("is status-blind: resolved / rejected / purged between runs still suppresses inside the cooldown", async () => {
    await run(inp());
    for (const status of ["approved", "rejected", "purged", "deferred"]) {
      cards[0].status = status;
      advance(DAY);
      const out = await run(inp());
      expect(out.inserted).toBe(false);
      expect(out.verdict.reason).toBe("suppressed_same_condition");
    }
    expect(cards).toHaveLength(1);
  });

  it("resolved-then-changed: a changed condition lands once, then is suppressed", async () => {
    await run(inp({ conditionKey: "A" }));
    cards[0].status = "approved";
    advance(2 * DAY);
    const changed = await run(inp({ conditionKey: "B" }));
    expect(changed.verdict.reason).toBe("condition_changed");
    expect(cards).toHaveLength(2);
    advance(DAY);
    await run(inp({ conditionKey: "B" }));
    expect(cards).toHaveLength(2);
    // And the unchanged old condition A is a change again relative to B.
    const back = await run(inp({ conditionKey: "A" }));
    expect(back.verdict.reason).toBe("condition_changed");
  });

  it("cooldown boundary: standard 30d, critical 7d", async () => {
    expect(STANDARD_COOLDOWN_MS).toBe(30 * DAY);
    expect(CRITICAL_COOLDOWN_MS).toBe(7 * DAY);

    await run(inp({ subjectKey: "std" }));
    advance(29 * DAY);
    expect((await run(inp({ subjectKey: "std" }))).inserted).toBe(false);
    advance(2 * DAY); // day 31
    const again = await run(inp({ subjectKey: "std" }));
    expect(again.verdict.reason).toBe("cooldown_elapsed");
    expect((await run(inp({ subjectKey: "std" }))).inserted).toBe(false); // once

    now = new Date(T0);
    await run(inp({ subjectKey: "crit", class: "critical" }));
    advance(6 * DAY);
    expect((await run(inp({ subjectKey: "crit", class: "critical" }))).inserted).toBe(false);
    advance(2 * DAY); // day 8
    const critAgain = await run(inp({ subjectKey: "crit", class: "critical" }));
    expect(critAgain.verdict.reason).toBe("cooldown_elapsed");
    expect((await run(inp({ subjectKey: "crit", class: "critical" }))).inserted).toBe(false);
  });

  it("daily cap: 5 distinct standard subjects in one UTC day → 3 allow, 2 capped, capped write no subject state, retry next day lands", async () => {
    const outs = [];
    for (let n = 0; n < 5; n += 1) outs.push(await run(inp({ subjectKey: `cap-${n}` })));
    expect(STANDARD_DAILY_CAP).toBe(3);
    expect(outs.filter((o) => o.inserted)).toHaveLength(3);
    expect(outs.filter((o) => o.verdict.reason === "suppressed_daily_cap")).toHaveLength(2);
    expect(mem.subjectRowCount()).toBe(3); // capped subjects wrote nothing
    expect(cards).toHaveLength(3);

    advance(DAY);
    for (let n = 3; n < 5; n += 1) {
      const out = await run(inp({ subjectKey: `cap-${n}` }));
      expect(out.verdict.reason).toBe("new_subject");
    }
    expect(cards).toHaveLength(5);
  });

  it("the cap rolls at UTC midnight", async () => {
    now = new Date("2026-11-09T23:59:00.000Z");
    for (let n = 0; n < 3; n += 1) await run(inp({ subjectKey: `m-${n}` }));
    expect((await run(inp({ subjectKey: "m-3" }))).verdict.reason).toBe("suppressed_daily_cap");
    now = new Date("2026-11-10T00:00:30.000Z");
    const out = await run(inp({ subjectKey: "m-3" }));
    expect(out.inserted).toBe(true);
    expect(out.verdict.reason).toBe("new_subject");
  });

  it("critical bypasses the cap but not the same-condition cooldown", async () => {
    for (let n = 0; n < 6; n += 1) await run(inp({ subjectKey: `k-${n}`, class: "critical" }));
    expect(cards).toHaveLength(6);
    advance(3 * DAY);
    for (let n = 0; n < 6; n += 1) {
      expect((await run(inp({ subjectKey: `k-${n}`, class: "critical" }))).inserted).toBe(false);
    }
    expect(cards).toHaveLength(6);
  });

  it("canonicalisation: key order and declared-set order never create a false 'new' subject", async () => {
    expect(canonicalJson({ a: 1, b: { y: 2, x: 1 } })).toBe(canonicalJson({ b: { x: 1, y: 2 }, a: 1 }));
    expect(canonicalSetJson(["b", "a", "c"])).toBe(canonicalSetJson(["c", "b", "a"]));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1])); // plain arrays are ordered

    await run(inp({ subjectKey: canonicalJson({ a: 1, b: 2 }), conditionKey: canonicalSetJson(["x", "y"]) }));
    const reordered = await run(
      inp({ subjectKey: canonicalJson({ b: 2, a: 1 }), conditionKey: canonicalSetJson(["y", "x"]) }),
    );
    expect(reordered.inserted).toBe(false);
    expect(cards).toHaveLength(1);
  });

  it("a producer insert that throws records nothing: the error propagates and the next call still allows", async () => {
    await expect(
      th.raiseIfAllowed(inp(), async () => {
        throw new Error("insert boom");
      }),
    ).rejects.toThrow("insert boom");
    expect(mem.subjectRowCount()).toBe(0);
    const next = await run(inp());
    expect(next.verdict.reason).toBe("new_subject");
    expect(cards).toHaveLength(1);

    // Split pair: a producer that skips recordRaised after a failed insert leaves no state.
    const split = inp({ subjectKey: "split" });
    expect((await th.shouldRaiseCard(split)).allow).toBe(true);
    expect((await th.shouldRaiseCard(split)).allow).toBe(true); // nothing recorded → still allowed
    await th.recordRaised(split);
    expect((await th.shouldRaiseCard(split)).allow).toBe(false);
  });

  it("fail-open: a store read that throws allows standard AND critical, and never throws", async () => {
    mem.flags.readFails = true;
    for (const cls of ["standard", "critical"] as const) {
      const v = await th.shouldRaiseCard(inp({ subjectKey: `fo-${cls}`, class: cls }));
      expect(v).toEqual({ allow: true, reason: "guard_failed_open" });
      const out = await run(inp({ subjectKey: `fo2-${cls}`, class: cls }));
      expect(out.inserted).toBe(true);
      expect(out.verdict.reason).toBe("guard_failed_open");
    }
    await expect(th.recordRaised(inp())).resolves.toBeUndefined();
    mem.flags.readFails = false;
    mem.flags.backendDown = true; // lock acquisition failure fails open too
    expect((await th.shouldRaiseCard(inp({ subjectKey: "down" }))).allow).toBe(true);
  });

  it("fail-open flood bound: store down, same key 20× in one process → one card, then in-memory suppression", async () => {
    mem.flags.readFails = true;
    const outs = [];
    for (let n = 0; n < 20; n += 1) outs.push(await run(inp()));
    expect(outs[0].verdict.reason).toBe("guard_failed_open");
    expect(outs[0].inserted).toBe(true); // first raise is never blocked
    expect(outs.slice(1).every((o) => !o.inserted && o.verdict.reason === "suppressed_same_condition")).toBe(true);
    expect(cards).toHaveLength(1);
  });

  it("an unparseable state row is treated as no state (gateWatcher parity)", async () => {
    const key = mem.subjectKeyFor("p_test", "s1");
    for (const garbage of ["{not json", "null", '{"c":1}', '{"c":"x","at":"nonsense","n":1}', ""]) {
      mem.rows.set(key, garbage);
      const v = await th.shouldRaiseCard(inp());
      expect(v).toEqual({ allow: true, reason: "new_subject" });
    }
    expect(hash16("s1")).toHaveLength(16);
  });
});
