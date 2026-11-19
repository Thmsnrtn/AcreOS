/**
 * What STRANGERS are told about a vertical — the one conservatism channel.
 *
 * ── THE DECISION THIS IMPLEMENTS ────────────────────────────────────────────
 * FD1 (launch scope & registry, 2026-11-12; recorded in
 * docs/company/founder-decisions-2026-11-12-launch-scope.md): the public
 * promise is 4 core + 1 beta (FD1 as lifted 2026-11-18 and 2026-11-19), and the other ten types are `registry_only` —
 * registered, built, kept for existing books, but not sold.
 *
 * Under OD-5 (2026-08-17) the registry said `core` for all fifteen and THIS
 * file carried an eleven-row demotion table that lowered the public claim to
 * `beta` for every vertical that could not show a recorded decision. FD1 moves
 * that conservatism INTO the registry: `shared/business-types.ts` now states
 * the launch presentation itself, so the public tier derives from the registry
 * entry and the demotion table is EMPTY — and pinned empty
 * (tests/unit/fd1LaunchScope.test.ts, verticalReadiness.test.ts).
 *
 * ── WHY THIS LIVES IN shared/ ───────────────────────────────────────────────
 * It used to be `DEMOTE_ON_LANDING` inside
 * `client/src/pages/landing/Positioning.tsx`, reachable only by the landing
 * page. A second public surface — `GET /api/trust/verticals`, unauthenticated —
 * published raw `maturity` and respected no demotion at all, so a demotion
 * approved for the landing would not have reached it. Two public surfaces
 * making different claims about the same thing is the drift this file exists to
 * make impossible: there is ONE projection, in shared/, and
 * `verticalReadiness.test.ts` fails if any public claim outruns the evidence
 * (outside the founder-decided set it names).
 *
 * (That endpoint was retired in the same change — it had zero callers, and its
 * own docstring claimed the landing used it, which the landing never did.)
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────
 * `publicMaturityOf` = the registry entry's public tier (`registryPublicTier`:
 * `registry_only` → the landing's "not sold" tier), lowered by an explicit
 * demotion if one exists, then capped by the Evidence Ladder (a vertical with
 * no E1 entry is never `core` publicly).
 *
 * A demotion entry may only ever move a vertical DOWN, and must carry a
 * written reason and the date it was decided. `assertDemotionsValid` throws at
 * module load on a promote, a no-op, or an empty reason, so a misconfiguration
 * fails the build rather than the visitor. The channel is kept, empty, so a
 * future founder decision can under-promise the registry without rebuilding
 * the mechanism — but FD1 needs no entry, and adding one is a founder decision.
 */

import {
  BUSINESS_TYPES,
  registryPublicTier,
  type BusinessTypeId,
  type BusinessTypeMeta,
  type PublicMaturity,
} from "../business-types";
import { CAPABILITIES, evidenceLevelOf, evidenceRankOf, type Capability } from "../governance/evidenceLadder";

export interface PublicClaimDemotion {
  /** Target tier. `core` is absent because this channel only ever demotes. */
  to: Exclude<PublicMaturity, "core">;
  /** Required, non-empty. Why the public claim under-promises the registry. */
  reason: string;
  /** ISO date the founder decided it. */
  decidedOn: string;
}

/**
 * EMPTY since FD1 (2026-11-12), and pinned empty.
 *
 * The eleven OD-5 rows (note_investor, hybrid, residential_wholesaler,
 * short_term_rental, commercial, creative_finance, developer, tax_lien_deed,
 * multifamily, mobile_home, agent_investor → `beta`) were the public layer
 * under-promising a registry that said `core` fifteen times. The registry now
 * says what the founder decided, per type, so there is nothing left for this
 * table to correct. A non-empty table from here on means the registry and the
 * founder's public promise have drifted apart again — fix the registry.
 */
export const PUBLIC_CLAIM_DEMOTIONS: Partial<
  Record<BusinessTypeId, PublicClaimDemotion>
> = {};

const TIER_RANK: Record<PublicMaturity, number> = {
  core: 0,
  beta: 1,
  roadmap: 2,
};

/**
 * The tier a PUBLIC surface may claim for a vertical.
 *
 * Every public surface must render this, never `meta.maturity` directly.
 * Derivation, in order: registry entry → public tier (`registry_only` is told
 * as "not sold", the roadmap tier) → explicit demotion, if any → Evidence
 * Ladder cap.
 */
export function publicMaturityOf(
  meta: BusinessTypeMeta,
  demotions: Partial<Record<BusinessTypeId, PublicClaimDemotion>> = PUBLIC_CLAIM_DEMOTIONS,
  ladder: readonly Capability[] = CAPABILITIES,
): PublicMaturity {
  const claimed = demotions[meta.id]?.to ?? registryPublicTier(meta.maturity);
  // The Evidence Ladder (shared/governance/evidenceLadder.ts) binds every
  // public claim: a vertical may be called `core` to a stranger only when its
  // ladder entry is at least E1. A vertical with no evidence on the ladder is
  // never `core` publicly, whatever the registry or a demotion says.
  if (claimed === "core" && evidenceRankOf(evidenceLevelOf(`vertical.${meta.id}`, ladder)) < evidenceRankOf("E1")) return "beta";
  return claimed;
}

/**
 * Throw on a malformed entry. Called at module load by every consumer, so a
 * bad entry fails the build rather than reaching a visitor.
 */
export function assertDemotionsValid(
  demotions: Partial<Record<BusinessTypeId, PublicClaimDemotion>> = PUBLIC_CLAIM_DEMOTIONS,
  registry: Record<BusinessTypeId, BusinessTypeMeta> = BUSINESS_TYPES,
): void {
  for (const [id, demotion] of Object.entries(demotions) as [
    BusinessTypeId,
    PublicClaimDemotion,
  ][]) {
    if (!demotion.reason || demotion.reason.trim().length === 0) {
      throw new Error(
        `PUBLIC_CLAIM_DEMOTIONS["${id}"] requires a non-empty reason — ` +
          `public conservatism must be documented, not silent.`,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(demotion.decidedOn)) {
      throw new Error(
        `PUBLIC_CLAIM_DEMOTIONS["${id}"].decidedOn must be an ISO date (YYYY-MM-DD).`,
      );
    }
    const declared = registry[id]?.maturity;
    if (declared === undefined) {
      throw new Error(
        `PUBLIC_CLAIM_DEMOTIONS["${id}"] names a vertical that is not in the registry.`,
      );
    }
    // Direction is judged on the PUBLIC tier the registry already projects: a
    // registry_only vertical is already told as "not sold", so "demoting" it to
    // roadmap is a no-op and to beta is a promote — both refused.
    if (TIER_RANK[demotion.to] <= TIER_RANK[registryPublicTier(declared)]) {
      throw new Error(
        `PUBLIC_CLAIM_DEMOTIONS["${id}"] targets "${demotion.to}" but the ` +
          `registry already declares "${declared}" — demotions must move a ` +
          `vertical DOWN. Remove the stale entry.`,
      );
    }
  }
}
