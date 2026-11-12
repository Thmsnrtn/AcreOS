/**
 * PX-1 — robots.txt and a visit-rate limit for Pax's `browse_web`.
 *
 * `browseWeb` (server/services/browserAutomation.ts) used to fetch any public
 * page, at any rate, ignoring what the site asked of automated visitors. This
 * module is the pure half: parse a robots.txt, decide whether a path may be
 * fetched, cache the answer per site, and count visits per org per host. The
 * network half (the robots fetch itself, which must pass the same SSRF checks
 * as the page) stays in browserAutomation.ts and is injected here, so this file
 * has no I/O and is tested with fakes.
 *
 * POSTURE WHEN robots.txt CANNOT BE READ (RFC 9309 §2.3.1):
 *   - 4xx (including 404, 401, 403): the site has no robots rules → allowed.
 *   - 5xx, a network error or a timeout: UNVERIFIED → the visit is REFUSED
 *     (fail-closed), and the refusal says so honestly. The trade-off: a site
 *     with a flaky robots endpoint is unreachable until it recovers (we
 *     re-check after ROBOTS_FAILURE_TTL_MS), in exchange for never browsing a
 *     site whose wishes we could not read. That matches the fence this program
 *     exists for — when the check cannot run, nothing proceeds.
 */

import { clock } from "../utils/clock";

/** The product token a site can address in robots.txt (`User-agent: acreos`). */
const ROBOTS_AGENT_TOKEN = "acreos";

/** A fetched robots.txt is reused this long. */
const ROBOTS_CACHE_TTL_MS = 60 * 60 * 1000;
/** A failed robots fetch is remembered this long, so a down site is not hammered. */
export const ROBOTS_FAILURE_TTL_MS = 60 * 1000;
/** Bound on cached sites. */
const ROBOTS_CACHE_MAX_ENTRIES = 500;
/** Bytes of robots.txt we read (RFC 9309 asks parsers to handle at least 500 KiB). */
export const ROBOTS_MAX_BYTES = 512 * 1024;

/** At most this many page visits to one host, per org, inside the window… */
export const BROWSE_RATE_MAX_VISITS = 10;
/** …this long. */
export const BROWSE_RATE_WINDOW_MS = 5 * 60 * 1000;

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export type RobotsFetchResult =
  | { status: "ok"; body: string }
  /** The site has no robots.txt (a 4xx answer). */
  | { status: "none" }
  /** 5xx, network error, timeout, or a redirect we would not follow. */
  | { status: "error" };

export type RobotsVerdict = "allowed" | "disallowed" | "unverified";

/** Parse the rules that apply to us: our own group if the site names one, else `*`. */
export function parseRobotsTxt(text: string, agentToken: string = ROBOTS_AGENT_TOKEN): RobotsRules {
  const token = agentToken.toLowerCase();
  interface Group { agents: string[]; allow: string[]; disallow: string[] }
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.allow.push(value);
    else if (field === "disallow" && value) current.disallow.push(value);
    // An empty Disallow means "allow everything": it adds no rule.
  }

  const named = groups.filter((g) => g.agents.some((a) => a !== "" && a !== "*" && token.includes(a)));
  const chosen = named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
  };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/** Longest matching rule wins; Allow wins a tie (RFC 9309 §2.2.2). */
export function isPathAllowedByRobots(rules: RobotsRules, pathAndQuery: string): boolean {
  const target = pathAndQuery || "/";
  let best = { len: -1, allow: true };
  for (const p of rules.disallow) {
    if (p.length >= best.len && patternToRegExp(p).test(target) && p.length > best.len) best = { len: p.length, allow: false };
  }
  for (const p of rules.allow) {
    if (p.length >= best.len && patternToRegExp(p).test(target)) best = { len: p.length, allow: true };
  }
  return best.allow;
}

interface RobotsCacheEntry {
  rules: RobotsRules | null; // null = the fetch failed (unverified)
  expiresAt: number;
}

const robotsCache = new Map<string, RobotsCacheEntry>();

/**
 * May `url` be fetched? `fetchRobots` is the injected network half: given the
 * robots.txt URL for this origin it reports ok/none/error. Cached per origin.
 */
export async function checkRobots(
  url: URL,
  fetchRobots: (robotsUrl: string) => Promise<RobotsFetchResult>,
  now: number = clock.nowMs(),
): Promise<RobotsVerdict> {
  const origin = url.origin;
  let entry = robotsCache.get(origin);
  if (!entry || entry.expiresAt <= now) {
    const res = await fetchRobots(`${origin}/robots.txt`);
    if (robotsCache.size >= ROBOTS_CACHE_MAX_ENTRIES) {
      const oldest = robotsCache.keys().next().value;
      if (oldest !== undefined) robotsCache.delete(oldest);
    }
    if (res.status === "ok") {
      entry = { rules: parseRobotsTxt(res.body.slice(0, ROBOTS_MAX_BYTES)), expiresAt: now + ROBOTS_CACHE_TTL_MS };
    } else if (res.status === "none") {
      entry = { rules: { allow: [], disallow: [] }, expiresAt: now + ROBOTS_CACHE_TTL_MS };
    } else {
      entry = { rules: null, expiresAt: now + ROBOTS_FAILURE_TTL_MS };
    }
    robotsCache.set(origin, entry);
  }
  if (entry.rules === null) return "unverified";
  return isPathAllowedByRobots(entry.rules, `${url.pathname}${url.search}`) ? "allowed" : "disallowed";
}

const visits = new Map<string, number[]>();

/**
 * Count one visit to `host` for `orgId` and say whether it is within the rate.
 * A call with no org (a caller that did not say who is browsing) is limited
 * per host alone, under the key "anon" — stricter in effect, since every such
 * caller shares one budget.
 */
export function takeBrowseVisit(
  orgId: number | null | undefined,
  host: string,
  now: number = clock.nowMs(),
): { allowed: boolean } {
  const key = `${orgId ?? "anon"}:${host.toLowerCase()}`;
  const recent = (visits.get(key) ?? []).filter((t) => now - t < BROWSE_RATE_WINDOW_MS);
  if (recent.length >= BROWSE_RATE_MAX_VISITS) {
    visits.set(key, recent);
    return { allowed: false };
  }
  recent.push(now);
  visits.set(key, recent);
  if (visits.size > 5000) {
    for (const [k, v] of visits) {
      if (v.every((t) => now - t >= BROWSE_RATE_WINDOW_MS)) visits.delete(k);
    }
  }
  return { allowed: true };
}

/** Test seam. */
export function resetBrowseGuardsForTests(): void {
  robotsCache.clear();
  visits.clear();
}
