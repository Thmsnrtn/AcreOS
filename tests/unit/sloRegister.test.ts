/**
 * sloRegister.test.ts — O4 exit tests (P5 §2 "promises with sensors").
 *
 * Pins, in order:
 *  1. The register declares exactly the four surface classes, each with a
 *     promise and a target — and every target is labelled as DECLARED, so a
 *     goal can never masquerade as a measurement.
 *  2. `wired` derives from REAL sensor references: every register row resolves
 *     against a live artifact (JOB_ROSTER membership for job sensors; an
 *     actual pgTable for table sensors), and a row naming a nonexistent
 *     sensor resolves UNWIRED (fails closed).
 *  3. The persona-journey canary is registered with a failure lane derived
 *     from the O5 pager matrix (jobRegistry → resolveFailureLane), its
 *     withJobLock literal exists in the module runScheduledJobs.ts actually
 *     imports, and its in-job failure path rides the QUEUE lane (warning
 *     spine alert, no page).
 *  4. The public /status page renders the register + canary (source pins),
 *     and the /api/status handler actually calls getPublicSloStatus — the
 *     register cannot be "built but unwired".
 *  5. No fabricated current values: an unwired row can never carry a reading
 *     (structural, via assemblePublicRow), the assembly site uses that
 *     function, and the status page source contains no hardcoded percentage.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { SLO_REGISTER, type SloRegisterRow } from "../../shared/slo";
import { JOB_ROSTER, resolveFailureLane } from "../../server/jobs/jobRegistry";
import {
  assemblePublicRow,
  resolveSensorWired,
} from "../../server/services/slo";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

/** Every schema source file a table sensor may legitimately live in. */
function schemaSources(): string {
  const parts = [read("shared/schema.ts")];
  const dir = path.join(ROOT, "shared/schema");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".ts")) parts.push(read(`shared/schema/${f}`));
    }
  }
  return parts.join("\n");
}

describe("1. the four surface classes, written down", () => {
  it("declares exactly send_lanes, five_doors, portals, background_intelligence", () => {
    expect(SLO_REGISTER.map((r) => r.surfaceClass).sort()).toEqual([
      "background_intelligence",
      "five_doors",
      "portals",
      "send_lanes",
    ]);
  });

  it("every row carries a real promise, a target, and a sensor reference", () => {
    for (const row of SLO_REGISTER) {
      expect(row.promise.length, row.surfaceClass).toBeGreaterThan(20);
      expect(row.target.length, row.surfaceClass).toBeGreaterThan(10);
      expect(row.sensor.kind, row.surfaceClass).toBeTruthy();
      expect(row.sensor.source, row.surfaceClass).toBeTruthy();
      expect(row.sensor.senses.length, row.surfaceClass).toBeGreaterThan(20);
    }
  });

  it("every target is labelled DECLARED — a goal can never read as a measurement", () => {
    for (const row of SLO_REGISTER) {
      expect(row.target.toLowerCase(), row.surfaceClass).toContain("declared");
    }
  });
});

describe("2. wired derives from real sensor references", () => {
  it("every register row names an artifact that exists TODAY", () => {
    const schemaSrc = schemaSources();
    const rosterNames = new Set(JOB_ROSTER.map((e) => e.name));
    for (const row of SLO_REGISTER) {
      if (row.sensor.kind === "job_failure_lane") {
        expect(
          rosterNames.has(row.sensor.source),
          `${row.surfaceClass} names roster job "${row.sensor.source}"`,
        ).toBe(true);
      } else {
        // Table sensors must name a real pgTable — tolerate formatting.
        const re = new RegExp(`pgTable\\(\\s*["'\`]${row.sensor.source}["'\`]`);
        expect(
          re.test(schemaSrc),
          `${row.surfaceClass} names schema table "${row.sensor.source}"`,
        ).toBe(true);
      }
      // And the DERIVATION agrees: the real resolver wires every current row.
      expect(resolveSensorWired(row.sensor), row.surfaceClass).toBe(true);
    }
  });

  it("a register row naming a nonexistent sensor resolves UNWIRED (fails closed)", () => {
    expect(
      resolveSensorWired({
        kind: "job_failure_lane",
        source: "job_that_does_not_exist_xyz",
        senses: "nothing",
      }),
    ).toBe(false);
    expect(
      resolveSensorWired({
        kind: "api_latency_samples",
        source: "table_that_does_not_exist_xyz",
        senses: "nothing",
      }),
    ).toBe(false);
    expect(
      resolveSensorWired({
        kind: "uptime_probe",
        source: "not_uptime_samples",
        senses: "nothing",
      }),
    ).toBe(false);
  });
});

