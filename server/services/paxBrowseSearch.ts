/**
 * PX-7 — Pax's bounded public-search sessions (register P-2, "browser rung 2").
 *
 * `browse_web` opens ONE address and reads it. This module lets Pax do the one
 * thing a person does next on a county assessor / recorder / treasurer site:
 * type a name or parcel number into the site's own search box, read the results
 * page, and (maybe) follow a result or the "next" link. Nothing else.
 *
 * THE STEP LANGUAGE is a closed enum — nothing outside it is representable:
 *
 *   open { url }          go to a URL (the first step, and the only way to change sites)
 *   search { query }      type `query` into the page's search box and submit it —
 *                         judged MECHANICALLY (judgeSearchForm), submitted as a GET
 *   open_result { index } follow the index-th link of the last page's extracted links
 *   next_page             follow the page's "next" link (rel=next or a next-text link)
 *   read                  hand the current page back (browseWeb's extraction + caps)
 *
 * There is no click, no free typing, no select/scroll, no script, no download
 * and no form POST; the browser behind it (openBrowseNavSession) can only
 * navigate to a URL this module hands it, and lets only GET/HEAD requests out.
 *
 * THE BOUNDS are code, not prompt (PAX_SEARCH_LIMITS): steps, pages, one site
 * per session (unless every host is on the org's "my sites" list or all share a
 * registrable domain), a per-navigation and a whole-session timeout. EVERY
 * navigation — the first and each hop — re-passes the full pre-flight
 * (preflightBrowseNavigation: SSRF patterns, private/DNS checks, the R-14 gate,
 * operator domain policy, robots.txt, the PX-1 per-org/per-host rate limit), and
 * a redirect's landing URL is re-checked too.
 *
 * A CAPTCHA or bot wall ends the session with a distinct `captcha` outcome. It
 * is never solved, waited out, retried or routed around; a login form is a
 * refusal, and the search step never types into a password field.
 *
 * LICENCE FENCE. Every page loaded is receipted like a browse_web read
 * (recordBrowseReceipt) and noted in the turn (noteBrowseInTurn), so PX-1's
 * `web:<host>` provenance and web-sourced row cap apply to anything Pax creates
 * afterwards exactly as with browse_web. This module creates no records and
 * offers no path from a result page into create_*.
 */

import { z } from "zod";
import { clock } from "../utils/clock";
import { logger } from "../utils/logger";
import { mySiteForHost, normalizeSiteHost, type PaxSiteEntry, type PaxStance } from "@shared/pax-controls";
import type {
  BrowseAnchorDescriptor,
  BrowseFormDescriptor,
  BrowseFormField,
  BrowseNavPage,
  BrowseNavSession,
  BrowseNavSessionOptions,
  BrowseNavRefusalReason,
  BrowsePreflightOutcome,
} from "./browserAutomation";
import type { noteBrowseInTurn, recordBrowseReceipt } from "./webSourceFence";
import type { PaxEffectOrigin } from "./paxReceipts";

// ── Bounds ──────────────────────────────────────────────────────────────────

export const PAX_SEARCH_LIMITS = {
  /** Steps in one session. */
  maxSteps: 8,
  /** Page LOADS (navigations) in one session, however many steps ask for one. */
  maxPages: 4,
  /** Page loads when the caller does not say. */
  defaultPages: 3,
  /** One navigation. */
  navTimeoutMs: 15_000,
  /** The whole session, Chromium launch included. */
  sessionTimeoutMs: 60_000,
  /** A search query, in characters. */
  maxQueryChars: 200,
  /** A GET URL built from a form. */
  maxUrlChars: 2000,
  /** The same caps browse_web applies to what it returns. */
  contentChars: 8000,
  linksShown: 15,
  tablesShown: 30,
  /** The model's one-line finding saved on a timeline row. */
  maxFindingChars: 500,
} as const;

// ── The step language ───────────────────────────────────────────────────────

export type PaxSearchStep =
  | { kind: "open"; url: string }
  | { kind: "search"; query: string }
  | { kind: "open_result"; index: number }
  | { kind: "next_page" }
  | { kind: "read" };

