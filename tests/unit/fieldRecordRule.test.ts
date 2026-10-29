/**
 * The shared field-record rule (shared/provenance/fieldRecord.ts) — one rule
 * for the note record (N4) and the tax lot record (V-Tax-1 T4). Pure.
 *
 *   - agreeing sources are not a disagreement; differing sources are, with
 *     every value and every observation kept, the book value named;
 *   - one source stating a value the book does not hold is a disagreement;
 *   - a missing value says why: blank on a source vs never stated;
 *   - and the rule has production callers in BOTH verticals (it is canonical
 *     only if the surfaces consume it, not if they re-implement it).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { recordedField, type ObservationView } from "@shared/provenance/fieldRecord";
import { stripComments } from "../helpers/stripComments";

const o = (value: unknown, file: string, kind: "value" | "searched_none" = "value"): ObservationView => ({
  value: kind === "value" ? value : null, kind, source: "tax_list", sourceRef: { fileName: file, column: "C" }, asOf: "2026-09-01", confidence: "medium", basis: "SYNTHETIC", decayClass: "months", observedAt: `2026-09-0${file.length % 9}T00:00:00.000Z`,
});

describe("one field across its sources", () => {
  it("agreeing sources: no disagreement; the provenance is the first that states the book value", () => {
    const r = recordedField("f", "F", 100, [o(100, "a.csv"), o(100, "b.csv")]);
    expect(r.disagreement).toBeNull();
    expect(r.provenance?.sourceRef.fileName).toBe("a.csv");
  });
  it("differing sources: every value with every observation, the book named", () => {
    const r = recordedField("f", "F", 100, [o(100, "a.csv"), o(250, "b.csv"), o(100, "c.csv")]);
    expect(r.disagreement).toEqual({ values: [{ value: 100, observations: [expect.anything(), expect.anything()] }, { value: 250, observations: [expect.anything()] }], bookValueIs: 0 });
    expect(r.value).toBe(100);
  });
  it("one source stating what the book does not hold is a disagreement", () => {
    expect(recordedField("f", "F", 100, [o(250, "b.csv")]).disagreement).toEqual({ values: [{ value: 250, observations: [expect.anything()] }], bookValueIs: null });
  });
  it("structured values compare by value", () => {
    expect(recordedField("y", "Y", [2023, 2024], [o([2023, 2024], "a.csv"), o([2023], "b.csv")]).disagreement?.values.map((v) => v.value)).toEqual([[2023, 2024], [2023]]);
  });
  it("missing: blank on a source is not never stated", () => {
    expect(recordedField("f", "F", null, [o(null, "a.csv", "searched_none")]).absence).toEqual({ status: "blank_on_source", column: "C", fileName: "a.csv" });
    expect(recordedField("f", "F", null, []).absence).toEqual({ status: "never_stated" });
    expect(recordedField("f", "F", 5, []).absence).toBeNull();
  });
});

describe("the rule is canonical: both records consume it", () => {
  const read = (p: string) => stripComments(readFileSync(path.join(__dirname, "../..", p), "utf8"));
  for (const p of ["server/services/notes/noteRecord.ts", "server/services/tax/lotRecord.ts"]) {
    it(`${p} calls recordedField and keeps no grouping of its own`, () => {
      const src = read(p);
      expect(src).toMatch(/\brecordedField\(/);
      expect(src).not.toMatch(/bookValueIs\s*:/);
    });
  }
});
