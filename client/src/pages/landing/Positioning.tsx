/**
 * Positioning band — explicit, visible, between Hero and HowItWorks.
 *
 * Answers the first question every visitor has: "is this for me?"
 * Primary positioning (founder ruling #12(a), 2026-07-29): built for
 * property investors, with land named honestly as the deepest wedge.
 * Below the headline, EVERY vertical in the business-type registry
 * appears in one of three tiers, DERIVED at build time from shared/business-types.ts
 * (read-only import — the registry is the single source of truth; wave
 * V1 of founder ruling #11, 2026-07-29). When a maturity flips in the
 * registry, the landing follows automatically — no hardcoded lists to
 * drift.
 *
 *   CORE     — registry maturity "core". Solid chips, no qualifier.
 *   BETA     — registry maturity "beta". Chips carry a "Beta"
 *              micro-label so a first-time visitor isn't surprised by
 *              gaps.
 *   ROADMAP  — registry maturity "roadmap". Muted, non-CTA chips — the
 *              platform's whole ambition made visible, promised but
 *              not sold.
 *
 * Dedupe: `hybrid` (land + notes) never renders as its own chip — it is
 * the combination of land_flipper + note_investor, not a distinct
 * audience; a chip for it would double-count the same two promises. See
 * LANDING_EXCLUDED_IDS.
 *
 * Conservatism channel: the landing may be MORE conservative than the
 * registry, but only via the shared demotion map — an explicit
 * per-vertical demotion carrying a required written reason and the date
 * it was decided. Demotions only ever move a vertical DOWN
 * (core→beta/roadmap, beta→roadmap); a promote, a no-op, or an empty
 * reason throws at module load so a stale entry can't linger silently.
 *
 * THIRTEEN ENTRIES AS OF 2026-08-17 (OD-5), and the map's old docstring
 * is why. It said the map was empty because "the registry's maturity
 * declarations are the audited truth" — and `verticalReadiness.test.ts`
 * measured that they are not. All fifteen verticals declare `core`;
 * exactly two record a decision snapshot in production. Thirteen chips
 * therefore now render as Beta rather than solid core. The registry
 * still says `core`, deliberately: that describes the in-app experience
 * a paying customer gets, and this file governs what a stranger is told
 * before they can check. See shared/business-types/publicClaims.ts.
 *
 * Copy prose comes from LANDING_COPY.positioning and is deliberately
 * tier-generic — the chips carry the vertical names (each entry's
 * registry label verbatim), so a registry flip can't strand a stale
 * sentence in copy.ts.
 *
 * The derivation is a pure exported function (deriveLandingTiers) so
 * tests/unit/landingVerticalTiers.test.ts can pin the logic against the
 * live registry without React.
 */

import {
  BUSINESS_TYPES,
  type BusinessTypeId,
  type BusinessTypeMeta,
  type VerticalMaturity,
} from "@shared/business-types";
import {
  PUBLIC_CLAIM_DEMOTIONS,
  assertDemotionsValid,
  type PublicClaimDemotion,
} from "@shared/business-types/publicClaims";
import { LANDING_COPY } from "./copy";

export interface LandingVerticalChip {
  id: BusinessTypeId;
  label: string;
}

export interface LandingVerticalTiers {
  core: LandingVerticalChip[];
  beta: LandingVerticalChip[];
  roadmap: LandingVerticalChip[];
}

/**
 * Registry ids that never render as a landing chip. `hybrid` is
 * land_flipper + note_investor operated in one workspace — both halves
 * already appear as their own chips, so a third would double-count the
 * same promise rather than name a distinct audience. (It still carries a
 * PUBLIC_CLAIM_DEMOTIONS entry, because the claim is demoted wherever it
 * is published — the landing simply does not publish it.)
 */
export const LANDING_EXCLUDED_IDS: readonly BusinessTypeId[] = ["hybrid"];

