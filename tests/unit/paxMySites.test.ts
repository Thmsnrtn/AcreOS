/**
 * PX-7 — "My county sites": the allowlist that says where Pax may run searches.
 *
 * It lives in the existing `organizations.pax_controls` jsonb (no table, no
 * migration) and is read by the ONE fail-closed reader. Pinned here:
 *
 *   1. READER. A pre-PX-7 row (no `mySites`) and a NULL column read as [] —
 *      "nothing listed", never "everything"; a well-formed list reads through
 *      deduplicated; every hostile value (a scheme, a path, credentials, a port,
 *      an IP, an unnormalised host, an extra key, a bad label, 51 entries, the
 *      wrong type) fails the WHOLE column CLOSED, with an empty list. A DB error
 *      keeps it empty. The values go through the real reader (probe: replace the
 *      zod parse with a cast and the hostile table turns red).
 *   2. HOST VALIDATION (shared/pax-controls.ts) — one definition, used by the
 *      reader, the PATCH route and the page: case and one trailing dot are
 *      normalised; everything else that is not a bare public host is REFUSED.
 *   3. THE SITE GATE (resolveSearchSite): a listed site (by name, host, its www
 *      twin, or any address on it) is allowed; an unlisted bare name or host is
 *      refused; only a FULL address starts a session on an unlisted site; an
 *      address with credentials, an IP or an internal name is never an address.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Rows = Array<Record<string, unknown>>;

const mocks = vi.hoisted(() => {
  let selectQueue: Array<Rows | Error> = [];
  let pause = { paused: false, pausedUntil: null as Date | null, checkFailed: false };
  const select = vi.fn((_shape?: unknown) => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (onFulfilled: (rows: unknown) => unknown, onRejected?: (err: unknown) => unknown) => {
        const next = selectQueue.shift();
        const p = next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? []);
        return p.then(onFulfilled, onRejected);
      },
    };
    return chain;
  });
  return {
    db: { select },
    setSelectQueue(q: Array<Rows | Error>) {
      selectQueue = [...q];
    },
    pause: () => pause,
  };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/paxPause", () => ({
  getPaxPauseState: vi.fn(async () => mocks.pause()),
}));

import { getPaxControls } from "../../server/services/paxControls";
import {
  PAX_CONTROLS_DEFAULTS,
  PAX_MY_SITES_MAX,
  PAX_SITE_LABEL_MAX,
  mySiteForHost,
  normalizeSiteHost,
  siteHostFromInput,
} from "../../shared/pax-controls";
import { resolveSearchSite } from "../../server/services/paxBrowseSearch";

const STRICT = "ask_before_everything";
const row = (paxControls: unknown) => [{ paxControls, timezone: "America/Chicago" }];
const base = { stance: "ask_before_sending", leadScoring: true, borrowerReminders: true, inboxDrafts: true };
const site = (host: string, label = "Assessor") => ({ host, label });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setSelectQueue([]);
});

// ── 1. The reader ───────────────────────────────────────────────────────────

describe("the reader: absent means none, never everything", () => {
  it("a pre-PX-7 row (no mySites key) reads as an empty list, not as a failure", async () => {
    mocks.setSelectQueue([row(base)]);
    const state = await getPaxControls(1);
    expect(state.checkFailed).toBe(false);
    expect(state.mySites).toEqual([]);
    expect(state.stance).toBe("ask_before_sending");
  });

  it("a pre-PX-7 row that already carries rails (PX-2) still reads, with no sites", async () => {
    mocks.setSelectQueue([row({ ...base, rails: { sends: "ask" } })]);
    const state = await getPaxControls(1);
    expect(state.checkFailed).toBe(false);
    expect(state.mySites).toEqual([]);
  });

  it("a NULL column is the defaults: no sites", async () => {
    mocks.setSelectQueue([row(null)]);
    const state = await getPaxControls(1);
    expect(state.checkFailed).toBe(false);
    expect(state.mySites).toEqual([]);
    expect(PAX_CONTROLS_DEFAULTS.mySites).toEqual([]);
  });

  it("an explicit empty list is an empty list", async () => {
    mocks.setSelectQueue([row({ ...base, mySites: [] })]);
    expect((await getPaxControls(1)).mySites).toEqual([]);
  });

  it("a well-formed list reads through (deduplicated by host, order kept)", async () => {
    mocks.setSelectQueue([
      row({ ...base, mySites: [site("assessor.example.gov", "Cochise assessor"), site("recorder.example.gov", "Recorder"), site("assessor.example.gov", "dupe")] }),
    ]);
    const state = await getPaxControls(1);
    expect(state.checkFailed).toBe(false);
    expect(state.mySites).toEqual([site("assessor.example.gov", "Cochise assessor"), site("recorder.example.gov", "Recorder")]);
  });
});

const HOSTILE_SITES: Array<[string, unknown]> = [
  ["a scheme in the host", [site("https://assessor.example.gov")]],
  ["a path in the host", [site("assessor.example.gov/search")]],
  ["credentials in the host", [site("user:pw@assessor.example.gov")]],
  ["a port in the host", [site("assessor.example.gov:8443")]],
  ["a query in the host", [site("assessor.example.gov?x=1")]],
  ["a wildcard host", [site("*.example.gov")]],
  ["an underscore host", [site("a_b.example.gov")]],
  ["a single-label host", [site("localhost")]],
  ["an IPv4 address", [site("10.0.0.1")]],
  ["a public IPv4 address", [site("93.184.216.34")]],
  ["an IPv6 literal", [site("[::1]")]],
  ["an unnormalised (upper-case) host", [site("Assessor.Example.GOV")]],
  ["an unnormalised (trailing-dot) host", [site("assessor.example.gov.")]],
  ["whitespace around the host", [site(" assessor.example.gov ")]],
  ["an empty host", [site("")]],
  ["a non-string host", [{ host: 5, label: "x" }]],
  ["a missing host", [{ label: "x" }]],
  ["an empty label", [site("assessor.example.gov", "")]],
  ["an over-long label", [site("assessor.example.gov", "x".repeat(PAX_SITE_LABEL_MAX + 1))]],
  ["a non-string label", [{ host: "assessor.example.gov", label: 7 }]],
  ["an extra key on an entry", [{ host: "assessor.example.gov", label: "x", path: "/search" }]],
  ["a bare string entry", ["assessor.example.gov"]],
  ["a null entry", [null]],
  ["more entries than the cap", Array.from({ length: PAX_MY_SITES_MAX + 1 }, (_, i) => site(`s${i}.example.gov`))],
  ["a string instead of a list", "assessor.example.gov"],
  ["an object instead of a list", { host: "assessor.example.gov", label: "x" }],
  ["null instead of a list", null],
  ["a number instead of a list", 1],
  ["true", true],
];

describe("the reader: a hostile mySites value fails the WHOLE column closed", () => {
  it("the hostile set is real (vacuity)", () => {
    expect(HOSTILE_SITES.length).toBeGreaterThan(20);
    for (const [name, value] of HOSTILE_SITES) {
      // none of them may be a valid list under the shared validator
      const looksValid =
        Array.isArray(value) &&
        value.length <= PAX_MY_SITES_MAX &&
        value.every(
          (e) =>
            e &&
            typeof e === "object" &&
            Object.keys(e).sort().join(",") === "host,label" &&
            typeof e.host === "string" &&
            normalizeSiteHost(e.host) === e.host &&
            typeof e.label === "string" &&
            e.label.length >= 1 &&
            e.label.length <= PAX_SITE_LABEL_MAX,
        );
      expect(looksValid, `${name} is a valid list`).toBe(false);
    }
  });

  it("resolves every one of them to the closed state with no sites", async () => {
    const leaked: string[] = [];
    for (const [name, value] of HOSTILE_SITES) {
      mocks.setSelectQueue([row({ ...base, mySites: value })]);
      const state = await getPaxControls(1);
      const closed =
        state.checkFailed &&
        state.paused &&
        state.stance === STRICT &&
        !state.leadScoring &&
        !state.borrowerReminders &&
        !state.inboxDrafts &&
        state.mySites.length === 0;
      if (!closed) leaked.push(`${name}: ${JSON.stringify(state.mySites)}`);
    }
    expect(leaked, "these stored values conveyed a site").toEqual([]);
  });

  it("a DB error, a missing org row and a failed pause read all keep the list empty", async () => {
    mocks.setSelectQueue([new Error("connection reset")]);
    expect((await getPaxControls(1)).mySites).toEqual([]);
    mocks.setSelectQueue([[]]);
    expect((await getPaxControls(1)).mySites).toEqual([]);
  });
});

// ── 2. Host validation ──────────────────────────────────────────────────────

describe("one definition of a bare host", () => {
  it.each([
    ["assessor.example.gov", "assessor.example.gov"],
    ["Assessor.Example.GOV", "assessor.example.gov"],
    ["assessor.example.gov.", "assessor.example.gov"],
    ["  assessor.example.gov  ", "assessor.example.gov"],
    ["www.co.cochise.az.us", "www.co.cochise.az.us"],
    ["xn--bcher-kva.example", "xn--bcher-kva.example"],
    ["a-b.example.org", "a-b.example.org"],
  ])("accepts %j → %j", (input, expected) => {
    expect(normalizeSiteHost(input)).toBe(expected);
  });

  it.each([
    "https://assessor.example.gov",
    "http://assessor.example.gov/",
    "assessor.example.gov/search",
    "assessor.example.gov?x=1",
    "assessor.example.gov#top",
    "user@assessor.example.gov",
    "user:pw@assessor.example.gov",
    "assessor.example.gov:8080",
    "assessor example.gov",
    "*.example.gov",
    "a_b.example.gov",
    "-bad.example.gov",
    "bad-.example.gov",
    "localhost",
    "10.0.0.1",
    "999.999.999.999",
    "[::1]",
    "::1",
    "example..gov",
    ".example.gov",
    "",
    "   ",
    `${"a".repeat(64)}.example.gov`,
    `${"a.".repeat(130)}gov`,
  ])("refuses %j (never rewritten into a host the person did not write)", (input) => {
    expect(normalizeSiteHost(input)).toBeNull();
  });

  it("refuses a value that is not a string", () => {
    for (const v of [null, undefined, 5, {}, [], true]) expect(normalizeSiteHost(v)).toBeNull();
  });

  it("the page's extraction takes the host out of a pasted address, and refuses credentials", () => {
    expect(siteHostFromInput("https://Assessor.Example.gov/Search?q=1#x")).toBe("assessor.example.gov");
    expect(siteHostFromInput("assessor.example.gov")).toBe("assessor.example.gov");
    expect(siteHostFromInput("assessor.example.gov/records")).toBe("assessor.example.gov");
    expect(siteHostFromInput("  http://assessor.example.gov:8080/x  ")).toBe("assessor.example.gov");
    expect(siteHostFromInput("https://user:pw@assessor.example.gov/")).toBeNull();
    expect(siteHostFromInput("user@assessor.example.gov")).toBeNull();
    expect(siteHostFromInput("javascript:alert(1)")).toBeNull();
    expect(siteHostFromInput("ftp://assessor.example.gov/")).toBeNull();
    expect(siteHostFromInput("http://127.0.0.1/")).toBeNull();
    expect(siteHostFromInput("http://localhost:3000/")).toBeNull();
    expect(siteHostFromInput("not an address")).toBeNull();
    expect(siteHostFromInput("")).toBeNull();
  });

  it("a listed host covers itself and its www twin — not a sibling, a parent or a look-alike", () => {
    const list = [site("records.example.gov", "Records")];
    expect(mySiteForHost(list, "records.example.gov")).toEqual(list[0]);
    expect(mySiteForHost(list, "WWW.Records.Example.gov")).toEqual(list[0]);
    expect(mySiteForHost(list, "example.gov")).toBeNull();
    expect(mySiteForHost(list, "other.example.gov")).toBeNull();
    expect(mySiteForHost(list, "evil-records.example.gov")).toBeNull();
    expect(mySiteForHost(list, "records.example.gov.evil.com")).toBeNull();
    expect(mySiteForHost(list, "10.0.0.1")).toBeNull();
    expect(mySiteForHost([], "records.example.gov")).toBeNull();
  });
});

// ── 3. The site gate ────────────────────────────────────────────────────────

describe("the site gate", () => {
  const list = [site("assessor.example.gov", "Cochise County assessor"), site("recorder.example.gov", "Recorder")];

  it("allows a listed site by its name (any case), its host, or its www twin", () => {
    for (const arg of ["Cochise County assessor", "cochise county ASSESSOR", "assessor.example.gov", "www.assessor.example.gov", "Assessor.Example.GOV"]) {
      const r = resolveSearchSite(arg, list);
      expect(r, arg).toMatchObject({ kind: "allowed", via: "my_sites", host: "assessor.example.gov" });
      if (r.kind === "allowed") expect(r.url).toBe("https://assessor.example.gov/");
    }
  });

  it("allows an address on a listed host and keeps its path (the search page the person pointed at)", () => {
    const r = resolveSearchSite("https://assessor.example.gov/parcelsearch?x=1", list);
    expect(r).toMatchObject({ kind: "allowed", via: "my_sites", label: "Cochise County assessor" });
    if (r.kind === "allowed") expect(r.url).toBe("https://assessor.example.gov/parcelsearch?x=1");
  });

  it("refuses an unlisted site named by a bare name or host — the model cannot add a site by saying so", () => {
    for (const arg of ["treasurer.example.gov", "Pima County treasurer", "example.gov", "www.treasurer.example.gov"]) {
      expect(resolveSearchSite(arg, list), arg).toEqual({ kind: "refused", reason: "site_not_listed" });
    }
  });

  it("an empty list allows nothing by name or host (fail-closed) — only a full address starts a session", () => {
    expect(resolveSearchSite("assessor.example.gov", [])).toEqual({ kind: "refused", reason: "site_not_listed" });
    expect(resolveSearchSite("Cochise County assessor", [])).toEqual({ kind: "refused", reason: "site_not_listed" });
    expect(resolveSearchSite("https://assessor.example.gov/", [])).toMatchObject({ kind: "allowed", via: "user_url" });
  });

  it("a full address on an unlisted host is allowed as the user's own pointer, for that exact host only", () => {
    const r = resolveSearchSite("https://records.other-county.gov/search", list);
    expect(r).toMatchObject({ kind: "allowed", via: "user_url", host: "records.other-county.gov", label: "records.other-county.gov" });
  });

  it("is never an address: credentials, an IP, an internal name, another scheme, nothing", () => {
    for (const arg of [
      "https://user:pw@assessor.example.gov/",
      "http://10.0.0.1/",
      "http://169.254.169.254/latest",
      "http://localhost/",
      "http://[::1]/",
      "ftp://assessor.example.gov/",
      "javascript:alert(1)",
      "",
      "   ",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(resolveSearchSite(arg, list), String(arg)).toEqual({ kind: "refused", reason: "not_an_address" });
    }
  });
});
