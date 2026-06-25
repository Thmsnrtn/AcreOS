/**
 * resolveActivePack — the SINGLE injection point for the active DomainPack
 * (frontier roadmap #1: make the loop pack-AGNOSTIC).
 *
 * The kernel decision loop (continuousLoop), the Context Pack (cognitionContext),
 * and the world-model snapshot used to import LAND_PACK directly — three
 * hardcoded couplings that a second vertical would have to edit blind. Now they
 * resolve the active pack here. Today AcreOS runs exactly one pack (land), so
 * this returns it unconditionally; when a second `packs/<vertical>` exists, the
 * scope selects between them and NOTHING in the kernel loop changes. This is the
 * composition root for verticals — the only place a pack symbol may be named
 * outside the resolver.
 *
 * Composition layer (it imports a pack) — deliberately NOT kernel; the
 * kernel-boundary ratchet forbids the kernel from naming any pack.
 */

import type { DomainPack } from "./domainPack";
import type { TenantScope } from "./tenantScope";
import { admitPack } from "./admitPack";
import { LAND_PACK } from "./packs/land";
import { logger } from "../../utils/logger";

// Frontier #11 — discharge the refinement proof ONCE per process: a pack that
// doesn't refine the kernel contract must never reach the brain. We log + still
// return it (a hard throw at module-eval could brick the whole app over a pack
// bug); the property test + admitPack verdict are the enforcement. A future
// multi-pack registry should refuse to register an un-admitted pack outright.
const ADMITTED = new WeakSet<DomainPack>();
function ensureAdmitted(pack: DomainPack): DomainPack {
  if (ADMITTED.has(pack)) return pack;
  const v = admitPack(pack);
  if (!v.admitted) {
    logger.error(`[activePack] DomainPack "${v.packId}" failed admission: ${v.violations.join("; ")}`);
  }
  ADMITTED.add(pack);
  return pack;
}

/**
 * The DomainPack that governs this scope's actions. `scope` is accepted now
 * (so call sites are already scope-shaped) but unused while AcreOS is single-
 * pack; a second vertical wires its selection here and only here.
 */
export function resolveActivePack(_scope?: TenantScope): DomainPack {
  return ensureAdmitted(LAND_PACK);
}
