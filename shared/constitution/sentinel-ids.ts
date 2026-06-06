// ============================================================================
// SHARED/CONSTITUTION/SENTINEL-IDS.TS
// ----------------------------------------------------------------------------
// Quinn (Chief of Alignment) — sentinel `cited_immutable_id` values.
//
// `pax_refusal_payloads.cited_immutable_id` is a free-text column whose
// canonical values are of shape `customer:N` or `sovereign:N`, drawn from
// sovereign-protocol/immutables.json. Some downstream emitters (postvalidate,
// streaming validators, future safety gates) catch a refusal-shaped event
// that doesn't cleanly map to a numbered immutable — the breach is real, but
// none of the 12 customer immutables or 10 sovereign principles is the right
// citation.
//
// Rather than modify immutables.json (which is hash-pinned by the
// sovereign-protocol unit test), we declare named sentinel IDs here. They:
//
//   1. Use a `customer:0:...` or `sovereign:0:...` prefix — the `:0:` segment
//      identifies them as sentinels, never colliding with real numbered
//      immutables (which start at 1).
//   2. Are validated by `isSentinelImmutableId()` so consumer code can
//      decide whether to treat them as canonical or as sentinel.
//   3. Carry an inline doc-comment explaining when each is the right citation.
//
// DO NOT use sentinels when a real numbered immutable would be a better fit
// — sentinels exist for the unmappable residue, not as a shortcut.
// ============================================================================

/**
 * Sentinel for postvalidate breaches that don't cleanly map to a numbered
 * immutable — e.g. a prompt-leak pattern matched the LEAK_PATTERNS regex but
 * the leak content is a system-prompt fragment (not strictly an AI-use
 * disclosure issue, not strictly a fact-misrepresentation). The breach IS a
 * constitutional concern (the model emitted state it shouldn't have) but the
 * numbered immutable list doesn't enumerate "system prompt leakage" directly.
 *
 * The persona-self-id leak class (e.g. "I am Atlas") IS a clean fit for
 * customer:7 (always disclose AI use clearly) — use that instead. This
 * sentinel is for the residue.
 */
export const SENTINEL_POSTVALIDATE_MISC = "customer:0:misc-postvalidate";

/** All declared sentinel IDs — used by lint + validation. */
export const ALL_SENTINEL_IMMUTABLE_IDS: ReadonlyArray<string> = Object.freeze([
  SENTINEL_POSTVALIDATE_MISC,
]);

const SENTINEL_RX = /^(customer|sovereign):0:[a-z0-9][a-z0-9-]*$/;

/** Returns true iff the id is a declared `customer:0:...`/`sovereign:0:...` sentinel. */
export function isSentinelImmutableId(id: string): boolean {
  if (typeof id !== "string") return false;
  if (!SENTINEL_RX.test(id)) return false;
  return ALL_SENTINEL_IMMUTABLE_IDS.includes(id);
}
