/**
 * Shared reconstruction of the runtime NEVER_PROMOTE set, for the two gates
 * that need it (hardStopLaneCoverage.test.ts, agentAuthorityCeiling.test.ts).
 *
 * A HELPER MODULE ON PURPOSE, and deliberately light. This logic first lived as
 * exports on hardStopLaneCoverage.test.ts, and the ceiling test imported the
 * TEST FILE to reach it — which dragged that file's import of
 * autonomousDecisionExecutor (a heavyweight module graph) into the ceiling
 * test's worker on top of its own mocked authority-gate graph, and the fork
 * OOM'd at the 2 GB default heap. Same lesson as the session's opening
 * incident, one layer down: watch what a convenience import actually loads.
 * This module imports ONLY the pure hard-stops data module and node:fs.
 *
 * Reconstruction = constitutional ids from the coverage map (the same object
 * production composes in) + the module-private OPERATIONAL_NEVER_PROMOTE
 * literal extracted from source. For a `const [...] as const` of string
 * literals the source IS the runtime value. Whether production actually
 * composes the two is proven elsewhere, from both sides: the composition
 * assertion in hardStopLaneCoverage.test.ts, and agentAuthorityCeiling.test.ts
 * driving every one of these ids through the real checkAuthority.
 */
import fs from "node:fs";
import path from "node:path";
import { HARD_STOP_LANE_COVERAGE } from "../../server/services/autopilot/hardStops";

const ROOT = path.resolve(__dirname, "../..");

export function agentAuthorityGateSource(): string {
  return fs.readFileSync(path.join(ROOT, "server/services/agentAuthorityGate.ts"), "utf8");
}

export function extractNeverPromoteActions(): string[] {
  const m = /const OPERATIONAL_NEVER_PROMOTE = \[([\s\S]*?)\] as const;/.exec(
    agentAuthorityGateSource(),
  );
  const operational = m ? [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]) : [];
  const constitutional = Object.values(HARD_STOP_LANE_COVERAGE).flatMap((c) => [
    ...c.neverPromoteIds,
  ]);
  return [...new Set([...constitutional, ...operational])];
}
