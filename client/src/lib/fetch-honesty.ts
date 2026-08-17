/**
 * Telling "you have none" apart from "we could not look".
 *
 * The repo carried 32 copies of this line:
 *
 *     if (!res.ok) return [];      // …or `return null`
 *
 * `!res.ok` collapses two answers that mean opposite things. A **404** on an
 * optional record is a real answer — *this property has no compliance record* —
 * and rendering it as `null` is honest. A **500** is not an answer at all, and
 * rendering it as `[]` states a fact about the customer's own data out of a
 * failure to read it.
 *
 * WHAT THAT COST, at its worst. The land-sourcing dashboard widget fetched
 * properties and leads, turned any failure into two empty arrays, and then hit:
 *
 *     if (properties.length === 0 && ownerTargets === 0) return <EmptyState
 *       headline="Start sourcing parcels"
 *       subtitle="… Add your first parcels or owner targets …" />
 *
 * So a customer with two hundred parcels, during an API blip, was shown the
 * NEW-USER ONBOARDING STATE on their own dashboard and invited to add their
 * first parcels. Not merely "you have none" — an instruction to redo work they
 * had already done.
 *
 * The constitution's rule is that fabrication is never acceptable, and the
 * canonical laws are explicit that UNKNOWN is a valid state which must stay
 * distinguishable from zero. These two helpers are how a call site says which
 * one it means.
 */

/** A failed request, carrying the status so a caller can still branch on it. */
export class RequestFailedError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`Request failed (${status}): ${url}`);
    this.name = "RequestFailedError";
  }
}

/**
 * The response, or a throw.
 *
 * For anything that answers "what do I have" — a list, a count, a total. There
 * is no honest empty value for a read that did not happen, so the query lands in
 * its error state and the page renders `QueryErrorState` with a retry, which is
 * what CLAUDE.md's UI patterns already prescribe.
 */
export async function okOrThrow(res: Response): Promise<Response> {
  if (!res.ok) throw new RequestFailedError(res.status, res.url);
  return res;
}

/**
 * `null` for a 404, a throw for anything else.
 *
 * For an OPTIONAL single record — a badge, a cached score, a preference — where
 * "there isn't one" is a real and expected answer that the server says with a
 * 404. Every other status is still a failure and still throws, which is the half
 * `if (!res.ok) return null` silently gave away.
 */
export async function nullOn404<T>(res: Response): Promise<T | null> {
  if (res.status === 404) return null;
  if (!res.ok) throw new RequestFailedError(res.status, res.url);
  return (await res.json()) as T;
}

/**
 * The list inside a paginated envelope, tolerant of both shapes this API uses
 * (`{ data: [...] }` and a bare array).
 *
 * Bundled with the helpers above on purpose: the unwrapping is where the old
 * code put its `: []` fallbacks, and a fallback there is the same lie one layer
 * in — a body that failed to parse is not an empty collection.
 */
export function listFrom<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)) {
    return (json as { data: T[] }).data;
  }
  throw new Error("Expected a list or a { data: [...] } envelope");
}
