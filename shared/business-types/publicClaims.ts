/**
 * What STRANGERS are told about a vertical — the one conservatism channel.
 *
 * ── THE DECISION THIS IMPLEMENTS ────────────────────────────────────────────
 * OD-5, decided 2026-08-17: demote the PUBLIC CLAIM, not the registry.
 *
 * `verticalReadiness.test.ts` measured that 13 of 15 verticals declare
 * `maturity: "core"` on evidence that reaches only `surfaced` — they have
 * somewhere to stand (4-7 spotlight modules, 2-5 workflow templates, every
 * declared template id real) and nothing that closes the canonical loop. Only
 * `fix_and_flip` and `subdivider` record a decision snapshot.
 *
 * The registry keeps saying `core`, deliberately. `core` is a fair description
 * of what a paying customer actually gets in-app, and demoting the registry
 * would demote the PRODUCT to fix a CLAIM. What changes is what someone is told
 * before they can see for themselves.
 *
 * ── WHY THIS LIVES IN shared/ ───────────────────────────────────────────────
 * It used to be `DEMOTE_ON_LANDING` inside
 * `client/src/pages/landing/Positioning.tsx`, reachable only by the landing
 * page. A second public surface — `GET /api/trust/verticals`, unauthenticated —
 * published raw `maturity` and respected no demotion at all, so a demotion
 * approved for the landing would not have reached it. Two public surfaces
 * making different claims about the same thing is the drift this file exists to
 * make impossible: there is now ONE map, in shared/, and
 * `verticalReadiness.test.ts` fails if any public claim outruns the evidence.
 *
 * (That endpoint was retired in the same change — it had zero callers, and its
 * own docstring claimed the landing used it, which the landing never did.)
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────
 * An entry may only ever move a vertical DOWN, and must carry a written reason
 * and the date it was decided. `assertDemotionsValid` throws at module load on
 * a promote, a no-op, or an empty reason, so a misconfiguration fails the build
 * rather than the visitor.
 */

import {
  BUSINESS_TYPES,
  type BusinessTypeId,
  type BusinessTypeMeta,
  type VerticalMaturity,
} from "../business-types";

export interface PublicClaimDemotion {
  /** Target tier. `core` is absent because this channel only ever demotes. */
  to: Exclude<VerticalMaturity, "core">;
  /** Required, non-empty. Why the public claim under-promises the registry. */
  reason: string;
  /** ISO date the founder decided it. */
  decidedOn: string;
}

const OD5 =
  "OD-5 (2026-08-17): evidences `surfaced`, not `decided` — real spotlight " +
  "modules and real workflow templates, but no production surface records a " +
  "decision snapshot, so nothing here can be graded or calibrated. The " +
  "registry keeps `core` because that describes the in-app experience; this " +
  "is what a stranger is told before they can check. Remove this entry when " +
  "the vertical closes the canonical loop — not when the copy feels stale.";

/**
 * The thirteen verticals whose public claim is lowered to `beta`.
 *
 * `beta` is not a hedge chosen by feel: `MATURITY_REQUIRES` in `readiness.ts`
 * says `beta` demands evidenced `surfaced`, and all thirteen evidence exactly
 * `surfaced`. So the public claim now equals the evidence — no gap left to
 * count, which is why the public-claim assertion in `verticalReadiness.test.ts`
 * is a hard zero rather than a ratchet.
 *
 * Absent, deliberately: `fix_and_flip` and `subdivider`. Both record decision
 * snapshots in production, so both carry `core` honestly.
 */
export const PUBLIC_CLAIM_DEMOTIONS: Partial<
  Record<BusinessTypeId, PublicClaimDemotion>
> = {
  land_flipper: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  note_investor: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  hybrid: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  residential_wholesaler: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  buy_and_hold: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  short_term_rental: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  commercial: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  creative_finance: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  developer: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  tax_lien_deed: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  multifamily: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  mobile_home: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
  agent_investor: { to: "beta", reason: OD5, decidedOn: "2026-08-17" },
};

const TIER_RANK: Record<VerticalMaturity, number> = {
  core: 0,
  beta: 1,
  roadmap: 2,
};

/**
 * The tier a PUBLIC surface may claim for a vertical.
 *
 * Every public surface must render this, never `meta.maturity` directly.
 */
export function publicMaturityOf(
  meta: BusinessTypeMeta,
  demotions: Partial<Record<BusinessTypeId, PublicClaimDemotion>> = PUBLIC_CLAIM_DEMOTIONS,
): VerticalMaturity {
  return demotions[meta.id]?.to ?? meta.maturity;
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
    if (TIER_RANK[demotion.to] <= TIER_RANK[declared]) {
      throw new Error(
        `PUBLIC_CLAIM_DEMOTIONS["${id}"] targets "${demotion.to}" but the ` +
          `registry already declares "${declared}" — demotions must move a ` +
          `vertical DOWN. Remove the stale entry.`,
      );
    }
  }
}
