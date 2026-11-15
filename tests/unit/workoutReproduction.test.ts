/**
 * Notes V2 Leg 2 — the reproduction check (reproduceRun) is not decoration: a
 * one-cent change anywhere in a stored result reads as "differs", key order
 * alone (what jsonb does to a stored run) does not, and a run stored by another
 * engine version is reported as such rather than compared.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runWorkoutComparison, WORKOUT_ENGINE_VERSION, type WorkoutInputs } from "@shared/notes/workoutEngine";
import { canonicalJson, reproduceRun } from "../../server/services/notes/workoutAnalysis";

const inputs = (JSON.parse(readFileSync(path.join(__dirname, "../../shared/notes/golden/workout-golden.expected.json"), "utf8")) as { inputs: WorkoutInputs }).inputs;

const reverseKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;

describe("workout run reproduction", () => {
  const result = runWorkoutComparison(inputs);

  it("an untouched stored result reproduces, whatever its key order", () => {
    const stored = reverseKeys(result) as typeof result;
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(result));
    expect(reproduceRun({ engineVersion: WORKOUT_ENGINE_VERSION, inputs, result: stored })).toEqual({ status: "reproduces" });
  });

  it("one cent changed in any line of any path reads as 'differs'", () => {
    for (let i = 0; i < result.paths.length; i++) {
      const tampered = JSON.parse(JSON.stringify(result));
      tampered.paths[i].lines[0].discountedCents += 1;
      expect(reproduceRun({ engineVersion: WORKOUT_ENGINE_VERSION, inputs, result: tampered })).toEqual({ status: "differs" });
    }
  });

  it("a changed input against the stored result reads as 'differs'", () => {
    const edited = { ...inputs, discountRateBps: inputs.discountRateBps! + 1 };
    expect(reproduceRun({ engineVersion: WORKOUT_ENGINE_VERSION, inputs: edited, result })).toEqual({ status: "differs" });
  });

  it("a run from another engine version is named, not compared", () => {
    expect(reproduceRun({ engineVersion: "workout-engine v0", inputs, result })).toEqual({
      status: "engine_version_changed",
      storedVersion: "workout-engine v0",
      currentVersion: WORKOUT_ENGINE_VERSION,
    });
  });

  it("canonicalJson orders keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });
});
