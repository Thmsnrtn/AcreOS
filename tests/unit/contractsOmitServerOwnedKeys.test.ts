/**
 * No insert contract lets a client choose a server-owned column.
 *
 * `leadCreateRequestSchema` was `insertLeadSchema.passthrough()`. The base
 * schema omits `id`, but `.passthrough()` re-admits every unknown key, and an
 * omitted key is just an unknown key — so a body carrying `id` reached the
 * insert. A client could choose a lead's primary key, and an id planted ahead
 * of the shared sequence makes a later sequence value collide, failing lead
 * creation for every tenant.
 *
 * THE RULE: for every request contract that creates a row, a body naming the
 * row's primary key, tenant key, server timestamps or generated columns either
 * fails to parse or comes out without them.
 *
 * THE POPULATION: every `ApiContract` declared in any shared/contracts/*.ts
 * file, read from the source and required to be registered in API_CONTRACTS
 * (so a new contract file cannot sit outside this gate), with a floor. Each
 * creating contract must name its table here — the forbidden keys are DERIVED
 * from that pgTable, not hand-listed — and supply a valid sample body, which is
 * the per-member vacuity check: a sample that does not parse would make
 * "the key was not in the output" true of every schema.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import { leads, insertLeadSchema as canonicalInsertLeadSchema } from "@shared/schema";
import { API_CONTRACTS } from "@shared/contracts";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const CONTRACTS_DIR = path.join(ROOT, "shared/contracts");

type AnyContract = (typeof API_CONTRACTS)[keyof typeof API_CONTRACTS];

/**
 * Each creating contract → the table it inserts into, the table's canonical
 * drizzle-zod insert schema (whatever it omits is server-owned), and a valid body.
 */
const CREATING_CONTRACTS: Record<
  string,
  { table: PgTable; canonicalInsert: { shape: Record<string, unknown> }; sample: Record<string, unknown> }
> = {
  "POST /api/leads": {
    table: leads,
    canonicalInsert: canonicalInsertLeadSchema as unknown as { shape: Record<string, unknown> },
    sample: { firstName: "Dana", lastName: "Reyes" },
  },
};

/** At least this many creating contracts must be found. Raise it as they are added. */
const CREATING_CONTRACT_FLOOR = 1;

const SERVER_TIMESTAMPS = ["createdAt", "updatedAt"];

function serverOwnedKeys(table: PgTable, canonicalInsert: { shape: Record<string, unknown> }): string[] {
  const cfg = getTableConfig(table);
  const byName = new Map(Object.entries(getTableColumns(table)).map(([k, c]) => [c.name, k]));
  const keys = new Set<string>();
  for (const col of cfg.columns) {
    const tsKey = byName.get(col.name)!;
    if (col.primary) keys.add(tsKey);
    if ((col as { generated?: unknown }).generated) keys.add(tsKey);
  }
  for (const pk of cfg.primaryKeys) for (const c of pk.columns) keys.add(byName.get(c.name)!);
  const all = new Set(byName.values());
  for (const k of ["organizationId", ...SERVER_TIMESTAMPS]) if (all.has(k)) keys.add(k);
  // Whatever the canonical insert schema omits is not the client's to write
  // (e.g. a generated column the drizzle table does not mark as generated).
  for (const k of all) if (!(k in canonicalInsert.shape)) keys.add(k);
  return [...keys];
}

/** A plausible value of the column's kind, so the planted key is not rejected for its type alone. */
function plantedValue(table: PgTable, key: string): unknown {
  const col = (getTableColumns(table) as Record<string, { dataType: string }>)[key];
  if (col?.dataType === "date") return new Date("2026-01-01T00:00:00Z");
  if (col?.dataType === "number") return 2_000_000_000;
  return "planted";
}

describe("population", () => {
  const declared: string[] = [];
  for (const file of fs.readdirSync(CONTRACTS_DIR)) {
    if (!file.endsWith(".ts") || file === "index.ts") continue;
    const src = stripComments(fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8"));
    for (const m of src.matchAll(/export\s+const\s+(\w+)\s*:\s*ApiContract\s*</g)) declared.push(m[1]);
  }
  const registered = new Set(Object.values(API_CONTRACTS));

  it("every ApiContract declared in shared/contracts is registered in API_CONTRACTS", async () => {
    expect(declared.length, "no ApiContract declarations parsed — did the shape change?").toBeGreaterThanOrEqual(2);
    const mod = (await import("@shared/contracts")) as Record<string, unknown>;
    const unregistered = declared.filter((name) => !registered.has(mod[name] as AnyContract));
    expect(unregistered, "a contract outside API_CONTRACTS is outside this gate").toEqual([]);
  });

  it("every creating contract names its table and sample, and the floor holds", () => {
    const creating = Object.entries(API_CONTRACTS)
      .filter(([, c]) => (c as AnyContract).requestSchema !== null && (c as AnyContract).method !== "GET")
      .map(([k]) => k);
    expect(creating.length).toBeGreaterThanOrEqual(CREATING_CONTRACT_FLOOR);
    for (const key of creating) {
      expect(CREATING_CONTRACTS[key], `${key} has a request body but no entry in CREATING_CONTRACTS`).toBeDefined();
    }
    for (const key of Object.keys(CREATING_CONTRACTS)) {
      expect(API_CONTRACTS, `${key} is listed here but no longer registered`).toHaveProperty([key]);
    }
  });
});

describe.each(Object.entries(CREATING_CONTRACTS))("%s", (key, { table, canonicalInsert, sample }) => {
  const contract = (API_CONTRACTS as Record<string, AnyContract>)[key];
  const schema = contract.requestSchema!;
  const forbidden = serverOwnedKeys(table, canonicalInsert);

  it("vacuity: the sample body parses, and the table has a primary key", () => {
    expect(schema.safeParse(sample).success).toBe(true);
    const pk = getTableConfig(table).columns.filter((c) => c.primary).length + getTableConfig(table).primaryKeys.length;
    expect(pk).toBeGreaterThan(0);
    expect(forbidden).toContain("id");
    // The canonical shape is read, not assumed: it must name real columns.
    expect(Object.keys(canonicalInsert.shape).length).toBeGreaterThan(5);
  });

  it.each(forbidden)("a client cannot set %s", (field) => {
    const parsed = schema.safeParse({ ...sample, [field]: plantedValue(table, field) });
    if (parsed.success) {
      expect(Object.prototype.hasOwnProperty.call(parsed.data, field), `${field} survived the parse`).toBe(false);
    }
  });
});
