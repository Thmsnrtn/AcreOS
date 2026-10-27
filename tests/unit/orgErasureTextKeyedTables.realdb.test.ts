/**
 * Org erasure removes rows from the TEXT-keyed tenant tables (Tom's decision
 * 2026-10-26: delete, not retain), against a database built from this
 * repository.
 *
 * onboarding_funnel_metrics.org_id and pax_user_context.organization_id are
 * text. The sweep used to compare every tenant key to an integer; Postgres
 * refuses `text = integer`, the FK-retry catch swallowed the error, and the
 * rows survived every erasure while the org row itself was deleted. This runs
 * the REAL deleteOrganization() on an org holding rows in both, and checks the
 * deliberate retentions in the same run: the financial ledger is detached
 * (org id nulled), the purpose ledger is kept as written.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("orgErasureTextKeyedTables.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `oetk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = 0;

const countOf = async (q: unknown): Promise<number> => (q as { rows: Array<{ n: number }> }).rows[0].n;

describe.runIf(realDbAvailable)("deleteOrganization on text-keyed tenant tables — real database", () => {
  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    if (orgId) {
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => undefined);
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config(${"acreos.allow_purpose_ledger_mutation"}, 'on', true)`);
        await tx.execute(sql`DELETE FROM purpose_ledger WHERE organization_id = ${orgId}`);
      });
    }
    await db.execute(sql`DELETE FROM financial_ledger WHERE posted_by = ${tag}`).catch(() => undefined);
    await pool.end();
  });

  it("deletes both tables' rows for the org, keeps the retained ledgers, and leaves no residual", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { organizations } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as never).returning();
    orgId = org.id;
    const orgText = String(orgId);

    await db.execute(sql`INSERT INTO onboarding_funnel_metrics (org_id, measured_date, signup_at) VALUES (${orgText}, CURRENT_DATE, now())`);
    await db.execute(sql`INSERT INTO pax_user_context (user_id, organization_id) VALUES (${`${tag}-u`}, ${orgText})`);
    await db.execute(sql`INSERT INTO financial_ledger (organization_id, bucket, category, amount_cents, posted_by) VALUES (${orgId}, 'revenue', 'subscription', 100, ${tag})`);
    await db.execute(sql`INSERT INTO purpose_ledger (organization_id, actor_user_id, surface, purpose_code) VALUES (${orgId}, ${`${tag}-u`}, 'skip_trace_call', 'collection')`);
    // Vacuity guard: the rows exist before the erasure.
    expect(await countOf(await db.execute(sql`SELECT count(*)::int AS n FROM onboarding_funnel_metrics WHERE org_id = ${orgText}`))).toBe(1);
    expect(await countOf(await db.execute(sql`SELECT count(*)::int AS n FROM pax_user_context WHERE organization_id = ${orgText}`))).toBe(1);

    const { deleteOrganization } = await import("../../server/services/orgDeletion");
    const result = await deleteOrganization(orgId);

    expect(result.orgRowDeleted).toBe(true);
    expect(result.residualTables).toEqual([]);
    expect(result.deletedRowsByTable.onboarding_funnel_metrics).toBe(1);
    expect(result.deletedRowsByTable.pax_user_context).toBe(1);
    expect(await countOf(await db.execute(sql`SELECT count(*)::int AS n FROM onboarding_funnel_metrics WHERE org_id = ${orgText}`))).toBe(0);
    expect(await countOf(await db.execute(sql`SELECT count(*)::int AS n FROM pax_user_context WHERE organization_id = ${orgText}`))).toBe(0);
    expect(await countOf(await db.execute(sql`SELECT count(*)::int AS n FROM organizations WHERE id = ${orgId}`))).toBe(0);

    // Retained: the financial ledger row survives, detached from the tenant…
    const ledger = await db.execute(sql`SELECT organization_id FROM financial_ledger WHERE posted_by = ${tag}`);
    expect((ledger as unknown as { rows: Array<{ organization_id: number | null }> }).rows).toEqual([{ organization_id: null }]);
    // …and the purpose ledger row is kept exactly as written.
    expect(await countOf(await db.execute(sql`SELECT count(*)::int AS n FROM purpose_ledger WHERE organization_id = ${orgId}`))).toBe(1);
  });
});
