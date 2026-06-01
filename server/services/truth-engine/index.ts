/**
 * Truth Engine — public-claim verification.
 *
 * Phase Zero-Two foundation. Every public claim with a number,
 * comparison, or capability statement must pass through verifyClaim()
 * before publish. The engine doesn't write copy; it audits copy against
 * a named source list and either confirms each claim with evidence or
 * surfaces the unverifiable claims for rewrite/cut.
 *
 * Design rules:
 *   - Sources are names + URLs/file paths, not free-text. A "source"
 *     that's just a description ("trust me, I checked") is rejected.
 *   - Verification is deterministic at this stage — string-match the
 *     claim's key tokens against the source content. LLM verification
 *     is a future upgrade gated on cost + reliability validation.
 *   - The engine is forgiving on phrasing (verb tense, contractions)
 *     but strict on numbers — a claim of "14 comps per parcel" only
 *     verifies against a source that contains "14" near "comps."
 *   - No network calls in this module. Source fetching is the caller's
 *     job; this module receives the source content as a string. Keeps
 *     the engine offline-testable, deterministic, and cheap.
 *
 * Soren (CGO) owns the engine; Beatrice (CRO) audits the source list
 * quarterly. Tom can grep `verifyClaim(` to find every claim under
 * audit at any time.
 */

import { logger } from "../../utils/logger";

/**
 * A named source for a claim. `name` is what gets printed in a "Sources"
 * footer; `content` is the raw text/data the engine string-matches
 * against. The caller fetches the content (file read, DB query, public
 * URL fetch) and passes it in.
 */
export interface Source {
  name: string;
  content: string;
  /** Optional path/URL surfaced in evidence output. */
  ref?: string;
}

/**
 * Verification result. `verified === true` means every key token in the
 * claim appeared in at least one of the provided sources. `evidence`
 * lists the matched snippets so an auditor can sanity-check.
 */
export interface VerificationResult {
  verified: boolean;
  claim: string;
  evidence: string[];
  /** Tokens that did NOT match any source — actionable for the writer. */
  unmatchedTokens: string[];
}

/**
 * Tokenize a claim into the substrings the engine string-matches.
 * Currently extracts:
 *   - All numbers (digits, percentages, dollar amounts)
 *   - Quoted phrases (literal quoted text)
 *   - Capability nouns of length ≥ 4 (filters out "the", "and", etc.)
 *
 * Returns the deduplicated token list, lowercased. The token list is
 * what the source content is checked against — every token must appear
 * (case-insensitive) in at least one source for the claim to verify.
 */
export function tokenizeClaim(claim: string): string[] {
  const tokens = new Set<string>();
  const lower = claim.toLowerCase();

  // Numbers: 14, $41, 17%, 2,840, 1.5x
  const numRegex = /(\$?[0-9][0-9,]*(?:\.[0-9]+)?%?x?)/g;
  let m: RegExpExecArray | null;
  while ((m = numRegex.exec(lower)) !== null) {
    tokens.add(m[1]);
  }

  // Quoted phrases — content between matching double or single quotes.
  const quoteRegex = /["']([^"']{3,})["']/g;
  while ((m = quoteRegex.exec(lower)) !== null) {
    tokens.add(m[1].trim());
  }

  // Capability nouns / verbs ≥ 4 chars, stop-word filtered. The engine
  // only checks meaningful tokens; the universe of stop words below is
  // intentionally conservative — better to over-check than under-check.
  const STOP = new Set([
    "the", "and", "but", "for", "with", "from", "into", "that", "this",
    "than", "then", "they", "them", "their", "there", "what", "when",
    "where", "which", "while", "your", "yours", "have", "been", "will",
    "would", "could", "should", "about", "after", "before", "every",
    "only", "some", "such", "more", "most", "much", "very", "just",
    "also", "even", "over", "under", "across", "through", "between",
  ]);
  const wordRegex = /\b([a-z][a-z'-]{3,})\b/g;
  while ((m = wordRegex.exec(lower)) !== null) {
    if (!STOP.has(m[1])) tokens.add(m[1]);
  }

  return Array.from(tokens);
}

/**
 * Verify a single claim against a list of named sources.
 *
 * Behavior:
 *   - Tokenizes the claim (see tokenizeClaim).
 *   - For each token, checks whether ANY source's `content` contains it
 *     (case-insensitive substring match).
 *   - Returns `verified: true` only if every token matched somewhere.
 *   - `evidence` includes one short snippet per matched token showing
 *     the surrounding text so an auditor can confirm the match is
 *     meaningful (not a coincidence in unrelated context).
 *   - `unmatchedTokens` lists tokens that failed — the writer rewrites
 *     to cut these or adds a source that contains them.
 *
 * The engine does NOT semantically validate the claim against the
 * source. "14 comps per parcel" can pass against a source that says
 * "the engine returns up to 14 comps" — that's a true claim. It would
 * also pass against "we ran 14 tests" — that's a false claim that
 * matches the same tokens. Human review of the evidence is required;
 * the engine is the floor, not the ceiling.
 */
export async function verifyClaim(
  claim: string,
  sources: Source[],
): Promise<VerificationResult> {
  if (!claim || claim.trim().length === 0) {
    return {
      verified: false,
      claim,
      evidence: [],
      unmatchedTokens: [],
    };
  }
  if (sources.length === 0) {
    logger.warn("[truth-engine] verifyClaim called with no sources", { claim });
    return {
      verified: false,
      claim,
      evidence: [],
      unmatchedTokens: tokenizeClaim(claim),
    };
  }

  const tokens = tokenizeClaim(claim);
  const evidence: string[] = [];
  const unmatched: string[] = [];

  for (const token of tokens) {
    let foundInSource: Source | null = null;
    let snippet: string | null = null;
    for (const source of sources) {
      const idx = source.content.toLowerCase().indexOf(token);
      if (idx >= 0) {
        foundInSource = source;
        const start = Math.max(0, idx - 30);
        const end = Math.min(source.content.length, idx + token.length + 30);
        snippet = source.content.slice(start, end).replace(/\s+/g, " ").trim();
        break;
      }
    }
    if (foundInSource && snippet) {
      evidence.push(`[${foundInSource.name}] …${snippet}…`);
    } else {
      unmatched.push(token);
    }
  }

  return {
    verified: unmatched.length === 0,
    claim,
    evidence,
    unmatchedTokens: unmatched,
  };
}

/**
 * Batch helper — verify many claims against the same source pool.
 * Returns a per-claim result plus a summary count. Useful for auditing
 * the landing page in one pass (see scripts/audit-public-claims.ts).
 */
export async function verifyClaims(
  claims: string[],
  sources: Source[],
): Promise<{
  results: VerificationResult[];
  verifiedCount: number;
  unverifiedCount: number;
}> {
  const results = await Promise.all(claims.map((c) => verifyClaim(c, sources)));
  const verifiedCount = results.filter((r) => r.verified).length;
  return {
    results,
    verifiedCount,
    unverifiedCount: results.length - verifiedCount,
  };
}
