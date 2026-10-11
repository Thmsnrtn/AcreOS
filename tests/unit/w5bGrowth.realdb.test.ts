/**
 * W5b growth on a REAL Postgres built from this repository (skips without
 * ACREOS_REAL_DATABASE_URL; required where CI builds a schema).
 *
 *   IMPORT ORG-SCOPING — a batch belongs to one org: another org cannot record
 *     into it, list it, or undo it; undo removes only this batch's untouched
 *     leads and keeps (and names) the ones that became work; the suppression
 *     hook reads only this org's opted-out owners.
 *   A2P — one org's approved registration does not confirm another org's.
 *   OUTCOME — computed from the org's own closed deals: sample-book and
 *     deleted deals are not outcomes; a missing purchase price refuses.
 *   FIRST DEAL — the step follows the org's real rows.
 *   OUTREACH LANGUAGE — the one writer is org-scoped.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("w5bGrowth.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `w5b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = { a: 0, b: 0, c: 0 };

describe.runIf(realDbAvailable)("W5b growth (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    ids.a = (await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-a` } as any).returning())[0].id;
    ids.b = (await db.insert(organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-b` } as any).returning())[0].id;
    ids.c = (await db.insert(organizations).values({ name: `${tag}-c`, slug: `${tag}-c`, ownerId: `${tag}-c` } as any).returning())[0].id;
  });

  afterAll(async () => {
    const { db } = await import("../../server/db");
    const { eq } = await import("drizzle-orm");
    const s = await import("@shared/schema");
    for (const org of [ids.a, ids.b, ids.c].filter(Boolean)) {
      await db.delete(s.deals).where(eq(s.deals.organizationId, org)).catch(() => undefined);
      await db.delete(s.notes).where(eq(s.notes.organizationId, org)).catch(() => undefined);
      await db.delete(s.properties).where(eq(s.properties.organizationId, org)).catch(() => undefined);
      await db.delete(s.leadImportBatches).where(eq(s.leadImportBatches.organizationId, org)).catch(() => undefined);
      await db.delete(s.smsA2pRegistrations).where(eq(s.smsA2pRegistrations.organizationId, org)).catch(() => undefined);
      await db.delete(s.activityLog).where(eq(s.activityLog.organizationId, org)).catch(() => undefined);
      await db.delete(s.leads).where(eq(s.leads.organizationId, org)).catch(() => undefined);
      await db.delete(s.organizations).where(eq(s.organizations.id, org));
    }
  });

  const lead = async (org: number, extra: Record<string, unknown> = {}) => {
    const { db } = await import("../../server/db");
    const { leads } = await import("@shared/schema");
    return (await db.insert(leads).values({ organizationId: org, firstName: "L", lastName: tag, ...extra } as any).returning())[0];
  };
  const reload = async (id: number) => {
    const { db } = await import("../../server/db");
    const { leads } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    return (await db.select().from(leads).where(eq(leads.id, id)))[0];
  };

  it("an import batch is invisible and inert to another org", async () => {
    const svc = await import("../../server/services/leads/importBatches");
    const batch = await svc.createImportBatch(ids.a, "u-a", { sourceFormat: "mapped", fileName: "a.csv", rowCount: 2 });
    expect(await svc.getOpenImportBatch(ids.b, batch.id)).toBeNull();
    expect((await svc.listImportBatches(ids.b)).some((x) => x.id === batch.id)).toBe(false);
    expect(await svc.undoImportBatch(ids.b, batch.id, "u-b")).toEqual({ ok: false, reason: "not_found" });
    // A record from org B into A's batch id writes nothing.
    await svc.recordImportIntoBatch(ids.b, batch.id, { leadIds: [999999], imported: 1, skipped: 0, suppressed: 0 });
    const still = await svc.getOpenImportBatch(ids.a, batch.id);
    expect(still?.leadIds).toEqual([]);
    expect(still?.importedCount).toBe(0);
  });

  it("undo removes only the batch's untouched leads and names what it kept", async () => {
    const svc = await import("../../server/services/leads/importBatches");
    const fresh = await lead(ids.a);
    const worked = await lead(ids.a, { status: "responded" });
    const contacted = await lead(ids.a, { lastContactedAt: new Date() });
    const outsider = await lead(ids.b); // another org's id smuggled into the list
    const batch = await svc.createImportBatch(ids.a, "u-a", { sourceFormat: "regrid_parcels", fileName: "r.csv", rowCount: 4 });
    await svc.recordImportIntoBatch(ids.a, batch.id, { leadIds: [fresh.id, worked.id, contacted.id, outsider.id], imported: 4, skipped: 0, suppressed: 0 });
    const out = await svc.undoImportBatch(ids.a, batch.id, "u-a");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.removed).toBe(1);
      expect(out.kept.map((k) => k.leadId).sort()).toEqual([worked.id, contacted.id].sort());
    }
    expect((await reload(fresh.id)).deletedAt).not.toBeNull();
    expect((await reload(worked.id)).deletedAt).toBeNull();
    expect((await reload(outsider.id)).deletedAt).toBeNull(); // never touched across the tenant line
    expect(await svc.undoImportBatch(ids.a, batch.id, "u-a")).toEqual({ ok: false, reason: "already_undone" });
  });

  it("the suppression hook reads only this org's opted-out owners", async () => {
    const { loadOutreachSuppression } = await import("../../server/services/leads/importSuppressionHook");
    await lead(ids.b, { phone: "+1 (512) 555-0177", doNotContact: true, email: `${tag}-stop@example.com` });
    await lead(ids.a, { address: "9 Elm St", zip: "73301-0001", optOutDate: new Date() });
    const forA = await loadOutreachSuppression(ids.a);
    expect(forA({ phone: "5125550177" }).suppressed).toBe(false); // org B's STOP does not reach org A
    expect(forA({ address: "9  ELM st", zip: "73301" }).suppressed).toBe(true);
    const forB = await loadOutreachSuppression(ids.b);
    expect(forB({ phone: "512-555-0177" }).suppressed).toBe(true);
    expect(forB({ email: `${tag.toUpperCase()}-STOP@EXAMPLE.COM`.toLowerCase() }).suppressed).toBe(true);
  });

  it("A2P: org A's approved registration does not confirm org B", async () => {
    const { db } = await import("../../server/db");
    const { smsA2pRegistrations } = await import("@shared/schema");
    await db.insert(smsA2pRegistrations).values({
      organizationId: ids.a,
      provider: "twilio",
      numberKind: "10dlc",
      phoneNumber: "+15125550100",
      brandStatus: "approved",
      campaignStatus: "approved",
      statusSource: "provider_api",
      checkedAt: new Date(),
    });
    const { a2pGateForSms, getA2pRegistration } = await import("../../server/services/sms/a2pRegistration");
    expect((await getA2pRegistration(ids.a))?.brandStatus).toBe("approved");
    expect(await getA2pRegistration(ids.b)).toBeNull();
    expect((await a2pGateForSms(ids.b)).allowed).toBe(false);
  });

  it("A2P self-report is stored and labelled self-reported", async () => {
    const { selfReportA2p } = await import("../../server/services/sms/a2pRegistration");
    const out = await selfReportA2p(ids.b, "u-b", { provider: "Telnyx", phoneNumber: "+1 737 555 0100", brandStatus: "approved", campaignStatus: "pending" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.registration.statusSource).toBe("self_reported");
  });

  it("outcome: own closed deals only; sample and deleted deals are not outcomes; a missing basis refuses", async () => {
    const { db } = await import("../../server/db");
    const { properties, deals } = await import("@shared/schema");
    const prop = async (org: number, extra: Record<string, unknown>) =>
      (await db.insert(properties).values({ organizationId: org, county: "Travis", state: "TX", sizeAcres: "5", ...extra } as any).returning())[0];
    const p1 = await prop(ids.a, { apn: `${tag}-1`, purchasePrice: "5000" });
    const sample = await prop(ids.a, { apn: `SAMPLE-${tag}`, purchasePrice: "1" });
    const p3 = await prop(ids.b, { apn: `${tag}-3` }); // org B, no purchase price
    await db.insert(deals).values([
      { organizationId: ids.a, propertyId: p1.id, type: "disposition", status: "closed", acceptedAmount: "15000", closingCosts: "500" },
      { organizationId: ids.a, propertyId: sample.id, type: "disposition", status: "closed", acceptedAmount: "999999" },
      { organizationId: ids.a, propertyId: p1.id, type: "disposition", status: "closed", acceptedAmount: "777777", deletedAt: new Date() },
      { organizationId: ids.a, propertyId: p1.id, type: "acquisition", status: "negotiating", acceptedAmount: "1" },
      { organizationId: ids.b, propertyId: p3.id, type: "disposition", status: "closed", acceptedAmount: "8000" },
    ] as any);
    const { customerOutcomeForOrg } = await import("../../server/services/growth/customerOutcome");
    const a = await customerOutcomeForOrg(ids.a);
    expect(a.dealsClosed.total).toBe(1);
    expect(a.realisedProfit).toEqual({ status: "shown", cents: 1500000 - 500000 - 50000, salesCounted: 1 });
    const b = await customerOutcomeForOrg(ids.b);
    expect(b.realisedProfit.status).toBe("refused");
  });

  it("outcome: Settings → Add Demo Data is not an outcome, for the org or in the founder aggregate", async () => {
    // The demo seeder's two CLOSED acquisitions used to be unmarked rows, so
    // they counted as this org's closings and in the founder Letter's
    // cross-customer total. Runs the REAL seeder, then the REAL metric.
    const { customerOutcomeForOrg, platformCustomerOutcomes } = await import("../../server/services/growth/customerOutcome");
    const { seedDemoDataForOrg } = await import("../../server/services/onboarding/demoDataSeeder");
    const before = await platformCustomerOutcomes();
    const counts = await seedDemoDataForOrg(ids.c);
    expect(counts.deals).toBeGreaterThan(0);

    const { db } = await import("../../server/db");
    const s = await import("@shared/schema");
    const { and, eq, inArray } = await import("drizzle-orm");
    const closed = await db.select({ id: s.deals.id }).from(s.deals).where(and(eq(s.deals.organizationId, ids.c), inArray(s.deals.status, ["closed"])));
    expect(closed.length).toBeGreaterThan(0); // the seeder really did make closed deals

    const c = await customerOutcomeForOrg(ids.c);
    expect(c.dealsClosed.total).toBe(0);
    const after = await platformCustomerOutcomes();
    expect(after.orgsWithAClosedDeal).toBe(before.orgsWithAClosedDeal);
    expect(after.dealsClosed).toBe(before.dealsClosed);

    const { realLead } = await import("../../server/services/onboarding/sampleFilters");
    const real = await db.select({ id: s.leads.id }).from(s.leads).where(and(eq(s.leads.organizationId, ids.c), realLead()));
    expect(real).toEqual([]);
  });

  it("outcome: a founder (AcreOS's own) org's closed deal is not a customer outcome in the founder aggregate", async () => {
    const { db } = await import("../../server/db");
    const s = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { platformCustomerOutcomes } = await import("../../server/services/growth/customerOutcome");
    const before = await platformCustomerOutcomes();
    const [p] = await db.insert(s.properties).values({ organizationId: ids.c, county: "Travis", state: "TX", sizeAcres: "5", apn: `${tag}-founder`, purchasePrice: "1000" } as any).returning();
    await db.insert(s.deals).values({ organizationId: ids.c, propertyId: p.id, type: "disposition", status: "closed", acceptedAmount: "3000" } as any);
    // As a customer org, the closing counts...
    expect((await platformCustomerOutcomes()).dealsClosed).toBe(before.dealsClosed + 1);
    // ...as AcreOS's own org, it does not.
    await db.update(s.organizations).set({ isFounder: true }).where(eq(s.organizations.id, ids.c));
    try {
      expect((await platformCustomerOutcomes()).dealsClosed).toBe(before.dealsClosed);
    } finally {
      await db.update(s.organizations).set({ isFounder: false }).where(eq(s.organizations.id, ids.c));
    }
  });

  it("first deal: the step follows this org's rows", async () => {
    const { firstDealStepForOrg } = await import("../../server/services/growth/firstDealProgram");
    const s = await firstDealStepForOrg(ids.a);
    expect(s).not.toBeNull();
    expect(s!.evidence.leads).toBeGreaterThan(0);
    expect(s!.evidence.closedDeals).toBe(1); // the sample and deleted closings are not counted
    expect(s!.step).toBe("done");
  });
});
