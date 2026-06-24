/**
 * DOMAIN PACK (land) — the AcreOS land-acquisition causal structure.
 *
 * Priors only (low confidence) — they sharpen from the causal ledger over time
 * (B2). This file is a PACK: it may import kernel types/machinery freely, but
 * the kernel may NOT import it (enforced by scripts/check-kernel-boundary.mjs).
 * All land vocabulary (county guide, parcel checks, signups → MRR) lives here,
 * never in the kernel.
 */

import type { CausalModel, EdgeEvidence } from "../../worldModel";

export const ACREOS_SEED_MODEL: CausalModel = {
  version: 1,
  variables: [
    { id: "publish_guide", label: "Publish a county guide", kind: "lever" },
    { id: "ramp_budget", label: "Lift growth budget", kind: "lever" },
    { id: "witnessed_outbound", label: "Witnessed outbound touch", kind: "lever" },
    { id: "indexed_pages", label: "Indexed SEO pages", kind: "metric" },
    { id: "search_impressions", label: "Search impressions", kind: "metric" },
    { id: "parcel_checks", label: "Free parcel checks run", kind: "metric" },
    { id: "signups", label: "Signups", kind: "metric" },
    { id: "mrr", label: "MRR", kind: "outcome" },
  ],
  edges: [
    { from: "publish_guide", to: "indexed_pages", effect: 0.8, confidence: 0.4, evidence: "prior: a published guide adds indexable surface" },
    { from: "indexed_pages", to: "search_impressions", effect: 0.5, confidence: 0.3, evidence: "prior: impressions lag indexing 4-9mo" },
    { from: "search_impressions", to: "parcel_checks", effect: 0.3, confidence: 0.3, evidence: "prior: a fraction of impressions click through to the tool" },
    { from: "witnessed_outbound", to: "parcel_checks", effect: 0.2, confidence: 0.25, evidence: "prior: helpful outbound drives a few checks" },
    { from: "parcel_checks", to: "signups", effect: 0.15, confidence: 0.3, evidence: "prior: a fraction of checkers sign up (lower bound via attribution)" },
    { from: "signups", to: "mrr", effect: 1.0, confidence: 0.7, evidence: "prior: signups → trials → paid at the tier blend" },
    { from: "ramp_budget", to: "search_impressions", effect: 0.2, confidence: 0.2, evidence: "prior: paid amplification, only once funnel proven" },
  ],
};

/**
 * Which world-model lever each decide.ts move-kind pulls, so the brain can query
 * a move's PREDICTED effect (the planning oracle). Unmapped moves → null in
 * predictMoveEffect: honest "no causal model for this move yet", never faked.
 */
export const LAND_MOVE_TO_LEVER: Record<string, string> = {
  grow_owned_channels: "publish_guide",
};

/**
 * Aggregate witnessed-move outcomes into per-LEVER evidence for refineModel().
 * Each episode is a move with a settled vote; we route it to the lever it pulls
 * (LAND_MOVE_TO_LEVER) and tally success/failure. Pending/unmapped moves are
 * ignored (honest — no signal yet). Pure: the caller fetches the episodes.
 */
export function landEvidenceByLever(
  episodes: Array<{ moveKind: string; vote: string }>,
): Record<string, EdgeEvidence> {
  const out: Record<string, EdgeEvidence> = {};
  for (const ep of episodes) {
    const lever = LAND_MOVE_TO_LEVER[ep.moveKind];
    if (!lever) continue;
    if (ep.vote !== "success" && ep.vote !== "failure") continue; // ignore "pending"
    const e = out[lever] ?? { successes: 0, failures: 0 };
    if (ep.vote === "success") e.successes += 1;
    else e.failures += 1;
    out[lever] = e;
  }
  return out;
}
