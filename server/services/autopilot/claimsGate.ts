/**
 * Founder Autopilot — the land-content claims/solicitation gate.
 *
 * Foundry move #6: this is now a THIN land wrapper over the domain-agnostic
 * kernel claims engine (./claimsEngine). All the land-specific prohibited-claim
 * patterns moved to the land RegulatoryProfile (./packs/land/regulatoryProfile);
 * a second vertical inherits the engine unchanged and supplies its own profile.
 * The public API here (screenLandClaims / summarizeClaimViolations / the types)
 * is preserved exactly so every existing caller + test is unchanged.
 *
 * What the gate bans (via LAND_REGULATORY_PROFILE):
 *   1. DETERMINATIONS — buildability, perc/septic, wetlands/flood, title/lien,
 *      legal access — allowed only ATTRIBUTED + hedged, never machine-asserted.
 *   2. INVESTMENT/RETURN language — guarantees, ROI claims, "will appreciate".
 *   3. FAIR-HOUSING steering — protected-class / "great for families" framing.
 *   4. MISSING DISCLOSURE — a required not-advice footer.
 */

import {
  screenClaims,
  summarizeClaimViolations as summarizeClaims,
  type ClaimSeverity,
  type ClaimViolation,
  type ClaimsGateResult,
  type ClaimsGateOptions,
} from "./claimsEngine";
import { LAND_REGULATORY_PROFILE } from "./packs/land/regulatoryProfile";

export type { ClaimSeverity, ClaimViolation, ClaimsGateResult, ClaimsGateOptions };

/**
 * Screen a land artifact's text. Pure + total. `ok` is false if ANY critical
 * violation is present. Determination terms are allowed only when attributed/
 * hedged nearby; investment + fair-housing terms are never allowed.
 */
export function screenLandClaims(text: string, opts: ClaimsGateOptions = {}): ClaimsGateResult {
  return screenClaims(text, LAND_REGULATORY_PROFILE, opts);
}

/** One-line summary for logs / the gate reason. */
export function summarizeClaimViolations(result: ClaimsGateResult): string {
  return summarizeClaims(result, "land-claims");
}
