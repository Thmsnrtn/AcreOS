/**
 * Truth-lint regression guard (Quinn — Chief of Alignment, 2026-06-08).
 *
 * These four sites previously fabricated internal/founder-facing metrics with
 * `Math.random()` (API-usage stats, agent self-calibration telemetry, org
 * heartbeat per-agent latency, pipeline-velocity stage timing). A lying
 * internal instrument is how "we didn't actually ship" stays invisible — so
 * each now returns a real value or an HONEST null/zero, never a random number.
 *
 * This test pins the no-fabrication contract at the source-text level (the same
 * level scripts/check-no-fabrication.mjs tracks) so a future edit can't quietly
 * reintroduce `Math.random()` into any of these outputs.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// These files have ZERO legitimate Math.random use — any occurrence is a
// fabricated metric. (routes-data-api.ts is checked separately because it
// retains one non-metric use: API-key value generation on line ~177.)
const GUARDED_FILES = [
  "server/services/agentSelfCalibrationV10.ts",
  "server/services/orgHeartbeatV10.ts",
  "server/services/reportingEnhancements.ts",
];

describe("no fabricated internal metrics", () => {
  for (const rel of GUARDED_FILES) {
    it(`${rel} contains no Math.random() (no synthetic metric output)`, () => {
      const src = read(rel);
      expect(src.includes("Math.random")).toBe(false);
    });
  }

  it("API key usage stats report honest zeros + an explicit not-tracked marker", () => {
    const src = read("server/routes-data-api.ts");
    // Isolate the usage-stats handler (the only place that previously
    // fabricated metrics). The sole remaining Math.random in this file is
    // API-key generation in the POST /keys handler — a non-metric use that is
    // intentionally out of scope and must NOT appear inside usage stats.
    const usageBlock = src.slice(
      src.indexOf("// ── API Key Usage Stats"),
      src.indexOf("// ── Data API Stats"),
    );
    expect(usageBlock.length).toBeGreaterThan(0);
    // The fabricated 0-10000/0-200/0-5000/120-200 random counts are gone…
    expect(usageBlock).not.toMatch(/Math\.random/);
    // …replaced by honest zeros and a tracking flag so no one reads the
    // numbers as real partner usage.
    expect(usageBlock).toMatch(/tracked:\s*false/);
    expect(usageBlock).toMatch(/totalRequests:\s*0/);
    expect(usageBlock).toMatch(/avgResponseTimeMs:\s*null/);
  });

  it("agent self-calibration emits null + insufficient-data marker for un-instrumented signals", () => {
    const src = read("server/services/agentSelfCalibrationV10.ts");
    expect(src).toMatch(/falseAlarmRate:\s*null/);
    expect(src).toMatch(/emailOpenRate:\s*null/);
    expect(src).toMatch(/overrideRate:\s*null/);
    expect(src).toMatch(/_insufficientData/);
    // And the rule evaluators must short-circuit on null rather than coerce a
    // missing signal into a real-looking 0/20 that could trigger calibration.
    expect(src).toMatch(/== null/);
  });

  it("org heartbeat leaves agent latencies empty when not measured", () => {
    const src = read("server/services/orgHeartbeatV10.ts");
    expect(src).not.toMatch(/Math\.random/);
    expect(src).toMatch(/const agentLatencies: Record<string, number> = \{\};/);
  });

  it("pipeline velocity returns null stage timing + timingAvailable:false, not invented avgDays", () => {
    const src = read("server/services/reportingEnhancements.ts");
    expect(src).not.toMatch(/avgDays:\s*Math\.floor/);
    expect(src).toMatch(/avgDays:\s*null/);
    expect(src).toMatch(/timingAvailable:\s*false/);
  });
});