/**
 * strict() on every member: an extra key (a selector, a script, a method) is
 * not a step, and a kind that is not one of these five is not representable.
 */
const stepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), url: z.string().min(1).max(PAX_SEARCH_LIMITS.maxUrlChars) }).strict(),
  z.object({ kind: z.literal("search"), query: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal("open_result"), index: z.number().int().min(0) }).strict(),
  z.object({ kind: z.literal("next_page") }).strict(),
  z.object({ kind: z.literal("read") }).strict(),
]);

export type PaxSearchRefusalReason =
  | "step_not_allowed"
  | "too_many_steps"
  | "too_many_pages"
  | "different_site"
  | "no_page_open"
  | "no_search_form"
  | "login_form_only"
  | "ambiguous_search_form"
  | "query_not_usable"
  | "no_such_result"
  | "no_next_page"
  | "address_refused"
  | "robots_disallowed"
  | "robots_unverified"
  | "rate_limited"
  | "timed_out"
  | "did_not_load"
  | "not_a_web_page"
  | "site_error";

/** Parse a step list against the closed language: the first step is `open`, nothing unknown, within the step bound. */
export function parseSearchSteps(
  raw: unknown,
): { kind: "steps"; steps: PaxSearchStep[] } | { kind: "refused"; reason: PaxSearchRefusalReason } {
  if (!Array.isArray(raw) || raw.length === 0) return { kind: "refused", reason: "step_not_allowed" };
  if (raw.length > PAX_SEARCH_LIMITS.maxSteps) return { kind: "refused", reason: "too_many_steps" };
  const parsed = z.array(stepSchema).safeParse(raw);
  if (!parsed.success) return { kind: "refused", reason: "step_not_allowed" };
  if (parsed.data[0].kind !== "open") return { kind: "refused", reason: "step_not_allowed" };
  return { kind: "steps", steps: parsed.data };
}

// ── Sites: the gate and the one-site rule ───────────────────────────────────

export type SearchSiteResolution =
  | { kind: "allowed"; url: string; host: string; via: "my_sites" | "user_url"; label: string }
  | { kind: "refused"; reason: "not_an_address" | "site_not_listed" };

/**
 * THE SITE GATE. A search session may start only on:
 *   - a site on the org's "my sites" list (named by its label, its bare host,
 *     or any http(s) address on that host), or
 *   - the exact host of a FULL address (http:// or https://) given as the
 *     tool's `site` argument — a person pointing Pax at a page is the same act
 *     as browse_web's open URL (the argument is model-written, so this trusts
 *     exactly what browse_web trusts; it widens nothing, and the licence fence
 *     still applies to everything read).
 * A bare name or host that is not listed is refused. Empty list = nothing is
 * allowed by listing (fail-closed); only a full address can start a session.
 */
export function resolveSearchSite(site: unknown, mySites: readonly PaxSiteEntry[]): SearchSiteResolution {
  const raw = typeof site === "string" ? site.trim() : "";
  if (!raw || raw.length > PAX_SEARCH_LIMITS.maxUrlChars) return { kind: "refused", reason: "not_an_address" };

  const byLabel = mySites.find((s) => s.label.trim().toLowerCase() === raw.toLowerCase());
  if (byLabel) return { kind: "allowed", url: `https://${byLabel.host}/`, host: byLabel.host, via: "my_sites", label: byLabel.label };

  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { kind: "refused", reason: "not_an_address" };
    }
    if (url.username || url.password) return { kind: "refused", reason: "not_an_address" };
    const host = normalizeSiteHost(url.hostname);
    if (!host) return { kind: "refused", reason: "not_an_address" };
    const listed = mySiteForHost(mySites, host);
    return { kind: "allowed", url: url.toString(), host, via: listed ? "my_sites" : "user_url", label: listed?.label ?? host };
  }

  // Some other scheme (javascript:, ftp://, data:) is not a website address at all.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return { kind: "refused", reason: "not_an_address" };

  // A bare name or host: usable only if it is on the list. A name that is not on
  // the list (or not even a host) is "not listed" — saying a site's name does not add it.
  const bareHost = normalizeSiteHost(raw);
  const listed = bareHost ? mySiteForHost(mySites, bareHost) : null;
  if (!listed) return { kind: "refused", reason: "site_not_listed" };
  return { kind: "allowed", url: `https://${listed.host}/`, host: listed.host, via: "my_sites", label: listed.label };
}

