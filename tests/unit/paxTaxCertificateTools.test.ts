/**
 * T7 — the Pax tax-certificate tool family (promised bar item (c)).
 *
 * Proves: the five tools are registered in every place the pattern registers a
 * tool; every read states its coverage; the org comes from the session and is
 * in the WHERE of every query (decoded from the real drizzle condition, not
 * grepped); a simulated notice is never reported as mailed; the record change
 * refuses a future date and writes one receipt; and NO tool sends a notice
 * (FD5) — asserted on the registry AND on what the tool module can reach.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const CERT_ID = "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e";
const H = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
  inserts: [] as Array<{ table: string; values: any }>,
  effects: [] as any[],
}));

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const make = () => {
    let table = "";
    const chain: any = {
      select: () => chain,
      from: (t: any) => { table = getTableName(t); return chain; },
      where: (c: unknown) => { H.wheres.push({ table, cond: c }); return chain; },
      orderBy: () => chain,
      limit: () => chain,
      then: (res: any, rej: any) => Promise.resolve(H.rows[table] ?? []).then(res, rej),
      insert: (t: any) => ({ values: async (v: any) => { H.inserts.push({ table: getTableName(t), values: v }); } }),
    };
    return chain;
  };
  return { db: make() };
});
vi.mock("../../server/services/paxReceipts", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordPaxEffect: vi.fn(async (e: any) => { H.effects.push(e); return { written: true }; }),
}));
vi.mock("../../server/services/tax/certificateClock", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  clockForCertificate: vi.fn(async (orgId: number, row: any) => ({ stub: true, orgId, certificateId: row.id })),
}));
vi.mock("../../server/services/tax/taxProcedures", () => ({
  countyBidStanding: vi.fn(async () => ({ current: null })),
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

import { executeTool, toolDefinitions, PAUSE_SAFE_TOOLS } from "../../server/ai/tools";
import { ledgerEntrySchema } from "../../server/services/tax/ledgerEntryInput";
import { PAX_TOOL_GROUPS, groupForTool } from "../../shared/pax-controls";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";

const READS = ["get_tax_certificates", "get_tax_certificate", "get_tax_certificate_clock", "get_tax_certificate_ledger"] as const;
const WRITE = "record_tax_ledger_entry";
const org = { id: 7, name: "Org", ownerId: "u" } as any;
const certRow = {
  id: CERT_ID, organizationId: 7, state: "AZ", county: "Cochise", apn: "100-20-030", certificateNumber: "C-1",
  saleType: "lien", saleDate: "2025-02-20", status: "active", purchaseAmountCents: 500000, bidDownRateBps: 1600,
  redemptionDeadline: "2027-02-20", deadlineSource: "county_record",
};
const src = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const params = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;

beforeEach(() => {
  H.rows = {}; H.wheres = []; H.inserts = []; H.effects = [];
});

describe("registration — every place the pattern registers a tool", () => {
  it("defined, and reads are pause-safe while the record change is not", () => {
    for (const n of [...READS, WRITE]) expect(toolDefinitions[n], n).toBeDefined();
    for (const n of READS) expect(PAUSE_SAFE_TOOLS.has(n), n).toBe(true);
    expect(PAUSE_SAFE_TOOLS.has(WRITE)).toBe(false);
  });
  it("classified in the controls registry: reads look, the record change is a deals-rail change", () => {
    for (const n of READS) expect(groupForTool(n), n).toBe("looks_and_drafts");
    expect(groupForTool(WRITE)).toBe("changes_records");
    expect(PAX_TOOL_GROUPS[WRITE]).toBe("changes_records");
  });
  it("scoped: reads need financial_read, the record change financial_write, under the finance door", () => {
    for (const n of READS) expect(INTENT_META[n]).toEqual({ door: "finance", scope: "financial_read" });
    expect(INTENT_META[WRITE]).toEqual({ door: "finance", scope: "financial_write" });
  });
  it("grouped in the underwriting and documents bundles — in BOTH registries (legacy tools.ts and the appIntents roleAllowList the Pax loop consumes)", () => {
    const legacy = src("server/ai/tools.ts");
    const registry = src("server/services/appIntents/index.ts");
    for (const [label, text, shape] of [
      ["tools.ts", legacy, (b: string) => (l: string) => l.trimStart().startsWith(`${b}: [`)],
      ["appIntents/index.ts", registry, (b: string) => (l: string) => l.trimStart().startsWith(`${b}: [`)],
    ] as const) {
      for (const bundle of ["underwriting", "documents"]) {
        const lines = text.split("\n");
        const start = lines.findIndex(shape(bundle));
        expect(start, `${label}: ${bundle} bundle`).toBeGreaterThan(-1);
        let end = start;
        while (!/\],?$/.test(lines[end].trimEnd())) end++;
        const body = lines.slice(start, end + 1).join("\n");
        for (const n of [...READS, WRITE]) expect(body, `${label}: ${bundle} lacks ${n}`).toContain(`"${n}"`);
      }
    }
  });
});

describe("FD5 — no notice send is reachable from Pax", () => {
  it("no tax tool name or description offers to send a notice", () => {
    for (const n of [...READS, WRITE]) {
      expect(n).not.toMatch(/send|mail|dispatch/i);
      expect(toolDefinitions[n].description).toMatch(/never send|read|record|list|get/i);
    }
    expect(Object.keys(toolDefinitions).filter((n) => /tax.*(send|notice)|redemption_notice|send.*notice/i.test(n))).toEqual([]);
  });
  it("the tool module cannot reach the rail, the mail lanes or the notice service", () => {
    const code = src("server/ai/taxCertificateTools.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/settlementRail|taxNotice|mailLane|emailService|smsService|redemption-notice/);
  });
  it("the ledger entry the tool records is the operator-sent kind, never a rail receipt", () => {
    const rail = ledgerEntrySchema.safeParse({ kind: "redemption_notice_recorded", sentOn: "2026-01-01", method: "x", note: null, source: "s", sentViaRail: true, providerId: "ltr_1" });
    expect(rail.success).toBe(true);
    expect((rail as any).data.sentViaRail).toBeUndefined(); // stripped: the input cannot claim a rail send
  });
});

describe("reads — coverage, org pinning, refusals", () => {
  it("list: states its coverage and filters by the SESSION org, ignoring a model-supplied one", async () => {
    H.rows.tax_certificates = [certRow];
    const r = await executeTool("get_tax_certificates", { organization_id: 999, organizationId: 999 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/THIS account's tax certificates only/);
    expect(r.data.coverage).toMatch(/does not include tax-sale listings/);
    expect(r.data.certificates).toHaveLength(1);
    expect(r.data.certificates[0]).toMatchObject({ id: CERT_ID, county: "Cochise", state: "AZ", status: "active" });
    const p = H.wheres.filter((w) => w.table === "tax_certificates").flatMap((w) => params(w.cond));
    expect(p).toContain(7);
    expect(p).not.toContain(999);
  });
  it("one certificate: coverage, the amounts, and a refusal for another account's id", async () => {
    H.rows.tax_certificates = [certRow];
    const ok = await executeTool("get_tax_certificate", { certificate_id: CERT_ID }, org);
    expect(ok.success).toBe(true);
    expect(ok.data.coverage).toMatch(/one certificate/i);
    expect(ok.data.certificate.purchaseAmountCents).toBe(500000);
    expect(params(H.wheres.at(-1)!.cond)).toContain(7);

    H.rows.tax_certificates = [];
    const none = await executeTool("get_tax_certificate", { certificate_id: CERT_ID }, org);
    expect(none.success).toBe(false);
    expect(none.refusal?.what).toMatch(/No tax certificate/);
  });
  it("a printed certificate number is refused, not queried", async () => {
    const r = await executeTool("get_tax_certificate_clock", { certificate_id: "C-1" }, org);
    expect(r.success).toBe(false);
    expect(H.wheres).toHaveLength(0);
  });
  it("clock: runs the shared service for the session org and states it is a legal fact", async () => {
    H.rows.tax_certificates = [certRow];
    const r = await executeTool("get_tax_certificate_clock", { certificate_id: CERT_ID }, org);
    expect(r.success).toBe(true);
    expect(r.data.clock).toMatchObject({ orgId: 7, certificateId: CERT_ID });
    expect(r.data.coverage).toMatch(/legal fact/);
  });
  it("ledger: a SIMULATED rail notice is flagged not-mailed; an unmarked one is not claimed real", async () => {
    H.rows.tax_certificates = [certRow];
    H.rows.tax_events = [
      { eventType: "redemption_notice_recorded", eventDate: "2026-11-19", ruleCited: { kind: "county_record", source: "s" }, detail: { method: "certified mail via AcreOS", sentViaRail: true, providerId: "sim_abc", testMode: true }, recordedBy: "u", recordedAt: new Date("2026-11-19") },
      { eventType: "redemption_notice_recorded", eventDate: "2026-11-20", ruleCited: { kind: "county_record", source: "s" }, detail: { method: "certified mail via AcreOS", sentViaRail: true, providerId: "ltr_1" }, recordedBy: "u", recordedAt: new Date("2026-11-20") },
    ];
    const r = await executeTool("get_tax_certificate_ledger", { certificate_id: CERT_ID }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/ONE certificate in THIS account/);
    const sim = r.data.noticeSimulation;
    expect(sim.notices.map((n: any) => n.simulated)).toEqual([true, null]);
    expect(sim.statement).toMatch(/SIMULATED/);
    expect(sim.statement).toMatch(/NOT mailed/);
    expect(sim.statement).toMatch(/does not show whether/);
    for (const w of H.wheres.filter((x) => x.table === "tax_events")) expect(params(w.cond)).toContain(7);
  });
  it("ledger: an operator-recorded notice is not labelled simulated", async () => {
    H.rows.tax_certificates = [certRow];
    H.rows.tax_events = [
      { eventType: "redemption_notice_recorded", eventDate: "2026-11-01", ruleCited: { kind: "county_record", source: "s" }, detail: { method: "certified mail", sentByOperator: true }, recordedBy: "u", recordedAt: new Date("2026-11-01") },
    ];
    const r = await executeTool("get_tax_certificate_ledger", { certificate_id: CERT_ID }, org);
    expect(r.data.noticeSimulation.notices[0].simulated).toBe(false);
    expect(r.data.noticeSimulation.statement).not.toMatch(/SIMULATED/);
  });
});

describe("record_tax_ledger_entry — validated, org-scoped, receipted, never a send", () => {
  const good = { certificate_id: CERT_ID, kind: "subsequent_tax_paid", paid_on: "2026-01-15", amount_cents: 12000, tax_year: "2025", source: "Treasurer receipt" };
  it("appends through the ledger service and writes ONE receipt naming the entry", async () => {
    H.rows.tax_certificates = [certRow];
    const r = await executeTool(WRITE, { ...good, organization_id: 999 }, org, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect(r.data.message).toMatch(/AcreOS did not send anything/);
    expect(H.inserts).toHaveLength(1);
    expect(H.inserts[0].table).toBe("tax_events");
    expect(H.inserts[0].values).toMatchObject({ organizationId: 7, certificateId: CERT_ID, eventType: "subsequent_tax_paid", recordedBy: "u-1" });
    expect(H.effects).toHaveLength(1);
    expect(H.effects[0]).toMatchObject({ orgId: 7, tool: "record_tax_ledger_entry", actor: "pax" });
    expect(H.effects[0].after.entry.amountCents).toBe(12000);
  });
  it("refuses a future date and writes nothing, no receipt", async () => {
    H.rows.tax_certificates = [certRow];
    const r = await executeTool(WRITE, { ...good, paid_on: "2026-12-31" }, org, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(r.refusal?.why).toMatch(/future/);
    expect(H.inserts).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
  it("refuses an entry with no source or a malformed amount, writes nothing", async () => {
    H.rows.tax_certificates = [certRow];
    for (const bad of [{ ...good, source: "" }, { ...good, amount_cents: -5 }, { ...good, kind: "quiet_title_filed" }]) {
      const r = await executeTool(WRITE, bad, org, { userId: "u-1" });
      expect(r.success).toBe(false);
    }
    expect(H.inserts).toHaveLength(0);
  });
  it("another account's certificate: refused, nothing written", async () => {
    H.rows.tax_certificates = [];
    const r = await executeTool(WRITE, good, org, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(H.inserts).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
});
