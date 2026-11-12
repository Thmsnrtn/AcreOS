/**
 * PX-7 — the step-language judge for Pax's bounded public-search sessions.
 *
 * What is pinned (all against the real functions in
 * server/services/paxBrowseSearch.ts; only the browser and the receipt writer
 * are fakes):
 *   1. the step language is CLOSED: an unknown kind, an extra key (a selector,
 *      a method, a script), a first step that is not `open`, or too many steps
 *      is not a step list;
 *   2. "search form" is judged mechanically — a GET form with one identifiable
 *      text/search input qualifies; a POST form never does; a login form
 *      refuses; a password / hidden / textarea / disabled / email field is
 *      NEVER the input; two unlabeled text inputs are ambiguous, not guessed;
 *   3. the GET URL is built the way a browser submits it (old query dropped,
 *      hidden defaults kept, submit and password controls never sent);
 *   4. the next-page finder (rel=next, then the next-text patterns), and the
 *      result-link index bound;
 *   5. the bounds: steps, page loads, one site per session (my-sites / same
 *      registrable domain), the session timeout;
 *   6. CAPTCHA / bot-wall markers (fixture HTML) end the session with
 *      `captcha` — and the browser is asked ONCE, never retried.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  PAX_SEARCH_LIMITS,
  cleanSearchQuery,
  detectChallenge,
  findNextLink,
  judgeSearchForm,
  parseSearchSteps,
  registrableDomainOf,
  resolveResultLink,
  runPaxSearchSession,
  sessionHostsAllowed,
  type PaxSearchDeps,
} from "../../server/services/paxBrowseSearch";
import type {
  BrowseAnchorDescriptor,
  BrowseFormDescriptor,
  BrowseFormField,
  BrowseNavOutcome,
  BrowseNavPage,
} from "../../server/services/browserAutomation";

// ── Fixtures ────────────────────────────────────────────────────────────────

const field = (o: Partial<BrowseFormField>): BrowseFormField => ({
  tag: "input",
  type: "text",
  name: "",
  id: "",
  placeholder: "",
  ariaLabel: "",
  value: "",
  checked: false,
  hidden: false,
  disabled: false,
  ...o,
});

const form = (o: Partial<BrowseFormDescriptor> = {}): BrowseFormDescriptor => ({
  method: "get",
  action: "https://assessor.example.gov/search?old=1#frag",
  fields: [],
  ...o,
});

const searchBox = field({ name: "q", placeholder: "Search owner or parcel" });
const submit = field({ tag: "button", type: "submit", name: "go", value: "Search" });

const page = (url: string, o: Partial<BrowseNavPage> = {}): BrowseNavPage => ({
  url,
  title: "Results",
  content: "Parcel 100-001 Jane Doe",
  links: [],
  tables: [],
  httpStatus: 200,
  html: "<html><body>ok</body></html>",
  forms: [],
  anchors: [],
  ...o,
});

// ── 1. The language is closed ───────────────────────────────────────────────

describe("the step language is a closed enum", () => {
  it("represents exactly the five kinds: each parses, and nothing else does", () => {
    const open = { kind: "open", url: "https://a.example.gov/" };
    const each: unknown[] = [{ kind: "search", query: "x" }, { kind: "open_result", index: 0 }, { kind: "next_page" }, { kind: "read" }, open];
    for (const step of each) expect(parseSearchSteps([open, step]).kind, JSON.stringify(step)).toBe("steps");
    for (const kind of ["click", "type", "select", "scroll", "evaluate", "submit", "download", "post", "goto", "fill", "press", "wait"]) {
      expect(parseSearchSteps([open, { kind }]), kind).toEqual({ kind: "refused", reason: "step_not_allowed" });
    }
  });

  it("accepts a well-formed plan", () => {
    const r = parseSearchSteps([
      { kind: "open", url: "https://assessor.example.gov/" },
      { kind: "search", query: "Doe" },
      { kind: "read" },
      { kind: "open_result", index: 0 },
      { kind: "next_page" },
    ]);
    expect(r.kind).toBe("steps");
  });

  it.each([
    ["an unknown kind", [{ kind: "open", url: "https://a.example.gov/" }, { kind: "click", selector: "#go" }]],
    ["a script step", [{ kind: "open", url: "https://a.example.gov/" }, { kind: "evaluate", code: "1" }]],
    ["an extra key on a real kind (a selector)", [{ kind: "open", url: "https://a.example.gov/" }, { kind: "search", query: "x", selector: "#q" }]],
    ["an extra key on read (a method)", [{ kind: "open", url: "https://a.example.gov/" }, { kind: "read", method: "POST" }]],
    ["a first step that is not open", [{ kind: "search", query: "x" }]],
    ["a negative result index", [{ kind: "open", url: "https://a.example.gov/" }, { kind: "open_result", index: -1 }]],
    ["a fractional result index", [{ kind: "open", url: "https://a.example.gov/" }, { kind: "open_result", index: 0.5 }]],
    ["an empty plan", []],
    ["not a list", { kind: "open", url: "https://a.example.gov/" }],
  ])("refuses %s", (_label, steps) => {
    const r = parseSearchSteps(steps);
    expect(r).toEqual({ kind: "refused", reason: "step_not_allowed" });
  });

  it("refuses more steps than the bound", () => {
    const steps = [{ kind: "open", url: "https://a.example.gov/" }, ...Array.from({ length: PAX_SEARCH_LIMITS.maxSteps }, () => ({ kind: "read" }))];
    expect(steps.length).toBe(PAX_SEARCH_LIMITS.maxSteps + 1);
    expect(parseSearchSteps(steps)).toEqual({ kind: "refused", reason: "too_many_steps" });
    expect(parseSearchSteps(steps.slice(0, PAX_SEARCH_LIMITS.maxSteps)).kind).toBe("steps");
  });
});

// ── 2. The search-form judge ────────────────────────────────────────────────

describe("search-form qualification", () => {
  it("a GET form with one search box qualifies, and the URL is built like a browser would", () => {
    const j = judgeSearchForm(
      [
        form({
          fields: [
            field({ type: "hidden", name: "mode", value: "owner", hidden: true }),
            searchBox,
            field({ tag: "select", type: "select", name: "county", value: "cochise" }),
            field({ type: "checkbox", name: "exact", value: "1", checked: false }),
            field({ type: "checkbox", name: "active", value: "1", checked: true }),
            submit,
          ],
        }),
      ],
      "Doe, Jane",
    );
    expect(j.kind).toBe("form");
    if (j.kind !== "form") return;
    const u = new URL(j.url);
    expect(u.origin + u.pathname).toBe("https://assessor.example.gov/search");
    expect(u.searchParams.get("old")).toBeNull(); // the action's old query is replaced, as a browser does
    expect(u.hash).toBe("");
    expect(u.searchParams.get("q")).toBe("Doe, Jane");
    expect(u.searchParams.get("mode")).toBe("owner"); // hidden default is sent
    expect(u.searchParams.get("county")).toBe("cochise");
    expect(u.searchParams.get("active")).toBe("1");
    expect(u.searchParams.has("exact")).toBe(false); // unchecked box is not sent
    expect(u.searchParams.has("go")).toBe(false); // no submit control is sent
    expect(j.inputName).toBe("q");
  });

  it("a form with no method attribute reads as GET (the extraction defaults it)", () => {
    expect(judgeSearchForm([form({ method: "get", fields: [searchBox] })], "x").kind).toBe("form");
  });

  it("a POST-only form does not qualify — it is never re-sent as a GET", () => {
    const j = judgeSearchForm([form({ method: "post", fields: [searchBox, submit] })], "Doe");
    expect(j).toEqual({ kind: "refused", reason: "no_search_form" });
  });

  it("an unknown method is not a GET", () => {
    for (const method of ["dialog", "put", "", "get "]) {
      expect(judgeSearchForm([form({ method, fields: [searchBox] })], "Doe").kind, method).toBe("refused");
    }
  });

  it("a login form refuses (the only form on the page)", () => {
    const login = form({
      method: "get",
      fields: [field({ name: "username" }), field({ type: "password", name: "password" }), submit],
    });
    expect(judgeSearchForm([login], "Doe")).toEqual({ kind: "refused", reason: "login_form_only" });
    // a POST login form is the same wall
    expect(judgeSearchForm([form({ method: "post", fields: [field({ name: "user" }), field({ type: "password", name: "pw" })] })], "Doe")).toEqual({
      kind: "refused",
      reason: "login_form_only",
    });
  });

  it("a password input is NEVER chosen — not even when it is named like a search box", () => {
    const sneaky = form({ fields: [field({ type: "password", name: "search", placeholder: "Search" }), submit] });
    expect(judgeSearchForm([sneaky], "Doe").kind).toBe("refused");
    // and a login form beside a real search form: the search form is used, the password never typed
    const j = judgeSearchForm(
      [
        form({ action: "https://assessor.example.gov/login", fields: [field({ name: "user" }), field({ type: "password", name: "pass" })] }),
        form({ action: "https://assessor.example.gov/find", fields: [searchBox] }),
      ],
      "Doe",
    );
    expect(j.kind).toBe("form");
    if (j.kind === "form") {
      expect(j.url).toContain("/find?");
      expect(j.url).not.toContain("pass");
    }
  });

  it("a hidden input is NEVER chosen", () => {
    const j = judgeSearchForm(
      [
        form({
          fields: [
            field({ type: "hidden", name: "q", hidden: true }),
            field({ type: "text", name: "search", hidden: true }), // rendered display:none
          ],
        }),
      ],
      "Doe",
    );
    expect(j).toEqual({ kind: "refused", reason: "no_search_form" });
  });

  it("a textarea, a select, an email or number field is never the search input", () => {
    for (const f of [
      field({ tag: "textarea", type: "textarea", name: "search" }),
      field({ tag: "select", type: "select", name: "search" }),
      field({ type: "email", name: "search" }),
      field({ type: "number", name: "search" }),
      field({ type: "text", name: "search", disabled: true }),
      field({ type: "text", name: "" }), // unnamed: cannot be submitted
      field({ type: "text", name: "newsletter_email" }),
    ]) {
      expect(judgeSearchForm([form({ fields: [f] })], "Doe").kind, JSON.stringify(f)).toBe("refused");
    }
  });

  it("does not guess between two unlabeled text inputs", () => {
    const j = judgeSearchForm([form({ fields: [field({ name: "a1" }), field({ name: "b2" })] })], "Doe");
    expect(j).toEqual({ kind: "refused", reason: "ambiguous_search_form" });
  });

  it("chooses the one search-like input among several text inputs", () => {
    const j = judgeSearchForm([form({ fields: [field({ name: "page_size" }), field({ name: "ownerName" })] })], "Doe");
    expect(j.kind).toBe("form");
    if (j.kind === "form") expect(j.inputName).toBe("ownerName");
  });

  it("prefers the form whose input is unmistakably a search box over a lone unlabeled one", () => {
    const j = judgeSearchForm(
      [form({ action: "https://assessor.example.gov/a", fields: [field({ name: "zz9" })] }), form({ action: "https://assessor.example.gov/b", fields: [searchBox] })],
      "Doe",
    );
    expect(j.kind).toBe("form");
    if (j.kind === "form") expect(j.url).toContain("/b?");
  });

  it("an action that is not http(s) cannot qualify", () => {
    for (const action of ["javascript:void(0)", "", "ftp://assessor.example.gov/x", "data:text/html,hi"]) {
      expect(judgeSearchForm([form({ action, fields: [searchBox] })], "Doe").kind, action).toBe("refused");
    }
  });

  it("no forms at all is a plain refusal, not a guess", () => {
    expect(judgeSearchForm([], "Doe")).toEqual({ kind: "refused", reason: "no_search_form" });
  });

  it("an empty or control-only query is not usable; a long one is capped", () => {
    expect(judgeSearchForm([form({ fields: [searchBox] })], "   \u0000\n ")).toEqual({ kind: "refused", reason: "query_not_usable" });
    expect(judgeSearchForm([form({ fields: [searchBox] })], 42)).toEqual({ kind: "refused", reason: "query_not_usable" });
    expect(cleanSearchQuery("x".repeat(500)).length).toBe(PAX_SEARCH_LIMITS.maxQueryChars);
    expect(cleanSearchQuery("a\u0007  b\n c")).toBe("a b c");
  });
});

// ── 4. next / result links ──────────────────────────────────────────────────

describe("next-page and result links", () => {
  const A = (text: string, href: string, rel = ""): BrowseAnchorDescriptor => ({ text, href, rel });
  const here = "https://assessor.example.gov/results?page=1";

  it("rel=next wins, and a relative href resolves against the page", () => {
    expect(findNextLink([A("2", "/results?page=2"), A("Older", "?page=2", "next")], here)).toBe("https://assessor.example.gov/results?page=2");
    expect(findNextLink([A("", "/p3", "nofollow next")], here)).toBe("https://assessor.example.gov/p3");
  });

  it.each(["Next", "next page", "NEXT >", "›", ">", "»", ">>", "  Next   Page "])("recognises the text %j", (text) => {
    expect(findNextLink([A(text, "/results?page=2")], here)).toBe("https://assessor.example.gov/results?page=2");
  });

  it("does not take other links, or a link that is not usable", () => {
    expect(findNextLink([A("Previous", "/p0"), A("Home", "/"), A("Nextdoor", "/x"), A("Next steps for owners", "/y")], here)).toBeNull();
    expect(findNextLink([A("Next", "javascript:go()"), A("Next", "#"), A("Next", "mailto:a@b.c")], here)).toBeNull();
    expect(findNextLink([A("Next", here)], here)).toBeNull(); // a "next" that is this page
    expect(findNextLink([], here)).toBeNull();
  });

  it("open_result takes only an index within the links the model was shown", () => {
    const links = Array.from({ length: 20 }, (_, i) => ({ text: `r${i}`, href: `/parcel/${i}` }));
    expect(resolveResultLink(links, 0, here)).toBe("https://assessor.example.gov/parcel/0");
    expect(resolveResultLink(links, PAX_SEARCH_LIMITS.linksShown - 1, here)).toBe("https://assessor.example.gov/parcel/14");
    expect(resolveResultLink(links, PAX_SEARCH_LIMITS.linksShown, here)).toBeNull(); // extracted but never shown
    expect(resolveResultLink(links, -1, here)).toBeNull();
    expect(resolveResultLink(links, 1.5, here)).toBeNull();
    expect(resolveResultLink([{ text: "x", href: "javascript:void(0)" }], 0, here)).toBeNull();
    expect(resolveResultLink([], 0, here)).toBeNull();
  });
});

// ── 5. Bounds ───────────────────────────────────────────────────────────────

describe("one site per session", () => {
  const mySites = [
    { host: "assessor.example.gov", label: "Assessor" },
    { host: "recorder.example.gov", label: "Recorder" },
  ];

  it("registrable domain approximation is narrow", () => {
    expect(registrableDomainOf("assessor.maricopa.gov")).toBe("maricopa.gov");
    expect(registrableDomainOf("WWW.Maricopa.gov.")).toBe("maricopa.gov");
    expect(registrableDomainOf("www.co.cochise.az.us")).toBe("co.cochise.az.us");
    expect(registrableDomainOf("records.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomainOf("a.az.us")).not.toBe(registrableDomainOf("b.az.us"));
  });

  it("one host (www-agnostic), every listed host, or one registrable domain — nothing else", () => {
    expect(sessionHostsAllowed(["a.example.com", "www.a.example.com"], [])).toBe(true);
    expect(sessionHostsAllowed(["assessor.example.gov", "recorder.example.gov"], mySites)).toBe(true);
    expect(sessionHostsAllowed(["assessor.example.gov", "recorder.example.gov"], [])).toBe(true); // same registrable domain
    expect(sessionHostsAllowed(["assessor.example.gov", "treasurer.other.gov"], mySites)).toBe(false); // one listed, one not
    expect(sessionHostsAllowed(["a.one.gov", "a.two.gov"], [])).toBe(false);
    expect(sessionHostsAllowed(["a.one.gov", "a.two.gov"], [{ host: "a.one.gov", label: "1" }, { host: "a.two.gov", label: "2" }])).toBe(true);
    expect(sessionHostsAllowed([], mySites)).toBe(false);
  });
});

/** A scripted fake of the seams: the browser and the receipt writer. The pre-flight is a stub that passes unless told. */
function harness(opts: {
  pages: Record<string, BrowseNavOutcome>;
  preflight?: (url: string) => { kind: "clear" } | { kind: "refused"; reason: string };
}) {
  const calls = { preflight: [] as string[], navigate: [] as string[], receipts: [] as Array<{ url: string; outcome: string }>, noted: [] as string[], closed: 0, opened: 0 };
  let now = 1_000_000;
  const deps = {
    preflight: async (url: string) => {
      calls.preflight.push(url);
      const verdict: { kind: "clear" } | { kind: "refused"; reason: string } = opts.preflight?.(url) ?? { kind: "clear" };
      return verdict.kind === "clear" ? { kind: "clear", url: new URL(url) } : { kind: "refused", reason: verdict.reason, detail: "" };
    },
    openNavigator: async () => {
      calls.opened += 1;
      return {
        navigate: async (url: string) => {
          calls.navigate.push(url);
          const hit = opts.pages[url];
          if (!hit) return { kind: "refused", reason: "did_not_load", detail: "no fixture" } as BrowseNavOutcome;
          now += 10;
          return hit;
        },
        close: async () => {
          calls.closed += 1;
        },
      };
    },
    recordReceipt: async (i: { url: string; outcome: string }) => {
      calls.receipts.push({ url: i.url, outcome: i.outcome });
      return { written: true };
    },
    noteBrowse: (_org: number, _turn: unknown, host: string) => {
      calls.noted.push(host);
    },
    nowMs: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
  return { deps: deps as unknown as PaxSearchDeps & { advance: (ms: number) => void }, calls };
}

const START = "https://assessor.example.gov/";
const RESULTS = "https://assessor.example.gov/search?q=Doe&mode=owner";
const homePage = page(START, { forms: [form({ action: "https://assessor.example.gov/search", fields: [searchBox, field({ type: "hidden", name: "mode", value: "owner", hidden: true })] })] });
const resultsPage = page(RESULTS, {
  links: Array.from({ length: 5 }, (_, i) => ({ text: `Parcel ${i}`, href: `/parcel/${i}` })),
  anchors: [{ text: "Next", href: "/search?q=Doe&mode=owner&page=2", rel: "" }],
});
const base = { orgId: 7, origin: "chat" as const, turnId: "t-1", mySites: [] as { host: string; label: string }[] };

describe("the session runner enforces the bounds in code", () => {
  it("runs open → search → read and hands back the page with the browse_web caps", async () => {
    const big = page(RESULTS, { ...resultsPage, content: "x".repeat(20_000), tables: Array.from({ length: 50 }, (_, i) => `row ${i}`), links: Array.from({ length: 20 }, (_, i) => ({ text: `l${i}`, href: `/p/${i}` })) });
    const { deps, calls } = harness({ pages: { [START]: { kind: "page", page: homePage }, [RESULTS]: { kind: "page", page: big } } });
    const out = await runPaxSearchSession(
      { ...base, steps: [{ kind: "open", url: START }, { kind: "search", query: "Doe" }, { kind: "read" }] },
      deps,
    );
    expect(out.kind).toBe("done");
    if (out.kind !== "done") return;
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].content.length).toBe(PAX_SEARCH_LIMITS.contentChars);
    expect(out.pages[0].links).toHaveLength(PAX_SEARCH_LIMITS.linksShown);
    expect(out.pages[0].tables).toHaveLength(PAX_SEARCH_LIMITS.tablesShown);
    expect(out.trail).toEqual(["https://assessor.example.gov/", "https://assessor.example.gov/search"]); // no query string in the trail
    expect(calls.navigate).toEqual([START, RESULTS]);
    expect(calls.closed).toBe(1);
  });

  it("an unknown step never reaches the browser", async () => {
    const { deps, calls } = harness({ pages: {} });
    const out = await runPaxSearchSession({ ...base, steps: [{ kind: "open", url: START }, { kind: "click", selector: "#go" }] }, deps);
    expect(out).toEqual({ kind: "refused", reason: "step_not_allowed", trail: [], pages: [] });
    expect(calls.preflight).toEqual([]);
    expect(calls.opened).toBe(0);
  });

  it("an address that is not a URL refuses before anything is fetched", async () => {
    const { deps, calls } = harness({ pages: {} });
    const out = await runPaxSearchSession({ ...base, steps: [{ kind: "open", url: "not a url" }, { kind: "read" }] }, deps);
    expect(out).toEqual({ kind: "refused", reason: "address_refused", trail: [], pages: [] });
    expect(calls.preflight).toEqual([]);
    expect(calls.opened).toBe(0);
  });

  it("stops at the page bound — a bound, not a crash", async () => {
    const pages: Record<string, BrowseNavOutcome> = { [START]: { kind: "page", page: homePage }, [RESULTS]: { kind: "page", page: resultsPage } };
    const { deps, calls } = harness({ pages });
    const out = await runPaxSearchSession(
      { ...base, maxPages: 2, steps: [{ kind: "open", url: START }, { kind: "search", query: "Doe" }, { kind: "read" }, { kind: "next_page" }, { kind: "read" }] },
      deps,
    );
    expect(out.kind).toBe("done");
    if (out.kind === "done") {
      expect(out.stoppedEarly).toBe("too_many_pages");
      expect(out.pages).toHaveLength(1); // what was read before the bound is kept
    }
    expect(calls.navigate).toHaveLength(2);
  });

  it("the page bound has a hard ceiling no caller can raise", async () => {
    const { deps, calls } = harness({ pages: { [START]: { kind: "page", page: homePage }, [RESULTS]: { kind: "page", page: resultsPage } } });
    await runPaxSearchSession(
      {
        ...base,
        maxPages: 999,
        steps: [{ kind: "open", url: START }, ...Array.from({ length: 7 }, () => ({ kind: "open", url: START }))],
      },
      deps,
    );
    expect(calls.navigate.length).toBeLessThanOrEqual(PAX_SEARCH_LIMITS.maxPages);
  });

  it("a hop to another registrable domain is refused (and receipted) before the pre-flight", async () => {
    const away = page(START, { links: [{ text: "Elsewhere", href: "https://records.other-county.gov/x" }] });
    const { deps, calls } = harness({ pages: { [START]: { kind: "page", page: away } } });
    const out = await runPaxSearchSession(
      { ...base, steps: [{ kind: "open", url: START }, { kind: "read" }, { kind: "open_result", index: 0 }, { kind: "read" }] },
      deps,
    );
    expect(out.kind).toBe("done");
    if (out.kind === "done") expect(out.stoppedEarly).toBe("different_site");
    expect(calls.navigate).toEqual([START]);
    expect(calls.preflight).toEqual([START]); // the foreign address never got as far as the pre-flight
    expect(calls.receipts.some((r) => r.url.startsWith("https://records.other-county.gov") && r.outcome === "refused")).toBe(true);
  });

  it("a hop to a second LISTED host is allowed", async () => {
    const away = page(START, { links: [{ text: "Recorder", href: "https://recorder.other-county.gov/x" }] });
    const recorder = page("https://recorder.other-county.gov/x");
    const { deps, calls } = harness({ pages: { [START]: { kind: "page", page: away }, "https://recorder.other-county.gov/x": { kind: "page", page: recorder } } });
    const out = await runPaxSearchSession(
      {
        ...base,
        mySites: [{ host: "assessor.example.gov", label: "A" }, { host: "recorder.other-county.gov", label: "R" }],
        steps: [{ kind: "open", url: START }, { kind: "open_result", index: 0 }, { kind: "read" }],
      },
      deps,
    );
    expect(out.kind).toBe("done");
    expect(calls.navigate).toHaveLength(2);
  });

  it("the whole-session timeout ends the session and still closes the browser", async () => {
    const { deps, calls } = harness({ pages: { [START]: { kind: "page", page: homePage } } });
    const originalNavigator = deps.openNavigator;
    deps.openNavigator = async (o) => {
      const nav = await originalNavigator(o);
      return {
        ...nav,
        navigate: async (url) => {
          const r = await nav.navigate(url);
          deps.advance(PAX_SEARCH_LIMITS.sessionTimeoutMs + 1);
          return r;
        },
      };
    };
    const out = await runPaxSearchSession({ ...base, steps: [{ kind: "open", url: START }, { kind: "search", query: "Doe" }, { kind: "read" }] }, deps);
    expect(out.kind).toBe("refused");
    if (out.kind === "refused") expect(out.reason).toBe("timed_out");
    expect(calls.closed).toBe(1);
  });
});