const withoutWww = (host: string): string => {
  const h = String(host ?? "").trim().toLowerCase().replace(/\.$/, "");
  return h.startsWith("www.") ? h.slice(4) : h;
};

/** Second-level labels that make a two-letter country code a public suffix (co.uk, com.au, …). */
const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or"]);

/**
 * An approximation of the registrable domain without a public-suffix list,
 * biased toward NARROW (two hosts compare equal only when clearly one site):
 *   assessor.maricopa.gov        → maricopa.gov
 *   www.co.cochise.az.us         → co.cochise.az.us   (a .us locality domain keeps up to four labels)
 *   records.example.co.uk        → example.co.uk
 */
export function registrableDomainOf(hostname: string): string {
  const labels = withoutWww(hostname).split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  if (tld === "us" && second.length === 2) return labels.slice(-4).join(".");
  if (tld.length === 2 && SECOND_LEVEL_LABELS.has(second)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/**
 * May a session that has visited `hosts` (the candidate included) continue?
 * One host (www-agnostic), or every host listed under "my sites", or every
 * host on one registrable domain.
 */
export function sessionHostsAllowed(hosts: readonly string[], mySites: readonly PaxSiteEntry[]): boolean {
  const unique = [...new Set(hosts.map(withoutWww).filter(Boolean))];
  if (unique.length === 0) return false;
  if (unique.length === 1) return true;
  if (unique.every((h) => mySiteForHost(mySites, h) !== null)) return true;
  return new Set(unique.map(registrableDomainOf)).size === 1;
}

// ── The search-form judge (mechanical — the model never picks a selector) ───

/** Fields that look like a search box. Long tokens match anywhere in name/id/placeholder/label… */
const SEARCH_FIELD_WORDS = /search|query|keyword|find|lookup|owner|parcel|apn|address|situs/i;
/** …short ones only as the whole name. */
const SEARCH_FIELD_SHORT_NAMES = /^(q|s|term|terms)$/i;
/** Text inputs that are plainly not a search box (a sign-up or contact form's fields). */
const NOT_A_SEARCH_FIELD = /e-?mail|phone|user(name)?|login|pass(word)?|zip|newsletter|subscribe|captcha|coupon|comment|message/i;

function fieldLabels(f: BrowseFormField): string[] {
  return [f.name, f.id, f.placeholder, f.ariaLabel].filter((s) => s.length > 0);
}

function looksLikeSearchField(f: BrowseFormField): boolean {
  if (f.type === "search") return true;
  return fieldLabels(f).some((s) => SEARCH_FIELD_WORDS.test(s) || SEARCH_FIELD_SHORT_NAMES.test(s));
}

/** A text/search <input>, rendered, enabled and named — NEVER password, hidden, textarea, select or any other type. */
function isSearchInputCandidate(f: BrowseFormField): boolean {
  if (f.tag !== "input") return false;
  if (f.type !== "text" && f.type !== "search") return false;
  if (f.hidden || f.disabled) return false;
  if (!f.name) return false;
  if (fieldLabels(f).some((s) => NOT_A_SEARCH_FIELD.test(s))) return false;
  return true;
}

const hasPasswordField = (form: BrowseFormDescriptor): boolean => form.fields.some((f) => f.type === "password");
const hasFileField = (form: BrowseFormDescriptor): boolean => form.fields.some((f) => f.type === "file");

/** A query with control characters removed and whitespace collapsed, capped; "" when nothing usable is left. */
export function cleanSearchQuery(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, PAX_SEARCH_LIMITS.maxQueryChars);
}

export type SearchFormJudgement =
  | { kind: "form"; url: string; inputName: string }
  | { kind: "refused"; reason: "no_search_form" | "login_form_only" | "ambiguous_search_form" | "query_not_usable" };

/**
 * Pick the page's search form and build the GET URL that submits it.
 *
 * A form QUALIFIES only if: its method is GET (absent = GET; a POST form is
 * never re-sent as a GET — that would change what the request means), it holds
 * no password and no file field, its action is an http(s) address, and it has
 * exactly one identifiable search input (a rendered, enabled, NAMED text/search
 * <input>: the sole such input, or the sole one that looks like a search box).
 * Several qualifying forms: the first whose input is unmistakably a search box;
 * otherwise a lone qualifier; otherwise `ambiguous_search_form` — Pax does not
 * guess. If every form on the page has a password field the page is a login
 * wall: `login_form_only`.
 *
 * The URL is built the way a browser submits a GET form: the action with its
 * old query dropped, then every named, enabled control in document order —
 * hidden fields at their defaults, the chosen input set to the query,
 * checkboxes/radios only if checked, selects at their selected value, and no
 * submit/button/file/password control.
 */
export function judgeSearchForm(forms: readonly BrowseFormDescriptor[], query: unknown): SearchFormJudgement {
  const q = cleanSearchQuery(query);
  if (!q) return { kind: "refused", reason: "query_not_usable" };

  interface Qualified { form: BrowseFormDescriptor; input: BrowseFormField; strong: boolean }
  const qualified: Qualified[] = [];
  let sawAmbiguous = false;

  for (const form of forms) {
    if (form.method !== "get") continue;
    if (hasPasswordField(form) || hasFileField(form)) continue;
    let action: URL;
    try {
      action = new URL(form.action);
    } catch {
      continue;
    }
    if (action.protocol !== "http:" && action.protocol !== "https:") continue;

    const candidates = form.fields.filter(isSearchInputCandidate);
    const matched = candidates.filter(looksLikeSearchField);
    const input = candidates.length === 1 ? candidates[0] : matched.length === 1 ? matched[0] : null;
    if (!input) {
      if (candidates.length > 1) sawAmbiguous = true;
      continue;
    }
    qualified.push({ form, input, strong: looksLikeSearchField(input) });
  }

  if (qualified.length === 0) {
    if (forms.length > 0 && forms.every(hasPasswordField)) return { kind: "refused", reason: "login_form_only" };
    return { kind: "refused", reason: sawAmbiguous ? "ambiguous_search_form" : "no_search_form" };
  }
  const chosen = qualified.find((c) => c.strong) ?? (qualified.length === 1 ? qualified[0] : null);
  if (!chosen) return { kind: "refused", reason: "ambiguous_search_form" };

  const url = new URL(chosen.form.action);
  url.search = "";
  url.hash = "";
  for (const f of chosen.form.fields) {
    if (f.disabled || !f.name) continue;
    if (f === chosen.input) {
      url.searchParams.append(f.name, q);
      continue;
    }
    if (f.tag === "button") continue;
    if (f.type === "password" || f.type === "file") continue;
    if (f.type === "submit" || f.type === "button" || f.type === "image" || f.type === "reset") continue;
    if ((f.type === "checkbox" || f.type === "radio") && !f.checked) continue;
    url.searchParams.append(f.name, f.value);
  }
  const built = url.toString();
  if (built.length > PAX_SEARCH_LIMITS.maxUrlChars) return { kind: "refused", reason: "query_not_usable" };
  return { kind: "form", url: built, inputName: chosen.input.name };
}

// ── Links: results and "next" ───────────────────────────────────────────────

/** Visible text of a "next page" link: next, next page, ›, », >, >> (and "next" with an arrow). */
const NEXT_LINK_TEXTS = new Set(["next", "next page", "next >", "next ›", "next »", ">", "›", "»", ">>"]);

function httpUrlOrNull(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const u = new URL(trimmed, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The page's next-page address: a rel=next link first, else the first link whose text is a next pattern. Null when absent. */
export function findNextLink(anchors: readonly BrowseAnchorDescriptor[], pageUrl: string): string | null {
  const here = httpUrlOrNull(pageUrl, pageUrl);
  const byRel = anchors.find((a) => a.rel.split(/\s+/).includes("next"));
  if (byRel) {
    const u = httpUrlOrNull(byRel.href, pageUrl);
    if (u && u !== here) return u;
  }
  for (const a of anchors) {
    if (!NEXT_LINK_TEXTS.has(a.text.trim().toLowerCase().replace(/\s+/g, " "))) continue;
    const u = httpUrlOrNull(a.href, pageUrl);
    if (u && u !== here) return u;
  }
  return null;
}

/** The index-th link of the links the model was shown (the first `linksShown`), as an absolute address; null when out of range. */
export function resolveResultLink(
  links: readonly { text: string; href: string }[],
  index: number,
  pageUrl: string,
): string | null {
  const shown = links.slice(0, PAX_SEARCH_LIMITS.linksShown);
  if (!Number.isInteger(index) || index < 0 || index >= shown.length) return null;
  return httpUrlOrNull(shown[index].href, pageUrl);
}

// ── CAPTCHA / bot walls ─────────────────────────────────────────────────────

/** Challenge ELEMENTS and IFRAMES in the page's HTML (an invisible reCAPTCHA is not one — nothing is asked of anyone). */
const CHALLENGE_HTML_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/<div\b(?![^>]*data-size=["']invisible["'])[^>]*class=["'][^"']*\bg-recaptcha\b/i, "reCAPTCHA widget"],
  [/<iframe\b[^>]*src=["'][^"']*recaptcha\/api2\/bframe/i, "reCAPTCHA challenge frame"],
  [/<(?:div|iframe)\b[^>]*(?:class|src)=["'][^"']*\bh-?captcha\b/i, "hCaptcha"],
  [/<iframe\b[^>]*src=["'][^"']*hcaptcha\.com/i, "hCaptcha frame"],
  [/<div\b[^>]*class=["'][^"']*\bcf-turnstile\b/i, "Turnstile widget"],
  [/<iframe\b[^>]*src=["'][^"']*challenges\.cloudflare\.com/i, "Cloudflare challenge frame"],
  [/\bid=["']challenge-form["']|\bcf-chl-|\bchallenge-running\b/i, "Cloudflare challenge page"],
  [/px-captcha|captcha-delivery\.com|\bgeo\.captcha-delivery/i, "bot-wall script"],
];

/** Wording of a challenge or bot-wall page, matched against the page's TITLE and visible TEXT. */
const CHALLENGE_TEXT_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\bjust a moment\.\.\./i, "interstitial title"],
  [/attention required! \| cloudflare/i, "Cloudflare block title"],
  [/checking your browser before accessing/i, "browser check"],
  [/verify (?:that )?you are (?:a )?human|verify you(?:'|’)re (?:a )?human|confirm you are (?:a )?human/i, "human check"],
  [/are you a (?:robot|human)\b/i, "robot check"],
  [/unusual traffic from your computer network/i, "unusual traffic"],
  [/please complete the (?:security|captcha) (?:check|challenge)/i, "security check"],
  [/press (?:&|and) hold to confirm you are/i, "press-and-hold check"],
  [/used cloudflare to restrict access|sorry, you have been blocked/i, "blocked by edge service"],
  [/enable javascript and cookies to continue/i, "interstitial text"],
];

/** A 403/429 whose body speaks of a challenge or a block. */
const BLOCKED_STATUS_BODY = /captcha|challenge|cloudflare|are you (?:a )?(?:human|robot)|\bbots?\b|automated|access denied|blocked|unusual traffic|security check/i;

export interface ChallengeVerdict {
  detected: boolean;
  /** What matched — for logs and tests, never shown to a person. */
  marker: string | null;
}

/** Is this page a CAPTCHA or bot wall? Purely a read of what loaded; it never retries or interacts. */
export function detectChallenge(page: { html: string; text: string; title: string; httpStatus: number | null }): ChallengeVerdict {
  const html = String(page.html ?? "");
  const words = `${page.title ?? ""}\n${page.text ?? ""}`;
  for (const [re, name] of CHALLENGE_HTML_MARKERS) if (re.test(html)) return { detected: true, marker: name };
  for (const [re, name] of CHALLENGE_TEXT_MARKERS) if (re.test(words)) return { detected: true, marker: name };
  if ((page.httpStatus === 403 || page.httpStatus === 429) && BLOCKED_STATUS_BODY.test(`${words}\n${html}`)) {
    return { detected: true, marker: `HTTP ${page.httpStatus} with a block or challenge body` };
  }
  return { detected: false, marker: null };
}

// ── The session ─────────────────────────────────────────────────────────────

export interface PaxSearchPageRead {
  url: string;
  title: string;
  content: string;
  links: { text: string; href: string }[];
  tables: string[];
}

export type PaxSearchOutcome =
  /** At least one page was handed back (or the plan had no `read`); `stoppedEarly` names a bound/refusal that ended it sooner. */
  | { kind: "done"; pages: PaxSearchPageRead[]; trail: string[]; stoppedEarly: PaxSearchRefusalReason | null }
  /** A CAPTCHA / bot wall. Never solved, never retried. */
  | { kind: "captcha"; host: string; trail: string[]; pages: PaxSearchPageRead[] }
  | { kind: "refused"; reason: PaxSearchRefusalReason; trail: string[]; pages: PaxSearchPageRead[] };

export interface PaxSearchInput {
  orgId: number;
  userId?: string | null;
  origin: PaxEffectOrigin;
  turnId?: string | null;
  /** The org's "my sites" list — what makes a second host acceptable. */
  mySites: readonly PaxSiteEntry[];
  /** The plan, validated against the closed language here (unknown input is `step_not_allowed`). */
  steps: unknown;
  /** Page loads allowed (default 3, never above PAX_SEARCH_LIMITS.maxPages). */
  maxPages?: number;
}

/** The seams: the real ones are loaded lazily so importing this module (the judge) pulls in no browser and no database. */
export interface PaxSearchDeps {
  preflight: (url: string, options: { orgId: number; takeVisit?: boolean }) => Promise<BrowsePreflightOutcome>;
  openNavigator: (options: BrowseNavSessionOptions) => Promise<BrowseNavSession>;
  recordReceipt: typeof recordBrowseReceipt;
  noteBrowse: typeof noteBrowseInTurn;
  nowMs: () => number;
}

async function defaultDeps(): Promise<PaxSearchDeps> {
  const { preflightBrowseNavigation, openBrowseNavSession } = await import("./browserAutomation");
  const { recordBrowseReceipt, noteBrowseInTurn } = await import("./webSourceFence");
  return {
    preflight: (url, options) => preflightBrowseNavigation(url, options),
    openNavigator: (options) => openBrowseNavSession(options),
    recordReceipt: recordBrowseReceipt,
    noteBrowse: noteBrowseInTurn,
    nowMs: () => clock.nowMs(),
  };
}

const PREFLIGHT_REASON: Record<BrowseNavRefusalReason, PaxSearchRefusalReason> = {
  address_blocked: "address_refused",
  private_address: "address_refused",
  unresolvable: "address_refused",
  site_policy: "address_refused",
  request_blocked: "address_refused",
  robots_disallowed: "robots_disallowed",
  robots_unverified: "robots_unverified",
  rate_limited: "rate_limited",
};

/** An address without its query string or fragment (they can carry tokens, and the query is the person's own search). */
function trailUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "";
  }
}

function pageRead(page: BrowseNavPage): PaxSearchPageRead {
  return {
    url: page.url,
    title: page.title,
    content: page.content.substring(0, PAX_SEARCH_LIMITS.contentChars),
    links: page.links.slice(0, PAX_SEARCH_LIMITS.linksShown),
    tables: page.tables.slice(0, PAX_SEARCH_LIMITS.tablesShown),
  };
}

/** Race `work` against `ms`; a timeout resolves to null (the caller then ends the session and closes the browser). */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(1, ms));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run one bounded search session. Never throws for a refusal (a refusal is an
 * outcome); an unexpected failure is logged and reported as `did_not_load`.
 * The browser is closed on every path.
 */
export async function runPaxSearchSession(input: PaxSearchInput, injected?: PaxSearchDeps): Promise<PaxSearchOutcome> {
  const parsed = parseSearchSteps(input.steps);
  if (parsed.kind === "refused") return { kind: "refused", reason: parsed.reason, trail: [], pages: [] };
  const steps = parsed.steps;

  const deps = injected ?? (await defaultDeps());
  const limits = PAX_SEARCH_LIMITS;
  const maxPages = Math.min(Math.max(1, Math.floor(input.maxPages ?? limits.defaultPages)), limits.maxPages);
  const deadline = deps.nowMs() + limits.sessionTimeoutMs;

  const hosts: string[] = [];
  const trail: string[] = [];
  const reads: PaxSearchPageRead[] = [];
  let navigations = 0;
  let current: BrowseNavPage | null = null;
  let navigator: BrowseNavSession | null = null;

  const allowHost = (hostname: string) => sessionHostsAllowed([...hosts, hostname], input.mySites);
  /** A stop: with something already read it is a (shorter) success; with nothing it is a refusal. */
  const stop = (reason: PaxSearchRefusalReason): PaxSearchOutcome =>
    reads.length > 0
      ? { kind: "done", pages: reads, trail, stoppedEarly: reason }
      : { kind: "refused", reason, trail, pages: [] };

  const receipt = (url: string, outcome: "read" | "refused" | "failed") =>
    deps.recordReceipt({ orgId: input.orgId, userId: input.userId ?? null, origin: input.origin, turnId: input.turnId ?? null, url, outcome });

  try {
    for (const step of steps) {
      if (deps.nowMs() >= deadline) return stop("timed_out");

      let target: string | null = null;
      if (step.kind === "read") {
        if (!current) return stop("no_page_open");
        if (!reads.some((r) => r.url === current!.url)) reads.push(pageRead(current));
        continue;
      }
      if (step.kind === "open") {
        target = step.url;
      } else {
        if (!current) return stop("no_page_open");
        if (step.kind === "search") {
          const judged = judgeSearchForm(current.forms, step.query);
          if (judged.kind === "refused") return stop(judged.reason);
          target = judged.url;
        } else if (step.kind === "open_result") {
          target = resolveResultLink(current.links, step.index, current.url);
          if (!target) return stop("no_such_result");
        } else {
          target = findNextLink(current.anchors, current.url);
          if (!target) return stop("no_next_page");
        }
      }

      if (navigations >= maxPages) return stop("too_many_pages");
      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
      } catch {
        return stop("address_refused");
      }
      if (!allowHost(targetUrl.hostname)) {
        await receipt(targetUrl.toString(), "refused");
        return stop("different_site");
      }

      // EVERY navigation re-passes the full pre-flight, the first one included.
      const pre = await deps.preflight(targetUrl.toString(), { orgId: input.orgId });
      if (pre.kind === "refused") {
        logger.info("[browse_search] Navigation refused before fetch", { orgId: input.orgId, metadata: { reason: pre.reason, host: targetUrl.hostname } });
        await receipt(targetUrl.toString(), "refused");
        return stop(PREFLIGHT_REASON[pre.reason]);
      }
      hosts.push(targetUrl.hostname);

      if (!navigator) {
        const launching = deps.openNavigator({ allowNavigationHost: allowHost, navTimeoutMs: limits.navTimeoutMs });
        const opened = await withTimeout(launching, deadline - deps.nowMs());
        if (!opened) {
          // A browser that finishes launching after the session gave up is closed, not leaked.
          void launching.then((late) => late.close()).catch(() => {});
          return stop("timed_out");
        }
        navigator = opened;
      }
      navigations += 1;
      trail.push(trailUrl(targetUrl.toString()));

      const outcome = await withTimeout(navigator.navigate(targetUrl.toString()), Math.min(limits.navTimeoutMs + 5_000, deadline - deps.nowMs()));
      if (!outcome) {
        await receipt(targetUrl.toString(), "failed");
        return stop("timed_out");
      }
      if (outcome.kind === "refused") {
        await receipt(targetUrl.toString(), outcome.reason === "left_site" || outcome.reason === "not_a_web_page" ? "refused" : "failed");
        return stop(outcome.reason === "left_site" ? "different_site" : outcome.reason);
      }

      const page = outcome.page;
      const challenge = detectChallenge({ html: page.html, text: page.content, title: page.title, httpStatus: page.httpStatus });
      if (challenge.detected) {
        // A human check. Receipted as a refused attempt; never solved, waited out or retried.
        logger.info("[browse_search] Human check met — stopping", { orgId: input.orgId, metadata: { host: targetUrl.hostname, marker: challenge.marker } });
        await receipt(page.url || targetUrl.toString(), "refused");
        return { kind: "captcha", host: targetUrl.hostname, trail, pages: reads };
      }
      if (page.httpStatus !== null && page.httpStatus >= 400) {
        await receipt(page.url || targetUrl.toString(), "failed");
        return stop("site_error");
      }

      // A redirect's landing URL is a navigation too: re-pass the pre-flight
      // (without spending another visit) before anything on it is used.
      if (page.url && page.url !== targetUrl.toString()) {
        const landing = await deps.preflight(page.url, { orgId: input.orgId, takeVisit: false });
        if (landing.kind === "refused") {
          await receipt(page.url, "refused");
          return stop(PREFLIGHT_REASON[landing.reason]);
        }
        try {
          hosts.push(new URL(page.url).hostname);
        } catch {
          return stop("address_refused");
        }
      }

      current = page;
      await receipt(page.url, "read");
      try {
        deps.noteBrowse(input.orgId, input.turnId, new URL(page.url).hostname);
      } catch {
        // an unparseable landing URL cannot be noted; the receipt above stands
      }
    }
    return { kind: "done", pages: reads, trail, stoppedEarly: null };
  } catch (err) {
    logger.error("[browse_search] Session failed", err as Error, { orgId: input.orgId });
    return stop("did_not_load");
  } finally {
    if (navigator) await navigator.close().catch(() => {});
  }
}

// ── The timeline note ───────────────────────────────────────────────────────

export type PaxSearchAttachKind = "lead" | "property" | "deal";

/** The model's one-line finding, made safe for a timeline row: control characters out, whitespace collapsed, capped. */
function cleanFinding(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, PAX_SEARCH_LIMITS.maxFindingChars);
}

/**
 * Write ONE timeline row on the record the search was about — the provenance-
 * tagged note. The full extracted text goes back to the conversation, never
 * into the timeline; the row holds a short summary, the host and address (no
 * query string), the query, and `source: web:<host>`.
 *
 * Skipped while Pax is paused (or its controls cannot be verified): browse_search
 * is pause-safe because it only LOOKS, and a note on a customer's record is a
 * write — so a paused Pax still searches and answers, and saves nothing. The
 * caller passes the pause state it ALREADY read for the site gate (one read
 * per call; this module is not a second reader of the pause), and anything but
 * an explicit `paused: false` skips the note.
 */
export async function attachSearchNote(input: {
  orgId: number;
  userId?: string | null;
  origin: PaxEffectOrigin;
  /** The org's pause state as the caller read it; only `false` allows the write. */
  paused: boolean;
  /** The org's stance at the time, or null when its controls could not be verified. */
  stance: PaxStance | null;
  kind: PaxSearchAttachKind;
  id: number;
  host: string;
  url: string;
  query: string;
  finding?: unknown;
  pagesRead: number;
}): Promise<{ attached: boolean; skipped: "paused" | "not_saved" | null }> {
  try {
    if (input.paused !== false) return { attached: false, skipped: "paused" };

    const { recordPaxEffect } = await import("./paxReceipts");
    const finding = cleanFinding(input.finding);
    const query = cleanSearchQuery(input.query).slice(0, 80);
    const where = trailUrl(input.url);
    const written = await recordPaxEffect({
      orgId: input.orgId,
      actor: "pax",
      origin: input.origin,
      stance: input.stance,
      tool: "browse_search",
      action: "browse_search",
      entityType: input.kind,
      entityId: input.id,
      description: `Searched ${input.host} for "${query}" — ${finding || `read ${input.pagesRead} ${input.pagesRead === 1 ? "page" : "pages"}, no summary saved`}`,
      after: { host: input.host, url: where, query, source: `web:${input.host}` },
      witnessed: false,
      userId: input.userId ?? null,
    });
    return written.written ? { attached: true, skipped: null } : { attached: false, skipped: "not_saved" };
  } catch (err) {
    logger.error("[browse_search] Timeline note failed — the search stands, the note does not", err as Error, { orgId: input.orgId });
    return { attached: false, skipped: "not_saved" };
  }
}
