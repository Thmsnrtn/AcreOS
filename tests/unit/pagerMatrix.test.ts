/**
 * Wave 0.9 (audit P5-1 / F-13-1 / F-18-2) — pager matrix + watchdog armament.
 *
 * 1. PAGER MATRIX AS DATA: every JOB_ROSTER entry resolves to exactly one
 *    failure lane via resolveFailureLane, a critical job can NEVER resolve
 *    below "page" (structural — the resolver ignores downgrading overrides),
 *    and the deadman DISPATCHES from the resolved lane, not from a local
 *    criticality branch. F-13-1's critical-job-failure pages stay closed.
 * 2. EXTERNAL WATCHDOGS (F-18-2): the step-away verdict carries an
 *    external_watchdogs check that verifies armament by BEHAVIOR (a landed
 *    outside-in uptime sample), never config self-report alone — "you can
 *    step away, every system armed" can no longer be true while the
 *    outside-in probes are dormant (founder decision 8's deferral stays
 *    visible until provisioned).
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  JOB_ROSTER,
  resolveFailureLane,
  type JobRosterEntry,
} from "../../server/jobs/jobRegistry";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("pager matrix as data (P5-1)", () => {
  it("every roster entry resolves to exactly one valid lane", () => {
    expect(JOB_ROSTER.length).toBeGreaterThan(100);
    for (const entry of JOB_ROSTER) {
      expect(["page", "queue", "tray"]).toContain(resolveFailureLane(entry));
    }
  });

  it("no critical job can resolve below page — even with a downgrading override", () => {
    for (const entry of JOB_ROSTER.filter((e) => e.critical)) {
      expect(
        resolveFailureLane(entry),
        `critical job ${entry.name} must page on absence`,
      ).toBe("page");
      // Structural, not merely conventional: an override cannot downgrade.
      const tampered = { ...entry, onFailure: "tray" } as JobRosterEntry;
      expect(resolveFailureLane(tampered)).toBe("page");
    }
  });

  it("the deadman dispatches FROM the resolved lane, not a local critical branch", () => {
    const code = stripComments(read("server/jobs/deadmanCheck.ts"));
    expect(code).toContain("resolveFailureLane(entry)");
    // Formatting-tolerant: severity must derive from the lane…
    expect(code).toMatch(/severity:\s*lane ===/);
    // …and the old direct branch must never come back — including on the
    // config-dormant meta-check, which now filters by lane too.
    expect(code).not.toMatch(/severity:\s*entry\.critical/);
    expect(code).toContain('e.lane === "page"');
  });

  it("F-13-1 stays closed: a dark critical job raises a critical spine alert that pages", () => {
    // The spine's own suites prove critical → page; here we pin the deadman's
    // side of the contract — the raiseAlert call survives with the spine
    // fields the pager depends on.
    const code = stripComments(read("server/jobs/deadmanCheck.ts"));
    expect(code).toContain("raiseAlert(");
    expect(code).toContain('alertType: "job_dark"');
    expect(code).toContain("seedPageThrottle(");
  });
});

describe("external watchdog armament (F-18-2)", () => {
  const code = stripComments(read("server/services/autopilot/stepAwayReadiness.ts"));

  it("the step-away verdict carries the external_watchdogs check", () => {
    expect(code).toContain('key: "external_watchdogs"');
  });

  it("dormant probes force action_needed — the verdict cannot say armed while outside-in is dark", () => {
    // Token unset → action_needed; and even with the token set, armament is
    // proven only by a LANDED external sample (behavior, not self-report).
    expect(code).toContain("UPTIME_PROBE_TOKEN");
    const checkStart = code.indexOf('key: "external_watchdogs"');
    const checkSlice = code.slice(checkStart, checkStart + 3200);
    expect(checkSlice).toContain('eq(uptimeSamples.source, "external")');
    const actionNeededCount = (checkSlice.match(/"action_needed"/g) ?? []).length;
    expect(actionNeededCount).toBeGreaterThanOrEqual(2);
  });

  it("the probe ingest endpoint records behavior the check reads (loop closes)", () => {
    const routes = read("server/routes.ts");
    expect(routes).toContain('"/api/health/uptime-probe"');
    expect(routes).toContain('recordUptimeSample("external")');
  });
});
