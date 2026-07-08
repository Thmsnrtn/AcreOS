/**
 * Claims engine — the domain-AGNOSTIC content-claims/solicitation screener
 * (Foundry move #6: generalize claimsGate into a per-pack regulatory profile).
 *
 * KERNEL. Auto-published content carries real liability in EVERY regulated
 * vertical — a confidently-wrong determination is a lawsuit, not a slop-factory
 * annoyance. This engine is the deterministic gate; the SPECIFIC prohibited
 * claims are supplied by a pack's `RegulatoryProfile` (the land pack's lives in
 * packs/land/regulatoryProfile.ts). A second vertical inherits this machinery
 * unchanged and supplies only its own profile.
 *
 * Two classes of rule:
 *   • determinationPatterns — facts the system cannot lawfully ASSERT, but MAY
 *     convey when attributed + hedged nearby ("County GIS lists … as of 2024").
 *   • bannedPatterns — phrasings never allowed (e.g. guaranteed-return,
 *     protected-class steering).
 * Plus a required disclosure footer.
 *
 * Pure + deterministic → exhaustively testable. Conservative by design (false
 * positives are cheap — reword/hold; false negatives are a published liability).
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

export interface ClaimPattern {
  code: string;
  re: RegExp;
  label: string;
}

/** A vertical's content-regulatory rules — the per-pack half of the claims gate. */
export interface RegulatoryProfile {
  /** Phrases that, near a determination, make it allowed (attributed + hedged). */
  attributionCues: string[];
  /** Determinations: banned UNLESS attributed/hedged nearby. */
  determinationPatterns: ClaimPattern[];
  /** Phrasings never allowed (investment, fair-housing steering, …). */
  bannedPatterns: ClaimPattern[];
  /** Phrases any of which satisfy the required not-advice disclosure footer. */
  disclosureCues: string[];
}

export interface ClaimsGateOptions {
  /** Require a not-advice disclosure footer (default true). */
  requireDisclosure?: boolean;
  /** Override the profile's disclosure cues for this call. */
  disclosureCues?: string[];
}

function hasNearbyAttribution(text: string, idx: number, cues: string[]): boolean {
  const windowStart = Math.max(0, idx - 80);
  const ctx = text.slice(windowStart, idx + 80).toLowerCase();
  return cues.some((cue) => ctx.includes(cue));
}

/**
 * Screen content against a regulatory profile. Pure + total. `ok` is false if
 * ANY critical violation is present. Determinations are allowed only when
 * attributed/hedged nearby; banned patterns are never allowed; a disclosure
 * footer is required unless opted out.
 */
export function screenClaims(
  text: string,
  profile: RegulatoryProfile,
  opts: ClaimsGateOptions = {},
): ClaimsGateResult {
  const violations: ClaimViolation[] = [];
  const body = text ?? "";

  // Determinations: flagged unless attributed/hedged nearby.
  for (const p of profile.determinationPatterns) {
    const m = p.re.exec(body);
    if (m && m.index != null && !hasNearbyAttribution(body, m.index, profile.attributionCues)) {
      violations.push({
        code: p.code,
        severity: "critical",
        match: m[0],
        message: `Asserts ${p.label} ("${m[0].trim()}") without attribution — facts must be sourced + hedged, never machine-asserted.`,
      });
    }
  }

  // Banned phrasings: never allowed.
  for (const p of profile.bannedPatterns) {
    const m = p.re.exec(body);
    if (m) {
      violations.push({
        code: p.code,
        severity: "critical",
        match: m[0],
        message: `Contains ${p.label} ("${m[0].trim()}") — not allowed in auto-published content.`,
      });
    }
  }

  // Disclosure footer must be present.
  if (opts.requireDisclosure ?? true) {
    const cues = opts.disclosureCues ?? profile.disclosureCues;
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
export function summarizeClaimViolations(result: ClaimsGateResult, label = "claims"): string {
  if (result.ok) return `${label} gate: clear`;
  return `${label} gate BLOCKED: ${result.violations.map((v) => v.code).join(", ")}`;
}
