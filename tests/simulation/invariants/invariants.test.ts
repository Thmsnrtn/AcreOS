/**
 * The invariant monitor fires on every violation it exists for.
 *
 * Population: every invariant the brief names is in the registry
 * (REQUIRED_INVARIANTS), every registry member has a canary, and every canary
 * is non-vacuous (has at least one clean and one violating observation). A
 * new invariant without a canary fails here.
 *
 * Falsification: mutate.mjs deletes each invariant's `detect:` body in turn
 * and requires its canary below to go red (results: the scorecard's
 * invariants.mutation section).
 */
import { describe, expect, it } from "vitest";
import { INVARIANTS, REQUIRED_INVARIANTS, freshState } from "./registry";
import { CANARIES } from "./canaries";
import { InvariantMonitor } from "./monitor";

const STATEFUL_LAST_ONLY = new Set(["one-page-per-incident"]);

describe("invariant registry — population", () => {
  it("names every invariant the platform must hold", () => {
    const ids = INVARIANTS.map((i) => i.id);
    for (const r of REQUIRED_INVARIANTS) expect(ids).toContain(r);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every invariant has a non-vacuous canary and a derivation", () => {
    for (const i of INVARIANTS) {
      const c = CANARIES[i.id];
      expect(c, `${i.id} has no canary`).toBeDefined();
      expect(c.clean.length, i.id).toBeGreaterThan(0);
      expect(c.violating.length, i.id).toBeGreaterThan(0);
      expect(i.derivedFrom.length, i.id).toBeGreaterThan(10);
      expect(i.reads.length, i.id).toBeGreaterThan(0);
    }
  });
});

describe("invariant canaries", () => {
  for (const inv of INVARIANTS) {
    it(`${inv.id}: clean world passes`, () => {
      const st = freshState();
      for (const o of CANARIES[inv.id].clean) expect(inv.check(o, st), JSON.stringify(o)).toEqual([]);
    });
    it(`${inv.id}: fires on its violation`, () => {
      const st = freshState();
      const seq = CANARIES[inv.id].violating;
      seq.forEach((o, idx) => {
        const hits = inv.check(o, st);
        if (STATEFUL_LAST_ONLY.has(inv.id) && idx < seq.length - 1) return;
        expect(hits.length, `${inv.id} missed violating observation #${idx}: ${JSON.stringify(o).slice(0, 300)}`).toBeGreaterThan(0);
      });
    });
  }
});

describe("the monitor checks every tick, not only the end", () => {
  it("a violation on an early tick stays recorded with its tick", () => {
    const m = new InvariantMonitor();
    m.observe({ tick: 1, at: "2026-10-05T01:00:00.000Z", sends: [{ channel: "sms", at: "2026-10-05T01:00:00.000Z", to: "+1", orgId: 1, leadDnc: true }] });
    m.observe({ tick: 2, at: "2026-10-05T02:00:00.000Z", sends: [] });
    expect(m.violations.map((v) => v.tick)).toEqual([1]);
    expect(m.summary().ticks).toBe(2);
  });
  it("an unread source is UNKNOWN for the invariants that read it, never clean", () => {
    const m = new InvariantMonitor();
    m.observe({ tick: 1, at: "x", unread: ["providerCalls"] });
    expect(m.coverage.get("customer-money-not-on-platform")!.unknown).toBe(1);
    expect(m.coverage.get("no-send-without-consent")!.checked).toBe(1);
  });
});
