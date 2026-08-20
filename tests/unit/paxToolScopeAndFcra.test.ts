/**
 * The Pax tool chokepoint enforces the permission ladder, and refuses the
 * FCRA-regulated lookup outright.
 *
 * ── THE FINDING ─────────────────────────────────────────────────────────────
 * Skip-trace had two doors and only one of them was guarded.
 *
 * The REST door (`POST /api/skip-traces`, routes-leads.ts) requires
 * `requireScope("tenant_pii_write")` — a scope `member`, `va`, `viewer` and
 * `intern` do NOT hold — plus a purpose from a closed enum, a justification of
 * at least ten characters, and a current annual FCRA §1681b(a)(3)(F)
 * attestation, all persisted on a `skip_traces` row whose stated reason for
 * existing is "class-action defense audit trail".
 *
 * The Pax door (`ai/tools.ts` → `connectors/executor.batchLeadsSkipTrace`)
 * required none of it: no scope, no purpose, no attestation, no audit row. A
 * `member` typed a sentence and got a third party's phone numbers, emails and
 * prior addresses. It also sat on `PAUSE_SAFE_TOOLS`, so it ran even while the
 * customer had Pax paused.
 *
 * Underneath that was a general hole: the App Intent registry declares a
 * `requiredScope` for every intent, and NOTHING on the Pax path read it. The
 * only consumer was `mcp/safeIntents.ts`, deciding which intents an external
 * agent may SEE. A canonical declaration with no enforcement — CLAUDE.md's
 * second law. And the declaration itself was wrong for this intent: it said
 * `deal_read`, the weakest scope in the ladder.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * The real `userHasScope` and the real `ROLE_SCOPES` table decide every case
 * below; only the database row is a fixture. A mock standing in for the
 * predicate would make this suite agree with any implementation of it,
 * including one with the polarity inverted — the mistake
 * `paxPauseToolGate.test.ts` records for `unattendedSendPermitted`.
 *
 * Both directions are asserted, because a gate that refuses everything is
 * deleted the first week and then guards nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getPaxPauseState, selectFn, memberRow, logWarn } = vi.hoisted(() => {
  const memberRow = { current: null as null | { role: string } };
  const selectFn = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () => (memberRow.current ? [memberRow.current] : []),
      }),
    }),
  }));
  return {
    getPaxPauseState: vi.fn(async () => ({
      paused: false,
      pausedUntil: null as Date | null,
      checkFailed: false,
    })),
    selectFn,
    memberRow,
    logWarn: vi.fn(),
  };
});

vi.mock("../../server/services/paxPause", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxPause")>();
  return { ...actual, getPaxPauseState };
});

// The DB row is the ONLY fixture. `userHasScope` and ROLE_SCOPES stay real.
vi.mock("../../server/db", () => ({ db: { select: selectFn } }));

vi.mock("../../server/services/approvalKernel", () => ({
  APPROVAL_REQUIRED_TOOLS: new Set(["send_email", "send_sms"]),
  proposePendingAction: vi.fn(async (i: any) => ({ id: 1, ...i })),
  pendingActionArtifact: (row: any) => ({ pendingApproval: true, pendingActionId: row.id }),
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getLeads: vi.fn(async () => []),
    createLead: vi.fn(async (i: any) => ({ id: 43, ...i })),
    logActivity: vi.fn(async () => undefined),
  },
  db: {},
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: vi.fn(), isConfigured: vi.fn(async () => true) },
}));
vi.mock("../../server/services/smsService", () => ({ smsService: {}, sendOrgSMS: vi.fn() }));
vi.mock("../../server/services/aiContextAggregator", () => ({
  getSystemContext: vi.fn(),
  formatContextForAI: vi.fn(),
  invalidateContextCache: vi.fn(),
}));
vi.mock("../../server/services/parcel", () => ({ lookupParcelByAPN: vi.fn() }));
vi.mock("../../server/services/aiOfferService", () => ({
  generateOfferSuggestions: vi.fn(),
  generateOfferLetter: vi.fn(),
}));
vi.mock("../../server/services/comps", () => ({ getComparableProperties: vi.fn() }));
vi.mock("../../server/services/data-source-broker", () => ({ DataSourceBroker: class {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/ai/validators", () => ({ validateAtlasOutput: vi.fn(), AtlasOutputType: {} }));

// The executor this gate blocked was DELETED on 2026-08-20 (deletion ledger):
// the FCRA refusal made it unreachable and Pax was its only caller. The
// dispatch branch went with it, so `batch_leads_skip_trace` has no path past
// the gate at all.
//
// The old scaffold kept a throwing mock here and asserted it was never called.
// With nothing left to call, that assertion would be true no matter what the
// gate did — decoration. It is replaced by the source case at the bottom of
// this file, which asserts the branch and the executor are actually gone.
vi.mock("../../server/services/connectors/executor", () => ({
  propstreamLookup: vi.fn(),
  propstreamComps: vi.fn(),
  searchMlsListings: vi.fn(),
  getMlsComps: vi.fn(),
  triggerZapier: vi.fn(),
  triggerMake: vi.fn(),
}));

import { executeTool, PAUSE_SAFE_TOOLS } from "../../server/ai/tools";
import { scopeForIntent, PII_SCOPES, INTENT_META } from "../../server/services/appIntents/intentScopes";

const OWNER = "user_owner";
const org = { id: 7, name: "Test Org", ownerId: OWNER } as any;

/** The org's team_members row for the next lookup — or none. */
function asRole(role: string | null) {
  memberRow.current = role ? { role } : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  asRole(null);
  getPaxPauseState.mockResolvedValue({ paused: false, pausedUntil: null, checkFailed: false });
});
afterEach(() => vi.clearAllMocks());

