/**
 * DOMAIN PACK (land) — the AcreOS land-acquisition vertical, expressed through
 * the typed DomainPack seam. This is the FIRST and (today) ONLY pack; the kernel
 * runs it unchanged. A second, deliberately-foreign pack running on this same
 * unchanged kernel is the milestone that earns the right to platformize
 * (docs/internal/roadmap/foundry-decision-2026-06-24.md).
 */

import type { DomainPack } from "../../domainPack";
import { ACREOS_SEED_MODEL, LAND_MOVE_TO_LEVER } from "./causalModel";

export const LAND_PACK: DomainPack = {
  id: "land",
  label: "Land acquisition",
  causalModel: ACREOS_SEED_MODEL,
  moveToLever: LAND_MOVE_TO_LEVER,
};

export { ACREOS_SEED_MODEL, LAND_MOVE_TO_LEVER, landEvidenceByLever } from "./causalModel";
