/**
 * admitPack — the DomainPack REFINEMENT PROOF (Frontier #11). KERNEL.
 *
 * The kernel/pack seam (Foundry move #1) is only as trustworthy as the gate that
 * decides a pack may plug in. A malformed pack — a causal model with no outcome
 * variable, a move pointing at a lever that doesn't exist, a cyclic graph — would
 * silently degrade the brain (predictMoveEffect returns garbage, the EV tiebreak
 * mis-ranks). admitPack is the proof obligation a pack must discharge BEFORE the
 * kernel will run on it: it checks, by construction, that the pack REFINES the
 * kernel contract. A pack is admitted iff every invariant holds; otherwise the
 * violations are returned (fail-closed — an unproven pack is never admitted).
 *
 * Pure + total (no DB, no clock). The companion property test
 * (tests/unit/packInvariance.test.ts) proves the kernel is invariant under ANY
 * admitted pack — random conforming packs never break the kernel; malformed ones
 * are always rejected here. Together they make the seam machine-checkable, which
 * is what earns the right to platformize on a second vertical.
 */

import type { DomainPack } from "./domainPack";
import type { CausalModel } from "./worldModel";

export interface AdmissionVerdict {
  packId: string;
  admitted: boolean;
  /** Each unmet invariant, human-readable. Empty iff admitted. */
  violations: string[];
}

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Pure Kahn acyclicity check — true iff the causal graph has no cycle. */
function isAcyclic(model: CausalModel): boolean {
  const indeg = new Map<string, number>();
  for (const v of model.variables) indeg.set(v.id, 0);
  for (const e of model.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const e of model.edges) {
      if (e.from !== id) continue;
      const d = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, d);
      if (d === 0) queue.push(e.to);
    }
  }
  return visited === indeg.size;
}

/**
 * Validate that a DomainPack refines the kernel contract. Returns the verdict;
 * `admitted` is true iff `violations` is empty. Total — never throws, whatever
 * the input shape (a pack from an untrusted source is exactly the threat model).
 */
export function admitPack(pack: DomainPack): AdmissionVerdict {
  const violations: string[] = [];
  const packId = typeof pack?.id === "string" ? pack.id : "<invalid>";

  // ── Identity ──
  if (!pack || typeof pack !== "object") {
    return { packId: "<invalid>", admitted: false, violations: ["pack is not an object"] };
  }
  if (typeof pack.id !== "string" || !KEBAB.test(pack.id)) {
    violations.push("id must be lowercase kebab-case (e.g. \"land\")");
  }
  if (typeof pack.label !== "string" || pack.label.trim() === "") {
    violations.push("label must be a non-empty string");
  }

  // ── Causal model — the brain's substrate ──
  const model = pack.causalModel;
  if (!model || !Array.isArray(model.variables) || !Array.isArray(model.edges)) {
    violations.push("causalModel must have variables[] and edges[]");
  } else {
    const ids = new Set(model.variables.map((v) => v.id));
    if (ids.size !== model.variables.length) violations.push("causalModel has duplicate variable ids");
    if (!model.variables.some((v) => v.kind === "outcome")) {
      violations.push("causalModel must declare at least one 'outcome' variable (the brain ranks EV on it)");
    }
    if (!model.variables.some((v) => v.kind === "lever")) {
      violations.push("causalModel must declare at least one 'lever' variable (a pack with no lever can drive nothing)");
    }
    for (const e of model.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) {
        violations.push(`causalModel edge ${e.from}→${e.to} references an unknown variable`);
      }
      if (!Number.isFinite(e.effect)) violations.push(`causalModel edge ${e.from}→${e.to} has a non-finite effect`);
      if (!(e.confidence >= 0 && e.confidence <= 1)) {
        violations.push(`causalModel edge ${e.from}→${e.to} confidence must be in [0,1]`);
      }
    }
    if (!isAcyclic(model)) violations.push("causalModel must be acyclic (a cycle breaks intervention prediction)");

    // ── moveToLever — honest-absence is allowed, but a present mapping must be valid ──
    if (!pack.moveToLever || typeof pack.moveToLever !== "object") {
      violations.push("moveToLever must be an object (may be empty — honest absence)");
    } else {
      const levers = new Set(model.variables.filter((v) => v.kind === "lever").map((v) => v.id));
      for (const [move, lever] of Object.entries(pack.moveToLever)) {
        if (typeof lever !== "string" || !levers.has(lever)) {
          violations.push(`moveToLever["${move}"] → "${lever}" is not a declared lever variable`);
        }
      }
    }
  }

  // ── Regulatory profile (optional) — if present, it must be well-formed ──
  if (pack.regulatoryProfile !== undefined) {
    // Validate an UNTRUSTED runtime shape — go through `unknown` (the typed
    // RegulatoryProfile doesn't structurally overlap Record<string,unknown>).
    const rp = pack.regulatoryProfile as unknown as Record<string, unknown>;
    for (const key of ["attributionCues", "determinationPatterns", "bannedPatterns", "disclosureCues"] as const) {
      if (!Array.isArray(rp[key])) {
        violations.push(`regulatoryProfile.${key} must be an array`);
      }
    }
  }

  return { packId, admitted: violations.length === 0, violations };
}

/** Convenience: admit or THROW (for a startup assertion where a bad pack must halt boot). */
export function assertPackAdmitted(pack: DomainPack): void {
  const v = admitPack(pack);
  if (!v.admitted) {
    throw new Error(`DomainPack "${v.packId}" failed admission: ${v.violations.join("; ")}`);
  }
}
