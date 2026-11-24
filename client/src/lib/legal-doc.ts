/**
 * Loader — the legal documents' section bodies, served as static assets.
 *
 * Bundle diet (the #524 learn-content / #581 TN-boundaries / BD-6 glossary
 * pattern): the Privacy Policy and Terms of Service section bodies are
 * long, static HTML (client/src/legal/*.html) that used to be inline JSX in
 * pages/privacy.tsx and pages/terms.tsx, where every byte rode inside the
 * bundle gate's summed JS total (scripts/check-bundle-size.js counts every
 * emitted .js file). The files now ship as static assets instead —
 * vite.config.ts (legalDocsPlugin) copies them verbatim into
 * dist/public/legal/ at build end and serves the same URLs from disk under
 * the dev server — and LegalDocBody fetches them on demand. The page
 * shells (title, effective dates, read-aloud, entity footer) stay bundled
 * React, and the bodies' {{TOKEN}} placeholders are substituted at render
 * time from their single sources of truth (lib/legal-entity.ts,
 * @shared/pax-glossary-core), so the one-edit entity flip in
 * legal-entity.ts still propagates to the served documents.
 *
 * A failed fetch REJECTS, never resolves an empty result: an unreadable
 * legal document must not masquerade as a shorter one. See the
 * empty-on-failure ratchet (scripts/ratchets/empty-on-failure.json).
 */

/** Where the legal section bodies are served from (dist/public/legal/). */
export const PRIVACY_POLICY_URL = "/legal/privacy-policy.html";
export const TERMS_OF_SERVICE_URL = "/legal/terms-of-service.html";

const pending = new Map<string, Promise<string>>();

/**
 * Fetch a legal document's section body, once per page load per URL:
 * concurrent callers share the request, and a rejection clears the cache
 * so a later caller can retry.
 */
export function fetchLegalDoc(url: string): Promise<string> {
  let req = pending.get(url);
  if (!req) {
    req = (async () => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Legal document failed to load (${url}): ${res.status}`);
      }
      return await res.text();
    })().catch((err: unknown) => {
      pending.delete(url);
      throw err;
    });
    pending.set(url, req);
  }
  return req;
}

/**
 * Substitute the {{TOKEN}} placeholders a legal body carries with the
 * current values from their single sources of truth. A token with no
 * supplied value is left in place — visibly wrong in review, never a
 * silently baked stale value.
 */
export function substituteLegalTokens(
  html: string,
  values: Record<string, string>,
): string {
  return html.replace(/\{\{([A-Z_]+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match,
  );
}
