/**
 * orgHasMadeAnOffer on a REAL Postgres (skips without ACREOS_REAL_DATABASE_URL).
 * Offers that count, offers that do not, sample lineage, soft-delete, org scope.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("firstOffer.realdb.test.ts");
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `fo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const orgs: number[] = [];

describe.runIf(realDbAvailable)("first offer (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  const mkOrg = async (n: string) => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const o = (await db.insert(organizations).values({ name: `${tag}${n}`, slug: `${tag}${n}`, ownerId: `${tag}${n}` } as any).returning())[0];
    orgs.push(o.id);
    return o.id;
  };
  const prop = async (org: number, apn: string, status = "prospect") => {
    const { db } = await import("../../server/db");
    const { properties } = await import("@shared/schema");
    return (await db.insert(properties).values({ organizationId: org, apn, county: "X", state: "TX", sizeAcres: "1", status } as any).returning())[0].id;
  };
  const deal = async (org: number, propertyId: number, status: string, extra: Record<string, unknown> = {}) => {
    const { db } = await import("../../server/db");
    const { deals } = await import("@shared/schema");
    return (await db.insert(deals).values({ organizationId: org, propertyId, type: "acquisition", status, ...extra } as any).returning())[0].id;
  };
  const offer = async (org: number, status: string, extra: Record<string, unknown> = {}) => {
    const { db } = await import("../../server/db");
    const { offers } = await import("@shared/schema");
    await db.insert(offers).values({ organizationId: org, status, ...extra } as any);
  };
  const made = async (org: number) => (await import("../../server/services/growth/firstOffer")).orgHasMadeAnOffer(org);

  afterAll(async () => {
    const { db } = await import("../../server/db");
    const { eq } = await import("drizzle-orm");
    const s = await import("@shared/schema");
    for (const o of orgs) {
      await db.delete(s.offers).where(eq(s.offers.organizationId, o)).catch(() => undefined);
      await db.delete(s.deals).where(eq(s.deals.organizationId, o)).catch(() => undefined);
      await db.delete(s.properties).where(eq(s.properties.organizationId, o)).catch(() => undefined);
      await db.delete(s.leads).where(eq(s.leads.organizationId, o)).catch(() => undefined);
      await db.delete(s.organizations).where(eq(s.organizations.id, o)).catch(() => undefined);
    }
  });

  it("a brand-new org has made no offer", async () => {
    expect(await made(await mkOrg("a"))).toBe(false);
  });

  it("deals: offer_sent and later count; negotiating and cancelled do not; soft-deleted do not", async () => {
    const o = await mkOrg("b");
    const p = await prop(o, `REAL-${tag}-1`);
    await deal(o, p, "negotiating");
    await deal(o, p, "cancelled");
    await deal(o, p, "offer_sent", { deletedAt: new Date() });
    expect(await made(o)).toBe(false);
    await deal(o, p, "offer_sent");
    expect(await made(o)).toBe(true);
  });

  it("offers rows: draft and approved do not count, sent does", async () => {
    const o = await mkOrg("c");
    await offer(o, "draft");
    await offer(o, "approved");
    expect(await made(o)).toBe(false);
    await offer(o, "sent");
    expect(await made(o)).toBe(true);
  });

  it("parcels: only offer_sent / under_contract count", async () => {
    const o = await mkOrg("d");
    await prop(o, `REAL-${tag}-2`, "prospect");
    await prop(o, `REAL-${tag}-3`, "owned");
    expect(await made(o)).toBe(false);
    await prop(o, `REAL-${tag}-4`, "offer_sent");
    expect(await made(o)).toBe(true);
  });

  it("the sample book is not the customer's first offer", async () => {
    const o = await mkOrg("e");
    const sp = await prop(o, `SAMPLE-${tag}`, "offer_sent");
    await deal(o, sp, "offer_sent");
    expect(await made(o)).toBe(false);
  });

  it("another org's offer is not this org's", async () => {
    const a = await mkOrg("f");
    const b = await mkOrg("g");
    await offer(b, "sent");
    expect(await made(a)).toBe(false);
    expect(await made(b)).toBe(true);
  });
});
