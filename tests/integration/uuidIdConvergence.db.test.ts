/**
 * CONVERGE_UUID_ID_FAMILIES (scripts/migrate.mjs) converts a db:push-built
 * database — the 15 id families varchar, as shared/schema used to declare
 * them — to the canonical uuid, keeps every row and every FK, is a no-op on a
 * database that is already uuid, and refuses rather than guess when a value
 * is not a uuid. Against a REAL database, because the guarantees rest on
 * ALTER COLUMN ... USING, pg_constraint and transactional DDL, which no mock
 * evaluates.
 *
 * WHY: staging's schema comes from db:push and the nightly
 * staging-schema-reconcile runs `migrate.mjs --ddl-only` on top of it. Once
 * shared/schema says uuid, that reconcile is the normal path by which staging
 * converges; nobody runs db:push against it by hand.
 *
 * The statement under test is read out of migrate.mjs verbatim (the script
 * runs on import, so it cannot be imported), so this exercises exactly what
 * the release and the reconcile execute.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("uuidIdConvergence.db");

function convergeStatement(): string {
  const src = readFileSync(join(__dirname, "../../scripts/migrate.mjs"), "utf8");
  const m = /const CONVERGE_UUID_ID_FAMILIES = `([\s\S]*?)`;/.exec(src);
  if (!m) throw new Error("CONVERGE_UUID_ID_FAMILIES not found in scripts/migrate.mjs");
  if (m[1].includes("${")) throw new Error("statement interpolates; extract would not match what runs");
  return m[1];
}

/** The shape db:push built before uuid: varchar ids, varchar children, real FKs. */
const STAGING_SHAPED = `
  CREATE TABLE rental_leases (id varchar PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE tenants (id varchar PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE contractors (id varchar PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE rent_charges (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id varchar NOT NULL REFERENCES rental_leases(id) ON DELETE CASCADE
  );
  CREATE TABLE lease_tenants (
    lease_id varchar NOT NULL REFERENCES rental_leases(id) ON DELETE CASCADE,
    tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  );
  -- a soft reference: listed for conversion, no FK
  CREATE TABLE maintenance_tickets (id serial PRIMARY KEY, assigned_contractor_id varchar);
  CREATE TABLE earnest_money_holds (id varchar PRIMARY KEY DEFAULT gen_random_uuid());
  -- SQL-only child: not in the explicit list, found through its FK
  CREATE TABLE earnest_money_events (
    id serial PRIMARY KEY,
    hold_id varchar NOT NULL REFERENCES earnest_money_holds(id) ON DELETE RESTRICT
  );
  -- the 15th parent (V-Tax-1 T2b): its first SQL FK is tax_events
  CREATE TABLE tax_certificates (id varchar PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE tax_events (
    id serial PRIMARY KEY,
    certificate_id varchar NOT NULL REFERENCES tax_certificates(id) ON DELETE CASCADE
  );
`;

