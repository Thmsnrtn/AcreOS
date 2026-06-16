/**
 * Founder Autopilot — the land-content claims/solicitation gate.
 *
 * Auto-published land content carries real liability: a confidently-wrong
 * "buildable, paved access" is a lawsuit, not a slop-factory annoyance. This is
 * the deterministic gate every customer-facing / publicly-broadcast land artifact
 * must clear before it can go out. It bans, by construction:
 *
 *   1. DETERMINATIONS — physical/legal claims the system cannot lawfully assert
 *      (buildability, perc/septic, wetlands/flood, title/lien, legal access).
 *      Land facts may only appear ATTRIBUTED + hedged ("County GIS lists … as of
 *      2024"), never as a bare machine assertion.
 *   2. INVESTMENT/RETURN language — guarantees, ROI claims, "will appreciate".
 *   3. FAIR-HOUSING steering descriptors — protected-class / "great for families"
 *      / "safe neighborhood" framing.
 *   4. MISSING DISCLOSURE — a required not-advice footer must be present.
 *
 * Pure + deterministic → exhaustively testable. It is intentionally conservative
 * (false positives are cheap — the artifact gets reworded or held; false
 * negatives are a published liability). Hedged/attributed phrasings are allowed
 * so the agent can still convey real, sourced facts.
 */

export type ClaimSeverity = "critical";

export interface ClaimViolation {
  code: string;
  severity: ClaimSeverity;
  match: string;
  message: string;
}

export interface ClaimsGateResult {
  ok: boolean;
  violations: ClaimViolation[];
}

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

const DETERMINATION_PATTERNS: Array<{ code: string; re: RegExp; label: string }> = [
  { code: "buildability", re: /\b(buildable|build[- ]ready|ready to build|shovel[- ]ready)\b/i, label: "a buildability determination" },
  { code: "perc_septic", re: /\b(perc(ed|s|olation)?\b.*\b(pass|approv)|perc test (pass|approv)|septic approv|septic[- ]ready|will perc)\b/i, label: "a perc/septic determination" },
  { code: "wetlands", re: /\b(no wetlands|wetland[- ]free|free of wetlands)\b/i, label: "a wetlands determination" },
  { code: "flood", re: /\b(flood[- ]free|no flood risk|not in a flood zone|outside the flood)\b/i, label: "a flood determination" },
  { code: "title_lien", re: /\b(clear title|free and clear|no liens|lien[- ]free|marketable title|clean title)\b/i, label: "a title/lien determination" },
  { code: "access", re: /\b(legal access guaranteed|guaranteed access|paved access|deeded access guaranteed)\b/i, label: "a legal-access determination" },
  { code: "utilities", re: /\b(utilities (are )?(at|on) the (lot|property|road)|power at the (lot|road)|city water and sewer at)\b/i, label: "a utilities-present determination" },
];

const INVESTMENT_PATTERNS: Array<{ code: string; re: RegExp; label: string }> = [
  { code: "guaranteed_return", re: /\b(guaranteed (return|profit|appreciation|roi)|risk[- ]free|can'?t lose|no risk)\b/i, label: "a guaranteed-return claim" },
  { code: "return_figure", re: /\b(\d+\s?%|\d+x)\s+(return|roi|profit|gain|appreciation)\b/i, label: "a return-figure claim" },
  { code: "appreciation", re: /\b(will (appreciate|double|triple)|double your money|triple your money|get rich)\b/i, label: "an appreciation/get-rich claim" },
  { code: "advice", re: /\b(you should (buy|invest)|a smart investment|best investment|invest now)\b/i, label: "investment advice" },
];

const FAIR_HOUSING_PATTERNS: Array<{ code: string; re: RegExp; label: string }> = [
  { code: "family_steering", re: /\b(great for families|perfect for families|family[- ]friendly|ideal for families|good for kids|no children|adults only|empty nesters)\b/i, label: "family-status steering" },
  { code: "safety_steering", re: /\b(safe neighborhood|safe area|good neighborhood|nice neighborhood|good schools|desirable area)\b/i, label: "neighborhood/safety steering" },
  { code: "protected_class", re: /\b(christian|church[- ]going|no section 8|english[- ]speaking|exclusive community)\b/i, label: "protected-class language" },
];

const DEFAULT_DISCLOSURE_CUES = [
  "not legal",
  "not investment advice",
  "not financial advice",
  "informational purposes",
  "verify independently",
  "do your own due diligence",
  "consult a",
];

function hasNearbyAttribution(text: string, idx: number): boolean {
  const windowStart = Math.max(0, idx - 80);
  const ctx = text.slice(windowStart, idx + 80).toLowerCase();
  return ATTRIBUTION_CUES.some((cue) => ctx.includes(cue));
}

export interface ClaimsGateOptions {
  /** Require a not-advice disclosure footer (default true). */
  requireDisclosure?: boolean;
  /** Phrases any of which satisfy the disclosure requirement. */
  disclosureCues?: string[];
}

/**
 * Screen a land artifact's text. Pure + total. `ok` is false if ANY critical
 * violation is present. Determination terms are allowed only when attributed/
 * hedged nearby; investment + fair-housing terms are never allowed.
 */
export function screenLandClaims(text: string, opts: ClaimsGateOptions = {}): ClaimsGateResult {
  const violations: ClaimViolation[] = [];
  const body = text ?? "";

  const scanBanned = (patterns: typeof INVESTMENT_PATTERNS) => {
    for (const p of patterns) {
      const m = p.re.exec(body);
      if (m) {
        violations.push({ code: p.code, severity: "critical", match: m[0], message: `Contains ${p.label} ("${m[0].trim()}") — not allowed in auto-published content.` });
      }
    }
  };

  // Determinations: flagged unless attributed/hedged nearby.
  for (const p of DETERMINATION_PATTERNS) {
    const m = p.re.exec(body);
    if (m && m.index != null && !hasNearbyAttribution(body, m.index)) {
      violations.push({
        code: p.code,
        severity: "critical",
        match: m[0],
        message: `Asserts ${p.label} ("${m[0].trim()}") without attribution — land facts must be sourced + hedged, never machine-asserted.`,
      });
    }
  }

  scanBanned(INVESTMENT_PATTERNS);
  scanBanned(FAIR_HOUSING_PATTERNS);

  // Disclosure footer must be present.
  if (opts.requireDisclosure ?? true) {
    const cues = opts.disclosureCues ?? DEFAULT_DISCLOSURE_CUES;
    const lower = body.toLowerCase();
    if (!cues.some((c) => lower.includes(c))) {
      violations.push({
        code: "missing_disclosure",
        severity: "critical",
        match: "",
        message: "Missing the required not-legal/not-investment-advice disclosure footer.",
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

/** One-line summary for logs / the gate reason. */
export function summarizeClaimViolations(result: ClaimsGateResult): string {
  if (result.ok) return "land-claims gate: clear";
  return `land-claims gate BLOCKED: ${result.violations.map((v) => v.code).join(", ")}`;
}
