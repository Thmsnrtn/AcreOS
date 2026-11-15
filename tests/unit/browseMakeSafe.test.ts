/**
 * PX-1 (register P-4) — browse is made safe BEFORE it is made powerful.
 *
 * The defect: Pax's `browse_web` could turn a page's text into property and
 * lead records with no licence check, no row cap and no receipt. The licensed-
 * data fence held by the model's good behaviour, not by a gate.
 *
 * What is pinned here, through the real `executeTool`:
 *   1. a browse writes a receipt (host, URL without its query string, the turn)
 *      even though the tool is pause-safe — and a receipt that fails to write
 *      never breaks the browse;
 *   2. a page's worth (50) of web-sourced parcels fed to create_properties_batch
 *      is REFUSED WHOLE, naming the licence check, with nothing written;
 *   3. the same 50 rows with NO browse in the turn are not touched by the fence;
 *   4. the cap is per turn across single-row creates, not per call (a model
 *      cannot slip past it by calling create_property fifty times);
 *   5. rows under the cap go through tagged `web:<host>` (lead.source; the
 *      property's due-diligence notes — properties have no source column);
 *   6. a cleared host lifts the fence (the list is empty by default);
 *   7. robots.txt and the visit rate limit (pure module, fakes at the seam).
 *
 * Mock scaffold mirrors tests/unit/tenantBoundaryTaskTools.test.ts so the
 * executeTool module graph stays light (no DB, no SES, no browser).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  logActivity: vi.fn(async (_row: Record<string, unknown>) => undefined as unknown),
  createProperty: vi.fn(async (input: Record<string, unknown>) => ({ id: 900, ...input })),
  createLead: vi.fn(async (input: Record<string, unknown>) => ({ id: 901, ...input })),
  browseWeb: vi.fn(async (_url: string, _opts?: Record<string, unknown>) => ({
    success: true,
    url: "https://assessor.example.com/parcels",
    title: "Parcels",
    content: "APN 100-001 ...",
    links: [] as Array<{ text: string; href: string }>,
    tables: [] as string[],
    screenshot: undefined as string | undefined,
    loadTimeMs: 5,
  })),
}));

vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return {
    ...actual,
    getPaxControls: vi.fn(async () => ({
      stance: "ask_before_sending" as const,
      leadScoring: true,
      borrowerReminders: true,
      inboxDrafts: true,
      paused: false,
      pausedUntil: null,
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
vi.mock("../../server/services/parcel", () => ({
  lookupParcelByAPN: vi.fn(async () => ({ found: false })),
}));
vi.mock("../../server/services/aiOfferService", () => ({
  generateOfferSuggestions: vi.fn(),
  generateOfferLetter: vi.fn(),
}));
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
vi.mock("../../server/ai/validators", () => ({
  validateAtlasOutput: vi.fn(),
  AtlasOutputType: {},
}));
// The SSRF guard is its own suite's business (validateUrl.test.ts); here the
// address is public and the browser itself is a fake.
vi.mock("../../server/middleware/fileUploadSecurity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/middleware/fileUploadSecurity")>();
  return { ...actual, validateUrl: vi.fn(async (u: string) => new URL(u)) };
});
vi.mock("../../server/services/browserAutomation", () => ({ browseWeb: H.browseWeb }));

import { executeTool } from "../../server/ai/tools";
import { WEB_SOURCED_ROW_CAP, CLEARED_SOURCE_ENV, resetBrowseRegistryForTests } from "../../server/services/webSourceFence";
import {
  parseRobotsTxt,
  isPathAllowedByRobots,
  checkRobots,
  takeBrowseVisit,
  resetBrowseGuardsForTests,
  BROWSE_RATE_MAX_VISITS,
  BROWSE_RATE_WINDOW_MS,
  ROBOTS_FAILURE_TTL_MS,
} from "../../server/services/browseRobots";

const org = { id: 7, name: "Org A" } as any;
const BROWSE_URL = "https://assessor.example.com/parcels?session=SECRET#frag";
let turnCounter = 0;
const newTurn = () => `turn-${++turnCounter}`;

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ apn: `100-${String(i).padStart(3, "0")}`, county: "Cochise", state: "AZ" }));

const browse = (turnId: string, url = BROWSE_URL) =>
  executeTool("browse_web", { url }, org, { userId: "u-1", origin: "chat", turnId });

const savedEnv = process.env[CLEARED_SOURCE_ENV];

beforeEach(() => {
  vi.clearAllMocks();
  resetBrowseRegistryForTests();
  resetBrowseGuardsForTests();
  delete process.env[CLEARED_SOURCE_ENV];
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[CLEARED_SOURCE_ENV];
  else process.env[CLEARED_SOURCE_ENV] = savedEnv;
});

describe("browse_web leaves a receipt (pause-safe tool, receipt anyway)", () => {
  it("writes one pax receipt naming the host, the URL without its query, and the turn", async () => {
    const turn = newTurn();
    const r = await browse(turn);
    expect(r.success).toBe(true);

    const receipts = H.logActivity.mock.calls.map((c) => c[0] as any).filter((row) => row.metadata?.tool === "browse_web");
    expect(receipts).toHaveLength(1);
    const receipt = receipts[0];
    expect(receipt.agentType).toBe("pax");
    expect(receipt.organizationId).toBe(7);
    expect(receipt.metadata.receipt).toBe("pax_effect");
    expect(receipt.changes.after.host).toBe("assessor.example.com");
    expect(receipt.changes.after.turnId).toBe(turn);
    expect(receipt.changes.after.url).toBe("https://assessor.example.com/parcels");
    expect(JSON.stringify(receipt)).not.toContain("SECRET");
  });

  it("a receipt that fails to write never breaks the browse", async () => {
    H.logActivity.mockRejectedValueOnce(new Error("activity_log is down"));
    const r = await browse(newTurn());
    expect(r.success).toBe(true);
    expect((r.data as any).title).toBe("Parcels");
  });

  it("a robots refusal is receipted too, and is a plain refusal rather than content", async () => {
    H.browseWeb.mockResolvedValueOnce({
      success: false, url: BROWSE_URL, title: "", content: "", links: [], tables: [], screenshot: undefined,
      loadTimeMs: 1, robotsDisallowed: true,
    } as any);
    const r = await browse(newTurn());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/respect them/);
    const receipt = H.logActivity.mock.calls.map((c) => c[0] as any).find((row) => row.metadata?.tool === "browse_web");
    expect(receipt?.changes.after.outcome).toBe("refused");
  });
});

describe("the bulk fence on web-sourced rows", () => {
  it(`REFUSES a page's worth (50) of web-sourced parcels in create_properties_batch — whole, naming the licence check`, async () => {
    const turn = newTurn();
    await browse(turn);
    const r = await executeTool("create_properties_batch", { properties: rows(50) }, org, { origin: "chat", turnId: turn });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/licence check/);
    expect(r.error).toContain("assessor.example.com");
    expect(H.createProperty).not.toHaveBeenCalled(); // refused whole, not truncated to the cap
  });

  it("the same 50 rows with NO browse in the turn are not refused by this fence", async () => {
    const r = await executeTool("create_properties_batch", { properties: rows(50) }, org, { origin: "chat", turnId: newTurn() });
    expect(r.success).toBe(true);
    expect(H.createProperty).toHaveBeenCalledTimes(50);
    for (const call of H.createProperty.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain("web:");
    }
  });

  it("a browse in ANOTHER turn does not fence this turn's rows", async () => {
    await browse(newTurn());
    const r = await executeTool("create_properties_batch", { properties: rows(50) }, org, { origin: "chat", turnId: newTurn() });
    expect(r.success).toBe(true);
    expect(H.createProperty).toHaveBeenCalledTimes(50);
  });

  it("rows within the cap go through, each tagged web:<host>", async () => {
    const turn = newTurn();
    await browse(turn);
    const r = await executeTool("create_properties_batch", { properties: rows(WEB_SOURCED_ROW_CAP) }, org, { origin: "chat", turnId: turn });
    expect(r.success).toBe(true);
    expect(H.createProperty).toHaveBeenCalledTimes(WEB_SOURCED_ROW_CAP);
    for (const call of H.createProperty.mock.calls) {
      expect((call[0] as any).dueDiligenceData.notes).toBe("source: web:assessor.example.com");
    }
  });

  it("the cap is per TURN: single-row creates cannot slip past it one call at a time", async () => {
    const turn = newTurn();
    await browse(turn);
    const results = [];
    for (let i = 0; i < WEB_SOURCED_ROW_CAP + 3; i++) {
      results.push(await executeTool("create_property", { apn: `200-${i}`, county: "Cochise", state: "AZ", sizeAcres: 5 }, org, { origin: "chat", turnId: turn }));
    }
    expect(results.filter((x) => x.success)).toHaveLength(WEB_SOURCED_ROW_CAP);
    expect(results[WEB_SOURCED_ROW_CAP].error).toMatch(/licence check/);
    expect(H.createProperty).toHaveBeenCalledTimes(WEB_SOURCED_ROW_CAP);
  });

  it("create_lead after a browse carries source web:<host>, and is capped with the same budget", async () => {
    const turn = newTurn();
    await browse(turn);
    const first = await executeTool("create_lead", { first_name: "A", last_name: "B", source: "referral" }, org, { origin: "chat", turnId: turn });
    expect(first.success).toBe(true);
    expect((H.createLead.mock.calls[0][0] as any).source).toBe("web:assessor.example.com");
    let refused = 0;
    for (let i = 0; i < WEB_SOURCED_ROW_CAP + 2; i++) {
      const r = await executeTool("create_lead", { first_name: `L${i}`, last_name: "X" }, org, { origin: "chat", turnId: turn });
      if (!r.success) refused++;
    }
    expect(refused).toBe(3); // 1 + (CAP+2) attempts against a cap of CAP
  });

  it("a lead made with no browse in the turn keeps its own source", async () => {
    await executeTool("create_lead", { first_name: "A", last_name: "B", source: "referral" }, org, { origin: "chat", turnId: newTurn() });
    expect((H.createLead.mock.calls[0][0] as any).source).toBe("referral");
  });

  it("starts EMPTY (fail-closed) and a cleared host lifts the fence", async () => {
    expect(process.env[CLEARED_SOURCE_ENV]).toBeUndefined();
    const closedTurn = newTurn();
    await browse(closedTurn);
    const closed = await executeTool("create_properties_batch", { properties: rows(50) }, org, { origin: "chat", turnId: closedTurn });
    expect(closed.success).toBe(false);

    process.env[CLEARED_SOURCE_ENV] = "example.com";
    const clearedTurn = newTurn();
    await browse(clearedTurn);
    const open = await executeTool("create_properties_batch", { properties: rows(50) }, org, { origin: "chat", turnId: clearedTurn });
    expect(open.success).toBe(true);
    expect(H.createProperty).toHaveBeenCalledTimes(50);
    // Cleared is not anonymous: the rows still carry where they came from.
    expect((H.createProperty.mock.calls[0][0] as any).dueDiligenceData.notes).toBe("source: web:assessor.example.com");
  });

  it("a cleared suffix does not clear a look-alike host", async () => {
    process.env[CLEARED_SOURCE_ENV] = "example.com";
    const turn = newTurn();
    await browse(turn, "https://notexample.com/parcels");
    const r = await executeTool("create_properties_batch", { properties: rows(50) }, org, { origin: "chat", turnId: turn });
    expect(r.success).toBe(false);
  });
});

describe("robots.txt", () => {
  const url = (p: string) => new URL(`https://site.example.com${p}`);

  it("honours Disallow, with Allow overriding by longest match, wildcards and $", () => {
    const rules = parseRobotsTxt(
      ["User-agent: *", "Disallow: /private", "Allow: /private/ok", "Disallow: /*.pdf$"].join("\n"),
    );
    expect(isPathAllowedByRobots(rules, "/private/x")).toBe(false);
    expect(isPathAllowedByRobots(rules, "/private/ok/y")).toBe(true);
    expect(isPathAllowedByRobots(rules, "/a/b.pdf")).toBe(false);
    expect(isPathAllowedByRobots(rules, "/a/b.pdf?x=1")).toBe(true);
    expect(isPathAllowedByRobots(rules, "/public")).toBe(true);
  });

  it("a group naming us beats the * group; an empty Disallow allows everything", () => {
    const rules = parseRobotsTxt(["User-agent: *", "Disallow: /", "", "User-agent: acreos", "Disallow:"].join("\n"));
    expect(isPathAllowedByRobots(rules, "/anything")).toBe(true);
  });

  it("a disallowed path is refused; a 4xx robots (none) allows; a server error is UNVERIFIED (fail-closed)", async () => {
    expect(await checkRobots(url("/secret/1"), async () => ({ status: "ok", body: "User-agent: *\nDisallow: /secret" }))).toBe("disallowed");
    resetBrowseGuardsForTests();
    expect(await checkRobots(url("/secret/1"), async () => ({ status: "none" }))).toBe("allowed");
    resetBrowseGuardsForTests();
    expect(await checkRobots(url("/page"), async () => ({ status: "error" }))).toBe("unverified");
  });

  it("caches per origin, and re-checks a failed fetch after the failure TTL", async () => {
    const fetcher = vi.fn(async () => ({ status: "ok" as const, body: "User-agent: *\nDisallow: /x" }));
    await checkRobots(url("/a"), fetcher, 1000);
    await checkRobots(url("/b"), fetcher, 2000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resetBrowseGuardsForTests();
    const failing = vi.fn(async () => ({ status: "error" as const }));
    await checkRobots(url("/a"), failing, 1000);
    await checkRobots(url("/a"), failing, 1000 + ROBOTS_FAILURE_TTL_MS - 1);
    expect(failing).toHaveBeenCalledTimes(1);
    await checkRobots(url("/a"), failing, 1000 + ROBOTS_FAILURE_TTL_MS + 1);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("visit rate limit", () => {
  it("allows the budget per org per host, refuses the next, and frees up after the window", () => {
    for (let i = 0; i < BROWSE_RATE_MAX_VISITS; i++) expect(takeBrowseVisit(7, "a.example.com", 1000 + i).allowed).toBe(true);
    expect(takeBrowseVisit(7, "a.example.com", 2000).allowed).toBe(false);
    // another host, and another org, have their own budget
    expect(takeBrowseVisit(7, "b.example.com", 2000).allowed).toBe(true);
    expect(takeBrowseVisit(8, "a.example.com", 2000).allowed).toBe(true);
    // the window rolls
    expect(takeBrowseVisit(7, "a.example.com", 1000 + BROWSE_RATE_WINDOW_MS + 100).allowed).toBe(true);
  });
});
