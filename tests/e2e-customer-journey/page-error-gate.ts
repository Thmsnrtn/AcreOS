/**
 * Network-corroborated page-error gate for the customer-journey walk (CJ1).
 *
 * WHY THIS EXISTS. On WebKit, the walk's uncaught-page-errors contract was
 * failing on one class only: "<url> due to access control checks." Proof run
 * 42151652145 (head 348b6d3): 13 failed attempts, 271 entries, every one that
 * shape. The decomposition of that run's traces found it is the HARNESS, not
 * the product. In the failing iPhone 12 trace:
 *   - all 196 /api/* network entries returned 200, including every endpoint
 *     the gate listed as failed;
 *   - the rejected fetch instances never appear in the network log;
 *   - the pages rendered the data the gate called failed;
 *   - Clerk's own FAPI fetches died the same way while succeeding on the wire.
 * Chromium: zero occurrences across three runs. The mechanism is the
 * harness's context.route + route.continue({ headers }) token injection
 * (seedTestAuth) racing WebKit's access-control adjudication. No real browser
 * has that machinery.
 *
 * WHAT IT DISMISSES, and nothing else. An access-control-shaped page error is
 * dismissed ONLY when ALL of these hold:
 *   1. its URL is on the walk's OWN origin. Same-origin requests cannot fail
 *      an access-control check in a real browser. A cross-origin one can (a
 *      genuine CORS block whose server still answered 200), so cross-origin is
 *      never dismissed;
 *   2. a response for the same host + path completed with a 2xx status in the
 *      same attempt. The query string is ignored, because the rejected
 *      instances carry unique Date.now() poll parameters;
 *   3. the gate is reached at all. It runs after every step, so every step's
 *      assertions have already passed.
 * Anything else still fails the gate:
 *   - an access-control error with no 2xx, or only a 4xx/5xx, for its path
 *     (revoked token, forced 500);
 *   - one whose URL cannot be parsed, or that has no network entry (blob:);
 *   - any other page error.
 *
 * NOTHING IS DROPPED SILENTLY. The caller records every dismissed entry,
 * with its raw string and the status that corroborated it, as an annotation
 * that the audit runner prints in the run report.
 */

export const ACCESS_CONTROL_RE = /\bdue to access control checks\.?\s*$/i;

/** host + pathname key a response and an error are matched on. */
export function pathKey(host: string, pathname: string): string {
  return `${host.toLowerCase()}${pathname}`;
}

/**
 * Pull host + pathname out of a WebKit access-control page error.
 *
 * Playwright surfaces WebKit's "Fetch API cannot load <url> due to access
 * control checks." with the front of the URL clipped, as measured in run
 * 42151652145:
 *   "/acreos-staging.fly.dev/api/notifications due to access control checks."
 *   "ttps://acreos-staging.fly.dev/767f47f1-… due to access control checks."
 * The full "https://host/path …" form is accepted too. Returns null when no
 * host + path can be read, and the caller then treats the error as
 * uncorroborated.
 */
export function parseAccessControlTarget(
  message: string,
): { host: string; pathname: string } | null {
  if (!ACCESS_CONTROL_RE.test(message)) return null;
  const urlish = message.replace(ACCESS_CONTROL_RE, "").trim().split(/\s+/).pop() ?? "";
  // Drop whatever is left of a scheme ("https:", "ttps:", "blob:https:", …) and
  // the leading slashes, leaving "host/path?query".
  const rest = urlish.replace(/^(?:[a-z][a-z0-9+.-]*:)*\/*/i, "");
  const m = /^([a-z0-9.-]+\.[a-z0-9-]+(?::\d+)?)(\/[^\s?#]*)?/i.exec(rest);
  if (!m) return null;
  return { host: m[1], pathname: m[2] ?? "/" };
}

export interface CorroboratedError {
  raw: string;
  key: string;
  status: number;
}

export interface PageErrorVerdict {
  /** Errors that fail the gate, as raw strings. */
  failing: string[];
  /** Access-control errors dismissed by a same-origin 2xx on the same path. */
  corroborated: CorroboratedError[];
}

/**
 * Decide the uncaught-page-errors contract.
 *
 * @param pageErrors raw page-error messages, after the suite's IGNORED_ERRORS
 * @param ok2xx      host+path key → a 2xx status seen in this attempt
 * @param ownHost    the walk's own host (from baseURL); only it is eligible
 */
export function gatePageErrors(
  pageErrors: readonly string[],
  ok2xx: ReadonlyMap<string, number>,
  ownHost: string,
): PageErrorVerdict {
  const failing: string[] = [];
  const corroborated: CorroboratedError[] = [];
  for (const raw of pageErrors) {
    const target = parseAccessControlTarget(raw);
    if (target && target.host.toLowerCase() === ownHost.toLowerCase()) {
      const key = pathKey(target.host, target.pathname);
      const status = ok2xx.get(key);
      if (status !== undefined && status >= 200 && status < 300) {
        corroborated.push({ raw, key, status });
        continue;
      }
    }
    failing.push(raw);
  }
  return { failing, corroborated };
}
