/**
 * LQ-11 — the DSAR drill (PKG-1 §5, docs/pkg1-dsar-design-2026-11.md).
 *
 * Drives the REAL founder DSAR routes (`registerPrivacyDsarRoutes`, plus the
 * legacy shim router for the clock check) over the REAL services and a REAL
 * Postgres built from this repo, through express + supertest. Only auth,
 * org resolution and the logger are mocked.
 *
 * Fixtures are synthetic, tag-scoped (`dsar-drill-<ts>-<rand>`), every email
 * is `<p>+<tag>@example.test`. Subjects:
 *   - U   customer-individual user in Org A (team member, team message,
 *         support ticket, AI conversation; plus a task and a lead ASSIGNED to
 *         U's team member, which erasure must NOT touch — C-5);
 *   - L_A borrower lead in Org A (note, 2 payments, consent event,
 *         conversation + message, property with sellerId = L_A), and the
 *         DECOY L_B in Org B with the SAME email (own note, consent, property);
 *   - L_S non-borrower lead in Org A (consent event, lead activity);
 *   - H   user in Org H under an org_wide hold; L_H lead under a
 *         lead_specific hold;
 *   - V   user whose DSAR records are NOT verified.
 *
 * DEVIATION from design §5 (code facts, intent kept): the design seeds L_H in
 * Org A. anonymizeUser blocks on ANY active hold in ANY member org of the
 * user (gdprService.ts — "Strictness is unchanged: ANY active hold in ANY
 * member org blocks", decided in design §3 C-5 step 1), so a lead_specific
 * hold in Org A would 423 user U's erasure (assertion 11) with L_H's caseRef.
 * L_H therefore lives in its own Org LH, which holds ONLY that lead_specific
 * hold — the lead_specific refusal is still the thing assertion 10 proves.
 *
 * Cleanup deletes fixture rows in FK order, scoped to the fixture org ids,
 * user ids and DSAR record ids. audit_events is NOT deleted — it is an
 * append-only hash chain; the drill's rows stay, tagged by DSAR id.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("dsarDrill.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireFounder: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const tag = `dsar-drill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const em = (p: string) => `${p}+${tag}@example.test`;
const HOUR_MS = 60 * 60 * 1000;
const ORG_CASE = `DRILL-${tag}-ORG`;
const LEAD_CASE = `DRILL-${tag}-LEAD`;
const TAX_CIPHERTEXT = `v1:drill-ciphertext-${tag}`;
const DECOY_NAME = `DecoyB-${tag}`;
const DECOY_APN = `DECOY-${tag}`;
const DECOY_CONSENT = `decoy-consent-${tag}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
const ids = {
  orgA: 0, orgB: 0, orgH: 0, orgLH: 0,
  userU: "", userH: "", userV: "",
  tmU: 0, tmH: 0,
  teamConvU: 0,
  leadA: 0, leadB: 0, leadS: 0, leadH: 0, leadAssigned: 0,
  noteA: 0, noteB: 0, propA: 0, propB: 0,
  taskAssigned: 0,
  holdOrg: "", holdLead: "",
  legacyDsar: "",
};
const rec: Record<string, string> = {};
const lifecycleIds: string[] = [];
const userIds: string[] = [];

let app: express.Express;
let db: any;
let S: any; // @shared/schema
let drizzle: any; // drizzle-orm (eq, and, sql)
let gdpr: any; // server/services/gdprService

async function one<T = any>(q: Promise<T[]>): Promise<T> {
  const rows = await q;
  if (!rows[0]) throw new Error("expected a row");
  return rows[0];
}

async function newRecord(key: string, requestType: string, requesterEmail: string, verified: boolean): Promise<string> {
  const row = await one(
    db
      .insert(S.dsarRequestsLifecycle)
      .values({
        requestType,
        requesterEmail,
        requesterIdentityVerified: verified,
        slaDeadlineAt: new Date(Date.now() + 24 * HOUR_MS),
        auditNotes: `LQ-11 drill ${tag}`,
      })
      .returning(),
  );
  rec[key] = row.id;
  lifecycleIds.push(row.id);
  return row.id;
}

const userSubject = (userId: string) => ({ kind: "user", userId });
const leadSubject = (organizationId: number, leadId: number) => ({ kind: "lead", organizationId, leadId });

function exportCall(dsarId: string, subject: unknown) {
  return request(app).post(`/api/founder/dsar/${dsarId}/generate-export`).send({ subject });
}
function eraseCall(dsarId: string, subject: unknown) {
  return request(app).post(`/api/founder/dsar/${dsarId}/execute-erasure`).send({ subject, confirm: "ERASE" });
}

async function userRow(id: string) {
  return one(db.select().from(S.users).where(drizzle.eq(S.users.id, id)));
}
async function leadRow(id: number) {
  return one(db.select().from(S.leads).where(drizzle.eq(S.leads.id, id)));
}
async function auditRows(dsarId: string, action: string): Promise<Array<{ action: string; metadata: any }>> {
  const r = await db.execute(
    drizzle.sql`SELECT action, metadata FROM audit_events WHERE target_type = 'dsar' AND target_id = ${dsarId} AND action = ${action} ORDER BY seq`,
  );
  return r.rows;
}
async function count(table: string, column: string, value: string | number): Promise<number> {
  const r = await db.execute(
    drizzle.sql`SELECT count(*)::int AS n FROM ${drizzle.sql.identifier(table)} WHERE ${drizzle.sql.identifier(column)} = ${value}`,
  );
  return Number(r.rows[0].n);
}

/** Visit every (key, value) pair in a JSON tree. */
function walk(v: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(v)) v.forEach((x) => walk(x, visit));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      visit(k, x);
      walk(x, visit);
    }
  }
}
const ORG_KEYS = new Set(["organizationId", "organization_id", "orgId", "org_id"]);
function orgValues(body: unknown): unknown[] {
  const out: unknown[] = [];
  walk(body, (k, x) => {
    if (ORG_KEYS.has(k)) out.push(x);
  });
  return out;
}
function allKeys(body: unknown): string[] {
  const out: string[] = [];
  walk(body, (k) => out.push(k));
  return out;
}

