/**
 * A benchmark is a claim about the world. It renders with a source, or not at all.
 *
 * ── WHAT SHIPPED ────────────────────────────────────────────────────────────
 * Two uncited constants were presented as facts:
 *
 *   `industryBenchmarkMin: 1, industryBenchmarkMax: 3` — served to CUSTOMERS on
 *   the direct-mail attribution card as "Industry benchmark: 1–3%", and driving
 *   a green "— above average" badge the moment a customer's measured response
 *   rate cleared the invented lower bound. An invented number was issuing a
 *   verdict on a paying customer's campaign.
 *
 *   `industryBenchmark: 2.5, // SaaS average monthly churn %` — served to the
 *   founder, rendered as two of three headline stats and a comparison bar, and
 *   reused as the threshold for a categorical health status, so an invented
 *   number also had authority over a verdict.
 *
 * ── WHY THIS IS A DIFFERENT CASE FROM AN INVENTED MEASUREMENT ───────────────
 * A benchmark is legitimately a CONSTANT: you do not compute the industry's
 * average from your own database. So the measurement-defaults rules do not and
 * should not fire on it — rule D's vocabulary is deliberately about
 * observations, and `benchmark` is not one. The defect is not the constancy.
 * It is the missing source, and only a rule about SOURCES can catch it.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * The contract is structural: `Benchmark` has no way to express a value without
 * `source` and `asOf`, so a figure cannot be added by accident. This file pins
 * the parts a type cannot reach — that the surfaces go through the registry,
 * that no payload hardcodes a figure again, and that the client renders the
 * citation whenever it renders the number.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/**
 * Every surface that serves or renders a benchmark. ENUMERATED here, so adding
 * a third one without adding it to this list is what fails — not a silent pass
 * over a file this test never opened.
 */
const BENCHMARK_SURFACES = [
  "server/routes-admin.ts",
  "server/routes-founder-intelligence.ts",
  "client/src/components/campaigns-content.tsx",
  "client/src/components/dashboard/ChurnIntelligence.tsx",
  "client/src/hooks/use-campaigns.ts",
];

describe("benchmarks carry their source", () => {
  it("the type cannot express a figure without a citation", () => {
    const src = read("server/services/benchmarks.ts");
    for (const field of ["value: number;", "unit: string;", "source: string;", "asOf: string;"]) {
      expect(
        src,
        `Benchmark.${field.split(":")[0]} is gone. Every one of these is what ` +
          "separates a cited figure from an invented one; source and asOf are " +
          "required, not optional, on purpose.",
      ).toContain(field);
    }
    // Required, not optional — `source?: string` would let the whole thing back.
    expect(
      src,
      "source or asOf became optional, which re-opens exactly the hole: a " +
        "figure with no citation, type-checked.",
    ).not.toMatch(/\b(source|asOf)\?\s*:/);
  });

  it("no surface hardcodes a benchmark figure", () => {
    for (const rel of BENCHMARK_SURFACES) {
      const src = read(rel);
      expect(
        src,
        `${rel} binds a benchmark to a numeric literal again. That is the ` +
          "defect verbatim: a claim about an entire industry with nothing " +
          "behind it. Register it in server/services/benchmarks.ts with its " +
          "publisher and year, or render nothing.",
      ).not.toMatch(/industryBenchmark[A-Za-z]*\s*:\s*-?\d/);
    }
  });

  it("the server reads both figures from the registry", () => {
    expect(read("server/routes-admin.ts")).toContain(
      "benchmarkFor(BENCHMARK_KEYS.directMailResponseRate)",
    );
    expect(read("server/routes-founder-intelligence.ts")).toContain(
      "benchmarkFor(BENCHMARK_KEYS.saasMonthlyChurn)",
    );
  });

  it("the churn status threshold is OURS, not borrowed from the benchmark", () => {
    const src = read("server/routes-founder-intelligence.ts");
    expect(
      src,
      "the health verdict reads a bare 2.5 again. When the same uncited " +
        "number drew the bar AND set the alarm, an invention had authority " +
        "over a categorical judgement. The thresholds are an internal policy " +
        "and are named as one.",
    ).toContain("CHURN_STATUS_THRESHOLDS");
    expect(src).toMatch(/monthlyChurnRate <= CHURN_STATUS_THRESHOLDS\.healthyAtOrBelowPct/);
  });

  it("the client renders the citation wherever it renders the figure", () => {
    const campaigns = read("client/src/components/campaigns-content.tsx");
    const churn = read("client/src/components/dashboard/ChurnIntelligence.tsx");

    // Guarded: nothing renders unless a benchmark object is present.
    expect(
      campaigns,
      "the customer-facing benchmark line is unguarded again, so a null " +
        "benchmark renders as an empty range.",
    ).toContain("{mailAttribution.industryBenchmark && (");
    expect(churn, "the founder benchmark stats are unguarded again").toContain("{benchmark && (");

    // And the source travels with the number, on both surfaces.
    for (const [rel, src] of [
      ["campaigns-content.tsx", campaigns],
      ["ChurnIntelligence.tsx", churn],
    ] as const) {
      expect(
        src,
        `${rel} renders a benchmark value without its source. A figure the ` +
          "reader cannot check is the thing this whole change exists to stop.",
      ).toMatch(/\.source\}/);
      expect(src, `${rel} renders a benchmark without its date`).toMatch(/\.asOf\}/);
    }
  });

  it("the registry is empty, and says so — no citation was invented to fill it", () => {
    const src = read("server/services/benchmarks.ts");
    expect(
      src,
      "a benchmark was added to the registry. That is fine and expected — but " +
        "update this assertion deliberately, and make sure `source` names a " +
        "real publisher rather than 'industry data'.",
    ).toMatch(/const BENCHMARKS: Record<string, Benchmark> = \{\};/);
  });
});
