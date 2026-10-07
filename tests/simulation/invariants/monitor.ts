/**
 * The continuous invariant monitor. A simulation calls `observe()` after every
 * tick (or simulated day); the monitor checks every invariant against that
 * tick's evidence, keeps the cross-tick state some invariants need (pages per
 * incident), and records each violation WITH the tick it happened on — so a
 * violation on day 3 that the world later papers over is still a violation.
 */
import { appendFileSync } from "node:fs";
import { checkAll, freshState, INVARIANTS, type MonitorState } from "./registry";
import type { Observation, Violation } from "./types";

export class InvariantMonitor {
  readonly violations: Violation[] = [];
  /** Per invariant: ticks it was checked with all its sources read, and ticks it was unknown. */
  readonly coverage = new Map<string, { checked: number; unknown: number }>();
  ticks = 0;
  private st: MonitorState = freshState();

  constructor(private readonly logFile?: string) {
    for (const i of INVARIANTS) this.coverage.set(i.id, { checked: 0, unknown: 0 });
  }

  observe(o: Observation): Violation[] {
    this.ticks++;
    const { violations, unknown } = checkAll(o, this.st);
    const unk = new Set(unknown);
    for (const i of INVARIANTS) {
      const c = this.coverage.get(i.id)!;
      if (unk.has(i.id)) c.unknown++;
      else c.checked++;
    }
    for (const v of violations) {
      this.violations.push(v);
      if (this.logFile) appendFileSync(this.logFile, JSON.stringify(v) + "\n");
    }
    return violations;
  }

  summary() {
    const byInvariant: Record<string, number> = {};
    for (const i of INVARIANTS) byInvariant[i.id] = 0;
    for (const v of this.violations) byInvariant[v.invariant]++;
    return {
      ticks: this.ticks,
      violations: this.violations.length,
      byInvariant,
      coverage: Object.fromEntries(this.coverage),
      firstViolations: this.violations.slice(0, 10),
    };
  }
}
