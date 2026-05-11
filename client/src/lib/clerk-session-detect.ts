/**
 * Clerk session-cookie detection helpers.
 *
 * Clerk-JS in our proxy/multi-instance config sets cookies whose names
 * are suffixed with a per-instance hash:
 *
 *   __session_<hash>=...   (the JWT)
 *   __client_uat_<hash>=... (last-active timestamp)
 *   __clerk_db_jwt_<hash>=...
 *
 * Earlier code only checked for the bare `__session=` name (left over from
 * the single-instance days). That gate is "always false" for real signed-in
 * users on this proxy config — so it (a) failed to enable authenticated
 * queries on resume and (b) didn't suppress them either, because some hooks
 * fired unconditionally.
 *
 * `hasAnyClerkSession()` is the canonical "does this browser have any
 * Clerk session cookie at all?" check. Use it as the `enabled` gate for any
 * fetch that requires authentication so unauthenticated landing-page visits
 * don't produce a wall of 401s in the console.
 *
 * Cookie-name-prefix tolerant — matches both the legacy bare `__session=`
 * and the suffixed `__session_<hash>=`.
 */

/**
 * True iff the current document has any Clerk session cookie set.
 * Returns false in non-browser contexts (SSR).
 */
export function hasAnyClerkSession(): boolean {
  if (typeof document === "undefined") return false;
  // Match `__session=` (legacy) or `__session_<anything>=` (suffixed).
  return /(^|;\s*)__session(_[^=]*)?=/.test(document.cookie);
}

/**
 * True iff the current document has any `__client_*` or `__session*`
 * Clerk cookie. Broader than `hasAnyClerkSession` — also matches
 * `__client_uat_<hash>` and `__clerk_db_jwt_<hash>`. Use this when you
 * want to know whether Clerk has ever touched this browser at all,
 * regardless of whether the session JWT is currently present.
 */
export function hasAnyClerkCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(^|;\s*)(__session|__client|__clerk)([_=])/.test(document.cookie);
}

/**
 * Extracts the Clerk session JWT from `document.cookie`, tolerating the
 * suffixed cookie names. Returns null if no session cookie is set.
 */
export function readClerkSessionJwt(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)__session(?:_[^=]*)?=([^;]+)/);
  return m?.[1] ?? null;
}