describe.runIf(realDbAvailable)("uuid id convergence — real database", () => {
  let client: pg.Client;
  const schemas: string[] = [];
  const tag = `uuidconv_${Date.now()}`;

  async function freshSchema(suffix: string): Promise<void> {
    const name = `${tag}_${suffix}`;
    schemas.push(name);
    await client.query(`CREATE SCHEMA "${name}"`);
    await client.query(`SET search_path TO "${name}"`);
  }
  async function typeOf(table: string, column: string): Promise<string> {
    const r = await client.query(
      `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute
        WHERE attrelid = to_regclass($1) AND attname = $2 AND NOT attisdropped`,
      [table, column],
    );
    return r.rows[0]?.t;
  }
  async function fks(): Promise<string[]> {
    const r = await client.query(
      `SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS d
         FROM pg_constraint
        WHERE contype = 'f' AND connamespace = $1::regnamespace
        ORDER BY 1`,
      [schemas[schemas.length - 1]],
    );
    return r.rows.map((x) => x.d);
  }

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.query("SET search_path TO public");
    for (const s of schemas) await client.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
    await client.end();
  });

  it("converts every id family and child to uuid, keeping rows, defaults and FKs", async () => {
    await freshSchema("converge");
    await client.query(STAGING_SHAPED);
    const lease = (await client.query(`INSERT INTO rental_leases DEFAULT VALUES RETURNING id`)).rows[0].id;
    const tenant = (await client.query(`INSERT INTO tenants DEFAULT VALUES RETURNING id`)).rows[0].id;
    const contractor = (await client.query(`INSERT INTO contractors DEFAULT VALUES RETURNING id`)).rows[0].id;
    const hold = (await client.query(`INSERT INTO earnest_money_holds DEFAULT VALUES RETURNING id`)).rows[0].id;
    await client.query(`INSERT INTO rent_charges(lease_id) VALUES ($1)`, [lease]);
    await client.query(`INSERT INTO lease_tenants VALUES ($1, $2)`, [lease, tenant]);
    await client.query(`INSERT INTO maintenance_tickets(assigned_contractor_id) VALUES ($1)`, [contractor]);
    // positional: earnest_money_events is SQL-only, absent from shared/schema
    await client.query(`INSERT INTO earnest_money_events VALUES (DEFAULT, $1)`, [hold]);
    const cert = (await client.query(`INSERT INTO tax_certificates DEFAULT VALUES RETURNING id`)).rows[0].id;
    await client.query(`INSERT INTO tax_events(certificate_id) VALUES ($1)`, [cert]);
    const before = await fks();
    expect(before).toHaveLength(5);

    await client.query(convergeStatement());

    for (const [t, c] of [
      ["rental_leases", "id"], ["tenants", "id"], ["contractors", "id"], ["earnest_money_holds", "id"],
      ["rent_charges", "id"], ["rent_charges", "lease_id"], ["lease_tenants", "lease_id"],
      ["lease_tenants", "tenant_id"], ["maintenance_tickets", "assigned_contractor_id"],
      ["earnest_money_events", "hold_id"],
      ["tax_certificates", "id"], ["tax_events", "certificate_id"],
    ]) {
      expect(await typeOf(t, c), `${t}.${c}`).toBe("uuid");
    }
    // the same FKs, by name and definition, ON DELETE actions included
    expect(await fks()).toEqual(before);
    // rows survive with the same ids
    const joined = await client.query(
      `SELECT l.id::text AS lease, lt.tenant_id::text AS tenant FROM rental_leases l
         JOIN rent_charges rc ON rc.lease_id = l.id JOIN lease_tenants lt ON lt.lease_id = l.id`,
    );
    expect(joined.rows).toEqual([{ lease, tenant }]);
    expect((await client.query(`SELECT hold_id::text AS h FROM earnest_money_events`)).rows).toEqual([{ h: hold }]);
    expect((await client.query(`SELECT certificate_id::text AS c FROM tax_events`)).rows).toEqual([{ c: cert }]);
    // the default still mints ids, now as uuid
    const minted = (await client.query(`INSERT INTO rental_leases DEFAULT VALUES RETURNING id`)).rows[0].id;
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    // and the FKs still enforce
    await expect(
      client.query(`INSERT INTO rent_charges(lease_id) VALUES (gen_random_uuid())`),
    ).rejects.toThrow(/foreign key/);
  });

  it("is a no-op on a database that is already uuid (a second run, production, a fresh build)", async () => {
    // same schema as the previous test, now uuid
    const before = await fks();
    await client.query(convergeStatement());
    expect(await fks()).toEqual(before);
    expect(await typeOf("rental_leases", "id")).toBe("uuid");
  });

  it("refuses, naming the column, when a value is not a uuid — and changes nothing", async () => {
    await freshSchema("refuse");
    await client.query(STAGING_SHAPED);
    await client.query(`INSERT INTO rental_leases(id) VALUES ('lease-1')`);
    await client.query(`INSERT INTO rent_charges(lease_id) VALUES ('lease-1')`);
    const before = await fks();

    await expect(client.query(convergeStatement())).rejects.toThrow(
      /uuid id convergence refused: (rental_leases\.id|rent_charges\.lease_id) has 1 non-uuid value/,
    );

    expect(await typeOf("rental_leases", "id")).toBe("character varying");
    expect(await typeOf("rent_charges", "lease_id")).toBe("character varying");
    expect(await fks()).toEqual(before);
  });

  it("does nothing on a database where none of the tables exist yet", async () => {
    await freshSchema("empty");
    await client.query(convergeStatement());
    expect(await fks()).toEqual([]);
  });
});
