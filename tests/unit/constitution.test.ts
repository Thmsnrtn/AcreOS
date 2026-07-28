/**
 * Constitution ratchet — the meta-gate over the governance registry.
 *
 * The ">$500 founder-only" hard stop drifted out of enforcement for months
 * because doctrine lived in prose while the code said otherwise, and nothing
 * cross-checked the two. This ratchet closes that class of failure:
 *
 *   1. Every enforcement pointer must resolve to a file that actually exists
 *      (a stale pointer = doctrine claiming an enforcement that's gone).
 *   2. The number of UNENFORCED HARD STOPS may only shrink, never grow —
 *      a hard stop with no automated backstop is governance debt, and this
 *      baseline drives it to zero the same way FOUNDER_ROUTE_BASELINE and the
 *      deletion floor drive their debts down.
 *
 * When you wire real enforcement for a prose-only hard stop, reclassify it in
 * shared/governance/constitution.ts and LOWER the baseline below.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  CONSTITUTION,
  hardStops,
  unenforcedHardStops,
  invariantById,
} from "@shared/governance/constitution";

const ROOT = path.resolve(__dirname, "../..");

/**
 * Current count of hard stops with no automated backstop. May only DECREASE.
 *
 * 2026-07-27 (initial): 3 — pricing changes, legal signing, customer-data
 *   deletion. (spends >$500 was the one already machine-enforced.)
 * 2026-07-27 (→1): auditing the actual code found checkHardGuardrails()
 *   ALREADY blocks pricing/billing modifications and customer-data deletion
 *   before the AI is consulted — the registry had been too pessimistic. That
 *   enforcement is now pinned by tests/unit/founderHardStopGuardrails.test.ts,
 *   so both were reclassified prose-only → code-invariant.
 * 2026-07-27 (→0): legal signing wired into checkHardGuardrails() —
 *   LEGAL_SIGNING_ACTIONS action class + sign/execute_contract payload flags,
 *   ratcheted by tests/unit/founderHardStopGuardrails.test.ts. All four hard
 *   stops are now machine-enforced; this baseline stays at 0 forever.
 */
const UNENFORCED_HARD_STOP_BASELINE = 0;

describe("constitution registry — shape", () => {
  it("every invariant has the required non-empty fields", () => {
    for (const inv of CONSTITUTION) {
      expect(inv.id, "id").toBeTruthy();
      expect(inv.title, `${inv.id} title`).toBeTruthy();
      expect(inv.statement, `${inv.id} statement`).toBeTruthy();
      expect(inv.source, `${inv.id} source`).toBeTruthy();
      expect(inv.enforcement.refs.length, `${inv.id} refs`).toBeGreaterThan(0);
    }
  });

  it("ids are unique and kebab-namespaced", () => {
    const ids = CONSTITUTION.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
  });

  it("invariantById round-trips", () => {
    expect(invariantById("hard-stop.spend-over-500")?.category).toBe("hard-stop");
    expect(invariantById("nope")).toBeUndefined();
  });
});

describe("constitution registry — enforcement pointers are real", () => {
  it("every enforcement ref resolves to a file that exists", () => {
    const missing: string[] = [];
    for (const inv of CONSTITUTION) {
      for (const ref of inv.enforcement.refs) {
        if (!fs.existsSync(path.join(ROOT, ref))) missing.push(`${inv.id} → ${ref}`);
      }
    }
    expect(missing, `stale enforcement pointers:\n${missing.join("\n")}`).toEqual([]);
  });
});

describe("constitution ratchet — hard stops must become machine-enforced", () => {
  it("registers the four founder hard stops", () => {
    // The four permanent hard stops from CLAUDE.md's DO-NOT-DO list.
    expect(hardStops().length).toBe(4);
  });

  it("the count of UNENFORCED hard stops never exceeds the baseline (it may only shrink)", () => {
    const debt = unenforcedHardStops().map((i) => i.id);
    expect(
      debt.length,
      `unenforced hard stops (${debt.length}) exceed the baseline ` +
        `(${UNENFORCED_HARD_STOP_BASELINE}). A hard stop must not lose its ` +
        `automated backstop. If you WIRED enforcement, reclassify it in ` +
        `constitution.ts and lower the baseline. Current debt: ${debt.join(", ")}`,
    ).toBeLessThanOrEqual(UNENFORCED_HARD_STOP_BASELINE);
  });

  it("the >$500 spend hard stop is machine-enforced (never regresses to prose)", () => {
    // This is the one that drifted. Pin it enforced forever.
    expect(invariantById("hard-stop.spend-over-500")?.enforcement.kind).not.toBe(
      "prose-only",
    );
  });
});
