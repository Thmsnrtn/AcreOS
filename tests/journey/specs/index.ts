/**
 * Journey-proof harness — the spec registry.
 *
 * The staging CLI (`scripts/run-journey-walk.ts`) resolves `--spec <id>`
 * here. A vertical joins the harness by adding its spec module and one
 * line in this map — no CLI change, no runner change.
 */
import { wholesaleWalk } from "./wholesale";
import { notesWalk } from "./notes";
import type { WalkSpec } from "../walk-spec";

export const walkSpecs: Record<string, WalkSpec> = {
  wholesale: wholesaleWalk,
  notes: notesWalk,
};

export function getWalkSpec(id: string): WalkSpec {
  const spec = walkSpecs[id];
  if (!spec) {
    throw new Error(`unknown walk spec ${JSON.stringify(id)} — available: ${Object.keys(walkSpecs).join(", ")}`);
  }
  return spec;
}
