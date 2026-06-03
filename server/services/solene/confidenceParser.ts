/**
 * SOLENE — confidence parser (L3.11 of agentic-evolution architecture).
 *
 * Pure function. No DB, no IO. Takes a dispatched agent's final-text
 * string + returns a ParsedConfidence describing which confidence signal
 * (if any) was detected, the extracted numeric confidence in [0, 1], and
 * a SANITIZED text excerpt of the matched phrase suitable for persistence.
 *
 * Five detection buckets (priority order, highest wins):
 *
 *   explicit_percentage — "I'm 92% sure", "confidence: 90%", "CONFIDENCE: 0.85"
 *   explicit_band       — "confidence: high", "low confidence"
 *   uncertainty_marker  — "I'm uncertain", "I'm not sure", "I cannot be sure"
 *   hedged_confidence   — "I think", "probably", "maybe", "likely", "might be"
 *   no_signal           — none of the above matched
 *
 * Sanitization mirrors constitutionalGuard.sanitizeEvidence behavior
 * inline (we deliberately do NOT import constitutionalGuard — that surface
 * is frozen by the L3.11 contract). The credential-prefix set comes
 * straight from feedback_credential_value_handling.md: sk_/pk_ Stripe
 * keys, phc_ / phx_ PostHog, ghp_ GitHub PATs, AKIA/ASIA AWS, Bearer auth
 * headers. All redacted to "[REDACTED]" before being included in the
 * persisted phrase.
 */

export type ParsedConfidenceKind =
  | "explicit_percentage"
  | "explicit_band"
  | "uncertainty_marker"
  | "hedged_confidence"
  | "no_signal";

export interface ParsedConfidence {
  kind: ParsedConfidenceKind;
  /** 0-1 when extractable; null otherwise. */
  statedConfidence: number | null;
  /** Sanitized matched-text excerpt; null when kind === 'no_signal'. */
  phrase: string | null;
}

// ============================================================================
// PATTERNS
// ============================================================================
// Each pattern below is documented + uses named groups so the extraction
// logic stays close to the regex source.
// ----------------------------------------------------------------------------

