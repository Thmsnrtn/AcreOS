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
 * the combination of the two core verticals (land_flipper +
 * note_investor), not a distinct audience; a chip for it would
 * double-count the same two promises. See LANDING_EXCLUDED_IDS.
 *
 * Conservatism escape hatch: the landing may still be MORE conservative
 * than the registry, but only via DEMOTE_ON_LANDING — an explicit
 * per-vertical demotion carrying a required written reason. The map is
 * currently EMPTY: the previous hardcoded conservatism (Subdivider
 * rendered as roadmap despite its "beta" registry maturity, per the
 * Rafe Castellan verification report 2026-06-01) is superseded by this
 * wave's registry truth pass — the registry's maturity declarations are
 * the audited truth, so the landing mirrors them until a NEW documented
 * reason to demote exists. Demotions only ever move a vertical DOWN
 * (core→beta/roadmap, beta→roadmap); a promote or no-op entry throws at
 * module load so a stale entry can't linger silently.
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
 * already appear as core chips, so a third chip would double-count the
 * same promise rather than name a distinct audience.
 */
export const LANDING_EXCLUDED_IDS: readonly BusinessTypeId[] = ["hybrid"];

/**
 * Explicit per-vertical demotion — the ONLY sanctioned way for the
 * landing to be more conservative than the registry. Every entry must
 * carry a non-empty written reason (enforced at runtime in
 * deriveLandingTiers, which runs at module load) and must actually move
 * the vertical DOWN a tier.
 *
 * CURRENTLY EMPTY — the 2026-07 registry truth pass (wave V1, founder
 * ruling #11) superseded the old hardcoded demotion of subdivider
 * (beta in the registry, shown as roadmap on the landing). Add an entry
 * only with a documented, dated reason.
 */
export const DEMOTE_ON_LANDING: Partial<
  Record<BusinessTypeId, LandingDemotion>
> = {};

export interface LandingDemotion {
  /** Target tier — demotion only, so "core" is not a valid target. */
  to: Exclude<VerticalMaturity, "core">;
  /** Required, non-empty. Why the landing under-promises the registry. */
  reason: string;
}

const TIER_RANK: Record<VerticalMaturity, number> = {
  core: 0,
  beta: 1,
  roadmap: 2,
};

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
  const tiers: LandingVerticalTiers = { core: [], beta: [], roadmap: [] };
  for (const meta of Object.values(registry)) {
    if (LANDING_EXCLUDED_IDS.includes(meta.id)) continue;
    let tier: VerticalMaturity = meta.maturity;
    const demotion = demotions[meta.id];
    if (demotion) {
      if (!demotion.reason || demotion.reason.trim().length === 0) {
        throw new Error(
          `DEMOTE_ON_LANDING["${meta.id}"] requires a non-empty reason — ` +
            `landing conservatism must be documented, not silent.`,
        );
      }
      if (TIER_RANK[demotion.to] <= TIER_RANK[meta.maturity]) {
        throw new Error(
          `DEMOTE_ON_LANDING["${meta.id}"] targets "${demotion.to}" but the ` +
            `registry already declares "${meta.maturity}" — demotions must move ` +
            `a vertical DOWN. Remove the stale entry.`,
        );
      }
      tier = demotion.to;
    }
    tiers[tier].push({ id: meta.id, label: meta.label });
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
