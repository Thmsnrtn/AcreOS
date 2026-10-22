/**
 * The default chart of accounts is seeded once per org, however many times or
 * however concurrently seeding runs, and an org with no chart gets one at the
 * GL's first use. Against a REAL database, because the guarantees rest on the
 * unique index chart_of_accounts_org_number_unique and on ON CONFLICT, which
 * no mock evaluates.
 *
 * WHY (G4 money-lifecycle run, staging, 2026-10-21): chart_of_accounts was
 * empty for every org, because the seed's only caller was
 * storage.createOrganization and the real signup path never calls it. Every
 * recognition GL post threw "has no 1000 (Cash) account".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("chartOfAccountsSeedIsIdempotent.db");

describe.runIf(realDbAvailable)("default chart of accounts — real database", () => {
  let db: typeof import("../../server/db").db;
  let schema: typeof import("../../shared/schema");
  const orgIds: number[] = [];
  const tag = `coa-${Date.now()}`;

  async function newOrg(suffix: string): Promise<number> {
    const [o] = await db
      .insert(schema.organizations)
      .values({ name: `${tag}-${suffix}`, slug: `${tag}-${suffix}`, ownerId: `${tag}-owner-${suffix}` })
      .returning();
    orgIds.push(o.id);
    return o.id;
  }
  async function accountsOf(orgId: number) {
    return db.select().from(schema.chartOfAccounts).where(eq(schema.chartOfAccounts.organizationId, orgId));
  }

  beforeAll(async () => {
    db = (await import("../../server/db")).db;
    schema = await import("../../shared/schema");
  });

  afterAll(async () => {
    if (!orgIds.length) return;
    await db.delete(schema.accountLedgerEntries).where(inArray(schema.accountLedgerEntries.organizationId, orgIds));
    await db.delete(schema.chartOfAccounts).where(inArray(schema.chartOfAccounts.organizationId, orgIds));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, orgIds));
  });

  it("(c) a second seed creates no duplicates", async () => {
    const { seedChartOfAccountsForOrg, DEFAULT_CHART_OF_ACCOUNTS } = await import("../../server/services/chartOfAccountsSeed");
    const orgId = await newOrg("twice");
    expect(await seedChartOfAccountsForOrg(orgId)).toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
    expect(await seedChartOfAccountsForOrg(orgId)).toBe(0);
    const rows = await accountsOf(orgId);
    expect(rows).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    expect(new Set(rows.map((r) => r.accountNumber)).size).toBe(rows.length);
  });

  it("(c) concurrent seeds racing past the count check still yield one chart, and none throws", async () => {
    const { seedChartOfAccountsForOrg, DEFAULT_CHART_OF_ACCOUNTS } = await import("../../server/services/chartOfAccountsSeed");
    const orgId = await newOrg("race");
    const created = await Promise.all([1, 2, 3, 4].map(() => seedChartOfAccountsForOrg(orgId)));
    expect(created.reduce((a, b) => a + b, 0)).toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
    expect(await accountsOf(orgId)).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
  });

  it("a custom chart is never topped up with defaults", async () => {
    const { seedChartOfAccountsForOrg } = await import("../../server/services/chartOfAccountsSeed");
    const orgId = await newOrg("custom");
    await db.insert(schema.chartOfAccounts).values({ organizationId: orgId, accountNumber: "9999", accountName: "Custom", accountType: "asset" });
    expect(await seedChartOfAccountsForOrg(orgId)).toBe(0);
    expect(await accountsOf(orgId)).toHaveLength(1);
  });

  it("the GL refund post on an org with NO chart seeds it and posts the balanced pair (what staging lacked)", async () => {
    const { recordStripeChargeRefunded } = await import("../../server/services/recognitionWorker");
    const orgId = await newOrg("gl");
    expect(await accountsOf(orgId)).toHaveLength(0);
    const out = await recordStripeChargeRefunded({
      chargeId: `ch_${tag}`,
      organizationId: orgId,
      amountRefundedCents: 4900,
      refundedAt: new Date("2026-10-21T00:00:00Z").toISOString(),
      description: "test refund",
    });
    expect(out).toEqual({ posted: true, legs: 2 });
    const legs = await db
      .select()
      .from(schema.accountLedgerEntries)
      .where(and(eq(schema.accountLedgerEntries.organizationId, orgId), eq(schema.accountLedgerEntries.referenceId, `charge.refunded:ch_${tag}`)));
    expect(legs).toHaveLength(2);
    // Redelivery is idempotent.
    expect(await recordStripeChargeRefunded({ chargeId: `ch_${tag}`, organizationId: orgId, amountRefundedCents: 4900, refundedAt: new Date().toISOString() })).toEqual({ posted: false, legs: 0 });
  });

  it("(c) the backfill seeds every chartless org once; a second run creates nothing", async () => {
    const { backfillChartOfAccounts, orgsWithoutChart } = await import("../../scripts/backfill-chart-of-accounts");
    const orgId = await newOrg("backfill");
    expect(await orgsWithoutChart()).toContain(orgId);
    const dry = await backfillChartOfAccounts(false);
    expect(dry.accountsCreated).toBe(0);
    expect(await accountsOf(orgId)).toHaveLength(0);
    const first = await backfillChartOfAccounts(true);
    expect(first.accountsCreated).toBeGreaterThan(0);
    expect(await orgsWithoutChart()).not.toContain(orgId);
    const second = await backfillChartOfAccounts(true);
    expect(second).toEqual({ orgs: 0, accountsCreated: 0 });
  });
});
