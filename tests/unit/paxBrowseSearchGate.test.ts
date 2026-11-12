/**
 * PX-7 — every navigation of a Pax search session re-passes the FULL pre-flight,
 * and every page it loads is receipted and noted in the turn.
 *
 * Three claims, each falsifiable:
 *
 *   1. `preflightBrowseNavigation` (server/services/browserAutomation.ts) is the
 *      pre-flight browseWeb runs, as one callable: a private address, a
 *      resolved-private host, an operator-denied domain, a robots.txt-disallowed
 *      path, an unreadable robots.txt and a rate-limited host each REFUSE before
 *      anything is fetched — through the real gate functions with only DNS and
 *      the robots fetch injected. A source pin shows browseWeb and the new
 *      callable reach the SAME gate functions (no second copy of a rule).
 *   2. The session runner calls that pre-flight once per navigation — the
 *      first and every hop — and a refusal means the browser is never asked.
 *      A redirect's landing URL is re-checked (without spending another visit).
 *   3. Receipts and provenance: each page loaded writes the SAME receipt
 *      browse_web writes (tool "browse_web", outcome read/refused/failed, URL
 *      without its query), a refused or CAPTCHA attempt is receipted "refused",
 *      and the turn registry notes the host so PX-1's fence applies: the real
 *      checkWebSourcedRows then sees the turn as web-sourced and refuses a
 *      page's worth of rows.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const H = vi.hoisted(() => ({
  logActivity: vi.fn(async (_row: Record<string, unknown>) => undefined as unknown),
}));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({ storage: { logActivity: H.logActivity }, db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { preflightBrowseNavigation } from "../../server/services/browserAutomation";
import {
  BROWSE_RATE_MAX_VISITS,
  resetBrowseGuardsForTests,
  type RobotsFetchResult,
} from "../../server/services/browseRobots";
import {
  WEB_SOURCED_ROW_CAP,
  checkWebSourcedRows,
  noteBrowseInTurn,
  recordBrowseReceipt,
  resetBrowseRegistryForTests,
} from "../../server/services/webSourceFence";
import { runPaxSearchSession, type PaxSearchDeps } from "../../server/services/paxBrowseSearch";
import type { BrowseFormDescriptor, BrowseNavOutcome, BrowseNavPage } from "../../server/services/browserAutomation";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

const publicDns = {
  resolve4: async () => ["93.184.216.34"],
  resolve6: async () => {
    throw new Error("no AAAA");
  },
};
const privateDns = {
  resolve4: async () => ["10.0.0.9"],
  resolve6: async () => {
    throw new Error("no AAAA");
  },
};
const robotsOk = (body = ""): (() => Promise<RobotsFetchResult>) => async () => ({ status: "ok", body });

const savedDeny = process.env.BROWSE_WEB_DOMAIN_DENYLIST;
beforeEach(() => {
  vi.clearAllMocks();
  resetBrowseGuardsForTests();
  resetBrowseRegistryForTests();
  delete process.env.BROWSE_WEB_DOMAIN_DENYLIST;
});
afterEach(() => {
  if (savedDeny === undefined) delete process.env.BROWSE_WEB_DOMAIN_DENYLIST;
  else process.env.BROWSE_WEB_DOMAIN_DENYLIST = savedDeny;
});

// ── 1. The pre-flight itself ────────────────────────────────────────────────

describe("preflightBrowseNavigation refuses before anything is fetched", () => {
  it("passes a public address with a permissive robots.txt", async () => {
    const r = await preflightBrowseNavigation("https://assessor.example.gov/search?q=Doe", {
      orgId: 7,
      deps: { dns: publicDns, fetchRobots: robotsOk("User-agent: *\nDisallow: /admin") },
    });
    expect(r.kind).toBe("clear");
  });

  it.each([
    ["a private literal", "http://10.0.0.5/search"],
    ["an internal name", "http://localhost/search"],
    ["a metadata address", "http://169.254.169.254/latest"],
    ["an IPv6 literal", "http://[::1]/search"],
    ["not http(s)", "file:///etc/passwd"],
    ["not a URL", "not a url"],
  ])("refuses %s — and never reads robots.txt", async (_name, url) => {
    const fetchRobots = vi.fn(robotsOk());
    const r = await preflightBrowseNavigation(url, { orgId: 7, deps: { dns: publicDns, fetchRobots } });
    expect(r.kind).toBe("refused");
    expect(fetchRobots).not.toHaveBeenCalled();
  });

  it("refuses a public-looking name that RESOLVES to a private address", async () => {
    const fetchRobots = vi.fn(robotsOk());
    const r = await preflightBrowseNavigation("https://sneaky.example.gov/search", { orgId: 7, deps: { dns: privateDns, fetchRobots } });
    expect(r).toMatchObject({ kind: "refused", reason: "private_address" });
    expect(fetchRobots).not.toHaveBeenCalled();
  });

  it("refuses a host that does not resolve (blocked as a precaution)", async () => {
    const none = { resolve4: async () => { throw new Error("nx"); }, resolve6: async () => { throw new Error("nx"); } };
    const r = await preflightBrowseNavigation("https://gone.example.gov/", { orgId: 7, deps: { dns: none, fetchRobots: robotsOk() } });
    expect(r).toMatchObject({ kind: "refused", reason: "unresolvable" });
  });

  it("applies the operator's domain policy on the hop, not just at the tool boundary", async () => {
    process.env.BROWSE_WEB_DOMAIN_DENYLIST = "example.gov";
    const fetchRobots = vi.fn(robotsOk());
    const r = await preflightBrowseNavigation("https://assessor.example.gov/search", { orgId: 7, deps: { dns: publicDns, fetchRobots } });
    expect(r).toMatchObject({ kind: "refused", reason: "site_policy" });
    expect(fetchRobots).not.toHaveBeenCalled();
  });

  it("refuses a path robots.txt disallows (the search URL, with its query, is what is judged)", async () => {
    const deps = { dns: publicDns, fetchRobots: robotsOk("User-agent: *\nDisallow: /search") };
    const blocked = await preflightBrowseNavigation("https://assessor.example.gov/search?q=Doe", { orgId: 7, deps });
    expect(blocked).toMatchObject({ kind: "refused", reason: "robots_disallowed" });
    const allowed = await preflightBrowseNavigation("https://assessor.example.gov/records", { orgId: 7, deps });
    expect(allowed.kind).toBe("clear");
  });

  it("refuses when robots.txt cannot be read — it does not guess", async () => {
    const r = await preflightBrowseNavigation("https://flaky.example.gov/search", {
      orgId: 7,
      deps: { dns: publicDns, fetchRobots: async () => ({ status: "error" }) },
    });
    expect(r).toMatchObject({ kind: "refused", reason: "robots_unverified" });
  });

  it("applies the PX-1 per-org/per-host rate limit, and a landing re-check does not spend a visit", async () => {
    const deps = { dns: publicDns, fetchRobots: robotsOk() };
    const url = "https://busy.example.gov/search";
    for (let i = 0; i < BROWSE_RATE_MAX_VISITS; i++) {
      expect((await preflightBrowseNavigation(url, { orgId: 7, deps })).kind, `visit ${i + 1}`).toBe("clear");
    }
    expect(await preflightBrowseNavigation(url, { orgId: 7, deps })).toMatchObject({ kind: "refused", reason: "rate_limited" });
    // another org has its own budget
    expect((await preflightBrowseNavigation(url, { orgId: 8, deps })).kind).toBe("clear");
    // a re-check that is told not to count passes while the budget is spent for org 7
    expect((await preflightBrowseNavigation(url, { orgId: 7, takeVisit: false, deps })).kind).toBe("clear");
  });
});

describe("one rule, one implementation: browseWeb and the pre-flight reach the same gate functions", () => {
  const src = stripComments(fs.readFileSync(path.join(ROOT, "server/services/browserAutomation.ts"), "utf8"));
  const between = (from: string, to: string) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a + from.length);
    expect(a, `${from} not found`).toBeGreaterThan(-1);
    expect(b, `${to} not found after ${from}`).toBeGreaterThan(a);
    return src.slice(a, b);
  };
  const browseWeb = between("export async function browseWeb(", "export interface BrowsePreflightDeps");
  const preflight = between("export async function preflightBrowseNavigation(", "export interface BrowseFormField");

  it.each([
    "isBlockedUrl(",
    "isPrivateIpv4(",
    "isPrivateIpv6(",
    "resolveAndCheckHost(",
    "evaluateBrowseRequest(",
    "checkRobots(",
    "fetchRobotsTxt",
    "takeBrowseVisit(",
  ])("both call %s", (needle) => {
    expect(browseWeb, `browseWeb no longer calls ${needle}`).toContain(needle);
    expect(preflight, `preflightBrowseNavigation does not call ${needle}`).toContain(needle);
  });

  it("the pre-flight also applies the operator domain policy", () => {
    expect(preflight).toContain("checkBrowseDomainPolicy(");
  });

  it("the navigation session lets only GET/HEAD out and re-checks every request through the R-14 gate", () => {
    const session = between("export async function openBrowseNavSession(", "export async function executeAdHocAutomation(");
    expect(session).toContain("evaluateBrowseRequest(");
    expect(session).toMatch(/method !== "GET" && method !== "HEAD"/);
    expect(session).toContain("allowNavigationHost");
    // fail-closed: the only continue() is behind a positive decision
    expect(session.match(/request\.continue\(\)/g)?.length).toBe(1);
    // and it exposes no way to type, click or script from outside
    for (const forbidden of [".click(", ".type(", ".keyboard", ".mouse", "page.select(", "setCookie(", "waitForSelector("]) {
      expect(session, `the navigation session uses ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ── 2 + 3. The runner, with the real receipt writer and turn registry ───────

const START = "https://assessor.example.gov/";
const RESULTS = "https://assessor.example.gov/search?q=Doe";

const searchForm: BrowseFormDescriptor = {
  method: "get",
  action: "https://assessor.example.gov/search",
  fields: [
    { tag: "input", type: "text", name: "q", id: "", placeholder: "Search", ariaLabel: "", value: "", checked: false, hidden: false, disabled: false },
  ],
};
const mk = (url: string, o: Partial<BrowseNavPage> = {}): BrowseNavPage => ({
  url,
  title: "Assessor",
  content: "Parcel 100-001",
  links: [],
  tables: [],
  httpStatus: 200,
  html: "<html></html>",
  forms: [],
  anchors: [],
  ...o,
});

function scripted(opts: {
  pages: Record<string, BrowseNavOutcome>;
  preflight?: (url: string, takeVisit: boolean | undefined) => { kind: "clear" } | { kind: "refused"; reason: string };
}) {
  const calls = { preflight: [] as Array<{ url: string; takeVisit: boolean | undefined }>, navigate: [] as string[] };
  const deps: PaxSearchDeps = {
    preflight: (async (url: string, o: { takeVisit?: boolean }) => {
      calls.preflight.push({ url, takeVisit: o.takeVisit });
      const v: { kind: "clear" } | { kind: "refused"; reason: string } = opts.preflight?.(url, o.takeVisit) ?? { kind: "clear" };
      return v.kind === "clear" ? { kind: "clear", url: new URL(url) } : { kind: "refused", reason: v.reason, detail: "" };
    }) as unknown as PaxSearchDeps["preflight"],
    openNavigator: async () => ({
      navigate: async (url: string) => {
        calls.navigate.push(url);
        return opts.pages[url] ?? ({ kind: "refused", reason: "did_not_load", detail: "no fixture" } as BrowseNavOutcome);
      },
      close: async () => {},
    }),
    recordReceipt: recordBrowseReceipt,
    noteBrowse: noteBrowseInTurn,
    nowMs: () => Date.now(),
  };
  return { deps, calls };
}

const receiptsWritten = () =>
  H.logActivity.mock.calls
    .map((c) => c[0] as { metadata?: { tool?: string }; changes?: { after?: { host: string; url: string; outcome: string; turnId: string | null } } })
    .filter((r) => r.metadata?.tool === "browse_web")
    .map((r) => r.changes!.after!);

const lastReceipt = () => {
  const all = receiptsWritten();
  return all[all.length - 1];
};

const base = { orgId: 7, userId: "u-1", origin: "chat" as const, mySites: [] as { host: string; label: string }[] };
const plan = (turnId: string, extra: unknown[] = []) => ({
  ...base,
  turnId,
  steps: [{ kind: "open", url: START }, { kind: "search", query: "Doe" }, { kind: "read" }, ...extra],
});

describe("every navigation re-passes the pre-flight", () => {
  it("one pre-flight per navigation, in order, before the browser is asked — then a hop that would land somewhere refused stops", async () => {
    const next = mk(RESULTS, { anchors: [{ text: "Next", href: "https://assessor.example.gov/search?q=Doe&page=2", rel: "" }] });
    const PAGE2 = "https://assessor.example.gov/search?q=Doe&page=2";
    const { deps, calls } = scripted({
      pages: { [START]: { kind: "page", page: mk(START, { forms: [searchForm] }) }, [RESULTS]: { kind: "page", page: next }, [PAGE2]: { kind: "page", page: mk(PAGE2) } },
    });
    const out = await runPaxSearchSession({ ...plan("t-order", [{ kind: "next_page" }, { kind: "read" }]), maxPages: 4 }, deps);
    expect(out.kind).toBe("done");
    expect(calls.preflight.map((c) => c.url)).toEqual([START, RESULTS, PAGE2]);
    expect(calls.navigate).toEqual([START, RESULTS, PAGE2]);
    expect(calls.preflight.every((c) => c.takeVisit === undefined)).toBe(true); // every hop spends a visit
  });

  it.each([
    ["a private/resolved-private address", "private_address", "address_refused"],
    ["a robots.txt-disallowed page", "robots_disallowed", "robots_disallowed"],
    ["an unreadable robots.txt", "robots_unverified", "robots_unverified"],
    ["a rate-limited host", "rate_limited", "rate_limited"],
    ["an operator-denied domain", "site_policy", "address_refused"],
    ["a request the R-14 gate blocks", "request_blocked", "address_refused"],
  ])("a SEARCH hop onto %s refuses; the browser is never asked for it", async (_name, preReason, expected) => {
    const { deps, calls } = scripted({
      pages: { [START]: { kind: "page", page: mk(START, { forms: [searchForm] }) }, [RESULTS]: { kind: "page", page: mk(RESULTS) } },
      preflight: (url) => (url === RESULTS ? { kind: "refused", reason: preReason } : { kind: "clear" }),
    });
    const out = await runPaxSearchSession(plan(`t-hop-${preReason}`), deps);
    // Nothing had been READ yet (the read step comes after the search), so this is a refusal.
    expect(out).toMatchObject({ kind: "refused", reason: expected });
    expect(calls.navigate).toEqual([START]);
    expect(calls.preflight.map((c) => c.url)).toEqual([START, RESULTS]); // it WAS pre-flighted — and stopped there
    expect(lastReceipt()).toMatchObject({ url: "https://assessor.example.gov/search", outcome: "refused" });
  });

  it("the very first open is pre-flighted too: refused → nothing is fetched and the result is a refusal", async () => {
    const { deps, calls } = scripted({ pages: { [START]: { kind: "page", page: mk(START) } }, preflight: () => ({ kind: "refused", reason: "private_address" }) });
    const out = await runPaxSearchSession(plan("t-first"), deps);
    expect(out).toMatchObject({ kind: "refused", reason: "address_refused" });
    expect(calls.navigate).toEqual([]);
    expect(receiptsWritten()).toEqual([expect.objectContaining({ outcome: "refused", host: "assessor.example.gov" })]);
    // nothing was read, so the fence has nothing to say
    expect(checkWebSourcedRows(7, "t-first", 50)).toEqual({ webSourced: false });
  });

  it("a redirect's landing URL is re-checked (no extra visit spent), and a refused landing is not a read", async () => {
    const MOVED = "https://assessor.example.gov/moved";
    const { deps, calls } = scripted({
      pages: { [START]: { kind: "page", page: mk(MOVED, { forms: [searchForm] }) } },
      preflight: (url) => (url === MOVED ? { kind: "refused", reason: "robots_disallowed" } : { kind: "clear" }),
    });
    const out = await runPaxSearchSession(plan("t-redirect"), deps);
    expect(out).toMatchObject({ kind: "refused", reason: "robots_disallowed" });
    expect(calls.preflight).toEqual([
      { url: START, takeVisit: undefined },
      { url: MOVED, takeVisit: false },
    ]);
    expect(lastReceipt()).toMatchObject({ url: "https://assessor.example.gov/moved", outcome: "refused" });
    expect(checkWebSourcedRows(7, "t-redirect", 50)).toEqual({ webSourced: false });
  });

  it("the browser leaving the session's site is refused and receipted, never read", async () => {
    const { deps } = scripted({ pages: { [START]: { kind: "refused", reason: "left_site", detail: "evil.example" } } });
    const out = await runPaxSearchSession(plan("t-left"), deps);
    expect(out).toMatchObject({ kind: "refused", reason: "different_site" });
    expect(receiptsWritten()).toEqual([expect.objectContaining({ outcome: "refused" })]);
  });
});

describe("receipts and provenance", () => {
  it("writes the browse_web receipt for each page loaded: host, URL without its query, the turn, outcome read", async () => {
    const { deps } = scripted({
      pages: { [START]: { kind: "page", page: mk(START, { forms: [searchForm] }) }, [RESULTS]: { kind: "page", page: mk(RESULTS) } },
    });
    const out = await runPaxSearchSession(plan("t-receipts"), deps);
    expect(out.kind).toBe("done");
    expect(receiptsWritten()).toEqual([
      { host: "assessor.example.gov", url: "https://assessor.example.gov/", turnId: "t-receipts", outcome: "read" },
      { host: "assessor.example.gov", url: "https://assessor.example.gov/search", turnId: "t-receipts", outcome: "read" },
    ]);
    // the query string (the person's own search, and any token) is in no stored row
    expect(JSON.stringify(H.logActivity.mock.calls)).not.toContain("q=Doe");
  });

  it("a page that does not load is receipted failed; an error page too", async () => {
    const a = scripted({ pages: {} });
    await runPaxSearchSession(plan("t-fail-a"), a.deps);
    expect(lastReceipt()).toMatchObject({ outcome: "failed" });

    H.logActivity.mockClear();
    const b = scripted({ pages: { [START]: { kind: "page", page: mk(START, { httpStatus: 500, content: "Server error" }) } } });
    const out = await runPaxSearchSession(plan("t-fail-b"), b.deps);
    expect(out).toMatchObject({ kind: "refused", reason: "site_error" });
    expect(lastReceipt()).toMatchObject({ outcome: "failed" });
  });

  it("a CAPTCHA attempt is receipted refused, and its page is not noted as a read", async () => {
    const wall = mk(RESULTS, { html: '<div class="cf-turnstile" data-sitekey="k"></div>', content: "Verify you are human" });
    const { deps } = scripted({ pages: { [START]: { kind: "page", page: mk(START, { forms: [searchForm] }) }, [RESULTS]: { kind: "page", page: wall } } });
    const out = await runPaxSearchSession(plan("t-captcha"), deps);
    expect(out.kind).toBe("captcha");
    expect(receiptsWritten().map((r) => r.outcome)).toEqual(["read", "refused"]);
  });

  it("a session whose FIRST page is a CAPTCHA wall leaves the turn un-browsed", async () => {
    const wall = mk(START, { html: '<iframe src="https://challenges.cloudflare.com/x"></iframe>' });
    const { deps } = scripted({ pages: { [START]: { kind: "page", page: wall } } });
    const out = await runPaxSearchSession(plan("t-wall-first"), deps);
    expect(out.kind).toBe("captcha");
    expect(checkWebSourcedRows(7, "t-wall-first", 1)).toEqual({ webSourced: false });
  });

  it("the turn registry notes the host, so PX-1's fence applies to anything created afterwards", async () => {
    const { deps } = scripted({
      pages: { [START]: { kind: "page", page: mk(START, { forms: [searchForm] }) }, [RESULTS]: { kind: "page", page: mk(RESULTS) } },
    });
    await runPaxSearchSession(plan("t-fence"), deps);

    // the real fence: a page's worth of rows is refused whole, tagged web:<host>
    const verdict = checkWebSourcedRows(7, "t-fence", 50);
    expect(verdict.webSourced).toBe(true);
    if (verdict.webSourced && !verdict.allowed) {
      expect(verdict.cap).toBe(WEB_SOURCED_ROW_CAP);
      expect(verdict.hosts).toEqual(["assessor.example.gov"]);
      expect(verdict.tag).toBe("web:assessor.example.gov");
    } else {
      throw new Error("the fence did not refuse 50 web-sourced rows after a search session");
    }
    // a few rows go through, tagged
    expect(checkWebSourcedRows(7, "t-fence", 2)).toMatchObject({ webSourced: true, allowed: true, tag: "web:assessor.example.gov" });
    // another org's identical turn id is a different turn
    expect(checkWebSourcedRows(8, "t-fence", 50)).toEqual({ webSourced: false });
    // a different turn is untouched
    expect(checkWebSourcedRows(7, "t-other", 50)).toEqual({ webSourced: false });
  });
});
