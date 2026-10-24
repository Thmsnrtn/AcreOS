/**
 * D2e — the purpose ledger is append-only in the DATABASE, not just in code:
 * migration 0289 run verbatim in a scratch schema, then UPDATE and DELETE are
 * attempted and must raise restrict_violation; the DBA retention GUC is the
 * only way through. Runs where a real database is wired (ACREOS_REAL_DATABASE_URL).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("purposeLedgerAppendOnly.db.test.ts");

describe.runIf(realDbAvailable)("purpose_ledger append-only — real database", () => {
  let client: pg.Client;
  const schema = `purpose_ledger_${Date.now()}`;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE organizations (id serial PRIMARY KEY)`);
    await client.query(`INSERT INTO organizations DEFAULT VALUES`);
    await client.query(readFileSync(join(__dirname, "../../migrations/0289_d2e_purpose_ledger.sql"), "utf8"));
    await client.query(`INSERT INTO purpose_ledger (organization_id, actor_user_id, surface, purpose_code) VALUES (1, 'u1', 'skip_trace_call', 'collection')`);
  });

  afterAll(async () => {
    await client.query(`SET search_path TO public`);
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("UPDATE is refused with restrict_violation", async () => {
    const err = await client.query(`UPDATE purpose_ledger SET purpose_code = 'written_consent'`).catch((e) => e);
    expect(err?.code).toBe("23001");
    expect(String(err?.message)).toMatch(/append-only/);
  });

  it("DELETE is refused with restrict_violation", async () => {
    const err = await client.query(`DELETE FROM purpose_ledger`).catch((e) => e);
    expect(err?.code).toBe("23001");
  });

  it("a NULL purpose code cannot be stored", async () => {
    const err = await client.query(`INSERT INTO purpose_ledger (organization_id, actor_user_id, surface, purpose_code) VALUES (1, 'u1', 'skip_trace_call', NULL)`).catch((e) => e);
    expect(err?.code).toBe("23502");
  });

  it("only the DBA retention GUC lets a row be removed", async () => {
    await client.query(`BEGIN`);
    await client.query("SET LOCAL acreos.allow_purpose_ledger_mutation = 'on'");
    const r = await client.query(`DELETE FROM purpose_ledger`);
    await client.query(`ROLLBACK`);
    expect(r.rowCount).toBe(1);
    const left = await client.query(`SELECT count(*)::int AS n FROM purpose_ledger`);
    expect(left.rows[0].n).toBe(1);
  });
});
