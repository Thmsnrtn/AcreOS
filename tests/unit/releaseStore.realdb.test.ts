/**
 * D2b — the release store against a REAL database built from this repository
 * (migration 0290). What a mock cannot prove:
 *   - storing the same content twice is one release (ON CONFLICT on the id);
 *   - a stored manifest is re-verified on load;
 *   - dataset_releases and dataset_release_pointer refuse UPDATE, DELETE and
 *     TRUNCATE (append-only triggers);
 *   - promote mints the next name and rollback returns to the previous
 *     release, each as ONE new pointer entry.
 * The tables have no bypass, so rows persist: every run uses county names
 * unique to it, and assertions are relative to the history it found.
 * Manifests are SYNTHETIC (no digest, bucket or county here is real).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("releaseStore.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `synthetic ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
const fixture = (f: string) => JSON.parse(readFileSync(path.join(__dirname, "../fixtures/releases", f), "utf8")).manifest;
/** The base fixture with every county renamed for this run (fresh content → fresh release id). */
const manifestFor = (suffix: string) => {
  const m = fixture("base.synthetic.json");
  for (const c of m.counties) c.county = `${c.county} ${tag} ${suffix}`;
  return m;
};

describe.runIf(realDbAvailable)("release store — real database", () => {
  afterAll(async () => {
    const { pool } = await import("../../server/db");
    await pool.end();
  });

  it("stores idempotently on content and verifies on load", async () => {
    const { storeRelease, loadRelease } = await import("../../server/services/landData/releases/releaseStore");
    const m = manifestFor("a");
    const first = await storeRelease(m, "test");
    const again = await storeRelease(m, "test");
    expect(first.created).toBe(true);
    expect(again).toEqual({ releaseId: first.releaseId, created: false });
    const loaded = await loadRelease(first.releaseId);
    expect(loaded?.counties.map((c) => c.county).sort()).toEqual(m.counties.map((c: { county: string }) => c.county).sort());
    expect(await loadRelease(`sha256:${"0".repeat(64)}`)).toBeNull();
  });

  it("refuses an invalid manifest before any write", async () => {
    const { storeRelease } = await import("../../server/services/landData/releases/releaseStore");
    await expect(storeRelease({ ...manifestFor("bad"), counties: [] }, "test")).rejects.toThrow(/invalid release manifest/);
  });

  // Row-level triggers fire per row, so a statement that touches no row cannot
  // prove anything: each statement is checked against a table that holds a row
  // (the pointer table's are checked after the promote test has written one).
  const refusesEveryMutation = async (stmts: ReturnType<typeof import("drizzle-orm").sql>[]) => {
    const { db } = await import("../../server/db");
    for (const stmt of stmts) {
      const err = await db.execute(stmt).then(() => null, (e: unknown) => e as { code?: string; cause?: { code?: string } });
      expect(err?.code ?? err?.cause?.code).toBe("23001");
    }
  };

  it("dataset_releases refuses UPDATE, DELETE and TRUNCATE", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { storeRelease } = await import("../../server/services/landData/releases/releaseStore");
    const { releaseId } = await storeRelease(manifestFor("immutable"), "test");
    const n = await db.execute(sql`SELECT count(*)::int AS n FROM dataset_releases WHERE release_id = ${releaseId}`);
    expect((n as unknown as { rows: Array<{ n: number }> }).rows[0].n).toBe(1);
    await refusesEveryMutation([
      sql`UPDATE dataset_releases SET created_by = 'x' WHERE release_id = ${releaseId}`,
      sql`DELETE FROM dataset_releases WHERE release_id = ${releaseId}`,
      sql`TRUNCATE dataset_releases CASCADE`,
    ]);
  });

  it("promote mints the next name as one new entry; rollback returns to the release before it", async () => {
    const store = await import("../../server/services/landData/releases/releaseStore");
    const { parseReleaseName } = await import("../../server/services/landData/releases/releaseName");
    const before = await store.loadPointerHistory();
    const r1 = await store.storeRelease(manifestFor("p1"), "test");
    const r2 = await store.storeRelease(manifestFor("p2"), "test");
    const at = new Date(Math.max(Date.now(), ...before.map((e) => Date.parse(e.at))) + 1000);
    const e1 = await store.movePointer({ kind: "promote", releaseId: r1.releaseId }, { at, actor: "test", reason: "first synthetic release" });
    const e2 = await store.movePointer({ kind: "promote", releaseId: r2.releaseId }, { at: new Date(at.getTime() + 1000), actor: "test", reason: "second synthetic release" });
    expect(e1.seq).toBe(before.length + 1);
    expect(e2.seq).toBe(before.length + 2);
    expect(parseReleaseName(e1.releaseName)).not.toBeNull();
    expect(e2.releaseName).not.toBe(e1.releaseName);
    await expect(store.movePointer({ kind: "promote", releaseId: r1.releaseId }, { at: new Date(at.getTime() + 2000), actor: "test", reason: "again" })).rejects.toThrow(/was current before/);
    const back = await store.movePointer({ kind: "rollback" }, { at: new Date(at.getTime() + 3000), actor: "test", reason: "roll back to the first" });
    expect(back).toMatchObject({ action: "rollback", releaseId: r1.releaseId, releaseName: e1.releaseName, previousReleaseId: r2.releaseId });
    const inv = await store.readReleaseInventory();
    expect(inv.find((r) => r.releaseId === r1.releaseId)).toMatchObject({ current: true, name: e1.releaseName });
    expect(inv.find((r) => r.releaseId === r2.releaseId)).toMatchObject({ current: false, name: e2.releaseName });

    // The pointer history now holds rows: none of it can be edited or removed.
    const { sql } = await import("drizzle-orm");
    await refusesEveryMutation([
      sql`UPDATE dataset_release_pointer SET reason = 'x' WHERE release_id = ${r1.releaseId}`,
      sql`DELETE FROM dataset_release_pointer WHERE release_id = ${r1.releaseId}`,
      sql`TRUNCATE dataset_release_pointer`,
    ]);
    expect((await store.loadPointerHistory()).length).toBe(before.length + 3);
  });
});
