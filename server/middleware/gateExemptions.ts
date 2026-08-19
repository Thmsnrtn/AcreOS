/**
 * Segment-bounded path exemption — the one containment rule the three
 * posture gates share.
 *
 * THE DEFECT THIS EXISTS TO FORECLOSE
 * -----------------------------------
 * `subscriptionPauseGate`, `dunningAccessGate` and `viewerReadOnlyGate` each
 * carried their own copy of:
 *
 *     for (const prefix of EXEMPT) if (path.startsWith(prefix)) return next();
 *
 * A raw `startsWith` treats an exemption as a TEXTUAL prefix, not a PATH
 * prefix, so an entry can reach paths nobody meant to exempt. `"/api/health"`
 * exempts `/api/healthz`; `"/api/audit/export"` exempts
 * `/api/audit/export-everything`; and `"/api/deal"` — a plausible future typo
 * for `/api/deals/` — would silently exempt every write behind the Deals door
 * from the viewer read-only guarantee. Nothing in the three gates refused
 * such an entry, and nothing made the three agree.
 *
 * That is the shape Foundry's `development_authority_guard` refuses in
 * migration 120: a grant may not widen its own reach, and containment is
 * checked with an explicit boundary rather than by string prefix. This is the
 * same rule, pointed at the exemption lists AcreOS actually has. It is
 * recorded as ledger entry 23 in the cross-pollination ledger.
 *
 * THE RULE
 * --------
 * An entry matches a path only at a SEGMENT boundary:
 *
 *   - `"/api/auth/"`  → `/api/auth/refresh` ✓   `/api/authz` ✗
 *   - `"/api/health"` → `/api/health` ✓, `/api/health/live` ✓, `/api/healthz` ✗
 *
 * The result is strictly NARROWER than `startsWith` for every possible entry
 * and path — this rule can only ever remove an exemption, never add one. A
 * security predicate that could widen under a refactor is the thing being
 * fixed, so the fix is not permitted to widen either. A trailing-slash entry
 * keeps the strict reading it already had (`/api/auth/` does NOT exempt a
 * bare `/api/auth`) for the same reason.
 */

/**
 * Does `path` fall inside `prefix`, at a path-segment boundary?
 *
 * Exported for the boundary tests; callers normally want `pathIsExempt`.
 */
export function pathWithin(path: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return path.startsWith(prefix);
  return path === prefix || path.startsWith(prefix + "/");
}

/**
 * Is `path` exempted by any entry in `prefixes`?
 *
 * The single containment predicate for every posture gate. A gate that
 * re-implements this loop inline has re-opened the defect above, so the
 * boundary tests drive the real middlewares rather than this function alone.
 */
export function pathIsExempt(path: string, prefixes: readonly string[]): boolean {
  for (const prefix of prefixes) {
    if (pathWithin(path, prefix)) return true;
  }
  return false;
}
