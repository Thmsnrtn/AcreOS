/**
 * Founder Autopilot — OKR rollup (Elite Vision H3).
 *
 * The P5 objectives are a flat list. This derives the planning TREE over them —
 * company → per-domain → objective — and surfaces the BINDING CONSTRAINT: the
 * single objective whose lag most limits the company right now. That's what
 * turns "move these numbers" into "move THIS number first." Pure → testable; a
 * derived view, no schema change.
 */
import type { AutopilotObjective } from "@shared/schema";
import { computeProgress, type ObjectiveProgress } from "./objectives";

export interface OkrDomainNode {
  domain: string;
  objectives: ObjectiveProgress[];
  /** Average progress across the domain's objectives (0..1). */
  progress: number;
}

export interface OkrTree {
  /** Company-level progress = mean of the domain nodes (equal domain weight). */
  progress: number;
  domains: OkrDomainNode[];
  /** The objective whose lag most limits the company (lowest progress, unmet). */
  bindingConstraint: ObjectiveProgress | null;
}

function mean(ns: number[]): number {
  return ns.length === 0 ? 1 : ns.reduce((a, b) => a + b, 0) / ns.length;
}

/** Build the OKR tree from the active objectives. Pure. */
export function buildOkrTree(objectives: AutopilotObjective[]): OkrTree {
  const progresses = objectives.map((o) => ({ o, p: computeProgress(o) }));
  const byDomain = new Map<string, ObjectiveProgress[]>();
  for (const { o, p } of progresses) {
    const key = o.owningDomain ?? "company";
    const arr = byDomain.get(key) ?? [];
    arr.push(p);
    byDomain.set(key, arr);
  }
  const domains: OkrDomainNode[] = [...byDomain.entries()]
    .map(([domain, objs]) => ({ domain, objectives: objs, progress: mean(objs.map((p) => p.pct)) }))
    .sort((a, b) => a.progress - b.progress); // most-behind domain first

  // Binding constraint: the unmet objective with the lowest progress.
  const unmet = progresses.map((x) => x.p).filter((p) => !p.met).sort((a, b) => a.pct - b.pct);

  return {
    progress: mean(domains.map((d) => d.progress)),
    domains,
    bindingConstraint: unmet[0] ?? null,
  };
}

/** One-line OKR summary for the daily letter. Pure. */
export function okrLine(tree: OkrTree): string {
  if (tree.domains.length === 0) return "Objectives: none set.";
  const pct = Math.round(tree.progress * 100);
  const bind = tree.bindingConstraint;
  const bindTxt = bind ? ` Binding constraint: ${bind.label} (${Math.round(bind.pct * 100)}%).` : " All objectives met.";
  return `Objectives: ${pct}% to target across ${tree.domains.length} domain(s).${bindTxt}`;
}
