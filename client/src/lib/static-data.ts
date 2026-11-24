/**
 * Loader — static copy served as data assets instead of bundle JS.
 *
 * The BD-6 / legal-docs pattern, generalised: long, purely-static copy
 * (campaign template bodies, the customer changelog, the help centre's
 * guides + FAQ, the security-deposit return-rule registry) ships as JSON
 * under client/public/ — Vite copies it
 * verbatim into the build output and the web server serves it at the
 * root — instead of riding inside a JS chunk, where every byte counts
 * against scripts/bundle-budget.json. The TypeScript modules stay the
 * single source of truth (the server and the test suite import them
 * synchronously); tests/unit/staticDataServedAsData.test.ts pins each
 * served asset deep-equal to its module, so the two cannot drift.
 *
 * Discipline (the tn-boundaries / legal-doc loader shape):
 *  - promise-cached per URL: one fetch per page session, shared by
 *    every consumer of the same asset;
 *  - a failed fetch REJECTS (never resolves empty): consumers render
 *    their shell first and show a visible failure line, never a
 *    silently-empty section;
 *  - the cache entry is cleared on rejection, so a retry can succeed.
 */

import { useEffect, useState } from "react";

export const OUTREACH_TEMPLATES_URL = "/outreach-templates.json";
export const CUSTOMER_CHANGELOG_URL = "/customer-changelog.json";
export const HELP_CONTENT_URL = "/help-content.json";
export const TRUST_CONTENT_URL = "/trust-content.json";
export const ONBOARDING_VERTICALS_URL = "/onboarding-verticals.json";
export const LANDING_COPY_URL = "/landing-copy.json";
export const PALETTE_VERBS_URL = "/palette-verbs.json";
export const DEPOSIT_RETURN_RULES_URL = "/deposit-return-rules.json";

const cache = new Map<string, Promise<unknown>>();

export function loadStaticData<T>(url: string): Promise<T> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url).then((res) => {
      if (!res.ok) {
        throw new Error(`static data ${url}: HTTP ${res.status}`);
      }
      return res.json() as Promise<unknown>;
    });
    // Clear on rejection so the next caller retries instead of
    // re-serving a cached failure for the rest of the session.
    pending.catch(() => {
      if (cache.get(url) === pending) cache.delete(url);
    });
    cache.set(url, pending);
  }
  return pending as Promise<T>;
}

export interface StaticDataState<T> {
  data: T | null;
  error: boolean;
}

/** Shell-first hook: `data` is null while the asset is in flight. */
export function useStaticData<T>(url: string): StaticDataState<T> {
  const [state, setState] = useState<StaticDataState<T>>({
    data: null,
    error: false,
  });
  useEffect(() => {
    let live = true;
    loadStaticData<T>(url).then(
      (data) => {
        if (live) setState({ data, error: false });
      },
      () => {
        if (live) setState({ data: null, error: true });
      },
    );
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

/**
 * {{TOKEN}} substitution for served copy whose strings interpolate a
 * single-source constant (the legal-doc assets' discipline): the asset
 * carries the placeholder, the consumer substitutes the live constant
 * at render time, so the one-edit flip still propagates. Unknown
 * tokens are left untouched — a typo'd placeholder stays visible
 * instead of silently vanishing.
 */
export function substituteTokens(
  text: string,
  tokens: Record<string, string>,
): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name] : match,
  );
}
