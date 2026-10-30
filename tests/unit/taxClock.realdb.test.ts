/**
 * V-Tax-1 T2b — the redemption clock, calendar and gates against a REAL
 * database built from this repository, over HTTP and through the real nightly
 * job. SYNTHETIC data.
 *
 *   - creating a certificate registers its expiry on the tax calendar with
 *     the rule it rests on (AcreOS's preliminary rule, or the county record);
 *   - the clock route cites that rule, counts down, and locks a redeemable deed;
 *   - the nightly job never overwrites a deadline the operator entered, and
 *     re-registers a computed one it corrects;
 *   - inside 30 days the job raises the 30-day alert, and not the 90-day one;
 *   - quiet title cannot open while the deed is redeemable; once a case is
 *     open, an attorney-reviewed exception makes it marketable in AcreOS;
 *   - calendar rows are append-only, and leave with their certificate.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("taxClock.realdb.test.ts");

const h = vi.hoisted(() => ({ org: { id: 0 }, user: { id: "t2b-user" } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/services/certificateEvents", () => ({
  emitCertAcquired: vi.fn(), emitCertRedeemed: vi.fn(), emitCertRedemptionApproaching: vi.fn(async () => undefined), emitCertForeclosureEligible: vi.fn(async () => undefined), certEventRowFrom: (r: unknown) => r,
}));

const tag = `t2b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let app: express.Express;
const today = new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe.runIf(realDbAvailable)("redemption clock, calendar and gates — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as never).returning();
    h.org = { id: org.id };
    const { registerTaxCertificateRoutes } = await import("../../server/routes-tax-certificates");
    const { registerQuietTitleRoutes } = await import("../../server/routes-quiet-title");
    app = express();
    app.use(express.json());
    registerTaxCertificateRoutes(app);
    registerQuietTitleRoutes(app);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM quiet_title_steps WHERE organization_id = ${h.org.id}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM quiet_title_cases WHERE organization_id = ${h.org.id}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM system_alerts WHERE organization_id = ${h.org.id}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM tax_procedure_objects WHERE organization_id = ${h.org.id}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM tax_certificates WHERE organization_id = ${h.org.id}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${h.org.id}`).catch(() => undefined);
    await pool.end();
  });

  const events = async (certId: string) => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    return (await db.execute(sql`SELECT event_type, event_date::text AS event_date, rule_cited, recorded_by FROM tax_events WHERE organization_id = ${h.org.id} AND certificate_id = ${certId} ORDER BY recorded_at`)).rows as Array<Record<string, any>>;
  };

  let gaId = "";
  it("a computed deadline is registered citing AcreOS's preliminary rule; the clock cites it, counts down and locks the redeemable deed", async () => {
    const res = await request(app).post("/api/tax-certificates").send({ state: "GA", county: "SYNTHETIC", apn: `${tag}-GA`, saleType: "redeemable_deed", saleDate: today, purchaseAmountCents: 500_000 });
    expect(res.status).toBe(201);
    gaId = res.body.certificate.id;
    expect(res.body.certificate.deadlineSource).toBe("computed_preliminary");
    const ev = await events(gaId);
    expect(ev).toEqual([expect.objectContaining({ event_type: "redemption_expiry", event_date: res.body.certificate.redemptionDeadline, rule_cited: expect.objectContaining({ kind: "preliminary_state_rule", state: "GA" }) })]);
    const clk = await request(app).get(`/api/tax-certificates/${gaId}/clock`);
    expect(clk.status).toBe(200);
    expect(clk.body).toMatchObject({ phase: "redeemable", deadline: res.body.certificate.redemptionDeadline, lock: { what: "do not improve, do not market" }, marketable: { eligible: false }, capitalTiedUpCents: 500_000 });
    expect(clk.body.deadlineBasis).toMatch(/computed by AcreOS from its encoded GA rule.*preliminary, not attorney-reviewed/);
  });

  it("an entered deadline cites the county record", async () => {
    const res = await request(app).post("/api/tax-certificates").send({ state: "OH", county: "SYNTHETIC", apn: `${tag}-OH`, saleType: "lien", saleDate: "2026-01-01", purchaseAmountCents: 100_000, redemptionDeadline: plusDays(20), redemptionDeadlineSource: "SYNTHETIC county certificate 12" });
    expect(res.status).toBe(201);
    expect((await events(res.body.certificate.id))[0].rule_cited).toEqual({ kind: "county_record", source: "SYNTHETIC county certificate 12" });
    expect((await request(app).get(`/api/tax-certificates/${res.body.certificate.id}/clock`)).body.deadlineBasis).toMatch(/entered from the county's records — SYNTHETIC county certificate 12/);
  });

  it("the nightly job keeps an entered deadline, corrects and re-registers a computed one, and raises only the 30-day alert inside 30 days", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { taxCertificates } = await import("@shared/schema");
    // TX is encoded, so the job WOULD recompute both — but one was entered from the county.
    const [entered] = await db.insert(taxCertificates).values({ organizationId: h.org.id, state: "TX", county: "SYNTHETIC", apn: `${tag}-TX-E`, saleType: "deed", saleDate: "2026-09-01", purchaseAmountCents: 1000, redemptionDeadline: plusDays(20), deadlineSource: "operator_entered" }).returning();
    const [computed] = await db.insert(taxCertificates).values({ organizationId: h.org.id, state: "TX", county: "SYNTHETIC", apn: `${tag}-TX-C`, saleType: "deed", saleDate: "2026-09-01", purchaseAmountCents: 1000, redemptionDeadline: "2026-09-02", deadlineSource: "computed_preliminary" }).returning();
    const { runRedemptionClockRefresh } = await import("../../server/jobs/redemptionClockRefresh");
    await runRedemptionClockRefresh();
    const after = (await db.execute(sql`SELECT apn, redemption_deadline::text AS d FROM tax_certificates WHERE id IN (${entered.id}, ${computed.id})`)).rows as Array<{ apn: string; d: string }>;
    expect(after.find((r) => r.apn.endsWith("TX-E"))!.d).toBe(plusDays(20));
    const fixed = after.find((r) => r.apn.endsWith("TX-C"))!.d;
    expect(fixed).not.toBe("2026-09-02");
    expect((await events(computed.id)).map((e) => [e.event_date, e.recorded_by, e.rule_cited.kind])).toEqual([[fixed, "system:redemption-clock-refresh", "preliminary_state_rule"]]);
    const alerts = (await db.execute(sql`SELECT alert_type FROM system_alerts WHERE organization_id = ${h.org.id} AND message LIKE ${`%${entered.id}%`}`)).rows.map((r: any) => r.alert_type).sort();
    expect(alerts).toContain("redemption_clock_30d");
    expect(alerts).not.toContain("redemption_clock_90d");
  });

  it("quiet title cannot open while redeemable; an attorney-reviewed exception makes the held deed marketable in AcreOS", async () => {
    const early = await request(app).post("/api/quiet-title/cases").send({ certificateId: gaId, deedRecordationDate: today });
    expect(early.status).toBe(422);
    expect(early.body.message).toMatch(/Still redeemable until/);
    const held = await request(app).post("/api/tax-certificates").send({ state: "OH", county: "SYNTHETIC", apn: `${tag}-OH-D`, saleType: "deed", saleDate: "2023-01-01", purchaseAmountCents: 100_000, redemptionDeadline: "2024-01-01", redemptionDeadlineSource: "SYNTHETIC county certificate 13" });
    await request(app).patch(`/api/tax-certificates/${held.body.certificate.id}`).send({ status: "deed_obtained" });
    const qt = await request(app).post("/api/quiet-title/cases").send({ certificateId: held.body.certificate.id, deedRecordationDate: "2024-02-01" });
    expect(qt.status).toBe(201);
    let clk = await request(app).get(`/api/tax-certificates/${held.body.certificate.id}/clock`);
    expect(clk.body).toMatchObject({ phase: "deed_held", marketable: { eligible: false }, lock: { until: "the quiet-title filing" } });
    expect((await request(app).post(`/api/quiet-title/cases/${qt.body.case.id}/market-exception`).send({ attorneyName: "SYNTHETIC Esq.", reason: "short" })).status).toBe(422);
    expect((await request(app).post(`/api/quiet-title/cases/${qt.body.case.id}/market-exception`).send({ attorneyName: "SYNTHETIC Esq.", reason: "the title insurer will insure without the filing" })).status).toBe(200);
    clk = await request(app).get(`/api/tax-certificates/${held.body.certificate.id}/clock`);
    expect(clk.body).toMatchObject({ marketable: { eligible: true, reason: expect.stringMatching(/attorney-reviewed exception \(SYNTHETIC Esq\.\)/) }, lock: null });
  });

  // Audit 2026-10-29 (fix 1): PATCH status -> deed_obtained while redeemable,
  // then open a case, used to pass the gate and lift the lock.
  it("a redeemable certificate cannot be PATCHed to a held deed, and a case still cannot open on it", async () => {
    for (const status of ["deed_obtained", "expired_to_deed"]) {
      const p = await request(app).patch(`/api/tax-certificates/${gaId}`).send({ status });
      expect(p.status).toBe(422);
      expect(p.body.message).toMatch(/Still redeemable until .*The deed is not held until redemption has expired/);
    }
    const qt = await request(app).post("/api/quiet-title/cases").send({ certificateId: gaId, deedRecordationDate: today });
    expect(qt.status).toBe(422);
    expect((await request(app).get(`/api/tax-certificates/${gaId}/clock`)).body).toMatchObject({ phase: "redeemable", marketable: { eligible: false } });
  });

  it("the case gate checks the date whatever the status says", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const res = await request(app).post("/api/tax-certificates").send({ state: "GA", county: "SYNTHETIC", apn: `${tag}-GA-S`, saleType: "redeemable_deed", saleDate: today, purchaseAmountCents: 1000 });
    await db.execute(sql`UPDATE tax_certificates SET status = 'deed_obtained' WHERE id = ${res.body.certificate.id}`);
    const qt = await request(app).post("/api/quiet-title/cases").send({ certificateId: res.body.certificate.id, deedRecordationDate: today });
    expect(qt.status).toBe(422);
    expect(qt.body.message).toMatch(/Still redeemable until/);
  });

  // Fix 2: the quiet_title_filed calendar leg is written, not just declared.
  it("completing the petition filing puts it on the calendar citing the case, lifts the lock, and cannot be taken back", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const held = await request(app).post("/api/tax-certificates").send({ state: "OH", county: "SYNTHETIC", apn: `${tag}-OH-F`, saleType: "deed", saleDate: "2023-01-01", purchaseAmountCents: 100_000, redemptionDeadline: "2024-01-01", redemptionDeadlineSource: "SYNTHETIC county certificate 14" });
    const certId = held.body.certificate.id;
    expect((await request(app).patch(`/api/tax-certificates/${certId}`).send({ status: "deed_obtained" })).status).toBe(200);
    const qt = await request(app).post("/api/quiet-title/cases").send({ certificateId: certId, deedRecordationDate: "2024-02-01" });
    expect(qt.status).toBe(201);
    const [step] = (await db.execute(sql`SELECT id FROM quiet_title_steps WHERE case_id = ${qt.body.case.id} AND step_key = 'petition_filed'`)).rows as Array<{ id: string }>;
    const done = await request(app).patch(`/api/quiet-title/steps/${step.id}`).send({ completed: true });
    expect(done.status).toBe(200);
    const filed = (await events(certId)).filter((e) => e.event_type === "quiet_title_filed");
    expect(filed).toEqual([expect.objectContaining({ event_date: today, recorded_by: h.user.id, rule_cited: { kind: "county_record", source: expect.stringContaining(`quiet-title case ${qt.body.case.id}`) } })]);
    expect((await request(app).get(`/api/tax-certificates/${certId}/clock`)).body).toMatchObject({ phase: "deed_held", marketable: { eligible: true }, lock: null });
    // Completing again is a no-op on the calendar; un-filing is refused.
    expect((await request(app).patch(`/api/quiet-title/steps/${step.id}`).send({ completed: true })).status).toBe(200);
    expect((await events(certId)).filter((e) => e.event_type === "quiet_title_filed")).toHaveLength(1);
    const undo = await request(app).patch(`/api/quiet-title/steps/${step.id}`).send({ completed: false });
    expect(undo.status).toBe(422);
    expect(undo.body.message).toMatch(/cannot be taken back/);
  });

  it("the petition filing is refused on a certificate still redeemable, even when a case exists", async () => {
    const { db } = await import("../../server/db");
    const res = await request(app).post("/api/tax-certificates").send({ state: "GA", county: "SYNTHETIC", apn: `${tag}-GA-P`, saleType: "redeemable_deed", saleDate: today, purchaseAmountCents: 1000 });
    const certId = res.body.certificate.id;
    // A case that predates the gate (or was made by any other path): the
    // filing re-checks the certificate on its own.
    const { noteQuietTitleCases, quietTitleSteps } = await import("@shared/schema");
    const [c] = await db.insert(noteQuietTitleCases).values({ organizationId: h.org.id, certificateId: certId, state: "GA", county: "SYNTHETIC", apn: `${tag}-GA-P`, deedRecordationDate: today }).returning({ id: noteQuietTitleCases.id });
    const [s] = await db.insert(quietTitleSteps).values({ organizationId: h.org.id, caseId: c.id, stepKey: "petition_filed" }).returning({ id: quietTitleSteps.id });
    const r = await request(app).patch(`/api/quiet-title/steps/${s.id}`).send({ completed: true });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/Still redeemable until/);
    expect((await events(certId)).filter((e) => e.event_type === "quiet_title_filed")).toEqual([]);
  });

  it("a computed deadline that the county's verified procedure states cites the procedure object", async () => {
    const { recordProcedureVersion, recordCountyVerification } = await import("../../server/services/tax/taxProcedures");
    const { STATE_REDEMPTION_RULES } = await import("../../server/services/redemptionClock");
    const county = `SYN-${tag}`;
    const field = <T,>(value: T) => ({ value, source: "SYNTHETIC county procedure §4", asOf: today, basis: "state_law" as const, verification: "confirmed_with_county" as const });
    const fields = { instrument: field("deed" as never), bidMethod: field("premium bid"), returnModel: field("penalty" as never), redemptionPeriodMonths: field(STATE_REDEMPTION_RULES.GA.redemptionPeriodMonths) };
    // Unverified: the date stays on AcreOS's preliminary rule.
    await recordProcedureVersion(h.org.id, h.user.id, "GA", county, fields as never);
    const before = await request(app).post("/api/tax-certificates").send({ state: "GA", county, apn: `${tag}-GA-V0`, saleType: "redeemable_deed", saleDate: today, purchaseAmountCents: 1000 });
    expect((await events(before.body.certificate.id))[0].rule_cited.kind).toBe("preliminary_state_rule");
    const verified = await recordCountyVerification(h.org.id, h.user.id, "GA", county, { completedOn: today, method: "SYNTHETIC call to the county treasurer" });
    const res = await request(app).post("/api/tax-certificates").send({ state: "GA", county, apn: `${tag}-GA-V1`, saleType: "redeemable_deed", saleDate: today, purchaseAmountCents: 1000 });
    expect((await events(res.body.certificate.id))[0].rule_cited).toEqual({ kind: "procedure_object", procedureId: verified!.id, version: verified!.version, field: "redemptionPeriodMonths", source: "SYNTHETIC county procedure §4", asOf: today });
    expect((await request(app).get(`/api/tax-certificates/${res.body.certificate.id}/clock`)).body.deadlineBasis).toMatch(new RegExp(`the county procedure, version ${verified!.version} — SYNTHETIC county procedure §4`));
  });

  it("calendar rows are append-only and leave with their certificate", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const codeOf = (q: Promise<unknown>) => q.then(() => null, (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code);
    expect(await codeOf(db.execute(sql`UPDATE tax_events SET event_date = '2099-01-01' WHERE certificate_id = ${gaId}`))).toBe("23001");
    expect(await codeOf(db.execute(sql`DELETE FROM tax_events WHERE certificate_id = ${gaId}`))).toBe("23503");
    await db.execute(sql`DELETE FROM tax_certificates WHERE id = ${gaId}`);
    expect(await events(gaId)).toEqual([]);
  });
});