/**
 * Explicit per-vertical demotion — the ONLY sanctioned way for a PUBLIC
 * surface to be more conservative than the registry.
 *
 * MOVED TO shared/ ON 2026-08-17 (OD-5). This was a local
 * `DEMOTE_ON_LANDING` map that only the landing page could reach, while
 * `GET /api/trust/verticals` published raw `maturity` and respected no
 * demotion at all — so a demotion approved for the landing would not have
 * reached the other public surface. One map now governs every public
 * claim; see shared/business-types/publicClaims.ts for the reasoning and
 * the thirteen entries.
 *
 * Re-exported under the old name so this module stays the landing's own
 * vocabulary, but it is an ALIAS, not a second map. Do not add entries
 * here.
 */
export const DEMOTE_ON_LANDING = PUBLIC_CLAIM_DEMOTIONS;
export type LandingDemotion = PublicClaimDemotion;

/**
 * Pure derivation of the three landing chip tiers from the business-type
 * registry. Exported for tests; parameters default to the live registry
 * and the live demotion map.
 *
 * Throws (at module load, via the TIERS constant below) on an invalid
 * demotion entry — empty reason, or a target that doesn't actually
 * demote — so misconfiguration fails the build, not the visitor.
 */
export function deriveLandingTiers(
  registry: Record<BusinessTypeId, BusinessTypeMeta> = BUSINESS_TYPES,
  demotions: Partial<Record<BusinessTypeId, LandingDemotion>> = DEMOTE_ON_LANDING,
): LandingVerticalTiers {
  // Validation moved to shared/business-types/publicClaims.ts. It used to be
  // inlined here — an empty-reason check and a must-move-DOWN check — and when
  // the map moved to shared/ so the trust endpoint could reach it too, keeping
  // a second copy of the rules would have been the duplicate architecture this
  // consolidation exists to remove. One map, one validator.
  assertDemotionsValid(demotions, registry);

  const tiers: LandingVerticalTiers = { core: [], beta: [], roadmap: [] };
  for (const meta of Object.values(registry)) {
    if (LANDING_EXCLUDED_IDS.includes(meta.id)) continue;
    tiers[demotions[meta.id]?.to ?? meta.maturity].push({
      id: meta.id,
      label: meta.label,
    });
  }
  return tiers;
}

// Derived once at module load so an invalid DEMOTE_ON_LANDING entry
// fails fast (build/test time), never in front of a visitor.
const TIERS: LandingVerticalTiers = deriveLandingTiers();

export function Positioning() {
  const c = LANDING_COPY.positioning;
  return (
    <section className="lp-positioning" aria-label="Who AcreOS is for">
      <div className="lp-positioning-inner">
        {/* h2 so the section participates in the document outline
            (h1 hero → h2 per section); visual style is unchanged —
            .lp-positioning-primary fully owns font/size/margin. */}
        <h2 className="lp-positioning-primary">{c.primary}</h2>
        <div className="lp-positioning-roadmap">{c.inProduct}</div>

        {/* Core tier — solid chips, no qualifier */}
        {TIERS.core.length > 0 && (
          <ul
            className="lp-positioning-roadmap-list"
            aria-label="Investor types with full workflow support"
          >
            {TIERS.core.map((v) => (
              <li
                key={v.id}
                className="lp-positioning-roadmap-chip lp-positioning-chip-core"
              >
                {v.label}
              </li>
            ))}
          </ul>
        )}

        {/* Beta tier — lighter chips with "Beta" micro-label */}
        {TIERS.beta.length > 0 && (
          <ul
            className="lp-positioning-roadmap-list lp-positioning-list-beta"
            aria-label="Investor types in beta"
          >
            {TIERS.beta.map((v) => (
              <li
                key={v.id}
                className="lp-positioning-roadmap-chip lp-positioning-chip-beta"
              >
                {v.label}
                <span className="lp-positioning-chip-badge" aria-label="Beta">
                  Beta
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Roadmap tier — muted, non-CTA chips: promised, not sold */}
        {TIERS.roadmap.length > 0 && (
          <>
            <div className="lp-positioning-roadmap lp-positioning-roadmap-footer">
              {c.roadmap}
            </div>
            <ul
              className="lp-positioning-roadmap-list lp-positioning-roadmap-list-muted"
              aria-label="Investor types on the roadmap"
            >
              {TIERS.roadmap.map((v) => (
                <li
                  key={v.id}
                  className="lp-positioning-roadmap-chip lp-positioning-roadmap-chip-muted"
                >
                  {v.label}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