// ── 6. CAPTCHA / bot walls ──────────────────────────────────────────────────

describe("CAPTCHA and bot-wall markers", () => {
  const p = (o: Partial<{ html: string; text: string; title: string; httpStatus: number | null }>) => ({ html: "", text: "", title: "", httpStatus: 200, ...o });

  it.each([
    ["reCAPTCHA v2 widget", p({ html: '<form><div class="g-recaptcha" data-sitekey="k"></div></form>' })],
    ["reCAPTCHA challenge frame", p({ html: '<iframe src="https://www.google.com/recaptcha/api2/bframe?hl=en"></iframe>' })],
    ["hCaptcha div", p({ html: '<div class="h-captcha" data-sitekey="k"></div>' })],
    ["hCaptcha frame", p({ html: '<iframe src="https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html"></iframe>' })],
    ["Turnstile div", p({ html: '<div class="cf-turnstile" data-sitekey="k"></div>' })],
    ["Cloudflare challenge frame", p({ html: '<iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile"></iframe>' })],
    ["Cloudflare challenge page", p({ html: '<form id="challenge-form" action="/cdn-cgi/l/chk_jschl">', title: "Just a moment..." })],
    ["interstitial title", p({ title: "Just a moment..." })],
    ["Cloudflare block title", p({ title: "Attention Required! | Cloudflare" })],
    ["human check text", p({ text: "Please verify you are human by completing the action below." })],
    ["robot check text", p({ text: "Are you a robot? Confirm below." })],
    ["unusual traffic", p({ text: "Our systems have detected unusual traffic from your computer network." })],
    ["blocked by edge service", p({ text: "Sorry, you have been blocked. You are unable to access example.gov" })],
    ["403 with a block body", p({ httpStatus: 403, text: "Access denied" })],
    ["429 with a challenge body", p({ httpStatus: 429, html: "<p>Too many requests — complete the CAPTCHA</p>" })],
    ["bot-wall script", p({ html: '<script src="https://client.px-cloud.net/x"></script><div id="px-captcha"></div>' })],
  ])("detects %s", (_name, input) => {
    const v = detectChallenge(input);
    expect(v.detected).toBe(true);
    expect(v.marker).toBeTruthy();
  });

  it.each([
    ["an ordinary results page", p({ html: "<html><body><table><tr><td>100-001</td></tr></table></body></html>", text: "Parcel 100-001 Jane Doe" })],
    ["an invisible reCAPTCHA (nothing is asked of anyone)", p({ html: '<div class="g-recaptcha" data-size="invisible" data-sitekey="k"></div>' })],
    ["a v3 script tag alone", p({ html: '<script src="https://www.google.com/recaptcha/api.js?render=KEY"></script>' })],
    ["a 404 with no challenge words", p({ httpStatus: 404, text: "Page not found" })],
    ["a 500 with no challenge words", p({ httpStatus: 500, text: "Server error" })],
  ])("does not flag %s", (_name, input) => {
    expect(detectChallenge(input).detected).toBe(false);
  });

  it("a CAPTCHA ends the session as `captcha` — the browser is asked ONCE, never retried, and the attempt is receipted as refused", async () => {
    const wall = page(RESULTS, { httpStatus: 200, html: '<div class="g-recaptcha" data-sitekey="k"></div>', content: "Please complete the security check" });
    const { deps, calls } = harness({ pages: { [START]: { kind: "page", page: homePage }, [RESULTS]: { kind: "page", page: wall } } });
    const out = await runPaxSearchSession(
      { ...base, steps: [{ kind: "open", url: START }, { kind: "search", query: "Doe" }, { kind: "read" }, { kind: "next_page" }, { kind: "read" }] },
      deps,
    );
    expect(out.kind).toBe("captcha");
    if (out.kind === "captcha") expect(out.host).toBe("assessor.example.gov");
    expect(calls.navigate.filter((u) => u === RESULTS)).toHaveLength(1); // no retry
    expect(calls.navigate).toHaveLength(2); // and nothing after it
    expect(calls.receipts[calls.receipts.length - 1]).toEqual({ url: RESULTS, outcome: "refused" });
    expect(calls.noted).toEqual(["assessor.example.gov"]); // the wall page itself is not noted as a read
    expect(calls.closed).toBe(1);
  });
});
