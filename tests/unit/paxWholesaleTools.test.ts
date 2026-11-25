/**
 * The Pax wholesale tool family (promised bar item (c), residential_wholesaler).
 *
 * Proves, by EXECUTING the tools through executeTool: every name is registered
 * in every place the pattern registers a tool; every read states its coverage
 * and a buyer answer says it covers the org's OWN buyer list only; the org comes
 * from the session and sits in the WHERE of every query (decoded from the real
 * drizzle condition); the wholesaler_compliance_blocked gate binds the packet
 * tool exactly as it binds the REST blast preview (a mutated gate refuses, and
 * nothing is derived); the one record change writes one receipt; and NO tool
 * can send or blast (FD5 / W-DEF-1), asserted on the registry AND on what the
 * tool module can reach.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";

const RECIPIENT_ID = "8a2d2d2e-3c8b-4d2e-8b66-1f1f1f1f1f1f";
const H = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  counts: {} as Record<string, number>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
  updates: [] as Array<{ table: string; set: any }>,
  updateWheres: [] as Array<{ table: string; cond: unknown }>,
  effects: [] as any[],
  gate: { blocked: false, warn: false } as { blocked: boolean; warn: boolean },
  packetCalls: 0,
  decisions: [] as any[],
  outcomes: [] as any[],
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
      where: (c: unknown) => { (updating ? H.updateWheres : H.wheres).push({ table, cond: c }); return chain; },
      orderBy: () => chain,
      limit: () => chain,
      update: (t: any) => { table = getTableName(t); updating = true; return chain; },
      set: (v: any) => { H.updates.push({ table, set: v }); return chain; },
      returning: async () => (H.rows[table] ?? []).map((r: any) => ({ ...r, ...(H.updates.at(-1)?.set ?? {}) })),
      then: (res: any, rej: any) => {
        if (updating) return Promise.resolve(undefined).then(res, rej);
        // The triage candidate query (it selects `apn`) reads its own seed, apart from the deal's property row.
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
  recordPaxEffect: vi.fn(async (e: any) => { H.effects.push(e); return { written: true }; }),
}));
vi.mock("../../server/routes-wholesaler-rules", () => ({
  checkAssignmentCompliance: vi.fn(async (state: string | null) =>
    H.gate.blocked
      ? { blocked: true, warn: false, recommendation: "license_required", citation: "735 ILCS 455/20", summary: `Assignment advertising is blocked in ${state}.`, attorneyReviewed: true }
      : H.gate.warn
        ? { blocked: false, warn: true, recommendation: "consult_counsel", citation: null, summary: "Disclose your equitable interest.", attorneyReviewed: false }
        : { blocked: false, warn: false, recommendation: "ok", citation: null, summary: "ok", attorneyReviewed: true }),
}));
vi.mock("../../server/services/wholesale/disposition", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  buildDispositionPacket: vi.fn(async (_org: number, propertyId: number) => {
    H.packetCalls += 1;
    return { propertyId, dealId: 11, decisionId: 5, scenarioId: 9, derivedAt: "2026-11-23T12:00:00.000Z", price: { contractPriceCents: 9_000_000, targetFeeCents: 1_000_000, buyerPriceCents: 10_000_000, buyerSideMaoCents: 11_000_000, withinBuyerCeiling: true }, subject: "Assignment: 1 Main St — $100,000", html: "<p>x</p>" };
  }),
}));
vi.mock("../../server/services/decisions/decisionStore", () => ({ decisionsForSubject: vi.fn(async () => H.decisions) }));
vi.mock("../../server/services/outcomes/outcomeStore", () => ({ outcomesForDecision: vi.fn(async () => H.outcomes) }));
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

import { executeTool, toolDefinitions, PAUSE_SAFE_TOOLS } from "../../server/ai/tools";
import { APPROVAL_REQUIRED_TOOLS } from "../../server/services/approvalKernel";
import { PAX_TOOL_GROUPS, groupForTool } from "../../shared/pax-controls";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";
import { getToolsForRole } from "../../server/ai/tools";
import { getToolsForRoleFromRegistry } from "../../server/services/appIntents";
import { stripComments } from "../helpers/stripComments";

const READS = [
  "get_wholesale_buy_box", "get_wholesale_triage", "get_wholesale_buyers", "get_wholesale_buyer_matches",
  "get_wholesale_assignments", "get_wholesale_decision", "get_wholesale_disposition_packet", "get_wholesale_blasts",
] as const;
const WRITE = "record_buyer_blast_response" as const; // `as const` keeps the literal type so [...READS, WRITE] indexes toolDefinitions (TS7053 otherwise)
const org = { id: 7, name: "Org", ownerId: "u" } as any;
const src = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const params = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;


const dealRow = { id: 11, propertyId: 21, type: "acquisition", status: "negotiating" };
const propRow = (over: Record<string, unknown> = {}) => ({ id: 21, address: "1 Main St", state: "TX", county: "Harris", status: "under_contract", ...over });
const seedDeal = (propOver: Record<string, unknown> = {}) => { H.rows.deals = [dealRow]; H.rows.properties = [propRow(propOver)]; };
const tablesWheres = (table: string) => H.wheres.filter((w) => w.table === table);
const decision = (over: Record<string, unknown> = {}) => ({
  id: 5, decidedAt: new Date("2026-11-01T00:00:00Z"),
  body: { kind: "offer", choice: "offer $90,000", rationale: "fee clears", strategyPackId: "residential_wholesaler", reviewDueAt: null, unknowns: [{}], scenarios: [{ engineId: "wholesale_mao", scenarioId: 9, predicted: [{ id: "assignment_fee", value: 1_000_000 }] }], ...over },
});

beforeEach(() => {
  H.rows = {}; H.counts = {}; H.wheres = []; H.updates = []; H.updateWheres = []; H.effects = []; H.gate = { blocked: false, warn: false };
  H.packetCalls = 0; H.decisions = []; H.outcomes = [];
});

describe("registration — every place the pattern registers a tool", () => {
  it("defined; reads pause-safe; the record change is not", () => {
    for (const n of [...READS, WRITE]) expect(toolDefinitions[n], n).toBeDefined();
    for (const n of READS) expect(PAUSE_SAFE_TOOLS.has(n), n).toBe(true);
    expect(PAUSE_SAFE_TOOLS.has(WRITE)).toBe(false);
  });
  it("controls registry: reads look; the record change is a deals-rail change", () => {
    for (const n of READS) expect(groupForTool(n), n).toBe("looks_and_drafts");
    expect(groupForTool(WRITE)).toBe("changes_records");
    expect(PAX_TOOL_GROUPS[WRITE]).toBe("changes_records");
  });
  it("scoped under the deals door: reads deal_read, the record change deal_write", () => {
    for (const n of READS) expect(INTENT_META[n]).toEqual({ door: "deals", scope: "deal_read" });
    expect(INTENT_META[WRITE]).toEqual({ door: "deals", scope: "deal_write" });
  });
  it("in the acquisitions and documents bundles, and in no vertical gate", () => {
    const s = src("server/ai/tools.ts");
    for (const bundle of ["acquisitions", "documents"]) {
      const line = s.split("\n").find((l) => l.trimStart().startsWith(`${bundle}: [`));
      expect(line, `${bundle} bundle line`).toBeDefined();
      for (const n of [...READS, WRITE]) expect(line!, `${bundle} lacks ${n}`).toContain(`"${n}"`);
    }
    expect(stripComments(src("server/ai/wholesaleTools.ts"))).not.toMatch(/businessType/);
  });
  it("both role maps (legacy and the App Intent registry's) carry them, for the same roles", () => {
    for (const role of ["acquisitions", "documents", "executive"]) {
      const legacy = getToolsForRole(role).map((t) => t.function.name);
      const registry = getToolsForRoleFromRegistry(role).map((t) => t.function.name);
      for (const n of [...READS, WRITE]) {
        expect(legacy, `legacy ${role} lacks ${n}`).toContain(n);
        expect(registry, `registry ${role} lacks ${n}`).toContain(n);
      }
    }
  });
  it("every tool has an executor case in the switch", () => {
    const s = src("server/ai/tools.ts");
    for (const n of [...READS, WRITE]) expect(s, n).toMatch(new RegExp(`^ {6}case "${n}": \\{`, "m"));
  });
});

describe("FD5 / W-DEF-1 — nothing here can send or blast", () => {
  it("no tool name or description offers to send, and none is approval-gated as a send", () => {
    for (const n of [...READS, WRITE]) {
      expect(n).not.toMatch(/send|mail|dispatch|^blast_/i);
      expect(APPROVAL_REQUIRED_TOOLS.has(n), n).toBe(false);
      expect(toolDefinitions[n].description).not.toMatch(/\b(I|Pax) (will |can |may )?(send|email|blast)\b/i);
    }
    expect(Object.keys(toolDefinitions).filter((n) => /wholesale.*(send|blast_buyers)|send.*blast|blast_buyers/i.test(n))).toEqual([]);
  });
  it("the packet tool tells the model it is a preview and where the human sends it", () => {
    expect(toolDefinitions.get_wholesale_disposition_packet.description).toMatch(/stores and sends nothing/);
    expect(toolDefinitions.get_wholesale_disposition_packet.description).toMatch(/own email identity/);
  });
  it("the tool module cannot reach a send path", () => {
    const code = stripComments(src("server/ai/wholesaleTools.ts"));
    expect(code).not.toMatch(/emailService|smsService|mailLane|sendEmail|sendSms|routes-buyer-blasts|listingSyndication|settlementRail/);
  });
});

describe("buyer answers state the own-book-only coverage (RW-D)", () => {
  it("buyer list: own list only, SQL count, org pinned, no email or phone", async () => {
    H.rows.buyer_profiles = [{ id: 3, profileType: "investor", isActive: true, preferences: { states: ["TX"], maxPrice: 150000 }, financialInfo: { financingType: "cash" }, intent: {}, engagement: { lastContactDate: "2026-10-01" }, firstName: "Ada", lastName: "Cash" }];
    H.counts.buyer_profiles = 1;
    const r = await executeTool("get_wholesale_buyers", { organization_id: 999 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/^Coverage:/);
    expect(r.data.coverage).toMatch(/OWN buyer list only/);
    expect(r.data.coverage).toMatch(/does not include any other account's buyers/);
    expect(r.data.total).toBe(1);
    expect(r.data.buyers[0]).toMatchObject({ buyerProfileId: 3, name: "Ada Cash", financingType: "cash", states: ["TX"] });
    expect(JSON.stringify(r.data)).not.toMatch(/email|phone/i);
    const p = tablesWheres("buyer_profiles").flatMap((w) => params(w.cond));
    expect(p).toContain(7);
    expect(p).not.toContain(999);
  });
  it("buyer match: states it covers the org's own buyer list only, stored scores, and pins the org", async () => {
    seedDeal();
    H.rows.buyer_property_matches = [{ buyerProfileId: 3, matchScore: 88, matchReasons: ["TX"], potentialConcerns: [], status: "pending", financialInfo: { financingType: "cash" }, firstName: "Ada", lastName: "Cash" }];
    const r = await executeTool("get_wholesale_buyer_matches", { deal_id: 11, organization_id: 999 }, org, { userId: "u-1" });
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/OWN buyer list only/);
    expect(r.data.coverage).toMatch(/does not re-run matching/);
    expect(r.data.coverage).toMatch(/opted out/);
    expect(r.data.matches[0]).toMatchObject({ buyerProfileId: 3, matchScore: 88, name: "Ada Cash" });
    for (const t of ["deals", "properties", "buyer_property_matches"]) {
      const p = tablesWheres(t).flatMap((w) => params(w.cond));
      expect(p, t).toContain(7);
      expect(p, t).not.toContain(999);
    }
  });
  it("buyer match: no stored matches is said, not guessed", async () => {
    seedDeal();
    const r = await executeTool("get_wholesale_buyer_matches", { deal_id: 11 }, org);
    expect(r.data.statement).toMatch(/I did not run it/);
  });
});

describe("the other reads — coverage, refusals, org pinning", () => {
  it("buy box: states its coverage; none saved is said plainly", async () => {
    const none = await executeTool("get_wholesale_buy_box", {}, org);
    expect(none.data.coverage).toMatch(/THIS account's wholesale buy box only/);
    expect(none.data.hasBuyBox).toBe(false);
    H.rows.wholesale_buy_boxes = [{ version: 2, criteria: { states: ["TX"], staleAfterDays: 30 }, createdAt: new Date("2026-11-01") }];
    const r = await executeTool("get_wholesale_buy_box", {}, org);
    expect(r.data.current).toMatchObject({ version: 2 });
    expect(params(tablesWheres("wholesale_buy_boxes").at(-1)!.cond)).toContain(7);
  });
  it("triage: scores the deal's property against the buy box with named reasons (real triage code)", async () => {
    seedDeal({ status: "prospect" });
    H.rows.wholesale_buy_boxes = [{ version: 1, criteria: { states: ["TX"], staleAfterDays: 30, maxPurchasePriceCents: 5_000_000 }, createdAt: new Date() }];
    H.rows.property_candidates = [{ id: 21, address: "1 Main St", apn: null, state: "TX", county: "Harris", zip: "77001", updatedAt: new Date("2026-11-20") }];
    H.rows.deals = [{ ...dealRow, propertyId: 21, offerAmount: "40000", acceptedAmount: null, updatedAt: new Date("2026-11-20") }];
    const r = await executeTool("get_wholesale_triage", { deal_id: 11 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/THIS account's current buy box/);
    expect(r.data.scored).toBe(true);
    expect(r.data.fit.verdict).toBe("fits");
    expect(r.data.fit.passed.join(" ")).toMatch(/In TX/);
    // Only candidate-status properties of THIS org are scored.
    const pp = tablesWheres("properties").flatMap((w) => params(w.cond));
    expect(pp).toContain(7);
    expect(pp).toEqual(expect.arrayContaining(["prospect", "due_diligence", "offer_sent"]));
  });
  it("triage: no buy box refuses plainly; a non-candidate property is 'not scored', not 'fits'", async () => {
    seedDeal();
    const none = await executeTool("get_wholesale_triage", { deal_id: 11 }, org);
    expect(none.success).toBe(false);
    expect(none.refusal?.what).toMatch(/no buy box/i);
    H.rows.wholesale_buy_boxes = [{ version: 1, criteria: { states: ["TX"], staleAfterDays: 30 }, createdAt: new Date() }];
    H.rows.property_candidates = [];
    const r = await executeTool("get_wholesale_triage", { deal_id: 11 }, org);
    expect(r.data.scored).toBe(false);
    expect(r.data.statement).toMatch(/Not scored/);
  });
  it("assignments: signed fee is a record, only signed counts, org pinned", async () => {
    H.rows.deals = [dealRow];
    H.rows.contract_assignments = [
      { id: 1, status: "signed", assignmentFeeCents: 1_200_000, endBuyerName: "Ada Cash", endBuyerProfileId: null, originalContractDate: "2026-10-01", notes: null },
      { id: 2, status: "draft", assignmentFeeCents: 900_000, endBuyerName: "Bo", endBuyerProfileId: null, originalContractDate: null, notes: null },
    ];
    const r = await executeTool("get_wholesale_assignments", { deal_id: 11 }, org);
    expect(r.data.coverage).toMatch(/holds and moves no money/);
    expect(r.data.signedFeeCents).toBe(1_200_000);
    expect(r.data.signedCount).toBe(1);
    for (const t of ["deals", "contract_assignments"]) expect(params(tablesWheres(t).at(-1)!.cond), t).toContain(7);
  });
  it("decision: latest wholesale_mao decision and its outcome, with the operator-inputs sentence", async () => {
    seedDeal();
    H.decisions = [decision({ strategyPackId: "fix_and_flip" }), decision()];
    H.outcomes = [{ id: 1, observedAt: new Date("2026-11-20"), body: { kind: "sold", summary: "Exit: assigned", actuals: [{ id: "assignment_fee", value: 1_100_000 }] }, varianceSummary: "Fee came in $1,000 over." }];
    const r = await executeTool("get_wholesale_decision", { deal_id: 11 }, org);
    expect(r.data.coverage).toMatch(/operator's own inputs/);
    expect(r.data.decision.decisionId).toBe(5);
    expect(r.data.outcomes[0].varianceSummary).toMatch(/over/);
    H.decisions = [];
    const none = await executeTool("get_wholesale_decision", { deal_id: 11 }, org);
    expect(none.data.decision).toBeNull();
  });
  it("a missing deal, a wrong-org deal and a non-number are refused, not guessed", async () => {
    for (const [tool, id] of [["get_wholesale_assignments", 11], ["get_wholesale_decision", 11], ["get_wholesale_blasts", 11]] as const) {
      H.rows = {};
      const none = await executeTool(tool, { deal_id: id }, org);
      expect(none.success, tool).toBe(false);
      expect(none.refusal?.what, tool).toMatch(/No deal/);
    }
    const bad = await executeTool("get_wholesale_assignments", { deal_id: "abc" }, org);
    expect(bad.success).toBe(false);
  });
  it("blasts: read-only record with recipient ids, no email addresses", async () => {
    seedDeal();
    H.rows.buyer_blasts = [{ id: "b1", subject: "Deal", status: "completed", createdAt: new Date("2026-11-10") }];
    H.rows.buyer_blast_recipients = [{ recipientId: RECIPIENT_ID, blastId: "b1", buyerProfileId: 3, status: "sent", sentAt: new Date("2026-11-10"), respondedAt: null, responseNotes: null, failureReason: null, firstName: "Ada", lastName: "Cash" }];
    const r = await executeTool("get_wholesale_blasts", { deal_id: 11 }, org);
    expect(r.data.coverage).toMatch(/I cannot send or re-send/);
    expect(r.data.recipients[0].recipientId).toBe(RECIPIENT_ID);
    expect(JSON.stringify(r.data)).not.toMatch(/@/);
    for (const t of ["buyer_blasts", "buyer_blast_recipients"]) expect(params(tablesWheres(t).at(-1)!.cond), t).toContain(7);
  });
});

describe("the compliance gate binds the AI door exactly as it binds the REST blast preview", () => {
  it("BLOCKED state (e.g. IL): the packet is refused and nothing is derived", async () => {
    seedDeal({ state: "IL" });
    H.gate.blocked = true;
    const r = await executeTool("get_wholesale_disposition_packet", { deal_id: 11 }, org, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(r.refusal?.why).toMatch(/blocked in IL/);
    expect(r.refusal?.why).toMatch(/735 ILCS 455\/20/);
    expect(H.packetCalls).toBe(0);
  });
  it("the same gate is surfaced on the buyer-match read (blastGate), blocked or clear", async () => {
    seedDeal({ state: "IL" });
    H.gate.blocked = true;
    const blocked = await executeTool("get_wholesale_buyer_matches", { deal_id: 11 }, org);
    expect(blocked.data.blastGate.status).toBe("blocked");
    H.gate.blocked = false;
    const clear = await executeTool("get_wholesale_buyer_matches", { deal_id: 11 }, org);
    expect(clear.data.blastGate.status).toBe("clear");
  });
  it("WARN state: the packet is prepared with the warning shown, and no acknowledgement is written", async () => {
    seedDeal({ state: "OH" });
    H.gate.warn = true;
    const r = await executeTool("get_wholesale_disposition_packet", { deal_id: 11 }, org, { userId: "u-1" });
    expect(r.success).toBe(true);
    expect(r.data.compliance.status).toBe("warn");
    expect(H.packetCalls).toBe(1);
    expect(H.updates).toHaveLength(0);
  });
  it("CLEAR state: a PREVIEW — prepared, sent false, says where the human sends it; stores nothing", async () => {
    seedDeal();
    const r = await executeTool("get_wholesale_disposition_packet", { deal_id: 11 }, org, { userId: "u-1" });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ prepared: true, sent: false });
    expect(r.data.statement).toMatch(/PREPARED, NOT SENT/);
    expect(r.data.statement).toMatch(/OWN connected email identity/);
    expect(r.data.coverage).toMatch(/Nothing was stored and nothing was sent/);
    expect(r.data.price.buyerPriceCents).toBe(10_000_000);
    expect(H.updates).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
  it("a property that is not under contract is outside the gate, and says so", async () => {
    seedDeal({ status: "owned" });
    const r = await executeTool("get_wholesale_disposition_packet", { deal_id: 11 }, org);
    expect(r.data.compliance.status).toBe("not_applicable");
  });
  it("a refused derivation (no accepted price / no decision) is a plain refusal", async () => {
    seedDeal();
    const { buildDispositionPacket, DispositionRefusal } = await import("../../server/services/wholesale/disposition");
    (buildDispositionPacket as any).mockRejectedValueOnce(new DispositionRefusal("Underwrite this property as a wholesale offer first.", 409));
    const r = await executeTool("get_wholesale_disposition_packet", { deal_id: 11 }, org);
    expect(r.success).toBe(false);
    expect(r.refusal?.why).toMatch(/Underwrite this property/);
  });
});

describe("record_buyer_blast_response — org-scoped, additive, receipted, never a send", () => {
  const existing = { id: RECIPIENT_ID, organizationId: 7, blastId: "b1", status: "sent", responseNotes: "Called Tuesday." };
  it("records the reply through the shared service, adds to notes, writes ONE receipt with before→after", async () => {
    H.rows.buyer_blast_recipients = [existing];
    const r = await executeTool(WRITE, { recipient_id: RECIPIENT_ID, status: "replied_interested", response_notes: "Wants the rehab scope", organization_id: 999 }, org, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect(r.data.message).toMatch(/nothing was sent to anyone/);
    const upd = H.updates.find((u) => u.table === "buyer_blast_recipients")!;
    expect(upd.set).toMatchObject({ status: "replied_interested", responseNotes: "Called Tuesday.\nWants the rehab scope" });
    expect(upd.set.respondedAt).toBeInstanceOf(Date);
    expect(H.updates.some((u) => u.table === "buyer_blasts")).toBe(true);
    const p = tablesWheres("buyer_blast_recipients").flatMap((w) => params(w.cond));
    expect(p).toContain(7);
    expect(p).not.toContain(999);
    // The WRITES themselves are org-scoped, not just the read before them.
    for (const t of ["buyer_blast_recipients", "buyer_blasts"]) {
      const uw = H.updateWheres.filter((w) => w.table === t).flatMap((w) => params(w.cond));
      expect(uw, `${t} update WHERE`).toContain(7);
      expect(uw, `${t} update WHERE`).not.toContain(999);
    }
    expect(H.effects).toHaveLength(1);
    expect(H.effects[0]).toMatchObject({ orgId: 7, tool: WRITE, actor: "pax", witnessed: false, entityType: "organization" });
    expect(H.effects[0].before).toMatchObject({ status: "sent", responseNotes: "Called Tuesday." });
    expect(H.effects[0].after.status).toBe("replied_interested");
  });
  it("refuses a delivery state, an empty reply and a malformed id — writes nothing, no receipt", async () => {
    H.rows.buyer_blast_recipients = [existing];
    for (const bad of [
      { recipient_id: RECIPIENT_ID, status: "delivered" },
      { recipient_id: RECIPIENT_ID },
      { recipient_id: "not-an-id", status: "replied_interested" },
    ]) {
      const r = await executeTool(WRITE, bad, org, { userId: "u-1" });
      expect(r.success, JSON.stringify(bad)).toBe(false);
    }
    expect(H.updates).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
  it("another account's recipient reads as not-found: nothing written, no receipt", async () => {
    H.rows.buyer_blast_recipients = [];
    const r = await executeTool(WRITE, { recipient_id: RECIPIENT_ID, status: "replied_not_interested" }, org, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(r.refusal?.what).toMatch(/No blast recipient/);
    expect(H.updates).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
  it("refuses notes that would pass the 4,000-character limit rather than truncating", async () => {
    H.rows.buyer_blast_recipients = [{ ...existing, responseNotes: "x".repeat(3_990) }];
    const r = await executeTool(WRITE, { recipient_id: RECIPIENT_ID, response_notes: "y".repeat(50) }, org, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(H.updates).toHaveLength(0);
  });
});