describe("3. the persona-journey canary is registered with a failure lane", () => {
  const entry = JOB_ROSTER.find((e) => e.name === "persona_journey_canary");

  it("has a roster entry the deadman can see", () => {
    expect(entry).toBeDefined();
    expect(entry!.intervalMs).toBeGreaterThan(0);
  });

  it("resolves to the QUEUE lane per the O5 pager matrix (non-critical, no page)", () => {
    expect(entry!.critical).toBe(false);
    expect(resolveFailureLane(entry!)).toBe("queue");
  });

  it("its withJobLock literal lives in the module runScheduledJobs.ts imports", () => {
    const mod = read("server/jobs/reliabilityCanaries.ts");
    expect(mod).toContain('withJobLock("persona_journey_canary"');
    expect(mod).toContain('name: "persona_journey_canary"');
    // The extraction kept the vendor checks — synthetic_checks moved with it.
    expect(mod).toContain('withJobLock("synthetic_checks"');
    const registrar = read("server/jobs/runScheduledJobs.ts");
    expect(registrar).toContain('import("./reliabilityCanaries")');
    expect(registrar).toContain("startReliabilityCanaryJobs");
    // No duplicate registration left behind in the god-file.
    expect(registrar).not.toContain('withJobLock("synthetic_checks"');
  });

  it("in-job failure rides the queue lane: a WARNING spine alert, never a page", () => {
    const mod = read("server/jobs/reliabilityCanaries.ts");
    const canaryBlock = mod.slice(mod.indexOf("persona-journey canary (every 30 min)"));
    expect(canaryBlock).toContain('severity: "warning"');
    expect(canaryBlock).not.toContain('severity: "critical"');
    expect(canaryBlock).not.toContain("pagePriority");
  });

  it("the canary rides the EXISTING synthetic_check_runs store (no new table)", () => {
    const svc = read("server/services/slo.ts");
    expect(svc).toContain("syntheticCheckRuns");
    expect(svc).toContain('CANARY_CHECK_KEY = "persona_journey"');
    // No new pgTable was introduced for the canary.
    expect(svc).not.toContain("pgTable(");
  });
});

describe("4. the status page tells the truth (wiring pins)", () => {
  it("/api/status serves the register — getPublicSloStatus has a production call site", () => {
    const routes = read("server/routes.ts");
    expect(routes).toContain("getPublicSloStatus");
    expect(routes).toContain('import("./services/slo")');
  });

  it("the /status page renders the register, the honest-absence state, and the canary", () => {
    const page = read("client/src/pages/status.tsx");
    expect(page).toContain('data-testid="slo-register"');
    expect(page).toContain("Declared — not yet sensed");
    expect(page).toContain('data-testid="journey-canary"');
    expect(page).toContain('from "@shared/slo"');
    // The honest-unavailable branch exists (slo null ⇒ words, not numbers).
    expect(page).toContain('data-testid="slo-unavailable"');
  });
});

describe("5. no fabricated current values", () => {
  const row: SloRegisterRow = SLO_REGISTER[0];

  it("an UNWIRED row can never carry a reading — whatever a caller passes", () => {
    const smuggled = assemblePublicRow(row, false, {
      label: "smuggled",
      value: "totally real number",
      asOf: null,
    });
    expect(smuggled.current).toBeNull();
    expect(smuggled.wired).toBe(false);
  });

  it("a wired row with no data renders null — never a stand-in", () => {
    const honest = assemblePublicRow(row, true, null);
    expect(honest.wired).toBe(true);
    expect(honest.current).toBeNull();
  });

  it("the assembly site actually uses the structural guard", () => {
    const svc = read("server/services/slo.ts");
    const assemblySite = svc.slice(svc.indexOf("export async function getPublicSloStatus"));
    expect(assemblySite).toContain("assemblePublicRow(");
  });

  it("the status page source hardcodes no percentage — values only arrive as data", () => {
    const page = read("client/src/pages/status.tsx");
    expect(page).not.toMatch(/\d+(\.\d+)?%/);
  });
});
