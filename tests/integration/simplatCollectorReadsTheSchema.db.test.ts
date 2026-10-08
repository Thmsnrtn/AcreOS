/**
 * The simulation platform's collector (tests/simulation/platform/collector.ts)
 * reads the app's own tables to feed the invariant monitor. When one of its
 * queries names a column the schema does not have, the read fails, the
 * observation marks that source UNREAD, and every invariant fed by it reports
 * "unknown" instead of "held" — a year of runs can then certify nothing about
 * it while showing zero violations.
 *
 * That happened: the refunds read selected autopilot_pending_actions.updated_at,
 * which does not exist, so refunds-within-rules was unknown on all 365 ticks of
 * all five year seeds. This test runs one observation against a database built
 * from this repo, with an executed refund in it so the per-row lookups run too,
 * and requires every DB-fed source to be read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("simplatCollectorReadsTheSchema.db.test.ts");

describe.runIf(realDbAvailable)("the simulation collector reads every source it claims on the real schema", () => {
  let pool: typeof import("../../server/db").pool;
  let actionId = 0;
  let orgId = 0;
  const landingOrgs: number[] = [];
  const pi = `pi_simplat_collector_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    ({ pool } = await import("../../server/db"));
    const r = await pool.query<{ id: number }>(
      `INSERT INTO autopilot_pending_actions (hand_name, args, content_hash, status, approved_by)
       VALUES ('apply_refund', $1::jsonb, $2, 'executed', 'witness-grant #999999') RETURNING id`,
      [JSON.stringify({ charge_id: pi, amount_cents: 3000 }), `simplat-collector-${pi}`],
    );
    actionId = r.rows[0].id;
  });

  afterAll(async () => {
    if (pool && landingOrgs.length) {
      await pool.query(`DELETE FROM unattached_inbound_messages WHERE organization_id = ANY($1)`, [landingOrgs]);
      await pool.query(`DELETE FROM lead_consent_events WHERE organization_id = ANY($1)`, [landingOrgs]);
      await pool.query(`DELETE FROM leads WHERE organization_id = ANY($1)`, [landingOrgs]);
      await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [landingOrgs]);
    }
    if (pool && actionId) await pool.query(`DELETE FROM autopilot_pending_actions WHERE id = $1`, [actionId]);
    if (pool && orgId) {
      await pool.query(`DELETE FROM org_email_identities WHERE organization_id = $1`, [orgId]);
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
  });

  it("an organization's own verified sending identity is not the platform sender", async () => {
    // The org provisions its own DKIM identity (org_email_identities) on its own
    // domain; mail from it is BYO, not the platform rail. The collector used to
    // know only verified_email_domains and email_sender_identities, so the first
    // year in which customers actually emailed their leads read every such send
    // as the platform mailing a counterparty.
    const { Collector } = await import("../simulation/platform/collector");
    const org = await pool.query<{ id: number }>(`INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id`, [`Collector ${pi}`, `collector-${pi}`, `owner-${pi}`]);
    orgId = org.rows[0].id;
    await pool.query(
      `INSERT INTO org_email_identities (organization_id, from_address, dkim_domain, dkim_selector, dkim_public_key, dkim_private_key_encrypted, spf_record, dmarc_record, status)
       VALUES ($1, $2, $3, 'acreos', 'pk', 'enc', 'spf', 'dmarc', 'verified')`,
      [orgId, `deals@collector-${process.pid}.example.org`, `collector-${process.pid}.example.org`],
    );
    const q = async (sql: string, params?: unknown[]) =>
      /simplat\.tenant_writes/.test(sql) ? (/max\(id\)/.test(sql) ? [{ m: 0 }] : []) : (await pool.query(sql, params as any[])).rows;
    const dir = mkdtempSync(join(tmpdir(), "simplat-collector-id-"));
    mkdirSync(join(dir, "provider"));
    writeFileSync(join(dir, "dbtap.jsonl"), "");
    writeFileSync(join(dir, "egress.jsonl"), "");
    writeFileSync(join(dir, "provider/provider-calls.jsonl"), [
      { rail: "ses", op: "send", from: `deals@collector-${process.pid}.example.org`, to: ["seller@example.net"], at: new Date().toISOString() },
      { rail: "ses", op: "send", from: "notifications@acreos.io", to: ["someone@example.net"], at: new Date().toISOString() },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n");
    const c = new Collector(q as any, dir);
    await c.init();
    const truth = { revokedAtVirtual: new Map(), outages: [], founderTaps: [], approvalsShown: new Map(), screens: [] };
    const o = await c.observe(new Date().toISOString(), truth as any, 0);
    expect(o.platformSenders).toEqual(["notifications@acreos.io"]);
  });

  it("a provider callback that lands in another tenant is a cross-tenant write", async () => {
    // A Twilio callback carries no tenant actor (the server resolves the org
    // from the signed To number, which is platform scope), so the db tap cannot
    // judge what it writes. The harness records which tenant each callback was
    // FOR, and the collector reads where it LANDED: a row under any other org
    // must reach no-cross-tenant, or misrouting a seller's reply (or STOP) into
    // another tenant would pass a year of runs green.
    const { Collector } = await import("../simulation/platform/collector");
    const { checkAll, freshState } = await import("../simulation/invariants/registry");
    const mk = async (tag: string) =>
      (await pool.query<{ id: number }>(`INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id`, [`Landing ${tag} ${pi}`, `landing-${tag}-${pi}`, `owner-${tag}-${pi}`])).rows[0].id;
    const forOrg = await mk("for");
    const otherOrg = await mk("other");
    landingOrgs.push(forOrg, otherOrg);
    const sidWrong = `SMwrong${process.pid}${Date.now()}`;
    const sidRight = `SMright${process.pid}${Date.now()}`;
    await pool.query(
      `INSERT INTO unattached_inbound_messages (organization_id, channel, from_address, to_address, body, external_id) VALUES ($1, 'sms', '+15205550100', '+15205550199', 'yes I would sell', $2), ($3, 'sms', '+15205550101', '+15205550198', 'maybe', $4)`,
      [otherOrg, sidWrong, forOrg, sidRight],
    );
    const q = async (sql: string, params?: unknown[]) =>
      /simplat\.tenant_writes/.test(sql) ? (/max\(id\)/.test(sql) ? [{ m: 0 }] : []) : (await pool.query(sql, params as any[])).rows;
    const dir = mkdtempSync(join(tmpdir(), "simplat-collector-landing-"));
    mkdirSync(join(dir, "provider"));
    for (const f of ["dbtap.jsonl", "egress.jsonl", "provider/provider-calls.jsonl"]) writeFileSync(join(dir, f), "");
    const c = new Collector(q as any, dir);
    await c.init();
    const truth = {
      revokedAtVirtual: new Map(), outages: [], founderTaps: [], approvalsShown: new Map(), screens: [],
      webhookLandings: [{ forOrg, sid: sidWrong }, { forOrg, sid: sidRight }],
    };
    const o = await c.observe(new Date().toISOString(), truth as any, 0);
    expect(o.unread ?? []).toEqual([]);
    const landed = (o.tenantWrites ?? []).filter((w) => w.op === "WEBHOOK");
    expect(landed).toEqual(expect.arrayContaining([
      { actorOrg: forOrg, rowOrg: otherOrg, table: "unattached_inbound_messages", op: "WEBHOOK" },
      { actorOrg: forOrg, rowOrg: forOrg, table: "unattached_inbound_messages", op: "WEBHOOK" },
    ]));
    const v = checkAll(o, freshState()).violations.filter((x) => x.invariant === "no-cross-tenant");
    expect(v.map((x) => x.evidence)).toEqual([`org ${forOrg} WEBHOOK on unattached_inbound_messages row of org ${otherOrg}`]);
    // Each landing is read once: the next tick has none pending.
    const o2 = await c.observe(new Date().toISOString(), truth as any, 0);
    expect((o2.tenantWrites ?? []).filter((w) => w.op === "WEBHOOK")).toEqual([]);
  });

  it("an SMS is judged by the consent its lead had WHEN it was sent", async () => {
    // A seller texted at 16:00 who answers STOP at midnight has tcpa_consent
    // false by the time the day is observed. Read as of now, that send looked
    // like a text without consent; read as of the send, it was consented. The
    // same reading must still catch a lead who never consented, and a send
    // after the revocation.
    const { Collector } = await import("../simulation/platform/collector");
    const { checkAll, freshState } = await import("../simulation/invariants/registry");
    const org = (await pool.query<{ id: number }>(`INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id`, [`Consent ${pi}`, `consent-${pi}`, `owner-consent-${pi}`])).rows[0].id;
    landingOrgs.push(org);
    const tail = String(process.pid).padStart(4, "0").slice(-4);
    const phoneA = `+1520555${tail}`, phoneB = `+1602555${tail}`;
    const lead = async (phone: string) =>
      (await pool.query<{ id: number }>(`INSERT INTO leads (organization_id, first_name, last_name, phone, tcpa_consent, do_not_contact) VALUES ($1, 'Pat', 'Seller', $2, false, true) RETURNING id`, [org, phone])).rows[0].id;
    const a = await lead(phoneA);
    const b = await lead(phoneB);
    const ev = (leadId: number, type: string, at: string) =>
      pool.query(`INSERT INTO lead_consent_events (organization_id, lead_id, event_type, channels, source, created_at) VALUES ($1, $2, $3, '["sms","email","phone","direct_mail"]'::jsonb, $4, $5)`, [org, leadId, type, type === "revoked" ? "inbound_stop" : "written", at]);
    await ev(a, "granted", "2026-11-26T16:00:00Z");
    await ev(a, "revoked", "2026-12-11T00:00:00Z");
    const q = async (sql: string, params?: unknown[]) =>
      /simplat\.tenant_writes/.test(sql) ? (/max\(id\)/.test(sql) ? [{ m: 0 }] : []) : (await pool.query(sql, params as any[])).rows;
    const dir = mkdtempSync(join(tmpdir(), "simplat-collector-consent-"));
    mkdirSync(join(dir, "provider"));
    for (const f of ["dbtap.jsonl", "egress.jsonl"]) writeFileSync(join(dir, f), "");
    const sms = (to: string, ts: string) => ({ rail: "twilio", op: "message", to, from: "+15005550005", ts });
    writeFileSync(join(dir, "provider/provider-calls.jsonl"), [
      sms(phoneA, "2026-12-10T16:00:00.000Z"), // consented when sent; revoked after
      sms(phoneA, "2026-12-12T16:00:00.000Z"), // after the revocation
      sms(phoneB, "2026-12-10T16:00:00.000Z"), // never consented
    ].map((x) => JSON.stringify(x)).join("\n") + "\n");
    const c = new Collector(q as any, dir);
    await c.init();
    const truth = { revokedAtVirtual: new Map(), outages: [], founderTaps: [], approvalsShown: new Map(), screens: [], webhookLandings: [] };
    const o = await c.observe("2026-12-13T00:00:00.000Z", truth as any, 0);
    const v = checkAll(o, freshState()).violations.filter((x) => x.invariant === "no-send-without-consent").map((x) => x.evidence);
    expect(v).toHaveLength(2);
    expect(v.some((e) => e.includes(phoneA) && e.includes("2026-12-12"))).toBe(true);
    expect(v.some((e) => e === `sms without consent to ${phoneB} at 2026-12-10T16:00:00.000Z`)).toBe(true);
    expect(v.some((e) => e.includes(phoneA) && e.includes("2026-12-10"))).toBe(false);
  });

  it("no DB-fed source is unread, and the executed refund is observed", async () => {
    const { Collector } = await import("../simulation/platform/collector");
    // simplat.tenant_writes exists only in the simulation template (tenant-tap.sql),
    // so that one read is answered empty here; every other query goes to Postgres.
    const q = async (sql: string, params?: unknown[]) =>
      /simplat\.tenant_writes/.test(sql)
        ? (/max\(id\)/.test(sql) ? [{ m: 0 }] : [])
        : (await pool.query(sql, params as any[])).rows;
    const dir = mkdtempSync(join(tmpdir(), "simplat-collector-db-"));
    mkdirSync(join(dir, "provider"));
    for (const f of ["dbtap.jsonl", "egress.jsonl", "provider/provider-calls.jsonl"]) writeFileSync(join(dir, f), "");
    const c = new Collector(q as any, dir);
    await c.init();
    // The refund cursor starts at 0, so the seeded row (and anything older) is read.
    const truth = { revokedAtVirtual: new Map(), outages: [], founderTaps: [], approvalsShown: new Map(), screens: [] };
    const o = await c.observe(new Date().toISOString(), truth as any, 0);
    expect(o.unread ?? []).toEqual([]);
    expect((o.refunds ?? []).some((r) => r.id === `pa-${actionId}` && r.amountCents === 3000 && r.byMachine)).toBe(true);
  });
});
