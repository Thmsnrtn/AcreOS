/**
 * Founder decision 2026-10-17 B, against a real Postgres: house mail is paid
 * ONLY from PURCHASED credits, pre-paid atomically, and never twice.
 *
 * What a mock cannot evaluate is the SQL: the grant exclusion lives in the
 * conditional UPDATE's WHERE (balance − every granted credit ≥ charge), the
 * idempotency in the ledger's unique external_event_id, the atomicity in one
 * transaction, and "the monthly pool never pays" in the pool sum's
 * posted_by filter. This runs chargeHouseMail / refundUnbilledHouseMail /
 * poolSnapshot on the real database; nothing in the money path is stubbed.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("houseMailPurchasedOnly.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `hmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const orgIds: number[] = [];

/** A house lane for a 4x6 postcard at 75 credits — the shape resolveMailLane returns. */
function lane(creditsPerPiece = 75): any {
  return {
    lane: "house",
    provider: "lob",
    spec: { kind: "postcard", size: "4x6" },
    price: { key: "postcard_4x6", label: "4×6 postcard", providerCostCents: 75, listedCredits: 75, creditsPerPiece, raisedToFloor: false },
    creditsPerPiece,
    senderIdentity: {},
  };
}

async function makeOrg(opts: { tier?: string; purchased?: number; granted?: number; grantType?: string }) {
  const { db } = await import("../../server/db");
  const { organizations, creditTransactions } = await import("@shared/schema");
  const purchased = opts.purchased ?? 0;
  const granted = opts.granted ?? 0;
  const slug = `${tag}-${orgIds.length}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: slug, slug, ownerId: `${slug}-owner`, subscriptionTier: opts.tier ?? "pro", creditBalance: String(purchased + granted) } as any)
    .returning();
  orgIds.push(org.id);
  if (purchased > 0) {
    await db.insert(creditTransactions).values({ organizationId: org.id, type: "purchase", amountCents: purchased, balanceAfterCents: purchased, description: "pack" });
  }
  if (granted > 0) {
    await db.insert(creditTransactions).values({
      organizationId: org.id,
      type: opts.grantType ?? "support_credit",
      amountCents: granted,
      balanceAfterCents: purchased + granted,
      description: "courtesy",
    });
  }
  return org.id as number;
}

async function balance(orgId: number): Promise<number> {
  const { db } = await import("../../server/db");
  const { organizations } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select({ b: organizations.creditBalance }).from(organizations).where(eq(organizations.id, orgId));
  return Number(row.b);
}

async function ledgerRows(orgId: number) {
  const { db } = await import("../../server/db");
  const { financialLedger } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(financialLedger).where(eq(financialLedger.organizationId, orgId));
}

describe.runIf(realDbAvailable)("house mail is paid from purchased credits only (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    await import("../../server/db");
  });

  afterAll(async () => {
    if (orgIds.length === 0) return;
    const { db } = await import("../../server/db");
    const { organizations, creditTransactions, financialLedger } = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");
    await db.delete(financialLedger).where(inArray(financialLedger.organizationId, orgIds));
    await db.delete(creditTransactions).where(inArray(creditTransactions.organizationId, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  });

  it("granted credits in the same balance are not spendable on house mail", async () => {
    const { purchasedCreditsAvailable } = await import("../../server/services/mail/mailLane");
    const org = await makeOrg({ purchased: 200, granted: 100 });
    expect(await balance(org)).toBe(300);
    expect(await purchasedCreditsAvailable(org)).toBe(200);

    const unknownGrant = await makeOrg({ purchased: 50, granted: 500, grantType: "bonus" });
    expect(await purchasedCreditsAvailable(unknownGrant)).toBe(50);
  });

  it("a charge the PURCHASED credits cover is taken in full, with its ledger claim and debit row", async () => {
    const { chargeHouseMail, purchasedCreditsAvailable } = await import("../../server/services/mail/mailLane");
    const org = await makeOrg({ purchased: 200, granted: 100 });
    const charge = await chargeHouseMail({ organizationId: org, lane: lane(), units: 2, externalEventId: `${tag}:a:${org}` });
    expect(charge).toMatchObject({ debitedCents: 150, units: 2, replay: false });
    expect(await balance(org)).toBe(150);
    expect(await purchasedCreditsAvailable(org)).toBe(50);
    const rows = await ledgerRows(org);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(-150);
    expect(rows[0].postedBy).toMatch(/:purchased-overflow$/);
  });

  it("refused when only GRANTED credits could pay — and nothing is written", async () => {
    const { chargeHouseMail, isHouseMailShort } = await import("../../server/services/mail/mailLane");
    const org = await makeOrg({ purchased: 50, granted: 1000 });
    const err = await chargeHouseMail({ organizationId: org, lane: lane(), externalEventId: `${tag}:b:${org}` }).catch((e) => e);
    expect(isHouseMailShort(err)).toBe(true);
    expect(await balance(org)).toBe(1050);
    expect(await ledgerRows(org)).toEqual([]); // the claim rolled back with the refusal
  });

  it("the monthly credit pool never pays: a paid-tier org with a full pool and no purchased credits is refused", async () => {
    const { chargeHouseMail, isHouseMailShort } = await import("../../server/services/mail/mailLane");
    const { poolSnapshot } = await import("../../server/services/creditPool");
    const org = await makeOrg({ tier: "scale", purchased: 0 });
    const before = await poolSnapshot(org);
    expect(before.remaining).toBeGreaterThan(75); // the pool COULD have paid
    const err = await chargeHouseMail({ organizationId: org, lane: lane(), externalEventId: `${tag}:c:${org}` }).catch((e) => e);
    expect(isHouseMailShort(err)).toBe(true);
    expect((await poolSnapshot(org)).used).toBe(before.used);
  });

  it("a house charge is not pool usage", async () => {
    const { chargeHouseMail } = await import("../../server/services/mail/mailLane");
    const { poolSnapshot } = await import("../../server/services/creditPool");
    const org = await makeOrg({ purchased: 300 });
    await chargeHouseMail({ organizationId: org, lane: lane(), units: 3, externalEventId: `${tag}:d:${org}` });
    expect((await poolSnapshot(org)).used).toBe(0);
  });

  it("a retry with the same key is charged nothing (replay)", async () => {
    const { chargeHouseMail } = await import("../../server/services/mail/mailLane");
    const org = await makeOrg({ purchased: 300 });
    const key = `${tag}:e:${org}`;
    await chargeHouseMail({ organizationId: org, lane: lane(), externalEventId: key });
    const replay = await chargeHouseMail({ organizationId: org, lane: lane(), externalEventId: key });
    expect(replay).toMatchObject({ replay: true, debitedCents: 75 });
    expect(await balance(org)).toBe(225);
  });

  it("concurrent charges cannot overspend the purchased balance (atomic)", async () => {
    const { chargeHouseMail } = await import("../../server/services/mail/mailLane");
    const org = await makeOrg({ purchased: 200, granted: 500 });
    const results = await Promise.allSettled([
      chargeHouseMail({ organizationId: org, lane: lane(), units: 2, externalEventId: `${tag}:f1:${org}` }),
      chargeHouseMail({ organizationId: org, lane: lane(), units: 2, externalEventId: `${tag}:f2:${org}` }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(org)).toBe(700 - 150);
  });

  it("refunds return credits ONLY for a piece the provider did not bill", async () => {
    const { chargeHouseMail, refundUnbilledHouseMail, purchasedCreditsAvailable } = await import("../../server/services/mail/mailLane");
    const org = await makeOrg({ purchased: 300 });
    const charge = await chargeHouseMail({ organizationId: org, lane: lane(), units: 2, externalEventId: `${tag}:g:${org}` });
    expect(await balance(org)).toBe(150);

    // Unknown outcome (a Lob 500): the charge stands.
    const kept = await refundUnbilledHouseMail(org, charge, Object.assign(new Error("lob 500"), { status_code: 500 }), "unknown", {
      amountCents: 75,
      refundKey: `${charge.externalEventId}:p1:refund`,
    });
    expect(kept).toBe(false);
    expect(await balance(org)).toBe(150);

    // A rejection: one piece returned, as purchased credit again.
    const returned = await refundUnbilledHouseMail(org, charge, Object.assign(new Error("invalid"), { status_code: 422 }), "rejected", {
      amountCents: 75,
      refundKey: `${charge.externalEventId}:p2:refund`,
    });
    expect(returned).toBe(true);
    expect(await balance(org)).toBe(225);
    expect(await purchasedCreditsAvailable(org)).toBe(225);
  });
});