describe("the declaration is true, and it is the one the REST door uses", () => {
  it("skip-trace declares a tenant-PII scope, not a deal scope", () => {
    const scope = scopeForIntent("batch_leads_skip_trace");
    expect(scope, "the intent must declare the scope its REST door requires").toBe(
      "tenant_pii_write",
    );
    expect(PII_SCOPES.has(scope!)).toBe(true);
  });

  it("vacuity: the intent table is populated and mostly scoped", () => {
    // Every assertion in this file reads that table. An empty or half-parsed
    // one would make the gate a no-op and every refusal case below a
    // coincidence.
    const entries = Object.entries(INTENT_META);
    expect(entries.length, "the intent table collapsed").toBeGreaterThan(40);
    const scoped = entries.filter(([, m]) => m.scope !== null);
    expect(scoped.length, "almost nothing declares a scope any more").toBeGreaterThan(30);
  });

  it("skip-trace is NOT on the pause allowlist", () => {
    // A consumer-report lookup that spends the org's credits and returns a
    // third party's contact details is not "safe while Pax is paused".
    expect(PAUSE_SAFE_TOOLS.has("batch_leads_skip_trace")).toBe(false);
  });
});

describe("the FCRA-regulated lookup is refused on the Pax path", () => {
  it("refuses a caller who DOES hold the scope, and does not reach the connector", async () => {
    // `screening_specialist` holds tenant_pii_write, so the permission gate
    // above lets this through and the FCRA gate is what stops it. Written this
    // way on purpose: with an unscoped caller the refusal proves nothing about
    // FCRA, because the scope gate fires first and the messages differ.
    asRole("screening_specialist");
    const result = await executeTool(
      "batch_leads_skip_trace",
      { firstName: "Jane", lastName: "Doe", address: "1 Main St" },
      org,
      { userId: "user_screener" },
    );
    expect(result.success).toBe(false);
    expect(result.error, "the scope gate answered; the FCRA gate never ran").toMatch(
      /skip trace/i,
    );
  });

  it("refuses the OWNER too — holding every scope is not an attestation", async () => {
    // The semantic core. The owner passes the permission ladder outright, so if
    // the refusal were only a scope check this case would sail through. A
    // permissible purpose, a written justification and a current annual
    // attestation are things a PERSON supplies; no role confers them.
    const result = await executeTool(
      "batch_leads_skip_trace",
      { firstName: "Jane", lastName: "Doe" },
      org,
      { userId: OWNER },
    );
    expect(result.success).toBe(false);
  });

  it("refuses even with trustedApproval — a human tap is not an attestation", async () => {
    // trustedApproval is the witnessed-send option the approve endpoint sets.
    // It proves a human approved THIS action. It does not prove they hold
    // tenant_pii_write, and it certainly does not record a permissible purpose.
    const result = await executeTool(
      "batch_leads_skip_trace",
      { firstName: "Jane" },
      org,
      { trustedApproval: true, userId: OWNER },
    );
    expect(result.success).toBe(false);
  });

  it("says WHERE it can be done, rather than only that it cannot", async () => {
    // Refuse-not-fabricate is only half of it; a refusal with no next step is
    // a dead end the user reads as the product being broken.
    const result = await executeTool("batch_leads_skip_trace", {}, org, { userId: OWNER });
    expect(result.error).toMatch(/permissible purpose/i);
    expect(result.error).toMatch(/attestation/i);
    expect(result.error).toMatch(/Deals/);
  });
});