// Explicit percentage: "I'm 92% confident", "I am 80% sure", "I'm 100% certain"
const RX_EXPLICIT_PERCENT_PROSE =
  /I(?:'m| am) (?<pct>\d{1,3})% (?:sure|confident|certain)/i;

// Explicit percentage label: "confidence: 90%" / "CONFIDENCE: 90 %"
const RX_EXPLICIT_PERCENT_LABEL = /confidence:\s*(?<pct>\d{1,3})\s*%/i;

// Explicit decimal label: "CONFIDENCE: 0.85" or "CONFIDENCE: 1.0"
const RX_EXPLICIT_DECIMAL_LABEL =
  /CONFIDENCE:\s*(?<dec>0?\.\d+|1\.0)\b/;

// Explicit band: "confidence: high" / "confidence: medium" / "confidence: low"
const RX_EXPLICIT_BAND_LABEL =
  /confidence:\s*(?<band>high|medium|low)\b/i;

// Explicit band prose: "high confidence", "low confidence", "medium confidence"
const RX_EXPLICIT_BAND_PROSE =
  /(?<band>high|medium|low) confidence/i;

// Uncertainty markers: "I'm uncertain", "I am unsure", "I'm not sure",
// "I don't be sure", "I cannot be sure".
const RX_UNCERTAIN_AM =
  /I(?:'m| am)(?: not| n't)? (?:uncertain|unsure|not sure)/i;
const RX_UNCERTAIN_CANT =
  /I (?:don'?t|cannot|can'?t) be sure/i;

// Hedged confidence — soft markers. Listed roughly weakest-to-strongest;
// the scorer below assigns 0.55-0.65 per band.
const HEDGE_PATTERNS: { rx: RegExp; score: number; label: string }[] = [
  { rx: /\bI think\b/i, score: 0.6, label: "I think" },
  { rx: /\bI believe\b/i, score: 0.65, label: "I believe" },
  { rx: /\bprobably\b/i, score: 0.6, label: "probably" },
  { rx: /\blikely\b/i, score: 0.6, label: "likely" },
  { rx: /\bmight be\b/i, score: 0.55, label: "might be" },
  { rx: /\bmaybe\b/i, score: 0.55, label: "maybe" },
];

// Band -> numeric confidence. Mirrors CONFIDENCE_BAND_VALUES in the schema
// but inlined here to keep the parser self-contained (no schema import in
// a pure function).
const BAND_TO_CONFIDENCE: Record<string, number> = {
  high: 0.85,
  medium: 0.55,
  low: 0.25,
};

const UNCERTAINTY_CONFIDENCE = 0.4;

// ============================================================================
// SANITIZATION — inline mirror of constitutionalGuard.sanitizeEvidence.
// Kept inline by design (don't import the frozen surface).
// ============================================================================

const PHRASE_MAX_LEN = 500;

const CREDENTIAL_PATTERNS: RegExp[] = [
  // Stripe secret/publishable: sk_live_... / sk_test_... / pk_live_... etc.
  /\b(?:sk|pk)_(?:test|live)?_?[A-Za-z0-9]{8,}\b/g,
  // PostHog project keys
  /\bphc_[A-Za-z0-9]{8,}\b/g,
  /\bphx_[A-Za-z0-9]{8,}\b/g,
  // GitHub PATs
  /\bghp_[A-Za-z0-9]{8,}\b/g,
  // Bearer auth headers
  /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/g,
  // AWS access keys (long-lived + STS)
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
];

function sanitizePhrase(s: string): string {
  let out = String(s ?? "");
  for (const rx of CREDENTIAL_PATTERNS) {
    out = out.replace(rx, "[REDACTED]");
  }
  if (out.length > PHRASE_MAX_LEN) {
    out = `${out.slice(0, PHRASE_MAX_LEN)}... [truncated]`;
  }
  return out;
}

// ============================================================================
// parseConfidence — the public surface.
// ============================================================================

export function parseConfidence(text: string): ParsedConfidence {
  const safe = typeof text === "string" ? text : "";
  if (safe.length === 0) {
    return { kind: "no_signal", statedConfidence: null, phrase: null };
  }

  // 1. Explicit percentage (highest priority). Order within: prose form
  //    (most natural), then label form, then decimal-label form.
  const m1 = RX_EXPLICIT_PERCENT_PROSE.exec(safe);
  if (m1?.groups?.pct) {
    const pct = clampPercent(Number(m1.groups.pct));
    return {
      kind: "explicit_percentage",
      statedConfidence: pct,
      phrase: sanitizePhrase(m1[0]),
    };
  }
  const m2 = RX_EXPLICIT_PERCENT_LABEL.exec(safe);
  if (m2?.groups?.pct) {
    const pct = clampPercent(Number(m2.groups.pct));
    return {
      kind: "explicit_percentage",
      statedConfidence: pct,
      phrase: sanitizePhrase(m2[0]),
    };
  }
  const m3 = RX_EXPLICIT_DECIMAL_LABEL.exec(safe);
  if (m3?.groups?.dec) {
    const dec = clamp01(Number(m3.groups.dec));
    return {
      kind: "explicit_percentage",
      statedConfidence: dec,
      phrase: sanitizePhrase(m3[0]),
    };
  }

  // 2. Explicit band: label form first (more deliberate), then prose form.
  const b1 = RX_EXPLICIT_BAND_LABEL.exec(safe);
  if (b1?.groups?.band) {
    const band = b1.groups.band.toLowerCase();
    return {
      kind: "explicit_band",
      statedConfidence: BAND_TO_CONFIDENCE[band] ?? null,
      phrase: sanitizePhrase(b1[0]),
    };
  }
  const b2 = RX_EXPLICIT_BAND_PROSE.exec(safe);
  if (b2?.groups?.band) {
    const band = b2.groups.band.toLowerCase();
    return {
      kind: "explicit_band",
      statedConfidence: BAND_TO_CONFIDENCE[band] ?? null,
      phrase: sanitizePhrase(b2[0]),
    };
  }

  // 3. Uncertainty markers.
  const u1 = RX_UNCERTAIN_AM.exec(safe);
  if (u1) {
    return {
      kind: "uncertainty_marker",
      statedConfidence: UNCERTAINTY_CONFIDENCE,
      phrase: sanitizePhrase(u1[0]),
    };
  }
  const u2 = RX_UNCERTAIN_CANT.exec(safe);
  if (u2) {
    return {
      kind: "uncertainty_marker",
      statedConfidence: UNCERTAINTY_CONFIDENCE,
      phrase: sanitizePhrase(u2[0]),
    };
  }

  // 4. Hedged confidence. Walk all hedge patterns; pick the first match.
  for (const h of HEDGE_PATTERNS) {
    const hm = h.rx.exec(safe);
    if (hm) {
      return {
        kind: "hedged_confidence",
        statedConfidence: h.score,
        phrase: sanitizePhrase(hm[0]),
      };
    }
  }

  // 5. No signal.
  return { kind: "no_signal", statedConfidence: null, phrase: null };
}

// ============================================================================
// Helpers
// ============================================================================

function clampPercent(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 1;
  return pct / 100;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
