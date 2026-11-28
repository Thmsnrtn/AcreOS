/**
 * Wholesale W8 — support drill set, part 2 of 3: drills 2c/2d (the stuck
 * moment, contract chain + blast identity) and drill 3 (WS-DEF-1, cured by the
 * WS-DEF-1 cure: the eight wholesale reads now run on the support path). Part 1 (wholesaleSupportDrills.test.ts) holds drill 1 and
 * drills 2a/2b; part 3 (wholesaleSupportDrillsData.test.ts) holds drill 4.
 * The full record: docs/evidence/2026-11-24/wholesale-support-drills.md.
 *
 * These legs run the real pure resolveStateContractTemplate, pin the
 * blast identity preflight on the real route source (the preflight itself
 * is proven by buyerBlastIdentityPreflight.test.ts and
 * counterpartyIdentityPreflight.test.ts), and pin the support resolver's
 * tool subset against the chat path's registry. Fixtures are synthetic.
 * Nothing in this file can send anything.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { stripComments } from "../helpers/stripComments";
import { resolveStateContractTemplate } from "../../server/services/contracts/contractAssembly";


// ── Drill 3 real-switch scaffold (the paxWholesaleTools / part-1 pattern:
// db is an infrastructure mock; the support switch, the wholesale helpers,
// the compliance gate and every refusal under drill run REAL) ────────────
const H = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  counts: {} as Record<string, number>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
  updates: [] as Array<{ table: string; set: any }>,
  packetCalls: 0,
}));

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const make = () => {
    let table = "";
    let fields: Record<string, unknown> | undefined;
    let updating = false;
    const chain: any = {
      select: (f?: Record<string, unknown>) => { fields = f; updating = false; return chain; },
      from: (t: any) => { table = getTableName(t); return chain; },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (c: unknown) => { H.wheres.push({ table, cond: c }); return chain; },
      orderBy: () => chain,
      limit: () => chain,
      update: (t: any) => { table = getTableName(t); updating = true; return chain; },
      set: (v: any) => { H.updates.push({ table, set: v }); return chain; },
      returning: async () => (H.rows[table] ?? []).map((r: any) => ({ ...r, ...(H.updates.at(-1)?.set ?? {}) })),
      then: (res: any, rej: any) => {
        if (updating) return Promise.resolve(undefined).then(res, rej);
        const rows = (fields && "apn" in fields ? H.rows.property_candidates : H.rows[table]) ?? [];
        const out = fields && "total" in fields ? [{ total: H.counts[table] ?? rows.length }] : rows;
        return Promise.resolve(out).then(res, rej);
      },
    };
    return chain;
  };
  return { db: make() };
});
vi.mock("../../server/services/paxReceipts", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordPaxEffect: vi.fn(async () => ({ written: true })),
}));
// Deliberately NOT mocked: routes-wholesaler-rules — the packet and match
// legs run the real offerComplianceGate over the real
// checkAssignmentCompliance against seeded wholesaler_state_rules rows.
vi.mock("../../server/services/wholesale/disposition", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  buildDispositionPacket: vi.fn(async (_org: number, propertyId: number) => {
    H.packetCalls += 1;
    return { propertyId, dealId: 11, decisionId: 5, scenarioId: 9, derivedAt: "2026-11-23T12:00:00.000Z", price: { contractPriceCents: 9_000_000, targetFeeCents: 1_000_000, buyerPriceCents: 10_000_000, buyerSideMaoCents: 11_000_000, withinBuyerCeiling: true }, subject: "Assignment: 1 Main St — $100,000", html: "<p>x</p>" };
  }),
}));
vi.mock("../../server/utils/clock", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const now = () => new Date("2026-11-23T12:00:00Z");
  return { ...actual, clock: { ...actual.clock, now, nowMs: () => now().getTime() } };
});
vi.mock("../../server/services/paxControls", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getPaxControls: vi.fn(async () => ({
    stance: "ask_before_sending",
    leadScoring: true, borrowerReminders: true, inboxDrafts: true,
    rails: { records: { leads: "act_and_report", properties: "act_and_report", deals: "act_and_report", tasks: "act_and_report", follow_ups: "act_and_report", account: "act_and_report" }, sends: "ask" },
    limits: { asksPerDay: null, creditSpendPerDay: null, browseCallsPerDay: null, batchRowsPerDay: null },
    members: {}, mySites: [], paused: false, pausedUntil: null, pausedBy: null, checkFailed: false, timezone: "America/Chicago",
  })),
}));
vi.mock("../../server/middleware/roleScope", () => ({ userHasScope: vi.fn(async () => true) }));

import { executeSupportTool } from "../../server/ai/supportAgent";

const supportOrg = { id: 7, name: "Org", ownerId: "u" } as any;
const params = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;
const dealRow = { id: 11, propertyId: 21, type: "acquisition", status: "negotiating" };
const propRow = (over: Record<string, unknown> = {}) => ({ id: 21, address: "1 Main St", state: "TX", county: "Harris", status: "under_contract", ...over });
const ilRule = { state: "IL", status: "license_required", licenseRequired: true, advertisingRestricted: true, recommendation: "license_required", citation: "735 ILCS 455/20", summary: "Assignment advertising is blocked in IL.", attorneyReviewedAt: new Date("2026-01-01") };

beforeEach(() => {
  H.rows = {}; H.counts = {}; H.wheres = []; H.updates = []; H.packetCalls = 0;
});

const root = resolve(__dirname, "../..");
const read = (p: string) => stripComments(readFileSync(resolve(root, p), "utf8"));
const readRaw = (p: string) => readFileSync(resolve(root, p), "utf8");

// ── Drill 2c — the contract chain refuses an unreviewed state ─────────────

describe("W8 drill 2c — the contract chain refuses an unreviewed state with STATE_NOT_CONFIGURED", () => {
  it("IL has no reviewed assignment template: the refusal names the state and the code", () => {
    const r = resolveStateContractTemplate("IL", "assignment_of_contract");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe("STATE_NOT_CONFIGURED");
      expect(r.refusal.state).toBe("IL");
      expect(r.refusal.message).toMatch(/Illinois|IL/);
    }
  });

  it("TX, a reviewed state, resolves — the refusal is about coverage, not a blanket block", () => {
    const r = resolveStateContractTemplate("TX", "assignment_of_contract");
    expect(r.ok).toBe(true);
  });
});

// ── Drill 2d — a blast starves without the org's OWN email identity ───────

describe("W8 drill 2d — a blast starves without the org's OWN email identity (W-DEF-1 preflight)", () => {
  const src = read("server/routes-buyer-blasts.ts");

  it("the send path refuses before any blast row exists: reason named, sent 0", () => {
    expect(src).toContain('reason: "no_counterparty_email_identity"');
    expect(src).toContain("sent: 0");
    expect(src.indexOf("no_counterparty_email_identity")).toBeLessThan(src.indexOf(".insert(buyerBlasts)"));
  });

  it("the warning words a support answer quotes say whose identity it must be — verbatim", () => {
    expect(src).toContain("buyer blasts go out under your own sending identity");
    expect(src).toContain("AcreOS does not email your buyers from its own address");
    // The preview surfaces the same warning where the operator composes.
    expect(src).toContain("sendingIdentityWarning: identityWarning");
  });
});

// ── Drill 3 — "Pax told me X": the wholesale reads now run on the support path ──

// The support resolver's subset is not exported (an export with no
// production consumer fails the reachability ratchet); pin it from source,
// the paxPauseSupportGate.test.ts pattern #738/#742/#764 used.
const SUPPORT_LAND_READS = [
  "get_parcel_passport_view",
  "get_land_listings_view",
  "get_land_listing_view",
  "get_listing_paste_text_view",
  "get_land_payoff_quote_view",
] as const;
const SUPPORT_TAX_READS = [
  "get_tax_certificates_book",
  "get_tax_certificate_record",
  "get_tax_certificate_clock_view",
  "get_tax_certificate_ledger_view",
] as const;
const SUPPORT_BH_READS = [
  "get_rent_roll_view",
  "get_rental_leases_view",
  "get_lease_ledger_view",
  "get_rental_underwriting_view",
] as const;
const SUPPORT_WS_READS = [
  "get_wholesale_buy_box_view",
  "get_wholesale_triage_view",
  "get_wholesale_buyers_view",
  "get_wholesale_buyer_matches_view",
  "get_wholesale_assignments_view",
  "get_wholesale_decision_view",
  "get_wholesale_disposition_packet_view",
  "get_wholesale_blasts_view",
] as const;
const SUPPORT_LEASE_VIEWS = [
  "get_lease_abstract_view",
  "get_lease_rent_steps_view",
  "get_lease_cam_status_view",
] as const;
const PRIOR_RESOLVER_NAMES = [
  "search_knowledge_base",
  "search_resolved_tickets",
  "get_similar_resolutions",
  "get_troubleshooting_steps",
  "diagnose_account",
  "check_data_integrity",
  "get_account_summary",
  "query_user_data",
  "get_user_activity",
  "estimate_resolution_confidence",
  "recall_user_memory",
  "draft_customer_response",
  "escalate_to_human",
];
const RESOLVER_TOOL_NAMES: string[] = (() => {
  const src = readFileSync(resolve(root, "server/ai/paxSupportResolver.ts"), "utf8");
  const m = /const RESOLVER_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!m) throw new Error("RESOLVER_TOOL_NAMES literal not found in paxSupportResolver.ts");
  return [...m[1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]);
})();

describe("W8 drill 3 — capability pin, cured: the resolver subset is the prior 13 + exactly the eight support wholesale reads (WS-DEF-1), composed with the five support land reads, the four support tax reads, the four support buy-hold reads and the three commercial lease views", () => {
  const WHOLESALE_TOOLS = [
    "get_wholesale_buy_box",
    "get_wholesale_triage",
    "get_wholesale_buyers",
    "get_wholesale_buyer_matches",
    "get_wholesale_assignments",
    "get_wholesale_decision",
    "get_wholesale_disposition_packet",
    "get_wholesale_blasts",
    "record_buyer_blast_response",
  ];

  it("the chat path still registers all nine wholesale tools (proven in paxWholesaleTools.test.ts)", () => {
    const toolsSrc = read("server/ai/tools.ts");
    for (const t of WHOLESALE_TOOLS) expect(toolsSrc, `chat path is missing ${t}`).toContain(t);
  });

  it("the resolver subset is exactly the prior 13 + the five support land reads + the four support tax reads + the four support buy-hold reads + the eight support wholesale reads + the three commercial lease views, in order", () => {
    expect(RESOLVER_TOOL_NAMES).toEqual([
      ...PRIOR_RESOLVER_NAMES.slice(0, 7),
      ...SUPPORT_LAND_READS,
      ...SUPPORT_TAX_READS,
      ...SUPPORT_BH_READS,
      ...SUPPORT_WS_READS,
      ...SUPPORT_LEASE_VIEWS,
      ...PRIOR_RESOLVER_NAMES.slice(7),
    ]);
  });

  it("no chat wholesale name entered the subset — the support variants carry their own names", () => {
    for (const t of WHOLESALE_TOOLS) expect(RESOLVER_TOOL_NAMES).not.toContain(t);
  });

  it("every subset name resolves to a real support tool definition (the resolver builds its tool list from these)", () => {
    const agentSrc = read("server/ai/supportAgent.ts");
    for (const n of RESOLVER_TOOL_NAMES) expect(agentSrc, n).toContain(`name: "${n}"`);
  });

  it("the eight reads are registered at every mirror point the pattern registers a support tool", () => {
    const agentSrc = read("server/ai/supportAgent.ts");
    const controlsSrc = read("shared/pax-controls.ts");
    const capsSrc = read("shared/pax-capabilities.ts");
    for (const n of SUPPORT_WS_READS) {
      expect(agentSrc, `${n} definition`).toContain(`  ${n}: {`);
      expect(agentSrc, `${n} dispatch case`).toContain(`case "${n}"`);
      expect(agentSrc, `${n} pause-safe`).toContain(`"${n}",`);
      expect(controlsSrc, `${n} in pax-controls looks_and_drafts`).toContain(`"${n}"`);
      expect(capsSrc, `${n} capability row`).toContain(`"${n}": {"dispatch": "executeSupportTool", "group": "looks_and_drafts", "scope": null, "approvalRequired": false, "pauseSafe": true`);
      expect(capsSrc, `${n} family`).toContain(`"${n}": {"dispatch": "executeSupportTool", "group": "looks_and_drafts", "scope": null, "approvalRequired": false, "pauseSafe": true, "receipt": "none", "coverage": "single_slice"`);
    }
    // Each support case dispatches to the SAME shared helper the chat path
    // calls — one implementation, two doors, never a reimplementation.
    for (const h of ["paxGetWholesaleBuyBox", "paxGetWholesaleTriage", "paxGetWholesaleBuyers", "paxGetWholesaleBuyerMatches", "paxGetWholesaleAssignments", "paxGetWholesaleDecision", "paxGetWholesaleDispositionPacket", "paxGetWholesaleBlasts"]) {
      expect(agentSrc, `${h} shared helper`).toContain(h);
    }
  });

  it("there is NO support variant of the one write — recording a buyer's reply stays on the chat path, pinned absent", () => {
    // record_buyer_blast_response MUTATES a blast recipient's recorded
    // status/notes (wholesaleTools.ts: recordBlastRecipientResponse). The
    // support path stays read-only, so the write gets no variant in any
    // registry — the same disposition #764 gave record_rent_payment and
    // generate_scheduled_rent_charges.
    const agentSrc = read("server/ai/supportAgent.ts");
    const capsSrc = read("shared/pax-capabilities.ts");
    expect(RESOLVER_TOOL_NAMES.some((n) => n.startsWith("record_"))).toBe(false);
    expect(agentSrc).not.toContain("record_buyer_blast_response");
    expect(agentSrc).not.toContain("paxRecordBuyerBlastResponse");
    expect(capsSrc).not.toContain("record_buyer_blast_response_view");
    // The chat-path write itself is untouched: its one capability row is
    // still the executeTool changes_records row.
    expect(capsSrc).toContain(`"record_buyer_blast_response": {"dispatch": "executeTool", "group": "changes_records"`);
  });

  it("no wholesale read needed an exclusion: none sits behind a PII or permission fence on the chat path", () => {
    // The get_tenants treatment (#764) applies only where the chat path
    // itself gates the read (tenant_pii_read). No wholesale read is gated:
    // the helpers take the session org (and, for the two gate-view reads,
    // the caller's user id — passed here exactly as the chat path passes
    // it), and the buyer-shaped reads expose names only: the source's own
    // words, "no email or phone leaves here". The compliance gate on the
    // packet/match reads runs INSIDE the shared helper, so the support
    // variant inherits it identically — proven by the real-switch legs
    // below, where the IL block refuses on this path too.
    const toolsSrc = readRaw("server/ai/wholesaleTools.ts");
    expect(toolsSrc).toContain("no email or phone leaves here");
    expect(toolsSrc).not.toContain("tenant_pii_read");
    expect(toolsSrc).not.toContain("userHasScope");
  });
});

describe("W8 drill 3 — the real support switch: the wholesale reads run and ground the answer", () => {
  const seedAssignments = () => {
    H.rows.deals = [dealRow];
    H.rows.contract_assignments = [
      { id: 1, status: "signed", assignmentFeeCents: 1_200_000, endBuyerName: "SYNTHETIC Ada Cash", endBuyerProfileId: null, originalContractDate: "2026-10-01", notes: null },
      { id: 2, status: "draft", assignmentFeeCents: 900_000, endBuyerName: "SYNTHETIC Bo", endBuyerProfileId: null, originalContractDate: null, notes: null },
    ];
  };

  it("the assignments read reproduces drill 1's figures on the support path: $12,000 signed, the $9,000 draft NOT counted", async () => {
    seedAssignments();
    const r = await executeSupportTool("get_wholesale_assignments_view", { deal_id: 11 }, supportOrg);
    expect(r.success).toBe(true);
    expect(r.data.signedCount).toBe(1);
    expect(r.data.signedFeeCents).toBe(1_200_000);
    expect(r.data.signedFee).toBe("$12,000");
    expect(r.data.coverage).toContain("An assignment fee is a RECORD of the fee in the contract — AcreOS holds and moves no money.");
    const p = H.wheres.filter((w) => w.table === "contract_assignments").flatMap((w) => params(w.cond));
    expect(p).toContain(7);
  });

  it("the buyer-match read surfaces the REAL gate as blocked in IL on the support path too", async () => {
    H.rows.deals = [dealRow];
    H.rows.properties = [propRow({ state: "IL" })];
    H.rows.wholesaler_state_rules = [ilRule];
    H.rows.buyer_property_matches = [];
    const r = await executeSupportTool("get_wholesale_buyer_matches_view", { deal_id: 11 }, supportOrg);
    expect(r.success).toBe(true);
    expect(r.data.blastGate.status).toBe("blocked");
    expect(r.data.coverage).toContain("OWN buyer list only");
    // Stored scores only: the read never re-runs matching and shapes no
    // buyer email or phone.
    expect(JSON.stringify(r.data)).not.toMatch(/\bemail\b|\bphone\b/);
  });

  it("the packet read refuses in IL through the REAL gate, before anything is derived — same refusal as the chat path", async () => {
    H.rows.deals = [dealRow];
    H.rows.properties = [propRow({ state: "IL" })];
    H.rows.wholesaler_state_rules = [ilRule];
    const r = await executeSupportTool("get_wholesale_disposition_packet_view", { deal_id: 11 }, supportOrg, undefined, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(r.refusal?.what).toMatch(/did not prepare a disposition packet/);
    expect(r.refusal?.why).toMatch(/same state rule that blocks the buyer blast/);
    expect(H.packetCalls).toBe(0);
    expect(H.updates).toHaveLength(0);
  });

  it("an unknown deal is refused in plain words on the support path — no invented deal", async () => {
    H.rows.deals = [];
    const r = await executeSupportTool("get_wholesale_assignments_view", { deal_id: 11 }, supportOrg);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.refusal ?? r)).not.toMatch(/get_wholesale|deal_id|snake_case/);
  });
});