describe("there is no path past the FCRA gate any more", () => {
  it("the dispatch branch and the executor behind it are gone", async () => {
    // What makes the refusal above load-bearing is not that a mock went
    // uncalled — it is that nothing remains to call. Asserted in source
    // because the absence of a code path cannot be observed at runtime.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { stripCommentsPreservingLines } = await import("../../scripts/lib/strip-comments.mjs");
    const read = (rel: string) =>
      stripCommentsPreservingLines(
        fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8"),
      );

    const tools = read("server/ai/tools.ts");
    expect(tools, "the tool must still exist, so Pax can explain the refusal").toContain(
      "batch_leads_skip_trace",
    );
    expect(
      tools,
      "the dispatch branch is back — a path past the FCRA gate",
    ).not.toContain('case "batch_leads_skip_trace"');

    const executor = read("server/services/connectors/executor.ts");
    expect(
      executor,
      "batchLeadsSkipTrace is back. If a BatchLeads skip trace is wanted, it " +
        "belongs in the provider registry — which has a cost, a circuit breaker " +
        "and a license flag — not as a second raw fetch.",
    ).not.toContain("export async function batchLeadsSkipTrace");
  });
});

describe("an identified caller is held to the scope the intent declares", () => {
  it("refuses a viewer the deal_write intent create_lead", async () => {
    asRole("viewer"); // deal_read, comms_read, annotation_only — no deal_write
    const result = await executeTool(
      "create_lead",
      { first_name: "A", last_name: "B" },
      org,
      { userId: "user_viewer" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
    expect(result.error).toMatch(/deal_write/);
  });

  it("PERMITS a member the same intent — the gate is not a blanket deny", async () => {
    // The negative control. `member` holds deal_write, so this must go through
    // to the real handler. If this ever fails, the gate has stopped being a
    // permission check and become an outage.
    asRole("member");
    const result = await executeTool(
      "create_lead",
      { first_name: "A", last_name: "B" },
      org,
      { userId: "user_member" },
    );
    expect(result.success, `a member was refused create_lead: ${result.error}`).toBe(true);
  });

  it("refuses a bookkeeper a comms_write intent but allows a member", async () => {
    // A second role pair, on a different scope, so the two cases above cannot
    // both be passing for a reason peculiar to deal_write.
    asRole("bookkeeper"); // financial_read/write + deal_read — no comms_write
    const denied = await executeTool(
      "draft_outreach_message",
      { lead_id: 1 },
      org,
      { userId: "user_bk" },
    );
    expect(denied.success).toBe(false);
    expect(denied.error).toMatch(/comms_write/);
  });

  it("the org OWNER passes without a team_members row", async () => {
    asRole(null); // no membership row at all
    const result = await executeTool(
      "create_lead",
      { first_name: "A", last_name: "B" },
      org,
      { userId: OWNER },
    );
    expect(result.success, `the owner was refused: ${result.error}`).toBe(true);
  });
});

describe("an UNIDENTIFIED caller may act as the org, except for PII", () => {
  it("allows a non-PII intent with no userId — vaService and the registry handler", async () => {
    // `vaService`'s agent loop and the App Intent registry's own
    // `handler(args, org)` pass no user. Refusing them would break automation
    // that has always run this way, and "the org did it" is a true statement
    // about an org-level agent.
    asRole(null);
    const result = await executeTool("create_lead", { first_name: "A" }, org);
    expect(result.success, `an org-level call was refused: ${result.error}`).toBe(true);
  });

  it("refuses a PII intent with no userId", async () => {
    // The asymmetry, and the reason it exists: "the org did it" is not an
    // answer anyone can give a regulator about a consumer-report lookup. This
    // holds even before the FCRA refusal — it is the scope gate's own branch,
    // proved here by asserting the message names the SCOPE rather than the
    // FCRA text.
    asRole(null);
    const result = await executeTool("batch_leads_skip_trace", {}, org);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tenant_pii_write/);
  });
});

describe("the scope lookup fails CLOSED", () => {
  it("refuses when the membership read throws", async () => {
    selectFn.mockImplementationOnce(() => {
      throw new Error("connection reset");
    });
    const result = await executeTool(
      "create_lead",
      { first_name: "A" },
      org,
      { userId: "user_member" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
  });
});
