/**
 * The Evidence Ladder's rule, as a pure check over a registry and the files it
 * points at (shared/governance/evidenceLadder.ts). Used by
 * tests/unit/evidenceLadder.test.ts on the real registry and on canaries.
 */
import { EVIDENCE_LEVELS, RUN_KIND_LEVEL, rankOf, type Capability } from "../../../shared/governance/evidenceLadder";

export interface RunRecord {
  id: string;
  kind: string;
  at: string;
  /** Capability ids this run proves. */
  proves: string[];
  /** Where the full results live (scorecard.json path or run directory). */
  scorecard?: string;
  summary?: Record<string, unknown>;
}

export function checkLadder(registry: readonly Capability[], io: { exists: (p: string) => boolean; readRun: (p: string) => RunRecord | null }): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const c of registry) {
    if (seen.has(c.id)) errors.push(`${c.id}: duplicate id`);
    seen.add(c.id);
    if (!(EVIDENCE_LEVELS as readonly string[]).includes(c.level)) { errors.push(`${c.id}: unknown level ${c.level}`); continue; }
    const r = rankOf(c.level);
    if (r >= rankOf("E1")) {
      if (!c.proof.unit?.length) errors.push(`${c.id}: claims ${c.level} with no unit-test pointer`);
      for (const u of c.proof.unit ?? []) if (!io.exists(u)) errors.push(`${c.id}: unit pointer ${u} does not exist`);
    }
    if (r >= rankOf("E2")) {
      const runs = c.proof.runs ?? [];
      if (!runs.length) errors.push(`${c.id}: claims ${c.level} with no pointer to a proving run`);
      const proving = runs.map((p) => ({ p, rec: io.exists(p) ? io.readRun(p) : null }));
      for (const { p, rec } of proving) {
        if (!rec) errors.push(`${c.id}: run pointer ${p} does not resolve to a run record`);
        else if (!rec.proves?.includes(c.id)) errors.push(`${c.id}: run ${p} does not list it in "proves"`);
        else if (!(rec.kind in RUN_KIND_LEVEL)) errors.push(`${c.id}: run ${p} has unknown kind ${rec.kind}`);
      }
      const best = Math.max(-1, ...proving.filter((x) => x.rec && x.rec.proves?.includes(c.id) && x.rec.kind in RUN_KIND_LEVEL).map((x) => rankOf(RUN_KIND_LEVEL[x.rec!.kind])));
      if (best < r) errors.push(`${c.id}: claims ${c.level} but its strongest proving run reaches ${best < 0 ? "nothing" : EVIDENCE_LEVELS[best]}`);
    }
  }
  return errors;
}
