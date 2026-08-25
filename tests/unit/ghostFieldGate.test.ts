/**
 * The ghost-field gate must fire on the defect and not on the idiom.
 *
 * `scripts/check-ghost-fields.mjs` counts `(x as any).prop` where `prop` is not
 * on x's pre-cast type. Three live defects of that shape were found by hand
 * (auditOrgUsury's Texas fallback, the seller-motivation vector, the campaign
 * message body) before anything could detect them, and a regex over casts whose
 * variable NAME matched a table found only 19 of the 100 the type checker sees.
 *
 * This file pins the gate's SHAPE, not its count: the ratchet holds the count.
 * What can rot here is the gate's meaning — the two exclusions are what let it
 * claim "a KNOWN shape is missing this field" rather than "some cast exists",
 * and a future edit that drops either turns the number into noise nobody can
 * act on.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const GATE = fs.readFileSync(path.join(ROOT, "scripts/check-ghost-fields.mjs"), "utf8");
const RATCHET = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/ratchets/ghost-fields.json"), "utf8"),
);
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

describe("the gate is wired and ratcheted", () => {
  it("runs inside npm run check", () => {
    // A gate nothing runs is a file, not a gate.
    //
    // This was `toBe("node scripts/check-ghost-fields.mjs")` — exact equality.
    // The invariant it meant to hold is "the npm script actually invokes THIS
    // gate", and exact equality over-specifies that: it also forbids any
    // legitimate change to how the command is launched. On 2026-08-25 this gate
    // was found to abort with 134 (V8 heap OOM) at Node's default ceiling —
    // it builds a full `ts.createProgram` + `getTypeChecker` IN PROCESS, so it
    // needs `NODE_OPTIONS=--max-old-space-size=…` on its own command, and the
    // exact-equality assertion made the fix look like a regression.
    //
    // Rewritten to the new truth, and STRENGTHENED: the original invariant
    // survives, plus the ceiling is now pinned too, because a gate that dies
    // partway through reports fewer findings than exist.
    expect(PKG.scripts["lint:ghost-fields"]).toContain("node scripts/check-ghost-fields.mjs");
    expect(
      PKG.scripts["lint:ghost-fields"],
      "this gate builds a TypeScript Program in-process and OOMs at Node's " +
        "default heap — it must carry an explicit --max-old-space-size",
    ).toMatch(/--max-old-space-size=\d+/);
    expect(
      PKG.scripts.check,
      "lint:ghost-fields is not in the check chain — it would only ever run by hand",
    ).toContain("npm run lint:ghost-fields");
  });

  it("is strictly down-only, in both directions", () => {
    expect(RATCHET.direction).toBe("down");
    expect(typeof RATCHET.baseline).toBe("number");
    // Over-baseline fails, and so does a stale-high baseline: a reduction that
    // is not locked into the commit that earned it is a reduction that rots.
    expect(GATE).toMatch(/findings\.length > baseline/);
    expect(GATE).toMatch(/findings\.length < baseline/);
    expect(GATE).toContain("stale-high");
  });

  it("floors its own populations, so an empty scan cannot read as clean", () => {
    // Every number this gate reports counts BAD THINGS FOUND. A program that
    // stops loading files finds zero and passes — the exact failure this repo
    // has already been bitten by elsewhere.
    expect(RATCHET.minima.castsInScope).toBeGreaterThan(0);
    expect(RATCHET.minima.judgedCasts).toBeGreaterThan(0);
    expect(GATE).toContain("VACUITY GUARD");
    expect(GATE).toMatch(/process\.exit\(1\)/);
  });
});

describe("the two exclusions that give the count its meaning", () => {
  it("excludes ambient global augmentation BY RULE, not by baseline", () => {
    // window.webkitSpeechRecognition and friends are a real idiom: the property
    // genuinely is not in the ambient lib types and there is no row to read.
    // Parking them in the baseline instead would make the number mean two
    // different things at once.
    expect(GATE).toMatch(/AMBIENT_BASE/);
    for (const g of ["Window", "globalThis", "Document", "Navigator"]) {
      expect(GATE, `${g} is no longer excluded — the count now mixes idiom with defect`).toContain(g);
    }
  });

  it("excludes shapeless base types, which contradict nothing", () => {
    // A type with zero declared properties (`object`, `{}`) is doing the job
    // `any` would do; there is no shape being asked for a field it lacks.
    expect(GATE).toMatch(/getPropertiesOfType\(t\)\.length === 0/);
    expect(GATE).toMatch(/shapeless/);
  });

  it("does not treat an index signature as a missing property", () => {
    // A `Record<string, X>` legitimately answers any key.
    expect(GATE).toMatch(/getIndexInfoOfType/);
  });

  it("skips bases it cannot judge rather than guessing", () => {
    // any / unknown / a bare type parameter carry no claim to contradict.
    expect(GATE).toMatch(/TypeFlags\.Any/);
    expect(GATE).toMatch(/TypeFlags\.Unknown/);
    expect(GATE).toMatch(/TypeFlags\.TypeParameter/);
  });
});

describe("the remedy text does not offer the wrong repair", () => {
  it("tells the reader to read the real field, and warns against widening the type", () => {
    // Widening the type to make the ghost legal is the one repair that is worse
    // than the defect: it documents `undefined` as the contract and silences the
    // gate permanently.
    expect(GATE).toMatch(/READ THE REAL FIELD/);
    expect(GATE).toMatch(/Do NOT widen the type/);
    expect(GATE).not.toMatch(/raise the baseline/i);
  });
});