describe.runIf(realDbAvailable)("LQ-11 DSAR drill (real database, real routes)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    ({ db } = await import("../../server/db"));
    S = await import("@shared/schema");
    drizzle = await import("drizzle-orm");
    gdpr = await import("../../server/services/gdprService");
    const { registerPrivacyDsarRoutes } = await import("../../server/routes-privacy-dsar");
    const gdprRouter = (await import("../../server/routes-gdpr")).default;

    const org = async (suffix: string) =>
      (await one(db.insert(S.organizations).values({ name: `${tag}-${suffix}`, slug: `${tag}-${suffix}`.toLowerCase(), ownerId: `${tag}-owner` } as any).returning())).id as number;
    ids.orgA = await org("A");
    ids.orgB = await org("B");
    ids.orgH = await org("H");
    ids.orgLH = await org("LH");

    // ── users (no realdb test inserted users before; required columns are
    //    id (uuid default) and persona (default) — shared/models/auth.ts) ──
    const user = async (p: string, firstName: string) => {
      const u = await one(db.insert(S.users).values({ email: em(p), firstName, lastName: "Drill" } as any).returning());
      userIds.push(u.id);
      return u.id as string;
    };
    ids.userU = await user("u", "Una");
    ids.userH = await user("h", "Hal");
    ids.userV = await user("v", "Vera");

    const member = async (organizationId: number, userId: string, email: string) =>
      (await one(db.insert(S.teamMembers).values({ organizationId, userId, email, role: "member" } as any).returning())).id as number;
    ids.tmU = await member(ids.orgA, ids.userU, em("u"));
    ids.tmH = await member(ids.orgH, ids.userH, em("h"));

    // ── U's own records ──
    ids.teamConvU = (await one(db.insert(S.teamConversations).values({ organizationId: ids.orgA, createdBy: ids.userU, participantIds: [ids.userU] } as any).returning())).id;
    await db.insert(S.teamMessages).values({ conversationId: ids.teamConvU, senderId: ids.userU, body: `team message ${tag}` } as any);
    await db.insert(S.supportTickets).values({ organizationId: ids.orgA, userId: ids.userU, subject: `ticket ${tag}`, description: "drill ticket" } as any);
    await db.insert(S.aiConversations).values({ organizationId: ids.orgA, userId: ids.userU, title: `ai ${tag}` } as any);
    // Org A's own records ASSIGNED to U's team member — third parties / the
    // org's work; C-5 removed erasure's reach into them.
    ids.leadAssigned = (await one(db.insert(S.leads).values({ organizationId: ids.orgA, firstName: "Assigned", lastName: "Contact", email: em("assigned"), phone: "555-0109", assignedTo: ids.tmU } as any).returning())).id;
    ids.taskAssigned = (await one(db.insert(S.tasks).values({ organizationId: ids.orgA, title: `task ${tag}`, assignedTo: ids.tmU, createdBy: `${tag}-owner` } as any).returning())).id;

    // ── Borrower L_A in Org A ──
    const borrowerLead = async (organizationId: number, firstName: string) =>
      (await one(db.insert(S.leads).values({
        organizationId, firstName, lastName: "Borrower", email: em("b"), phone: "555-0100",
        address: "1 Drill Way", city: "Austin", state: "TX", zip: "78701",
        taxId: TAX_CIPHERTEXT, taxIdType: "SSN",
      } as any).returning())).id as number;
    const note = async (organizationId: number, borrowerId: number, portal: string | null) =>
      (await one(db.insert(S.notes).values({
        organizationId, borrowerId,
        originalPrincipal: "50000.00", currentBalance: "40000.00", interestRate: "9.5", termMonths: 120, monthlyPayment: "650.00",
        startDate: new Date("2024-01-01T00:00:00Z"), firstPaymentDate: new Date("2024-02-01T00:00:00Z"),
        // Not "active": an active note must carry an ATR determination
        // (notes_atr_origination_gate) — bookkeepingContract.realdb.test.ts.
        status: "paid_off",
        countyTaxPortalUrl: portal,
      } as any).returning())).id as number;
    const property = async (organizationId: number, sellerId: number, apn: string) =>
      (await one(db.insert(S.properties).values({ organizationId, apn, county: "Travis", state: "TX", sizeAcres: "1.25", sellerId } as any).returning())).id as number;
    const consent = async (organizationId: number, leadId: number, consentText: string) =>
      db.insert(S.leadConsentEvents).values({ organizationId, leadId, eventType: "granted", channels: ["sms"], source: "written", consentText } as any);

    ids.leadA = await borrowerLead(ids.orgA, "Bora");
    ids.noteA = await note(ids.orgA, ids.leadA, null);
    const pay = (month: number) => ({
      organizationId: ids.orgA, noteId: ids.noteA, amount: "650.00", principalAmount: "300.00", interestAmount: "350.00",
      paymentDate: new Date(Date.UTC(2025, month, 15)), dueDate: new Date(Date.UTC(2025, month, 1)), status: "completed",
    });
    await db.insert(S.payments).values([pay(2), pay(3)] as any);
    await consent(ids.orgA, ids.leadA, `borrower consent ${tag}`);
    const convA = await one(db.insert(S.conversations).values({ organizationId: ids.orgA, leadId: ids.leadA, channel: "sms" } as any).returning());
    await db.insert(S.messages).values({ conversationId: convA.id, organizationId: ids.orgA, direction: "inbound", sender: "lead", content: `hello ${tag}` } as any);
    ids.propA = await property(ids.orgA, ids.leadA, `APN-A-${tag}`);

    // ── Decoy L_B in Org B — SAME email, its own note/consent/property ──
    ids.leadB = await borrowerLead(ids.orgB, DECOY_NAME);
    ids.noteB = await note(ids.orgB, ids.leadB, `https://decoy-${tag}.example.test`);
    await consent(ids.orgB, ids.leadB, DECOY_CONSENT);
    ids.propB = await property(ids.orgB, ids.leadB, DECOY_APN);

    // ── Non-borrower L_S in Org A ──
    ids.leadS = (await one(db.insert(S.leads).values({ organizationId: ids.orgA, firstName: "Sel", lastName: "Seller", email: em("s"), phone: "555-0101", address: "2 Drill Way", city: "Austin", zip: "78702" } as any).returning())).id;
    await consent(ids.orgA, ids.leadS, `seller consent ${tag}`);
    await db.insert(S.leadActivities).values({ leadId: ids.leadS, organizationId: ids.orgA, type: "note_added", description: `activity ${tag}` } as any);

    // ── Held subjects (see the header DEVIATION for Org LH) ──
    ids.holdOrg = (await one(db.insert(S.legalHolds).values({ organizationId: ids.orgH, caseRef: ORG_CASE, scope: "org_wide", notes: tag } as any).returning())).id;
    ids.leadH = (await one(db.insert(S.leads).values({ organizationId: ids.orgLH, firstName: "Held", lastName: "Lead", email: em("lh"), phone: "555-0102" } as any).returning())).id;
    ids.holdLead = (await one(db.insert(S.legalHolds).values({ organizationId: ids.orgLH, caseRef: LEAD_CASE, scope: "lead_specific", scopeIds: [String(ids.leadH)], notes: tag } as any).returning())).id;

    // ── DSAR lifecycle records ──
    await newRecord("U_access", "access", em("u"), true);
    await newRecord("U_erase", "erasure", em("u"), true);
    await newRecord("B_access", "access", em("b"), true);
    await newRecord("B_erase", "erasure", em("b"), true);
    await newRecord("S_erase", "erasure", em("s"), true);
    await newRecord("H_erase", "erasure", em("h"), true);
    await newRecord("LH_erase", "erasure", em("lh"), true);
    await newRecord("V_access", "access", em("v"), false);
    await newRecord("V_erase", "erasure", em("v"), false);

    // A record on the OTHER table (dsar_requests) for the §8 route-ordering check.
    const legacy = await db.execute(
      drizzle.sql`INSERT INTO dsar_requests (request_type, email, full_name) VALUES ('access', ${em("legacy")}, ${`Legacy ${tag}`}) RETURNING id`,
    );
    ids.legacyDsar = legacy.rows[0].id;

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: `${tag}-founder`, email: em("founder") };
      next();
    });
    registerPrivacyDsarRoutes(app as any);
    app.use("/api/privacy", gdprRouter);
  });

  afterAll(async () => {
    if (!db) return;
    const { sql } = drizzle;
    const errors: string[] = [];
    const run = async (q: unknown) => {
      try {
        await db.execute(q);
      } catch (e) {
        errors.push((e as Error).message);
      }
    };
    const orgs = [ids.orgA, ids.orgB, ids.orgH, ids.orgLH].filter((o) => o > 0);
    for (const o of orgs) {
      await run(sql`DELETE FROM messages WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM conversations WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM lead_activities WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM lead_consent_events WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM payments WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM notes WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM properties WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM tasks WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM leads WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM team_messages WHERE conversation_id IN (SELECT id FROM team_conversations WHERE organization_id = ${o})`);
      await run(sql`DELETE FROM team_conversations WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM support_tickets WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM ai_conversations WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM team_members WHERE organization_id = ${o}`);
      // legal_holds.organization_id is onDelete "restrict": release, then delete.
      await run(sql`UPDATE legal_holds SET status = 'released', released_at = now(), release_reason = ${`LQ-11 drill cleanup ${tag}`} WHERE organization_id = ${o}`);
      await run(sql`DELETE FROM legal_holds WHERE organization_id = ${o}`);
    }
    for (const id of lifecycleIds) await run(sql`DELETE FROM dsar_requests_lifecycle WHERE id = ${id}`);
    if (ids.legacyDsar) await run(sql`DELETE FROM dsar_requests WHERE id = ${ids.legacyDsar}`);
    for (const id of userIds) await run(sql`DELETE FROM users WHERE id = ${id}`);
    for (const o of orgs) await run(sql`DELETE FROM organizations WHERE id = ${o}`);
    // audit_events is deliberately NOT deleted (append-only hash chain).
    if (errors.length > 0) throw new Error(`LQ-11 drill cleanup left residue (tag ${tag}):\n${errors.join("\n")}`);
  });

  it("1. clock adoption: the shim intake stamps slaDeadlineAt = now + DSAR_CLOCK_HOURS (frozen clock)", async () => {
    const { clock } = await import("../../server/utils/clock");
    const { DSAR_CLOCK_HOURS } = await import("@shared/privacy/dsarClock");
    const FROZEN = Date.parse("2026-11-09T12:00:00.000Z");
    const spy = vi.spyOn(clock, "nowMs").mockReturnValue(FROZEN);
    try {
      const res = await request(app).post("/api/privacy/export").send({});
      expect(res.status).toBe(202);
      lifecycleIds.push(res.body.requestId);
      const row = await one(db.select().from(S.dsarRequestsLifecycle).where(drizzle.eq(S.dsarRequestsLifecycle.id, res.body.requestId)));
      expect(new Date(row.slaDeadlineAt).getTime() - FROZEN).toBe(DSAR_CLOCK_HOURS * HOUR_MS);
    } finally {
      spy.mockRestore();
    }
  });

  it("§8 route ordering: verify-identity on a dsar_requests id is a lifecycle 404 and touches nothing", async () => {
    const before = (await db.execute(drizzle.sql`SELECT * FROM dsar_requests WHERE id = ${ids.legacyDsar}`)).rows;
    const res = await request(app)
      .post(`/api/founder/dsar/${ids.legacyDsar}/verify-identity`)
      .send({ method: "operator_document_check", evidenceNote: "drill: checked a government ID out-of-band" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
    expect(res.body.message).toContain("DSAR request");
    const after = (await db.execute(drizzle.sql`SELECT * FROM dsar_requests WHERE id = ${ids.legacyDsar}`)).rows;
    expect(after).toEqual(before);
    expect(await auditRows(ids.legacyDsar, "dsar.verified")).toEqual([]);
  });

  it("2. unverified records refuse export AND erasure with 422 DSAR_NOT_VERIFIED; V is byte-identical", async () => {
    const before = await userRow(ids.userV);
    const exp = await exportCall(rec.V_access, userSubject(ids.userV));
    expect(exp.status).toBe(422);
    expect(exp.body.details.reason).toBe("DSAR_NOT_VERIFIED");
    const era = await eraseCall(rec.V_erase, userSubject(ids.userV));
    expect(era.status).toBe(422);
    expect(era.body.details.reason).toBe("DSAR_NOT_VERIFIED");
    expect(await userRow(ids.userV)).toEqual(before);
  });

  it("3. verify-identity: a too-short evidence note is refused; a valid one verifies, audits, and unlocks export", async () => {
    const short = await request(app)
      .post(`/api/founder/dsar/${rec.V_access}/verify-identity`)
      .send({ method: "operator_document_check", evidenceNote: "too short" });
    expect(short.status).toBe(422);
    let row = await one(db.select().from(S.dsarRequestsLifecycle).where(drizzle.eq(S.dsarRequestsLifecycle.id, rec.V_access)));
    expect(row.requesterIdentityVerified).toBe(false);

    const ok = await request(app)
      .post(`/api/founder/dsar/${rec.V_access}/verify-identity`)
      .send({ method: "operator_document_check", evidenceNote: "drill: checked a government ID out-of-band" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ verified: true, alreadyVerified: false, method: "operator_document_check" });
    row = await one(db.select().from(S.dsarRequestsLifecycle).where(drizzle.eq(S.dsarRequestsLifecycle.id, rec.V_access)));
    expect(row.requesterIdentityVerified).toBe(true);

    const audits = await auditRows(rec.V_access, "dsar.verified");
    expect(audits.length).toBe(1);
    expect(audits[0].metadata.method).toBe("operator_document_check");
    expect(audits[0].metadata.table).toBe("dsar_requests_lifecycle");

    const exp = await exportCall(rec.V_access, userSubject(ids.userV));
    expect(exp.status).toBe(200);
    // The erasure record for V was NOT verified by verifying the access record.
    const era = await eraseCall(rec.V_erase, userSubject(ids.userV));
    expect(era.body.details.reason).toBe("DSAR_NOT_VERIFIED");
  });

  let userExport: any;
  it("4. customer-individual export: account, own records, named exclusions, honest totals", async () => {
    const res = await exportCall(rec.U_access, userSubject(ids.userU));
    expect(res.status).toBe(200);
    userExport = res.body;
    const d = userExport.domains;
    expect(d.account_profile).toHaveLength(1);
    expect(d.account_profile[0].email).toBe(em("u"));
    expect(allKeys(userExport)).not.toContain("password");
    expect(allKeys(userExport)).not.toContain("passwordResetToken");
    expect(d.team_messages).toHaveLength(1);
    expect(d.support_tickets).toHaveLength(1);
    expect(d.ai_conversations).toHaveLength(1);
    expect(d.team_memberships).toHaveLength(1);
    const excluded = userExport.exclusions.map((x: { domain: string }) => x.domain);
    expect(excluded).toEqual(expect.arrayContaining(["assigned_records", "properties_user"]));
    for (const x of userExport.exclusions) expect(x.reason.length).toBeGreaterThan(0);
    for (const [domain, rows] of Object.entries(d)) expect(userExport.totalRecords[domain]).toBe((rows as unknown[]).length);
    expect(Object.keys(userExport.totalRecords).sort()).toEqual(Object.keys(d).sort());
    // The assigned lead is the org's record, not U's — it is not in U's export.
    expect(JSON.stringify(userExport)).not.toContain(em("assigned"));
  });

  let borrowerExport: any;
  it("5. borrower export end-to-end: profile, loan, payments, consent, comms, property — no credentials, no ciphertext", async () => {
    const res = await exportCall(rec.B_access, leadSubject(ids.orgA, ids.leadA));
    expect(res.status).toBe(200);
    borrowerExport = res.body;
    const d = borrowerExport.domains;
    expect(d.lead_profile).toHaveLength(1);
    expect(d.lead_profile[0].id).toBe(ids.leadA);
    expect(d.loan_notes).toHaveLength(1);
    expect(d.loan_notes[0].id).toBe(ids.noteA);
    expect(d.loan_payments).toHaveLength(2);
    expect(d.consent_records).toHaveLength(1);
    expect(d.consent_records[0].channels).toContain("sms");
    expect(d.communications.length).toBeGreaterThanOrEqual(2); // conversation + message
    expect(d.communications.map((c: { table: string }) => c.table)).toEqual(expect.arrayContaining(["conversations", "messages"]));
    expect(d.properties).toHaveLength(1);
    expect(d.properties[0].id).toBe(ids.propA);

    const keys = allKeys(borrowerExport);
    expect(keys).not.toContain("accessToken");
    expect(keys).not.toContain("taxId");
    expect(d.lead_profile[0].taxIdOnFile).toBe(true);
    expect(JSON.stringify(borrowerExport)).not.toContain(TAX_CIPHERTEXT);
  });

  it("6. tenant isolation: every org value in the borrower export is Org A; the decoy appears nowhere; U's export carries no B/H org", () => {
    expect(borrowerExport, "assertion 5 must run first").toBeDefined();
    const orgs = orgValues(borrowerExport);
    expect(orgs.length).toBeGreaterThan(5); // vacuity: the walk really saw org-keyed rows
    expect(orgs.filter((o) => o !== ids.orgA)).toEqual([]);

    // String search on values only the decoy carries.
    const text = JSON.stringify(borrowerExport);
    expect(text).not.toContain(DECOY_NAME);
    expect(text).not.toContain(DECOY_APN);
    expect(text).not.toContain(DECOY_CONSENT);
    expect(text).not.toContain(`decoy-${tag}`);
    // Typed id search: a bare-number search would collide across sequences,
    // so check the keys that reference each decoy entity.
    const leadRefs: unknown[] = [];
    const noteRefs: unknown[] = [];
    const propRefs: unknown[] = [];
    walk(borrowerExport, (k, v) => {
      if (["leadId", "borrowerId", "sellerId", "buyerId"].includes(k)) leadRefs.push(v);
      if (k === "noteId") noteRefs.push(v);
      if (k === "propertyId") propRefs.push(v);
    });
    expect(leadRefs.length).toBeGreaterThan(0);
    expect(leadRefs).not.toContain(ids.leadB);
    expect(noteRefs).not.toContain(ids.noteB);
    expect(propRefs).not.toContain(ids.propB);
    expect(borrowerExport.domains.lead_profile.map((r: { id: number }) => r.id)).not.toContain(ids.leadB);
    expect(borrowerExport.domains.loan_notes.map((r: { id: number }) => r.id)).not.toContain(ids.noteB);
    expect(borrowerExport.domains.properties.map((r: { id: number }) => r.id)).not.toContain(ids.propB);

    expect(userExport, "assertion 4 must run first").toBeDefined();
    const uOrgs = orgValues(userExport);
    expect(uOrgs.length).toBeGreaterThan(0);
    expect(uOrgs.filter((o) => o !== ids.orgA)).toEqual([]);
    for (const other of [ids.orgB, ids.orgH, ids.orgLH]) expect(uOrgs).not.toContain(other);
  });

  it("7. subject mismatch: the borrower's record cannot export the seller → 422 DSAR_SUBJECT_MISMATCH", async () => {
    const res = await exportCall(rec.B_access, leadSubject(ids.orgA, ids.leadS));
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe("DSAR_SUBJECT_MISMATCH");
    expect(JSON.stringify(res.body)).not.toContain(em("s"));
  });

  it("8. type mismatch: erasure on an access record → 422 DSAR_TYPE_MISMATCH", async () => {
    const res = await eraseCall(rec.U_access, userSubject(ids.userU));
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe("DSAR_TYPE_MISMATCH");
  });

  it("9. borrower erasure is refused by name (S-1): 422 RETENTION_REQUIRED_LOAN_RECORDS, note ids, lead untouched, audited", async () => {
    const before = await leadRow(ids.leadA);
    const res = await eraseCall(rec.B_erase, leadSubject(ids.orgA, ids.leadA));
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe("RETENTION_REQUIRED_LOAN_RECORDS");
    expect(res.body.details.noteIds).toContain(ids.noteA);
    expect(res.body.details.noteIds).not.toContain(ids.noteB);
    expect(await leadRow(ids.leadA)).toEqual(before);
    const audits = await auditRows(rec.B_erase, "dsar.erasure");
    expect(audits.map((a) => a.metadata.outcome)).toContain("RETENTION_REQUIRED_LOAN_RECORDS");
  });

  it("10. legal hold, named: 423 with the REAL caseRef/holdId for an org_wide (user) and a lead_specific (lead) hold", async () => {
    const hBefore = await userRow(ids.userH);
    const h = await eraseCall(rec.H_erase, userSubject(ids.userH));
    expect(h.status).toBe(423);
    expect(h.body.error).toBe("LEGAL_HOLD_ACTIVE");
    expect(h.body.details.caseRef).toBe(ORG_CASE);
    expect(h.body.details.holdId).toBe(ids.holdOrg);
    expect(h.body.details.holdId).not.toBe("(see legal_holds)");
    expect(h.body.details.scope).toBe("org_wide");
    expect(h.body.message).toContain(ORG_CASE);
    expect(await userRow(ids.userH)).toEqual(hBefore);

    const lBefore = await leadRow(ids.leadH);
    const l = await eraseCall(rec.LH_erase, leadSubject(ids.orgLH, ids.leadH));
    expect(l.status).toBe(423);
    expect(l.body.error).toBe("LEGAL_HOLD_ACTIVE");
    expect(l.body.details.caseRef).toBe(LEAD_CASE);
    expect(l.body.details.holdId).toBe(ids.holdLead);
    expect(l.body.details.scope).toBe("lead_specific");
    expect(l.body.message).toContain(LEAD_CASE);
    expect(await leadRow(ids.leadH)).toEqual(lBefore);

    for (const [dsarId, caseRef] of [[rec.H_erase, ORG_CASE], [rec.LH_erase, LEAD_CASE]] as const) {
      const audits = await auditRows(dsarId, "dsar.erasure");
      const refused = audits.filter((a) => a.metadata.outcome === "refused_legal_hold");
      expect(refused.length).toBe(1);
      expect(refused[0].metadata.caseRef).toBe(caseRef);
    }
  });

  it("11. customer-individual erasure: U anonymized, own records gone, org A's assigned lead/task untouched, S-3 surfaced, audit has no email", async () => {
    const leadBefore = await leadRow(ids.leadAssigned);
    const taskBefore = await one(db.select().from(S.tasks).where(drizzle.eq(S.tasks.id, ids.taskAssigned)));

    const res = await eraseCall(rec.U_erase, userSubject(ids.userU));
    expect(res.status).toBe(200);
    expect(res.body.erased).toBe(true);

    expect(await gdpr.isUserDeleted(ids.userU)).toBe(true);
    expect(await count("team_messages", "sender_id", ids.userU)).toBe(0);
    expect(await count("support_tickets", "user_id", ids.userU)).toBe(0);
    expect(await count("ai_conversations", "user_id", ids.userU)).toBe(0);
    // Retained by declaration: the membership row stays.
    expect(await count("team_members", "user_id", ids.userU)).toBe(1);

    // C-5 pins: the org's records assigned to U's team member are unchanged.
    expect(await leadRow(ids.leadAssigned)).toEqual(leadBefore);
    expect(await one(db.select().from(S.tasks).where(drizzle.eq(S.tasks.id, ids.taskAssigned)))).toEqual(taskBefore);
    expect(res.body.report.leadsAnonymized).toBe(0);
    expect(res.body.report.itemsDeleted.tasks).toBe(0);

    expect(res.body.retained.map((r: { domain: string }) => r.domain)).toContain("team_memberships");
    expect(res.body.operatorFollowUps.join(" ")).toMatch(/Clerk/);

    const audits = await auditRows(rec.U_erase, "dsar.erasure");
    const erased = audits.filter((a) => a.metadata.outcome === "erased");
    expect(erased.length).toBe(1);
    expect(erased[0].metadata.subject).toEqual({ kind: "user", userId: ids.userU });
    expect(JSON.stringify(erased[0].metadata)).not.toContain(em("u"));
    expect(JSON.stringify(erased[0].metadata)).not.toMatch(/@example\.test/);
  });

  it("12. non-borrower lead erasure: identity anchor anonymized, consent exhibit retained unchanged", async () => {
    const consentBefore = await db.select().from(S.leadConsentEvents).where(drizzle.eq(S.leadConsentEvents.leadId, ids.leadS));
    expect(consentBefore).toHaveLength(1);

    const res = await eraseCall(rec.S_erase, leadSubject(ids.orgA, ids.leadS));
    expect(res.status).toBe(200);
    const lead = await leadRow(ids.leadS);
    expect(gdpr.isLeadErased({ id: lead.id, email: lead.email })).toBe(true);
    expect(lead.phone).toBeNull();
    expect(lead.doNotContact).toBe(true);
    expect(lead.deletedAt).toBeNull(); // not soft-deleted — the org keeps its record

    const consentAfter = await db.select().from(S.leadConsentEvents).where(drizzle.eq(S.leadConsentEvents.leadId, ids.leadS));
    expect(consentAfter).toEqual(consentBefore);

    const retained = res.body.retained.map((r: { domain: string }) => r.domain);
    expect(retained).toEqual(expect.arrayContaining(["consent_records", "communications"]));

    // The decoy and the borrower are untouched by a seller's erasure in the same org.
    expect((await leadRow(ids.leadA)).email).toBe(em("b"));
    expect((await leadRow(ids.leadB)).email).toBe(em("b"));
  });

  it("13. a second erasure is refused as SUBJECT_ALREADY_ERASED — including through a NEW verified record", async () => {
    const u = await eraseCall(rec.U_erase, userSubject(ids.userU));
    expect(u.status).toBe(422);
    expect(u.body.details.reason).toBe("SUBJECT_ALREADY_ERASED");

    const s = await eraseCall(rec.S_erase, leadSubject(ids.orgA, ids.leadS));
    expect(s.status).toBe(422);
    expect(s.body.details.reason).toBe("SUBJECT_ALREADY_ERASED");

    // A fresh, verified erasure record for U's ORIGINAL email: the subject's
    // own state proves the prior erasure (§3), not the DSAR record.
    const fresh = await newRecord("U_erase2", "erasure", em("u"), true);
    const again = await eraseCall(fresh, userSubject(ids.userU));
    expect(again.status).toBe(422);
    expect(again.body.details.reason).toBe("SUBJECT_ALREADY_ERASED");
    expect(again.body.details.reason).not.toBe("DSAR_SUBJECT_MISMATCH");
  });
});
