/**
 * Legal-run Leg 6 (LQ-07 §4.3) — the two deletion paths that were blind to
 * legal holds, run for real against a database built from this repository.
 *
 *  6.2  The nightly retention job (server/jobs/dataRetention.ts) deleted by
 *       raw SQL with no org dimension: a held org's expired rows went with
 *       everyone else's.
 *  6.1  Org erasure (server/services/orgDeletion.ts) checked no hold at all,
 *       and `legal_holds` is itself a tenant table the sweep deleted first.
 *
 * Falsifying shape: on the previous tree the held org's rows are purged by
 * the job and the held org is erased; here both are kept, and both paths
 * proceed exactly as before once the hold is released.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("retentionRespectsLegalHolds.realdb.test.ts");

const logs = vi.hoisted(() => ({ error: [] as string[] }));
vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn((m: string) => {
      logs.error.push(String(m));
    }),
  },
}));

const tag = `lh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let heldOrg = 0;
let freeOrg = 0;

describe.runIf(realDbAvailable)("legal holds stop the nightly purge and org erasure — real database", () => {
  const OLD = "2001-01-01T00:00:00Z"; // far past every retention window

  async function q<T = Record<string, unknown>>(text: TemplateStringsArray, ...vals: unknown[]): Promise<T[]> {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const res = await db.execute(sql(text, ...vals));
    return ((res as { rows?: T[] }).rows ?? []) as T[];
  }

  async function seedExpired(orgId: number) {
    await q`INSERT INTO activity_events (organization_id, entity_type, entity_id, event_type, description, created_at)
            VALUES (${orgId}, 'lead', 1, 'note', ${tag}, ${OLD}::timestamp)`;
    await q`INSERT INTO usage_events (organization_id, event_type, created_at)
            VALUES (${orgId}, ${tag}, ${OLD}::timestamp)`;
  }
  async function expiredCount(orgId: number): Promise<number> {
    const [a] = await q<{ n: number }>`SELECT count(*)::int AS n FROM activity_events WHERE organization_id = ${orgId} AND description = ${tag}`;
    const [u] = await q<{ n: number }>`SELECT count(*)::int AS n FROM usage_events WHERE organization_id = ${orgId} AND event_type = ${tag}`;
    return Number(a.n) + Number(u.n);
  }

  beforeAll(async () => {
    const [h] = await q<{ id: number }>`INSERT INTO organizations (name, slug, owner_id) VALUES (${tag + "-held"}, ${tag + "-held"}, ${tag + "-o1"}) RETURNING id`;
    const [f] = await q<{ id: number }>`INSERT INTO organizations (name, slug, owner_id) VALUES (${tag + "-free"}, ${tag + "-free"}, ${tag + "-o2"}) RETURNING id`;
    heldOrg = h.id;
    freeOrg = f.id;
    await q`INSERT INTO legal_holds (organization_id, case_ref, scope) VALUES (${heldOrg}, ${tag + "-case"}, 'org_wide')`;
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    for (const id of [heldOrg, freeOrg]) {
      if (!id) continue;
      await q`DELETE FROM activity_events WHERE organization_id = ${id}`.catch(() => undefined);
      await q`DELETE FROM usage_events WHERE organization_id = ${id}`.catch(() => undefined);
      await q`DELETE FROM legal_holds WHERE organization_id = ${id}`.catch(() => undefined);
      await q`DELETE FROM organizations WHERE id = ${id}`.catch(() => undefined);
    }
    await pool.end();
  });

  it("6.2 nightly job: held org's expired org-scoped rows are kept, the unheld org's are purged, and the keep is reported", async () => {
    await seedExpired(heldOrg);
    await seedExpired(freeOrg);
    expect(await expiredCount(heldOrg)).toBe(2);
    expect(await expiredCount(freeOrg)).toBe(2);

    const { runDataRetention } = await import("../../server/jobs/dataRetention");
    logs.error.length = 0;
    const result = await runDataRetention();

    expect(await expiredCount(freeOrg)).toBe(0);
    expect(await expiredCount(heldOrg)).toBe(2);
    const labels = result.heldRetained.map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(["Activity events (timeline)", "Usage events"]));
    for (const r of result.heldRetained) expect(r.heldOrgIds).toContain(heldOrg);
    expect(logs.error.some((m) => m.includes("[data-retention] HELD"))).toBe(true);
  });

  it("6.1 org erasure: a held org is refused with the hold error and NOTHING is deleted", async () => {
    const { deleteOrganization } = await import("../../server/services/orgDeletion");
    logs.error.length = 0;
    await expect(deleteOrganization(heldOrg)).rejects.toMatchObject({ name: "LegalHoldViolationError", code: "LEGAL_HOLD_ACTIVE" });

    const [org] = await q<{ n: number }>`SELECT count(*)::int AS n FROM organizations WHERE id = ${heldOrg}`;
    expect(Number(org.n)).toBe(1);
    const [hold] = await q<{ n: number }>`SELECT count(*)::int AS n FROM legal_holds WHERE organization_id = ${heldOrg}`;
    expect(Number(hold.n)).toBe(1);
    expect(await expiredCount(heldOrg)).toBe(2);
    expect(logs.error.some((m) => m.includes("REFUSED") && m.includes(`${tag}-case`))).toBe(true);
    const [audit] = await q<{ n: number }>`SELECT count(*)::int AS n FROM audit_events WHERE action = 'org_erasure.refused_legal_hold' AND target_id = ${String(heldOrg)}`;
    expect(Number(audit.n)).toBeGreaterThanOrEqual(1);
  });

  it("a RELEASED hold no longer blocks: the job purges and the erasure proceeds", async () => {
    await q`UPDATE legal_holds SET status = 'released', released_at = now() WHERE organization_id = ${heldOrg}`;

    const { runDataRetention } = await import("../../server/jobs/dataRetention");
    const result = await runDataRetention();
    expect(await expiredCount(heldOrg)).toBe(0);
    expect(result.heldRetained.filter((r) => r.heldOrgIds.includes(heldOrg))).toEqual([]);

    const { deleteOrganization } = await import("../../server/services/orgDeletion");
    const del = await deleteOrganization(heldOrg);
    expect(del.orgRowDeleted).toBe(true);
    heldOrg = 0;
  });
});
