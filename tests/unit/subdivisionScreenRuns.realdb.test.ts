/**
 * Subdivision V1, Leg 1 — subdivision_screen_runs against a REAL database
 * built from this repository (migration 0301). What a mock cannot prove:
 *   - the database itself refuses UPDATE on a run (append-only, trigger);
 *   - organization erasure still removes the org's runs (DELETE is left to
 *     erasure; the organization_id FK cascades);
 *   - parent_parcel_id is not a foreign key: a run survives its parcel.
 * Every row is SYNTHETIC and tagged for this run.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("subdivisionScreenRuns.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `synthetic-screen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe.runIf(realDbAvailable)("subdivision_screen_runs — real database", () => {
  afterAll(async () => {
    const { pool } = await import("../../server/db");
    await pool.end();
  });

  it("refuses UPDATE; survives its parcel; is removed with its organization", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { organizations, subdivisionScreenRuns } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as never).returning();
    const [run] = await db
      .insert(subdivisionScreenRuns)
      .values({
        organizationId: org.id,
        parentParcelId: 2_147_483_000, // no such parcel: not a foreign key, by design
        ruleVersion: "buildability-screen v1",
        inputs: { synthetic: true },
        yieldEstimate: { synthetic: true },
        result: { synthetic: true },
        triggeredCount: 0,
        notDeterminableCount: 7,
        actorRef: tag,
      })
      .returning();
    expect(run.id).toBeGreaterThan(0);

    // drizzle wraps the driver error ("Failed query: …"); the trigger's own code and message are on the cause.
    const err = await db.execute(sql`UPDATE subdivision_screen_runs SET triggered_count = 1 WHERE id = ${run.id}`).then(
      () => null,
      (e: unknown) => e as { code?: string; message?: string; cause?: { code?: string; message?: string } },
    );
    expect(err, "the UPDATE must be refused").not.toBeNull();
    expect(err?.code ?? err?.cause?.code).toBe("23001");
    expect(err?.cause?.message ?? err?.message).toMatch(/append-only/);
    const [still] = (await db.execute(sql`SELECT triggered_count FROM subdivision_screen_runs WHERE id = ${run.id}`)).rows as Array<{ triggered_count: number }>;
    expect(still.triggered_count).toBe(0);

    await db.execute(sql`DELETE FROM organizations WHERE id = ${org.id}`);
    const gone = (await db.execute(sql`SELECT count(*)::int AS n FROM subdivision_screen_runs WHERE id = ${run.id}`)).rows as Array<{ n: number }>;
    expect(gone[0].n).toBe(0);
  });
});
