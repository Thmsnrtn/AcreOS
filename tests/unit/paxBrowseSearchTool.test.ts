/**
 * PX-7 — the `browse_search` tool, through the real `executeTool`.
 *
 * The browser is a fake (preflightBrowseNavigation / openBrowseNavSession are
 * stubbed at the module seam); everything else is real: the tool case, the
 * site gate, the session runner, the PX-1 receipt writer and turn registry,
 * the pause gate and the refusal shape.
 *
 *   1. SITE GATE — a listed site (by name) runs; an unlisted bare name/host is
 *      refused and the browser is never opened; a full address the user gave
 *      runs for that exact host.
 *   2. ATTACH — the record is verified BEFORE searching: a missing or other-
 *      org record refuses the whole call and nothing is fetched. A good one
 *      gets exactly ONE timeline row (tool "browse_search", the record's kind
 *      and id, a short summary, after = { host, url without query, query,
 *      source: "web:<host>" }); the model's finding is capped; while Pax is
 *      paused the search still runs and answers but NO note is written.
 *   3. CAPTCHA — a refusal in the standard shape naming the human check and the
 *      way forward, receipted, never retried; every refusal reads as plain words.
 *   4. FENCE — a search turn is web-sourced (PX-1's checkWebSourcedRows refuses
 *      a page's worth of rows afterwards) and the tool creates no records.
 *   5. REGISTRATION — classified looks_and_drafts, pause-safe, offered wherever
 *      browse_web is offered, behind the Map door.
 *   6. The model cannot widen the language: unknown arguments (steps, selector,
 *      method) are ignored — the browser is asked for exactly open + search.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => {
  const state = {
    paused: false,
    mySites: [] as Array<{ host: string; label: string }>,
    pages: {} as Record<string, unknown>,
  };
  return {
    state,
    logActivity: vi.fn(async (_row: Record<string, unknown>) => undefined as unknown),
    createProperty: vi.fn(async (input: Record<string, unknown>) => ({ id: 900, ...input })),
    createLead: vi.fn(async (input: Record<string, unknown>) => ({ id: 901, ...input })),
    getLead: vi.fn(async (orgId: number, id: number) => (orgId === 7 && id === 11 ? { id: 11, organizationId: 7 } : undefined)),
    getProperty: vi.fn(async (orgId: number, id: number) => (orgId === 7 && id === 21 ? { id: 21, organizationId: 7 } : undefined)),
    getDeal: vi.fn(async (orgId: number, id: number) => (orgId === 7 && id === 31 ? { id: 31, organizationId: 7 } : undefined)),
    preflight: vi.fn(async (url: string, _o?: unknown) => ({ kind: "clear", url: new URL(url) })),
    navigate: vi.fn(async (url: string) => state.pages[url] ?? { kind: "refused", reason: "did_not_load", detail: "no fixture" }),
    close: vi.fn(async () => undefined),
    openNavigator: vi.fn(),
  };
});
H.openNavigator.mockImplementation(async () => ({ navigate: H.navigate, close: H.close }));

vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  const shared = await import("../../shared/pax-controls");
  return {
    ...actual,
    getPaxControls: vi.fn(async () => ({
      stance: "ask_before_sending" as const,
      leadScoring: true,
      borrowerReminders: true,
      inboxDrafts: true,
      rails: shared.defaultPaxRails(),
      mySites: H.state.mySites,
      paused: H.state.paused,
      pausedUntil: H.state.paused ? new Date("2030-01-01T00:00:00Z") : null,
      pausedBy: null,
      checkFailed: false,
      timezone: "America/Chicago",
    })),
  };
});
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/services/autonomyGuardrails", () => ({
  checkSendRateLimit: vi.fn(async () => ({ allowed: true })),
  checkTcpaBeforeSend: vi.fn(async () => ({ allowed: true })),
  recordAutonomousSend: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/approvalKernel", () => ({
  APPROVAL_REQUIRED_TOOLS: new Set(["send_email", "send_sms"]),
  proposePendingAction: vi.fn(async (input: any) => ({ id: 1, ...input })),
  pendingActionArtifact: (row: any) => ({ pendingApproval: true, pendingActionId: row.id }),
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: vi.fn(), isConfigured: vi.fn(async () => true) },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    logActivity: H.logActivity,
    createProperty: H.createProperty,
    createLead: H.createLead,
    getLead: H.getLead,
    getProperty: H.getProperty,
    getDeal: H.getDeal,
    updateProperty: vi.fn(async () => ({})),
  },
  db: {},
}));
vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: vi.fn(() => ({ canEmail: true, canSms: true })),
  isWithinQuietHours: vi.fn(() => ({ blocked: false })),
  isWithinQuietHoursForLead: vi.fn(() => ({ blocked: false })),
  canSendViaChannel: vi.fn(() => ({ allowed: true })),
  hasCompleteMailingAddress: vi.fn(() => true),
}));
vi.mock("../../server/services/aiContextAggregator", () => ({
  getSystemContext: vi.fn(),
  formatContextForAI: vi.fn(),
  invalidateContextCache: vi.fn(),
}));
vi.mock("../../server/services/parcel", () => ({ lookupParcelByAPN: vi.fn(async () => ({ found: false })) }));
vi.mock("../../server/services/aiOfferService", () => ({ generateOfferSuggestions: vi.fn(), generateOfferLetter: vi.fn() }));
vi.mock("../../server/services/smsService", () => ({ smsService: {}, sendOrgSMS: vi.fn() }));
vi.mock("../../server/services/comps", () => ({ getComparableProperties: vi.fn() }));
vi.mock("../../server/services/data-source-broker", () => ({ DataSourceBroker: class {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/leadEvents", () => ({ emitLeadCreated: vi.fn(), emitLeadUpdated: vi.fn() }));
vi.mock("../../server/services/propertyEvents", () => ({ emitPropertyCreated: vi.fn(), emitPropertyStatusChanged: vi.fn() }));
vi.mock("../../server/middleware/roleScope", () => ({ userHasScope: vi.fn(async () => true) }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/ai/validators", () => ({ validateAtlasOutput: vi.fn(), AtlasOutputType: {} }));
vi.mock("../../server/middleware/fileUploadSecurity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/middleware/fileUploadSecurity")>();
  return { ...actual, validateUrl: vi.fn(async (u: string) => new URL(u)) };
});
vi.mock("../../server/services/browserAutomation", () => ({
  browseWeb: vi.fn(),
  preflightBrowseNavigation: H.preflight,
  openBrowseNavSession: H.openNavigator,
}));

import { executeTool, toolDefinitions, PAUSE_SAFE_TOOLS, getToolsForRole } from "../../server/ai/tools";
import { checkWebSourcedRows, resetBrowseRegistryForTests, WEB_SOURCED_ROW_CAP } from "../../server/services/webSourceFence";
import { resetBrowseGuardsForTests } from "../../server/services/browseRobots";
import { PAX_SEARCH_LIMITS } from "../../server/services/paxBrowseSearch";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";
import { groupForTool, dispatchForTool } from "../../shared/pax-controls";
import { judgeRefusal } from "../../shared/refusal/plainRefusal";

const org = { id: 7, name: "Org A" } as any;
const START = "https://assessor.example.gov/";
const RESULTS = "https://assessor.example.gov/search?q=Doe";
const LISTED = [{ host: "assessor.example.gov", label: "Cochise assessor" }];

const searchForm = {
  method: "get",
  action: "https://assessor.example.gov/search",
  fields: [{ tag: "input", type: "text", name: "q", id: "", placeholder: "Search", ariaLabel: "", value: "", checked: false, hidden: false, disabled: false }],
};
const mk = (url: string, o: Record<string, unknown> = {}) => ({
  kind: "page" as const,
  page: { url, title: "Assessor", content: "Parcel 100-001 Jane Doe", links: [], tables: [], httpStatus: 200, html: "<html></html>", forms: [], anchors: [], ...o },
});

let turn = 0;
const newTurn = () => `search-turn-${++turn}`;
const search = (args: Record<string, unknown>, turnId = newTurn()) =>
  executeTool("browse_search", args, org, { userId: "u-1", origin: "chat", turnId });

const rowsBy = (tool: string) =>
  H.logActivity.mock.calls.map((c) => c[0] as any).filter((row) => row.metadata?.tool === tool);

beforeEach(() => {
  vi.clearAllMocks();
  H.openNavigator.mockImplementation(async () => ({ navigate: H.navigate, close: H.close }));
  H.state.paused = false;
  H.state.mySites = [...LISTED];
  H.state.pages = { [START]: mk(START, { forms: [searchForm] }), [RESULTS]: mk(RESULTS) };
  resetBrowseRegistryForTests();
  resetBrowseGuardsForTests();
});

describe("the site gate", () => {
  it("runs a search on a listed site named by its label", async () => {
    const r = await search({ site: "Cochise assessor", query: "Doe" });
    expect(r.success).toBe(true);
    expect(r.data.site).toBe("assessor.example.gov");
    expect(r.data.pages).toHaveLength(1);
    expect(r.data.pages[0].content).toContain("Jane Doe");
    expect(r.data.pagesVisited).toEqual(["https://assessor.example.gov/", "https://assessor.example.gov/search"]);
    expect(H.navigate.mock.calls.map((c) => c[0])).toEqual([START, RESULTS]);
    expect(H.close).toHaveBeenCalledTimes(1);
  });

  it("refuses a site that is not listed — by name or host — and never opens the browser", async () => {
    for (const site of ["Pima County treasurer", "treasurer.example.gov", "example.gov"]) {
      const r = await search({ site, query: "Doe" });
      expect(r.success, site).toBe(false);
      expect(r.error).toMatch(/not on your list of county sites/);
      expect(r.error).toMatch(/My county sites/);
      expect(judgeRefusal(r.error!), r.error).toEqual({ plain: true, problems: [] });
    }
    expect(H.openNavigator).not.toHaveBeenCalled();
    expect(H.preflight).not.toHaveBeenCalled();
  });

  it("an EMPTY list allows nothing by name (fail-closed)", async () => {
    H.state.mySites = [];
    const r = await search({ site: "Cochise assessor", query: "Doe" });
    expect(r.success).toBe(false);
    expect(H.openNavigator).not.toHaveBeenCalled();
  });

  it("a full address the user gave runs for that exact host", async () => {
    H.state.mySites = [];
    const r = await search({ site: START, query: "Doe" });
    expect(r.success).toBe(true);
    expect(H.navigate.mock.calls.map((c) => c[0])).toEqual([START, RESULTS]);
  });

  it("is not an address: credentials, an IP, another scheme, nothing", async () => {
    for (const site of ["https://user:pw@assessor.example.gov/", "http://10.0.0.1/", "ftp://assessor.example.gov/", ""]) {
      const r = await search({ site, query: "Doe" });
      expect(r.success, site).toBe(false);
      expect(judgeRefusal(r.error!), r.error).toEqual({ plain: true, problems: [] });
    }
    expect(H.openNavigator).not.toHaveBeenCalled();
  });

  it("refuses without a query", async () => {
    const r = await search({ site: "Cochise assessor", query: "   " });
    expect(r.success).toBe(false);
    expect(H.openNavigator).not.toHaveBeenCalled();
  });
});

describe("attach_to: verified before searching, one timeline row after", () => {
  it.each([
    ["a lead", { kind: "lead", id: 11 }, "lead", 11],
    ["a property", { kind: "property", id: 21 }, "property", 21],
    ["a deal", { kind: "deal", id: 31 }, "deal", 31],
  ])("%s gets exactly ONE provenance-tagged row", async (_name, attach_to, entityType, entityId) => {
    const r = await search({ site: "Cochise assessor", query: "Doe", attach_to, finding: "Owner of record is Jane Doe; taxes current." });
    expect(r.success).toBe(true);
    expect(r.data.noteSaved).toBe(true);
    const rows = rowsBy("browse_search");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: 7, agentType: "pax", entityType, entityId });
    expect(rows[0].description).toContain("assessor.example.gov");
    expect(rows[0].description).toContain('for "Doe"');
    expect(rows[0].description).toContain("Owner of record is Jane Doe");
    expect(rows[0].changes.after).toEqual({
      host: "assessor.example.gov",
      url: "https://assessor.example.gov/search",
      query: "Doe",
      source: "web:assessor.example.gov",
    });
    // the full page text goes to the conversation, never into the timeline
    expect(JSON.stringify(rows[0])).not.toContain("Parcel 100-001");
  });

  it("a record that is not in this account refuses the WHOLE call, and nothing is fetched", async () => {
    for (const attach_to of [{ kind: "lead", id: 999 }, { kind: "property", id: 11 }, { kind: "deal", id: 21 }]) {
      const r = await search({ site: "Cochise assessor", query: "Doe", attach_to });
      expect(r.success, JSON.stringify(attach_to)).toBe(false);
      expect(r.error).toMatch(/not in this account/);
      expect(judgeRefusal(r.error!), r.error).toEqual({ plain: true, problems: [] });
    }
    expect(H.openNavigator).not.toHaveBeenCalled();
    expect(H.navigate).not.toHaveBeenCalled();
    expect(rowsBy("browse_search")).toHaveLength(0);
  });

  it("another org's record id is not found by the org-scoped getters (cross-org)", async () => {
    const r = await executeTool("browse_search", { site: "Cochise assessor", query: "Doe", attach_to: { kind: "lead", id: 11 } }, { id: 8, name: "Org B" } as any, {
      userId: "u-9",
      origin: "chat",
      turnId: newTurn(),
    });
    expect(r.success).toBe(false);
    expect(H.getLead).toHaveBeenCalledWith(8, 11);
    expect(H.openNavigator).not.toHaveBeenCalled();
  });

  it("a malformed attach target refuses plainly", async () => {
    for (const attach_to of [{ kind: "task", id: 1 }, { kind: "lead" }, { kind: "lead", id: "abc" }, { kind: "lead", id: -4 }, "lead 11"]) {
      const r = await search({ site: "Cochise assessor", query: "Doe", attach_to });
      expect(r.success, JSON.stringify(attach_to)).toBe(false);
      expect(judgeRefusal(r.error!), r.error).toEqual({ plain: true, problems: [] });
    }
    expect(H.openNavigator).not.toHaveBeenCalled();
  });

  it("the finding is capped in code", async () => {
    await search({ site: "Cochise assessor", query: "Doe", attach_to: { kind: "lead", id: 11 }, finding: "x".repeat(900) });
    const description: string = rowsBy("browse_search")[0].description;
    const finding = description.match(/x{20,}/)?.[0] ?? "";
    expect(finding.length).toBe(PAX_SEARCH_LIMITS.maxFindingChars);
  });

  it("no attach_to, no timeline row", async () => {
    const r = await search({ site: "Cochise assessor", query: "Doe" });
    expect(r.data.noteSaved).toBe(false);
    expect(rowsBy("browse_search")).toHaveLength(0);
  });

  it("while Pax is paused the search still runs and answers, but no note is written", async () => {
    H.state.paused = true;
    const r = await search({ site: "Cochise assessor", query: "Doe", attach_to: { kind: "lead", id: 11 }, finding: "Found it." });
    expect(r.success).toBe(true);
    expect(r.data.pages).toHaveLength(1);
    expect(r.data.noteSaved).toBe(false);
    expect(r.data.noteNotSaved).toMatch(/paused/);
    expect(rowsBy("browse_search")).toHaveLength(0);
    // the visit itself is still receipted, as for browse_web
    expect(rowsBy("browse_web").length).toBeGreaterThan(0);
  });
});

describe("a CAPTCHA is a plain refusal and a handoff", () => {
  it("names the human check and the way forward, is receipted, and is never retried", async () => {
    H.state.pages = {
      [START]: mk(START, { forms: [searchForm] }),
      [RESULTS]: mk(RESULTS, { html: '<div class="g-recaptcha" data-sitekey="k"></div>', content: "Please complete the security check" }),
    };
    const r = await search({ site: "Cochise assessor", query: "Doe", max_pages: 3 });
    expect(r.success).toBe(false);
    expect(r.refusal).toMatchObject({ what: "The search was not finished" });
    expect(r.refusal!.why).toMatch(/human check/);
    expect(r.refusal!.why).toMatch(/CAPTCHA/);
    expect(r.refusal!.unlock).toMatch(/^Open Cochise assessor yourself, run the search, and paste the result page address here/);
    expect(judgeRefusal(r.error!), r.error).toEqual({ plain: true, problems: [] });
    expect(H.navigate.mock.calls.filter((c) => c[0] === RESULTS)).toHaveLength(1);
    expect(H.navigate).toHaveBeenCalledTimes(2);
    expect(rowsBy("browse_web").map((x) => x.changes.after.outcome)).toEqual(["read", "refused"]);
  });

  it("every way the session can refuse reads as plain words", async () => {
    const cases: Array<[string, () => void]> = [
      ["no search box", () => { H.state.pages = { [START]: mk(START, { forms: [] }) }; }],
      ["a login wall", () => { H.state.pages = { [START]: mk(START, { forms: [{ method: "post", action: START, fields: [{ ...searchForm.fields[0], name: "user" }, { ...searchForm.fields[0], type: "password", name: "pw" }] }] }) }; }],
      ["a robots refusal", () => { H.preflight.mockResolvedValueOnce({ kind: "refused", reason: "robots_disallowed", detail: "" } as any); }],
      ["a rate limit", () => { H.preflight.mockResolvedValueOnce({ kind: "refused", reason: "rate_limited", detail: "" } as any); }],
      ["a private address", () => { H.preflight.mockResolvedValueOnce({ kind: "refused", reason: "private_address", detail: "" } as any); }],
      ["a page that does not load", () => { H.state.pages = {}; }],
      ["an error page", () => { H.state.pages = { [START]: mk(START, { httpStatus: 500, content: "Server error" }) }; }],
    ];
    for (const [name, arrange] of cases) {
      vi.clearAllMocks();
      H.openNavigator.mockImplementation(async () => ({ navigate: H.navigate, close: H.close }));
      H.state.pages = { [START]: mk(START, { forms: [searchForm] }), [RESULTS]: mk(RESULTS) };
      resetBrowseGuardsForTests();
      arrange();
      const r = await search({ site: "Cochise assessor", query: "Doe" });
      expect(r.success, name).toBe(false);
      expect(judgeRefusal(r.error!), `${name}: ${r.error}`).toEqual({ plain: true, problems: [] });
    }
  });
});

describe("the PX-1 fence applies to what a search reads", () => {
  it("a search turn is web-sourced: a page's worth of rows is refused afterwards, a few are tagged", async () => {
    const turnId = newTurn();
    await search({ site: "Cochise assessor", query: "Doe" }, turnId);
    const verdict = checkWebSourcedRows(7, turnId, 50);
    expect(verdict).toMatchObject({ webSourced: true, allowed: false, cap: WEB_SOURCED_ROW_CAP, tag: "web:assessor.example.gov" });
    expect(checkWebSourcedRows(7, turnId, 2)).toMatchObject({ webSourced: true, allowed: true, tag: "web:assessor.example.gov" });
  });

  it("the tool creates no records itself", async () => {
    await search({ site: "Cochise assessor", query: "Doe", attach_to: { kind: "lead", id: 11 } });
    expect(H.createLead).not.toHaveBeenCalled();
    expect(H.createProperty).not.toHaveBeenCalled();
  });

  it("a refused session leaves the turn un-browsed", async () => {
    const turnId = newTurn();
    H.preflight.mockResolvedValueOnce({ kind: "refused", reason: "robots_disallowed", detail: "" } as any);
    const r = await search({ site: "Cochise assessor", query: "Doe" }, turnId);
    expect(r.success).toBe(false);
    expect(checkWebSourcedRows(7, turnId, 1)).toEqual({ webSourced: false });
  });
});

describe("the model cannot widen the step language", () => {
  it("unknown arguments are ignored: the browser is asked for exactly open + search", async () => {
    const r = await search({
      site: "Cochise assessor",
      query: "Doe",
      steps: [{ kind: "click", selector: "#delete-all" }],
      selector: "#go",
      method: "POST",
      body: "x=1",
      script: "document.cookie",
    });
    expect(r.success).toBe(true);
    expect(H.navigate.mock.calls.map((c) => c[0])).toEqual([START, RESULTS]);
    // the navigator is built with no way to type or click: it takes a URL and nothing else
    expect(H.navigate.mock.calls.every((c) => c.length === 1)).toBe(true);
  });

  it("max_pages and open_result stay inside the code bounds", async () => {
    const PAGE2 = "https://assessor.example.gov/search?q=Doe&page=2";
    H.state.pages = {
      [START]: mk(START, { forms: [searchForm] }),
      [RESULTS]: mk(RESULTS, { anchors: [{ text: "Next", href: PAGE2, rel: "" }], links: [{ text: "Parcel 1", href: "/parcel/1" }] }),
      [PAGE2]: mk(PAGE2, { anchors: [{ text: "Next", href: "/search?q=Doe&page=3", rel: "" }] }),
      "https://assessor.example.gov/parcel/1": mk("https://assessor.example.gov/parcel/1", { content: "Parcel detail" }),
    };
    const many = await search({ site: "Cochise assessor", query: "Doe", max_pages: 99 });
    expect(many.success).toBe(true);
    expect(H.navigate.mock.calls.length).toBeLessThanOrEqual(PAX_SEARCH_LIMITS.maxPages);
    expect(many.data.pages.length).toBeLessThanOrEqual(3);

    vi.clearAllMocks();
    H.openNavigator.mockImplementation(async () => ({ navigate: H.navigate, close: H.close }));
    const one = await search({ site: "Cochise assessor", query: "Doe", open_result: 0 });
    expect(one.success).toBe(true);
    expect(one.data.pages.map((p: any) => p.content)).toContain("Parcel detail");

    vi.clearAllMocks();
    H.openNavigator.mockImplementation(async () => ({ navigate: H.navigate, close: H.close }));
    const outOfRange = await search({ site: "Cochise assessor", query: "Doe", open_result: 40 });
    expect(outOfRange.success).toBe(true); // the search page was read; the hop was refused
    expect(outOfRange.data.endedEarly).toMatch(/not among the links/);
  });
});

describe("registration", () => {
  it("is a defined tool with the args the contract names", () => {
    const def = (toolDefinitions as Record<string, any>).browse_search;
    expect(def.name).toBe("browse_search");
    expect(def.parameters.required).toEqual(["site", "query"]);
    for (const key of ["site", "query", "attach_to", "max_pages"]) expect(def.parameters.properties[key], key).toBeDefined();
    expect(def.parameters.properties.attach_to.properties.kind.enum).toEqual(["lead", "property", "deal"]);
  });

  it("is looks_and_drafts, dispatched by executeTool, pause-safe, behind the Map door — like browse_web", () => {
    expect(groupForTool("browse_search")).toBe("looks_and_drafts");
    expect(groupForTool("browse_search")).toBe(groupForTool("browse_web"));
    expect(dispatchForTool("browse_search")).toBe("executeTool");
    expect(PAUSE_SAFE_TOOLS.has("browse_search")).toBe(true);
    expect(INTENT_META.browse_search).toEqual(INTENT_META.browse_web);
  });

  it("is offered to every role that is offered browse_web", () => {
    for (const role of ["executive", "assistant", "acquisitions", "underwriting", "marketing", "research", "documents"]) {
      const names = getToolsForRole(role).map((t) => t.function.name);
      expect(names.includes("browse_search"), role).toBe(names.includes("browse_web"));
    }
  });
});
