/**
 * DOMAIN PACK (land) — the land-content RegulatoryProfile for the kernel claims
 * engine (Foundry move #6). All land-specific prohibited-claim patterns live
 * here; the kernel `screenClaims` engine is domain-agnostic and inherits this.
 *
 * Bans, by construction:
 *   1. DETERMINATIONS — physical/legal claims the system can't lawfully assert
 *      (buildability, perc/septic, wetlands/flood, title/lien, legal access).
 *      Allowed only ATTRIBUTED + hedged ("County GIS lists … as of 2024").
 *   2. INVESTMENT/RETURN language — guarantees, ROI claims, "will appreciate".
 *   3. FAIR-HOUSING steering — protected-class / "great for families" framing.
 *   4. MISSING DISCLOSURE — a not-advice footer must be present.
 */

import type { ClaimPattern, RegulatoryProfile } from "../../claimsEngine";

/** A bare determination is banned; the same fact ATTRIBUTED + hedged is allowed. */
const ATTRIBUTION_CUES = [
  "according to",
  "per the",
  "per county",
  "county gis",
  "county records",
  "as listed",
  "the listing",
  "as of",
  "reportedly",
  "the seller states",
  "the seller says",
  "may ",
  "appears to",
  "is listed as",
];

const DETERMINATION_PATTERNS: ClaimPattern[] = [
  { code: "buildability", re: /\b(buildable|build[- ]ready|ready to build|shovel[- ]ready)\b/i, label: "a buildability determination" },
  { code: "perc_septic", re: /\b(perc(ed|s|olation)?\b.*\b(pass|approv)|perc test (pass|approv)|septic approv|septic[- ]ready|will perc)\b/i, label: "a perc/septic determination" },
  { code: "wetlands", re: /\b(no wetlands|wetland[- ]free|free of wetlands)\b/i, label: "a wetlands determination" },
  { code: "flood", re: /\b(flood[- ]free|no flood risk|not in a flood zone|outside the flood)\b/i, label: "a flood determination" },
  { code: "title_lien", re: /\b(clear title|free and clear|no liens|lien[- ]free|marketable title|clean title)\b/i, label: "a title/lien determination" },
  { code: "access", re: /\b(legal access guaranteed|guaranteed access|paved access|deeded access guaranteed)\b/i, label: "a legal-access determination" },
  { code: "utilities", re: /\b(utilities (are )?(at|on) the (lot|property|road)|power at the (lot|road)|city water and sewer at)\b/i, label: "a utilities-present determination" },
];

const INVESTMENT_PATTERNS: ClaimPattern[] = [
  { code: "guaranteed_return", re: /\b(guaranteed (return|profit|appreciation|roi)|risk[- ]free|can'?t lose|no risk)\b/i, label: "a guaranteed-return claim" },
  { code: "return_figure", re: /\b(\d+\s?%|\d+x)\s+(return|roi|profit|gain|appreciation)\b/i, label: "a return-figure claim" },
  { code: "appreciation", re: /\b(will (appreciate|double|triple)|double your money|triple your money|get rich)\b/i, label: "an appreciation/get-rich claim" },
  { code: "advice", re: /\b(you should (buy|invest)|a smart investment|best investment|invest now)\b/i, label: "investment advice" },
];

const FAIR_HOUSING_PATTERNS: ClaimPattern[] = [
  { code: "family_steering", re: /\b(great for families|perfect for families|family[- ]friendly|ideal for families|good for kids|no children|adults only|empty nesters)\b/i, label: "family-status steering" },
  { code: "safety_steering", re: /\b(safe neighborhood|safe area|good neighborhood|nice neighborhood|good schools|desirable area)\b/i, label: "neighborhood/safety steering" },
  { code: "protected_class", re: /\b(christian|church[- ]going|no section 8|english[- ]speaking|exclusive community)\b/i, label: "protected-class language" },
];

const DISCLOSURE_CUES = [
  "not legal",
  "not investment advice",
  "not financial advice",
  "informational purposes",
  "verify independently",
  "do your own due diligence",
  "consult a",
];

export const LAND_REGULATORY_PROFILE: RegulatoryProfile = {
  attributionCues: ATTRIBUTION_CUES,
  determinationPatterns: DETERMINATION_PATTERNS,
  // Investment + fair-housing are both "never allowed" → the engine's banned set.
  bannedPatterns: [...INVESTMENT_PATTERNS, ...FAIR_HOUSING_PATTERNS],
  disclosureCues: DISCLOSURE_CUES,
};
