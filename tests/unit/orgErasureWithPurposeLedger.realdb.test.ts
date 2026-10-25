/**
 * MERGE BLOCKER (D2e, 2026-10-25): the right-to-erasure path must finish for
 * an organization that has used skip trace.
 *
 * purpose_ledger is append-only — its BEFORE DELETE trigger refuses every
 * delete — and it first shipped with organization_id REFERENCES organizations.
 * deleteOrganization() then could not remove the organizations row for any org
 * holding a ledger row: the sweep's DELETE hit the trigger, and the final org
 * delete hit the FK. The fix keeps the ledger as a retained compliance record
 * (GDPR Art. 17(3)(b), RETAINED_TABLES) with no FK, so the erasure finishes and
 * the record survives. This runs the REAL deleteOrganization() against a
 * database built from this repository.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("orgErasureWithPurposeLedger.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `oep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = 0;
let controlId = 0;

describe.runIf(realDbAvailable)("deleteOrganization on an org that used skip trace — real database", () => {
  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    if (controlId) await db.execute(sql`DELETE FROM organizations WHERE id = ${controlId}`).catch(() => undefined);
    if (orgId) {
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => undefined);
      // Test cleanup only: the DBA retention GUC is the one way through the trigger.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config(${"acreos.allow_purpose_ledger_mutation"}, 'on', true)`);
        await tx.execute(sql`DELETE FROM purpose_ledger WHERE organization_id = ${orgId}`);
      });
    }
    await pool.end();
  });

  // Residuals are compared against a CONTROL org with no ledger row: two
  // text-keyed tables (onboarding_funnel_metrics.org_id, pax_user_context
  // .organization_id) are never swept for ANY org today — `text = integer`
  // errors — and whether erasure should delete them is a retention decision
  // escalated separately. What this pins is that the ledger adds nothing.
  it("removes the organizations row, adds no residual beyond a ledger-free org's, and keeps the purpose-ledger record", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { organizations, purposeLedger } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as never).returning();
    orgId = org.id;
    await db.insert(purposeLedger).values({ organizationId: orgId, actorUserId: `${tag}-u`, surface: "skip_trace_call", purposeCode: "collection" });

    const [control] = await db.insert(organizations).values({ name: `${tag}-c`, slug: `${tag}-c`, ownerId: `${tag}-c` } as never).returning();
    controlId = control.id;

    const { deleteOrganization } = await import("../../server/services/orgDeletion");
    const baseline = await deleteOrganization(controlId);
    const result = await deleteOrganization(orgId);

    expect(result.orgRowDeleted).toBe(true);
    expect(result.residualTables).not.toContain("purpose_ledger");
    expect([...result.residualTables].sort()).toEqual([...baseline.residualTables].sort());
    const orgLeft = await db.execute(sql`SELECT count(*)::int AS n FROM organizations WHERE id = ${orgId}`);
    expect((orgLeft as unknown as { rows: Array<{ n: number }> }).rows[0].n).toBe(0);
    const kept = await db.execute(sql`SELECT count(*)::int AS n FROM purpose_ledger WHERE organization_id = ${orgId}`);
    expect((kept as unknown as { rows: Array<{ n: number }> }).rows[0].n).toBe(1);
  });
});
