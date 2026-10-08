/**
 * The Evidence Ladder's rule, as a pure check over a registry and the files it
 * points at (shared/governance/evidenceLadder.ts). Used by
 * tests/unit/evidenceLadder.test.ts on the real registry and on canaries.
 */
import { rankOf, type Capability, type EvidenceLevel } from "../../../shared/governance/evidenceLadder";

/** The run kinds a proving record may have, and the level each can prove (the ladder's header states the same rule). */
export const RUN_KIND_LEVEL: Record<string, EvidenceLevel> = {
  "deterministic-sim": "E2",
  "real-model-sim": "E3",
  shadow: "E4",
  pilot: "E5",
  production: "E6",
};

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
    if (rankOf(c.level) < 0) { errors.push(`${c.id}: unknown level ${c.level}`); continue; }
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
      let best: EvidenceLevel | null = null;
      for (const x of proving) {
        if (!x.rec || !x.rec.proves?.includes(c.id) || !(x.rec.kind in RUN_KIND_LEVEL)) continue;
        const lv = RUN_KIND_LEVEL[x.rec.kind];
        if (best == null || rankOf(lv) > rankOf(best)) best = lv;
      }
      if (best == null || rankOf(best) < r) errors.push(`${c.id}: claims ${c.level} but its strongest proving run reaches ${best ?? "nothing"}`);
    }
  }
  return errors;
}
