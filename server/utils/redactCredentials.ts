/**
 * THE credential redactor. There were four, and they disagreed.
 *
 * Unit 120. Four modules each carried their own `CREDENTIAL_PATTERNS` list for
 * scrubbing evidence/trigger/phrase strings before persisting them to audit
 * rows — `krieger/mobileFeelAudit.ts`, `solene/constitutionalGuard.ts`,
 * `solene/speculations.ts`, `solene/confidenceParser.ts` — and Krieger's own
 * comment claimed it used the *"same prefix set as the wave's other Phase-C
 * agents."* It did not. Measured divergence, bidirectional:
 *
 *   input with a Slack token `xoxb-…`   → constitutionalGuard redacts; the
 *                                          other THREE persist it verbatim
 *   input with a session JWT `eyJ…`     → constitutionalGuard redacts; the
 *                                          other three persist it verbatim
 *   input with a GitHub OAuth `gho_…`   → krieger + speculations redact;
 *                                          constitutionalGuard + confidenceParser
 *                                          persist it verbatim
 *
 * Which secrets survive into an audit row depended on WHICH AGENT wrote the
 * row. This module is the union of all four lists; the four call sites import
 * it, and `credentialRedaction.test.ts` asserts no module carries a private
 * pattern list again.
 *
 * ADD PATTERNS HERE AND NOWHERE ELSE. The same rule as the prompt-injection
 * deny-list (server/utils/sanitizePrompt.ts): a second copy is not defence in
 * depth, it is a coin flip about which audit row keeps a live token.
 */

const CREDENTIAL_PATTERNS: { name: string; rx: RegExp }[] = [
  // Stripe secret/publishable. {4,} not {8,}, for the same reason the AWS rule
  // below is {4,}: FOR A REDACTOR THE UNION IS THE LOOSEST FORM.
  //
  // This shipped as {8,} in the six-copy consolidation and that was a real miss,
  // caught by krieger's own pinning test: `pk_test_xyz789` leaves a 6-character
  // suffix after the `pk_test_` prefix, so the {8,} form matched NOTHING and the
  // key survived into an audit row. The consolidation's whole claim was that it
  // was the union of the six copies it replaced; on this line it was narrower
  // than at least one of them.
  //
  // An `sk_`/`pk_` prefix is already strong evidence on its own — the prefix is
  // the signal, the length is not — so the minimum exists only to avoid matching
  // a bare `sk_` in prose. Over-redacting a short token that looks like a Stripe
  // key is noise; an unredacted one is the defect.
  { name: "stripe-key", rx: /\b(?:sk|pk)_(?:test|live)?_?[A-Za-z0-9]{4,}\b/g },
  { name: "posthog-project", rx: /\bphc_[A-Za-z0-9]{8,}\b/g },
  { name: "posthog-personal", rx: /\bphx_[A-Za-z0-9]{8,}\b/g },
  { name: "github-pat", rx: /\bghp_[A-Za-z0-9]{8,}\b/g },
  { name: "github-oauth", rx: /\bgho_[A-Za-z0-9]{8,}\b/g },
  { name: "bearer", rx: /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/g },
  // {4,} not {16}: real AWS key ids are AKIA+16, but two of the six retired
  // copies deliberately matched {4,}/{12,} and their pinning tests encode that.
  // For a redactor the union is the LOOSEST form — over-redacting an
  // AKIA-prefixed uppercase token in prose is noise, an unredacted key is the
  // defect.
  { name: "aws-access-key", rx: /\b(?:AKIA|ASIA)[A-Z0-9]{4,}\b/g },
  { name: "slack-token", rx: /\bxox[abpsr]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt-like", rx: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
];

/**
 * Replace credential-shaped substrings with [REDACTED]; optionally truncate.
 * `maxLen` keeps a single rogue field from blowing up an audit row — pass the
 * caller's own cap (the four sites cap at 500 or their trigger max).
 */
export function redactCredentials(
  s: string | null | undefined,
  maxLen?: number,
  marker = "[REDACTED]",
): string {
  let out = String(s ?? "");
  for (const { rx } of CREDENTIAL_PATTERNS) {
    out = out.replace(rx, marker);
    rx.lastIndex = 0;
  }
  if (maxLen !== undefined && out.length > maxLen) {
    out = `${out.slice(0, maxLen)}... [truncated]`;
  }
  return out;
}

/** Which patterns an input trips — for callers that log the category. */
export function detectCredentialPatterns(s: string): string[] {
  const hits: string[] = [];
  for (const { name, rx } of CREDENTIAL_PATTERNS) {
    if (rx.test(s)) hits.push(name);
    rx.lastIndex = 0;
  }
  return hits;
}
